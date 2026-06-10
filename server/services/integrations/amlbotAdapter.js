import crypto from "crypto";

/**
 * AMLBot Web API token = md5("{signingKey}:{accessKey}:{accessId}").
 * Per AMLBot docs the signing key is usually the request-type field name
 * (e.g. "address", "page"), not the wallet address or page number.
 * Transaction recheck uses the actual hash / uid value.
 */
function buildToken(signingKey, accessKey, accessId) {
  return crypto.createHash("md5").update(`${signingKey}:${accessKey}:${accessId}`).digest("hex");
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

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const detail =
      json.description ||
      json.message ||
      (text && !text.trimStart().startsWith("<") ? text.slice(0, 200) : null);
    let message = detail || `AMLBot HTTP ${response.status}`;
    if (response.status === 403) {
      message =
        `${message}. This often means invalid credentials or your server IP is not whitelisted with AMLBot (Railway egress IP, not your website domain). Contact @amlbot_support_bot.`;
    }
    const err = new Error(message);
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
    "address",
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
    "address",
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
  return postForm(credentials, "/history/", { page: pageStr }, "page");
}

export async function amlbotTestConnection(credentials) {
  try {
    await amlbotHistory(credentials, { page: 1 });
    return;
  } catch (firstError) {
    if (firstError.statusCode !== 401 && firstError.statusCode !== 403) {
      throw firstError;
    }
    // Fallback: some deployments sign history with page number instead of literal "page"
    const pageStr = "1";
    await postForm(
      credentials,
      "/history/",
      { page: pageStr },
      pageStr,
    );
  }
}
