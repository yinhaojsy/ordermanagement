import { db } from "../db.js";
import {
  saveFile,
  deleteFile,
  generateOrderReceiptFilename,
  generateOrderPaymentFilename,
  base64ToBuffer,
  getFileUrl,
  normalizeStoredImagePath,
} from "../utils/fileStorage.js";
import { getUserIdFromHeader } from "../utils/auth.js";
import { createNotification } from "../services/notification/notificationService.js";
import { getUserPermissions, isAdmin, canModifyOrder, canEditAnyOrder, canPinOrders } from "../utils/orderPermissions.js";
import {
  getAllowedAccountIdsForUser,
  requireAccountAccess,
} from "../utils/accountAccess.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";
import { convertCurrency } from "../utils/currencyConversion.js";
import {
  syncCustomerLedgerForCompletedOrder,
  syncCustomerLedgerOnOrderCancelOrDelete,
  purgeLedgerEntriesForOrder,
  notifyCustomerLedger,
} from "../services/customerLedgerOrders.js";
import { assertAllocatableBalance, assertAllocatableOwed } from "../services/customerLedgerAccounts.js";
import {
  isCustomerBalanceFunded,
  normalizeReceiptFundedFrom,
  RECEIPT_FUNDED_CUSTOMER_BALANCE,
} from "../utils/orderReceiptFunding.js";
import {
  isLedgerSwapOrder,
  normalizeOrderMode,
  ORDER_MODE_LEDGER_SWAP,
} from "../utils/orderMode.js";

function ledgerSwapFunding(order, fundedFromRaw) {
  if (isLedgerSwapOrder(order)) {
    return RECEIPT_FUNDED_CUSTOMER_BALANCE;
  }
  return normalizeReceiptFundedFrom(fundedFromRaw);
}

function trySyncCompletedOrderLedger(orderId, userId) {
  try {
    const row = db.prepare("SELECT status FROM orders WHERE id = ?;").get(orderId);
    if (row?.status === "completed") {
      syncCustomerLedgerForCompletedOrder(orderId, userId);
    }
  } catch (err) {
    console.error("[trySyncCompletedOrderLedger]", orderId, err);
  }
}

function resolveServiceChargeFunding({ fundedFrom, amount, accountId, customerId }) {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    return { error: "amount must be a non-zero number" };
  }

  const normalizedFundedFrom = normalizeReceiptFundedFrom(fundedFrom);
  if (normalizedFundedFrom === RECEIPT_FUNDED_CUSTOMER_BALANCE) {
    if (!customerId) {
      return { error: "Order must have a customer to use prepaid balance for service charge" };
    }
    return { fundedFrom: normalizedFundedFrom, accountId: null, amount: parsedAmount };
  }

  if (!accountId) {
    return { error: "accountId is required for cash-funded service charge" };
  }
  return { fundedFrom: normalizedFundedFrom, accountId: Number(accountId), amount: parsedAmount };
}

function assertServiceChargeBalanceOnConfirm(serviceCharge) {
  if (!isCustomerBalanceFunded(serviceCharge)) return null;
  const order = db
    .prepare("SELECT id, customerId FROM orders WHERE id = ?;")
    .get(serviceCharge.orderId);
  if (!order?.customerId) {
    return { status: 400, message: "Order must have a customer to use prepaid balance for service charge" };
  }
  const amount = Math.abs(Number(serviceCharge.amount));
  if (!amount) {
    return { status: 400, message: "Service charge amount must be non-zero" };
  }
  try {
    assertAllocatableBalance(
      order.customerId,
      serviceCharge.currencyCode,
      amount,
      null,
      serviceCharge.id,
    );
  } catch (err) {
    if (err.status) {
      return { status: err.status, message: err.message };
    }
    throw err;
  }
  return null;
}

function applyCashServiceChargeAccountEffects(serviceCharge, orderId) {
  if (isCustomerBalanceFunded(serviceCharge) || !serviceCharge.accountId) return;

  const accountForBalance = db
    .prepare("SELECT balance FROM accounts WHERE id = ?;")
    .get(serviceCharge.accountId);
  if (!accountForBalance) return;

  const oldBalance = accountForBalance.balance;
  const amount = Number(serviceCharge.amount);

  if (amount > 0) {
    const newBalance = oldBalance + amount;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, serviceCharge.accountId);
    db.prepare(
      `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
       VALUES (?, 'add', ?, ?, ?);`,
    ).run(
      serviceCharge.accountId,
      amount,
      `Order #${orderId} - Service charge`,
      new Date().toISOString(),
    );
  } else if (amount < 0) {
    const absAmount = Math.abs(amount);
    const newBalance = oldBalance - absAmount;
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, serviceCharge.accountId);
    db.prepare(
      `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
       VALUES (?, 'withdraw', ?, ?, ?);`,
    ).run(
      serviceCharge.accountId,
      absAmount,
      `Order #${orderId} - Service charge borne by company`,
      new Date().toISOString(),
    );
  }
}

function reverseCashServiceChargeAccountEffects(serviceCharge, orderId, reasonLabel) {
  if (isCustomerBalanceFunded(serviceCharge) || !serviceCharge.accountId) return;

  const serviceChargeAmount = Number(serviceCharge.amount);
  if (isNaN(serviceChargeAmount) || serviceChargeAmount === 0) return;

  if (serviceChargeAmount > 0) {
    db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
      serviceChargeAmount,
      serviceCharge.accountId,
    );
    db.prepare(
      `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
       VALUES (?, 'withdraw', ?, ?, ?);`,
    ).run(
      serviceCharge.accountId,
      serviceChargeAmount,
      `Order #${orderId} - Reversal of service charge (${reasonLabel})`,
      new Date().toISOString(),
    );
  } else {
    const absAmount = Math.abs(serviceChargeAmount);
    db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
      absAmount,
      serviceCharge.accountId,
    );
    db.prepare(
      `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
       VALUES (?, 'add', ?, ?, ?);`,
    ).run(
      serviceCharge.accountId,
      absAmount,
      `Order #${orderId} - Reversal of service charge borne by company (${reasonLabel})`,
      new Date().toISOString(),
    );
  }
}

const ORDER_AUDIT_FIELDS = [
  "customerId",
  "fromCurrency",
  "toCurrency",
  "amountBuy",
  "amountSell",
  "rate",
  "status",
  "remarks",
  "buyAccountId",
  "sellAccountId",
  "handlerId",
  "orderType",
  "orderMode",
];

function pickOrderAuditSnapshot(row) {
  if (!row) return null;
  const out = {};
  for (const k of ORDER_AUDIT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      out[k] = row[k];
    }
  }
  return out;
}

function insertOrderChange(orderId, userId, beforeRow, afterRow) {
  try {
    db.prepare(
      `INSERT INTO order_changes (orderId, changedBy, changedAt, beforeJson, afterJson)
       VALUES (?, ?, ?, ?, ?);`,
    ).run(
      orderId,
      userId || null,
      new Date().toISOString(),
      JSON.stringify(pickOrderAuditSnapshot(beforeRow)),
      JSON.stringify(pickOrderAuditSnapshot(afterRow)),
    );
  } catch (e) {
    console.error("[insertOrderChange]", e);
  }
}

function notifyOrderPins(orderId) {
  scheduleCacheSync({
    scopes: ["orders"],
    orderId: orderId != null ? Number(orderId) : undefined,
  });
}

function notifyOrderPinsGlobal() {
  scheduleCacheSync({ scopes: ["orders"] });
}

function notifyOrderWrite(orderId) {
  scheduleCacheSync({
    scopes: ["orders", "profitCalculations"],
    orderId: orderId != null ? Number(orderId) : undefined,
  });
}

function notifyOrderFinancial(orderId, accountIds) {
  scheduleCacheSync({
    scopes: ["orders", "profitCalculations", "accounts"],
    orderId: orderId != null ? Number(orderId) : undefined,
    accountIds:
      accountIds && accountIds.length > 0
        ? [...new Set(accountIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
        : undefined,
  });
}

const MAX_ORDER_PINS_GLOBAL = 10;

function userCanAccessOrderForListing(userId, orderId) {
  const exists = db.prepare("SELECT 1 FROM orders WHERE id = ?;").get(orderId);
  if (!exists) return false;
  const allowedOrderAccountIds = getAllowedAccountIdsForUser(userId, "order.account");
  if (!Array.isArray(allowedOrderAccountIds)) return true;
  if (allowedOrderAccountIds.length === 0) return false;
  const params = { orderId };
  const placeholders = allowedOrderAccountIds.map((accountId, index) => {
    const key = `acc${index}`;
    params[key] = accountId;
    return `@${key}`;
  }).join(",");
  const sql = `SELECT 1 FROM orders o WHERE o.id = @orderId AND (
    EXISTS (SELECT 1 FROM order_receipts r WHERE r.orderId = o.id AND r.accountId IN (${placeholders}))
    OR EXISTS (SELECT 1 FROM order_payments p WHERE p.orderId = o.id AND p.accountId IN (${placeholders}))
    OR EXISTS (SELECT 1 FROM order_service_charges sc WHERE sc.orderId = o.id AND sc.accountId IN (${placeholders}))
    OR o.serviceChargeAccountId IN (${placeholders})
  )`;
  return Boolean(db.prepare(sql).get(params));
}

export const COF_ACCOUNT_LABEL = "COF";

function buildBuyAccountsForOrder(orderId) {
  const cash = db
    .prepare(
      `SELECT r.accountId, a.name as accountName, SUM(r.amount) as totalAmount, MIN(r.createdAt) as firstCreatedAt
       FROM order_receipts r
       LEFT JOIN accounts a ON a.id = r.accountId
       WHERE r.orderId = ? AND r.accountId IS NOT NULL
       GROUP BY r.accountId, a.name
       ORDER BY firstCreatedAt ASC;`,
    )
    .all(orderId);

  const cofRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS totalAmount, MIN(createdAt) AS firstCreatedAt
       FROM order_receipts
       WHERE orderId = ? AND fundedFrom = 'customer_balance';`,
    )
    .get(orderId);

  const entries = cash.map((r) => ({
    accountId: r.accountId,
    accountName: r.accountName || `Account #${r.accountId}`,
    amount: r.totalAmount,
    firstCreatedAt: r.firstCreatedAt,
    isCof: false,
  }));

  if (cofRow && Number(cofRow.totalAmount) > 0) {
    entries.push({
      accountId: null,
      accountName: COF_ACCOUNT_LABEL,
      amount: cofRow.totalAmount,
      firstCreatedAt: cofRow.firstCreatedAt,
      isCof: true,
    });
  }

  entries.sort(
    (a, b) => new Date(a.firstCreatedAt).getTime() - new Date(b.firstCreatedAt).getTime(),
  );

  return entries.map(({ accountId, accountName, amount, isCof }) => ({
    accountId,
    accountName,
    amount,
    isCof,
  }));
}

function buildSellAccountsForOrder(orderId) {
  const cash = db
    .prepare(
      `SELECT p.accountId, a.name as accountName, SUM(p.amount) as totalAmount, MIN(p.createdAt) as firstCreatedAt
       FROM order_payments p
       LEFT JOIN accounts a ON a.id = p.accountId
       WHERE p.orderId = ? AND p.accountId IS NOT NULL
       GROUP BY p.accountId, a.name
       ORDER BY firstCreatedAt ASC;`,
    )
    .all(orderId);

  const cofRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS totalAmount, MIN(createdAt) AS firstCreatedAt
       FROM order_payments
       WHERE orderId = ? AND fundedFrom = 'customer_balance';`,
    )
    .get(orderId);

  const entries = cash.map((p) => ({
    accountId: p.accountId,
    accountName: p.accountName || `Account #${p.accountId}`,
    amount: p.totalAmount,
    firstCreatedAt: p.firstCreatedAt,
    isCof: false,
  }));

  if (cofRow && Number(cofRow.totalAmount) > 0) {
    entries.push({
      accountId: null,
      accountName: COF_ACCOUNT_LABEL,
      amount: cofRow.totalAmount,
      firstCreatedAt: cofRow.firstCreatedAt,
      isCof: true,
    });
  }

  entries.sort(
    (a, b) => new Date(a.firstCreatedAt).getTime() - new Date(b.firstCreatedAt).getTime(),
  );

  return entries.map(({ accountId, accountName, amount, isCof }) => ({
    accountId,
    accountName,
    amount,
    isCof,
  }));
}

/** Filter orders where any account name matches keyword (receipts, payments, SC, profit, legacy). */
function appendOrderAccountSearchFilter(conditions, params, searchRaw) {
  const q = String(searchRaw || "").trim().toLowerCase();
  if (!q) return;
  params.accountSearch = `%${q}%`;

  const COF_LABEL = "cof";
  const matchCof = COF_LABEL.includes(q) || q.includes(COF_LABEL);

  const parts = [
    `EXISTS (
      SELECT 1 FROM order_receipts r
      INNER JOIN accounts a ON a.id = r.accountId
      WHERE r.orderId = o.id AND lower(a.name) LIKE @accountSearch
    )`,
    `EXISTS (
      SELECT 1 FROM order_payments p
      INNER JOIN accounts a ON a.id = p.accountId
      WHERE p.orderId = o.id AND lower(a.name) LIKE @accountSearch
    )`,
    `EXISTS (
      SELECT 1 FROM order_service_charges sc
      INNER JOIN accounts a ON a.id = sc.accountId
      WHERE sc.orderId = o.id AND lower(a.name) LIKE @accountSearch
    )`,
    `EXISTS (
      SELECT 1 FROM order_profits op
      INNER JOIN accounts a ON a.id = op.accountId
      WHERE op.orderId = o.id AND lower(a.name) LIKE @accountSearch
    )`,
    `EXISTS (
      SELECT 1 FROM accounts ba
      WHERE ba.id = o.buyAccountId AND lower(ba.name) LIKE @accountSearch
    )`,
    `EXISTS (
      SELECT 1 FROM accounts sa
      WHERE sa.id = o.sellAccountId AND lower(sa.name) LIKE @accountSearch
    )`,
  ];

  if (matchCof) {
    parts.push(
      `EXISTS (SELECT 1 FROM order_receipts r2 WHERE r2.orderId = o.id AND r2.fundedFrom = 'customer_balance')`,
      `EXISTS (SELECT 1 FROM order_payments p2 WHERE p2.orderId = o.id AND p2.fundedFrom = 'customer_balance')`,
      `EXISTS (SELECT 1 FROM order_service_charges sc2 WHERE sc2.orderId = o.id AND sc2.fundedFrom = 'customer_balance')`,
      `COALESCE(o.orderMode, 'exchange') = 'ledger_swap'`,
    );
  }

  conditions.push(`(${parts.join(" OR ")})`);
}

function listGlobalPinnedOrderIds() {
  return db
    .prepare("SELECT orderId FROM order_pins ORDER BY sortOrder ASC;")
    .all()
    .map((r) => r.orderId);
}

// Helper function to calculate amountSell from amountBuy using the same logic as order creation (OrdersPage.tsx lines 298-365)
const calculateAmountSell = (amountBuy, rate, fromCurrency, toCurrency) => {
  // Determine which side is the "stronger" currency so we know which way to apply the rate.
  // Heuristic: USDT (or any currency with rate <= 1) is the base; otherwise pick the currency with the smaller rate.
  const getCurrencyRate = (code) => {
    const currency = db.prepare("SELECT baseRateBuy, conversionRateBuy, baseRateSell, conversionRateSell FROM currencies WHERE code = ? AND active = 1;").get(code);
    if (!currency) return null;
    const candidate = currency.conversionRateBuy ?? currency.baseRateBuy ?? currency.baseRateSell ?? currency.conversionRateSell;
    return typeof candidate === "number" ? candidate : null;
  };

  const fromRate = getCurrencyRate(fromCurrency);
  const toRate = getCurrencyRate(toCurrency);

  const inferredFromIsUSDT = fromRate !== null ? fromRate <= 1 : fromCurrency === "USDT";
  const inferredToIsUSDT = toRate !== null ? toRate <= 1 : toCurrency === "USDT";

  // If both sides look like USDT (rate <= 1), nothing to auto-calc - default to fromCurrency as base
  if (inferredFromIsUSDT && inferredToIsUSDT) {
    // Default: multiply (baseIsFrom = true)
    return amountBuy * rate;
  }

  let baseIsFrom = null;
  if (inferredFromIsUSDT !== inferredToIsUSDT) {
    // One side is USDT (or behaves like it)
    baseIsFrom = inferredFromIsUSDT;
  } else if (!inferredFromIsUSDT && !inferredToIsUSDT && fromRate !== null && toRate !== null) {
    // Neither is USDT: pick the currency with the smaller rate as the stronger/base currency
    baseIsFrom = fromRate < toRate;
  } else {
    // Default to fromCurrency as base if we can't determine
    baseIsFrom = true;
  }

  if (baseIsFrom) {
    // Stronger/base currency (fromCurrency) → weaker: multiply by rate
    return amountBuy * rate;
  } else {
    // Weaker → stronger/base currency (toCurrency): divide by rate
    return amountBuy / rate;
  }
};

// Helper function to reverse calculateAmountSell: calculate amountBuy from amountSell
const calculateAmountBuy = (amountSell, rate, fromCurrency, toCurrency) => {
  const getCurrencyRate = (code) => {
    const currency = db.prepare("SELECT baseRateBuy, conversionRateBuy, baseRateSell, conversionRateSell FROM currencies WHERE code = ? AND active = 1;").get(code);
    if (!currency) return null;
    const candidate = currency.conversionRateBuy ?? currency.baseRateBuy ?? currency.baseRateSell ?? currency.conversionRateSell;
    return typeof candidate === "number" ? candidate : null;
  };

  const fromRate = getCurrencyRate(fromCurrency);
  const toRate = getCurrencyRate(toCurrency);

  const inferredFromIsUSDT = fromRate !== null ? fromRate <= 1 : fromCurrency === "USDT";
  const inferredToIsUSDT = toRate !== null ? toRate <= 1 : toCurrency === "USDT";

  // If both sides look like USDT (rate <= 1), default to fromCurrency as base
  if (inferredFromIsUSDT && inferredToIsUSDT) {
    // Reverse: if amountSell = amountBuy * rate, then amountBuy = amountSell / rate
    return amountSell / rate;
  }

  let baseIsFrom = null;
  if (inferredFromIsUSDT !== inferredToIsUSDT) {
    baseIsFrom = inferredFromIsUSDT;
  } else if (!inferredFromIsUSDT && !inferredToIsUSDT && fromRate !== null && toRate !== null) {
    baseIsFrom = fromRate < toRate;
  } else {
    baseIsFrom = true;
  }

  if (baseIsFrom) {
    // Reverse: if amountSell = amountBuy * rate, then amountBuy = amountSell / rate
    return amountSell / rate;
  } else {
    // Reverse: if amountSell = amountBuy / rate, then amountBuy = amountSell * rate
    return amountSell * rate;
  }
};

