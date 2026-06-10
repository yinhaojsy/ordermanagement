import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import AmlConnectionsTable from "./AmlConnectionsTable";
import AmlSignalsSection from "./AmlSignalsSection";
import type { AmlCheck } from "../../types/integrations";
import { useGetAmlCheckQuery, useRecheckAmlMutation } from "../../services/api";
import { formatUsdVolume, parseAmlReport } from "../../utils/amlReportParser";

type Tone = "emerald" | "amber" | "rose" | "slate" | "blue";

function gaugeTone(check: AmlCheck): Tone {
  if (check.isBlacklisted || check.riskLevel === "severe") return "rose";
  if (check.riskLevel === "high") return "rose";
  if (check.riskLevel === "medium") return "amber";
  if (check.riskLevel === "low" || check.riskLevel === "none") return "emerald";
  return "slate";
}

function reportTitleKey(checkType: AmlCheck["checkType"]): string {
  if (checkType === "transaction") return "aml.reportTitleTransaction";
  if (checkType === "address_investigation") return "aml.reportTitleInvestigate";
  return "aml.reportTitleScreen";
}

function flowBadgeKey(checkType: AmlCheck["checkType"], flow: string | null): string {
  if (checkType === "address_investigation" || flow === "advanced") {
    return "aml.flowAdvanced";
  }
  return "aml.flowFast";
}

function modalWidthClass(variant: string): string {
  if (variant === "investigate") return "max-w-4xl";
  if (variant === "transaction") return "max-w-2xl";
  return "max-w-lg";
}

