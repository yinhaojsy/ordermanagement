import app from "./app.js";
import { db } from "./db.js";
import { startAutoBackupScheduler, stopAutoBackupScheduler } from "./services/autoBackup.js";
import { registerTelegramWebhookIfConfigured } from "./services/telegram/telegramWebhookSetup.js";
import { isTelegramBotConfigured } from "./services/telegram/telegramApi.js";
import { isTelegramEnabled } from "./services/telegram/telegramConfig.js";

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`API ready on http://localhost:${PORT}`);
  startAutoBackupScheduler();
  console.log("Orders: DELETE /api/orders/:id uses direct delete (approval workflow removed). Restart this process after server code changes.");
  if (isTelegramEnabled() && isTelegramBotConfigured()) {
    console.log("Telegram: in-app Bot API enabled");
    registerTelegramWebhookIfConfigured().catch((err) => {
      console.error("Telegram webhook setup error:", err);
    });
  }
});

// Wallet Auto-Refresh Configuration
const WALLET_REFRESH_INTERVAL = parseInt(process.env.WALLET_REFRESH_INTERVAL_SECONDS || '5') * 1000; // Default: 5 seconds
const WALLET_AUTO_REFRESH_ENABLED = process.env.WALLET_AUTO_REFRESH_ENABLED === 'true'; // Default: disabled
let walletRefreshTimer = null;
let isPollingActive = WALLET_AUTO_REFRESH_ENABLED;

// Background job to automatically refresh all wallets
async function refreshAllWalletsBackground() {
  try {
    // Check if there are any wallets to refresh
    const wallets = db.prepare("SELECT COUNT(*) as count FROM tron_wallets").get();
    
    if (wallets.count === 0) {
      console.log('⏭️  No wallets to refresh');
      return;
    }

    console.log(`🔄 Auto-refreshing ${wallets.count} wallet(s)...`);
    
    // Call the internal refresh endpoint
    const response = await fetch(`http://localhost:${PORT}/api/wallets/refresh-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_CRON_SECRET
          ? { 'x-internal-cron-secret': process.env.INTERNAL_CRON_SECRET }
          : {}),
      },
    });

    if (response.ok) {
      const result = await response.json();
      const successCount = result.results.filter((r) => r.success).length;
      const failCount = result.results.filter((r) => !r.success).length;
      
      console.log(`✅ Wallet auto-refresh completed: ${successCount} successful, ${failCount} failed`);
      
      // Log details of any new transactions found
      result.results.forEach((r) => {
        if (r.success && r.newTransactions > 0) {
          console.log(`   💰 ${r.nickname}: ${r.newTransactions} new transaction(s), balance change: ${r.balanceChange.toFixed(2)} USDT`);
        }
      });
    } else {
      console.error('❌ Wallet auto-refresh failed:', response.status);
    }
  } catch (error) {
    console.error('❌ Error in wallet auto-refresh:', error.message);
  }
}

// Function to start wallet polling
export function startWalletPolling() {
  if (walletRefreshTimer) {
    console.log('⚠️  Wallet polling already active');
    return { success: false, message: 'Polling already active' };
  }
  
  console.log(`▶️  Starting wallet auto-refresh (interval: ${WALLET_REFRESH_INTERVAL / 1000} seconds)`);
  
  // Start immediately
  refreshAllWalletsBackground();
  
  // Then run periodically
  walletRefreshTimer = setInterval(() => {
    refreshAllWalletsBackground();
  }, WALLET_REFRESH_INTERVAL);
  
  isPollingActive = true;
  return { success: true, message: 'Wallet polling started', interval: WALLET_REFRESH_INTERVAL / 1000 };
}

// Function to stop wallet polling
export function stopWalletPolling() {
  if (!walletRefreshTimer) {
    console.log('⚠️  Wallet polling already stopped');
    return { success: false, message: 'Polling already stopped' };
  }
  
  clearInterval(walletRefreshTimer);
  walletRefreshTimer = null;
  isPollingActive = false;
  console.log('⏸️  Wallet auto-refresh stopped');
  return { success: true, message: 'Wallet polling stopped' };
}

// Function to get polling status
export function getPollingStatus() {
  return {
    isActive: isPollingActive,
    interval: WALLET_REFRESH_INTERVAL / 1000,
    enabled: WALLET_AUTO_REFRESH_ENABLED
  };
}

// Start wallet auto-refresh if enabled
if (WALLET_AUTO_REFRESH_ENABLED) {
  console.log(`🤖 Wallet auto-refresh enabled (interval: ${WALLET_REFRESH_INTERVAL / 1000} seconds)`);
  
  // Use the startWalletPolling function after a short delay to avoid double-starting
  setTimeout(() => {
    if (!walletRefreshTimer) { // Only start if not already started
      startWalletPolling();
    }
  }, 5000);
} else {
  console.log('⏸️  Wallet auto-refresh disabled');
  isPollingActive = false;
}

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

// Graceful shutdown function
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  
  // Stop wallet auto-refresh
  if (walletRefreshTimer) {
    stopWalletPolling();
  }
  stopAutoBackupScheduler();
  
  // Set a timeout to force exit if graceful shutdown takes too long
  const shutdownTimeout = setTimeout(() => {
    console.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000); // 10 second timeout

  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  
  server.close(() => {
    clearTimeout(shutdownTimeout);
    console.log('Server closed');
    process.exit(0);
  });
};

// Graceful shutdown handlers - use 'once' to prevent multiple registrations
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  server.close(() => {
    process.exit(1);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    process.exit(1);
  });
});

