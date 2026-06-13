import type { Currency, ProfitExchangeRate } from "../../types";
import { convertCurrency } from "../orders/orderCalculations";

export interface CustomerDepositTotalByCurrency {
  currencyCode: string;
  totalFundedBalance: number;
}

/** Prefer in-progress input text so converted amounts update on every keystroke. */
export function resolveLiveExchangeRate(
  key: string,
  fromCurrency: string,
  targetCurrency: string,
  rateMap: Map<string, number>,
  inputMap?: Map<string, string>,
): number {
  if (fromCurrency === targetCurrency) return 1;

  if (inputMap?.has(key)) {
    const raw = inputMap.get(key);
    if (raw === "" || raw === undefined) return 0;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const fromMap = rateMap.get(key);
  if (fromMap !== undefined && fromMap > 0) return fromMap;

  return 0;
}

export function buildEffectiveExchangeRateMap(
  targetCurrency: string,
  currencyCodes: string[],
  rateMap: Map<string, number>,
  inputMap?: Map<string, string>,
): Map<string, number> {
  const effective = new Map(rateMap);
  for (const currency of currencyCodes) {
    const key = `${currency}_${targetCurrency}`;
    const rate = resolveLiveExchangeRate(key, currency, targetCurrency, rateMap, inputMap);
    if (rate > 0) {
      effective.set(key, rate);
    }
  }
  if (targetCurrency) {
    effective.set(`${targetCurrency}_${targetCurrency}`, 1);
  }
  return effective;
}

export function buildDepositExchangeRateMap(
  targetCurrency: string,
  mainRates: Map<string, number>,
  depositRates: ProfitExchangeRate[],
  useLinked: boolean,
  pendingDepositRates?: Map<string, number>,
  mainRateInputs?: Map<string, string>,
  linkedCurrencyCodes?: string[],
): Map<string, number> {
  if (useLinked) {
    return buildEffectiveExchangeRateMap(
      targetCurrency,
      linkedCurrencyCodes ?? [],
      mainRates,
      mainRateInputs,
    );
  }

  const map = new Map<string, number>();
  depositRates.forEach((er) => {
    map.set(`${er.fromCurrencyCode}_${er.toCurrencyCode}`, er.rate);
  });
  pendingDepositRates?.forEach((rate, key) => {
    map.set(key, rate);
  });
  if (targetCurrency) {
    map.set(`${targetCurrency}_${targetCurrency}`, 1);
  }
  return map;
}

export function computeCustomerDepositConverted(
  depositTotals: CustomerDepositTotalByCurrency[],
  targetCurrency: string,
  depositRateMap: Map<string, number>,
  currencies: Currency[],
): number {
  let total = 0;

  for (const { currencyCode, totalFundedBalance } of depositTotals) {
    if (Math.abs(totalFundedBalance) < 0.005) continue;

    if (currencyCode === targetCurrency) {
      total += totalFundedBalance;
      continue;
    }

    const key = `${currencyCode}_${targetCurrency}`;
    const rate = depositRateMap.get(key) || 0;
    if (rate > 0) {
      total += convertCurrency(
        totalFundedBalance,
        rate,
        currencyCode,
        targetCurrency,
        currencies,
      );
    }
  }

  return total;
}

export function convertDepositCurrencyAmount(
  amount: number,
  currencyCode: string,
  targetCurrency: string,
  depositRateMap: Map<string, number>,
  currencies: Currency[],
  depositRateInputs?: Map<string, string>,
): number {
  if (Math.abs(amount) < 0.005) return 0;
  if (currencyCode === targetCurrency) return amount;

  const key = `${currencyCode}_${targetCurrency}`;
  const rate = resolveLiveExchangeRate(
    key,
    currencyCode,
    targetCurrency,
    depositRateMap,
    depositRateInputs,
  );
  if (rate <= 0) return amount;

  return convertCurrency(amount, rate, currencyCode, targetCurrency, currencies);
}
