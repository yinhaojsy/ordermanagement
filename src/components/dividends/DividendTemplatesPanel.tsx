import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import SectionCard from "../common/SectionCard";
import AlertModal from "../common/AlertModal";
import ConfirmModal from "../common/ConfirmModal";
import {
  useGetDividendTemplatesQuery,
  useGetDividendTemplateQuery,
  useCreateDividendTemplateMutation,
  useUpdateDividendTemplateMutation,
  useDeleteDividendTemplateMutation,
} from "../../services/api";
import type {
  DividendTemplateDetail,
  DividendTemplateInput,
  DividendTemplateBusinessInput,
  DividendTemplatePersonInput,
} from "../../types";

type FormBusiness = {
  tempKey: string;
  name: string;
  keepPercent: string;
  remainderBusinessTempKey: string;
  shares: { personTempKey: string; sharePercent: string }[];
};

type FormPerson = {
  tempKey: string;
  name: string;
};

type FormState = {
  name: string;
  notes: string;
  businesses: FormBusiness[];
  persons: FormPerson[];
};

function newTempKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyBusiness(): FormBusiness {
  return {
    tempKey: newTempKey("biz"),
    name: "",
    keepPercent: "100",
    remainderBusinessTempKey: "",
    shares: [],
  };
}

function emptyForm(): FormState {
  return {
    name: "",
    notes: "",
    businesses: [emptyBusiness()],
    persons: [],
  };
}

function detailToForm(detail: DividendTemplateDetail): FormState {
  const businessTempById = new Map<number, string>();
  detail.businesses.forEach((b, i) => {
    businessTempById.set(b.id, `biz_${b.id}_${i}`);
  });
  const personTempById = new Map<number, string>();
  detail.persons.forEach((p, i) => {
    personTempById.set(p.id, `person_${p.id}_${i}`);
  });

  return {
    name: detail.name,
    notes: detail.notes || "",
    businesses: detail.businesses.map((b) => ({
      tempKey: businessTempById.get(b.id)!,
      name: b.name,
      keepPercent: String(b.keepPercent),
      remainderBusinessTempKey: b.remainderBusinessId
        ? businessTempById.get(b.remainderBusinessId) || ""
        : "",
      shares: b.shares.map((s) => ({
        personTempKey: personTempById.get(s.templatePersonId) || "",
        sharePercent: String(s.sharePercent),
      })),
    })),
    persons: detail.persons.map((p) => ({
      tempKey: personTempById.get(p.id)!,
      name: p.name,
    })),
  };
}

function formToInput(form: FormState): DividendTemplateInput {
  const persons: DividendTemplatePersonInput[] = form.persons
    .filter((p) => p.name.trim())
    .map((p, index) => ({ tempKey: p.tempKey, name: p.name.trim(), sortOrder: index }));

  const businesses: DividendTemplateBusinessInput[] = form.businesses.map((b, index) => ({
    tempKey: b.tempKey,
    name: b.name.trim(),
    sortOrder: index,
    keepPercent: Number(b.keepPercent) || 0,
    remainderBusinessTempKey: b.remainderBusinessTempKey || null,
    shares: b.shares
      .filter((s) => s.personTempKey)
      .map((s) => ({
        personTempKey: s.personTempKey,
        sharePercent: Number(s.sharePercent) || 0,
      })),
  }));

  return {
    name: form.name.trim(),
    notes: form.notes.trim() || null,
    businesses,
    persons,
  };
}

