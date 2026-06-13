# Rebuild Plan — Order Management (Currency Exchange Back Office)

## Reference App Location (READ FIRST)

This plan is executed inside a **fresh, empty project**. The "current app" / "old app"
referenced throughout this document is a **separate existing codebase on disk** — it is
NOT in the new project. Whenever this plan says "the current app", "the old app",
`server/...`, `db.js`, `ordersController.js`, `app.db`, etc., it means a path inside the
legacy app directory below.

```
<LEGACY_APP> = /Users/yin/Documents/Codes/Webapp Projects/ordermanagement
```

Key reference paths inside `<LEGACY_APP>` (read-only — never modify the legacy app):

```
<LEGACY_APP>/server/                       # Express backend (the behavior spec)
<LEGACY_APP>/server/db.js                  # 1,622-line schema/DDL reference
<LEGACY_APP>/server/controllers/           # per-domain behavior (ordersController.js = 4,286 lines)
<LEGACY_APP>/server/services/              # money logic (ledger, funding, profit, conversion)
<LEGACY_APP>/server/utils/                 # permissions, account access, file storage, currency conversion
<LEGACY_APP>/src/                          # legacy React frontend
<LEGACY_APP>/server/data/app.db            # live SQLite data = ETL source + test fixtures (§20)
```

Old → new module mapping (use the left side as the spec when building the right side):

```
ordersController.js                              -> modules/orders/ (§10)
accountsController.js + utils/accountAccess.js   -> modules/accounts/ (§11)
customersController.js, customerLedgerController.js,
  services/customerLedgerOrders.js,
  services/customerLedgerAccounts.js,
  services/customerFundingBalances.js            -> modules/customers, customerLedger, customerFunding (§12)
profitController.js, services/profitConversion.js,
  services/customerTradeProfitLoss.js            -> modules/profit (§14)
utils/orderPermissions.js,
  utils/customerPermissions.js                   -> packages/shared/permissions (§8)
uploadsController.js, utils/fileStorage.js       -> core/uploads (§15)
server/db.js (inline DDL)                        -> packages/db schema (§5)
```

Highest-risk files to read carefully (financial behavior that must NOT silently change):
`services/customerLedgerOrders.js`, `services/customerFundingBalances.js`,
`services/customerTradeProfitLoss.js`, `services/profitConversion.js`,
`utils/currencyConversion.js`, `utils/orderReceiptFunding.js`.

> If the legacy app is not at the path above (e.g. it was moved), update `<LEGACY_APP>`
> here first, then proceed. All references below assume this directory exists and is
> readable.

---

## Goal
Rebuild the app as a **clean, scalable, maintainable monorepo**. Same proven feature
set, but with feature-module boundaries, shared types/permissions, thin controllers,
split god-files, and a single database (Postgres). The legacy app at `<LEGACY_APP>` is
the **business behavior reference**, not code to copy 1:1.

This is a **business-critical financial system**. The most important success criteria,
in order, are: **money correctness, data-migration safety, permission correctness,
auditability, maintainability, production reliability.** The legacy app at `<LEGACY_APP>`
must be used as the behavior reference; the new app must be cleaner and safer but must
**not silently change financial behavior** unless the change is explicitly approved and
documented.

> Note: there is **no order type concept** in this app (no OTC / online / batch).
> Any `orderType` / `OTC` / `online` strings, filenames, or constants in the legacy
> code at `<LEGACY_APP>` are leftovers and must NOT be carried into the rebuild. Orders
> are a single, uniform entity.

Do **not** rebuild or carry forward: `orderType`, OTC orders, online orders, batch order
type, `approval_requests`, the old approval workflow, the legacy SQLite runtime path,
base64-in-DB upload storage, the giant `db.js`, the giant `api.ts`, the giant
`ordersController.js`.

### Decisions (locked)
- **Package manager:** **pnpm workspaces** (better dependency isolation, cleaner
  workspace linking, faster installs). Turborepo may be added later for build
  orchestration if needed, but `pnpm workspaces` is the default.
- **Database:** Postgres + Drizzle ORM (drop better-sqlite3 and the stray `pg` path).
  SQLite is **only** the old source database for migration — never a runtime DB.
- **Backend:** Express + TypeScript, Drizzle, Zod, httpOnly-cookie JWT, RBAC.
- **Frontend:** React + Vite + TypeScript, RTK Query, Tailwind, i18next.
- **Strategy:** Fresh repo, port domain-by-domain using the legacy app at `<LEGACY_APP>`
  as the spec.
- **Scope:** Lean core first; integrations are env-flagged plugins.
- **Data:** Existing data lives in SQLite. A repeatable, **restorable** SQLite→Postgres
  migration is a first-class workstream (see §20).
- **Hosting:** Railway (Postgres plugin + persistent volume for uploads/backups).

---

## 1. Monorepo Layout

Tooling: **pnpm workspaces** (Turborepo optional, added only if build orchestration
needs it). One lockfile, one TypeScript project graph, shared config presets.

```
order-management/
├── package.json                 # workspace root scripts
├── pnpm-workspace.yaml
├── turbo.json                   # optional, only if Turborepo is added
├── tsconfig.base.json
├── .env.example
├── README.md
├── apps/
│   ├── web/                     # React + Vite + RTK Query + Tailwind + i18next
│   └── api/                     # Express + Drizzle + JWT (httpOnly cookies)
├── packages/
│   ├── shared/                  # types + Zod schemas + permission catalog (single source of truth)
│   ├── db/                      # Drizzle schema, migrations, seeds, connection
│   └── config/                  # eslint/tsconfig/tailwind presets shared across apps
├── tools/
│   └── migrate-sqlite/          # one-shot SQLite→Postgres ETL + verifier (see §20)
├── docs/                        # all docs (move WALLET_TRACKER_*, TRONSCAN, TELEGRAM_* here)
└── backups/
```

---

