import { db } from "../db.js";
import { buildAccountStatementRows } from "./customerLedgerOrders.js";

const BAL = "customer_balance";

function sumBalReceipts(orderId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM order_receipts
       WHERE orderId = ? AND status = 'confirmed' AND fundedFrom = ?;`,
    )
    .get(orderId, BAL);
  return Number(row?.total ?? 0);
}

function sumBalPayments(orderId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM order_payments
       WHERE orderId = ? AND status = 'confirmed' AND fundedFrom = ?;`,
    )
    .get(orderId, BAL);
  return Number(row?.total ?? 0);
}

function listBalServiceCharges(orderId) {
  return db
    .prepare(
      `SELECT currencyCode, amount
       FROM order_service_charges
       WHERE orderId = ? AND status = 'confirmed' AND fundedFrom = ?;`,
    )
    .all(orderId, BAL)
    .map((r) => ({
      currencyCode: r.currencyCode,
      amount: Math.abs(Number(r.amount ?? 0)),
    }))
    .filter((r) => r.amount > 0);
}

/**
 * Funding deltas for an order (Bal receipt/payment/SC only). sign = -1 for reversal rows.
 */
export function getOrderFundingDetails(orderId, fromCurrency, toCurrency, sign = 1) {
  const receiptBal = sumBalReceipts(orderId);
  const paymentBal = sumBalPayments(orderId);
  const scBal = listBalServiceCharges(orderId);

  const fundingEffects = [];
  if (receiptBal > 0) {
    fundingEffects.push({ currencyCode: fromCurrency, delta: -receiptBal * sign });
  }
  if (paymentBal > 0) {
    fundingEffects.push({ currencyCode: toCurrency, delta: paymentBal * sign });
  }
  for (const sc of scBal) {
    fundingEffects.push({ currencyCode: sc.currencyCode, delta: -sc.amount * sign });
  }

  return {
    prepaidUsed:
      receiptBal > 0 ? { amount: receiptBal * sign, currency: fromCurrency } : null,
    depositCredited:
      paymentBal > 0 ? { amount: paymentBal * sign, currency: toCurrency } : null,
    serviceChargeFromDeposit: scBal.map((sc) => ({
      amount: sc.amount * sign,
      currency: sc.currencyCode,
    })),
    fundingEffects,
    usesDeposit: receiptBal > 0 || paymentBal > 0 || scBal.length > 0,
  };
}

function enrichFundingRow(row) {
  const delta = row.fundingType === "deposit" ? row.amount : -row.amount;
  return {
    ...row,
    fundingEffects: [{ currencyCode: row.currencyCode, delta }],
    usesDeposit: true,
    prepaidUsed: null,
    depositCredited: null,
    serviceChargeFromDeposit: [],
    orderMode: null,
  };
}

function enrichTradeRow(row, orderMeta, sign) {
  const { fromCurrency, toCurrency, orderMode } = orderMeta;
  const details = getOrderFundingDetails(row.orderId, fromCurrency, toCurrency, sign);
  return {
    ...row,
    orderMode: orderMode === "ledger_swap" ? "ledger_swap" : "exchange",
    prepaidUsed: details.prepaidUsed,
    depositCredited: details.depositCredited,
    serviceChargeFromDeposit: details.serviceChargeFromDeposit,
    fundingEffects: details.fundingEffects,
    usesDeposit: details.usesDeposit,
  };
}

/**
 * Bank-style deposit account statement: manual funding + trades with Bal usage metadata.
 * Credit/debit on trade rows remain trade volume; fundingEffects drive running balance.
 */
export function buildDepositAccountStatementRows(customerId, { includeReversals = false } = {}) {
  const baseRows = buildAccountStatementRows(customerId, { activity: "all", includeReversals });

  const orderIds = [
    ...new Set(
      baseRows.filter((r) => r.activity === "trade").map((r) => r.orderId),
    ),
  ];

  const orderMetaById = {};
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => "?").join(",");
    const orders = db
      .prepare(
        `SELECT id, fromCurrency, toCurrency, COALESCE(orderMode, 'exchange') AS orderMode
         FROM orders WHERE id IN (${placeholders});`,
      )
      .all(...orderIds);
    for (const o of orders) {
      orderMetaById[o.id] = o;
    }
  }

  return baseRows.map((row) => {
    if (row.activity === "funding") {
      return enrichFundingRow(row);
    }
    const meta = orderMetaById[row.orderId];
    if (!meta) {
      return {
        ...row,
        orderMode: "exchange",
        prepaidUsed: null,
        depositCredited: null,
        serviceChargeFromDeposit: [],
        fundingEffects: [],
        usesDeposit: false,
      };
    }
    const sign = row.isReversal ? -1 : 1;
    return enrichTradeRow(row, meta, sign);
  });
}