/** Service charge lines for profit calc (confirmed, else draft) — same rules as the orders table row. */
function getServiceChargeEntriesForOrder(orderId) {
  const confirmedScRows = db
    .prepare(
      `SELECT SUM(amount) as total, currencyCode
       FROM order_service_charges
       WHERE orderId = ? AND status = 'confirmed'
       GROUP BY currencyCode
       ORDER BY MIN(createdAt) ASC;`,
    )
    .all(orderId);
  const scRows =
    confirmedScRows.length > 0
      ? confirmedScRows
      : db
          .prepare(
            `SELECT SUM(amount) as total, currencyCode
             FROM order_service_charges
             WHERE orderId = ? AND status = 'draft'
             GROUP BY currencyCode
             ORDER BY MIN(createdAt) ASC;`,
          )
          .all(orderId);
  return scRows.map((r) => ({ amount: Number(r.total), currency: r.currencyCode }));
}

/** Auto-calculated profit in target currency — same formula as the Profit column in the table. */
function computeCalculatedProfit(order, serviceChargeEntries, profitTargetCurrency, calcConvertToTarget) {
  if (!profitTargetCurrency) return null;
  const received = calcConvertToTarget(Number(order.amountBuy), order.fromCurrency);
  const paid = calcConvertToTarget(Number(order.amountSell), order.toCurrency);
  if (received === null || paid === null) return null;

  let scTotal = 0;
  for (const sc of serviceChargeEntries) {
    const cv = calcConvertToTarget(sc.amount, sc.currency);
    if (cv === null) return null;
    scTotal += cv;
  }

  const result = received - paid + scTotal;
  return Number.isFinite(result) ? result : null;
}

export const listOrders = (req, res) => {
  // Extract query parameters
  const {
    dateFrom,
    dateTo,
    handlerId,
    customerId,
    fromCurrency,
    toCurrency,
    currencyPairs,
    accountSearch,
    status,
    orderType,
    tagId,
    tagIds,
    page = '1',
    limit = '20',
  } = req.query;

  // Build WHERE clause conditions
  const conditions = [];
  const params = {};
  const userId = getUserIdFromHeader(req);

  const allowedOrderAccountIds = getAllowedAccountIdsForUser(userId, "order.account");
  if (Array.isArray(allowedOrderAccountIds)) {
    if (allowedOrderAccountIds.length === 0) {
      conditions.push("1 = 0");
    } else {
      const placeholders = allowedOrderAccountIds.map((accountId, index) => {
        const key = `orderAccountAccess${index}`;
        params[key] = accountId;
        return `@${key}`;
      }).join(",");
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM order_receipts r
          WHERE r.orderId = o.id AND r.accountId IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM order_payments p
          WHERE p.orderId = o.id AND p.accountId IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM order_service_charges sc
          WHERE sc.orderId = o.id AND sc.accountId IN (${placeholders})
        )
        OR o.serviceChargeAccountId IN (${placeholders})
      )`);
    }
  }

  if (dateFrom) {
    conditions.push('DATE(COALESCE(o.orderDate, o.createdAt)) >= DATE(@dateFrom)');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push('DATE(COALESCE(o.orderDate, o.createdAt)) <= DATE(@dateTo)');
    params.dateTo = dateTo;
  }
  if (handlerId) {
    conditions.push('o.handlerId = @handlerId');
    params.handlerId = parseInt(handlerId, 10);
  }
  if (customerId) {
    conditions.push('o.customerId = @customerId');
    params.customerId = parseInt(customerId, 10);
  }
  // Support multi-select currency pairs (comma-separated "FROM/TO" list)
  if (currencyPairs) {
    const pairList = String(currencyPairs).split(',').map((p) => p.trim()).filter(Boolean);
    if (pairList.length === 1) {
      const [from, to] = pairList[0].split('/');
      if (from) { conditions.push('o.fromCurrency = @cpFrom0'); params.cpFrom0 = from; }
      if (to) { conditions.push('o.toCurrency = @cpTo0'); params.cpTo0 = to; }
    } else if (pairList.length > 1) {
      const pairClauses = pairList.map((pair, i) => {
        const [from, to] = pair.split('/');
        const fromKey = `cpFrom${i}`;
        const toKey = `cpTo${i}`;
        params[fromKey] = from || '';
        params[toKey] = to || '';
        return `(o.fromCurrency = @${fromKey} AND o.toCurrency = @${toKey})`;
      });
      conditions.push(`(${pairClauses.join(' OR ')})`);
    }
  } else if (fromCurrency) {
    conditions.push('o.fromCurrency = @fromCurrency');
    params.fromCurrency = fromCurrency;
    if (toCurrency) {
      conditions.push('o.toCurrency = @toCurrency');
      params.toCurrency = toCurrency;
    }
  }
  if (accountSearch) {
    appendOrderAccountSearchFilter(conditions, params, accountSearch);
  }
  if (status) {
    conditions.push('o.status = @status');
    params.status = status;
  }
  if (orderType) {
    conditions.push('o.orderType = @orderType');
    params.orderType = orderType;
  }
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
      SELECT 1 FROM order_tag_assignments ota 
      WHERE ota.orderId = o.id AND ota.tagId IN (${placeholders})
    )`);
    parsedTagIds.forEach((id, i) => {
      params[`tagId${i}`] = id;
    });
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count for pagination
  const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
  const countResult = db.prepare(countQuery).get(params);
  const total = countResult?.total || 0;

  // Calculate pagination
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;
  const totalPages = Math.ceil(total / limitNum);

  // Build main query with pagination (team-wide pinned rows first, then by date)
  const query = `
    SELECT o.*, c.name as customerName, u.name as handlerName,
           COALESCE(cu.name, u.name) as createdByName,
           buyAcc.name as buyAccountName, sellAcc.name as sellAccountName,
           op.sortOrder AS pinSortOrder
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customerId
    LEFT JOIN users u ON u.id = o.handlerId
    LEFT JOIN users cu ON cu.id = o.createdBy
    LEFT JOIN accounts buyAcc ON buyAcc.id = o.buyAccountId
    LEFT JOIN accounts sellAcc ON sellAcc.id = o.sellAccountId
    LEFT JOIN order_pins op ON op.orderId = o.id
    ${whereClause}
    ORDER BY CASE WHEN op.sortOrder IS NOT NULL THEN 0 ELSE 1 END ASC,
             op.sortOrder ASC,
             COALESCE(o.orderDate, o.createdAt) DESC
    LIMIT @limit OFFSET @offset;
  `;

  // Snapshot params before adding pagination limits (used later for profit aggregation)
  const filterOnlyParams = { ...params };

  params.limit = limitNum;
  params.offset = offset;

  const rows = db.prepare(query).all(params);

  // Load default profit calculation once for auto-calculated profit column
  const defaultProfitCalc = db
    .prepare("SELECT id, targetCurrencyCode FROM profit_calculations WHERE isDefault = 1 LIMIT 1;")
    .get();
  const profitTargetCurrency = defaultProfitCalc?.targetCurrencyCode ?? null;
  const profitRateMap = new Map();
  const allCurrenciesForProfit = defaultProfitCalc
    ? db.prepare("SELECT * FROM currencies ORDER BY code ASC;").all()
    : [];
  if (defaultProfitCalc) {
    db.prepare(
      "SELECT fromCurrencyCode, toCurrencyCode, rate FROM profit_exchange_rates WHERE profitCalculationId = ?;"
    ).all(defaultProfitCalc.id).forEach((r) => {
      profitRateMap.set(`${r.fromCurrencyCode}_${r.toCurrencyCode}`, r.rate);
    });
  }

  const calcConvertToTarget = (amount, currency) => {
    if (!profitTargetCurrency) return null;
    if (currency === profitTargetCurrency) return amount;
    const rate = profitRateMap.get(`${currency}_${profitTargetCurrency}`);
    if (!rate) return null;
    return convertCurrency(amount, rate, currency, profitTargetCurrency, allCurrenciesForProfit);
  };

  // Total profit for filtered orders with status = completed only (list may show cancelled/saved for records)
  let totalCalculatedProfit = null;
  if (profitTargetCurrency) {
    const profitWhereClause = whereClause
      ? `${whereClause} AND o.status = 'completed'`
      : `WHERE o.status = 'completed'`;
    const allFilteredOrdersQuery = `
      SELECT o.id, o.fromCurrency, o.toCurrency, o.amountBuy, o.amountSell
      FROM orders o
      ${profitWhereClause}
    `;
    const allFilteredOrders = db.prepare(allFilteredOrdersQuery).all(filterOnlyParams);
    let profitSum = 0;
    for (const o of allFilteredOrders) {
      const scEntries = getServiceChargeEntriesForOrder(o.id);
      const cp = computeCalculatedProfit(o, scEntries, profitTargetCurrency, calcConvertToTarget);
      if (cp !== null) profitSum += cp;
    }
    totalCalculatedProfit = profitSum;
  }

  // Parse JSON fields and check for beneficiaries
  const orders = rows.map((rawRow) => {
    const { pinSortOrder, ...order } = rawRow;
    const pinned = pinSortOrder != null;
    const pinOrder = pinned ? pinSortOrder : undefined;
    try {
      // Check if order has beneficiaries
      const beneficiaryCount = db
        .prepare("SELECT COUNT(*) as count FROM order_beneficiaries WHERE orderId = ?;")
        .get(order.id);
      const hasBeneficiaries = (beneficiaryCount?.count || 0) > 0;

      const buyAccounts = buildBuyAccountsForOrder(order.id);
      const sellAccounts = buildSellAccountsForOrder(order.id);

      // Get tags for this order
      const tags = db
        .prepare(
          `SELECT t.id, t.name, t.color 
           FROM tags t
           INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
           WHERE ota.orderId = ?
           ORDER BY t.name ASC;`
        )
        .all(order.id);

      // Sum all confirmed profits per currency; fall back to drafts if no confirmed entries
      const confirmedProfitRows = db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_profits
           WHERE orderId = ? AND status = 'confirmed'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      const profitRows = confirmedProfitRows.length > 0 ? confirmedProfitRows : db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_profits
           WHERE orderId = ? AND status = 'draft'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      // Sum all confirmed service charges per currency; fall back to drafts if none
      const confirmedScRows = db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_service_charges
           WHERE orderId = ? AND status = 'confirmed'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      const scRows = confirmedScRows.length > 0 ? confirmedScRows : db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_service_charges
           WHERE orderId = ? AND status = 'draft'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      // Build entries arrays for the table display
      const profitEntries = profitRows.map(r => ({ amount: Number(r.total), currency: r.currencyCode }));
      const serviceChargeEntries = scRows.map(r => ({ amount: Number(r.total), currency: r.currencyCode }));

      const calculatedProfit = computeCalculatedProfit(
        order,
        serviceChargeEntries,
        profitTargetCurrency,
        calcConvertToTarget,
      );

      // Resolve accountId from order_profits/order_service_charges as a fallback for unified-modal orders
      // (legacy orders.profitAccountId is null for those; the table entry is the source of truth)
      const firstProfitEntry = profitRows.length > 0
        ? db.prepare(`SELECT accountId FROM order_profits WHERE orderId = ? AND status IN ('confirmed','draft') ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, createdAt ASC LIMIT 1;`).get(order.id)
        : null;
      const firstScEntry = scRows.length > 0
        ? db.prepare(`SELECT accountId FROM order_service_charges WHERE orderId = ? AND status IN ('confirmed','draft') ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, createdAt ASC LIMIT 1;`).get(order.id)
        : null;

      // Scalar backward-compat fields: use first entry (or legacy order table fallback)
      const profitAmount = profitEntries.length > 0 ? profitEntries[0].amount : (order.profitAmount !== null && order.profitAmount !== undefined ? Number(order.profitAmount) : null);
      const profitCurrency = profitEntries.length > 0 ? profitEntries[0].currency : (order.profitCurrency ?? null);
      const profitAccountId = order.profitAccountId ?? firstProfitEntry?.accountId ?? null;

      const serviceChargeAmount = serviceChargeEntries.length > 0 ? serviceChargeEntries[0].amount : (order.serviceChargeAmount !== null && order.serviceChargeAmount !== undefined ? Number(order.serviceChargeAmount) : null);
      const serviceChargeCurrency = serviceChargeEntries.length > 0 ? serviceChargeEntries[0].currency : (order.serviceChargeCurrency ?? null);
      const serviceChargeAccountId = order.serviceChargeAccountId ?? firstScEntry?.accountId ?? null;

      return {
        ...order,
        pinned,
        pinOrder,
        walletAddresses: order.walletAddresses ? JSON.parse(order.walletAddresses) : null,
        bankDetails: order.bankDetails ? JSON.parse(order.bankDetails) : null,
        hasBeneficiaries,
        buyAccounts: buyAccounts.length > 0 ? buyAccounts : null,
        sellAccounts: sellAccounts.length > 0 ? sellAccounts : null,
        tags: tags.length > 0 ? tags : [],
        profitEntries,
        serviceChargeEntries,
        profitAmount,
        profitCurrency,
        profitAccountId,
        serviceChargeAmount,
        serviceChargeCurrency,
        serviceChargeAccountId,
        calculatedProfit,
        calculatedProfitCurrency: profitTargetCurrency,
      };
    } catch (e) {
      // Get tags for this order even in error case
      const tags = db
        .prepare(
          `SELECT t.id, t.name, t.color 
           FROM tags t
           INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
           WHERE ota.orderId = ?
           ORDER BY t.name ASC;`
        )
        .all(order.id);

      // Get confirmed profit/service charge sums per currency even in error case
      const confirmedProfitRows = db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_profits
           WHERE orderId = ? AND status = 'confirmed'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      const confirmedScRows = db
        .prepare(
          `SELECT SUM(amount) as total, currencyCode
           FROM order_service_charges
           WHERE orderId = ? AND status = 'confirmed'
           GROUP BY currencyCode
           ORDER BY MIN(createdAt) ASC;`
        )
        .all(order.id);

      const profitEntries = confirmedProfitRows.map(r => ({ amount: Number(r.total), currency: r.currencyCode }));
      const serviceChargeEntries = confirmedScRows.map(r => ({ amount: Number(r.total), currency: r.currencyCode }));

      const firstProfitEntry = confirmedProfitRows.length > 0
        ? db.prepare(`SELECT accountId FROM order_profits WHERE orderId = ? AND status = 'confirmed' ORDER BY createdAt ASC LIMIT 1;`).get(order.id)
        : null;
      const firstScEntry = confirmedScRows.length > 0
        ? db.prepare(`SELECT accountId FROM order_service_charges WHERE orderId = ? AND status = 'confirmed' ORDER BY createdAt ASC LIMIT 1;`).get(order.id)
        : null;

      const profitAmount = profitEntries.length > 0 ? profitEntries[0].amount : (order.profitAmount !== null && order.profitAmount !== undefined ? Number(order.profitAmount) : null);
      const profitCurrency = profitEntries.length > 0 ? profitEntries[0].currency : (order.profitCurrency ?? null);
      const profitAccountId = order.profitAccountId ?? firstProfitEntry?.accountId ?? null;

      const serviceChargeAmount = serviceChargeEntries.length > 0 ? serviceChargeEntries[0].amount : (order.serviceChargeAmount !== null && order.serviceChargeAmount !== undefined ? Number(order.serviceChargeAmount) : null);
      const serviceChargeCurrency = serviceChargeEntries.length > 0 ? serviceChargeEntries[0].currency : (order.serviceChargeCurrency ?? null);
      const serviceChargeAccountId = order.serviceChargeAccountId ?? firstScEntry?.accountId ?? null;

      const calculatedProfit = computeCalculatedProfit(
        order,
        serviceChargeEntries,
        profitTargetCurrency,
        calcConvertToTarget,
      );

      return {
        ...order,
        pinned,
        pinOrder,
        walletAddresses: null,
        bankDetails: null,
        hasBeneficiaries: false,
        buyAccounts: null,
        sellAccounts: null,
        tags: tags.length > 0 ? tags : [],
        profitEntries,
        serviceChargeEntries,
        profitAmount,
        profitCurrency,
        profitAccountId,
        serviceChargeAmount,
        serviceChargeCurrency,
        serviceChargeAccountId,
        calculatedProfit,
        calculatedProfitCurrency: profitTargetCurrency,
      };
    }
  });
  
  res.json({
    orders,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages,
    totalCalculatedProfit,
    totalCalculatedProfitCurrency: profitTargetCurrency,
  });
};

