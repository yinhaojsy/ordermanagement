import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { ensureBootstrapAdmin } from "./utils/bootstrapAdmin.js";

// Use Railway's persistent volume path, or fallback to local path
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "server", "data");
export const dbPath = path.join(dataDir, "app.db");

fs.mkdirSync(dataDir, { recursive: true });

const applyPragmas = (instance) => {
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
};

export const createDbInstance = () => {
  const instance = new Database(dbPath);
  applyPragmas(instance);
  return instance;
};

export let db = createDbInstance();

export const resetDbInstance = () => {
  try {
    if (db && typeof db.close === "function") {
      db.close();
    }
  } catch (e) {
    // ignore close errors
  }
  db = createDbInstance();
  return db;
};

/** Remove WAL sidecar files so a replaced main DB is not merged with stale journal data. */
export const removeWalSidecars = (mainDbPath = dbPath) => {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${mainDbPath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }
};

/** Close connection, replace app.db, clear WAL files, reopen. */
export const replaceDatabaseFromPath = (sourcePath) => {
  try {
    if (db && typeof db.close === "function") {
      db.close();
    }
  } catch {
    // ignore if already closed
  }
  removeWalSidecars();
  fs.copyFileSync(sourcePath, dbPath);
  removeWalSidecars();
  resetDbInstance();
  const row = db.prepare("PRAGMA integrity_check").get();
  const status = row?.integrity_check ?? row?.["integrity_check"];
  if (status !== "ok") {
    throw new Error(`Restored database failed integrity check: ${status}`);
  }
  return db;
};

const SECTIONS = ["dashboard", "currencies", "customers", "users", "roles", "orders", "transfers", "accounts", "expenses", "profit", "wallets", "referenceRates"];

