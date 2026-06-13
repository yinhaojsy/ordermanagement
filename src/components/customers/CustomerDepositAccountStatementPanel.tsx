import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import SectionCard from "../common/SectionCard";
import { useGetCustomerDepositAccountStatementQuery } from "../../services/api";
import type {
  CustomerDepositStatementRow,
  CustomerDepositStatementRowWithBalance,
  CustomerDepositStatementTradeRow,
} from "../../types";

const BALANCE_EPSILON = 0.005;

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDisplayDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const isTradeRow = (
  row: CustomerDepositStatementRow | CustomerDepositStatementRowWithBalance,
): row is CustomerDepositStatementTradeRow =>
  row.activity === "trade";

function rowKey(row: CustomerDepositStatementRow | CustomerDepositStatementRowWithBalance) {
  return isTradeRow(row)
    ? `trade-${row.orderId}-${row.ledgerBatch}-${row.source}`
    : `funding-${row.entryId}`;
}

function sortKey(row: CustomerDepositStatementRow) {
  const t = new Date(row.activityDate).getTime();
  const id = isTradeRow(row) ? row.orderId * 1000 + row.ledgerBatch : row.entryId;
  return { t, id };
}

function deltasByCurrency(
  row: CustomerDepositStatementRow | CustomerDepositStatementRowWithBalance,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const { currencyCode, delta } of row.fundingEffects) {
    map[currencyCode] = (map[currencyCode] ?? 0) + delta;
  }
  return map;
}

