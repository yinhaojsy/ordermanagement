import { db, ensureCustomerLedgerOrderColumns } from "../db.js";
import { scheduleCacheSync } from "./cacheSyncBroadcast.js";

function assertLedgerSchema() {
  ensureCustomerLedgerOrderColumns();
}

export function getOrderFinancialTotals(orderId) {
  assertLedgerSchema();
  const order = db
    .prepare(
      `SELECT id, customerId, fromCurrency, toCurrency, amountBuy, amountSell,
              actualAmountBuy, actualAmountSell, actualRate, rate,
              serviceChargeAmount, serviceChargeCurrency,
              COALESCE(orderDate, createdAt) AS entryDate, status
       FROM orders WHERE id = ?;`,
    )
    .get(orderId);

  if (!order) return null;

  const confirmedReceipts = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM order_receipts WHERE orderId = ? AND status = 'confirmed';`,
    )
    .get(orderId);
  const confirmedPayments = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM order_payments WHERE orderId = ? AND status = 'confirmed';`,
    )
    .get(orderId);

  const receiptTotal =
    Number(confirmedReceipts?.total) > 0
      ? Number(confirmedReceipts.total)
      : Number(order.actualAmountBuy ?? order.amountBuy ?? 0);

  const paymentTotal =
    Number(confirmedPayments?.total) > 0
      ? Number(confirmedPayments.total)
      : Number(order.actualAmountSell ?? order.amountSell ?? 0);

  const scRows = db
    .prepare(
      `SELECT currencyCode, amount, fundedFrom
       FROM order_service_charges
       WHERE orderId = ? AND status = 'confirmed';`,
    )
    .all(orderId);

  let serviceCharges = scRows.map((r) => ({
    currencyCode: r.currencyCode,
    amount: Number(r.amount),
    fundedFrom: r.fundedFrom === "customer_balance" ? "customer_balance" : "cash",
  }));

  if (serviceCharges.length === 0 && order.serviceChargeAmount != null) {
    const legacyAmt = Number(order.serviceChargeAmount);
    if (!Number.isNaN(legacyAmt) && legacyAmt !== 0 && order.serviceChargeCurrency) {
      serviceCharges = [
        { currencyCode: order.serviceChargeCurrency, amount: legacyAmt, fundedFrom: "cash" },
      ];
    }
  }

  return {
    order,
    receiptTotal,
    paymentTotal,
    serviceCharges,
    effectiveRate: order.actualRate ?? order.rate,
  };
}

export function financialFingerprint(orderId) {
  const t = getOrderFinancialTotals(orderId);
  if (!t) return null;
  const scKey = t.serviceCharges
    .map((s) => `${s.currencyCode}:${s.amount}`)
    .sort()
    .join("|");
  return JSON.stringify({
    r: t.receiptTotal,
    p: t.paymentTotal,
    sc: scKey,
  });
}

