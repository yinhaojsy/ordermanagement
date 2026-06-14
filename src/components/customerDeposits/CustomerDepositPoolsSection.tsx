import { useTranslation } from "react-i18next";
import SectionCard from "../common/SectionCard";
import { CustomerDepositCurrencyCard } from "./CustomerDepositCurrencyCard";
import { CustomerDepositTotalCard } from "./CustomerDepositTotalCard";
import { CustomerDepositSidebarContent } from "./CustomerDepositSidebarContent";
import { RightSidebar } from "./RightSidebar";
import { useCustomerDepositUi } from "./useCustomerDepositUi";
const fmtDashboard = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface Props {
  variant: "detailed" | "compact";
}

export function CustomerDepositPoolsSection({ variant }: Props) {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    depositCurrencies,
    isSidebarOpen,
    sidebarCurrency,
    openSidebar,
    closeSidebar,
  } = useCustomerDepositUi();

  const sidebarTitle =
    sidebarCurrency != null
      ? t("customerDeposits.sidebarTitleCurrency", { currency: sidebarCurrency })
      : t("customerDeposits.sidebarTitleAll");

  const totalConverted = data?.totalConverted;
  const targetCurrency = data?.targetCurrency;

  const body =
    isLoading ? (
      <p className="text-sm text-slate-400">{t("common.loading")}</p>
    ) : depositCurrencies.length === 0 ? (
      <p className="text-sm text-slate-400">{t("customerDeposits.noCustomerDeposits")}</p>
    ) : variant === "compact" ? (
      <div className="flex flex-wrap gap-2">
        {totalConverted != null && targetCurrency ? (
          <CustomerDepositTotalCard
            variant="compact"
            totalConverted={totalConverted}
            targetCurrency={targetCurrency}
            totalPrepaidConverted={data?.totalPrepaidConverted}
            totalAdvanceConverted={data?.totalAdvanceConverted}
            hasUnknownRate={data?.hasUnknownRate}
            onClick={() => openSidebar(null)}
          />
        ) : null}
        {depositCurrencies.map((row) => (
          <CustomerDepositCurrencyCard
            key={row.currencyCode}
            row={row}
            variant="compact"
            onClick={() => openSidebar(row.currencyCode)}
          />
        ))}
      </div>
    ) : (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {totalConverted != null && targetCurrency ? (
            <CustomerDepositTotalCard
              variant="detailed"
              totalConverted={totalConverted}
              targetCurrency={targetCurrency}
              totalPrepaidConverted={data?.totalPrepaidConverted}
              totalAdvanceConverted={data?.totalAdvanceConverted}
              hasUnknownRate={data?.hasUnknownRate}
              onClick={() => openSidebar(null)}
            />
          ) : null}
          {depositCurrencies.map((row) => (
            <CustomerDepositCurrencyCard
              key={row.currencyCode}
              row={row}
              variant="detailed"
              onClick={() => openSidebar(row.currencyCode)}
            />
          ))}
        </div>
        {data?.hasUnknownRate ? (
          <p className="text-xs text-amber-700">{t("customerLedger.fundingUnknownRate")}</p>
        ) : null}
      </div>
    );

  if (variant === "compact") {
    return (
      <>
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
            {t("customerDeposits.sectionTitle")}
          </h3>
          {body}
        </div>
        <RightSidebar isOpen={isSidebarOpen} onClose={closeSidebar} title={sidebarTitle}>
          <CustomerDepositSidebarContent
            currencyCode={sidebarCurrency}
            currencies={depositCurrencies}
          />
        </RightSidebar>
      </>
    );
  }

  return (
    <>
      <SectionCard title={t("customerDeposits.sectionTitle")}>{body}</SectionCard>
      <RightSidebar isOpen={isSidebarOpen} onClose={closeSidebar} title={sidebarTitle}>
        <CustomerDepositSidebarContent
          currencyCode={sidebarCurrency}
          currencies={depositCurrencies}
        />
      </RightSidebar>
    </>
  );
}

export function CustomerDepositDashboardCard() {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    depositCurrencies,
    isSidebarOpen,
    sidebarCurrency,
    openSidebar,
    closeSidebar,
  } = useCustomerDepositUi();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-slate-600">{t("profit.totalCustomerDeposit")}</div>
        <div className="mt-1.5 text-xl font-semibold text-slate-300">—</div>
      </div>
    );
  }

  const totalConverted = data?.totalConverted;
  const targetCurrency = data?.targetCurrency;

  if (totalConverted == null || !targetCurrency) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm text-slate-600">{t("profit.totalCustomerDeposit")}</div>
        <div className="mt-1.5 text-xl font-semibold text-slate-300">—</div>
      </div>
    );
  }

  const sidebarTitle =
    sidebarCurrency != null
      ? t("customerDeposits.sidebarTitleCurrency", { currency: sidebarCurrency })
      : t("customerDeposits.sidebarTitleAll");

  return (
    <>
      <button
        type="button"
        onClick={() => openSidebar(null)}
        className="rounded-xl border-2 border-indigo-300 bg-indigo-50 px-4 py-3 text-left shadow-sm transition-colors hover:border-indigo-400 hover:bg-indigo-100/80"
      >
        <div className="text-sm text-indigo-800">{t("profit.totalCustomerDeposit")}</div>
        <div className="mt-1.5 text-xl font-semibold tabular-nums leading-tight text-indigo-950">
          {fmtDashboard(totalConverted)}
          <span className="ml-1 text-sm font-medium text-indigo-700">{targetCurrency}</span>
          {data.hasUnknownRate ? (
            <span className="ml-1 text-sm font-medium text-amber-600">*</span>
          ) : null}
        </div>
      </button>
      <RightSidebar isOpen={isSidebarOpen} onClose={closeSidebar} title={sidebarTitle}>
        <CustomerDepositSidebarContent
          currencyCode={sidebarCurrency}
          currencies={depositCurrencies}
        />
      </RightSidebar>
    </>
  );
}
