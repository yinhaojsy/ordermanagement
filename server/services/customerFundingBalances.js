import {
  buildEffectiveFundedBalanceByCustomerCurrency,
  fetchDistinctFundingCurrencies,
  getAllocatableCustomerBalance,
  getAllocatableCustomerOwed,
  getEffectiveFundedBalance,
} from "./customerLedgerAccounts.js";
import { getDefaultProfitConversion } from "./profitConversion.js";

const FUNDING_EPSILON = 0.005;

/**
 * Sum effective funding balances into target currency (same as Funding tab Total Balance).
 * @param {{ currencyCode: string, fundedBalance: number }[]} positions
 */
export function aggregateFundingTotal(positions) {
  const { targetCurrency, convertToTarget } = getDefaultProfitConversion();

  if (!targetCurrency) {
    return {
      targetCurrency: null,
      totalBalance: null,
      hasUnknownRate: false,
      currencyBreakdown: [],
    };
  }

  let totalBalance = 0;
  let hasUnknownRate = false;
  const currencyBreakdown = [];

  for (const { currencyCode, fundedBalance } of positions) {
    const balance = Number(fundedBalance ?? 0);
    currencyBreakdown.push({ currencyCode, fundedBalance: balance });

    const converted = convertToTarget(balance, currencyCode);
    if (converted !== null) {
      totalBalance += converted;
    } else if (Math.abs(balance) >= FUNDING_EPSILON) {
      hasUnknownRate = true;
    }
  }

  return {
    targetCurrency,
    totalBalance,
    hasUnknownRate,
    currencyBreakdown,
  };
}

/** Per-currency funding + total converted (customer ledger Funding tab). */
export function getCustomerFundingBalances(customerId) {
  const currencyRows = fetchDistinctFundingCurrencies(customerId);
  const { targetCurrency, convertToTarget } = getDefaultProfitConversion();

  const positions = currencyRows.map(({ currencyCode }) => ({
    currencyCode,
    fundedBalance: getEffectiveFundedBalance(customerId, currencyCode),
  }));

  const aggregated = aggregateFundingTotal(positions);

  const currencies = positions.map(({ currencyCode, fundedBalance }) => ({
    currencyCode,
    fundedBalance,
    allocatable: getAllocatableCustomerBalance(customerId, currencyCode),
    allocatableAdvance: getAllocatableCustomerOwed(customerId, currencyCode),
    convertedAmount: targetCurrency ? convertToTarget(fundedBalance, currencyCode) : null,
  }));

  return {
    targetCurrency: aggregated.targetCurrency,
    totalConverted: aggregated.totalBalance,
    hasUnknownRate: aggregated.hasUnknownRate,
    currencies,
  };
}

/** All customers — same total as Funding tab, for customer list Balance column. */
export function getAllCustomersFundingBalances() {
  const { targetCurrency } = getDefaultProfitConversion();

  if (!targetCurrency) {
    return { targetCurrency: null, result: [] };
  }

  const byCustomer = buildEffectiveFundedBalanceByCustomerCurrency();
  const result = Object.entries(byCustomer).map(([customerId, positions]) => {
    const id = parseInt(customerId, 10);
    const aggregated = aggregateFundingTotal(positions);
    return {
      customerId: id,
      totalBalance: aggregated.totalBalance,
      hasUnknownRate: aggregated.hasUnknownRate,
      currencyBreakdown: aggregated.currencyBreakdown,
    };
  });

  return { targetCurrency, result };
}

/** Subset for order modal chips: currencies with usable prepaid or advance only. */
export function getCustomerFundingSummary(customerId) {
  const { currencies } = getCustomerFundingBalances(customerId);
  return currencies.filter(
    (c) => c.allocatable >= FUNDING_EPSILON || c.allocatableAdvance >= FUNDING_EPSILON,
  );
}
