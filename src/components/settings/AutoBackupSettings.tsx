import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ConfirmModal from "../common/ConfirmModal";
import {
  useDeleteAutoBackupMutation,
  useGetAutoBackupSettingsQuery,
  useListAutoBackupsQuery,
  useRestoreAutoBackupMutation,
  useSaveAutoBackupSettingsMutation,
} from "../../services/api";

type Frequency = "hourly" | "daily" | "weekly" | "monthly";

type AutoBackupSettings = {
  enabled: boolean;
  frequency: Frequency;
  intervalHours: number;
  time: string;
  timezone: string;
  weekday: number;
  dayOfMonth: number;
  endOfMonth: boolean;
  includeFiles: boolean;
  retentionCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "success" | "error" | null;
  lastError: string | null;
};

type Draft = {
  enabled: boolean;
  frequency: Frequency;
  intervalHours: string;
  time: string;
  timezone: string;
  weekday: number;
  dayOfMonth: string;
  endOfMonth: boolean;
  includeFiles: boolean;
  retentionCount: string;
};

const fieldClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;
const weekdayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function toDraft(settings: AutoBackupSettings, timezone: string): Draft {
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    intervalHours: String(settings.intervalHours),
    time: settings.time,
    timezone,
    weekday: settings.weekday,
    dayOfMonth: String(settings.dayOfMonth),
    endOfMonth: settings.endOfMonth,
    includeFiles: settings.includeFiles,
    retentionCount: String(settings.retentionCount),
  };
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function formatWhen(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export default function AutoBackupSettings() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetAutoBackupSettingsQuery(undefined, { pollingInterval: 60000 });
  const { data: listData, refetch: refetchList } = useListAutoBackupsQuery();
  const [saveSettings, { isLoading: isSaving }] = useSaveAutoBackupSettingsMutation();
  const [deleteBackup, { isLoading: isDeleting }] = useDeleteAutoBackupMutation();
  const [restoreBackup, { isLoading: isRestoring }] = useRestoreAutoBackupMutation();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [restoreFile, setRestoreFile] = useState<{ file: string; includeFiles: boolean } | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const timeZones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);

  const saved = data?.settings;

  useEffect(() => {
    if (!data || draft) return;
    const timezone = data.saved ? data.settings.timezone : browserTimeZone();
    setDraft(toDraft(data.settings, timezone));
  }, [data, draft]);

  useEffect(() => {
    if (!saved?.lastRunAt) return;
    refetchList();
  }, [saved?.lastRunAt, refetchList]);

  const zoneOptions = useMemo(() => {
    if (!draft || timeZones.includes(draft.timezone)) return timeZones;
    return [draft.timezone, ...timeZones];
  }, [draft, timeZones]);

  const update = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.time) {
      alert(t("settings.backupRestore.timeRequired"));
      return;
    }
    const intervalHours = Number(draft.intervalHours);
    if (draft.frequency === "hourly" && (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 23)) {
      alert(t("settings.backupRestore.intervalInvalid"));
      return;
    }
    const dayOfMonth = Number(draft.dayOfMonth);
    if (
      draft.frequency === "monthly" &&
      !draft.endOfMonth &&
      (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 27)
    ) {
      alert(t("settings.backupRestore.dayInvalid"));
      return;
    }
    const retentionCount = Number(draft.retentionCount);
    if (!Number.isInteger(retentionCount) || retentionCount < 1 || retentionCount > 1000) {
      alert(t("settings.backupRestore.retentionInvalid"));
      return;
    }

    try {
      const result = await saveSettings({
        enabled: draft.enabled,
        frequency: draft.frequency,
        intervalHours: Number.isInteger(intervalHours) ? intervalHours : 1,
        time: draft.time,
        timezone: draft.timezone,
        weekday: draft.weekday,
        dayOfMonth: Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 27 ? dayOfMonth : 1,
        endOfMonth: draft.endOfMonth,
        includeFiles: draft.includeFiles,
        retentionCount,
      }).unwrap();
      setDraft(toDraft(result.settings, result.settings.timezone));
      setSuccessMessage(t("settings.backupRestore.saved"));
    } catch (error: any) {
      alert(error?.data?.message || error?.message || t("settings.backupRestore.saveError"));
    }
  };

  const handleDownload = (file: string) => {
    window.open(`/api/settings/auto-backup/files/download?file=${encodeURIComponent(file)}`, "_blank");
  };

  const handleDelete = async (file: string) => {
    if (!window.confirm(t("settings.backupRestore.deleteAutoConfirm"))) return;
    try {
      await deleteBackup({ file }).unwrap();
      await refetchList();
    } catch (error: any) {
      alert(error?.data?.message || error?.message || t("settings.backupRestore.deleteAutoError"));
    }
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile) return;
    const file = restoreFile.file;
    setRestoreFile(null);
    setShowManage(false);
    try {
      const result = await restoreBackup({ file }).unwrap();
      setSuccessMessage(result.message || t("settings.backupRestore.restoreSuccess"));
      await refetchList();
    } catch (error: any) {
      alert(error?.data?.message || error?.message || t("settings.backupRestore.restoreError"));
    }
  };

  if (isLoading || !draft) {
    return (
      <div className="border-t border-slate-200 pt-4 text-sm text-slate-600">
        {isError ? t("settings.backupRestore.loadError") : t("common.loading")}
      </div>
    );
  }

  const displayZone = saved?.timezone || draft.timezone;

  return (
    <div className="space-y-4 border-t border-slate-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{t("settings.backupRestore.autoTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("settings.backupRestore.autoDescription")}</p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        {t("settings.backupRestore.enabled")}
      </label>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("settings.backupRestore.includeLabel")}</div>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="autoBackupInclude"
              checked={!draft.includeFiles}
              onChange={() => update({ includeFiles: false })}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-slate-900">{t("settings.backupRestore.databaseOnly")}</div>
              <div className="text-sm text-slate-600">{t("settings.backupRestore.databaseOnlyDesc")}</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="autoBackupInclude"
              checked={draft.includeFiles}
              onChange={() => update({ includeFiles: true })}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-slate-900">{t("settings.backupRestore.databaseAndFiles")}</div>
              <div className="text-sm text-slate-600">{t("settings.backupRestore.databaseAndFilesDesc")}</div>
            </div>
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t("settings.backupRestore.frequency")}</span>
          <select
            value={draft.frequency}
            onChange={(event) => update({ frequency: event.target.value as Frequency })}
            className={fieldClass}
          >
            <option value="hourly">{t("settings.backupRestore.hourly")}</option>
            <option value="daily">{t("settings.backupRestore.daily")}</option>
            <option value="weekly">{t("settings.backupRestore.weekly")}</option>
            <option value="monthly">{t("settings.backupRestore.monthly")}</option>
          </select>
        </label>

        {draft.frequency === "hourly" && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("settings.backupRestore.everyHours")}</span>
            <input
              type="number"
              min={1}
              max={23}
              step={1}
              value={draft.intervalHours}
              onChange={(event) => update({ intervalHours: event.target.value })}
              className={fieldClass}
            />
          </label>
        )}

        {draft.frequency === "weekly" && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t("settings.backupRestore.weekday")}</span>
            <select
              value={draft.weekday}
              onChange={(event) => update({ weekday: Number(event.target.value) })}
              className={fieldClass}
            >
              {weekdays.map((day, index) => (
                <option key={day} value={day}>
                  {t(`settings.backupRestore.${weekdayKeys[index]}`)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            {draft.frequency === "hourly" ? t("settings.backupRestore.startTime") : t("settings.backupRestore.time")}
          </span>
          <input
            type="time"
            value={draft.time}
            onChange={(event) => update({ time: event.target.value })}
            className={fieldClass}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t("settings.backupRestore.timezone")}</span>
          <select
            value={draft.timezone}
            onChange={(event) => update({ timezone: event.target.value })}
            className={fieldClass}
          >
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t("settings.backupRestore.retention")}</span>
          <input
            type="number"
            min={1}
            max={1000}
            step={1}
            value={draft.retentionCount}
            onChange={(event) => update({ retentionCount: event.target.value })}
            className={fieldClass}
          />
        </label>
      </div>

      {draft.frequency === "hourly" && (
        <p className="text-sm text-slate-600">{t("settings.backupRestore.everyHoursHint")}</p>
      )}

      {draft.frequency === "monthly" && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700">{t("settings.backupRestore.dayOfMonth")}</div>
          <label className="flex items-center gap-3 text-sm text-slate-800">
            <input
              type="radio"
              name="autoBackupMonthMode"
              checked={!draft.endOfMonth}
              onChange={() => update({ endOfMonth: false })}
            />
            <span>{t("settings.backupRestore.specificDay")}</span>
            {!draft.endOfMonth && (
              <input
                type="number"
                min={1}
                max={27}
                step={1}
                value={draft.dayOfMonth}
                onChange={(event) => update({ dayOfMonth: event.target.value })}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            )}
          </label>
          <label className="flex items-center gap-3 text-sm text-slate-800">
            <input
              type="radio"
              name="autoBackupMonthMode"
              checked={draft.endOfMonth}
              onChange={() => update({ endOfMonth: true })}
            />
            {t("settings.backupRestore.endOfMonth")}
          </label>
          {draft.endOfMonth && (
            <p className="text-sm text-slate-600">{t("settings.backupRestore.endOfMonthHint")}</p>
          )}
        </div>
      )}

      <p className="text-sm text-slate-600">{t("settings.backupRestore.retentionHint")}</p>

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isSaving ? t("common.saving") : t("settings.backupRestore.saveSchedule")}
      </button>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {saved?.enabled ? (
          <div>
            {t("settings.backupRestore.nextRun")}: {formatWhen(saved.nextRunAt, displayZone) || t("settings.backupRestore.neverRun")}
          </div>
        ) : (
          <div>{t("settings.backupRestore.disabledStatus")}</div>
        )}
        <div className="mt-1">
          {t("settings.backupRestore.lastRun")}: {saved?.lastRunAt ? formatWhen(saved.lastRunAt, displayZone) : t("settings.backupRestore.neverRun")}
          {saved?.lastStatus === "success" ? ` · ${t("settings.backupRestore.lastStatusSuccess")}` : ""}
          {saved?.lastStatus === "error" ? ` · ${t("settings.backupRestore.lastStatusError")}` : ""}
        </div>
        {saved?.lastStatus === "error" && saved.lastError && (
          <div className="mt-1 text-red-600">{saved.lastError}</div>
        )}
        <div className="mt-1 text-slate-500">
          {t("settings.backupRestore.backupCount", {
            count: listData?.backups.length ?? 0,
            max: saved?.retentionCount ?? draft.retentionCount,
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setShowManage(true);
          refetchList();
        }}
        className="rounded-lg bg-slate-600 px-4 py-2 font-semibold text-white hover:bg-slate-700"
      >
        {t("settings.backupRestore.manage")}
      </button>

      {showManage && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => setShowManage(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">{t("settings.backupRestore.manageTitle")}</h3>
              <button type="button" onClick={() => setShowManage(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-slate-600">{t("settings.backupRestore.manageDesc")}</p>
            <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
              {listData?.backups.length ? (
                <div className="divide-y divide-slate-200">
                  {listData.backups.map((backup) => (
                    <div key={backup.file} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">
                          {formatWhen(backup.createdAt, displayZone)}
                        </div>
                        <div className="text-xs text-slate-600">
                          {backup.includeFiles
                            ? t("settings.backupRestore.databaseAndFiles")
                            : t("settings.backupRestore.databaseOnly")}
                          {" · "}
                          {formatBytes(backup.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(backup.file)}
                        className="rounded border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {t("settings.backupRestore.downloadAuto")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRestoreFile({ file: backup.file, includeFiles: backup.includeFiles })}
                        disabled={isRestoring}
                        className="rounded border border-orange-200 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                      >
                        {t("settings.backupRestore.restoreAuto")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(backup.file)}
                        disabled={isDeleting}
                        className="rounded border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t("settings.backupRestore.deleteAuto")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-sm text-slate-600">{t("settings.backupRestore.noAutoBackups")}</div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowManage(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(restoreFile)}
        message={
          restoreFile?.includeFiles
            ? t("settings.backupRestore.restoreAutoConfirmFull")
            : t("settings.backupRestore.restoreAutoConfirmDb")
        }
        onConfirm={handleRestoreConfirm}
        onCancel={() => setRestoreFile(null)}
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
        type="warning"
      />
      <ConfirmModal
        isOpen={Boolean(successMessage)}
        message={successMessage}
        onConfirm={() => setSuccessMessage("")}
        onCancel={() => setSuccessMessage("")}
        confirmText={t("common.ok")}
        cancelText={t("common.close")}
        type="info"
      />
    </div>
  );
}
