import { db } from "../db.js";
import { convertCurrency } from "../utils/currencyConversion.js";

/** Profit calculation rates for converting amounts to target currency. */
export function getProfitConversion(profitCalculationId) {
  const calc = profitCalculationId
    ? db.prepare("SELECT * FROM profit_calculations WHERE id = ?;").get(profitCalculationId)
    : db
        .prepare("SELECT * FROM profit_calculations WHERE isDefault = 1 LIMIT 1;")
        .get();

  if (!calc) {
    return {
      profitCalculationId: null,
      profitCalculationName: null,
      targetCurrency: null,
      convertToTarget: () => null,
      convertFromTarget: () => null,
      rateToTarget: {},
    };
  }

  const rates = db
    .prepare(
      "SELECT fromCurrencyCode, toCurrencyCode, rate FROM profit_exchange_rates WHERE profitCalculationId = ?;",
    )
    .all(calc.id);

  const currencies = db.prepare("SELECT * FROM currencies ORDER BY code ASC;").all();
  const targetCurrency = calc.targetCurrencyCode;
  const rateToTarget = {};
  for (const r of rates) {
    if (r.toCurrencyCode === targetCurrency) {
      rateToTarget[r.fromCurrencyCode] = r.rate;
    }
  }

  const convertToTarget = (amount, fromCode) => {
    if (fromCode === targetCurrency) return amount;
    const rate = rateToTarget[fromCode];
    if (rate === undefined || rate === null) return null;
    return convertCurrency(amount, rate, fromCode, targetCurrency, currencies);
  };

  /** Convert an amount in target currency into `toCode` using the same stored rate. */
  const convertFromTarget = (amountInTarget, toCode) => {
    if (toCode === targetCurrency) return amountInTarget;
    const rate = rateToTarget[toCode];
    if (rate === undefined || rate === null) return null;
    return convertCurrency(amountInTarget, rate, targetCurrency, toCode, currencies);
  };

  return {
    profitCalculationId: calc.id,
    profitCalculationName: calc.name,
    targetCurrency,
    convertToTarget,
    convertFromTarget,
    rateToTarget,
  };
}

/** Default profit calculation rates for converting amounts to target currency. */
export function getDefaultProfitConversion() {
  const { targetCurrency, convertToTarget } = getProfitConversion();
  return { targetCurrency, convertToTarget };
}
