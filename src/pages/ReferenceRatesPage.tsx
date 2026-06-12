import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ReferenceRatesTable from "../components/referenceRates/ReferenceRatesTable";
import ReferenceRatesPairEditor, {
  type PairFormState,
} from "../components/referenceRates/ReferenceRatesPairEditor";
import { CONFIG_PAIR_ORDER, DERIVED_PAIR_ORDER } from "../constants/referenceRatePairs";
import {
  useGetReferenceRatesQuery,
  useSendReferenceRatesToTelegramMutation,
  useUpdateReferenceRatesMutation,
} from "../services/api";
import { hasActionPermission } from "../utils/permissions";
import { useAppSelector } from "../app/hooks";
import type { ReferenceRateBaseMode, ReferenceRatePairId, ReferenceRatesUpdatePayload } from "../types";
import {
  buildDerivedAutoBases,
  buildPreviewFromForm,
  clampDisplayDecimals,
  displayToPercentFraction,
  fractionToDisplayPercent,
  responseDerivedFormPairs,
  type DerivedPairId,
} from "../utils/referenceRates";
const emptyFormPair = (pairId: ReferenceRatePairId): PairFormState => {
  const base: PairFormState = {
    baseModeChoice: "average",
    averageBase: "",
    baseBuy: "",
    baseSell: "",
    markupPercent: "",
    markdownPercent: "",
    displayDecimals: "3",
  };
  if (pairId === "PKR_USDT") {
    return { ...base, markupPercent: "0.2", markdownPercent: "0.9" };
  }
  if (pairId === "USD_USDT_HK") {
    return {
      ...base,
      averageBase: "1",
      markupPercent: "0.8",
      markdownPercent: "0.8",
    };
  }
  if (pairId === "USD_USDT_INTL") {
    return {
      ...base,
      averageBase: "1",
      markupPercent: "1.5",
      markdownPercent: "1.5",
    };
  }
  if (DERIVED_PAIR_ORDER.includes(pairId)) {
    return { ...base, baseModeChoice: "average" };
  }
  return base;
};

const formToPayloadPair = (
  pairId: ReferenceRatePairId,
  f: PairFormState,
): NonNullable<ReferenceRatesUpdatePayload["pairs"][ReferenceRatePairId]> => {
  const markup = displayToPercentFraction(f.markupPercent);
  const markdown = displayToPercentFraction(f.markdownPercent);
  const displayDecimals = clampDisplayDecimals(f.displayDecimals);

  if (pairId === "PKR_USDT") {
    return { markup, markdown, displayDecimals };
  }

  if (DERIVED_PAIR_ORDER.includes(pairId)) {
    const avg = f.averageBase.trim() === "" ? null : Number(f.averageBase);
    return {
      averageBase: Number.isFinite(avg as number) ? avg : null,
      markup,
      markdown,
      displayDecimals,
    };
  }

  if (pairId === "AED_USDT" || pairId === "HKD_USDT") {
    const buy = f.baseBuy.trim() === "" ? null : Number(f.baseBuy);
    const sell = f.baseSell.trim() === "" ? null : Number(f.baseSell);
    return {
      baseMode: "dual",
      baseBuy: Number.isFinite(buy as number) ? buy : null,
      baseSell: Number.isFinite(sell as number) ? sell : null,
      displayDecimals,
    };
  }

  if (f.baseModeChoice === "average") {
    const avg = f.averageBase.trim() === "" ? null : Number(f.averageBase);
    return {
      baseMode: "average",
      averageBase: Number.isFinite(avg as number) ? avg : null,
      markup,
      markdown,
      displayDecimals,
    };
  }

  const buy = f.baseBuy.trim() === "" ? null : Number(f.baseBuy);
  const sell = f.baseSell.trim() === "" ? null : Number(f.baseSell);
  return {
    baseMode: "dual",
    baseBuy: Number.isFinite(buy as number) ? buy : null,
    baseSell: Number.isFinite(sell as number) ? sell : null,
    markup,
    markdown,
    displayDecimals,
  };
};