export default function DividendTemplatesPanel() {
  const { t } = useTranslation();
  const { data: list = [], isLoading } = useGetDividendTemplatesQuery();
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingPersonKey, setEditingPersonKey] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: detail } = useGetDividendTemplateQuery(selectedId!, {
    skip: selectedId == null || mode !== "edit",
  });

  const [createTemplate, { isLoading: creating }] = useCreateDividendTemplateMutation();
  const [updateTemplate, { isLoading: updating }] = useUpdateDividendTemplateMutation();
  const [deleteTemplate, { isLoading: deleting }] = useDeleteDividendTemplateMutation();

  useEffect(() => {
    if (mode === "edit" && detail && detail.id === selectedId) {
      setForm(detailToForm(detail));
      setEditingPersonKey(null);
    }
  }, [mode, detail, selectedId]);

  function updateBusiness(tempKey: string, patch: Partial<FormBusiness>) {
    setForm((prev) => ({
      ...prev,
      businesses: prev.businesses.map((b) => (b.tempKey === tempKey ? { ...b, ...patch } : b)),
    }));
  }

  function startCreate() {
    setForm(emptyForm());
    setSelectedId(null);
    setEditingPersonKey(null);
    setMode("create");
  }

  function openEdit(id: number) {
    setSelectedId(id);
    setEditingPersonKey(null);
    setMode("edit");
  }

  async function saveForm() {
    try {
      const input = formToInput(form);
      if (!input.name) {
        setAlert({ message: t("dividends.templateNameRequired") });
        return;
      }
      if (input.businesses.some((b) => !b.name)) {
        setAlert({ message: t("dividends.businessNameRequired") });
        return;
      }
      if (mode === "create") {
        await createTemplate(input).unwrap();
      } else if (selectedId) {
        await updateTemplate({ id: selectedId, data: input }).unwrap();
      }
      setMode("list");
      setSelectedId(null);
    } catch (e: any) {
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.templateSaveFailed"),
      });
    }
  }

  async function doDelete() {
    if (!confirmDeleteId) return;
    try {
      await deleteTemplate(confirmDeleteId).unwrap();
      setConfirmDeleteId(null);
      if (selectedId === confirmDeleteId) {
        setSelectedId(null);
        setMode("list");
      }
    } catch (e: any) {
      setConfirmDeleteId(null);
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.templateDeleteFailed"),
      });
    }
  }

  const showEditor = mode === "create" || mode === "edit";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("dividends.templatesTitle")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t("dividends.templatesDesc")}</p>
        </div>
        {mode === "list" ? (
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {t("dividends.newTemplate")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMode("list");
              setSelectedId(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("dividends.backToTemplates")}
          </button>
        )}
      </div>

      {mode === "list" && (
        <SectionCard title={t("dividends.templatesListTitle")}>
          {isLoading ? (
            <p className="text-sm text-slate-500">{t("common.loading")}</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-slate-500">{t("dividends.templatesEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4 font-medium">{t("dividends.name")}</th>
                    <th className="py-2 pr-4 font-medium">{t("dividends.businessesCount")}</th>
                    <th className="py-2 pr-4 font-medium">{t("dividends.personsCount")}</th>
                    <th className="py-2 font-medium">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.name}</td>
                      <td className="py-3 pr-4 text-slate-600">{row.businessCount}</td>
                      <td className="py-3 pr-4 text-slate-600">{row.personCount}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-sm text-slate-600 underline"
                            onClick={() => openEdit(row.id)}
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            className="text-sm text-red-600 underline"
                            onClick={() => setConfirmDeleteId(row.id)}
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {showEditor && (
        <div className="space-y-6">
          <SectionCard title={t("dividends.templateSetup")}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.templateName")}
                </span>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="mb-1 block font-medium text-slate-700">{t("dividends.notes")}</span>
                <textarea
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title={t("dividends.personsTitle")}
            description={t("dividends.templatePersonsDesc")}
            actions={
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => {
                  const key = newTempKey("person");
                  setForm({
                    ...form,
                    persons: [...form.persons, { tempKey: key, name: "" }],
                  });
                  setEditingPersonKey(key);
                }}
              >
                {t("dividends.addPerson")}
              </button>
            }
          >
            <div className="space-y-2">
              {form.persons.length === 0 && (
                <p className="text-sm text-slate-500">{t("dividends.noPersons")}</p>
              )}
              {form.persons.map((person) => {
                const isEditing = editingPersonKey === person.tempKey;
                return (
                  <div key={person.tempKey} className="flex items-center gap-2">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={t("dividends.personName")}
                        value={person.name}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            persons: form.persons.map((p) =>
                              p.tempKey === person.tempKey ? { ...p, name: e.target.value } : p,
                            ),
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (person.name.trim()) setEditingPersonKey(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        {person.name.trim() || (
                          <span className="text-slate-400">{t("dividends.personName")}</span>
                        )}
                      </div>
                    )}
                    {isEditing ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-slate-800"
                        onClick={() => {
                          if (person.name.trim()) setEditingPersonKey(null);
                        }}
                      >
                        {t("common.done")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-sm text-slate-600 underline"
                        onClick={() => setEditingPersonKey(person.tempKey)}
                      >
                        {t("common.edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-sm text-red-600"
                      onClick={() => {
                        setForm({
                          ...form,
                          persons: form.persons.filter((p) => p.tempKey !== person.tempKey),
                          businesses: form.businesses.map((b) => ({
                            ...b,
                            shares: b.shares.filter((s) => s.personTempKey !== person.tempKey),
                          })),
                        });
                        if (editingPersonKey === person.tempKey) setEditingPersonKey(null);
                      }}
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          {form.businesses.map((biz) => (
            <SectionCard
              key={biz.tempKey}
              title={biz.name || t("dividends.business")}
              description={t("dividends.templateBusinessDesc")}
              actions={
                form.businesses.length > 1 ? (
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() =>
                      setForm({
                        ...form,
                        businesses: form.businesses.filter((b) => b.tempKey !== biz.tempKey),
                      })
                    }
                  >
                    {t("dividends.removeBusiness")}
                  </button>
                ) : null
              }
            >
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                      {t("dividends.businessName")}
                    </span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={biz.name}
                      onChange={(e) => updateBusiness(biz.tempKey, { name: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                      {t("dividends.keepPercent")}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.001"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={biz.keepPercent}
                      onChange={(e) => updateBusiness(biz.tempKey, { keepPercent: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                      {t("dividends.remainderTo")}
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={biz.remainderBusinessTempKey}
                      onChange={(e) =>
                        updateBusiness(biz.tempKey, { remainderBusinessTempKey: e.target.value })
                      }
                    >
                      <option value="">{t("dividends.remainderStay")}</option>
                      {form.businesses
                        .filter((b) => b.tempKey !== biz.tempKey)
                        .map((b) => (
                          <option key={b.tempKey} value={b.tempKey}>
                            {b.name || b.tempKey}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-medium text-slate-600">
                      {t("dividends.stakeholderShares")}
                    </div>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-800 underline"
                      onClick={() =>
                        updateBusiness(biz.tempKey, {
                          shares: [
                            ...biz.shares,
                            {
                              personTempKey: form.persons[0]?.tempKey || "",
                              sharePercent: "",
                            },
                          ],
                        })
                      }
                    >
                      {t("dividends.addShare")}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {biz.shares.map((share, idx) => (
                      <div
                        key={`${biz.tempKey}_share_${idx}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <select
                          className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          value={share.personTempKey}
                          onChange={(e) => {
                            const next = [...biz.shares];
                            next[idx] = { ...share, personTempKey: e.target.value };
                            updateBusiness(biz.tempKey, { shares: next });
                          }}
                        >
                          <option value="">{t("dividends.selectPerson")}</option>
                          {form.persons.map((p) => (
                            <option key={p.tempKey} value={p.tempKey}>
                              {p.name || p.tempKey}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.001"
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          value={share.sharePercent}
                          onChange={(e) => {
                            const next = [...biz.shares];
                            next[idx] = { ...share, sharePercent: e.target.value };
                            updateBusiness(biz.tempKey, { shares: next });
                          }}
                        />
                        <span className="text-sm text-slate-500">%</span>
                        <button
                          type="button"
                          className="text-sm text-red-600"
                          onClick={() =>
                            updateBusiness(biz.tempKey, {
                              shares: biz.shares.filter((_, i) => i !== idx),
                            })
                          }
                        >
                          {t("common.remove")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
              onClick={() =>
                setForm({
                  ...form,
                  businesses: [...form.businesses, emptyBusiness()],
                })
              }
            >
              {t("dividends.addBusiness")}
            </button>
            <button
              type="button"
              disabled={creating || updating}
              onClick={saveForm}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating || updating ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}

      {alert && (
        <AlertModal isOpen message={alert.message} type="error" onClose={() => setAlert(null)} />
      )}
      <ConfirmModal
        isOpen={confirmDeleteId != null}
        message={t("dividends.templateDeleteConfirm")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteId(null)}
        type="warning"
      />
      {deleting ? null : null}
    </div>
  );
}
