import { db } from "../db.js";
import { getProfitConversion } from "./profitConversion.js";

function getServiceChargeEntriesForOrder(orderId) {
  const confirmedScRows = db
    .prepare(
      `SELECT SUM(amount) AS total, currencyCode
       FROM order_service_charges
       WHERE orderId = ? AND status = 'confirmed'
       GROUP BY currencyCode;`,
    )
    .all(orderId);

  const scRows =
    confirmedScRows.length > 0
      ? confirmedScRows
      : db
          .prepare(
            `SELECT SUM(amount) AS total, currencyCode
             FROM order_service_charges
             WHERE orderId = ? AND status = 'draft'
             GROUP BY currencyCode;`,
          )
          .all(orderId);

  return scRows.map((r) => ({ amount: Number(r.total), currency: r.currencyCode }));
}

/**
 * Document-dated P&L breakdown in profit-calculation target currency.
 * Order gross excludes service charges; total should match converted net change.
 */
export function computeAccountMonthlyPnLBreakdown({
  bounds,
  accountIds,
  profitCalculationId,
}) {
  const { profitCalculationId: calcId, profitCalculationName, targetCurrency, convertToTarget } =
    getProfitConversion(profitCalculationId);

  if (!targetCurrency || !convertToTarget) {
    return null;
  }

  const { periodStartDate, periodEndDate } = bounds;
  const accountIdSet = new Set(accountIds);

  const orders = db
    .prepare(
      `SELECT o.id, o.amountBuy, o.amountSell, o.fromCurrency, o.toCurrency
       FROM orders o
       WHERE o.status = 'completed'
         AND DATE(COALESCE(o.orderDate, o.createdAt)) BETWEEN ? AND ?;`,
    )
    .all(periodStartDate, periodEndDate);

  let orderGrossProfit = 0;
  let serviceCharges = 0;

  for (const order of orders) {
    const received = convertToTarget(Number(order.amountBuy), order.fromCurrency);
    const paid = convertToTarget(Number(order.amountSell), order.toCurrency);
    if (received === null || paid === null) continue;

    orderGrossProfit += received - paid;

    for (const sc of getServiceChargeEntriesForOrder(order.id)) {
      const converted = convertToTarget(sc.amount, sc.currency);
      if (converted !== null) serviceCharges += converted;
    }
  }

  let otherIncome = 0;
  let totalExpenses = 0;
  let transferFeesTotal = 0;

  if (accountIds.length > 0) {
    const placeholders = accountIds.map((_, i) => `@aid${i}`).join(", ");
    const params = { periodStartDate, periodEndDate };
    accountIds.forEach((id, i) => {
      params[`aid${i}`] = id;
    });

    const expenses = db
      .prepare(
        `SELECT e.amount, e.currencyCode, e.type
         FROM expenses e
         WHERE e.accountId IN (${placeholders})
           AND e.deletedAt IS NULL
           AND DATE(COALESCE(e.entryDate, e.createdAt)) BETWEEN @periodStartDate AND @periodEndDate;`,
      )
      .all(params);

    for (const expense of expenses) {
      const converted = convertToTarget(Number(expense.amount), expense.currencyCode);
      if (converted === null) continue;
      if (expense.type === "income") {
        otherIncome += converted;
      } else {
        totalExpenses += converted;
      }
    }

    const transferFees = db
      .prepare(
        `SELECT t.transactionFee, ta.currencyCode
         FROM internal_transfers t
         INNER JOIN accounts ta ON ta.id = t.toAccountId
         WHERE t.transactionFee > 0
           AND DATE(COALESCE(t.entryDate, t.createdAt)) BETWEEN @periodStartDate AND @periodEndDate
           AND (
             t.fromAccountId IN (${placeholders})
             OR t.toAccountId IN (${placeholders})
           );`,
      )
      .all(params);

    for (const row of transferFees) {
      const converted = convertToTarget(Number(row.transactionFee), row.currencyCode);
      if (converted !== null) transferFeesTotal += converted;
    }
  }

  const total =
    orderGrossProfit + serviceCharges + otherIncome - totalExpenses - transferFeesTotal;

  return {
    profitCalculationId: calcId,
    profitCalculationName,
    targetCurrency,
    orderGrossProfit,
    serviceCharges,
    otherIncome,
    totalExpenses,
    transferFees: transferFeesTotal,
    total,
  };
}

export function aggregateCurrencyPoolsWithConversion(accounts, convertToTarget, targetCurrency) {
  const byCurrency = new Map();

  for (const account of accounts) {
    const existing = byCurrency.get(account.currencyCode);
    if (existing) {
      existing.accountCount += 1;
      existing.totalInflow += account.totalInflow;
      existing.totalOutflow += account.totalOutflow;
      existing.netChange += account.netChange;
      if (!existing.currencyName && account.currencyName) {
        existing.currencyName = account.currencyName;
      }
    } else {
      byCurrency.set(account.currencyCode, {
        currencyCode: account.currencyCode,
        currencyName: account.currencyName,
        accountCount: 1,
        totalInflow: account.totalInflow,
        totalOutflow: account.totalOutflow,
        netChange: account.netChange,
      });
    }
  }

  const pools = Array.from(byCurrency.values()).sort((a, b) =>
    a.currencyCode.localeCompare(b.currencyCode),
  );

  let totalNetChangeConverted = 0;

  const currencyPools = pools.map((pool) => {
    const netChangeConverted =
      convertToTarget && targetCurrency
        ? (convertToTarget(pool.netChange, pool.currencyCode) ?? 0)
        : 0;
    totalNetChangeConverted += netChangeConverted;
    return { ...pool, netChangeConverted };
  });

  return { currencyPools, totalNetChangeConverted, targetCurrency };
}
