/**
 * Integration provider catalog — defines required fields per supplier.
 * Add new providers here; Integrations UI renders from this registry.
 */

export const INTEGRATION_PROVIDERS = [
  {
    id: "amlbot",
    name: "AMLBot",
    category: "aml",
    description: "Crypto wallet and transaction AML screening (TRON / multi-chain).",
    docsUrl: "https://docs.amlbot.com/webApi/introduction",
    usedBy: ["walletTracker"],
    capabilities: [
      "addressVerification",
      "addressInvestigation",
      "transactionVerification",
      "recheck",
      "history",
    ],
    fields: [
      {
        key: "enabled",
        label: "Enabled",
        type: "boolean",
        required: false,
        defaultValue: "false",
      },
      {
        key: "accessId",
        label: "Access ID",
        type: "text",
        required: true,
        placeholder: "From web.amlbot.com → Profile → API Keys",
      },
      {
        key: "accessKey",
        label: "Access Key",
        type: "password",
        required: true,
        placeholder: "Secret key for MD5 token signing",
      },
      {
        key: "apiUrl",
        label: "Access Point",
        type: "url",
        required: true,
        defaultValue: "https://extrnlapiendpoint.silencatech.com",
        helpText: "Base URL from AMLBot Web API docs",
      },
      {
        key: "defaultFlow",
        label: "Default flow",
        type: "select",
        required: false,
        defaultValue: "fast",
        options: [
          { value: "fast", label: "Fast" },
          { value: "advanced", label: "Advanced (full report)" },
        ],
      },
      {
        key: "riskThresholdPercent",
        label: "Warning threshold (%)",
        type: "number",
        required: false,
        defaultValue: "50",
        helpText: "Wallet Tracker shows a high-risk badge at or above this score",
      },
      {
        key: "requestTimeoutMs",
        label: "Request timeout (ms)",
        type: "number",
        required: false,
        defaultValue: "15000",
      },
    ],
  },
];

export function getProviderDef(providerId) {
  return INTEGRATION_PROVIDERS.find((p) => p.id === providerId) || null;
}
