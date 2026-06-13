import { useCallback, useMemo, useState } from "react";
import { useGetCustomerDepositByCurrencyQuery } from "../../services/api";

export function useCustomerDepositUi() {
  const { data, isLoading, isFetching } = useGetCustomerDepositByCurrencyQuery();
  const [sidebarCurrency, setSidebarCurrency] = useState<string | null | undefined>(undefined);

  const isSidebarOpen = sidebarCurrency !== undefined;

  const openSidebar = useCallback((currencyCode: string | null) => {
    setSidebarCurrency(currencyCode);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarCurrency(undefined);
  }, []);

  const depositCurrencies = useMemo(() => data?.currencies ?? [], [data]);

  return {
    data,
    isLoading: isLoading || isFetching,
    depositCurrencies,
    isSidebarOpen,
    sidebarCurrency: isSidebarOpen ? sidebarCurrency! : null,
    openSidebar,
    closeSidebar,
  };
}
