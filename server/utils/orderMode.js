export const ORDER_MODE_EXCHANGE = "exchange";
export const ORDER_MODE_LEDGER_SWAP = "ledger_swap";

export function normalizeOrderMode(mode) {
  return mode === ORDER_MODE_LEDGER_SWAP ? ORDER_MODE_LEDGER_SWAP : ORDER_MODE_EXCHANGE;
}

export function isLedgerSwapOrder(order) {
  if (!order) return false;
  return normalizeOrderMode(order.orderMode) === ORDER_MODE_LEDGER_SWAP;
}
