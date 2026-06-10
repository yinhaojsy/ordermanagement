import { INTEGRATION_PROVIDERS } from "../services/integrations/registry.js";
import {
  listIntegrationConfigsMasked,
  getIntegrationConfig,
  saveIntegrationConfig,
  maskConfigForClient,
  formatConfigForAdmin,
} from "../services/integrations/integrationConfigStore.js";
import { testAmlConnection } from "../services/integrations/amlService.js";

export const listProviders = (_req, res) => {
  res.json({ providers: INTEGRATION_PROVIDERS });
};

export const listConfigs = (_req, res) => {
  const saved = listIntegrationConfigsMasked();
  const savedIds = new Set(saved.map((c) => c.providerId));
  const placeholders = INTEGRATION_PROVIDERS.filter((p) => !savedIds.has(p.id)).map((p) =>
    maskConfigForClient({ providerId: p.id, enabled: false, config: {}, secrets: {} }),
  );
  res.json({ configs: [...saved, ...placeholders] });
};

export const getConfig = (req, res, next) => {
  try {
    const { providerId } = req.params;
    const config = getIntegrationConfig(providerId, { includeSecrets: true });
    if (!config) {
      return res.json(
        formatConfigForAdmin({ providerId, enabled: false, config: {}, secrets: {} }),
      );
    }
    res.json(formatConfigForAdmin(config));
  } catch (error) {
    next(error);
  }
};

export const putConfig = (req, res, next) => {
  try {
    const { providerId } = req.params;
    const { enabled, config, secrets } = req.body || {};
    const saved = saveIntegrationConfig(providerId, {
      enabled: !!enabled,
      config: config || {},
      secrets: secrets || {},
      userId: req.user?.id,
    });
    res.json(saved);
  } catch (error) {
    if (error.message?.includes("required")) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
};

export const testProviderConnection = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    if (providerId !== "amlbot") {
      return res.status(400).json({ message: "Test connection not supported for this provider" });
    }
    const result = await testAmlConnection();
    res.json(result);
  } catch (error) {
    const status = error.statusCode;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: error.message });
    }
    if (status === 503) {
      return res.status(503).json({ message: error.message });
    }
    next(error);
  }
};