export const exportOrders = (req, res) => {
  // Extract query parameters (same as listOrders but without pagination)
  const {
    dateFrom,
    dateTo,
    handlerId,
    customerId,
    fromCurrency,
    toCurrency,
    currencyPairs,
    accountSearch,
    status,
    orderType,
    tagId,
    tagIds,
  } = req.query;

  // Build WHERE clause conditions (same logic as listOrders)
  const conditions = [];
  const params = {};
  const userId = getUserIdFromHeader(req);

  const allowedOrderAccountIds = getAllowedAccountIdsForUser(userId, "order.account");
  if (Array.isArray(allowedOrderAccountIds)) {
    if (allowedOrderAccountIds.length === 0) {
      conditions.push("1 = 0");
    } else {
      const placeholders = allowedOrderAccountIds.map((accountId, index) => {
        const key = `orderAccountAccess${index}`;
        params[key] = accountId;
        return `@${key}`;
      }).join(",");
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM order_receipts r
          WHERE r.orderId = o.id AND r.accountId IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM order_payments p
          WHERE p.orderId = o.id AND p.accountId IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM order_service_charges sc
          WHERE sc.orderId = o.id AND sc.accountId IN (${placeholders})
        )
        OR o.serviceChargeAccountId IN (${placeholders})
      )`);
    }
  }

  if (dateFrom) {
    conditions.push('DATE(COALESCE(o.orderDate, o.createdAt)) >= DATE(@dateFrom)');
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push('DATE(COALESCE(o.orderDate, o.createdAt)) <= DATE(@dateTo)');
    params.dateTo = dateTo;
  }
  if (handlerId) {
    conditions.push('o.handlerId = @handlerId');
    params.handlerId = parseInt(handlerId, 10);
  }
  if (customerId) {
    conditions.push('o.customerId = @customerId');
    params.customerId = parseInt(customerId, 10);
  }
  // Support multi-select currency pairs (comma-separated "FROM/TO" list)
  if (currencyPairs) {
    const pairList = String(currencyPairs).split(',').map((p) => p.trim()).filter(Boolean);
    if (pairList.length === 1) {
      const [from, to] = pairList[0].split('/');
      if (from) { conditions.push('o.fromCurrency = @cpFrom0'); params.cpFrom0 = from; }
      if (to) { conditions.push('o.toCurrency = @cpTo0'); params.cpTo0 = to; }
    } else if (pairList.length > 1) {
      const pairClauses = pairList.map((pair, i) => {
        const [from, to] = pair.split('/');
        const fromKey = `cpFrom${i}`;
        const toKey = `cpTo${i}`;
        params[fromKey] = from || '';
        params[toKey] = to || '';
        return `(o.fromCurrency = @${fromKey} AND o.toCurrency = @${toKey})`;
      });
      conditions.push(`(${pairClauses.join(' OR ')})`);
    }
  } else if (fromCurrency) {
    conditions.push('o.fromCurrency = @fromCurrency');
    params.fromCurrency = fromCurrency;
    if (toCurrency) {
      conditions.push('o.toCurrency = @toCurrency');
      params.toCurrency = toCurrency;
    }
  }
  if (accountSearch) {
    appendOrderAccountSearchFilter(conditions, params, accountSearch);
  }
  if (status) {
    conditions.push('o.status = @status');
    params.status = status;
  }
  if (orderType) {
    conditions.push('o.orderType = @orderType');
    params.orderType = orderType;
  }
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
      SELECT 1 FROM order_tag_assignments ota 
      WHERE ota.orderId = o.id AND ota.tagId IN (${placeholders})
    )`);
    parsedTagIds.forEach((id, i) => {
      params[`tagId${i}`] = id;
    });
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build query without pagination
  const query = `
    SELECT o.*, c.name as customerName, u.name as handlerName,
           COALESCE(cu.name, u.name) as createdByName,
           buyAcc.name as buyAccountName, sellAcc.name as sellAccountName,
           op.sortOrder AS pinSortOrder
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customerId
    LEFT JOIN users u ON u.id = o.handlerId
    LEFT JOIN users cu ON cu.id = o.createdBy
    LEFT JOIN accounts buyAcc ON buyAcc.id = o.buyAccountId
    LEFT JOIN accounts sellAcc ON sellAcc.id = o.sellAccountId
    LEFT JOIN order_pins op ON op.orderId = o.id
    ${whereClause}
    ORDER BY CASE WHEN op.sortOrder IS NOT NULL THEN 0 ELSE 1 END ASC,
             op.sortOrder ASC,
             COALESCE(o.orderDate, o.createdAt) DESC;
  `;

  const rows = db.prepare(query).all(params);
  
  // Parse JSON fields and check for beneficiaries (same logic as listOrders)
  const orders = rows.map((rawRow) => {
    const { pinSortOrder, ...order } = rawRow;
    const pinned = pinSortOrder != null;
    const pinOrder = pinned ? pinSortOrder : undefined;
    try {
      const beneficiaryCount = db
        .prepare("SELECT COUNT(*) as count FROM order_beneficiaries WHERE orderId = ?;")
        .get(order.id);
      const hasBeneficiaries = (beneficiaryCount?.count || 0) > 0;

      const buyAccounts = buildBuyAccountsForOrder(order.id);
      const sellAccounts = buildSellAccountsForOrder(order.id);

      // Get tags for this order
      const tags = db
        .prepare(
          `SELECT t.id, t.name, t.color 
           FROM tags t
           INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
           WHERE ota.orderId = ?
           ORDER BY t.name ASC;`
        )
        .all(order.id);

      return {
        ...order,
        pinned,
        pinOrder,
        walletAddresses: order.walletAddresses ? JSON.parse(order.walletAddresses) : null,
        bankDetails: order.bankDetails ? JSON.parse(order.bankDetails) : null,
        hasBeneficiaries,
        buyAccounts: buyAccounts.length > 0 ? buyAccounts : null,
        sellAccounts: sellAccounts.length > 0 ? sellAccounts : null,
        tags: tags.length > 0 ? tags : [],
      };
    } catch (e) {
      // Get tags for this order even in error case
      const tags = db
        .prepare(
          `SELECT t.id, t.name, t.color 
           FROM tags t
           INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
           WHERE ota.orderId = ?
           ORDER BY t.name ASC;`
        )
        .all(order.id);

      return {
        ...order,
        pinned,
        pinOrder,
        walletAddresses: null,
        bankDetails: null,
        hasBeneficiaries: false,
        buyAccounts: null,
        sellAccounts: null,
        tags: tags.length > 0 ? tags : [],
      };
    }
  });
  
  res.json(orders);
};

export const getPinnedOrderIds = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  res.json({ orderIds: listGlobalPinnedOrderIds() });
};

export const pinOrder = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinOrders(userPermissions)) {
    return res.status(403).json({ message: "You do not have permission to pin orders" });
  }
  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ message: "Invalid order id" });
  }
  if (!userCanAccessOrderForListing(userId, orderId)) {
    return res.status(403).json({ message: "You do not have access to this order" });
  }
  const already = db.prepare("SELECT 1 FROM order_pins WHERE orderId = ?;").get(orderId);
  if (already) {
    return res.json({ success: true, orderIds: listGlobalPinnedOrderIds() });
  }
  const countRow = db.prepare("SELECT COUNT(*) as n FROM order_pins;").get();
  if ((countRow?.n || 0) >= MAX_ORDER_PINS_GLOBAL) {
    return res.status(400).json({
      message: `At most ${MAX_ORDER_PINS_GLOBAL} orders can be pinned for everyone. Unpin one to add another.`,
    });
  }
  const maxSort = db.prepare("SELECT COALESCE(MAX(sortOrder), -1) AS m FROM order_pins;").get();
  db.prepare("INSERT INTO order_pins (orderId, sortOrder) VALUES (?, ?);").run(
    orderId,
    (maxSort?.m ?? -1) + 1,
  );
  res.json({ success: true, orderIds: listGlobalPinnedOrderIds() });
  notifyOrderPins(orderId);
};

export const unpinOrder = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinOrders(userPermissions)) {
    return res.status(403).json({ message: "You do not have permission to unpin orders" });
  }
  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ message: "Invalid order id" });
  }
  db.prepare("DELETE FROM order_pins WHERE orderId = ?;").run(orderId);
  const remaining = listGlobalPinnedOrderIds();
  const normalize = db.transaction((ids) => {
    ids.forEach((oid, i) => {
      db.prepare("UPDATE order_pins SET sortOrder = ? WHERE orderId = ?;").run(i, oid);
    });
  });
  normalize(remaining);
  res.json({ success: true, orderIds: remaining });
  notifyOrderPins(orderId);
};

export const reorderPinnedOrders = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinOrders(userPermissions)) {
    return res.status(403).json({ message: "You do not have permission to reorder pinned orders" });
  }
  const { orderIds } = req.body || {};
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ message: "orderIds must be a non-empty array" });
  }
  if (!orderIds.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ message: "orderIds must be positive integers" });
  }
  const current = listGlobalPinnedOrderIds();
  if (current.length !== orderIds.length) {
    return res.status(400).json({ message: "Pin list length does not match the current pinned orders" });
  }
  const setCurrent = new Set(current);
  if (orderIds.some((id) => !setCurrent.has(id))) {
    return res.status(400).json({ message: "orderIds must match the current pinned orders exactly" });
  }
  const apply = db.transaction((ids) => {
    ids.forEach((oid, i) => {
      db.prepare("UPDATE order_pins SET sortOrder = ? WHERE orderId = ?;").run(i, oid);
    });
  });
  apply(orderIds);
  res.json({ success: true, orderIds: listGlobalPinnedOrderIds() });
  notifyOrderPinsGlobal();
};

export const createOrder = async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { tagIds, ...orderData } = payload;
    const userId = getUserIdFromHeader(req);
    
    if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }

    let resolvedCustomerId = orderData.customerId != null ? Number(orderData.customerId) : null;
    const rawName = orderData.customerName != null ? String(orderData.customerName).trim() : "";
    if ((!resolvedCustomerId || Number.isNaN(resolvedCustomerId)) && rawName) {
      const existingCustomer = db
        .prepare("SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1")
        .get(rawName);
      if (existingCustomer) {
        resolvedCustomerId = existingCustomer.id;
      } else {
        const ins = db.prepare("INSERT INTO customers (name) VALUES (?)").run(rawName);
        resolvedCustomerId = ins.lastInsertRowid;
      }
    }
    if (!resolvedCustomerId || Number.isNaN(resolvedCustomerId)) {
      return res.status(400).json({ message: "Customer name or customer ID is required" });
    }
    orderData.customerId = resolvedCustomerId;

    const orderMode = normalizeOrderMode(orderData.orderMode);
    orderData.orderMode = orderMode;
    if (orderMode === ORDER_MODE_LEDGER_SWAP) {
      orderData.buyAccountId = null;
      orderData.sellAccountId = null;
    }

    if (orderData.handlerId !== undefined && orderData.handlerId !== null && orderData.handlerId !== "") {
      const handler = db.prepare("SELECT id, name FROM users WHERE id = ?").get(orderData.handlerId);
      if (!handler) {
        return res.status(400).json({ message: "Handler not found" });
      }
    }

    // Validate buy/sell accounts only if provided (allow creating pending orders without accounts)
    let buyAccount = null;
    let sellAccount = null;
    if (orderData.buyAccountId !== undefined && orderData.buyAccountId !== null) {
      buyAccount = db.prepare("SELECT id, name, currencyCode FROM accounts WHERE id = ?").get(orderData.buyAccountId);
      if (!buyAccount) {
        return res.status(400).json({ message: "Buy account not found" });
      }
      if ((buyAccount.currencyCode || "").toUpperCase() !== (orderData.fromCurrency || "").toUpperCase()) {
        return res.status(400).json({ message: "Buy account currency does not match fromCurrency" });
      }
      if (!requireAccountAccess(req, res, "order.account", orderData.buyAccountId, "You do not have access to use this order account")) {
        return;
      }
    }
    if (orderData.sellAccountId !== undefined && orderData.sellAccountId !== null) {
      sellAccount = db.prepare("SELECT id, name, currencyCode FROM accounts WHERE id = ?").get(orderData.sellAccountId);
      if (!sellAccount) {
        return res.status(400).json({ message: "Sell account not found" });
      }
      if ((sellAccount.currencyCode || "").toUpperCase() !== (orderData.toCurrency || "").toUpperCase()) {
        return res.status(400).json({ message: "Sell account currency does not match toCurrency" });
      }
      if (!requireAccountAccess(req, res, "order.account", orderData.sellAccountId, "You do not have access to use this order account")) {
        return;
      }
    }
    // Validate profit account/currency if provided
    if (orderData.profitAmount !== undefined && orderData.profitAmount !== null) {
      if (!orderData.profitAccountId || !orderData.profitCurrency) {
        return res.status(400).json({ message: "Profit amount requires profit account and profit currency" });
      }
      const profitAccount = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?").get(orderData.profitAccountId);
      if (!profitAccount) {
        return res.status(400).json({ message: "Profit account not found" });
      }
      if ((profitAccount.currencyCode || "").toUpperCase() !== String(orderData.profitCurrency || "").toUpperCase()) {
        return res.status(400).json({ message: "Profit account currency does not match profit currency" });
      }
      if (!requireAccountAccess(req, res, "profit.account", orderData.profitAccountId, "You do not have access to use this profit account")) {
        return;
      }
    }

    // Validate service charge if provided
    let createOrderServiceChargeFunding = null;
    if (orderData.serviceChargeAmount !== undefined && orderData.serviceChargeAmount !== null) {
      if (!orderData.serviceChargeCurrency) {
        return res.status(400).json({ message: "Service charge amount requires service charge currency" });
      }
      createOrderServiceChargeFunding = resolveServiceChargeFunding({
        fundedFrom: orderData.serviceChargeFundedFrom,
        amount: orderData.serviceChargeAmount,
        accountId: orderData.serviceChargeAccountId,
        customerId: orderData.customerId,
      });
      if (createOrderServiceChargeFunding.error) {
        return res
          .status(createOrderServiceChargeFunding.status || 400)
          .json({ message: createOrderServiceChargeFunding.error });
      }
      if (createOrderServiceChargeFunding.accountId) {
        const scAccount = db
          .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?")
          .get(createOrderServiceChargeFunding.accountId);
        if (!scAccount) {
          return res.status(400).json({ message: "Service charge account not found" });
        }
        if (
          (scAccount.currencyCode || "").toUpperCase() !==
          String(orderData.serviceChargeCurrency || "").toUpperCase()
        ) {
          return res.status(400).json({
            message: "Service charge account currency does not match service charge currency",
          });
        }
        if (
          !requireAccountAccess(
            req,
            res,
            "serviceCharge.account",
            createOrderServiceChargeFunding.accountId,
            "You do not have access to use this service charge account",
          )
        ) {
          return;
        }
      }
    }

    if (sellAccount && (sellAccount.currencyCode || "").toUpperCase() !== (orderData.toCurrency || "").toUpperCase()) {
      return res.status(400).json({ message: "Sell account currency does not match toCurrency" });
    }
    
    const stmt = db.prepare(
      `INSERT INTO orders (
         customerId,
         fromCurrency,
         toCurrency,
         amountBuy,
         amountSell,
         rate,
         status,
         handlerId,
         buyAccountId,
         sellAccountId,
         orderType,
         profitAmount,
         profitCurrency,
         profitAccountId,
         serviceChargeAmount,
         serviceChargeCurrency,
         serviceChargeAccountId,
         createdBy,
         createdAt,
         orderDate,
         orderMode
       ) VALUES (
         @customerId,
         @fromCurrency,
         @toCurrency,
         @amountBuy,
         @amountSell,
         @rate,
         @status,
         @handlerId,
         @buyAccountId,
         @sellAccountId,
         @orderType,
         @profitAmount,
         @profitCurrency,
         @profitAccountId,
         @serviceChargeAmount,
         @serviceChargeCurrency,
         @serviceChargeAccountId,
         @createdBy,
         @createdAt,
         @orderDate,
         @orderMode
       );`,
    );
    const rowForInsert = { ...orderData };
    delete rowForInsert.customerName;
    delete rowForInsert.remarks;
    const nowIso = new Date().toISOString();
    const result = stmt.run({
      ...rowForInsert,
      status: orderData.status || "saved",
      handlerId: orderData.handlerId ?? null,
      buyAccountId: orderData.buyAccountId ?? null,
      sellAccountId: orderData.sellAccountId ?? null,
      orderType:
        orderData.orderType === undefined || orderData.orderType === null || orderData.orderType === ""
          ? null
          : orderData.orderType,
      profitAmount: orderData.profitAmount ?? null,
      profitCurrency: orderData.profitCurrency ?? null,
      profitAccountId: orderData.profitAccountId ?? null,
      serviceChargeAmount: orderData.serviceChargeAmount ?? null,
      serviceChargeCurrency: orderData.serviceChargeCurrency ?? null,
      serviceChargeAccountId: orderData.serviceChargeAccountId ?? null,
      createdBy: userId,
      createdAt: nowIso,
      orderDate: orderData.orderDate ? new Date(orderData.orderDate).toISOString() : nowIso,
      orderMode,
    });
    
    const orderId = result.lastInsertRowid;
    
    // Create profit/service charge entries in separate tables when saving a non-completed order
    // (legacy OTC-only path; unified clients omit orderType and still get drafts here)
    if ((orderData.status || "saved") !== "completed") {
      // Check if this is an imported order (status is "completed" from the start)
      const isImported = (orderData.status || "saved") === "completed";
      const importedSuffix = isImported ? " (Imported)" : "";
      const profitServiceChargeStatus = isImported ? "confirmed" : "draft";
      
      // Create profit entry if provided (draft for pending, confirmed for completed)
      if (orderData.profitAmount !== null && orderData.profitAmount !== undefined && 
          orderData.profitCurrency && orderData.profitAccountId) {
        const profitAmount = Number(orderData.profitAmount);
        if (!isNaN(profitAmount) && profitAmount > 0) {
          db.prepare(
            `INSERT INTO order_profits (orderId, amount, currencyCode, accountId, status, createdAt)
             VALUES (?, ?, ?, ?, ?, ?);`
          ).run(orderId, profitAmount, orderData.profitCurrency, orderData.profitAccountId, profitServiceChargeStatus, new Date().toISOString());
          
          // Only update account balance and create transaction if confirmed (completed order)
          if (isImported) {
            const profitAccount = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(orderData.profitAccountId);
            if (profitAccount) {
              const newBalance = profitAccount.balance + profitAmount;
              db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, orderData.profitAccountId);
              db.prepare(
                `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
                 VALUES (?, 'add', ?, ?, ?);`
              ).run(
                orderData.profitAccountId,
                profitAmount,
                `Order #${orderId} - Profit${importedSuffix}`,
                new Date().toISOString()
              );
            }
          }
        }
      }
      
      // Create service charge entry if provided (draft for pending, confirmed for completed)
      if (
        createOrderServiceChargeFunding &&
        orderData.serviceChargeCurrency
      ) {
        const serviceChargeAmount = createOrderServiceChargeFunding.amount;
        db.prepare(
          `INSERT INTO order_service_charges (orderId, amount, currencyCode, accountId, status, fundedFrom, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
        ).run(
          orderId,
          serviceChargeAmount,
          orderData.serviceChargeCurrency,
          createOrderServiceChargeFunding.accountId,
          profitServiceChargeStatus,
          createOrderServiceChargeFunding.fundedFrom,
          new Date().toISOString(),
        );

        if (isImported && profitServiceChargeStatus === "confirmed") {
          applyCashServiceChargeAccountEffects(
            {
              accountId: createOrderServiceChargeFunding.accountId,
              amount: serviceChargeAmount,
              fundedFrom: createOrderServiceChargeFunding.fundedFrom,
            },
            orderId,
          );
        }
      }
    }
    
    // Handle tag assignments if provided
    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const tagAssignmentStmt = db.prepare(
        `INSERT INTO order_tag_assignments (orderId, tagId) VALUES (?, ?);`
      );
      const insertTagAssignments = db.transaction((tags) => {
        for (const tagId of tags) {
          if (typeof tagId === 'number' && tagId > 0) {
            try {
              tagAssignmentStmt.run(orderId, tagId);
            } catch (err) {
              // Ignore duplicate or invalid tag assignments
            }
          }
        }
      });
      insertTagAssignments(tagIds);
    }
    
    const row = db
      .prepare(
        `SELECT o.*, 
                c.name as customerName, 
                u.name as handlerName,
                buyAcc.name as buyAccountName,
                sellAcc.name as sellAccountName
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customerId
         LEFT JOIN users u ON u.id = o.handlerId
         LEFT JOIN accounts buyAcc ON buyAcc.id = o.buyAccountId
         LEFT JOIN accounts sellAcc ON sellAcc.id = o.sellAccountId
         WHERE o.id = ?;`,
      )
      .get(orderId);
    
    // Get tags for the order
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
         WHERE ota.orderId = ?
         ORDER BY t.name ASC;`
      )
      .all(orderId);
    
    // If order is created with status "completed" and has accounts, update account balances
    // This handles imported orders that are already completed
    // Query the actual order from database to get the real status and account IDs
    const actualOrder = db.prepare("SELECT status, buyAccountId, sellAccountId FROM orders WHERE id = ?;").get(orderId);
    const finalStatus = actualOrder?.status || orderData.status || "saved";
    const actualBuyAccountId = actualOrder?.buyAccountId || orderData.buyAccountId;
    const actualSellAccountId = actualOrder?.sellAccountId || orderData.sellAccountId;
    
    console.log(`[createOrder] Order ${orderId} created - Status: ${finalStatus}, buyAccountId: ${actualBuyAccountId}, sellAccountId: ${actualSellAccountId}`);
    
    if (finalStatus === "completed") {
      // Update account balances for buy/sell accounts
      if (actualBuyAccountId || actualSellAccountId) {
        try {
          console.log(`[createOrder] Calling updateAccountBalancesOnCompletion for order ${orderId} (imported)`);
          updateAccountBalancesOnCompletion(orderId, true);
          console.log(`[createOrder] Successfully updated account balances for order ${orderId}`);
        } catch (error) {
          console.error(`[createOrder] Error updating account balances for order ${orderId}:`, error);
          // Don't fail the order creation, but log the error
        }
      } else {
        console.log(`[createOrder] Order ${orderId} is completed but has no accounts set, skipping balance update`);
      }

      trySyncCompletedOrderLedger(orderId, userId);

      // Handle profit account balance if provided
      // Skip for OTC orders since they're already handled in the OTC block above
      if (orderData.orderType !== "otc" && orderData.profitAmount !== null && orderData.profitAmount !== undefined && orderData.profitAccountId) {
        const profitAmount = Number(orderData.profitAmount);
        if (!isNaN(profitAmount) && profitAmount > 0) {
          db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(profitAmount, orderData.profitAccountId);
          db.prepare(
            `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
             VALUES (?, 'add', ?, ?, ?);`
          ).run(
            orderData.profitAccountId,
            profitAmount,
            `Order #${orderId} - Profit (Imported)`,
            new Date().toISOString()
          );
        }
      }
      
      // Handle service charge account balance if provided
      // Skip for OTC orders since they're already handled in the OTC block above
      if (orderData.orderType !== "otc" && orderData.serviceChargeAmount !== null && orderData.serviceChargeAmount !== undefined && orderData.serviceChargeAccountId) {
        const serviceChargeAmount = Number(orderData.serviceChargeAmount);
        if (!isNaN(serviceChargeAmount) && serviceChargeAmount !== 0) {
          if (serviceChargeAmount > 0) {
            // Positive service charge: add to account (we receive it)
            db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(serviceChargeAmount, orderData.serviceChargeAccountId);
            db.prepare(
              `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
               VALUES (?, 'add', ?, ?, ?);`
            ).run(
              orderData.serviceChargeAccountId,
              serviceChargeAmount,
              `Order #${orderId} - Service charge (Imported)`,
              new Date().toISOString()
            );
          } else {
            // Negative service charge: subtract from account (we pay it)
            const absAmount = Math.abs(serviceChargeAmount);
            db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(absAmount, orderData.serviceChargeAccountId);
            db.prepare(
              `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
               VALUES (?, 'withdraw', ?, ?, ?);`
            ).run(
              orderData.serviceChargeAccountId,
              absAmount,
              `Order #${orderId} - Service charge paid by us (Imported)`,
              new Date().toISOString()
            );
          }
        }
      }
    }

    res.status(201).json({
      ...row,
      tags: tags.length > 0 ? tags : [],
    });

    notifyOrderFinancial(orderId);

    // Send notifications in background after response is sent
    const allUsers = db.prepare("SELECT id FROM users").all();
    const allUserIds = allUsers.map(u => u.id);
    const creatorName = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);

    createNotification({
      userId: allUserIds,
      type: 'order_created',
      title: 'New Order Created',
      message: `Order #${orderId} created by ${creatorName?.name || 'User'} - ${row.customerName || 'Customer'}`,
      entityType: 'order',
      entityId: orderId,
      actionUrl: `/orders`,
    }).catch(err => console.error('[createOrder] notification failed:', err));

    // Notify the assigned handler (if different from creator)
    const assignedHandlerId = orderData.handlerId ?? null;
    if (assignedHandlerId && Number(assignedHandlerId) !== Number(userId)) {
      const assigneeName = db
        .prepare("SELECT name FROM users WHERE id = ?")
        .get(Number(assignedHandlerId))?.name;
      createNotification({
        userId: Number(assignedHandlerId),
        type: 'order_assigned',
        title: 'Order Assigned to You',
        message: `Order #${orderId} has been assigned to you by ${creatorName?.name || 'User'} - ${row.customerName || 'Customer'}`,
        entityType: 'order',
        entityId: orderId,
        actionUrl: `/orders`,
        metadata: { assigneeName: assigneeName || 'Unknown User' },
      }).catch(err => console.error('[createOrder] handler notification failed:', err));
    }
  } catch (error) {
    next(error);
  }
};

