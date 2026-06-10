import { db } from "../../db.js";
import { getActiveAmlCredentials, getAmlbotCredentialsForTest } from "./integrationConfigStore.js";
import * as amlbot from "./amlbotAdapter.js";

const SIGNAL_LABELS = {
  exchange: "Exchange",
  payment: "Payment service",
  dark_market: "Dark market",
  dark_service: "Dark service",
  mixer: "Mixer",
  sanctions: "Sanctions",
  scam: "Scam",
  stolen_coins: "Stolen coins",
  ransom: "Ransom",
  terrorism_financing: "Terrorism financing",
  gambling: "Gambling",
  illegal_service: "Illegal service",
  exchange_fraudulent: "Fraudulent exchange",
};

function toRiskPercent(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const n = Number(score);
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function toRiskLevel(percent, blacklisted, status) {
  if (status === "pending" || percent == null) return "pending";
  if (blacklisted) return "severe";
  if (percent === 0) return "none";
  if (percent <= 20) return "low";
  if (percent <= 50) return "medium";
  if (percent <= 79) return "high";
  return "severe";
}

function parseSignals(data) {
  const raw = data?.signals || data?.risk_signals || data?.counterparty?.signals;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .map(([key, value]) => ({
      key,
      label: SIGNAL_LABELS[key] || key.replace(/_/g, " "),
      percent: toRiskPercent(value) ?? 0,
    }))
    .filter((s) => s.percent > 0)
    .sort((a, b) => b.percent - a.percent);
}

function normalizeAmlResponse(apiResponse, checkType) {
  const data = apiResponse?.data || {};
  const status = (data.status || "pending").toLowerCase();
  const riskPercent = toRiskPercent(data.riskscore ?? data.risk_score ?? data.riskScore);
  const isBlacklisted = !!(data.blacklist ?? data.is_blacklisted ?? data.counterparty?.is_blacklisted);
  const riskLevel = toRiskLevel(riskPercent, isBlacklisted, status);

  return {
    externalUid: data.uid || data.UID || null,
    status,
    riskPercent,
    riskLevel,
    isBlacklisted,
    signals: parseSignals(data),
    addressOrHash: data.hash || data.address || null,
    asset: data.asset || "TRX",
    flow: data.flow || null,
    raw: data,
    checkType,
    isPending: status === "pending" || status === "new" || (riskPercent == null && status !== "failed"),
  };
}

function persistCheck({
  walletId,
  transactionId,
  providerId,
  checkType,
  normalized,
  rawResponse,
  userId,
}) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO aml_checks
       (walletId, transactionId, providerId, checkType, externalUid, status, riskPercent, riskLevel,
        isBlacklisted, signalsJson, rawResponseJson, createdAt, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      walletId,
      transactionId || null,
      providerId,
      checkType,
      normalized.externalUid,
      normalized.status,
      normalized.riskPercent,
      normalized.riskLevel,
      normalized.isBlacklisted ? 1 : 0,
      JSON.stringify(normalized.signals),
      JSON.stringify(rawResponse),
      now,
      userId || null,
    );

  return getCheckById(result.lastInsertRowid);
}

function updateCheckRow(id, normalized, rawResponse) {
  db.prepare(
    `UPDATE aml_checks
     SET status = ?, riskPercent = ?, riskLevel = ?, isBlacklisted = ?,
         signalsJson = ?, rawResponseJson = ?, externalUid = COALESCE(?, externalUid)
     WHERE id = ?`,
  ).run(
    normalized.status,
    normalized.riskPercent,
    normalized.riskLevel,
    normalized.isBlacklisted ? 1 : 0,
    JSON.stringify(normalized.signals),
    JSON.stringify(rawResponse),
    normalized.externalUid,
    id,
  );
  return getCheckById(id);
}

export function getCheckById(id) {
  const row = db.prepare("SELECT * FROM aml_checks WHERE id = ?").get(id);
  return row ? formatCheckRow(row) : null;
}

