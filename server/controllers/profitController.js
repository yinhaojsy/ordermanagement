import { db } from "../db.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";

export const getProfitCalculations = (_req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM profit_calculations ORDER BY updatedAt DESC, createdAt DESC;`
    )
    .all();
  res.json(rows);
};

export const getProfitCalculation = (req, res, next) => {
  try {
    const { id } = req.params;
    
    const calculation = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    // Get multipliers
    const multipliers = db
      .prepare(
        `SELECT pam.*, a.name as accountName, a.currencyCode, a.balance, c.name as currencyName
         FROM profit_account_multipliers pam
         LEFT JOIN accounts a ON a.id = pam.accountId
         LEFT JOIN currencies c ON c.code = a.currencyCode
         WHERE pam.profitCalculationId = ?
         ORDER BY pam.groupId, a.currencyCode, a.name;`
      )
      .all(id);

    // Get exchange rates
    const exchangeRates = db
      .prepare(
        `SELECT * FROM profit_exchange_rates WHERE profitCalculationId = ?;`
      )
      .all(id);

    const depositExchangeRates = db
      .prepare(
        `SELECT * FROM profit_deposit_exchange_rates WHERE profitCalculationId = ?;`,
      )
      .all(id);

    // Parse groups JSON
    let groups = [];
    try {
      groups = calculation.groups ? JSON.parse(calculation.groups) : [];
    } catch (e) {
      groups = [];
    }

    const useLinkedDepositExchangeRates =
      calculation.useLinkedDepositExchangeRates === undefined ||
      calculation.useLinkedDepositExchangeRates === null
        ? true
        : Number(calculation.useLinkedDepositExchangeRates) === 1;

    res.json({
      ...calculation,
      multipliers,
      exchangeRates,
      depositExchangeRates,
      useLinkedDepositExchangeRates,
      groups,
    });
  } catch (error) {
    next(error);
  }
};

export const createProfitCalculation = (req, res, next) => {
  try {
    const { name, targetCurrencyCode, initialInvestment } = req.body || {};
    
    if (!name || !targetCurrencyCode) {
      return res.status(400).json({ 
        message: "Name and target currency code are required" 
      });
    }

    // Verify currency exists
    const currency = db
      .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
      .get(targetCurrencyCode);
    if (!currency) {
      return res.status(400).json({ message: "Target currency not found or inactive" });
    }

    const investment = parseFloat(initialInvestment || 0);
    if (isNaN(investment) || investment < 0) {
      return res.status(400).json({ message: "Invalid initial investment amount" });
    }

    const now = new Date().toISOString();
    const stmt = db.prepare(
      `INSERT INTO profit_calculations (name, targetCurrencyCode, initialInvestment, createdAt, updatedAt)
       VALUES (@name, @targetCurrencyCode, @initialInvestment, @createdAt, @updatedAt);`
    );
    const result = stmt.run({
      name,
      targetCurrencyCode,
      initialInvestment: investment,
      createdAt: now,
      updatedAt: now,
    });

    const row = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(result.lastInsertRowid);
    
    // Parse groups JSON for response
    let groups = [];
    try {
      groups = row.groups ? JSON.parse(row.groups) : [];
    } catch (e) {
      groups = [];
    }
    
    res.status(201).json({
      ...row,
      multipliers: [],
      exchangeRates: [],
      depositExchangeRates: [],
      useLinkedDepositExchangeRates: true,
      groups,
    });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(result.lastInsertRowid),
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfitCalculation = (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { name, targetCurrencyCode, initialInvestment, groups, useLinkedDepositExchangeRates } =
      body;
    
    // Check if calculation exists
    const existing = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!existing) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (targetCurrencyCode !== undefined) {
      // Verify currency exists
      const currency = db
        .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
        .get(targetCurrencyCode);
      if (!currency) {
        return res.status(400).json({ message: "Target currency not found or inactive" });
      }
      updates.targetCurrencyCode = targetCurrencyCode;
    }
    if (initialInvestment !== undefined) {
      const investment = parseFloat(initialInvestment);
      if (isNaN(investment) || investment < 0) {
        return res.status(400).json({ message: "Invalid initial investment amount" });
      }
      updates.initialInvestment = investment;
    }
    if (groups !== undefined && groups !== null) {
      // Validate groups is an array
      if (!Array.isArray(groups)) {
        return res.status(400).json({ message: "Groups must be an array" });
      }
      // Check if groups column exists in database
      const tableInfo = db.prepare("PRAGMA table_info(profit_calculations)").all();
      const hasGroupsColumn = tableInfo.some((col) => col.name === "groups");
      if (!hasGroupsColumn) {
        // Add the column if it doesn't exist
        try {
          db.prepare("ALTER TABLE profit_calculations ADD COLUMN groups TEXT DEFAULT '[]'").run();
        } catch (e) {
          // Column might already exist, ignore error
        }
      }
      updates.groups = JSON.stringify(groups);
    }
    if (useLinkedDepositExchangeRates !== undefined) {
      const linked = useLinkedDepositExchangeRates === true || useLinkedDepositExchangeRates === 1;
      updates.useLinkedDepositExchangeRates = linked ? 1 : 0;
      if (linked) {
        db.prepare("DELETE FROM profit_deposit_exchange_rates WHERE profitCalculationId = ?;").run(
          id,
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    updates.updatedAt = new Date().toISOString();
    
    const setClause = Object.keys(updates)
      .map((key) => `${key} = @${key}`)
      .join(", ");
    
    db.prepare(
      `UPDATE profit_calculations SET ${setClause} WHERE id = @id;`
    ).run({ ...updates, id });

    const row = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    
    // Parse groups JSON for response
    let parsedGroups = [];
    try {
      parsedGroups = row.groups ? JSON.parse(row.groups) : [];
    } catch (e) {
      parsedGroups = [];
    }

    const linkedDepositRates =
      row.useLinkedDepositExchangeRates === undefined ||
      row.useLinkedDepositExchangeRates === null
        ? true
        : Number(row.useLinkedDepositExchangeRates) === 1;
    
    res.json({
      ...row,
      groups: parsedGroups,
      useLinkedDepositExchangeRates: linkedDepositRates,
    });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProfitCalculation = (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if calculation exists
    const existing = db
      .prepare("SELECT id FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!existing) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    // Delete will cascade to multipliers and exchange rates
    const stmt = db.prepare("DELETE FROM profit_calculations WHERE id = ?;");
    const result = stmt.run(id);
    
    if (result.changes === 0) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }
    
    res.json({ success: true });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const updateAccountMultiplier = (req, res, next) => {
  try {
    const { id, accountId } = req.params;
    const { multiplier, groupId, groupName } = req.body || {};
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT id FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    // Check if account exists
    const account = db
      .prepare("SELECT id FROM accounts WHERE id = ?")
      .get(accountId);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const mult = parseFloat(multiplier);
    if (isNaN(mult) || mult < 0) {
      return res.status(400).json({ message: "Invalid multiplier value" });
    }

    // Check if multiplier already exists
    const existing = db
      .prepare(
        "SELECT id FROM profit_account_multipliers WHERE profitCalculationId = ? AND accountId = ?"
      )
      .get(id, accountId);

    if (existing) {
      // Update existing
      db.prepare(
        `UPDATE profit_account_multipliers 
         SET multiplier = @multiplier, groupId = @groupId, groupName = @groupName
         WHERE profitCalculationId = @profitCalculationId AND accountId = @accountId;`
      ).run({
        profitCalculationId: id,
        accountId,
        multiplier: mult,
        groupId: groupId || null,
        groupName: groupName || null,
      });
    } else {
      // Insert new
      db.prepare(
        `INSERT INTO profit_account_multipliers 
         (profitCalculationId, accountId, multiplier, groupId, groupName, createdAt)
         VALUES (@profitCalculationId, @accountId, @multiplier, @groupId, @groupName, @createdAt);`
      ).run({
        profitCalculationId: id,
        accountId,
        multiplier: mult,
        groupId: groupId || null,
        groupName: groupName || null,
        createdAt: new Date().toISOString(),
      });
    }

    // Update calculation's updatedAt
    db.prepare(
      "UPDATE profit_calculations SET updatedAt = @updatedAt WHERE id = @id;"
    ).run({
      id,
      updatedAt: new Date().toISOString(),
    });

    // Return updated multiplier with account info
    const row = db
      .prepare(
        `SELECT pam.*, a.name as accountName, a.currencyCode, a.balance, c.name as currencyName
         FROM profit_account_multipliers pam
         LEFT JOIN accounts a ON a.id = pam.accountId
         LEFT JOIN currencies c ON c.code = a.currencyCode
         WHERE pam.profitCalculationId = ? AND pam.accountId = ?;`
      )
      .get(id, accountId);
    
    res.json(row);
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const updateExchangeRate = (req, res, next) => {
  try {
    const { id } = req.params;
    const { fromCurrencyCode, toCurrencyCode, rate } = req.body || {};
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT id FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    if (!fromCurrencyCode || !toCurrencyCode || rate === undefined) {
      return res.status(400).json({ 
        message: "From currency, to currency, and rate are required" 
      });
    }

    // Verify currencies exist
    const fromCurrency = db
      .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
      .get(fromCurrencyCode);
    if (!fromCurrency) {
      return res.status(400).json({ message: "From currency not found or inactive" });
    }

    const toCurrency = db
      .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
      .get(toCurrencyCode);
    if (!toCurrency) {
      return res.status(400).json({ message: "To currency not found or inactive" });
    }

    const exchangeRate = parseFloat(rate);
    if (isNaN(exchangeRate) || exchangeRate <= 0) {
      return res.status(400).json({ message: "Invalid exchange rate" });
    }

    // Check if exchange rate already exists
    const existing = db
      .prepare(
        `SELECT id FROM profit_exchange_rates 
         WHERE profitCalculationId = ? AND fromCurrencyCode = ? AND toCurrencyCode = ?`
      )
      .get(id, fromCurrencyCode, toCurrencyCode);

    if (existing) {
      // Update existing
      db.prepare(
        `UPDATE profit_exchange_rates 
         SET rate = @rate 
         WHERE profitCalculationId = @profitCalculationId 
         AND fromCurrencyCode = @fromCurrencyCode 
         AND toCurrencyCode = @toCurrencyCode;`
      ).run({
        profitCalculationId: id,
        fromCurrencyCode,
        toCurrencyCode,
        rate: exchangeRate,
      });
    } else {
      // Insert new
      db.prepare(
        `INSERT INTO profit_exchange_rates 
         (profitCalculationId, fromCurrencyCode, toCurrencyCode, rate, createdAt)
         VALUES (@profitCalculationId, @fromCurrencyCode, @toCurrencyCode, @rate, @createdAt);`
      ).run({
        profitCalculationId: id,
        fromCurrencyCode,
        toCurrencyCode,
        rate: exchangeRate,
        createdAt: new Date().toISOString(),
      });
    }

    // Update calculation's updatedAt
    db.prepare(
      "UPDATE profit_calculations SET updatedAt = @updatedAt WHERE id = @id;"
    ).run({
      id,
      updatedAt: new Date().toISOString(),
    });

    // Return updated exchange rate
    const row = db
      .prepare(
        `SELECT * FROM profit_exchange_rates 
         WHERE profitCalculationId = ? AND fromCurrencyCode = ? AND toCurrencyCode = ?;`
      )
      .get(id, fromCurrencyCode, toCurrencyCode);
    
    res.json(row);
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const updateDepositExchangeRate = (req, res, next) => {
  try {
    const { id } = req.params;
    const { fromCurrencyCode, toCurrencyCode, rate } = req.body || {};

    const calculation = db
      .prepare("SELECT id, useLinkedDepositExchangeRates FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }

    if (!fromCurrencyCode || !toCurrencyCode || rate === undefined) {
      return res.status(400).json({
        message: "From currency, to currency, and rate are required",
      });
    }

    const fromCurrency = db
      .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
      .get(fromCurrencyCode);
    if (!fromCurrency) {
      return res.status(400).json({ message: "From currency not found or inactive" });
    }

    const toCurrency = db
      .prepare("SELECT code FROM currencies WHERE code = ? AND active = 1")
      .get(toCurrencyCode);
    if (!toCurrency) {
      return res.status(400).json({ message: "To currency not found or inactive" });
    }

    const exchangeRate = parseFloat(rate);
    if (isNaN(exchangeRate) || exchangeRate <= 0) {
      return res.status(400).json({ message: "Invalid exchange rate" });
    }

    db.prepare(
      "UPDATE profit_calculations SET useLinkedDepositExchangeRates = 0 WHERE id = ?;",
    ).run(id);

    const existing = db
      .prepare(
        `SELECT id FROM profit_deposit_exchange_rates
         WHERE profitCalculationId = ? AND fromCurrencyCode = ? AND toCurrencyCode = ?`,
      )
      .get(id, fromCurrencyCode, toCurrencyCode);

    if (existing) {
      db.prepare(
        `UPDATE profit_deposit_exchange_rates
         SET rate = @rate
         WHERE profitCalculationId = @profitCalculationId
         AND fromCurrencyCode = @fromCurrencyCode
         AND toCurrencyCode = @toCurrencyCode;`,
      ).run({
        profitCalculationId: id,
        fromCurrencyCode,
        toCurrencyCode,
        rate: exchangeRate,
      });
    } else {
      db.prepare(
        `INSERT INTO profit_deposit_exchange_rates
         (profitCalculationId, fromCurrencyCode, toCurrencyCode, rate, createdAt)
         VALUES (@profitCalculationId, @fromCurrencyCode, @toCurrencyCode, @rate, @createdAt);`,
      ).run({
        profitCalculationId: id,
        fromCurrencyCode,
        toCurrencyCode,
        rate: exchangeRate,
        createdAt: new Date().toISOString(),
      });
    }

    db.prepare("UPDATE profit_calculations SET updatedAt = @updatedAt WHERE id = @id;").run({
      id,
      updatedAt: new Date().toISOString(),
    });

    const row = db
      .prepare(
        `SELECT * FROM profit_deposit_exchange_rates
         WHERE profitCalculationId = ? AND fromCurrencyCode = ? AND toCurrencyCode = ?;`,
      )
      .get(id, fromCurrencyCode, toCurrencyCode);

    res.json(row);
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteGroup = (req, res, next) => {
  try {
    const { id } = req.params;
    const { groupName } = req.body || {};
    
    if (!groupName) {
      return res.status(400).json({ message: "Group name is required" });
    }
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }
    
    // Parse groups JSON
    let groups = [];
    try {
      groups = calculation.groups ? JSON.parse(calculation.groups) : [];
    } catch (e) {
      groups = [];
    }
    
    // Remove group from groups array
    const updatedGroups = groups.filter((g) => g !== groupName);
    
    // Update calculation's groups
    db.prepare(
      "UPDATE profit_calculations SET groups = @groups, updatedAt = @updatedAt WHERE id = @id;"
    ).run({
      id,
      groups: JSON.stringify(updatedGroups),
      updatedAt: new Date().toISOString(),
    });
    
    // Unassign all accounts from this group
    const groupId = `GROUP_${groupName.toUpperCase().replace(/\s+/g, "_")}`;
    db.prepare(
      `UPDATE profit_account_multipliers 
       SET groupId = NULL, groupName = NULL 
       WHERE profitCalculationId = @profitCalculationId AND (groupId = @groupId OR groupName = @groupName);`
    ).run({
      profitCalculationId: id,
      groupId,
      groupName,
    });
    
    res.json({ message: "Group deleted successfully" });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const renameGroup = (req, res, next) => {
  try {
    const { id } = req.params;
    const { oldGroupName, newGroupName } = req.body || {};
    
    if (!oldGroupName || !newGroupName) {
      return res.status(400).json({ message: "Old and new group names are required" });
    }
    
    if (oldGroupName === newGroupName) {
      return res.status(400).json({ message: "New group name must be different from old name" });
    }
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }
    
    // Parse groups JSON
    let groups = [];
    try {
      groups = calculation.groups ? JSON.parse(calculation.groups) : [];
    } catch (e) {
      groups = [];
    }
    
    // Check if old group exists in groups array or in multipliers
    const oldGroupExists = groups.includes(oldGroupName);
    const oldGroupId = `GROUP_${oldGroupName.toUpperCase().replace(/\s+/g, "_")}`;
    const existingMultiplier = db
      .prepare(
        "SELECT id FROM profit_account_multipliers WHERE profitCalculationId = ? AND (groupId = ? OR groupName = ?) LIMIT 1"
      )
      .get(id, oldGroupId, oldGroupName);
    
    if (!oldGroupExists && !existingMultiplier) {
      return res.status(404).json({ message: "Group not found" });
    }
    
    // Check if new group name already exists
    if (groups.includes(newGroupName)) {
      return res.status(400).json({ message: "Group with this name already exists" });
    }
    
    // Also check if new group name exists in multipliers
    const newGroupId = `GROUP_${newGroupName.toUpperCase().replace(/\s+/g, "_")}`;
    const existingNewGroupMultiplier = db
      .prepare(
        "SELECT id FROM profit_account_multipliers WHERE profitCalculationId = ? AND (groupId = ? OR groupName = ?) LIMIT 1"
      )
      .get(id, newGroupId, newGroupName);
    
    if (existingNewGroupMultiplier) {
      return res.status(400).json({ message: "Group with this name already exists" });
    }
    
    // Update groups array (only if old group was in the array)
    let updatedGroups = groups;
    if (oldGroupExists) {
      updatedGroups = groups.map((g) => (g === oldGroupName ? newGroupName : g));
      
      // Update calculation's groups
      db.prepare(
        "UPDATE profit_calculations SET groups = @groups, updatedAt = @updatedAt WHERE id = @id;"
      ).run({
        id,
        groups: JSON.stringify(updatedGroups),
        updatedAt: new Date().toISOString(),
      });
    } else {
      // If group wasn't in the array but exists in multipliers, add the new name to the array
      updatedGroups = [...groups, newGroupName];
      db.prepare(
        "UPDATE profit_calculations SET groups = @groups, updatedAt = @updatedAt WHERE id = @id;"
      ).run({
        id,
        groups: JSON.stringify(updatedGroups),
        updatedAt: new Date().toISOString(),
      });
    }
    
    // Update all multipliers that reference this group
    // newGroupId is already declared above
    db.prepare(
      `UPDATE profit_account_multipliers 
       SET groupId = @newGroupId, groupName = @newGroupName 
       WHERE profitCalculationId = @profitCalculationId AND (groupId = @oldGroupId OR groupName = @oldGroupName);`
    ).run({
      profitCalculationId: id,
      oldGroupId,
      oldGroupName,
      newGroupId,
      newGroupName,
    });
    
    res.json({ message: "Group renamed successfully" });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const setDefaultCalculation = (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }
    
    // Unset all existing defaults
    db.prepare("UPDATE profit_calculations SET isDefault = 0").run();
    
    // Set this calculation as default
    db.prepare("UPDATE profit_calculations SET isDefault = 1, updatedAt = ? WHERE id = ?").run(
      new Date().toISOString(),
      id
    );
    
    res.json({ message: "Default calculation set successfully" });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const unsetDefaultCalculation = (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if calculation exists
    const calculation = db
      .prepare("SELECT * FROM profit_calculations WHERE id = ?")
      .get(id);
    
    if (!calculation) {
      return res.status(404).json({ message: "Profit calculation not found" });
    }
    
    // Unset default for this calculation
    db.prepare("UPDATE profit_calculations SET isDefault = 0, updatedAt = ? WHERE id = ?").run(
      new Date().toISOString(),
      id
    );
    
    res.json({ message: "Default calculation unset successfully" });
    scheduleCacheSync({
      scopes: ["profitCalculations", "accounts", "customerLedger"],
      calculationId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