export const updateOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const { tagIds, ...orderUpdates } = updates;
    const userId = getUserIdFromHeader(req);
    
    // Check if order exists and get existing profit/service charge data
    const existingOrder = db
      .prepare(
        "SELECT id, createdBy, handlerId, status, customerId, fromCurrency, toCurrency, profitAmount, profitAccountId, profitCurrency, serviceChargeAmount, serviceChargeAccountId, serviceChargeCurrency, buyAccountId, sellAccountId FROM orders WHERE id = ?",
      )
      .get(id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const beforeAuditRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);

    if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }
    if (!canModifyOrder(existingOrder, userId)) {
      return res.status(403).json({
        message: "You are not allowed to edit this order",
      });
    }

    // Completed and cancelled orders require the editAnyOrder permission
    const userPermissions = getUserPermissions(userId);
    const userCanEditAnyOrder = canEditAnyOrder(userPermissions);
    if (existingOrder.status === "completed" || existingOrder.status === "cancelled") {
      if (!userCanEditAnyOrder) {
        return res.status(403).json({
          message: "You do not have permission to edit completed or cancelled orders",
        });
      }
    }

    // Fields that can only be updated when order is pending (saved)
    // Users with editAnyOrder permission can update these fields regardless of status
    const pendingOnlyFields = ["customerId", "fromCurrency", "toCurrency", "amountBuy", "amountSell", "rate", "orderMode"];
    // Fields that can be updated at any time (service charges and profit)
    const alwaysUpdatableFields = [
      "serviceChargeAmount",
      "serviceChargeCurrency",
      "serviceChargeAccountId",
      "serviceChargeFundedFrom",
      "profitAmount",
      "profitCurrency",
      "profitAccountId",
      "handlerId",
      "buyAccountId",
      "sellAccountId",
      "remarks",
      "orderDate",
    ];
    
    // Separate updates into pending-only and always-updatable
    const pendingOnlyUpdates = {};
    const alwaysUpdatableUpdates = {};
    
    Object.keys(orderUpdates).forEach(key => {
      if (pendingOnlyFields.includes(key)) {
        pendingOnlyUpdates[key] = orderUpdates[key];
      } else if (alwaysUpdatableFields.includes(key)) {
        alwaysUpdatableUpdates[key] = orderUpdates[key];
      }
    });

    // Core fields are restricted to saved orders unless the user has editAnyOrder permission
    if (Object.keys(pendingOnlyUpdates).length > 0 && existingOrder.status !== "saved" && !userCanEditAnyOrder) {
      return res.status(400).json({ message: "Core fields can only be edited when order status is Saved" });
    }

    // When editAnyOrder is granted, core fields are treated as always-updatable
    if (userCanEditAnyOrder && existingOrder.status !== "saved") {
      Object.assign(alwaysUpdatableUpdates, pendingOnlyUpdates);
    }

    // Use effective currencies (new values if being changed, otherwise existing)
    const effectiveFromCurrency = pendingOnlyUpdates.fromCurrency ?? existingOrder.fromCurrency;
    const effectiveToCurrency = pendingOnlyUpdates.toCurrency ?? existingOrder.toCurrency;

    // Validate service charge and profit currency fields
    if (alwaysUpdatableUpdates.serviceChargeCurrency !== undefined) {
      const currency = alwaysUpdatableUpdates.serviceChargeCurrency;
      if (currency !== null && currency !== "" && currency !== effectiveFromCurrency && currency !== effectiveToCurrency) {
        return res.status(400).json({ message: "Service charge currency must be either fromCurrency or toCurrency" });
      }
    }
    if (alwaysUpdatableUpdates.profitCurrency !== undefined) {
      const currency = alwaysUpdatableUpdates.profitCurrency;
      if (currency !== null && currency !== "" && currency !== effectiveFromCurrency && currency !== effectiveToCurrency) {
        return res.status(400).json({ message: "Profit currency must be either fromCurrency or toCurrency" });
      }
    }

    // Validate buy/sell account currencies when updating
    if (alwaysUpdatableUpdates.buyAccountId !== undefined && alwaysUpdatableUpdates.buyAccountId !== null) {
      const buyAcc = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;").get(alwaysUpdatableUpdates.buyAccountId);
      if (!buyAcc) {
        return res.status(400).json({ message: "Buy account not found" });
      }
      if ((buyAcc.currencyCode || "").toUpperCase() !== (effectiveFromCurrency || "").toUpperCase()) {
        return res.status(400).json({ message: "Buy account currency does not match fromCurrency" });
      }
      if (!requireAccountAccess(req, res, "order.account", alwaysUpdatableUpdates.buyAccountId, "You do not have access to use this order account")) {
        return;
      }
    }
    if (alwaysUpdatableUpdates.sellAccountId !== undefined && alwaysUpdatableUpdates.sellAccountId !== null) {
      const sellAcc = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;").get(alwaysUpdatableUpdates.sellAccountId);
      if (!sellAcc) {
        return res.status(400).json({ message: "Sell account not found" });
      }
      if ((sellAcc.currencyCode || "").toUpperCase() !== (effectiveToCurrency || "").toUpperCase()) {
        return res.status(400).json({ message: "Sell account currency does not match toCurrency" });
      }
      if (!requireAccountAccess(req, res, "order.account", alwaysUpdatableUpdates.sellAccountId, "You do not have access to use this order account")) {
        return;
      }
    }

    if (alwaysUpdatableUpdates.profitAccountId !== undefined && alwaysUpdatableUpdates.profitAccountId !== null) {
      if (!requireAccountAccess(req, res, "profit.account", alwaysUpdatableUpdates.profitAccountId, "You do not have access to use this profit account")) {
        return;
      }
    }
    if (alwaysUpdatableUpdates.serviceChargeAccountId !== undefined && alwaysUpdatableUpdates.serviceChargeAccountId !== null) {
      if (!requireAccountAccess(req, res, "serviceCharge.account", alwaysUpdatableUpdates.serviceChargeAccountId, "You do not have access to use this service charge account")) {
        return;
      }
    }

    // Handle profit and service charge - create drafts instead of directly updating
    // Remove profit/service charge fields from alwaysUpdatableUpdates as they're handled separately
    const {
      profitAmount,
      profitCurrency,
      profitAccountId,
      serviceChargeAmount,
      serviceChargeCurrency,
      serviceChargeAccountId,
      serviceChargeFundedFrom,
      ...otherUpdates
    } = alwaysUpdatableUpdates;
    
    let profitDraftCreated = false;
    let serviceChargeDraftCreated = false;
    let profitDraftDeleted = false;
    let serviceChargeDraftDeleted = false;
    let createdProfitId = null;
    let createdServiceChargeId = null;
    
    const allowProfitScDrafts =
      existingOrder.status !== "completed" && existingOrder.status !== "cancelled" || userCanEditAnyOrder;

    // If profit fields are provided, handle profit draft (saved / in-progress orders only)
    if (
      allowProfitScDrafts &&
      (profitAmount !== undefined || profitAccountId !== undefined || profitCurrency !== undefined)
    ) {
      // Delete any existing draft profit for this order
      const deleteResult = db.prepare("DELETE FROM order_profits WHERE orderId = ? AND status = 'draft';").run(id);
      profitDraftDeleted = deleteResult.changes > 0;

      // Create new draft profit if all required fields are provided and amount is valid
      if (profitAmount !== null && profitAmount !== undefined && profitCurrency && profitAccountId) {
        const amount = Number(profitAmount);
        if (!isNaN(amount) && amount > 0) {
          const profitResult = db.prepare(
            `INSERT INTO order_profits (orderId, amount, currencyCode, accountId, status, createdAt)
             VALUES (?, ?, ?, ?, 'draft', ?);`,
          ).run(id, amount, profitCurrency, profitAccountId, new Date().toISOString());
          profitDraftCreated = true;
          createdProfitId = profitResult.lastInsertRowid;
        }
      }
    }

    // If service charge fields are provided, handle service charge draft
    if (
      allowProfitScDrafts &&
      (serviceChargeAmount !== undefined ||
        serviceChargeAccountId !== undefined ||
        serviceChargeCurrency !== undefined)
    ) {
      // Delete any existing draft service charge for this order
      const deleteResult = db.prepare("DELETE FROM order_service_charges WHERE orderId = ? AND status = 'draft';").run(id);
      serviceChargeDraftDeleted = deleteResult.changes > 0;

      if (
        serviceChargeAmount !== null &&
        serviceChargeAmount !== undefined &&
        serviceChargeCurrency
      ) {
        const funding = resolveServiceChargeFunding({
          fundedFrom: serviceChargeFundedFrom,
          amount: serviceChargeAmount,
          accountId: serviceChargeAccountId,
          customerId: existingOrder.customerId,
        });
        if (!funding.error) {
          const serviceChargeResult = db.prepare(
            `INSERT INTO order_service_charges (orderId, amount, currencyCode, accountId, status, fundedFrom, createdAt)
             VALUES (?, ?, ?, ?, 'draft', ?, ?);`,
          ).run(
            id,
            funding.amount,
            serviceChargeCurrency,
            funding.accountId,
            funding.fundedFrom,
            new Date().toISOString(),
          );
          serviceChargeDraftCreated = true;
          createdServiceChargeId = serviceChargeResult.lastInsertRowid;
        }
      }
    }
    
    // Use otherUpdates instead of alwaysUpdatableUpdates
    const alwaysUpdatableUpdatesFiltered = otherUpdates;

    // Combine all updates
    const allUpdates = { ...pendingOnlyUpdates, ...alwaysUpdatableUpdatesFiltered };
    const fieldsToUpdate = Object.keys(allUpdates);
    
    // Allow updating tags even if no other fields are being updated
    // Also allow if profit or service charge drafts were created or deleted
    if (fieldsToUpdate.length === 0 && tagIds === undefined && !profitDraftCreated && !serviceChargeDraftCreated && !profitDraftDeleted && !serviceChargeDraftDeleted) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    // Handle null values properly (to clear fields)
    const updateValues = {};
    fieldsToUpdate.forEach(field => {
      const value = allUpdates[field];
      if (field === "remarks") {
        // For remarks: null/undefined removes it, empty string also removes it, otherwise save the value
        if (value === null || value === undefined || value === "" || (typeof value === "string" && value.trim() === "")) {
          updateValues[field] = null;
        } else {
          updateValues[field] = String(value);
        }
      } else if (field === "orderDate") {
        // For orderDate: convert to ISO string if provided
        updateValues[field] = value ? new Date(value).toISOString() : null;
      } else if (value === null || value === "" || (typeof value === "string" && value.trim() === "")) {
        updateValues[field] = null;
      } else if (field === "profitAccountId" || field === "serviceChargeAccountId") {
        // Handle account IDs - convert empty string to null
        updateValues[field] = value === "" ? null : (value ? Number(value) : null);
      } else {
        updateValues[field] = value;
      }
    });
    updateValues.id = Number(id);

    const assignments = fieldsToUpdate.map((field) => `${field} = @${field}`).join(", ");
    if (assignments) {
      db.prepare(`UPDATE orders SET ${assignments} WHERE id = @id;`).run(updateValues);
    }

    // Handle tag assignments if provided (tags can be updated even if no other fields are updated)
    if (tagIds !== undefined) {
      // Remove all existing tag assignments
      db.prepare("DELETE FROM order_tag_assignments WHERE orderId = ?;").run(id);
      
      // Add new tag assignments if provided
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        const tagAssignmentStmt = db.prepare(
          `INSERT INTO order_tag_assignments (orderId, tagId) VALUES (?, ?);`
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

    const row = db
      .prepare(
        `SELECT o.*, c.name as customerName FROM orders o
         LEFT JOIN customers c ON c.id = o.customerId
         WHERE o.id = ?;`,
      )
      .get(id);
    
    // Include created profit/service charge IDs in response (for OTC orders to confirm immediately)
    const responseData = { ...row };
    if (createdProfitId) {
      responseData.createdProfitId = createdProfitId;
    }
    if (createdServiceChargeId) {
      responseData.createdServiceChargeId = createdServiceChargeId;
    }
    
    // Get tags for the order
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
         WHERE ota.orderId = ?
         ORDER BY t.name ASC;`
      )
      .all(id);

    const afterAuditRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (beforeAuditRow && afterAuditRow) {
      insertOrderChange(Number(id), userId, beforeAuditRow, afterAuditRow);
    }

    trySyncCompletedOrderLedger(Number(id), userId);

    res.json({
      ...responseData,
      tags: tags.length > 0 ? tags : [],
    });
    notifyOrderWrite(Number(id));
  } catch (error) {
    next(error);
  }
};

export const getOrderChanges = (req, res, next) => {
  try {
    const { id } = req.params;
    const rows = db
      .prepare(
        `SELECT oc.id, oc.orderId, oc.changedBy, oc.changedAt, oc.beforeJson, oc.afterJson,
                u.name as changedByName
         FROM order_changes oc
         LEFT JOIN users u ON u.id = oc.changedBy
         WHERE oc.orderId = ?
         ORDER BY oc.changedAt DESC, oc.id DESC;`,
      )
      .all(id);
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const userId = getUserIdFromHeader(req);
    
    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }

    const allowedStatuses = ["saved", "completed", "cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` });
    }
    
    // Get the current status before updating (include amounts/accounts for cancel reversals)
    const currentOrder = db
      .prepare(
        `SELECT id, createdBy, handlerId, status, buyAccountId, sellAccountId, orderType,
                amountBuy, amountSell, profitAmount, profitAccountId, serviceChargeAmount, serviceChargeAccountId
         FROM orders WHERE id = ?;`,
      )
      .get(id);
    if (!currentOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check permissions for status changes
    if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }

    if (status === "cancelled" && currentOrder.status !== "cancelled") {
      const userPermissions = getUserPermissions(userId);
      const userRow = db.prepare("SELECT role FROM users WHERE id = ?;").get(userId);
      if (userRow?.role !== "admin" && !userPermissions?.actions?.cancelOrder) {
        return res.status(403).json({ message: "You do not have permission to cancel orders" });
      }
    }

    let cancelAffectedAccountIds = null;
    if (status === "cancelled" && currentOrder.status !== "cancelled") {
      db.transaction(() => {
        const { affectedAccountIds } = performOrderFinancialReversals(Number(id), currentOrder, "Order cancelled");
        cancelAffectedAccountIds = Array.from(affectedAccountIds);
        db.prepare(`UPDATE orders SET status = @status WHERE id = @id;`).run({ id, status });
      })();
      try {
        syncCustomerLedgerOnOrderCancelOrDelete(Number(id), "cancelled", userId);
      } catch (ledgerErr) {
        console.error("[updateOrderStatus] customer ledger cancel sync failed:", ledgerErr);
      }
    } else {
      db.prepare(`UPDATE orders SET status = @status WHERE id = @id;`).run({ id, status });
    }
    
    // If status is being changed to "completed" and accounts are set, update account balances
    if (status === "completed" && currentOrder.status !== "completed" && (currentOrder.buyAccountId || currentOrder.sellAccountId)) {
      // Avoid double-counting when receipts/payments were already confirmed
      const hasConfirmedReceipt = db
        .prepare("SELECT id FROM order_receipts WHERE orderId = ? AND status = 'confirmed' LIMIT 1;")
        .get(id);
      const hasConfirmedPayment = db
        .prepare("SELECT id FROM order_payments WHERE orderId = ? AND status = 'confirmed' LIMIT 1;")
        .get(id);
      const isOtcOrder =
        currentOrder.orderType === "otc" ||
        currentOrder.orderType === null ||
        currentOrder.orderType === undefined ||
        currentOrder.orderType === "";

      // Only run the direct balance update when there are no confirmed receipt/payment entries
      // (typical for imported orders without detailed entries) and it's not an OTC order
      if (!hasConfirmedReceipt && !hasConfirmedPayment && !isOtcOrder) {
        updateAccountBalancesOnCompletion(id, false);
      }
    }
    
    // When order is completed, confirm all draft profit and service charge entries
    if (status === "completed" && currentOrder.status !== "completed") {
      // Confirm all draft profit entries
      const draftProfits = db.prepare("SELECT * FROM order_profits WHERE orderId = ? AND status = 'draft';").all(id);
      for (const profit of draftProfits) {
        if (profit.accountId) {
          // Update profit status to confirmed
          db.prepare("UPDATE order_profits SET status = 'confirmed' WHERE id = ?;").run(profit.id);
          
          // Update account balance
          const accountForBalance = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(profit.accountId);
          if (accountForBalance) {
            const newBalance = accountForBalance.balance + profit.amount;
            db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, profit.accountId);
            
            // Create account transaction
            db.prepare(
              `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
               VALUES (?, 'add', ?, ?, ?);`
            ).run(
              profit.accountId,
              profit.amount,
              `Order #${id} - Profit`,
              new Date().toISOString()
            );
          }
        }
      }
      
      // Confirm all draft service charge entries
      const draftServiceCharges = db.prepare("SELECT * FROM order_service_charges WHERE orderId = ? AND status = 'draft';").all(id);
      for (const serviceCharge of draftServiceCharges) {
        const balanceErr = assertServiceChargeBalanceOnConfirm(serviceCharge);
        if (balanceErr) {
          return res.status(balanceErr.status).json({ message: balanceErr.message });
        }
        const needsAccount = !isCustomerBalanceFunded(serviceCharge);
        if (needsAccount && !serviceCharge.accountId) {
          return res.status(400).json({ message: "Service charge must have an account before confirmation" });
        }
        db.prepare("UPDATE order_service_charges SET status = 'confirmed' WHERE id = ?;").run(serviceCharge.id);
        applyCashServiceChargeAccountEffects(serviceCharge, id);
      }
    }

    if (status === "completed" && currentOrder.status !== "completed") {
      trySyncCompletedOrderLedger(Number(id), userId);
    }
    
    const row = db
      .prepare(
        `SELECT o.*, c.name as customerName FROM orders o
         LEFT JOIN customers c ON c.id = o.customerId
         WHERE o.id = ?;`,
      )
      .get(id);
    
    // Get tags for the order
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
         WHERE ota.orderId = ?
         ORDER BY t.name ASC;`
      )
      .all(id);

    res.json({
      ...row,
      tags: tags.length > 0 ? tags : [],
      ...(cancelAffectedAccountIds !== null ? { affectedAccountIds: cancelAffectedAccountIds } : {}),
    });
    notifyOrderFinancial(
      Number(id),
      cancelAffectedAccountIds != null ? cancelAffectedAccountIds : undefined,
    );

    // Send notifications in background after response is sent
    if (status === 'completed' && currentOrder.status !== 'completed') {
      const allUsers = db.prepare("SELECT id FROM users").all();
      const allUserIds = allUsers.map(u => u.id);
      const userName = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
      createNotification({
        userId: allUserIds,
        type: 'order_completed',
        title: 'Order Completed',
        message: `Order #${id} - ${row.customerName || 'Customer'} has been completed by ${userName?.name || 'User'}`,
        entityType: 'order',
        entityId: id,
        actionUrl: `/orders`,
      }).catch(err => console.error('[changeOrderStatus] completed notification failed:', err));
    } else if (status === 'cancelled' && currentOrder.status !== 'cancelled') {
      const allUsers = db.prepare("SELECT id FROM users").all();
      const allUserIds = allUsers.map(u => u.id);
      const userName = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
      createNotification({
        userId: allUserIds,
        type: 'order_cancelled',
        title: 'Order Cancelled',
        message: `Order #${id} - ${row.customerName || 'Customer'} has been cancelled by ${userName?.name || 'User'}`,
        entityType: 'order',
        entityId: id,
        actionUrl: `/orders`,
      }).catch(err => console.error('[changeOrderStatus] cancelled notification failed:', err));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * When deleting a confirmed receipt/payment/profit/SC during order edit, undo the confirm's balance effect.
 * Skip for cancelled orders — cancel already ran performOrderFinancialReversals.
 */
function shouldReverseConfirmedEntryOnDelete(orderId) {
  const order = db.prepare("SELECT status FROM orders WHERE id = ?;").get(orderId);
  return order?.status !== "cancelled";
}

/**
 * Reverses confirmed receipts/payments, direct completion balances, profit, and service charge.
 * Same rules as order deletion; used for delete and for cancel.
 */
function performOrderFinancialReversals(orderId, order, reasonLabel) {
  const id = orderId;
  const receipts = db
    .prepare(
      "SELECT accountId, amount, imagePath, status, fundedFrom FROM order_receipts WHERE orderId = ? AND status = 'confirmed';",
    )
    .all(id);
  const payments = db
    .prepare(
      "SELECT accountId, amount, imagePath, status, fundedFrom FROM order_payments WHERE orderId = ? AND status = 'confirmed';",
    )
    .all(id);
  const confirmedProfits = db.prepare("SELECT accountId, amount FROM order_profits WHERE orderId = ? AND status = 'confirmed';").all(id);
  const confirmedServiceCharges = db
    .prepare(
      "SELECT accountId, amount, fundedFrom FROM order_service_charges WHERE orderId = ? AND status = 'confirmed';",
    )
    .all(id);

  const isCompleted = order.status === "completed";
  const hasDirectTransactions = isCompleted && (order.buyAccountId || order.sellAccountId);

  receipts.forEach((receipt) => {
    if (isCustomerBalanceFunded(receipt)) return;
    if (receipt.accountId && receipt.amount) {
      const accountId = receipt.accountId;
      const amount = receipt.amount;
      db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(amount, accountId);
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'withdraw', ?, ?, ?);`
      ).run(
        accountId,
        amount,
        `Order #${id} - Reversal of receipt from customer (${reasonLabel})`,
        new Date().toISOString()
      );
    }
  });

  payments.forEach((payment) => {
    if (isCustomerBalanceFunded(payment)) return;
    if (payment.accountId && payment.amount) {
      const accountId = payment.accountId;
      const amount = payment.amount;
      db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(amount, accountId);
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'add', ?, ?, ?);`
      ).run(
        accountId,
        amount,
        `Order #${id} - Reversal of payment to customer (${reasonLabel})`,
        new Date().toISOString()
      );
    }
  });

  if (hasDirectTransactions) {
    if (order.buyAccountId && order.amountBuy) {
      const buyAccountId = order.buyAccountId;
      const amountBuy = Number(order.amountBuy);
      const hasReceiptReversal = receipts.some((r) => r.accountId === buyAccountId);
      if (!hasReceiptReversal && !isNaN(amountBuy) && amountBuy > 0) {
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(amountBuy, buyAccountId);
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'withdraw', ?, ?, ?);`
        ).run(
          buyAccountId,
          amountBuy,
          `Order #${id} - Reversal of receipt from customer (${reasonLabel})`,
          new Date().toISOString()
        );
      }
    }

    if (order.sellAccountId && order.amountSell) {
      const sellAccountId = order.sellAccountId;
      const amountSell = Number(order.amountSell);
      const hasPaymentReversal = payments.some((p) => p.accountId === sellAccountId);
      if (!hasPaymentReversal && !isNaN(amountSell) && amountSell > 0) {
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(amountSell, sellAccountId);
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`
        ).run(
          sellAccountId,
          amountSell,
          `Order #${id} - Reversal of payment to customer (${reasonLabel})`,
          new Date().toISOString()
        );
      }
    }
  }

  const profitReversals =
    confirmedProfits.length > 0
      ? confirmedProfits
      : order.profitAmount !== null && order.profitAmount !== undefined && order.profitAccountId
        ? [{ accountId: order.profitAccountId, amount: Number(order.profitAmount) }]
        : [];

  profitReversals.forEach((profit) => {
    const profitAmount = Number(profit.amount);
    if (profit.accountId && !isNaN(profitAmount) && profitAmount > 0) {
      db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(profitAmount, profit.accountId);
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'withdraw', ?, ?, ?);`
      ).run(
        profit.accountId,
        profitAmount,
        `Order #${id} - Reversal of profit (${reasonLabel})`,
        new Date().toISOString()
      );
    }
  });

  const serviceChargeReversals =
    confirmedServiceCharges.length > 0
      ? confirmedServiceCharges
      : order.serviceChargeAmount !== null && order.serviceChargeAmount !== undefined && order.serviceChargeAccountId
        ? [{ accountId: order.serviceChargeAccountId, amount: Number(order.serviceChargeAmount) }]
        : [];

  serviceChargeReversals.forEach((serviceCharge) => {
    reverseCashServiceChargeAccountEffects(serviceCharge, id, reasonLabel);
  });

  const affectedAccountIds = new Set();
  receipts.forEach((receipt) => {
    if (receipt.accountId) affectedAccountIds.add(receipt.accountId);
  });
  payments.forEach((payment) => {
    if (payment.accountId) affectedAccountIds.add(payment.accountId);
  });
  if (hasDirectTransactions) {
    if (order.buyAccountId && order.amountBuy) {
      const amountBuy = Number(order.amountBuy);
      const hasReceiptReversal = receipts.some((r) => r.accountId === order.buyAccountId);
      if (!hasReceiptReversal && !isNaN(amountBuy) && amountBuy > 0) {
        affectedAccountIds.add(order.buyAccountId);
      }
    }
    if (order.sellAccountId && order.amountSell) {
      const amountSell = Number(order.amountSell);
      const hasPaymentReversal = payments.some((p) => p.accountId === order.sellAccountId);
      if (!hasPaymentReversal && !isNaN(amountSell) && amountSell > 0) {
        affectedAccountIds.add(order.sellAccountId);
      }
    }
  }
  profitReversals.forEach((profit) => {
    if (profit.accountId) affectedAccountIds.add(profit.accountId);
  });
  serviceChargeReversals.forEach((serviceCharge) => {
    if (serviceCharge.accountId) affectedAccountIds.add(serviceCharge.accountId);
  });

  return { affectedAccountIds };
}

