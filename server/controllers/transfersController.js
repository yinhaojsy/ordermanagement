import { db } from "../db.js";
import { getUserIdFromHeader } from "../utils/auth.js";
import { createNotification } from "../services/notification/notificationService.js";
import { generateTransferFilename, saveFile, deleteFile, normalizeStoredImagePath } from "../utils/fileStorage.js";
import {
  appendAccountAccessFilter,
  requireAccountAccess,
} from "../utils/accountAccess.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";
import { parseOptionalRecordId } from "../utils/importRecordId.js";

export const listTransfers = (req, res) => {
  const {
    dateFrom,
    dateTo,
    fromAccountId,
    toAccountId,
    currencyCode,
    createdBy,
    tagId,
    tagIds,
    page,
    limit,
  } = req.query;
  
  // Build WHERE conditions
  const conditions = [];
  const params = {};
  const userId = getUserIdFromHeader(req);

  appendAccountAccessFilter({
    userId,
    scope: "transfer.account",
    accountColumn: "t.fromAccountId",
    conditions,
    params,
    paramPrefix: "transferFromAccess",
  });
  appendAccountAccessFilter({
    userId,
    scope: "transfer.account",
    accountColumn: "t.toAccountId",
    conditions,
    params,
    paramPrefix: "transferToAccess",
  });
  
  if (dateFrom) {
    conditions.push('DATE(COALESCE(t.entryDate, t.createdAt)) >= DATE(@dateFrom)');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push('DATE(COALESCE(t.entryDate, t.createdAt)) <= DATE(@dateTo)');
    params.dateTo = dateTo;
  }
  if (fromAccountId) {
    conditions.push('t.fromAccountId = @fromAccountId');
    params.fromAccountId = parseInt(fromAccountId, 10);
  }
  if (toAccountId) {
    conditions.push('t.toAccountId = @toAccountId');
    params.toAccountId = parseInt(toAccountId, 10);
  }
  if (currencyCode) {
    conditions.push('t.currencyCode = @currencyCode');
    params.currencyCode = currencyCode;
  }
  if (createdBy) {
    conditions.push('t.createdBy = @createdBy');
    params.createdBy = parseInt(createdBy, 10);
  }
  
  // Handle tag filtering (support both single tagId and multiple tagIds)
  const parsedTagIds = [];
  if (tagIds) {
    const parts = String(tagIds).split(',').map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    parsedTagIds.push(...parts);
  } else if (tagId) {
    const single = parseInt(tagId, 10);
    if (!isNaN(single)) parsedTagIds.push(single);
  }
  if (parsedTagIds.length > 0) {
    const placeholders = parsedTagIds.map((_, i) => `@tagId${i}`).join(',');
    conditions.push(`EXISTS (
      SELECT 1 FROM transfer_tag_assignments tta 
      WHERE tta.transferId = t.id AND tta.tagId IN (${placeholders})
    )`);
    parsedTagIds.forEach((id, i) => {
      params[`tagId${i}`] = id;
    });
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Pagination
  const pageNum = parseInt(page, 10) || 1;
  const pageSize = parseInt(limit, 10) || 20;
  const offset = (pageNum - 1) * pageSize;
  const usePagination = page && limit;

  // Get total count
  let countQuery = `SELECT COUNT(*) as total
       FROM internal_transfers t
       ${whereClause};`;
  const countResult = db.prepare(countQuery).get(params);
  const total = countResult.total;
  
  let query = `SELECT 
        t.id,
        t.fromAccountId,
        t.toAccountId,
        t.amount,
        t.currencyCode,
        t.description,
        t.transactionFee,
        t.imagePath,
        t.createdBy,
        t.createdAt,
        t.entryDate,
        t.updatedBy,
        t.updatedAt,
        fromAcc.name as fromAccountName,
        toAcc.name as toAccountName,
        creator.name as createdByName,
        updater.name as updatedByName
       FROM internal_transfers t
       LEFT JOIN accounts fromAcc ON fromAcc.id = t.fromAccountId
       LEFT JOIN accounts toAcc ON toAcc.id = t.toAccountId
       LEFT JOIN users creator ON creator.id = t.createdBy
       LEFT JOIN users updater ON updater.id = t.updatedBy
       ${whereClause}
       ORDER BY COALESCE(t.entryDate, t.createdAt) DESC`;

  // Add pagination if requested
  if (usePagination) {
    query += ` LIMIT @limit OFFSET @offset;`;
    params.limit = pageSize;
    params.offset = offset;
  } else {
    query += `;`;
  }
  
  const rows = db.prepare(query).all(params);
  
  // Add tags to each transfer
  const transfers = rows.map(transfer => {
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN transfer_tag_assignments tta ON tta.tagId = t.id
         WHERE tta.transferId = ?
         ORDER BY t.name ASC;`
      )
      .all(transfer.id);
    
    return {
      ...transfer,
      tags: tags.length > 0 ? tags : [],
    };
  });
  
  // Return with pagination info if requested
  if (usePagination) {
    res.json({
      transfers,
      total,
      page: pageNum,
      limit: pageSize,
    });
  } else {
    res.json(transfers);
  }
};

export const exportTransfers = (req, res) => {
  // Extract query parameters (same as listTransfers but without pagination)
  const {
    dateFrom,
    dateTo,
    fromAccountId,
    toAccountId,
    currencyCode,
    createdBy,
    tagId,
    tagIds,
  } = req.query;
  
  // Build WHERE conditions (same logic as listTransfers)
  const conditions = [];
  const params = {};
  const userId = getUserIdFromHeader(req);

  appendAccountAccessFilter({
    userId,
    scope: "transfer.account",
    accountColumn: "t.fromAccountId",
    conditions,
    params,
    paramPrefix: "transferFromAccess",
  });
  appendAccountAccessFilter({
    userId,
    scope: "transfer.account",
    accountColumn: "t.toAccountId",
    conditions,
    params,
    paramPrefix: "transferToAccess",
  });
  
  if (dateFrom) {
    conditions.push('DATE(COALESCE(t.entryDate, t.createdAt)) >= DATE(@dateFrom)');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push('DATE(COALESCE(t.entryDate, t.createdAt)) <= DATE(@dateTo)');
    params.dateTo = dateTo;
  }
  if (fromAccountId) {
    conditions.push('t.fromAccountId = @fromAccountId');
    params.fromAccountId = parseInt(fromAccountId, 10);
  }
  if (toAccountId) {
    conditions.push('t.toAccountId = @toAccountId');
    params.toAccountId = parseInt(toAccountId, 10);
  }
  if (currencyCode) {
    conditions.push('t.currencyCode = @currencyCode');
    params.currencyCode = currencyCode;
  }
  if (createdBy) {
    conditions.push('t.createdBy = @createdBy');
    params.createdBy = parseInt(createdBy, 10);
  }
  
  // Handle tag filtering (support both single tagId and multiple tagIds)
  const parsedTagIds = [];
  if (tagIds) {
    const parts = String(tagIds).split(',').map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    parsedTagIds.push(...parts);
  } else if (tagId) {
    const single = parseInt(tagId, 10);
    if (!isNaN(single)) parsedTagIds.push(single);
  }
  if (parsedTagIds.length > 0) {
    const placeholders = parsedTagIds.map((_, i) => `@tagId${i}`).join(',');
    conditions.push(`EXISTS (
      SELECT 1 FROM transfer_tag_assignments tta 
      WHERE tta.transferId = t.id AND tta.tagId IN (${placeholders})
    )`);
    parsedTagIds.forEach((id, i) => {
      params[`tagId${i}`] = id;
    });
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Build query without pagination
  let query = `SELECT 
        t.id,
        t.fromAccountId,
        t.toAccountId,
        t.amount,
        t.currencyCode,
        t.description,
        t.transactionFee,
        t.imagePath,
        t.createdBy,
        t.createdAt,
        t.entryDate,
        t.updatedBy,
        t.updatedAt,
        fromAcc.name as fromAccountName,
        toAcc.name as toAccountName,
        creator.name as createdByName,
        updater.name as updatedByName
       FROM internal_transfers t
       LEFT JOIN accounts fromAcc ON fromAcc.id = t.fromAccountId
       LEFT JOIN accounts toAcc ON toAcc.id = t.toAccountId
       LEFT JOIN users creator ON creator.id = t.createdBy
       LEFT JOIN users updater ON updater.id = t.updatedBy
       ${whereClause}
       ORDER BY COALESCE(t.entryDate, t.createdAt) DESC;`;
  
  const rows = db.prepare(query).all(params);
  
  // Add tags to each transfer
  const transfers = rows.map(transfer => {
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN transfer_tag_assignments tta ON tta.tagId = t.id
         WHERE tta.transferId = ?
         ORDER BY t.name ASC;`
      )
      .all(transfer.id);
    
    return {
      ...transfer,
      tags: tags.length > 0 ? tags : [],
    };
  });
  
  res.json(transfers);
};

