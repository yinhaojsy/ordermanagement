import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "../../app/hooks";
import SectionCard from "../common/SectionCard";
import AccountMonthlySummaryTable from "./AccountMonthlySummaryTable";
import AccountMonthlyDailyTable from "./AccountMonthlyDailyTable";
import AccountMonthlyChart from "./AccountMonthlyChart";
import AccountMonthlyCurrencyPoolSummary, {
  aggregateCurrencyPoolsFromAccounts,
} from "./AccountMonthlyCurrencyPoolSummary";
import AccountMonthlyPnLBreakdownSection from "./AccountMonthlyPnLBreakdownSection";
import AccountMonthlyProfitSection from "./AccountMonthlyProfitSection";
import ReportingCycleControl from "./ReportingCycleControl";
import {
  useGetAccountsQuery,
  useGetCurrenciesQuery,
  useGetAccountMonthlyStatisticsQuery,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
} from "../../services/api";
import { useMonthlyProfitComparison } from "../../hooks/useMonthlyProfitComparison";
import type { ReportingCycle } from "../../utils/accounts/periodBounds";
import {
  loadReportingCycleFromStorage,
} from "../../utils/accounts/periodBounds";
import { formatPeriodLabel } from "../../utils/accounts/accountReportFormat";

type ViewMode = "chart" | "table";

function monthOptions() {
  return Array.from({ length: 12 }, (_, i) => i + 1);
}

function yearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

export default function AccountMonthlyStatisticsPanel() {
  const { t } = useTranslation();
  const userId = useAppSelector((s) => s.auth.user?.id);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [cycle, setCycle] = useState<ReportingCycle>(() => loadReportingCycleFromStorage(userId));
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [selectedCalculationId, setSelectedCalculationId] = useState<number | null>(null);

  useEffect(() => {
    setCycle(loadReportingCycleFromStorage(userId));
  }, [userId]);

  const { data: calculations = [] } = useGetProfitCalculationsQuery();

  const defaultCalculation = useMemo(
    () => calculations.find((c) => c.isDefault === 1 || c.isDefault === true),
    [calculations],
  );

  const activeCalculationId = selectedCalculationId ?? defaultCalculation?.id ?? null;

  const { data: statistics, isLoading, isFetching } = useGetAccountMonthlyStatisticsQuery({
    year,
    month,
    periodStartDay: cycle.startDay,
    periodEndMode: cycle.endMode,
    periodEndDay: cycle.endDay,
    profitCalculationId: activeCalculationId,
  });

  const { data: accounts = [] } = useGetAccountsQuery();
  const { data: currencies = [] } = useGetCurrenciesQuery();

  const { data: calculationDetails } = useGetProfitCalculationQuery(activeCalculationId || 0, {
    skip: !activeCalculationId,
  });

  const activeCalculationName = useMemo(() => {
    if (!activeCalculationId) return undefined;
    return calculations.find((c) => c.id === activeCalculationId)?.name;
  }, [activeCalculationId, calculations]);

  const { startSummary, endSummary, monthlyProfit } = useMonthlyProfitComparison(
    calculationDetails,
    accounts,
    currencies,
    statistics,
  );

  const currencyPools = useMemo(() => {
    if (!statistics) return [];
    if (statistics.currencyPools?.length) return statistics.currencyPools;
    return aggregateCurrencyPoolsFromAccounts(statistics.accounts);
  }, [statistics]);

  const totalNetChangeConverted =
    statistics?.totalNetChangeConverted ?? statistics?.pnlBreakdown?.total ?? 0;

  const poolTargetCurrency =
    statistics?.targetCurrency ?? statistics?.pnlBreakdown?.targetCurrency ?? "USDT";

  const periodLabel = statistics
    ? formatPeriodLabel(statistics.periodStartDate, statistics.periodEndDate)
    : "";

  return (
    <div className="space-y-6">
      <SectionCard
        title={t("reports.accountMonthlyTitle")}
        description={t("reports.accountMonthlyDesc")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {monthOptions().map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="mb-4">
          <ReportingCycleControl
            year={year}
            month={month}
            cycle={cycle}
            onCycleChange={setCycle}
          />
        </div>

        {isLoading || isFetching ? (
          <p className="text-sm text-slate-500">{t("common.loading")}</p>
        ) : statistics ? (
          <p className="text-sm text-slate-600 mb-4">
            {t("reports.periodRange")}: <span className="font-medium">{periodLabel}</span>
          </p>
        ) : null}
        {statistics && <AccountMonthlySummaryTable accounts={statistics.accounts} />}
      </SectionCard>

      {statistics && (
        <SectionCard
          title={t("reports.dailyActivity")}
          actions={
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setViewMode("chart")}
                className={`px-3 py-1.5 font-medium ${
                  viewMode === "chart" ? "bg-slate-800 text-white" : "bg-white text-slate-700"
                }`}
              >
                {t("reports.chartView")}
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`px-3 py-1.5 font-medium border-l border-slate-200 ${
                  viewMode === "table" ? "bg-slate-800 text-white" : "bg-white text-slate-700"
                }`}
              >
                {t("reports.tableView")}
              </button>
            </div>
          }
        >
          {viewMode === "chart" ? (
            <AccountMonthlyChart accounts={statistics.accounts} daily={statistics.daily} />
          ) : (
            <AccountMonthlyDailyTable accounts={statistics.accounts} daily={statistics.daily} />
          )}
        </SectionCard>
      )}

      {statistics && currencyPools.length > 0 && (
        <SectionCard
          title={t("reports.currencyPoolSummaryTitle")}
          description={t("reports.currencyPoolSummaryDesc")}
        >
          <AccountMonthlyCurrencyPoolSummary
            pools={currencyPools}
            totalNetChangeConverted={totalNetChangeConverted}
            targetCurrency={poolTargetCurrency}
          />
        </SectionCard>
      )}

      {statistics?.pnlBreakdown && (
        <SectionCard
          title={t("reports.pnlBreakdownTitle")}
          description={t("reports.pnlBreakdownDesc")}
        >
          <AccountMonthlyPnLBreakdownSection breakdown={statistics.pnlBreakdown} />
        </SectionCard>
      )}

      {statistics && (
        <SectionCard
          title={t("reports.monthlyProfitTitle")}
          description={t("reports.monthlyProfitDesc")}
          actions={
            calculations.length > 0 ? (
              <select
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                value={activeCalculationId ?? ""}
                onChange={(e) =>
                  setSelectedCalculationId(e.target.value ? Number(e.target.value) : null)
                }
              >
                {calculations.map((calc) => (
                  <option key={calc.id} value={calc.id}>
                    {calc.name}
                    {calc.isDefault === 1 || calc.isDefault === true ? ` (${t("common.default")})` : ""}
                  </option>
                ))}
              </select>
            ) : null
          }
        >
          <AccountMonthlyProfitSection
            calculationName={activeCalculationName}
            startSummary={startSummary}
            endSummary={endSummary}
            monthlyProfit={monthlyProfit}
          />
        </SectionCard>
      )}
    </div>
  );
}
