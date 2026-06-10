import { db } from "../../db.js";
import { getProviderDef, INTEGRATION_PROVIDERS } from "./registry.js";

const SECRET_KEYS = new Set(["accessKey"]);

function envFallbackConfig(providerId) {
  if (providerId !== "amlbot") return null;
  const accessId = process.env.AMLBOT_ACCESS_ID?.trim();
  const accessKey = process.env.AMLBOT_ACCESS_KEY?.trim();
  if (!accessId || !accessKey) return null;
  return {
    providerId: "amlbot",
    enabled: process.env.AMLBOT_ENABLED === "true",
    config: {
      accessId,
      apiUrl: (process.env.AMLBOT_API_URL || "https://extrnlapiendpoint.silencatech.com").replace(/\/$/, ""),
      defaultFlow: process.env.AMLBOT_DEFAULT_FLOW || "fast",
      riskThresholdPercent: Number(process.env.AMLBOT_RISK_THRESHOLD_PERCENT || 50),
      requestTimeoutMs: Number(process.env.AMLBOT_REQUEST_TIMEOUT_MS || 15000),
    },
    secrets: { accessKey },
    source: "env",
  };
}

function parseRow(row) {
  if (!row) return null;
  let config = {};
  let secrets = {};
  try {
    config = JSON.parse(row.configJson || "{}");
  } catch {
    config = {};
  }
  try {
    secrets = JSON.parse(row.secretsJson || "{}");
  } catch {
    secrets = {};
  }
  return {
    providerId: row.providerId,
    enabled: row.enabled === 1,
    config,
    secrets,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
    source: "db",
  };
}

export function listIntegrationConfigsMasked() {
  const rows = db.prepare("SELECT * FROM integration_configs ORDER BY providerId").all();
  const byId = new Map(rows.map((r) => [r.providerId, parseRow(r)]));

  return INTEGRATION_PROVIDERS.map((def) => {
    const saved = byId.get(def.id);
    return maskConfigForClient(
      saved || { providerId: def.id, enabled: false, config: {}, secrets: {} },
    );
  });
}

function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function maskConfigForClient(record) {
  if (!record) return null;
  const def = getProviderDef(record.providerId);
  const config = { ...record.config };
  const secretsMeta = {};
  for (const field of def?.fields || []) {
    if (field.type === "password") {
      const val = record.secrets?.[field.key];
      secretsMeta[field.key] = val ? maskSecret(val) : null;
      delete config[field.key];
    }
  }
  return {
    providerId: record.providerId,
    enabled: !!record.enabled,
    config,
    secretsMeta,
    hasSecrets: Object.values(secretsMeta).some(Boolean),
    updatedAt: record.updatedAt || null,
    source: record.source || "db",
  };
}

export function getIntegrationConfig(providerId, { includeSecrets = false } = {}) {
  const row = db.prepare("SELECT * FROM integration_configs WHERE providerId = ?").get(providerId);
  const fromDb = parseRow(row);
  if (fromDb) {
    return includeSecrets ? fromDb : maskConfigForClient(fromDb);
  }
  const envCfg = envFallbackConfig(providerId);
  if (!envCfg) return null;
  return includeSecrets ? envCfg : maskConfigForClient(envCfg);
}

export function getActiveAmlCredentials() {
  const full = getFullCredentials("amlbot");
  if (!full || !full.enabled) return null;
  const { accessId, accessKey, apiUrl, defaultFlow, requestTimeoutMs, riskThresholdPercent } = full;
  if (!accessId || !accessKey || !apiUrl) return null;
  return {
    providerId: "amlbot",
    accessId,
    accessKey,
    apiUrl: apiUrl.replace(/\/$/, ""),
    defaultFlow: defaultFlow || "fast",
    requestTimeoutMs: Number(requestTimeoutMs) || 15000,
    riskThresholdPercent: Number(riskThresholdPercent) || 50,
  };
}

