import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import SectionCard from "../components/common/SectionCard";
import type { IntegrationFieldDef, IntegrationProviderDef } from "../types/integrations";
import {
  useGetIntegrationProvidersQuery,
  useGetIntegrationConfigsQuery,
  useSaveIntegrationConfigMutation,
  useTestIntegrationConnectionMutation,
} from "../services/api";

function buildDefaults(provider: IntegrationProviderDef) {
  const config: Record<string, string> = {};
  for (const field of provider.fields) {
    if (field.type === "password" || field.type === "boolean") continue;
    if (field.defaultValue !== undefined) config[field.key] = field.defaultValue;
  }
  return config;
}

function ProviderConfigureModal({
  provider,
  saved,
  onClose,
}: {
  provider: IntegrationProviderDef;
  saved?: { enabled: boolean; config: Record<string, unknown>; secretsMeta: Record<string, string | null> };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [config, setConfig] = useState<Record<string, string>>(() => ({
    ...buildDefaults(provider),
    ...(saved?.config as Record<string, string>),
  }));
  const [accessKey, setAccessKey] = useState("");
  const [saveConfig, { isLoading: isSaving }] = useSaveIntegrationConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const renderField = (field: IntegrationFieldDef) => {
    if (field.type === "boolean") {
      return (
        <label key={field.key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-slate-300"
          />
          {field.label}
        </label>
      );
    }

    if (field.type === "password") {
      const masked = saved?.secretsMeta?.[field.key];
      return (
        <div key={field.key}>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {field.label}
            {field.required ? <span className="text-rose-600"> *</span> : null}
          </label>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder={masked ? `${t("integrations.secretConfigured")} (${masked})` : field.placeholder}
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
          />
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.key}>
          <label className="mb-1 block text-sm font-medium text-slate-700">{field.label}</label>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={config[field.key] ?? field.defaultValue ?? ""}
            onChange={(e) => setConfig((p) => ({ ...p, [field.key]: e.target.value }))}
          >
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {field.label}
          {field.required ? <span className="text-rose-600"> *</span> : null}
        </label>
        <input
          type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder={field.placeholder}
          value={config[field.key] ?? ""}
          onChange={(e) => setConfig((p) => ({ ...p, [field.key]: e.target.value }))}
        />
        {field.helpText ? <p className="mt-1 text-xs text-slate-500">{field.helpText}</p> : null}
      </div>
    );
  };

  const handleSave = async () => {
    setMessage(null);
    try {
      const secrets: Record<string, string> = {};
      if (accessKey.trim()) secrets.accessKey = accessKey.trim();
      await saveConfig({
        providerId: provider.id,
        enabled,
        config,
        secrets,
      }).unwrap();
      setMessage({ text: t("integrations.saveSuccess"), type: "success" });
      setAccessKey("");
    } catch (err: any) {
      setMessage({ text: err?.data?.message || t("integrations.saveError"), type: "error" });
    }
  };

  const handleTest = async () => {
    setMessage(null);
    try {
      await saveConfig({
        providerId: provider.id,
        enabled,
        config,
        secrets: accessKey.trim() ? { accessKey: accessKey.trim() } : {},
      }).unwrap();
      const result = await testConnection(provider.id).unwrap();
      setMessage({ text: result.message || t("integrations.testSuccess"), type: "success" });
    } catch (err: any) {
      setMessage({ text: err?.data?.message || t("integrations.testError"), type: "error" });
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{provider.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{provider.description}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {provider.capabilities.map((cap) => (
            <span key={cap} className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              {cap}
            </span>
          ))}
        </div>

        <div className="grid gap-4">
          {provider.fields.map(renderField)}
        </div>

        {message ? (
          <p className={`mt-4 text-sm ${message.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
            {message.text}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-auto text-sm text-blue-600 hover:underline"
          >
            {t("integrations.viewDocs")}
          </a>
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || isSaving}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {isTesting ? t("common.loading") : t("integrations.testConnection")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSaving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { t } = useTranslation();
  const { data: providersData } = useGetIntegrationProvidersQuery();
  const { data: configsData } = useGetIntegrationConfigsQuery();
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);

  const configsById = useMemo(() => {
    const map: Record<string, NonNullable<typeof configsData>["configs"][number]> = {};
    for (const c of configsData?.configs || []) map[c.providerId] = c;
    return map;
  }, [configsData]);

  const activeProvider = providersData?.providers.find((p) => p.id === activeProviderId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <Link to="/settings" className="text-blue-600 hover:underline">
          {t("nav.settings")}
        </Link>
        <span>/</span>
        <span>{t("integrations.title")}</span>
      </div>

      <SectionCard title={t("integrations.title")} description={t("integrations.description")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(providersData?.providers || []).map((provider) => {
            const saved = configsById[provider.id];
            return (
              <div
                key={provider.id}
                className="rounded-xl border border-slate-200 p-4 shadow-sm hover:border-slate-300"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">{provider.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      saved?.enabled
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {saved?.enabled ? t("integrations.enabled") : t("integrations.disabled")}
                  </span>
                </div>
                <p className="mb-3 text-sm text-slate-500">{provider.description}</p>
                <p className="mb-4 text-xs text-slate-400">
                  {t("integrations.usedBy")}: {provider.usedBy.join(", ")}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveProviderId(provider.id)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  {t("integrations.configure")}
                </button>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {activeProvider ? (
        <ProviderConfigureModal
          provider={activeProvider}
          saved={configsById[activeProvider.id]}
          onClose={() => setActiveProviderId(null)}
        />
      ) : null}
    </div>
  );
}
