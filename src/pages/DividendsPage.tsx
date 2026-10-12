import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import Badge from "../components/common/Badge";
import { AccountSelect } from "../components/common/AccountSelect";
import {
  useGetDividendsQuery,
  useGetDividendQuery,
  useCreateDividendMutation,
  useUpdateDividendMutation,
  useCalculateDividendMutation,
  usePayDividendMutation,
  useDeleteDividendMutation,
  useGetTagsQuery,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
  useGetAccountsQuery,
  useGetCurrenciesQuery,
  useGetDividendTemplatesQuery,
  useLazyGetDividendTemplateQuery,
} from "../services/api";
import type {
  Currency,
  DividendBusinessInput,
  DividendCalculationDetail,
  DividendCalculationInput,
  DividendPersonInput,
  DividendTemplateDetail,
  ProfitExchangeRate,
  Tag,
} from "../types";
import { ORDER_RECEIPT_PAYMENT_TOLERANCE } from "../utils/orders/orderAmountTolerance";
import { convertCurrency } from "../utils/orders/orderCalculations";
import DividendTemplatesPanel from "../components/dividends/DividendTemplatesPanel";
import { exportDividendReport } from "../utils/dividends/dividendReportExport";

const DIVIDEND_PAYMENT_TOLERANCE = ORDER_RECEIPT_PAYMENT_TOLERANCE;
/** Matches server DIVIDEND_UNTAGGED_TAG_ID — items with no tags. */
const UNTAGGED_TAG_ID = 0;

function buildProfitConverters(
  targetCurrency: string | null | undefined,
  exchangeRates: ProfitExchangeRate[] | undefined,
  currencies: Currency[],
) {
  const rateToTarget: Record<string, number> = {};
  if (targetCurrency && exchangeRates) {
    for (const r of exchangeRates) {
      if (r.toCurrencyCode === targetCurrency) {
        rateToTarget[r.fromCurrencyCode] = r.rate;
      }
    }
  }

  const toTarget = (amount: number, fromCode: string): number | null => {
    if (!targetCurrency) return null;
    if (fromCode === targetCurrency) return amount;
    const rate = rateToTarget[fromCode];
    if (rate == null) return null;
    return convertCurrency(amount, rate, fromCode, targetCurrency, currencies);
  };

  const fromTarget = (amount: number, toCode: string): number | null => {
    if (!targetCurrency) return null;
    if (toCode === targetCurrency) return amount;
    const rate = rateToTarget[toCode];
    if (rate == null) return null;
    return convertCurrency(amount, rate, targetCurrency, toCode, currencies);
  };

  return { toTarget, fromTarget, rateToTarget };
}

function roundMoney(n: number, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

type FormBusiness = {
  tempKey: string;
  name: string;
  keepPercent: string;
  remainderBusinessTempKey: string;
  orderTagIds: number[];
  expenseTags: { tagId: number; allocationPercent: string }[];
  shares: { personTempKey: string; sharePercent: string }[];
  manualOrderProfit: string;
  manualExpenseTotal: string;
  manualIncomeTotal: string;
};

type FormPerson = {
  tempKey: string;
  name: string;
};

type FormState = {
  name: string;
  periodStartDate: string;
  periodEndDate: string;
  sourceMode: "auto" | "manual";
  manualInputCurrencyCode: string;
  profitCalculationId: string;
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
    orderTagIds: [],
    expenseTags: [],
    shares: [],
    manualOrderProfit: "",
    manualExpenseTotal: "",
    manualIncomeTotal: "",
  };
}

function emptyForm(): FormState {
  return {
    name: "",
    periodStartDate: "",
    periodEndDate: "",
    sourceMode: "auto",
    manualInputCurrencyCode: "",
    profitCalculationId: "",
    notes: "",
    businesses: [emptyBusiness()],
    persons: [],
  };
}

/** Apply a saved template onto the current form (snapshot copy). */
function applyTemplateToForm(
  form: FormState,
  template: DividendTemplateDetail,
): FormState {
  const businessTempById = new Map<number, string>();
  template.businesses.forEach((b, i) => {
    businessTempById.set(b.id, `biz_tpl_${b.id}_${i}_${Date.now()}`);
  });
  const personTempById = new Map<number, string>();
  template.persons.forEach((p, i) => {
    personTempById.set(p.id, `person_tpl_${p.id}_${i}_${Date.now()}`);
  });

  return {
    ...form,
    businesses: template.businesses.map((b) => ({
      tempKey: businessTempById.get(b.id)!,
      name: b.name,
      keepPercent: String(b.keepPercent),
      remainderBusinessTempKey: b.remainderBusinessId
        ? businessTempById.get(b.remainderBusinessId) || ""
        : "",
      orderTagIds: [],
      expenseTags: [],
      shares: b.shares.map((s) => ({
        personTempKey: personTempById.get(s.templatePersonId) || "",
        sharePercent: String(s.sharePercent),
      })),
      manualOrderProfit: "",
      manualExpenseTotal: "",
      manualIncomeTotal: "",
    })),
    persons: template.persons.map((p) => ({
      tempKey: personTempById.get(p.id)!,
      name: p.name,
    })),
  };
}

