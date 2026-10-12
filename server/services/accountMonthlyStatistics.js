import { db } from "../db.js";
import { appendAccountAccessFilter } from "../utils/accountAccess.js";
import { resolvePeriodBounds } from "../utils/periodBounds.js";
import { getCustomerDepositTotalsByCurrencyAsOf } from "./customerDepositTotals.js";
import {
  collectEconomicFlows,
  aggregateFlowsByAccountAndDate,
} from "./accountEconomicFlows.js";
import { getProfitConversion } from "./profitConversion.js";
import {
  computeAccountMonthlyPnLBreakdown,
  aggregateCurrencyPoolsWithConversion,
} from "./accountMonthlyPnLBreakdown.js";

function balanceBeforeAccount(accountId, beforeIso) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(
         CASE
           WHEN type = 'add' THEN amount
           WHEN type = 'withdraw' THEN -amount
           WHEN type = 'subtract' THEN -amount
           ELSE 0
         END
       ), 0) AS balance
       FROM account_transactions
       WHERE accountId = ? AND datetime(createdAt) < datetime(?);`,
    )
    .get(accountId, beforeIso);
  return Number(row?.balance ?? 0);
}

export function getAccountMonthlyStatistics({
  userId,
  year,
  month,
  periodStartDay,
  periodEndMode,
  periodEndDay,
  profitCalculationId,
}) {
  const bounds = resolvePeriodBounds(year, month, {
    periodStartDay,
    periodEndMode,
    periodEndDay,
  });
  const conditions = [];
  const params = {};

  appendAccountAccessFilter({
    userId,
    scope: "account.view",
    accountColumn: "a.id",
    conditions,
    params,
    paramPrefix: "accountAccess",
  });

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.currencyCode, a.balance, c.name AS currencyName
       FROM accounts a
       LEFT JOIN currencies c ON c.code = a.currencyCode
       ${whereClause}
       ORDER BY a.currencyCode ASC, a.name ASC;`,
    )
    .all(params);

  const accountIds = accounts.map((a) => a.id);
  const economicFlows = collectEconomicFlows({ accountIds, bounds });
  const { dailyByAccount, periodTotalsByAccount } = aggregateFlowsByAccountAndDate(economicFlows);

  const accountSummaries = accounts.map((account) => {
    const totals = periodTotalsByAccount.get(account.id) ?? { inflow: 0, outflow: 0 };
    const openingBalance = balanceBeforeAccount(account.id, bounds.periodStartIso);
    const closingBalance = balanceBeforeAccount(account.id, bounds.periodEndExclusiveIso);
    // Net change follows document-dated economic flows (same basis as inflow/outflow).
    const netChange = totals.inflow - totals.outflow;

    return {
      id: account.id,
      name: account.name,
      currencyCode: account.currencyCode,
      currencyName: account.currencyName,
      openingBalance,
      closingBalance,
      totalInflow: totals.inflow,
      totalOutflow: totals.outflow,
      netChange,
    };
  });

  const daily = bounds.dates.map((date) => {
    const byAccount = {};
    for (const account of accounts) {
      const day = dailyByAccount.get(account.id)?.get(date) ?? { inflow: 0, outflow: 0 };
      byAccount[account.id] = {
        inflow: day.inflow,
        outflow: day.outflow,
        net: day.inflow - day.outflow,
      };
    }
    return { date, byAccount };
  });

  const { convertToTarget, targetCurrency } = getProfitConversion(profitCalculationId);
  const { currencyPools, totalNetChangeConverted } = aggregateCurrencyPoolsWithConversion(
    accountSummaries,
    convertToTarget,
    targetCurrency,
  );
  const pnlBreakdown = computeAccountMonthlyPnLBreakdown({
    bounds,
    accountIds,
    profitCalculationId,
  });

  return {
    ...bounds,
    accounts: accountSummaries,
    daily,
    currencyPools,
    totalNetChangeConverted,
    targetCurrency: targetCurrency ?? pnlBreakdown?.targetCurrency ?? null,
    pnlBreakdown,
    depositTotalsAtStart: getCustomerDepositTotalsByCurrencyAsOf(bounds.periodStartIso),
    depositTotalsAtEnd: getCustomerDepositTotalsByCurrencyAsOf(bounds.periodEndExclusiveIso),
  };
}
