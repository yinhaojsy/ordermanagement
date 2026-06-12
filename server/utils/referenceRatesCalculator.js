/** @typedef {'average' | 'dual' | 'chain' | 'derived' | null} ReferenceRateBaseMode */
/** @typedef {'standalone' | 'benchmark' | 'chain' | 'derived'} ReferenceRatePairKind */

export const CONFIG_PAIR_IDS = [
  "CNY_USDT",
  "PKR_AED",
  "AED_USDT",
  "HKD_USDT",
  "PKR_USDT",
  "USD_USDT_HK",
  "USD_USDT_INTL",
];

export const DERIVED_PAIR_IDS = ["HKD_PKR", "CNY_PKR", "PKR_SWIFT"];

export const REFERENCE_RATE_PAIR_IDS = [...CONFIG_PAIR_IDS, ...DERIVED_PAIR_IDS];

const PAIR_LABELS = {
  CNY_USDT: "CNY/USDT",
  PKR_AED: "PKR/AED",
  AED_USDT: "AED/USDT",
  HKD_USDT: "HKD/USDT",
  PKR_USDT: "PKR/USDT",
  USD_USDT_HK: "USD/USDT (HK)",
  USD_USDT_INTL: "USD/USDT (INTL)",
  HKD_PKR: "HKD/PKR",
  CNY_PKR: "CNY/PKR",
  PKR_SWIFT: "PKR/SWIFT",
};

/** @type {Record<string, ReferenceRatePairKind>} */
export const PAIR_KINDS = {
  CNY_USDT: "standalone",
  PKR_AED: "standalone",
  AED_USDT: "benchmark",
  HKD_USDT: "benchmark",
  PKR_USDT: "chain",
  USD_USDT_HK: "standalone",
  USD_USDT_INTL: "standalone",
  HKD_PKR: "derived",
  CNY_PKR: "derived",
  PKR_SWIFT: "derived",
};

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const hasPositive = (n) => n !== null && n > 0;

/** @param {unknown} v @param {number} [fallback] */
export const clampDisplayDecimals = (v, fallback = 3) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(0, n));
};

const withDisplayDecimals = (pair, raw = {}) => ({
  ...pair,
  displayDecimals: clampDisplayDecimals(raw.displayDecimals),
});

/**
 * @param {{ averageBase?: number|null, baseBuy?: number|null, baseSell?: number|null, baseMode?: string, kind?: string }} input
 */
export const resolveBaseMode = (input) => {
  if (input.kind === "chain") return "chain";
  if (input.kind === "benchmark") {
    const buy = toNum(input.baseBuy);
    const sell = toNum(input.baseSell);
    if (hasPositive(buy) || hasPositive(sell)) return "dual";
    return input.baseMode === "dual" ? "dual" : null;
  }
  const avg = toNum(input.averageBase);
  const buy = toNum(input.baseBuy);
  const sell = toNum(input.baseSell);
  if (hasPositive(avg)) return "average";
  if (hasPositive(buy) || hasPositive(sell)) return "dual";
  if (input.baseMode === "average" || input.baseMode === "dual") return input.baseMode;
  return null;
};

/** CNY row 7 benchmark for CNY/PKR (average base or dual base sell). */
const getCnyBenchmarkBase = (cny) => {
  if (cny.baseMode === "average" && hasPositive(cny.averageBase)) return cny.averageBase;
  if (cny.baseMode === "dual" && hasPositive(cny.baseSell)) return cny.baseSell;
  return null;
};

/**
 * @param {ReturnType<typeof normalizePairInput>} pair
 */
export const computeStandaloneRates = (pair) => {
  const markup = pair.markup ?? 0;
  const markdown = pair.markdown ?? 0;

  if (pair.baseMode === "average") {
    const avg = pair.averageBase;
    if (!hasPositive(avg)) {
      return { buy: null, sell: null, error: "missing_average_base" };
    }
    return {
      buy: avg * (1 - markdown),
      sell: avg * (1 + markup),
      error: null,
    };
  }

  if (pair.baseMode === "dual") {
    const buy = hasPositive(pair.baseBuy) ? pair.baseBuy * (1 - markdown) : null;
    const sell = hasPositive(pair.baseSell) ? pair.baseSell * (1 + markup) : null;
    if (buy === null && sell === null) {
      return { buy: null, sell: null, error: "missing_dual_base" };
    }
    return { buy, sell, error: null };
  }

  return { buy: null, sell: null, error: "no_base_mode" };
};

