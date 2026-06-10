import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import type { AmlConnectionRow } from "../../utils/amlReportParser";
import { formatEntityType, formatUsdVolume } from "../../utils/amlReportParser";

type Tone = "emerald" | "amber" | "rose" | "slate" | "orange";

function entityTone(type: string, isHighRisk: boolean): Tone {
  if (isHighRisk) return "rose";
  if (type.includes("licensed") && type.includes("exchange")) return "emerald";
  if (type.includes("exchange")) return "orange";
  if (type === "gambling") return "amber";
  return "slate";
}

function formatVolume(total: number | null, direct: number | null): string {
  if (total == null) return "—";
  const base = formatUsdVolume(total);
  if (direct != null && direct > 0) {
    return `${base} (${formatUsdVolume(direct)} direct)`;
  }
  return base;
}

function formatHops(received: number | null, sent: number | null): string {
  const parts: string[] = [];
  if (received != null) parts.push(String(received));
  else parts.push("—");
  if (sent != null) parts.push(String(sent));
  else parts.push("—");
  return parts.join(" / ");
}

export default function AmlConnectionsTable({
  rows,
  limit,
  showSent = true,
}: {
  rows: AmlConnectionRow[];
  limit?: number;
  showSent?: boolean;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo(() => {
    if (showAll || limit == null) return rows;
    return rows.slice(0, limit);
  }, [rows, limit, showAll]);

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{t("aml.noConnections")}</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">{t("aml.connectionEntity")}</th>
              <th className="px-3 py-2 font-semibold">{t("aml.connectionType")}</th>
              <th className="px-3 py-2 font-semibold">{t("aml.connectionRisk")}</th>
              <th className="px-3 py-2 font-semibold">{t("aml.connectionReceived")}</th>
              {showSent ? (
                <th className="px-3 py-2 font-semibold">{t("aml.connectionSent")}</th>
              ) : null}
              <th className="px-3 py-2 font-semibold">{t("aml.connectionHops")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((row) => (
              <tr
                key={row.id}
                className={row.isHighRisk ? "bg-rose-50/60" : undefined}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{row.entityName}</div>
                  {row.entitySubtype ? (
                    <div className="text-[11px] text-slate-500">{row.entitySubtype}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={entityTone(row.entityType, row.isHighRisk)}>
                    {formatEntityType(row.entityType)}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {row.entityRiskPercent != null ? `${row.entityRiskPercent}%` : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatVolume(row.receivedTotal, row.receivedDirect)}
                </td>
                {showSent ? (
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatVolume(row.sentTotal, row.sentDirect)}
                  </td>
                ) : null}
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatHops(row.receivedHops, showSent ? row.sentHops : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit != null && rows.length > limit ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800"
        >
          {showAll
            ? t("aml.showLess")
            : t("aml.showAllConnections", { count: rows.length })}
        </button>
      ) : null}
    </div>
  );
}
