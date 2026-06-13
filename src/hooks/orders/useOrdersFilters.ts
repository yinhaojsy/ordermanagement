import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { OrderFilters, OrderQueryParams, DatePreset } from "../../types/orders";
import { getCurrentWeekRange, getLastWeekRange, getCurrentMonthRange, getLastMonthRange } from "../../utils/orders/datePresets";

const defaultFilters: OrderFilters = {
  datePreset: 'all',
  dateFrom: null,
  dateTo: null,
  handlerId: null,
  customerId: null,
  currencyPairs: [],
  accountSearch: "",
  status: null,
  tagIds: [],
};

export function useOrdersFilters(
  currentPage: number,
  setCurrentPage: (page: number) => void,
  initialFilters?: Partial<OrderFilters>
) {
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    ...defaultFilters,
    ...initialFilters,
  }));
  const [debouncedAccountSearch, setDebouncedAccountSearch] = useState(
    () => (initialFilters?.accountSearch ?? "").trim(),
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAccountSearch(filters.accountSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [filters.accountSearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedAccountSearch, setCurrentPage]);

  // Apply initial filters if provided after mount
  useEffect(() => {
    if (initialFilters && Object.keys(initialFilters).length > 0) {
      setFilters((prev) => ({
        ...prev,
        ...initialFilters,
      }));
      setCurrentPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const [tagFilterHighlight, setTagFilterHighlight] = useState<number>(-1);
  const tagFilterListRef = useRef<HTMLDivElement | null>(null);

  // Helper function to build query parameters from filters
  const buildQueryParams = useCallback((
    filterState: OrderFilters,
    includePagination = false,
    page?: number,
    accountSearchOverride?: string,
  ): OrderQueryParams => {
    const params: OrderQueryParams = {};

    if (filterState.dateFrom) params.dateFrom = filterState.dateFrom;
    if (filterState.dateTo) params.dateTo = filterState.dateTo;
    if (filterState.handlerId !== null) params.handlerId = filterState.handlerId;
    if (filterState.customerId !== null) params.customerId = filterState.customerId;
    if (filterState.currencyPairs.length > 0) {
      params.currencyPairs = filterState.currencyPairs.join(',');
    }
    const accountSearch = (accountSearchOverride ?? filterState.accountSearch).trim();
    if (accountSearch) params.accountSearch = accountSearch;
    if (filterState.status) params.status = filterState.status;
    if (filterState.tagIds.length > 0) params.tagIds = filterState.tagIds.join(',');
    
    if (includePagination) {
      params.page = page ?? currentPage;
      params.limit = 20;
    }

    return params;
  }, [currentPage]);

  // Handle date preset changes
  const handleDatePresetChange = useCallback((preset: DatePreset) => {
    let dateFrom: string | null = null;
    let dateTo: string | null = null;

    if (preset === 'all') {
      // Clear date filters
      dateFrom = null;
      dateTo = null;
    } else if (preset === 'currentWeek') {
      const range = getCurrentWeekRange();
      dateFrom = range.from;
      dateTo = range.to;
    } else if (preset === 'lastWeek') {
      const range = getLastWeekRange();
      dateFrom = range.from;
      dateTo = range.to;
    } else if (preset === 'currentMonth') {
      const range = getCurrentMonthRange();
      dateFrom = range.from;
      dateTo = range.to;
    } else if (preset === 'lastMonth') {
      const range = getLastMonthRange();
      dateFrom = range.from;
      dateTo = range.to;
    }
    // For 'custom', keep existing dateFrom/dateTo values

    setFilters((prev) => ({
      ...prev,
      datePreset: preset,
      dateFrom,
      dateTo,
    }));
    setCurrentPage(1); // Reset to first page when filter changes
  }, [setCurrentPage]);

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setFilters(defaultFilters);
    setDebouncedAccountSearch("");
    setCurrentPage(1);
  }, [setCurrentPage]);

  // Update a filter field
  const updateFilter = useCallback(<K extends keyof OrderFilters>(
    key: K,
    value: OrderFilters[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key !== "accountSearch") {
      setCurrentPage(1);
    }
  }, [setCurrentPage]);

  // Build query parameters for API
  const queryParams = useMemo(
    () => buildQueryParams(filters, true, currentPage, debouncedAccountSearch),
    [filters, currentPage, debouncedAccountSearch, buildQueryParams],
  );

  // Build export query parameters (same as queryParams but without pagination)
  const exportQueryParams = useMemo(
    () => buildQueryParams(filters, false, undefined, debouncedAccountSearch),
    [filters, debouncedAccountSearch, buildQueryParams],
  );

  return {
    filters,
    setFilters,
    updateFilter,
    handleDatePresetChange,
    handleClearFilters,
    buildQueryParams,
    queryParams,
    exportQueryParams,
    // Tag filter state
    isTagFilterOpen,
    setIsTagFilterOpen,
    tagFilterHighlight,
    setTagFilterHighlight,
    tagFilterListRef,
  };
}
