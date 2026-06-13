import { useTranslation } from "react-i18next";
import type { CustomerFundingBalanceRow } from "../../types";
import { formatAmountForInput } from "../../utils/orders/orderAmountTolerance";
import { formatLedgerAmount } from "./NewOrderModal";

const EPSILON = 0.005;

function formatFundingAmount(value: number) {
  const abs = formatLedgerAmount(Math.abs(value));
  return value < 0 ? `-${abs}` : abs;
}

interface Props {
  items: CustomerFundingBalanceRow[];
  loading?: boolean;
  fromCurrency?: string;
  toCurrency?: string;
  onFillBuy?: (amount: string) => void;
  onFillSell?: (amount: string) => void;
}

function chipFillTarget(
  currencyCode: string,
  value: number,
  fromCurrency: string,
  toCurrency: string,
): "buy" | "sell" | null {
  const pairReady = Boolean(fromCurrency && toCurrency);
  if (!pairReady) return "buy";

  if (value > 0 && currencyCode === fromCurrency) return "buy";
  if (value < 0 && currencyCode === toCurrency) return "sell";
  return null;
}

/** Compact prepaid (positive) / advance to settle (negative) per currency — no modal. */
export function CustomerFundingSummaryInline({
  items,
  loading,
  fromCurrency = "",
  toCurrency = "",
  onFillBuy,
  onFillSell,
}: Props) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="mt-1.5 text-xs text-slate-400">{t("orders.customerBalanceLoading")}</p>
    );
  }

  const chips = items
    .map((item) => {
      if (item.allocatable >= EPSILON) {
        return { currencyCode: item.currencyCode, value: item.allocatable };
      }
      if (item.allocatableAdvance >= EPSILON) {
        return { currencyCode: item.currencyCode, value: -item.allocatableAdvance };
      }
      return null;
    })
    .filter((c): c is { currencyCode: string; value: number } => c != null);

  if (chips.length === 0) return null;

  const handleChipClick = (currencyCode: string, value: number) => {
    const target = chipFillTarget(currencyCode, value, fromCurrency, toCurrency);
    const amount = formatAmountForInput(Math.abs(value));
    if (!target || !amount) return;

    if (target === "buy") {
      onFillBuy?.(amount);
    } else {
      onFillSell?.(amount);
    }
  };

  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium tabular-nums">
      {chips.map(({ currencyCode, value }) => {
        const fillTarget = chipFillTarget(currencyCode, value, fromCurrency, toCurrency);
        const clickable = Boolean(fillTarget && (onFillBuy || onFillSell));
        const tooltip =
          fillTarget === "sell"
            ? t("orders.fillBalanceSellTooltip")
            : t("orders.fillBalanceBuyTooltip");

        return (
          <span
            key={currencyCode}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => handleChipClick(currencyCode, value) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleChipClick(currencyCode, value);
                    }
                  }
                : undefined
            }
            title={clickable ? tooltip : undefined}
            className={`${value > 0 ? "text-emerald-700" : "text-amber-800"} ${
              clickable ? "cursor-pointer rounded hover:underline focus:outline-none focus:ring-1 focus:ring-blue-400" : ""
            }`}
          >
            {currencyCode}: {formatFundingAmount(value)}
          </span>
        );
      })}
    </p>
  );
}