function getFullCredentials(providerId) {
  const row = db.prepare("SELECT * FROM integration_configs WHERE providerId = ?").get(providerId);
  const fromDb = parseRow(row);
  if (fromDb) {
    return {
      enabled: fromDb.enabled,
      accessId: fromDb.config.accessId?.trim(),
      accessKey: fromDb.secrets.accessKey?.trim(),
      apiUrl: (fromDb.config.apiUrl || "https://extrnlapiendpoint.silencatech.com").replace(/\/$/, ""),
      defaultFlow: fromDb.config.defaultFlow || "fast",
      requestTimeoutMs: fromDb.config.requestTimeoutMs || 15000,
      riskThresholdPercent: fromDb.config.riskThresholdPercent ?? 50,
    };
  }
  const env = envFallbackConfig(providerId);
  if (!env) return null;
  return {
    enabled: env.enabled,
    accessId: env.config.accessId,
    accessKey: env.secrets.accessKey,
    apiUrl: env.config.apiUrl,
    defaultFlow: env.config.defaultFlow,
    requestTimeoutMs: env.config.requestTimeoutMs,
    riskThresholdPercent: env.config.riskThresholdPercent,
  };
}

export function saveIntegrationConfig(providerId, { enabled, config, secrets, userId }) {
  const def = getProviderDef(providerId);
  if (!def) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const existing = db.prepare("SELECT * FROM integration_configs WHERE providerId = ?").get(providerId);
  let existingSecrets = {};
  if (existing) {
    try {
      existingSecrets = JSON.parse(existing.secretsJson || "{}");
    } catch {
      existingSecrets = {};
    }
  }

  const mergedConfig = { ...(existing ? JSON.parse(existing.configJson || "{}") : {}) };
  const mergedSecrets = { ...existingSecrets };

  for (const field of def.fields) {
    if (field.type === "password") continue;
    if (config && Object.prototype.hasOwnProperty.call(config, field.key)) {
      mergedConfig[field.key] = config[field.key];
    } else if (!existing && field.defaultValue !== undefined) {
      mergedConfig[field.key] = field.defaultValue;
    }
  }

  if (config?.accessId !== undefined) mergedConfig.accessId = String(config.accessId).trim();
  if (config?.apiUrl !== undefined) mergedConfig.apiUrl = String(config.apiUrl).trim().replace(/\/$/, "");

  if (secrets) {
    for (const [key, value] of Object.entries(secrets)) {
      if (!SECRET_KEYS.has(key)) continue;
      if (value === undefined || value === null || value === "") continue;
      mergedSecrets[key] = String(value).trim();
    }
  }

  if (!mergedConfig.accessId) {
    throw new Error("Access ID is required");
  }
  if (!mergedSecrets.accessKey && !existingSecrets.accessKey) {
    const env = envFallbackConfig(providerId);
    if (env?.secrets?.accessKey) {
      mergedSecrets.accessKey = env.secrets.accessKey;
    } else {
      throw new Error("Access Key is required");
    }
  }

  const now = new Date().toISOString();
  const enabledInt = enabled ? 1 : 0;

  if (existing) {
    db.prepare(
      `UPDATE integration_configs
       SET enabled = @enabled, configJson = @configJson, secretsJson = @secretsJson,
           updatedAt = @updatedAt, updatedByUserId = @updatedByUserId
       WHERE providerId = @providerId`,
    ).run({
      providerId,
      enabled: enabledInt,
      configJson: JSON.stringify(mergedConfig),
      secretsJson: JSON.stringify(mergedSecrets),
      updatedAt: now,
      updatedByUserId: userId || null,
    });
  } else {
    db.prepare(
      `INSERT INTO integration_configs (providerId, enabled, configJson, secretsJson, updatedAt, updatedByUserId)
       VALUES (@providerId, @enabled, @configJson, @secretsJson, @updatedAt, @updatedByUserId)`,
    ).run({
      providerId,
      enabled: enabledInt,
      configJson: JSON.stringify(mergedConfig),
      secretsJson: JSON.stringify(mergedSecrets),
      updatedAt: now,
      updatedByUserId: userId || null,
    });
  }

  return maskConfigForClient(parseRow(db.prepare("SELECT * FROM integration_configs WHERE providerId = ?").get(providerId)));
}

export function isAmlIntegrationEnabled() {
  return !!getActiveAmlCredentials();
}
