import { db } from "../db.js";

/**
 * Economic inflow/outflow for account reports: final confirmed order legs only,
 * plus expenses, transfers, and other non-order ledger activity.
 * Period attribution uses source document dates (order / entry date), not re-book timestamps.
 */

function toDateString(isoOrDate) {
  if (!isoOrDate) return null;
  const s = String(isoOrDate);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function documentDate(entryDate, createdAt) {
  return toDateString(entryDate || createdAt);
}

function orderEconomicDate(order) {
  return documentDate(order.orderDate, order.orderCreatedAt ?? order.createdAt);
}

function isDateInPeriod(dateStr, bounds) {
  if (!dateStr) return false;
  return dateStr >= bounds.periodStartDate && dateStr <= bounds.periodEndDate;
}

function addFlow(flows, accountId, dateStr, inflow, outflow) {
  if (!accountId || !dateStr) return;
  const inAmt = Number(inflow) || 0;
  const outAmt = Number(outflow) || 0;
  if (inAmt === 0 && outAmt === 0) return;
  flows.push({ accountId, date: dateStr, inflow: inAmt, outflow: outAmt });
}

/**
 * Ledger rows already counted via orders, expenses/income, transfers — or edit/delete reversals
 * that must not be double-counted (final document amount only).
 */
function isExcludedFromOtherTx(description) {
  if (!description) return false;
  return (
    description.startsWith("Order #") ||
    description.startsWith("Expense #") ||
    description.startsWith("Income #") ||
    description.startsWith("Transfer #") ||
    description.startsWith("Dividend #") ||
    description.startsWith("Reversal: Expense #") ||
    description.startsWith("Reversal: Income #") ||
    description.startsWith("Reversal: Transfer #") ||
    description.startsWith("Reversal: Dividend #")
  );
}

/**
 * @param {{ accountIds: number[], bounds: { periodStartDate: string, periodEndDate: string } }} options
 * @returns {{ accountId: number, date: string, inflow: number, outflow: number }[]}
 */
export function collectEconomicFlows({ accountIds, bounds }) {
  if (accountIds.length === 0) return [];

  const accountIdSet = new Set(accountIds);
  const flows = [];
  const placeholders = accountIds.map((_, i) => `@aid${i}`).join(", ");
  const params = {};
  accountIds.forEach((id, i) => {
    params[`aid${i}`] = id;
  });

  const receipts = db
    .prepare(
      `SELECT r.orderId, r.accountId, r.amount,
              o.orderDate, o.createdAt AS orderCreatedAt
       FROM order_receipts r
       INNER JOIN orders o ON o.id = r.orderId
       WHERE r.status = 'confirmed'
         AND r.accountId IS NOT NULL
         AND COALESCE(r.fundedFrom, 'cash') = 'cash'
         AND r.accountId IN (${placeholders})
         AND o.status = 'completed';`,
    )
    .all(params);

  const payments = db
    .prepare(
      `SELECT p.orderId, p.accountId, p.amount,
              o.orderDate, o.createdAt AS orderCreatedAt
       FROM order_payments p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE p.status = 'confirmed'
         AND p.accountId IS NOT NULL
         AND COALESCE(p.fundedFrom, 'cash') = 'cash'
         AND p.accountId IN (${placeholders})
         AND o.status = 'completed';`,
    )
    .all(params);

  const ordersWithCashReceipts = new Set(
    db
      .prepare(
        `SELECT DISTINCT orderId FROM order_receipts
         WHERE status = 'confirmed'
           AND accountId IS NOT NULL
           AND COALESCE(fundedFrom, 'cash') = 'cash';`,
      )
      .all()
      .map((r) => r.orderId),
  );

  const ordersWithCashPayments = new Set(
    db
      .prepare(
        `SELECT DISTINCT orderId FROM order_payments
         WHERE status = 'confirmed'
           AND accountId IS NOT NULL
           AND COALESCE(fundedFrom, 'cash') = 'cash';`,
      )
      .all()
      .map((r) => r.orderId),
  );

  const directOrders = db
    .prepare(
      `SELECT o.id, o.buyAccountId, o.sellAccountId, o.amountBuy, o.amountSell,
              o.orderDate, o.createdAt AS orderCreatedAt
       FROM orders o
       WHERE o.status = 'completed'
         AND (
           o.buyAccountId IN (${placeholders})
           OR o.sellAccountId IN (${placeholders})
         );`,
    )
    .all(params);

  for (const receipt of receipts) {
    if (!accountIdSet.has(receipt.accountId)) continue;
    const dateStr = orderEconomicDate(receipt);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    addFlow(flows, receipt.accountId, dateStr, receipt.amount, 0);
  }

  for (const payment of payments) {
    if (!accountIdSet.has(payment.accountId)) continue;
    const dateStr = orderEconomicDate(payment);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    addFlow(flows, payment.accountId, dateStr, 0, payment.amount);
  }

  for (const order of directOrders) {
    const dateStr = orderEconomicDate(order);

    if (
      order.buyAccountId &&
      accountIdSet.has(order.buyAccountId) &&
      !ordersWithCashReceipts.has(order.id)
    ) {
      if (isDateInPeriod(dateStr, bounds)) {
        addFlow(flows, order.buyAccountId, dateStr, order.amountBuy, 0);
      }
    }

    if (
      order.sellAccountId &&
      accountIdSet.has(order.sellAccountId) &&
      !ordersWithCashPayments.has(order.id)
    ) {
      if (isDateInPeriod(dateStr, bounds)) {
        addFlow(flows, order.sellAccountId, dateStr, 0, order.amountSell);
      }
    }
  }

  const profits = db
    .prepare(
      `SELECT p.accountId, p.amount, o.orderDate, o.createdAt AS orderCreatedAt
       FROM order_profits p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE p.status = 'confirmed'
         AND p.accountId IS NOT NULL
         AND p.accountId IN (${placeholders})
         AND o.status = 'completed';`,
    )
    .all(params);

  for (const profit of profits) {
    const dateStr = orderEconomicDate(profit);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    addFlow(flows, profit.accountId, dateStr, profit.amount, 0);
  }

  const serviceCharges = db
    .prepare(
      `SELECT sc.accountId, sc.amount, o.orderDate, o.createdAt AS orderCreatedAt
       FROM order_service_charges sc
       INNER JOIN orders o ON o.id = sc.orderId
       WHERE sc.status = 'confirmed'
         AND sc.accountId IS NOT NULL
         AND COALESCE(sc.fundedFrom, 'cash') = 'cash'
         AND sc.accountId IN (${placeholders})
         AND o.status = 'completed';`,
    )
    .all(params);

  for (const sc of serviceCharges) {
    const dateStr = orderEconomicDate(sc);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    const amount = Number(sc.amount) || 0;
    if (amount > 0) {
      addFlow(flows, sc.accountId, dateStr, amount, 0);
    } else if (amount < 0) {
      addFlow(flows, sc.accountId, dateStr, 0, Math.abs(amount));
    }
  }

  const expenses = db
    .prepare(
      `SELECT e.accountId, e.amount, e.type, e.entryDate, e.createdAt
       FROM expenses e
       WHERE e.accountId IN (${placeholders})
         AND e.deletedAt IS NULL;`,
    )
    .all(params);

  for (const expense of expenses) {
    if (!accountIdSet.has(expense.accountId)) continue;
    const dateStr = documentDate(expense.entryDate, expense.createdAt);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    const amount = Number(expense.amount) || 0;
    if (expense.type === "income") {
      addFlow(flows, expense.accountId, dateStr, amount, 0);
    } else {
      addFlow(flows, expense.accountId, dateStr, 0, amount);
    }
  }

  const transfers = db
    .prepare(
      `SELECT t.fromAccountId, t.toAccountId, t.amount, t.transactionFee, t.entryDate, t.createdAt
       FROM internal_transfers t
       WHERE t.fromAccountId IN (${placeholders})
          OR t.toAccountId IN (${placeholders});`,
    )
    .all(params);

  for (const transfer of transfers) {
    const dateStr = documentDate(transfer.entryDate, transfer.createdAt);
    if (!isDateInPeriod(dateStr, bounds)) continue;
    const amount = Number(transfer.amount) || 0;
    const fee = Number(transfer.transactionFee) || 0;

    if (accountIdSet.has(transfer.fromAccountId)) {
      addFlow(flows, transfer.fromAccountId, dateStr, 0, amount);
    }
    if (accountIdSet.has(transfer.toAccountId)) {
      addFlow(flows, transfer.toAccountId, dateStr, amount, fee > 0 ? fee : 0);
    }
  }

  const otherTx = db
    .prepare(
      `SELECT accountId, type, amount, date(createdAt) AS txDate, description
       FROM account_transactions
       WHERE accountId IN (${placeholders})
         AND type IN ('add', 'withdraw');`,
    )
    .all(params);

  for (const tx of otherTx) {
    if (isExcludedFromOtherTx(tx.description)) continue;
    if (!isDateInPeriod(tx.txDate, bounds)) continue;
    if (tx.type === "add") {
      addFlow(flows, tx.accountId, tx.txDate, tx.amount, 0);
    } else if (tx.type === "withdraw") {
      addFlow(flows, tx.accountId, tx.txDate, 0, tx.amount);
    }
  }

  return flows;
}

export function aggregateFlowsByAccountAndDate(flows) {
  const dailyByAccount = new Map();
  const periodTotalsByAccount = new Map();

  for (const flow of flows) {
    let daily = dailyByAccount.get(flow.accountId);
    if (!daily) {
      daily = new Map();
      dailyByAccount.set(flow.accountId, daily);
    }
    const existing = daily.get(flow.date) ?? { inflow: 0, outflow: 0 };
    existing.inflow += flow.inflow;
    existing.outflow += flow.outflow;
    daily.set(flow.date, existing);

    const totals = periodTotalsByAccount.get(flow.accountId) ?? { inflow: 0, outflow: 0 };
    totals.inflow += flow.inflow;
    totals.outflow += flow.outflow;
    periodTotalsByAccount.set(flow.accountId, totals);
  }

  return { dailyByAccount, periodTotalsByAccount };
}