function detailToForm(detail: DividendCalculationDetail): FormState {
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
    periodStartDate: detail.periodStartDate || "",
    periodEndDate: detail.periodEndDate || "",
    sourceMode: detail.sourceMode === "manual" ? "manual" : "auto",
    manualInputCurrencyCode: detail.manualInputCurrencyCode || detail.targetCurrencyCode || "",
    profitCalculationId: detail.profitCalculationId ? String(detail.profitCalculationId) : "",
    notes: detail.notes || "",
    businesses: detail.businesses.map((b) => ({
      tempKey: businessTempById.get(b.id)!,
      name: b.name,
      keepPercent: String(b.keepPercent),
      remainderBusinessTempKey: b.remainderBusinessId
        ? businessTempById.get(b.remainderBusinessId) || ""
        : "",
      orderTagIds: b.orderTags.map((t) => t.id),
      expenseTags: b.expenseTags.map((et) => ({
        tagId: et.tagId || et.id,
        allocationPercent: String(et.allocationPercent),
      })),
      shares: b.shares.map((s) => ({
        personTempKey: personTempById.get(s.personId) || "",
        sharePercent: String(s.sharePercent),
      })),
      manualOrderProfit: b.orderProfit != null ? String(b.orderProfit) : "",
      manualExpenseTotal: b.expenseTotal != null ? String(b.expenseTotal) : "",
      manualIncomeTotal: b.incomeTotal != null ? String(b.incomeTotal) : "",
    })),
    persons: detail.persons.map((p) => ({
      tempKey: personTempById.get(p.id)!,
      name: p.name,
    })),
  };
}

/** After calculate, stored amounts are in target — convert back for the manual form. */
function applyManualAmountsFromTarget(
  form: FormState,
  detail: DividendCalculationDetail,
  fromTarget: (amount: number, toCode: string) => number | null,
): FormState {
  if (form.sourceMode !== "manual") return form;
  if (!detail.calculatedAt) return form;
  const inputCode =
    form.manualInputCurrencyCode || detail.targetCurrencyCode || "";
  const target = detail.targetCurrencyCode || "";
  if (!inputCode || !target || inputCode === target) return form;

  const convertField = (raw: string) => {
    if (raw.trim() === "") return raw;
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    const converted = fromTarget(n, inputCode);
    if (converted == null) return raw;
    return String(roundMoney(converted));
  };

  return {
    ...form,
    businesses: form.businesses.map((b) => ({
      ...b,
      manualOrderProfit: convertField(b.manualOrderProfit),
      manualExpenseTotal: convertField(b.manualExpenseTotal),
      manualIncomeTotal: convertField(b.manualIncomeTotal),
    })),
  };
}

function formToInput(form: FormState): DividendCalculationInput {
  const persons: DividendPersonInput[] = form.persons
    .filter((p) => p.name.trim())
    .map((p) => ({ tempKey: p.tempKey, name: p.name.trim() }));

  const parseManual = (v: string) => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const businesses: DividendBusinessInput[] = form.businesses.map((b, index) => ({
    tempKey: b.tempKey,
    name: b.name.trim(),
    sortOrder: index,
    keepPercent: Number(b.keepPercent) || 0,
    remainderBusinessTempKey: b.remainderBusinessTempKey || null,
    orderTagIds: form.sourceMode === "manual" ? [] : b.orderTagIds,
    expenseTags:
      form.sourceMode === "manual"
        ? []
        : b.expenseTags
            .filter((et) => Number.isFinite(Number(et.tagId)) && Number(et.tagId) >= 0)
            .map((et) => ({
              tagId: Number(et.tagId),
              allocationPercent: Number(et.allocationPercent) || 0,
            })),
    shares: b.shares
      .filter((s) => s.personTempKey)
      .map((s) => ({
        personTempKey: s.personTempKey,
        sharePercent: Number(s.sharePercent) || 0,
      })),
    manualOrderProfit: form.sourceMode === "manual" ? parseManual(b.manualOrderProfit) : null,
    manualExpenseTotal: form.sourceMode === "manual" ? parseManual(b.manualExpenseTotal) : null,
    manualIncomeTotal: form.sourceMode === "manual" ? parseManual(b.manualIncomeTotal) : null,
  }));

  return {
    name: form.name.trim(),
    periodStartDate: form.periodStartDate,
    periodEndDate: form.periodEndDate,
    sourceMode: form.sourceMode,
    manualInputCurrencyCode:
      form.sourceMode === "manual" ? form.manualInputCurrencyCode || null : null,
    profitCalculationId: form.profitCalculationId ? Number(form.profitCalculationId) : null,
    notes: form.notes.trim() || null,
    businesses,
    persons,
  };
}

