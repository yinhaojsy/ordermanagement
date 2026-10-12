import { db } from "../db.js";
import {
  getAllocatableCustomerBalance,
  getAllocatableCustomerOwed,
  getEffectiveFundedBalance,
} from "./customerLedgerAccounts.js";
import { aggregateFundingTotal } from "./customerFundingBalances.js";

const EPSILON = 0.005;

function distinctCustomerCurrencyPairs() {
  return db
    .prepare(
      `SELECT DISTINCT e.customerId, e.currencyCode, c.name AS customerName
       FROM customer_ledger_entries e
       INNER JOIN customers c ON c.id = e.customerId
       WHERE e.deletedAt IS NULL
       ORDER BY c.name ASC, e.currencyCode ASC;`,
    )
    .all();
}

function buildCurrencyCustomerRows() {
  const byCurrency = new Map();

  for (const row of distinctCustomerCurrencyPairs()) {
    const fundedBalance = getEffectiveFundedBalance(row.customerId, row.currencyCode);
    if (Math.abs(fundedBalance) < EPSILON) continue;

    if (!byCurrency.has(row.currencyCode)) {
      byCurrency.set(row.currencyCode, []);
    }

    byCurrency.get(row.currencyCode).push({
      customerId: row.customerId,
      customerName: row.customerName,
      fundedBalance,
      allocatable: getAllocatableCustomerBalance(row.customerId, row.currencyCode),
      allocatableAdvance: getAllocatableCustomerOwed(row.customerId, row.currencyCode),
    });
  }

  for (const customers of byCurrency.values()) {
    customers.sort((a, b) => Math.abs(b.fundedBalance) - Math.abs(a.fundedBalance));
  }

  return byCurrency;
}

function sumPrepaidAdvance(customers) {
  let totalPrepaid = 0;
  let totalAdvance = 0;

  for (const { fundedBalance } of customers) {
    if (fundedBalance > EPSILON) {
      totalPrepaid += fundedBalance;
    } else if (fundedBalance < -EPSILON) {
      totalAdvance += Math.abs(fundedBalance);
    }
  }

  return { totalPrepaid, totalAdvance };
}

/**
 * Sum effective customer funded balance per currency (signed: + prepaid owed to customers, − advance).
 */