export function getCheckDetailById(id) {
  const row = db.prepare("SELECT * FROM aml_checks WHERE id = ?").get(id);
  return row ? formatCheckDetail(row) : null;
}

export function formatCheckRow(row) {
  let signals = [];
  try {
    signals = JSON.parse(row.signalsJson || "[]");
  } catch {
    signals = [];
  }
  if (!Array.isArray(signals)) {
    signals = [];
  }
  return {
    id: row.id,
    walletId: row.walletId,
    transactionId: row.transactionId,
    providerId: row.providerId,
    checkType: row.checkType,
    externalUid: row.externalUid,
    status: row.status,
    riskPercent: row.riskPercent,
    riskLevel: row.riskLevel,
    isBlacklisted: row.isBlacklisted === 1,
    signals,
    createdAt: row.createdAt,
    isPending: row.status === "pending" || row.status === "new",
  };
}

export function formatCheckDetail(row) {
  let rawResponse = null;
  try {
    rawResponse = JSON.parse(row.rawResponseJson || "null");
  } catch {
    rawResponse = null;
  }
  return {
    check: formatCheckRow(row),
    rawResponse,
  };
}

function requireCredentials() {
  const creds = getActiveAmlCredentials();
  if (!creds) {
    const err = new Error("AML integration is not configured or disabled");
    err.statusCode = 503;
    throw err;
  }
  return creds;
}

async function runAndStore({ walletId, transactionId, checkType, apiCall, userId }) {
  const creds = requireCredentials();
  const raw = await apiCall(creds);
  const normalized = normalizeAmlResponse(raw, checkType);
  return persistCheck({
    walletId,
    transactionId,
    providerId: creds.providerId,
    checkType,
    normalized,
    rawResponse: raw,
    userId,
  });
}

export async function checkWalletAddress(walletId, { userId, flow } = {}) {
  const wallet = db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(walletId);
  if (!wallet) throw Object.assign(new Error("Wallet not found"), { statusCode: 404 });
  return runAndStore({
    walletId,
    checkType: "address",
    apiCall: (c) => amlbot.amlbotCheckAddress(c, { address: wallet.walletAddress, flow }),
    userId,
  });
}

export async function investigateWalletAddress(walletId, { userId } = {}) {
  const wallet = db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(walletId);
  if (!wallet) throw Object.assign(new Error("Wallet not found"), { statusCode: 404 });
  return runAndStore({
    walletId,
    checkType: "address_investigation",
    apiCall: (c) => amlbot.amlbotInvestigateAddress(c, { address: wallet.walletAddress }),
    userId,
  });
}

export async function checkWalletTransaction(walletId, transactionId, { userId, flow } = {}) {
  const wallet = db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(walletId);
  if (!wallet) throw Object.assign(new Error("Wallet not found"), { statusCode: 404 });

  const tx = db
    .prepare("SELECT * FROM tron_wallet_transactions WHERE id = ? AND walletId = ?")
    .get(transactionId, walletId);
  if (!tx) throw Object.assign(new Error("Transaction not found"), { statusCode: 404 });

  return runAndStore({
    walletId,
    transactionId,
    checkType: "transaction",
    apiCall: (c) =>
      amlbot.amlbotCheckTransaction(c, {
        hash: tx.transactionHash,
        address: tx.toAddress,
        direction: tx.transactionType,
        flow,
      }),
    userId,
  });
}

export async function recheckByUid(uid, { userId, walletId } = {}) {
  const creds = requireCredentials();
  const raw = await amlbot.amlbotRecheck(creds, { uid });
  const normalized = normalizeAmlResponse(raw, "recheck");

  const existing = db
    .prepare("SELECT * FROM aml_checks WHERE externalUid = ? ORDER BY id DESC LIMIT 1")
    .get(uid);

  if (existing) {
    return updateCheckRow(existing.id, normalized, raw);
  }

  if (!walletId) {
    throw Object.assign(new Error("walletId is required to persist a new recheck"), { statusCode: 400 });
  }

  return persistCheck({
    walletId,
    checkType: "address",
    normalized,
    rawResponse: raw,
    userId,
    providerId: creds.providerId,
  });
}

