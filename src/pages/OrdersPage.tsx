import React, { useState, type FormEvent, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import Badge from "../components/common/Badge";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import NewOrderModal from "../components/orders/NewOrderModal";
import { BatchOrdersTab } from "../components/orders/BatchOrdersTab";
import { AccountTooltip } from "../components/orders/AccountTooltip";
import { SearchableSelect } from "../components/common/SearchableSelect";
import { OrdersFilters } from "../components/orders/OrdersFilters";
import { OrdersTable } from "../components/orders/OrdersTable";
import { OrdersColumnDropdown } from "../components/orders/OrdersColumnDropdown";
import { CreateCustomerModal } from "../components/orders/CreateCustomerModal";
import { CustomerLedgerEntryFormModal } from "../components/customers/CustomerLedgerEntryFormModal";
import { ImportOrdersModal } from "../components/orders/ImportOrdersModal";
import { ProfitServiceChargeSection } from "../components/orders/ProfitServiceChargeSection";
import { ViewOrderModal } from "../components/orders/ViewOrderModal";
import { OnlineOrderSummary } from "../components/orders/OnlineOrderSummary";
import { TagSelectionModal } from "../components/common/TagSelectionModal";
import { RemarksSection } from "../components/orders/RemarksSection";
import { useOrdersFilters } from "../hooks/orders/useOrdersFilters";
import { useOrdersTable } from "../hooks/orders/useOrdersTable";
import { useUnifiedOrderModal } from "../hooks/orders/useUnifiedOrderModal";
import { useViewOrderModal } from "../hooks/orders/useViewOrderModal";
import { useBeneficiaryForm } from "../hooks/orders/useBeneficiaryForm";
import { useOrdersModals } from "../hooks/orders/useOrdersModals";
import { useOrdersImportExport } from "../hooks/orders/useOrdersImportExport";
import { useOrdersCustomer } from "../hooks/orders/useOrdersCustomer";
import { useOrdersActions } from "../hooks/orders/useOrdersActions";
import { useBatchDelete } from "../hooks/useBatchDelete";
import { useCurrencyByCode } from "../hooks/useCurrencyByCode";

import {
  useAddOrderMutation,
  useGetCurrenciesQuery,
  useGetCustomerOptionsQuery,
  useGetOrdersQuery,
  useGetUsersQuery,
  useUpdateOrderMutation,
  useUpdateOrderStatusMutation,
  useDeleteOrderMutation,
  useGetOrderDetailsQuery,
  useDeleteReceiptMutation,
  useConfirmReceiptMutation,
  useDeleteProfitMutation,
  useConfirmProfitMutation,
  useDeleteServiceChargeMutation,
  useConfirmServiceChargeMutation,
  useAddBeneficiaryMutation,
  useDeletePaymentMutation,
  useConfirmPaymentMutation,
  useGetCustomerBeneficiariesQuery,
  useAddCustomerBeneficiaryMutation,
  useGetAccountsQuery,
  useAddCustomerMutation,
  useGetTagsQuery,
  useBatchAssignTagsMutation,
  useBatchUnassignTagsMutation,
  useGetOrderPinsQuery,
  usePinOrderMutation,
  useUnpinOrderMutation,
  useReorderPinnedOrdersMutation,
} from "../services/api";
import { useAppSelector } from "../app/hooks";
import { hasActionPermission } from "../utils/permissions";
import { canCreateLedgerDepositWithdraw } from "../utils/customerPermissions";
import type { Order } from "../types";
import { formatDate } from "../utils/format";

/** Apply a reorder of visible pinned rows into the user's full pinned-id list. */
function applyVisiblePinReorder(fullPinned: number[], visibleTopToBottom: number[], newVisibleOrder: number[]) {
  const idxs: number[] = [];
  fullPinned.forEach((id, i) => {
    if (visibleTopToBottom.includes(id)) idxs.push(i);
  });
  if (idxs.length !== newVisibleOrder.length) return fullPinned;
  const out = [...fullPinned];
  idxs.forEach((pos, j) => {
    const nextId = newVisibleOrder[j];
    if (nextId !== undefined) out[pos] = nextId;
  });
  return out;
}

export default function OrdersPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const authUser = useAppSelector((s) => s.auth.user);
  const canPinOrders = hasActionPermission(authUser, "pinOrders");
  // Get initial filters from location state
  const initialFilters = useMemo(() => {
    const state = location.state as { initialFilters?: Partial<import("../types/orders").OrderFilters> } | null;
    return state?.initialFilters;
  }, [location.state]);

  // Page state
  const [currentPage, setCurrentPage] = useState(1);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [isSavingRemarks, setIsSavingRemarks] = useState(false);

  // Filter state and handlers
  const {
    filters,
    setFilters,
    updateFilter,
    handleDatePresetChange,
    handleClearFilters,
    queryParams,
    exportQueryParams,
    isTagFilterOpen,
    setIsTagFilterOpen,
    tagFilterHighlight,
    setTagFilterHighlight,
    tagFilterListRef,
  } = useOrdersFilters(currentPage, setCurrentPage, initialFilters);

  const { data: ordersData, isLoading, refetch: refetchOrders } = useGetOrdersQuery(queryParams);
  const orders = ordersData?.orders || [];
  const totalOrders = ordersData?.total || 0;
  const totalCalculatedProfit = ordersData?.totalCalculatedProfit ?? null;
  const totalCalculatedProfitCurrency = ordersData?.totalCalculatedProfitCurrency ?? null;

  const { data: pinsData } = useGetOrderPinsQuery(undefined, { skip: !authUser?.id || !canPinOrders });
  const pinnedOrderIds = pinsData?.orderIds ?? [];
  const [pinOrderMut] = usePinOrderMutation();
  const [unpinOrderMut] = useUnpinOrderMutation();
  const [reorderPinnedMut] = useReorderPinnedOrdersMutation();

  const totalPages = useMemo(() => {
    return Math.ceil(totalOrders / 20);
  }, [totalOrders]);

  const { data: customersData } = useGetCustomerOptionsQuery();
  const customers = customersData?.customers ?? [];
  const { data: currencies = [] } = useGetCurrenciesQuery();
  const currencyByCode = useCurrencyByCode();
  const { data: users = [] } = useGetUsersQuery();
  const { data: orderAccounts = [] } = useGetAccountsQuery({ scope: "order.account" });
  const { data: profitAccounts = [] } = useGetAccountsQuery({ scope: "profit.account" });
  const { data: serviceChargeAccounts = [] } = useGetAccountsQuery({ scope: "serviceCharge.account" });
  const accounts = useMemo(() => {
    const byId = new Map<number, (typeof orderAccounts)[number]>();
    [
      ...orderAccounts,
      ...profitAccounts,
      ...serviceChargeAccounts,
    ].forEach((account) => byId.set(account.id, account));
    return [...byId.values()];
  }, [orderAccounts, profitAccounts, serviceChargeAccounts]);
  const { data: tags = [] } = useGetTagsQuery();
  const [addOrder] = useAddOrderMutation();

  const [ordersPageTab, setOrdersPageTab] = useState<"list" | "batch">("list");
  const [newOrderViewerModal, setNewOrderViewerModal] = useState<{
    isOpen: boolean;
    src: string;
    type: "image" | "pdf";
    title: string;
  } | null>(null);
  const [ledgerEntryModal, setLedgerEntryModal] = useState<{
    open: boolean;
    type: "credit" | "debit";
  }>({ open: false, type: "credit" });

  const unifiedOrder = useUnifiedOrderModal(currencies, accounts, authUser, customers);
  const canDepositWithdraw = canCreateLedgerDepositWithdraw(authUser);

  useEffect(() => {
    if (!unifiedOrder.isOpen) {
      setLedgerEntryModal({ open: false, type: "credit" });
    }
  }, [unifiedOrder.isOpen]);

  // Get unique currency pairs from all orders (for dropdown)
  // Note: This would ideally come from the backend, but for now we'll generate from currencies
  const currencyPairs = useMemo(() => {
    const pairs = new Set<string>();
    // Generate pairs from active currencies
    currencies
      .filter((c) => c.active)
      .forEach((fromCurr) => {
        currencies
          .filter((c) => c.active && c.code !== fromCurr.code)
          .forEach((toCurr) => {
            pairs.add(`${fromCurr.code}/${toCurr.code}`);
          });
      });
    return Array.from(pairs).sort();
  }, [currencies]);

  // Modal state management
  const {
    alertModal,
    setAlertModal,
    confirmModal,
    setConfirmModal,
    isCreateCustomerModalOpen,
    setIsCreateCustomerModalOpen,
    importModalOpen,
    setImportModalOpen,
    isImporting,
    setIsImporting,
    viewerModal,
    setViewerModal,
  } = useOrdersModals();

  // Import/Export functionality
  const {
    isExporting,
    handleExportOrders,
    handleDownloadTemplate,
    handleImportFile,
  } = useOrdersImportExport({
    exportQueryParams,
    customers,
    users,
    currencies,
    currencyPairs,
    accounts,
    tags,
    addOrder,
    setAlertModal,
    setIsImporting,
    setImportModalOpen,
    t,
  });


  // Helper function to prevent number input from changing value on scroll
  const handleNumberInputWheel = useCallback((e: React.WheelEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    if (document.activeElement === target) {
      target.blur();
    }
  }, []);

  const [updateOrder] = useUpdateOrderMutation();
  const [updateOrderStatus] = useUpdateOrderStatusMutation();
  const [deleteOrder, { isLoading: isDeleting }] = useDeleteOrderMutation();
  // Batch delete hook
  const {
    isBatchDeleteMode,
    selectedIds: selectedOrderIds,
    setSelectedIds: setSelectedOrderIds,
    setIsBatchDeleteMode,
    handleDeleteClick: batchDeleteHandleDeleteClick,
    handleDelete: batchDeleteHandleDelete,
    handleBulkDelete: batchDeleteHandleBulkDelete,
    toggleBatchDeleteMode,
    exitBatchDeleteMode,
    confirmModal: batchDeleteConfirmModal,
    setConfirmModal: setBatchDeleteConfirmModal,
  } = useBatchDelete({
    deleteSingle: (id: number) => deleteOrder(id),
    confirmMessage: t("orders.confirmDeleteOrder"),
    confirmBulkMessage: t("orders.confirmDeleteSelected"),
    errorMessage: t("orders.errorDeleting"),
    t,
    setAlertModal,
  });

  const handlePinOrder = useCallback(
    async (orderId: number) => {
      try {
        await pinOrderMut(orderId).unwrap();
      } catch (e: unknown) {
        let msg = t("orders.pinLimitReached");
        if (e && typeof e === "object" && "data" in e) {
          const d = (e as { data?: { message?: string } }).data;
          if (d?.message) msg = d.message;
        }
        setAlertModal({ isOpen: true, message: msg, type: "error" });
      }
    },
    [pinOrderMut, setAlertModal, t],
  );

  const handleUnpinOrder = useCallback(async (orderId: number) => {
    try {
      await unpinOrderMut(orderId).unwrap();
    } catch {
      /* ignore */
    }
  }, [unpinOrderMut]);

  const handleReorderPinnedRows = useCallback(
    (fromId: number, toId: number) => {
      const visible = orders.filter((o) => o.pinned).map((o) => o.id);
      const fromIdx = visible.indexOf(fromId);
      const toIdx = visible.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const newVisible = [...visible];
      const [removed] = newVisible.splice(fromIdx, 1);
      newVisible.splice(toIdx, 0, removed);
      const merged = applyVisiblePinReorder(pinnedOrderIds, visible, newVisible);
      void reorderPinnedMut({ orderIds: merged })
        .unwrap()
        .catch(() => {
          /* ignore */
        });
    },
    [orders, pinnedOrderIds, reorderPinnedMut],
  );

  // Adapter for confirm modal to match existing structure
  // Use batch delete modal for delete operations
  const deleteConfirmModal = {
    isOpen: batchDeleteConfirmModal.isOpen,
    message: batchDeleteConfirmModal.message,
    orderId: batchDeleteConfirmModal.entityId,
    isBulk: batchDeleteConfirmModal.isBulk,
  };
  const setDeleteConfirmModal = (modal: { isOpen: boolean; message: string; orderId: number | null; isBulk?: boolean }) => {
    setBatchDeleteConfirmModal({
      isOpen: modal.isOpen,
      message: modal.message,
      entityId: modal.orderId,
      isBulk: modal.isBulk || false,
    });
  };
  const [batchAssignTags, { isLoading: isTagging }] = useBatchAssignTagsMutation();
  const [batchUnassignTags, { isLoading: isUntagging }] = useBatchUnassignTagsMutation();
  const [addCustomer, { isLoading: isCreatingCustomer }] = useAddCustomerMutation();

  // Customer creation (legacy modal — optional)
  const {
    customerForm,
    setCustomerForm,
    resetCustomerForm,
    handleCreateCustomer,
  } = useOrdersCustomer({
    addCustomer,
    setForm: () => {},
    setIsCreateCustomerModalOpen,
    customers,
    setAlertModal,
    t,
  });
  const [deleteReceipt] = useDeleteReceiptMutation();
  const [confirmReceipt] = useConfirmReceiptMutation();
  const [deleteProfit] = useDeleteProfitMutation();
  const [confirmProfit] = useConfirmProfitMutation();
  const [deleteServiceCharge] = useDeleteServiceChargeMutation();
  const [confirmServiceCharge] = useConfirmServiceChargeMutation();
  const [addBeneficiary] = useAddBeneficiaryMutation();
  const [deletePayment] = useDeletePaymentMutation();
  const [confirmPayment] = useConfirmPaymentMutation();
  const [addCustomerBeneficiary] = useAddCustomerBeneficiaryMutation();

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPositionAbove, setMenuPositionAbove] = useState<{ [key: number]: boolean }>({});
  const [isBatchTagMode, setIsBatchTagMode] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  
  // Tag filter helpers (needs tags from query)
  const selectedTagNames = useMemo(
    () =>
      filters.tagIds
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [filters.tagIds, tags],
  );
  const tagFilterLabel = useMemo(() => {
    if (selectedTagNames.length === 0) {
      return t("orders.selectTag");
    }
    return selectedTagNames.join(", ");
  }, [selectedTagNames, t]);

  const handleTagFilterKeyDown = (e: React.KeyboardEvent) => {
    if (!isTagFilterOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        setIsTagFilterOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsTagFilterOpen(false);
      return;
    }

    if (tags.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setTagFilterHighlight((prev) => {
        const next = prev < tags.length - 1 ? prev + 1 : 0;
        return next;
      });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setTagFilterHighlight((prev) => {
        if (prev <= 0) return tags.length - 1;
        return prev - 1;
      });
      return;
    }

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (tagFilterHighlight >= 0 && tagFilterHighlight < tags.length) {
        const tag = tags[tagFilterHighlight];
        const exists = filters.tagIds.includes(tag.id);
        const next = exists ? filters.tagIds.filter((id) => id !== tag.id) : [...filters.tagIds, tag.id];
        updateFilter('tagIds', next);
      }
    }
  };
  
  // Column management via hook
  const {
    isColumnDropdownOpen,
    setIsColumnDropdownOpen,
    columnDropdownRef,
    availableColumns,
    columnOrder,
    visibleColumns,
    getColumnLabel,
    toggleColumnVisibility,
    draggedColumnIndex,
    dragOverIndex,
    handleColumnDragStart,
    handleColumnDragOver,
    handleColumnDragEnd,
    handleColumnDragLeave,
  } = useOrdersTable();

  
  // View order modal state and handlers (read-only summary for completed/cancelled)
  const {
    viewModalOrderId,
    setViewModalOrderId,
    makePaymentModalOrderId,
    setMakePaymentModalOrderId,
    closeViewModal,
    profitAmount,
    setProfitAmount,
    profitCurrency,
    setProfitCurrency,
    profitAccountId,
    setProfitAccountId,
    serviceChargeAmount,
    setServiceChargeAmount,
    serviceChargeCurrency,
    setServiceChargeCurrency,
    serviceChargeAccountId,
    setServiceChargeAccountId,
    serviceChargeFundedFrom,
    setServiceChargeFundedFrom,
    showProfitSection,
    setShowProfitSection,
    showServiceChargeSection,
    setShowServiceChargeSection,
    remarks,
    setRemarks,
    showRemarks,
    setShowRemarks,
  } = useViewOrderModal();
  
  const renderProfitServiceCharges = () => {
    if (!orderDetails) return null;
    const order = orderDetails.order;
    const summaryClass = "lg:col-span-2 border-t pt-4 mt-4";
    const addWrapperClass = "lg:col-span-2";
    const canEdit = Boolean(authUser);

    return (
      <>
        {/* Display profit entries (draft and confirmed) */}
        {orderDetails?.profits && orderDetails.profits.length > 0 && (
          <div className={summaryClass}>
            {orderDetails.profits.map((profit: any) => (
              <div key={profit.id} className="p-3 border border-blue-200 rounded-lg bg-blue-50 mb-2 relative">
                <div className="flex items-start gap-2 mb-2">
                  {profit.status === 'draft' && (
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-yellow-200 text-yellow-800">
                      Draft
                    </span>
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-blue-900 mb-2">
                      {t("orders.profit")}
                    </h3>
                    <div className="text-sm text-slate-600 space-y-1">
                      <div>
                        {t("orders.profitAmount")}:{" "}
                        {profit.amount > 0 ? "+" : ""}
                        {profit.amount.toFixed(2)} {profit.currencyCode || ""}
                      </div>
                      {profit.accountName && (
                        <div className="text-slate-500">
                          {t("orders.account")}: {profit.accountName}
                        </div>
                      )}
                    </div>
                  </div>
                  {profit.status === 'draft' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(t("orders.confirmProfitQuestion") || "Confirm this profit?")) {
                            try {
                              await confirmProfit(profit.id).unwrap();
                            } catch (error: any) {
                              console.error("Error confirming profit:", error);
                              const errorMessage = error?.data?.message || error?.message || t("orders.failedToConfirmProfit");
                              alert(errorMessage);
                            }
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(t("orders.deleteProfitQuestion") || "Delete this profit?")) {
                            try {
                              await deleteProfit(profit.id).unwrap();
                            } catch (error: any) {
                              console.error("Error deleting profit:", error);
                              const errorMessage = error?.data?.message || error?.message || t("orders.failedToDeleteProfit");
                              alert(errorMessage);
                            }
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Display service charge entries (draft and confirmed) */}
        {orderDetails?.serviceCharges && orderDetails.serviceCharges.length > 0 && (
          <div className={summaryClass}>
            {orderDetails.serviceCharges.map((serviceCharge: any) => (
              <div key={serviceCharge.id} className="p-3 border border-green-200 rounded-lg bg-green-50 mb-2 relative">
                <div className="flex items-start gap-2 mb-2">
                  {serviceCharge.status === 'draft' && (
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-yellow-200 text-yellow-800">
                      Draft
                    </span>
                  )}
                  <div className="flex-1">
                    <h3 className="font-semibold text-green-900 mb-2">
                      {t("orders.serviceCharges")}
                    </h3>
                    <div className="text-sm text-slate-600 space-y-1">
                      <div>
                        {t("orders.serviceChargeAmount")}:{" "}
                        {serviceCharge.amount > 0 ? "+" : ""}
                        {serviceCharge.amount.toFixed(2)} {serviceCharge.currencyCode || ""}
                      </div>
                      {serviceCharge.fundedFrom === "customer_balance" ? (
                        <div className="text-slate-500">
                          {t("orders.serviceChargeFundedFromBalance")}
                        </div>
                      ) : serviceCharge.accountName ? (
                        <div className="text-slate-500">
                          {t("orders.account")}: {serviceCharge.accountName}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {serviceCharge.status === 'draft' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(t("orders.confirmServiceChargeQuestion") || "Confirm this service charge?")) {
                            try {
                              await confirmServiceCharge(serviceCharge.id).unwrap();
                            } catch (error: any) {
                              console.error("Error confirming service charge:", error);
                              const errorMessage = error?.data?.message || error?.message || t("orders.failedToConfirmServiceCharge");
                              alert(errorMessage);
                            }
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.confirm(t("orders.deleteServiceChargeQuestion") || "Delete this service charge?")) {
                            try {
                              await deleteServiceCharge(serviceCharge.id).unwrap();
                            } catch (error: any) {
                              console.error("Error deleting service charge:", error);
                              const errorMessage = error?.data?.message || error?.message || t("orders.failedToDeleteServiceCharge");
                              alert(errorMessage);
                            }
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className={addWrapperClass}>
            <ProfitServiceChargeSection
              authUser={authUser}
              showAddControls={false}
              orderId={viewModalOrderId}
              order={orderDetails?.order}
              accounts={accounts}
              profits={orderDetails?.profits}
              serviceCharges={orderDetails?.serviceCharges}
              profitAmount={profitAmount}
              setProfitAmount={setProfitAmount}
              profitCurrency={profitCurrency}
              setProfitCurrency={setProfitCurrency}
              profitAccountId={profitAccountId}
              setProfitAccountId={setProfitAccountId}
              showProfitSection={showProfitSection}
              setShowProfitSection={setShowProfitSection}
              serviceChargeAmount={serviceChargeAmount}
              setServiceChargeAmount={setServiceChargeAmount}
              serviceChargeCurrency={serviceChargeCurrency}
              setServiceChargeCurrency={setServiceChargeCurrency}
              serviceChargeAccountId={serviceChargeAccountId}
              setServiceChargeAccountId={setServiceChargeAccountId}
              serviceChargeFundedFrom={serviceChargeFundedFrom}
              setServiceChargeFundedFrom={setServiceChargeFundedFrom}
              showServiceChargeSection={showServiceChargeSection}
              setShowServiceChargeSection={setShowServiceChargeSection}
              updateOrder={updateOrder}
              handleNumberInputWheel={handleNumberInputWheel}
              layout="grid"
              t={t}
            />
          </div>
        )}
      </>
    );
  };

  const renderRemarks = () => {
    if (!orderDetails) return null;
    const order = orderDetails.order;
    const summaryClass = "lg:col-span-2 border-t pt-4 mt-4";
    const canEdit = Boolean(authUser);

    // If remarks exist in the database, show as readonly preview
    if (order.remarks && order.remarks.trim() !== "") {
      return (
        <div className={summaryClass}>
          <div className="p-3 border border-slate-200 rounded-lg bg-slate-50 mb-2 relative">
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-2">
                  {t("orders.remarks")}
                </h3>
                <div className="text-sm text-slate-600 whitespace-pre-wrap">
                  {order.remarks}
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm(t("orders.removeRemarksQuestion") || "Remove remarks?")) {
                      try {
                        await updateOrder({
                          id: order.id,
                          data: { remarks: "" },
                        }).unwrap();
                        setRemarks("");
                        setShowRemarks(false);
                      } catch (error: any) {
                        console.error("Error removing remarks:", error);
                        const errorMessage = error?.data?.message || error?.message || t("orders.failedToRemoveRemarks");
                        setAlertModal({
                          isOpen: true,
                          message: errorMessage,
                          type: "error",
                        });
                      }
                    }
                  }}
                  className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                >
                  {t("common.remove")}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // If editing remarks (showRemarks is true), show textarea
    if (canEdit && showRemarks) {
      return (
        <div className={summaryClass}>
          <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">
                {t("orders.remarks")}
              </label>
              <button
                type="button"
                onClick={() => {
                  setRemarks("");
                  setShowRemarks(false);
                }}
                className="text-slate-600 hover:text-slate-800 text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={t("orders.remarksPlaceholder") || "Add any notes or remarks about this order..."}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
            />
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={handleSaveRemarks}
                disabled={isSavingRemarks}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingRemarks ? t("common.saving") || "Saving..." : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // If no remarks and not editing, show "Add Remarks" button
    if (canEdit) {
      return (
        <div className={summaryClass}>
          <button
            type="button"
            onClick={() => setShowRemarks(true)}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            {t("orders.addRemarks")}
          </button>
        </div>
      );
    }

    return null;
  };
  
  const previousOrderStatusRef = useRef<string | null>(null);
  
  const menuRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const menuElementRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // processForm is now provided by useProcessOrderModal hook

  // Beneficiary form state and handlers
  const {
    beneficiaryForm,
    setBeneficiaryForm,
    saveBeneficiaryToCustomer,
    setSaveBeneficiaryToCustomer,
    selectedCustomerBeneficiaryId,
    setSelectedCustomerBeneficiaryId,
    applyCustomerBeneficiaryToForm,
    resetBeneficiaryForm,
    closeMakePaymentModal,
    handleAddBeneficiary,
  } = useBeneficiaryForm(orders, accounts, makePaymentModalOrderId, setOpenMenuId, setMakePaymentModalOrderId, t);

  // Order actions (edit, delete, status updates)
  const {
    setStatus,
    startEdit,
    submit,
    handleProcess,
  } = useOrdersActions({
    orders,
    updateOrderStatus,
    deleteOrder,
    setOpenMenuId,
    setConfirmModal: setDeleteConfirmModal,
    setAlertModal,
    openOrderEditor: unifiedOrder.openEdit,
    selectedOrderIds,
    setSelectedOrderIds,
    setIsBatchDeleteMode,
    t,
  });

  // Use batch delete handlers from hook
  const handleDeleteClick = batchDeleteHandleDeleteClick;
  const handleDelete = batchDeleteHandleDelete;
  const handleBulkDelete = batchDeleteHandleBulkDelete;

  const { data: orderDetails } = useGetOrderDetailsQuery(viewModalOrderId || 0, {
    skip: !viewModalOrderId,
  });

  // Helper function to determine which currency is the base (stronger) currency
  // Returns true if fromCurrency is base, false if toCurrency is base, null if can't determine
  const getBaseCurrency = useCallback((fromCurrency: string, toCurrency: string): boolean | null => {
    const getCurrencyRate = (code: string) => {
      const currency = currencies.find((c) => c.code === code);
      const candidate =
        currency?.conversionRateBuy ??
        currency?.baseRateBuy ??
        currency?.baseRateSell ??
        currency?.conversionRateSell;
      return typeof candidate === "number" ? candidate : null;
    };

    const fromRate = getCurrencyRate(fromCurrency);
    const toRate = getCurrencyRate(toCurrency);

    const inferredFromIsUSDT = fromRate !== null ? fromRate <= 1 : fromCurrency === "USDT";
    const inferredToIsUSDT = toRate !== null ? toRate <= 1 : toCurrency === "USDT";

    // If both sides look like USDT (rate <= 1), return null
    if (inferredFromIsUSDT && inferredToIsUSDT) return null;

    if (inferredFromIsUSDT !== inferredToIsUSDT) {
      // One side is USDT (or behaves like it)
      return inferredFromIsUSDT;
    } else if (!inferredFromIsUSDT && !inferredToIsUSDT && fromRate !== null && toRate !== null) {
      // Neither is USDT: pick the currency with the smaller rate as the stronger/base currency
      return fromRate < toRate;
    }
    return null;
  }, [currencies]);

  // Load remarks when order details change
  useEffect(() => {
    if (viewModalOrderId && orderDetails?.order) {
      const orderRemarks = orderDetails.order.remarks;
      if (orderRemarks !== null && orderRemarks !== undefined && orderRemarks.trim() !== "") {
        setRemarks(orderRemarks);
        setShowRemarks(true);
      } else {
        setRemarks("");
        setShowRemarks(false);
      }
    } else if (!viewModalOrderId) {
      // Reset saving state when modal closes
      setIsSavingRemarks(false);
    }
  }, [viewModalOrderId, orderDetails?.order?.id, orderDetails?.order?.remarks]);

  // Handler to save remarks
  const handleSaveRemarks = useCallback(async () => {
    if (!viewModalOrderId || isSavingRemarks) return;
    
    setIsSavingRemarks(true);
    try {
      const remarksData: any = {};
      if (showRemarks) {
        if (remarks && remarks.trim() !== "") {
          remarksData.remarks = remarks.trim();
        } else {
          // Empty remarks - set to null to remove from database
          remarksData.remarks = null;
        }
      }
      
      if (Object.keys(remarksData).length > 0) {
        await updateOrder({
          id: viewModalOrderId,
          data: remarksData,
        }).unwrap();
      }
    } catch (error: any) {
      console.error("Error saving remarks:", error);
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || error?.message || t("orders.failedToSaveRemarks"),
        type: "error",
      });
    } finally {
      setIsSavingRemarks(false);
    }
  }, [viewModalOrderId, remarks, showRemarks, updateOrder, setAlertModal, t, isSavingRemarks]);

  // Track order status when modal opens
  useEffect(() => {
    if (viewModalOrderId && orderDetails?.order) {
      // Store the status when modal opens or order details load
      previousOrderStatusRef.current = orderDetails.order.status;
    } else if (!viewModalOrderId) {
      // Reset when modal closes
      previousOrderStatusRef.current = null;
    }
  }, [viewModalOrderId, orderDetails?.order?.id]);

  // Auto-close the view modal only if order transitions TO completed while modal is open
  // (not if it's already completed when user opens it)
  useEffect(() => {
    if (
      viewModalOrderId &&
      orderDetails?.order?.status === "completed" &&
      previousOrderStatusRef.current !== "completed" &&
      previousOrderStatusRef.current !== null
    ) {
      setViewModalOrderId(null);
      previousOrderStatusRef.current = null;
    }
  }, [orderDetails?.order?.status, viewModalOrderId, setViewModalOrderId]);

  // OTC order state and handlers are now provided by useOtcOrder hook

  // resetForm is now provided by useOrderForm hook

  // resetProcessForm is now provided by useProcessOrderModal hook

  // resetBeneficiaryForm is now provided by useBeneficiaryForm hook

  // resetOtcForm and closeOtcModal are now provided by useOtcOrder hook
 /*  // When fromCurrency or toCurrency changes, fetch the buy and sell rates for the selected non-USDT currency (rates are against USDT)
  useEffect(() => {
    const fetchConversionRates = async () => {
      let currency = null;
      // Only fetch for the currency that is NOT USDT, and only if one is USDT and one is not
      if (form.fromCurrency === "USDT" && form.toCurrency && form.toCurrency !== "USDT") {
        currency = form.toCurrency;
      } else if (form.toCurrency === "USDT" && form.fromCurrency && form.fromCurrency !== "USDT") {
        currency = form.fromCurrency;
      } else {
        // If both are USDT or both are non-USDT or missing, do nothing
        return;
      }
      try {
        // Replace with your actual endpoint or API method
        const response = await fetch(`/api/exchange-rates/${currency}`);
        if (!response.ok) {
          // Handles HTTP 404s or others gracefully
          console.warn(`Exchange rates endpoint not found for: ${currency}`);
          return;
        }
        // Attempt to parse only if the response is JSON
        const contentType = response.headers.get("Content-Type");
        if (!contentType || !contentType.includes("application/json")) {
          console.warn(`Exchange rates response for ${currency} is not valid JSON`);
          return;
        }
        const data = await response.json();
        // Suppose the response structure is { buy: 284.5, sell: 286 }
        if (data && typeof data.buy !== 'undefined' && typeof data.sell !== 'undefined') {
          console.log(`Buy rate for ${currency} against USDT: ${data.buy}`);
          console.log(`Sell rate for ${currency} against USDT: ${data.sell}`);
        } else {
          console.log(`Could not fetch valid conversion rates for ${currency} against USDT`);
        }
      } catch (error) {
        console.log(`Error fetching conversion rates for ${currency} against USDT:`, error);
      }
    };
    fetchConversionRates();
  }, [form.fromCurrency, form.toCurrency]); */



  // Auto-calculation logic is now handled by useOrderForm hook



  // closeProcessModal is now provided by useProcessOrderModal hook

  // closeViewModal is now provided by useViewOrderModal hook

  // closeMakePaymentModal is now provided by useBeneficiaryForm hook

  // OTC Order handlers are now provided by useOtcOrder hook



  // handleAddBeneficiary is now provided by useBeneficiaryForm hook

  // Tag selection handlers
  const handleTagSelectionChange = useCallback((tagId: number, checked: boolean) => {
    if (checked) {
      setSelectedTagIds((prev) => [...prev, tagId]);
    } else {
      setSelectedTagIds((prev) => prev.filter((id) => id !== tagId));
    }
  }, []);

  const handleApplyTags = useCallback(async () => {
    if (selectedTagIds.length === 0) {
      setAlertModal({
        isOpen: true,
        message: t("orders.selectAtLeastOneTag"),
        type: "error",
      });
      return;
    }
    try {
      await batchAssignTags({
        entityType: "order",
        entityIds: selectedOrderIds,
        tagIds: selectedTagIds,
      }).unwrap();
      
      // Close modal and reset state
      setIsTagModalOpen(false);
      setSelectedTagIds([]);
      setSelectedOrderIds([]);
      setIsBatchTagMode(false);
      
      // Show success message
      setAlertModal({
        isOpen: true,
        message: t("orders.tagsApplied"),
        type: "success",
      });
      
      // Force refetch
      setTimeout(async () => {
        try {
          await refetchOrders();
        } catch (err) {
          console.error("Error refetching orders:", err);
        }
      }, 100);
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("orders.tagError"),
        type: "error",
      });
    }
  }, [selectedTagIds, selectedOrderIds, batchAssignTags, t, setAlertModal, refetchOrders]);

  const handleRemoveTags = useCallback(async () => {
    if (selectedTagIds.length === 0) {
      setAlertModal({
        isOpen: true,
        message: t("orders.selectAtLeastOneTag"),
        type: "error",
      });
      return;
    }
    try {
      await batchUnassignTags({
        entityType: "order",
        entityIds: selectedOrderIds,
        tagIds: selectedTagIds,
      }).unwrap();

      setIsTagModalOpen(false);
      setSelectedTagIds([]);
      setSelectedOrderIds([]);
      setIsBatchTagMode(false);

      setAlertModal({
        isOpen: true,
        message: t("orders.tagsRemovedSuccess"),
        type: "success",
      });

      setTimeout(async () => {
        try {
          await refetchOrders();
        } catch (err) {
          console.error("Error refetching orders:", err);
        }
      }, 100);
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message:
          error?.data?.message ||
          error?.message ||
          t("orders.failedToRemoveTags") ||
          "Failed to remove tags",
        type: "error",
      });
    }
  }, [selectedTagIds, selectedOrderIds, batchUnassignTags, t, setAlertModal, refetchOrders]);

  const handleCloseTagModal = useCallback(() => {
    setIsTagModalOpen(false);
    setSelectedTagIds([]);
  }, []);

  const canActOnOrders = Boolean(authUser);
  const canCancelOrder = canActOnOrders;
  const canDeleteOrder = hasActionPermission(authUser, "deleteOrder");
  const canDeleteManyOrders = hasActionPermission(authUser, "deleteManyOrders");
  const canEditAnyOrder = hasActionPermission(authUser, "editAnyOrder");

  // Action buttons and status tone are now handled by OrderActionsMenu component

  const getFileType = useCallback((imagePath: string): "image" | "pdf" | null => {
    if (!imagePath) return null;
    if (imagePath.startsWith("data:image/")) return "image";
    if (imagePath.startsWith("data:application/pdf")) return "pdf";

    let pathForExt = imagePath;
    if (imagePath.startsWith("/api/uploads/")) {
      pathForExt = imagePath;
    } else if (/^https?:\/\//i.test(imagePath)) {
      try {
        const u = new URL(imagePath);
        if (u.pathname.startsWith("/api/uploads/")) {
          pathForExt = u.pathname;
        } else {
          return null;
        }
      } catch {
        return null;
      }
    } else {
      return null;
    }

    const lowerPath = pathForExt.toLowerCase();
    if (lowerPath.endsWith(".pdf")) return "pdf";
    if (
      lowerPath.endsWith(".jpg") ||
      lowerPath.endsWith(".jpeg") ||
      lowerPath.endsWith(".png") ||
      lowerPath.endsWith(".gif") ||
      lowerPath.endsWith(".webp")
    ) {
      return "image";
    }
    return null;
  }, []);

  // Helper function to open PDF data URI in a new tab
  const openPdfInNewTab = useCallback((dataUri: string) => {
    // If it's a server URL, open it directly
    if (dataUri.startsWith('/api/uploads/')) {
      window.open(dataUri, '_blank');
      return;
    }
    if (/^https?:\/\//i.test(dataUri)) {
      try {
        const u = new URL(dataUri);
        if (u.pathname.startsWith('/api/uploads/')) {
          window.open(dataUri, '_blank');
          return;
        }
      } catch {
        /* fall through */
      }
    }
    
    try {
      // Convert data URI to blob
      const byteString = atob(dataUri.split(',')[1]);
      const mimeString = dataUri.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      const url = URL.createObjectURL(blob);
      
      // Open in new tab
      const newWindow = window.open(url, '_blank');
      if (newWindow) {
        // Clean up the object URL after a delay to allow the browser to load it
        setTimeout(() => URL.revokeObjectURL(url), 100);
      } else {
        // If popup blocked, revoke immediately
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error opening PDF:', error);
      // Fallback: try opening directly
      window.open(dataUri, '_blank');
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId !== null) {
        const menuElement = menuRefs.current[openMenuId];
        if (menuElement && !menuElement.contains(event.target as Node)) {
          setOpenMenuId(null);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openMenuId]);

  // Calculate menu position (above or below) when it opens
  useEffect(() => {
    if (openMenuId !== null) {
      const buttonElement = menuRefs.current[openMenuId];
      const menuElement = menuElementRefs.current[openMenuId];
      
      if (buttonElement) {
        // Use requestAnimationFrame to ensure menu is rendered
        requestAnimationFrame(() => {
          const buttonRect = buttonElement.getBoundingClientRect();
          const menuHeight = menuElement?.offsetHeight || 200; // Approximate height if not measured yet
          const spaceBelow = window.innerHeight - buttonRect.bottom;
          const spaceAbove = buttonRect.top;
          
          // Position above if there's not enough space below, or if there's more space above
          const shouldPositionAbove = spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow;
          
          setMenuPositionAbove(prev => ({
            ...prev,
            [openMenuId]: shouldPositionAbove
          }));
        });
      }
    }
  }, [openMenuId]);

  // Handle Esc key to close view modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && viewModalOrderId) {
        closeViewModal();
      }
    };

    if (viewModalOrderId) {
      document.addEventListener("keydown", handleEscKey);
      return () => {
        document.removeEventListener("keydown", handleEscKey);
      };
    }
  }, [viewModalOrderId, closeViewModal]);

  // Handle Esc key to close unified new order modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && unifiedOrder.isOpen) {
        unifiedOrder.closeModal();
      }
    };

    if (unifiedOrder.isOpen) {
      document.addEventListener("keydown", handleEscKey);
      return () => {
        document.removeEventListener("keydown", handleEscKey);
      };
    }
  }, [unifiedOrder.isOpen, unifiedOrder.closeModal]);

  // Handle Esc key to close viewer modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && viewerModal) {
        setViewerModal(null);
      }
    };

    if (viewerModal) {
      document.addEventListener("keydown", handleEscKey);
      return () => {
        document.removeEventListener("keydown", handleEscKey);
      };
    }
  }, [viewerModal]);

  // Column management and rendering is now handled by OrdersTable component

  const makePaymentOrder = orders.find((o) => o.id === makePaymentModalOrderId);

  const { data: customerBeneficiaries = [] } = useGetCustomerBeneficiariesQuery(
    makePaymentOrder?.customerId ?? 0,
    { skip: !makePaymentOrder?.customerId },
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("orders.title")}
        // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
        // description={t("orders.titledescription")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {isLoading ? t("common.loading") : `${totalOrders} ${t("orders.orders")}`}
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setOrdersPageTab("list")}
                className={`rounded-md px-3 py-1.5 ${
                  ordersPageTab === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`}
              >
                {t("orders.tabList")}
              </button>
              <button
                type="button"
                onClick={() => setOrdersPageTab("batch")}
                className={`rounded-md px-3 py-1.5 ${
                  ordersPageTab === "batch" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`}
              >
                {t("orders.tabBatch")}
              </button>
            </div>
            {hasActionPermission(authUser, "createOrder") && (
              <button
                type="button"
                onClick={() => unifiedOrder.openNew()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition-colors"
              >
                {t("orders.newOrder")}
              </button>
            )}
            {canDeleteManyOrders && (
              <button
                onClick={() => {
                  if (!isBatchDeleteMode) {
                    setIsBatchDeleteMode(true);
                    setIsBatchTagMode(false); // Exit batch tag mode if active
                    setSelectedOrderIds([]);
                  } else {
                    // Toggle will handle confirmation modal
                    toggleBatchDeleteMode();
                  }
                }}
                disabled={isDeleting}
                className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              >
                {isDeleting 
                  ? t("common.deleting") 
                  : isBatchDeleteMode 
                    ? (selectedOrderIds.length > 0 ? t("orders.deleteSelected") : t("common.cancel"))
                    : t("orders.batchDelete")}
              </button>
            )}
            {hasActionPermission(authUser, "assignUnassignOrderTag") && (
              <button
                onClick={async () => {
                  if (!isBatchTagMode) {
                    // Enable batch tag mode
                    setIsBatchTagMode(true);
                    setIsBatchDeleteMode(false); // Exit batch delete mode if active
                    setSelectedOrderIds([]);
                  } else {
                    // If no orders selected, exit batch tag mode
                    if (!selectedOrderIds.length) {
                      setIsBatchTagMode(false);
                      setSelectedOrderIds([]);
                      return;
                    }
                    // Open tag selection modal
                    setIsTagModalOpen(true);
                  }
                }}
                disabled={isTagging}
                className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              >
                {isTagging 
                  ? t("orders.tagging")
                  : isBatchTagMode 
                    ? (selectedOrderIds.length > 0 ? t("orders.addTags") : t("common.cancel"))
                    : t("orders.addTag")}
              </button>
            )}
            {hasActionPermission(authUser, "importOrder") && (
              <button
                onClick={() => setImportModalOpen(true)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                {t("orders.import")}
              </button>
            )}
            <OrdersColumnDropdown
              isOpen={isColumnDropdownOpen}
              onToggle={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)}
              availableColumns={availableColumns}
              visibleColumns={visibleColumns}
              onToggleColumn={toggleColumnVisibility}
              draggedColumnIndex={draggedColumnIndex}
              dragOverIndex={dragOverIndex}
              onDragStart={handleColumnDragStart}
              onDragOver={handleColumnDragOver}
              onDragEnd={handleColumnDragEnd}
              onDragLeave={handleColumnDragLeave}
              dropdownRef={columnDropdownRef}
              t={t}
            />
          </div>
        }
      >
        {ordersPageTab === "list" ? (
          <>
            <OrdersFilters
              filters={filters}
              isExpanded={isFilterExpanded}
              onToggleExpanded={() => setIsFilterExpanded(!isFilterExpanded)}
              onDatePresetChange={handleDatePresetChange}
              onFilterChange={updateFilter}
              onClearFilters={handleClearFilters}
              onExport={handleExportOrders}
              isExporting={isExporting}
              canExport={hasActionPermission(authUser, "exportOrder")}
              isTagFilterOpen={isTagFilterOpen}
              setIsTagFilterOpen={setIsTagFilterOpen}
              tagFilterHighlight={tagFilterHighlight}
              setTagFilterHighlight={setTagFilterHighlight}
              tagFilterListRef={tagFilterListRef}
              onTagFilterKeyDown={handleTagFilterKeyDown}
              users={users}
              customers={customers}
              currencyPairs={currencyPairs}
              tags={tags}
              selectedTagNames={selectedTagNames}
              tagFilterLabel={tagFilterLabel}
              totalCalculatedProfit={totalCalculatedProfit}
              totalCalculatedProfitCurrency={totalCalculatedProfitCurrency}
              isOrdersLoading={isLoading}
            />

            <OrdersTable
              orders={orders}
              accounts={accounts}
              customers={customers}
              users={users}
              currencyByCode={currencyByCode}
              columnOrder={columnOrder}
              visibleColumns={visibleColumns}
              getColumnLabel={getColumnLabel}
              showCheckbox={isBatchTagMode || (canDeleteManyOrders && isBatchDeleteMode)}
              selectedOrderIds={selectedOrderIds}
              onSelectOrder={(orderId, selected) => {
                if (selected) {
                  setSelectedOrderIds((prev: number[]) =>
                    prev.includes(orderId) ? prev : [...prev, orderId]
                  );
                } else {
                  setSelectedOrderIds((prev: number[]) => prev.filter((id: number) => id !== orderId));
                }
              }}
              onSelectAll={(selected) => {
                setSelectedOrderIds(selected ? orders.map((o) => o.id) : []);
              }}
              openMenuId={openMenuId}
              menuPositionAbove={menuPositionAbove}
              menuRefs={menuRefs}
              menuElementRefs={menuElementRefs}
              onMenuToggle={(orderId) => setOpenMenuId(openMenuId === orderId ? null : orderId)}
              authUser={authUser}
              onEdit={startEdit}
              onProcess={() => {}}
              onView={(orderId) => {
                setViewModalOrderId(orderId);
                setOpenMenuId(null);
              }}
              onCancel={(orderId) => setStatus(orderId, "cancelled")}
              onDelete={handleDeleteClick}
              canCancelOrder={canCancelOrder}
              canDeleteOrder={canDeleteOrder}
              canEditAnyOrder={canEditAnyOrder}
              isDeleting={isDeleting}
              currentPage={currentPage}
              totalPages={totalPages}
              totalOrders={totalOrders}
              onPageChange={setCurrentPage}
              pinnedOrderIds={pinnedOrderIds}
              onReorderPinned={authUser && canPinOrders ? handleReorderPinnedRows : undefined}
              onPinOrder={authUser && canPinOrders ? handlePinOrder : undefined}
              onUnpinOrder={authUser && canPinOrders ? handleUnpinOrder : undefined}
              closeOrderMenu={() => setOpenMenuId(null)}
              canPinOrders={canPinOrders}
            />
          </>
        ) : (
          <BatchOrdersTab
            currencies={currencies}
            accounts={accounts}
            onDone={() => setOrdersPageTab("list")}
            setAlertModal={setAlertModal}
          />
        )}
      </SectionCard>

      <NewOrderModal
        isOpen={unifiedOrder.isOpen}
        isSaving={unifiedOrder.isSaving}
        editingOrderId={unifiedOrder.editingOrderId}
        customerName={unifiedOrder.customerName}
        setCustomerName={unifiedOrder.setCustomerName}
        users={users}
        handlerId={unifiedOrder.handlerId}
        setHandlerId={unifiedOrder.setHandlerId}
        userId={authUser?.id ?? undefined}
        fromCurrency={unifiedOrder.fromCurrency}
        setFromCurrency={unifiedOrder.setFromCurrency}
        toCurrency={unifiedOrder.toCurrency}
        setToCurrency={unifiedOrder.setToCurrency}
        amountBuy={unifiedOrder.amountBuy}
        amountSell={unifiedOrder.amountSell}
        rate={unifiedOrder.rate}
        onAmountBuyChange={unifiedOrder.handleAmountBuyChange}
        onAmountSellChange={unifiedOrder.handleAmountSellChange}
        onRateChange={unifiedOrder.handleRateChange}
        lines={unifiedOrder.lines}
        setLines={unifiedOrder.setLines}
        remarks={unifiedOrder.remarks}
        setRemarks={unifiedOrder.setRemarks}
        showRemarks={unifiedOrder.showRemarks}
        setShowRemarks={unifiedOrder.setShowRemarks}
        tags={tags}
        customers={customers}
        selectedTagIds={unifiedOrder.selectedTagIds}
        setSelectedTagIds={unifiedOrder.setSelectedTagIds}
        showTagPicker={unifiedOrder.showTagPicker}
        setShowTagPicker={unifiedOrder.setShowTagPicker}
        orderDate={unifiedOrder.orderDate}
        setOrderDate={unifiedOrder.setOrderDate}
        currencies={currencies}
        accounts={accounts}
        accountOptionsByKind={{
          receipt: orderAccounts,
          payment: orderAccounts,
          profit: profitAccounts,
          service_charge: serviceChargeAccounts,
        }}
        handleNumberInputWheel={handleNumberInputWheel}
        onSave={unifiedOrder.handleSave}
        onComplete={unifiedOrder.handleComplete}
        onClose={unifiedOrder.closeModal}
        onOpenCreateCustomer={() => setIsCreateCustomerModalOpen(true)}
        onAutoFill={unifiedOrder.fillReceiptPaymentFromTotals}
        prepaidBalance={unifiedOrder.prepaidBalance}
        advanceBalance={unifiedOrder.advanceBalance}
        fundingSummary={unifiedOrder.fundingSummary}
        fundingSummaryLoading={unifiedOrder.fundingSummaryLoading}
        orderMode={unifiedOrder.orderMode}
        setOrderMode={unifiedOrder.setOrderMode}
        isLedgerSwap={unifiedOrder.isLedgerSwap}
        selectedCustomerId={unifiedOrder.selectedCustomerId}
        addLineRow={unifiedOrder.addLineRow}
        addPresetServiceCharge={unifiedOrder.addPresetServiceCharge}
        viewerModal={newOrderViewerModal}
        setViewerModal={setNewOrderViewerModal}
        canDepositWithdraw={canDepositWithdraw}
        onOpenLedgerEntry={() => setLedgerEntryModal({ open: true, type: "credit" })}
      />

      {ledgerEntryModal.open && unifiedOrder.selectedCustomerId ? (
        <CustomerLedgerEntryFormModal
          key={`${unifiedOrder.selectedCustomerId}-${ledgerEntryModal.type}`}
          customerId={unifiedOrder.selectedCustomerId}
          initialType={ledgerEntryModal.type}
          defaultCurrencyCode={
            ledgerEntryModal.type === "credit"
              ? unifiedOrder.fromCurrency
              : unifiedOrder.toCurrency
          }
          currencies={currencies}
          overlayClassName="z-[8100]"
          onClose={() => setLedgerEntryModal({ open: false, type: "credit" })}
          onError={(msg) => setAlertModal({ isOpen: true, message: msg, type: "error" })}
        />
      ) : null}

      {/* Create Customer Modal */}
      <CreateCustomerModal
        isOpen={isCreateCustomerModalOpen}
        customerForm={customerForm}
        setCustomerForm={setCustomerForm}
        isCreatingCustomer={isCreatingCustomer}
        onClose={() => {
          setIsCreateCustomerModalOpen(false);
          resetCustomerForm();
        }}
        onSubmit={handleCreateCustomer}
      />

      {viewModalOrderId && orderDetails && (
        <ViewOrderModal
          isOpen={!!viewModalOrderId}
          onClose={closeViewModal}
          title={t("orders.orderDetails")}
        >
          <div className="space-y-4">
            <OnlineOrderSummary
              orderDetails={orderDetails}
              accounts={accounts}
              viewModalOrderId={viewModalOrderId}
              confirmReceipt={confirmReceipt}
              deleteReceipt={deleteReceipt}
              confirmPayment={confirmPayment}
              deletePayment={deletePayment}
              getFileType={getFileType}
              setViewerModal={setViewerModal}
              openPdfInNewTab={openPdfInNewTab}
              t={t}
            />

            {renderProfitServiceCharges()}
            {renderRemarks()}
          </div>
        </ViewOrderModal>
      )}

      {/* Image/PDF Viewer Modal */}
      {viewerModal && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-75" style={{ margin: 0, padding: 0 }}
          onClick={() => setViewerModal(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewerModal(null)}
              className="absolute top-2 right-2 z-10 bg-white hover:bg-slate-100 rounded-full p-2 shadow-lg transition-colors"
              aria-label={t("orders.close")}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <img
              src={viewerModal.src}
              alt={viewerModal.title}
              className="max-w-full max-h-[95vh] w-auto h-auto mx-auto object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        message={alertModal.message}
        type={alertModal.type || "error"}
        onClose={() => setAlertModal({ isOpen: false, message: "", type: "error" })}
      />

      {/* Tag Selection Modal */}
      <TagSelectionModal
        isOpen={isTagModalOpen}
        onClose={handleCloseTagModal}
        tags={tags}
        selectedTagIds={selectedTagIds}
        onTagSelectionChange={handleTagSelectionChange}
        onApply={handleApplyTags}
        onRemove={handleRemoveTags}
        isApplying={isTagging}
        isRemoving={isUntagging}
        t={t}
      />

      {/* Delete confirmation modal (for delete operations) */}
      <ConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        message={deleteConfirmModal.message}
        onConfirm={() => {
          if (deleteConfirmModal.isBulk) {
            handleBulkDelete();
          } else if (deleteConfirmModal.orderId !== null && deleteConfirmModal.orderId > 0) {
            handleDelete(deleteConfirmModal.orderId);
          }
        }}
        onCancel={() => setDeleteConfirmModal({ isOpen: false, message: "", orderId: null, isBulk: false })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />


      {/* Import Orders Modal */}
      <ImportOrdersModal
        isOpen={importModalOpen}
        isImporting={isImporting}
        onClose={() => setImportModalOpen(false)}
        onFileChange={handleImportFile}
        onDownloadTemplate={handleDownloadTemplate}
      />
    </div>
  );
}

