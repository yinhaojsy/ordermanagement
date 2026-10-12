import { db } from "../db.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";
import {
  listDividendCalculations,
  getDividendCalculationById,
  replaceDividendConfig,
  runDividendCalculation,
  payDividendPerson,
  deleteDividendCalculation,
} from "../services/dividendCalculation.js";

function normalizeSourceMode(value) {
  return value === "manual" ? "manual" : "auto";
}

function validatePeriod(periodStartDate, periodEndDate, sourceMode) {
  if (sourceMode === "manual") {
    if (periodStartDate && periodEndDate && String(periodStartDate) > String(periodEndDate)) {
      const err = new Error("periodStartDate must be on or before periodEndDate");
      err.status = 400;
      throw err;
    }
    return;
  }
  if (!periodStartDate || !periodEndDate) {
    const err = new Error("periodStartDate and periodEndDate are required");
    err.status = 400;
    throw err;
  }
  if (String(periodStartDate) > String(periodEndDate)) {
    const err = new Error("periodStartDate must be on or before periodEndDate");
    err.status = 400;
    throw err;
  }
}

function validateBusinessesPayload(businesses, sourceMode = "auto") {
  if (!Array.isArray(businesses) || businesses.length === 0) {
    const err = new Error("At least one business is required");
    err.status = 400;
    throw err;
  }
  for (const biz of businesses) {
    if (!String(biz.name || "").trim()) {
      const err = new Error("Each business needs a name");
      err.status = 400;
      throw err;
    }
    const keep = Number(biz.keepPercent);
    if (!Number.isFinite(keep) || keep < 0 || keep > 100) {
      const err = new Error(`Invalid keepPercent for ${biz.name}`);
      err.status = 400;
      throw err;
    }
    if (sourceMode === "manual") {
      for (const key of ["manualOrderProfit", "manualExpenseTotal", "manualIncomeTotal"]) {
        const v = biz[key];
        if (v === null || v === undefined || v === "") continue;
        if (!Number.isFinite(Number(v))) {
          const err = new Error(`Invalid ${key} for ${biz.name}`);
          err.status = 400;
          throw err;
        }
      }
    }
  }

  if (sourceMode === "manual") return;

  // Shared expense tags: percents across businesses should sum ~100
  const tagPercents = new Map();
  for (const biz of businesses) {
    for (const et of biz.expenseTags || []) {
      const tagId = Number(et.tagId);
      const pct = Number(et.allocationPercent);
      if (!Number.isFinite(tagId) || tagId < 0 || !Number.isFinite(pct)) continue;
      tagPercents.set(tagId, (tagPercents.get(tagId) || 0) + pct);
    }
  }
  for (const [tagId, sum] of tagPercents.entries()) {
    if (Math.abs(sum - 100) > 0.05 && Math.abs(sum) > 0.05) {
      const usedBy = businesses.filter((b) =>
        (b.expenseTags || []).some((et) => Number(et.tagId) === tagId),
      ).length;
      if (usedBy > 1 && Math.abs(sum - 100) > 0.05) {
        const err = new Error(
          `Expense tag #${tagId} allocation across businesses sums to ${sum}% (expected 100%)`,
        );
        err.status = 400;
        throw err;
      }
    }
  }
}

export const listDividends = (_req, res, next) => {
  try {
    res.json(listDividendCalculations());
  } catch (e) {
    next(e);
  }
};

export const getDividend = (req, res, next) => {
  try {
    const detail = getDividendCalculationById(Number(req.params.id));
    if (!detail) return res.status(404).json({ message: "Not found" });
    res.json(detail);
  } catch (e) {
    next(e);
  }
};

