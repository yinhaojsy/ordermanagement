import type { AmlCheck, AmlSignal } from "../types/integrations";

export type AmlReportVariant = "screen" | "investigate" | "transaction";

const SIGNAL_LABELS: Record<string, string> = {
  exchange: "Exchange",
  risky_exchange: "Risky exchange",
  p2p_exchange: "P2P exchange",
  p2p_exchange_mlrisk_high: "P2P exchange (high ML risk)",
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
  enforcement_action: "Enforcement action",
  other: "Other",
  wallet: "Wallet",
  unnamed_service: "Unnamed service",
  marketplace: "Marketplace",
  miner: "Miner",
  liquidity_pools: "Liquidity pools",
  merchant_services: "Merchant services",
  infrastructure_as_a_service: "Infrastructure as a service",
  decentralized_exchange_contract: "DEX contract",
  malware: "Malware",
  atm: "ATM",
  child_exploitation: "Child exploitation",
  seized_assets: "Seized assets",
};

const HIGH_RISK_TYPES = new Set([
  "sanctions",
  "scam",
  "stolen_coins",
  "illegal_service",
  "mixer",
  "dark_market",
  "dark_service",
  "ransom",
  "terrorism_financing",
  "exchange_fraudulent",
  "enforcement_action",
  "child_exploitation",
  "malware",
]);

function toRiskPercent(score: unknown): number | null {
  if (score == null || Number.isNaN(Number(score))) return null;
  const n = Number(score);
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] || key.replace(/_/g, " ");
}

function parseSignalObject(raw: unknown): AmlSignal[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => ({
      key,
      label: signalLabel(key),
      percent: toRiskPercent(value) ?? 0,
    }))
    .filter((s) => s.percent > 0)
    .sort((a, b) => b.percent - a.percent);
}

export function formatEntityType(type: string): string {
  return type.replace(/_/g, " ");
}

export function isHighRiskEntity(entity: {
  riskscore?: number | null;
  type?: string | null;
}): boolean {
  const risk = entity.riskscore;
  if (risk != null && (risk >= 0.75 || risk === 1)) return true;
  if (entity.type && HIGH_RISK_TYPES.has(entity.type)) return true;
  return false;
}

export interface AmlConnectionRow {
  id: string;
  entityName: string;
  entityType: string;
  entitySubtype: string | null;
  entityRiskPercent: number | null;
  receivedTotal: number | null;
  receivedDirect: number | null;
  receivedHops: number | null;
  sentTotal: number | null;
  sentDirect: number | null;
  sentHops: number | null;
  isHighRisk: boolean;
}

function parseCounterpartyConnection(
  conn: Record<string, unknown>,
  index: number,
): AmlConnectionRow {
  const entity = (conn.entity || {}) as Record<string, unknown>;
  const received = conn.received as Record<string, unknown> | null | undefined;
  const sent = conn.sent as Record<string, unknown> | null | undefined;
  const name = String(entity.name || "Unknown");
  return {
    id: `${entity.id ?? name}-${index}`,
    entityName: name,
    entityType: String(entity.type || "unknown"),
    entitySubtype: entity.subtype != null ? String(entity.subtype) : null,
    entityRiskPercent: toRiskPercent(entity.riskscore),
    receivedTotal: received?.total != null ? Number(received.total) : null,
    receivedDirect: received?.direct != null ? Number(received.direct) : null,
    receivedHops: received?.hops != null ? Number(received.hops) : null,
    sentTotal: sent?.total != null ? Number(sent.total) : null,
    sentDirect: sent?.direct != null ? Number(sent.direct) : null,
    sentHops: sent?.hops != null ? Number(sent.hops) : null,
    isHighRisk: isHighRiskEntity({
      riskscore: entity.riskscore as number | null,
      type: entity.type as string | null,
    }),
  };
}

