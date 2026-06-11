import React, { useMemo } from "react";
import type { Account, Order, ReceiptFundedFrom } from "../../types";
import { useGetCustomerFundingBalancesQuery } from "../../services/api";
import { OrderLineBalanceField } from "./NewOrderModal";

const PREPAID_EPSILON = 0.005;

interface ServiceChargeSectionProps {
  serviceChargeAmount: string;
  setServiceChargeAmount: (value: string) => void;
  serviceChargeCurrency: string;
  setServiceChargeCurrency: (value: string) => void;
  serviceChargeAccountId: string;
  setServiceChargeAccountId: (value: string) => void;
  serviceChargeFundedFrom: ReceiptFundedFrom;
  setServiceChargeFundedFrom: (value: ReceiptFundedFrom) => void;
  showServiceChargeSection: boolean;
  setShowServiceChargeSection: (show: boolean) => void;
  onSave: () => Promise<void>;
  onRemove?: () => Promise<void>;
  order: Order | null | undefined;
  accounts: Account[];
  handleNumberInputWheel: (e: React.WheelEvent<HTMLInputElement>) => void;
  t: (key: string) => string | undefined;
}

export const ServiceChargeSection: React.FC<ServiceChargeSectionProps> = ({
  serviceChargeAmount,
  setServiceChargeAmount,
  serviceChargeCurrency,
  setServiceChargeCurrency,
  serviceChargeAccountId,
  setServiceChargeAccountId,
  serviceChargeFundedFrom,
  setServiceChargeFundedFrom,
  showServiceChargeSection,
  setShowServiceChargeSection,
  onSave,
  onRemove,
  order,
  accounts,
  handleNumberInputWheel,
  t,
}) => {
  const customerId = order?.customerId ?? null;
  const { data: fundingBalances } = useGetCustomerFundingBalancesQuery(customerId!, {
    skip: !customerId,
  });

  const prepaidByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of fundingBalances?.currencies ?? []) {
      if (row.allocatable >= PREPAID_EPSILON) {
        map.set(row.currencyCode, row.allocatable);
      }
    }
    return map;
  }, [fundingBalances]);

  const isBalanceFunded = serviceChargeFundedFrom === "customer_balance";

  const currencyOptions = useMemo(() => {
    const pair = [order?.fromCurrency, order?.toCurrency].filter(Boolean) as string[];
    if (isBalanceFunded) {
      return [...prepaidByCurrency.keys()].sort();
    }
    return pair;
  }, [isBalanceFunded, order?.fromCurrency, order?.toCurrency, prepaidByCurrency]);

  if (!showServiceChargeSection) return null;

  const handleRemoveClick = async () => {
    if (onRemove) {
      await onRemove();
    } else {
      setShowServiceChargeSection(false);
      setServiceChargeAmount("");
      setServiceChargeCurrency("");
      setServiceChargeAccountId("");
      setServiceChargeFundedFrom("cash");
    }
  };

  const prepaidForCurrency = serviceChargeCurrency
    ? prepaidByCurrency.get(serviceChargeCurrency) ?? 0
    : 0;

  return (
    <div className="p-4 border border-green-200 rounded-lg bg-green-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-green-900">{t("orders.serviceCharges")}</h3>
        <button
          type="button"
          onClick={handleRemoveClick}
          className="text-green-600 hover:text-green-800 text-sm"
        >
          {t("common.remove")}
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-green-900 mb-1">
            {t("orders.serviceChargeAmount")}
          </label>
          <input
            type="number"
            step="0.01"
            value={serviceChargeAmount}
            onChange={(e) => setServiceChargeAmount(e.target.value)}
            onWheel={handleNumberInputWheel}
            className="w-full rounded-lg border border-green-300 px-3 py-2"
            placeholder={
              isBalanceFunded
                ? t("orders.amount")
                : t("orders.amountNegativeIfPaidByUs")
            }
          />
          {!isBalanceFunded && (
            <p className="text-xs text-green-700 mt-1">{t("orders.negativeForPaidByUs")}</p>
          )}
          {isBalanceFunded && (
            <p className="text-xs text-green-700 mt-1">{t("orders.serviceChargeBalDeductHint")}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="block text-xs font-medium text-green-900 mb-1">
              {t("orders.serviceChargeFunding")}
            </span>
            <div className="flex rounded-md border border-green-300 overflow-hidden text-xs font-semibold bg-white">
              <button
                type="button"
                className={`px-3 py-2 transition-colors ${
                  !isBalanceFunded ? "bg-green-700 text-white" : "text-green-800 hover:bg-green-100"
                }`}
                title={t("orders.receiptFundedCash")}
                onClick={() => {
                  setServiceChargeFundedFrom("cash");
                }}
              >
                {t("orders.receiptFundedCashShort")}
              </button>
              <button
                type="button"
                className={`px-3 py-2 transition-colors ${
                  isBalanceFunded ? "bg-green-700 text-white" : "text-green-800 hover:bg-green-100"
                }`}
                title={t("orders.serviceChargeFundedBalance")}
                disabled={!customerId}
                onClick={() => {
                  setServiceChargeFundedFrom("customer_balance");
                  setServiceChargeAccountId("");
                  if (
                    serviceChargeCurrency &&
                    !prepaidByCurrency.has(serviceChargeCurrency)
                  ) {
                    setServiceChargeCurrency("");
                  }
                }}
              >
                {t("orders.receiptFundedBalanceShort")}
              </button>
            </div>
          </div>

          <div className="min-w-[140px] flex-1">
            <label className="block text-sm font-medium text-green-900 mb-1">
              {t("orders.serviceChargeCurrency")}
            </label>
            <select
              value={serviceChargeCurrency}
              onChange={(e) => {
                setServiceChargeCurrency(e.target.value);
                setServiceChargeAccountId("");
              }}
              className="w-full rounded-lg border border-green-300 px-3 py-2"
            >
              <option value="">{t("orders.selectCurrency")}</option>
              {currencyOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                  {isBalanceFunded
                    ? ` (${(prepaidByCurrency.get(code) ?? 0).toFixed(2)} ${t("orders.receiptFundedBalanceShort")})`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isBalanceFunded && serviceChargeCurrency && (
          <OrderLineBalanceField
            messageKey="orders.linePrepaidBalance"
            amount={prepaidForCurrency}
            currency={serviceChargeCurrency}
            t={t as (key: string, opts?: Record<string, string>) => string}
          />
        )}

        {!isBalanceFunded && serviceChargeCurrency && (
          <div>
            <label className="block text-sm font-medium text-green-900 mb-1">
              {t("orders.selectAccount")} ({serviceChargeCurrency})
            </label>
            <select
              value={serviceChargeAccountId}
              onChange={(e) => setServiceChargeAccountId(e.target.value)}
              className="w-full rounded-lg border border-green-300 px-3 py-2"
              required
            >
              <option value="">{t("orders.selectAccount")}</option>
              {accounts
                .filter((acc) => acc.currencyCode === serviceChargeCurrency)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.balance.toFixed(2)} {account.currencyCode})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSave}
        className="mt-3 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
      >
        {t("common.save")}
      </button>
    </div>
  );
};
