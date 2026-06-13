import { useMemo } from "react";
import type {
  Account,
  Currency,
  CustomerDepositTotalByCurrency,
  ProfitCalculationDetails,
  ProfitAccountMultiplier,
} from "../types";
import { convertCurrency } from "../utils/orders/orderCalculations";
import {
  buildDepositExchangeRateMap,
  computeCustomerDepositConverted,
} from "../utils/profit/customerDepositConversion";

export interface ProfitSummaryData {
  groupSums: Map<string, Map<string, number>>;
  groupNames: Map<string, string>;
  groupConvertedTotals: Map<string, number>;
  groupAccountCounts: Map<string, number>;
  totalConverted: number;
  totalCustomerDepositConverted: number;
  totalInvestment: number;
  totalProfit: number;
  targetCurrency: string;
  exchangeRateMap: Map<string, number>;
}

export function useProfitSummary(
  calculationDetails: ProfitCalculationDetails | undefined,
  accounts: Account[],
  currencies: Currency[] = [],
  customerDepositTotals: CustomerDepositTotalByCurrency[] = [],
): ProfitSummaryData | null {
  return useMemo(() => {
    if (!calculationDetails) return null;

    const defaultMultiplierMap = new Map<number, ProfitAccountMultiplier>();
    calculationDetails.multipliers.forEach((m) => {
      defaultMultiplierMap.set(m.accountId, m);
    });

    const defaultExchangeRateMap = new Map<string, number>();
    calculationDetails.exchangeRates.forEach((er) => {
      defaultExchangeRateMap.set(`${er.fromCurrencyCode}_${er.toCurrencyCode}`, er.rate);
    });

    const useLinkedDepositRates =
      calculationDetails.useLinkedDepositExchangeRates === undefined ||
      calculationDetails.useLinkedDepositExchangeRates === null
        ? true
        : calculationDetails.useLinkedDepositExchangeRates === true ||
          calculationDetails.useLinkedDepositExchangeRates === 1;

    const depositRateMap = buildDepositExchangeRateMap(
      calculationDetails.targetCurrencyCode,
      defaultExchangeRateMap,
      calculationDetails.depositExchangeRates ?? [],
      useLinkedDepositRates,
    );

    const accountCalcs = accounts.map((account) => {
      const multiplier = defaultMultiplierMap.get(account.id);
      const mult = multiplier?.multiplier ?? 1.0;
      const calculated = account.balance * mult;
      return {
        account,
        multiplier: multiplier || null,
        calculated,
        groupId: multiplier?.groupId || null,
        groupName: multiplier?.groupName || null,
      };
    });

    const grouped = new Map<string, typeof accountCalcs>();
    accountCalcs.forEach((calc) => {
      const groupId = calc.groupId || "ungrouped";
      if (!grouped.has(groupId)) {
        grouped.set(groupId, []);
      }
      grouped.get(groupId)!.push(calc);
    });

    const groupSums = new Map<string, Map<string, number>>();
    grouped.forEach((groupAccounts, groupId) => {
      if (groupId !== "ungrouped") {
        const currencySums = new Map<string, number>();
        groupAccounts.forEach((calc) => {
          const currency = calc.account.currencyCode;
          currencySums.set(currency, (currencySums.get(currency) || 0) + calc.calculated);
        });
        groupSums.set(groupId, currencySums);
      }
    });

    const convertedAmounts = new Map<string, number>();
    const uniqueCurrencies = Array.from(
      new Set(
        accountCalcs
          .filter((calc) => calc.groupId)
          .map((calc) => calc.account.currencyCode),
      ),
    );
    uniqueCurrencies.forEach((currency) => {
      const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
      const defaultRate = currency === calculationDetails.targetCurrencyCode ? 1 : 0;
      const rate = defaultExchangeRateMap.get(key) || defaultRate;
      const currencySum = Array.from(groupSums.values()).reduce(
        (sum, currencySums) => sum + (currencySums.get(currency) || 0),
        0,
      );
      const converted =
        rate > 0
          ? convertCurrency(
              currencySum,
              rate,
              currency,
              calculationDetails.targetCurrencyCode,
              currencies,
            )
          : currencySum;
      convertedAmounts.set(currency, converted);
    });

    const totalConverted = Array.from(convertedAmounts.values()).reduce((sum, val) => sum + val, 0);
    const totalCustomerDepositConverted = computeCustomerDepositConverted(
      customerDepositTotals,
      calculationDetails.targetCurrencyCode,
      depositRateMap,
      currencies,
    );
    const totalInvestment = calculationDetails.initialInvestment || 0;
    const totalProfit = totalConverted - totalCustomerDepositConverted - totalInvestment;

    const groupNames = new Map<string, string>();
    grouped.forEach((_, groupId) => {
      if (groupId !== "ungrouped") {
        const firstCalc = grouped.get(groupId)?.[0];
        if (firstCalc?.groupName) {
          groupNames.set(groupId, firstCalc.groupName);
        }
      }
    });

    const groupConvertedTotals = new Map<string, number>();
    groupSums.forEach((currencySums, groupId) => {
      let groupTotal = 0;
      currencySums.forEach((sum, currency) => {
        const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
        const defaultRate = currency === calculationDetails.targetCurrencyCode ? 1 : 0;
        const rate = defaultExchangeRateMap.get(key) || defaultRate;
        const converted =
          rate > 0
            ? convertCurrency(sum, rate, currency, calculationDetails.targetCurrencyCode, currencies)
            : sum;
        groupTotal += converted;
      });
      groupConvertedTotals.set(groupId, groupTotal);
    });

    const groupAccountCounts = new Map<string, number>();
    grouped.forEach((groupAccounts, groupId) => {
      groupAccountCounts.set(groupId, groupAccounts.length);
    });

    return {
      groupSums,
      groupNames,
      groupConvertedTotals,
      groupAccountCounts,
      totalConverted,
      totalCustomerDepositConverted,
      totalInvestment,
      totalProfit,
      targetCurrency: calculationDetails.targetCurrencyCode,
      exchangeRateMap: defaultExchangeRateMap,
    };
  }, [calculationDetails, accounts, currencies, customerDepositTotals]);
}
