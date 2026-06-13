import { useTranslation } from "react-i18next";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  totalDeposit: number;
  totalWithdrawal: number;
  currencyCode: string;
  compact?: boolean;
}

export function CustomerDepositBreakdownLines({
  totalDeposit,
  totalWithdrawal,
  currencyCode,
  compact = false,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className={`space-y-0.5 ${compact ? "mt-1.5" : "mt-2 border-t border-indigo-100 pt-2"}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">{t("customerDeposits.totalDeposit")}</span>
        <span className="font-medium tabular-nums text-emerald-700">
          {fmt(totalDeposit)} {currencyCode}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">{t("customerDeposits.totalWithdrawal")}</span>
        <span className="font-medium tabular-nums text-amber-700">
          {fmt(totalWithdrawal)} {currencyCode}
        </span>
      </div>
    </div>
  );
}
