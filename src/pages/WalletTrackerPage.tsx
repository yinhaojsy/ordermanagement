import { useState, type FormEvent, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../components/common/Badge";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import {
  useGetWalletsQuery,
  useGetWalletsSummaryQuery,
  useCreateWalletMutation,
  useUpdateWalletMutation,
  useDeleteWalletMutation,
  useRefreshWalletBalanceMutation,
  useGetWalletTransactionsQuery,
  useRefreshAllWalletsMutation,
  useGetPollingStatusQuery,
  useStopWalletPollingMutation,
  useStartWalletPollingMutation,
  useGetAmlStatusQuery,
  useGetWalletAmlSummariesQuery,
  useGetWalletTransactionAmlSummariesQuery,
  useGetWalletAmlHistoryQuery,
  useCheckWalletAddressAmlMutation,
  useInvestigateWalletAddressAmlMutation,
  useCheckWalletTransactionAmlMutation,
  useUpdateWalletAmlAutoScreenTxMutation,
} from "../services/api";
import { formatDate } from "../utils/format";
import { useAppSelector } from "../app/hooks";
import { hasActionPermission } from "../utils/permissions";
import AmlRiskBadge from "../components/aml/AmlRiskBadge";
import AmlReportModal from "../components/aml/AmlReportModal";
import WalletBlacklistBadges from "../components/wallets/WalletBlacklistBadges";
import type { TronWallet } from "../types/wallets";
import type { AmlCheck } from "../types/integrations";

function asAmlCheckList(value: unknown): AmlCheck[] {
  return Array.isArray(value) ? value : [];
}

function amlReportTabForCheck(
  check: AmlCheck,
  preferred: "screen" | "investigate" = "screen",
): "screen" | "investigate" {
  if (check.checkType === "address_investigation") return "investigate";
  if (check.checkType === "address") return "screen";
  return preferred;
}

// Helper function to format currency
const formatCurrency = (amount: number) => {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
};

