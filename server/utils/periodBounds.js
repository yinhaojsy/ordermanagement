/**
 * @typedef {"eom" | "day"} PeriodEndMode
 * @typedef {{ periodStartDay?: number, periodEndMode?: PeriodEndMode, periodEndDay?: number }} ReportingCycle
 */

export function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(day, maxDay) {
  const n = Number(day);
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, maxDay, Math.max(1, Math.floor(n)));
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve inclusive reporting period for a selected year/month and cycle config.
 * Default: start day 1 through end of selected month.
 */
export function resolvePeriodBounds(year, month, cycle = {}) {
  const y = Number(year);
  const m = Number(month);
  const periodStartDay = cycle.periodStartDay ?? 1;
  const periodEndMode = cycle.periodEndMode === "day" ? "day" : "eom";
  const periodEndDay = cycle.periodEndDay ?? 1;

  if (!Number.isInteger(y) || y < 1970 || y > 2100) {
    throw Object.assign(new Error("Invalid year"), { status: 400 });
  }
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw Object.assign(new Error("Invalid month"), { status: 400 });
  }

  const startDay = clampDay(periodStartDay, lastDayOfMonth(y, m));
  const periodStart = utcDate(y, m, startDay);

  let endYear = y;
  let endMonth = m;
  let endDay;

  if (periodEndMode === "eom") {
    endDay = lastDayOfMonth(y, m);
  } else {
    const requestedEndDay = clampDay(periodEndDay, 28);
    if (requestedEndDay < startDay) {
      endMonth = m + 1;
      endYear = y;
      if (endMonth > 12) {
        endMonth = 1;
        endYear += 1;
      }
      endDay = clampDay(requestedEndDay, lastDayOfMonth(endYear, endMonth));
    } else {
      endDay = clampDay(requestedEndDay, lastDayOfMonth(y, m));
    }
  }

  const periodEndInclusive = utcDate(endYear, endMonth, endDay);
  if (periodEndInclusive < periodStart) {
    throw Object.assign(new Error("Invalid reporting cycle: end is before start"), { status: 400 });
  }

  const periodEndExclusive = new Date(periodEndInclusive);
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);

  const periodStartDate = toDateString(periodStart);
  const periodEndDate = toDateString(periodEndInclusive);
  const periodEndExclusiveDate = toDateString(periodEndExclusive);

  const dates = [];
  const cursor = new Date(periodStart);
  while (cursor < periodEndExclusive) {
    dates.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    year: y,
    month: m,
    periodStartDay: startDay,
    periodEndMode,
    periodEndDay: periodEndMode === "day" ? clampDay(periodEndDay, 28) : null,
    periodStartDate,
    periodEndDate,
    periodEndExclusiveDate,
    periodStartIso: `${periodStartDate}T00:00:00.000Z`,
    periodEndExclusiveIso: `${periodEndExclusiveDate}T00:00:00.000Z`,
    dates,
  };
}
