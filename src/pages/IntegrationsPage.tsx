import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import SectionCard from "../components/common/SectionCard";
import type { IntegrationFieldDef, IntegrationProviderDef } from "../types/integrations";
import {
  useGetIntegrationProvidersQuery,
  useGetIntegrationConfigsQuery,
  useGetIntegrationConfigQuery,
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

function CopyIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CopyableTextFieldInput({
  label,
  required,
  value,
  onChange,
  placeholder,
  inputType = "text",
  helpText,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputType?: "text" | "url" | "number";
  helpText?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      <div className="relative">
        <input
          type={inputType}
          className="w-full rounded-lg border border-slate-200 py-2 pl-3 pr-10 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            title={copied ? t("integrations.copiedToClipboard") : t("integrations.copyValue")}
            aria-label={t("integrations.copyValue")}
          >
            <CopyIcon />
          </button>
        </div>
      </div>
      {copied ? <p className="mt-1 text-xs text-emerald-600">{t("integrations.copiedToClipboard")}</p> : null}
      {helpText ? <p className="mt-1 text-xs text-slate-500">{helpText}</p> : null}
    </div>
  );
}

function SecretFieldInput({
  label,
  required,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          className="w-full rounded-lg border border-slate-200 py-2 pl-3 pr-20 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2">
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title={visible ? t("integrations.hideAccessKey") : t("integrations.showAccessKey")}
            aria-label={visible ? t("integrations.hideAccessKey") : t("integrations.showAccessKey")}
          >
            {visible ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            title={copied ? t("integrations.copiedToClipboard") : t("integrations.copyValue")}
            aria-label={t("integrations.copyValue")}
          >
            <CopyIcon />
          </button>
        </div>
      </div>
      {copied ? <p className="mt-1 text-xs text-emerald-600">{t("integrations.copiedToClipboard")}</p> : null}
    </div>
  );
}

function ProviderConfigureModal({
  provider,
  onClose,
}: {
  provider: IntegrationProviderDef;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: savedConfig, isLoading: isLoadingConfig } = useGetIntegrationConfigQuery(provider.id);
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>(() => buildDefaults(provider));
  const [accessKey, setAccessKey] = useState("");
  const [saveConfig, { isLoading: isSaving }] = useSaveIntegrationConfigMutation();
  const [testConnection, { isLoading: isTesting }] = useTestIntegrationConnectionMutation();
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!savedConfig) return;
    setEnabled(savedConfig.enabled);
    setConfig({
      ...buildDefaults(provider),
      ...(savedConfig.config as Record<string, string>),
    });
    setAccessKey(savedConfig.secrets?.accessKey ?? "");
  }, [savedConfig, provider]);

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
      return (
        <SecretFieldInput
          key={field.key}
          label={field.label}
          required={field.required}
          value={accessKey}
          onChange={setAccessKey}
          placeholder={field.placeholder}
        />
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

    if (field.type === "text" || field.type === "url") {
      return (
        <CopyableTextFieldInput
          key={field.key}
          label={field.label}
          required={field.required}
          value={config[field.key] ?? ""}
          onChange={(value) => setConfig((p) => ({ ...p, [field.key]: value }))}
          placeholder={field.placeholder}
          inputType={field.type === "url" ? "url" : "text"}
          helpText={field.helpText}
        />
      );
    }

    return (
      <div key={field.key}>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          {field.label}
          {field.required ? <span className="text-rose-600"> *</span> : null}
        </label>
        <input
          type={field.type === "number" ? "number" : "text"}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder={field.placeholder}
          value={config[field.key] ?? ""}
          onChange={(e) => setConfig((p) => ({ ...p, [field.key]: e.target.value }))}
        />
        {field.helpText ? <p className="mt-1 text-xs text-slate-500">{field.helpText}</p> : null}
      </div>
    );
  };

  const buildSecrets = () => {
    const secrets: Record<string, string> = {};
    if (accessKey.trim()) secrets.accessKey = accessKey.trim();
    return secrets;
  };

  const handleSave = async () => {
    setMessage(null);
    try {
      const result = await saveConfig({
        providerId: provider.id,
        enabled,
        config,
        secrets: buildSecrets(),
      }).unwrap();
      if (result.secrets?.accessKey) setAccessKey(result.secrets.accessKey);
      setMessage({ text: t("integrations.saveSuccess"), type: "success" });
    } catch (err: any) {
      setMessage({ text: err?.data?.message || t("integrations.saveError"), type: "error" });
    }
  };

  const handleTest = async () => {
    setMessage(null);
    try {
      const result = await saveConfig({
        providerId: provider.id,
        enabled,
        config,
        secrets: buildSecrets(),
      }).unwrap();
      if (result.secrets?.accessKey) setAccessKey(result.secrets.accessKey);
      const testResult = await testConnection(provider.id).unwrap();
      setMessage({ text: testResult.message || t("integrations.testSuccess"), type: "success" });
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

        {isLoadingConfig ? (
          <p className="py-8 text-center text-sm text-slate-500">{t("common.loading")}</p>
        ) : (
          <div className="grid gap-4">{provider.fields.map(renderField)}</div>
        )}

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
            disabled={isTesting || isSaving || isLoadingConfig}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {isTesting ? t("common.loading") : t("integrations.testConnection")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoadingConfig}
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
        <ProviderConfigureModal provider={activeProvider} onClose={() => setActiveProviderId(null)} />
      ) : null}
    </div>
  );
}