export const deleteOrder = async (req, res, next) => {
  try {
    const { id: idRaw } = req.params;
    const id = parseInt(String(idRaw), 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const userId = getUserIdFromHeader(req);
    console.log(`[deleteOrder] orderId=${id} userId=${userId ?? "none"}`);

    // Check if order exists and get profit/service charge data, and account info
    const order = db.prepare("SELECT id, customerId, createdBy, handlerId, profitAmount, profitAccountId, serviceChargeAmount, serviceChargeAccountId, buyAccountId, sellAccountId, amountBuy, amountSell, status FROM orders WHERE id = ?;").get(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }

    const userPermissions = getUserPermissions(userId);
    if (!userPermissions?.actions?.deleteOrder) {
      return res.status(403).json({ message: "You do not have permission to delete orders" });
    }

    if (order.status === "completed" || order.status === "cancelled") {
      try {
        syncCustomerLedgerOnOrderCancelOrDelete(id, "deleted", userId);
      } catch (ledgerErr) {
        console.error("[deleteOrder] customer ledger delete sync failed:", ledgerErr);
      }
    }

    try {
      const purged = purgeLedgerEntriesForOrder(id);
      if (purged > 0) {
        console.log(`[deleteOrder] purged ${purged} customer_ledger_entries for orderId=${id}`);
      }
      if (order.customerId) {
        notifyCustomerLedger(order.customerId);
      }
    } catch (ledgerErr) {
      console.error("[deleteOrder] purge ledger entries failed:", ledgerErr);
      return res.status(500).json({
        message: "Failed to remove customer ledger records for this order",
      });
    }

    // Cancel already ran the same reversals; avoid double-counting on delete.
    const { affectedAccountIds } =
      order.status === "cancelled"
        ? { affectedAccountIds: new Set() }
        : performOrderFinancialReversals(id, order, "Order deleted");

    const allReceipts = db.prepare("SELECT imagePath FROM order_receipts WHERE orderId = ?;").all(id);
    const allPayments = db.prepare("SELECT imagePath FROM order_payments WHERE orderId = ?;").all(id);
    allReceipts.forEach((receipt) => deleteFile(receipt.imagePath));
    allPayments.forEach((payment) => deleteFile(payment.imagePath));

    // Get order details for notification before deleting
    const orderDetails = db.prepare(
      `SELECT o.id, c.name as customerName 
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customerId
       WHERE o.id = ?`
    ).get(id);
    const userName = db.prepare("SELECT name FROM users WHERE id = ?").get(userId);
    
    // Legacy approval rows (no FK) — remove so they never block cleanup
    db.prepare("DELETE FROM approval_requests WHERE entityType = 'order' AND entityId = ?").run(id);

    // Delete the order (this will cascade delete receipts and payments due to foreign key constraints)
    const stmt = db.prepare(`DELETE FROM orders WHERE id = ?;`);
    const result = stmt.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ 
      success: true,
      affectedAccountIds: Array.from(affectedAccountIds)
    });
    notifyOrderFinancial(id, Array.from(affectedAccountIds));

    // Send notification in background after response is sent
    const allUsers = db.prepare("SELECT id FROM users").all();
    const allUserIds = allUsers.map(u => u.id);
    createNotification({
      userId: allUserIds,
      type: 'order_deleted',
      title: 'Order Deleted',
      message: `Order #${id} - ${orderDetails?.customerName || 'Customer'} has been deleted by ${userName?.name || 'User'}`,
      entityType: 'order',
      entityId: id,
      actionUrl: `/orders`,
    }).catch(err => console.error('[deleteOrder] notification failed:', err));
  } catch (error) {
    next(error);
  }
};

