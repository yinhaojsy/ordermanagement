import { db } from "../db.js";
import { getProfitConversion } from "./profitConversion.js";

export const DIVIDEND_PAYMENT_TOLERANCE = 2;
/** Sentinel tagId meaning "no tags assigned" (orders / expenses). */
export const DIVIDEND_UNTAGGED_TAG_ID = 0;

const UNTAGGED_TAG_META = {
  id: DIVIDEND_UNTAGGED_TAG_ID,
  name: "Untagged",
  color: "#94a3b8",
};

function getServiceChargeEntriesForOrder(orderId) {
  const confirmedScRows = db
    .prepare(
      `SELECT SUM(amount) AS total, currencyCode
       FROM order_service_charges
       WHERE orderId = ? AND status = 'confirmed'
       GROUP BY currencyCode;`,
    )
    .all(orderId);

  const scRows =
    confirmedScRows.length > 0
      ? confirmedScRows
      : db
          .prepare(
            `SELECT SUM(amount) AS total, currencyCode
             FROM order_service_charges
             WHERE orderId = ? AND status = 'draft'
             GROUP BY currencyCode;`,
          )
          .all(orderId);

  return scRows.map((r) => ({ amount: Number(r.total), currency: r.currencyCode }));
}

function computeOrderCalculatedProfit(order, convertToTarget) {
  const received = convertToTarget(Number(order.amountBuy), order.fromCurrency);
  const paid = convertToTarget(Number(order.amountSell), order.toCurrency);
  if (received === null || paid === null) return null;

  let scTotal = 0;
  for (const sc of getServiceChargeEntriesForOrder(order.id)) {
    const cv = convertToTarget(sc.amount, sc.currency);
    if (cv === null) return null;
    scTotal += cv;
  }
  const result = received - paid + scTotal;
  return Number.isFinite(result) ? result : null;
}

/**
 * Load a dividend calculation with nested businesses, tags, persons, shares, payments.
 */