export function getCustomerDepositTotalsByCurrency() {
  const byCurrency = buildCurrencyCustomerRows();

  return Array.from(byCurrency.entries())
    .map(([currencyCode, customers]) => {
      const { totalPrepaid, totalAdvance } = sumPrepaidAdvance(customers);
      return {
        currencyCode,
        totalFundedBalance: customers.reduce((sum, c) => sum + c.fundedBalance, 0),
        totalPrepaid,
        totalAdvance,
        customers,
      };
    })
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

function depositBalanceMapKey(customerId, currencyCode) {
  return `${customerId}:${currencyCode}`;
}

function fetchManualFundedBalancesGroupedBefore(isoExclusive) {
  return db
    .prepare(
      `SELECT customerId, currencyCode,
              COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM customer_ledger_entries
       WHERE deletedAt IS NULL
         AND source = 'manual'
         AND datetime(COALESCE(entryDate, createdAt)) < datetime(?)
       GROUP BY customerId, currencyCode;`,
    )
    .all(isoExclusive);
}

function fetchConsumedPrepaidReceiptsGroupedBefore(isoExclusive) {
  return db
    .prepare(
      `SELECT o.customerId, o.fromCurrency AS currencyCode,
              COALESCE(SUM(r.amount), 0) AS total
       FROM order_receipts r
       INNER JOIN orders o ON o.id = r.orderId
       WHERE r.fundedFrom = 'customer_balance'
         AND r.status = 'confirmed'
         AND o.status = 'completed'
         AND datetime(COALESCE(o.orderDate, o.createdAt)) < datetime(?)
       GROUP BY o.customerId, o.fromCurrency;`,
    )
    .all(isoExclusive);
}

function fetchConsumedPrepaidServiceChargesGroupedBefore(isoExclusive) {
  return db
    .prepare(
      `SELECT o.customerId, sc.currencyCode,
              COALESCE(SUM(ABS(sc.amount)), 0) AS total
       FROM order_service_charges sc
       INNER JOIN orders o ON o.id = sc.orderId
       WHERE sc.fundedFrom = 'customer_balance'
         AND sc.status = 'confirmed'
         AND o.status = 'completed'
         AND datetime(COALESCE(o.orderDate, o.createdAt)) < datetime(?)
       GROUP BY o.customerId, sc.currencyCode;`,
    )
    .all(isoExclusive);
}

function fetchConsumedAdvancePaymentsGroupedBefore(isoExclusive) {
  return db
    .prepare(
      `SELECT o.customerId, o.toCurrency AS currencyCode,
              COALESCE(SUM(p.amount), 0) AS total
       FROM order_payments p
       INNER JOIN orders o ON o.id = p.orderId
       WHERE p.fundedFrom = 'customer_balance'
         AND p.status = 'confirmed'
         AND o.status = 'completed'
         AND datetime(COALESCE(o.orderDate, o.createdAt)) < datetime(?)
       GROUP BY o.customerId, o.toCurrency;`,
    )
    .all(isoExclusive);
}

/**
 * Effective customer funded balance per currency as of a date (exclusive).
 * Same rules as getCustomerDepositTotalsByCurrency / Accounts profit summary.
 */
export function getCustomerDepositTotalsByCurrencyAsOf(isoExclusive) {
  const manualByKey = new Map(
    fetchManualFundedBalancesGroupedBefore(isoExclusive).map((r) => [
      depositBalanceMapKey(r.customerId, r.currencyCode),
      Number(r.balance ?? 0),
    ]),
  );
  const receiptByKey = new Map(
    fetchConsumedPrepaidReceiptsGroupedBefore(isoExclusive).map((r) => [
      depositBalanceMapKey(r.customerId, r.currencyCode),
      Number(r.total ?? 0),
    ]),
  );
  const serviceChargeByKey = new Map(
    fetchConsumedPrepaidServiceChargesGroupedBefore(isoExclusive).map((r) => [
      depositBalanceMapKey(r.customerId, r.currencyCode),
      Number(r.total ?? 0),
    ]),
  );
  const paymentByKey = new Map(
    fetchConsumedAdvancePaymentsGroupedBefore(isoExclusive).map((r) => [
      depositBalanceMapKey(r.customerId, r.currencyCode),
      Number(r.total ?? 0),
    ]),
  );

  const allKeys = new Set([
    ...manualByKey.keys(),
    ...receiptByKey.keys(),
    ...serviceChargeByKey.keys(),
    ...paymentByKey.keys(),
  ]);

  const byCurrency = new Map();
  for (const key of allKeys) {
    const [, currencyCode] = key.split(":");
    const effective =
      (manualByKey.get(key) ?? 0) -
      (receiptByKey.get(key) ?? 0) -
      (serviceChargeByKey.get(key) ?? 0) +
      (paymentByKey.get(key) ?? 0);
    if (Math.abs(effective) < EPSILON) continue;
    byCurrency.set(currencyCode, (byCurrency.get(currencyCode) ?? 0) + effective);
  }

  return Array.from(byCurrency.entries())
    .map(([currencyCode, totalFundedBalance]) => ({
      currencyCode,
      totalFundedBalance,
    }))
    .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

/** Per-currency customer breakdown + converted company total. */
export function getCustomerDepositByCurrency() {
  const currencies = getCustomerDepositTotalsByCurrency();
  const aggregated = aggregateFundingTotal(
    currencies.map(({ currencyCode, totalFundedBalance }) => ({
      currencyCode,
      fundedBalance: totalFundedBalance,
    })),
  );
  const prepaidAggregated = aggregateFundingTotal(
    currencies.map(({ currencyCode, totalPrepaid }) => ({
      currencyCode,
      fundedBalance: totalPrepaid,
    })),
  );
  const advanceAggregated = aggregateFundingTotal(
    currencies.map(({ currencyCode, totalAdvance }) => ({
      currencyCode,
      fundedBalance: totalAdvance,
    })),
  );

  return {
    targetCurrency: aggregated.targetCurrency,
    totalConverted: aggregated.totalBalance,
    totalPrepaidConverted: prepaidAggregated.totalBalance,
    totalAdvanceConverted: advanceAggregated.totalBalance,
    hasUnknownRate:
      aggregated.hasUnknownRate ||
      prepaidAggregated.hasUnknownRate ||
      advanceAggregated.hasUnknownRate,
    currencies,
  };
}

/** Manual ledger entries for deposit trace (which account received funds). */
export function getCustomerDepositTraceEntries(customerId, currencyCode) {
  return db
    .prepare(
      `SELECT
         e.id,
         e.type,
         e.amount,
         e.description,
         e.entryDate,
         e.createdAt,
         e.accountId,
         acc.name AS accountName
       FROM customer_ledger_entries e
       LEFT JOIN accounts acc ON acc.id = e.accountId
       WHERE e.customerId = ?
         AND e.currencyCode = ?
         AND e.source = 'manual'
         AND e.deletedAt IS NULL
       ORDER BY COALESCE(e.entryDate, e.createdAt) DESC, e.id DESC;`,
    )
    .all(customerId, currencyCode);
}
