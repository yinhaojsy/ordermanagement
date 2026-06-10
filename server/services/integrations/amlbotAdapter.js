import crypto from "crypto";

function buildToken(primaryField, accessKey, accessId) {
  return crypto.createHash("md5").update(`${primaryField}:${accessKey}:${accessId}`).digest("hex");
}

async function postForm(credentials, path, fields, primaryForToken) {
  const body = new URLSearchParams({
    accessId: credentials.accessId,
    token: buildToken(primaryForToken, credentials.accessKey, credentials.accessId),
    locale: "en_US",
    ...fields,
  });

  const url = `${credentials.apiUrl}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(credentials.requestTimeoutMs),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(json.description || json.message || `AMLBot HTTP ${response.status}`);
    err.statusCode = response.status;
    err.raw = json;
    throw err;
  }
  if (json.result === false) {
    const err = new Error(json.description || "AMLBot request failed");
    err.raw = json;
    throw err;
  }
  return json;
}

const TRON_ASSET = "TRX";

export async function amlbotCheckAddress(credentials, { address, flow }) {
  return postForm(
    credentials,
    "/",
    {
      hash: address,
      asset: TRON_ASSET,
      flow: flow || credentials.defaultFlow || "fast",
    },
    address,
  );
}

export async function amlbotInvestigateAddress(credentials, { address }) {
  return postForm(
    credentials,
    "/",
    {
      hash: address,
      asset: TRON_ASSET,
      flow: "advanced",
    },
    address,
  );
}

export async function amlbotCheckTransaction(credentials, { hash, address, direction, flow }) {
  const dir = direction === "inflow" ? "deposit" : "withdrawal";
  return postForm(
    credentials,
    "/",
    {
      hash,
      address,
      asset: TRON_ASSET,
      direction: dir,
      flow: flow || credentials.defaultFlow || "fast",
    },
    hash,
  );
}

export async function amlbotRecheck(credentials, { uid }) {
  return postForm(credentials, "/recheck/", { uid }, uid);
}

export async function amlbotHistory(credentials, { page = 1 }) {
  const pageStr = String(page);
  return postForm(credentials, "/history/", { page: pageStr }, pageStr);
}

export async function amlbotTestConnection(credentials) {
  await amlbotHistory(credentials, { page: 1 });
}
