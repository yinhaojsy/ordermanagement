import { db } from "../db.js";

export function getCustomerCurrencyBalance(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM customer_ledger_entries
       WHERE customerId = ? AND currencyCode = ? AND deletedAt IS NULL;`,
    )
    .get(customerId, currencyCode);
  return Number(row?.balance ?? 0);
}

/** Deposits/withdrawals only (manual ledger), excluding order trade postings. */
export function getFundedCustomerCurrencyBalance(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM customer_ledger_entries
       WHERE customerId = ? AND currencyCode = ? AND deletedAt IS NULL AND source = 'manual';`,
    )
    .get(customerId, currencyCode);
  return Number(row?.balance ?? 0);
}

/** Net position from completed/cancelled order ledger postings. */
export function getTradePositionBalance(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM customer_ledger_entries
       WHERE customerId = ? AND currencyCode = ? AND deletedAt IS NULL
         AND source IN ('order', 'order_reversal');`,
    )
    .get(customerId, currencyCode);
  return Number(row?.balance ?? 0);
}

function sumReservedBalanceReceipts(customerId, currencyCode, excludeReceiptId = null) {
  const reserved = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount), 0) AS total
       FROM order_receipts r
       INNER JOIN orders o ON o.id = r.orderId
       WHERE o.customerId = ?
         AND o.fromCurrency = ?
         AND r.fundedFrom = 'customer_balance'
         AND r.status = 'confirmed'
         AND o.status NOT IN ('completed', 'cancelled')
         ${excludeReceiptId ? "AND r.id != ?" : ""};`,
    )
    .get(...(excludeReceiptId ? [customerId, currencyCode, excludeReceiptId] : [customerId, currencyCode]));
  return Number(reserved?.total ?? 0);
}

function sumReservedBalancePayments(customerId, currencyCode, excludePaymentId = null) {
  const reserved = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM order_payments p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE o.customerId = ?
         AND o.toCurrency = ?
         AND p.fundedFrom = 'customer_balance'
         AND p.status = 'confirmed'
         AND o.status NOT IN ('completed', 'cancelled')
         ${excludePaymentId ? "AND p.id != ?" : ""};`,
    )
    .get(...(excludePaymentId ? [customerId, currencyCode, excludePaymentId] : [customerId, currencyCode]));
  return Number(reserved?.total ?? 0);
}

function sumReservedBalanceServiceCharges(customerId, currencyCode, excludeServiceChargeId = null) {
  const reserved = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(sc.amount)), 0) AS total
       FROM order_service_charges sc
       INNER JOIN orders o ON o.id = sc.orderId
       WHERE o.customerId = ?
         AND sc.currencyCode = ?
         AND sc.fundedFrom = 'customer_balance'
         AND sc.status = 'confirmed'
         AND o.status NOT IN ('completed', 'cancelled')
         ${excludeServiceChargeId ? "AND sc.id != ?" : ""};`,
    )
    .get(
      ...(excludeServiceChargeId
        ? [customerId, currencyCode, excludeServiceChargeId]
        : [customerId, currencyCode]),
    );
  return Number(reserved?.total ?? 0);
}

/** Prepaid applied on completed orders (Bal receipts). */
function sumConsumedPrepaidReceipts(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount), 0) AS total
       FROM order_receipts r
       INNER JOIN orders o ON o.id = r.orderId
       WHERE o.customerId = ?
         AND o.fromCurrency = ?
         AND r.fundedFrom = 'customer_balance'
         AND r.status = 'confirmed'
         AND o.status = 'completed';`,
    )
    .get(customerId, currencyCode);
  return Number(row?.total ?? 0);
}

/** Prepaid service charges applied on completed orders (Bal SC). */
function sumConsumedPrepaidServiceCharges(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(sc.amount)), 0) AS total
       FROM order_service_charges sc
       INNER JOIN orders o ON o.id = sc.orderId
       WHERE o.customerId = ?
         AND sc.currencyCode = ?
         AND sc.fundedFrom = 'customer_balance'
         AND sc.status = 'confirmed'
         AND o.status = 'completed';`,
    )
    .get(customerId, currencyCode);
  return Number(row?.total ?? 0);
}

