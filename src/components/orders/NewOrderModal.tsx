import React, { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  Account,
  Currency,
  CustomerFundingBalanceRow,
  CustomerLedgerBalanceInfo,
  Tag,
} from "../../types";
import Badge from "../common/Badge";
import type { UnifiedLine, UnifiedLineKind } from "../../hooks/orders/useUnifiedOrderModal";
import { CurrencyPairSwapButton } from "./CurrencyPairSwapButton";
import { AccountSelect } from "../common/AccountSelect";
import { CustomerSelect } from "../common/CustomerSelect";
import FileUploadModal from "../common/FileUploadModal";
import { CustomerFundingSummaryInline } from "./CustomerFundingSummaryInline";

export type NewOrderViewerState = {
  isOpen: boolean;
  src: string;
  type: "image" | "pdf";
  title: string;
} | null;

type Props = {
  isOpen: boolean;
  isSaving: boolean;
  editingOrderId: number | null;
  customerName: string;
  setCustomerName: (v: string) => void;
  users: { id: number; name: string; role?: string }[];
  handlerId: string;
  setHandlerId: (v: string) => void;
  userId?: number;
  fromCurrency: string;
  setFromCurrency: (v: string) => void;
  toCurrency: string;
  setToCurrency: (v: string) => void;
  amountBuy: string;
  amountSell: string;
  rate: string;
  onAmountBuyChange: (v: string) => void;
  onAmountSellChange: (v: string) => void;
  onRateChange: (v: string) => void;
  lines: UnifiedLine[];
  setLines: React.Dispatch<React.SetStateAction<UnifiedLine[]>>;
  remarks: string;
  setRemarks: (v: string) => void;
  showRemarks: boolean;
  setShowRemarks: (v: boolean) => void;
  tags: Tag[];
  customers: { id: number; name: string }[];
  selectedTagIds: number[];
  setSelectedTagIds: React.Dispatch<React.SetStateAction<number[]>>;
  showTagPicker: boolean;
  setShowTagPicker: (v: boolean) => void;
  orderDate: string;
  setOrderDate: (v: string) => void;
  currencies: Currency[];
  accounts: Account[];
  accountOptionsByKind?: Partial<Record<UnifiedLineKind, Account[]>>;
  handleNumberInputWheel: (e: React.WheelEvent<HTMLInputElement>) => void;
  onSave: (e: FormEvent) => void;
  onComplete: (e: FormEvent) => void;
  onClose: () => void;
  onOpenCreateCustomer: () => void;
  onAutoFill: () => void;
  addLineRow: (kind: UnifiedLineKind) => void;
  addPresetServiceCharge: (amount: string) => void;
  viewerModal: NewOrderViewerState;
  setViewerModal: (v: NewOrderViewerState) => void;
  selectedCustomerId?: number | null;
  prepaidBalance?: CustomerLedgerBalanceInfo;
  advanceBalance?: CustomerLedgerBalanceInfo;
  fundingSummary?: CustomerFundingBalanceRow[];
  fundingSummaryLoading?: boolean;
};

const kindLabel = (k: UnifiedLineKind, t: (k: string) => string) => {
  switch (k) {
    case "receipt":
      return t("orders.lineReceipt");
    case "payment":
      return t("orders.linePayment");
    case "profit":
      return t("orders.profit");
    case "service_charge":
      return t("orders.serviceCharges");
    default:
      return k;
  }
};

export function formatLedgerAmount(amount: number) {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function OrderLineBalanceField({
  messageKey,
  amount,
  currency,
  variant = "prepaid",
  t,
}: {
  messageKey: string;
  amount: number;
  currency: string;
  variant?: "prepaid" | "advance";
  t: (key: string, opts?: Record<string, string>) => string;
}) {
  const hasFunds = amount > 0;
  const tone =
    variant === "advance"
      ? hasFunds
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-600"
      : hasFunds
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div
      className={`flex min-h-[34px] min-w-[240px] flex-[1_1_240px] items-center rounded-lg border px-3 py-1.5 text-sm ${tone}`}
    >
      {t(messageKey, { amount: formatLedgerAmount(amount), currency })}
    </div>
  );
}

type CurrencySelectorProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currencies: Currency[];
  excludeCurrency: string;
  storageKey: string;
  t: (k: string) => string;
};

function CurrencySelector({
  label,
  value,
  onChange,
  currencies,
  excludeCurrency,
  storageKey,
  t,
}: CurrencySelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Custom order persisted in localStorage (per user, per direction)
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Re-load when storageKey changes (different user logs in)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setCustomOrder(raw ? JSON.parse(raw) : []);
    } catch {
      setCustomOrder([]);
    }
  }, [storageKey]);

  // Persist whenever order changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(customOrder));
    } catch { /* ignore */ }
  }, [storageKey, customOrder]);

  // Drag-and-drop state
  const [draggedCode, setDraggedCode] = useState<string | null>(null);
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);

  const availableCurrencies = useMemo(() => {
    return currencies.filter((c) => c.code !== excludeCurrency);
  }, [currencies, excludeCurrency]);

  // Full sorted list: custom-ordered first, then remaining alphabetically
  const effectiveOrder = useMemo(() => {
    const inOrder = customOrder
      .filter((code) => availableCurrencies.some((c) => c.code === code))
      .map((code) => availableCurrencies.find((c) => c.code === code)!);
    const rest = availableCurrencies
      .filter((c) => !customOrder.includes(c.code))
      .sort((a, b) => a.code.localeCompare(b.code));
    return [...inOrder, ...rest];
  }, [availableCurrencies, customOrder]);

  const filteredCurrencies = useMemo(() => {
    if (!searchQuery.trim()) return effectiveOrder;
    const q = searchQuery.toLowerCase();
    return effectiveOrder.filter((c) => c.code.toLowerCase().includes(q));
  }, [effectiveOrder, searchQuery]);

  const handleDrop = (targetCode: string) => {
    if (!draggedCode || draggedCode === targetCode) return;
    const fullOrder = effectiveOrder.map((c) => c.code);
    const from = fullOrder.indexOf(draggedCode);
    const to = fullOrder.indexOf(targetCode);
    if (from === to) return;
    const next = [...fullOrder];
    next.splice(from, 1);
    next.splice(to, 0, draggedCode);
    setCustomOrder(next);
  };

  const selectedCurrency = currencies.find((c) => c.code === value);

  useEffect(() => {
    if (!isDropdownOpen) setHighlightedIndex(-1);
  }, [isDropdownOpen]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery]);

  useEffect(() => {
    if (isDropdownOpen && highlightedIndex >= 0 && listRef.current) {
      const optionElement = listRef.current.children[highlightedIndex] as HTMLElement;
      optionElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlightedIndex, isDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  const handleSelect = (code: string) => {
    onChange(code);
    setSearchQuery("");
    setIsDropdownOpen(false);
    setHighlightedIndex(-1);
  };

  const handleClear = () => {
    onChange("");
    setSearchQuery("");
    setIsDropdownOpen(true);
  };

  return (
    <div className="min-w-0">
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative" ref={containerRef}>
        <input
          type="text"
          className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm ${value ? "pr-20" : "pr-10"}`}
          placeholder={t("orders.selectCurrency")}
          value={isDropdownOpen ? searchQuery : selectedCurrency?.code || ""}
          onFocus={() => {
            setIsDropdownOpen(true);
            if (value) setSearchQuery(selectedCurrency?.code || "");
          }}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsDropdownOpen(true);
            if (!e.target.value) onChange("");
          }}
          onKeyDown={(e) => {
            if (!isDropdownOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
              e.preventDefault();
              setIsDropdownOpen(true);
              return;
            }
            if (!isDropdownOpen) return;
            switch (e.key) {
              case "ArrowDown":
                e.preventDefault();
                setHighlightedIndex((prev) => (prev < filteredCurrencies.length - 1 ? prev + 1 : 0));
                break;
              case "ArrowUp":
                e.preventDefault();
                setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredCurrencies.length - 1));
                break;
              case "Enter":
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < filteredCurrencies.length) {
                  handleSelect(filteredCurrencies[highlightedIndex].code);
                }
                break;
              case "Escape":
                e.preventDefault();
                setIsDropdownOpen(false);
                setHighlightedIndex(-1);
                break;
              case "Tab":
                setIsDropdownOpen(false);
                setHighlightedIndex(-1);
                setSearchQuery("");
                break;
            }
          }}
        />
        {value ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="absolute right-10 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
            title={t("common.clear")}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("orders.selectCurrency")}
          onClick={(e) => {
            e.preventDefault();
            setIsDropdownOpen((prev) => !prev);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
        >
          <svg
            className={`h-5 w-5 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isDropdownOpen ? (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {filteredCurrencies.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">{t("orders.selectCurrency")}</div>
            ) : (
              <div ref={listRef}>
                {filteredCurrencies.map((currency, index) => {
                  const isSelected = currency.code === value;
                  const isHighlighted = highlightedIndex === index;
                  const isDragging = draggedCode === currency.code;
                  const isDragOver = dragOverCode === currency.code;
                  return (
                    <div
                      key={currency.code}
                      className={`flex cursor-pointer items-center justify-between px-3 py-2 transition-colors ${
                        isHighlighted ? "bg-blue-100 text-blue-900" : isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                      } ${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-t-2 border-blue-500" : ""}`}
                      onClick={() => handleSelect(currency.code)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverCode(currency.code); }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(currency.code); setDraggedCode(null); setDragOverCode(null); }}
                      onDragLeave={() => setDragOverCode(null)}
                    >
                      <span className="truncate font-medium text-slate-900">{currency.code}</span>
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", currency.code);
                          setDraggedCode(currency.code);
                        }}
                        onDragEnd={() => { setDraggedCode(null); setDragOverCode(null); }}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-3 shrink-0 cursor-move select-none text-slate-400 hover:text-slate-600"
                        style={{ userSelect: "none" }}
                      >
                        <svg className="h-4 w-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function NewOrderModal({
  isOpen,
  isSaving,
  editingOrderId,
  customerName,
  setCustomerName,
  users,
  handlerId,
  setHandlerId,
  userId,
  fromCurrency,
  setFromCurrency,
  toCurrency,
  setToCurrency,
  amountBuy,
  amountSell,
  rate,
  onAmountBuyChange,
  onAmountSellChange,
  onRateChange,
  lines,
  setLines,
  remarks,
  setRemarks,
  showRemarks,
  setShowRemarks,
  tags,
  customers,
  selectedTagIds,
  setSelectedTagIds,
  showTagPicker,
  setShowTagPicker,
  orderDate,
  setOrderDate,
  currencies,
  accounts,
  accountOptionsByKind,
  handleNumberInputWheel,
  onSave,
  onComplete,
  onClose,
  onOpenCreateCustomer,
  onAutoFill,
  addLineRow,
  addPresetServiceCharge,
  viewerModal,
  setViewerModal,
  selectedCustomerId: selectedCustomerIdProp,
  prepaidBalance,
  advanceBalance,
  fundingSummary = [],
  fundingSummaryLoading = false,
}: Props) {
  const { t } = useTranslation();
  const [uploadModalLineId, setUploadModalLineId] = useState<string | null>(null);

  if (!isOpen) return null;

  const activeCurrencies = currencies.filter((c) => c.active);
  const selectedCustomerId = (() => {
    if (selectedCustomerIdProp) return String(selectedCustomerIdProp);
    const match = customers.find((c) => c.name.toLowerCase() === customerName.trim().toLowerCase());
    return match ? String(match.id) : "";
  })();

  const updateLine = (localId: string, patch: Partial<UnifiedLine>) => {
    setLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)));
  };

  const clearLineRow = (localId: string) => {
    updateLine(localId, {
      amount: "",
      accountId: "",
      file: null,
      serverImagePath: undefined,
      serverReceiptId: undefined,
      serverPaymentId: undefined,
    });
  };

  const removeLineRow = (localId: string) => {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
  };
// 我 filter dropdown list for currencies
  const accountOptionsForLine = (line: UnifiedLine) => {
    const sourceAccounts = accountOptionsByKind?.[line.kind] || accounts;
    if (line.kind === "receipt" || line.kind === "profit") {
      return sourceAccounts.filter((a) => a.currencyCode === fromCurrency);
    }
    if (line.kind === "payment") {
      return sourceAccounts.filter((a) => a.currencyCode === toCurrency);
    }
    if (line.kind === "service_charge") {
      if (line.serviceChargeCurrency) {
        return sourceAccounts.filter((a) => a.currencyCode === line.serviceChargeCurrency);
      }
      return [];
    }
    return sourceAccounts;
  };

  return (
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-order-modal-title"
    >
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 id="new-order-modal-title" className="text-lg font-semibold text-slate-900">
            {editingOrderId ? t("orders.editOrderTitle") : t("orders.newOrder")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <form className="space-y-5 px-6 py-5" onSubmit={(e) => e.preventDefault()}>
          {/* Row 1: Customer + Handler (hints below so handler stays aligned with customer select) */}
          <div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-end">
              <div className="min-w-0">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("orders.customerName")}
                </label>
                <div className="flex items-end gap-2">
                  <CustomerSelect
                    value={selectedCustomerId}
                    onChange={(value) => {
                      const selected = customers.find((c) => c.id === Number(value));
                      setCustomerName(selected?.name || "");
                    }}
                    customers={customers}
                    placeholder={t("orders.selectCustomer") || "Select customer"}
                    required
                    disabled={!!editingOrderId}
                    t={t}
                  />
                  {!editingOrderId ? (
                    <button
                      type="button"
                      onClick={onOpenCreateCustomer}
                      className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 whitespace-nowrap"
                    >
                      {t("orders.createNewCustomer")}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {t("orders.handler")}{" "}
                  <span className="text-xs font-normal text-slate-400">({t("common.optional")})</span>
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                  value={handlerId}
                  onChange={(e) => setHandlerId(e.target.value)}
                >
                  <option value="">{t("orders.noHandler")}</option>
                  {users
                    .filter((u) => u.role !== "admin")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            {editingOrderId ? (
              <p className="mt-1 text-xs text-slate-500">{t("orders.customerNameLockedWhenEditing")}</p>
            ) : null}
            {selectedCustomerId ? (
              <CustomerFundingSummaryInline
                items={fundingSummary}
                loading={fundingSummaryLoading}
              />
            ) : null}
          </div>

          {/* Row 2: Currency pair */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-end">
            <div className="min-w-0">
              <CurrencySelector
                label={t("orders.from")}
                value={fromCurrency}
                onChange={setFromCurrency}
                currencies={activeCurrencies}
                excludeCurrency={toCurrency}
                storageKey={userId ? `currency_order_from_user_${userId}` : "currency_order_from_guest"}
                t={t}
              />
            </div>
            <div className="flex justify-center xl:pb-0.5">
              <CurrencyPairSwapButton
                label={t("orders.swapCurrencies")}
                disabled={!fromCurrency && !toCurrency}
                onClick={() => {
                  const wasFrom = fromCurrency;
                  const wasTo = toCurrency;
                  setFromCurrency(wasTo);
                  setToCurrency(wasFrom);
                }}
              />
            </div>
            <div className="min-w-0">
              <CurrencySelector
                label={t("orders.to")}
                value={toCurrency}
                onChange={setToCurrency}
                currencies={activeCurrencies}
                excludeCurrency={fromCurrency}
                storageKey={userId ? `currency_order_to_user_${userId}` : "currency_order_to_guest"}
                t={t}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("orders.exchangeRate")}</label>
              <input
                type="number"
                step="0.0001"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={rate}
                onChange={(e) => onRateChange(e.target.value)}
                onWheel={handleNumberInputWheel}
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("orders.amountBuy")}</label>
              <input
                type="number"
                step="0.0001"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={amountBuy}
                onChange={(e) => onAmountBuyChange(e.target.value)}
                onWheel={handleNumberInputWheel}
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("orders.amountSell")}</label>
              <input
                type="number"
                step="0.0001"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={amountSell}
                onChange={(e) => onAmountSellChange(e.target.value)}
                onWheel={handleNumberInputWheel}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={onAutoFill}
                disabled={
                  !amountBuy ||
                  !amountSell ||
                  Number(amountBuy) <= 0 ||
                  Number(amountSell) <= 0
                }
                title={t("orders.autoFillTooltip")}
                className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("orders.autoFill")}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            {/* <h3 className="text-sm font-semibold text-slate-800">{t("orders.linesSection")}</h3> */}
          </div>
          <div>
            <div className="space-y-3">
              {lines.map((line) => {
                const isServiceCharge = line.kind === "service_charge";
                const isPercentMode = isServiceCharge && line.serviceChargeMode === "percentage";

                // Compute live preview for percentage mode
                let computedPreview: string | null = null;
                if (isPercentMode && line.serviceChargePercent && line.serviceChargeCurrency) {
                  const pct = Number(line.serviceChargePercent);
                  if (!Number.isNaN(pct) && pct !== 0) {
                    const base = line.serviceChargeCurrency === fromCurrency
                      ? Number(amountBuy || 0)
                      : Number(amountSell || 0);
                    if (base > 0) {
                      const result = (pct / 100) * base;
                      computedPreview = `≈ ${result.toFixed(2)} ${line.serviceChargeCurrency}`;
                    }
                  }
                }

                return (
                <div
                  key={line.localId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3"
                >
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase text-slate-500">
                    {kindLabel(line.kind, t)}
                  </span>

                  {isServiceCharge ? (
                    <div className="flex items-center gap-1.5">
                      {/* Mode toggle */}
                      <div className="flex rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
                        <button
                          type="button"
                          className={`px-2.5 py-1.5 transition-colors ${!isPercentMode ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                          onClick={() => updateLine(line.localId, { serviceChargeMode: "fixed", serviceChargePercent: "" })}
                        >
                          {t("orders.scFixed")}
                        </button>
                        <button
                          type="button"
                          className={`px-2.5 py-1.5 transition-colors ${isPercentMode ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                          onClick={() => updateLine(line.localId, { serviceChargeMode: "percentage", amount: "" })}
                        >
                          %
                        </button>
                      </div>

                      {isPercentMode ? (
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              className="w-24 rounded border border-slate-200 px-2 py-1.5 pr-6 text-sm"
                              value={line.serviceChargePercent ?? ""}
                              onChange={(e) => updateLine(line.localId, { serviceChargePercent: e.target.value })}
                              onWheel={handleNumberInputWheel}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                          </div>
                          {computedPreview ? (
                            <span className="text-xs font-medium text-emerald-600 whitespace-nowrap">
                              {computedPreview}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              {t("orders.scSelectAcctForPreview")}
                            </span>
                          )}
                        </div>
                      ) : (
                        <input
                          type="number"
                          placeholder={t("orders.amount")}
                          className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm"
                          value={line.amount}
                          onChange={(e) => updateLine(line.localId, { amount: e.target.value })}
                          onWheel={handleNumberInputWheel}
                        />
                      )}
                    </div>
                  ) : (
                  <input
                    type="number"
                    placeholder={t("orders.amount")}
                    className="w-24 rounded border border-slate-200 px-2 py-1.5 text-sm"
                    value={line.amount}
                    onChange={(e) => updateLine(line.localId, { amount: e.target.value })}
                    onWheel={handleNumberInputWheel}
                  />
                  )}
                  {isServiceCharge && (
                    <div className="flex shrink-0 rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "cash"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.receiptFundedCash")}
                        onClick={() => updateLine(line.localId, { fundedFrom: "cash" })}
                      >
                        {t("orders.receiptFundedCashShort")}
                      </button>
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "customer_balance"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.serviceChargeFundedBalance")}
                        disabled={!selectedCustomerId}
                        onClick={() =>
                          updateLine(line.localId, {
                            fundedFrom: "customer_balance",
                            accountId: "",
                          })
                        }
                      >
                        {t("orders.receiptFundedBalanceShort")}
                      </button>
                    </div>
                  )}
                  {isServiceCharge && (
                    <select
                      className="rounded border border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-white"
                      value={line.serviceChargeCurrency ?? ""}
                      onChange={(e) =>
                        updateLine(line.localId, {
                          serviceChargeCurrency: e.target.value,
                          accountId: "",
                        })
                      }
                    >
                      <option value="">{t("orders.selectCurrency")}</option>
                      {((line.fundedFrom ?? "cash") === "customer_balance"
                        ? (fundingSummary ?? [])
                            .filter((c) => c.allocatable >= 0.005)
                            .map((c) => c.currencyCode)
                        : activeCurrencies.map((c) => c.code)
                      ).map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  )}
                  {isServiceCharge &&
                    (line.fundedFrom ?? "cash") === "customer_balance" &&
                    line.serviceChargeCurrency && (
                      <OrderLineBalanceField
                        messageKey="orders.linePrepaidBalance"
                        amount={
                          fundingSummary?.find((c) => c.currencyCode === line.serviceChargeCurrency)
                            ?.allocatable ?? 0
                        }
                        currency={line.serviceChargeCurrency}
                        t={t}
                      />
                    )}
                  {line.kind === "receipt" && (
                    <div className="flex shrink-0 rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "cash"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.receiptFundedCash")}
                        onClick={() => updateLine(line.localId, { fundedFrom: "cash" })}
                      >
                        {t("orders.receiptFundedCashShort")}
                      </button>
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "customer_balance"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.receiptFundedBalance")}
                        onClick={() =>
                          updateLine(line.localId, {
                            fundedFrom: "customer_balance",
                            accountId: "",
                          })
                        }
                      >
                        {t("orders.receiptFundedBalanceShort")}
                      </button>
                    </div>
                  )}
                  {line.kind === "payment" && (
                    <div className="flex shrink-0 rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "cash"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.paymentFundedCash")}
                        onClick={() => updateLine(line.localId, { fundedFrom: "cash" })}
                      >
                        {t("orders.paymentFundedCashShort")}
                      </button>
                      <button
                        type="button"
                        className={`px-2.5 py-1.5 transition-colors ${
                          (line.fundedFrom ?? "cash") === "customer_balance"
                            ? "bg-slate-700 text-white"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title={t("orders.paymentFundedBalance")}
                        onClick={() =>
                          updateLine(line.localId, {
                            fundedFrom: "customer_balance",
                            accountId: "",
                          })
                        }
                      >
                        {t("orders.paymentFundedBalanceShort")}
                      </button>
                    </div>
                  )}
                  {line.kind === "receipt" &&
                    (line.fundedFrom ?? "cash") === "customer_balance" && (
                      <OrderLineBalanceField
                        messageKey="orders.linePrepaidBalance"
                        amount={prepaidBalance?.allocatable ?? 0}
                        currency={fromCurrency}
                        t={t}
                      />
                    )}
                  {line.kind === "payment" &&
                    (line.fundedFrom ?? "cash") === "customer_balance" && (
                      <OrderLineBalanceField
                        messageKey="orders.lineAdvanceBalance"
                        amount={advanceBalance?.allocatableAdvance ?? 0}
                        currency={toCurrency}
                        variant="advance"
                        t={t}
                      />
                    )}
                  {(line.kind === "profit" || (line.fundedFrom ?? "cash") === "cash") && (
                    <div className="min-w-[240px] flex-[1_1_240px] [&_input]:py-1.5 [&_input]:text-sm">
                      <AccountSelect
                        value={line.accountId}
                        onChange={(accountId) => updateLine(line.localId, { accountId })}
                        accounts={accountOptionsForLine(line)}
                        placeholder={
                          isServiceCharge && !line.serviceChargeCurrency
                            ? t("orders.selectCurrencyFirst")
                            : t("orders.selectAccount")
                        }
                        showBalance
                        showSelectedBalanceBelow={false}
                        showOptionBalanceInline
                        t={t}
                      />
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-2">
                  {line.file || line.serverImagePath ? (
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          if (line.file) {
                            const url = URL.createObjectURL(line.file);
                            const isPdf = line.file.type === "application/pdf";
                            setViewerModal({
                              isOpen: true,
                              src: url,
                              type: isPdf ? "pdf" : "image",
                              title: line.file.name,
                            });
                          } else if (line.serverImagePath) {
                            setViewerModal({
                              isOpen: true,
                              src: line.serverImagePath,
                              type: line.serverImagePath.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
                              title: t("orders.uploadedFile"),
                            });
                          }
                        }}
                      >
                        {t("orders.view")}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        title={t("orders.replaceUploadTooltip")}
                        onClick={() => setUploadModalLineId(line.localId)}
                      >
                        {t("orders.replaceUpload")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setUploadModalLineId(line.localId)}
                    >
                      {t("orders.upload")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    title={t("orders.clearLineRowTooltip")}
                    onClick={() => clearLineRow(line.localId)}
                  >
                    {t("common.clear")}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-dashed border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
                    title={t("common.remove")}
                    onClick={() => removeLineRow(line.localId)}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-dashed border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
                    title={t("orders.addLine")}
                    onClick={() => addLineRow(line.kind)}
                  >
                    +
                  </button>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:underline"
                onClick={() => addLineRow("receipt")}
              >
                + {t("orders.lineReceipt")}
              </button>
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:underline"
                onClick={() => addLineRow("payment")}
              >
                + {t("orders.linePayment")}
              </button>
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:underline"
                onClick={() => addLineRow("service_charge")}
              >
                + {t("orders.serviceCharges")}
              </button>
              <button
                type="button"
                title={t("orders.trxFeeTooltip")}
                className="text-xs font-medium text-orange-600 hover:underline"
                onClick={() => addPresetServiceCharge("-1.5")}
              >
                {t("orders.trxFee")}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!showRemarks ? (
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setShowRemarks(true)}
              >
                {t("orders.addRemarks")}
              </button>
            ) : null}
            {!showTagPicker ? (
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setShowTagPicker(true)}
              >
                {t("orders.tag")}
              </button>
            ) : null}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600 whitespace-nowrap">
                {t("orders.orderDate")}
              </label>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={orderDate.split("T")[0] ?? ""}
                onChange={(e) => {
                  const time = orderDate.split("T")[1] ?? "00:00";
                  setOrderDate(`${e.target.value}T${time}`);
                }}
              />
              <input
                type="time"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={orderDate.split("T")[1] ?? ""}
                onChange={(e) => {
                  const date = orderDate.split("T")[0] ?? new Date().toISOString().split("T")[0];
                  setOrderDate(`${date}T${e.target.value}`);
                }}
              />
            </div>
          </div>
          {showRemarks && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t("orders.remarks")}</label>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          )}

          {showTagPicker && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">{t("orders.tags")}</span>
                {tags.length > 0 && selectedTagIds.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-slate-600 hover:text-slate-900"
                    onClick={() => setSelectedTagIds([])}
                  >
                    {t("common.clear")}
                  </button>
                )}
              </div>
              {tags.length === 0 ? (
                <p className="text-sm text-slate-500">{t("orders.noTagsAvailable")}</p>
              ) : (
                <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedTagIds.includes(tag.id)}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelectedTagIds((prev) =>
                            on ? [...prev, tag.id] : prev.filter((id) => id !== tag.id),
                          );
                        }}
                      />
                      <Badge tone="slate" backgroundColor={tag.color}>
                        {tag.name}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={onSave}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {isSaving ? t("common.saving") : t("orders.saveOrder")}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={onComplete}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {isSaving ? t("common.saving") : t("orders.completeOrder")}
            </button>
          </div>
        </form>
      </div>

      {viewerModal?.isOpen ? (
        <div
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setViewerModal(null)}
        >
          <div
            className="max-h-[90vh] max-w-4xl overflow-auto rounded-lg bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex justify-between">
              <span className="font-medium">{viewerModal.title}</span>
              <button type="button" className="text-slate-500" onClick={() => setViewerModal(null)}>
                ✕
              </button>
            </div>
            {viewerModal.type === "image" ? (
              <img src={viewerModal.src} alt="" className="max-h-[80vh] max-w-full object-contain" />
            ) : (
              <iframe src={viewerModal.src} className="h-[80vh] w-full" title={viewerModal.title} />
            )}
          </div>
        </div>
      ) : null}
      <FileUploadModal
        isOpen={uploadModalLineId !== null}
        onClose={() => setUploadModalLineId(null)}
        onFileSelected={(file) => {
          if (uploadModalLineId) {
            updateLine(uploadModalLineId, { file, serverImagePath: undefined });
          }
          setUploadModalLineId(null);
        }}
      />
    </div>
  );
}
