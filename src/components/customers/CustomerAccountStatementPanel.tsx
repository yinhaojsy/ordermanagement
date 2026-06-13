import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import SectionCard from "../common/SectionCard";
import ConfirmModal from "../common/ConfirmModal";
import {
  useGetCustomerAccountStatementQuery,
  useGetCustomerLedgerSummaryQuery,
  useRebuildCustomerLedgerFromOrdersMutation,
} from "../../services/api";
import type {
  AccountStatementActivityFilter,
  CustomerAccountStatementRow,
  CustomerAccountStatementTradeRow,
  CustomerLedgerSummary,
} from "../../types";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtRate = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const formatDisplayDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const isTradeRow = (row: CustomerAccountStatementRow): row is CustomerAccountStatementTradeRow =>
  row.activity === "trade";

type ColumnKey =
  | "activityType"
  | "orderDate"
  | "description"
  | "currencyPair"
  | "exchangeRate"
  | "credit"
  | "debit"
  | "accountName"
  | "serviceCharges"
  | "remarks"
  | "createdBy";

const ALL_COLUMNS: ColumnKey[] = [
  "activityType",
  "orderDate",
  "description",
  "currencyPair",
  "exchangeRate",
  "credit",
  "debit",
  "accountName",
  "serviceCharges",
  "remarks",
  "createdBy",
];

interface Props {
  customerId: number;
  customerName?: string;
  canWrite: boolean;
  onAlert: (msg: string, type?: "error" | "success") => void;
}

