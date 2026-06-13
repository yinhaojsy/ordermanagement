import React, { useCallback, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import Badge from "../common/Badge";
import { formatDate } from "../../utils/format";
import { RemarksSection } from "./RemarksSection";
import { CustomerSelect } from "../common/CustomerSelect";
import { CurrencyPairSwapButton } from "./CurrencyPairSwapButton";
import { OrderLineBalanceField } from "./NewOrderModal";
import { CustomerFundingSummaryInline } from "./CustomerFundingSummaryInline";
import { saveDefaultOtcHandler, getDefaultOtcHandler, clearDefaultOtcHandler } from "../../utils/otcHandlerPreference";
import { useTranslation } from "react-i18next";
import type { Account, Order, OrderStatus } from "../../types";
import {
  useGetCustomerFundingBalancesQuery,
  useGetCustomerLedgerBalanceQuery,
} from "../../services/api";
import { getStatusTone } from "../../utils/orders/orderFormatters";

type BasicEntity = { id: number; name: string };
type UserEntity = { id: number; name: string; role?: string };
type Currency = { id: number; code: string; active?: boolean | number };

export type OtcFormState = {
  customerId: string;
  fromCurrency: string;
  toCurrency: string;
  amountBuy: string;
  amountSell: string;
  rate: string;
  handlerId: string;
};

export type OtcEntry = {
  amount: string;
  accountId: string;
  fundedFrom?: "cash" | "customer_balance";
};

export type OtcOrderDetails = {
  order?: {
    customerId: number;
    handlerId?: number | null;
    fromCurrency: string;
    toCurrency: string;
    amountBuy: number;
    amountSell: number;
    rate: number;
    status: string;
    createdAt?: string;
    profitAmount?: number | null;
    profitCurrency?: string | null;
    profitAccountId?: number | null;
    serviceChargeAmount?: number | null;
    serviceChargeCurrency?: string | null;
    serviceChargeAccountId?: number | null;
    remarks?: string | null;
  };
  receipts?: Array<{ amount: number; accountId?: number | null; accountName?: string }>;
  payments?: Array<{ amount: number; accountId?: number | null; accountName?: string }>;
  profits?: Array<{ id: number; amount: number; currencyCode: string; accountId?: number | null; accountName?: string; status?: string }>;
  serviceCharges?: Array<{ id: number; amount: number; currencyCode: string; accountId?: number | null; accountName?: string; status?: string }>;
};

type OtcOrderModalProps = {
  isOpen: boolean;
  isSaving: boolean;
  isOtcCompleted: boolean;
  otcEditingOrderId: number | null;
  otcOrderDetails?: OtcOrderDetails | null;
  customers: BasicEntity[];
  users: UserEntity[];
  currencies: Currency[];
  accounts: Account[];
  otcForm: OtcFormState;
  setOtcForm: Dispatch<SetStateAction<OtcFormState>>;
  otcReceipts: OtcEntry[];
  setOtcReceipts: Dispatch<SetStateAction<OtcEntry[]>>;
  otcPayments: OtcEntry[];
  setOtcPayments: Dispatch<SetStateAction<OtcEntry[]>>;
  showOtcProfitSection: boolean;
  setShowOtcProfitSection: Dispatch<SetStateAction<boolean>>;
  showOtcServiceChargeSection: boolean;
  setShowOtcServiceChargeSection: Dispatch<SetStateAction<boolean>>;
  otcProfitAmount: string;
  setOtcProfitAmount: Dispatch<SetStateAction<string>>;
  otcProfitCurrency: string;
  setOtcProfitCurrency: Dispatch<SetStateAction<string>>;
  otcProfitAccountId: string;
  setOtcProfitAccountId: Dispatch<SetStateAction<string>>;
  otcServiceChargeAmount: string;
  setOtcServiceChargeAmount: Dispatch<SetStateAction<string>>;
  otcServiceChargeCurrency: string;
  setOtcServiceChargeCurrency: Dispatch<SetStateAction<string>>;
  otcServiceChargeAccountId: string;
  setOtcServiceChargeAccountId: Dispatch<SetStateAction<string>>;
  otcServiceChargeFundedFrom: "cash" | "customer_balance";
  setOtcServiceChargeFundedFrom: Dispatch<SetStateAction<"cash" | "customer_balance">>;
  otcRemarks: string;
  setOtcRemarks: Dispatch<SetStateAction<string>>;
  showOtcRemarks: boolean;
  setShowOtcRemarks: Dispatch<SetStateAction<boolean>>;
  handleNumberInputWheel: (e: React.WheelEvent<HTMLInputElement>) => void;
  getBaseCurrency: (fromCurrency: string, toCurrency: string) => boolean | null;
  onSave: (event: FormEvent) => void;
  onComplete: (event: FormEvent) => void;
  onClose: () => void;
  setIsCreateCustomerModalOpen: Dispatch<SetStateAction<boolean>>;
  authUser: { id: number } | null;
  onRemoveProfit?: () => Promise<void>;
  onRemoveServiceCharge?: () => Promise<void>;
  onRemoveRemarks?: () => Promise<void>;
  t: (key: string) => string;
};

type ViewProps = {
  accounts: Account[];
  customers: BasicEntity[];
  users: BasicEntity[];
  otcOrderDetails: OtcOrderDetails;
  onClose: () => void;
  t: (key: string) => string;
};

type FormProps = {
  accounts: Account[];
  customers: BasicEntity[];
  users: UserEntity[];
  currencies: Currency[];
  otcForm: OtcFormState;
  setOtcForm: Dispatch<SetStateAction<OtcFormState>>;
  otcReceipts: OtcEntry[];
  setOtcReceipts: Dispatch<SetStateAction<OtcEntry[]>>;
  otcPayments: OtcEntry[];
  setOtcPayments: Dispatch<SetStateAction<OtcEntry[]>>;
  showOtcProfitSection: boolean;
  setShowOtcProfitSection: Dispatch<SetStateAction<boolean>>;
  showOtcServiceChargeSection: boolean;
  setShowOtcServiceChargeSection: Dispatch<SetStateAction<boolean>>;
  otcProfitAmount: string;
  setOtcProfitAmount: Dispatch<SetStateAction<string>>;
  otcProfitCurrency: string;
  setOtcProfitCurrency: Dispatch<SetStateAction<string>>;
  otcProfitAccountId: string;
  setOtcProfitAccountId: Dispatch<SetStateAction<string>>;
  otcServiceChargeAmount: string;
  setOtcServiceChargeAmount: Dispatch<SetStateAction<string>>;
  otcServiceChargeCurrency: string;
  setOtcServiceChargeCurrency: Dispatch<SetStateAction<string>>;
  otcServiceChargeAccountId: string;
  setOtcServiceChargeAccountId: Dispatch<SetStateAction<string>>;
  otcServiceChargeFundedFrom: "cash" | "customer_balance";
  setOtcServiceChargeFundedFrom: Dispatch<SetStateAction<"cash" | "customer_balance">>;
  otcRemarks: string;
  setOtcRemarks: Dispatch<SetStateAction<string>>;
  showOtcRemarks: boolean;
  setShowOtcRemarks: Dispatch<SetStateAction<boolean>>;
  handleNumberInputWheel: (e: React.WheelEvent<HTMLInputElement>) => void;
  getBaseCurrency: (fromCurrency: string, toCurrency: string) => boolean | null;
  onSave: (event: FormEvent) => void;
  onComplete: (event: FormEvent) => void;
  onClose: () => void;
  setIsCreateCustomerModalOpen: Dispatch<SetStateAction<boolean>>;
  isSaving: boolean;
  authUser: { id: number } | null;
  otcEditingOrderId: number | null;
  otcOrderDetails?: OtcOrderDetails | null;
  onRemoveProfit?: () => Promise<void>;
  onRemoveServiceCharge?: () => Promise<void>;
  onRemoveRemarks?: () => Promise<void>;
  t: (key: string) => string;
};


const OtcOrderView = ({ accounts, customers, users, otcOrderDetails, onClose, t }: ViewProps) => {
  const order = otcOrderDetails.order;
  if (!order) return null;

  const customerName = customers.find((c) => c.id === order.customerId)?.name || "";
  const handlerName = order.handlerId ? users.find((u) => u.id === order.handlerId)?.name || "" : "";

  return (
    <div className="space-y-6">
      <div className="space-y-3 border-b border-slate-200 pb-4">
        <h3 className="text-lg font-semibold text-slate-900">{t("orders.orderDetails")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.customer")}</label>
            <p className="mt-1 text-sm text-slate-900">{customerName}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.handler")}</label>
            <p className="mt-1 text-sm text-slate-900">{handlerName || "-"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.currencyPair")}</label>
            <p className="mt-1 text-sm text-slate-900">
              {order.fromCurrency} / {order.toCurrency}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.rate")}</label>
            <p className="mt-1 text-sm text-slate-900">{order.rate}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.amountBuy")}</label>
            <p className="mt-1 text-sm text-slate-900">
              {order.amountBuy.toFixed(2)} {order.fromCurrency}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.amountSell")}</label>
            <p className="mt-1 text-sm text-slate-900">
              {order.amountSell.toFixed(2)} {order.toCurrency}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.status")}</label>
            <p className="mt-1">
              <Badge tone={getStatusTone(order.status as OrderStatus)}>
                {t(`orders.${order.status}`)}
              </Badge>
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">{t("orders.date")}</label>
            <p className="mt-1 text-sm text-slate-900">{order.createdAt ? formatDate(order.createdAt) : "-"}</p>
          </div>
        </div>
      </div>

      {otcOrderDetails.receipts && otcOrderDetails.receipts.length > 0 && (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {t("orders.receipts")} ({order.fromCurrency})
          </h3>
          <div className="space-y-2">
            {otcOrderDetails.receipts.map((receipt, index) => (
              <div key={index} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-900">{receipt.accountName || "-"}</span>
                <span className="text-sm font-medium text-slate-900">
                  {receipt.amount.toFixed(2)} {order.fromCurrency}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-900">{t("orders.total")}</span>
              <span className="text-sm font-semibold text-slate-900">
                {otcOrderDetails.receipts.reduce((sum, r) => sum + r.amount, 0).toFixed(2)} {order.fromCurrency}
              </span>
            </div>
          </div>
        </div>
      )}

      {otcOrderDetails.payments && otcOrderDetails.payments.length > 0 && (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {t("orders.payments")} ({order.toCurrency})
          </h3>
          <div className="space-y-2">
            {otcOrderDetails.payments.map((payment, index) => (
              <div key={index} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                <span className="text-sm text-slate-900">{payment.accountName || "-"}</span>
                <span className="text-sm font-medium text-slate-900">
                  {payment.amount.toFixed(2)} {order.toCurrency}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t border-slate-200">
              <span className="text-sm font-semibold text-slate-900">{t("orders.total")}</span>
              <span className="text-sm font-semibold text-slate-900">
                {otcOrderDetails.payments.reduce((sum, p) => sum + p.amount, 0).toFixed(2)} {order.toCurrency}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Display profit entries (draft and confirmed) */}
      {otcOrderDetails.profits && otcOrderDetails.profits.length > 0 && (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-blue-900">{t("orders.profit")}</h3>
          {otcOrderDetails.profits.map((profit) => (
            <div key={profit.id} className="p-3 bg-blue-50 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-900">
                  {profit.accountName || accounts.find((a) => a.id === profit.accountId)?.name || "-"} ({profit.currencyCode})
                </span>
                <span className="text-sm font-semibold text-blue-900">
                  {profit.amount > 0 ? "+" : ""}
                  {profit.amount.toFixed(2)} {profit.currencyCode}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Display service charge entries (draft and confirmed) */}
      {otcOrderDetails.serviceCharges && otcOrderDetails.serviceCharges.length > 0 && (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-green-900">{t("orders.serviceCharges")}</h3>
          {otcOrderDetails.serviceCharges.map((serviceCharge) => (
            <div key={serviceCharge.id} className="p-3 bg-green-50 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-900">
                  {serviceCharge.accountName || accounts.find((a) => a.id === serviceCharge.accountId)?.name || "-"} ({serviceCharge.currencyCode})
                </span>
                <span
                  className={`text-sm font-semibold ${
                    serviceCharge.amount < 0 ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {serviceCharge.amount > 0 ? "+" : ""}
                  {serviceCharge.amount.toFixed(2)} {serviceCharge.currencyCode}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Remarks Display - At the bottom */}
      {order.remarks && (
        <div className="space-y-3 border-b border-slate-200 pb-4">
          <h3 className="text-lg font-semibold text-slate-900">{t("orders.remarks") || "Remarks"}</h3>
          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-900 whitespace-pre-wrap">{order.remarks}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
};


const OtcOrderForm = ({
  accounts,
  customers,
  users,
  currencies,
  otcForm,
  setOtcForm,
  otcReceipts,
  setOtcReceipts,
  otcPayments,
  setOtcPayments,
  showOtcProfitSection,
  setShowOtcProfitSection,
  showOtcServiceChargeSection,
  setShowOtcServiceChargeSection,
  otcProfitAmount,
  setOtcProfitAmount,
  otcProfitCurrency,
  setOtcProfitCurrency,
  otcProfitAccountId,
  setOtcProfitAccountId,
  otcServiceChargeAmount,
  setOtcServiceChargeAmount,
  otcServiceChargeCurrency,
  setOtcServiceChargeCurrency,
  otcServiceChargeAccountId,
  setOtcServiceChargeAccountId,
  otcServiceChargeFundedFrom,
  setOtcServiceChargeFundedFrom,
  otcRemarks,
  setOtcRemarks,
  showOtcRemarks,
  setShowOtcRemarks,
  handleNumberInputWheel,
  getBaseCurrency,
  onSave,
  onComplete,
  onClose,
  setIsCreateCustomerModalOpen,
  isSaving,
  authUser,
  otcEditingOrderId,
  otcOrderDetails,
  onRemoveProfit,
  onRemoveServiceCharge,
  onRemoveRemarks,
  t,
}: FormProps) => {
  const isOtcScBalanceFunded = otcServiceChargeFundedFrom === "customer_balance";
  const { data: prepaidBalance } = useGetCustomerLedgerBalanceQuery(
    { customerId: Number(otcForm.customerId), currencyCode: otcForm.fromCurrency },
    { skip: !otcForm.customerId || !otcForm.fromCurrency },
  );
  const { data: advanceBalance } = useGetCustomerLedgerBalanceQuery(
    { customerId: Number(otcForm.customerId), currencyCode: otcForm.toCurrency },
    { skip: !otcForm.customerId || !otcForm.toCurrency },
  );

  const otcCustomerId = otcForm.customerId ? Number(otcForm.customerId) : null;
  const { data: otcFundingBalances, isFetching: otcFundingSummaryLoading } =
    useGetCustomerFundingBalancesQuery(otcCustomerId!, { skip: !otcCustomerId });
  const otcFundingSummary = (otcFundingBalances?.currencies ?? []).filter(
    (c) => c.allocatable >= 0.005 || c.allocatableAdvance >= 0.005,
  );

  const computeOtcSellFromBuy = useCallback(
    (buyStr: string, rateStr: string, from: string, to: string) => {
      const rate = Number(rateStr);
      if (!buyStr || !rateStr || Number.isNaN(rate) || rate <= 0) return null;
      const baseIsFrom = getBaseCurrency(from, to);
      if (baseIsFrom === true) return (Number(buyStr) * rate).toFixed(4);
      if (baseIsFrom === false) return (Number(buyStr) / rate).toFixed(4);
      return (Number(buyStr) * rate).toFixed(4);
    },
    [getBaseCurrency],
  );

  const computeOtcBuyFromSell = useCallback(
    (sellStr: string, rateStr: string, from: string, to: string) => {
      const rate = Number(rateStr);
      if (!sellStr || !rateStr || Number.isNaN(rate) || rate <= 0) return null;
      const baseIsFrom = getBaseCurrency(from, to);
      if (baseIsFrom === true) return (Number(sellStr) / rate).toFixed(4);
      if (baseIsFrom === false) return (Number(sellStr) * rate).toFixed(4);
      return (Number(sellStr) / rate).toFixed(4);
    },
    [getBaseCurrency],
  );

  const fillOtcBuy = useCallback(
    (amount: string) => {
      setOtcForm((p) => {
        const sellAmount =
          computeOtcSellFromBuy(amount, p.rate, p.fromCurrency, p.toCurrency) ?? p.amountSell;
        return { ...p, amountBuy: amount, amountSell: sellAmount };
      });
    },
    [computeOtcSellFromBuy, setOtcForm],
  );

  const fillOtcSell = useCallback(
    (amount: string) => {
      setOtcForm((p) => {
        const buyAmount =
          computeOtcBuyFromSell(amount, p.rate, p.fromCurrency, p.toCurrency) ?? p.amountBuy;
        return { ...p, amountSell: amount, amountBuy: buyAmount };
      });
    },
    [computeOtcBuyFromSell, setOtcForm],
  );

  // Track the current default handler ID to update button state immediately
  const [defaultHandlerId, setDefaultHandlerId] = useState<string | null>(() => {
    if (authUser?.id) {
      return getDefaultOtcHandler(authUser.id);
    }
    return null;
  });

  // Track original handlerId to detect changes
  const [originalHandlerId, setOriginalHandlerId] = useState<string>("");
  const [showHandlerChangeWarning, setShowHandlerChangeWarning] = useState(false);
  const [pendingHandlerChange, setPendingHandlerChange] = useState<string | null>(null);

  // Sync defaultHandlerId when authUser changes or when modal opens
  useEffect(() => {
    if (authUser?.id) {
      const savedDefault = getDefaultOtcHandler(authUser.id);
      setDefaultHandlerId(savedDefault);
    }
  }, [authUser?.id]);

  // Track original handlerId when editing an order
  useEffect(() => {
    if (otcEditingOrderId && otcOrderDetails?.order?.handlerId) {
      setOriginalHandlerId(String(otcOrderDetails.order.handlerId));
    } else {
      setOriginalHandlerId("");
    }
  }, [otcEditingOrderId, otcOrderDetails]);

  // Handle handler change with warning for saved OTC orders
  const handleHandlerChange = (newHandlerId: string) => {
    const order = otcOrderDetails?.order;
    const isSaved = order?.status === "saved";
    const hasOriginalHandler = originalHandlerId !== "" && originalHandlerId !== null;
    const isChangingHandler = newHandlerId !== originalHandlerId && hasOriginalHandler;

    // Show warning only for saved OTC orders that already have a handler
    if (isSaved && isChangingHandler && otcEditingOrderId) {
      setPendingHandlerChange(newHandlerId);
      setShowHandlerChangeWarning(true);
    } else {
      // No warning needed, proceed with change
      setOtcForm((p) => ({ ...p, handlerId: newHandlerId }));
    }
  };

  // Confirm handler change
  const confirmHandlerChange = () => {
    if (pendingHandlerChange !== null) {
      setOtcForm((p) => ({ ...p, handlerId: pendingHandlerChange }));
      setPendingHandlerChange(null);
    }
    setShowHandlerChangeWarning(false);
  };

  // Cancel handler change
  const cancelHandlerChange = () => {
    setPendingHandlerChange(null);
    setShowHandlerChangeWarning(false);
  };

  // Check if current handler is the default handler
  const isDefaultHandler = useMemo(() => {
    if (!authUser?.id || !otcForm.handlerId) return false;
    return defaultHandlerId === otcForm.handlerId;
  }, [authUser?.id, otcForm.handlerId, defaultHandlerId]);

  // Hide button for saved (in-progress) orders until status changes
  const isSavedOrder = useMemo(() => {
    return otcOrderDetails?.order?.status === "saved";
  }, [otcOrderDetails?.order?.status]);

  return (
  <form className="space-y-6" onSubmit={onSave}>
    <div className="space-y-3 border-b border-slate-200 pb-4">
      <h3 className="text-lg font-semibold text-slate-900">{t("orders.orderDetails")}</h3>
      <div className="flex gap-2 items-end">
        <div className="min-w-0 flex-1">
          <CustomerSelect
            value={otcForm.customerId}
            onChange={(value) => setOtcForm((p) => ({ ...p, customerId: value }))}
            customers={customers}
            placeholder={t("orders.selectCustomer") || "Select customer"}
            required
            t={t}
          />
          {otcForm.customerId ? (
            <CustomerFundingSummaryInline
              items={otcFundingSummary}
              loading={otcFundingSummaryLoading}
              fromCurrency={otcForm.fromCurrency}
              toCurrency={otcForm.toCurrency}
              onFillBuy={fillOtcBuy}
              onFillSell={fillOtcSell}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setIsCreateCustomerModalOpen(true)}
          className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors whitespace-nowrap"
        >
          {t("orders.createNewCustomer")}
        </button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <select
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2"
          value={otcForm.fromCurrency}
          onChange={(e) => setOtcForm((p) => ({ ...p, fromCurrency: e.target.value }))}
          required
        >
          <option value="">{t("orders.from")}</option>
          {currencies
            .filter((c) => Boolean(c.active) && c.code !== otcForm.toCurrency)
            .map((c) => (
              <option key={c.id} value={c.code}>
                {c.code}
              </option>
            ))}
        </select>
        <div className="flex justify-center sm:pb-0.5">
          <CurrencyPairSwapButton
            label={t("orders.swapCurrencies")}
            disabled={!otcForm.fromCurrency && !otcForm.toCurrency}
            onClick={() =>
              setOtcForm((p) => ({
                ...p,
                fromCurrency: p.toCurrency,
                toCurrency: p.fromCurrency,
              }))
            }
          />
        </div>
        <select
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2"
          value={otcForm.toCurrency}
          onChange={(e) => setOtcForm((p) => ({ ...p, toCurrency: e.target.value }))}
          required
        >
          <option value="">{t("orders.to")}</option>
          {currencies
            .filter((c) => Boolean(c.active) && c.code !== otcForm.fromCurrency)
            .map((c) => (
              <option key={c.id} value={c.code}>
                {c.code}
              </option>
            ))}
        </select>
      </div>
      <input
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
        placeholder={t("orders.exchangeRate")}
        value={otcForm.rate}
        onChange={(e) => setOtcForm((p) => ({ ...p, rate: e.target.value }))}
        required
        type="number"
        step="0.0001"
        onWheel={handleNumberInputWheel}
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          className="rounded-lg border border-slate-200 px-3 py-2"
          placeholder={t("orders.amountBuy")}
          value={otcForm.amountBuy}
          onChange={(e) => {
            const value = e.target.value;
            setOtcForm((p) => ({ ...p, amountBuy: value }));
            if (value && otcForm.rate && otcForm.fromCurrency && otcForm.toCurrency) {
              const rate = Number(otcForm.rate);
              if (!isNaN(rate) && rate > 0) {
                const baseIsFrom = getBaseCurrency(otcForm.fromCurrency, otcForm.toCurrency);
                let sellAmount: string;
                if (baseIsFrom === true) {
                  sellAmount = (Number(value) * rate).toFixed(4);
                } else if (baseIsFrom === false) {
                  sellAmount = (Number(value) / rate).toFixed(4);
                } else {
                  sellAmount = (Number(value) * rate).toFixed(4);
                }
                setOtcForm((p) => ({ ...p, amountSell: sellAmount }));
              }
            }
          }}
          required
          type="number"
          onWheel={handleNumberInputWheel}
        />
        <input
          className="rounded-lg border border-slate-200 px-3 py-2"
          placeholder={t("orders.amountSell")}
          value={otcForm.amountSell}
          onChange={(e) => {
            const value = e.target.value;
            setOtcForm((p) => ({ ...p, amountSell: value }));
            if (value && otcForm.rate && otcForm.fromCurrency && otcForm.toCurrency) {
              const rate = Number(otcForm.rate);
              if (!isNaN(rate) && rate > 0) {
                const baseIsFrom = getBaseCurrency(otcForm.fromCurrency, otcForm.toCurrency);
                let buyAmount: string;
                if (baseIsFrom === true) {
                  buyAmount = (Number(value) / rate).toFixed(4);
                } else if (baseIsFrom === false) {
                  buyAmount = (Number(value) * rate).toFixed(4);
                } else {
                  buyAmount = (Number(value) / rate).toFixed(4);
                }
                setOtcForm((p) => ({ ...p, amountBuy: buyAmount }));
              }
            }
          }}
          required
          type="number"
          onWheel={handleNumberInputWheel}
        />
      </div>
      <div className="flex gap-2 items-center">
        <select
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2"
          value={otcForm.handlerId}
          onChange={(e) => handleHandlerChange(e.target.value)}
          required
        >
          <option value="">{t("orders.selectHandler")}</option>
          {users.filter((user) => user.role !== "admin").map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        {otcForm.handlerId && !isSavedOrder && (
          <button
            type="button"
            onClick={() => {
              if (authUser?.id && otcForm.handlerId) {
                if (isDefaultHandler) {
                  // Unset default
                  clearDefaultOtcHandler(authUser.id);
                  setDefaultHandlerId(null);
                  setOtcForm((p) => ({ ...p, handlerId: "" }));
                  // 我 comment out the confirmation message because it's not needed
                  // alert(t("orders.defaultHandlerUnset") || "Default handler unset successfully");
                } else {
                  // Set default
                  saveDefaultOtcHandler(authUser.id, otcForm.handlerId);
                  setDefaultHandlerId(otcForm.handlerId);
                  // 我 comment out the confirmation message because it's not needed
                  // alert(t("orders.defaultHandlerSet") || "Default handler set successfully");
                }
              }
            }}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
              isDefaultHandler
                ? "text-red-700 bg-red-50 border-red-200 hover:bg-red-100"
                : "text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100"
            }`}
            title={
              isDefaultHandler
                ? t("orders.unsetDefaultHandler") || "Unset default handler"
                : t("orders.setDefaultHandler") || "Set as default handler"
            }
          >
            {isDefaultHandler
              ? t("orders.unsetDefault") || "Unset Default"
              : t("orders.setDefault") || "Set Default"}
          </button>
        )}
      </div>
    </div>

    <div className="space-y-3 border-b border-slate-200 pb-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">
          {t("orders.receipts")} ({otcForm.fromCurrency})
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              // Auto fill: add receipt with amountBuy and payment with amountSell
              const newReceipts = [...otcReceipts];
              const newPayments = [...otcPayments];
              
              // Add receipt with amountBuy if it exists and is not empty
              if (otcForm.amountBuy && Number(otcForm.amountBuy) > 0) {
                newReceipts.push({ amount: otcForm.amountBuy, accountId: "" });
              }
              
              // Add payment with amountSell if it exists and is not empty
              if (otcForm.amountSell && Number(otcForm.amountSell) > 0) {
                newPayments.push({ amount: otcForm.amountSell, accountId: "" });
              }
              
              setOtcReceipts(newReceipts);
              setOtcPayments(newPayments);
            }}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-colors"
            disabled={!otcForm.amountBuy || !otcForm.amountSell || Number(otcForm.amountBuy) <= 0 || Number(otcForm.amountSell) <= 0}
            title={t("orders.autoFillTooltip") || "Auto fill receipts and payments with buy/sell amounts"}
          >
            {t("orders.autoFill") || "Auto Fill"}
          </button>
          <button
            type="button"
            onClick={() =>
              setOtcReceipts([
                ...otcReceipts,
                { amount: "", accountId: "", fundedFrom: "cash" },
              ])
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            {t("orders.addReceipt")}
          </button>
        </div>
      </div>
      {otcReceipts.map((receipt, index) => (
        <div
          key={index}
          className="flex flex-nowrap items-center gap-2 overflow-visible p-3 bg-slate-50 rounded-lg"
        >
          <input
            type="number"
            step="0.01"
            placeholder={t("orders.amount")}
            value={receipt.amount}
            onChange={(e) => {
              const newReceipts = [...otcReceipts];
              newReceipts[index] = { ...newReceipts[index], amount: e.target.value };
              setOtcReceipts(newReceipts);
            }}
            className="w-28 shrink-0 rounded-lg border border-slate-200 px-3 py-2"
            required
            onWheel={handleNumberInputWheel}
          />
          <div className="flex shrink-0 rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${
                (receipt.fundedFrom ?? "cash") === "cash"
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title={t("orders.receiptFundedCash")}
              onClick={() => {
                const newReceipts = [...otcReceipts];
                newReceipts[index] = { ...newReceipts[index], fundedFrom: "cash" };
                setOtcReceipts(newReceipts);
              }}
            >
              {t("orders.receiptFundedCashShort")}
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${
                (receipt.fundedFrom ?? "cash") === "customer_balance"
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title={t("orders.receiptFundedBalance")}
              onClick={() => {
                const newReceipts = [...otcReceipts];
                newReceipts[index] = {
                  ...newReceipts[index],
                  fundedFrom: "customer_balance",
                  accountId: "",
                };
                setOtcReceipts(newReceipts);
              }}
            >
              {t("orders.receiptFundedBalanceShort")}
            </button>
          </div>
          {(receipt.fundedFrom ?? "cash") === "customer_balance" && (
            <OrderLineBalanceField
              messageKey="orders.linePrepaidBalance"
              amount={prepaidBalance?.allocatable ?? 0}
              currency={otcForm.fromCurrency}
              t={t}
            />
          )}
          {(receipt.fundedFrom ?? "cash") === "cash" && (
            <select
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2"
              value={receipt.accountId}
              onChange={(e) => {
                const newReceipts = [...otcReceipts];
                newReceipts[index] = { ...newReceipts[index], accountId: e.target.value };
                setOtcReceipts(newReceipts);
              }}
              required
            >
              <option value="">
                {t("orders.selectAccount")} ({otcForm.fromCurrency})
              </option>
              {accounts
                .filter((a) => a.currencyCode === otcForm.fromCurrency)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.balance.toFixed(2)} {acc.currencyCode})
                  </option>
                ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setOtcReceipts(otcReceipts.filter((_, i) => i !== index))}
            className="shrink-0 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
          >
            {t("orders.remove")}
          </button>
        </div>
      ))}
      <div className="text-sm text-slate-600">
        {t("orders.total")}: {otcReceipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toFixed(2)}{" "}
        {otcForm.fromCurrency}
      </div>
    </div>

    <div className="space-y-3 border-b border-slate-200 pb-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">
          {t("orders.payments")} ({otcForm.toCurrency})
        </h3>
        <button
          type="button"
          onClick={() =>
            setOtcPayments([...otcPayments, { amount: "", accountId: "", fundedFrom: "cash" }])
          }
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
        >
          {t("orders.addPayment")}
        </button>
      </div>
      {otcPayments.map((payment, index) => (
        <div
          key={index}
          className="flex flex-wrap items-center gap-2 overflow-visible rounded-lg bg-slate-50 p-3"
        >
          <input
            type="number"
            step="0.01"
            placeholder={t("orders.amount")}
            value={payment.amount}
            onChange={(e) => {
              const newPayments = [...otcPayments];
              newPayments[index] = { ...newPayments[index], amount: e.target.value };
              setOtcPayments(newPayments);
            }}
            className="w-28 shrink-0 rounded-lg border border-slate-200 px-3 py-2"
            required
            onWheel={handleNumberInputWheel}
          />
          <div className="flex shrink-0 rounded-md border border-slate-200 overflow-hidden text-xs font-semibold">
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${
                (payment.fundedFrom ?? "cash") === "cash"
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title={t("orders.paymentFundedCash")}
              onClick={() => {
                const newPayments = [...otcPayments];
                newPayments[index] = { ...newPayments[index], fundedFrom: "cash" };
                setOtcPayments(newPayments);
              }}
            >
              {t("orders.paymentFundedCashShort")}
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 transition-colors ${
                (payment.fundedFrom ?? "cash") === "customer_balance"
                  ? "bg-slate-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              title={t("orders.paymentFundedBalance")}
              onClick={() => {
                const newPayments = [...otcPayments];
                newPayments[index] = {
                  ...newPayments[index],
                  fundedFrom: "customer_balance",
                  accountId: "",
                };
                setOtcPayments(newPayments);
              }}
            >
              {t("orders.paymentFundedBalanceShort")}
            </button>
          </div>
          {(payment.fundedFrom ?? "cash") === "customer_balance" && (
            <OrderLineBalanceField
              messageKey="orders.lineAdvanceBalance"
              amount={advanceBalance?.allocatableAdvance ?? 0}
              currency={otcForm.toCurrency}
              variant="advance"
              t={t}
            />
          )}
          {(payment.fundedFrom ?? "cash") === "cash" && (
            <select
              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2"
              value={payment.accountId}
              onChange={(e) => {
                const newPayments = [...otcPayments];
                newPayments[index] = { ...newPayments[index], accountId: e.target.value };
                setOtcPayments(newPayments);
              }}
              required
            >
              <option value="">
                {t("orders.selectAccount")} ({otcForm.toCurrency})
              </option>
              {accounts
                .filter((a) => a.currencyCode === otcForm.toCurrency)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.balance.toFixed(2)} {acc.currencyCode})
                  </option>
                ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setOtcPayments(otcPayments.filter((_, i) => i !== index))}
            className="shrink-0 rounded-lg px-3 py-2 text-red-600 hover:bg-red-50"
          >
            {t("orders.remove")}
          </button>
        </div>
      ))}
      <div className="text-sm text-slate-600">
        {t("orders.total")}: {otcPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0).toFixed(2)}{" "}
        {otcForm.toCurrency}
      </div>
    </div>

    <div className="space-y-3 border-b border-slate-200 pb-4">
      {!showOtcProfitSection ? (
        <button
          type="button"
          onClick={() => setShowOtcProfitSection(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          {t("orders.addProfit")}
        </button>
      ) : (
        <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-blue-900">{t("orders.profit")}</h3>
            <button
              type="button"
              onClick={async () => {
                if (onRemoveProfit) {
                  await onRemoveProfit();
                } else {
                  setShowOtcProfitSection(false);
                  setOtcProfitAmount("");
                  setOtcProfitCurrency("");
                  setOtcProfitAccountId("");
                }
              }}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              {t("orders.remove")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              step="0.01"
              placeholder={t("orders.amount")}
              value={otcProfitAmount}
              onChange={(e) => setOtcProfitAmount(e.target.value)}
              className="rounded-lg border border-blue-300 px-3 py-2"
              onWheel={handleNumberInputWheel}
            />
            <select
              value={otcProfitCurrency}
              onChange={(e) => {
                setOtcProfitCurrency(e.target.value);
                setOtcProfitAccountId("");
              }}
              className="rounded-lg border border-blue-300 px-3 py-2"
            >
              <option value="">{t("orders.selectCurrency")}</option>
              {otcForm.fromCurrency && <option value={otcForm.fromCurrency}>{otcForm.fromCurrency}</option>}
              {otcForm.toCurrency && <option value={otcForm.toCurrency}>{otcForm.toCurrency}</option>}
            </select>
          </div>
          {otcProfitCurrency && (
            <select
              className="w-full mt-3 rounded-lg border border-blue-300 px-3 py-2"
              value={otcProfitAccountId}
              onChange={(e) => setOtcProfitAccountId(e.target.value)}
            >
              <option value="">
                {t("orders.selectAccount")} ({otcProfitCurrency})
              </option>
              {accounts
                .filter((a) => a.currencyCode === otcProfitCurrency)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.balance.toFixed(2)} {acc.currencyCode})
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
    </div>

    <div className="space-y-3 border-b border-slate-200 pb-4">
      {!showOtcServiceChargeSection ? (
        <button
          type="button"
          onClick={() => setShowOtcServiceChargeSection(true)}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
        >
          {t("orders.addServiceCharges")}
        </button>
      ) : (
        <div className="p-4 border border-green-200 rounded-lg bg-green-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-green-900">{t("orders.serviceCharges")}</h3>
            <button
              type="button"
              onClick={async () => {
                if (onRemoveServiceCharge) {
                  await onRemoveServiceCharge();
                } else {
                  setShowOtcServiceChargeSection(false);
                  setOtcServiceChargeAmount("");
                  setOtcServiceChargeCurrency("");
                  setOtcServiceChargeAccountId("");
                }
              }}
              className="text-green-600 hover:text-green-800 text-sm"
            >
              {t("orders.remove")}
            </button>
          </div>
          <div className="space-y-3">
            <input
              type="number"
              step="0.01"
              placeholder={
                isOtcScBalanceFunded
                  ? t("orders.amount")
                  : t("orders.amountNegativeIfPaidByUs")
              }
              value={otcServiceChargeAmount}
              onChange={(e) => setOtcServiceChargeAmount(e.target.value)}
              className="w-full rounded-lg border border-green-300 px-3 py-2"
              onWheel={handleNumberInputWheel}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex rounded-md border border-green-300 overflow-hidden text-xs font-semibold bg-white">
                <button
                  type="button"
                  className={`px-3 py-2 transition-colors ${
                    !isOtcScBalanceFunded ? "bg-green-700 text-white" : "text-green-800 hover:bg-green-100"
                  }`}
                  onClick={() => setOtcServiceChargeFundedFrom("cash")}
                >
                  {t("orders.receiptFundedCashShort")}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 transition-colors ${
                    isOtcScBalanceFunded ? "bg-green-700 text-white" : "text-green-800 hover:bg-green-100"
                  }`}
                  disabled={!otcForm.customerId}
                  onClick={() => {
                    setOtcServiceChargeFundedFrom("customer_balance");
                    setOtcServiceChargeAccountId("");
                  }}
                >
                  {t("orders.receiptFundedBalanceShort")}
                </button>
              </div>
              <select
                value={otcServiceChargeCurrency}
                onChange={(e) => {
                  setOtcServiceChargeCurrency(e.target.value);
                  setOtcServiceChargeAccountId("");
                }}
                className="min-w-[140px] flex-1 rounded-lg border border-green-300 px-3 py-2"
              >
                <option value="">{t("orders.selectCurrency")}</option>
                {(isOtcScBalanceFunded
                  ? otcFundingSummary.filter((c) => c.allocatable >= 0.005).map((c) => c.currencyCode)
                  : [otcForm.fromCurrency, otcForm.toCurrency].filter(Boolean)
                ).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isOtcScBalanceFunded && otcServiceChargeCurrency && (
            <OrderLineBalanceField
              messageKey="orders.linePrepaidBalance"
              amount={
                otcFundingSummary.find((c) => c.currencyCode === otcServiceChargeCurrency)?.allocatable ?? 0
              }
              currency={otcServiceChargeCurrency}
              t={t}
            />
          )}
          {!isOtcScBalanceFunded && otcServiceChargeCurrency && (
            <select
              className="w-full mt-3 rounded-lg border border-green-300 px-3 py-2"
              value={otcServiceChargeAccountId}
              onChange={(e) => setOtcServiceChargeAccountId(e.target.value)}
            >
              <option value="">
                {t("orders.selectAccount")} ({otcServiceChargeCurrency})
              </option>
              {accounts
                .filter((a) => a.currencyCode === otcServiceChargeCurrency)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.balance.toFixed(2)} {acc.currencyCode})
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
    </div>

    <RemarksSection
      remarks={otcRemarks}
      setRemarks={setOtcRemarks}
      showRemarks={showOtcRemarks}
      setShowRemarks={setShowOtcRemarks}
      onRemove={onRemoveRemarks}
      t={t}
    />

    <div className="flex gap-3 justify-end">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        {t("common.cancel")}
      </button>
      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60 transition-colors"
      >
        {isSaving ? t("common.saving") : t("common.save")}
      </button>
      <button
        type="button"
        onClick={onComplete}
        disabled={isSaving}
        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-60 transition-colors"
      >
        {t("orders.complete")}
      </button>
    </div>

    {/* Handler Change Warning Modal */}
    {showHandlerChangeWarning && (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            {t("orders.changeHandlerWarning") || "Change Handler Warning"}
          </h3>
          <p className="text-sm text-slate-600 mb-6">
            {t("orders.changeHandlerWarningMessage") || 
              "Changing the handler will revoke the current handler's access to add receipts, payments, profits, and service charges to this order. Only the new handler and order creator will have access. Are you sure you want to proceed?"}
          </p>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={cancelHandlerChange}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              {t("common.cancel") || "Cancel"}
            </button>
            <button
              type="button"
              onClick={confirmHandlerChange}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              {t("orders.confirmChangeHandler") || "Confirm Change"}
            </button>
          </div>
        </div>
      </div>
    )}
  </form>
  );
};

export default function OtcOrderModal({
  isOpen,
  isSaving,
  isOtcCompleted,
  otcEditingOrderId,
  otcOrderDetails,
  customers,
  users,
  currencies,
  accounts,
  otcForm,
  setOtcForm,
  otcReceipts,
  setOtcReceipts,
  otcPayments,
  setOtcPayments,
  showOtcProfitSection,
  setShowOtcProfitSection,
  showOtcServiceChargeSection,
  setShowOtcServiceChargeSection,
  otcProfitAmount,
  setOtcProfitAmount,
  otcProfitCurrency,
  setOtcProfitCurrency,
  otcProfitAccountId,
  setOtcProfitAccountId,
  otcServiceChargeAmount,
  setOtcServiceChargeAmount,
  otcServiceChargeCurrency,
  setOtcServiceChargeCurrency,
  otcServiceChargeAccountId,
  setOtcServiceChargeAccountId,
  otcServiceChargeFundedFrom,
  setOtcServiceChargeFundedFrom,
  otcRemarks,
  setOtcRemarks,
  showOtcRemarks,
  setShowOtcRemarks,
  handleNumberInputWheel,
  getBaseCurrency,
  onSave,
  onComplete,
  onClose,
  setIsCreateCustomerModalOpen,
  authUser,
  onRemoveProfit,
  onRemoveServiceCharge,
  onRemoveRemarks,
  t,
}: OtcOrderModalProps) {
  const shouldShowViewMode = Boolean(otcEditingOrderId && isOtcCompleted);

  const heading = shouldShowViewMode
    ? t("orders.viewOtcOrder")
    : otcEditingOrderId
      ? t("orders.editOtcOrder")
      : t("orders.createOtcOrder");

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50"
      style={{ margin: 0, padding: 0 }}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">{heading}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label={t("common.close")}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {shouldShowViewMode && otcOrderDetails?.order ? (
            <OtcOrderView
              accounts={accounts}
              customers={customers}
              users={users}
              otcOrderDetails={otcOrderDetails}
              onClose={onClose}
              t={t}
            />
          ) : (
            <OtcOrderForm
              accounts={accounts}
              customers={customers}
              users={users}
              currencies={currencies}
              otcForm={otcForm}
              setOtcForm={setOtcForm}
              otcReceipts={otcReceipts}
              setOtcReceipts={setOtcReceipts}
              otcPayments={otcPayments}
              setOtcPayments={setOtcPayments}
              showOtcProfitSection={showOtcProfitSection}
              setShowOtcProfitSection={setShowOtcProfitSection}
              showOtcServiceChargeSection={showOtcServiceChargeSection}
              setShowOtcServiceChargeSection={setShowOtcServiceChargeSection}
              otcProfitAmount={otcProfitAmount}
              setOtcProfitAmount={setOtcProfitAmount}
              otcProfitCurrency={otcProfitCurrency}
              setOtcProfitCurrency={setOtcProfitCurrency}
              otcProfitAccountId={otcProfitAccountId}
              setOtcProfitAccountId={setOtcProfitAccountId}
              otcServiceChargeAmount={otcServiceChargeAmount}
              setOtcServiceChargeAmount={setOtcServiceChargeAmount}
              otcServiceChargeCurrency={otcServiceChargeCurrency}
              setOtcServiceChargeCurrency={setOtcServiceChargeCurrency}
              otcServiceChargeAccountId={otcServiceChargeAccountId}
              setOtcServiceChargeAccountId={setOtcServiceChargeAccountId}
              otcServiceChargeFundedFrom={otcServiceChargeFundedFrom}
              setOtcServiceChargeFundedFrom={setOtcServiceChargeFundedFrom}
              otcRemarks={otcRemarks}
              setOtcRemarks={setOtcRemarks}
              showOtcRemarks={showOtcRemarks}
              setShowOtcRemarks={setShowOtcRemarks}
              handleNumberInputWheel={handleNumberInputWheel}
              getBaseCurrency={getBaseCurrency}
              onSave={onSave}
              onComplete={onComplete}
              onClose={onClose}
              setIsCreateCustomerModalOpen={setIsCreateCustomerModalOpen}
              isSaving={isSaving}
              authUser={authUser}
              otcEditingOrderId={otcEditingOrderId}
              otcOrderDetails={otcOrderDetails}
              onRemoveProfit={onRemoveProfit}
              onRemoveServiceCharge={onRemoveServiceCharge}
              onRemoveRemarks={onRemoveRemarks}
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  );
}