// Helper function to truncate wallet address
const truncateAddress = (address: string) => {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

function isWalletAutoScreenTxEnabled(wallet: Pick<TronWallet, "amlAutoScreenTx">) {
  if (typeof wallet.amlAutoScreenTx === "boolean") return wallet.amlAutoScreenTx;
  return wallet.amlAutoScreenTx !== 0;
}

function AmlAutoScreenToggle({
  enabled,
  disabled,
  onToggle,
  title,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? "bg-blue-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function WalletTrackerPage() {
  const { t } = useTranslation();
  const authUser = useAppSelector((s) => s.auth.user);
  
  const { data: wallets = [], isLoading: isLoadingWallets, refetch: refetchWallets } = useGetWalletsQuery();
  const { data: summary = [], isLoading: isLoadingSummary } = useGetWalletsSummaryQuery();
  const { data: pollingStatus, refetch: refetchPollingStatus } = useGetPollingStatusQuery();
  const [createWallet, { isLoading: isCreating }] = useCreateWalletMutation();
  const [updateWallet] = useUpdateWalletMutation();
  const [deleteWallet, { isLoading: isDeleting }] = useDeleteWalletMutation();
  const [refreshWalletBalance] = useRefreshWalletBalanceMutation();
  const [refreshAllWallets, { isLoading: isRefreshingAll }] = useRefreshAllWalletsMutation();
  const [stopPolling, { isLoading: isStoppingPolling }] = useStopWalletPollingMutation();
  const [startPolling, { isLoading: isStartingPolling }] = useStartWalletPollingMutation();

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    message: string;
    type?: "error" | "warning" | "info" | "success";
  }>({
    isOpen: false,
    message: "",
    type: "error",
  });

  const [addWalletModalOpen, setAddWalletModalOpen] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState<number | null>(null);
  const [transactionsModalWalletId, setTransactionsModalWalletId] = useState<number | null>(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    walletId: number | null;
    walletName: string;
  }>({
    isOpen: false,
    walletId: null,
    walletName: "",
  });

  const [form, setForm] = useState({
    nickname: "",
    walletAddress: "",
    remarks: "",
  });

  const { data: amlStatus } = useGetAmlStatusQuery();
  const { data: amlSummariesData, refetch: refetchAmlSummaries } = useGetWalletAmlSummariesQuery(undefined, {
    skip: !amlStatus?.enabled,
  });
  const { data: txAmlSummariesData, refetch: refetchTxAmlSummaries } = useGetWalletTransactionAmlSummariesQuery(
    transactionsModalWalletId || 0,
    { skip: !transactionsModalWalletId || !amlStatus?.enabled },
  );
  const { data: walletAmlHistoryData, refetch: refetchWalletAmlHistory } = useGetWalletAmlHistoryQuery(
    transactionsModalWalletId || 0,
    { skip: !transactionsModalWalletId || !amlStatus?.enabled },
  );
  const [checkAddressAml] = useCheckWalletAddressAmlMutation();
  const [investigateAddressAml] = useInvestigateWalletAddressAmlMutation();
  const [checkTransactionAml] = useCheckWalletTransactionAmlMutation();
  const [updateWalletAmlAutoScreenTx] = useUpdateWalletAmlAutoScreenTxMutation();

  const [amlReportCheck, setAmlReportCheck] = useState<AmlCheck | null>(null);
  const [amlReportWallet, setAmlReportWallet] = useState<TronWallet | null>(null);
  const [amlReportSubtitle, setAmlReportSubtitle] = useState("");
  const [amlReportInitialTab, setAmlReportInitialTab] = useState<"screen" | "investigate">("screen");
  const [showAmlHistory, setShowAmlHistory] = useState(false);
  const [amlActionLoading, setAmlActionLoading] = useState<string | null>(null);
  const [autoScreenToggleId, setAutoScreenToggleId] = useState<number | null>(null);

  const walletAmlHistoryItems = useMemo(
    () => asAmlCheckList(walletAmlHistoryData?.history),
    [walletAmlHistoryData],
  );

  const resetForm = () => {
    setForm({
      nickname: "",
      walletAddress: "",
      remarks: "",
    });
  };

  const handleOpenAddModal = () => {
    resetForm();
    setEditingWalletId(null);
    setAddWalletModalOpen(true);
  };

  const handleOpenEditModal = (walletId: number) => {
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;
    
    setForm({
      nickname: wallet.nickname,
      walletAddress: wallet.walletAddress,
      remarks: wallet.remarks || "",
    });
    setEditingWalletId(walletId);
    setAddWalletModalOpen(true);
  };

  const handleCloseModal = () => {
    setAddWalletModalOpen(false);
    setEditingWalletId(null);
    resetForm();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.nickname || !form.walletAddress) return;

    try {
      if (editingWalletId) {
        await updateWallet({
          id: editingWalletId,
          nickname: form.nickname,
          remarks: form.remarks,
        }).unwrap();
        setAlertModal({
          isOpen: true,
          message: t("wallets.walletUpdated") || "Wallet updated successfully",
          type: "success",
        });
      } else {
        await createWallet({
          nickname: form.nickname,
          walletAddress: form.walletAddress,
          remarks: form.remarks,
        }).unwrap();
        setAlertModal({
          isOpen: true,
          message: t("wallets.walletCreated") || "Wallet added successfully",
          type: "success",
        });
      }
      handleCloseModal();
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("wallets.errorSaving") || "Error saving wallet",
        type: "error",
      });
    }
  };

  const handleDeleteClick = (walletId: number) => {
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;

    setDeleteConfirmModal({
      isOpen: true,
      walletId,
      walletName: wallet.nickname,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmModal.walletId) return;

    try {
      await deleteWallet(deleteConfirmModal.walletId).unwrap();
      setAlertModal({
        isOpen: true,
        message: t("wallets.walletDeleted") || "Wallet deleted successfully",
        type: "success",
      });
      setDeleteConfirmModal({ isOpen: false, walletId: null, walletName: "" });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("wallets.errorDeleting") || "Error deleting wallet",
        type: "error",
      });
    }
  };

  const handleRefreshBalance = async (walletId: number) => {
    try {
      await refreshWalletBalance(walletId).unwrap();
      setAlertModal({
        isOpen: true,
        message: t("wallets.balanceRefreshed") || "Balance refreshed successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("wallets.errorRefreshing") || "Error refreshing balance",
        type: "error",
      });
    }
  };

  const handleRefreshAll = async () => {
    try {
      const result = await refreshAllWallets().unwrap();
      const successCount = result.results.filter((r: any) => r.success).length;
      const failCount = result.results.filter((r: any) => !r.success).length;
      
      setAlertModal({
        isOpen: true,
        message: `Refreshed ${successCount} wallet(s) successfully${failCount > 0 ? `, ${failCount} failed` : ""}`,
        type: failCount > 0 ? "warning" : "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("wallets.errorRefreshingAll") || "Error refreshing wallets",
        type: "error",
      });
    }
  };

  const handleStopPolling = async () => {
    try {
      const result = await stopPolling().unwrap();
      await refetchPollingStatus();
      setAlertModal({
        isOpen: true,
        message: result.message || "Polling stopped successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || "Error stopping polling",
        type: "error",
      });
    }
  };

  const handleStartPolling = async () => {
    try {
      const result = await startPolling().unwrap();
      await refetchPollingStatus();
      setAlertModal({
        isOpen: true,
        message: result.message || "Polling started successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || "Error starting polling",
        type: "error",
      });
    }
  };

  const handleOpenTransactions = (walletId: number) => {
    setTransactionsModalWalletId(walletId);
  };

  const selectedWallet = wallets.find((w) => w.id === transactionsModalWalletId);
  const { data: transactions = [], refetch: refetchTransactions } = useGetWalletTransactionsQuery(
    { id: transactionsModalWalletId || 0, refresh: false },
    { skip: !transactionsModalWalletId }
  );

  const handleRefreshTransactions = async () => {
    if (!transactionsModalWalletId) return;
    try {
      await refetchTransactions();
      if (amlStatus?.enabled) {
        await refetchTxAmlSummaries();
      }
      setAlertModal({
        isOpen: true,
        message: t("wallets.transactionsRefreshed") || "Transactions refreshed successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("wallets.errorRefreshingTransactions") || "Error refreshing transactions",
        type: "error",
      });
    }
  };

  const showAmlError = (error: any) => {
    setAlertModal({
      isOpen: true,
      message: error?.data?.message || t("aml.actionFailed"),
      type: "error",
    });
  };

  const openAmlReport = (
    check: AmlCheck,
    subtitle: string,
    tab: "screen" | "investigate" = "screen",
    wallet?: TronWallet | null,
  ) => {
    setAmlReportInitialTab(amlReportTabForCheck(check, tab));
    setAmlReportCheck(check);
    setAmlReportSubtitle(subtitle);
    setAmlReportWallet(wallet ?? wallets.find((w) => w.id === check.walletId) ?? null);
  };

  const runAmlAction = async (
    key: string,
    action: () => Promise<{ check: AmlCheck }>,
    subtitle: string,
    tab: "screen" | "investigate",
  ) => {
    setAmlActionLoading(key);
    try {
      const result = await action();
      openAmlReport(result.check, subtitle, tab);
      await refetchAmlSummaries();
      if (transactionsModalWalletId) {
        await refetchTxAmlSummaries();
        await refetchWalletAmlHistory();
      }
    } catch (error: any) {
      showAmlError(error);
    } finally {
      setAmlActionLoading(null);
    }
  };

  const handleAmlCheckUpdated = (check: AmlCheck) => {
    setAmlReportCheck(check);
    refetchAmlSummaries();
    if (transactionsModalWalletId) {
      refetchTxAmlSummaries();
      refetchWalletAmlHistory();
    }
  };

  const handleToggleAutoScreenTx = async (walletId: number, currentlyEnabled: boolean) => {
    setAutoScreenToggleId(walletId);
    try {
      await updateWalletAmlAutoScreenTx({ id: walletId, enabled: !currentlyEnabled }).unwrap();
    } catch (error: any) {
      showAmlError(error);
    } finally {
      setAutoScreenToggleId(null);
    }
  };

  // Handle Esc key to close modals
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (addWalletModalOpen) {
          handleCloseModal();
        } else if (transactionsModalWalletId) {
          setTransactionsModalWalletId(null);
        }
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => {
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [addWalletModalOpen, transactionsModalWalletId]);

  // Calculate total balance
  const totalBalance = summary.reduce((sum, wallet) => sum + (wallet.currentBalance || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary Section */}
      <SectionCard
        title={t("wallets.summaryTitle") || "Wallet Summary"}
        actions={
          <div className="flex items-center gap-3">
            {/* Polling Status Indicator */}
            {pollingStatus && (
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${pollingStatus.isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                  <span className={pollingStatus.isActive ? 'text-green-700' : 'text-gray-600'}>
                    {pollingStatus.isActive 
                      ? `Auto-refresh: ${pollingStatus.interval}s` 
                      : 'Auto-refresh: OFF'}
                  </span>
                </span>
              </div>
            )}
            
            {/* Stop/Resume Polling Button */}
            {pollingStatus && (
              <button
                onClick={pollingStatus.isActive ? handleStopPolling : handleStartPolling}
                disabled={isStoppingPolling || isStartingPolling}
                className={`px-3 py-1 text-sm rounded transition-colors disabled:opacity-60 ${
                  pollingStatus.isActive
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {isStoppingPolling || isStartingPolling 
                  ? t("common.processing") || "Processing..." 
                  : pollingStatus.isActive 
                    ? '⏸ Stop Polling' 
                    : '▶ Resume Polling'}
              </button>
            )}
            
            {/* Refresh All Button */}
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshingAll}
              className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {isRefreshingAll ? t("common.refreshing") || "Refreshing..." : t("wallets.refreshAll") || "Refresh All"}
            </button>
          </div>
        }
      >
        {isLoadingSummary ? (
          <div className="text-sm text-slate-500">{t("common.loading")}</div>
        ) : summary.length === 0 ? (
          <div className="text-sm text-slate-500">{t("wallets.noWallets") || "No wallets added yet"}</div>
        ) : (
          <>
            <div className="mb-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
              <div className="text-sm text-slate-600 mb-1">{t("wallets.totalBalance") || "Total USDT Balance"}</div>
              <div className="text-3xl font-bold text-slate-900">
                {formatCurrency(totalBalance)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {t("wallets.across") || "Across"} {summary.length} {summary.length === 1 ? t("wallets.wallet") || "wallet" : t("wallets.wallets") || "wallets"}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {summary.map((wallet) => {
                const canViewTransactions = hasActionPermission(authUser, "viewWalletTransactions");
                return (
                  <div
                    key={wallet.id}
                    className={`p-4 border border-slate-200 rounded-lg bg-white hover:shadow-md transition-shadow ${canViewTransactions ? 'cursor-pointer' : ''}`}
                    onClick={canViewTransactions ? () => handleOpenTransactions(wallet.id) : undefined}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-semibold text-slate-900">{wallet.nickname}</span>
                      <Badge tone="blue">USDT</Badge>
                    </div>
                    <div className="text-2xl font-bold text-slate-900 mb-2">
                      {formatCurrency(wallet.currentBalance || 0)}
                    </div>
                    {wallet.lastBalanceCheck && (
                      <div className="text-xs text-slate-500">
                        {t("wallets.lastChecked") || "Last checked"}: {formatDate(wallet.lastBalanceCheck)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </SectionCard>

      {/* Wallet List */}
      <SectionCard
        title={t("wallets.walletListTitle") || "Wallet List"}
        actions={
          hasActionPermission(authUser, "createWallet") && (
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors font-semibold"
            >
              {t("wallets.addWallet") || "ADD WALLET"}
            </button>
          )
        }
      >
        {isLoadingWallets ? (
          <div className="text-sm text-slate-500">{t("common.loading")}</div>
        ) : wallets.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-8">
            {t("wallets.noWallets") || "No wallets added yet"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-3 px-2">{t("wallets.dateAdded") || "Date Added"}</th>
                  <th className="py-3 px-2">{t("wallets.nickname") || "Nick Name"}</th>
                  <th className="py-3 px-2">{t("wallets.currentBalance") || "Current USDT Balance"}</th>
                  <th className="py-3 px-2">{t("wallets.walletAddress") || "Wallet Address"}</th>
                  <th className="py-3 px-2">{t("wallets.remarks") || "Remarks"}</th>
                  <th className="py-3 px-2">{t("wallets.blacklistStatus")}</th>
                  {amlStatus?.enabled ? (
                    <th className="py-3 px-2">{t("aml.risk")}</th>
                  ) : null}
                  {amlStatus?.enabled ? (
                    <th className="py-3 px-2">{t("aml.autoScreenTx")}</th>
                  ) : null}
                  <th className="py-3 px-2">{t("wallets.actions") || "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((wallet) => (
                  <tr key={wallet.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-2 text-slate-600">
                      {formatDate(wallet.createdAt)}
                    </td>
                    <td className="py-3 px-2 font-semibold text-slate-900">
                      {wallet.nickname}
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-semibold text-slate-900">
                        {formatCurrency(wallet.currentBalance || 0)}
                      </div>
                      {wallet.lastBalanceCheck && (
                        <div className="text-xs text-slate-500">
                          {formatDate(wallet.lastBalanceCheck)}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-600" title={wallet.walletAddress}>
                          {truncateAddress(wallet.walletAddress)}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(wallet.walletAddress);
                            setAlertModal({
                              isOpen: true,
                              message: t("wallets.addressCopied") || "Address copied to clipboard",
                              type: "success",
                            });
                          }}
                          className="text-blue-600 hover:text-blue-700"
                          title={t("wallets.copyAddress") || "Copy address"}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-slate-600 max-w-xs truncate">
                      {wallet.remarks || "-"}
                    </td>
                    <td className="py-3 px-2">
                      <WalletBlacklistBadges
                        wallet={wallet}
                        amlCheck={amlStatus?.enabled ? amlSummariesData?.summaries?.[wallet.id] : null}
                        compact
                      />
                    </td>
                    {amlStatus?.enabled ? (
                      <td className="py-3 px-2">
                        <button
                          type="button"
                          className="inline-flex"
                          onClick={() => {
                            const check = amlSummariesData?.summaries?.[wallet.id];
                            if (check) openAmlReport(check, wallet.walletAddress, "screen", wallet);
                          }}
                        >
                          <AmlRiskBadge
                            check={amlSummariesData?.summaries?.[wallet.id]}
                            notScreenedLabel={t("aml.notScreened")}
                            screeningLabel={t("aml.screening")}
                          />
                        </button>
                      </td>
                    ) : null}
                    {amlStatus?.enabled ? (
                      <td className="py-3 px-2">
                        {hasActionPermission(authUser, "updateWallet") ? (
                          <AmlAutoScreenToggle
                            enabled={isWalletAutoScreenTxEnabled(wallet)}
                            disabled={autoScreenToggleId === wallet.id}
                            title={t("aml.autoScreenTxHint")}
                            onToggle={() =>
                              handleToggleAutoScreenTx(wallet.id, isWalletAutoScreenTxEnabled(wallet))
                            }
                          />
                        ) : (
                          <span className="text-xs text-slate-500">
                            {isWalletAutoScreenTxEnabled(wallet) ? "On" : "Off"}
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td className="py-3 px-2">
                      <div className="flex flex-wrap gap-2 text-sm">
                        {hasActionPermission(authUser, "updateWallet") && (
                          <>
                            <button
                              className="text-blue-600 hover:text-blue-700"
                              onClick={() => handleOpenEditModal(wallet.id)}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              className="text-purple-600 hover:text-purple-700"
                              onClick={() => handleRefreshBalance(wallet.id)}
                            >
                              {t("wallets.refresh") || "Refresh"}
                            </button>
                          </>
                        )}
                        {hasActionPermission(authUser, "viewWalletTransactions") && (
                          <button
                            className="text-emerald-600 hover:text-emerald-700"
                            onClick={() => handleOpenTransactions(wallet.id)}
                          >
                            {t("wallets.logs") || "Logs"}
                          </button>
                        )}
                        {amlStatus?.enabled ? (
                          <>
                            <button
                              className="text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                              disabled={amlActionLoading === `screen-${wallet.id}`}
                              onClick={() =>
                                runAmlAction(
                                  `screen-${wallet.id}`,
                                  () => checkAddressAml(wallet.id).unwrap(),
                                  wallet.walletAddress,
                                  "screen",
                                )
                              }
                            >
                              {t("aml.screen")}
                            </button>
                            <button
                              className="text-violet-600 hover:text-violet-700 disabled:opacity-50"
                              disabled={amlActionLoading === `investigate-${wallet.id}`}
                              onClick={() =>
                                runAmlAction(
                                  `investigate-${wallet.id}`,
                                  () => investigateAddressAml(wallet.id).unwrap(),
                                  wallet.walletAddress,
                                  "investigate",
                                )
                              }
                            >
                              {t("aml.investigate")}
                            </button>
                          </>
                        ) : null}
                        {hasActionPermission(authUser, "deleteWallet") && (
                          <button
                            className="text-rose-600 hover:text-rose-700"
                            onClick={() => handleDeleteClick(wallet.id)}
                            disabled={isDeleting}
                          >
                            {t("common.delete")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Add/Edit Wallet Modal */}
      {addWalletModalOpen && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {editingWalletId ? t("wallets.editWallet") || "Edit Wallet" : t("wallets.addWallet") || "Add Wallet"}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("wallets.nickname") || "Nick Name"} <span className="text-rose-600">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder={t("wallets.nicknamePlaceholder") || "e.g., Main Wallet"}
                  value={form.nickname}
                  onChange={(e) => setForm((p) => ({ ...p, nickname: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("wallets.walletAddress") || "Wallet Address"} <span className="text-rose-600">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  placeholder="T..."
                  value={form.walletAddress}
                  onChange={(e) => setForm((p) => ({ ...p, walletAddress: e.target.value }))}
                  required
                  disabled={!!editingWalletId}
                />
                {editingWalletId && (
                  <p className="text-xs text-slate-500 mt-1">
                    {t("wallets.addressCannotBeChanged") || "Wallet address cannot be changed"}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t("wallets.remarks") || "Remarks"} ({t("common.optional") || "Optional"})
                </label>
                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  placeholder={t("wallets.remarksPlaceholder") || "Additional notes about this wallet"}
                  value={form.remarks}
                  onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="flex gap-3 justify-end mt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {isCreating ? t("common.saving") : editingWalletId ? t("common.update") : t("common.add")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transactions Modal */}
      {transactionsModalWalletId && selectedWallet && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {t("wallets.transactionLogs") || "Transaction Logs"} - {selectedWallet.nickname}
                </h2>
                <p className="text-sm text-slate-500 font-mono mt-1">
                  {selectedWallet.walletAddress}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {amlStatus?.enabled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAmlHistory((v) => {
                        const next = !v;
                        if (next && transactionsModalWalletId) {
                          refetchWalletAmlHistory();
                        }
                        return next;
                      });
                    }}
                    className="px-3 py-1 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                  >
                    {showAmlHistory ? t("aml.hideHistory") : t("aml.showHistory")}
                  </button>
                ) : null}
                <button
                  onClick={handleRefreshTransactions}
                  className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  {t("wallets.refresh") || "Refresh"}
                </button>
                <button
                  onClick={() => setTransactionsModalWalletId(null)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={t("common.close")}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="mb-4 p-3 bg-slate-50 rounded-lg flex items-center justify-between gap-4">
              <div>
                <div className="text-sm text-slate-600">{t("wallets.currentBalance") || "Current Balance"}</div>
                <div className="text-xl font-bold text-slate-900">
                  {formatCurrency(selectedWallet.currentBalance || 0)}
                </div>
              </div>
              {amlStatus?.enabled && hasActionPermission(authUser, "updateWallet") ? (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-medium text-slate-700">{t("aml.autoScreenTx")}</div>
                    <div className="text-xs text-slate-500 max-w-xs">{t("aml.autoScreenTxHint")}</div>
                  </div>
                  <AmlAutoScreenToggle
                    enabled={isWalletAutoScreenTxEnabled(selectedWallet)}
                    disabled={autoScreenToggleId === selectedWallet.id}
                    onToggle={() =>
                      handleToggleAutoScreenTx(
                        selectedWallet.id,
                        isWalletAutoScreenTxEnabled(selectedWallet),
                      )
                    }
                  />
                </div>
              ) : null}
              {selectedWallet.lastBalanceCheck && (
                <div className="text-xs text-slate-500 text-right shrink-0">
                  {t("wallets.lastChecked") || "Last checked"}:<br />
                  {formatDate(selectedWallet.lastBalanceCheck)}
                </div>
              )}
            </div>

            {showAmlHistory && amlStatus?.enabled ? (
              <div className="mb-4 rounded-lg border border-slate-200 p-3">
                <h3 className="mb-1 text-sm font-semibold text-slate-800">{t("aml.historyTitle")}</h3>
                <p className="mb-2 text-xs text-slate-500">{t("aml.historyHint")}</p>
                {walletAmlHistoryItems.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("aml.noHistory")}</p>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-y-auto text-sm">
                    {walletAmlHistoryItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded border border-slate-100 px-2 py-1 text-left hover:bg-slate-50"
                        onClick={() =>
                          openAmlReport(
                            item,
                            selectedWallet.walletAddress,
                            item.checkType === "address_investigation" ? "investigate" : "screen",
                          )
                        }
                      >
                        <span className="text-slate-600">
                          {formatDate(item.createdAt)} ·{" "}
                          {item.checkType === "address"
                            ? t("aml.checkTypeScreen")
                            : item.checkType === "address_investigation"
                              ? t("aml.checkTypeInvestigate")
                              : t("aml.checkTypeTransaction")}
                        </span>
                        <AmlRiskBadge check={item} notScreenedLabel="—" screeningLabel={t("aml.screening")} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 px-2">{t("wallets.date") || "Date"}</th>
                    <th className="py-2 px-2">{t("wallets.type") || "Type"}</th>
                    <th className="py-2 px-2">{t("wallets.amount") || "Amount"}</th>
                    <th className="py-2 px-2">{t("wallets.fromTo") || "From/To"}</th>
                    <th className="py-2 px-2">{t("wallets.txHash") || "Transaction Hash"}</th>
                    {amlStatus?.enabled ? <th className="py-2 px-2">{t("aml.risk")}</th> : null}
                    {amlStatus?.enabled ? <th className="py-2 px-2">{t("wallets.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx: any) => (
                    <tr key={tx.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-2 text-slate-600">
                        {formatDate(tx.timestamp)}
                      </td>
                      <td className="py-2 px-2">
                        <Badge tone={tx.transactionType === "inflow" ? "emerald" : "rose"}>
                          {tx.transactionType === "inflow" ? (
                            <>
                              <span className="mr-1">↓</span>
                              {t("wallets.inflow") || "Inflow"}
                            </>
                          ) : (
                            <>
                              <span className="mr-1">↑</span>
                              {t("wallets.outflow") || "Outflow"}
                            </>
                          )}
                        </Badge>
                      </td>
                      <td className={`py-2 px-2 font-semibold ${
                        tx.transactionType === "inflow" ? "text-emerald-600" : "text-rose-600"
                      }`}>
                        {tx.transactionType === "inflow" ? "+" : "-"}
                        {formatCurrency(tx.amount)}
                      </td>
                      <td className="py-2 px-2">
                        <div className="text-xs font-mono text-slate-600">
                          {tx.transactionType === "inflow" ? (
                            <>
                              <div className="text-slate-500">{t("wallets.from") || "From"}:</div>
                              <div title={tx.fromAddress}>{truncateAddress(tx.fromAddress)}</div>
                            </>
                          ) : (
                            <>
                              <div className="text-slate-500">{t("wallets.to") || "To"}:</div>
                              <div title={tx.toAddress}>{truncateAddress(tx.toAddress)}</div>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <a
                          href={`https://tronscan.org/#/transaction/${tx.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 text-xs font-mono flex items-center gap-1"
                          title={tx.transactionHash}
                        >
                          {truncateAddress(tx.transactionHash)}
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </td>
                      {amlStatus?.enabled ? (
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            onClick={() => {
                              const check = txAmlSummariesData?.summaries?.[tx.id];
                              if (check) openAmlReport(check, tx.transactionHash);
                            }}
                          >
                            <AmlRiskBadge
                              check={txAmlSummariesData?.summaries?.[tx.id]}
                              notScreenedLabel={t("aml.notScreened")}
                              screeningLabel={t("aml.screening")}
                            />
                          </button>
                        </td>
                      ) : null}
                      {amlStatus?.enabled && transactionsModalWalletId ? (
                        <td className="py-2 px-2">
                          <button
                            type="button"
                            className="text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                            disabled={amlActionLoading === `tx-${tx.id}`}
                            onClick={() =>
                              runAmlAction(
                                `tx-${tx.id}`,
                                () =>
                                  checkTransactionAml({
                                    walletId: transactionsModalWalletId,
                                    txId: tx.id,
                                  }).unwrap(),
                                tx.transactionHash,
                                "screen",
                              )
                            }
                          >
                            {t("aml.screenTx")}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td
                        className="py-8 text-sm text-slate-500 text-center"
                        colSpan={amlStatus?.enabled ? 7 : 5}
                      >
                        {t("wallets.noTransactions") || "No transactions found"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        message={alertModal.message}
        type={alertModal.type || "error"}
        onClose={() => setAlertModal({ isOpen: false, message: "", type: "error" })}
      />

      <AmlReportModal
        isOpen={!!amlReportCheck}
        onClose={() => {
          setAmlReportCheck(null);
          setAmlReportWallet(null);
        }}
        check={amlReportCheck}
        wallet={amlReportWallet}
        subtitle={amlReportSubtitle}
        initialTab={amlReportInitialTab}
        onCheckUpdated={handleAmlCheckUpdated}
        onScreen={
          amlReportCheck?.walletId && amlReportCheck.checkType !== "transaction"
            ? () =>
                runAmlAction(
                  `screen-${amlReportCheck.walletId}`,
                  () => checkAddressAml(amlReportCheck.walletId).unwrap(),
                  amlReportSubtitle,
                  "screen",
                )
            : undefined
        }
        onInvestigate={
          amlReportCheck?.walletId && amlReportCheck.checkType !== "transaction"
            ? () =>
                runAmlAction(
                  `investigate-${amlReportCheck.walletId}`,
                  () => investigateAddressAml(amlReportCheck.walletId).unwrap(),
                  amlReportSubtitle,
                  "investigate",
                )
            : undefined
        }
        screenLoading={
          amlReportCheck?.walletId
            ? amlActionLoading === `screen-${amlReportCheck.walletId}`
            : false
        }
        investigateLoading={
          amlReportCheck?.walletId
            ? amlActionLoading === `investigate-${amlReportCheck.walletId}`
            : false
        }
      />

      <ConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        message={
          t("wallets.confirmDelete")?.replace("{{walletName}}", deleteConfirmModal.walletName) ||
          `Are you sure you want to delete wallet "${deleteConfirmModal.walletName}"? This will also delete all transaction logs.`
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmModal({ isOpen: false, walletId: null, walletName: "" })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />
    </div>
  );
}