export const createTransfer = async (req, res, next) => {
  try {
    const { fromAccountId, toAccountId, amount, description, transactionFee, createdBy, tagIds } = req.body || {};
    const parsedRecordId = parseOptionalRecordId(req.body?.id, "Transfer ID");
    if (parsedRecordId.error) {
      return res.status(400).json({ message: parsedRecordId.error });
    }
    const recordId = parsedRecordId.id;
    const file = req.file;

    if (!fromAccountId || !toAccountId || !amount) {
      return res.status(400).json({ message: "From account, to account, and amount are required" });
    }

    if (fromAccountId === toAccountId) {
      return res.status(400).json({ message: "Cannot transfer to the same account" });
    }

    // Get both accounts
    const fromAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(fromAccountId);
    const toAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(toAccountId);

    if (!fromAccount) {
      return res.status(404).json({ message: "From account not found" });
    }
    if (!toAccount) {
      return res.status(404).json({ message: "To account not found" });
    }
    if (!requireAccountAccess(req, res, "transfer.account", fromAccountId, "You do not have access to use this transfer account")) {
      return;
    }
    if (!requireAccountAccess(req, res, "transfer.account", toAccountId, "You do not have access to use this transfer account")) {
      return;
    }

    // Verify same currency
    if (fromAccount.currencyCode !== toAccount.currencyCode) {
      return res.status(400).json({ 
        message: `Cannot transfer between different currencies. From: ${fromAccount.currencyCode}, To: ${toAccount.currencyCode}` 
      });
    }

    // Handle currencyCode for imports (optional, but validate if provided)
    let finalCurrencyCode = fromAccount.currencyCode;
    if (req.body?.currencyCode) {
      const providedCurrencyCode = String(req.body.currencyCode).trim();
      if (providedCurrencyCode !== fromAccount.currencyCode || providedCurrencyCode !== toAccount.currencyCode) {
        return res.status(400).json({ 
          message: `Currency "${providedCurrencyCode}" does not match account currencies "${fromAccount.currencyCode}"` 
        });
      }
      finalCurrencyCode = providedCurrencyCode;
    }

    // Handle createdAt for imports (optional)
    let finalCreatedAt = new Date().toISOString();
    if (req.body?.createdAt) {
      const providedDate = new Date(req.body.createdAt);
      if (!isNaN(providedDate.getTime())) {
        finalCreatedAt = providedDate.toISOString();
      }
    }

    const transferAmount = Number(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    // Handle transaction fee - convert to number, treat empty string as 0
    let feeAmount = 0;
    if (transactionFee !== undefined && transactionFee !== null && transactionFee !== "") {
      feeAmount = Number(transactionFee);
      if (isNaN(feeAmount) || feeAmount < 0) {
        return res.status(400).json({ message: "Transaction fee must be a non-negative number" });
      }
    }

    // Check sufficient balance (allow negative, but warn)
    const newFromBalance = fromAccount.balance - transferAmount;
    if (newFromBalance < 0) {
      // Allow negative but could add warning here if needed
    }

    // Handle file upload
    let imagePath = null;
    if (file) {
      const tempTransferId = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM internal_transfers;").get().nextId;
      const filename = generateTransferFilename(tempTransferId, file.mimetype, file.originalname);
      imagePath = saveFile(file.buffer, filename, "transfer");
    } else if (req.body?.imagePath) {
      const providedPath = req.body.imagePath;
      if (typeof providedPath === 'string' && providedPath.trim().length > 0) {
        imagePath = normalizeStoredImagePath(providedPath) || providedPath;
      }
    }

    if (recordId != null) {
      const existingTransfer = db.prepare("SELECT 1 AS ok FROM internal_transfers WHERE id = ?").get(recordId);
      if (existingTransfer) {
        return res.status(409).json({ message: `Transfer ID ${recordId} already exists` });
      }
    }

    // Perform transfer in a transaction
    const transaction = db.transaction(() => {
      // Create transfer record first to get the transfer ID
      const stmt = db.prepare(
        `INSERT INTO internal_transfers (id, fromAccountId, toAccountId, amount, currencyCode, description, transactionFee, createdBy, createdAt, entryDate, imagePath)
         VALUES (@id, @fromAccountId, @toAccountId, @amount, @currencyCode, @description, @transactionFee, @createdBy, @createdAt, @entryDate, @imagePath);`
      );
      const entryDateValue = req.body?.entryDate ? new Date(req.body.entryDate).toISOString() : finalCreatedAt;
      const result = stmt.run({
        id: recordId,
        fromAccountId,
        toAccountId,
        amount: transferAmount,
        currencyCode: finalCurrencyCode,
        description: description || null,
        transactionFee: feeAmount > 0 ? feeAmount : null,
        createdBy: createdBy || null,
        createdAt: finalCreatedAt,
        entryDate: entryDateValue,
        imagePath: imagePath || null,
      });

      const transferId = result.lastInsertRowid;

      // Update balances (deduct only amount from fromAccount, add amount then deduct fee from toAccount)
      db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(transferAmount, fromAccountId);
      db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(transferAmount, toAccountId);
      if (feeAmount > 0) {
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(feeAmount, toAccountId);
      }

      // Create transaction records for both accounts with transfer ID
      const isImported = req.body?.isImported === true || req.body?.isImported === "true";
      const importedSuffix = isImported ? " (Imported)" : "";
      
      const baseTransferLabel = `Transfer #${transferId}${importedSuffix}`;
      const detailSuffix = description ? ` - ${description}` : "";
      const transferDescription = `${baseTransferLabel} to ${toAccount.name}${detailSuffix}`;
      const receiveDescription = `${baseTransferLabel} from ${fromAccount.name}${detailSuffix}`;

      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'withdraw', ?, ?, ?);`
      ).run(
        fromAccountId,
        transferAmount,
        transferDescription,
        finalCreatedAt
      );

      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'add', ?, ?, ?);`
      ).run(
        toAccountId,
        transferAmount,
        receiveDescription,
        finalCreatedAt
      );

      // Record transaction fee deduction on To Account if fee exists
      if (feeAmount > 0) {
        const feeDescription = description
          ? `${baseTransferLabel} fee on ${toAccount.name} - ${description}`
          : `${baseTransferLabel} fee on ${toAccount.name}`;
        
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'withdraw', ?, ?, ?);`
        ).run(
          toAccountId,
          feeAmount,
          feeDescription,
          finalCreatedAt
        );
      }

      // Log the initial creation as a change
      db.prepare(
        `INSERT INTO transfer_changes (transferId, changedBy, changedAt, fromAccountId, fromAccountName, toAccountId, toAccountName, amount, description, transactionFee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
      ).run(
        transferId,
        createdBy || null,
        new Date().toISOString(),
        fromAccountId,
        fromAccount.name,
        toAccountId,
        toAccount.name,
        transferAmount,
        description || null,
        feeAmount > 0 ? feeAmount : null
      );

      return transferId;
    });

    const transferId = transaction();

    // Handle tag assignments if provided
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const tagAssignmentStmt = db.prepare(
        `INSERT INTO transfer_tag_assignments (transferId, tagId) VALUES (?, ?);`
      );
      const insertTagAssignments = db.transaction((tags) => {
        for (const tagId of tags) {
          if (typeof tagId === 'number' && tagId > 0) {
            try {
              tagAssignmentStmt.run(transferId, tagId);
            } catch (err) {
              // Ignore duplicate or invalid tag assignments
            }
          }
        }
      });
      insertTagAssignments(tagIds);
    }

    // Get the created transfer with joined data
    const transfer = db
      .prepare(
        `SELECT 
          t.id,
          t.fromAccountId,
          t.toAccountId,
          t.amount,
          t.currencyCode,
          t.description,
          t.transactionFee,
          t.imagePath,
          t.createdBy,
          t.createdAt,
          t.updatedBy,
          t.updatedAt,
          fromAcc.name as fromAccountName,
          toAcc.name as toAccountName,
          creator.name as createdByName
         FROM internal_transfers t
         LEFT JOIN accounts fromAcc ON fromAcc.id = t.fromAccountId
         LEFT JOIN accounts toAcc ON toAcc.id = t.toAccountId
         LEFT JOIN users creator ON creator.id = t.createdBy
         WHERE t.id = ?;`
      )
      .get(transferId);

    // Get tags for the transfer
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN transfer_tag_assignments tta ON tta.tagId = t.id
         WHERE tta.transferId = ?
         ORDER BY t.name ASC;`
      )
      .all(transferId);

    // Send notification to all users about new transfer
    const allUsers = db.prepare("SELECT id FROM users").all();
    const allUserIds = allUsers.map(u => u.id);
    const creatorUser = db.prepare("SELECT name FROM users WHERE id = ?").get(transfer.createdBy);
    const fromAccountName = db.prepare("SELECT name FROM accounts WHERE id = ?").get(transfer.fromAccountId);
    const toAccountName = db.prepare("SELECT name FROM accounts WHERE id = ?").get(transfer.toAccountId);
    
    await createNotification({
      userId: allUserIds,
      type: 'transfer_created',
      title: 'New Transfer Created',
      message: `Transfer #${transferId} created by ${creatorUser?.name || 'User'} - ${transfer.amount} ${transfer.currencyCode} from ${fromAccountName?.name || 'Account'} to ${toAccountName?.name || 'Account'}`,
      entityType: 'transfer',
      entityId: transferId,
      actionUrl: `/transfers`,
    });

    res.status(201).json({
      ...transfer,
      tags: tags.length > 0 ? tags : [],
    });
    scheduleCacheSync({
      scopes: ["transfers", "accounts", "profitCalculations"],
      accountIds: [Number(transfer.fromAccountId), Number(transfer.toAccountId)].filter(
        (n) => Number.isFinite(n) && n > 0,
      ),
    });
  } catch (error) {
    next(error);
  }
};