export function CustomerAccountStatementPanel({
  customerId,
  customerName,
  canWrite,
  onAlert,
}: Props) {
  const { t } = useTranslation();
  const [activityFilter, setActivityFilter] = useState<AccountStatementActivityFilter>("all");
  const [includeReversals, setIncludeReversals] = useState(false);
  const { data: rows = [], isLoading, refetch } = useGetCustomerAccountStatementQuery({
    customerId,
    activity: activityFilter,
    includeReversals,
  });
  const { data: summary = [] } = useGetCustomerLedgerSummaryQuery(customerId);
  const [rebuild, { isLoading: rebuilding }] = useRebuildCustomerLedgerFromOrdersMutation();

  const [exportOpen, setExportOpen] = useState(false);
  const [exportActivity, setExportActivity] = useState<AccountStatementActivityFilter>("all");
  const [exportIncludeReversals, setExportIncludeReversals] = useState(false);
  const [exportColumns, setExportColumns] = useState<Set<ColumnKey>>(() => new Set(ALL_COLUMNS));
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);

  const columnLabels: Record<ColumnKey, string> = useMemo(
    () => ({
      activityType: t("customerLedger.activityType"),
      orderDate: t("customerLedger.date"),
      description: t("customerLedger.description"),
      currencyPair: t("customerLedger.currencyPair"),
      exchangeRate: t("customerLedger.exchangeRate"),
      credit: t("customerLedger.credit"),
      debit: t("customerLedger.debit"),
      accountName: t("customerLedger.accountName"),
      serviceCharges: t("customerLedger.serviceCharges"),
      remarks: t("customerLedger.remarks"),
      createdBy: t("customerLedger.createdBy"),
    }),
    [t],
  );

  const typeLabel = (row: CustomerAccountStatementRow) => {
    if (isTradeRow(row)) {
      return row.isReversal ? t("customerLedger.typeReversal") : t("customerLedger.typeExchange");
    }
    return row.fundingType === "deposit"
      ? t("customerLedger.typeDeposit")
      : t("customerLedger.typeWithdrawal");
  };

  const formatTradeCredit = (row: CustomerAccountStatementTradeRow) => {
    if (row.creditAmount == null || !row.creditCurrency) return "";
    const sign = row.creditAmount < 0 ? "-" : "";
    return `${sign}${fmt(Math.abs(row.creditAmount))} ${row.creditCurrency}`;
  };

  const formatTradeDebit = (row: CustomerAccountStatementTradeRow) => {
    if (row.debitAmount == null || !row.debitCurrency) return "";
    if (row.debitAmount < 0) {
      return `${fmt(Math.abs(row.debitAmount))} ${row.debitCurrency}`;
    }
    return `-${fmt(row.debitAmount)} ${row.debitCurrency}`;
  };

  const formatCredit = (row: CustomerAccountStatementRow) => {
    if (isTradeRow(row)) return formatTradeCredit(row);
    if (row.fundingType === "deposit") return `${fmt(row.amount)} ${row.currencyCode}`;
    return "";
  };

  const formatDebit = (row: CustomerAccountStatementRow) => {
    if (isTradeRow(row)) return formatTradeDebit(row);
    if (row.fundingType === "withdrawal") return `-${fmt(row.amount)} ${row.currencyCode}`;
    return "";
  };

  const currencyPairCell = (row: CustomerAccountStatementRow) =>
    isTradeRow(row) ? row.currencyPair : row.currencyCode;

  const rowKey = (row: CustomerAccountStatementRow) =>
    isTradeRow(row)
      ? `trade-${row.orderId}-${row.ledgerBatch}-${row.source}`
      : `funding-${row.entryId}`;

  const handleRebuild = async () => {
    try {
      const result = await rebuild(customerId).unwrap();
      await refetch();
      onAlert(
        t("customerLedger.rebuildSuccess", { count: result.ordersProcessed }) as string,
        "success",
      );
    } catch {
      onAlert(t("customerLedger.rebuildFailed"), "error");
    }
    setRebuildConfirmOpen(false);
  };

  const runExport = async () => {
    const params = new URLSearchParams();
    if (exportActivity !== "all") params.set("activity", exportActivity);
    if (exportIncludeReversals) params.set("includeReversals", "true");
    const qs = params.toString();
    const res = await fetch(
      `/api/customers/${customerId}/ledger/account-statement${qs ? `?${qs}` : ""}`,
      { credentials: "include" },
    );
    if (!res.ok) {
      onAlert(`${t("customerLedger.exportStatement")} failed`, "error");
      return;
    }
    const exportRows: CustomerAccountStatementRow[] = await res.json();

    const sheetRows = exportRows.map((row) => {
      const out: Record<string, string | number> = {};
      if (exportColumns.has("activityType")) out[columnLabels.activityType] = typeLabel(row);
      if (exportColumns.has("orderDate")) out[columnLabels.orderDate] = formatDisplayDate(row.activityDate);
      if (exportColumns.has("description")) out[columnLabels.description] = row.description;
      if (exportColumns.has("currencyPair")) out[columnLabels.currencyPair] = currencyPairCell(row);
      if (exportColumns.has("exchangeRate")) {
        out[columnLabels.exchangeRate] =
          isTradeRow(row) && row.exchangeRate != null ? Number(row.exchangeRate) : "";
      }
      if (exportColumns.has("credit")) out[columnLabels.credit] = formatCredit(row);
      if (exportColumns.has("debit")) out[columnLabels.debit] = formatDebit(row);
      if (exportColumns.has("accountName")) {
        out[columnLabels.accountName] = isTradeRow(row) ? "" : row.accountName || "";
      }
      if (exportColumns.has("serviceCharges")) {
        out[columnLabels.serviceCharges] = isTradeRow(row) ? row.serviceCharges || "" : "";
      }
      if (exportColumns.has("remarks")) {
        out[columnLabels.remarks] = isTradeRow(row) ? row.remarks || "" : "";
      }
      if (exportColumns.has("createdBy")) out[columnLabels.createdBy] = row.createdByName || "";
      return out;
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("customerLedger.tradeRecord"));
    const balanceRows = (summary as CustomerLedgerSummary[]).map((s) => ({
      Currency: s.currencyCode,
      Balance: s.balance,
    }));
    if (balanceRows.length > 0) {
      const wsBal = XLSX.utils.json_to_sheet(balanceRows);
      XLSX.utils.book_append_sheet(wb, wsBal, t("customerLedger.balancesSummary"));
    }
    const fileName = `account_statement_${customerName ?? customerId}_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    setExportOpen(false);
  };

  const toggleColumn = (key: ColumnKey) => {
    setExportColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const openExport = () => {
    setExportActivity(activityFilter);
    setExportIncludeReversals(includeReversals);
    setExportColumns(new Set(ALL_COLUMNS));
    setExportOpen(true);
  };

  const filterControls = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span className="font-medium text-slate-500">{t("customerLedger.activityFilter")}:</span>
      <label className="flex items-center gap-1">
        <input
          type="radio"
          name="activityFilter"
          checked={activityFilter === "all"}
          onChange={() => setActivityFilter("all")}
          className="border-slate-300"
        />
        {t("customerLedger.activityAll")}
      </label>
      <label className="flex items-center gap-1">
        <input
          type="radio"
          name="activityFilter"
          checked={activityFilter === "funding"}
          onChange={() => setActivityFilter("funding")}
          className="border-slate-300"
        />
        {t("customerLedger.activityFunding")}
      </label>
      <label className="flex items-center gap-1">
        <input
          type="radio"
          name="activityFilter"
          checked={activityFilter === "trade"}
          onChange={() => setActivityFilter("trade")}
          className="border-slate-300"
        />
        {t("customerLedger.activityTrade")}
      </label>
      <label className="flex items-center gap-1.5 ml-1 border-l border-slate-200 pl-3">
        <input
          type="checkbox"
          checked={includeReversals}
          onChange={(e) => setIncludeReversals(e.target.checked)}
          className="rounded border-slate-300"
        />
        {t("customerLedger.includeReversals")}
      </label>
    </div>
  );

  return (
    <>
      <SectionCard
        title={t("customerLedger.tradeRecord")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openExport}
              className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("customerLedger.exportAccountStatement")}
            </button>
            {canWrite && (
              <button
                type="button"
                disabled={rebuilding}
                onClick={() => setRebuildConfirmOpen(true)}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                {rebuilding ? t("common.loading") : t("customerLedger.rebuildFromOrders")}
              </button>
            )}
          </div>
        }
      >
        <div className="mb-4">{filterControls}</div>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-slate-400">{t("common.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            {t("customerLedger.noAccountStatement")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3 whitespace-nowrap">{t("customerLedger.date")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.activityType")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.description")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.currencyPair")}</th>
                  <th className="py-2 pr-3 text-right">{t("customerLedger.exchangeRate")}</th>
                  <th className="py-2 pr-3 text-right text-emerald-700">{t("customerLedger.credit")}</th>
                  <th className="py-2 pr-3 text-right text-rose-700">{t("customerLedger.debit")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.accountName")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.serviceCharges")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.remarks")}</th>
                  <th className="py-2 pr-3">{t("customerLedger.createdBy")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
                          isTradeRow(row)
                            ? row.isReversal
                              ? "bg-slate-200 text-slate-700"
                              : "bg-blue-50 text-blue-800"
                            : row.fundingType === "deposit"
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-amber-50 text-amber-900"
                        }`}
                      >
                        {typeLabel(row)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-800">{row.description}</td>
                    <td className="py-2 pr-3 font-medium">{currencyPairCell(row)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {isTradeRow(row) && row.exchangeRate != null
                        ? fmtRate(Number(row.exchangeRate))
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-emerald-700 font-medium tabular-nums">
                      {formatCredit(row) || "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-rose-700 font-medium tabular-nums">
                      {formatDebit(row) || "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {!isTradeRow(row) ? row.accountName || "—" : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {isTradeRow(row) ? row.serviceCharges || "—" : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600 max-w-[200px] truncate" title={isTradeRow(row) ? row.remarks || "" : ""}>
                      {isTradeRow(row) ? row.remarks || "—" : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{row.createdByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {t("customerLedger.exportAccountStatement")}
            </h3>
            <p className="text-xs font-medium text-slate-500 mb-2">{t("customerLedger.exportActivity")}</p>
            <div className="flex flex-col gap-2 mb-4 text-sm text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportActivity"
                  checked={exportActivity === "all"}
                  onChange={() => setExportActivity("all")}
                />
                {t("customerLedger.activityAll")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportActivity"
                  checked={exportActivity === "funding"}
                  onChange={() => setExportActivity("funding")}
                />
                {t("customerLedger.activityFunding")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportActivity"
                  checked={exportActivity === "trade"}
                  onChange={() => setExportActivity("trade")}
                />
                {t("customerLedger.activityTrade")}
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 mb-4">
              <input
                type="checkbox"
                checked={exportIncludeReversals}
                onChange={(e) => setExportIncludeReversals(e.target.checked)}
                className="rounded border-slate-300"
              />
              {t("customerLedger.includeReversals")}
            </label>
            <p className="text-xs font-medium text-slate-500 mb-2">{t("customerLedger.selectColumns")}</p>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {ALL_COLUMNS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={exportColumns.has(key)}
                    onChange={() => toggleColumn(key)}
                    className="rounded border-slate-300"
                  />
                  {columnLabels[key]}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={runExport}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {t("customerLedger.exportStatement")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={rebuildConfirmOpen}
        message={t("customerLedger.rebuildConfirm")}
        onConfirm={handleRebuild}
        onCancel={() => setRebuildConfirmOpen(false)}
        confirmText={t("customerLedger.rebuildFromOrders")}
        cancelText={t("common.cancel")}
        type="warning"
      />
    </>
  );
}
