import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SectionCard from "../components/common/SectionCard";
import ConfirmModal from "../components/common/ConfirmModal";
import {
  useCreateBackupMutation,
  useRestoreBackupMutation,
  useRestoreSafetyBackupMutation,
  useListSafetyBackupsQuery,
  useDeleteSafetyBackupMutation,
  useResetTableIdsMutation,
  useGetDbSchemaQuery,
  useExecuteQueryMutation,
  useClearAllNotificationsMutation,
  useClearDatabaseMutation,
  useGetSettingQuery,
  useGetPublicBrandingQuery,
  useUploadSiteFaviconMutation,
  useDeleteSiteFaviconMutation,
  useSetSettingMutation,
} from "../services/api";
import {
  APP_DISPLAY_NAME_EN_KEY,
  APP_DISPLAY_NAME_ZH_KEY,
  APP_DOCUMENT_TITLE_EN_KEY,
  APP_DOCUMENT_TITLE_ZH_KEY,
} from "../constants/appBrandSettings";

export default function SettingsPage() {
  const { t } = useTranslation();

  // Backup/Restore state
  const [backupType, setBackupType] = useState<"db" | "full">("db");
  const [restoreType, setRestoreType] = useState<"db" | "full">("db");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showSafetyRestoreConfirm, setShowSafetyRestoreConfirm] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [selectedSafetyFile, setSelectedSafetyFile] = useState<string | null>(null);
  const [showRestoreSuccess, setShowRestoreSuccess] = useState(false);
  const [restoreSuccessMessage, setRestoreSuccessMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  // Reset IDs state
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [resetResults, setResetResults] = useState<any[]>([]);

  // Debug state
  const [showSchema, setShowSchema] = useState(false);
  const [sqlQuery, setSqlQuery] = useState("");
  const [queryResults, setQueryResults] = useState<any>(null);

  // API hooks
  const [createBackup, { isLoading: isCreatingBackup }] = useCreateBackupMutation();
  const [restoreBackup, { isLoading: isRestoring }] = useRestoreBackupMutation();
  const [restoreSafetyBackup, { isLoading: isRestoringSafety }] = useRestoreSafetyBackupMutation();
  const [deleteSafetyBackup, { isLoading: isDeletingSafety }] = useDeleteSafetyBackupMutation();
  const [resetTableIds, { isLoading: isResetting }] = useResetTableIdsMutation();
  const { data: schemaData } = useGetDbSchemaQuery(undefined, { skip: !showSchema });
  const [executeQuery, { isLoading: isExecuting }] = useExecuteQueryMutation();
  const { data: safetyListData, isFetching: isLoadingSafetyList, refetch: refetchSafetyList } = useListSafetyBackupsQuery(undefined, { skip: !showSafetyModal });
  const [clearAllNotifications, { isLoading: isClearingNotifications }] = useClearAllNotificationsMutation();

  const { data: appNameEnData, isSuccess: appNameEnLoaded } = useGetSettingQuery(APP_DISPLAY_NAME_EN_KEY);
  const { data: appNameZhData, isSuccess: appNameZhLoaded } = useGetSettingQuery(APP_DISPLAY_NAME_ZH_KEY);
  const { data: docTitleEnData, isSuccess: docTitleEnLoaded } = useGetSettingQuery(APP_DOCUMENT_TITLE_EN_KEY);
  const { data: docTitleZhData, isSuccess: docTitleZhLoaded } = useGetSettingQuery(APP_DOCUMENT_TITLE_ZH_KEY);
  const { data: publicBranding } = useGetPublicBrandingQuery();
  const [appNameEnDraft, setAppNameEnDraft] = useState("");
  const [appNameZhDraft, setAppNameZhDraft] = useState("");
  const [docTitleEnDraft, setDocTitleEnDraft] = useState("");
  const [docTitleZhDraft, setDocTitleZhDraft] = useState("");
  const [setSetting, { isLoading: isSavingAppBrand }] = useSetSettingMutation();
  const [uploadSiteFavicon, { isLoading: isUploadingFavicon }] = useUploadSiteFaviconMutation();
  const [deleteSiteFavicon, { isLoading: isDeletingFavicon }] = useDeleteSiteFaviconMutation();

  useEffect(() => {
    if (appNameEnLoaded && appNameEnData) {
      setAppNameEnDraft(appNameEnData.value ?? "");
    }
  }, [appNameEnLoaded, appNameEnData]);

  useEffect(() => {
    if (appNameZhLoaded && appNameZhData) {
      setAppNameZhDraft(appNameZhData.value ?? "");
    }
  }, [appNameZhLoaded, appNameZhData]);

  useEffect(() => {
    if (docTitleEnLoaded && docTitleEnData) {
      setDocTitleEnDraft(docTitleEnData.value ?? "");
    }
  }, [docTitleEnLoaded, docTitleEnData]);

  useEffect(() => {
    if (docTitleZhLoaded && docTitleZhData) {
      setDocTitleZhDraft(docTitleZhData.value ?? "");
    }
  }, [docTitleZhLoaded, docTitleZhData]);

  const handleSaveAppBrand = async () => {
    try {
      await setSetting({
        key: APP_DISPLAY_NAME_EN_KEY,
        value: appNameEnDraft.trim(),
      }).unwrap();
      await setSetting({
        key: APP_DISPLAY_NAME_ZH_KEY,
        value: appNameZhDraft.trim(),
      }).unwrap();
      await setSetting({
        key: APP_DOCUMENT_TITLE_EN_KEY,
        value: docTitleEnDraft.trim(),
      }).unwrap();
      await setSetting({
        key: APP_DOCUMENT_TITLE_ZH_KEY,
        value: docTitleZhDraft.trim(),
      }).unwrap();
      alert(t("settings.appBranding.saveSuccess"));
    } catch (error: any) {
      console.error("Save app brand error:", error);
      alert(
        error?.data?.message ||
          error?.message ||
          t("settings.appBranding.saveError")
      );
    }
  };

  const handleFaviconFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (event.target) {
      event.target.value = "";
    }
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      await uploadSiteFavicon(formData).unwrap();
      alert(t("settings.appBranding.faviconUploadSuccess"));
    } catch (error: any) {
      console.error("Favicon upload error:", error);
      alert(
        error?.data?.message || error?.message || t("settings.appBranding.faviconUploadError")
      );
    }
  };

  const handleRemoveFavicon = async () => {
    const ok = window.confirm(t("settings.appBranding.faviconRemoveConfirm"));
    if (!ok) return;
    try {
      await deleteSiteFavicon().unwrap();
      alert(t("settings.appBranding.faviconRemoveSuccess"));
    } catch (error: any) {
      console.error("Favicon remove error:", error);
      alert(error?.data?.message || error?.message || t("settings.appBranding.faviconUploadError"));
    }
  };

  // Backup handlers
  const handleCreateBackup = async () => {
    try {
      const result = await createBackup({ includeFiles: backupType === "full" }).unwrap();
      
      // Create download link
      const blob = result as any;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupType === "full" 
        ? `backup-with-files-${new Date().toISOString().split("T")[0]}.zip`
        : `backup-${new Date().toISOString().split("T")[0]}.db`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setRestoreSuccessMessage(t("settings.backupRestore.backupSuccess"));
      setShowRestoreSuccess(true);
    } catch (error) {
      console.error("Backup error:", error);
      alert(t("settings.backupRestore.backupError"));
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    if (restoreType === "db") {
      if (!name.endsWith(".db")) {
        alert(t("settings.backupRestore.invalidDbFile"));
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    } else if (!name.endsWith(".zip")) {
      alert(t("settings.backupRestore.invalidZipFile"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setShowRestoreConfirm(true);
  };

  const handleRestoreConfirm = async () => {
    if (!selectedFile) return;

    // Close the confirmation modal immediately to prevent multiple clicks
    setShowRestoreConfirm(false);
    const fileToRestore = selectedFile;
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    try {
      const formData = new FormData();
      formData.append("file", fileToRestore);
      formData.append("includeFiles", restoreType === "full" ? "true" : "false");

      const result = await restoreBackup(formData).unwrap();
      setRestoreSuccessMessage(
        (result as any)?.message || t("settings.backupRestore.restoreSuccess")
      );
      setShowRestoreSuccess(true);
    } catch (error) {
      console.error("Restore error:", error);
      const message =
        (error as any)?.data?.message ||
        (error as any)?.message ||
        t("settings.backupRestore.restoreError");
      alert(message);
    }
  };

  const handleRestoreCancel = () => {
    setShowRestoreConfirm(false);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSafetyRestoreConfirm = async () => {
    if (!selectedSafetyFile) {
      alert(t("settings.backupRestore.selectSafetyBackup"));
      return;
    }

    // Close the confirmation modal immediately to prevent multiple clicks
    setShowSafetyRestoreConfirm(false);
    setShowSafetyModal(false);
    const fileToRestore = selectedSafetyFile;
    setSelectedSafetyFile(null);

    try {
      const result = await restoreSafetyBackup({ file: fileToRestore }).unwrap();
      setRestoreSuccessMessage(
        (result as any)?.message || t("settings.backupRestore.restoreSafetySuccess")
      );
      setShowRestoreSuccess(true);
    } catch (error: any) {
      console.error("Safety restore error:", error);
      const message =
        error?.data?.message || error?.message || t("settings.backupRestore.restoreSafetyError");
      alert(message);
    }
  };

  const handleDownloadSafety = (file: string) => {
    const url = `/api/settings/restore/safety/download?file=${encodeURIComponent(file)}`;
    window.open(url, "_blank");
  };

  const handleDeleteSafety = async (file: string) => {
    const confirmed = window.confirm(t("settings.backupRestore.deleteSafetyConfirm") || "Delete safety backup?");
    if (!confirmed) return;
    try {
      await deleteSafetyBackup({ file }).unwrap();
      await refetchSafetyList();
      if (selectedSafetyFile === file) {
        setSelectedSafetyFile(null);
      }
    } catch (error) {
      console.error("Delete safety backup error:", error);
      alert(t("settings.backupRestore.restoreSafetyError"));
    }
  };

  // Reset IDs handlers
  const handleTableToggle = (tableName: string) => {
    setSelectedTables((prev) =>
      prev.includes(tableName)
        ? prev.filter((t) => t !== tableName)
        : [...prev, tableName]
    );
  };

  const handleResetIds = async () => {
    if (selectedTables.length === 0) {
      alert(t("settings.resetIds.selectTables"));
      return;
    }

    try {
      const result = await resetTableIds({ tables: selectedTables }).unwrap();
      setResetResults(result.results);
      alert(t("settings.resetIds.resetSuccess"));
    } catch (error) {
      console.error("Reset IDs error:", error);
      alert(t("settings.resetIds.resetError"));
    }
  };

  // Debug handlers
  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) {
      return;
    }

    try {
      const result = await executeQuery({ sql: sqlQuery }).unwrap();
      setQueryResults(result);
    } catch (error: any) {
      console.error("Query error:", error);
      setQueryResults({
        success: false,
        message: error.data?.message || error.message || "Query failed",
      });
    }
  };

  // Clear database state
  const [showClearDbConfirm, setShowClearDbConfirm] = useState(false);
  const [clearDbPhrase, setClearDbPhrase] = useState("");
  const [clearDatabase, { isLoading: isClearingDb }] = useClearDatabaseMutation();

  const handleClearDatabase = async () => {
    if (clearDbPhrase !== "CLEAR DATABASE") {
      alert('Please type "CLEAR DATABASE" exactly to confirm.');
      return;
    }
    try {
      await clearDatabase({ confirmPhrase: clearDbPhrase }).unwrap();
      setShowClearDbConfirm(false);
      setClearDbPhrase("");
      alert("Database cleared and recreated successfully. Default admin user, currencies, and roles have been restored.");
    } catch (error: any) {
      console.error("Clear database error:", error);
      alert(error?.data?.message || error?.message || "Failed to clear database");
    }
  };

  // Notification handlers
  const handleClearAllNotifications = async () => {
    const confirmed = window.confirm(
      t("settings.notifications.clearAllConfirm") || 
      "Are you sure you want to clear ALL notifications for ALL users? This action cannot be undone."
    );
    if (!confirmed) return;

    try {
      const result = await clearAllNotifications().unwrap();
      alert(
        t("settings.notifications.clearAllSuccess", { count: result.count }) ||
        `Successfully cleared ${result.count} notifications`
      );
    } catch (error: any) {
      console.error("Clear notifications error:", error);
      alert(
        error?.data?.message || 
        error?.message || 
        t("settings.notifications.clearAllError") ||
        "Failed to clear notifications"
      );
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("integrations.title")}
        description={t("integrations.settingsDescription")}
      >
        <Link
          to="/settings/integrations"
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {t("integrations.manage")}
        </Link>
      </SectionCard>

      <SectionCard
        title={t("settings.appBranding.title")}
        description={t("settings.appBranding.description")}
      >
        <div className="space-y-8 max-w-xl">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {t("settings.appBranding.sidebarHeading")}
            </h3>
            <p className="text-sm text-slate-600">{t("settings.appBranding.sidebarDescription")}</p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("settings.appBranding.englishName")}
              </label>
              <input
                type="text"
                value={appNameEnDraft}
                onChange={(e) => setAppNameEnDraft(e.target.value)}
                placeholder={t("settings.appBranding.englishPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("settings.appBranding.chineseName")}
              </label>
              <input
                type="text"
                value={appNameZhDraft}
                onChange={(e) => setAppNameZhDraft(e.target.value)}
                placeholder={t("settings.appBranding.chinesePlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <p className="text-sm text-slate-600">{t("settings.appBranding.hint")}</p>
          </div>

          <div className="border-t border-slate-200 pt-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {t("settings.appBranding.documentTitleHeading")}
            </h3>
            <p className="text-sm text-slate-600">{t("settings.appBranding.documentTitleDescription")}</p>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("settings.appBranding.documentTitleEnglish")}
              </label>
              <input
                type="text"
                value={docTitleEnDraft}
                onChange={(e) => setDocTitleEnDraft(e.target.value)}
                placeholder={t("settings.appBranding.documentTitleEnglishPlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {t("settings.appBranding.documentTitleChinese")}
              </label>
              <input
                type="text"
                value={docTitleZhDraft}
                onChange={(e) => setDocTitleZhDraft(e.target.value)}
                placeholder={t("settings.appBranding.documentTitleChinesePlaceholder")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <p className="text-sm text-slate-600">{t("settings.appBranding.documentTitleHint")}</p>
          </div>

          <div className="border-t border-slate-200 pt-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              {t("settings.appBranding.faviconHeading")}
            </h3>
            <p className="text-sm text-slate-600">{t("settings.appBranding.faviconDescription")}</p>
            <div className="flex flex-wrap items-center gap-4">
              {publicBranding?.faviconUrl ? (
                <img
                  src={publicBranding.faviconUrl}
                  alt=""
                  className="h-10 w-10 rounded border border-slate-200 bg-white object-contain p-0.5"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                  —
                </div>
              )}
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.ico,image/x-icon"
                className="hidden"
                onChange={handleFaviconFile}
              />
              <button
                type="button"
                onClick={() => faviconInputRef.current?.click()}
                disabled={isUploadingFavicon}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {isUploadingFavicon ? t("common.saving") : t("settings.appBranding.uploadFavicon")}
              </button>
              {publicBranding?.faviconUrl ? (
                <button
                  type="button"
                  onClick={handleRemoveFavicon}
                  disabled={isDeletingFavicon}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  {isDeletingFavicon ? t("common.saving") : t("settings.appBranding.removeFavicon")}
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveAppBrand}
            disabled={isSavingAppBrand}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSavingAppBrand ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </SectionCard>

      {/* Backup & Restore Section */}
      <SectionCard
        title={t("settings.backupRestore.title")}
        description={t("settings.backupRestore.description")}
      >
        <div className="space-y-4">
          {/* Backup Options */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              {t("settings.backupRestore.backupOptions")}
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="backupType"
                  value="db"
                  checked={backupType === "db"}
                  onChange={(e) => setBackupType(e.target.value as "db")}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-slate-900">
                    {t("settings.backupRestore.databaseOnly")}
                  </div>
                  <div className="text-sm text-slate-600">
                    {t("settings.backupRestore.databaseOnlyDesc")}
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="backupType"
                  value="full"
                  checked={backupType === "full"}
                  onChange={(e) => setBackupType(e.target.value as "full")}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-slate-900">
                    {t("settings.backupRestore.databaseAndFiles")}
                  </div>
                  <div className="text-sm text-slate-600">
                    {t("settings.backupRestore.databaseAndFilesDesc")}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Backup Button */}
          <button
            onClick={handleCreateBackup}
            disabled={isCreatingBackup}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreatingBackup
              ? t("settings.backupRestore.creatingBackup")
              : t("settings.backupRestore.createBackup")}
          </button>

          <div className="border-t border-slate-200 pt-4">
            <div className="mb-3 text-sm font-medium text-slate-700">
              {t("settings.backupRestore.restoreOptions")}
            </div>
            <div className="mb-4 space-y-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="restoreType"
                  value="db"
                  checked={restoreType === "db"}
                  onChange={() => {
                    setRestoreType("db");
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-slate-900">
                    {t("settings.backupRestore.restoreDatabaseOnly")}
                  </div>
                  <div className="text-sm text-slate-500">
                    {t("settings.backupRestore.restoreDatabaseOnlyDesc")}
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="restoreType"
                  value="full"
                  checked={restoreType === "full"}
                  onChange={() => {
                    setRestoreType("full");
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-slate-900">
                    {t("settings.backupRestore.restoreDatabaseAndFiles")}
                  </div>
                  <div className="text-sm text-slate-500">
                    {t("settings.backupRestore.restoreDatabaseAndFilesDesc")}
                  </div>
                </div>
              </label>
            </div>
            <div className="mb-2 text-sm text-orange-600">
              {restoreType === "full"
                ? t("settings.backupRestore.restoreWarningFull")
                : t("settings.backupRestore.restoreWarningDb")}
            </div>
            {isRestoring ? (
              <div className="flex items-center gap-2 py-2 text-sm text-slate-600">
                <svg className="animate-spin h-4 w-4 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {restoreType === "full"
                  ? t("settings.backupRestore.restoringFull")
                  : t("settings.backupRestore.restoringDB")}
              </div>
            ) : (
              <input
                key={restoreType}
                ref={fileInputRef}
                type="file"
                accept={restoreType === "db" ? ".db" : ".zip"}
                onChange={handleFileSelect}
                className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
            )}
            <div className="mt-3">
              <button
                onClick={() => {
                  setShowSafetyModal(true);
                  refetchSafetyList();
                }}
                disabled={isRestoringSafety || isDeletingSafety}
                className="rounded-lg bg-slate-600 px-4 py-2 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {isRestoringSafety
                  ? t("settings.backupRestore.restoringSafety")
                  : t("settings.backupRestore.restoreSafetyList")}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Reset IDs Section */}
      <SectionCard
        title={t("settings.resetIds.title")}
        description={t("settings.resetIds.description")}
      >
        <div className="space-y-4">
          <div className="text-sm text-orange-600">
            {t("settings.resetIds.resetWarning")}
          </div>

          {/* Table Selection */}
          <div className="space-y-2">
            {[
              "orders",
              "expenses",
              "internal_transfers",
              "customers",
              "accounts",
              "users",
              "tags",
              "currencies",
            ].map((tableName) => (
              <label
                key={tableName}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedTables.includes(tableName)}
                  onChange={() => handleTableToggle(tableName)}
                />
                <div className="flex-1">
                  <div className="font-medium text-slate-900">
                    {tableName === "orders" && t("settings.resetIds.orders")}
                    {tableName === "expenses" && t("settings.resetIds.expenses")}
                    {tableName === "internal_transfers" && t("settings.resetIds.transfers")}
                    {tableName === "customers" && t("settings.resetIds.customers")}
                    {tableName === "accounts" && t("settings.resetIds.accounts")}
                    {tableName === "users" && t("settings.resetIds.users")}
                    {tableName === "tags" && t("settings.resetIds.tags")}
                    {tableName === "currencies" && t("settings.resetIds.currencies")}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Reset Results */}
          {resetResults.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="mb-2 text-sm font-medium text-slate-700">
                {t("settings.resetIds.status")}
              </div>
              <div className="space-y-2">
                {resetResults.map((result, index) => (
                  <div key={index} className="text-sm">
                    <span className="font-medium">{result.table}:</span>{" "}
                    <span
                      className={result.success ? "text-green-600" : "text-red-600"}
                    >
                      {result.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset Button */}
          <button
            onClick={handleResetIds}
            disabled={isResetting || selectedTables.length === 0}
            className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {isResetting
              ? t("settings.resetIds.resetting")
              : t("settings.resetIds.resetSelected")}
          </button>
        </div>
      </SectionCard>

      {/* Notifications Management Section */}
      <SectionCard
        title={t("settings.notifications.title") || "Notifications Management"}
        description={t("settings.notifications.description") || "Manage system notifications"}
      >
        <div className="space-y-4">
          <div className="text-sm text-orange-600">
            {t("settings.notifications.clearAllWarning") || 
            "⚠️ Clearing notifications will permanently delete all notifications for all users. This action cannot be undone."}
          </div>
          <button
            onClick={handleClearAllNotifications}
            disabled={isClearingNotifications}
            className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isClearingNotifications
              ? t("settings.notifications.clearing") || "Clearing Notifications..."
              : t("settings.notifications.clearAll") || "Clear All Notifications"}
          </button>
        </div>
      </SectionCard>

      {/* Database Debug Section */}
      <SectionCard
        title={t("settings.debug.title")}
        description={t("settings.debug.description")}
      >
        <div className="space-y-4">
          {/* Schema Viewer */}
          <div>
            <button
              onClick={() => setShowSchema(!showSchema)}
              className="rounded-lg bg-slate-600 px-4 py-2 font-semibold text-white hover:bg-slate-700"
            >
              {showSchema
                ? t("settings.debug.hideSchema")
                : t("settings.debug.viewSchema")}
            </button>
          </div>

          {showSchema && schemaData && (
            <div className="space-y-4 rounded-lg bg-slate-50 p-4">
              {schemaData.schema.map((table) => (
                <div key={table.name} className="rounded-lg bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">{table.name}</h3>
                    <span className="text-sm text-slate-600">
                      {table.rowCount} {t("settings.debug.rowCount").toLowerCase()}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="px-2 py-1 text-left font-medium text-slate-700">
                            {t("settings.debug.columnName")}
                          </th>
                          <th className="px-2 py-1 text-left font-medium text-slate-700">
                            {t("settings.debug.type")}
                          </th>
                          <th className="px-2 py-1 text-left font-medium text-slate-700">
                            {t("settings.debug.nullable")}
                          </th>
                          <th className="px-2 py-1 text-left font-medium text-slate-700">
                            {t("settings.debug.primaryKey")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.columns.map((col) => (
                          <tr key={col.name} className="border-b border-slate-100">
                            <td className="px-2 py-1 font-mono text-slate-900">
                              {col.name}
                            </td>
                            <td className="px-2 py-1 text-slate-600">{col.type}</td>
                            <td className="px-2 py-1 text-slate-600">
                              {col.notNull ? "No" : "Yes"}
                            </td>
                            <td className="px-2 py-1 text-slate-600">
                              {col.primaryKey ? "Yes" : "No"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Query Executor */}
          <div className="border-t border-slate-200 pt-4">
            <div className="mb-2 text-sm font-medium text-slate-700">
              {t("settings.debug.queryExecutor")}
            </div>
            <div className="mb-2 text-xs text-slate-600">
              {t("settings.debug.onlySelectAllowed")}
            </div>
            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              placeholder={t("settings.debug.queryPlaceholder")}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={handleExecuteQuery}
              disabled={isExecuting || !sqlQuery.trim()}
              className="mt-2 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {isExecuting
                ? t("settings.debug.executing")
                : t("settings.debug.executeQuery")}
            </button>
          </div>

          {/* Query Results */}
          {queryResults && (
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="mb-2 text-sm font-medium text-slate-700">
                {t("settings.debug.queryResults")}
              </div>
              {queryResults.success ? (
                <>
                  <div className="mb-2 text-sm text-green-600">
                    {t("settings.debug.querySuccess", {
                      count: queryResults.rowCount || 0,
                    })}
                  </div>
                  {queryResults.results && queryResults.results.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            {Object.keys(queryResults.results[0]).map((key) => (
                              <th
                                key={key}
                                className="px-2 py-1 text-left font-medium text-slate-700"
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResults.results.map((row: any, index: number) => (
                            <tr key={index} className="border-b border-slate-100">
                              {Object.values(row).map((value: any, colIndex: number) => (
                                <td
                                  key={colIndex}
                                  className="px-2 py-1 font-mono text-slate-900"
                                >
                                  {value === null
                                    ? "NULL"
                                    : typeof value === "object"
                                    ? JSON.stringify(value)
                                    : String(value)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">
                      {t("settings.debug.noResults")}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-red-600">
                  {t("settings.debug.queryError", {
                    message: queryResults.message || "Unknown error",
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Danger Zone — Clear Database */}
      <SectionCard
        title="Danger Zone"
        description="Irreversible actions that affect all data in the system."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="mb-1 text-sm font-semibold text-red-700">Clear Entire Database</div>
            <div className="mb-3 text-sm text-red-600">
              This will permanently delete <strong>all orders, customers, accounts, transfers, expenses, users, currencies, tags, and every other record</strong>. The database will be rebuilt from scratch with only the default admin user, default currencies, and default roles. This action <strong>cannot be undone</strong>.
            </div>
            {!showClearDbConfirm ? (
              <button
                onClick={() => setShowClearDbConfirm(true)}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700"
              >
                Clear Database
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-medium text-red-700">
                  Type <span className="font-mono font-bold">CLEAR DATABASE</span> to confirm:
                </div>
                <input
                  type="text"
                  value={clearDbPhrase}
                  onChange={(e) => setClearDbPhrase(e.target.value)}
                  placeholder="CLEAR DATABASE"
                  className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm font-mono focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleClearDatabase}
                    disabled={isClearingDb || clearDbPhrase !== "CLEAR DATABASE"}
                    className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isClearingDb ? "Clearing..." : "Confirm Clear Database"}
                  </button>
                  <button
                    onClick={() => { setShowClearDbConfirm(false); setClearDbPhrase(""); }}
                    className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Restore Confirmation Modal */}
      <ConfirmModal
        isOpen={showRestoreConfirm}
        message={
          restoreType === "full"
            ? t("settings.backupRestore.restoreConfirmFull")
            : t("settings.backupRestore.restoreConfirmDb")
        }
        onConfirm={handleRestoreConfirm}
        onCancel={handleRestoreCancel}
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
        type="warning"
      />
      <ConfirmModal
        isOpen={showSafetyRestoreConfirm}
        message={t("settings.backupRestore.restoreSafetyConfirm")}
        onConfirm={handleSafetyRestoreConfirm}
        onCancel={() => setShowSafetyRestoreConfirm(false)}
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
        type="warning"
      />
      <ConfirmModal
        isOpen={showRestoreSuccess}
        message={restoreSuccessMessage || t("settings.backupRestore.restoreSuccess")}
        onConfirm={() => setShowRestoreSuccess(false)}
        onCancel={() => setShowRestoreSuccess(false)}
        confirmText={t("common.ok")}
        cancelText={t("common.cancel")}
        type="info"
      />
      {showSafetyModal && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => setShowSafetyModal(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {t("settings.backupRestore.restoreSafetyListTitle")}
              </h3>
              <button
                onClick={() => setShowSafetyModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="mb-4 text-sm text-slate-600">
              {t("settings.backupRestore.restoreSafetyListDesc")}
            </div>
            <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
              {isLoadingSafetyList ? (
                <div className="p-3 text-sm text-slate-600">{t("common.loading")}</div>
              ) : safetyListData?.backups?.length ? (
                <div className="divide-y divide-slate-200">
                  {safetyListData.backups.map((b) => (
                    <label
                      key={b.file}
                      className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="safety-backup"
                        checked={selectedSafetyFile === b.file}
                        onChange={() => setSelectedSafetyFile(b.file)}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-slate-900">{b.file}</div>
                        <div className="text-xs text-slate-600">
                          {new Date(b.modifiedAt).toLocaleString()} • {(b.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadSafety(b.file);
                          }}
                          className="rounded border border-slate-200 p-2 text-slate-700 hover:bg-slate-100"
                          title={t("settings.backupRestore.downloadSafety") || "Download safety backup"}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M8 12l4 4m0 0l4-4m-4 4V4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSafety(b.file);
                          }}
                          className="rounded border border-slate-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title={t("settings.backupRestore.deleteSafety") || "Delete safety backup"}
                          disabled={isDeletingSafety}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0h8l-.867-2.6A1 1 0 0015.184 3H8.816a1 1 0 00-.949.658L7 7z" />
                          </svg>
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-sm text-slate-600">
                  {t("settings.backupRestore.noSafetyBackups")}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSafetyModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => setShowSafetyRestoreConfirm(true)}
                disabled={!selectedSafetyFile || isRestoringSafety}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {t("settings.backupRestore.restoreSafetySelected")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
