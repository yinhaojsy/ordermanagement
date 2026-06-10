import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import type { AmlCheck } from "../../types/integrations";
import { useRecheckAmlMutation } from "../../services/api";

type Tone = "emerald" | "amber" | "rose" | "slate" | "blue";

function gaugeTone(check: AmlCheck): Tone {
  if (check.isBlacklisted || check.riskLevel === "severe") return "rose";
  if (check.riskLevel === "high") return "rose";
  if (check.riskLevel === "medium") return "amber";
  if (check.riskLevel === "low" || check.riskLevel === "none") return "emerald";
  return "slate";
}

export default function AmlReportModal({
  isOpen,
  onClose,
  check,
  title,
  subtitle,
  onCheckUpdated,
}: {
  isOpen: boolean;
  onClose: () => void;
  check: AmlCheck | null;
  title?: string;
  subtitle?: string;
  onCheckUpdated?: (check: AmlCheck) => void;
}) {
  const { t } = useTranslation();
  const [recheck, { isLoading: isRechecking }] = useRecheckAmlMutation();
  const [localCheck, setLocalCheck] = useState<AmlCheck | null>(check);

  useEffect(() => {
    setLocalCheck(check);
  }, [check]);

  useEffect(() => {
    if (!isOpen || !localCheck?.isPending || !localCheck.externalUid) return undefined;
    const timer = setInterval(async () => {
      try {
        const result = await recheck({ checkId: localCheck.id }).unwrap();
        setLocalCheck(result.check);
        onCheckUpdated?.(result.check);
        if (!result.check.isPending) clearInterval(timer);
      } catch {
        // keep polling
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [isOpen, localCheck?.id, localCheck?.isPending, localCheck?.externalUid, onCheckUpdated, recheck]);

  if (!isOpen || !localCheck) return null;

  const signals = Array.isArray(localCheck.signals) ? localCheck.signals : [];
  const tone = gaugeTone(localCheck);
  const toneColors: Record<Tone, string> = {
    emerald: "text-emerald-600 border-emerald-200 bg-emerald-50",
    amber: "text-amber-600 border-amber-200 bg-amber-50",
    rose: "text-rose-600 border-rose-200 bg-rose-50",
    slate: "text-slate-600 border-slate-200 bg-slate-50",
    blue: "text-blue-600 border-blue-200 bg-blue-50",
  };

  const handleManualRecheck = async () => {
    try {
      const result = await recheck({ checkId: localCheck.id }).unwrap();
      setLocalCheck(result.check);
      onCheckUpdated?.(result.check);
    } catch {
      // parent may show alert
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {title || t("aml.reportTitle")}
            </h2>
            {subtitle ? <p className="mt-1 text-sm font-mono text-slate-500 break-all">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t("common.close")}>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {localCheck.isBlacklisted ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {t("aml.blacklistedWarning")}
          </div>
        ) : null}

        {localCheck.isPending ? (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {t("aml.pendingMessage")}
          </div>
        ) : null}

        <div className="mb-6 flex items-center gap-6">
          <div className={`flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 ${toneColors[tone]}`}>
            <span className="text-2xl font-bold">
              {localCheck.riskPercent != null ? `${localCheck.riskPercent}%` : "—"}
            </span>
            <span className="text-xs uppercase">{t("aml.risk")}</span>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-slate-500">{t("aml.level")}: </span>
              <Badge tone={tone}>{localCheck.riskLevel}</Badge>
            </div>
            <div>
              <span className="text-slate-500">{t("aml.status")}: </span>
              <span className="font-medium">{localCheck.status}</span>
            </div>
            <div>
              <span className="text-slate-500">{t("aml.checkType")}: </span>
              <span className="font-medium">{localCheck.checkType}</span>
            </div>
            {localCheck.externalUid ? (
              <div className="font-mono text-xs text-slate-500 break-all">
                UID: {localCheck.externalUid}
              </div>
            ) : null}
          </div>
        </div>

        {signals.length > 0 ? (
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">{t("aml.signalsTitle")}</h3>
            <div className="space-y-2">
              {signals.map((signal) => (
                <div key={signal.key}>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span>{signal.label}</span>
                    <span>{signal.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${Math.min(signal.percent, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mb-6 text-sm text-slate-500">{t("aml.noSignals")}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {localCheck.isPending ? (
            <button
              type="button"
              onClick={handleManualRecheck}
              disabled={isRechecking}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isRechecking ? t("common.loading") : t("aml.recheck")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
