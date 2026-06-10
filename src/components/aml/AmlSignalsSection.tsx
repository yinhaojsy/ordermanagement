import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AmlSignal } from "../../types/integrations";

type SignalTab = "overall" | "in" | "out";

function SignalBars({ signals }: { signals: AmlSignal[] }) {
  const { t } = useTranslation();

  if (signals.length === 0) {
    return <p className="text-sm text-slate-500">{t("aml.noSignals")}</p>;
  }

  return (
    <div className="space-y-2">
      {signals.map((signal) => (
        <div key={signal.key}>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>{signal.label}</span>
            <span>{signal.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.min(signal.percent, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AmlSignalsSection({
  aggregate,
  signalsIn,
  signalsOut,
  showDirectional,
  defaultTab = "overall",
}: {
  aggregate: AmlSignal[];
  signalsIn: AmlSignal[];
  signalsOut: AmlSignal[];
  showDirectional: boolean;
  defaultTab?: SignalTab;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SignalTab>(defaultTab);

  const hasDirectional = showDirectional && (signalsIn.length > 0 || signalsOut.length > 0);

  const activeSignals =
    tab === "in" ? signalsIn : tab === "out" ? signalsOut : aggregate;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{t("aml.signalsTitle")}</h3>
        {hasDirectional ? (
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {(["overall", "in", "out"] as SignalTab[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-2.5 py-1 font-semibold ${
                  tab === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t(`aml.signalsTab.${key}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <SignalBars signals={activeSignals} />
    </div>
  );
}
