import type { CustomerDepositCurrencyRow } from "../../types";
import { getCustomerDepositBreakdown } from "../../utils/customerDeposits/breakdown";
import { CustomerDepositBreakdownLines } from "./CustomerDepositBreakdownLines";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  row: CustomerDepositCurrencyRow;
  onClick: () => void;
  variant: "detailed" | "compact";
  customerCount?: number;
}

export function CustomerDepositCurrencyCard({ row, onClick, variant, customerCount }: Props) {
  const isAdvance = row.totalFundedBalance < 0;
  const count = customerCount ?? row.customers.length;
  const { totalDeposit, totalWithdrawal } = getCustomerDepositBreakdown(row);

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex shrink-0 flex-col rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          {row.currencyCode}
        </span>
        <span
          className={`mt-0.5 text-sm font-bold tabular-nums ${
            isAdvance ? "text-rose-700" : "text-indigo-900"
          }`}
        >
          {isAdvance ? "-" : ""}
          {fmt(Math.abs(row.totalFundedBalance))}
        </span>
        <CustomerDepositBreakdownLines
          compact
          totalDeposit={totalDeposit}
          totalWithdrawal={totalWithdrawal}
          currencyCode={row.currencyCode}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-indigo-900">{row.currencyCode}</span>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {count}
        </span>
      </div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          isAdvance ? "text-rose-700" : "text-indigo-950"
        }`}
      >
        {isAdvance ? "-" : ""}
        {fmt(Math.abs(row.totalFundedBalance))}
      </div>
      <CustomerDepositBreakdownLines
        totalDeposit={totalDeposit}
        totalWithdrawal={totalWithdrawal}
        currencyCode={row.currencyCode}
      />
    </button>
  );
}
