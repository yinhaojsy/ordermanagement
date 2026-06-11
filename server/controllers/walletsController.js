import { db } from "../db.js";
import { createNotificationForAllUsers } from "./notificationsController.js";
import {
  autoScreenNewWallet,
  autoScreenNewTransaction,
} from "../services/integrations/amlService.js";
import { checkUsdtContractBlacklist } from "../services/tron/tronService.js";
import { mapWalletRow } from "../utils/mapWalletRow.js";

// TronScan API configuration
// If API key is provided, use authenticated TronScan as primary (100K requests/day)
// Otherwise, use public APIs with lower rate limits
// Use function to get API key to ensure it's read after .env is loaded
const getTronScanApiKey = () => process.env.TRONSCAN_API_KEY;

const getTronScanEndpoints = () => {
  const apiKey = getTronScanApiKey();
  return apiKey
    ? [
        "https://api.tronscan.org/api",           // Primary: Authenticated TronScan (100K/day)
        "https://apilist.tronscanapi.com/api",    // Fallback 1: Authenticated TronScan alternative
        "https://api.trongrid.io",                // Fallback 2: Public TronGrid
        "https://api.tronscan.org/api",           // Fallback 3: Public TronScan (no key)
      ]
    : [
        "https://api.tronscan.org/api",           // Primary: Public TronScan
        "https://apilist.tronscanapi.com/api",    // Fallback 1: Public TronScan alternative
        "https://api.trongrid.io",                // Fallback 2: Public TronGrid
      ];
};

const USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT TRC20 contract