export const getOrderDetails = (req, res, next) => {
  try {
    const { id } = req.params;
    const order = db
      .prepare(
        `SELECT o.*, c.name as customerName, u.name as handlerName,
                COALESCE(cu.name, u.name) as createdByName FROM orders o
         LEFT JOIN customers c ON c.id = o.customerId
         LEFT JOIN users u ON u.id = o.handlerId
         LEFT JOIN users cu ON cu.id = o.createdBy
         WHERE o.id = ?;`,
      )
      .get(id);
    
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const receipts = db
      .prepare(
        `SELECT r.*, a.name as accountName 
         FROM order_receipts r
         LEFT JOIN accounts a ON a.id = r.accountId
         WHERE r.orderId = ? 
         ORDER BY r.createdAt ASC;`
      )
      .all(id);

    const beneficiaries = db
      .prepare("SELECT * FROM order_beneficiaries WHERE orderId = ? ORDER BY createdAt ASC;")
      .all(id);

    const payments = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_payments p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.orderId = ? 
         ORDER BY p.createdAt ASC;`
      )
      .all(id);

    // Get profit entries (both draft and confirmed)
    const profits = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_profits p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.orderId = ? 
         ORDER BY p.createdAt ASC;`
      )
      .all(id);

    // Get service charge entries (both draft and confirmed)
    const serviceCharges = db
      .prepare(
        `SELECT sc.*, a.name as accountName 
         FROM order_service_charges sc
         LEFT JOIN accounts a ON a.id = sc.accountId
         WHERE sc.orderId = ? 
         ORDER BY sc.createdAt ASC;`
      )
      .all(id);

    // Calculate totals only from confirmed receipts/payments for balance calculations
    const totalReceiptAmount = receipts.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + r.amount, 0);
    const totalPaymentAmount = payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + p.amount, 0);
    
    // Use the original amountBuy and amountSell from order creation
    const receiptBalance = order.amountBuy - totalReceiptAmount;
    const paymentBalance = order.amountSell - totalPaymentAmount;

    const receiptBalanceCalc = receiptBalance;
    const paymentBalanceCalc = paymentBalance;
    
    // Convert file paths to URLs for receipts and payments
    const receiptsWithUrls = receipts.map(r => ({
      ...r,
      imagePath: r.imagePath?.startsWith('data:') ? r.imagePath : getFileUrl(r.imagePath),
    }));
    
    const paymentsWithUrls = payments.map(p => ({
      ...p,
      imagePath: p.imagePath?.startsWith('data:') ? p.imagePath : getFileUrl(p.imagePath),
    }));

    // Get tags for the order
    const tags = db
      .prepare(
        `SELECT t.id, t.name, t.color 
         FROM tags t
         INNER JOIN order_tag_assignments ota ON ota.tagId = t.id
         WHERE ota.orderId = ?
         ORDER BY t.name ASC;`
      )
      .all(id);

    // Get profit transactions for this order
    const profitTransactions = db
      .prepare(
        `SELECT at.*, a.name as accountName, a.currencyCode
         FROM account_transactions at
         LEFT JOIN accounts a ON a.id = at.accountId
         WHERE at.description LIKE ? AND at.type = 'add'
         ORDER BY at.createdAt ASC;`
      )
      .all(`Order #${id} - Profit%`);

    // Get service charge transactions for this order
    const serviceChargeTransactions = db
      .prepare(
        `SELECT at.*, a.name as accountName, a.currencyCode,
                CASE 
                  WHEN at.type = 'add' THEN at.amount
                  WHEN at.type = 'withdraw' THEN -at.amount
                  ELSE 0
                END as signedAmount
         FROM account_transactions at
         LEFT JOIN accounts a ON a.id = at.accountId
         WHERE (at.description LIKE ? OR at.description LIKE ?)
         ORDER BY at.createdAt ASC;`
      )
      .all(`Order #${id} - Service Charge%`, `Order #${id} - Service Charge Paid by Us%`);

    res.json({
      order: {
        ...order,
        walletAddresses: order.walletAddresses ? JSON.parse(order.walletAddresses) : null,
        bankDetails: order.bankDetails ? JSON.parse(order.bankDetails) : null,
        tags: tags.length > 0 ? tags : [],
      },
      receipts: receiptsWithUrls,
      beneficiaries: beneficiaries.map(b => ({
        ...b,
        walletAddresses: b.walletAddresses ? JSON.parse(b.walletAddresses) : null,
      })),
      payments: paymentsWithUrls,
      profits: profits || [],
      serviceCharges: serviceCharges || [],
      profitTransactions: profitTransactions || [],
      serviceChargeTransactions: serviceChargeTransactions || [],
      totalReceiptAmount,
      totalPaymentAmount,
      receiptBalance: receiptBalanceCalc,
      paymentBalance: paymentBalanceCalc,
    });
  } catch (error) {
    next(error);
  }
};

export const processOrder = (req, res, next) => {
  try {
    console.log("processOrder called with params:", req.params, "body:", req.body);
    const { id } = req.params;
    const { handlerId, paymentFlow = "receive_first" } = req.body;
    // Commented out for future use:
    // const { handlerId, paymentType, networkChain, walletAddresses, bankDetails } = req.body;

    if (!handlerId) {
      console.error("processOrder error: Handler ID is missing");
      return res.status(400).json({ message: "Handler ID is required" });
    }

    const existingOrder = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
    if (!existingOrder) {
      console.error("processOrder error: Order not found", id);
      return res.status(404).json({ message: "Order not found" });
    }

    const status = "saved";

    console.log("processOrder: Updating order", { id, handlerId, paymentFlow, status });

    // Update order with handler and status
    // Both flex orders and regular orders now follow the same flow
    try {
      const updateStmt = db.prepare(
        `UPDATE orders 
         SET handlerId = @handlerId, 
             status = @status
         WHERE id = @id;`
      );
      const updateResult = updateStmt.run({
        id: Number(id),
        handlerId: Number(handlerId),
        status: status,
      });

      console.log("processOrder: Update result", updateResult);
    } catch (updateError) {
      console.error("processOrder: Update error", updateError);
      return res.status(400).json({ message: `Failed to update order: ${updateError.message}` });
    }

    const order = db
      .prepare(
        `SELECT o.*, c.name as customerName, u.name as handlerName,
                COALESCE(cu.name, u.name) as createdByName FROM orders o
         LEFT JOIN customers c ON c.id = o.customerId
         LEFT JOIN users u ON u.id = o.handlerId
         LEFT JOIN users cu ON cu.id = o.createdBy
         WHERE o.id = ?;`,
      )
      .get(id);

    if (!order) {
      return res.status(404).json({ message: "Order not found after update" });
    }

    try {
      res.json({
        ...order,
        walletAddresses: order.walletAddresses ? JSON.parse(order.walletAddresses) : null,
        bankDetails: order.bankDetails ? JSON.parse(order.bankDetails) : null,
      });
    } catch (parseError) {
      res.json({
        ...order,
        walletAddresses: null,
        bankDetails: null,
      });
    }
    notifyOrderWrite(Number(id));
  } catch (error) {
    console.error("Error processing order:", error);
    next(error);
  }
};

export const addReceipt = (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, accountId, fundedFrom: fundedFromRaw } = req.body;
    const file = req.file; // Multer file object
    const userId = getUserIdFromHeader(req);

    // Support both file upload and base64 (for backward compatibility)
    let imagePath = null;
    
    if (file) {
      // New file upload path
      const filename = generateOrderReceiptFilename(id, file.mimetype, file.originalname);
      imagePath = saveFile(file.buffer, filename, "order");
    } else if (req.body.imagePath) {
      // Legacy base64 path (backward compatibility)
      const base64Path = req.body.imagePath;
      if (typeof base64Path === 'string' && base64Path.trim().length > 0) {
        if (base64Path.startsWith('data:')) {
          // Convert base64 to file for migration
          const buffer = base64ToBuffer(base64Path);
          if (buffer) {
            const filename = generateOrderReceiptFilename(id, null, null);
            imagePath = saveFile(buffer, filename, "order");
          } else {
            // If conversion fails, store as base64 (legacy)
            imagePath = base64Path;
          }
        } else {
          // Relative path or "/api/uploads/..." from client — persist relative only
          imagePath = normalizeStoredImagePath(base64Path);
        }
      }
    }

    // Check if order exists first and get paymentFlow and status
    const order = db
      .prepare(
        "SELECT id, customerId, createdBy, handlerId, fromCurrency, toCurrency, amountBuy, amountSell, paymentFlow, buyAccountId, status, orderType, orderMode FROM orders WHERE id = ?;",
      )
      .get(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check permissions
    if (userId) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can add receipts" 
        });
      }
    } else {
      return res.status(401).json({ message: "User ID is required" });
    }

    // Receipt attachment is optional; use placeholder when none uploaded.
    if (!imagePath) {
      imagePath = "OTC_NO_IMAGE";
    }
    if (amount === undefined) {
      return res.status(400).json({ message: "Amount is required" });
    }

    const fundedFrom = ledgerSwapFunding(order, fundedFromRaw);
    const receiptAmount = parseFloat(amount);
    if (!receiptAmount || receiptAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    let receiptAccountId = null;

    if (fundedFrom === RECEIPT_FUNDED_CUSTOMER_BALANCE) {
      if (!order.customerId) {
        return res.status(400).json({ message: "Order must have a customer to use prepaid balance" });
      }
    } else {
      if (!accountId) {
        return res.status(400).json({ message: "Account ID is required for cash receipt" });
      }
      receiptAccountId = Number(accountId);
      const receiptAccount = db
        .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;")
        .get(receiptAccountId);
      if (!receiptAccount) {
        return res.status(400).json({ message: "Receipt account not found" });
      }
      if (receiptAccount.currencyCode !== order.fromCurrency) {
        return res.status(400).json({
          message: `Receipt account currency (${receiptAccount.currencyCode}) does not match order fromCurrency (${order.fromCurrency})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          receiptAccountId,
          "You do not have access to use this order account",
        )
      ) {
        return;
      }
    }

    const stmt = db.prepare(
      `INSERT INTO order_receipts (orderId, imagePath, amount, accountId, status, fundedFrom, createdAt)
       VALUES (@orderId, @imagePath, @amount, @accountId, @status, @fundedFrom, @createdAt);`,
    );

    const result = stmt.run({
      orderId: id,
      imagePath,
      amount: receiptAmount,
      accountId: receiptAccountId,
      status: "draft",
      fundedFrom,
      createdAt: new Date().toISOString(),
    });

    const receipt = db
      .prepare(
        `SELECT r.*, a.name as accountName 
         FROM order_receipts r
         LEFT JOIN accounts a ON a.id = r.accountId
         WHERE r.id = ?;`
      )
      .get(result.lastInsertRowid);
    
    // Convert file path to URL for response (if not base64)
    const receiptWithUrl = {
      ...receipt,
      imagePath: receipt.imagePath.startsWith('data:') ? receipt.imagePath : getFileUrl(receipt.imagePath),
    };

    // Note: Account balance and transaction history will only be updated when receipt is confirmed
    // This allows users to save drafts and confirm later

    // Update order's buyAccountId if not already set (use the account from the first receipt)
    if (receiptAccountId && !order.buyAccountId) {
      db.prepare("UPDATE orders SET buyAccountId = ? WHERE id = ?;").run(receiptAccountId, id);
    }

    res.json(receiptWithUrl);
    if (order?.customerId) {
      scheduleCacheSync({
        scopes: ["customerLedger"],
        customerId: order.customerId,
      });
    }
    notifyOrderWrite(Number(id));
  } catch (error) {
    console.error("Error adding receipt:", error);
    next(error);
  }
};

export const addBeneficiary = (req, res, next) => {
  try {
    const { id } = req.params;
    const { paymentAccountId, receiptAccountId } = req.body;
    // Commented out for future use:
    // const { paymentType, networkChain, walletAddresses, bankName, accountTitle, accountNumber, accountIban, swiftCode, bankAddress } = req.body;

    // Check if order exists and get its details
    const existingOrder = db.prepare("SELECT id, fromCurrency, toCurrency, paymentFlow FROM orders WHERE id = ?").get(id);
    if (!existingOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const paymentFlow = existingOrder.paymentFlow || "receive_first";

    // Handle payment account (for receive_first flow)
    if (paymentAccountId) {
      // Verify payment account exists and matches order's toCurrency
      const paymentAccount = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?").get(paymentAccountId);
      if (!paymentAccount) {
        return res.status(400).json({ message: "Payment account not found" });
      }
      if (paymentAccount.currencyCode !== existingOrder.toCurrency) {
        return res.status(400).json({ 
          message: `Payment account currency (${paymentAccount.currencyCode}) does not match order toCurrency (${existingOrder.toCurrency})` 
        });
      }

      // Update order with sellAccountId (payment account - where we pay customer from in toCurrency)
      db.prepare("UPDATE orders SET sellAccountId = ? WHERE id = ?;").run(paymentAccountId, id);
    }

    // Handle receipt account (for pay_first flow when not set during processOrder)
    if (receiptAccountId) {
      // Verify receipt account exists and matches order's fromCurrency
      const receiptAccount = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?").get(receiptAccountId);
      if (!receiptAccount) {
        return res.status(400).json({ message: "Receipt account not found" });
      }
      if (receiptAccount.currencyCode !== existingOrder.fromCurrency) {
        return res.status(400).json({ 
          message: `Receipt account currency (${receiptAccount.currencyCode}) does not match order fromCurrency (${existingOrder.fromCurrency})` 
        });
      }

      // Update order with buyAccountId (receipt account - where we receive customer payment in fromCurrency)
      db.prepare("UPDATE orders SET buyAccountId = ? WHERE id = ?;").run(receiptAccountId, id);
    }

    if (!paymentAccountId && !receiptAccountId) {
      return res.status(400).json({ message: "Either payment account ID or receipt account ID is required" });
    }

    // Commented out for future use - beneficiary details:
    // const stmt = db.prepare(
    //   `INSERT INTO order_beneficiaries 
    //    (orderId, paymentType, networkChain, walletAddresses, bankName, accountTitle, accountNumber, accountIban, swiftCode, bankAddress, createdAt)
    //    VALUES (@orderId, @paymentType, @networkChain, @walletAddresses, @bankName, @accountTitle, @accountNumber, @accountIban, @swiftCode, @bankAddress, @createdAt);`
    // );
    // const result = stmt.run({
    //   orderId: id,
    //   paymentType,
    //   networkChain: networkChain || null,
    //   walletAddresses: walletAddresses ? JSON.stringify(walletAddresses) : null,
    //   bankName: bankName || null,
    //   accountTitle: accountTitle || null,
    //   accountNumber: accountNumber || null,
    //   accountIban: accountIban || null,
    //   swiftCode: swiftCode || null,
    //   bankAddress: bankAddress || null,
    //   createdAt: new Date().toISOString(),
    // });
    // const beneficiary = db
    //   .prepare("SELECT * FROM order_beneficiaries WHERE id = ?;")
    //   .get(result.lastInsertRowid);
    // res.json({
    //   ...beneficiary,
    //   walletAddresses: beneficiary.walletAddresses ? JSON.parse(beneficiary.walletAddresses) : null,
    // });

    // Return success response
    res.json({ success: true, message: "Payment account set successfully" });
    notifyOrderWrite(Number(id));
  } catch (error) {
    next(error);
  }
};

// Helper function to update account balances when order is completed
const updateAccountBalancesOnCompletion = (orderId, isImported = false) => {
  // buyAccountId = receipt account (where we receive customer payment in fromCurrency)
  // sellAccountId = payment account (where we pay customer from in toCurrency)
  const orderWithAccounts = db
    .prepare("SELECT buyAccountId, sellAccountId, amountBuy, amountSell FROM orders WHERE id = ?;")
    .get(orderId);
  
  if (!orderWithAccounts) {
    console.error(`[updateAccountBalancesOnCompletion] Order ${orderId} not found`);
    return;
  }
  
  console.log(`[updateAccountBalancesOnCompletion] Order ${orderId} completion - Accounts:`, {
    buyAccountId: orderWithAccounts.buyAccountId,
    sellAccountId: orderWithAccounts.sellAccountId,
    amountBuy: orderWithAccounts.amountBuy,
    amountSell: orderWithAccounts.amountSell,
    isImported,
  });
  
  if (orderWithAccounts.buyAccountId) {
    // Add funds to buy account (receipt account) - customer paid us amountBuy in fromCurrency
    const buyAccount = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(orderWithAccounts.buyAccountId);
    if (buyAccount) {
      db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
        orderWithAccounts.amountBuy,
        orderWithAccounts.buyAccountId
      );
      const description = isImported 
        ? `Order #${orderId} - Receipt from customer (Imported)`
        : `Order #${orderId} - Receipt from customer`;
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'add', ?, ?, ?);`
      ).run(
        orderWithAccounts.buyAccountId,
        orderWithAccounts.amountBuy,
        description,
        new Date().toISOString()
      );
    }
  }
  
  if (orderWithAccounts.sellAccountId) {
    // Deduct funds from sell account (payment account) - we paid customer amountSell in toCurrency
    // Allow negative balances (employees may use their own money)
    const sellAccount = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(orderWithAccounts.sellAccountId);
    if (sellAccount) {
      const oldBalance = sellAccount.balance;
      const amountToDeduct = Number(orderWithAccounts.amountSell);
      const newBalance = oldBalance - amountToDeduct;
      
      console.log(`Updating sell account ${orderWithAccounts.sellAccountId}: ${oldBalance} - ${amountToDeduct} = ${newBalance}`);
      
      // Use explicit calculation to ensure negative values work
      const updateStmt = db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;");
      const updateResult = updateStmt.run(newBalance, orderWithAccounts.sellAccountId);
      
      console.log(`Update result:`, updateResult);
      
      // Verify the update
      const updatedAccount = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(orderWithAccounts.sellAccountId);
      console.log(`Updated balance:`, updatedAccount?.balance);
      
      const description = isImported 
        ? `Order #${orderId} - Payment to customer (Imported)`
        : `Order #${orderId} - Payment to customer`;
      db.prepare(
        `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
         VALUES (?, 'withdraw', ?, ?, ?);`
      ).run(
        orderWithAccounts.sellAccountId,
        amountToDeduct,
        description,
        new Date().toISOString()
      );
    } else {
      console.warn(`Sell account ${orderWithAccounts.sellAccountId} not found`);
    }
  } else {
    console.warn(`Order ${orderId} has no sellAccountId set`);
  }
};

export const addPayment = (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, accountId, fundedFrom: fundedFromRaw } = req.body;
    const file = req.file; // Multer file object
    const userId = getUserIdFromHeader(req);

    // Support both file upload and base64 (for backward compatibility)
    let imagePath = null;
    
    if (file) {
      // New file upload path
      const filename = generateOrderPaymentFilename(id, file.mimetype, file.originalname);
      imagePath = saveFile(file.buffer, filename, "order");
    } else if (req.body.imagePath) {
      // Legacy base64 path (backward compatibility)
      const base64Path = req.body.imagePath;
      if (typeof base64Path === 'string' && base64Path.trim().length > 0) {
        if (base64Path.startsWith('data:')) {
          // Convert base64 to file for migration
          const buffer = base64ToBuffer(base64Path);
          if (buffer) {
            const filename = generateOrderPaymentFilename(id, null, null);
            imagePath = saveFile(buffer, filename, "order");
          } else {
            // If conversion fails, store as base64 (legacy)
            imagePath = base64Path;
          }
        } else {
          imagePath = normalizeStoredImagePath(base64Path);
        }
      }
    }

    const order = db
      .prepare(
        "SELECT id, createdBy, handlerId, customerId, toCurrency, amountSell, paymentFlow, sellAccountId, rate, orderType, orderMode FROM orders WHERE id = ?;",
      )
      .get(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check permissions
    if (userId) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can add payments" 
        });
      }
    } else {
      return res.status(401).json({ message: "User ID is required" });
    }

    // Payment attachment is optional; use placeholder when none uploaded.
    if (!imagePath) {
      imagePath = "OTC_NO_IMAGE";
    }
    if (amount === undefined) {
      return res.status(400).json({ message: "Amount is required" });
    }

    const fundedFrom = ledgerSwapFunding(order, fundedFromRaw);
    const paymentAmount = parseFloat(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    let paymentAccountId = null;

    if (fundedFrom === RECEIPT_FUNDED_CUSTOMER_BALANCE) {
      if (!order.customerId) {
        return res.status(400).json({
          message: "Order must have a customer to settle payment from customer advance",
        });
      }
    } else {
      if (!accountId) {
        return res.status(400).json({ message: "Account ID is required for cash payment" });
      }
      paymentAccountId = Number(accountId);
      const paymentAccount = db
        .prepare("SELECT id, currencyCode, balance FROM accounts WHERE id = ?;")
        .get(paymentAccountId);
      if (!paymentAccount) {
        return res.status(400).json({ message: "Payment account not found" });
      }
      if (paymentAccount.currencyCode !== order.toCurrency) {
        return res.status(400).json({
          message: `Payment account currency (${paymentAccount.currencyCode}) does not match order toCurrency (${order.toCurrency})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          paymentAccountId,
          "You do not have access to use this order account",
        )
      ) {
        return;
      }
    }

    const stmt = db.prepare(
      `INSERT INTO order_payments (orderId, imagePath, amount, accountId, status, fundedFrom, createdAt)
       VALUES (@orderId, @imagePath, @amount, @accountId, @status, @fundedFrom, @createdAt);`,
    );

    const result = stmt.run({
      orderId: id,
      imagePath,
      amount: paymentAmount,
      accountId: paymentAccountId,
      status: "draft",
      fundedFrom,
      createdAt: new Date().toISOString(),
    });

    const payment = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_payments p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.id = ?;`
      )
      .get(result.lastInsertRowid);
    
    // Convert file path to URL for response (if not base64)
    const paymentWithUrl = {
      ...payment,
      imagePath: payment.imagePath.startsWith('data:') ? payment.imagePath : getFileUrl(payment.imagePath),
    };

    // Note: Account balance and transaction history will only be updated when payment is confirmed
    // This allows users to save drafts and confirm later

    // Update order's sellAccountId if not already set (use the account from the first payment)
    if (paymentAccountId && !order.sellAccountId) {
      db.prepare("UPDATE orders SET sellAccountId = ? WHERE id = ?;").run(paymentAccountId, id);
    }

    res.json(paymentWithUrl);
    notifyOrderWrite(Number(id));
  } catch (error) {
    console.error("Error adding payment:", error);
    next(error);
  }
};

// Update a draft receipt (can only update drafts)
export const updateReceipt = (req, res, next) => {
  try {
    const { receiptId } = req.params;
    const { amount, accountId, fundedFrom: fundedFromRaw } = req.body;
    const file = req.file;

    // Check if receipt exists and is a draft
    const existingReceipt = db.prepare("SELECT * FROM order_receipts WHERE id = ?;").get(receiptId);
    if (!existingReceipt) {
      return res.status(404).json({ message: "Receipt not found" });
    }
    if (existingReceipt.status !== 'draft') {
      return res.status(400).json({ message: "Only draft receipts can be updated" });
    }

    const order = db
      .prepare("SELECT id, customerId, fromCurrency, orderMode FROM orders WHERE id = ?;")
      .get(existingReceipt.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    let imagePath = existingReceipt.imagePath;
    
    // Update file if provided
    if (file) {
      // Delete old file
      if (imagePath && !imagePath.startsWith('data:')) {
        deleteFile(imagePath);
      }
      const filename = generateOrderReceiptFilename(order.id, file.mimetype, file.originalname);
      imagePath = saveFile(file.buffer, filename, "order");
    }

    const fundedFrom =
      fundedFromRaw !== undefined
        ? ledgerSwapFunding(order, fundedFromRaw)
        : ledgerSwapFunding(order, existingReceipt.fundedFrom);

    const receiptAmount = amount !== undefined ? parseFloat(amount) : existingReceipt.amount;
    if (!receiptAmount || receiptAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    let accountIdToUse = null;
    if (fundedFrom === RECEIPT_FUNDED_CUSTOMER_BALANCE) {
      if (!order.customerId) {
        return res.status(400).json({ message: "Order must have a customer to use prepaid balance" });
      }
    } else if (accountId !== undefined && accountId !== null && accountId !== "") {
      const receiptAccount = db
        .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;")
        .get(Number(accountId));
      if (!receiptAccount) {
        return res.status(400).json({ message: "Receipt account not found" });
      }
      if (receiptAccount.currencyCode !== order.fromCurrency) {
        return res.status(400).json({
          message: `Receipt account currency (${receiptAccount.currencyCode}) does not match order fromCurrency (${order.fromCurrency})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          Number(accountId),
          "You do not have access to use this order account",
        )
      ) {
        return;
      }
      accountIdToUse = Number(accountId);
    } else if (existingReceipt.accountId) {
      accountIdToUse = existingReceipt.accountId;
    } else {
      return res.status(400).json({ message: "Account ID is required for cash receipt" });
    }

    db.prepare(
      `UPDATE order_receipts
       SET imagePath = @imagePath, amount = @amount, accountId = @accountId, fundedFrom = @fundedFrom
       WHERE id = @id;`,
    ).run({
      id: receiptId,
      imagePath,
      amount: receiptAmount,
      accountId: accountIdToUse,
      fundedFrom,
    });

    const updatedReceipt = db
      .prepare(
        `SELECT r.*, a.name as accountName 
         FROM order_receipts r
         LEFT JOIN accounts a ON a.id = r.accountId
         WHERE r.id = ?;`
      )
      .get(receiptId);
    
    const receiptWithUrl = {
      ...updatedReceipt,
      imagePath: updatedReceipt.imagePath.startsWith('data:') ? updatedReceipt.imagePath : getFileUrl(updatedReceipt.imagePath),
    };

    res.json(receiptWithUrl);
    if (existingReceipt.status === "confirmed") {
      trySyncCompletedOrderLedger(Number(existingReceipt.orderId), userId);
    }
    notifyOrderWrite(Number(existingReceipt.orderId));
  } catch (error) {
    console.error("Error updating receipt:", error);
    next(error);
  }
};

// Delete a receipt — drafts always; confirmed only for users with editAnyOrder permission (reverses account balance)
export const deleteReceipt = (req, res, next) => {
  try {
    const { receiptId } = req.params;
    const userId = getUserIdFromHeader(req);

    const receipt = db.prepare("SELECT * FROM order_receipts WHERE id = ?;").get(receiptId);
    if (!receipt) {
      return res.status(404).json({ message: "Receipt not found" });
    }

    if (receipt.status === 'confirmed') {
      const userPermissions = getUserPermissions(userId);
      if (!canEditAnyOrder(userPermissions)) {
        return res.status(400).json({ message: "Only draft receipts can be deleted" });
      }
      if (
        !isCustomerBalanceFunded(receipt) &&
        receipt.accountId &&
        shouldReverseConfirmedEntryOnDelete(receipt.orderId)
      ) {
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
          receipt.amount,
          receipt.accountId,
        );
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'subtract', ?, ?, ?);`
        ).run(
          receipt.accountId,
          receipt.amount,
          `Order #${receipt.orderId} - Receipt reversed (order edited)`,
          new Date().toISOString(),
        );
      }
    }

    // Delete file
    if (receipt.imagePath && !receipt.imagePath.startsWith('data:')) {
      deleteFile(receipt.imagePath);
    }

    const orderId = receipt.orderId;
    db.prepare("DELETE FROM order_receipts WHERE id = ?;").run(receiptId);

    res.json({ success: true, orderId });
    trySyncCompletedOrderLedger(Number(orderId), userId);
    notifyOrderFinancial(
      Number(orderId),
      receipt.accountId ? [receipt.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error deleting receipt:", error);
    next(error);
  }
};

// Confirm a draft receipt (updates account balance)
export const confirmReceipt = (req, res, next) => {
  try {
    const { receiptId } = req.params;
    const userId = getUserIdFromHeader(req);

    // Check if receipt exists and is a draft
    const receipt = db.prepare("SELECT * FROM order_receipts WHERE id = ?;").get(receiptId);
    if (!receipt) {
      return res.status(404).json({ message: "Receipt not found" });
    }
    if (receipt.status !== 'draft') {
      return res.status(400).json({ message: "Only draft receipts can be confirmed" });
    }

    // Check permissions - get order info (fetch all fields needed for later use)
    const order = db.prepare("SELECT id, createdBy, handlerId, fromCurrency, toCurrency, amountBuy, paymentFlow, actualAmountBuy, rate, actualRate, status FROM orders WHERE id = ?;").get(receipt.orderId);
    if (userId && order) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can confirm receipts" 
        });
      }
    } else if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }

    const orderForReceipt = db
      .prepare("SELECT id, customerId, fromCurrency FROM orders WHERE id = ?;")
      .get(receipt.orderId);

    if (isCustomerBalanceFunded(receipt)) {
      if (!orderForReceipt?.customerId) {
        return res.status(400).json({ message: "Order must have a customer to use prepaid balance" });
      }
      try {
        assertAllocatableBalance(
          orderForReceipt.customerId,
          orderForReceipt.fromCurrency,
          receipt.amount,
          receiptId,
        );
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({ message: err.message });
        }
        throw err;
      }
    } else {
      if (!receipt.accountId) {
        return res.status(400).json({ message: "Receipt must have an account before confirmation" });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          receipt.accountId,
          "You do not have access to confirm this order account",
        )
      ) {
        return;
      }
    }

    db.prepare("UPDATE order_receipts SET status = 'confirmed' WHERE id = ?;").run(receiptId);

    if (!isCustomerBalanceFunded(receipt) && receipt.accountId) {
      const receiptAccount = db
        .prepare("SELECT balance FROM accounts WHERE id = ?;")
        .get(receipt.accountId);
      if (receiptAccount) {
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
          receipt.amount,
          receipt.accountId,
        );
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`,
        ).run(
          receipt.accountId,
          receipt.amount,
          `Order #${receipt.orderId} - Receipt from customer`,
          new Date().toISOString(),
        );
      }
    }

    // Get updated receipt
    const confirmedReceipt = db
      .prepare(
        `SELECT r.*, a.name as accountName 
         FROM order_receipts r
         LEFT JOIN accounts a ON a.id = r.accountId
         WHERE r.id = ?;`
      )
      .get(receiptId);
    
    const receiptWithUrl = {
      ...confirmedReceipt,
      imagePath: confirmedReceipt.imagePath.startsWith('data:') ? confirmedReceipt.imagePath : getFileUrl(confirmedReceipt.imagePath),
    };

    // Check if order should be updated based on confirmed receipts
    // Note: order variable already fetched above with all needed fields
    if (order) {
      const confirmedReceipts = db.prepare("SELECT * FROM order_receipts WHERE orderId = ? AND status = 'confirmed';").all(receipt.orderId);
      const totalAmount = confirmedReceipts.reduce((sum, r) => sum + r.amount, 0);
      
      if (order.status === "saved") {
        const effectiveRate = order.actualRate || order.rate;
        const calculatedAmountSell = calculateAmountSell(totalAmount, effectiveRate, order.fromCurrency, order.toCurrency);
        db.prepare(
          `UPDATE orders 
           SET actualAmountBuy = @actualAmountBuy,
               actualAmountSell = @actualAmountSell,
               actualRate = @actualRate
           WHERE id = @id;`
        ).run({
          id: Number(receipt.orderId),
          actualAmountBuy: totalAmount,
          actualAmountSell: calculatedAmountSell,
          actualRate: effectiveRate,
        });
      }
    }

    res.json(receiptWithUrl);
    if (orderForReceipt?.customerId) {
      scheduleCacheSync({
        scopes: ["customerLedger"],
        customerId: orderForReceipt.customerId,
      });
    }
    trySyncCompletedOrderLedger(Number(receipt.orderId), userId);
    notifyOrderFinancial(
      Number(receipt.orderId),
      receipt.accountId ? [receipt.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error confirming receipt:", error);
    next(error);
  }
};

