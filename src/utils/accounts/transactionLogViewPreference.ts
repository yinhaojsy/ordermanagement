export type TransactionLogViewMode = "sidebar" | "modal";

const STORAGE_KEY_PREFIX = "account_transaction_log_view_";

function getStorageKey(userId: number | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}${userId ?? "anonymous"}`;
}

export function getTransactionLogViewPreference(
  userId: number | null | undefined,
): TransactionLogViewMode {
  if (typeof window === "undefined") return "sidebar";

  try {
    const value = localStorage.getItem(getStorageKey(userId));
    return value === "modal" ? "modal" : "sidebar";
  } catch {
    return "sidebar";
  }
}

export function saveTransactionLogViewPreference(
  userId: number | null | undefined,
  mode: TransactionLogViewMode,
): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(getStorageKey(userId), mode);
  } catch (error) {
    console.error("Failed to save transaction log view preference:", error);
  }
}
