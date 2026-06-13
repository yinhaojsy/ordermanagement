import { db } from "../db.js";
import { getUserIdFromHeader } from "../utils/auth.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";
import {
  buildAccountStatementRows,
  rebuildCustomerLedgerFromOrders,
} from "../services/customerLedgerOrders.js";
import {
  getAllCustomersFundingBalances,
  getCustomerFundingBalances,
} from "../services/customerFundingBalances.js";
import {
  getAllCustomersTradeProfitLoss,
  getCustomerTradeProfitLoss,
} from "../services/customerTradeProfitLoss.js";
import {
  getCustomerDepositByCurrency,
  getCustomerDepositTotalsByCurrency,
  getCustomerDepositTraceEntries,
} from "../services/customerDepositTotals.js";
import { buildDepositAccountStatementRows } from "../services/customerDepositAccountStatement.js";
import {
  applyLedgerAccountTransaction,
  assertAllocatableBalance,
  buildLedgerAccountDescription,
  getAllocatableCustomerBalance,
  getAllocatableCustomerOwed,
  getCustomerCurrencyBalance,
  getFundedCustomerCurrencyBalance,
  getEffectiveFundedBalance,
  getTradePositionBalance,
  reverseLedgerAccountTransaction,
  validateLedgerAccount,
} from "../services/customerLedgerAccounts.js";

const ENTRY_SELECT = `
  SELECT
    e.*,
    c.name  AS customerName,
    acc.name AS accountName,
    u1.name AS createdByName,
    u2.name AS updatedByName,
    u3.name AS deletedByName
  FROM customer_ledger_entries e
  LEFT JOIN customers c  ON c.id  = e.customerId
  LEFT JOIN accounts  acc ON acc.id = e.accountId
  LEFT JOIN users     u1 ON u1.id = e.createdBy
  LEFT JOIN users     u2 ON u2.id = e.updatedBy
  LEFT JOIN users     u3 ON u3.id = e.deletedBy`;

function syncCacheAfterLedgerChange(customerId, accountIds = []) {
  scheduleCacheSync({
    scopes: ["customerLedger", "accounts", "profitCalculations"],
    customerId,
    accountIds: accountIds.filter(Boolean).map(Number),
  });
}

export const getAllCustomersConvertedBalances = (_req, res, next) => {
  try {
    res.json(getAllCustomersTradeProfitLoss());
  } catch (error) {
    next(error);
  }
};

export const getAllCustomersFundingBalancesHandler = (_req, res, next) => {
  try {
    res.json(getAllCustomersFundingBalances());
  } catch (error) {
    next(error);
  }
};

export const getCustomerDepositTotalsByCurrencyHandler = (_req, res, next) => {
  try {
    res.json({ currencies: getCustomerDepositTotalsByCurrency() });
  } catch (error) {
    next(error);
  }
};

export const getCustomerDepositByCurrencyHandler = (_req, res, next) => {
  try {
    res.json(getCustomerDepositByCurrency());
  } catch (error) {
    next(error);
  }
};

