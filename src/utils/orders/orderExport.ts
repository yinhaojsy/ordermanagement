import * as XLSX from "xlsx";
import type { OrderQueryParams } from "../../types/orders";
import { formatOrderAccountsColumn } from "./orderAccounts";

/**
 * Exports orders to Excel file
 */
export async function exportOrdersToExcel(
  queryParams: OrderQueryParams,
  t: (key: string) => string
): Promise<{ fileName: string; count: number }> {
  // Build query string
  const queryString = new URLSearchParams();
  if (queryParams.dateFrom) queryString.append("dateFrom", queryParams.dateFrom);
  if (queryParams.dateTo) queryString.append("dateTo", queryParams.dateTo);
  if (queryParams.handlerId !== undefined) queryString.append("handlerId", queryParams.handlerId.toString());
  if (queryParams.customerId !== undefined) queryString.append("customerId", queryParams.customerId.toString());
  if (queryParams.fromCurrency) queryString.append("fromCurrency", queryParams.fromCurrency);
  if (queryParams.toCurrency) queryString.append("toCurrency", queryParams.toCurrency);
  if (queryParams.currencyPairs) queryString.append("currencyPairs", queryParams.currencyPairs);
  if (queryParams.accountSearch) queryString.append("accountSearch", queryParams.accountSearch);
  if (queryParams.status) queryString.append("status", queryParams.status);
  if (queryParams.tagIds) queryString.append("tagIds", queryParams.tagIds);

  // Fetch orders
  const response = await fetch(`/api/orders/export?${queryString.toString()}`);
  if (!response.ok) {
    throw new Error(t("orders.exportError") || "Failed to export orders. Please try again.");
  }

  const orders = await response.json();

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Prepare data for Excel
  const excelData = orders.map((order: any) => ({
    "Order ID": order.id,
    "Date": order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "",
    "Handler": order.handlerName || "-",
    "Customer": order.customerName || "-",
    "Currency Pair": `${order.fromCurrency}/${order.toCurrency}`,
    "Rate": order.rate,
    "Amount Buy": order.amountBuy,
    "From Currency": order.fromCurrency,
    "Buy Account": formatOrderAccountsColumn(
      order.buyAccounts,
      t("orders.cof"),
      order.buyAccountName,
    ),
    "Amount Sell": order.amountSell,
    "To Currency": order.toCurrency,
    "Sell Account": formatOrderAccountsColumn(
      order.sellAccounts,
      t("orders.cof"),
      order.sellAccountName,
    ),
    "Status": order.status,
    "Profit Amount": order.profitAmount || 0,
    "Profit Currency": order.profitCurrency || "-",
    "Service Charge Amount": order.serviceChargeAmount || 0,
    "Service Charge Currency": order.serviceChargeCurrency || "-",
    "Tags": order.tags && order.tags.length > 0 ? order.tags.map((tag: any) => tag.name).join(", ") : "-",
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");

  // Generate file name with date
  const fileName = `orders_export_${new Date().toISOString().split("T")[0]}.xlsx`;

  // Write file
  XLSX.writeFile(workbook, fileName);

  return { fileName, count: orders.length };
}