export const updateTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fromAccountId, toAccountId, amount, description, transactionFee, updatedBy, tagIds, entryDate } = req.body || {};
    const file = req.file;

    // Get existing transfer
    const existingTransfer = db.prepare("SELECT * FROM internal_transfers WHERE id = ?;").get(id);
    if (!existingTransfer) {
      return res.status(404).json({ message: "Transfer not found" });
    }

    // Handle file upload for update
    let newImagePath = undefined; // undefined means "don't change"
    if (file) {
      // Delete old file if it exists
      if (existingTransfer.imagePath) {
        deleteFile(existingTransfer.imagePath);
      }
      const filename = generateTransferFilename(id, file.mimetype, file.originalname);
      newImagePath = saveFile(file.buffer, filename, "transfer");
    } else if (req.body?.imagePath !== undefined) {
      const provided = req.body.imagePath;
      if (!provided || provided === "") {
        // Explicitly clearing the image
        if (existingTransfer.imagePath) {
          deleteFile(existingTransfer.imagePath);
        }
        newImagePath = null;
      } else {
        newImagePath = normalizeStoredImagePath(provided) || provided;
      }
    }

    // Get account details
    const finalFromAccountId = fromAccountId !== undefined ? fromAccountId : existingTransfer.fromAccountId;
    const finalToAccountId = toAccountId !== undefined ? toAccountId : existingTransfer.toAccountId;
    const finalAmount = amount !== undefined ? Number(amount) : existingTransfer.amount;
    const finalDescription = description !== undefined ? (description || null) : existingTransfer.description;
    const finalTransactionFee = transactionFee !== undefined ? (transactionFee !== null && transactionFee !== "" ? Number(transactionFee) : null) : existingTransfer.transactionFee;
    
    if (finalTransactionFee !== null && finalTransactionFee !== undefined && finalTransactionFee < 0) {
      return res.status(400).json({ message: "Transaction fee must be a non-negative number" });
    }
    
    const feeAmount = finalTransactionFee !== null && finalTransactionFee !== undefined ? finalTransactionFee : 0;

    if (finalFromAccountId === finalToAccountId) {
      return res.status(400).json({ message: "Cannot transfer to the same account" });
    }

    const fromAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(finalFromAccountId);
    const toAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(finalToAccountId);

    if (!fromAccount || !toAccount) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (!requireAccountAccess(req, res, "transfer.account", finalFromAccountId, "You do not have access to use this transfer account")) {
      return;
    }
    if (!requireAccountAccess(req, res, "transfer.account", finalToAccountId, "You do not have access to use this transfer account")) {
      return;
    }

    if (fromAccount.currencyCode !== toAccount.currencyCode) {
      return res.status(400).json({ 
        message: `Cannot transfer between different currencies. From: ${fromAccount.currencyCode}, To: ${toAccount.currencyCode}` 
      });
    }

    if (isNaN(finalAmount) || finalAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const fromAccountChanged = fromAccountId !== undefined && fromAccountId !== existingTransfer.fromAccountId;
    const toAccountChanged = toAccountId !== undefined && toAccountId !== existingTransfer.toAccountId;
    const amountChanged = amount !== undefined && amount !== existingTransfer.amount;
    const feeChanged = transactionFee !== undefined && finalTransactionFee !== existingTransfer.transactionFee;
    const oldFeeAmount = existingTransfer.transactionFee || 0;

    // Perform update in a transaction
    const transaction = db.transaction(() => {
      // If accounts, amount, or fee changed, reverse old transfer and create new one
      if (fromAccountChanged || toAccountChanged || amountChanged || feeChanged) {
        // Reverse old transfer: add back only amount to old from account, deduct amount and add back fee to old to account
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
          existingTransfer.amount,
          existingTransfer.fromAccountId
        );
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
          existingTransfer.amount,
          existingTransfer.toAccountId
        );
        if (oldFeeAmount > 0) {
          db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
            oldFeeAmount,
            existingTransfer.toAccountId
          );
        }

        // Create reversal transactions with transfer ID
        const oldDescription = existingTransfer.description 
          ? `Transfer #${id} - ${existingTransfer.description}`
          : `Transfer #${id}`;

        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`
        ).run(
          existingTransfer.fromAccountId,
          existingTransfer.amount,
          `Reversal: ${oldDescription} (Order updated)`,
          new Date().toISOString()
        );

        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'withdraw', ?, ?, ?);`
        ).run(
          existingTransfer.toAccountId,
          existingTransfer.amount,
          `Reversal: ${oldDescription} (Order updated)`,
          new Date().toISOString()
        );

        // Reverse the fee deduction on old To Account if fee existed
        if (oldFeeAmount > 0) {
          const oldFeeDescription = existingTransfer.description
            ? `Transfer #${id} - Transaction fee: ${existingTransfer.description}`
            : `Transfer #${id} - Transaction fee`;
          
          db.prepare(
            `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
             VALUES (?, 'add', ?, ?, ?);`
          ).run(
            existingTransfer.toAccountId,
            oldFeeAmount,
            `Reversal: ${oldFeeDescription} (Order updated)`,
            new Date().toISOString()
          );
        }

        // Create new transfer: deduct only amount from new from account, add amount then deduct fee from new to account
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
          finalAmount,
          finalFromAccountId
        );
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
          finalAmount,
          finalToAccountId
        );
        if (feeAmount > 0) {
          db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
            feeAmount,
            finalToAccountId
          );
        }

        // Create new transactions with transfer ID
        const updatedBaseLabel = `Transfer #${id}`;
        const updatedDetailSuffix = finalDescription ? ` - ${finalDescription}` : "";
        const withdrawDescription = `${updatedBaseLabel} to ${toAccount.name}${updatedDetailSuffix}`;
        const depositDescription = `${updatedBaseLabel} from ${fromAccount.name}${updatedDetailSuffix}`;

        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'withdraw', ?, ?, ?);`
        ).run(
          finalFromAccountId,
          finalAmount,
          withdrawDescription,
          new Date().toISOString()
        );

        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`
        ).run(
          finalToAccountId,
          finalAmount,
          depositDescription,
          new Date().toISOString()
        );

        // Record transaction fee deduction on new To Account if fee exists
        if (feeAmount > 0) {
          const feeDescription = finalDescription
            ? `${updatedBaseLabel} fee on ${toAccount.name} - ${finalDescription}`
            : `${updatedBaseLabel} fee on ${toAccount.name}`;
          
          db.prepare(
            `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
             VALUES (?, 'withdraw', ?, ?, ?);`
          ).run(
            finalToAccountId,
            feeAmount,
            feeDescription,
            new Date().toISOString()
          );
        }
      }

      // Update transfer record
      const updateFields = [];
      const updateValues = [];
      
      if (fromAccountId !== undefined) updateFields.push("fromAccountId = ?"), updateValues.push(fromAccountId);
      if (toAccountId !== undefined) updateFields.push("toAccountId = ?"), updateValues.push(toAccountId);
      if (amount !== undefined) updateFields.push("amount = ?"), updateValues.push(finalAmount);
      if (description !== undefined) updateFields.push("description = ?"), updateValues.push(finalDescription || null);
      if (transactionFee !== undefined) updateFields.push("transactionFee = ?"), updateValues.push(finalTransactionFee);
      if (entryDate !== undefined) updateFields.push("entryDate = ?"), updateValues.push(entryDate ? new Date(entryDate).toISOString() : null);
      if (newImagePath !== undefined) updateFields.push("imagePath = ?"), updateValues.push(newImagePath);

      updateFields.push("updatedBy = ?"), updateValues.push(updatedBy || null);
      updateFields.push("updatedAt = ?"), updateValues.push(new Date().toISOString());
      updateValues.push(id);

      if (updateFields.length > 2) {
        db.prepare(`UPDATE internal_transfers SET ${updateFields.join(", ")} WHERE id = ?;`).run(...updateValues);
        
        // Log the change if accounts, amount, description, or fee changed
        if (fromAccountId !== undefined || toAccountId !== undefined || amount !== undefined || description !== undefined || transactionFee !== undefined) {
          db.prepare(
            `INSERT INTO transfer_changes (transferId, changedBy, changedAt, fromAccountId, fromAccountName, toAccountId, toAccountName, amount, description, transactionFee)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
          ).run(
            id,
            updatedBy || null,
            new Date().toISOString(),
            finalFromAccountId,
            fromAccount.name,
            finalToAccountId,
            toAccount.name,
            finalAmount,
            finalDescription,
            finalTransactionFee
          );
        }
      }
    });

    transaction();

    // Handle tag assignments if provided
    if (tagIds !== undefined) {
      // Remove all existing tag assignments
      db.prepare("DELETE FROM transfer_tag_assignments WHERE transferId = ?;").run(id);
      
      // Add new tag assignments if provided
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        const tagAssignmentStmt = db.prepare(
          `INSERT INTO transfer_tag_assignments (transferId, tagId) VALUES (?, ?);`
        );
        const insertTagAssignments = db.transaction((tags) => {
          for (const tagId of tags) {
            if (typeof tagId === 'number' && tagId > 0) {
              try {
                tagAssignmentStmt.run(id, tagId);
              } catch (err) {
                // Ignore duplicate or invalid tag assignments
              }
            }
          }
        });
        insertTagAssignments(tagIds);
      }
    }

    // Get the updated transfer with joined data
    const transfer = db
      .prepare(
        `SELECT 
          t.id,
          t.fromAccountId,
          t.toAccountId,
          t.amount,
          t.currencyCode,
          t.description,
          t.transactionFee,
          t.imagePath,
          t.createdBy,
          t.createdAt,
          t.updatedBy,
          t.updatedAt,
          fromAcc.name as fromAccountName,
          toAcc.name as toAccountName,
          creator.name as createdByName,
          updater.name as updatedByName
         FROM internal_transfers t
         LEFT JOIN accounts fromAcc ON fromAcc.id = t.fromAccountId
         LEFT JOIN accounts toAcc ON toAcc.id = t.toAccountId
         LEFT JOIN users creator ON creator.id = t.createdBy
         LEFT JOIN users updater ON updater.id = t.updatedBy
         WHERE t.id = ?;`
      )
      .get(id);

    // Get tags for the transfer
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN transfer_tag_assignments tta ON tta.tagId = t.id
         WHERE tta.transferId = ?
         ORDER BY t.name ASC;`
      )
      .all(id);

    res.json({
      ...transfer,
      tags: tags.length > 0 ? tags : [],
    });
    const ids = new Set(
      [
        existingTransfer.fromAccountId,
        existingTransfer.toAccountId,
        transfer.fromAccountId,
        transfer.toAccountId,
      ]
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0),
    );
    scheduleCacheSync({
      scopes: ["transfers", "accounts", "profitCalculations"],
      accountIds: [...ids],
    });
  } catch (error) {
    next(error);
  }
};

