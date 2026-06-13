import React from "react";
import Badge from "../common/Badge";
import { AccountTooltip } from "./AccountTooltip";
import type { Order, Currency, Customer, User } from "../../types";
import type { OrderStatus } from "../../types";
import { formatDate } from "../../utils/format";
import type { Account } from "../../types";
import { StyledCurrencyAmount } from "../common/StyledCurrencyAmount";
import {
  formatOrderAccountLegName,
  isCofAccountLeg,
  type OrderAccountLeg,
} from "../../utils/orders/orderAccounts";

interface OrdersTableColumnsProps {
  columnKey: string;
  order: Order;
  accounts: Account[];
  customers?: import("../../types").CustomerOption[];
  users?: User[];
  currencyByCode: Map<string, Currency>;
  getStatusTone: (status: OrderStatus) => "amber" | "blue" | "emerald" | "rose" | "slate" | "orange";
  t: (key: string) => string;
}

function getAccountStyle(
  accountId: number | null | undefined,
  accounts: Account[],
  currencyByCode: Map<string, Currency>,
): React.CSSProperties | undefined {
  if (!accountId) return undefined;
  const account = accounts.find((a) => a.id === accountId);
  const poolCurrency = account ? currencyByCode.get(account.currencyCode) : undefined;
  const effectiveBg = account?.displayBgColor || poolCurrency?.accountPoolDisplayBgColor;
  if (!effectiveBg) return undefined;
  const effectiveText = account?.displayBgColor
    ? (account.displayTextColor || "#ffffff")
    : (poolCurrency?.accountPoolDisplayTextColor || "#ffffff");
  return {
    backgroundColor: effectiveBg,
    color: effectiveText,
    fontWeight: 700,
    borderRadius: "0.375rem",
    padding: "0.125rem 0.375rem",
    display: "inline-block",
  };
}

function getCofStyle(): React.CSSProperties {
  return {
    fontWeight: 600,
    borderRadius: "0.375rem",
    padding: "0.125rem 0.375rem",
    display: "inline-block",
    backgroundColor: "#f1f5f9",
    color: "#475569",
  };
}

function accountLegDisplayName(leg: OrderAccountLeg, t: (key: string) => string): string {
  return formatOrderAccountLegName(leg, t("orders.cof"));
}

function accountLegCellStyle(
  leg: OrderAccountLeg | null,
  accounts: Account[],
  currencyByCode: Map<string, Currency>,
  fallbackAccountId?: number | null,
): React.CSSProperties | undefined {
  if (!leg) return getAccountStyle(fallbackAccountId, accounts, currencyByCode);
  if (isCofAccountLeg(leg)) return getCofStyle();
  return getAccountStyle(leg.accountId, accounts, currencyByCode);
}

/**
 * Renders cell content for a specific column in the orders table
 */
