import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGetCustomerDepositTraceQuery } from "../../services/api";
import type { CustomerDepositCurrencyRow, CustomerDepositCustomerRow } from "../../types";
import { formatDepositAmount } from "./format";
import { getCustomerDepositBreakdown } from "../../utils/customerDeposits/breakdown";
import { CustomerDepositBreakdownLines } from "./CustomerDepositBreakdownLines";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CustomerDepositTraceList({
  customerId,
  currencyCode,
}: {
  customerId: number;
  currencyCode: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useGetCustomerDepositTraceQuery(
    { customerId, currencyCode },
    { skip: !customerId || !currencyCode },
  );

  if (isLoading) {
    return <p className="px-3 py-2 text-xs text-slate-400">{t("common.loading")}</p>;
  }

  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-slate-500">{t("customerDeposits.noManualEntries")}</p>
    );
  }

  return (
    <ul className="space-y-2 border-t border-slate-100 bg-slate-50/80 px-3 py-2">
      {entries.map((entry) => (
        <li key={entry.id} className="text-xs text-slate-600">
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-slate-800">
              {entry.type === "credit"
                ? t("customerLedger.typeDeposit")
                : t("customerLedger.typeWithdrawal")}
            </span>
            <span className={`tabular-nums ${entry.type === "credit" ? "text-emerald-700" : "text-rose-700"}`}>
              {entry.type === "credit" ? "+" : "-"}
              {fmt(entry.amount)} {currencyCode}
            </span>
          </div>
          {entry.accountName ? (
            <div className="mt-0.5 text-slate-500">
              {t("customerDeposits.viaAccount")}: {entry.accountName}
            </div>
          ) : null}
          {entry.description ? (
            <div className="mt-0.5 text-slate-500">{entry.description}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CustomerRow({
  customer,
  currencyCode,
}: {
  customer: CustomerDepositCustomerRow;
  currencyCode: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isAdvance = customer.fundedBalance < 0;

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{customer.customerName}</div>
            {isAdvance ? (
              <div className="text-xs text-amber-700">{t("customerDeposits.customerAdvance")}</div>
            ) : (
              <div className="text-xs text-slate-500">{t("customerDeposits.customerPrepaid")}</div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`font-semibold tabular-nums ${
                isAdvance ? "text-amber-800" : "text-indigo-900"
              }`}
            >
              {isAdvance ? "-" : ""}
              {fmt(Math.abs(customer.fundedBalance))} {currencyCode}
            </div>
            <div className="text-xs text-slate-400">
              {expanded ? t("customerDeposits.hideTrace") : t("customerDeposits.showTrace")}
            </div>
          </div>
        </button>
        <Link
          to={`/customers/${customer.customerId}/ledger`}
          className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("customerDeposits.viewLedger")}
        </Link>
      </div>
      {expanded ? (
        <CustomerDepositTraceList customerId={customer.customerId} currencyCode={currencyCode} />
      ) : null}
    </li>
  );
}

function CurrencyBlock({ row }: { row: CustomerDepositCurrencyRow }) {
  const { t } = useTranslation();
  const isAdvance = row.totalFundedBalance < 0;
  const { totalDeposit, totalWithdrawal } = getCustomerDepositBreakdown(row);

  return (
    <section className="space-y-3">
      <div className="rounded-lg bg-indigo-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-indigo-900">
            {t("customerDeposits.depositCurrency", { currency: row.currencyCode })}
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${
              isAdvance ? "text-rose-700" : "text-indigo-900"
            }`}
          >
            {isAdvance ? "-" : ""}
            {fmt(Math.abs(row.totalFundedBalance))} {row.currencyCode}
          </span>
        </div>
        <CustomerDepositBreakdownLines
          compact
          totalDeposit={totalDeposit}
          totalWithdrawal={totalWithdrawal}
          currencyCode={row.currencyCode}
        />
      </div>
      <ul className="space-y-2">
        {row.customers.map((customer) => (
          <CustomerRow key={customer.customerId} customer={customer} currencyCode={row.currencyCode} />
        ))}
      </ul>
    </section>
  );
}

interface Props {
  currencyCode: string | null;
  currencies: CustomerDepositCurrencyRow[];
}

export function CustomerDepositSidebarContent({ currencyCode, currencies }: Props) {
  const { t } = useTranslation();

  const visibleRows = currencyCode
    ? currencies.filter((c) => c.currencyCode === currencyCode)
    : currencies;
  const footerRow = currencyCode ? visibleRows[0] : null;
  const footerBreakdown = footerRow ? getCustomerDepositBreakdown(footerRow) : null;

  if (visibleRows.length === 0) {
    return (
      <p className="p-4 text-sm text-slate-500">{t("customerDeposits.noCustomerDeposits")}</p>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {visibleRows.map((row) => (
        <CurrencyBlock key={row.currencyCode} row={row} />
      ))}
      {footerRow ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <div className="flex items-center justify-between gap-3">
            <span>{t("customerDeposits.sidebarTotal")}</span>
            <span className="font-semibold text-slate-800">
              {formatDepositAmount(footerRow.totalFundedBalance, footerRow.currencyCode)}
            </span>
          </div>
          <CustomerDepositBreakdownLines
            compact
            totalDeposit={footerBreakdown!.totalDeposit}
            totalWithdrawal={footerBreakdown!.totalWithdrawal}
            currencyCode={footerRow.currencyCode}
          />
        </div>
      ) : null}
    </div>
  );
}