function parseTxConnection(conn: Record<string, unknown>, index: number): AmlConnectionRow {
  const entity = (conn.entity || {}) as Record<string, unknown>;
  const received = conn.received as Record<string, unknown> | null | undefined;
  const name = String(entity.name || "Unknown");
  const total = conn.total != null ? Number(conn.total) : null;
  const hops = conn.hops != null ? Number(conn.hops) : null;
  const direct = conn.direct != null ? Number(conn.direct) : null;
  return {
    id: `tx-${entity.id ?? name}-${index}`,
    entityName: name,
    entityType: String(entity.type || "unknown"),
    entitySubtype: entity.subtype != null ? String(entity.subtype) : null,
    entityRiskPercent: toRiskPercent(entity.riskscore),
    receivedTotal: received?.total != null ? Number(received.total) : total,
    receivedDirect: received?.direct != null ? Number(received.direct) : direct,
    receivedHops: received?.hops != null ? Number(received.hops) : hops,
    sentTotal: null,
    sentDirect: null,
    sentHops: null,
    isHighRisk: isHighRiskEntity({
      riskscore: entity.riskscore as number | null,
      type: entity.type as string | null,
    }),
  };
}

function sortConnections(rows: AmlConnectionRow[]): AmlConnectionRow[] {
  return [...rows].sort((a, b) => {
    const riskA = a.entityRiskPercent ?? -1;
    const riskB = b.entityRiskPercent ?? -1;
    if (riskB !== riskA) return riskB - riskA;
    const volA = Math.max(a.receivedTotal ?? 0, a.sentTotal ?? 0);
    const volB = Math.max(b.receivedTotal ?? 0, b.sentTotal ?? 0);
    return volB - volA;
  });
}

function countDirectConnections(rows: AmlConnectionRow[]): number {
  return rows.filter(
    (r) => (r.receivedDirect ?? 0) > 0 || (r.sentDirect ?? 0) > 0,
  ).length;
}