async function refreshUsdtBlacklistStatus(walletId, walletAddress) {
  const checkedAt = new Date().toISOString();
  try {
    const isBlacklisted = await checkUsdtContractBlacklist(walletAddress);
    db.prepare(
      `UPDATE tron_wallets
       SET isUsdtBlacklisted = ?, usdtBlacklistCheckedAt = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(isBlacklisted ? 1 : 0, checkedAt, checkedAt, walletId);
    return isBlacklisted;
  } catch (error) {
    console.error(`USDT blacklist check failed for wallet ${walletId}:`, error.message);
    return null;
  }
}

// Keep track of which endpoint is working
let workingEndpointIndex = 0;
let hasLoggedApiStatus = false;

// Log API configuration (will be called on first API request)
function logApiConfiguration() {
  if (hasLoggedApiStatus) return;
  hasLoggedApiStatus = true;
  
  const apiKey = getTronScanApiKey();
  if (apiKey) {
    console.log("🔑 TronScan API key detected - using authenticated endpoint (100K requests/day)");
  } else {
    console.log("⚠️  No TronScan API key - using public endpoints (limited rate)");
  }
}

/**
 * Fetch USDT balance for a TRON wallet address
 * Tries multiple API endpoints if one fails
 */
async function fetchWalletBalance(walletAddress) {
  let lastError = null;
  
  // Log API configuration on first request
  logApiConfiguration();
  
  const TRONSCAN_API_ENDPOINTS = getTronScanEndpoints();
  const TRONSCAN_API_KEY = getTronScanApiKey();
  
  // Try each endpoint starting from the last working one
  for (let i = 0; i < TRONSCAN_API_ENDPOINTS.length; i++) {
    const endpointIndex = (workingEndpointIndex + i) % TRONSCAN_API_ENDPOINTS.length;
    const apiBase = TRONSCAN_API_ENDPOINTS[endpointIndex];
    
    try {
      // Add API key header for authenticated TronScan endpoints
      const headers = {};
      const isTronScan = apiBase.includes('tronscan');
      const isAuthenticatedRequest = isTronScan && TRONSCAN_API_KEY && (endpointIndex === 0 || endpointIndex === 1);
      
      if (isAuthenticatedRequest) {
        headers['x-api-key'] = TRONSCAN_API_KEY;
      }
      
      const response = await fetch(
        `${apiBase}/account?address=${walletAddress}`,
        { 
          signal: AbortSignal.timeout(10000), // 10 second timeout
          headers
        }
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Find USDT token in trc20token_balances
      const trc20Balances = data.trc20token_balances || [];
      const usdtToken = trc20Balances.find(
        (token) => token.tokenId === USDT_CONTRACT_ADDRESS
      );

      // Update working endpoint if this one succeeded
      if (workingEndpointIndex !== endpointIndex) {
        const isTronScan = apiBase.includes('tronscan');
        const authStatus = (isTronScan && TRONSCAN_API_KEY && (endpointIndex === 0 || endpointIndex === 1)) ? ' (authenticated)' : '';
        console.log(`✅ Switched to working endpoint: ${apiBase}${authStatus}`);
        workingEndpointIndex = endpointIndex;
      }

      if (!usdtToken) {
        return 0; // No USDT balance found
      }

      // USDT has 6 decimals
      const balance = parseFloat(usdtToken.balance) / Math.pow(10, usdtToken.tokenDecimal || 6);
      return balance;
    } catch (error) {
      const isTronScan = apiBase.includes('tronscan');
      const authStatus = (isTronScan && TRONSCAN_API_KEY && (endpointIndex === 0 || endpointIndex === 1)) ? ' (authenticated)' : '';
      console.warn(`Failed to fetch from ${apiBase}${authStatus}:`, error.message);
      lastError = error;
      // Continue to next endpoint
    }
  }
  
  // All endpoints failed
  console.error(`All TronScan API endpoints failed for ${walletAddress}:`, lastError);
  throw new Error(`Unable to connect to TronScan API. Please check your internet connection.`);
}

/**
 * Fetch USDT transactions for a TRON wallet address
 * Tries multiple API endpoints if one fails
 */
async function fetchWalletTransactions(walletAddress, limit = 50) {
  let lastError = null;
  
  const TRONSCAN_API_ENDPOINTS = getTronScanEndpoints();
  const TRONSCAN_API_KEY = getTronScanApiKey();
  
  // Try each endpoint starting from the last working one
  for (let i = 0; i < TRONSCAN_API_ENDPOINTS.length; i++) {
    const endpointIndex = (workingEndpointIndex + i) % TRONSCAN_API_ENDPOINTS.length;
    const apiBase = TRONSCAN_API_ENDPOINTS[endpointIndex];
    
    try {
      // Add API key header for authenticated TronScan endpoints
      const headers = {};
      const isTronScan = apiBase.includes('tronscan');
      const isAuthenticatedRequest = isTronScan && TRONSCAN_API_KEY && (endpointIndex === 0 || endpointIndex === 1);
      
      if (isAuthenticatedRequest) {
        headers['x-api-key'] = TRONSCAN_API_KEY;
      }
      
      const response = await fetch(
        `${apiBase}/token_trc20/transfers?relatedAddress=${walletAddress}&contract_address=${USDT_CONTRACT_ADDRESS}&limit=${limit}&start=0`,
        { 
          signal: AbortSignal.timeout(10000), // 10 second timeout
          headers
        }
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const transactions = data.token_transfers || [];

      // Update working endpoint if this one succeeded
      if (workingEndpointIndex !== endpointIndex) {
        const isTronScan = apiBase.includes('tronscan');
        const authStatus = (isTronScan && TRONSCAN_API_KEY && (endpointIndex === 0 || endpointIndex === 1)) ? ' (authenticated)' : '';
        console.log(`✅ Switched to working endpoint: ${apiBase}${authStatus}`);
        workingEndpointIndex = endpointIndex;
      }

      return transactions.map((tx) => ({
        transactionHash: tx.transaction_id,
        transactionType: tx.to_address.toLowerCase() === walletAddress.toLowerCase() ? "inflow" : "outflow",
        amount: parseFloat(tx.quant) / Math.pow(10, 6), // USDT has 6 decimals
        fromAddress: tx.from_address,
        toAddress: tx.to_address,
        timestamp: new Date(tx.block_ts).toISOString(),
        blockNumber: tx.block,
      }));
    } catch (error) {
      console.warn(`Failed to fetch from ${apiBase}:`, error.message);
      lastError = error;
      // Continue to next endpoint
    }
  }
  
  // All endpoints failed
  console.error(`All TronScan API endpoints failed for ${walletAddress}:`, lastError);
  throw new Error(`Unable to connect to TronScan API. Please check your internet connection.`);
}

/**
 * List all wallets
 */
export const listWallets = (_req, res, next) => {
  try {
    const wallets = db
      .prepare(
        `SELECT * FROM tron_wallets 
         ORDER BY createdAt DESC;`
      )
      .all();
    res.json(wallets.map(mapWalletRow));
  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet summary (for summary cards)
 */
export const getWalletsSummary = (_req, res, next) => {
  try {
    const wallets = db
      .prepare(
        `SELECT 
          id,
          nickname,
          currentBalance,
          lastBalanceCheck
         FROM tron_wallets
         ORDER BY nickname ASC;`
      )
      .all();
    res.json(wallets);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new wallet
 */
export const createWallet = async (req, res, next) => {
  try {
    const { nickname, walletAddress, remarks } = req.body || {};

    if (!nickname || !walletAddress) {
      return res.status(400).json({ message: "Nickname and wallet address are required" });
    }

    // Validate TRON address format (starts with T and 34 characters)
    if (!walletAddress.match(/^T[A-Za-z1-9]{33}$/)) {
      return res.status(400).json({ message: "Invalid TRON wallet address format" });
    }

    // Check if wallet already exists
    const existing = db
      .prepare("SELECT id FROM tron_wallets WHERE walletAddress = ?")
      .get(walletAddress);
    
    if (existing) {
      return res.status(400).json({ message: "This wallet address is already being tracked" });
    }

    // Fetch initial balance and on-chain USDT blacklist status
    let currentBalance = 0;
    let lastBalanceCheck = null;
    let isUsdtBlacklisted = 0;
    let usdtBlacklistCheckedAt = null;
    try {
      const [balance, usdtBlacklisted] = await Promise.all([
        fetchWalletBalance(walletAddress),
        checkUsdtContractBlacklist(walletAddress),
      ]);
      currentBalance = balance;
      lastBalanceCheck = new Date().toISOString();
      isUsdtBlacklisted = usdtBlacklisted ? 1 : 0;
      usdtBlacklistCheckedAt = lastBalanceCheck;
    } catch (error) {
      console.error("Failed to fetch initial wallet status:", error);
      try {
        currentBalance = await fetchWalletBalance(walletAddress);
        lastBalanceCheck = new Date().toISOString();
      } catch (balanceError) {
        console.error("Failed to fetch initial balance:", balanceError);
      }
      try {
        const usdtBlacklisted = await checkUsdtContractBlacklist(walletAddress);
        isUsdtBlacklisted = usdtBlacklisted ? 1 : 0;
        usdtBlacklistCheckedAt = new Date().toISOString();
      } catch (blacklistError) {
        console.error("Failed to fetch initial USDT blacklist status:", blacklistError);
      }
    }

    const stmt = db.prepare(
      `INSERT INTO tron_wallets (
         nickname, walletAddress, remarks, currentBalance, lastBalanceCheck,
         isUsdtBlacklisted, usdtBlacklistCheckedAt, createdAt
       )
       VALUES (
         @nickname, @walletAddress, @remarks, @currentBalance, @lastBalanceCheck,
         @isUsdtBlacklisted, @usdtBlacklistCheckedAt, @createdAt
       );`
    );

    const result = stmt.run({
      nickname,
      walletAddress,
      remarks: remarks || null,
      currentBalance,
      lastBalanceCheck,
      isUsdtBlacklisted,
      usdtBlacklistCheckedAt,
      createdAt: new Date().toISOString(),
    });

    const wallet = mapWalletRow(
      db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(result.lastInsertRowid),
    );

    // Fetch and store recent transactions
    try {
      const transactions = await fetchWalletTransactions(walletAddress, 20);
      const insertTx = db.prepare(
        `INSERT OR IGNORE INTO tron_wallet_transactions 
         (walletId, transactionHash, transactionType, amount, fromAddress, toAddress, timestamp, blockNumber, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
      );

      for (const tx of transactions) {
        insertTx.run(
          result.lastInsertRowid,
          tx.transactionHash,
          tx.transactionType,
          tx.amount,
          tx.fromAddress,
          tx.toAddress,
          tx.timestamp,
          tx.blockNumber,
          new Date().toISOString()
        );
      }
    } catch (error) {
      console.error("Failed to fetch initial transactions:", error);
    }

    autoScreenNewWallet(result.lastInsertRowid, req.user?.id).catch((err) =>
      console.error("AML auto-screen new wallet failed:", err.message),
    );

    res.status(201).json(wallet);
  } catch (error) {
    next(error);
  }
};