// Update a draft payment (can only update drafts)
export const updatePayment = (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const { amount, accountId, fundedFrom: fundedFromRaw } = req.body;
    const file = req.file;

    // Check if payment exists and is a draft
    const existingPayment = db.prepare("SELECT * FROM order_payments WHERE id = ?;").get(paymentId);
    if (!existingPayment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (existingPayment.status !== 'draft') {
      return res.status(400).json({ message: "Only draft payments can be updated" });
    }

    const order = db
      .prepare("SELECT id, customerId, toCurrency, orderMode FROM orders WHERE id = ?;")
      .get(existingPayment.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    let imagePath = existingPayment.imagePath;
    
    // Update file if provided
    if (file) {
      // Delete old file
      if (imagePath && !imagePath.startsWith('data:')) {
        deleteFile(imagePath);
      }
      const filename = generateOrderPaymentFilename(order.id, file.mimetype, file.originalname);
      imagePath = saveFile(file.buffer, filename, "order");
    }

    const fundedFrom =
      fundedFromRaw !== undefined
        ? ledgerSwapFunding(order, fundedFromRaw)
        : ledgerSwapFunding(order, existingPayment.fundedFrom);

    const paymentAmount = amount !== undefined ? parseFloat(amount) : existingPayment.amount;
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    let accountIdToUse = null;
    if (fundedFrom === RECEIPT_FUNDED_CUSTOMER_BALANCE) {
      if (!order.customerId) {
        return res.status(400).json({
          message: "Order must have a customer to settle payment from customer advance",
        });
      }
    } else if (accountId !== undefined && accountId !== null && accountId !== "") {
      const paymentAccount = db
        .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;")
        .get(Number(accountId));
      if (!paymentAccount) {
        return res.status(400).json({ message: "Payment account not found" });
      }
      if (paymentAccount.currencyCode !== order.toCurrency) {
        return res.status(400).json({
          message: `Payment account currency (${paymentAccount.currencyCode}) does not match order toCurrency (${order.toCurrency})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          Number(accountId),
          "You do not have access to use this order account",
        )
      ) {
        return;
      }
      accountIdToUse = Number(accountId);
    } else if (existingPayment.accountId) {
      accountIdToUse = existingPayment.accountId;
    } else {
      return res.status(400).json({ message: "Account ID is required for cash payment" });
    }

    db.prepare(
      `UPDATE order_payments
       SET imagePath = @imagePath, amount = @amount, accountId = @accountId, fundedFrom = @fundedFrom
       WHERE id = @id;`,
    ).run({
      id: paymentId,
      imagePath,
      amount: paymentAmount,
      accountId: accountIdToUse,
      fundedFrom,
    });

    const updatedPayment = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_payments p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.id = ?;`
      )
      .get(paymentId);
    
    const paymentWithUrl = {
      ...updatedPayment,
      imagePath: updatedPayment.imagePath.startsWith('data:') ? updatedPayment.imagePath : getFileUrl(updatedPayment.imagePath),
    };

    res.json(paymentWithUrl);
    if (existingPayment.status === "confirmed") {
      trySyncCompletedOrderLedger(Number(existingPayment.orderId), userId);
    }
    notifyOrderWrite(Number(existingPayment.orderId));
  } catch (error) {
    console.error("Error updating payment:", error);
    next(error);
  }
};

// Delete a draft payment (can only delete drafts)
// Delete a payment — drafts always; confirmed only for users with editAnyOrder permission (reverses account balance)
export const deletePayment = (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const userId = getUserIdFromHeader(req);

    const payment = db.prepare("SELECT * FROM order_payments WHERE id = ?;").get(paymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.status === 'confirmed') {
      const userPermissions = getUserPermissions(userId);
      if (!canEditAnyOrder(userPermissions)) {
        return res.status(400).json({ message: "Only draft payments can be deleted" });
      }
      // Reverse the balance decrease that was applied when this payment was confirmed
      if (payment.accountId && shouldReverseConfirmedEntryOnDelete(payment.orderId)) {
        db.prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?;").run(
          payment.amount,
          payment.accountId,
        );
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'add', ?, ?, ?);`
        ).run(
          payment.accountId,
          payment.amount,
          `Order #${payment.orderId} - Payment reversed (order edited)`,
          new Date().toISOString(),
        );
      }
    }

    // Delete file
    if (payment.imagePath && !payment.imagePath.startsWith('data:')) {
      deleteFile(payment.imagePath);
    }

    const orderId = payment.orderId;
    db.prepare("DELETE FROM order_payments WHERE id = ?;").run(paymentId);

    res.json({ success: true, orderId });
    trySyncCompletedOrderLedger(Number(orderId), userId);
    notifyOrderFinancial(
      Number(orderId),
      payment.accountId ? [payment.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error deleting payment:", error);
    next(error);
  }
};

// Confirm a draft payment (updates account balance)
export const confirmPayment = (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const userId = getUserIdFromHeader(req);

    // Check if payment exists and is a draft
    const payment = db.prepare("SELECT * FROM order_payments WHERE id = ?;").get(paymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }
    if (payment.status !== 'draft') {
      return res.status(400).json({ message: "Only draft payments can be confirmed" });
    }

    // Check permissions - get order info (fetch all fields needed for later use)
    const order = db
      .prepare(
        "SELECT id, createdBy, handlerId, customerId, fromCurrency, toCurrency, amountBuy, amountSell, paymentFlow, actualAmountBuy, rate, actualRate, status, orderMode FROM orders WHERE id = ?;",
      )
      .get(payment.orderId);
    if (userId && order) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can confirm payments" 
        });
      }
    } else if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }

    if (isCustomerBalanceFunded(payment)) {
      if (!order?.customerId) {
        return res.status(400).json({
          message: "Order must have a customer to settle payment from customer advance",
        });
      }
      if (!isLedgerSwapOrder(order)) {
        try {
          assertAllocatableOwed(order.customerId, order.toCurrency, payment.amount, paymentId);
        } catch (err) {
          if (err.status) {
            return res.status(err.status).json({ message: err.message });
          }
          throw err;
        }
      }
    } else {
      if (!payment.accountId) {
        return res.status(400).json({ message: "Payment must have an account before confirmation" });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "order.account",
          payment.accountId,
          "You do not have access to confirm this order account",
        )
      ) {
        return;
      }
    }

    db.prepare("UPDATE order_payments SET status = 'confirmed' WHERE id = ?;").run(paymentId);

    if (!isCustomerBalanceFunded(payment) && payment.accountId) {
      const accountForBalance = db
        .prepare("SELECT balance FROM accounts WHERE id = ?;")
        .get(payment.accountId);
      if (accountForBalance) {
        const newBalance = accountForBalance.balance - payment.amount;
        db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, payment.accountId);
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'withdraw', ?, ?, ?);`,
        ).run(
          payment.accountId,
          payment.amount,
          `Order #${payment.orderId} - Payment to customer`,
          new Date().toISOString(),
        );
      }
    }

    // Get updated payment
    const confirmedPayment = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_payments p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.id = ?;`
      )
      .get(paymentId);
    
    const paymentWithUrl = {
      ...confirmedPayment,
      imagePath: confirmedPayment.imagePath.startsWith('data:') ? confirmedPayment.imagePath : getFileUrl(confirmedPayment.imagePath),
    };

    res.json(paymentWithUrl);
    trySyncCompletedOrderLedger(Number(payment.orderId), userId);
    notifyOrderFinancial(
      Number(payment.orderId),
      payment.accountId ? [payment.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error confirming payment:", error);
    next(error);
  }
};

// Update a draft profit (can only update drafts)
export const updateProfit = (req, res, next) => {
  try {
    const { profitId } = req.params;
    const { amount, accountId, currencyCode } = req.body;
    const userId = getUserIdFromHeader(req);

    // Check if profit exists and is a draft
    const existingProfit = db.prepare("SELECT * FROM order_profits WHERE id = ?;").get(profitId);
    if (!existingProfit) {
      return res.status(404).json({ message: "Profit not found" });
    }

    // Check permissions - get order info (fetch all fields needed)
    const order = db.prepare("SELECT id, createdBy, handlerId, fromCurrency, toCurrency FROM orders WHERE id = ?;").get(existingProfit.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    if (userId) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can update profit" 
        });
      }
    } else {
      return res.status(401).json({ message: "User ID is required" });
    }

    if (existingProfit.status !== 'draft') {
      return res.status(400).json({ message: "Only draft profits can be updated" });
    }

    // Validate account if provided
    let accountIdToUse = existingProfit.accountId;
    if (accountId !== undefined && accountId !== null && accountId !== "") {
      const profitAccount = db.prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;").get(Number(accountId));
      if (!profitAccount) {
        return res.status(400).json({ message: "Profit account not found" });
      }
      const currencyToCheck = currencyCode || existingProfit.currencyCode;
      if (profitAccount.currencyCode !== currencyToCheck) {
        return res.status(400).json({ 
          message: `Profit account currency (${profitAccount.currencyCode}) does not match profit currency (${currencyToCheck})` 
        });
      }
      accountIdToUse = Number(accountId);
    }

    const profitAmount = amount !== undefined ? parseFloat(amount) : existingProfit.amount;
    const profitCurrency = currencyCode || existingProfit.currencyCode;

    // Update profit
    db.prepare(
      `UPDATE order_profits 
       SET amount = @amount, accountId = @accountId, currencyCode = @currencyCode
       WHERE id = @id;`
    ).run({
      id: profitId,
      amount: profitAmount,
      accountId: accountIdToUse,
      currencyCode: profitCurrency,
    });

    const updatedProfit = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_profits p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.id = ?;`
      )
      .get(profitId);

    res.json(updatedProfit);
    notifyOrderWrite(Number(existingProfit.orderId));
  } catch (error) {
    console.error("Error updating profit:", error);
    next(error);
  }
};