export function formatFiatAmount(value: number | null | undefined, currency = "USD"): string {
  if (value == null || Number.isNaN(value)) return "—";
  const dollars = value / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatUsdVolume(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatTokenAmount(
  amount: number | null | undefined,
  precision: number,
  code: string,
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  const value = amount / 10 ** precision;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: precision }).format(value)} ${code}`;
}

function formatUnixTimestamp(ts: unknown): string | undefined {
  if (ts == null) return undefined;
  const n = Number(ts);
  if (Number.isNaN(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString();
}

export function getReportVariant(checkType: AmlCheck["checkType"], flow?: string | null): AmlReportVariant {
  if (checkType === "transaction") return "transaction";
  if (checkType === "address_investigation" || flow === "advanced") return "investigate";
  return "screen";
}

export interface ParsedAmlReport {
  variant: AmlReportVariant;
  flow: string | null;
  address: string | null;
  txHash: string | null;
  direction: string | null;
  tokenAmount: string | null;
  tokenCode: string | null;
  fiatAmount: string | null;
  fiatCode: string;
  riskyTokenAmount: string | null;
  riskyFiatAmount: string | null;
  riskyPercent: number | null;
  counterpartyAddress: string | null;
  pdfReport: string | null;
  timestamp: string | null;
  confirmedAt: string | null;
  asset: string | null;
  network: string | null;
  aggregateSignals: AmlSignal[];
  signalsIn: AmlSignal[];
  signalsOut: AmlSignal[];
  receivedFiatAmount: number | null;
  sentFiatAmount: number | null;
  highRiskCount: number;
  directConnectionCount: number;
  txConnections: AmlConnectionRow[];
  walletConnections: AmlConnectionRow[];
  hasBlackListFlag: boolean;
}

export function parseAmlReport(
  rawResponse: unknown,
  checkType: AmlCheck["checkType"],
): ParsedAmlReport | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;
  const root = rawResponse as Record<string, unknown>;
  const data = (root.data || {}) as Record<string, unknown>;
  const counterparty = (data.counterparty || {}) as Record<string, unknown>;
  const tokenDetails = (data.tokenDetails || {}) as Record<string, unknown>;

  const flow = data.flow != null ? String(data.flow) : null;
  const variant = getReportVariant(checkType, flow);

  const walletConnectionsRaw = Array.isArray(counterparty.connections)
    ? counterparty.connections
    : [];
  const txConnectionsRaw = Array.isArray(data.connections) ? data.connections : [];

  const walletConnections = sortConnections(
    walletConnectionsRaw.map((c, i) => parseCounterpartyConnection(c as Record<string, unknown>, i)),
  );
  const txConnections = sortConnections(
    txConnectionsRaw.map((c, i) => parseTxConnection(c as Record<string, unknown>, i)),
  );

  const highRiskWallet = walletConnections.filter((r) => r.isHighRisk).length;
  const highRiskTx = txConnections.filter((r) => r.isHighRisk).length;

  const precision = tokenDetails.precision != null ? Number(tokenDetails.precision) : 6;
  const tokenCode = tokenDetails.code != null ? String(tokenDetails.code) : String(data.asset || "TRX");
  const fiatCode = String(data.fiat_code_effective || "usd");

  const fiatRaw = data.fiat != null ? Number(data.fiat) : null;
  const riskyFiatRaw = data.risky_volume_fiat != null ? Number(data.risky_volume_fiat) : null;
  const amountRaw = data.amount != null ? Number(data.amount) : null;
  const riskyVolumeRaw = data.risky_volume != null ? Number(data.risky_volume) : null;

  let riskyPercent: number | null = null;
  if (fiatRaw != null && riskyFiatRaw != null && fiatRaw > 0) {
    riskyPercent = Math.round((riskyFiatRaw / fiatRaw) * 1000) / 10;
  }

  const cpSignals = counterparty.signals as Record<string, unknown> | undefined;

  return {
    variant,
    flow,
    address: data.address != null ? String(data.address) : null,
    txHash: data.tx != null ? String(data.tx) : null,
    direction: data.direction != null ? String(data.direction) : null,
    tokenAmount:
      amountRaw != null ? formatTokenAmount(amountRaw, precision, tokenCode) : null,
    tokenCode,
    fiatAmount: fiatRaw != null ? formatFiatAmount(fiatRaw, fiatCode) : null,
    fiatCode,
    riskyTokenAmount:
      riskyVolumeRaw != null
        ? formatTokenAmount(riskyVolumeRaw, precision, tokenCode)
        : null,
    riskyFiatAmount: riskyFiatRaw != null ? formatFiatAmount(riskyFiatRaw, fiatCode) : null,
    riskyPercent,
    counterpartyAddress:
      counterparty.address != null ? String(counterparty.address) : null,
    pdfReport: data.pdfReport != null ? String(data.pdfReport) : null,
    timestamp: data.timestamp != null ? String(data.timestamp) : null,
    confirmedAt: formatUnixTimestamp(data.confirmed_at) ?? null,
    asset: data.asset != null ? String(data.asset) : null,
    network: data.network != null ? String(data.network) : null,
    aggregateSignals: parseSignalObject(data.signals),
    signalsIn: parseSignalObject(cpSignals?.in),
    signalsOut: parseSignalObject(cpSignals?.out),
    receivedFiatAmount:
      counterparty.received_fiat_amount != null
        ? Number(counterparty.received_fiat_amount)
        : null,
    sentFiatAmount:
      counterparty.sent_fiat_amount != null ? Number(counterparty.sent_fiat_amount) : null,
    highRiskCount: variant === "transaction" ? highRiskTx : highRiskWallet,
    directConnectionCount: countDirectConnections(walletConnections),
    txConnections,
    walletConnections,
    hasBlackListFlag: Boolean(data.hasBlackListFlag),
  };
}