## 2. Backend Module Structure (`apps/api`)

Every domain is a self-contained module. **Controllers are thin** (parse → validate →
call service → respond). **Services hold business logic.** **Repositories hold all SQL
(Drizzle).** No raw SQL outside repositories.

```
apps/api/src/
├── server.ts                       # process bootstrap (listen, graceful shutdown, jobs)
├── app.ts                          # express app: mounts core + modules
├── core/
│   ├── env.ts                      # typed env loader (replaces scattered process.env)
│   ├── errors/                     # AppError + central error middleware + typed error shape
│   ├── http/
│   │   ├── asyncHandler.ts
│   │   ├── validate.ts             # zod request validation middleware
│   │   └── listQuery.ts            # parses standard list params (see §9)
│   ├── auth/
│   │   ├── jwt.ts                  # sign/verify httpOnly cookie tokens
│   │   ├── authMiddleware.ts       # requireAuth
│   │   ├── rbac.ts                 # section(), action(), anySection() guards (see §8)
│   │   └── loginLockout.ts
│   ├── uploads/
│   │   ├── multer.ts               # memory storage, size/mime limits
│   │   ├── fileStorage.ts          # save/delete/url, DATA_DIR aware (see §15)
│   │   └── staticUploads.ts        # GET /api/uploads/* handler
│   ├── importExport/               # shared Excel toolkit (see §16)
│   │   ├── excelParser.ts
│   │   ├── excelWriter.ts
│   │   ├── importValidator.ts
│   │   ├── exportFilterBuilder.ts
│   │   └── importResult.ts
│   ├── realtime/
│   │   └── cacheSyncBroadcast.ts   # SSE channel for cross-client cache invalidation
│   └── logger/                     # structured logging (see §23)
├── modules/
│   ├── auth/                       # login, logout, refresh, password reset, 2FA enroll/verify
│   ├── users/
│   ├── roles/                      # roles + permission assignment
│   ├── currencies/
│   ├── exchangeRates/              # manual/derived rates used across modules
│   ├── referenceRates/             # reference rate pairs + calculator
│   ├── customers/                  # customer CRUD + pins + sort
│   ├── kyc/                        # kyc schema builder + customer kyc docs
│   ├── customerLedger/             # ledger entries, rebuild-from-orders
│   ├── customerFunding/            # funding balances
│   ├── accounts/                   # accounts + balances + access scoping (see §11)
│   ├── orders/                     # see §10 (largest module, fully split)
│   ├── transfers/
│   ├── expenses/
│   ├── profit/                     # profit calculation configs + conversion (see §14)
│   ├── tags/
│   ├── notifications/              # in-app notifications + preferences (see §17)
│   ├── settings/                   # app settings + branding
│   └── dashboard/                  # aggregate stats
├── plugins/                        # env-flagged; core boots without them (see §18)
│   ├── telegram/                   # bot api, webhook setup, command handlers
│   ├── email/                      # resend-based sender + templates
│   ├── twofa/                      # speakeasy/qrcode
│   └── walletTracker/              # tron wallets + poller (background job, see §19)
└── jobs/
    └── walletRefresh.job.ts        # interval poller, started from server.ts (see §19)
```

Each `modules/<domain>/` folder contains exactly:

```
modules/<domain>/
├── <domain>.routes.ts        # express.Router(); applies rbac guards
├── <domain>.controller.ts    # thin handlers (request/response only)
├── <domain>.service.ts       # business logic only
├── <domain>.repository.ts    # Drizzle queries only
├── <domain>.schema.ts        # re-exports zod schemas from packages/shared
└── index.ts                  # mounts router under /api/<domain>
```

Rule: `routes` = route definitions + middleware; `controller` = request/response only;
`service` = business logic only; `repository` = DB access only; `schema` = Zod. No raw
SQL outside repositories. Controllers stay thin.

---

## 3. Frontend Module Structure (`apps/web`)

Feature folders own their components, hooks, API slice, and types. **Pages are thin
shells** over a `usePageLogic()` hook.

```
apps/web/src/
├── main.tsx                        # single entry (delete legacy main.jsx pattern)
├── App.tsx
├── app/
│   ├── store.ts
│   ├── hooks.ts                    # typed useAppDispatch/useAppSelector
│   ├── authSlice.ts
│   └── router.tsx                  # route table + guards (hasSectionAccess)
├── services/
│   ├── baseApi.ts                  # createApi: baseUrl, credentials:'include', shared error handling
│   │                               #   -> the ONLY fetch path (incl. Excel import/export)
│   ├── ordersApi.ts                # injectEndpoints
│   ├── customersApi.ts
│   ├── accountsApi.ts
│   ├── customerLedgerApi.ts
│   ├── transfersApi.ts
│   ├── expensesApi.ts
│   ├── profitApi.ts
│   ├── currenciesApi.ts
│   ├── referenceRatesApi.ts
│   ├── notificationsApi.ts
│   ├── rolesApi.ts / usersApi.ts / settingsApi.ts / tagsApi.ts / authApi.ts / dashboardApi.ts
├── features/
│   └── orders/                     # template for every feature
│       ├── pages/OrdersPage.tsx    # thin shell -> useOrdersPage()
│       ├── components/             # OrderTable, OrderRow, OrderFormModal, OrderViewModal,
│       │                           #   OrderFileSection (variant="receipt"|"payment"),
│       │                           #   OrderProfitSection, OrderServiceChargeSection,
│       │                           #   OrderChangesDrawer, OrderFilters
│       ├── hooks/                  # useOrdersPage, useOrderForm, useOrdersTable,
│       │                           #   useOrdersFilters, useOrdersActions, useOrdersModals
│       ├── utils/
│       └── types.ts               # re-exports from packages/shared
├── shared/
│   ├── ui/                         # DataTable, Modal, ConfirmDialog, AlertDialog, Pagination,
│   │                               #   FilterBar, SearchInput, DateRangeFilter, TagFilter,
│   │                               #   FileUpload, ActionsMenu, FormField, EmptyState,
│   │                               #   LoadingState, ErrorState
│   ├── hooks/
│   │   ├── useEntityImportExport.ts   # generic; replaces 3 near-identical hooks
│   │   ├── useListFilters.ts          # generic; date presets, pagination reset, tag/search
│   │   ├── useBatchDelete.ts
│   │   └── useIdleTimeout.ts
│   ├── utils/
│   └── layout/
├── i18n/locales/{en,zh}.json
└── routes/                         # route table + guards (hasSectionAccess)
```

