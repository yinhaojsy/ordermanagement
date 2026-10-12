import { useTranslation } from "react-i18next";
import type { AccountMonthlyCurrencyPoolRow, AccountMonthlySummaryRow } from "../../types";
import { formatAccountAmount } from "../../utils/accounts/accountReportFormat";

export function aggregateCurrencyPoolsFromAccounts(
  accounts: AccountMonthlySummaryRow[],
): AccountMonthlyCurrencyPoolRow[] {
  const byCurrency = new Map<string, AccountMonthlyCurrencyPoolRow>();

  for (const account of accounts) {
    const existing = byCurrency.get(account.currencyCode);
    if (existing) {
      existing.accountCount += 1;
      existing.totalInflow += account.totalInflow;
      existing.totalOutflow += account.totalOutflow;
      existing.netChange += account.netChange;
      if (!existing.currencyName && account.currencyName) {
        existing.currencyName = account.currencyName;
      }
    } else {
      byCurrency.set(account.currencyCode, {
        currencyCode: account.currencyCode,
        currencyName: account.currencyName,
        accountCount: 1,
        totalInflow: account.totalInflow,
        totalOutflow: account.totalOutflow,
        netChange: account.netChange,
        netChangeConverted: 0,
      });
    }
  }

  return Array.from(byCurrency.values()).sort((a, b) =>
    a.currencyCode.localeCompare(b.currencyCode),
  );
}

function amountClass(value: number) {
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-slate-600";
}

export default function AccountMonthlyCurrencyPoolSummary({
  pools,
  totalNetChangeConverted,
  targetCurrency,
}: {
  pools: AccountMonthlyCurrencyPoolRow[];
  totalNetChangeConverted: number;
  targetCurrency: string;
}) {
  const { t } = useTranslation();

  if (pools.length === 0) {
    return <p className="text-sm text-slate-500">{t("reports.noAccounts")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 font-semibold text-slate-700">{t("reports.currencyPool")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.poolAccounts")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.totalInflow")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.totalOutflow")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">{t("reports.netChange")}</th>
            <th className="px-3 py-2 font-semibold text-slate-700 text-right">
              {t("reports.netChangeConverted", { currency: targetCurrency })}
            </th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr key={pool.currencyCode} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{pool.currencyCode}</div>
                {pool.currencyName && pool.currencyName !== pool.currencyCode && (
                  <div className="text-xs text-slate-500">{pool.currencyName}</div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                {pool.accountCount}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${amountClass(pool.totalInflow)}`}>
                +{formatAccountAmount(pool.totalInflow, pool.currencyCode)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${amountClass(-pool.totalOutflow)}`}>
                -{formatAccountAmount(pool.totalOutflow, pool.currencyCode)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${amountClass(pool.netChange)}`}>
                {pool.netChange > 0 ? "+" : ""}
                {formatAccountAmount(pool.netChange, pool.currencyCode)}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums font-semibold ${amountClass(pool.netChangeConverted)}`}
              >
                {pool.netChangeConverted > 0 ? "+" : ""}
                {formatAccountAmount(pool.netChangeConverted, targetCurrency)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-3 py-2 text-slate-900" colSpan={5}>
              {t("reports.totalNetChangeConverted")}
            </td>
            <td
              className={`px-3 py-2 text-right tabular-nums ${amountClass(totalNetChangeConverted)}`}
            >
              {totalNetChangeConverted > 0 ? "+" : ""}
              {formatAccountAmount(totalNetChangeConverted, targetCurrency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
