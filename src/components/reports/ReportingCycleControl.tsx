import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "../../app/hooks";
import { useSetSettingMutation } from "../../services/api";
import type { ReportingCycle } from "../../utils/accounts/periodBounds";
import {
  DEFAULT_REPORTING_CYCLE,
  loadReportingCycleFromStorage,
  resolvePeriodBounds,
  saveReportingCycleToStorage,
} from "../../utils/accounts/periodBounds";
import { formatPeriodLabel } from "../../utils/accounts/accountReportFormat";
import {
  ACCOUNT_STATISTICS_PERIOD_END_DAY_KEY,
  ACCOUNT_STATISTICS_PERIOD_END_MODE_KEY,
  ACCOUNT_STATISTICS_PERIOD_START_KEY,
} from "../../types";

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function formatEndLabel(cycle: ReportingCycle, t: (key: string) => string): string {
  if (cycle.endMode === "eom") {
    return t("reports.endOfMonth");
  }
  if (cycle.endDay < cycle.startDay) {
    return t("reports.endDayNextMonth", { day: cycle.endDay });
  }
  return t("reports.endDaySameMonth", { day: cycle.endDay });
}

interface ReportingCycleControlProps {
  year: number;
  month: number;
  cycle: ReportingCycle;
  onCycleChange: (cycle: ReportingCycle) => void;
}

export default function ReportingCycleControl({
  year,
  month,
  cycle,
  onCycleChange,
}: ReportingCycleControlProps) {
  const { t } = useTranslation();
  const user = useAppSelector((s) => s.auth.user);
  const [setSetting] = useSetSettingMutation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ReportingCycle>(cycle);

  useEffect(() => {
    if (!isEditing) {
      setDraft(cycle);
    }
  }, [cycle, isEditing]);

  const previewBounds = useMemo(
    () => resolvePeriodBounds(year, month, draft),
    [year, month, draft],
  );

  const committedBounds = useMemo(
    () => resolvePeriodBounds(year, month, cycle),
    [year, month, cycle],
  );

  const handleStartEdit = () => {
    setDraft(cycle);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraft(cycle);
    setIsEditing(false);
  };

  const handleSet = async () => {
    const next: ReportingCycle = {
      startDay: draft.startDay,
      endMode: draft.endMode,
      endDay: draft.endDay,
    };
    saveReportingCycleToStorage(user?.id, next);
    onCycleChange(next);
    setIsEditing(false);

    if (user?.role === "admin") {
      try {
        await Promise.all([
          setSetting({ key: ACCOUNT_STATISTICS_PERIOD_START_KEY, value: String(next.startDay) }).unwrap(),
          setSetting({ key: ACCOUNT_STATISTICS_PERIOD_END_MODE_KEY, value: next.endMode }).unwrap(),
          setSetting({ key: ACCOUNT_STATISTICS_PERIOD_END_DAY_KEY, value: String(next.endDay) }).unwrap(),
        ]);
      } catch {
        // localStorage already applied
      }
    }
  };

  if (!isEditing) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("reports.reportingCycle")}
            </div>
            <div className="mt-1 text-slate-800">
              <span className="font-medium">{t("reports.cycleStartDay", { day: cycle.startDay })}</span>
              <span className="mx-2 text-slate-400">→</span>
              <span className="font-medium">{formatEndLabel(cycle, t)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {t("reports.periodRange")}: {formatPeriodLabel(committedBounds.periodStartDate, committedBounds.periodEndDate)}
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartEdit}
            className="flex-shrink-0 rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:border-slate-300 hover:text-slate-900"
            aria-label={t("reports.editCycle")}
            title={t("reports.editCycle")}
          >
            <PencilIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-3 text-sm space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {t("reports.editReportingCycle")}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">{t("reports.cycleStartDayLabel")}</span>
          <input
            type="number"
            min={1}
            max={28}
            className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            value={draft.startDay}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 28) setDraft((prev) => ({ ...prev, startDay: v }));
            }}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-slate-600">{t("reports.cycleEndLabel")}</legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="periodEndMode"
                checked={draft.endMode === "eom"}
                onChange={() => setDraft((prev) => ({ ...prev, endMode: "eom" }))}
              />
              <span>{t("reports.endOfMonth")}</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="periodEndMode"
                checked={draft.endMode === "day"}
                onChange={() => setDraft((prev) => ({ ...prev, endMode: "day" }))}
              />
              <span>{t("reports.fixedEndDay")}</span>
            </label>
            {draft.endMode === "day" && (
              <input
                type="number"
                min={1}
                max={28}
                className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.endDay}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1 && v <= 28) setDraft((prev) => ({ ...prev, endDay: v }));
                }}
              />
            )}
          </div>
        </fieldset>
      </div>

      <p className="text-xs text-slate-600">
        {t("reports.cyclePreview")}:{" "}
        <span className="font-medium">
          {formatPeriodLabel(previewBounds.periodStartDate, previewBounds.periodEndDate)}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSet}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900"
        >
          {t("reports.setCycle")}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_REPORTING_CYCLE)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
        >
          {t("reports.resetCycleDefault")}
        </button>
      </div>
    </div>
  );
}
