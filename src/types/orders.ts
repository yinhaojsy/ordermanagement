import type { OrderStatus } from "../types";

export type DatePreset = 'all' | 'currentWeek' | 'lastWeek' | 'currentMonth' | 'lastMonth' | 'custom';

export interface OrderFilters {
  datePreset: DatePreset;
  dateFrom: string | null;
  dateTo: string | null;
  handlerId: number | null;
  customerId: number | null;
  currencyPairs: string[];
  /** Keyword search against buy/sell/profit/service-charge account names (and COF when matched). */
  accountSearch: string;
  status: OrderStatus | null;
  tagIds: number[];
}

export interface OrderQueryParams {
  dateFrom?: string;
  dateTo?: string;
  handlerId?: number;
  customerId?: number;
  currencyPairs?: string;
  accountSearch?: string;
  status?: OrderStatus;
  tagIds?: string;
  page?: number;
  limit?: number;
}