Pages stay thin:

```tsx
export default function OrdersPage() {
  const page = useOrdersPage();
  return <OrdersLayout {...page} />;
}
```

Feature folders to create (one per domain): `auth, users, roles, currencies,
exchangeRates, referenceRates, customers, kyc, customerLedger, customerFunding,
accounts, orders, transfers, expenses, profit, tags, notifications, settings,
dashboard, walletTracker`.

### 3.1 RTK Query rules
- One `baseApi` (`services/baseApi.ts`); all domains use `injectEndpoints`.
- No giant `api.ts`.
- No raw `fetch()` anywhere (including import/export) — everything goes through `baseApi`.

---

## 4. Shared Package (`packages/shared`)

One shared package is the single source of truth used by both apps, eliminating
client/server drift.

```
packages/shared/src/
├── types/
├── schemas/        # Zod schemas
├── permissions/    # sections + actions + rules (see §8)
├── constants/
├── utils/
└── api/            # shared list request/response contracts
```

Domains covered: `auth, users, roles, currencies, customers, kyc, accounts, orders,
transfers, expenses, ledger, funding, profit, tags, notifications, settings, pagination,
permissions`.

---

## 5. Database Rules

1. **Postgres only.** No SQLite runtime, no dual-DB. The reference-rates `pg` path is
   folded in. SQLite is only the migration source.
2. **Drizzle is the single schema source.** Schema lives in `packages/db/src/schema/*.ts`;
   migrations are generated, versioned files in `packages/db/migrations/`. No inline
   `CREATE TABLE` at runtime (replaces the 159 inline DDL statements in
   `<LEGACY_APP>/server/db.js`).
3. **No business logic in the DB** (no triggers for app logic); keep it in services so it
   is testable. Constraints/indexes only.
4. **Migrations run before the app starts** (see §22.2), never inside request handling.

Schema package layout:

```
packages/db/src/
├── connection.ts
├── migrate.ts
├── schema/
│   ├── users.ts            roles.ts             permissions.ts
│   ├── currencies.ts       exchangeRates.ts     referenceRates.ts
│   ├── customers.ts        customerBeneficiaries.ts   customerKyc.ts
│   ├── accounts.ts         accountTransactions.ts
│   ├── orders.ts           orderReceipts.ts     orderPayments.ts
│   ├── orderBeneficiaries.ts  orderProfits.ts   orderServiceCharges.ts
│   ├── orderChanges.ts     orderPins.ts
│   ├── transfers.ts        expenses.ts
│   ├── customerLedger.ts   customerFunding.ts   profit.ts
│   ├── tags.ts             notifications.ts     settings.ts
│   ├── uploads.ts          walletTracker.ts
│   └── index.ts
├── migrations/
└── seeds/
```

### 5.1 Money fields
All money, rates, balances, profits, and service charges use **`numeric(20,8)`**. Never
`float`, `double`, `real`, or a JavaScript `number` for final financial calculation.
Financial calculations use decimal-safe handling in service logic.

### 5.2 Timestamps
Use **`timestamptz`**, defaulting to `now()`. Store UTC in the database; format for the
user in the frontend.

### 5.3 Identity keys
`bigint generated always as identity` (or `serial`); after data migration, reset
sequences to `max(id)+1`.

### 5.4 Booleans
Real `boolean` (SQLite stored 0/1 ints — convert during ETL).

### 5.5 Enums
Enums for fixed vocabularies: `order_status` (`draft`,`confirmed`,`completed`,
`cancelled`,`saved` — confirm exact set during port), `ledger_entry_status`,
`notification_type`. Drop the removed `approval_requests` table and its notification
types entirely.

### 5.6 Foreign keys
Enforce FKs with explicit `on delete` behavior:
- `orders.customerId` / `orders.accountId` → `on delete restrict` (protect history).
- order child rows (`order_receipts/payments/profits/service_charges/beneficiaries`)
  → `on delete cascade` when safe.
- financial history / reversal records → preserve (audit).
- `users` / `roles` → restrict when referenced.

### 5.7 Indexes (from day one)
```
orders.customerId   orders.accountId   orders.status
orders.createdAt    orders.orderDate   orders.handlerId

customers.name      customers.email    customers.createdAt

accounts.currencyCode    accounts.ownerUserId

account_transactions.accountId   account_transactions.createdAt   account_transactions.type

customer_ledger_entries.customerId   customer_ledger_entries.createdAt   customer_ledger_entries.status

customer_funding.customerId   customer_funding.currencyCode

transfers.createdAt   transfers.accountId   transfers.status

expenses.createdAt    expenses.accountId    expenses.category

notifications.userId  notifications.createdAt  notifications.readAt

tags.name

wallet_transactions.walletId  wallet_transactions.createdAt
```

---

## 6. Validation

Use Zod for **every** API input, validated **before** service logic runs: request body,
query params, route params, file metadata, imported Excel rows, settings values, and
permission assignment.

Invalid input returns a typed error:

```json
{
  "message": "Invalid input",
  "code": "VALIDATION_ERROR",
  "details": []
}
```

Schemas live in `packages/shared` and are re-exported by each module's `*.schema.ts`.

---

## 7. Auth & Security

- JWT access token in an **httpOnly cookie**; `secure` cookies in production; `sameSite`
  policy.
