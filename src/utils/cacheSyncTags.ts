import type { TagDescription } from "@reduxjs/toolkit/query";

export type CacheSyncPayload = {
  scopes: string[];
  orderId?: number;
  accountIds?: number[];
  customerId?: number;
  calculationId?: number;
  beneficiaryId?: number;
};

type AnyInvalidateTag = TagDescription<any> | string;

const uniqTags = (tags: AnyInvalidateTag[]) => {
  const seen = new Set<string>();
  const out: AnyInvalidateTag[] = [];
  for (const t of tags) {
    const key = typeof t === "string" ? `s:${t}` : `${(t as { type: string }).type}:${(t as { id?: string | number }).id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
};

/** Maps server cacheSync scopes to RTK Query invalidateTags input (same shapes as api.ts). */
export function tagsFromCacheSyncPayload(payload: CacheSyncPayload): AnyInvalidateTag[] {
  const tags: AnyInvalidateTag[] = [];
  const { scopes, orderId, accountIds, customerId, calculationId, beneficiaryId } = payload;

  for (const scope of scopes || []) {
    switch (scope) {
      case "orders":
        tags.push({ type: "Order", id: "LIST" });
        tags.push({ type: "Order", id: "PINS" });
        if (orderId != null && Number.isFinite(Number(orderId))) {
          tags.push({ type: "Order", id: Number(orderId) });
        }
        break;
      case "accounts":
        tags.push({ type: "Account", id: "LIST" });
        tags.push("Account");
        for (const id of accountIds || []) {
          if (id != null && Number.isFinite(Number(id))) tags.push({ type: "Account", id: Number(id) });
        }
        break;
      case "expenses":
        tags.push({ type: "Expense", id: "LIST" });
        break;
      case "transfers":
        tags.push({ type: "Transfer", id: "LIST" });
        tags.push({ type: "Account", id: "LIST" });
        tags.push("Account");
        break;
      case "customers":
        tags.push({ type: "Customer", id: "LIST" });
        tags.push({ type: "Customer", id: "OPTIONS" });
        if (customerId != null && Number.isFinite(Number(customerId))) {
          tags.push({ type: "Customer", id: Number(customerId) });
        }
        break;
      case "currencies":
        tags.push({ type: "Currency", id: "LIST" });
        break;
      case "tags":
        tags.push({ type: "Tag", id: "LIST" });
        break;
      case "profitCalculations":
        tags.push({ type: "ProfitCalculation", id: "LIST" });
        if (calculationId != null && Number.isFinite(Number(calculationId))) {
          tags.push({ type: "ProfitCalculation", id: Number(calculationId) });
        }
        break;
      case "customerBeneficiaries":
        if (customerId != null && Number.isFinite(Number(customerId))) {
          tags.push({ type: "CustomerBeneficiary", id: `LIST-${Number(customerId)}` });
        }
        if (beneficiaryId != null && Number.isFinite(Number(beneficiaryId))) {
          tags.push({ type: "CustomerBeneficiary", id: Number(beneficiaryId) });
        }
        break;
      case "customerLedger":
        tags.push({ type: "CustomerLedger", id: "CONVERTED-BALANCES" });
        tags.push({ type: "CustomerLedger", id: "FUNDING-CONVERTED-BALANCES" });
        tags.push({ type: "CustomerLedger", id: "DEPOSIT-TOTALS" });
        tags.push({ type: "CustomerLedger", id: "DEPOSIT-BY-CURRENCY" });
        tags.push({ type: "Customer", id: "LIST" });
        if (customerId != null && Number.isFinite(Number(customerId))) {
          const cid = Number(customerId);
          tags.push({ type: "CustomerLedger", id: `LIST-${cid}` });
          tags.push({ type: "CustomerLedger", id: `SUMMARY-${cid}` });
          tags.push({ type: "CustomerLedger", id: `FUNDING-BALANCES-${cid}` });
          tags.push({ type: "CustomerLedger", id: `FUNDING-SUMMARY-${cid}` });
          tags.push({ type: "CustomerLedger", id: `TRADE-PROFIT-${cid}` });
          tags.push({ type: "CustomerLedger", id: `BALANCE-${cid}` });
          tags.push({ type: "CustomerLedger", id: `ACCOUNT-STATEMENT-${cid}` });
        }
        break;
      case "customerKyc":
        if (customerId != null && Number.isFinite(Number(customerId))) {
          tags.push({ type: "CustomerKyc", id: Number(customerId) });
        }
        break;
      default:
        break;
    }
  }

  return uniqTags(tags);
}