const ensureSchema = () => {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS currencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      baseRateBuy REAL NOT NULL,
      conversionRateBuy REAL NOT NULL,
      baseRateSell REAL NOT NULL,
      conversionRateSell REAL NOT NULL,
      active INTEGER DEFAULT 1
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      remarks TEXT,
      customerType TEXT NOT NULL DEFAULT 'individual'
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId INTEGER NOT NULL,
      paymentType TEXT NOT NULL,
      networkChain TEXT,
      walletAddresses TEXT,
      bankName TEXT,
      accountTitle TEXT,
      accountNumber TEXT,
      accountIban TEXT,
      swiftCode TEXT,
      bankAddress TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customerId) REFERENCES customers(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL
    );`,
  ).run();

  // Ensure password column exists for legacy databases
  const userColumns = db.prepare("PRAGMA table_info(users);").all();
  const userColumnNames = userColumns.map((col) => col.name);
  if (!userColumnNames.includes("password")) {
    db.prepare("ALTER TABLE users ADD COLUMN password TEXT;").run();
  }
  if (!userColumnNames.includes("displayBgColor")) {
    db.prepare("ALTER TABLE users ADD COLUMN displayBgColor TEXT;").run();
  }
  if (!userColumnNames.includes("displayTextColor")) {
    db.prepare("ALTER TABLE users ADD COLUMN displayTextColor TEXT;").run();
  }
  if (!userColumnNames.includes("sidebarBgColor")) {
    db.prepare("ALTER TABLE users ADD COLUMN sidebarBgColor TEXT;").run();
  }
  if (!userColumnNames.includes("themeHeaderBg")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeHeaderBg TEXT;").run();
  }
  if (!userColumnNames.includes("themeCardBg")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeCardBg TEXT;").run();
  }
  if (!userColumnNames.includes("themeBorder")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeBorder TEXT;").run();
  }
  if (!userColumnNames.includes("themeTextPrimary")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeTextPrimary TEXT;").run();
  }
  if (!userColumnNames.includes("themeTextSecondary")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeTextSecondary TEXT;").run();
  }
  if (!userColumnNames.includes("themeSidebarNavText")) {
    db.prepare("ALTER TABLE users ADD COLUMN themeSidebarNavText TEXT;").run();
  }
  if (!userColumnNames.includes("totpSecret")) {
    db.prepare("ALTER TABLE users ADD COLUMN totpSecret TEXT;").run();
  }
  if (!userColumnNames.includes("totpPendingSecret")) {
    db.prepare("ALTER TABLE users ADD COLUMN totpPendingSecret TEXT;").run();
  }
  if (!userColumnNames.includes("totpEnabled")) {
    db.prepare("ALTER TABLE users ADD COLUMN totpEnabled INTEGER NOT NULL DEFAULT 0;").run();
  }
  if (!userColumnNames.includes("failedLoginAttempts")) {
    db.prepare("ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER NOT NULL DEFAULT 0;").run();
  }
  if (!userColumnNames.includes("loginLockPhase")) {
    db.prepare("ALTER TABLE users ADD COLUMN loginLockPhase INTEGER NOT NULL DEFAULT 0;").run();
  }
  if (!userColumnNames.includes("loginLockedUntil")) {
    db.prepare("ALTER TABLE users ADD COLUMN loginLockedUntil TEXT;").run();
  }
  if (!userColumnNames.includes("isSuspended")) {
    db.prepare("ALTER TABLE users ADD COLUMN isSuspended INTEGER NOT NULL DEFAULT 0;").run();
  }

  db.prepare(
    `CREATE TABLE IF NOT EXISTS auth_email_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      codeHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_user_purpose
     ON auth_email_tokens(userId, purpose, usedAt, expiresAt);`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_kyc_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId INTEGER NOT NULL UNIQUE,
      schemaVersion INTEGER NOT NULL DEFAULT 1,
      answersJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
      submittedAt TEXT,
      submittedBy INTEGER,
      reviewedAt TEXT,
      reviewedBy INTEGER,
      rejectionReason TEXT,
      kycCustomerType TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT,
      FOREIGN KEY(customerId) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY(submittedBy) REFERENCES users(id),
      FOREIGN KEY(reviewedBy) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_kyc_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId INTEGER NOT NULL,
      profileId INTEGER NOT NULL,
      documentCode TEXT NOT NULL,
      filePath TEXT NOT NULL,
      originalName TEXT,
      mimeType TEXT,
      uploadedBy INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customerId) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY(profileId) REFERENCES customer_kyc_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY(uploadedBy) REFERENCES users(id),
      UNIQUE(profileId, documentCode)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      displayName TEXT NOT NULL,
      permissions TEXT NOT NULL,
      updatedAt TEXT
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS role_account_scope_settings (
      roleId INTEGER NOT NULL,
      scope TEXT NOT NULL,
      accessMode TEXT NOT NULL DEFAULT 'all',
      PRIMARY KEY (roleId, scope),
      FOREIGN KEY(roleId) REFERENCES roles(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS role_account_access (
      roleId INTEGER NOT NULL,
      scope TEXT NOT NULL,
      accountId INTEGER NOT NULL,
      PRIMARY KEY (roleId, scope, accountId),
      FOREIGN KEY(roleId) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
  ).run();
  
  // Add updatedAt column if it doesn't exist (migration)
  const roleColumns = db.prepare("PRAGMA table_info(roles);").all();
  const hasUpdatedAt = roleColumns.some((col) => col.name === "updatedAt");
  if (!hasUpdatedAt) {
    db.prepare("ALTER TABLE roles ADD COLUMN updatedAt TEXT;").run();
  }

  db.prepare(
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId INTEGER NOT NULL,
      fromCurrency TEXT NOT NULL,
      toCurrency TEXT NOT NULL,
      amountBuy REAL NOT NULL,
      amountSell REAL NOT NULL,
      rate REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      handlerId INTEGER,
      paymentType TEXT,
      networkChain TEXT,
      walletAddresses TEXT,
      bankDetails TEXT,
      orderType TEXT DEFAULT 'online',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customerId) REFERENCES customers(id),
      FOREIGN KEY(handlerId) REFERENCES users(id)
    );`,
  ).run();

  // Migration: Add orderType column if it doesn't exist
  const orderColumns = db.prepare("PRAGMA table_info(orders);").all();
  const hasOrderType = orderColumns.some((col) => col.name === "orderType");
  if (!hasOrderType) {
    db.prepare("ALTER TABLE orders ADD COLUMN orderType TEXT DEFAULT 'online';").run();
  }

  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      imagePath TEXT NOT NULL,
      amount REAL NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_beneficiaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      paymentType TEXT NOT NULL,
      networkChain TEXT,
      walletAddresses TEXT,
      bankName TEXT,
      accountTitle TEXT,
      accountNumber TEXT,
      accountIban TEXT,
      swiftCode TEXT,
      bankAddress TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      imagePath TEXT NOT NULL,
      amount REAL NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_profits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      amount REAL NOT NULL,
      currencyCode TEXT NOT NULL,
      accountId INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(accountId) REFERENCES accounts(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_service_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      amount REAL NOT NULL,
      currencyCode TEXT NOT NULL,
      accountId INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(accountId) REFERENCES accounts(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      currencyCode TEXT NOT NULL,
      name TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(currencyCode) REFERENCES currencies(code)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS account_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accountId INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS internal_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fromAccountId INTEGER NOT NULL,
      toAccountId INTEGER NOT NULL,
      amount REAL NOT NULL,
      currencyCode TEXT NOT NULL,
      description TEXT,
      transactionFee REAL,
      createdBy INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedBy INTEGER,
      updatedAt TEXT,
      FOREIGN KEY(fromAccountId) REFERENCES accounts(id),
      FOREIGN KEY(toAccountId) REFERENCES accounts(id),
      FOREIGN KEY(createdBy) REFERENCES users(id),
      FOREIGN KEY(updatedBy) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS transfer_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transferId INTEGER NOT NULL,
      changedBy INTEGER,
      changedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fromAccountId INTEGER NOT NULL,
      fromAccountName TEXT,
      toAccountId INTEGER NOT NULL,
      toAccountName TEXT,
      amount REAL NOT NULL,
      description TEXT,
      transactionFee REAL,
      FOREIGN KEY(transferId) REFERENCES internal_transfers(id) ON DELETE CASCADE,
      FOREIGN KEY(changedBy) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accountId INTEGER NOT NULL,
      amount REAL NOT NULL,
      currencyCode TEXT NOT NULL,
      description TEXT,
      imagePath TEXT,
      createdBy INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedBy INTEGER,
      updatedAt TEXT,
      deletedBy INTEGER,
      deletedAt TEXT,
      FOREIGN KEY(accountId) REFERENCES accounts(id),
      FOREIGN KEY(createdBy) REFERENCES users(id),
      FOREIGN KEY(updatedBy) REFERENCES users(id),
      FOREIGN KEY(deletedBy) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS expense_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expenseId INTEGER NOT NULL,
      changedBy INTEGER,
      changedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      accountId INTEGER NOT NULL,
      accountName TEXT,
      amount REAL NOT NULL,
      description TEXT,
      FOREIGN KEY(expenseId) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY(changedBy) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS profit_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      targetCurrencyCode TEXT NOT NULL,
      initialInvestment REAL NOT NULL DEFAULT 0,
      groups TEXT DEFAULT '[]',
      isDefault INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(targetCurrencyCode) REFERENCES currencies(code)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS profit_account_multipliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profitCalculationId INTEGER NOT NULL,
      accountId INTEGER NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1.0,
      groupId TEXT,
      groupName TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(profitCalculationId) REFERENCES profit_calculations(id) ON DELETE CASCADE,
      FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE CASCADE,
      UNIQUE(profitCalculationId, accountId)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS profit_exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profitCalculationId INTEGER NOT NULL,
      fromCurrencyCode TEXT NOT NULL,
      toCurrencyCode TEXT NOT NULL,
      rate REAL NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(profitCalculationId) REFERENCES profit_calculations(id) ON DELETE CASCADE,
      FOREIGN KEY(fromCurrencyCode) REFERENCES currencies(code),
      FOREIGN KEY(toCurrencyCode) REFERENCES currencies(code),
      UNIQUE(profitCalculationId, fromCurrencyCode, toCurrencyCode)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ).run();

  // Tags table - shared across orders, transfers, and expenses
  db.prepare(
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  ).run();

  // Tag assignments for orders
  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_tag_assignments (
      orderId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (orderId, tagId),
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
    );`,
  ).run();

  // Team-wide pinned orders (shared sort order; max enforced in app)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS order_pins (
      orderId INTEGER NOT NULL PRIMARY KEY,
      sortOrder INTEGER NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    );`,
  ).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_order_pins_sort ON order_pins (sortOrder);`).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_pins (
      customerId INTEGER NOT NULL PRIMARY KEY,
      sortOrder INTEGER NOT NULL,
      FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
    );`,
  ).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_pins_sort ON customer_pins (sortOrder);`).run();

  // Migration: legacy databases pointed order_tag_assignments.tagId to order_tags
  const orderTagFkInfo = db.prepare("PRAGMA foreign_key_list(order_tag_assignments);").all();
  const usesLegacyOrderTags = orderTagFkInfo.some((fk) => fk.table === "order_tags");
  if (usesLegacyOrderTags) {
    // Move any legacy tags into the shared tags table and rebuild the FK
    db.exec("PRAGMA foreign_keys=OFF;");
    try {
      const legacyTagsTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='order_tags';",
      ).get();
      const legacyTags = legacyTagsTable
        ? db.prepare("SELECT id, name, color, createdAt FROM order_tags;").all()
        : [];

      if (legacyTags.length > 0) {
        const insertLegacyTag = db.prepare(
          "INSERT OR IGNORE INTO tags (id, name, color, createdAt) VALUES (@id, @name, @color, COALESCE(@createdAt, CURRENT_TIMESTAMP));",
        );
        const upsertLegacyTags = db.transaction((rows) => rows.forEach((row) => insertLegacyTag.run(row)));
        upsertLegacyTags(legacyTags);
      }

      db.exec(
        `CREATE TABLE IF NOT EXISTS order_tag_assignments_new (
          orderId INTEGER NOT NULL,
          tagId INTEGER NOT NULL,
          PRIMARY KEY (orderId, tagId),
          FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
        );`,
      );

      db.exec(
        "INSERT OR IGNORE INTO order_tag_assignments_new (orderId, tagId) SELECT orderId, tagId FROM order_tag_assignments;",
      );
      db.exec("DROP TABLE order_tag_assignments;");
      db.exec("ALTER TABLE order_tag_assignments_new RENAME TO order_tag_assignments;");
      db.exec("DROP TABLE IF EXISTS order_tags;");
    } finally {
      db.exec("PRAGMA foreign_keys=ON;");
    }
  }

  // Tag assignments for transfers
  db.prepare(
    `CREATE TABLE IF NOT EXISTS transfer_tag_assignments (
      transferId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (transferId, tagId),
      FOREIGN KEY(transferId) REFERENCES internal_transfers(id) ON DELETE CASCADE,
      FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
    );`,
  ).run();

  // Tag assignments for expenses
  db.prepare(
    `CREATE TABLE IF NOT EXISTS expense_tag_assignments (
      expenseId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      PRIMARY KEY (expenseId, tagId),
      FOREIGN KEY(expenseId) REFERENCES expenses(id) ON DELETE CASCADE,
      FOREIGN KEY(tagId) REFERENCES tags(id) ON DELETE CASCADE
    );`,
  ).run();

  // Generic approval requests table (for orders, expenses, transfers, etc.)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entityType TEXT NOT NULL,
      entityId INTEGER NOT NULL,
      requestType TEXT NOT NULL,
      requestedBy INTEGER NOT NULL,
      requestedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approvedBy INTEGER,
      approvedAt TEXT,
      rejectedBy INTEGER,
      rejectedAt TEXT,
      status TEXT NOT NULL DEFAULT 'saved',
      requestData TEXT,
      originalEntityData TEXT,
      reason TEXT NOT NULL,
      FOREIGN KEY(requestedBy) REFERENCES users(id),
      FOREIGN KEY(approvedBy) REFERENCES users(id),
      FOREIGN KEY(rejectedBy) REFERENCES users(id)
    );`,
  ).run();

  // Migration: Add originalEntityData column if it doesn't exist
  const approvalRequestColumns = db.prepare("PRAGMA table_info(approval_requests);").all();
  const hasOriginalEntityData = approvalRequestColumns.some((col) => col.name === "originalEntityData");
  if (!hasOriginalEntityData) {
    db.prepare("ALTER TABLE approval_requests ADD COLUMN originalEntityData TEXT;").run();
  }

  // Notifications table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entityType TEXT,
      entityId INTEGER,
      actionUrl TEXT,
      isRead INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );`,
  ).run();

  // TRON Wallets table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS tron_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      walletAddress TEXT NOT NULL UNIQUE,
      remarks TEXT,
      currentBalance REAL DEFAULT 0,
      lastBalanceCheck TEXT,
      amlAutoScreenTx INTEGER NOT NULL DEFAULT 1,
      isUsdtBlacklisted INTEGER NOT NULL DEFAULT 0,
      usdtBlacklistCheckedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT
    );`,
  ).run();

  // TRON Wallet Transactions table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS tron_wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      transactionHash TEXT NOT NULL UNIQUE,
      transactionType TEXT NOT NULL,
      amount REAL NOT NULL,
      fromAddress TEXT NOT NULL,
      toAddress TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      blockNumber INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(walletId) REFERENCES tron_wallets(id) ON DELETE CASCADE
    );`,
  ).run();

  // Create indexes for wallet transactions
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_wallet_transactions_walletId 
     ON tron_wallet_transactions(walletId);`,
  ).run();
  
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_wallet_transactions_timestamp 
     ON tron_wallet_transactions(timestamp DESC);`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS integration_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      providerId TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      configJson TEXT NOT NULL DEFAULT '{}',
      secretsJson TEXT NOT NULL DEFAULT '{}',
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedByUserId INTEGER,
      FOREIGN KEY(updatedByUserId) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE TABLE IF NOT EXISTS aml_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walletId INTEGER NOT NULL,
      transactionId INTEGER,
      providerId TEXT NOT NULL,
      checkType TEXT NOT NULL CHECK(checkType IN ('address', 'address_investigation', 'transaction')),
      externalUid TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      riskPercent REAL,
      riskLevel TEXT,
      isBlacklisted INTEGER NOT NULL DEFAULT 0,
      signalsJson TEXT,
      rawResponseJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdByUserId INTEGER,
      FOREIGN KEY(walletId) REFERENCES tron_wallets(id) ON DELETE CASCADE,
      FOREIGN KEY(transactionId) REFERENCES tron_wallet_transactions(id) ON DELETE SET NULL,
      FOREIGN KEY(createdByUserId) REFERENCES users(id)
    );`,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_aml_checks_walletId ON aml_checks(walletId);`,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_aml_checks_transactionId ON aml_checks(transactionId);`,
  ).run();

  // Create indexes for better performance
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user 
     ON notifications(userId);`,
  ).run();
  
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_read 
     ON notifications(userId, isRead);`,
  ).run();

  // User notification preferences table
  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL UNIQUE,
      notifyApprovalApproved INTEGER DEFAULT 1,
      notifyApprovalRejected INTEGER DEFAULT 1,
      notifyApprovalPending INTEGER DEFAULT 1,
      notifyOrderAssigned INTEGER DEFAULT 1,
      notifyOrderUnassigned INTEGER DEFAULT 1,
      notifyOrderCreated INTEGER DEFAULT 0,
      notifyOrderCompleted INTEGER DEFAULT 0,
      notifyOrderCancelled INTEGER DEFAULT 0,
      notifyOrderDeleted INTEGER DEFAULT 1,
      notifyExpenseCreated INTEGER DEFAULT 0,
      notifyExpenseDeleted INTEGER DEFAULT 1,
      notifyTransferCreated INTEGER DEFAULT 0,
      notifyTransferDeleted INTEGER DEFAULT 1,
      notifyWalletIncoming INTEGER DEFAULT 1,
      notifyWalletOutgoing INTEGER DEFAULT 1,
      enableEmailNotifications INTEGER DEFAULT 0,
      enablePushNotifications INTEGER DEFAULT 0,
      enableTelegramNotifications INTEGER DEFAULT 1,
      updatedAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );`,
  ).run();

  // Add wallet notification columns if they don't exist (for existing databases)
  const prefsColumns = db.prepare("PRAGMA table_info(user_notification_preferences)").all();
  const hasWalletIncoming = prefsColumns.some((col) => col.name === "notifyWalletIncoming");
  const hasWalletOutgoing = prefsColumns.some((col) => col.name === "notifyWalletOutgoing");
  const hasTelegramEnabled = prefsColumns.some((col) => col.name === "enableTelegramNotifications");

  if (!hasWalletIncoming) {
    db.prepare("ALTER TABLE user_notification_preferences ADD COLUMN notifyWalletIncoming INTEGER DEFAULT 1").run();
  }
  if (!hasWalletOutgoing) {
    db.prepare("ALTER TABLE user_notification_preferences ADD COLUMN notifyWalletOutgoing INTEGER DEFAULT 1").run();
  }
  if (!hasTelegramEnabled) {
    db.prepare("ALTER TABLE user_notification_preferences ADD COLUMN enableTelegramNotifications INTEGER DEFAULT 1").run();
  }

  // Customer ledger entries (standalone deposits/withdrawals per client per currency)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_ledger_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      customerId   INTEGER NOT NULL,
      currencyCode TEXT NOT NULL,
      type         TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
      amount       REAL NOT NULL CHECK(amount > 0),
      description  TEXT,
      createdBy    INTEGER,
      createdAt    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      entryDate    TEXT,
      updatedBy    INTEGER,
      updatedAt    TEXT,
      deletedBy    INTEGER,
      deletedAt    TEXT,
      FOREIGN KEY(customerId)   REFERENCES customers(id) ON DELETE RESTRICT,
      FOREIGN KEY(currencyCode) REFERENCES currencies(code),
      FOREIGN KEY(createdBy)    REFERENCES users(id),
      FOREIGN KEY(updatedBy)    REFERENCES users(id),
      FOREIGN KEY(deletedBy)    REFERENCES users(id)
    );`,
  ).run();

  // Audit log for edits to customer ledger entries
  db.prepare(
    `CREATE TABLE IF NOT EXISTS customer_ledger_entry_changes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      entryId      INTEGER NOT NULL,
      changedBy    INTEGER,
      changedAt    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      type         TEXT NOT NULL,
      amount       REAL NOT NULL,
      description  TEXT,
      currencyCode TEXT NOT NULL,
      FOREIGN KEY(entryId)   REFERENCES customer_ledger_entries(id) ON DELETE CASCADE,
      FOREIGN KEY(changedBy) REFERENCES users(id)
    );`,
  ).run();

  // Indexes for ledger performance
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ledger_customer
     ON customer_ledger_entries(customerId);`,
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ledger_customer_currency
     ON customer_ledger_entries(customerId, currencyCode);`,
  ).run();

  ensureCustomerLedgerOrderColumns();
  ensureCustomerLedgerAccountColumns();
  ensureOrderReceiptFundedFromColumn();
  ensureOrderPaymentFundedFromColumn();
};