- **bcrypt** password hashing.
- Login **rate limit** + **lockout**.
- Server-side **RBAC** (see §8) and server-side **row-level scoping**.
- Optional **2FA** plugin.

Rules:
- Client guards are for UI only; the backend always enforces permissions.
- **No silent admin bypass** in code (remove commented-out `role === "admin"` shortcuts).
- Seed an admin role that has all sections/actions.
- Never expose stack traces to the frontend (see §23).

---

## 8. Permissions (RBAC)

Model: each user/role has **`sections`** (page-level access), **`actions`** (granular
capability flags), and **row-level scoping** (data-access boundaries). Single source of
truth shared by client + server.

```
packages/shared/src/permissions/
├── sections.ts     # SECTIONS = ["dashboard","orders","customers","accounts","transfers",
│                   #   "expenses","profit","currencies","exchangeRates","referenceRates",
│                   #   "users","roles","settings","notifications","tags","wallets"]
├── actions.ts      # ACTIONS = ["createOrder","updateOrder","deleteOrder","cancelOrder",
│                   #   "exportOrder","pinOrders","confirmReceipt","confirmPayment",
│                   #   "confirmProfit","confirmServiceCharge","createCustomer",
│                   #   "updateCustomer","deleteCustomer","viewCustomerLedger","manageKyc",
│                   #   "createAccount","updateAccount","viewAccountBalance",
│                   #   "viewAccountTransactions","createTransfer","updateTransfer",
│                   #   "deleteTransfer","exportTransfer","createExpense","updateExpense",
│                   #   "deleteExpense","exportExpense", ...]
└── rules.ts        # orderPermissions + customerPermissions (the ONLY copy)
```

- **Backend guards** (`core/auth/rbac.ts`): `requireAuth`, `section("orders")`,
  `action("createOrder")`, `anySection("orders","dashboard", ...)` applied in routes.
- **Frontend guards:** `hasSectionAccess(user, section)`,
  `hasActionPermission(user, action)`, `getUserPermissions(user)` — imported from the
  same `packages/shared` catalog so client and server can never drift.
- Permissions are always evaluated from the catalog; seed an admin role with everything.
- **Row-level scoping** (which orders/accounts a user can see) is enforced in the
  repository/service layer, not just the route guard.

---

## 9. List Endpoint Format

A single, consistent contract for ALL list endpoints (orders, transfers, expenses,
customers, ...). Implemented once in `core/http/listQuery.ts`.

### Request (query string)
```
page        integer, default 1
limit       integer, default 20, max 100
search      string, optional (domain decides searched columns)
sortBy      whitelisted column name, optional
sortDir     "asc" | "desc", default "desc"
dateFrom    YYYY-MM-DD, optional   (filters on orderDate||createdAt)
dateTo      YYYY-MM-DD, optional
status      enum, optional
tags        comma-separated tag ids, optional
accountId   optional scoping filter
customerId  optional scoping filter
```

### Response (standard envelope)
```jsonc
{
  "rows": [ /* domain objects */ ],
  "page": 1,
  "limit": 20,
  "total": 137,
  "totalPages": 7,
  "meta": {                      // optional, domain-specific aggregates
    "totalCalculatedProfit": "1234.56",
    "totalCalculatedProfitCurrency": "USD"
  }
}
```

