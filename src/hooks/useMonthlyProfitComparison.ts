import { useMemo } from "react";
import type { Account, AccountMonthlyStatistics, Currency, ProfitCalculationDetails } from "../types";
import { useProfitSummary } from "./useProfitSummary";

export function accountsWithBalances(
  accounts: Account[],
  balanceById: Map<number, number>,
): Account[] {
  return accounts.map((account) => ({
    ...account,
    balance: balanceById.get(account.id) ?? 0,
  }));
}

export function useMonthlyProfitComparison(
  calculationDetails: ProfitCalculationDetails | undefined,
  accounts: Account[],
  currencies: Currency[],
  statistics: AccountMonthlyStatistics | undefined,
) {
  const openingAccounts = useMemo(() => {
    if (!statistics) return [];
    const balanceById = new Map(statistics.accounts.map((a) => [a.id, a.openingBalance]));
    return accountsWithBalances(accounts, balanceById);
  }, [accounts, statistics]);

  const closingAccounts = useMemo(() => {
    if (!statistics) return [];
    const balanceById = new Map(statistics.accounts.map((a) => [a.id, a.closingBalance]));
    return accountsWithBalances(accounts, balanceById);
  }, [accounts, statistics]);

  const startSummary = useProfitSummary(
    calculationDetails,
    openingAccounts,
    currencies,
    statistics?.depositTotalsAtStart ?? [],
  );

  const endSummary = useProfitSummary(
    calculationDetails,
    closingAccounts,
    currencies,
    statistics?.depositTotalsAtEnd ?? [],
  );

  const monthlyProfit = useMemo(() => {
    if (!startSummary || !endSummary) return null;
    return endSummary.totalProfit - startSummary.totalProfit;
  }, [startSummary, endSummary]);

  return { startSummary, endSummary, monthlyProfit };
}