function nextLedgerBatch(orderId) {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(ledgerBatch), 0) + 1 AS n
       FROM customer_ledger_entries
       WHERE orderId = ? AND deletedAt IS NULL;`,
    )
    .get(orderId);
  return row?.n ?? 1;
}

function isBatchReversed(orderId, batch) {
  const row = db
    .prepare(
      `SELECT 1 FROM customer_ledger_entries
       WHERE orderId = ? AND source = 'order_reversal' AND reversesBatch = ? AND deletedAt IS NULL
       LIMIT 1;`,
    )
    .get(orderId, batch);
  return Boolean(row);
}

export function getActiveCompletionBatch(orderId) {
  const batches = db
    .prepare(
      `SELECT DISTINCT ledgerBatch AS batch
       FROM customer_ledger_entries
       WHERE orderId = ? AND source = 'order' AND deletedAt IS NULL AND ledgerBatch IS NOT NULL
       ORDER BY ledgerBatch DESC;`,
    )
    .all(orderId);

  for (const { batch } of batches) {
    if (!isBatchReversed(orderId, batch)) return batch;
  }
  return null;
}

function fingerprintForBatch(orderId, batch) {
  const legs = db
    .prepare(
      `SELECT leg, currencyCode, type, amount
       FROM customer_ledger_entries
       WHERE orderId = ? AND ledgerBatch = ? AND source = 'order' AND deletedAt IS NULL;`,
    )
    .all(orderId, batch);

  let r = 0;
  let p = 0;
  const scParts = [];

  for (const leg of legs) {
    if (leg.leg === "receipt" && leg.type === "debit") r = leg.amount;
    if (leg.leg === "payment" && leg.type === "credit") p = leg.amount;
    if (leg.leg === "service_charge") {
      const signed = leg.type === "debit" ? leg.amount : -leg.amount;
      scParts.push(`${leg.currencyCode}:${signed}`);
    }
  }
  scParts.sort();
  return JSON.stringify({ r, p, sc: scParts.join("|") });
}

function insertLedgerLeg({
  customerId,
  orderId,
  currencyCode,
  type,
  amount,
  description,
  source,
  reversalReason,
  leg,
  ledgerBatch,
  reversesBatch,
  entryDate,
  createdBy,
}) {
  const parsed = Number(amount);
  if (!parsed || parsed <= 0) return null;

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO customer_ledger_entries
         (customerId, currencyCode, type, amount, description, createdBy, createdAt, entryDate,
          orderId, source, reversalReason, leg, ledgerBatch, reversesBatch)
       VALUES (@customerId, @currencyCode, @type, @amount, @description, @createdBy, @createdAt, @entryDate,
               @orderId, @source, @reversalReason, @leg, @ledgerBatch, @reversesBatch);`,
    )
    .run({
      customerId,
      currencyCode,
      type,
      amount: parsed,
      description: description || null,
      createdBy: createdBy ?? null,
      createdAt: now,
      entryDate: entryDate || now,
      orderId: orderId ?? null,
      source: source || "manual",
      reversalReason: reversalReason ?? null,
      leg: leg ?? null,
      ledgerBatch: ledgerBatch ?? null,
      reversesBatch: reversesBatch ?? null,
    });

  const entryId = result.lastInsertRowid;
  db.prepare(
    `INSERT INTO customer_ledger_entry_changes
       (entryId, changedBy, changedAt, type, amount, description, currencyCode)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
  ).run(entryId, createdBy ?? null, now, type, parsed, description || null, currencyCode);

  return entryId;
}

function postServiceChargeLegs({
  customerId,
  orderId,
  serviceCharges,
  source,
  reversalReason,
  ledgerBatch,
  reversesBatch,
  entryDate,
  createdBy,
  descriptionPrefix,
  invert,
}) {
  for (const sc of serviceCharges) {
    const abs = Math.abs(sc.amount);
    if (abs <= 0) continue;
    const fundedFrom = sc.fundedFrom === "customer_balance" ? "customer_balance" : "cash";
    // Bal: always debit prepaid. New + positive: debit. New + negative: company bears fee — no ledger leg.
    const postsLedger = fundedFrom === "customer_balance" || sc.amount > 0;
    if (!postsLedger) continue;
    const type = invert ? "credit" : "debit";
    insertLedgerLeg({
      customerId,
      orderId,
      currencyCode: sc.currencyCode,
      type,
      amount: abs,
      description: `${descriptionPrefix} — Service charge`,
      source,
      reversalReason,
      leg: "service_charge",
      ledgerBatch,
      reversesBatch,
      entryDate,
      createdBy,
    });
  }
}

export function postOrderLedgerCompletion(orderId, createdBy = null) {
  assertLedgerSchema();
  const totals = getOrderFinancialTotals(orderId);
  if (!totals || totals.order.status !== "completed") return null;

  const { order, receiptTotal, paymentTotal, serviceCharges } = totals;
  const batch = nextLedgerBatch(orderId);
  const entryDate = order.entryDate;
  const desc = `Order #${orderId}`;

  if (receiptTotal > 0) {
    insertLedgerLeg({
      customerId: order.customerId,
      orderId,
      currencyCode: order.fromCurrency,
      type: "debit",
      amount: receiptTotal,
      description: desc,
      source: "order",
      leg: "receipt",
      ledgerBatch: batch,
      entryDate,
      createdBy,
    });
  }

  if (paymentTotal > 0) {
    insertLedgerLeg({
      customerId: order.customerId,
      orderId,
      currencyCode: order.toCurrency,
      type: "credit",
      amount: paymentTotal,
      description: desc,
      source: "order",
      leg: "payment",
      ledgerBatch: batch,
      entryDate,
      createdBy,
    });
  }

  postServiceChargeLegs({
    customerId: order.customerId,
    orderId,
    serviceCharges,
    source: "order",
    ledgerBatch: batch,
    entryDate,
    createdBy,
    descriptionPrefix: desc,
    invert: false,
  });

  return batch;
}