/**
 * @param {string} pairId
 * @param {object} raw
 */
export const normalizePairInput = (pairId, raw = {}) => {
  const kind = PAIR_KINDS[pairId] || "standalone";
  const markup = toNum(raw.markup) ?? 0;
  const markdown = toNum(raw.markdown) ?? 0;
  const averageBase = toNum(raw.averageBase);
  const baseBuy = toNum(raw.baseBuy);
  const baseSell = toNum(raw.baseSell);
  const baseMode = resolveBaseMode({
    averageBase,
    baseBuy,
    baseSell,
    baseMode: raw.baseMode,
    kind,
  });

  if (kind === "chain") {
    return withDisplayDecimals(
      {
        id: pairId,
        label: PAIR_LABELS[pairId] || pairId,
        kind,
        baseMode: "chain",
        averageBase: null,
        baseBuy: null,
        baseSell: null,
        markup: Math.max(0, markup),
        markdown: Math.max(0, markdown),
      },
      raw,
    );
  }

  if (kind === "benchmark") {
    return withDisplayDecimals(
      {
        id: pairId,
        label: PAIR_LABELS[pairId] || pairId,
        kind,
        baseMode: "dual",
        averageBase: null,
        baseBuy: hasPositive(baseBuy) ? baseBuy : null,
        baseSell: hasPositive(baseSell) ? baseSell : null,
        markup: 0,
        markdown: 0,
      },
      raw,
    );
  }

  return withDisplayDecimals(
    {
      id: pairId,
      label: PAIR_LABELS[pairId] || pairId,
      kind,
      baseMode,
      averageBase: baseMode === "average" ? averageBase : null,
      baseBuy: baseMode === "dual" ? baseBuy : null,
      baseSell: baseMode === "dual" ? baseSell : null,
      markup: Math.max(0, markup),
      markdown: Math.max(0, markdown),
    },
    raw,
  );
};

/**
 * @param {string} pairId
 * @param {object} raw
 */
export const normalizeDerivedPairInput = (pairId, raw = {}) => {
  const markup = toNum(raw.markup) ?? 0;
  const markdown = toNum(raw.markdown) ?? 0;
  const averageBase = toNum(raw.averageBase);
  return withDisplayDecimals(
    {
      id: pairId,
      label: PAIR_LABELS[pairId] || pairId,
      kind: "derived",
      baseMode: "derived",
      averageBase: hasPositive(averageBase) ? averageBase : null,
      baseBuy: null,
      baseSell: null,
      markup: Math.max(0, markup),
      markdown: Math.max(0, markdown),
    },
    raw,
  );
};

/**
 * @param {string} pairId
 * @param {{ buy: number|null, sell: number|null, error: string|null }} raw
 * @param {ReturnType<typeof normalizeDerivedPairInput>} config
 */
const applyDerivedSpreads = (pairId, raw, config) => {
  const markup = config.markup ?? 0;
  const markdown = config.markdown ?? 0;
  const storedBase = config.averageBase;
  const autoBase =
    pairId === "PKR_SWIFT"
      ? raw.sell
      : hasPositive(raw.buy) && hasPositive(raw.sell)
        ? (raw.buy + raw.sell) / 2
        : raw.sell ?? raw.buy;
  const base = hasPositive(storedBase) ? storedBase : autoBase;

  if (!hasPositive(base)) {
    return { buy: null, sell: null, error: raw.error };
  }

  if (pairId === "PKR_SWIFT") {
    return { buy: null, sell: base * (1 + markup), error: raw.error };
  }

  return {
    buy: base * (1 - markdown),
    sell: base * (1 + markup),
    error: raw.error,
  };
};

