import type { Account } from "../../types";

export function normalizeImportAccountName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFC");
}

/** Accounts that share a name stay together so each currency pool can be chosen. */
export function groupAccountsByName(accounts: Account[]): Map<string, Account[]> {
  const map = new Map<string, Account[]>();
  for (const account of accounts) {
    const key = normalizeImportAccountName(account.name);
    const list = map.get(key);
    if (list) list.push(account);
    else map.set(key, [account]);
  }
  return map;
}

function candidatesForName(accountsByName: Map<string, Account[]>, rawName: string): Account[] {
  const normalized = normalizeImportAccountName(rawName);
  const direct = accountsByName.get(normalized);
  if (direct?.length) return direct;

  const withoutNfc = rawName.trim().toLowerCase().replace(/\s+/g, " ");
  const loose = accountsByName.get(withoutNfc);
  if (loose?.length) return loose;

  const compact = rawName.trim().toLowerCase().replace(/\s/g, "").normalize("NFC");
  for (const [key, list] of accountsByName) {
    if (key.replace(/\s/g, "") === compact) return list;
  }

  const lower = rawName.trim().toLowerCase();
  for (const [key, list] of accountsByName) {
    if (key === lower || list.some((account) => account.name.toLowerCase() === lower)) return list;
  }
  return [];
}

export type AccountMatchResult =
  | { account: Account }
  | { error: "not_found" }
  | { error: "not_in_currency"; currencies: string[] }
  | { error: "currency_required"; currencies: string[] };

export function matchAccountInCurrency(
  accountsByName: Map<string, Account[]>,
  rawName: string,
  currencyCode: string | undefined,
): AccountMatchResult {
  const matches = candidatesForName(accountsByName, rawName);
  if (matches.length === 0) return { error: "not_found" };

  if (currencyCode) {
    const wanted = currencyCode.toUpperCase();
    const account = matches.find((item) => (item.currencyCode || "").toUpperCase() === wanted);
    if (account) return { account };
    return {
      error: "not_in_currency",
      currencies: [...new Set(matches.map((item) => item.currencyCode))],
    };
  }

  if (matches.length === 1) return { account: matches[0] };
  return {
    error: "currency_required",
    currencies: [...new Set(matches.map((item) => item.currencyCode))],
  };
}

export function accountNamePreview(accountsByName: Map<string, Account[]>, limit = 10) {
  const labels: string[] = [];
  for (const list of accountsByName.values()) {
    for (const account of list) {
      labels.push(`${account.name} (${account.currencyCode})`);
      if (labels.length >= limit) return `${labels.join(", ")}...`;
    }
  }
  return labels.join(", ");
}