export function renderOrderCell({
  columnKey,
  order,
  accounts,
  customers,
  users,
  currencyByCode,
  getStatusTone,
  t,
}: OrdersTableColumnsProps): React.ReactElement | null {
  switch (columnKey) {
    case "id":
      return <td key={columnKey} className="py-2 font-mono text-slate-600">#{order.id}</td>;
    case "date":
      return <td key={columnKey} className="py-2">{formatDate(order.orderDate || order.createdAt)}</td>;
    case "createdBy": {
      const creatorLabel =
        (order.createdByName && String(order.createdByName).trim()) ||
        (order.handlerName && String(order.handlerName).trim()) ||
        "";
      const creatorId = order.createdBy ?? order.handlerId;
      const creatorUser = creatorId ? users?.find((u) => u.id === creatorId) : undefined;
      const creatorStyle = creatorUser?.displayBgColor
        ? { backgroundColor: creatorUser.displayBgColor, color: creatorUser.displayTextColor || "#ffffff", fontWeight: 700, borderRadius: "0.375rem", padding: "0.125rem 0.375rem", display: "inline-block" }
        : undefined;
      return (
        <td key={columnKey} className="py-2 text-slate-700">
          {creatorLabel
            ? <span style={creatorStyle}>{creatorLabel}</span>
            : <span className="text-slate-400">—</span>}
        </td>
      );
    }
    case "customer": {
      const customerRecord = customers?.find((c) => c.id === order.customerId);
      const customerStyle = customerRecord?.displayBgColor
        ? { backgroundColor: customerRecord.displayBgColor, color: customerRecord.displayTextColor || "#ffffff", fontWeight: 700, borderRadius: "0.375rem", padding: "0.125rem 0.375rem", display: "inline-block" }
        : undefined;
      return (
        <td key={columnKey} className="py-2 font-semibold">
          <div className="flex items-center gap-2">
            <span style={customerStyle}>{order.customerName || order.customerId}</span>

            {/* 我 TAGS DISPLAY NEXT TO CUSTOMER NAME 
            {order.tags && Array.isArray(order.tags) && order.tags.length > 0 &&
              order.tags.map((tag: { id: number; name: string; color: string }) => (
                <Badge key={tag.id} tone="slate" backgroundColor={tag.color} lightStyle={true}>
                  {tag.name}
                </Badge>
              ))} */}
          </div>
        </td>
      );
    }
    case "pair":
      return (
        <td key={columnKey} className="py-2">
          {order.fromCurrency} → {order.toCurrency}
        </td>
      );
    case "buy": {
      const buyAmount = order.amountBuy;
      return (
        <td key={columnKey} className="py-2">
          <StyledCurrencyAmount
            signedAmount={buyAmount}
            currencyCode={order.fromCurrency}
            currencyByCode={currencyByCode}
            formatAbsValue={(n) => Math.round(n).toLocaleString()}
          />
        </td>
      );
    }
    case "sell": {
      const sellDisplayAmount = -order.amountSell;
      return (
        <td key={columnKey} className="py-2">
          <StyledCurrencyAmount
            signedAmount={sellDisplayAmount}
            currencyCode={order.toCurrency}
            currencyByCode={currencyByCode}
            formatAbsValue={(n) => Math.round(n).toLocaleString()}
          />
        </td>
      );
    }
    case "rate":
      return (
        <td key={columnKey} className="py-2">
          {order.rate}
        </td>
      );
    case "status":
      return (
        <td key={columnKey} className="py-2">
          <Badge tone={getStatusTone(order.status)}>
            {t(`orders.${order.status}`)}
          </Badge>
        </td>
      );
    case "buyAccount": {
      const fallbackAccountName =
        order.buyAccountName ||
        (order.buyAccountId ? accounts.find((acc) => acc.id === order.buyAccountId)?.name : null) ||
        null;

      // Imported orders may not have receipt aggregates; fall back to the primary account/amount
      const buyAccounts =
        (order.buyAccounts && order.buyAccounts.length > 0)
          ? order.buyAccounts
          : order.buyAccountId
            ? [{
                accountId: order.buyAccountId,
                accountName: fallbackAccountName || `Account #${order.buyAccountId}`,
                amount: order.actualAmountBuy ?? order.amountBuy ?? 0,
              }]
            : [];

      const firstAccount = buyAccounts.length > 0 ? buyAccounts[0] : null;
      const accountName = firstAccount
        ? accountLegDisplayName(firstAccount, t)
        : fallbackAccountName || "-";
      const buyAccountStyle = firstAccount
        ? accountLegCellStyle(firstAccount, accounts, currencyByCode, order.buyAccountId)
        : getAccountStyle(order.buyAccountId, accounts, currencyByCode);
      const buyAccountsForTooltip = buyAccounts.map((a) => ({
        ...a,
        accountName: accountLegDisplayName(a, t),
      }));

      // Check if profit or service charge should appear in buy account tooltip
      // Buy account is for fromCurrency, so check if profit/service charge currency matches fromCurrency
      const showProfitInBuy = order.profitCurrency === order.fromCurrency && 
                              order.profitAmount !== null && 
                              order.profitAmount !== undefined &&
                              order.profitAccountId;
      const showServiceChargeInBuy = order.serviceChargeCurrency === order.fromCurrency && 
                                     order.serviceChargeAmount !== null && 
                                     order.serviceChargeAmount !== undefined &&
                                     order.serviceChargeAccountId;
      
      const profitAccountName = showProfitInBuy && order.profitAccountId 
        ? accounts.find(acc => acc.id === order.profitAccountId)?.name || null
        : null;
      const serviceChargeAccountName = showServiceChargeInBuy && order.serviceChargeAccountId
        ? accounts.find(acc => acc.id === order.serviceChargeAccountId)?.name || null
        : null;
      
      // Count the number of entries that will be displayed in the tooltip
      // This includes all buy accounts, plus profit and service charges if they are shown
      // Each entry counts as 1, even if they use the same account
      let accountCount = buyAccounts.length;
      if (showProfitInBuy) {
        accountCount++;
      }
      if (showServiceChargeInBuy) {
        accountCount++;
      }
      
      const hasMultiple = accountCount > 1;
      const shouldShowTooltip = hasMultiple || showProfitInBuy || showServiceChargeInBuy;
      // Show badge when there are multiple entries (accounts, profit, or service charges)
      const showBadge = accountCount > 1;
      
      return (
        <td key={columnKey} className="py-2 text-slate-600">
          {shouldShowTooltip ? (
            <AccountTooltip 
              accounts={buyAccountsForTooltip} 
              label={t("orders.buyAccount")}
              profitAmount={showProfitInBuy ? order.profitAmount : null}
              profitCurrency={showProfitInBuy ? order.profitCurrency : null}
              profitAccountName={profitAccountName}
              serviceChargeAmount={showServiceChargeInBuy ? order.serviceChargeAmount : null}
              serviceChargeCurrency={showServiceChargeInBuy ? order.serviceChargeCurrency : null}
              serviceChargeAccountName={serviceChargeAccountName}
              accountCount={accountCount}
              currency={order.fromCurrency}
            >
              <div className="flex items-center gap-2 cursor-pointer">
                <span style={buyAccountStyle}>{accountName}</span>
                {showBadge && (
                  <span className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-white bg-blue-600 rounded-full">
                    {accountCount}
                  </span>
                )}
              </div>
            </AccountTooltip>
          ) : (
            <span style={buyAccountStyle}>{accountName}</span>
          )}
        </td>
      );
    }
    case "sellAccount": {
      const fallbackAccountName =
        order.sellAccountName ||
        (order.sellAccountId ? accounts.find((acc) => acc.id === order.sellAccountId)?.name : null) ||
        null;

      // Imported orders may not have payment aggregates; fall back to the primary account/amount
      const sellAccounts =
        (order.sellAccounts && order.sellAccounts.length > 0)
          ? order.sellAccounts
          : order.sellAccountId
            ? [{
                accountId: order.sellAccountId,
                accountName: fallbackAccountName || `Account #${order.sellAccountId}`,
                amount: order.actualAmountSell ?? order.amountSell ?? 0,
              }]
            : [];

      const firstAccount = sellAccounts.length > 0 ? sellAccounts[0] : null;
      const accountName = firstAccount
        ? accountLegDisplayName(firstAccount, t)
        : fallbackAccountName || "-";
      const sellAccountStyle = firstAccount
        ? accountLegCellStyle(firstAccount, accounts, currencyByCode, order.sellAccountId)
        : getAccountStyle(order.sellAccountId, accounts, currencyByCode);
      const sellAccountsForTooltip = sellAccounts.map((a) => ({
        ...a,
        accountName: accountLegDisplayName(a, t),
      }));

      // Check if profit or service charge should appear in sell account tooltip
      // Sell account is for toCurrency, so check if profit/service charge currency matches toCurrency
      const showProfitInSell = order.profitCurrency === order.toCurrency && 
                               order.profitAmount !== null && 
                               order.profitAmount !== undefined &&
                               order.profitAccountId;
      const showServiceChargeInSell = order.serviceChargeCurrency === order.toCurrency && 
                                      order.serviceChargeAmount !== null && 
                                      order.serviceChargeAmount !== undefined &&
                                      order.serviceChargeAccountId;
      
      const profitAccountName = showProfitInSell && order.profitAccountId 
        ? accounts.find(acc => acc.id === order.profitAccountId)?.name || null
        : null;
      const serviceChargeAccountName = showServiceChargeInSell && order.serviceChargeAccountId
        ? accounts.find(acc => acc.id === order.serviceChargeAccountId)?.name || null
        : null;
      
      // Count the number of entries that will be displayed in the tooltip
      // This includes all sell accounts, plus profit and service charges if they are shown
      // Each entry counts as 1, even if they use the same account
      let accountCount = sellAccounts.length;
      if (showProfitInSell) {
        accountCount++;
      }
      if (showServiceChargeInSell) {
        accountCount++;
      }
      
      const hasMultiple = accountCount > 1;
      const shouldShowTooltip = hasMultiple || showProfitInSell || showServiceChargeInSell;
      // Show badge when there are multiple entries (accounts, profit, or service charges)
      const showBadge = accountCount > 1;
      
      return (
        <td key={columnKey} className="py-2 text-slate-600">
          {shouldShowTooltip ? (
            <AccountTooltip 
              accounts={sellAccountsForTooltip} 
              label={t("orders.sellAccount")}
              profitAmount={showProfitInSell ? order.profitAmount : null}
              profitCurrency={showProfitInSell ? order.profitCurrency : null}
              profitAccountName={profitAccountName}
              serviceChargeAmount={showServiceChargeInSell ? order.serviceChargeAmount : null}
              serviceChargeCurrency={showServiceChargeInSell ? order.serviceChargeCurrency : null}
              serviceChargeAccountName={serviceChargeAccountName}
              isSellAccount={true}
              accountCount={accountCount}
              currency={order.toCurrency}
            >
              <div className="flex items-center gap-2 cursor-pointer">
                <span style={sellAccountStyle}>{accountName}</span>
                {showBadge && (
                  <span className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-white bg-blue-600 rounded-full">
                    {accountCount}
                  </span>
                )}
              </div>
            </AccountTooltip>
          ) : (
            <span style={sellAccountStyle}>{accountName}</span>
          )}
        </td>
      );
    }
    case "profit": {
      const amount = order.calculatedProfit;
      const currency = order.calculatedProfitCurrency;
      return (
        <td key={columnKey} className="py-2 text-slate-600">
          {amount !== null && amount !== undefined && currency ? (
            <span className={`font-medium whitespace-nowrap ${amount >= 0 ? "text-blue-700" : "text-red-600"}`}>
              {amount > 0 ? "+" : ""}{amount.toFixed(2)} {currency}
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </td>
      );
    }
    case "serviceCharges": {
      const entries = order.serviceChargeEntries && order.serviceChargeEntries.length > 0
        ? order.serviceChargeEntries
        : (order.serviceChargeAmount !== null && order.serviceChargeAmount !== undefined ? [{ amount: order.serviceChargeAmount, currency: order.serviceChargeCurrency || "" }] : []);
      return (
        <td key={columnKey} className="py-2 text-slate-600">
          {entries.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {entries.map((e, i) => (
                <StyledCurrencyAmount
                  key={i}
                  signedAmount={e.amount}
                  currencyCode={e.currency}
                  currencyByCode={currencyByCode}
                  formatAbsValue={(n) => n.toFixed(2)}
                />
              ))}
            </div>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </td>
      );
    }
    case "tags":
      return (
        <td key={columnKey} className="py-2">
          <div className="flex flex-wrap gap-1">
            {order.tags && Array.isArray(order.tags) && order.tags.length > 0 ? (
              order.tags.map((tag: { id: number; name: string; color: string }) => (
                <Badge key={tag.id} tone="slate" backgroundColor={tag.color} lightStyle={true}>
                  {tag.name}
                </Badge>
              ))
            ) : (
              <span className="text-slate-400 text-xs">-</span>
            )}
          </div>
        </td>
      );
    default:
      return null;
  }
}