Rules:
- `rows` is always the array key (replaces today's `orders`/`transfers`/… key drift).
- Domain-specific aggregates (e.g. orders' filtered profit total) go under `meta`.
- `sortBy` is validated against a per-domain whitelist (no arbitrary column injection).
- `limit` max 100; pagination happens on the backend — the frontend must never fetch
  thousands of rows.
- Export endpoints reuse the SAME filter builder as list (no duplicated query logic),
  just without pagination.

---

## 10. Order Module Details

The legacy `<LEGACY_APP>/server/controllers/ordersController.js` is 4,286 lines. Split
into the module below. Orders are
a **single uniform entity** (no order types, no OTC/online/batch, no approval flow).
Sub-entities: receipts, payments, profits, service charges, beneficiaries, change history
(audit), and pins.

```
modules/orders/
├── orders.routes.ts
├── orders.controller.ts            # delegates to the services below
├── orders.repository.ts            # all order + child-table SQL
├── orders.schema.ts                # zod: createOrder, updateOrder, list query, child entities
└── services/
    ├── orderList.service.ts        # list + filters + pagination + aggregate profit
    ├── orderCrud.service.ts        # create / update / updateStatus / delete
    ├── orderStatus.service.ts      # status transitions + lifecycle policy
    ├── orderReceipts.service.ts    # add/update/delete/confirm receipts (file upload)
    ├── orderPayments.service.ts    # add/update/delete/confirm payments (file upload)
    ├── orderProfit.service.ts      # add/update/delete/confirm profit entries + calc
    ├── orderServiceCharges.service.ts
    ├── orderBeneficiaries.service.ts
    ├── orderPins.service.ts        # global pinned order ids + reorder
    ├── orderAudit.service.ts       # order_changes snapshots + diff
    ├── orderLedgerSync.service.ts  # sync completed order -> customer ledger
    ├── orderReversals.service.ts   # reverse confirmed financial entries on delete/cancel
    └── orderImportExport.service.ts
```

### Endpoints (preserve current surface, minus order-type semantics)
```
GET    /api/orders                         listOrders            (section: orders)
GET    /api/orders/export                  exportOrders          (action: exportOrder)
GET    /api/orders/pins                    getPinnedOrderIds
PUT    /api/orders/pins/reorder            reorderPinnedOrders
POST   /api/orders                         createOrder           (action: createOrder)
GET    /api/orders/:id/details             getOrderDetails
GET    /api/orders/:id/changes             getOrderChanges
PUT    /api/orders/:id                     updateOrder
PUT    /api/orders/:id/status              updateOrderStatus
DELETE /api/orders/:id                     deleteOrder           (direct delete; no approval flow)
POST   /api/orders/:id/process             processOrder
POST   /api/orders/:id/receipts            addReceipt            (multipart: file)
PUT    /api/orders/receipts/:receiptId     updateReceipt         (multipart: file)
DELETE /api/orders/receipts/:receiptId     deleteReceipt
POST   /api/orders/receipts/:receiptId/confirm   confirmReceipt
POST   /api/orders/:id/beneficiaries       addBeneficiary
POST   /api/orders/:id/payments            addPayment            (multipart: file)
PUT    /api/orders/payments/:paymentId     updatePayment         (multipart: file)
DELETE /api/orders/payments/:paymentId     deletePayment
POST   /api/orders/payments/:paymentId/confirm   confirmPayment
POST   /api/orders/:id/profits             addProfitToOrder
PUT    /api/orders/profits/:profitId       updateProfit
DELETE /api/orders/profits/:profitId       deleteProfit
POST   /api/orders/profits/:profitId/confirm     confirmProfit
POST   /api/orders/:id/service-charges     addServiceChargeToOrder
PUT    /api/orders/service-charges/:id      updateServiceCharge
DELETE /api/orders/service-charges/:id      deleteServiceCharge
POST   /api/orders/service-charges/:id/confirm   confirmServiceCharge
```

### 10.1 Status lifecycle
Status drives money movement. Minimum expected statuses: `draft`, `confirmed`,
`completed`, `cancelled`, `saved` (final names must match current business behavior —
confirm exact set during port). Only `completed` orders sync to the customer ledger.

### 10.2 Financial rules (transactions)
All financial mutations run inside **database transactions** — a transaction fully
succeeds or fully fails:

```
confirm receipt   -> update receipt status -> update account balance
                  -> create account transaction -> audit entry -> notify (if needed)
confirm payment   -> update payment status -> update account balance
                  -> create account transaction -> audit entry
complete order    -> update order status -> sync customer ledger -> audit entry
cancel completed  -> reverse confirmed financial entries -> reverse ledger effect
                  -> set status cancelled/voided -> audit entry
```

- Confirmed financial entries (receipts/payments/profits/service charges) affect account
  balances; deleting/cancelling an order must **reverse** confirmed entries
  (`orderReversals`) before removal.
- Calculated profit is derived from service-charge entries + a default profit target
  currency; conversion via the `profit` module (see §14). Keep this in
  `orderProfit.service`.
- Access scoping: non-admin users only see orders tied to accounts/customers they can
  access (account filter applied in `orderList`).

### 10.3 Delete policy
- Draft/unconfirmed orders may be hard-deleted.
- Confirmed/completed orders are **not** physically deleted by normal users — they are
  cancelled/voided with reversal entries + audit history.
- Physical deletion of financially active orders is restricted to super-admin / system
  maintenance only, if supported at all. This protects financial history.

### 10.4 Audit rules
Every important mutation writes an `order_changes` snapshot: create, update, status
change, receipt/payment/profit/service-charge confirm or delete, cancel/void, reversal,
import. Each audit row stores `orderId`, `userId`, `action`, before snapshot, after
snapshot, timestamp, and reason/remarks if available.

---

## 11. Accounts Module

Accounts support: CRUD, opening balance, current balance, currency, account
transactions, account access scoping, references, and statements.

Financial changes must **never** directly update balances from random controllers. All
balance changes go through account service methods, inside database transactions:

```
creditAccount()
debitAccount()
reverseTransaction()
createAccountTransaction()
```

---

## 12. Customers, Ledger & Funding

### 12.1 Customers
Support: customer CRUD, beneficiaries, profile, pins, sort/reorder, tags, KYC, ledger
view, funding view.

### 12.2 Customer ledger
Ledger is service-driven. Support: ledger entries, ledger rebuild, ledger verification,
order-to-ledger sync, ledger reversal on cancel/void. Ledger rebuild should be
background-job capable and must not block normal API requests.

### 12.3 Customer funding
Funding balances are financial data — use transactions and verification tests.

---

## 13. Transfers & Expenses

Same module pattern as every other domain.

```
modules/transfers/                      modules/expenses/
├── transfers.routes.ts                 ├── expenses.routes.ts
├── transfers.controller.ts             ├── expenses.controller.ts
├── transfers.service.ts                ├── expenses.service.ts
├── transfers.repository.ts             ├── expenses.repository.ts
├── transfers.schema.ts                 ├── expenses.schema.ts
├── transferImportExport.service.ts     ├── expenseImportExport.service.ts
└── transferAudit.service.ts            └── expenseAudit.service.ts
```

Transfers and expenses with account effects must use transactions (via the account
service methods in §11).

---

## 14. Profit Module

Profit calculation is isolated in its own module. Support: profit calculation config,
target profit currency, exchange-rate conversion, order-level profit, filtered profit
totals, profit reports.

Rules:
- Never duplicate profit calculation logic in the frontend; the frontend displays
  backend results.
- The old app's output is used for characterization tests (see §21.1).

---

## 15. File Uploads

Storage: **local disk under a Railway persistent volume**, served over HTTP. Drop the
legacy base64-in-DB path entirely; migrate any remaining base64 to files during ETL.

```
DATA_DIR (env, e.g. /data on Railway volume)
└── uploads/
    ├── orders/        order_{orderId}_receipt|payment_{ts}_{hash}.{ext}
    ├── transfers/     transfer_{transferId}_{ts}_{hash}.{ext}
    ├── expenses/      expense_{expenseId}_{ts}_{hash}.{ext}
    ├── customers/kyc/ customer_{id}_kyc_{code}_{ts}_{hash}.{ext}
    └── branding/      favicon_{ts}_{hash}.{ext}
```

Rules:
- **Multer memory storage**, then write via `core/uploads/fileStorage.ts`. Enforce mime
  allowlist (`jpg/jpeg/png/gif/webp/svg/ico/pdf`) and a max file size.
- **DB stores the relative path** (e.g. `orders/order_123_...jpg`); never an absolute URL
  and never base64. `getFileUrl()` produces `/api/uploads/<relative>` for clients.
- `normalizeStoredImagePath()` keeps a single canonical relative form (kills the legacy
  double-prefix `/api/uploads/api/uploads/...` bug).
- Deleting an order/child row deletes its file(s) best-effort (never throws).
- Static serving via `GET /api/uploads/*` behind auth where appropriate.
- The `OTC_NO_IMAGE` sentinel is a leftover — drop it; absence of a file means `null`.

---

## 16. Import & Export

Shared Excel toolkit in `core/importExport/` (`excelParser`, `excelWriter`,
`importValidator`, `exportFilterBuilder`, `importResult`). Each module provides only its
column mapping (orders/transfers/expenses/customers).

Rules:
- Do not duplicate Excel logic across modules.
- Import must validate **all** rows before applying any financial changes.
- Large imports should be background-job capable (see §19).
- Export must reuse the same filter builder as the list endpoints (§9).
- All import/export traffic goes through `baseApi` on the frontend — never raw `fetch()`.

---

## 17. Notifications & Realtime

Three channels, all routed through one service so call sites don't branch per channel.

```
modules/notifications/
├── notifications.routes.ts     # list, mark read, preferences get/update
├── notifications.controller.ts
├── notifications.service.ts     # create + fan-out to enabled channels
├── notifications.repository.ts
└── notifications.schema.ts
core/realtime/cacheSyncBroadcast.ts   # SSE: pushes cache-invalidation events to clients
plugins/email/        # resend sender (channel)
plugins/telegram/     # bot sender (channel)
```

Rules:
- **In-app notifications** persist to DB with a typed `notification_type` enum (remove
  dead `approval_request*` types). In-app always works.
- **Per-user preferences** decide which `type`→`channel` combinations fire (email /
  telegram / in-app). Defaults defined in `packages/shared`.
- **Real-time UI updates** use the SSE-style `cacheSyncBroadcast` so RTK Query caches
  invalidate across open tabs/clients on writes (orders, balances, etc.).
- Email/Telegram are plugins: if their env flags are off, the service skips that channel
  and still records the in-app notification.

---

## 18. Plugins

Plugins are optional and env-flagged.

```
plugins/
├── telegram/
├── email/
├── twofa/
└── walletTracker/
```

Rules:
- The core app must boot and run with **all** plugins disabled.
- Plugins are controlled by environment variables.
- No plugin code is required for the core orders/accounts/customers flow.
- No plugin can crash the core app.

---

## 19. Background Jobs

Today the only real background job is the **wallet auto-refresh poller**; Telegram
webhook registration also runs at boot. In the rebuild these become explicit,
env-flagged, and isolated under `apps/api/src/jobs/` + `plugins/`.

| Job | Trigger | Env flag | Notes |
|---|---|---|---|
| Wallet refresh (Tron) | `setInterval` | `WALLET_AUTO_REFRESH_ENABLED`, `WALLET_REFRESH_INTERVAL_SECONDS` (default **30–60s**, not 5s) | Polls `tron_wallets`, records new tx + balance changes. Start/stop/status controllable via wallet plugin API. Skip when 0 wallets. |
| Telegram webhook register | on boot | `TELEGRAM_ENABLED` + bot configured | `registerTelegramWebhookIfConfigured()` |
| Reference rates refresh | optional interval/manual | reference-rates env | Pulls/derives reference rates |
| Ledger rebuild | manual/job | — | Background-capable; never blocks API |
| Large import/export | job | — | Background-capable for large files |
| Backup creation | scheduled | — | `pg_dump` to volume (see §22.3) |
| Report generation | job | — | |

Rules:
- Jobs live behind their plugin and are **no-ops when the flag is off** — the core app
  must boot and run without any plugin.
- No job blocks normal request flow.
- Use an internal auth guard for self-calls (`INTERNAL_CRON_SECRET`) rather than the
  current localhost `fetch` to its own HTTP endpoint; call the service directly.
- All timers registered in `server.ts` and torn down in graceful shutdown
  (`SIGTERM`/`SIGINT`).
- If moved to a multi-instance deploy later, gate interval jobs to a single instance
  (leader lock) to avoid duplicate polling.

---

## 20. Data Migration & Restorable Backups (SQLite → Postgres)

Migration is a **first-class workstream**, not an afterthought.
**Source today:** `<LEGACY_APP>/server/data/app.db` (better-sqlite3). Work on a **copy**;
never read/modify the original (and checkpoint the `-wal` file before copying so the copy
holds all committed data).
**Requirement:** back up current SQLite data, load into Postgres, and **restore at any
time**.

### 20.1 Clean schema first
Derive the Postgres schema in `packages/db` from the **current real features** of the
legacy app at `<LEGACY_APP>`, not by replaying the 159 historical DDL statements in
`<LEGACY_APP>/server/db.js`.

### 20.2 Backup artifacts (never lock yourself in)
```
backups/
├── sqlite/app-YYYYMMDD-HHmm.db          # raw original snapshot (source of truth)
├── neutral/app-YYYYMMDD-HHmm/*.json     # per-table, engine-agnostic export
└── postgres/app-YYYYMMDD-HHmm.dump      # pg_dump custom format (fast restore)
```

### 20.3 ETL tool: `tools/migrate-sqlite`
Idempotent Node script that:
1. Opens SQLite read-only; reads every table.
2. **Type mapping:** int-boolean → `boolean`; epoch/text dates → `timestamptz`;
   money/text-number → `numeric(20,8)`; `AUTOINCREMENT` → identity.
3. **Base64 → files:** any legacy `data:` image is written to disk under the right
   `uploads/` subdir and the row updated to the relative path.
4. Inserts in FK-dependency order (currencies → customers → accounts → orders → child
   tables → ledger → ...).
5. Resets all sequences to `max(id)+1`.
6. Produces a migration report.

### 20.4 Verification (must pass before cutover — fail loudly on any mismatch)
- Row counts per table match SQLite.
- Sum checks on money columns (account balances, customer ledger, customer funding,
  order profit totals, receipt/payment totals).
- Account / ledger / funding balances reconcile.
- Spot-check N random orders end-to-end through the new services.
- File migration count, permissions count, users/roles count.

### 20.5 Restore paths (test all three before cutover)
- **Postgres → Postgres:** `pg_restore` from the `.dump`.
- **From neutral export:** re-run the importer against the JSON (engine-independent).
- **From origin:** re-run full ETL from the raw `.db` snapshot.

### 20.6 Cutover
```
1. Take latest SQLite backup.
2. Export neutral JSON.
3. Run ETL into staging Postgres.
4. Run verifier.
5. Run UAT on staging.
6. Schedule maintenance window.
7. Freeze old app writes.
8. Take final SQLite backup.
9. Re-run ETL into production Postgres.
10. Run verifier again.
11. Switch DATABASE_URL.
12. Start new app.
13. Keep old app + raw SQLite snapshot available during the bake-in period.
```

---

## 21. Testing Strategy

Testing is mandatory.

### 21.1 Characterization tests
**Before** rewriting financial logic, write tests against the behavior of the legacy app
at `<LEGACY_APP>` (run it locally and/or capture its API responses as golden fixtures).
Must cover: order profit calculation, filtered profit totals, account balance changes,
receipt/payment/service-charge confirmation, customer ledger sync, funding balances,
order cancel/reversal, permissions, row-level scoping. The new app must match expected
behavior unless a business rule is intentionally changed and documented.

### 21.2 Unit tests — **Vitest**
Test services: orders, accounts, ledger, funding, profit, permissions, import/export
validation.

### 21.3 Integration tests — **Supertest** + a test Postgres database
Test: auth, orders, accounts, customers, transfers, expenses, uploads, permissions, list
filters, exports.

### 21.4 Frontend tests — **Testing Library**
Test: login flow, permission-based UI visibility, orders page behavior, forms, filters,
modals, file-upload UI.

---

## 22. Deployment (Railway)

Target: **Railway**, Nixpacks build.

- **One service first:** serve the built `apps/web` as static files from `apps/api`
  (single-service model) to minimize moving parts. Split into separate web / API / worker
  services later only if needed.
- **Postgres:** Railway Postgres plugin; connection via `DATABASE_URL`.
- **Persistent volume:** mount at `DATA_DIR` (e.g. `/data`) for `uploads/` and backups.
- **Config files:** `nixpacks.toml`, `railway.json`, `.nvmrc` (Node >= 22.12).

### 22.1 Environment variables
Required: `DATABASE_URL`, `DATA_DIR`, `JWT_SECRET`, `COOKIE_SECRET`, `CORS_ORIGIN`,
`PORT`, `NODE_ENV`.

Optional plugin vars: `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`,
`EMAIL_ENABLED`, `RESEND_API_KEY`, `TWOFA_ENABLED`, `WALLET_TRACKER_ENABLED`,
`WALLET_AUTO_REFRESH_ENABLED`, `WALLET_REFRESH_INTERVAL_SECONDS`, `TRON_API_KEY`,
`INTERNAL_CRON_SECRET`. Document all in `.env.example`.

### 22.2 Migrations on Railway
- Run `drizzle-kit migrate` as a **release/start step before the app starts** — never
  inside request handling.
- The API starts only after migration succeeds.
- Do not run multiple migration processes in parallel.
- Background jobs disabled during migration.

### 22.3 Backups
Scheduled `pg_dump` to the persistent volume (prefer an external copy too). Keep the raw
SQLite migration backup.

---

## 23. Error Handling & Logging

Centralized errors with a typed shape (never expose stack traces to the frontend):

```json
{
  "message": "Order not found",
  "code": "ORDER_NOT_FOUND",
  "details": {}
}
```

Use **structured logging**. Log: request method, path, status, duration, userId, error
stack, job start/finish, migration report, financial-reversal report.

---

## 24. Documentation

Must produce: `README.md`, `docs/architecture.md`, `docs/database.md`,
`docs/migration.md`, `docs/deployment.md`, `docs/permissions.md`, `docs/testing.md`,
`docs/railway.md`, `.env.example`. A `docs/current-app-audit.md` is produced in Phase 0
(see §26).

README must include: local setup, env vars, dev commands, migration commands, test
commands, build commands, deployment notes, backup/restore notes.

---

## 25. Code Quality Rules

```
No giant controller / page / RTK api file
No raw SQL outside repositories
No duplicated permission logic
No duplicated import/export logic
No duplicated file-upload logic
No base64 images in DB
No business logic in the frontend
No money calculation using float
No plugin required for core app boot
```

Files over ~400 lines must be justified; the rule is not absolute, but large files must
not mix unrelated responsibilities.

Dead code to remove: `main.jsx`, `vite.config.js` shim, `@tanstack/react-query`,
`getAuthToken/setAuthToken`, empty `data.db` files, committed `*.db` backups, the stray
reference-rates `pg` path, the `OTC_NO_IMAGE` sentinel.

---

## 26. Build Phases

Sequenced delivery with exit criteria per phase. Lean core first; plugins last.

### Phase 0 — Current App Audit
Read the legacy app at `<LEGACY_APP>` (see "Reference App Location" at the top). Inventory
real features, dead code, all tables/columns, money logic, permission logic, file-storage
patterns, import/export behavior, production data location. Confirm `<LEGACY_APP>` exists
and is readable before starting any later phase.
**Output:** `docs/current-app-audit.md`.

### Phase 1 — Foundation
Monorepo, pnpm workspace, TypeScript, Express API (`app.ts`/`server.ts`), Vite frontend,
shared package, db package, Drizzle, Postgres connection, env loader, error handling,
logger, `baseApi`, CI.
**Exit:** API boots, frontend boots, Postgres connects, migration command works, CI runs.

### Phase 2 — Auth, Users, Roles, Permissions
Login, logout, current user, users CRUD, roles CRUD, permission assignment, backend
guards, frontend route guards, row-level scoping foundation.
**Exit:** admin can log in, role permissions work, unauthorized actions blocked
server-side.

### Phase 3 — Database Schema & Migration Skeleton
Clean Postgres schema, Drizzle schema, generated migrations, SQLite reader, neutral JSON
exporter, basic verifier.
**Exit:** can migrate sample data into Postgres, verify row counts, restore a test backup.

### Phase 4 — Currencies, Rates, Accounts
Currencies, exchange rates, reference rates, accounts, account transactions, account
balance service, account access scoping.
**Exit:** balance changes are transactional, statements work, tests pass.

### Phase 5 — Customers, KYC, Ledger, Funding
Customers CRUD, beneficiaries, KYC, customer pins, customer ledger, customer funding,
ledger rebuild.
**Exit:** customer ledger matches old-app behavior, funding tests pass.

### Phase 6 — Orders
List, create/edit/details/status, receipts, payments, beneficiaries, profits, service
charges, remarks, tags, pins/reordering, audit history, ledger sync, cancel/void with
reversals, import/export.
**Exit:** order financial characterization tests pass, list/export match old filters,
delete/cancel behavior is safe.

### Phase 7 — Transfers & Expenses
CRUD, attachments, account effects, import/export, audit (both domains).
**Exit:** transactions and exports match old behavior, files upload/download correctly.

### Phase 8 — Dashboard, Profit, Notifications
Dashboard stats, profit reports, filtered profit totals, notifications, SSE cache
invalidation.
**Exit:** dashboard numbers + profit totals match old app, notifications work with
plugins disabled.

### Phase 9 — Plugins
Telegram, email, 2FA, wallet tracker, reference-rate refresh.
**Exit:** core works with all plugins disabled; each plugin works only when enabled; no
plugin can crash the core app.

### Phase 10 — Full Migration & UAT
Full SQLite backup, full ETL, verifier, restore tests, deploy staging, UAT, fix
mismatches.
**Exit:** all verification checks pass, UAT approved, restore paths tested.

### Phase 11 — Production Cutover
Maintenance window, freeze old writes, final backup, final ETL, final verification,
deploy new app, monitor logs, keep old backup available.
**Exit:** production app running, balances verified, uploads accessible, users can perform
core flows, no critical errors.

---

## 27. CI/CD

Add CI from the beginning, running on every PR. No production deploy if CI is failing.

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

---

## 28. Acceptance Criteria

The rebuild is "done" for a domain when ALL of the following hold:

**Architecture**
- [ ] Monorepo works; frontend + backend are TypeScript; Postgres + Drizzle used.
- [ ] Shared package used by both apps; controllers thin; services hold logic;
      repositories hold DB access.
- [ ] No file > ~400 lines mixing responsibilities; no raw SQL outside repositories.
- [ ] No giant `db.js` / `api.ts` / `ordersController`.
- [ ] Types + permission rules exist once in `packages/shared`, imported by both apps.
- [ ] Zero references to `orderType` / `OTC` / `online` / `batch` / `approval_request`.
- [ ] Dead code removed (see §25).

**Functional parity (vs current app as reference)**
- [ ] Orders: create/update/status/delete, receipts, payments, profits, service charges,
      beneficiaries, pins, change history, process — all behave identically.
- [ ] Completed orders sync to the customer ledger; delete/cancel reverses confirmed
      financial entries and account balances correctly.
- [ ] Calculated profit + filtered profit totals match the old app for the same data.
- [ ] List + export return identical rows for identical filters (standard envelope).
- [ ] RBAC: a user with a given section/action set sees and can do exactly what they
      could before; row-level scoping enforced server-side.
- [ ] File upload/download works for orders/transfers/expenses/kyc/branding; legacy
      base64 records migrated to files.
- [ ] Notifications: in-app + (enabled) email/telegram fire per preferences; SSE cache
      sync invalidates across clients.

**Financial**
- [ ] Financial operations are transactional.
- [ ] Account / ledger / funding balances reconcile; profit totals reconcile.
- [ ] Cancel/void creates reversal entries; characterization tests pass.

**Data / Migration**
- [ ] SQLite backup, neutral JSON export, and Postgres dump created.
- [ ] ETL passes row-count + money-sum verification; sequences reset.
- [ ] Base64 files migrated to disk.
- [ ] All three restore paths tested (pg_restore, neutral JSON, raw SQLite re-ETL).

**Security**
- [ ] httpOnly cookie auth; bcrypt hashing; RBAC + row-level scoping server-side.
- [ ] Login rate limits; no stack traces exposed.

**Deployment**
- [ ] Railway deploy works with Postgres plugin + persistent volume.
- [ ] Migrations run before app start; uploads survive redeploy; backups documented.
- [ ] Core app boots with all plugins disabled.

**Quality / Ops**
- [ ] Characterization tests for money math pass; Zod validation on every endpoint.
- [ ] CI green (typecheck + lint + test); both apps build.
- [ ] Documentation complete (see §24).

---

## 29. Risks
- **Money correctness** → mitigated by §21 characterization tests; don't skip.
- **SQLite→Postgres semantics** → explicit type mapping (§20.3); `numeric` for money.
- **Fresh-repo scope creep** → enforce lean-core-first build order (§26); plugins last.
- **Multi-instance background jobs** → add a leader lock before scaling API horizontally.
- **Migration data loss** → three backup formats + three tested restore paths (§20).