/**
 * Update a wallet
 */
export const updateWallet = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nickname, remarks } = req.body || {};

    if (!nickname) {
      return res.status(400).json({ message: "Nickname is required" });
    }

    const existing = db.prepare("SELECT id FROM tron_wallets WHERE id = ?").get(id);
    if (!existing) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    db.prepare(
      `UPDATE tron_wallets 
       SET nickname = @nickname, remarks = @remarks, updatedAt = @updatedAt 
       WHERE id = @id;`
    ).run({
      id,
      nickname,
      remarks: remarks || null,
      updatedAt: new Date().toISOString(),
    });

    const wallet = mapWalletRow(db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(id));
    res.json(wallet);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a wallet
 */
export const deleteWallet = (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = db.prepare("SELECT id FROM tron_wallets WHERE id = ?").get(id);
    if (!existing) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Transactions will be automatically deleted due to CASCADE
    db.prepare("DELETE FROM tron_wallets WHERE id = ?").run(id);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh wallet balance
 */
export const refreshWalletBalance = async (req, res, next) => {
  try {
    const { id } = req.params;

    const wallet = db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(id);
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    const [newBalance] = await Promise.all([
      fetchWalletBalance(wallet.walletAddress),
      refreshUsdtBlacklistStatus(id, wallet.walletAddress),
    ]);

    db.prepare(
      `UPDATE tron_wallets 
       SET currentBalance = @currentBalance, lastBalanceCheck = @lastBalanceCheck, updatedAt = @updatedAt 
       WHERE id = @id;`
    ).run({
      id,
      currentBalance: newBalance,
      lastBalanceCheck: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = mapWalletRow(db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(id));

    res.json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet transactions
 */
export const getWalletTransactions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { refresh } = req.query;

    const wallet = db.prepare("SELECT * FROM tron_wallets WHERE id = ?").get(id);
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // If refresh is requested, fetch latest transactions
    if (refresh === "true") {
      try {
        const transactions = await fetchWalletTransactions(wallet.walletAddress, 50);
        const insertTx = db.prepare(
          `INSERT OR IGNORE INTO tron_wallet_transactions 
           (walletId, transactionHash, transactionType, amount, fromAddress, toAddress, timestamp, blockNumber, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
        );

        let newTransactionsCount = 0;
        for (const tx of transactions) {
          const result = insertTx.run(
            id,
            tx.transactionHash,
            tx.transactionType,
            tx.amount,
            tx.fromAddress,
            tx.toAddress,
            tx.timestamp,
            tx.blockNumber,
            new Date().toISOString()
          );
          if (result.changes > 0) {
            newTransactionsCount++;

            // Notify users about new transaction
            await createNotificationForAllUsers({
              type: tx.transactionType === "inflow" ? "wallet_incoming" : "wallet_outgoing",
              title: `Wallet ${tx.transactionType === "inflow" ? "Received" : "Sent"} USDT`,
              message: `${wallet.nickname}: ${tx.transactionType === "inflow" ? "Received" : "Sent"} ${tx.amount.toFixed(2)} USDT`,
              entityType: "wallet",
              entityId: parseInt(id),
              actionUrl: `/wallets`,
            });

            autoScreenNewTransaction(parseInt(id, 10), result.lastInsertRowid, req.user?.id).catch((err) =>
              console.error("AML auto-screen tx failed:", err.message),
            );
          }
        }

        console.log(`Refreshed transactions for wallet ${id}: ${newTransactionsCount} new transactions`);
      } catch (error) {
        console.error("Failed to refresh transactions:", error);
      }
    }

    const transactions = db
      .prepare(
        `SELECT * FROM tron_wallet_transactions 
         WHERE walletId = ? 
         ORDER BY timestamp DESC
         LIMIT 100;`
      )
      .all(id);

    res.json(transactions);
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh all wallets (can be called periodically)
 */
export const refreshAllWallets = async (req, res, next) => {
  try {
    const wallets = db.prepare("SELECT * FROM tron_wallets").all();
    const results = [];

    for (const wallet of wallets) {
      try {
        const [newBalance] = await Promise.all([
          fetchWalletBalance(wallet.walletAddress),
          refreshUsdtBlacklistStatus(wallet.id, wallet.walletAddress),
        ]);
        const oldBalance = wallet.currentBalance;

        db.prepare(
          `UPDATE tron_wallets 
           SET currentBalance = @currentBalance, lastBalanceCheck = @lastBalanceCheck, updatedAt = @updatedAt 
           WHERE id = @id;`
        ).run({
          id: wallet.id,
          currentBalance: newBalance,
          lastBalanceCheck: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Check for new transactions
        const transactions = await fetchWalletTransactions(wallet.walletAddress, 20);
        const insertTx = db.prepare(
          `INSERT OR IGNORE INTO tron_wallet_transactions 
           (walletId, transactionHash, transactionType, amount, fromAddress, toAddress, timestamp, blockNumber, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
        );

        let newTransactionsCount = 0;
        for (const tx of transactions) {
          const result = insertTx.run(
            wallet.id,
            tx.transactionHash,
            tx.transactionType,
            tx.amount,
            tx.fromAddress,
            tx.toAddress,
            tx.timestamp,
            tx.blockNumber,
            new Date().toISOString()
          );
          if (result.changes > 0) {
            newTransactionsCount++;

            // Notify users about new transaction
            await createNotificationForAllUsers({
              type: tx.transactionType === "inflow" ? "wallet_incoming" : "wallet_outgoing",
              title: `Wallet ${tx.transactionType === "inflow" ? "Received" : "Sent"} USDT`,
              message: `${wallet.nickname}: ${tx.transactionType === "inflow" ? "Received" : "Sent"} ${tx.amount.toFixed(2)} USDT`,
              entityType: "wallet",
              entityId: wallet.id,
              actionUrl: `/wallets`,
            });

            autoScreenNewTransaction(wallet.id, result.lastInsertRowid, req.user?.id).catch((err) =>
              console.error("AML auto-screen tx failed:", err.message),
            );
          }
        }

        results.push({
          walletId: wallet.id,
          nickname: wallet.nickname,
          oldBalance,
          newBalance,
          balanceChange: newBalance - oldBalance,
          newTransactions: newTransactionsCount,
          success: true,
        });
      } catch (error) {
        console.error(`Failed to refresh wallet ${wallet.id}:`, error);
        results.push({
          walletId: wallet.id,
          nickname: wallet.nickname,
          success: false,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      refreshedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    next(error);
  }
};

// Polling control endpoints
export const stopPolling = async (req, res, next) => {
  try {
    const { stopWalletPolling } = await import('../index.js');
    const result = stopWalletPolling();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const startPolling = async (req, res, next) => {
  try {
    const { startWalletPolling } = await import('../index.js');
    const result = startWalletPolling();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getPollingStatus = async (req, res, next) => {
  try {
    const { getPollingStatus: getStatus } = await import('../index.js');
    const status = getStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
};
