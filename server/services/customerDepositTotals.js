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