// Delete a profit entry — drafts always; confirmed only for users with editAnyOrder permission (reverses account balance)
export const deleteProfit = (req, res, next) => {
  try {
    const { profitId } = req.params;
    const userId = getUserIdFromHeader(req);

    const profit = db.prepare("SELECT * FROM order_profits WHERE id = ?;").get(profitId);
    if (!profit) {
      return res.status(404).json({ message: "Profit not found" });
    }

    if (profit.status === 'confirmed') {
      const userPermissions = getUserPermissions(userId);
      if (!canEditAnyOrder(userPermissions)) {
        return res.status(400).json({ message: "Only draft profits can be deleted" });
      }
      // Reverse the balance increase that was applied when this profit was confirmed
      if (profit.accountId && shouldReverseConfirmedEntryOnDelete(profit.orderId)) {
        db.prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?;").run(
          profit.amount,
          profit.accountId,
        );
        db.prepare(
          `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
           VALUES (?, 'subtract', ?, ?, ?);`
        ).run(
          profit.accountId,
          profit.amount,
          `Order #${profit.orderId} - Profit reversal (edit)`,
          new Date().toISOString()
        );
      }
    }

    db.prepare("DELETE FROM order_profits WHERE id = ?;").run(profitId);

    res.json({ success: true, orderId: profit.orderId });
    notifyOrderFinancial(
      Number(profit.orderId),
      profit.accountId ? [profit.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error deleting profit:", error);
    next(error);
  }
};

// Confirm a draft profit (updates account balance and transaction history)
export const confirmProfit = (req, res, next) => {
  try {
    const { profitId } = req.params;

    // Check if profit exists and is a draft
    const profit = db.prepare("SELECT * FROM order_profits WHERE id = ?;").get(profitId);
    if (!profit) {
      return res.status(404).json({ message: "Profit not found" });
    }
    if (profit.status !== 'draft') {
      return res.status(400).json({ message: "Only draft profits can be confirmed" });
    }

    if (!profit.accountId) {
      return res.status(400).json({ message: "Profit must have an account before confirmation" });
    }

    // Update profit status to confirmed
    db.prepare("UPDATE order_profits SET status = 'confirmed' WHERE id = ?;").run(profitId);

    // Update account balance and create transaction
    const accountForBalance = db.prepare("SELECT balance FROM accounts WHERE id = ?;").get(profit.accountId);
    if (!accountForBalance) {
      return res.status(400).json({ message: "Profit account not found" });
    }
    
    const oldBalance = accountForBalance.balance;
    const newBalance = oldBalance + profit.amount;
    
    db.prepare("UPDATE accounts SET balance = ? WHERE id = ?;").run(newBalance, profit.accountId);
    
    // Create account transaction
    const transactionResult = db.prepare(
      `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
       VALUES (?, 'add', ?, ?, ?);`
    ).run(
      profit.accountId,
      profit.amount,
      `Order #${profit.orderId} - Profit`,
      new Date().toISOString()
    );
    
    if (!transactionResult.lastInsertRowid) {
      console.error("Failed to create account transaction for profit:", profitId);
    }

    // Get updated profit
    const confirmedProfit = db
      .prepare(
        `SELECT p.*, a.name as accountName 
         FROM order_profits p
         LEFT JOIN accounts a ON a.id = p.accountId
         WHERE p.id = ?;`
      )
      .get(profitId);

    res.json(confirmedProfit);
    notifyOrderFinancial(
      Number(profit.orderId),
      profit.accountId ? [profit.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error confirming profit:", error);
    next(error);
  }
};

// Update a draft service charge (can only update drafts)
export const updateServiceCharge = (req, res, next) => {
  try {
    const { serviceChargeId } = req.params;
    const { amount, accountId, currencyCode, fundedFrom: fundedFromRaw } = req.body;
    const userId = getUserIdFromHeader(req);

    // Check if service charge exists and is a draft
    const existingServiceCharge = db.prepare("SELECT * FROM order_service_charges WHERE id = ?;").get(serviceChargeId);
    if (!existingServiceCharge) {
      return res.status(404).json({ message: "Service charge not found" });
    }

    // Check permissions - get order info (fetch all fields needed)
    const order = db.prepare("SELECT id, createdBy, handlerId, fromCurrency, toCurrency FROM orders WHERE id = ?;").get(existingServiceCharge.orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    if (userId) {
      const userPermissions = getUserPermissions(userId);
      const isUserAdmin = isAdmin(userPermissions);
      
      if (!isUserAdmin && !canModifyOrder(order, userId)) {
        return res.status(403).json({ 
          message: "Only the order creator, handler, or admin can update service charges" 
        });
      }
    } else {
      return res.status(401).json({ message: "User ID is required" });
    }

    if (existingServiceCharge.status !== 'draft') {
      return res.status(400).json({ message: "Only draft service charges can be updated" });
    }

    const serviceChargeAmount =
      amount !== undefined ? parseFloat(amount) : existingServiceCharge.amount;
    const serviceChargeCurrency = currencyCode || existingServiceCharge.currencyCode;
    const fundedFrom =
      fundedFromRaw !== undefined
        ? normalizeReceiptFundedFrom(fundedFromRaw)
        : normalizeReceiptFundedFrom(existingServiceCharge.fundedFrom);
    const orderForSc = db
      .prepare("SELECT customerId FROM orders WHERE id = ?;")
      .get(existingServiceCharge.orderId);
    const accountIdInput =
      accountId !== undefined
        ? accountId === null || accountId === ""
          ? null
          : Number(accountId)
        : existingServiceCharge.accountId;
    const funding = resolveServiceChargeFunding({
      fundedFrom,
      amount: serviceChargeAmount,
      accountId: accountIdInput,
      customerId: orderForSc?.customerId,
    });
    if (funding.error) {
      return res.status(funding.status || 400).json({ message: funding.error });
    }

    if (funding.accountId) {
      const scAccount = db
        .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;")
        .get(funding.accountId);
      if (!scAccount) {
        return res.status(400).json({ message: "Service charge account not found" });
      }
      if (scAccount.currencyCode !== serviceChargeCurrency) {
        return res.status(400).json({
          message: `Service charge account currency (${scAccount.currencyCode}) does not match service charge currency (${serviceChargeCurrency})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "serviceCharge.account",
          funding.accountId,
          "You do not have access to use this service charge account",
        )
      ) {
        return;
      }
    }

    db.prepare(
      `UPDATE order_service_charges 
       SET amount = @amount, accountId = @accountId, currencyCode = @currencyCode, fundedFrom = @fundedFrom
       WHERE id = @id;`,
    ).run({
      id: serviceChargeId,
      amount: funding.amount,
      accountId: funding.accountId,
      currencyCode: serviceChargeCurrency,
      fundedFrom: funding.fundedFrom,
    });

    const updatedServiceCharge = db
      .prepare(
        `SELECT sc.*, a.name as accountName 
         FROM order_service_charges sc
         LEFT JOIN accounts a ON a.id = sc.accountId
         WHERE sc.id = ?;`
      )
      .get(serviceChargeId);

    res.json(updatedServiceCharge);
    notifyOrderWrite(Number(existingServiceCharge.orderId));
  } catch (error) {
    console.error("Error updating service charge:", error);
    next(error);
  }
};

// Delete a service charge entry — drafts always; confirmed only for users with editAnyOrder permission (reverses account balance)
export const deleteServiceCharge = (req, res, next) => {
  try {
    const { serviceChargeId } = req.params;
    const userId = getUserIdFromHeader(req);

    const serviceCharge = db.prepare("SELECT * FROM order_service_charges WHERE id = ?;").get(serviceChargeId);
    if (!serviceCharge) {
      return res.status(404).json({ message: "Service charge not found" });
    }

    if (serviceCharge.status === 'confirmed') {
      const userPermissions = getUserPermissions(userId);
      if (!canEditAnyOrder(userPermissions)) {
        return res.status(400).json({ message: "Only draft service charges can be deleted" });
      }
      if (shouldReverseConfirmedEntryOnDelete(serviceCharge.orderId)) {
        reverseCashServiceChargeAccountEffects(
          serviceCharge,
          serviceCharge.orderId,
          "edit",
        );
      }
    }

    db.prepare("DELETE FROM order_service_charges WHERE id = ?;").run(serviceChargeId);

    res.json({ success: true, orderId: serviceCharge.orderId });
    trySyncCompletedOrderLedger(Number(serviceCharge.orderId), userId);
    notifyOrderFinancial(
      Number(serviceCharge.orderId),
      serviceCharge.accountId ? [serviceCharge.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error deleting service charge:", error);
    next(error);
  }
};

// Confirm a draft service charge (updates account balance and transaction history)
export const confirmServiceCharge = (req, res, next) => {
  try {
    const { serviceChargeId } = req.params;
    const userId = getUserIdFromHeader(req);

    // Check if service charge exists and is a draft
    const serviceCharge = db.prepare("SELECT * FROM order_service_charges WHERE id = ?;").get(serviceChargeId);
    if (!serviceCharge) {
      return res.status(404).json({ message: "Service charge not found" });
    }
    if (serviceCharge.status !== 'draft') {
      return res.status(400).json({ message: "Only draft service charges can be confirmed" });
    }

    const balanceErr = assertServiceChargeBalanceOnConfirm(serviceCharge);
    if (balanceErr) {
      return res.status(balanceErr.status).json({ message: balanceErr.message });
    }

    if (!isCustomerBalanceFunded(serviceCharge) && !serviceCharge.accountId) {
      return res.status(400).json({ message: "Service charge must have an account before confirmation" });
    }

    if (
      !isCustomerBalanceFunded(serviceCharge) &&
      !requireAccountAccess(
        req,
        res,
        "serviceCharge.account",
        serviceCharge.accountId,
        "You do not have access to confirm this service charge account",
      )
    ) {
      return;
    }

    db.prepare("UPDATE order_service_charges SET status = 'confirmed' WHERE id = ?;").run(serviceChargeId);
    applyCashServiceChargeAccountEffects(serviceCharge, serviceCharge.orderId);

    // Get updated service charge
    const confirmedServiceCharge = db
      .prepare(
        `SELECT sc.*, a.name as accountName 
         FROM order_service_charges sc
         LEFT JOIN accounts a ON a.id = sc.accountId
         WHERE sc.id = ?;`
      )
      .get(serviceChargeId);

    res.json(confirmedServiceCharge);
    const orderForSync = db.prepare("SELECT customerId FROM orders WHERE id = ?;").get(serviceCharge.orderId);
    if (orderForSync?.customerId) {
      scheduleCacheSync({
        scopes: ["customerLedger"],
        customerId: orderForSync.customerId,
      });
    }
    trySyncCompletedOrderLedger(Number(serviceCharge.orderId), userId);
    notifyOrderFinancial(
      Number(serviceCharge.orderId),
      serviceCharge.accountId ? [serviceCharge.accountId] : undefined,
    );
  } catch (error) {
    console.error("Error confirming service charge:", error);
    next(error);
  }
};

// Add a new draft profit entry directly to an order
export const addProfitToOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, currencyCode, accountId } = req.body;
    const userId = getUserIdFromHeader(req);

    if (!userId) return res.status(401).json({ message: "User ID is required" });

    const order = db.prepare("SELECT id, createdBy, handlerId FROM orders WHERE id = ?;").get(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const userPermissions = getUserPermissions(userId);
    if (!isAdmin(userPermissions) && !canModifyOrder(order, userId)) {
      return res.status(403).json({ message: "You do not have permission to add profit to this order" });
    }

    if (!amount || !currencyCode || !accountId) {
      return res.status(400).json({ message: "amount, currencyCode, and accountId are required" });
    }
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const account = db.prepare("SELECT id FROM accounts WHERE id = ?;").get(Number(accountId));
    if (!account) return res.status(400).json({ message: "Account not found" });

    const result = db.prepare(
      `INSERT INTO order_profits (orderId, amount, currencyCode, accountId, status, createdAt)
       VALUES (?, ?, ?, ?, 'draft', ?);`
    ).run(Number(id), parsedAmount, currencyCode, Number(accountId), new Date().toISOString());

    const profit = db.prepare(
      `SELECT p.*, a.name as accountName
       FROM order_profits p
       LEFT JOIN accounts a ON a.id = p.accountId
       WHERE p.id = ?;`
    ).get(result.lastInsertRowid);

    res.json(profit);
    notifyOrderWrite(Number(id));
  } catch (error) {
    next(error);
  }
};

// Add a new draft service charge entry directly to an order
export const addServiceChargeToOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, currencyCode, accountId, fundedFrom: fundedFromRaw } = req.body;
    const userId = getUserIdFromHeader(req);

    if (!userId) return res.status(401).json({ message: "User ID is required" });

    const order = db.prepare("SELECT id, createdBy, handlerId, customerId FROM orders WHERE id = ?;").get(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const userPermissions = getUserPermissions(userId);
    if (!isAdmin(userPermissions) && !canModifyOrder(order, userId)) {
      return res.status(403).json({ message: "You do not have permission to add service charges to this order" });
    }

    if (!amount || !currencyCode) {
      return res.status(400).json({ message: "amount and currencyCode are required" });
    }

    const funding = resolveServiceChargeFunding({
      fundedFrom: fundedFromRaw,
      amount,
      accountId,
      customerId: order.customerId,
    });
    if (funding.error) {
      return res.status(funding.status || 400).json({ message: funding.error });
    }

    if (funding.accountId) {
      const account = db
        .prepare("SELECT id, currencyCode FROM accounts WHERE id = ?;")
        .get(funding.accountId);
      if (!account) return res.status(400).json({ message: "Account not found" });
      if (account.currencyCode !== currencyCode) {
        return res.status(400).json({
          message: `Service charge account currency (${account.currencyCode}) does not match service charge currency (${currencyCode})`,
        });
      }
      if (
        !requireAccountAccess(
          req,
          res,
          "serviceCharge.account",
          funding.accountId,
          "You do not have access to use this service charge account",
        )
      ) {
        return;
      }
    }

    const result = db.prepare(
      `INSERT INTO order_service_charges (orderId, amount, currencyCode, accountId, status, fundedFrom, createdAt)
       VALUES (?, ?, ?, ?, 'draft', ?, ?);`,
    ).run(
      Number(id),
      funding.amount,
      currencyCode,
      funding.accountId,
      funding.fundedFrom,
      new Date().toISOString(),
    );

    const sc = db.prepare(
      `SELECT sc.*, a.name as accountName
       FROM order_service_charges sc
       LEFT JOIN accounts a ON a.id = sc.accountId
       WHERE sc.id = ?;`
    ).get(result.lastInsertRowid);

    res.json(sc);
    notifyOrderWrite(Number(id));
  } catch (error) {
    next(error);
  }
};

export const getDashboardStats = (req, res) => {
  try {
    // Get total orders count
    const totalOrdersResult = db.prepare("SELECT COUNT(*) as total FROM orders;").get();
    const totalOrders = Number(totalOrdersResult?.total || 0);

    const savedOrdersResult = db.prepare(
      "SELECT COUNT(*) as total FROM orders WHERE status = 'saved';"
    ).get();
    const savedOrders = Number(savedOrdersResult?.total || 0);

    // Get completed orders count
    const completedOrdersResult = db.prepare(
      "SELECT COUNT(*) as total FROM orders WHERE status = 'completed';"
    ).get();
    const completedOrders = Number(completedOrdersResult?.total || 0);

    // Get cancelled orders count
    const cancelledOrdersResult = db.prepare(
      "SELECT COUNT(*) as total FROM orders WHERE status = 'cancelled';"
    ).get();
    const cancelledOrders = Number(cancelledOrdersResult?.total || 0);

    const result = {
      totalOrders,
      savedOrders,
      completedOrders,
      cancelledOrders,
    };

    console.log("Dashboard stats result:", result);
    res.json(result);
  } catch (error) {
    console.error("Error getting dashboard stats:", error);
    res.status(500).json({ message: "Error getting dashboard statistics", error: error.message });
  }
};


