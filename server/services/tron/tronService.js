const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const TRONGRID_ENDPOINTS = [
  "https://api.trongrid.io",
  "https://api.shasta.trongrid.io",
];

function getTronGridApiKey() {
  return process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY || null;
}

/**
 * Decode a TRON base58 address (T…) to 20-byte hex (no 0x41 prefix).
 */
export function tronAddressToHex(address) {
  let num = 0n;
  for (const char of address) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base58 character in TRON address: ${char}`);
    }
    num = num * 58n + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;

  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }

  // Last 4 bytes are checksum; leading byte is 0x41 mainnet prefix.
  const payload = bytes.slice(0, -4);
  if (payload.length !== 21 || payload[0] !== 0x41) {
    throw new Error("Invalid TRON address payload");
  }

  return payload
    .slice(1)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Call USDT TRC20 isBlackListed(address) on-chain via TronGrid.
 * Returns true when Tether has frozen the address on the USDT contract.
 */
export async function checkUsdtContractBlacklist(walletAddress) {
  const addressHex = tronAddressToHex(walletAddress);
  const parameter = addressHex.padStart(64, "0");

  const apiKey = getTronGridApiKey();
  let lastError = null;

  for (const baseUrl of TRONGRID_ENDPOINTS) {
    if (baseUrl.includes("shasta")) continue;

    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;

      const response = await fetch(`${baseUrl}/wallet/triggerconstantcontract`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          owner_address: USDT_TRC20_CONTRACT,
          contract_address: USDT_TRC20_CONTRACT,
          function_selector: "isBlackListed(address)",
          parameter,
          visible: true,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`TronGrid HTTP ${response.status}`);
      }

      const json = await response.json();
      const constantResult = json?.constant_result?.[0];
      if (typeof constantResult !== "string") {
        throw new Error("Missing constant_result from TronGrid");
      }

      const normalized = constantResult.replace(/^0x/, "").toLowerCase();
      return normalized.endsWith("1");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to check USDT contract blacklist status");
}

export { USDT_TRC20_CONTRACT };