export function postOrderLedgerReversal(orderId, reversesBatch, reversalReason, createdBy = null) {
  assertLedgerSchema();
  if (!reversesBatch || isBatchReversed(orderId, reversesBatch)) return null;

  const legs = db
    .prepare(
      `SELECT * FROM customer_ledger_entries
       WHERE orderId = ? AND ledgerBatch = ? AND source = 'order' AND deletedAt IS NULL;`,
    )
    .all(orderId, reversesBatch);

  if (legs.length === 0) return null;

  const order = db
    .prepare("SELECT customerId, COALESCE(orderDate, createdAt) AS entryDate FROM orders WHERE id = ?;")
    .get(orderId);
  if (!order) return null;

  const batch = nextLedgerBatch(orderId);
  const entryDate = order.entryDate;
  const reasonLabel =
    reversalReason === "cancelled"
      ? "cancelled"
      : reversalReason === "deleted"
        ? "deleted"
        : "adjustment";
  const desc = `Reversal — Order #${orderId} (${reasonLabel})`;

  for (const leg of legs) {
    insertLedgerLeg({
      customerId: order.customerId,
      orderId,
      currencyCode: leg.currencyCode,
      type: leg.type === "credit" ? "debit" : "credit",
      amount: leg.amount,
      description: desc,
      source: "order_reversal",
      reversalReason,
      leg: leg.leg,
      ledgerBatch: batch,
      reversesBatch,
      entryDate,
      createdBy,
    });
  }

  return batch;
}

export function notifyCustomerLedger(customerId) {
  if (!customerId) return;
  scheduleCacheSync({
    scopes: ["customerLedger"],
    customerId: Number(customerId),
  });
}

export function syncCustomerLedgerForCompletedOrder(orderId, createdBy = null) {
  assertLedgerSchema();
  const order = db.prepare("SELECT id, customerId, status FROM orders WHERE id = ?;").get(orderId);
  if (!order || order.status !== "completed") return;

  const fp = financialFingerprint(orderId);
  const activeBatch = getActiveCompletionBatch(orderId);

  if (activeBatch != null) {
    const existingFp = fingerprintForBatch(orderId, activeBatch);
    if (existingFp === fp) return;
    postOrderLedgerReversal(orderId, activeBatch, "adjusted", createdBy);
  }

  postOrderLedgerCompletion(orderId, createdBy);
  notifyCustomerLedger(order.customerId);
}

export function syncCustomerLedgerOnOrderCancelOrDelete(orderId, reversalReason, createdBy = null) {
  assertLedgerSchema();
  const order = db.prepare("SELECT customerId FROM orders WHERE id = ?;").get(orderId);
  if (!order) return;

  let activeBatch = getActiveCompletionBatch(orderId);
  while (activeBatch != null) {
    postOrderLedgerReversal(orderId, activeBatch, reversalReason, createdBy);
    activeBatch = getActiveCompletionBatch(orderId);
  }

  notifyCustomerLedger(order.customerId);
}

export function purgeAutoLedgerEntriesForCustomer(customerId) {
  assertLedgerSchema();
  const ids = db
    .prepare(
      `SELECT id FROM customer_ledger_entries
       WHERE customerId = ? AND source IN ('order', 'order_reversal');`,
    )
    .all(customerId)
    .map((r) => r.id);

  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM customer_ledger_entry_changes WHERE entryId IN (${placeholders});`).run(...ids);
  const result = db
    .prepare(`DELETE FROM customer_ledger_entries WHERE id IN (${placeholders});`)
    .run(...ids);
  return result.changes;
}

/** Remove all ledger rows tied to an order so orders(id) can be deleted (FK on orderId). */
export function purgeLedgerEntriesForOrder(orderId) {
  assertLedgerSchema();
  const ids = db
    .prepare("SELECT id FROM customer_ledger_entries WHERE orderId = ?;")
    .all(orderId)
    .map((r) => r.id);

  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM customer_ledger_entry_changes WHERE entryId IN (${placeholders});`).run(...ids);
  const result = db
    .prepare(`DELETE FROM customer_ledger_entries WHERE id IN (${placeholders});`)
    .run(...ids);
  return result.changes;
}

function orderHasAutoLedgerEntries(orderId) {
  const row = db
    .prepare(
      `SELECT 1 FROM customer_ledger_entries
       WHERE orderId = ? AND source IN ('order', 'order_reversal') AND deletedAt IS NULL
       LIMIT 1;`,
    )
    .get(orderId);
  return Boolean(row);
}

