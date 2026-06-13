import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetAccountsQuery,
  useCreateLedgerEntryMutation,
  useUpdateLedgerEntryMutation,
} from "../../services/api";
import type { CustomerLedgerEntry } from "../../types";
import { AccountSelect } from "../common/AccountSelect";

export interface CustomerLedgerEntryFormModalProps {
  customerId: number;
  initialType?: "credit" | "debit";
  defaultCurrencyCode?: string;
  editing?: CustomerLedgerEntry | null;
  currencies: Array<{ code: string; name: string; active: boolean | number }>;
  onClose: () => void;
  onError: (msg: string) => void;
  /** Overlay z-index class; use z-[8100] when stacking above NewOrderModal (z-[8000]). */
  overlayClassName?: string;
}

export function CustomerLedgerEntryFormModal({
  customerId,
  initialType = "credit",
  defaultCurrencyCode = "",
  editing,
  currencies,
  onClose,
  onError,
  overlayClassName = "z-50",
}: CustomerLedgerEntryFormModalProps) {
  const { t } = useTranslation();
  const [createEntry, { isLoading: isCreating }] = useCreateLedgerEntryMutation();
  const [updateEntry, { isLoading: isUpdating }] = useUpdateLedgerEntryMutation();
  const { data: accounts = [] } = useGetAccountsQuery();
  const isManualEntry = !editing || editing.source === "manual" || !editing.source;

  const [form, setForm] = useState({
    type: editing?.type ?? initialType,
    amount: editing ? String(editing.amount) : "",
    currencyCode: editing?.currencyCode ?? defaultCurrencyCode,
    accountId: editing?.accountId ? String(editing.accountId) : "",
    description: editing?.description ?? "",
    entryDate: editing?.entryDate
      ? new Date(editing.entryDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });

  const activeCurrencies = currencies.filter((c) => c.active);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    const accountId = parseInt(form.accountId, 10);
    if (!form.currencyCode) {
      onError(t("customerLedger.selectCurrency"));
      return;
    }
    if (!accountId) {
      onError(t("customerLedger.selectAccount"));
      return;
    }
    if (!amount || amount <= 0) {
      onError("Amount must be a positive number.");
      return;
    }

    try {
      if (editing) {
        if (!isManualEntry) {
          onError(t("customerLedger.saveFailed"));
          return;
        }
        await updateEntry({
          customerId,
          entryId: editing.id,
          data: {
            type: form.type,
            amount,
            currencyCode: form.currencyCode,
            accountId,
            description: form.description || undefined,
            entryDate: form.entryDate || null,
          },
        }).unwrap();
      } else {
        await createEntry({
          customerId,
          type: form.type,
          amount,
          currencyCode: form.currencyCode,
          accountId,
          description: form.description || undefined,
          entryDate: form.entryDate || null,
        }).unwrap();
      }
      onClose();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "data" in err
          ? (err as { data?: { message?: string } }).data?.message
          : undefined;
      onError(message || t("customerLedger.saveFailed"));
    }
  };

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/40 px-4 ${overlayClassName}`}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">
          {editing
            ? t("customerLedger.editEntry")
            : form.type === "credit"
              ? t("customerLedger.addCredit")
              : t("customerLedger.addDebit")}
        </h3>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="flex gap-2">
            {(["credit", "debit"] as const).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setForm((p) => ({ ...p, type: tp }))}
                className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors ${
                  form.type === tp
                    ? tp === "credit"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-rose-500 bg-rose-50 text-rose-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {tp === "credit" ? t("customerLedger.credit") : t("customerLedger.debit")}
              </button>
            ))}
          </div>

          <select
            value={form.currencyCode}
            onChange={(e) =>
              setForm((p) => ({ ...p, currencyCode: e.target.value, accountId: "" }))
            }
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            required
            disabled={!!editing}
          >
            <option value="">{t("customerLedger.selectCurrency")}</option>
            {activeCurrencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>

          <AccountSelect
            value={form.accountId}
            onChange={(accountId) => setForm((p) => ({ ...p, accountId }))}
            accounts={accounts}
            label={t("customerLedger.selectAccount")}
            placeholder={t("customerLedger.selectAccount")}
            required
            disabled={!form.currencyCode || (!isManualEntry && !!editing)}
            filterByCurrency={form.currencyCode || undefined}
            showBalance
            t={t}
          />

          <input
            type="number"
            min="0.01"
            step="any"
            placeholder={t("customerLedger.amountPlaceholder")}
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            required
          />

          <input
            type="text"
            placeholder={t("customerLedger.descriptionPlaceholder")}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              {t("customerLedger.entryDate")}
            </label>
            <input
              type="date"
              value={form.entryDate}
              onChange={(e) => setForm((p) => ({ ...p, entryDate: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={isCreating || isUpdating}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white shadow transition-colors disabled:opacity-60 ${
                form.type === "credit"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {isCreating || isUpdating ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