const responsePairToForm = (
  pairId: ReferenceRatePairId,
  p: {
    baseMode: ReferenceRateBaseMode;
    averageBase: number | null;
    baseBuy: number | null;
    baseSell: number | null;
    markup: number;
    markdown: number;
    displayDecimals?: number;
  },
): PairFormState => {
  const base: PairFormState = {
    baseModeChoice: p.baseMode === "dual" ? "dual" : "average",
    averageBase: p.averageBase != null ? String(p.averageBase) : "",
    baseBuy: p.baseBuy != null ? String(p.baseBuy) : "",
    baseSell: p.baseSell != null ? String(p.baseSell) : "",
    markupPercent: fractionToDisplayPercent(p.markup),
    markdownPercent: fractionToDisplayPercent(p.markdown),
    displayDecimals: String(p.displayDecimals ?? 3),
  };
  if (pairId === "AED_USDT" || pairId === "HKD_USDT") {
    return { ...base, baseModeChoice: "dual" };
  }
  if (pairId === "PKR_USDT") {
    return {
      ...emptyFormPair(pairId),
      markupPercent: fractionToDisplayPercent(p.markup),
      markdownPercent: fractionToDisplayPercent(p.markdown),
      displayDecimals: String(p.displayDecimals ?? 3),
    };
  }
  if (DERIVED_PAIR_ORDER.includes(pairId)) {
    return {
      ...emptyFormPair(pairId),
      averageBase: p.averageBase != null ? String(p.averageBase) : "",
      markupPercent: fractionToDisplayPercent(p.markup),
      markdownPercent: fractionToDisplayPercent(p.markdown),
      displayDecimals: String(p.displayDecimals ?? 3),
    };
  }
  return base;
};

const STANDALONE_PAIRS: ReferenceRatePairId[] = ["CNY_USDT", "PKR_AED", "USD_USDT_HK", "USD_USDT_INTL"];
const BENCHMARK_PAIRS: ReferenceRatePairId[] = ["AED_USDT", "HKD_USDT"];
const CHAIN_PAIRS: ReferenceRatePairId[] = ["PKR_USDT"];

