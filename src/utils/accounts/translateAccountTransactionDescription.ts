import type { TFunction } from "i18next";

function translateTransferDescription(
  desc: string,
  t: TFunction,
  pattern: RegExp,
  key: "accounts.internalTransferTo" | "accounts.internalTransferFrom" | "accounts.transactionFeeForTransfer",
): string | null {
  const match = desc.match(pattern);
  if (!match) return null;
  const accountName = match[1].trim();
  const description = match[2] ? `: ${match[2]}` : "";
  return t(key, { accountName, description });
}

export function translateAccountTransactionDescription(desc: string, t: TFunction): string {
  if (!desc || desc === "-") return desc || "-";

  const transferTo = translateTransferDescription(
    desc,
    t,
    /^Internal transfer to ([^:]+)(?:: (.+))?$/,
    "accounts.internalTransferTo",
  );
  if (transferTo) return transferTo;

  const transferFrom = translateTransferDescription(
    desc,
    t,
    /^Internal transfer from ([^:]+)(?:: (.+))?$/,
    "accounts.internalTransferFrom",
  );
  if (transferFrom) return transferFrom;

  const fee = translateTransferDescription(
    desc,
    t,
    /^Transaction fee for transfer from ([^:]+)(?:: (.+))?$/,
    "accounts.transactionFeeForTransfer",
  );
  if (fee) return fee;

  const expenseDeletedMatch = desc.match(/^Reversal: Expense(?:: (.+))? \(Deleted\)$/);
  if (expenseDeletedMatch) {
    const description = expenseDeletedMatch[1] ? `: ${expenseDeletedMatch[1]}` : "";
    return t("accounts.expenseDeleted", { description });
  }

  const expenseReversalMatch = desc.match(/^Reversal: Expense(?:: (.+))?$/);
  if (expenseReversalMatch) {
    const description = expenseReversalMatch[1] ? `: ${expenseReversalMatch[1]}` : "";
    return t("accounts.expenseReversal", { description });
  }

  const reversalMatch = desc.match(/^Reversal: (.+)$/);
  if (reversalMatch) {
    return t("accounts.reversal", {
      description: translateAccountTransactionDescription(reversalMatch[1], t),
    });
  }

  const expenseMatch = desc.match(/^Expense(?:: (.+))?$/);
  if (expenseMatch) {
    const description = expenseMatch[1] ? `: ${expenseMatch[1]}` : "";
    return t("accounts.expense", { description });
  }

  const orderReceiptMatch = desc.match(/^Order #(\d+) - Receipt from customer$/);
  if (orderReceiptMatch) {
    return t("accounts.orderReceipt", { orderId: orderReceiptMatch[1] });
  }

  const orderPaymentMatch = desc.match(/^Order #(\d+) - Payment to customer$/);
  if (orderPaymentMatch) {
    return t("accounts.orderPayment", { orderId: orderPaymentMatch[1] });
  }

  const orderBuyMatch = desc.match(/^Order #(\d+) - Buy$/);
  if (orderBuyMatch) {
    return t("accounts.orderBuy", { orderId: orderBuyMatch[1] });
  }

  const orderSellMatch = desc.match(/^Order #(\d+) - Sell$/);
  if (orderSellMatch) {
    return t("accounts.orderSell", { orderId: orderSellMatch[1] });
  }

  return desc;
}
