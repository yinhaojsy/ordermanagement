import { db } from "../db.js";
import { mapWalletRow } from "../utils/mapWalletRow.js";
import {
  checkWalletAddress,
  investigateWalletAddress,
  checkWalletTransaction,
  recheckById,
  recheckByUid,
  getWalletAmlHistory,
  getWalletAddressAmlReports,
  getGlobalAmlHistory,
  getWalletAmlSummaries,
  getTransactionAmlSummaries,
  getCheckById,
  getCheckDetailById,
} from "../services/integrations/amlService.js";
import { isAmlIntegrationEnabled as isEnabled } from "../services/integrations/integrationConfigStore.js";

export const getAmlStatus = (_req, res) => {
  res.json({ enabled: isEnabled() });
};

export const getWalletAmlSummariesHandler = (_req, res) => {
  res.json({ summaries: getWalletAmlSummaries() });
};

export const getWalletAmlSummary = (req, res) => {
  const summaries = getWalletAmlSummaries();
  res.json({ summary: summaries[Number(req.params.id)] || null });
};

export const getWalletTransactionAmlSummaries = (req, res) => {
  res.json({ summaries: getTransactionAmlSummaries(Number(req.params.id)) });
};

export const postCheckAddress = async (req, res, next) => {
  try {
    const walletId = Number(req.params.id);
    const { flow } = req.body || {};
    const check = await checkWalletAddress(walletId, { userId: req.user?.id, flow });
    res.status(201).json({ check });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

export const postInvestigateAddress = async (req, res, next) => {
  try {
    const walletId = Number(req.params.id);
    const check = await investigateWalletAddress(walletId, { userId: req.user?.id });
    res.status(201).json({ check });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

export const postCheckTransaction = async (req, res, next) => {
  try {
    const walletId = Number(req.params.id);
    const transactionId = Number(req.params.txId);
    const { flow } = req.body || {};
    const check = await checkWalletTransaction(walletId, transactionId, {
      userId: req.user?.id,
      flow,
    });
    res.status(201).json({ check });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

export const postRecheck = async (req, res, next) => {
  try {
    const { uid, checkId } = req.body || {};
    let check;
    if (checkId) {
      check = await recheckById(Number(checkId), { userId: req.user?.id });
    } else if (uid) {
      check = await recheckByUid(uid, { userId: req.user?.id });
    } else {
      return res.status(400).json({ message: "checkId or uid is required" });
    }
    res.json({ check });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

export const getWalletHistory = (req, res) => {
  const walletId = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ history: getWalletAmlHistory(walletId, { limit }) });
};

export const getWalletAddressAmlReportsHandler = (req, res) => {
  const walletId = Number(req.params.id);
  res.json(getWalletAddressAmlReports(walletId));
};

export const getAmlHistory = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const result = await getGlobalAmlHistory({ page });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
};

export const getAmlCheck = (req, res) => {
  const detail = getCheckDetailById(Number(req.params.checkId));
  if (!detail) return res.status(404).json({ message: "Check not found" });
  res.json(detail);
};

export const patchWalletAmlAutoScreenTx = (req, res, next) => {
  try {
    const walletId = Number(req.params.id);
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled (boolean) is required" });
    }
    const existing = db.prepare("SELECT id FROM tron_wallets WHERE id = ?").get(walletId);
    if (!existing) return res.status(404).json({ message: "Wallet not found" });
    db.prepare(
      "UPDATE tron_wallets SET amlAutoScreenTx = ?, updatedAt = ? WHERE id = ?",
    ).run(enabled ? 1 : 0, new Date().toISOString(), walletId);
    const wallet = mapWalletRow(db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(walletId));
    res.json({ wallet });
  } catch (error) {
    next(error);
  }
};
