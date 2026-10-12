import { useTranslation } from "react-i18next";
import type { AccountMonthlyPnLBreakdown } from "../../types";
import { formatAccountAmount } from "../../utils/accounts/accountReportFormat";

function amountClass(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-600";
}

function formatSigned(value: number, currency: string) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatAccountAmount(value, currency)}`;
}

export default function AccountMonthlyPnLBreakdownSection({
  breakdown,
}: {
  breakdown: AccountMonthlyPnLBreakdown;
}) {
  const { t } = useTranslation();
  const { targetCurrency } = breakdown;

  const rows = [
    { label: t("reports.pnlOrderGrossProfit"), value: breakdown.orderGrossProfit },
    { label: t("reports.pnlServiceCharges"), value: breakdown.serviceCharges },
    { label: t("reports.pnlOtherIncome"), value: breakdown.otherIncome },
    { label: t("reports.pnlTotalExpenses"), value: -breakdown.totalExpenses },
    { label: t("reports.pnlTransferFees"), value: -breakdown.transferFees },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {t("reports.usingCalculation")}:{" "}
        <span className="font-semibold">{breakdown.profitCalculationName}</span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 font-semibold text-slate-700">{t("reports.pnlSource")}</th>
              <th className="px-3 py-2 font-semibold text-slate-700 text-right">
                {t("reports.pnlAmount", { currency: targetCurrency })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-800">{row.label}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${amountClass(row.value)}`}>
                  {formatSigned(row.value, targetCurrency)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="px-3 py-2 text-slate-900">{t("reports.pnlTotal")}</td>
              <td
                className={`px-3 py-2 text-right tabular-nums text-base ${amountClass(breakdown.total)}`}
              >
                {formatSigned(breakdown.total, targetCurrency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t("reports.pnlBreakdownNote")}</p>
    </div>
  );
}
