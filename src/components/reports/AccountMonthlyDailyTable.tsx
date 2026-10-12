import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AccountMonthlyDailyRow, AccountMonthlySummaryRow } from "../../types";
import { formatAccountAmount, formatShortDate } from "../../utils/accounts/accountReportFormat";

function cellText(inflow: number, outflow: number, currencyCode: string) {
  if (inflow === 0 && outflow === 0) return "—";
  const parts: string[] = [];
  if (inflow > 0) parts.push(`+${formatAccountAmount(inflow, currencyCode)}`);
  if (outflow > 0) parts.push(`-${formatAccountAmount(outflow, currencyCode)}`);
  return parts.join(" / ");
}

export default function AccountMonthlyDailyTable({
  accounts,
  daily,
}: {
  accounts: AccountMonthlySummaryRow[];
  daily: AccountMonthlyDailyRow[];
}) {
  const { t } = useTranslation();

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  if (accounts.length === 0 || daily.length === 0) {
    return <p className="text-sm text-slate-500">{t("reports.noDailyData")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[32rem]">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            <th className="px-2 py-2 font-semibold text-slate-700 sticky left-0 bg-slate-50 z-20 min-w-[5rem]">
              {t("common.entryDate")}
            </th>
            {accounts.map((account) => (
              <th
                key={account.id}
                className="px-2 py-2 font-semibold text-slate-700 min-w-[8rem] whitespace-nowrap"
                title={`${account.name} (${account.currencyCode})`}
              >
                <div className="truncate max-w-[7rem]">{account.name}</div>
                <div className="text-[10px] font-normal text-slate-500">{account.currencyCode}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {daily.map((row) => (
            <tr key={row.date} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-medium text-slate-700 sticky left-0 bg-white z-10 whitespace-nowrap">
                {formatShortDate(row.date)}
              </td>
              {accountIds.map((accountId) => {
                const account = accounts.find((a) => a.id === accountId);
                const cell = row.byAccount[String(accountId)] ?? row.byAccount[accountId];
                if (!account || !cell) {
                  return (
                    <td key={accountId} className="px-2 py-1.5 text-slate-400">
                      —
                    </td>
                  );
                }
                return (
                  <td key={accountId} className="px-2 py-1.5 tabular-nums whitespace-nowrap">
                    {cellText(cell.inflow, cell.outflow, account.currencyCode)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