function truncateHash(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export default function AmlReportModal({
  isOpen,
  onClose,
  check,
  title,
  subtitle,
  onCheckUpdated,
  onInvestigate,
  investigateLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  check: AmlCheck | null;
  title?: string;
  subtitle?: string;
  onCheckUpdated?: (check: AmlCheck) => void;
  onInvestigate?: () => void;
  investigateLoading?: boolean;
}) {
  const { t } = useTranslation();
  const [recheck, { isLoading: isRechecking }] = useRecheckAmlMutation();
  const [localCheck, setLocalCheck] = useState<AmlCheck | null>(check);
  const [showRawJson, setShowRawJson] = useState(false);
  const [showCounterpartyHistory, setShowCounterpartyHistory] = useState(false);

  const { data: detailData, isFetching: isDetailLoading } = useGetAmlCheckQuery(
    localCheck?.id ?? 0,
    { skip: !isOpen || !localCheck?.id },
  );

  useEffect(() => {
    setLocalCheck(check);
    setShowRawJson(false);
    setShowCounterpartyHistory(false);
  }, [check]);

  useEffect(() => {
    if (detailData?.check) {
      setLocalCheck(detailData.check);
    }
  }, [detailData?.check]);

  const parsed = useMemo(
    () =>
      localCheck
        ? parseAmlReport(detailData?.rawResponse, localCheck.checkType)
        : null,
    [detailData?.rawResponse, localCheck],
  );

  const signals = useMemo(() => {
    if (parsed?.aggregateSignals.length) return parsed.aggregateSignals;
    return Array.isArray(localCheck?.signals) ? localCheck.signals : [];
  }, [parsed?.aggregateSignals, localCheck?.signals]);

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

  const tone = gaugeTone(localCheck);
  const toneColors: Record<Tone, string> = {
    emerald: "text-emerald-600 border-emerald-200 bg-emerald-50",
    amber: "text-amber-600 border-amber-200 bg-amber-50",
    rose: "text-rose-600 border-rose-200 bg-rose-50",
    slate: "text-slate-600 border-slate-200 bg-slate-50",
    blue: "text-blue-600 border-blue-200 bg-blue-50",
  };

  const variant = parsed?.variant ?? (localCheck.checkType === "transaction" ? "transaction" : "screen");
  const widthClass = modalWidthClass(variant);

  const handleManualRecheck = async () => {
    try {
      const result = await recheck({ checkId: localCheck.id }).unwrap();
      setLocalCheck(result.check);
      onCheckUpdated?.(result.check);
    } catch {
      // parent may show alert
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard unavailable
    }
  };

  const flaggedConnections =
    variant === "transaction" && parsed
      ? parsed.txConnections.filter((r) => r.isHighRisk)
      : parsed?.walletConnections.filter((r) => r.isHighRisk) ?? [];

  const topFlagged =
    variant === "screen" && parsed
      ? sortByRisk(parsed.walletConnections.filter((r) => r.isHighRisk)).slice(0, 5)
      : flaggedConnections.slice(0, 5);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div
        className={`w-full ${widthClass} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-lg`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900">
                {title || t(reportTitleKey(localCheck.checkType))}
              </h2>
              <Badge tone="slate">
                {t(flowBadgeKey(localCheck.checkType, parsed?.flow ?? null))}
              </Badge>
            </div>
            {subtitle ? (
              <p className="mt-1 break-all font-mono text-sm text-slate-500">{subtitle}</p>
            ) : null}
            {parsed?.txHash ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-slate-700">{truncateHash(parsed.txHash, 10, 10)}</span>
                <button
                  type="button"
                  onClick={() => copyText(parsed.txHash!)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  {t("aml.copyHash")}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label={t("common.close")}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {localCheck.isBlacklisted || parsed?.hasBlackListFlag ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {t("aml.blacklistedWarning")}
          </div>
        ) : null}

        {localCheck.isPending ? (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {t("aml.pendingMessage")}
          </div>
        ) : null}

        {parsed && parsed.highRiskCount > 0 ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t("aml.highRiskExposure", { count: parsed.highRiskCount })}
          </div>
        ) : null}

        {variant === "transaction" && parsed ? (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {parsed.direction ? (
                <Badge tone={parsed.direction === "deposit" ? "emerald" : "blue"}>
                  {t(`aml.direction.${parsed.direction}`, parsed.direction)}
                </Badge>
              ) : null}
              {parsed.tokenAmount ? (
                <span className="font-semibold text-slate-900">{parsed.tokenAmount}</span>
              ) : null}
              {parsed.fiatAmount ? (
                <span className="text-slate-600">≈ {parsed.fiatAmount}</span>
              ) : null}
            </div>
            {parsed.riskyTokenAmount && parsed.riskyFiatAmount ? (
              <p className="mt-2 text-xs text-slate-600">
                {t("aml.riskyPortion", {
                  token: parsed.riskyTokenAmount,
                  fiat: parsed.riskyFiatAmount,
                  percent: parsed.riskyPercent ?? 0,
                })}
              </p>
            ) : null}
            {parsed.timestamp ? (
              <p className="mt-1 text-xs text-slate-500">
                {t("aml.screenedAt")}: {parsed.timestamp}
              </p>
            ) : null}
            <div className="mt-3 space-y-1 text-xs">
              {parsed.address ? (
                <div>
                  <span className="text-slate-500">
                    {parsed.direction === "deposit"
                      ? t("aml.receivingWallet")
                      : t("aml.walletAddress")}
                    :{" "}
                  </span>
                  <span className="break-all font-mono text-slate-800">{parsed.address}</span>
                </div>
              ) : null}
              {parsed.counterpartyAddress ? (
                <div>
                  <span className="text-slate-500">
                    {parsed.direction === "deposit"
                      ? t("aml.senderCounterparty")
                      : t("aml.recipientCounterparty")}
                    :{" "}
                  </span>
                  <span className="break-all font-mono text-slate-800">
                    {parsed.counterpartyAddress}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div
            className={`flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border-4 ${toneColors[tone]}`}
          >
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
            {parsed?.asset ? (
              <div>
                <span className="text-slate-500">{t("aml.asset")}: </span>
                <span className="font-medium">
                  {parsed.tokenCode || parsed.asset}
                  {parsed.network ? ` · ${parsed.network}` : ""}
                </span>
              </div>
            ) : null}
            {parsed?.timestamp && variant !== "transaction" ? (
              <div>
                <span className="text-slate-500">{t("aml.screenedAt")}: </span>
                <span className="font-medium">{parsed.timestamp}</span>
              </div>
            ) : null}
            {localCheck.externalUid ? (
              <div className="break-all font-mono text-xs text-slate-500">
                UID: {localCheck.externalUid}
              </div>
            ) : null}
          </div>
        </div>

        {parsed &&
        (parsed.receivedFiatAmount != null || parsed.sentFiatAmount != null) &&
        variant !== "transaction" ? (
          <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t("aml.fiatReceived")}</div>
              <div className="font-semibold text-slate-900">
                {formatUsdVolume(parsed.receivedFiatAmount)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t("aml.fiatSent")}</div>
              <div className="font-semibold text-slate-900">
                {formatUsdVolume(parsed.sentFiatAmount)}
              </div>
            </div>
            {parsed.directConnectionCount > 0 ? (
              <div className="col-span-2 text-xs text-slate-600">
                {t("aml.directConnections", { count: parsed.directConnectionCount })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mb-6">
          <AmlSignalsSection
            aggregate={signals}
            signalsIn={parsed?.signalsIn ?? []}
            signalsOut={parsed?.signalsOut ?? []}
            showDirectional={variant === "investigate"}
          />
        </div>

        {variant === "transaction" && parsed && parsed.txConnections.length > 0 ? (
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              {t("aml.txConnectionsTitle")}
            </h3>
            <AmlConnectionsTable rows={parsed.txConnections} showSent={false} />
          </div>
        ) : null}

        {variant === "screen" && parsed && topFlagged.length > 0 ? (
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              {t("aml.topFlaggedTitle")}
            </h3>
            <AmlConnectionsTable rows={topFlagged} />
          </div>
        ) : null}

        {variant === "investigate" && parsed && parsed.walletConnections.length > 0 ? (
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              {t("aml.connectionsTitle")}
            </h3>
            <AmlConnectionsTable rows={parsed.walletConnections} />
          </div>
        ) : null}

        {variant === "transaction" &&
        parsed &&
        parsed.walletConnections.length > 0 ? (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setShowCounterpartyHistory((v) => !v)}
              className="mb-3 text-sm font-semibold text-blue-600 hover:text-blue-800"
            >
              {showCounterpartyHistory
                ? t("aml.hideCounterpartyHistory")
                : t("aml.showCounterpartyHistory")}
            </button>
            {showCounterpartyHistory ? (
              <AmlConnectionsTable rows={parsed.walletConnections} />
            ) : null}
          </div>
        ) : null}

        {isDetailLoading ? (
          <p className="mb-4 text-xs text-slate-400">{t("aml.loadingDetails")}</p>
        ) : null}

        {showRawJson && detailData?.rawResponse ? (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">{t("aml.rawJsonTitle")}</h3>
              <button
                type="button"
                onClick={() =>
                  copyText(JSON.stringify(detailData.rawResponse, null, 2))
                }
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                {t("aml.copyRawJson")}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
              {JSON.stringify(detailData.rawResponse, null, 2)}
            </pre>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {parsed?.pdfReport ? (
            <a
              href={parsed.pdfReport}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("aml.openPdf")}
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setShowRawJson((v) => !v)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {showRawJson ? t("aml.hideRawJson") : t("aml.viewRawJson")}
          </button>
          {variant === "screen" && onInvestigate ? (
            <button
              type="button"
              onClick={onInvestigate}
              disabled={investigateLoading}
              className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
            >
              {investigateLoading ? t("common.loading") : t("aml.investigate")}
            </button>
          ) : null}
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

function sortByRisk<T extends { isHighRisk: boolean; entityRiskPercent: number | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.isHighRisk !== b.isHighRisk) return a.isHighRisk ? -1 : 1;
    return (b.entityRiskPercent ?? 0) - (a.entityRiskPercent ?? 0);
  });
}