export const getCustomerDepositTraceHandler = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const { currencyCode } = req.params;

    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      customerId,
      currencyCode,
      entries: getCustomerDepositTraceEntries(customerId, currencyCode),
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerTradeProfitLossHandler = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.json(getCustomerTradeProfitLoss(customerId));
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// LIST entries for a customer (all or filtered)
// ─────────────────────────────────────────────
export const listLedgerEntries = (req, res, next) => {
  try {
    const { id: customerId } = req.params;
    const { currencyCode, dateFrom, dateTo, showDeleted } = req.query;

    const conditions = ["e.customerId = @customerId"];
    const params = { customerId: parseInt(customerId, 10) };

    if (showDeleted !== "true") {
      conditions.push("e.deletedAt IS NULL");
    }
    if (currencyCode) {
      conditions.push("e.currencyCode = @currencyCode");
      params.currencyCode = currencyCode;
    }
    if (dateFrom) {
      conditions.push("DATE(COALESCE(e.entryDate, e.createdAt)) >= DATE(@dateFrom)");
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push("DATE(COALESCE(e.entryDate, e.createdAt)) <= DATE(@dateTo)");
      params.dateTo = dateTo;
    }

    const where = conditions.join(" AND ");

    const rows = db
      .prepare(
        `${ENTRY_SELECT}
         WHERE ${where}
         ORDER BY COALESCE(e.entryDate, e.createdAt) DESC, e.id DESC;`,
      )
      .all(params);

    res.json(rows);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// BALANCE SUMMARY for a customer (per currency)
// ─────────────────────────────────────────────
export const getLedgerSummary = (req, res, next) => {
  try {
    const { id: customerId } = req.params;

    const rows = db
      .prepare(
        `SELECT
           e.currencyCode,
           SUM(CASE WHEN e.type = 'credit' THEN e.amount ELSE 0 END) AS totalCredit,
           SUM(CASE WHEN e.type = 'debit'  THEN e.amount ELSE 0 END) AS totalDebit,
           SUM(CASE WHEN e.type = 'credit' THEN e.amount ELSE -e.amount END) AS balance
         FROM customer_ledger_entries e
         WHERE e.customerId = ? AND e.deletedAt IS NULL
         GROUP BY e.currencyCode
         ORDER BY e.currencyCode ASC;`
      )
      .all(parseInt(customerId, 10));

    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const getCustomerFundingBalancesHandler = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.json(getCustomerFundingBalances(customerId));
  } catch (error) {
    next(error);
  }
};

/** @deprecated Use funding-balances; kept for older clients. */
export const getCustomerFundingSummaryHandler = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const { currencies } = getCustomerFundingBalances(customerId);
    const FUNDING_EPSILON = 0.005;
    const items = currencies.filter(
      (c) => c.allocatable >= FUNDING_EPSILON || c.allocatableAdvance >= FUNDING_EPSILON,
    );
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getCustomerLedgerBalance = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const currencyCode = req.params.currencyCode;
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const balance = getCustomerCurrencyBalance(customerId, currencyCode);
    const manualFundedBalance = getFundedCustomerCurrencyBalance(customerId, currencyCode);
    const fundedBalance = getEffectiveFundedBalance(customerId, currencyCode);
    const tradePosition = getTradePositionBalance(customerId, currencyCode);
    const allocatable = getAllocatableCustomerBalance(customerId, currencyCode);
    const allocatableAdvance = getAllocatableCustomerOwed(customerId, currencyCode);
    const fundedOwedTotal = Math.max(0, -fundedBalance);
    const fundedPositive = Math.max(0, fundedBalance);
    res.json({
      currencyCode,
      balance,
      fundedBalance,
      manualFundedBalance,
      tradePosition,
      allocatable,
      reserved: fundedPositive - allocatable,
      allocatableAdvance,
      reservedAdvance: fundedOwedTotal - allocatableAdvance,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// CREATE a ledger entry
// ─────────────────────────────────────────────
export const createLedgerEntry = (req, res, next) => {
  try {
    const { id: customerId } = req.params;
    const { type, amount, currencyCode, description, entryDate, accountId } = req.body;
    const createdBy = getUserIdFromHeader(req);
    const now = new Date().toISOString();
    const customerIdNum = parseInt(customerId, 10);

    if (!type || !["credit", "debit"].includes(type)) {
      return res.status(400).json({ message: "Type must be 'credit' or 'debit'" });
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    if (!currencyCode) {
      return res.status(400).json({ message: "Currency is required" });
    }

    const accountIdNum = parseInt(accountId, 10);
    if (!accountIdNum) {
      return res.status(400).json({ message: "Account is required for manual deposit or withdrawal" });
    }

    const customer = db
      .prepare("SELECT id, name FROM customers WHERE id = ?;")
      .get(customerIdNum);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const currency = db.prepare("SELECT code FROM currencies WHERE code = ?;").get(currencyCode);
    if (!currency) {
      return res.status(404).json({ message: "Currency not found" });
    }

    validateLedgerAccount(accountIdNum, currencyCode);

    const finalEntryDate = entryDate ? new Date(entryDate).toISOString() : now;
    const txDescription = buildLedgerAccountDescription(
      customer.name,
      type,
      parsedAmount,
      currencyCode,
      description,
    );

    let entryId;
    let affectedAccountId;

    const runCreate = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO customer_ledger_entries
             (customerId, currencyCode, type, amount, description, createdBy, createdAt, entryDate, source, accountId)
           VALUES (@customerId, @currencyCode, @type, @amount, @description, @createdBy, @createdAt, @entryDate, 'manual', @accountId);`,
        )
        .run({
          customerId: customerIdNum,
          currencyCode,
          type,
          amount: parsedAmount,
          description: description || null,
          createdBy: createdBy || null,
          createdAt: now,
          entryDate: finalEntryDate,
          accountId: accountIdNum,
        });

      entryId = result.lastInsertRowid;

      db.prepare(
        `INSERT INTO customer_ledger_entry_changes
           (entryId, changedBy, changedAt, type, amount, description, currencyCode)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ).run(entryId, createdBy || null, now, type, parsedAmount, description || null, currencyCode);

      affectedAccountId = applyLedgerAccountTransaction({
        accountId: accountIdNum,
        ledgerEntryId: entryId,
        ledgerType: type,
        amount: parsedAmount,
        description: txDescription,
        createdAt: finalEntryDate,
      });
    });

    try {
      runCreate();
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }

    const entry = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?;`).get(entryId);

    res.status(201).json(entry);
    syncCacheAfterLedgerChange(customerIdNum, [affectedAccountId]);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// UPDATE a ledger entry
// ─────────────────────────────────────────────
export const updateLedgerEntry = (req, res, next) => {
  try {
    const { id: customerId, entryId } = req.params;
    const { type, amount, currencyCode, description, entryDate, accountId } = req.body;
    const updatedBy = getUserIdFromHeader(req);
    const now = new Date().toISOString();
    const customerIdNum = parseInt(customerId, 10);
    const entryIdNum = parseInt(entryId, 10);

    const existing = db
      .prepare(
        "SELECT * FROM customer_ledger_entries WHERE id = ? AND customerId = ? AND deletedAt IS NULL;",
      )
      .get(entryIdNum, customerIdNum);

    if (!existing) {
      return res.status(404).json({ message: "Entry not found" });
    }

    if (existing.source && existing.source !== "manual") {
      return res.status(400).json({ message: "Only manual ledger entries can be edited" });
    }

    if (type && !["credit", "debit"].includes(type)) {
      return res.status(400).json({ message: "Type must be 'credit' or 'debit'" });
    }

    const parsedAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
    if (parsedAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const finalType = type || existing.type;
    const finalCurrency = currencyCode || existing.currencyCode;
    const finalDescription = description !== undefined ? description : existing.description;
    const finalEntryDate = entryDate ? new Date(entryDate).toISOString() : existing.entryDate;
    const accountIdNum =
      accountId !== undefined ? parseInt(accountId, 10) : existing.accountId;

    if (!accountIdNum) {
      return res.status(400).json({ message: "Account is required for manual deposit or withdrawal" });
    }

    const customer = db
      .prepare("SELECT id, name FROM customers WHERE id = ?;")
      .get(customerIdNum);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    validateLedgerAccount(accountIdNum, finalCurrency);

    const txDescription = buildLedgerAccountDescription(
      customer.name,
      finalType,
      parsedAmount,
      finalCurrency,
      finalDescription,
    );

    const affectedAccountIds = new Set();

    const runUpdate = db.transaction(() => {
      db.prepare(
        `INSERT INTO customer_ledger_entry_changes
           (entryId, changedBy, changedAt, type, amount, description, currencyCode)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ).run(
        existing.id,
        updatedBy || null,
        now,
        existing.type,
        existing.amount,
        existing.description,
        existing.currencyCode,
      );

      const reversedId = reverseLedgerAccountTransaction(existing.id);
      if (reversedId) affectedAccountIds.add(reversedId);

      db.prepare(
        `UPDATE customer_ledger_entries
         SET type=@type, amount=@amount, currencyCode=@currencyCode,
             description=@description, entryDate=@entryDate,
             accountId=@accountId, updatedBy=@updatedBy, updatedAt=@updatedAt
         WHERE id=@id;`,
      ).run({
        type: finalType,
        amount: parsedAmount,
        currencyCode: finalCurrency,
        description: finalDescription || null,
        entryDate: finalEntryDate,
        accountId: accountIdNum,
        updatedBy: updatedBy || null,
        updatedAt: now,
        id: existing.id,
      });

      const appliedId = applyLedgerAccountTransaction({
        accountId: accountIdNum,
        ledgerEntryId: existing.id,
        ledgerType: finalType,
        amount: parsedAmount,
        description: txDescription,
        createdAt: finalEntryDate || now,
      });
      affectedAccountIds.add(appliedId);
    });

    try {
      runUpdate();
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }

    const updated = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?;`).get(existing.id);

    res.json(updated);
    syncCacheAfterLedgerChange(customerIdNum, Array.from(affectedAccountIds));
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// SOFT DELETE a ledger entry
// ─────────────────────────────────────────────
export const deleteLedgerEntry = (req, res, next) => {
  try {
    const { id: customerId, entryId } = req.params;
    const deletedBy = getUserIdFromHeader(req);
    const now = new Date().toISOString();
    const customerIdNum = parseInt(customerId, 10);
    const entryIdNum = parseInt(entryId, 10);

    const existing = db
      .prepare(
        "SELECT * FROM customer_ledger_entries WHERE id = ? AND customerId = ? AND deletedAt IS NULL;",
      )
      .get(entryIdNum, customerIdNum);

    if (!existing) {
      return res.status(404).json({ message: "Entry not found" });
    }

    const affectedAccountIds = new Set();

    db.transaction(() => {
      if (existing.source === "manual" || existing.accountId) {
        const reversedId = reverseLedgerAccountTransaction(existing.id);
        if (reversedId) affectedAccountIds.add(reversedId);
      }

      db.prepare(
        "UPDATE customer_ledger_entries SET deletedBy=?, deletedAt=? WHERE id=?;",
      ).run(deletedBy || null, now, existing.id);
    })();

    res.status(204).send();
    syncCacheAfterLedgerChange(customerIdNum, Array.from(affectedAccountIds));
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// GET change history for a single entry
// ─────────────────────────────────────────────
export const getAccountStatement = (req, res, next) => {
  try {
    const { id: customerId } = req.params;
    const activityParam = req.query.activity;
    const activity =
      activityParam === "funding" || activityParam === "trade" ? activityParam : "all";
    const includeReversals = req.query.includeReversals === "true";
    const rows = buildAccountStatementRows(parseInt(customerId, 10), {
      activity,
      includeReversals,
    });
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const getDepositAccountStatement = (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const includeReversals = req.query.includeReversals === "true";
    const rows = buildDepositAccountStatementRows(customerId, { includeReversals });
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const rebuildLedgerFromOrders = (req, res, next) => {
  try {
    const { id: customerId } = req.params;
    const createdBy = getUserIdFromHeader(req);
    const customer = db.prepare("SELECT id FROM customers WHERE id = ?;").get(parseInt(customerId, 10));
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const result = rebuildCustomerLedgerFromOrders(parseInt(customerId, 10), createdBy);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getLedgerEntryChanges = (req, res, next) => {
  try {
    const { entryId } = req.params;

    const rows = db
      .prepare(
        `SELECT ch.*, u.name AS changedByName
         FROM customer_ledger_entry_changes ch
         LEFT JOIN users u ON u.id = ch.changedBy
         WHERE ch.entryId = ?
         ORDER BY ch.changedAt ASC;`
      )
      .all(parseInt(entryId, 10));

    res.json(rows);
  } catch (error) {
    next(error);
  }
};