/** Advance settled on completed orders (Bal payments). */
function sumConsumedAdvancePayments(customerId, currencyCode) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM order_payments p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE o.customerId = ?
         AND o.toCurrency = ?
         AND p.fundedFrom = 'customer_balance'
         AND p.status = 'confirmed'
         AND o.status = 'completed';`,
    )
    .get(customerId, currencyCode);
  return Number(row?.total ?? 0);
}

/**
 * Net funding balance after completed Bal usage (deposits/withdrawals minus prepaid used on orders).
 */
/** Bulk manual funding balances keyed by `${customerId}:${currencyCode}`. */
export function fetchManualFundedBalancesGrouped() {
  return db
    .prepare(
      `SELECT customerId, currencyCode,
              COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM customer_ledger_entries
       WHERE deletedAt IS NULL AND source = 'manual'
       GROUP BY customerId, currencyCode;`,
    )
    .all();
}

/** Bulk completed-order Bal receipt usage keyed by `${customerId}:${currencyCode}`. */
export function fetchConsumedPrepaidReceiptsGrouped() {
  return db
    .prepare(
      `SELECT o.customerId, o.fromCurrency AS currencyCode,
              COALESCE(SUM(r.amount), 0) AS total
       FROM order_receipts r
       INNER JOIN orders o ON o.id = r.orderId
       WHERE r.fundedFrom = 'customer_balance'
         AND r.status = 'confirmed'
         AND o.status = 'completed'
       GROUP BY o.customerId, o.fromCurrency;`,
    )
    .all();
}

/** Bulk completed-order Bal payment usage keyed by `${customerId}:${currencyCode}`. */
export function fetchConsumedAdvancePaymentsGrouped() {
  return db
    .prepare(
      `SELECT o.customerId, o.toCurrency AS currencyCode,
              COALESCE(SUM(p.amount), 0) AS total
       FROM order_payments p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE p.fundedFrom = 'customer_balance'
         AND p.status = 'confirmed'
         AND o.status = 'completed'
       GROUP BY o.customerId, o.toCurrency;`,
    )
    .all();
}

function balanceMapKey(customerId, currencyCode) {
  return `${customerId}:${currencyCode}`;
}

/** Effective funded balance per manual-ledger currency (same rules as getEffectiveFundedBalance). */
export function buildEffectiveFundedBalanceByCustomerCurrency() {
  const manualRows = fetchManualFundedBalancesGrouped();
  const receiptByKey = new Map(
    fetchConsumedPrepaidReceiptsGrouped().map((r) => [
      balanceMapKey(r.customerId, r.currencyCode),
      Number(r.total ?? 0),
    ]),
  );
  const paymentByKey = new Map(
    fetchConsumedAdvancePaymentsGrouped().map((r) => [
      balanceMapKey(r.customerId, r.currencyCode),
      Number(r.total ?? 0),
    ]),
  );

  const byCustomer = {};
  for (const row of manualRows) {
    const key = balanceMapKey(row.customerId, row.currencyCode);
    const effective =
      Number(row.balance ?? 0) - (receiptByKey.get(key) ?? 0) + (paymentByKey.get(key) ?? 0);
    if (!byCustomer[row.customerId]) {
      byCustomer[row.customerId] = [];
    }
    byCustomer[row.customerId].push({
      currencyCode: row.currencyCode,
      fundedBalance: effective,
    });
  }
  return byCustomer;
}

export function getEffectiveFundedBalance(customerId, currencyCode) {
  const manual = getFundedCustomerCurrencyBalance(customerId, currencyCode);
  const consumedReceipts = sumConsumedPrepaidReceipts(customerId, currencyCode);
  const consumedServiceCharges = sumConsumedPrepaidServiceCharges(customerId, currencyCode);
  const consumedPayments = sumConsumedAdvancePayments(customerId, currencyCode);
  return manual - consumedReceipts - consumedServiceCharges + consumedPayments;
}

/** Prepaid (deposit) balance available for receipt Bal. */
export function getAllocatableCustomerBalance(
  customerId,
  currencyCode,
  excludeReceiptId = null,
  excludeServiceChargeId = null,
) {
  const effective = getEffectiveFundedBalance(customerId, currencyCode);
  const reserved =
    sumReservedBalanceReceipts(customerId, currencyCode, excludeReceiptId) +
    sumReservedBalanceServiceCharges(customerId, currencyCode, excludeServiceChargeId);
  return Math.max(0, effective - reserved);
}

export function assertAllocatableBalance(
  customerId,
  currencyCode,
  amount,
  excludeReceiptId = null,
  excludeServiceChargeId = null,
) {
  const available = getAllocatableCustomerBalance(
    customerId,
    currencyCode,
    excludeReceiptId,
    excludeServiceChargeId,
  );
  if (amount > available + 1e-9) {
    const err = new Error(
      `Insufficient customer prepaid balance. Available: ${available.toFixed(2)} ${currencyCode}`,
    );
    err.status = 400;
    throw err;
  }
}

/** Negative effective funded balance; available for payment Bal on open orders. */
export function getAllocatableCustomerOwed(customerId, currencyCode, excludePaymentId = null) {
  const effective = getEffectiveFundedBalance(customerId, currencyCode);
  const owed = Math.max(0, -effective);
  const reserved = sumReservedBalancePayments(customerId, currencyCode, excludePaymentId);
  return owed - reserved;
}

export function assertAllocatableOwed(customerId, currencyCode, amount, excludePaymentId = null) {
  const available = getAllocatableCustomerOwed(customerId, currencyCode, excludePaymentId);
  if (amount > available + 1e-9) {
    const err = new Error(
      `Insufficient customer advance to settle. Available: ${available.toFixed(2)} ${currencyCode}`,
    );
    err.status = 400;
    throw err;
  }
}

export function buildLedgerAccountDescription(customerName, ledgerType, amount, currencyCode, userDescription) {
  const action = ledgerType === "credit" ? "deposit" : "withdrawal";
  const base = `Customer ${action}: ${customerName} — ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`;
  if (userDescription?.trim()) {
    return `${base} — ${userDescription.trim()}`;
  }
  return base;
}

export function validateLedgerAccount(accountId, currencyCode) {
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?;").get(accountId);
  if (!account) {
    const err = new Error("Account not found");
    err.status = 404;
    throw err;
  }
  if (account.currencyCode !== currencyCode) {
    const err = new Error("Account currency must match the ledger entry currency");
    err.status = 400;
    throw err;
  }
  return account;
}

export function reverseLedgerAccountTransaction(ledgerEntryId) {
  const tx = db
    .prepare("SELECT * FROM account_transactions WHERE ledgerEntryId = ? LIMIT 1;")
    .get(ledgerEntryId);
  if (!tx) return null;

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?;").get(tx.accountId);
  if (!account) {
    db.prepare("DELETE FROM account_transactions WHERE id = ?;").run(tx.id);
    return null;
  }

  const newBalance =
    tx.type === "add" ? account.balance - tx.amount : account.balance + tx.amount;

  db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, account.id);
  db.prepare("DELETE FROM account_transactions WHERE id = ?;").run(tx.id);
  return account.id;
}

export function applyLedgerAccountTransaction({
  accountId,
  ledgerEntryId,
  ledgerType,
  amount,
  description,
  createdAt,
}) {
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?;").get(accountId);
  if (!account) {
    const err = new Error("Account not found");
    err.status = 404;
    throw err;
  }

  const parsedAmount = parseFloat(amount);
  const txType = ledgerType === "credit" ? "add" : "withdraw";

  const newBalance =
    txType === "add" ? account.balance + parsedAmount : account.balance - parsedAmount;

  db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, accountId);

  db.prepare(
    `INSERT INTO account_transactions (accountId, type, amount, description, createdAt, ledgerEntryId)
     VALUES (?, ?, ?, ?, ?, ?);`,
  ).run(accountId, txType, parsedAmount, description, createdAt, ledgerEntryId);

  return accountId;
}
