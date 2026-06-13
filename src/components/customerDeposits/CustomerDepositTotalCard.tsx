import { useTranslation } from "react-i18next";
import { CustomerDepositBreakdownLines } from "./CustomerDepositBreakdownLines";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  totalConverted: number;
  targetCurrency: string;
  totalPrepaidConverted?: number | null;
  totalAdvanceConverted?: number | null;
  hasUnknownRate?: boolean;
  onClick: () => void;
  variant: "detailed" | "compact";
}

export function CustomerDepositTotalCard({
  totalConverted,
  targetCurrency,
  totalPrepaidConverted,
  totalAdvanceConverted,
  hasUnknownRate,
  onClick,
  variant,
}: Props) {
  const { t } = useTranslation();
  const totalDeposit = totalPrepaidConverted ?? 0;
  const totalWithdrawal = totalAdvanceConverted ?? 0;

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-[9rem] shrink-0 flex-col rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-100/80"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          {t("profit.totalCustomerDeposit")}
          {hasUnknownRate ? <span className="ml-1 text-amber-600">*</span> : null}
        </span>
        <span className="mt-0.5 text-sm font-bold tabular-nums text-indigo-950">
          {fmt(totalConverted)} {targetCurrency}
        </span>
        <CustomerDepositBreakdownLines
          compact
          totalDeposit={totalDeposit}
          totalWithdrawal={totalWithdrawal}
          currencyCode={targetCurrency}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-indigo-300 bg-indigo-50 p-4 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-100/80"
    >
      <div className="mb-2 font-semibold text-indigo-900">
        {t("profit.totalCustomerDeposit")}
        {hasUnknownRate ? <span className="ml-1 text-sm text-amber-600">*</span> : null}
      </div>
      <div className="text-2xl font-bold tabular-nums text-indigo-950">
        {fmt(totalConverted)} {targetCurrency}
      </div>
      <CustomerDepositBreakdownLines
        totalDeposit={totalDeposit}
        totalWithdrawal={totalWithdrawal}
        currencyCode={targetCurrency}
      />
    </button>
  );
}
