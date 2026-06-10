import crypto from "crypto";

/**
 * AMLBot Web API token = md5("{signingValue}:{accessKey}:{accessId}").
 * signingValue is always the primary form field's value (not the field name):
 * history → page number, address → wallet hash, transaction → tx hash, recheck → uid.
 */
function buildToken(signingValue, accessKey, accessId) {
  return crypto.createHash("md5").update(`${signingValue}:${accessKey}:${accessId}`).digest("hex");
}

async function postForm(credentials, path, fields, signingValue) {
  const body = new URLSearchParams({
    accessId: credentials.accessId,
    token: buildToken(signingValue, credentials.accessKey, credentials.accessId),
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
    err.statusCode = 400;
    err.raw = json;
    throw err;
  }
  return json;
}

const TRON_ASSET = "TRX";

export async function amlbotCheckAddress(credentials, { address, flow }) {
  const walletAddress = String(address);
  return postForm(
    credentials,
    "/",
    {
      hash: walletAddress,
      asset: TRON_ASSET,
      flow: flow || credentials.defaultFlow || "fast",
    },
    walletAddress,
  );
}

export async function amlbotInvestigateAddress(credentials, { address }) {
  const walletAddress = String(address);
  return postForm(
    credentials,
    "/",
    {
      hash: walletAddress,
      asset: TRON_ASSET,
      flow: "advanced",
    },
    walletAddress,
  );
}

export async function amlbotCheckTransaction(credentials, { hash, address, direction, flow }) {
  const txHash = String(hash);
  const dir = direction === "inflow" ? "deposit" : "withdrawal";
  return postForm(
    credentials,
    "/",
    {
      hash: txHash,
      address: String(address),
      asset: TRON_ASSET,
      direction: dir,
      flow: flow || credentials.defaultFlow || "fast",
    },
    txHash,
  );
}

export async function amlbotRecheck(credentials, { uid }) {
  const uidStr = String(uid);
  return postForm(credentials, "/recheck/", { uid: uidStr }, uidStr);
}

export async function amlbotHistory(credentials, { page = 1 }) {
  const pageStr = String(page);
  return postForm(credentials, "/history/", { page: pageStr }, pageStr);
}

export async function amlbotTestConnection(credentials) {
  await amlbotHistory(credentials, { page: 1 });
}