const attachComputed = (pair, computed) => ({
  ...pair,
  computedBuy: computed.buy,
  computedSell: computed.sell,
  computeError: computed.error,
});

/**
 * @param {object} config
 */
export const buildReferenceRatesResponse = (config) => {
  const pkrSwiftFactor = toNum(config.pkrSwiftFactor) ?? 1.01;

  /** @type {Record<string, object>} */
  const normalized = {};
  for (const pairId of CONFIG_PAIR_IDS) {
    normalized[pairId] = normalizePairInput(pairId, config.pairs?.[pairId] || {});
  }

  const pairs = {};

  const cny = normalized.CNY_USDT;
  const pkrAed = normalized.PKR_AED;
  const aed = normalized.AED_USDT;
  const hkd = normalized.HKD_USDT;
  const pkrUsdtSpread = normalized.PKR_USDT;

  pairs.CNY_USDT = attachComputed(cny, computeStandaloneRates(cny));
  pairs.PKR_AED = attachComputed(pkrAed, computeStandaloneRates(pkrAed));
  pairs.USD_USDT_HK = attachComputed(
    normalized.USD_USDT_HK,
    computeStandaloneRates(normalized.USD_USDT_HK),
  );
  pairs.USD_USDT_INTL = attachComputed(
    normalized.USD_USDT_INTL,
    computeStandaloneRates(normalized.USD_USDT_INTL),
  );

  // D/F columns: show benchmark bases on panel (no spread formula on these pairs)
  pairs.AED_USDT = attachComputed(aed, {
    buy: aed.baseBuy,
    sell: aed.baseSell,
    error: null,
  });

  const pkrAedSell = pairs.PKR_AED.computedSell;
  const aedBaseSell = aed.baseSell;

  let pkrUsdtSell = null;
  let pkrUsdtBuy = null;
  let pkrUsdtError = null;

  if (!hasPositive(pkrAedSell)) {
    pkrUsdtError = "missing_pkr_aed_sell";
  } else if (!hasPositive(aedBaseSell)) {
    pkrUsdtError = "missing_aed_base_sell";
  } else {
    pkrUsdtSell = pkrAedSell * aedBaseSell * (1 + (pkrUsdtSpread.markup ?? 0));
    pkrUsdtBuy = pkrUsdtSell * (1 - (pkrUsdtSpread.markdown ?? 0));
  }

  pairs.PKR_USDT = attachComputed(
    { ...pkrUsdtSpread, kind: "chain", baseMode: "chain" },
    { buy: pkrUsdtBuy, sell: pkrUsdtSell, error: pkrUsdtError },
  );

  pairs.HKD_USDT = attachComputed(
    { ...hkd, kind: "benchmark", baseMode: "dual" },
    { buy: hkd.baseBuy, sell: hkd.baseSell, error: null },
  );

  const hkdPkrConfig = normalizeDerivedPairInput("HKD_PKR", config.pairs?.HKD_PKR || {});
  const cnyPkrConfig = normalizeDerivedPairInput("CNY_PKR", config.pairs?.CNY_PKR || {});
  const pkrSwiftConfig = normalizeDerivedPairInput("PKR_SWIFT", config.pairs?.PKR_SWIFT || {});

  // G column: HKD/PKR — buy = E8/F7, sell = E9/F6
  let hkdPkrBuy = null;
  let hkdPkrSell = null;
  let hkdPkrError = null;
  if (!hasPositive(pkrUsdtBuy) || !hasPositive(pkrUsdtSell)) {
    hkdPkrError = "missing_pkr_usdt";
  } else if (!hasPositive(hkd.baseSell)) {
    hkdPkrError = "missing_hkd_base_sell";
  } else if (!hasPositive(hkd.baseBuy)) {
    hkdPkrError = "missing_hkd_base_buy";
  } else {
    hkdPkrBuy = pkrUsdtBuy / hkd.baseSell;
    hkdPkrSell = pkrUsdtSell / hkd.baseBuy;
  }

  pairs.HKD_PKR = attachComputed(
    hkdPkrConfig,
    applyDerivedSpreads(
      "HKD_PKR",
      { buy: hkdPkrBuy, sell: hkdPkrSell, error: hkdPkrError },
      hkdPkrConfig,
    ),
  );

  // H column: CNY/PKR — buy = E8/B7, sell = E9/B7
  const cnyBench = getCnyBenchmarkBase(cny);
  let cnyPkrBuy = null;
  let cnyPkrSell = null;
  let cnyPkrError = null;
  if (!hasPositive(pkrUsdtBuy) || !hasPositive(pkrUsdtSell)) {
    cnyPkrError = "missing_pkr_usdt";
  } else if (!hasPositive(cnyBench)) {
    cnyPkrError = "missing_cny_benchmark";
  } else {
    cnyPkrBuy = pkrUsdtBuy / cnyBench;
    cnyPkrSell = pkrUsdtSell / cnyBench;
  }

  pairs.CNY_PKR = attachComputed(
    cnyPkrConfig,
    applyDerivedSpreads(
      "CNY_PKR",
      { buy: cnyPkrBuy, sell: cnyPkrSell, error: cnyPkrError },
      cnyPkrConfig,
    ),
  );

  let pkrSwiftSell = null;
  let pkrSwiftError = null;
  if (!hasPositive(pkrUsdtSell)) {
    pkrSwiftError = "missing_pkr_usdt_sell";
  } else {
    pkrSwiftSell = pkrUsdtSell * pkrSwiftFactor;
  }

  pairs.PKR_SWIFT = attachComputed(
    pkrSwiftConfig,
    applyDerivedSpreads(
      "PKR_SWIFT",
      { buy: null, sell: pkrSwiftSell, error: pkrSwiftError },
      pkrSwiftConfig,
    ),
  );

  return {
    version: config.version ?? 2,
    updatedAt: config.updatedAt ?? null,
    pkrSwiftFactor,
    pairs,
  };
};