export const getTransferChanges = (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Check if transfer exists
    const transfer = db.prepare("SELECT id FROM internal_transfers WHERE id = ?;").get(id);
    if (!transfer) {
      return res.status(404).json({ message: "Transfer not found" });
    }

    // Get all changes for this transfer
    const changes = db
      .prepare(
        `SELECT 
          tc.*,
          u.name as changedByName
         FROM transfer_changes tc
         LEFT JOIN users u ON u.id = tc.changedBy
         WHERE tc.transferId = ?
         ORDER BY tc.changedAt ASC;`
      )
      .all(id);

    res.json(changes);
  } catch (error) {
    next(error);
  }
};

export const deleteTransfer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = getUserIdFromHeader(req);

    // Check if transfer exists
    const transfer = db.prepare("SELECT * FROM internal_transfers WHERE id = ?;").get(id);
    if (!transfer) {
      return res.status(404).json({ message: "Transfer not found" });
    }

    // Get account details for reversal
    const fromAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(transfer.fromAccountId);
    const toAccount = db.prepare("SELECT id, name, balance, currencyCode FROM accounts WHERE id = ?;").get(transfer.toAccountId);

    if (!fromAccount || !toAccount) {
      return res.status(404).json({ message: "Account not found" });
    }

    const transferAmount = transfer.amount;
    const feeAmount = transfer.transactionFee || 0;

    // Perform reversal in a transaction
    const transaction = db.transaction(() => {
      // Reverse balances: add back amount to fromAccount, deduct amount and add back fee to toAccount
      db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(transferAmount, transfer.fromAccountId);
      db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(transferAmount, transfer.toAccountId);
      if (feeAmount > 0) {
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(feeAmount, transfer.toAccountId);
      }

      // Create reversal transaction records with transfer ID and counterparty clarity
      const baseTransferLabel = `Transfer #${id}`;
      const detailSuffix = transfer.description ? ` - ${transfer.description}` : "";
      const reversalToDescription = `${baseTransferLabel} from ${toAccount.name}${detailSuffix}`;
      const reversalFromDescription = `${baseTransferLabel} to ${fromAccount.name}${detailSuffix}`;
      
      // Reversal for fromAccount (add back the amount)
      // Use current time to ensure reversal appears at top of transaction history
      const reversalCreatedAt = new Date().toISOString();
      
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'add', ?, ?, ?);`
      ).run(
        transfer.fromAccountId,
        transferAmount,
        `Reversal: ${reversalToDescription} (Deleted)`,
        reversalCreatedAt
      );

      // Reversal for toAccount (deduct back the amount)
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'withdraw', ?, ?, ?);`
      ).run(
        transfer.toAccountId,
        transferAmount,
        `Reversal: ${reversalFromDescription} (Deleted)`,
        reversalCreatedAt
      );

      // Reversal for fee on toAccount (add back the fee)
      if (feeAmount > 0) {
        const feeDescription = transfer.description
          ? `${baseTransferLabel} fee on ${toAccount.name} - ${transfer.description}`
          : `${baseTransferLabel} fee on ${toAccount.name}`;
        
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`
        ).run(
          transfer.toAccountId,
          feeAmount,
          `Reversal: ${feeDescription} (Deleted)`,
          reversalCreatedAt
        );
      }

      // Delete transfer changes first (foreign key constraint)
      db.prepare("DELETE FROM transfer_changes WHERE transferId = ?;").run(id);
      
      // Delete transfer record
      db.prepare("DELETE FROM internal_transfers WHERE id = ?;").run(id);
    });

    transaction();

    // Send notification to all users about transfer deletion
    const allUsers = db.prepare("SELECT id FROM users").all();
    const allUserIds = allUsers.map(u => u.id);
    const userName = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
    
    await createNotification({
      userId: allUserIds,
      type: 'transfer_deleted',
      title: 'Transfer Deleted',
      message: `Transfer #${id} - ${transfer.amount} ${transfer.currencyCode} from ${fromAccount.name} to ${toAccount.name} deleted by ${userName?.name || 'User'}`,
      entityType: 'transfer',
      entityId: id,
      actionUrl: `/transfers`,
    });
    
    res.json({ success: true });
    scheduleCacheSync({
      scopes: ["transfers", "accounts", "profitCalculations"],
      accountIds: [Number(transfer.fromAccountId), Number(transfer.toAccountId)].filter(
        (n) => Number.isFinite(n) && n > 0,
      ),
    });
  } catch (error) {
    next(error);
  }
};