export async function recheckById(checkId, { userId } = {}) {
  const row = db.prepare("SELECT * FROM aml_checks WHERE id = ?").get(checkId);
  if (!row?.externalUid) throw Object.assign(new Error("Check not found or missing UID"), { statusCode: 404 });
  return recheckByUid(row.externalUid, { userId, walletId: row.walletId });
}

export async function getWalletAmlHistory(walletId, { limit = 50 } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM aml_checks WHERE walletId = ? ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(walletId, limit);
  return rows.map(formatCheckRow);
}

export async function getGlobalAmlHistory({ page = 1, pageSize = 20 } = {}) {
  const creds = requireCredentials();
  const raw = await amlbot.amlbotHistory(creds, { page });
  return raw;
}

export function getWalletAmlSummaries() {
  const rows = db
    .prepare(
      `SELECT ac.*
       FROM aml_checks ac
       INNER JOIN (
         SELECT walletId, MAX(id) AS maxId
         FROM aml_checks
         WHERE checkType IN ('address', 'address_investigation') AND transactionId IS NULL
         GROUP BY walletId
       ) latest ON ac.id = latest.maxId`,
    )
    .all();
  const map = {};
  for (const row of rows) {
    map[row.walletId] = formatCheckRow(row);
  }
  return map;
}

export function getTransactionAmlSummaries(walletId) {
  const rows = db
    .prepare(
      `SELECT ac.*
       FROM aml_checks ac
       INNER JOIN (
         SELECT transactionId, MAX(id) AS maxId
         FROM aml_checks
         WHERE walletId = ? AND transactionId IS NOT NULL
         GROUP BY transactionId
       ) latest ON ac.id = latest.maxId`,
    )
    .all(walletId);
  const map = {};
  for (const row of rows) {
    if (row.transactionId) map[row.transactionId] = formatCheckRow(row);
  }
  return map;
}

export function hasAddressCheck(walletId) {
  const row = db
    .prepare(
      `SELECT 1 FROM aml_checks WHERE walletId = ? AND checkType = 'address' AND transactionId IS NULL LIMIT 1`,
    )
    .get(walletId);
  return !!row;
}

export function hasTransactionCheck(transactionId) {
  const row = db
    .prepare(`SELECT 1 FROM aml_checks WHERE transactionId = ? LIMIT 1`)
    .get(transactionId);
  return !!row;
}

export async function autoScreenNewWallet(walletId, userId) {
  if (!getActiveAmlCredentials()) return null;
  if (hasAddressCheck(walletId)) return null;
  try {
    return await checkWalletAddress(walletId, { userId });
  } catch (err) {
    console.error(`AML auto-screen wallet ${walletId} failed:`, err.message);
    return null;
  }
}

export async function autoScreenNewTransaction(walletId, transactionId, userId) {
  if (!getActiveAmlCredentials()) return null;
  const wallet = db.prepare("SELECT amlAutoScreenTx FROM tron_wallets WHERE id = ?").get(walletId);
  if (!wallet || wallet.amlAutoScreenTx === 0) return null;
  if (hasTransactionCheck(transactionId)) return null;
  try {
    return await checkWalletTransaction(walletId, transactionId, { userId });
  } catch (err) {
    console.error(`AML auto-screen tx ${transactionId} failed:`, err.message);
    return null;
  }
}

export async function testAmlConnection() {
  const creds = getAmlbotCredentialsForTest();
  if (!creds) {
    throw Object.assign(
      new Error("AMLBot Access ID and Access Key are required. Save credentials first."),
      { statusCode: 400 },
    );
  }
  await amlbot.amlbotTestConnection(creds);
  return { ok: true, message: "AMLBot connection successful" };
}

export { SIGNAL_LABELS };