export function getDividendCalculationById(id) {
  const calc = db.prepare("SELECT * FROM dividend_calculations WHERE id = ?").get(id);
  if (!calc) return null;

  const businesses = db
    .prepare(
      `SELECT * FROM dividend_businesses
       WHERE calculationId = ?
       ORDER BY sortOrder ASC, id ASC`,
    )
    .all(id);

  const businessIds = businesses.map((b) => b.id);
  const orderTagsByBusiness = new Map();
  const expenseTagsByBusiness = new Map();

  if (businessIds.length > 0) {
    const placeholders = businessIds.map(() => "?").join(", ");
    const orderTagRows = db
      .prepare(
        `SELECT bot.businessId, bot.tagId
         FROM dividend_business_order_tags bot
         WHERE bot.businessId IN (${placeholders})
         ORDER BY bot.tagId ASC`,
      )
      .all(...businessIds);

    const realOrderTagIds = [
      ...new Set(orderTagRows.map((r) => r.tagId).filter((id) => id > 0)),
    ];
    const tagMetaById = new Map();
    if (realOrderTagIds.length > 0) {
      const tagPlaceholders = realOrderTagIds.map(() => "?").join(", ");
      const tags = db
        .prepare(`SELECT id, name, color FROM tags WHERE id IN (${tagPlaceholders})`)
        .all(...realOrderTagIds);
      for (const t of tags) tagMetaById.set(t.id, t);
    }

    for (const row of orderTagRows) {
      if (!orderTagsByBusiness.has(row.businessId)) orderTagsByBusiness.set(row.businessId, []);
      if (row.tagId === DIVIDEND_UNTAGGED_TAG_ID) {
        orderTagsByBusiness.get(row.businessId).push({ ...UNTAGGED_TAG_META });
      } else {
        const t = tagMetaById.get(row.tagId);
        if (t) {
          orderTagsByBusiness.get(row.businessId).push({
            id: t.id,
            name: t.name,
            color: t.color,
          });
        }
      }
    }

    const expenseTagRows = db
      .prepare(
        `SELECT bet.id AS assignmentId, bet.businessId, bet.allocationPercent, bet.tagId
         FROM dividend_business_expense_tags bet
         WHERE bet.businessId IN (${placeholders})
         ORDER BY bet.tagId ASC`,
      )
      .all(...businessIds);

    const realExpenseTagIds = [
      ...new Set(expenseTagRows.map((r) => r.tagId).filter((id) => id > 0)),
    ];
    if (realExpenseTagIds.length > 0) {
      const tagPlaceholders = realExpenseTagIds.map(() => "?").join(", ");
      const tags = db
        .prepare(`SELECT id, name, color FROM tags WHERE id IN (${tagPlaceholders})`)
        .all(...realExpenseTagIds);
      for (const t of tags) tagMetaById.set(t.id, t);
    }

    for (const row of expenseTagRows) {
      if (!expenseTagsByBusiness.has(row.businessId)) expenseTagsByBusiness.set(row.businessId, []);
      if (row.tagId === DIVIDEND_UNTAGGED_TAG_ID) {
        expenseTagsByBusiness.get(row.businessId).push({
          assignmentId: row.assignmentId,
          tagId: DIVIDEND_UNTAGGED_TAG_ID,
          id: DIVIDEND_UNTAGGED_TAG_ID,
          name: UNTAGGED_TAG_META.name,
          color: UNTAGGED_TAG_META.color,
          allocationPercent: Number(row.allocationPercent),
        });
      } else {
        const t = tagMetaById.get(row.tagId);
        if (t) {
          expenseTagsByBusiness.get(row.businessId).push({
            assignmentId: row.assignmentId,
            tagId: t.id,
            id: t.id,
            name: t.name,
            color: t.color,
            allocationPercent: Number(row.allocationPercent),
          });
        }
      }
    }
  }

  const persons = db
    .prepare(
      `SELECT * FROM dividend_persons WHERE calculationId = ? ORDER BY id ASC`,
    )
    .all(id);

  const shares = businessIds.length
    ? db
        .prepare(
          `SELECT s.*, p.name AS personName
           FROM dividend_business_shares s
           INNER JOIN dividend_persons p ON p.id = s.personId
           WHERE s.businessId IN (${businessIds.map(() => "?").join(", ")})
           ORDER BY s.id ASC`,
        )
        .all(...businessIds)
    : [];

  const sharesByBusiness = new Map();
  for (const s of shares) {
    if (!sharesByBusiness.has(s.businessId)) sharesByBusiness.set(s.businessId, []);
    sharesByBusiness.get(s.businessId).push({
      id: s.id,
      personId: s.personId,
      personName: s.personName,
      sharePercent: Number(s.sharePercent),
      amount: s.amount != null ? Number(s.amount) : null,
    });
  }

  const personTotals = db
    .prepare(
      `SELECT pt.*, p.name AS personName
       FROM dividend_person_totals pt
       INNER JOIN dividend_persons p ON p.id = pt.personId
       WHERE pt.calculationId = ?
       ORDER BY p.name ASC`,
    )
    .all(id)
    .map((r) => ({
      id: r.id,
      personId: r.personId,
      personName: r.personName,
      amount: Number(r.amount),
    }));

  const payments = db
    .prepare(
      `SELECT pay.*, p.name AS personName, a.name AS accountName, a.currencyCode AS accountCurrencyCode
       FROM dividend_payments pay
       INNER JOIN dividend_persons p ON p.id = pay.personId
       LEFT JOIN accounts a ON a.id = pay.accountId
       WHERE pay.calculationId = ?
       ORDER BY pay.createdAt ASC, pay.id ASC`,
    )
    .all(id)
    .map((r) => ({
      id: r.id,
      personId: r.personId,
      personName: r.personName,
      accountId: r.accountId,
      accountName: r.accountName,
      amount: Number(r.amount),
      currencyCode: r.currencyCode,
      description: r.description,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));

  const paidByPerson = new Map();
  for (const pay of payments) {
    paidByPerson.set(pay.personId, (paidByPerson.get(pay.personId) || 0) + pay.amount);
  }

  return {
    ...calc,
    businesses: businesses.map((b) => ({
      ...b,
      keepPercent: Number(b.keepPercent),
      orderProfit: b.orderProfit != null ? Number(b.orderProfit) : null,
      expenseTotal: b.expenseTotal != null ? Number(b.expenseTotal) : null,
      incomeTotal: b.incomeTotal != null ? Number(b.incomeTotal) : null,
      netProfit: b.netProfit != null ? Number(b.netProfit) : null,
      poolAmount: b.poolAmount != null ? Number(b.poolAmount) : null,
      orderTags: orderTagsByBusiness.get(b.id) || [],
      expenseTags: expenseTagsByBusiness.get(b.id) || [],
      shares: sharesByBusiness.get(b.id) || [],
    })),
    persons: persons.map((p) => ({
      ...p,
      totalAmount: personTotals.find((t) => t.personId === p.id)?.amount ?? null,
      paidAmount: paidByPerson.get(p.id) || 0,
    })),
    personTotals: personTotals.map((t) => ({
      ...t,
      paidAmount: paidByPerson.get(t.personId) || 0,
      remainingAmount: t.amount - (paidByPerson.get(t.personId) || 0),
    })),
    payments,
  };
}

export function listDividendCalculations() {
  return db
    .prepare(
      `SELECT id, name, periodStartDate, periodEndDate, status, targetCurrencyCode, sourceMode,
              manualInputCurrencyCode, profitCalculationId, createdBy, createdAt, updatedAt, calculatedAt
       FROM dividend_calculations
       ORDER BY createdAt DESC, id DESC`,
    )
    .all();
}

/**
 * Replace nested config for a calculation (businesses, tags, persons, shares).
 * Clears calculation snapshots and payments when structure is rewritten.
 */
export function replaceDividendConfig(calculationId, payload) {
  const {
    businesses = [],
    persons = [],
  } = payload;

  db.prepare("DELETE FROM dividend_payments WHERE calculationId = ?").run(calculationId);
  db.prepare("DELETE FROM dividend_person_totals WHERE calculationId = ?").run(calculationId);
  db.prepare("DELETE FROM dividend_persons WHERE calculationId = ?").run(calculationId);
  db.prepare("DELETE FROM dividend_businesses WHERE calculationId = ?").run(calculationId);

  const insertBusiness = db.prepare(
    `INSERT INTO dividend_businesses
       (calculationId, name, sortOrder, keepPercent, remainderBusinessId, orderProfit, expenseTotal, incomeTotal)
     VALUES
       (@calculationId, @name, @sortOrder, @keepPercent, NULL, @orderProfit, @expenseTotal, @incomeTotal)`,
  );
  const insertOrderTag = db.prepare(
    `INSERT INTO dividend_business_order_tags (businessId, tagId) VALUES (?, ?)`,
  );
  const insertExpenseTag = db.prepare(
    `INSERT INTO dividend_business_expense_tags (businessId, tagId, allocationPercent)
     VALUES (?, ?, ?)`,
  );
  const insertPerson = db.prepare(
    `INSERT INTO dividend_persons (calculationId, name) VALUES (?, ?)`,
  );
  const insertShare = db.prepare(
    `INSERT INTO dividend_business_shares (businessId, personId, sharePercent)
     VALUES (?, ?, ?)`,
  );
  const updateRemainder = db.prepare(
    `UPDATE dividend_businesses SET remainderBusinessId = ? WHERE id = ?`,
  );

  const businessIdByTempKey = new Map();
  const personIdByTempKey = new Map();

  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const parseManual = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const result = insertBusiness.run({
      calculationId,
      name: String(biz.name || "").trim(),
      sortOrder: Number.isFinite(Number(biz.sortOrder)) ? Number(biz.sortOrder) : index,
      keepPercent: Number.isFinite(Number(biz.keepPercent)) ? Number(biz.keepPercent) : 100,
      orderProfit: parseManual(biz.manualOrderProfit ?? biz.orderProfit),
      expenseTotal: parseManual(biz.manualExpenseTotal ?? biz.expenseTotal),
      incomeTotal: parseManual(biz.manualIncomeTotal ?? biz.incomeTotal),
    });
    businessIdByTempKey.set(tempKey, result.lastInsertRowid);
    if (biz.id != null) businessIdByTempKey.set(`id:${biz.id}`, result.lastInsertRowid);

    const businessId = result.lastInsertRowid;
    const orderTagIds = Array.isArray(biz.orderTagIds) ? biz.orderTagIds : [];
    for (const tagId of orderTagIds) {
      insertOrderTag.run(businessId, Number(tagId));
    }
    const expenseTags = Array.isArray(biz.expenseTags) ? biz.expenseTags : [];
    for (const et of expenseTags) {
      insertExpenseTag.run(
        businessId,
        Number(et.tagId),
        Number.isFinite(Number(et.allocationPercent)) ? Number(et.allocationPercent) : 100,
      );
    }
  });

  // Resolve remainderBusinessId using tempKey or id references
  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const businessId = businessIdByTempKey.get(tempKey);
    if (!businessId) return;
    let remainderId = null;
    if (biz.remainderBusinessTempKey) {
      remainderId = businessIdByTempKey.get(biz.remainderBusinessTempKey) ?? null;
    } else if (biz.remainderBusinessId != null) {
      remainderId =
        businessIdByTempKey.get(`id:${biz.remainderBusinessId}`) ??
        (businessIdByTempKey.has(biz.remainderBusinessId)
          ? businessIdByTempKey.get(biz.remainderBusinessId)
          : null);
    }
    if (remainderId && remainderId !== businessId) {
      updateRemainder.run(remainderId, businessId);
    }
  });

  persons.forEach((person, index) => {
    const tempKey = person.tempKey ?? `p${index}`;
    const name = String(person.name || "").trim();
    if (!name) return;
    const result = insertPerson.run(calculationId, name);
    personIdByTempKey.set(tempKey, result.lastInsertRowid);
    if (person.id != null) personIdByTempKey.set(`id:${person.id}`, result.lastInsertRowid);
  });

  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const businessId = businessIdByTempKey.get(tempKey);
    if (!businessId) return;
    const shares = Array.isArray(biz.shares) ? biz.shares : [];
    for (const share of shares) {
      const personId =
        (share.personTempKey && personIdByTempKey.get(share.personTempKey)) ||
        (share.personId != null && personIdByTempKey.get(`id:${share.personId}`)) ||
        (share.personId != null ? personIdByTempKey.get(share.personId) : null);
      if (!personId) continue;
      insertShare.run(
        businessId,
        personId,
        Number.isFinite(Number(share.sharePercent)) ? Number(share.sharePercent) : 0,
      );
    }
  });

  db.prepare(
    `UPDATE dividend_calculations
     SET status = 'draft', calculatedAt = NULL, updatedAt = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), calculationId);
}

/**
 * Compute and persist net profit, pools, and person allocations.
 */
export function runDividendCalculation(calculationId) {
  const calc = db.prepare("SELECT * FROM dividend_calculations WHERE id = ?").get(calculationId);
  if (!calc) {
    throw Object.assign(new Error("Dividend calculation not found"), { status: 404 });
  }

  const sourceMode = calc.sourceMode === "manual" ? "manual" : "auto";

  const { targetCurrency, convertToTarget, profitCalculationId } = getProfitConversion(
    calc.profitCalculationId,
  );
  if (!targetCurrency || !convertToTarget) {
    throw Object.assign(
      new Error("Profit calculation with exchange rates is required"),
      { status: 400 },
    );
  }

  const warnings = [];
  const periodStart = calc.periodStartDate;
  const periodEnd = calc.periodEndDate;

  const businesses = db
    .prepare(
      `SELECT * FROM dividend_businesses
       WHERE calculationId = ?
       ORDER BY sortOrder ASC, id ASC`,
    )
    .all(calculationId);

  if (businesses.length === 0) {
    throw Object.assign(new Error("Add at least one business"), { status: 400 });
  }

  const netByBusiness = new Map();

  if (sourceMode === "manual") {
    // Draft / after config edit: amounts are in manualInputCurrency.
    // After a prior calculate (recalculate without re-edit): amounts are already in target.
    const inputCurrency = calc.manualInputCurrencyCode || targetCurrency;
    const amountsAlreadyInTarget = Boolean(calc.calculatedAt);
    const needsFx =
      !amountsAlreadyInTarget &&
      inputCurrency &&
      inputCurrency !== targetCurrency;

    for (const biz of businesses) {
      const rawOrder = Number(biz.orderProfit) || 0;
      const rawExpense = Number(biz.expenseTotal) || 0;
      const rawIncome = Number(biz.incomeTotal) || 0;
      if (biz.orderProfit == null && biz.expenseTotal == null && biz.incomeTotal == null) {
        warnings.push(
          `${biz.name}: no manual amounts entered (order profit / expenses / income default to 0)`,
        );
      }

      let orderProfit = rawOrder;
      let expenseTotal = rawExpense;
      let incomeTotal = rawIncome;

      if (needsFx) {
        const cOrder = convertToTarget(rawOrder, inputCurrency);
        const cExpense = convertToTarget(rawExpense, inputCurrency);
        const cIncome = convertToTarget(rawIncome, inputCurrency);
        if (cOrder === null || cExpense === null || cIncome === null) {
          throw Object.assign(
            new Error(
              `No FX rate to convert ${inputCurrency} → ${targetCurrency} in the profit calculation`,
            ),
            { status: 400 },
          );
        }
        orderProfit = cOrder;
        expenseTotal = cExpense;
        incomeTotal = cIncome;
      }

      netByBusiness.set(biz.id, {
        orderProfit,
        expenseTotal,
        incomeTotal,
        netProfit: orderProfit - expenseTotal + incomeTotal,
      });
    }
  } else {
    if (!periodStart || !periodEnd) {
      throw Object.assign(new Error("periodStartDate and periodEndDate are required"), {
        status: 400,
      });
    }

    for (const biz of businesses) {
      const orderTagIds = db
        .prepare("SELECT tagId FROM dividend_business_order_tags WHERE businessId = ?")
        .all(biz.id)
        .map((r) => Number(r.tagId));

      const realOrderTagIds = orderTagIds.filter((id) => id > 0);
      const includeUntaggedOrders = orderTagIds.includes(DIVIDEND_UNTAGGED_TAG_ID);

      let orderProfit = 0;
      const orderById = new Map();

      if (realOrderTagIds.length > 0) {
        const placeholders = realOrderTagIds.map(() => "?").join(", ");
        const orders = db
          .prepare(
            `SELECT DISTINCT o.id, o.amountBuy, o.amountSell, o.fromCurrency, o.toCurrency
             FROM orders o
             INNER JOIN order_tag_assignments ota ON ota.orderId = o.id
             WHERE o.status = 'completed'
               AND ota.tagId IN (${placeholders})
               AND DATE(COALESCE(o.orderDate, o.createdAt)) BETWEEN ? AND ?`,
          )
          .all(...realOrderTagIds, periodStart, periodEnd);
        for (const order of orders) orderById.set(order.id, order);
      }

      if (includeUntaggedOrders) {
        const untaggedOrders = db
          .prepare(
            `SELECT o.id, o.amountBuy, o.amountSell, o.fromCurrency, o.toCurrency
             FROM orders o
             WHERE o.status = 'completed'
               AND DATE(COALESCE(o.orderDate, o.createdAt)) BETWEEN ? AND ?
               AND NOT EXISTS (
                 SELECT 1 FROM order_tag_assignments ota WHERE ota.orderId = o.id
               )`,
          )
          .all(periodStart, periodEnd);
        for (const order of untaggedOrders) orderById.set(order.id, order);
      }

      for (const order of orderById.values()) {
        const cp = computeOrderCalculatedProfit(order, convertToTarget);
        if (cp === null) {
          warnings.push(`Order #${order.id}: missing FX rate for calculated profit`);
          continue;
        }
        orderProfit += cp;
      }

      const expenseTagRows = db
        .prepare(
          `SELECT tagId, allocationPercent FROM dividend_business_expense_tags WHERE businessId = ?`,
        )
        .all(biz.id);

      let expenseTotal = 0;
      let incomeTotal = 0;

      for (const et of expenseTagRows) {
        const tagId = Number(et.tagId);
        const pct = Number(et.allocationPercent) / 100;
        if (!Number.isFinite(pct) || pct === 0) continue;

        let expenses;
        if (tagId === DIVIDEND_UNTAGGED_TAG_ID) {
          expenses = db
            .prepare(
              `SELECT e.id, e.amount, e.currencyCode, e.type
               FROM expenses e
               WHERE e.deletedAt IS NULL
                 AND DATE(COALESCE(e.entryDate, e.createdAt)) BETWEEN ? AND ?
                 AND NOT EXISTS (
                   SELECT 1 FROM expense_tag_assignments eta WHERE eta.expenseId = e.id
                 )`,
            )
            .all(periodStart, periodEnd);
        } else {
          expenses = db
            .prepare(
              `SELECT e.id, e.amount, e.currencyCode, e.type
               FROM expenses e
               INNER JOIN expense_tag_assignments eta ON eta.expenseId = e.id
               WHERE e.deletedAt IS NULL
                 AND eta.tagId = ?
                 AND DATE(COALESCE(e.entryDate, e.createdAt)) BETWEEN ? AND ?`,
            )
            .all(tagId, periodStart, periodEnd);
        }

        for (const exp of expenses) {
          const converted = convertToTarget(Number(exp.amount), exp.currencyCode);
          if (converted === null) {
            warnings.push(`Expense #${exp.id}: missing FX rate`);
            continue;
          }
          const allocated = converted * pct;
          if (exp.type === "income") incomeTotal += allocated;
          else expenseTotal += allocated;
        }
      }

      netByBusiness.set(biz.id, {
        orderProfit,
        expenseTotal,
        incomeTotal,
        netProfit: orderProfit - expenseTotal + incomeTotal,
      });
    }
  }

  // Pool: keepPercent stays; remainder goes to remainderBusinessId (or stays if unset)
  const poolByBusiness = new Map(businesses.map((b) => [b.id, 0]));
  for (const biz of businesses) {
    const net = netByBusiness.get(biz.id)?.netProfit ?? 0;
    const keepPct = Number(biz.keepPercent);
    const keep = Number.isFinite(keepPct) ? Math.min(100, Math.max(0, keepPct)) / 100 : 1;
    const keepAmount = net * keep;
    const remainderAmount = net - keepAmount;
    poolByBusiness.set(biz.id, (poolByBusiness.get(biz.id) || 0) + keepAmount);
    if (remainderAmount !== 0) {
      const targetId =
        biz.remainderBusinessId && poolByBusiness.has(biz.remainderBusinessId)
          ? biz.remainderBusinessId
          : biz.id;
      poolByBusiness.set(targetId, (poolByBusiness.get(targetId) || 0) + remainderAmount);
    }
  }

  const updateBiz = db.prepare(
    `UPDATE dividend_businesses
     SET orderProfit = @orderProfit,
         expenseTotal = @expenseTotal,
         incomeTotal = @incomeTotal,
         netProfit = @netProfit,
         poolAmount = @poolAmount
     WHERE id = @id`,
  );

  for (const biz of businesses) {
    const nets = netByBusiness.get(biz.id);
    updateBiz.run({
      id: biz.id,
      orderProfit: nets.orderProfit,
      expenseTotal: nets.expenseTotal,
      incomeTotal: nets.incomeTotal,
      netProfit: nets.netProfit,
      poolAmount: poolByBusiness.get(biz.id) || 0,
    });
  }

  // Clear previous allocations & payments on recalculate
  db.prepare("DELETE FROM dividend_payments WHERE calculationId = ?").run(calculationId);
  db.prepare("DELETE FROM dividend_person_totals WHERE calculationId = ?").run(calculationId);
  db.prepare(
    `UPDATE dividend_business_shares SET amount = NULL
     WHERE businessId IN (SELECT id FROM dividend_businesses WHERE calculationId = ?)`,
  ).run(calculationId);

  const personAmount = new Map();
  const updateShare = db.prepare(
    `UPDATE dividend_business_shares SET amount = ? WHERE id = ?`,
  );

  for (const biz of businesses) {
    const pool = poolByBusiness.get(biz.id) || 0;
    const shares = db
      .prepare("SELECT id, personId, sharePercent FROM dividend_business_shares WHERE businessId = ?")
      .all(biz.id);
    const shareSum = shares.reduce((s, r) => s + Number(r.sharePercent), 0);
    if (shares.length > 0 && Math.abs(shareSum - 100) > 0.05) {
      warnings.push(
        `${biz.name}: stakeholder shares sum to ${shareSum.toFixed(3)}% (expected ~100%)`,
      );
    }
    for (const share of shares) {
      const amount = (pool * Number(share.sharePercent)) / 100;
      updateShare.run(amount, share.id);
      personAmount.set(
        share.personId,
        (personAmount.get(share.personId) || 0) + amount,
      );
    }
  }

  const insertTotal = db.prepare(
    `INSERT INTO dividend_person_totals (calculationId, personId, amount)
     VALUES (?, ?, ?)`,
  );
  for (const [personId, amount] of personAmount.entries()) {
    insertTotal.run(calculationId, personId, amount);
  }

  // Also create zero totals for persons with no shares
  const allPersons = db
    .prepare("SELECT id FROM dividend_persons WHERE calculationId = ?")
    .all(calculationId);
  for (const p of allPersons) {
    if (!personAmount.has(p.id)) {
      insertTotal.run(calculationId, p.id, 0);
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE dividend_calculations
     SET status = 'calculated',
         targetCurrencyCode = ?,
         profitCalculationId = COALESCE(profitCalculationId, ?),
         calculatedAt = ?,
         updatedAt = ?
     WHERE id = ?`,
  ).run(targetCurrency, profitCalculationId, now, now, calculationId);

  return { warnings, detail: getDividendCalculationById(calculationId) };
}

/**
 * Record multi-account payments for one person. Sum must match remaining within tolerance.
 */
export function payDividendPerson({ calculationId, personId, payments, userId }) {
  const calc = getDividendCalculationById(calculationId);
  if (!calc) {
    throw Object.assign(new Error("Dividend calculation not found"), { status: 404 });
  }
  if (calc.status === "draft") {
    throw Object.assign(new Error("Calculate dividends before paying"), { status: 400 });
  }

  const totalRow = calc.personTotals.find((t) => t.personId === personId);
  if (!totalRow) {
    throw Object.assign(new Error("Person has no dividend allocation"), { status: 400 });
  }

  const remaining = totalRow.remainingAmount;
  if (remaining <= DIVIDEND_PAYMENT_TOLERANCE && remaining >= -DIVIDEND_PAYMENT_TOLERANCE) {
    throw Object.assign(new Error("This person is already fully paid"), { status: 400 });
  }

  if (!Array.isArray(payments) || payments.length === 0) {
    throw Object.assign(new Error("At least one payment line is required"), { status: 400 });
  }

  const targetCurrency = calc.targetCurrencyCode;
  const { convertToTarget } = getProfitConversion(calc.profitCalculationId);
  if (!convertToTarget) {
    throw Object.assign(new Error("Profit calculation FX rates are required to pay"), {
      status: 400,
    });
  }

  let paySumInTarget = 0;
  const normalized = [];

  for (const line of payments) {
    const accountId = Number(line.accountId);
    const amount = Number(line.amount);
    if (!accountId || !Number.isFinite(amount) || amount <= 0) {
      throw Object.assign(new Error("Each payment needs a valid account and positive amount"), {
        status: 400,
      });
    }
    const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
    if (!account) {
      throw Object.assign(new Error(`Account #${accountId} not found`), { status: 404 });
    }
    const inTarget = convertToTarget(amount, account.currencyCode);
    if (inTarget === null) {
      throw Object.assign(
        new Error(
          `No FX rate to convert ${account.currencyCode} → ${targetCurrency} in the profit calculation`,
        ),
        { status: 400 },
      );
    }
    paySumInTarget += inTarget;
    normalized.push({ account, amount, amountInTarget: inTarget });
  }

  if (Math.abs(paySumInTarget - remaining) > DIVIDEND_PAYMENT_TOLERANCE) {
    throw Object.assign(
      new Error(
        `Payment total ${paySumInTarget.toFixed(2)} ${targetCurrency} must match remaining dividend ${remaining.toFixed(2)} ${targetCurrency} (±${DIVIDEND_PAYMENT_TOLERANCE})`,
      ),
      { status: 400 },
    );
  }

  const person = db.prepare("SELECT * FROM dividend_persons WHERE id = ?").get(personId);
  const now = new Date().toISOString();
  const insertPay = db.prepare(
    `INSERT INTO dividend_payments
       (calculationId, personId, accountId, amount, currencyCode, description, createdBy, createdAt)
     VALUES (@calculationId, @personId, @accountId, @amount, @currencyCode, @description, @createdBy, @createdAt)`,
  );
  const updateBalance = db.prepare("UPDATE accounts SET balance = @balance WHERE id = @id");
  const insertTx = db.prepare(
    `INSERT INTO account_transactions (accountId, type, amount, description, createdAt)
     VALUES (@accountId, 'withdraw', @amount, @description, @createdAt)`,
  );

  const run = db.transaction(() => {
    for (const { account, amount } of normalized) {
      const description = `Dividend #${calculationId} — ${person?.name || personId}`;
      const fresh = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(account.id);
      updateBalance.run({
        id: account.id,
        balance: Number(fresh?.balance ?? account.balance) - amount,
      });
      insertTx.run({
        accountId: account.id,
        amount,
        description,
        createdAt: now,
      });
      insertPay.run({
        calculationId,
        personId,
        accountId: account.id,
        amount,
        currencyCode: account.currencyCode,
        description,
        createdBy: userId || null,
        createdAt: now,
      });
    }

    const refreshed = getDividendCalculationById(calculationId);
    const allPaid = refreshed.personTotals.every(
      (t) => Math.abs(t.remainingAmount) <= DIVIDEND_PAYMENT_TOLERANCE,
    );
    const anyPaid = refreshed.payments.length > 0;
    const status = allPaid ? "paid" : anyPaid ? "partially_paid" : refreshed.status;
    db.prepare(
      `UPDATE dividend_calculations SET status = ?, updatedAt = ? WHERE id = ?`,
    ).run(status, now, calculationId);
  });

  run();
  return getDividendCalculationById(calculationId);
}

export function deleteDividendCalculation(id) {
  const calc = db.prepare("SELECT * FROM dividend_calculations WHERE id = ?").get(id);
  if (!calc) return false;
  if (calc.status === "paid" || calc.status === "partially_paid") {
    throw Object.assign(
      new Error("Cannot delete a calculation that has payments. Reverse payments first."),
      { status: 400 },
    );
  }
  db.prepare("DELETE FROM dividend_calculations WHERE id = ?").run(id);
  return true;
}