export default function ReferenceRatesPage() {
  const { t } = useTranslation();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = hasActionPermission(user, "editReferenceRates");
  const { data, isLoading, refetch } = useGetReferenceRatesQuery();
  const [updateRates, { isLoading: isSaving }] = useUpdateReferenceRatesMutation();
  const [sendToTelegram, { isLoading: isSendingTelegram }] = useSendReferenceRatesToTelegramMutation();

  const [pkrSwiftFactor, setPkrSwiftFactor] = useState("1.01");
  const [form, setForm] = useState<Record<ReferenceRatePairId, PairFormState>>(() => {
    const init = {} as Record<ReferenceRatePairId, PairFormState>;
    [...CONFIG_PAIR_ORDER, ...DERIVED_PAIR_ORDER].forEach((id) => {
      init[id] = emptyFormPair(id);
    });
    return init;
  });

  const [alert, setAlert] = useState<{ isOpen: boolean; message: string; type?: "error" | "success" }>({
    isOpen: false,
    message: "",
    type: "error",
  });

  useEffect(() => {
    if (!data) return;
    const next = {} as Record<ReferenceRatePairId, PairFormState>;
    CONFIG_PAIR_ORDER.forEach((id) => {
      const p = data.pairs[id];
      next[id] = responsePairToForm(id, {
        baseMode: p?.baseMode ?? "average",
        averageBase: p?.averageBase ?? null,
        baseBuy: p?.baseBuy ?? null,
        baseSell: p?.baseSell ?? null,
        markup: p?.markup ?? 0,
        markdown: p?.markdown ?? 0,
        displayDecimals: p?.displayDecimals,
      });
    });
    const derivedPairs = responseDerivedFormPairs(data);
    DERIVED_PAIR_ORDER.forEach((id) => {
      const derivedId = id as DerivedPairId;
      const p = derivedPairs[derivedId] ?? data.pairs[derivedId];
      next[id] = responsePairToForm(id, {
        baseMode: "derived",
        averageBase: p?.averageBase ?? null,
        baseBuy: null,
        baseSell: null,
        markup: p?.markup ?? 0,
        markdown: p?.markdown ?? 0,
        displayDecimals: p?.displayDecimals,
      });
    });
    setForm(next);
    setPkrSwiftFactor(String(data.pkrSwiftFactor ?? 1.01));
  }, [data]);

  const payloadPairs = useMemo(() => {
    const pairs: ReferenceRatesUpdatePayload["pairs"] = {};
    [...CONFIG_PAIR_ORDER, ...DERIVED_PAIR_ORDER].forEach((id) => {
      pairs[id] = formToPayloadPair(id, form[id]);
    });
    return pairs;
  }, [form]);

  const swiftFactorNum = Number(pkrSwiftFactor);
  const previewPairs = useMemo(
    () => buildPreviewFromForm(payloadPairs, Number.isFinite(swiftFactorNum) ? swiftFactorNum : 1.01),
    [payloadPairs, swiftFactorNum],
  );

  const previewResponse = useMemo(
    () => ({
      version: data?.version ?? 2,
      updatedAt: data?.updatedAt ?? null,
      pkrSwiftFactor: Number.isFinite(swiftFactorNum) ? swiftFactorNum : 1.01,
      pairs: previewPairs,
    }),
    [data, previewPairs, swiftFactorNum],
  );

  const derivedAutoBases = useMemo(
    () =>
      buildDerivedAutoBases(
        payloadPairs,
        Number.isFinite(swiftFactorNum) ? swiftFactorNum : 1.01,
      ),
    [payloadPairs, swiftFactorNum],
  );

  const setPairField = (id: ReferenceRatePairId, patch: Partial<PairFormState>) => {
    setForm((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    try {
      await updateRates({
        pairs: payloadPairs,
        pkrSwiftFactor: Number.isFinite(swiftFactorNum) ? swiftFactorNum : 1.01,
      }).unwrap();
      setAlert({ isOpen: true, message: t("referenceRates.saveSuccess"), type: "success" });
      refetch();
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "data" in err && (err as { data?: { message?: string } }).data?.message
          ? String((err as { data: { message: string } }).data.message)
          : t("referenceRates.saveError");
      setAlert({ isOpen: true, message, type: "error" });
    }
  };

  const handleSendToTelegram = async () => {
    if (!canEdit) return;
    try {
      await sendToTelegram().unwrap();
      setAlert({ isOpen: true, message: t("referenceRates.sendTelegramSuccess"), type: "success" });
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "data" in err && (err as { data?: { message?: string } }).data?.message
          ? String((err as { data: { message: string } }).data.message)
          : t("referenceRates.sendTelegramError");
      setAlert({ isOpen: true, message, type: "error" });
    }
  };

  if (isLoading && !data) {
    return (
      <div className="p-6">
        <p className="text-slate-500">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("referenceRates.pageTitle")}</h1>
      </div>

      <SectionCard title={t("referenceRates.previewTitle")}>
        <ReferenceRatesTable pairs={previewResponse.pairs} compact />
      </SectionCard>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("referenceRates.sectionPrimary")}</h2>
          <div className="space-y-6">
            {STANDALONE_PAIRS.map((id) => (
              <ReferenceRatesPairEditor
                key={id}
                pairId={id}
                form={form[id]}
                preview={previewPairs[id]}
                canEdit={canEdit}
                onChange={(patch) => setPairField(id, patch)}
              />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("referenceRates.sectionBenchmark")}</h2>
          <div className="space-y-6">
            {BENCHMARK_PAIRS.map((id) => (
              <ReferenceRatesPairEditor
                key={id}
                pairId={id}
                form={form[id]}
                preview={previewPairs[id]}
                canEdit={canEdit}
                onChange={(patch) => setPairField(id, patch)}
              />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("referenceRates.sectionChain")}</h2>
          <div className="space-y-6">
            {CHAIN_PAIRS.map((id) => (
              <ReferenceRatesPairEditor
                key={id}
                pairId={id}
                form={form[id]}
                preview={previewPairs[id]}
                canEdit={canEdit}
                onChange={(patch) => setPairField(id, patch)}
              />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">{t("referenceRates.sectionDerived")}</h2>
          <p className="mb-4 text-sm text-slate-600">{t("referenceRates.sectionDerivedDesc")}</p>
          <div className="space-y-6">
            {DERIVED_PAIR_ORDER.map((id) => (
              <ReferenceRatesPairEditor
                key={id}
                pairId={id}
                form={form[id]}
                preview={previewPairs[id]}
                derivedAutoBase={derivedAutoBases[id as DerivedPairId]}
                pkrSwiftFactor={id === "PKR_SWIFT" ? pkrSwiftFactor : undefined}
                onPkrSwiftFactorChange={id === "PKR_SWIFT" ? setPkrSwiftFactor : undefined}
                canEdit={canEdit}
                onChange={(patch) => setPairField(id, patch)}
              />
            ))}
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSaving || isSendingTelegram}
              className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              disabled={isSaving || isSendingTelegram}
              onClick={handleSendToTelegram}
              className="rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {isSendingTelegram ? t("referenceRates.sendingTelegram") : t("referenceRates.sendToTelegram")}
            </button>
            <p className="w-full text-sm text-slate-500">{t("referenceRates.sendTelegramHint")}</p>
          </div>
        ) : (
          <p className="text-sm text-amber-700">{t("referenceRates.readOnlyHint")}</p>
        )}
      </form>

      <AlertModal
        isOpen={alert.isOpen}
        message={alert.message}
        type={alert.type}
        onClose={() => setAlert({ isOpen: false, message: "" })}
      />
    </div>
  );
}
