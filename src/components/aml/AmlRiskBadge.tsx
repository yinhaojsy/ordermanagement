import Badge from "../common/Badge";
import type { AmlCheck } from "../../types/integrations";

type Tone = "emerald" | "amber" | "rose" | "slate" | "blue";

function riskTone(check: AmlCheck | null | undefined): Tone {
  if (!check) return "slate";
  if (check.isPending || check.status === "pending") return "blue";
  if (check.isBlacklisted || check.riskLevel === "severe" || check.riskLevel === "high") return "rose";
  if (check.riskLevel === "medium") return "amber";
  if (check.riskLevel === "low" || check.riskLevel === "none") return "emerald";
  return "slate";
}

function riskLabel(check: AmlCheck | null | undefined, notScreened: string, screening: string): string {
  if (!check) return notScreened;
  if (check.isPending || check.status === "pending") return screening;
  if (check.isBlacklisted) return "Blacklisted";
  if (check.riskPercent != null) {
    const level = check.riskLevel !== "pending" ? ` ${check.riskLevel}` : "";
    return `${check.riskPercent}%${level}`;
  }
  return check.status;
}

export default function AmlRiskBadge({
  check,
  notScreenedLabel = "Not screened",
  screeningLabel = "Screening…",
}: {
  check?: AmlCheck | null;
  notScreenedLabel?: string;
  screeningLabel?: string;
}) {
  return (
    <Badge tone={riskTone(check)}>
      {riskLabel(check, notScreenedLabel, screeningLabel)}
    </Badge>
  );
}
