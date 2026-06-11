import type { AmlCheck } from "../types/integrations";

/** True when the AML provider report indicates a blacklist / contract-ban / max-risk flag. */
export function isAmlProviderFlagged(check: AmlCheck | null | undefined): boolean {
  if (!check || check.isPending) return false;
  if (check.isBlacklisted) return true;
  if (check.riskLevel === "severe" && (check.riskPercent ?? 0) >= 100) return true;
  if (
    Array.isArray(check.signals) &&
    check.signals.some((signal) => signal.key === "illegal_service" && signal.percent >= 100)
  ) {
    return true;
  }
  return false;
}
