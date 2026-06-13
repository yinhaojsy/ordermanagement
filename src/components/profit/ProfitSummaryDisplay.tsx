import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import type { ProfitSummaryData } from "../../hooks/useProfitSummary";
import type { Currency } from "../../types";
import { convertCurrency } from "../../utils/orders/orderCalculations";

// Helper function to format currency with proper number formatting
const formatCurrency = (amount: number, currencyCode: string) => {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencyCode}`;
};

interface ProfitSummaryDisplayProps {
  summary: ProfitSummaryData;
  currencies?: Currency[];
  showTitle?: boolean;
  title?: string;
  description?: string;
}

export default function ProfitSummaryDisplay({
  summary,
  currencies = [],
  showTitle = false,
  title,
  description,
}: ProfitSummaryDisplayProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Group Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from(summary.groupSums.entries())
          .filter(([groupId]) => groupId !== "ungrouped")
          .map(([groupId, currencySums]) => {
            const groupName = summary.groupNames.get(groupId) || groupId;
            const convertedTotal = summary.groupConvertedTotals.get(groupId) || 0;
            return (
              <div
                key={groupId}
                className="p-4 border border-slate-200 rounded-lg bg-slate-50"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-900">{groupName}</span>
                  <Badge tone="blue">
                    {summary.groupAccountCounts.get(groupId) || 0} {t("accounts.accounts")}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {Array.from(currencySums.entries()).map(([currency, sum]) => {
                    const key = `${currency}_${summary.targetCurrency}`;
                    const defaultRate = currency === summary.targetCurrency ? 1 : 0;
                    const rate = summary.exchangeRateMap.get(key) || defaultRate;
                    const converted = rate > 0
                      ? convertCurrency(sum, rate, currency, summary.targetCurrency, currencies)
                      : sum;
                    return (
                      <div key={currency} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">{currency}:</span>
                          <span className="font-semibold">{formatCurrency(sum, currency)}</span>
                        </div>

                        {/*  SHOW →HKD AMOUNT IN HKD FOR CURRENCY THAT IS NOT HKD, COMMENTED OUT BECAUSE TOTAL ALREADY SHOWN
                        {currency !== summary.targetCurrency && rate > 0 && (
                          <div className="flex justify-between text-xs text-slate-500 ml-2">
                            <span>→ {summary.targetCurrency}:</span>
                            <span>{formatCurrency(converted, summary.targetCurrency)}</span>
                          </div>
                        )} */}
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t border-slate-200 mt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-700 font-semibold">
                        {t("profit.total") || "Total"} ({summary.targetCurrency}):
                      </span>
                      <span className="font-bold text-slate-900">
                        {formatCurrency(convertedTotal, summary.targetCurrency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Totals */}
      <div className="border-t-2 border-slate-300 pt-4 mt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 border border-slate-200 rounded-lg bg-blue-50">
            <div className="text-sm font-semibold text-slate-700 mb-1">
              {t("profit.totalConverted") || "Total Converted"}
            </div>
            <div className="text-2xl font-bold text-blue-700">
              {formatCurrency(summary.totalConverted, summary.targetCurrency)}
            </div>
          </div>
          <div className="p-4 border border-slate-200 rounded-lg bg-indigo-50">
            <div className="text-sm font-semibold text-slate-700 mb-1">
              {t("profit.totalCustomerDeposit") || "Customer Deposits"}
            </div>
            <div className="text-2xl font-bold text-indigo-800">
              {formatCurrency(summary.totalCustomerDepositConverted, summary.targetCurrency)}
            </div>
          </div>
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50">
            <div className="text-sm font-semibold text-slate-700 mb-1">
              {t("profit.totalInvestment") || "Total Investment"}
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {formatCurrency(summary.totalInvestment, summary.targetCurrency)}
            </div>
          </div>
          <div className={`p-4 border border-slate-200 rounded-lg ${
            summary.totalProfit >= 0 ? "bg-emerald-50" : "bg-rose-50"
          }`}>
            <div className="text-sm font-semibold text-slate-700 mb-1">
              {t("profit.totalProfit") || "Total Profit"}
            </div>
            <div className={`text-2xl font-bold ${
              summary.totalProfit >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}>
              {formatCurrency(summary.totalProfit, summary.targetCurrency)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

