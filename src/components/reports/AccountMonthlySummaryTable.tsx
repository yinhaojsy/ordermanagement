import { useTranslation } from "react-i18next";
import type { AccountMonthlySummaryRow } from "../../types";
import { formatAccountAmount } from "../../utils/accounts/accountReportFormat";

function amountClass(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-600";
}

export default function AccountMonthlySummaryTable({
  accounts,
}: {
  accounts: AccountMonthlySummaryRow[];
}) {
  const { t } = useTranslation();

  if (accounts.length === 0) {
    return <p className="text-sm text-slate-500">{t("reports.noAccounts")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 font-semibold text-slate-700">{t("accounts.accountName")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700">{t("accounts.currencyCode")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.openingBalance")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.totalInflow")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.totalOutflow")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.closingBalance")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.netChange")}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-900">{account.name}</td>
              <td className="px-3 py-2 text-slate-600">{account.currencyCode}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatAccountAmount(account.openingBalance, account.currencyCode)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${amountClass(account.totalInflow)}`}>
                +{formatAccountAmount(account.totalInflow, account.currencyCode)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${amountClass(-account.totalOutflow)}`}>
                -{formatAccountAmount(account.totalOutflow, account.currencyCode)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatAccountAmount(account.closingBalance, account.currencyCode)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${amountClass(account.netChange)}`}>
                {account.netChange > 0 ? "+" : ""}
                {formatAccountAmount(account.netChange, account.currencyCode)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
