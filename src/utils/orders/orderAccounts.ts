/** Label returned by API for customer-balance (Bal) legs — not a company account. */
export const COF_ACCOUNT_LABEL = "COF";

export interface OrderAccountLeg {
  accountId: number | null;
  accountName: string;
  amount: number;
  isCof?: boolean;
}

export function isCofAccountLeg(
  leg: Pick<OrderAccountLeg, "accountName" | "isCof">,
): boolean {
  return leg.isCof === true || leg.accountName === COF_ACCOUNT_LABEL;
}

export function formatOrderAccountLegName(
  leg: Pick<OrderAccountLeg, "accountName" | "isCof">,
  cofLabel: string,
): string {
  return isCofAccountLeg(leg) ? cofLabel : leg.accountName;
}

export function formatOrderAccountsColumn(
  accounts: OrderAccountLeg[] | null | undefined,
  cofLabel: string,
  fallback?: string | null,
): string {
  if (accounts && accounts.length > 0) {
    return accounts.map((a) => formatOrderAccountLegName(a, cofLabel)).join(", ");
  }
  return fallback || "-";
}