/** Backfill order-sourced ledger rows for all customers (skips orders that already have entries). */
export function initialBuildAllCustomerLedgersFromOrders(createdBy = null) {
  assertLedgerSchema();

  const orders = db
    .prepare(
      `SELECT id, customerId, status FROM orders
       WHERE status IN ('completed', 'cancelled')
       ORDER BY id ASC;`,
    )
    .all();

  const customersToNotify = new Set();
  let ordersProcessed = 0;

  for (const o of orders) {
    if (orderHasAutoLedgerEntries(o.id)) continue;

    if (o.status === "completed") {
      postOrderLedgerCompletion(o.id, createdBy);
      ordersProcessed += 1;
      customersToNotify.add(o.customerId);
    } else if (o.status === "cancelled") {
      postOrderLedgerCompletion(o.id, createdBy);
      const batch = getActiveCompletionBatch(o.id);
      if (batch != null) {
        postOrderLedgerReversal(o.id, batch, "cancelled", createdBy);
      }
      ordersProcessed += 1;
      customersToNotify.add(o.customerId);
    }
  }

  for (const customerId of customersToNotify) {
    notifyCustomerLedger(customerId);
  }

  return { ordersProcessed, customersUpdated: customersToNotify.size };
}

const INITIAL_ORDER_SYNC_MIGRATION = "customer_ledger_initial_order_sync_v1";

/** Run once after deploy to backfill ledgers from historical orders. */
export function runInitialCustomerLedgerOrderSyncIfNeeded() {
  assertLedgerSchema();
  const done = db
    .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
    .get(INITIAL_ORDER_SYNC_MIGRATION);
  if (done) return { skipped: true };

  const result = initialBuildAllCustomerLedgersFromOrders();
  db.prepare("INSERT INTO _schema_migrations (key) VALUES (?)").run(INITIAL_ORDER_SYNC_MIGRATION);
  return { skipped: false, ...result };
}

export function rebuildCustomerLedgerFromOrders(customerId, createdBy = null) {
  assertLedgerSchema();
  purgeAutoLedgerEntriesForCustomer(customerId);

  const orders = db
    .prepare(
      `SELECT id, status FROM orders WHERE customerId = ? AND status IN ('completed', 'cancelled')
       ORDER BY id ASC;`,
    )
    .all(customerId);

  for (const o of orders) {
    if (o.status === "completed") {
      postOrderLedgerCompletion(o.id, createdBy);
    } else if (o.status === "cancelled") {
      postOrderLedgerCompletion(o.id, createdBy);
      const batch = getActiveCompletionBatch(o.id);
      if (batch != null) {
        postOrderLedgerReversal(o.id, batch, "cancelled", createdBy);
      }
    }
  }

  notifyCustomerLedger(customerId);
  return { ordersProcessed: orders.length };
}

