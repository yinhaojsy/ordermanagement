import { db } from "../db.js";
import { getAllCustomersFundingBalances } from "./customerFundingBalances.js";
import { getAllCustomersTradeProfitLoss } from "./customerTradeProfitLoss.js";
import { getDefaultProfitConversion } from "./profitConversion.js";

export const MAX_CUSTOMER_PINS = 10;

function listPinnedCustomerIds() {
  return db
    .prepare("SELECT customerId FROM customer_pins ORDER BY sortOrder ASC;")
    .all()
    .map((r) => r.customerId);
}

function compareMetric(a, b, dir) {
  const aNull = a == null || Number.isNaN(a);
  const bNull = b == null || Number.isNaN(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return dir * (a - b);
}

function buildCustomerListWhere({ search = "", customerType, kycStatus } = {}) {
  const clauses = [];
  const params = {};

  if (search) {
    clauses.push("(lower(c.name) LIKE @q OR lower(COALESCE(c.email, '')) LIKE @q)");
    params.q = `%${search.toLowerCase()}%`;
  }

  if (customerType === "individual" || customerType === "corporate") {
    clauses.push("COALESCE(c.customerType, 'individual') = @customerType");
    params.customerType = customerType;
  }

  if (kycStatus === "submitted" || kycStatus === "approved" || kycStatus === "rejected") {
    clauses.push(
      `EXISTS (SELECT 1 FROM customer_kyc_profiles p WHERE p.customerId = c.id AND p.status = @kycStatus)`,
    );
    params.kycStatus = kycStatus;
  } else if (kycStatus === "none") {
    clauses.push(
      `NOT EXISTS (
         SELECT 1 FROM customer_kyc_profiles p
         WHERE p.customerId = c.id AND p.status IN ('submitted', 'approved', 'rejected')
       )`,
    );
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereSql, params };
}

/**
 * Paginated customer list: pinned first (pin order), then unpinned by sort or name.
 * @param {{ search?: string, page: number, limit: number, sortBy?: 'balance'|'profitLoss', sortDir?: 'asc'|'desc', customerType?: string, kycStatus?: string }}
 */
export function listCustomersPaginated({
  search = "",
  page,
  limit,
  sortBy,
  sortDir,
  customerType,
  kycStatus,
}) {
  const { whereSql, params } = buildCustomerListWhere({ search, customerType, kycStatus });

  const total = db.prepare(`SELECT COUNT(*) as c FROM customers c ${whereSql};`).get(params).c;

  const rows = db
    .prepare(`SELECT c.id, c.name FROM customers c ${whereSql} ORDER BY lower(c.name) ASC;`)
    .all(params);

  const fundingById = Object.fromEntries(
    getAllCustomersFundingBalances().result.map((r) => [r.customerId, r.totalBalance]),
  );
  const profitById = Object.fromEntries(
    getAllCustomersTradeProfitLoss().result.map((r) => [r.customerId, r.profitLoss]),
  );

  const kycById = Object.fromEntries(
    db.prepare("SELECT customerId, status FROM customer_kyc_profiles;").all().map((r) => [r.customerId, r.status]),
  );

  const pinRows = db
    .prepare("SELECT customerId, sortOrder FROM customer_pins ORDER BY sortOrder ASC;")
    .all();
  const pinOrder = new Map(pinRows.map((p) => [p.customerId, p.sortOrder]));

  const pinned = [];
  const unpinned = [];

  for (const row of rows) {
    const pinSort = pinOrder.get(row.id);
    const entry = {
      id: row.id,
      pinSort: pinSort ?? null,
      balance: fundingById[row.id] ?? null,
      profitLoss: profitById[row.id] ?? null,
      name: row.name,
    };
    if (pinSort != null) pinned.push(entry);
    else unpinned.push(entry);
  }

  pinned.sort((a, b) => a.pinSort - b.pinSort);

  const dir = sortDir === "asc" ? 1 : -1;
  if (sortBy === "balance") {
    unpinned.sort((a, b) => compareMetric(a.balance, b.balance, dir) || a.name.localeCompare(b.name));
  } else if (sortBy === "profitLoss") {
    unpinned.sort(
      (a, b) => compareMetric(a.profitLoss, b.profitLoss, dir) || a.name.localeCompare(b.name),
    );
  } else {
    unpinned.sort((a, b) => a.name.localeCompare(b.name));
  }

  const orderedIds = [...pinned.map((p) => p.id), ...unpinned.map((p) => p.id)];
  const offset = (page - 1) * limit;
  const pageIds = orderedIds.slice(offset, offset + limit);

  const { targetCurrency } = getDefaultProfitConversion();

  if (pageIds.length === 0) {
    return { customers: [], total, page, limit, targetCurrency };
  }

  const placeholders = pageIds.map((_, i) => `@id${i}`).join(",");
  const idParams = Object.fromEntries(pageIds.map((id, i) => [`id${i}`, id]));
  const customerRows = db
    .prepare(`SELECT * FROM customers WHERE id IN (${placeholders});`)
    .all(idParams);

  const customerMap = Object.fromEntries(customerRows.map((c) => [c.id, c]));

  const customers = pageIds.map((id) => {
    const c = customerMap[id];
    if (!c) return null;
    const pinSort = pinOrder.get(id);
    const rawKyc = kycById[id];
    const kycStatus =
      rawKyc === "submitted" || rawKyc === "approved" || rawKyc === "rejected" ? rawKyc : null;

    return {
      ...c,
      pinned: pinSort != null,
      pinOrder: pinSort != null ? pinSort : undefined,
      listBalance: fundingById[id] ?? null,
      listProfitLoss: profitById[id] ?? null,
      kycStatus,
    };
  }).filter(Boolean);

  return { customers, total, page, limit, targetCurrency };
}

/**
 * Every customer matching the list filters, with the same balance, P/L, and KYC fields as the list.
 * @param {{ search?: string, customerType?: string, kycStatus?: string }}
 */
export function listCustomersForExport({ search = "", customerType, kycStatus } = {}) {
  const { whereSql, params } = buildCustomerListWhere({ search, customerType, kycStatus });
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.email, c.phone, c.remarks,
              COALESCE(c.customerType, 'individual') AS customerType
       FROM customers c ${whereSql}
       ORDER BY lower(c.name) ASC;`,
    )
    .all(params);

  const fundingById = Object.fromEntries(
    getAllCustomersFundingBalances().result.map((r) => [r.customerId, r.totalBalance]),
  );
  const profitById = Object.fromEntries(
    getAllCustomersTradeProfitLoss().result.map((r) => [r.customerId, r.profitLoss]),
  );
  const kycById = Object.fromEntries(
    db.prepare("SELECT customerId, status FROM customer_kyc_profiles;").all().map((r) => [r.customerId, r.status]),
  );

  const { targetCurrency } = getDefaultProfitConversion();

  const customers = rows.map((c) => {
    const rawKyc = kycById[c.id];
    const kycStatusValue =
      rawKyc === "submitted" || rawKyc === "approved" || rawKyc === "rejected" ? rawKyc : null;
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      remarks: c.remarks,
      customerType: c.customerType,
      kycStatus: kycStatusValue,
      listBalance: fundingById[c.id] ?? null,
      listProfitLoss: profitById[c.id] ?? null,
    };
  });

  return { customers, targetCurrency };
}

/** Lightweight id/name list for dropdowns (orders, dashboard, ledger picker). */
export function listCustomerOptions() {
  return db
    .prepare(
      `SELECT id, name, email, phone,
              COALESCE(customerType, 'individual') AS customerType,
              displayBgColor, displayTextColor
       FROM customers
       ORDER BY lower(name) ASC;`,
    )
    .all();
}

export { listPinnedCustomerIds };