/** Order-linked customer ledger columns (idempotent; safe on every startup and API call). */
export function ensureCustomerLedgerOrderColumns() {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_ledger_entries';")
    .get();
  if (!table) return;

  const columnNames = () =>
    db.prepare("PRAGMA table_info(customer_ledger_entries);").all().map((c) => c.name);

  if (!columnNames().includes("orderId")) {
    db.prepare("ALTER TABLE customer_ledger_entries ADD COLUMN orderId INTEGER REFERENCES orders(id);").run();
  }
  if (!columnNames().includes("source")) {
    db.prepare(
      "ALTER TABLE customer_ledger_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';",
    ).run();
  }
  if (!columnNames().includes("reversalReason")) {
    db.prepare("ALTER TABLE customer_ledger_entries ADD COLUMN reversalReason TEXT;").run();
  }
  if (!columnNames().includes("leg")) {
    db.prepare("ALTER TABLE customer_ledger_entries ADD COLUMN leg TEXT;").run();
  }
  if (!columnNames().includes("ledgerBatch")) {
    db.prepare("ALTER TABLE customer_ledger_entries ADD COLUMN ledgerBatch INTEGER;").run();
  }
  if (!columnNames().includes("reversesBatch")) {
    db.prepare("ALTER TABLE customer_ledger_entries ADD COLUMN reversesBatch INTEGER;").run();
  }
  if (!columnNames().includes("accountId")) {
    db.prepare(
      "ALTER TABLE customer_ledger_entries ADD COLUMN accountId INTEGER REFERENCES accounts(id);",
    ).run();
  }

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ledger_order
     ON customer_ledger_entries(orderId);`,
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ledger_account
     ON customer_ledger_entries(accountId);`,
  ).run();
}

