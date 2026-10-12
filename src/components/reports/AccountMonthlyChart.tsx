import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AccountMonthlyDailyRow, AccountMonthlySummaryRow } from "../../types";
import { formatShortDate } from "../../utils/accounts/accountReportFormat";

type ChartMode = "total" | "account";

export default function AccountMonthlyChart({
  accounts,
  daily,
}: {
  accounts: AccountMonthlySummaryRow[];
  daily: AccountMonthlyDailyRow[];
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ChartMode>("total");
  const [selectedAccountId, setSelectedAccountId] = useState<number | "">("");

  const chartData = useMemo(() => {
    return daily.map((row) => {
      const point: Record<string, string | number> = {
        date: row.date,
        label: formatShortDate(row.date),
      };

      if (mode === "total") {
        let inflow = 0;
        let outflow = 0;
        for (const account of accounts) {
          const cell = row.byAccount[String(account.id)] ?? row.byAccount[account.id];
          if (!cell) continue;
          inflow += cell.inflow;
          outflow += cell.outflow;
        }
        point.inflow = inflow;
        point.outflow = outflow;
      } else if (selectedAccountId !== "") {
        const cell = row.byAccount[String(selectedAccountId)] ?? row.byAccount[selectedAccountId];
        point.inflow = cell?.inflow ?? 0;
        point.outflow = cell?.outflow ?? 0;
      }

      return point;
    });
  }, [accounts, daily, mode, selectedAccountId]);

  if (daily.length === 0) {
    return <p className="text-sm text-slate-500">{t("reports.noDailyData")}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as ChartMode)}
        >
          <option value="total">{t("reports.chartAllAccounts")}</option>
          <option value="account">{t("reports.chartSingleAccount")}</option>
        </select>
        {mode === "account" && (
          <select
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm min-w-[12rem]"
            value={selectedAccountId}
            onChange={(e) =>
              setSelectedAccountId(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">{t("reports.selectAccount")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currencyCode})
              </option>
            ))}
          </select>
        )}
      </div>

      {mode === "account" && selectedAccountId === "" ? (
        <p className="text-sm text-slate-500">{t("reports.selectAccountToChart")}</p>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={72} />
              <Tooltip
                formatter={(value: number) =>
                  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                }
              />
              <Legend />
              <Bar dataKey="inflow" name={t("reports.totalInflow")} fill="#10b981" radius={[2, 2, 0, 0]} />
              <Bar dataKey="outflow" name={t("reports.totalOutflow")} fill="#f43f5e" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