function buildTradeAccountStatementRows(customerId, { includeReversals = false } = {}) {
  assertLedgerSchema();

  const orders = db
    .prepare(
      `SELECT o.id, o.fromCurrency, o.toCurrency, o.rate, o.actualRate, o.remarks,
              COALESCE(o.orderDate, o.createdAt) AS orderDate, o.status,
              COALESCE(cu.name, u.name) AS createdByName
       FROM orders o
       LEFT JOIN users u ON u.id = o.handlerId
       LEFT JOIN users cu ON cu.id = o.createdBy
       WHERE o.customerId = ?
       ORDER BY COALESCE(o.orderDate, o.createdAt) DESC, o.id DESC;`,
    )
    .all(customerId);

  const batches = db
    .prepare(
      `SELECT DISTINCT orderId, ledgerBatch, source, reversalReason, reversesBatch
       FROM customer_ledger_entries
       WHERE customerId = ? AND orderId IS NOT NULL AND deletedAt IS NULL
         AND source IN ('order', 'order_reversal')
       ORDER BY orderId, ledgerBatch;`,
    )
    .all(customerId);

  const batchesByOrder = {};
  for (const b of batches) {
    if (!batchesByOrder[b.orderId]) batchesByOrder[b.orderId] = [];
    batchesByOrder[b.orderId].push(b);
  }

  const rows = [];

  for (const order of orders) {
    const orderBatches = batchesByOrder[order.id] || [];
    if (orderBatches.length === 0) continue;

    for (const meta of orderBatches) {
      const isReversal = meta.source === "order_reversal";
      const reason = meta.reversalReason;

      if (!includeReversals) {
        if (isReversal && (reason === "cancelled" || reason === "deleted" || reason === "adjusted")) {
          continue;
        }
        // Hide superseded completion batches only (cancelled/deleted/adjusted/re-completed).
        if (!isReversal && isBatchReversed(order.id, meta.ledgerBatch)) {
          continue;
        }
      }

      if (!includeReversals && isReversal && reason === "adjusted") {
        continue;
      }

      const legs = db
        .prepare(
          `SELECT leg, currencyCode, type, amount
           FROM customer_ledger_entries
           WHERE customerId = ? AND orderId = ? AND ledgerBatch = ? AND deletedAt IS NULL;`,
        )
        .all(customerId, order.id, meta.ledgerBatch);

      let creditAmount = null;
      let creditCurrency = null;
      let debitAmount = null;
      let debitCurrency = null;
      const scParts = [];

      for (const leg of legs) {
        // Align with currency statement: receipt = ledger debit, payment = ledger credit
        if (leg.leg === "receipt") {
          debitCurrency = leg.currencyCode;
          debitAmount = leg.type === "debit" ? leg.amount : -leg.amount;
        }
        if (leg.leg === "payment") {
          creditCurrency = leg.currencyCode;
          creditAmount = leg.type === "credit" ? leg.amount : -leg.amount;
        }
        if (leg.leg === "service_charge") {
          const sign = leg.type === "debit" ? "" : "-";
          scParts.push(`${sign}${leg.amount} ${leg.currencyCode}`);
        }
      }

      const description = isReversal
        ? `Reversal — Order #${order.id} (${
            reason === "cancelled" ? "cancelled" : reason === "deleted" ? "deleted" : "adjustment"
          })`
        : `Order #${order.id}`;

      rows.push({
        activity: "trade",
        activityDate: order.orderDate,
        orderId: order.id,
        description,
        currencyPair: `${order.fromCurrency}/${order.toCurrency}`,
        exchangeRate: order.actualRate ?? order.rate,
        creditAmount,
        creditCurrency,
        debitAmount,
        debitCurrency,
        serviceCharges: scParts.length > 0 ? scParts.join(", ") : null,
        remarks: order.remarks,
        createdByName: order.createdByName,
        ledgerBatch: meta.ledgerBatch,
        source: meta.source,
        reversalReason: reason,
        isReversal,
      });
    }
  }

  rows.sort((a, b) => {
    const da = new Date(a.activityDate).getTime();
    const db_ = new Date(b.activityDate).getTime();
    if (db_ !== da) return db_ - da;
    return (b.ledgerBatch ?? 0) - (a.ledgerBatch ?? 0);
  });

  return rows;
}

function buildFundingAccountStatementRows(customerId) {
  assertLedgerSchema();

  const entries = db
    .prepare(
      `SELECT e.id, e.currencyCode, e.type, e.amount, e.description,
              COALESCE(e.entryDate, e.createdAt) AS activityDate,
              u.name AS createdByName, acc.name AS accountName
       FROM customer_ledger_entries e
       LEFT JOIN users u ON u.id = e.createdBy
       LEFT JOIN accounts acc ON acc.id = e.accountId
       WHERE e.customerId = ? AND e.source = 'manual' AND e.deletedAt IS NULL
       ORDER BY COALESCE(e.entryDate, e.createdAt) DESC, e.id DESC;`,
    )
    .all(customerId);

  return entries.map((e) => ({
    activity: "funding",
    entryId: e.id,
    activityDate: e.activityDate,
    description: e.description || (e.type === "credit" ? "Deposit" : "Withdrawal"),
    fundingType: e.type === "credit" ? "deposit" : "withdrawal",
    currencyCode: e.currencyCode,
    amount: e.amount,
    accountName: e.accountName ?? null,
    createdByName: e.createdByName ?? null,
    isReversal: false,
  }));
}

/**
 * Combined account statement: manual funding + order trades.
 * @param {'all'|'funding'|'trade'} activity
 */
export function buildAccountStatementRows(
  customerId,
  { activity = "all", includeReversals = false } = {},
) {
  const normalized = activity === "funding" || activity === "trade" ? activity : "all";
  let rows = [];

  if (normalized === "all" || normalized === "trade") {
    rows = rows.concat(buildTradeAccountStatementRows(customerId, { includeReversals }));
  }
  if (normalized === "all" || normalized === "funding") {
    rows = rows.concat(buildFundingAccountStatementRows(customerId));
  }

  rows.sort((a, b) => {
    const da = new Date(a.activityDate).getTime();
    const db_ = new Date(b.activityDate).getTime();
    if (db_ !== da) return db_ - da;
    const aTrade = a.activity === "trade" ? a.orderId : a.entryId;
    const bTrade = b.activity === "trade" ? b.orderId : b.entryId;
    return bTrade - aTrade;
  });

  return rows;
}
