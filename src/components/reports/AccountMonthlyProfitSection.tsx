import { useTranslation } from "react-i18next";
import type { ProfitSummaryData } from "../../hooks/useProfitSummary";
import { formatAccountAmount } from "../../utils/accounts/accountReportFormat";

function SnapshotCard({
  title,
  summary,
  convertedLabel,
  depositsLabel,
  profitLabel,
}: {
  title: string;
  summary: ProfitSummaryData;
  convertedLabel: string;
  depositsLabel: string;
  profitLabel: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-slate-500">{convertedLabel}</div>
          <div className="font-semibold tabular-nums">
            {formatAccountAmount(summary.totalConverted, summary.targetCurrency)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">{depositsLabel}</div>
          <div className="font-semibold tabular-nums">
            {formatAccountAmount(summary.totalCustomerDepositConverted, summary.targetCurrency)}
          </div>
        </div>
        <div className="col-span-2 pt-2 border-t border-slate-200">
          <div className="text-slate-500">{profitLabel}</div>
          <div
            className={`text-lg font-bold tabular-nums ${
              summary.totalProfit >= 0 ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {formatAccountAmount(summary.totalProfit, summary.targetCurrency)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountMonthlyProfitSection({
  calculationName,
  startSummary,
  endSummary,
  monthlyProfit,
}: {
  calculationName?: string;
  startSummary: ProfitSummaryData | null;
  endSummary: ProfitSummaryData | null;
  monthlyProfit: number | null;
}) {
  const { t } = useTranslation();

  if (!startSummary || !endSummary || monthlyProfit === null) {
    return (
      <p className="text-sm text-slate-500">{t("reports.profitUnavailable")}</p>
    );
  }

  return (
    <div className="space-y-4">
      {calculationName && (
        <p className="text-sm text-slate-600">
          {t("reports.usingCalculation")}: <span className="font-semibold">{calculationName}</span>
        </p>
      )}
      <p className="text-xs text-slate-500">{t("reports.depositHistoricalNote")}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SnapshotCard
          title={t("reports.periodStart")}
          summary={startSummary}
          convertedLabel={t("profit.totalConverted")}
          depositsLabel={t("profit.totalCustomerDeposit")}
          profitLabel={t("profit.totalProfit")}
        />
        <SnapshotCard
          title={t("reports.periodEnd")}
          summary={endSummary}
          convertedLabel={t("profit.totalConverted")}
          depositsLabel={t("profit.totalCustomerDeposit")}
          profitLabel={t("profit.totalProfit")}
        />
      </div>
      <div
        className={`rounded-xl border-2 px-5 py-4 ${
          monthlyProfit >= 0 ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
        }`}
      >
        <div className="text-sm font-medium text-slate-700">{t("reports.monthlyProfit")}</div>
        <div
          className={`mt-1 text-2xl font-bold tabular-nums ${
            monthlyProfit >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {monthlyProfit > 0 ? "+" : ""}
          {formatAccountAmount(monthlyProfit, endSummary.targetCurrency)}
        </div>
      </div>
    </div>
  );
}
