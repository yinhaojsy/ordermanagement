import React, { useRef, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import { SearchableSelect } from "../common/SearchableSelect";
import type { OrderFilters, DatePreset } from "../../types/orders";
import type { OrderStatus, Tag, Customer, User, Currency } from "../../types";

interface OrdersFiltersProps {
  filters: OrderFilters;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onFilterChange: <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) => void;
  onClearFilters: () => void;
  onExport: () => void;
  isExporting: boolean;
  canExport?: boolean;
  // Tag filter state
  isTagFilterOpen: boolean;
  setIsTagFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tagFilterHighlight: number;
  setTagFilterHighlight: React.Dispatch<React.SetStateAction<number>>;
  tagFilterListRef: React.RefObject<HTMLDivElement | null>;
  onTagFilterKeyDown: (e: React.KeyboardEvent) => void;
  // Data
  users: User[];
  customers: import("../../types").CustomerOption[];
  currencyPairs: string[];
  tags: Tag[];
  selectedTagNames: string[];
  tagFilterLabel: string;
  // Profit summary
  totalCalculatedProfit?: number | null;
  totalCalculatedProfitCurrency?: string | null;
  isOrdersLoading?: boolean;
}

export function OrdersFilters({
  filters,
  isExpanded,
  onToggleExpanded,
  onDatePresetChange,
  onFilterChange,
  onClearFilters,
  onExport,
  isExporting,
  canExport = true,
  isTagFilterOpen,
  setIsTagFilterOpen,
  tagFilterHighlight,
  setTagFilterHighlight,
  tagFilterListRef,
  onTagFilterKeyDown,
  users,
  customers,
  currencyPairs,
  tags,
  selectedTagNames,
  tagFilterLabel,
  totalCalculatedProfit,
  totalCalculatedProfitCurrency,
  isOrdersLoading = false,
}: OrdersFiltersProps) {
  const { t } = useTranslation();

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).filter(([, v]) => {
      return v !== null && v !== 'all' && v !== 'custom' && (Array.isArray(v) ? v.length > 0 : v !== "");
    }).length;
  }, [filters]);

  useEffect(() => {
    if (isTagFilterOpen && tags.length > 0) {
      setTagFilterHighlight(0);
      // Move focus to the list for keyboard navigation
      setTimeout(() => tagFilterListRef.current?.focus(), 0);
    } else if (!isTagFilterOpen) {
      setTagFilterHighlight(-1);
    }
  }, [isTagFilterOpen, tags.length, setTagFilterHighlight, tagFilterListRef]);

  return (
    <div className="mb-4 border-b border-slate-200 pb-4">
      <button
        onClick={onToggleExpanded}
        className="flex items-center justify-between w-full text-left text-sm font-semibold text-slate-700 hover:text-slate-900 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg
            className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {t("orders.filters") || "Filters"}
        </span>
        <span className="text-xs font-normal text-slate-500">
          {activeFilterCount > 0 && `(${activeFilterCount} active)`}
        </span>
      </button>
      
      {isExpanded && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Date Preset */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t("orders.datePreset") || "Date Range"}
            </label>
            <select
              value={filters.datePreset}
              onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">{t("orders.all") || "All"}</option>
              <option value="currentWeek">{t("orders.currentWeek") || "Current Week"}</option>
              <option value="lastWeek">{t("orders.lastWeek") || "Last Week"}</option>
              <option value="currentMonth">{t("orders.currentMonth") || "Current Month"}</option>
              <option value="lastMonth">{t("orders.lastMonth") || "Last Month"}</option>
              <option value="custom">{t("orders.custom") || "Custom"}</option>
            </select>
          </div>

          {/* Date From */}
          {filters.datePreset === 'custom' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("orders.dateFrom") || "Date From"}
              </label>
              <input
                type="date"
                value={filters.dateFrom || ""}
                onChange={(e) => onFilterChange('dateFrom', e.target.value || null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Date To */}
          {filters.datePreset === 'custom' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("orders.dateTo") || "Date To"}
              </label>
              <input
                type="date"
                value={filters.dateTo || ""}
                onChange={(e) => onFilterChange('dateTo', e.target.value || null)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Handler */}
          <SearchableSelect
            value={filters.handlerId}
            onChange={(value) => onFilterChange('handlerId', value)}
            options={users.filter((user) => user.role !== "admin")}
            placeholder={t("orders.selectHandler") || "Type to search handlers..."}
            label={t("orders.handler") || "Handler"}
            allOptionLabel={t("orders.all") || "All"}
          />

          {/* Customer */}
          <SearchableSelect
            value={filters.customerId}
            onChange={(value) => onFilterChange('customerId', value)}
            options={customers}
            placeholder={t("orders.selectCustomer") || "Type to search customers..."}
            label={t("orders.customer") || "Customer"}
            allOptionLabel={t("orders.all") || "All"}
          />

          {/* Currency Pair multi-select */}
          <CurrencyPairFilter
            currencyPairs={currencyPairs}
            selectedPairs={filters.currencyPairs}
            onFilterChange={onFilterChange}
            t={t}
          />

          {/* Account keyword search (buy, sell, profit, service charge) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t("orders.filterAccount") || "Account"}
            </label>
            <input
              type="search"
              value={filters.accountSearch}
              onChange={(e) => onFilterChange("accountSearch", e.target.value)}
              placeholder={t("orders.filterAccountSearchPlaceholder") || "Search by account name..."}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t("orders.status") || "Status"}
            </label>
            <select
              value={filters.status || ""}
              onChange={(e) => onFilterChange('status', (e.target.value || null) as OrderStatus | null)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">{t("orders.all") || "All"}</option>
              <option value="saved">{t("orders.saved") || "Saved"}</option>
              <option value="completed">{t("orders.completed") || "Completed"}</option>
              <option value="cancelled">{t("orders.cancelled") || "Cancelled"}</option>
            </select>
          </div>

          {/* Tag Filter */}
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t("orders.tag")}
            </label>
            <button
              type="button"
              onClick={() => setIsTagFilterOpen((prev) => !prev)}
              onKeyDown={onTagFilterKeyDown}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm flex items-center justify-between hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <span
                className="truncate flex-1 min-w-0 text-left"
                title={selectedTagNames.length ? selectedTagNames.join(", ") : undefined}
              >
                {tagFilterLabel}
              </span>
              {filters.tagIds.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700 font-medium shrink-0">
                  {filters.tagIds.length}
                </span>
              )}
              <svg className="w-4 h-4 text-slate-500" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 8l4 4 4-4" />
              </svg>
            </button>
            {isTagFilterOpen && (
              <div
                ref={tagFilterListRef}
                tabIndex={0}
                onKeyDown={onTagFilterKeyDown}
                className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto p-2 focus:outline-none"
              >
                {tags.length === 0 && (
                  <div className="text-sm text-slate-500 px-2 py-1">
                    {t("orders.noTagsAvailable") || "No tags available"}
                  </div>
                )}
                {tags.map((tag: Tag, idx: number) => {
                  const isHighlighted = tagFilterHighlight === idx;
                  return (
                    <label
                      key={tag.id}
                      onMouseEnter={() => setTagFilterHighlight(idx)}
                      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${
                        isHighlighted ? "bg-blue-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={filters.tagIds.includes(tag.id)}
                        onChange={(e) => {
                          const exists = filters.tagIds.includes(tag.id);
                          const next = e.target.checked
                            ? [...filters.tagIds, tag.id]
                            : filters.tagIds.filter((id) => id !== tag.id);
                          onFilterChange('tagIds', next);
                        }}
                      />
                      <Badge tone="slate" backgroundColor={tag.color}>
                        {tag.name}
                      </Badge>
                    </label>
                  );
                })}
                {tags.length > 0 && (
                  <div className="flex justify-between items-center pt-2 mt-2 border-t border-slate-200">
                    <button
                      className="text-xs text-slate-600 hover:text-slate-900"
                      onClick={() => onFilterChange('tagIds', [])}
                    >
                      {t("common.clear") || "Clear"}
                    </button>
                    <button
                      className="text-xs text-blue-600 hover:text-blue-800"
                      onClick={() => setIsTagFilterOpen(false)}
                    >
                      {t("common.done") || "Done"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            <button
              onClick={onClearFilters}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t("orders.clearFilters") || "Clear Filters"}
            </button>
          </div>

          {/* Export Button */}
          {canExport && (
            <div className="flex items-end">
              <button
                onClick={onExport}
                disabled={isExporting}
                className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("orders.exporting") || "Exporting..."}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {t("orders.export") || "Export to Excel"}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Total Profit — always shown when filters are expanded */}
          <div className="flex flex-col justify-end">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {t("orders.totalProfit")}
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm flex items-center min-h-[42px]">
              {isOrdersLoading ? (
                <span className="text-slate-400">{t("common.loading")}</span>
              ) : totalCalculatedProfitCurrency &&
                totalCalculatedProfit !== null &&
                totalCalculatedProfit !== undefined ? (
                <span
                  className={`font-bold tabular-nums ${
                    totalCalculatedProfit >= 0 ? "text-blue-700" : "text-red-600"
                  }`}
                >
                  {totalCalculatedProfit > 0 ? "+" : ""}
                  {totalCalculatedProfit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  {totalCalculatedProfitCurrency}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CurrencyPairFilterProps {
  currencyPairs: string[];
  selectedPairs: string[];
  onFilterChange: <K extends keyof OrderFilters>(key: K, value: OrderFilters[K]) => void;
  t: (key: string) => string;
}

function CurrencyPairFilter({ currencyPairs, selectedPairs, onFilterChange, t }: CurrencyPairFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const label = useMemo(() => {
    if (selectedPairs.length === 0) return t("orders.all") || "All";
    if (selectedPairs.length === 1) return selectedPairs[0];
    return selectedPairs.join(", ");
  }, [selectedPairs, t]);

  const toggle = (pair: string) => {
    const next = selectedPairs.includes(pair)
      ? selectedPairs.filter((p) => p !== pair)
      : [...selectedPairs, pair];
    onFilterChange("currencyPairs", next);
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {t("orders.currencyPair") || "Currency Pair"}
      </label>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm flex items-center justify-between hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <span
          className="truncate flex-1 min-w-0 text-left"
          title={selectedPairs.length > 0 ? selectedPairs.join(", ") : undefined}
        >
          {label}
        </span>
        {selectedPairs.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-700 font-medium shrink-0">
            {selectedPairs.length}
          </span>
        )}
        <svg className="w-4 h-4 text-slate-500 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 8l4 4 4-4" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto p-2">
          {currencyPairs.length === 0 && (
            <div className="text-sm text-slate-500 px-2 py-1">
              {t("orders.noCurrencyPairs") || "No currency pairs available"}
            </div>
          )}
          {currencyPairs.map((pair) => (
            <label
              key={pair}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selectedPairs.includes(pair)}
                onChange={() => toggle(pair)}
              />
              <span className="text-sm text-slate-700">{pair}</span>
            </label>
          ))}
          {currencyPairs.length > 0 && (
            <div className="flex justify-between items-center pt-2 mt-2 border-t border-slate-200">
              <button
                className="text-xs text-slate-600 hover:text-slate-900"
                onClick={() => onFilterChange("currencyPairs", [])}
              >
                {t("common.clear") || "Clear"}
              </button>
              <button
                className="text-xs text-blue-600 hover:text-blue-800"
                onClick={() => setIsOpen(false)}
              >
                {t("common.done") || "Done"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

