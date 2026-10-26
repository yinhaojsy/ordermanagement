import * as XLSX from "xlsx";
import type { OrderQueryParams } from "../../types/orders";
import { COF_ACCOUNT_LABEL, type OrderAccountLeg } from "./orderAccounts";

type AmountCurrencyEntry = { amount: number; currency: string };
type ChargeLeg = {
  accountName?: string | null;
  amount: number;
  currency?: string | null;
  isCof?: boolean;
};

function isPlaceholder(value: unknown): boolean {
  return /^[-–—]+$/.test(String(value ?? "").trim());
}

function textCell(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || isPlaceholder(text)) return "";
  return text;
}

function formatLegAmount(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const text = n.toFixed(8).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/** Every receipt/payment leg, with the amount that hit that account. */
function formatAccountLegs(
  legs: OrderAccountLeg[] | null | undefined,
  fallbackName: string | null | undefined,
  fallbackAmount: number | null | undefined,
  cofLabel: string,
): string {
  if (legs && legs.length > 0) {
    return legs
      .map((leg) => {
        const name = leg.isCof ? cofLabel : textCell(leg.accountName);
        if (!name || leg.amount == null || Number.isNaN(Number(leg.amount))) return "";
        return `${name} ${formatLegAmount(Number(leg.amount))}`;
      })
      .filter(Boolean)
      .join(", ");
  }
  const name = textCell(fallbackName);
  if (!name) return "";
  const amount = Number(fallbackAmount);
  if (!Number.isFinite(amount)) return name;
  return `${name} ${formatLegAmount(amount)}`;
}

function formatChargeColumns(
  legs: ChargeLeg[] | null | undefined,
  fallbackAmount: number | null | undefined,
  fallbackCurrency: string | null | undefined,
  fallbackAccount: string | null | undefined,
  cofLabel: string,
): { amount: string | number; currency: string; account: string } {
  if (legs && legs.length > 0) {
    return {
      amount: legs.map((leg) => formatLegAmount(Number(leg.amount))).join(", "),
      currency: legs.map((leg) => textCell(leg.currency).toUpperCase()).join(", "),
      account: legs
        .map((leg) => (leg.isCof ? cofLabel : textCell(leg.accountName)))
        .join(", "),
    };
  }
  const amount = Number(fallbackAmount);
  const currency = textCell(fallbackCurrency).toUpperCase();
  const account = textCell(fallbackAccount);
  if (!Number.isFinite(amount) || (amount === 0 && !currency && !account)) {
    return { amount: "", currency: "", account: "" };
  }
  return { amount, currency, account };
}

/**
 * Exports orders to an Excel file that order import can read back.
 * Buy Account and Sell Account list every leg as "Name amount".
 */
export async function exportOrdersToExcel(
  queryParams: OrderQueryParams,
  t: (key: string) => string
): Promise<{ fileName: string; count: number }> {
  const queryString = new URLSearchParams();
  if (queryParams.dateFrom) queryString.append("dateFrom", queryParams.dateFrom);
  if (queryParams.dateTo) queryString.append("dateTo", queryParams.dateTo);
  if (queryParams.handlerId !== undefined) queryString.append("handlerId", queryParams.handlerId.toString());
  if (queryParams.customerId !== undefined) queryString.append("customerId", queryParams.customerId.toString());
  if (queryParams.currencyPairs) queryString.append("currencyPairs", queryParams.currencyPairs);
  if (queryParams.accountSearch) queryString.append("accountSearch", queryParams.accountSearch);
  if (queryParams.status) queryString.append("status", queryParams.status);
  if (queryParams.tagIds) queryString.append("tagIds", queryParams.tagIds);

  const response = await fetch(`/api/orders/export?${queryString.toString()}`);
  if (!response.ok) {
    throw new Error(t("orders.exportError") || "Failed to export orders. Please try again.");
  }

  const orders = await response.json();
  const cofLabel = t("orders.cof") || COF_ACCOUNT_LABEL;
  const workbook = XLSX.utils.book_new();

  const excelData = orders.map((order: any) => {
    const profit = formatChargeColumns(
      order.profitLegs,
      order.profitAmount,
      order.profitCurrency,
      order.profitAccountName,
      cofLabel,
    );
    const serviceCharge = formatChargeColumns(
      order.serviceChargeLegs,
      order.serviceChargeAmount,
      order.serviceChargeCurrency,
      order.serviceChargeAccountName,
      cofLabel,
    );
    const orderType = textCell(order.orderType).toLowerCase();

    return {
      "Order ID": order.id,
      "Date": order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "",
      "Handler": textCell(order.handlerName) || textCell(order.createdByName),
      "Customer": textCell(order.customerName),
      "Currency Pair": `${order.fromCurrency}/${order.toCurrency}`,
      "Rate": order.rate,
      "Amount Buy": order.amountBuy,
      "From Currency": order.fromCurrency,
      "Buy Account": formatAccountLegs(order.buyAccounts, order.buyAccountName, order.amountBuy, cofLabel),
      "Amount Sell": order.amountSell,
      "To Currency": order.toCurrency,
      "Sell Account": formatAccountLegs(order.sellAccounts, order.sellAccountName, order.amountSell, cofLabel),
      "Status": textCell(order.status).toLowerCase(),
      "Order Type": orderType === "otc" || orderType === "online" ? orderType : "",
      "Profit Amount": profit.amount,
      "Profit Currency": profit.currency,
      "Profit Account": profit.account,
      "Service Charges Amount": serviceCharge.amount,
      "Service Charges Currency": serviceCharge.currency,
      "Service Charges Account": serviceCharge.account,
      "Tags":
        order.tags && order.tags.length > 0
          ? order.tags.map((tag: any) => textCell(tag.name)).filter(Boolean).join(", ")
          : "",
      "Remarks": order.remarks?.trim() || "",
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");

  const fileName = `orders_export_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  return { fileName, count: orders.length };
}