export const defaultReferenceRatesConfig = () => ({
  version: 2,
  pkrSwiftFactor: 1.01,
  pairs: {
    CNY_USDT: normalizePairInput("CNY_USDT", {
      baseMode: "average",
      averageBase: 6.8,
      markup: 0.004,
      markdown: 0.004,
    }),
    PKR_AED: normalizePairInput("PKR_AED", {
      baseMode: "average",
      averageBase: 77,
      markup: 0.002,
      markdown: 0.006,
    }),
    AED_USDT: normalizePairInput("AED_USDT", {
      baseBuy: 3.663,
      baseSell: 3.673,
    }),
    HKD_USDT: normalizePairInput("HKD_USDT", {
      baseBuy: 7.77,
      baseSell: 7.82,
    }),
    PKR_USDT: normalizePairInput("PKR_USDT", {
      markup: 0.002,
      markdown: 0.009,
    }),
    USD_USDT_HK: normalizePairInput("USD_USDT_HK", {
      baseMode: "average",
      averageBase: 1,
      markup: 0.008,
      markdown: 0.008,
    }),
    USD_USDT_INTL: normalizePairInput("USD_USDT_INTL", {
      baseMode: "average",
      averageBase: 1,
      markup: 0.015,
      markdown: 0.015,
    }),
    HKD_PKR: normalizeDerivedPairInput("HKD_PKR", {}),
    CNY_PKR: normalizeDerivedPairInput("CNY_PKR", {}),
    PKR_SWIFT: normalizeDerivedPairInput("PKR_SWIFT", {}),
  },
});

/**
 * @param {object} body
 */
export const parseAndBuildConfig = (body) => {
  const pairs = {};
  for (const pairId of CONFIG_PAIR_IDS) {
    pairs[pairId] = normalizePairInput(pairId, body?.pairs?.[pairId] || {});
  }
  for (const pairId of DERIVED_PAIR_IDS) {
    pairs[pairId] = normalizeDerivedPairInput(pairId, body?.pairs?.[pairId] || {});
  }
  const factor = toNum(body?.pkrSwiftFactor);
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    pkrSwiftFactor: hasPositive(factor) ? factor : 1.01,
    pairs,
  };
};