export const createDividend = (req, res, next) => {
  try {
    const body = req.body || {};
    const {
      name,
      periodStartDate,
      periodEndDate,
      profitCalculationId,
      notes,
      businesses = [],
      persons = [],
    } = body;
    const sourceMode = normalizeSourceMode(body.sourceMode);
    const manualInputCurrencyCode =
      sourceMode === "manual"
        ? body.manualInputCurrencyCode
          ? String(body.manualInputCurrencyCode).trim().toUpperCase()
          : null
        : null;

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Name is required" });
    }
    validatePeriod(periodStartDate, periodEndDate, sourceMode);
    validateBusinessesPayload(businesses, sourceMode);

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO dividend_calculations
           (name, periodStartDate, periodEndDate, profitCalculationId, sourceMode, manualInputCurrencyCode, status, notes, createdBy, createdAt, updatedAt)
         VALUES (@name, @periodStartDate, @periodEndDate, @profitCalculationId, @sourceMode, @manualInputCurrencyCode, 'draft', @notes, @createdBy, @createdAt, @updatedAt)`,
      )
      .run({
        name: String(name).trim(),
        periodStartDate: periodStartDate || "",
        periodEndDate: periodEndDate || "",
        profitCalculationId: profitCalculationId || null,
        sourceMode,
        manualInputCurrencyCode,
        notes: notes || null,
        createdBy: req.user?.id || null,
        createdAt: now,
        updatedAt: now,
      });

    const id = result.lastInsertRowid;
    const businessesPayload =
      sourceMode === "manual"
        ? businesses.map((b) => ({
            ...b,
            orderTagIds: [],
            expenseTags: [],
          }))
        : businesses;
    replaceDividendConfig(id, { businesses: businessesPayload, persons });
    res.status(201).json(getDividendCalculationById(id));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const updateDividend = (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM dividend_calculations WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (existing.status === "paid" || existing.status === "partially_paid") {
      return res.status(400).json({
        message: "Cannot edit a calculation that already has payments",
      });
    }

    const body = req.body || {};
    const name = body.name != null ? String(body.name).trim() : existing.name;
    const sourceMode =
      body.sourceMode !== undefined
        ? normalizeSourceMode(body.sourceMode)
        : normalizeSourceMode(existing.sourceMode);
    const periodStartDate =
      body.periodStartDate !== undefined
        ? body.periodStartDate || ""
        : existing.periodStartDate || "";
    const periodEndDate =
      body.periodEndDate !== undefined ? body.periodEndDate || "" : existing.periodEndDate || "";
    const profitCalculationId =
      body.profitCalculationId !== undefined
        ? body.profitCalculationId || null
        : existing.profitCalculationId;
    const notes = body.notes !== undefined ? body.notes : existing.notes;
    const manualInputCurrencyCode =
      sourceMode === "manual"
        ? body.manualInputCurrencyCode !== undefined
          ? body.manualInputCurrencyCode
            ? String(body.manualInputCurrencyCode).trim().toUpperCase()
            : null
          : existing.manualInputCurrencyCode || null
        : null;

    if (!name) return res.status(400).json({ message: "Name is required" });
    validatePeriod(periodStartDate, periodEndDate, sourceMode);

    if (Array.isArray(body.businesses)) {
      validateBusinessesPayload(body.businesses, sourceMode);
    }

    db.prepare(
      `UPDATE dividend_calculations
       SET name = @name,
           periodStartDate = @periodStartDate,
           periodEndDate = @periodEndDate,
           profitCalculationId = @profitCalculationId,
           sourceMode = @sourceMode,
           manualInputCurrencyCode = @manualInputCurrencyCode,
           notes = @notes,
           updatedAt = @updatedAt
       WHERE id = @id`,
    ).run({
      id,
      name,
      periodStartDate,
      periodEndDate,
      profitCalculationId,
      sourceMode,
      manualInputCurrencyCode,
      notes: notes || null,
      updatedAt: new Date().toISOString(),
    });

    if (Array.isArray(body.businesses) || Array.isArray(body.persons)) {
      const businesses =
        sourceMode === "manual" && Array.isArray(body.businesses)
          ? body.businesses.map((b) => ({
              ...b,
              orderTagIds: [],
              expenseTags: [],
            }))
          : body.businesses || [];
      replaceDividendConfig(id, {
        businesses,
        persons: body.persons || [],
      });
    }

    res.json(getDividendCalculationById(id));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const calculateDividend = (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM dividend_calculations WHERE id = ?").get(id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (existing.status === "paid" || existing.status === "partially_paid") {
      return res.status(400).json({
        message: "Cannot recalculate after payments have been made",
      });
    }

    const { warnings, detail } = runDividendCalculation(id);
    res.json({ warnings, ...detail });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const payDividend = (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { personId, payments } = req.body || {};
    if (!personId) return res.status(400).json({ message: "personId is required" });

    const detail = payDividendPerson({
      calculationId: id,
      personId: Number(personId),
      payments,
      userId: req.user?.id,
    });

    scheduleCacheSync({ scopes: ["accounts", "profitCalculations"] });
    res.json(detail);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const removeDividend = (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ok = deleteDividendCalculation(id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};