/** Manual ledger ↔ company account link (idempotent). */
export function ensureCustomerLedgerAccountColumns() {
  ensureCustomerLedgerOrderColumns();

  const txCols = db.prepare("PRAGMA table_info(account_transactions);").all().map((c) => c.name);
  if (!txCols.includes("ledgerEntryId")) {
    db.prepare(
      "ALTER TABLE account_transactions ADD COLUMN ledgerEntryId INTEGER REFERENCES customer_ledger_entries(id) ON DELETE SET NULL;",
    ).run();
  }
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_account_tx_ledger_entry
     ON account_transactions(ledgerEntryId);`,
  ).run();
}

export function ensureOrderReceiptFundedFromColumn() {
  const receiptTableInfo = db.prepare("PRAGMA table_info(order_receipts)").all();
  const receiptColumnNames = receiptTableInfo.map((col) => col.name);
  if (!receiptColumnNames.includes("fundedFrom")) {
    db.prepare(
      "ALTER TABLE order_receipts ADD COLUMN fundedFrom TEXT NOT NULL DEFAULT 'cash';",
    ).run();
    db.prepare("UPDATE order_receipts SET fundedFrom = 'cash' WHERE fundedFrom IS NULL;").run();
  }
}

export function ensureOrderPaymentFundedFromColumn() {
  const paymentTableInfo = db.prepare("PRAGMA table_info(order_payments)").all();
  const paymentColumnNames = paymentTableInfo.map((col) => col.name);
  if (!paymentColumnNames.includes("fundedFrom")) {
    db.prepare(
      "ALTER TABLE order_payments ADD COLUMN fundedFrom TEXT NOT NULL DEFAULT 'cash';",
    ).run();
    db.prepare("UPDATE order_payments SET fundedFrom = 'cash' WHERE fundedFrom IS NULL;").run();
  }
}

const seedData = () => {
  const currencyCount = db.prepare("SELECT COUNT(*) as count FROM currencies").get().count;
  if (currencyCount === 0) {
    const insert = db.prepare(
      `INSERT INTO currencies (code, name, baseRateBuy, conversionRateBuy, baseRateSell, conversionRateSell, active)
       VALUES (@code, @name, @baseRateBuy, @conversionRateBuy, @baseRateSell, @conversionRateSell, @active);`,
    );
    const seed = [
      {
        code: "USD",
        name: "US Dollar",
        baseRateBuy: 1.0,
        conversionRateBuy: 1.0,
        baseRateSell: 1.0,
        conversionRateSell: 1.0,
        active: 1,
      },
      {
        code: "EUR",
        name: "Euro",
        baseRateBuy: 1.08,
        conversionRateBuy: 1.085,
        baseRateSell: 1.075,
        conversionRateSell: 1.08,
        active: 1,
      },
      {
        code: "GBP",
        name: "British Pound",
        baseRateBuy: 1.25,
        conversionRateBuy: 1.255,
        baseRateSell: 1.245,
        conversionRateSell: 1.25,
        active: 1,
      },
    ];
    const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
    insertMany(seed);
  }

  {/*我 remove customers seed data*/}
/*   const customerCount = db.prepare("SELECT COUNT(*) as count FROM customers").get().count;
  if (customerCount === 0) {
    const insert = db.prepare(
      `INSERT INTO customers (name, email, phone) VALUES (@name, @email, @phone);`,
    );
    const seed = [
      { name: "John Doe", email: "john@example.com", phone: "+1-555-0101" },
      { name: "Sophie Yang", email: "sophie@example.com", phone: "+1-555-0102" },
      { name: "Michael Chen", email: "michael@example.com", phone: "+1-555-0103" },
    ];
    const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
    insertMany(seed);
  } */

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  if (userCount === 0) {
    const insert = db.prepare(
      `INSERT INTO users (name, email, password, role) VALUES (@name, @email, @password, @role);`,
    );
    const seed = [
      { name: "Admin", email: "admin@test.com", password: "$2a$10$5THacbZ24lgrg1X/yIwNCernzsTWIJQLakSAdhpJ6R8AAWJXq5Ycm", role: "admin" }, // password: admin123
    ];
    const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
    insertMany(seed);
  }

  const roleCount = db.prepare("SELECT COUNT(*) as count FROM roles").get().count;
  if (roleCount === 0) {
    const insert = db.prepare(
      `INSERT INTO roles (name, displayName, permissions) VALUES (@name, @displayName, @permissions);`,
    );
    const basePermissions = [
      {
        name: "admin",
        displayName: "Admin",
        permissions: {
          sections: SECTIONS,
          actions: {
            createCustomer: true,
            formatCustomerColors: true,
            updateCustomer: true,
            pinCustomers: true,
            deleteCustomer: true,
            submitCustomerKyc: true,
            approveCustomerKyc: true,
            reopenCustomerKyc: true,
            manageKycPolicy: true,
            viewCustomerLedger: true,
            createLedgerDepositWithdraw: true,
            editDeleteCustomerLedger: true,
            createUser: true,
            createOrder: true,
            createCurrency: true,
            updateCurrency: true,
            cancelOrder: true,
            editAnyOrder: true,
            deleteOrder: true,
            deleteManyOrders: true,
            pinOrders: true,
            editReferenceRates: true,
            displayReferenceRatesPanel: true,
          },
        },
      },
      {
        name: "manager",
        displayName: "Manager",
        permissions: {
          sections: ["dashboard", "currencies", "customers", "orders"],
          actions: {
            createCustomer: true,
            createOrder: true,
            createCurrency: true,
            updateCurrency: true,
            cancelOrder: true,
          },
        },
      },
      {
        name: "viewer",
        displayName: "Viewer",
        permissions: {
          sections: ["dashboard", "orders"],
          actions: {},
        },
      },
    ];
    const insertMany = db.transaction((rows) =>
      rows.forEach((row) =>
        insert.run({
          name: row.name,
          displayName: row.displayName,
          permissions: JSON.stringify(row.permissions),
        }),
      ),
    );
    insertMany(basePermissions);
  }

/*
  const orderCount = db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
  if (orderCount === 0) {
    // Get actual customer IDs from the database
    const getCustomerId = db.prepare("SELECT id FROM customers WHERE email = ?");
    const customer1 = getCustomerId.get("john@example.com");
    const customer2 = getCustomerId.get("sophie@example.com");
    
     // Only seed orders if we have at least 2 customers
    if (customer1 && customer2) {
      const insert = db.prepare(
        `INSERT INTO orders (customerId, fromCurrency, toCurrency, amountBuy, amountSell, rate, status, createdAt)
         VALUES (@customerId, @fromCurrency, @toCurrency, @amountBuy, @amountSell, @rate, @status, @createdAt);`,
      );
      const nowIso = () => new Date().toISOString();
      const seed = [
        {
          customerId: customer1.id,
          fromCurrency: "USD",
          toCurrency: "EUR",
          amountBuy: 5400,
          amountSell: 5000,
          rate: 1.08,
          status: "pending",
          createdAt: nowIso(),
        },
        {
          customerId: customer2.id,
          fromCurrency: "GBP",
          toCurrency: "USD",
          amountBuy: 4000,
          amountSell: 3200,
          rate: 1.25,
          status: "completed",
          createdAt: nowIso(),
        },
      ];
      const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
      insertMany(seed);
    } 
  } */
};

const migrateDatabase = () => {
  // Check if new columns exist, if not add them
  try {
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const columnNames = tableInfo.map((col) => col.name);
    
    if (!columnNames.includes("handlerId")) {
      db.prepare("ALTER TABLE orders ADD COLUMN handlerId INTEGER REFERENCES users(id)").run();
    }
    if (!columnNames.includes("paymentType")) {
      db.prepare("ALTER TABLE orders ADD COLUMN paymentType TEXT").run();
    }
    if (!columnNames.includes("networkChain")) {
      db.prepare("ALTER TABLE orders ADD COLUMN networkChain TEXT").run();
    }
    if (!columnNames.includes("walletAddresses")) {
      db.prepare("ALTER TABLE orders ADD COLUMN walletAddresses TEXT").run();
    }
    if (!columnNames.includes("bankDetails")) {
      db.prepare("ALTER TABLE orders ADD COLUMN bankDetails TEXT").run();
    }
    if (!columnNames.includes("buyAccountId")) {
      db.prepare("ALTER TABLE orders ADD COLUMN buyAccountId INTEGER REFERENCES accounts(id)").run();
    }
    if (!columnNames.includes("sellAccountId")) {
      db.prepare("ALTER TABLE orders ADD COLUMN sellAccountId INTEGER REFERENCES accounts(id)").run();
    }
    if (!columnNames.includes("paymentFlow")) {
      db.prepare("ALTER TABLE orders ADD COLUMN paymentFlow TEXT DEFAULT 'receive_first'").run();
    }
    if (!columnNames.includes("actualAmountBuy")) {
      db.prepare("ALTER TABLE orders ADD COLUMN actualAmountBuy REAL").run();
    }
    if (!columnNames.includes("actualAmountSell")) {
      db.prepare("ALTER TABLE orders ADD COLUMN actualAmountSell REAL").run();
    }
    if (!columnNames.includes("actualRate")) {
      db.prepare("ALTER TABLE orders ADD COLUMN actualRate REAL").run();
    }
    if (!columnNames.includes("isFlexOrder")) {
      db.prepare("ALTER TABLE orders ADD COLUMN isFlexOrder INTEGER DEFAULT 0").run();
    }
    if (!columnNames.includes("serviceChargeAmount")) {
      db.prepare("ALTER TABLE orders ADD COLUMN serviceChargeAmount REAL").run();
    }
    if (!columnNames.includes("serviceChargeCurrency")) {
      db.prepare("ALTER TABLE orders ADD COLUMN serviceChargeCurrency TEXT").run();
    }
    if (!columnNames.includes("profitAmount")) {
      db.prepare("ALTER TABLE orders ADD COLUMN profitAmount REAL").run();
    }
    if (!columnNames.includes("profitCurrency")) {
      db.prepare("ALTER TABLE orders ADD COLUMN profitCurrency TEXT").run();
    }
    if (!columnNames.includes("profitAccountId")) {
      db.prepare("ALTER TABLE orders ADD COLUMN profitAccountId INTEGER REFERENCES accounts(id)").run();
    }
    if (!columnNames.includes("serviceChargeAccountId")) {
      db.prepare("ALTER TABLE orders ADD COLUMN serviceChargeAccountId INTEGER REFERENCES accounts(id)").run();
    }
    if (!columnNames.includes("remarks")) {
      db.prepare("ALTER TABLE orders ADD COLUMN remarks TEXT").run();
    }
    if (!columnNames.includes("createdBy")) {
      db.prepare("ALTER TABLE orders ADD COLUMN createdBy INTEGER REFERENCES users(id)").run();
    }
    if (!columnNames.includes("orderDate")) {
      db.prepare("ALTER TABLE orders ADD COLUMN orderDate TEXT").run();
    }

    // Best-effort: older rows had NULL createdBy; copy handler user when present so "Created by" can resolve.
    const ordersColNames = db.prepare("PRAGMA table_info(orders)").all().map((col) => col.name);
    if (ordersColNames.includes("createdBy") && ordersColNames.includes("handlerId")) {
      db.prepare(
        "UPDATE orders SET createdBy = handlerId WHERE createdBy IS NULL AND handlerId IS NOT NULL",
      ).run();
    }

    // Check customers table for remarks column
    const customerTableInfo = db.prepare("PRAGMA table_info(customers)").all();
    const customerColumnNames = customerTableInfo.map((col) => col.name);
    
    if (!customerColumnNames.includes("remarks")) {
      db.prepare("ALTER TABLE customers ADD COLUMN remarks TEXT").run();
    }
    if (!customerColumnNames.includes("customerType")) {
      db.prepare("ALTER TABLE customers ADD COLUMN customerType TEXT NOT NULL DEFAULT 'individual'").run();
    }
    if (!customerColumnNames.includes("displayBgColor")) {
      db.prepare("ALTER TABLE customers ADD COLUMN displayBgColor TEXT").run();
    }
    if (!customerColumnNames.includes("displayTextColor")) {
      db.prepare("ALTER TABLE customers ADD COLUMN displayTextColor TEXT").run();
    }

    const kycProfileCols = db.prepare("PRAGMA table_info(customer_kyc_profiles)").all().map((c) => c.name);
    if (!kycProfileCols.includes("kycCustomerType")) {
      db.prepare("ALTER TABLE customer_kyc_profiles ADD COLUMN kycCustomerType TEXT").run();
    }

    // Check order_payments table for new columns
    const paymentTableInfo = db.prepare("PRAGMA table_info(order_payments)").all();
    const paymentColumnNames = paymentTableInfo.map((col) => col.name);
    
    if (!paymentColumnNames.includes("accountId")) {
      db.prepare("ALTER TABLE order_payments ADD COLUMN accountId INTEGER REFERENCES accounts(id)").run();
    }

    // Check order_receipts table for new columns
    const receiptTableInfo = db.prepare("PRAGMA table_info(order_receipts)").all();
    const receiptColumnNames = receiptTableInfo.map((col) => col.name);
    
    if (!receiptColumnNames.includes("accountId")) {
      db.prepare("ALTER TABLE order_receipts ADD COLUMN accountId INTEGER REFERENCES accounts(id)").run();
    }
    if (!receiptColumnNames.includes("status")) {
      // Default existing records to 'confirmed' to maintain backward compatibility
      db.prepare("ALTER TABLE order_receipts ADD COLUMN status TEXT DEFAULT 'confirmed'").run();
      // Update all existing records to confirmed
      db.prepare("UPDATE order_receipts SET status = 'confirmed' WHERE status IS NULL").run();
    }
    ensureOrderReceiptFundedFromColumn();
    ensureOrderPaymentFundedFromColumn();

    // Check order_payments table for status column
    if (!paymentColumnNames.includes("status")) {
      // Default existing records to 'confirmed' to maintain backward compatibility
      db.prepare("ALTER TABLE order_payments ADD COLUMN status TEXT DEFAULT 'confirmed'").run();
      // Update all existing records to confirmed
      db.prepare("UPDATE order_payments SET status = 'confirmed' WHERE status IS NULL").run();
    }

    // Check expenses table for type column
    const expenseTableInfo = db.prepare("PRAGMA table_info(expenses)").all();
    const expenseColumnNames = expenseTableInfo.map((col) => col.name);
    if (!expenseColumnNames.includes("type")) {
      db.prepare("ALTER TABLE expenses ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'").run();
      // Also add type to expense_changes for audit trail
      db.prepare("ALTER TABLE expense_changes ADD COLUMN type TEXT NOT NULL DEFAULT 'expense'").run();
    }
    if (!expenseColumnNames.includes("entryDate")) {
      db.prepare("ALTER TABLE expenses ADD COLUMN entryDate TEXT").run();
    }

    // Check transfers table for new columns
    const transferTableInfo = db.prepare("PRAGMA table_info(internal_transfers)").all();
    const transferColumnNames = transferTableInfo.map((col) => col.name);
    
    if (!transferColumnNames.includes("updatedBy")) {
      db.prepare("ALTER TABLE internal_transfers ADD COLUMN updatedBy INTEGER REFERENCES users(id)").run();
    }
    if (!transferColumnNames.includes("updatedAt")) {
      db.prepare("ALTER TABLE internal_transfers ADD COLUMN updatedAt TEXT").run();
    }
    if (!transferColumnNames.includes("transactionFee")) {
      db.prepare("ALTER TABLE internal_transfers ADD COLUMN transactionFee REAL").run();
    }

    // Check transfer_changes table for new columns
    const transferChangesTableInfo = db.prepare("PRAGMA table_info(transfer_changes)").all();
    const transferChangesColumnNames = transferChangesTableInfo.map((col) => col.name);
    
    if (!transferChangesColumnNames.includes("transactionFee")) {
      db.prepare("ALTER TABLE transfer_changes ADD COLUMN transactionFee REAL").run();
    }
    if (!transferColumnNames.includes("entryDate")) {
      db.prepare("ALTER TABLE internal_transfers ADD COLUMN entryDate TEXT").run();
    }
    if (!transferColumnNames.includes("imagePath")) {
      db.prepare("ALTER TABLE internal_transfers ADD COLUMN imagePath TEXT").run();
    }

    // Check profit_calculations table for groups column
    const profitCalcTableInfo = db.prepare("PRAGMA table_info(profit_calculations)").all();
    const profitCalcColumnNames = profitCalcTableInfo.map((col) => col.name);
    
    if (!profitCalcColumnNames.includes("groups")) {
      db.prepare("ALTER TABLE profit_calculations ADD COLUMN groups TEXT DEFAULT '[]'").run();
    }
    
    // Check profit_calculations table for isDefault column
    if (!profitCalcColumnNames.includes("isDefault")) {
      db.prepare("ALTER TABLE profit_calculations ADD COLUMN isDefault INTEGER NOT NULL DEFAULT 0").run();
    }

    const currencyTableInfo = db.prepare("PRAGMA table_info(currencies)").all();
    const currencyColumnNames = currencyTableInfo.map((col) => col.name);
    if (!currencyColumnNames.includes("displayBgColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN displayBgColor TEXT").run();
    }
    if (!currencyColumnNames.includes("displayPositiveColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN displayPositiveColor TEXT").run();
    }
    if (!currencyColumnNames.includes("displayNegativeColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN displayNegativeColor TEXT").run();
    }
    if (!currencyColumnNames.includes("codeDisplaySameAsAmount")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN codeDisplaySameAsAmount INTEGER DEFAULT 1").run();
    }
    if (!currencyColumnNames.includes("codeDisplayBgColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN codeDisplayBgColor TEXT").run();
    }
    if (!currencyColumnNames.includes("codeDisplayPositiveColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN codeDisplayPositiveColor TEXT").run();
    }
    if (!currencyColumnNames.includes("codeDisplayNegativeColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN codeDisplayNegativeColor TEXT").run();
    }
    if (!currencyColumnNames.includes("amountDisplayMode")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN amountDisplayMode TEXT DEFAULT 'code'").run();
    }
    if (!currencyColumnNames.includes("currencySymbol")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN currencySymbol TEXT").run();
    }
    if (!currencyColumnNames.includes("accountPoolDisplayBgColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN accountPoolDisplayBgColor TEXT").run();
    }
    if (!currencyColumnNames.includes("accountPoolDisplayTextColor")) {
      db.prepare("ALTER TABLE currencies ADD COLUMN accountPoolDisplayTextColor TEXT").run();
    }

    const accountTableInfo = db.prepare("PRAGMA table_info(accounts)").all();
    const accountColumnNames = accountTableInfo.map((col) => col.name);
    if (!accountColumnNames.includes("displayBgColor")) {
      db.prepare("ALTER TABLE accounts ADD COLUMN displayBgColor TEXT").run();
    }
    if (!accountColumnNames.includes("displayTextColor")) {
      db.prepare("ALTER TABLE accounts ADD COLUMN displayTextColor TEXT").run();
    }

    db.prepare(
      `CREATE TABLE IF NOT EXISTS order_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId INTEGER NOT NULL,
        changedBy INTEGER,
        changedAt TEXT NOT NULL,
        beforeJson TEXT,
        afterJson TEXT,
        FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(changedBy) REFERENCES users(id)
      );`,
    ).run();

    // KYC schema versioning table (v2 builder)
  db.prepare(
    `CREATE TABLE IF NOT EXISTS kyc_schema_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerType TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
      schemaJson TEXT NOT NULL,
      publishedAt TEXT,
      publishedBy INTEGER,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdBy INTEGER,
      FOREIGN KEY(publishedBy) REFERENCES users(id),
      FOREIGN KEY(createdBy) REFERENCES users(id)
    );`,
  ).run();
  db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_schema_draft ON kyc_schema_versions(customerType) WHERE status='draft';`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS _schema_migrations (key TEXT PRIMARY KEY);`).run();

    const globalOrderPinsMigrated = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("global_order_pins_v1");
    if (!globalOrderPinsMigrated) {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS order_pins (
          orderId INTEGER NOT NULL PRIMARY KEY,
          sortOrder INTEGER NOT NULL,
          FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
        );`,
      ).run();
      const userPinsTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_order_pins'")
        .get();
      if (userPinsTable) {
        const rows = db
          .prepare(
            `SELECT orderId, MIN(sortOrder) AS m
             FROM user_order_pins
             GROUP BY orderId
             ORDER BY m ASC
             LIMIT 10`,
          )
          .all();
        const insert = db.prepare("INSERT OR REPLACE INTO order_pins (orderId, sortOrder) VALUES (?, ?);");
        rows.forEach((r, i) => insert.run(r.orderId, i));
        db.exec("DROP TABLE IF EXISTS user_order_pins;");
      }
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('global_order_pins_v1')").run();
    }

    const customerPinsMigrated = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("customer_pins_v1");
    if (!customerPinsMigrated) {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS customer_pins (
          customerId INTEGER NOT NULL PRIMARY KEY,
          sortOrder INTEGER NOT NULL,
          FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
        );`,
      ).run();
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_customer_pins_sort ON customer_pins (sortOrder);`,
      ).run();
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('customer_pins_v1')").run();
    }

    const underProcessMigrated = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("merge_under_process_to_pending_v1");
    if (!underProcessMigrated) {
      db.prepare("UPDATE orders SET status = 'pending' WHERE status = 'under_process'").run();
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('merge_under_process_to_pending_v1')").run();
    }

    const ordersThreeStatus = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("orders_three_status_v1");
    if (!ordersThreeStatus) {
      db.prepare(
        `UPDATE orders SET status = 'saved' WHERE status IN ('pending', 'under_process', 'pending_amend', 'pending_delete')`,
      ).run();
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('orders_three_status_v1')").run();
    }

    const ledgerOrderColumnsMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("customer_ledger_order_columns_v1");
    if (!ledgerOrderColumnsMigration) {
      ensureCustomerLedgerOrderColumns();
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('customer_ledger_order_columns_v1')").run();
    }

    const ledgerAccountColumnsMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("customer_ledger_account_columns_v1");
    if (!ledgerAccountColumnsMigration) {
      ensureCustomerLedgerAccountColumns();
      ensureOrderReceiptFundedFromColumn();
    ensureOrderPaymentFundedFromColumn();
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('customer_ledger_account_columns_v1')").run();
    }

    // Migrate existing roles to include "profit" and "wallets" sections if not present
    const roles = db.prepare("SELECT id, permissions FROM roles").all();
    roles.forEach((role) => {
      try {
        const permissions = JSON.parse(role.permissions);
        let updated = false;
        
        if (permissions.sections && !permissions.sections.includes("profit")) {
          permissions.sections.push("profit");
          updated = true;
        }
        
        if (permissions.sections && !permissions.sections.includes("wallets")) {
          permissions.sections.push("wallets");
          updated = true;
        }
        
        if (updated) {
          db.prepare("UPDATE roles SET permissions = @permissions, updatedAt = @updatedAt WHERE id = @id").run({
            id: role.id,
            permissions: JSON.stringify(permissions),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error(`Error migrating role ${role.id}:`, error);
      }
    });

    // Grant pinOrders to admin role if missing (team-wide order pins)
    const adminRole = db.prepare("SELECT id, permissions FROM roles WHERE name = 'admin'").get();
    if (adminRole?.permissions) {
      try {
        const permissions = JSON.parse(adminRole.permissions);
        if (!permissions.actions) permissions.actions = {};
        if (permissions.actions.pinOrders !== true) {
          permissions.actions.pinOrders = true;
          db.prepare("UPDATE roles SET permissions = @permissions, updatedAt = @updatedAt WHERE id = @id").run({
            id: adminRole.id,
            permissions: JSON.stringify(permissions),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error("Error migrating admin pinOrders permission:", e);
      }
    }

    const referenceRatesMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("reference_rates_permissions_v1");
    if (!referenceRatesMigration) {
      const rolesForRef = db.prepare("SELECT id, name, permissions FROM roles").all();
      rolesForRef.forEach((role) => {
        try {
          const permissions = JSON.parse(role.permissions);
          let updated = false;
          if (permissions.sections && !permissions.sections.includes("referenceRates")) {
            if (role.name === "admin") {
              permissions.sections.push("referenceRates");
              updated = true;
            }
          }
          if (!permissions.actions) permissions.actions = {};
          if (role.name === "admin" && permissions.actions.editReferenceRates !== true) {
            permissions.actions.editReferenceRates = true;
            updated = true;
          }
          if (role.name === "admin" && permissions.actions.displayReferenceRatesPanel !== true) {
            permissions.actions.displayReferenceRatesPanel = true;
            updated = true;
          }
          if (updated) {
            db.prepare("UPDATE roles SET permissions = @permissions, updatedAt = @updatedAt WHERE id = @id").run({
              id: role.id,
              permissions: JSON.stringify(permissions),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`Error migrating reference rates permissions for role ${role.id}:`, error);
        }
      });
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('reference_rates_permissions_v1')").run();
    }

    const referenceRatesPanelMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("reference_rates_panel_display_v1");
    if (!referenceRatesPanelMigration) {
      const rolesForPanel = db.prepare("SELECT id, name, permissions FROM roles").all();
      rolesForPanel.forEach((role) => {
        try {
          const permissions = JSON.parse(role.permissions);
          if (!permissions.actions) permissions.actions = {};
          if (permissions.actions.displayReferenceRatesPanel !== true) {
            permissions.actions.displayReferenceRatesPanel = true;
            db.prepare("UPDATE roles SET permissions = @permissions, updatedAt = @updatedAt WHERE id = @id").run({
              id: role.id,
              permissions: JSON.stringify(permissions),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`Error migrating reference rates panel permission for role ${role.id}:`, error);
        }
      });
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('reference_rates_panel_display_v1')").run();
    }

    const customerPermissionsMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("customer_permissions_v1");
    if (!customerPermissionsMigration) {
      const allCustomerActions = {
        createCustomer: true,
        formatCustomerColors: true,
        updateCustomer: true,
        pinCustomers: true,
        deleteCustomer: true,
        submitCustomerKyc: true,
        approveCustomerKyc: true,
        reopenCustomerKyc: true,
        manageKycPolicy: true,
        viewCustomerLedger: true,
        createLedgerDepositWithdraw: true,
        editDeleteCustomerLedger: true,
      };
      const rolesForCustomers = db.prepare("SELECT id, name, permissions FROM roles").all();
      rolesForCustomers.forEach((role) => {
        try {
          const permissions = JSON.parse(role.permissions);
          if (!permissions.actions) permissions.actions = {};
          let updated = false;
          if (role.name === "admin") {
            Object.entries(allCustomerActions).forEach(([key, value]) => {
              if (permissions.actions[key] !== value) {
                permissions.actions[key] = value;
                updated = true;
              }
            });
          }
          if (permissions.actions.pinOrders === true && permissions.actions.pinCustomers !== true) {
            permissions.actions.pinCustomers = true;
            updated = true;
          }
          if (updated) {
            db.prepare("UPDATE roles SET permissions = @permissions, updatedAt = @updatedAt WHERE id = @id").run({
              id: role.id,
              permissions: JSON.stringify(permissions),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`Error migrating customer permissions for role ${role.id}:`, error);
        }
      });
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('customer_permissions_v1')").run();
    }

    const tronWalletAmlAutoScreenMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("tron_wallets_aml_auto_screen_tx_v1");
    if (!tronWalletAmlAutoScreenMigration) {
      const walletCols = db.prepare("PRAGMA table_info(tron_wallets)").all().map((c) => c.name);
      if (!walletCols.includes("amlAutoScreenTx")) {
        db.prepare(
          "ALTER TABLE tron_wallets ADD COLUMN amlAutoScreenTx INTEGER NOT NULL DEFAULT 1",
        ).run();
      }
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('tron_wallets_aml_auto_screen_tx_v1')").run();
    }

    const tronWalletUsdtBlacklistMigration = db
      .prepare("SELECT 1 FROM _schema_migrations WHERE key = ?")
      .get("tron_wallets_usdt_blacklist_v1");
    if (!tronWalletUsdtBlacklistMigration) {
      const walletCols = db.prepare("PRAGMA table_info(tron_wallets)").all().map((c) => c.name);
      if (!walletCols.includes("isUsdtBlacklisted")) {
        db.prepare(
          "ALTER TABLE tron_wallets ADD COLUMN isUsdtBlacklisted INTEGER NOT NULL DEFAULT 0",
        ).run();
      }
      if (!walletCols.includes("usdtBlacklistCheckedAt")) {
        db.prepare("ALTER TABLE tron_wallets ADD COLUMN usdtBlacklistCheckedAt TEXT").run();
      }
      db.prepare("INSERT INTO _schema_migrations (key) VALUES ('tron_wallets_usdt_blacklist_v1')").run();
    }
  } catch (error) {
    console.error("Migration error:", error);
  }
};

export const initDatabase = () => {
  try {
    ensureSchema();
    migrateDatabase();
    seedData();
    ensureBootstrapAdmin();
    console.log('Database initialization completed');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error; // Re-throw to be caught by app.js
  }
};

export const DB_CONSTANTS = {
  SECTIONS,
};


