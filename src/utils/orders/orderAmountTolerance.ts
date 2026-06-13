/**
 * Max allowed absolute difference between header amounts (Amount Buy / Amount Sell)
 * and summed receipt or payment lines when completing an order.
 * Currency exchange amounts are often rounded in practice.
 */
export const ORDER_RECEIPT_PAYMENT_TOLERANCE = 2;

/** Rounding slack when comparing order lines to customer prepaid/advance balances. */
export const FUNDING_BALANCE_TOLERANCE = 0.01;

/** Floor to display precision so shown balances are never higher than actual. */
export function floorToDisplayAmount(amount: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.floor(amount * factor + 1e-9) / factor;
}

/** Full precision for amount inputs — up to 4 dp, no trailing zeros. */
export function formatAmountForInput(amount: number, maxDecimals = 4): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const fixed = amount.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}
