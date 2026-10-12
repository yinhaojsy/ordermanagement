import { getUserIdFromHeader } from "../utils/auth.js";
import { getAccountMonthlyStatistics } from "../services/accountMonthlyStatistics.js";
import { db } from "../db.js";

const PERIOD_START_SETTING_KEY = "accountStatisticsPeriodStartDay";
const PERIOD_END_MODE_SETTING_KEY = "accountStatisticsPeriodEndMode";
const PERIOD_END_DAY_SETTING_KEY = "accountStatisticsPeriodEndDay";

function readSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?;").get(key);
  return row?.value ?? null;
}

function readCycleFromSettings() {
  const startRaw = readSetting(PERIOD_START_SETTING_KEY);
  const endModeRaw = readSetting(PERIOD_END_MODE_SETTING_KEY);
  const endDayRaw = readSetting(PERIOD_END_DAY_SETTING_KEY);

  const periodStartDay = Number(startRaw);
  const periodEndDay = Number(endDayRaw);

  return {
    periodStartDay:
      Number.isInteger(periodStartDay) && periodStartDay >= 1 && periodStartDay <= 28
        ? periodStartDay
        : 1,
    periodEndMode: endModeRaw === "day" ? "day" : "eom",
    periodEndDay:
      Number.isInteger(periodEndDay) && periodEndDay >= 1 && periodEndDay <= 28 ? periodEndDay : 9,
  };
}

function readCycleFromQuery(query) {
  const defaults = readCycleFromSettings();

  let periodStartDay = defaults.periodStartDay;
  if (query.periodStartDay !== undefined && query.periodStartDay !== "") {
    const parsed = Number(query.periodStartDay);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 28) {
      periodStartDay = parsed;
    }
  }

  let periodEndMode = defaults.periodEndMode;
  if (query.periodEndMode === "day" || query.periodEndMode === "eom") {
    periodEndMode = query.periodEndMode;
  }

  let periodEndDay = defaults.periodEndDay;
  if (query.periodEndDay !== undefined && query.periodEndDay !== "") {
    const parsed = Number(query.periodEndDay);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 28) {
      periodEndDay = parsed;
    }
  }

  return { periodStartDay, periodEndMode, periodEndDay };
}

export const getAccountMonthlyStatisticsHandler = (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const cycle = readCycleFromQuery(req.query);

    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      return res.status(400).json({ message: "year and month are required" });
    }

    const userId = getUserIdFromHeader(req);
    const profitCalculationId =
      req.query.profitCalculationId !== undefined && req.query.profitCalculationId !== ""
        ? Number(req.query.profitCalculationId)
        : undefined;

    const data = getAccountMonthlyStatistics({
      userId,
      year,
      month,
      ...cycle,
      profitCalculationId: Number.isInteger(profitCalculationId) ? profitCalculationId : undefined,
    });

    res.json(data);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    next(error);
  }
};