function formatDeltaCell(delta: number | undefined) {
  if (delta == null || Math.abs(delta) < BALANCE_EPSILON) return "—";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${fmt(delta)}`;
}

function deltaCellClass(delta: number | undefined) {
  if (delta == null || Math.abs(delta) < BALANCE_EPSILON) return "text-slate-400";
  return delta > 0 ? "text-emerald-700 font-medium" : "text-rose-700 font-medium";
}

function balanceCellClass(balance: number) {
  if (Math.abs(balance) < BALANCE_EPSILON) return "text-slate-500";
  return balance > 0 ? "text-emerald-800 font-semibold" : "text-rose-700 font-semibold";
}

function enrichRows(rows: CustomerDepositStatementRow[]) {
  const asc = [...rows].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka.t !== kb.t) return ka.t - kb.t;
    return ka.id - kb.id;
  });

  const running = new Map<string, number>();
  const enriched = new Map<string, CustomerDepositStatementRowWithBalance>();

  for (const row of asc) {
    for (const eff of row.fundingEffects) {
      running.set(eff.currencyCode, (running.get(eff.currencyCode) ?? 0) + eff.delta);
    }
    const runningBalances: Record<string, number> = {};
    for (const [ccy, bal] of running) {
      runningBalances[ccy] = bal;
    }
    enriched.set(rowKey(row), { ...row, runningBalances });
  }

  const currencySet = new Set<string>();
  for (const row of rows) {
    for (const eff of row.fundingEffects) {
      currencySet.add(eff.currencyCode);
    }
  }
  for (const ccy of running.keys()) {
    currencySet.add(ccy);
  }

  const finalBalances: Record<string, number> = {};
  for (const [ccy, bal] of running) {
    finalBalances[ccy] = bal;
  }

  return {
    rowsWithBalance: asc.map((row) => enriched.get(rowKey(row))!),
    currencyColumns: [...currencySet].sort(),
    finalBalances,
  };
}

interface Props {
  customerId: number;
  customerName?: string;
}

export function CustomerDepositAccountStatementPanel({ customerId, customerName }: Props) {
  const { t } = useTranslation();
  const [includeReversals, setIncludeReversals] = useState(false);
  const { data: rows = [], isLoading } = useGetCustomerDepositAccountStatementQuery({
    customerId,
    includeReversals,
  });

  const { rowsWithBalance, currencyColumns, finalBalances } = useMemo(
    () => enrichRows(rows),
    [rows],
  );

  const typeLabel = (row: CustomerDepositStatementRowWithBalance) => {
    if (isTradeRow(row)) {
      if (row.isReversal) return t("customerLedger.typeReversal");
      if (row.orderMode === "ledger_swap") return t("customerLedger.typeSwap");
      if (row.usesDeposit) return t("customerLedger.typeExchangeBal");
      return t("customerLedger.typeExchangeCash");
    }
    return row.fundingType === "deposit"
      ? t("customerLedger.typeDeposit")
      : t("customerLedger.typeWithdrawal");
  };

  const typeBadgeClass = (row: CustomerDepositStatementRowWithBalance) => {
    if (isTradeRow(row)) {
      if (row.isReversal) return "bg-slate-200 text-slate-700";
      if (row.orderMode === "ledger_swap") return "bg-violet-50 text-violet-800";
      if (row.usesDeposit) return "bg-blue-50 text-blue-800";
      return "bg-slate-100 text-slate-600";
    }
    return row.fundingType === "deposit"
      ? "bg-emerald-50 text-emerald-800"
      : "bg-amber-50 text-amber-900";
  };

  const formatTradeCredit = (row: CustomerDepositStatementTradeRow) => {
    if (row.creditAmount == null || !row.creditCurrency) return "";
    const sign = row.creditAmount < 0 ? "-" : "";
    return `${sign}${fmt(Math.abs(row.creditAmount))} ${row.creditCurrency}`;
  };

  const formatTradeDebit = (row: CustomerDepositStatementTradeRow) => {
    if (row.debitAmount == null || !row.debitCurrency) return "";
    if (row.debitAmount < 0) {
      return `${fmt(Math.abs(row.debitAmount))} ${row.debitCurrency}`;
    }
    return `-${fmt(row.debitAmount)} ${row.debitCurrency}`;
  };

  const formatCredit = (row: CustomerDepositStatementRowWithBalance) => {
    if (isTradeRow(row)) return formatTradeCredit(row);
    if (row.fundingType === "deposit") return `${fmt(row.amount)} ${row.currencyCode}`;
    return "";
  };

  const formatDebit = (row: CustomerDepositStatementRowWithBalance) => {
    if (isTradeRow(row)) return formatTradeDebit(row);
    if (row.fundingType === "withdrawal") return `-${fmt(row.amount)} ${row.currencyCode}`;
    return "";
  };

  const handleExport = () => {
    const sheetRows = rowsWithBalance.map((row) => {
      const deltas = deltasByCurrency(row);
      const out: Record<string, string> = {
        [t("customerLedger.date")]: formatDisplayDate(row.activityDate),
        [t("customerLedger.activityType")]: typeLabel(row),
        [t("customerLedger.description")]: row.description,
        [t("customerLedger.credit")]: formatCredit(row),
        [t("customerLedger.debit")]: formatDebit(row),
      };
      for (const ccy of currencyColumns) {
        out[ccy] = formatDeltaCell(deltas[ccy]);
      }
      out[t("customerLedger.createdBy")] = row.createdByName || "";
      return out;
    });

    const footer: Record<string, string> = {
      [t("customerLedger.date")]: "",
      [t("customerLedger.activityType")]: "",
      [t("customerLedger.description")]: t("customerLedger.stmtCurrentBalance"),
      [t("customerLedger.credit")]: "",
      [t("customerLedger.debit")]: "",
    };
    for (const ccy of currencyColumns) {
      footer[ccy] = fmt(finalBalances[ccy] ?? 0);
    }
    footer[t("customerLedger.createdBy")] = "";
    sheetRows.push(footer);

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("customerLedger.depositAccountStatement"));
    const fileName = `deposit_statement_${customerName ?? customerId}_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <SectionCard
      title={t("customerLedger.depositAccountStatement")}
      actions={
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {t("customerLedger.exportDepositStatement")}
        </button>
      }
    >
      <p className="text-xs text-slate-500 mb-4">{t("customerLedger.depositAccountStatementHint")}</p>
      <label className="flex items-center gap-1.5 mb-4 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={includeReversals}
          onChange={(e) => setIncludeReversals(e.target.checked)}
          className="rounded border-slate-300"
        />
        {t("customerLedger.includeReversals")}
      </label>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">{t("common.loading")}</div>
      ) : rowsWithBalance.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          {t("customerLedger.noDepositStatement")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3 whitespace-nowrap">{t("customerLedger.date")}</th>
                <th className="py-2 pr-3">{t("customerLedger.activityType")}</th>
                <th className="py-2 pr-3">{t("customerLedger.description")}</th>
                <th className="py-2 pr-3 text-right text-emerald-700">{t("customerLedger.credit")}</th>
                <th className="py-2 pr-3 text-right text-rose-700">{t("customerLedger.debit")}</th>
                {currencyColumns.map((ccy) => (
                  <th key={ccy} className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                    {ccy}
                  </th>
                ))}
                <th className="py-2 pr-3">{t("customerLedger.createdBy")}</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithBalance.map((row) => {
                const deltas = deltasByCurrency(row);
                return (
                  <tr
                    key={rowKey(row)}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      row.isReversal ? "bg-slate-50/80 text-slate-600" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                      {formatDisplayDate(row.activityDate)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${typeBadgeClass(row)}`}
                      >
                        {typeLabel(row)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-800">{row.description}</td>
                    <td className="py-2 pr-3 text-right text-emerald-700 font-medium tabular-nums whitespace-nowrap">
                      {formatCredit(row) || "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-rose-700 font-medium tabular-nums whitespace-nowrap">
                      {formatDebit(row) || "—"}
                    </td>
                    {currencyColumns.map((ccy) => (
                      <td
                        key={ccy}
                        className={`py-2 pr-3 text-right tabular-nums whitespace-nowrap ${deltaCellClass(deltas[ccy])}`}
                      >
                        {formatDeltaCell(deltas[ccy])}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-slate-500">{row.createdByName || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {currencyColumns.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/80">
                <td className="py-2.5 pr-3" colSpan={5}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t("customerLedger.stmtCurrentBalance")}
                  </span>
                </td>
                {currencyColumns.map((ccy) => (
                  <td
                    key={ccy}
                    className={`py-2.5 pr-3 text-right tabular-nums whitespace-nowrap ${balanceCellClass(finalBalances[ccy] ?? 0)}`}
                  >
                    {fmt(finalBalances[ccy] ?? 0)}
                  </td>
                ))}
                <td className="py-2.5 pr-3" />
              </tr>
            </tfoot>
            )}
          </table>
        </div>
      )}
    </SectionCard>
  );
}