function formatMoney(amount: number | null | undefined, currency?: string | null) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const n = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${n} ${currency}` : n;
}

/** Format a target-currency amount for the chosen display currency; show both when they differ. */
function formatMoneyForDisplay(
  amountInTarget: number | null | undefined,
  displayCurrency: string | null | undefined,
  targetCurrency: string | null | undefined,
  fromTarget: (amount: number, toCode: string) => number | null,
) {
  if (amountInTarget == null || !Number.isFinite(amountInTarget)) return "—";
  const target = targetCurrency || null;
  const display = displayCurrency || target;
  if (!display || !target || display === target) {
    return formatMoney(amountInTarget, target || display);
  }
  const converted = fromTarget(amountInTarget, display);
  if (converted == null) {
    return formatMoney(amountInTarget, target);
  }
  return (
    <>
      {formatMoney(converted, display)}
      <span className="mt-0.5 block text-xs font-normal text-slate-500">
        ≈ {formatMoney(amountInTarget, target)}
      </span>
    </>
  );
}

function statusBadgeTone(status: string): "emerald" | "amber" | "blue" | "slate" {
  switch (status) {
    case "paid":
      return "emerald";
    case "partially_paid":
      return "amber";
    case "calculated":
      return "blue";
    default:
      return "slate";
  }
}

function TagMultiSelect({
  tags,
  selectedIds,
  onChange,
  label,
  untaggedLabel,
}: {
  tags: Tag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  label: string;
  untaggedLabel: string;
}) {
  const options: { id: number; name: string; color: string }[] = [
    { id: UNTAGGED_TAG_ID, name: untaggedLabel, color: "#94a3b8" },
    ...tags,
  ];

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">{label}</div>
      <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
        {options.map((tag) => {
          const checked = selectedIds.includes(tag.id);
          return (
            <label
              key={tag.id}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                checked ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selectedIds, tag.id]);
                  else onChange(selectedIds.filter((id) => id !== tag.id));
                }}
              />
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: tag.color || "#94a3b8" }}
              />
              {tag.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function DividendsPage() {
  const { t } = useTranslation();
  const { data: list = [], isLoading } = useGetDividendsQuery();
  const { data: tags = [] } = useGetTagsQuery();
  const { data: profitCalcs = [] } = useGetProfitCalculationsQuery();
  const { data: accounts = [] } = useGetAccountsQuery({});
  const { data: currencies = [] } = useGetCurrenciesQuery();
  const { data: templates = [] } = useGetDividendTemplatesQuery();
  const [fetchTemplate] = useLazyGetDividendTemplateQuery();

  const [pageTab, setPageTab] = useState<"calculations" | "templates">("calculations");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "edit" | "view">("list");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [alert, setAlert] = useState<{ message: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [payPersonId, setPayPersonId] = useState<number | null>(null);
  const [payCurrency, setPayCurrency] = useState<string>("");
  const [payLines, setPayLines] = useState<{ accountId: string; amount: string }[]>([
    { accountId: "", amount: "" },
  ]);
  const [editingPersonKey, setEditingPersonKey] = useState<string | null>(null);
  const [calcWarnings, setCalcWarnings] = useState<string[]>([]);
  const [viewDisplayCurrency, setViewDisplayCurrency] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const { data: detail, isFetching: detailLoading } = useGetDividendQuery(selectedId!, {
    skip: selectedId == null || mode === "create",
  });

  const defaultProfitId = useMemo(() => {
    const def = profitCalcs.find((c) => c.isDefault);
    return def?.id ? String(def.id) : profitCalcs[0]?.id ? String(profitCalcs[0].id) : "";
  }, [profitCalcs]);

  const resolvedProfitCalcId = useMemo(() => {
    if (mode === "create" || mode === "edit") {
      if (form.profitCalculationId) return Number(form.profitCalculationId);
      if (defaultProfitId) return Number(defaultProfitId);
      return null;
    }
    return (
      detail?.profitCalculationId ??
      profitCalcs.find((c) => c.isDefault)?.id ??
      profitCalcs[0]?.id ??
      null
    );
  }, [mode, form.profitCalculationId, defaultProfitId, detail?.profitCalculationId, profitCalcs]);

  const { data: profitCalcDetails } = useGetProfitCalculationQuery(resolvedProfitCalcId!, {
    skip: !resolvedProfitCalcId || pageTab !== "calculations" || mode === "list",
  });

  const [createDividend, { isLoading: creating }] = useCreateDividendMutation();
  const [updateDividend, { isLoading: updating }] = useUpdateDividendMutation();
  const [calculateDividend, { isLoading: calculating }] = useCalculateDividendMutation();
  const [payDividend, { isLoading: paying }] = usePayDividendMutation();
  const [deleteDividend, { isLoading: deleting }] = useDeleteDividendMutation();

  const currency =
    detail?.targetCurrencyCode || profitCalcDetails?.targetCurrencyCode || null;

  const { toTarget, fromTarget, rateToTarget } = useMemo(
    () =>
      buildProfitConverters(
        currency || profitCalcDetails?.targetCurrencyCode,
        profitCalcDetails?.exchangeRates,
        currencies,
      ),
    [currency, profitCalcDetails, currencies],
  );

  const fxCurrencyOptions = useMemo(() => {
    const codes = new Set<string>();
    if (currency) codes.add(currency);
    if (profitCalcDetails?.targetCurrencyCode) codes.add(profitCalcDetails.targetCurrencyCode);
    for (const code of Object.keys(rateToTarget)) codes.add(code);
    return [...codes].sort();
  }, [currency, profitCalcDetails?.targetCurrencyCode, rateToTarget]);

  const ratesReady = Boolean(profitCalcDetails?.exchangeRates);
  useEffect(() => {
    if (mode !== "edit" || !detail || detail.id !== selectedId) return;
    const base = detailToForm(detail);
    setForm(applyManualAmountsFromTarget(base, detail, fromTarget));
    // Hydrate once when opening edit / when FX becomes available for convert-back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedId, detail?.id, detail?.updatedAt, ratesReady]);

  useEffect(() => {
    if (mode === "view" && currency) {
      setViewDisplayCurrency(currency);
    }
    if (mode !== "view") {
      setViewDisplayCurrency("");
    }
  }, [mode, currency, selectedId]);

  // Default manual input currency to profit-calc target when empty.
  useEffect(() => {
    if (mode !== "create" && mode !== "edit") return;
    if (form.sourceMode !== "manual") return;
    const target = profitCalcDetails?.targetCurrencyCode;
    if (!target) return;
    setForm((prev) => {
      if (prev.manualInputCurrencyCode) return prev;
      return { ...prev, manualInputCurrencyCode: target };
    });
  }, [mode, form.sourceMode, profitCalcDetails?.targetCurrencyCode]);

  const payCurrencyOptions = useMemo(() => {
    const codes = new Set<string>();
    if (currency) codes.add(currency);
    for (const a of accounts) {
      if (a.currencyCode) codes.add(a.currencyCode);
    }
    for (const code of Object.keys(rateToTarget)) codes.add(code);
    return [...codes].sort();
  }, [accounts, currency, rateToTarget]);

  const payTarget = detail?.personTotals.find((p) => p.personId === payPersonId);
  const activePayCurrency = payCurrency || currency || "";
  const activeDisplayCurrency = viewDisplayCurrency || currency || "";

  const money = (amount: number | null | undefined) => {
    // Manual draft before Calculate stores amounts in the input currency, not target.
    if (
      detail?.sourceMode === "manual" &&
      !detail.calculatedAt &&
      detail.manualInputCurrencyCode &&
      currency &&
      detail.manualInputCurrencyCode !== currency
    ) {
      const inputCode = detail.manualInputCurrencyCode;
      if (amount == null || !Number.isFinite(amount)) return "—";
      if (!activeDisplayCurrency || activeDisplayCurrency === inputCode) {
        return formatMoney(amount, inputCode);
      }
      const inTarget = toTarget(amount, inputCode);
      if (inTarget == null) return formatMoney(amount, inputCode);
      return formatMoneyForDisplay(inTarget, activeDisplayCurrency, currency, fromTarget);
    }
    return formatMoneyForDisplay(amount, activeDisplayCurrency, currency, fromTarget);
  };

  const suggestedPayAmount = useMemo(() => {
    if (!payTarget || !activePayCurrency) return null;
    const converted = fromTarget(payTarget.remainingAmount, activePayCurrency);
    if (converted == null) return null;
    return roundMoney(converted);
  }, [payTarget, activePayCurrency, fromTarget]);

  const paySumInTarget = useMemo(() => {
    let sum = 0;
    for (const line of payLines) {
      const amt = Number(line.amount);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const converted = toTarget(amt, activePayCurrency);
      if (converted == null) return null;
      sum += converted;
    }
    return sum;
  }, [payLines, activePayCurrency, toTarget]);

  const payDiff =
    payTarget && paySumInTarget != null
      ? Math.abs(paySumInTarget - payTarget.remainingAmount)
      : Infinity;
  const payOk =
    !!payTarget &&
    paySumInTarget != null &&
    paySumInTarget > 0 &&
    payDiff <= DIVIDEND_PAYMENT_TOLERANCE;

  const filteredAccounts = useMemo(() => {
    if (!activePayCurrency) return accounts;
    return accounts.filter((a) => a.currencyCode === activePayCurrency);
  }, [accounts, activePayCurrency]);

  function openPayModal(personId: number) {
    setPayPersonId(personId);
    setPayCurrency(currency || "");
    setPayLines([{ accountId: "", amount: "" }]);
  }

  function changePayCurrency(nextCurrency: string) {
    setPayCurrency(nextCurrency);
    // Clear account; amount will be refilled by the suggestion effect
    setPayLines([{ accountId: "", amount: "" }]);
  }

  // Auto-fill suggested amount in selected currency once FX rates are available
  useEffect(() => {
    if (payPersonId == null || !payTarget || !activePayCurrency) return;
    const converted = fromTarget(payTarget.remainingAmount, activePayCurrency);
    if (converted == null) return;
    const suggested = String(roundMoney(converted));
    setPayLines((prev) => {
      if (prev.some((l) => l.accountId)) return prev;
      if (prev.length === 1 && (!prev[0].amount || prev[0].amount === "")) {
        return [{ accountId: "", amount: suggested }];
      }
      return prev;
    });
  }, [payPersonId, payTarget, activePayCurrency, fromTarget]);

  function startCreate() {
    const f = emptyForm();
    f.profitCalculationId = defaultProfitId;
    const defCalc =
      profitCalcs.find((c) => String(c.id) === defaultProfitId) || profitCalcs[0];
    f.manualInputCurrencyCode = defCalc?.targetCurrencyCode || "";
    setForm(f);
    setSelectedId(null);
    setSelectedTemplateId("");
    setCalcWarnings([]);
    setEditingPersonKey(null);
    setPageTab("calculations");
    setMode("create");
  }

  async function applySelectedTemplate(templateIdStr: string) {
    setSelectedTemplateId(templateIdStr);
    if (!templateIdStr) return;
    try {
      const template = await fetchTemplate(Number(templateIdStr)).unwrap();
      setForm((prev) => applyTemplateToForm(prev, template));
      setEditingPersonKey(null);
    } catch (e: any) {
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.templateLoadFailed"),
      });
    }
  }

  function openView(id: number) {
    setSelectedId(id);
    setCalcWarnings([]);
    setMode("view");
  }

  function openEdit(id: number) {
    setSelectedId(id);
    setCalcWarnings([]);
    setEditingPersonKey(null);
    setMode("edit");
  }

  async function saveForm() {
    try {
      const input = formToInput(form);
      if (!input.name) {
        setAlert({ message: t("dividends.nameRequired") });
        return;
      }
      if (
        form.sourceMode === "auto" &&
        (!input.periodStartDate || !input.periodEndDate)
      ) {
        setAlert({ message: t("dividends.periodRequired") });
        return;
      }
      if (mode === "create") {
        const created = await createDividend(input).unwrap();
        setSelectedId(created.id);
        setMode("view");
      } else if (selectedId) {
        await updateDividend({ id: selectedId, data: input }).unwrap();
        setMode("view");
      }
    } catch (e: any) {
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.saveFailed"),
      });
    }
  }

  async function runCalculate() {
    if (!selectedId) return;
    try {
      const result = await calculateDividend(selectedId).unwrap();
      setCalcWarnings(result.warnings || []);
      setMode("view");
    } catch (e: any) {
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.calculateFailed"),
      });
    }
  }

  async function runExportExcel() {
    if (!detail) return;
    const targetCurrency = currency || detail.targetCurrencyCode || "";
    const displayCurrency = activeDisplayCurrency || targetCurrency;
    if (!targetCurrency) {
      setAlert({ message: t("dividends.exportFailed") });
      return;
    }
    if (displayCurrency !== targetCurrency) {
      const probe = fromTarget(1, displayCurrency);
      if (probe == null) {
        setAlert({
          message: t("dividends.noFxRate", {
            from: targetCurrency,
            to: displayCurrency,
          }),
        });
        return;
      }
    }
    setExporting(true);
    try {
      await exportDividendReport(detail, t, {
        displayCurrency,
        targetCurrency,
        fromTarget,
      });
    } catch (e: any) {
      setAlert({
        message: e?.message || t("dividends.exportFailed"),
      });
    } finally {
      setExporting(false);
    }
  }

  async function confirmPay() {
    if (!selectedId || !payPersonId || !payOk) return;
    try {
      await payDividend({
        id: selectedId,
        data: {
          personId: payPersonId,
          payments: payLines
            .filter((l) => l.accountId && Number(l.amount) > 0)
            .map((l) => ({ accountId: Number(l.accountId), amount: Number(l.amount) })),
        },
      }).unwrap();
      setPayPersonId(null);
      setPayCurrency("");
      setPayLines([{ accountId: "", amount: "" }]);
    } catch (e: any) {
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.payFailed"),
      });
    }
  }

  async function doDelete() {
    if (!confirmDeleteId) return;
    try {
      await deleteDividend(confirmDeleteId).unwrap();
      setConfirmDeleteId(null);
      if (selectedId === confirmDeleteId) {
        setSelectedId(null);
        setMode("list");
      }
    } catch (e: any) {
      setConfirmDeleteId(null);
      setAlert({
        message: e?.data?.message || e?.message || t("dividends.deleteFailed"),
      });
    }
  }

  function updateBusiness(tempKey: string, patch: Partial<FormBusiness>) {
    setForm((prev) => ({
      ...prev,
      businesses: prev.businesses.map((b) => (b.tempKey === tempKey ? { ...b, ...patch } : b)),
    }));
  }

  const showEditor = pageTab === "calculations" && (mode === "create" || mode === "edit");
  const showDetail = pageTab === "calculations" && mode === "view" && detail;
  const canEditConfig =
    detail && (detail.status === "draft" || detail.status === "calculated");
  const canExportReport =
    detail &&
    detail.status !== "draft" &&
    (detail.businesses.some(
      (b) => b.netProfit != null || b.poolAmount != null || b.orderProfit != null,
    ) ||
      detail.personTotals.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("dividends.pageTitle")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("dividends.pageDesc")}</p>
        </div>
        {pageTab === "calculations" && mode === "list" ? (
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {t("dividends.newCalculation")}
          </button>
        ) : pageTab === "calculations" && mode !== "list" ? (
          <button
            type="button"
            onClick={() => {
              setMode("list");
              setSelectedId(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("dividends.backToList")}
          </button>
        ) : null}
      </div>

      {(mode === "list" || pageTab === "templates") && (
        <div className="flex gap-2 border-b border-slate-200">
          <button
            type="button"
            className={`px-3 py-2 text-sm font-medium ${
              pageTab === "calculations"
                ? "border-b-2 border-slate-900 text-slate-900"
                : "text-slate-500 hover:text-slate-800"
            }`}
            onClick={() => {
              setPageTab("calculations");
              setMode("list");
              setSelectedId(null);
            }}
          >
            {t("dividends.tabCalculations")}
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-sm font-medium ${
              pageTab === "templates"
                ? "border-b-2 border-slate-900 text-slate-900"
                : "text-slate-500 hover:text-slate-800"
            }`}
            onClick={() => {
              setPageTab("templates");
              setMode("list");
              setSelectedId(null);
            }}
          >
            {t("dividends.tabTemplates")}
          </button>
        </div>
      )}

      {pageTab === "templates" && <DividendTemplatesPanel />}

      {pageTab === "calculations" && mode === "list" && (
        <SectionCard title={t("dividends.listTitle")} description={t("dividends.listDesc")}>
          {isLoading ? (
            <p className="text-sm text-slate-500">{t("common.loading")}</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-slate-500">{t("dividends.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4 font-medium">{t("dividends.name")}</th>
                    <th className="py-2 pr-4 font-medium">{t("dividends.period")}</th>
                    <th className="py-2 pr-4 font-medium">{t("dividends.status")}</th>
                    <th className="py-2 pr-4 font-medium">{t("dividends.currency")}</th>
                    <th className="py-2 font-medium">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium text-slate-900">{row.name}</td>
                      <td className="py-3 pr-4 text-slate-600">
                        {row.sourceMode === "manual"
                          ? t("dividends.modeManual")
                          : row.periodStartDate && row.periodEndDate
                            ? `${row.periodStartDate} → ${row.periodEndDate}`
                            : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={statusBadgeTone(row.status)}>
                          {t(`dividends.status_${row.status}`)}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{row.targetCurrencyCode || "—"}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-sm font-medium text-slate-900 underline"
                            onClick={() => openView(row.id)}
                          >
                            {t("common.view")}
                          </button>
                          {(row.status === "draft" || row.status === "calculated") && (
                            <button
                              type="button"
                              className="text-sm text-slate-600 underline"
                              onClick={() => openEdit(row.id)}
                            >
                              {t("common.edit")}
                            </button>
                          )}
                          {(row.status === "draft" || row.status === "calculated") && (
                            <button
                              type="button"
                              className="text-sm text-red-600 underline"
                              onClick={() => setConfirmDeleteId(row.id)}
                            >
                              {t("common.delete")}
                            </button>
                          )}
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
          <SectionCard title={t("dividends.setupTitle")} description={t("dividends.setupDesc")}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">{t("dividends.name")}</span>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.applyTemplate")}
                </span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={selectedTemplateId}
                  onChange={(e) => applySelectedTemplate(e.target.value)}
                >
                  <option value="">{t("dividends.selectTemplate")}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} ({tpl.businessCount} {t("dividends.business")}, {tpl.personCount}{" "}
                      {t("dividends.person")})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  {t("dividends.applyTemplateHint")}
                </span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.profitCalculation")}
                </span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.profitCalculationId}
                  onChange={(e) => setForm({ ...form, profitCalculationId: e.target.value })}
                >
                  <option value="">{t("dividends.useDefaultFx")}</option>
                  {profitCalcs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.isDefault ? ` (${t("dividends.default")})` : ""} — {c.targetCurrencyCode}
                    </option>
                  ))}
                </select>
              </label>

              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-medium text-slate-700">
                  {t("dividends.sourceMode")}
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="sourceMode"
                      checked={form.sourceMode === "auto"}
                      onChange={() => setForm({ ...form, sourceMode: "auto" })}
                    />
                    {t("dividends.modeAuto")}
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="sourceMode"
                      checked={form.sourceMode === "manual"}
                      onChange={() =>
                        setForm({
                          ...form,
                          sourceMode: "manual",
                          manualInputCurrencyCode:
                            form.manualInputCurrencyCode ||
                            profitCalcDetails?.targetCurrencyCode ||
                            "",
                        })
                      }
                    />
                    {t("dividends.modeManual")}
                  </label>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {form.sourceMode === "manual"
                    ? t("dividends.modeManualHint")
                    : t("dividends.modeAutoHint")}
                </p>
              </div>

              {form.sourceMode === "manual" && (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">
                    {t("dividends.manualInputCurrency")}
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.manualInputCurrencyCode}
                    onChange={(e) =>
                      setForm({ ...form, manualInputCurrencyCode: e.target.value })
                    }
                  >
                    {!form.manualInputCurrencyCode && (
                      <option value="">{t("dividends.selectCurrency")}</option>
                    )}
                    {fxCurrencyOptions.map((code) => (
                      <option key={code} value={code}>
                        {code}
                        {code === profitCalcDetails?.targetCurrencyCode
                          ? ` (${t("dividends.targetCurrency")})`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    {t("dividends.manualInputCurrencyHint")}
                  </span>
                </label>
              )}

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.periodStart")}
                  {form.sourceMode === "manual" ? (
                    <span className="font-normal text-slate-400"> ({t("common.optional")})</span>
                  ) : null}
                </span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.periodStartDate}
                  onChange={(e) => setForm({ ...form, periodStartDate: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.periodEnd")}
                  {form.sourceMode === "manual" ? (
                    <span className="font-normal text-slate-400"> ({t("common.optional")})</span>
                  ) : null}
                </span>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.periodEndDate}
                  onChange={(e) => setForm({ ...form, periodEndDate: e.target.value })}
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
            description={t("dividends.personsDesc")}
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
                          if (e.key === "Escape") {
                            if (!person.name.trim()) {
                              setForm({
                                ...form,
                                persons: form.persons.filter((p) => p.tempKey !== person.tempKey),
                              });
                            }
                            setEditingPersonKey(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
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
              description={
                form.sourceMode === "manual"
                  ? t("dividends.manualAmountsHint")
                  : t("dividends.businessDesc")
              }
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
                    <span className="mt-1 block text-xs text-slate-500">
                      {t("dividends.keepPercentHint")}
                    </span>
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

                {form.sourceMode === "manual" ? (
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-600">
                      {t("dividends.manualAmounts")}
                      {form.manualInputCurrencyCode
                        ? ` (${form.manualInputCurrencyCode})`
                        : ""}
                    </div>
                    <p className="mb-3 text-xs text-slate-500">{t("dividends.manualAmountsHint")}</p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">
                          {t("dividends.orderProfit")}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          value={biz.manualOrderProfit}
                          onChange={(e) =>
                            updateBusiness(biz.tempKey, { manualOrderProfit: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">
                          {t("dividends.expenses")}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          value={biz.manualExpenseTotal}
                          onChange={(e) =>
                            updateBusiness(biz.tempKey, { manualExpenseTotal: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-slate-700">
                          {t("dividends.income")}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                          value={biz.manualIncomeTotal}
                          onChange={(e) =>
                            updateBusiness(biz.tempKey, { manualIncomeTotal: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <>
                    <TagMultiSelect
                      tags={tags}
                      selectedIds={biz.orderTagIds}
                      label={t("dividends.orderProfitTags")}
                      untaggedLabel={t("dividends.untagged")}
                      onChange={(ids) => updateBusiness(biz.tempKey, { orderTagIds: ids })}
                    />

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-medium text-slate-600">
                          {t("dividends.expenseTags")}
                        </div>
                        <button
                          type="button"
                          className="text-xs font-medium text-slate-800 underline"
                          onClick={() =>
                            updateBusiness(biz.tempKey, {
                              expenseTags: [
                                ...biz.expenseTags,
                                { tagId: UNTAGGED_TAG_ID, allocationPercent: "100" },
                              ],
                            })
                          }
                        >
                          {t("dividends.addExpenseTag")}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {biz.expenseTags.map((et, idx) => (
                          <div
                            key={`${biz.tempKey}_exp_${idx}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <select
                              className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                              value={
                                et.tagId === UNTAGGED_TAG_ID
                                  ? String(UNTAGGED_TAG_ID)
                                  : et.tagId || ""
                              }
                              onChange={(e) => {
                                const next = [...biz.expenseTags];
                                next[idx] = { ...et, tagId: Number(e.target.value) };
                                updateBusiness(biz.tempKey, { expenseTags: next });
                              }}
                            >
                              <option value={UNTAGGED_TAG_ID}>{t("dividends.untagged")}</option>
                              {tags.map((tag) => (
                                <option key={tag.id} value={tag.id}>
                                  {tag.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.001"
                              className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                              value={et.allocationPercent}
                              onChange={(e) => {
                                const next = [...biz.expenseTags];
                                next[idx] = { ...et, allocationPercent: e.target.value };
                                updateBusiness(biz.tempKey, { expenseTags: next });
                              }}
                            />
                            <span className="text-sm text-slate-500">%</span>
                            <button
                              type="button"
                              className="text-sm text-red-600"
                              onClick={() =>
                                updateBusiness(biz.tempKey, {
                                  expenseTags: biz.expenseTags.filter((_, i) => i !== idx),
                                })
                              }
                            >
                              {t("common.remove")}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

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
                      <div key={`${biz.tempKey}_share_${idx}`} className="flex flex-wrap items-center gap-2">
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

      {pageTab === "calculations" && mode === "view" && detailLoading && (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      )}

      {showDetail && (
        <div className="space-y-6">
          <SectionCard
            title={detail.name}
            description={
              detail.sourceMode === "manual"
                ? t("dividends.modeManual")
                : detail.periodStartDate && detail.periodEndDate
                  ? `${detail.periodStartDate} → ${detail.periodEndDate}`
                  : undefined
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <Badge tone={statusBadgeTone(detail.status)}>
                  {t(`dividends.status_${detail.status}`)}
                </Badge>
                {canEditConfig && (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                    onClick={() => openEdit(detail.id)}
                  >
                    {t("common.edit")}
                  </button>
                )}
                {canEditConfig && (
                  <button
                    type="button"
                    disabled={calculating}
                    onClick={runCalculate}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {calculating ? t("dividends.calculating") : t("dividends.calculate")}
                  </button>
                )}
                {canExportReport && (
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={runExportExcel}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {exporting ? t("dividends.exporting") : t("dividends.exportExcel")}
                  </button>
                )}
              </div>
            }
          >
            <div className="flex flex-wrap items-end gap-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  {t("dividends.displayCurrency")}
                </span>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2"
                  value={activeDisplayCurrency}
                  onChange={(e) => setViewDisplayCurrency(e.target.value)}
                >
                  {fxCurrencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                      {code === currency ? ` (${t("dividends.targetCurrency")})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {detail.sourceMode === "manual" && detail.manualInputCurrencyCode ? (
                <p className="text-sm text-slate-600">
                  {t("dividends.manualInputCurrency")}:{" "}
                  <strong>{detail.manualInputCurrencyCode}</strong>
                </p>
              ) : null}
            </div>
            {detail.notes ? (
              <p className="mt-2 text-sm text-slate-600">{detail.notes}</p>
            ) : null}
            {calcWarnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-medium">{t("dividends.warnings")}</div>
                <ul className="mt-1 list-disc pl-5">
                  {calcWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>

          <SectionCard title={t("dividends.businessResults")}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">{t("dividends.business")}</th>
                    <th className="py-2 pr-3 font-medium">{t("dividends.orderProfit")}</th>
                    <th className="py-2 pr-3 font-medium">{t("dividends.expenses")}</th>
                    <th className="py-2 pr-3 font-medium">{t("dividends.income")}</th>
                    <th className="py-2 pr-3 font-medium">{t("dividends.netProfit")}</th>
                    <th className="py-2 font-medium">{t("dividends.poolAmount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.businesses.map((b) => (
                    <tr key={b.id} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{b.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {t("dividends.keepPercent")}: {b.keepPercent}%
                          {b.remainderBusinessId
                            ? ` → ${
                                detail.businesses.find((x) => x.id === b.remainderBusinessId)?.name ||
                                ""
                              }`
                            : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {detail.sourceMode !== "manual" &&
                            b.orderTags.map((tag) => (
                              <span
                                key={tag.id}
                                className="rounded-full px-2 py-0.5 text-[10px] text-white"
                                style={{ backgroundColor: tag.color || "#64748b" }}
                              >
                                {tag.id === UNTAGGED_TAG_ID
                                  ? t("dividends.untagged")
                                  : tag.name}
                              </span>
                            ))}
                          {detail.sourceMode === "manual" && (
                            <span className="rounded-full bg-slate-500 px-2 py-0.5 text-[10px] text-white">
                              {t("dividends.modeManual")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-3">{money(b.orderProfit)}</td>
                      <td className="py-3 pr-3">{money(b.expenseTotal)}</td>
                      <td className="py-3 pr-3">{money(b.incomeTotal)}</td>
                      <td className="py-3 pr-3 font-medium">{money(b.netProfit)}</td>
                      <td className="py-3 font-semibold">{money(b.poolAmount)}</td>
                    </tr>
                  ))}
                  {detail.businesses.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="py-3 pr-3">{t("dividends.total")}</td>
                      <td className="py-3 pr-3">
                        {money(
                          detail.businesses.reduce((s, b) => s + (Number(b.orderProfit) || 0), 0),
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {money(
                          detail.businesses.reduce((s, b) => s + (Number(b.expenseTotal) || 0), 0),
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {money(
                          detail.businesses.reduce((s, b) => s + (Number(b.incomeTotal) || 0), 0),
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {money(
                          detail.businesses.reduce((s, b) => s + (Number(b.netProfit) || 0), 0),
                        )}
                      </td>
                      <td className="py-3">
                        {money(
                          detail.businesses.reduce((s, b) => s + (Number(b.poolAmount) || 0), 0),
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 space-y-4">
              {detail.businesses.map((b) => (
                <div key={`shares_${b.id}`}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">
                    {b.name} — {t("dividends.stakeholderShares")}
                  </h3>
                  {b.shares.length === 0 ? (
                    <p className="text-sm text-slate-500">{t("dividends.noShares")}</p>
                  ) : (
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-1 pr-3 font-medium">{t("dividends.person")}</th>
                          <th className="py-1 pr-3 font-medium">%</th>
                          <th className="py-1 font-medium">{t("dividends.amount")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.shares.map((s) => (
                          <tr key={s.id} className="border-b border-slate-50">
                            <td className="py-2 pr-3">{s.personName}</td>
                            <td className="py-2 pr-3">{s.sharePercent}</td>
                            <td className="py-2">{money(s.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t("dividends.personSummary")} description={t("dividends.personSummaryDesc")}>
            {detail.personTotals.length === 0 ? (
              <p className="text-sm text-slate-500">{t("dividends.runCalculateFirst")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">{t("dividends.person")}</th>
                      <th className="py-2 pr-3 font-medium">{t("dividends.total")}</th>
                      <th className="py-2 pr-3 font-medium">{t("dividends.paid")}</th>
                      <th className="py-2 pr-3 font-medium">{t("dividends.remaining")}</th>
                      <th className="py-2 font-medium">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.personTotals.map((pt) => {
                      const fullyPaid =
                        Math.abs(pt.remainingAmount) <= DIVIDEND_PAYMENT_TOLERANCE;
                      return (
                        <tr key={pt.personId} className="border-b border-slate-100">
                          <td className="py-3 pr-3 font-medium">{pt.personName}</td>
                          <td className="py-3 pr-3">{money(pt.amount)}</td>
                          <td className="py-3 pr-3">{money(pt.paidAmount)}</td>
                          <td className="py-3 pr-3">{money(pt.remainingAmount)}</td>
                          <td className="py-3">
                            {!fullyPaid && detail.status !== "draft" && (
                              <button
                                type="button"
                                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                                onClick={() => openPayModal(pt.personId)}
                              >
                                {t("dividends.pay")}
                              </button>
                            )}
                            {fullyPaid && pt.amount > 0 && (
                              <span className="text-xs font-medium text-emerald-700">
                                {t("dividends.fullyPaid")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {detail.payments.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold">{t("dividends.paymentHistory")}</h3>
                <ul className="space-y-1 text-sm text-slate-600">
                  {detail.payments.map((p) => (
                    <li key={p.id}>
                      {p.createdAt.slice(0, 19).replace("T", " ")} — {p.personName}:{" "}
                      {formatMoney(p.amount, p.currencyCode)} ← {p.accountName || `#${p.accountId}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {payPersonId != null && payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("dividends.payTitle", { name: payTarget.personName })}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t("dividends.payHint", {
                amount: formatMoney(payTarget.remainingAmount, currency),
                tolerance: DIVIDEND_PAYMENT_TOLERANCE,
              })}
            </p>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                {t("dividends.payCurrency")}
              </span>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                value={activePayCurrency}
                onChange={(e) => changePayCurrency(e.target.value)}
              >
                {payCurrencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                    {code === currency ? ` (${t("dividends.targetCurrency")})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {suggestedPayAmount != null ? (
              <p className="mt-2 text-sm text-slate-700">
                {t("dividends.suggestedAmount")}:{" "}
                <strong>
                  {formatMoney(suggestedPayAmount, activePayCurrency)}
                </strong>
                {activePayCurrency !== currency && currency ? (
                  <span className="text-slate-500">
                    {" "}
                    ≈ {formatMoney(payTarget.remainingAmount, currency)}
                  </span>
                ) : null}
              </p>
            ) : activePayCurrency && activePayCurrency !== currency ? (
              <p className="mt-2 text-sm text-amber-700">
                {t("dividends.noFxRate", {
                  from: activePayCurrency,
                  to: currency || "",
                })}
              </p>
            ) : null}

            <div className="mt-4 space-y-3">
              {payLines.map((line, idx) => (
                <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <AccountSelect
                      value={line.accountId}
                      onChange={(accountId) => {
                        const next = [...payLines];
                        next[idx] = { ...line, accountId };
                        setPayLines(next);
                      }}
                      accounts={filteredAccounts}
                      label={t("dividends.account")}
                      filterByCurrency={activePayCurrency || undefined}
                      t={t}
                    />
                  </div>
                  <label className="block text-sm sm:w-40">
                    <span className="mb-1 block font-medium text-slate-700">
                      {t("dividends.amount")} ({activePayCurrency || "—"})
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={line.amount}
                      onChange={(e) => {
                        const next = [...payLines];
                        next[idx] = { ...line, amount: e.target.value };
                        setPayLines(next);
                      }}
                    />
                  </label>
                  {payLines.length > 1 && (
                    <button
                      type="button"
                      className="text-sm text-red-600 sm:mb-2"
                      onClick={() => setPayLines(payLines.filter((_, i) => i !== idx))}
                    >
                      {t("common.remove")}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-slate-800 underline"
              onClick={() => setPayLines([...payLines, { accountId: "", amount: "" }])}
            >
              {t("dividends.addPaymentLine")}
            </button>
            <div className="mt-3 text-sm text-slate-600">
              {t("dividends.paymentSum")}:{" "}
              <strong className={payOk ? "text-emerald-700" : "text-amber-700"}>
                {formatMoney(
                  payLines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
                  activePayCurrency,
                )}
              </strong>
              {paySumInTarget != null && currency && activePayCurrency !== currency && (
                <span className="ml-1 text-slate-500">
                  ≈ {formatMoney(paySumInTarget, currency)}
                </span>
              )}
              {!payOk && paySumInTarget != null && paySumInTarget > 0 && (
                <span className="ml-2 text-amber-700">
                  ({t("dividends.diff")}: {formatMoney(payDiff, currency)})
                </span>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                onClick={() => {
                  setPayPersonId(null);
                  setPayCurrency("");
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!payOk || paying}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={confirmPay}
              >
                {paying ? t("common.saving") : t("dividends.confirmPay")}
              </button>
            </div>
          </div>
        </div>
      )}

      {alert && (
        <AlertModal
          isOpen
          message={alert.message}
          type="error"
          onClose={() => setAlert(null)}
        />
      )}
      <ConfirmModal
        isOpen={confirmDeleteId != null}
        message={t("dividends.deleteConfirm")}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={doDelete}
        onCancel={() => setConfirmDeleteId(null)}
        type="warning"
      />
    </div>
  );
}
