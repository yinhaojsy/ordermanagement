import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import {
  useGetCustomerOptionsQuery,
  useGetCurrenciesQuery,
  useGetCustomerLedgerEntriesQuery,
  useGetCustomerLedgerSummaryQuery,
  useGetCustomerFundingBalancesQuery,
  useDeleteLedgerEntryMutation,
  useGetLedgerEntryChangesQuery,
} from "../services/api";
import type { CustomerLedgerEntry } from "../types";
import { useAppSelector } from "../app/hooks";
import {
  canCreateLedgerDepositWithdraw,
  canEditDeleteCustomerLedger,
  canViewCustomerLedger,
} from "../utils/customerPermissions";
import { CustomerAccountStatementPanel } from "../components/customers/CustomerAccountStatementPanel";
import { CustomerDepositAccountStatementPanel } from "../components/customers/CustomerDepositAccountStatementPanel";
import { CustomerFundingBalancesPanel } from "../components/customers/CustomerFundingBalancesPanel";
import { CustomerLedgerEntryFormModal } from "../components/customers/CustomerLedgerEntryFormModal";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDisplayDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

// ──────────────────────────────────────────────────────────
// Change history sub-component
// ──────────────────────────────────────────────────────────
function EntryChangeHistory({ entryId }: { entryId: number }) {
  const { t } = useTranslation();
  const { data: changes = [], isLoading } = useGetLedgerEntryChangesQuery(entryId);

  if (isLoading) return <div className="text-xs text-slate-400 p-2">{t("common.loading")}</div>;
  if (!changes.length) return <div className="text-xs text-slate-400 p-2">No history.</div>;

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
      <div className="font-semibold text-slate-600 mb-2">{t("customerLedger.history")}</div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 pr-3">{t("customerLedger.changedAt")}</th>
            <th className="py-1 pr-3">{t("customerLedger.changedBy")}</th>
            <th className="py-1 pr-3">{t("customerLedger.credit")}/{t("customerLedger.debit")}</th>
            <th className="py-1 pr-3">Amount</th>
            <th className="py-1">{t("customerLedger.description")}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((ch) => (
            <tr key={ch.id} className="border-b border-slate-100">
              <td className="py-1 pr-3 whitespace-nowrap">{formatDisplayDate(ch.changedAt)}</td>
              <td className="py-1 pr-3">{ch.changedByName || "—"}</td>
              <td className="py-1 pr-3 capitalize">{ch.type}</td>
              <td className="py-1 pr-3">{fmt(ch.amount)} {ch.currencyCode}</td>
              <td className="py-1 text-slate-500">{ch.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────
export default function CustomerLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authUser = useAppSelector((s) => s.auth.user);

  const customerId = parseInt(id ?? "0", 10);

  const canViewLedger = canViewCustomerLedger(authUser);
  const canDepositWithdraw = canCreateLedgerDepositWithdraw(authUser);
  const canEditDeleteLedger = canEditDeleteCustomerLedger(authUser);
  const showEntryActions = canEditDeleteLedger;

  useEffect(() => {
    if (!canViewLedger) {
      navigate("/customers", { replace: true });
    }
  }, [canViewLedger, navigate]);

  const { data: customersData } = useGetCustomerOptionsQuery();
  const customers = customersData?.customers ?? [];
  const { data: currencies = [] } = useGetCurrenciesQuery();
  const { data: summary = [] } = useGetCustomerLedgerSummaryQuery(customerId);
  const { data: fundingBalances, isLoading: fundingBalancesLoading } =
    useGetCustomerFundingBalancesQuery(customerId);
  const { data: entries = [], isLoading } = useGetCustomerLedgerEntriesQuery({ customerId });
  const [deleteEntry] = useDeleteLedgerEntryMutation();

  const customer = customers.find((c) => c.id === customerId);

  // UI state
  const [activeCurrency, setActiveCurrency] = useState<string | null>(null);
  const [entryModal, setEntryModal] = useState<{ open: boolean; type: "credit" | "debit"; editing: CustomerLedgerEntry | null }>({
    open: false, type: "credit", editing: null,
  });
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }>({
    isOpen: false, message: "", type: "error",
  });
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; entryId: number | null }>({
    isOpen: false, entryId: null,
  });
  const [mainTab, setMainTab] = useState<"currency" | "tradeRecord" | "accountStatement">("currency");

  // Derive active currency tabs (currencies with entries)
  const activeCurrencyTabs = summary.map((s) => s.currencyCode);
  const selectedCurrency = activeCurrency ?? activeCurrencyTabs[0] ?? null;

  // Filter entries for selected currency tab
  const visibleEntries = entries.filter((e) => !e.deletedAt && e.currencyCode === selectedCurrency);

  // Running balance computation (entries already sorted DESC by server, we reverse for running total then reverse back)
  const entriesWithBalance = (() => {
    const asc = [...visibleEntries].reverse();
    let running = 0;
    const result = asc.map((e) => {
      running += e.type === "credit" ? e.amount : -e.amount;
      return { ...e, runningBalance: running };
    });
    return result.reverse();
  })();

  const summaryForSelected = summary.find((s) => s.currencyCode === selectedCurrency);

  const handleDeleteConfirm = async () => {
    if (!confirmModal.entryId) return;
    try {
      await deleteEntry({ customerId, entryId: confirmModal.entryId }).unwrap();
    } catch {
      setAlertModal({ isOpen: true, message: t("customerLedger.deleteFailed"), type: "error" });
    }
    setConfirmModal({ isOpen: false, entryId: null });
  };

  const toggleHistory = (id: number) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Export to Excel
  const handleExport = () => {
    if (!selectedCurrency || !entriesWithBalance.length) return;

    const rows = entriesWithBalance.map((e) => ({
      Date: formatDisplayDate(e.entryDate || e.createdAt),
      Description: e.description || "",
      Credit: e.type === "credit" ? e.amount : "",
      Debit: e.type === "debit" ? -e.amount : "",
      Balance: e.runningBalance,
      Currency: e.currencyCode,
      "Created By": e.createdByName || "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${customer?.name ?? "Customer"} ${selectedCurrency}`);
    XLSX.writeFile(wb, `statement_${customer?.name ?? customerId}_${selectedCurrency}.xlsx`);
  };

  if (!canViewLedger) {
    return null;
  }

  if (!customer && customers.length > 0) {
    return (
      <div className="p-8 text-slate-500">Customer not found.</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate("/customers")}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("customerLedger.backToCustomers")}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{customer?.name ?? "..."}</h1>
          {(customer?.phone || customer?.email) && (
            <p className="text-sm text-slate-500 mt-0.5">{customer?.phone || customer?.email}</p>
          )}
        </div>
        {canDepositWithdraw ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEntryModal({ open: true, type: "credit", editing: null })}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t("customerLedger.addCredit")}
            </button>
            <button
              type="button"
              onClick={() => setEntryModal({ open: true, type: "debit", editing: null })}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-rose-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
              {t("customerLedger.addDebit")}
            </button>
          </div>
        ) : null}
      </div>

      <h2 className="text-lg font-semibold text-slate-800 mb-3">
        {t("customerLedger.balanceOverview")}
      </h2>
      <CustomerFundingBalancesPanel
        data={fundingBalances}
        isLoading={fundingBalancesLoading}
      />

      <div className="flex gap-1 border-b border-slate-200 pt-2">
        <button
          type="button"
          onClick={() => setMainTab("currency")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            mainTab === "currency"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("customerLedger.currencyStatement")}
        </button>
        <button
          type="button"
          onClick={() => setMainTab("tradeRecord")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            mainTab === "tradeRecord"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("customerLedger.tradeRecord")}
        </button>
        <button
          type="button"
          onClick={() => setMainTab("accountStatement")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            mainTab === "accountStatement"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t("customerLedger.depositAccountStatement")}
        </button>
      </div>

      {mainTab === "tradeRecord" && (
        <CustomerAccountStatementPanel
          customerId={customerId}
          customerName={customer?.name}
          canWrite={canEditDeleteLedger}
          onAlert={(message, type) => setAlertModal({ isOpen: true, message, type: type || "error" })}
        />
      )}

      {mainTab === "accountStatement" && (
        <CustomerDepositAccountStatementPanel
          customerId={customerId}
          customerName={customer?.name}
        />
      )}

      {mainTab === "currency" && activeCurrencyTabs.length > 0 && (
        <SectionCard
          title={t("customerLedger.currencyStatement")}
          actions={
            <div className="flex items-center gap-2">
              {selectedCurrency && (
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  {t("customerLedger.exportStatement")}
                </button>
              )}
            </div>
          }
        >
          {/* Currency tabs */}
          <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
            {activeCurrencyTabs.map((code) => {
              const s = summary.find((x) => x.currencyCode === code);
              return (
                <button
                  key={code}
                  onClick={() => setActiveCurrency(code)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                    selectedCurrency === code
                      ? "border-blue-500 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {code}
                  {s && (
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                        s.balance < 0
                          ? "bg-rose-100 text-rose-700"
                          : s.balance > 0
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {s.balance < 0 ? "-" : ""}{fmt(Math.abs(s.balance))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="py-8 text-center text-sm text-slate-400">{t("common.loading")}</div>
          ) : entriesWithBalance.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">{t("customerLedger.noEntries")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-4 w-32">{t("customerLedger.date")}</th>
                    <th className="py-2 pr-4">{t("customerLedger.description")}</th>
                    <th className="py-2 pr-4 text-right w-32 text-emerald-700">{t("customerLedger.credit")}</th>
                    <th className="py-2 pr-4 text-right w-32 text-rose-700">{t("customerLedger.debit")}</th>
                    <th className="py-2 pr-4 text-right w-36 font-semibold">{t("customerLedger.balance")}</th>
                    {showEntryActions && <th className="py-2 text-right w-24">{t("customers.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {entriesWithBalance.map((entry) => (
                    <>
                      <tr
                        key={entry.id}
                        className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        <td className="py-2 pr-4 text-slate-500 whitespace-nowrap">
                          {formatDisplayDate(entry.entryDate || entry.createdAt)}
                        </td>
                        <td className="py-2 pr-4 text-slate-700">
                          <div>{entry.description || <span className="text-slate-300">—</span>}</div>
                          {entry.accountName && (
                            <div className="text-xs text-slate-500">
                              {t("customerLedger.account")}: {entry.accountName}
                            </div>
                          )}
                          {entry.createdByName && (
                            <div className="text-xs text-slate-400">{entry.createdByName}</div>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right text-emerald-700 font-medium">
                          {entry.type === "credit" ? fmt(entry.amount) : ""}
                        </td>
                        <td className="py-2 pr-4 text-right text-rose-700 font-medium">
                          {entry.type === "debit" ? `-${fmt(entry.amount)}` : ""}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right font-semibold ${
                            entry.runningBalance < 0 ? "text-rose-700" : "text-slate-900"
                          }`}
                        >
                          {entry.runningBalance < 0 ? "-" : ""}{fmt(Math.abs(entry.runningBalance))}
                        </td>
                        {showEntryActions && (
                          <td className="py-2 text-right">
                            <div className="flex gap-2 justify-end text-xs font-semibold">
                              <button
                                className="text-slate-400 hover:text-slate-700"
                                title={t("customerLedger.history")}
                                onClick={() => toggleHistory(entry.id)}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </button>
                              {(entry.source === "manual" || !entry.source) && (
                                <button
                                  className="text-amber-600 hover:text-amber-700"
                                  onClick={() => setEntryModal({ open: true, type: entry.type, editing: entry })}
                                >
                                  {t("common.edit")}
                                </button>
                              )}
                              <button
                                className="text-rose-600 hover:text-rose-700"
                                onClick={() => setConfirmModal({ isOpen: true, entryId: entry.id })}
                              >
                                {t("common.delete")}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {expandedHistory.has(entry.id) && (
                        <tr key={`hist-${entry.id}`} className="bg-slate-50">
                          <td colSpan={showEntryActions ? 6 : 5} className="px-4 pb-3">
                            <EntryChangeHistory entryId={entry.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
                {/* Footer totals */}
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td colSpan={2} className="py-2 pr-4 text-sm font-semibold text-slate-700">
                      {t("customerLedger.balance")} ({selectedCurrency})
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold text-emerald-700">
                      {summaryForSelected ? fmt(summaryForSelected.totalCredit) : ""}
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold text-rose-700">
                      {summaryForSelected ? `-${fmt(summaryForSelected.totalDebit)}` : ""}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right font-bold ${
                        (summaryForSelected?.balance ?? 0) < 0 ? "text-rose-700" : "text-slate-900"
                      }`}
                    >
                      {summaryForSelected
                        ? `${summaryForSelected.balance < 0 ? "-" : ""}${fmt(Math.abs(summaryForSelected.balance))}`
                        : ""}
                    </td>
                    {showEntryActions && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {mainTab === "currency" && activeCurrencyTabs.length === 0 && (
        <SectionCard title={t("customerLedger.currencyStatement")}>
          <p className="text-sm text-slate-400">{t("customerLedger.noCurrencies")}</p>
        </SectionCard>
      )}

      {/* Entry form modal */}
      {entryModal.open &&
        (canDepositWithdraw || (entryModal.editing && canEditDeleteLedger)) && (
        <CustomerLedgerEntryFormModal
          customerId={customerId}
          initialType={entryModal.type}
          editing={entryModal.editing}
          currencies={currencies}
          onClose={() => setEntryModal({ open: false, type: "credit", editing: null })}
          onError={(msg) => setAlertModal({ isOpen: true, message: msg, type: "error" })}
        />
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        message={alertModal.message}
        type={alertModal.type || "error"}
        onClose={() => setAlertModal({ isOpen: false, message: "", type: "error" })}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen && canEditDeleteLedger}
        message={t("customerLedger.confirmDelete")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmModal({ isOpen: false, entryId: null })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />
    </div>
  );
}
