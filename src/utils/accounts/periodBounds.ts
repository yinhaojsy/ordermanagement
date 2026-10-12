export type PeriodEndMode = "eom" | "day";

export interface ReportingCycle {
  startDay: number;
  endMode: PeriodEndMode;
  endDay: number;
}

export const DEFAULT_REPORTING_CYCLE: ReportingCycle = {
  startDay: 1,
  endMode: "eom",
  endDay: 9,
};

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(day: number, maxDay: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(28, maxDay, Math.max(1, Math.floor(day)));
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface PeriodBounds extends ReportingCycle {
  year: number;
  month: number;
  periodStartDate: string;
  periodEndDate: string;
  periodEndExclusiveDate: string;
  periodStartIso: string;
  periodEndExclusiveIso: string;
  dates: string[];
}

export function resolvePeriodBounds(
  year: number,
  month: number,
  cycle: Partial<ReportingCycle> = {},
): PeriodBounds {
  const y = Number(year);
  const m = Number(month);
  const startDayInput = cycle.startDay ?? DEFAULT_REPORTING_CYCLE.startDay;
  const endMode = cycle.endMode === "day" ? "day" : "eom";
  const endDayInput = cycle.endDay ?? DEFAULT_REPORTING_CYCLE.endDay;

  const startDay = clampDay(startDayInput, lastDayOfMonth(y, m));
  const periodStart = utcDate(y, m, startDay);

  let endYear = y;
  let endMonth = m;
  let endDay: number;

  if (endMode === "eom") {
    endDay = lastDayOfMonth(y, m);
  } else {
    const requestedEndDay = clampDay(endDayInput, 28);
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
  const periodEndExclusive = new Date(periodEndInclusive);
  periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);

  const periodStartDate = toDateString(periodStart);
  const periodEndDate = toDateString(periodEndInclusive);
  const periodEndExclusiveDate = toDateString(periodEndExclusive);

  const dates: string[] = [];
  const cursor = new Date(periodStart);
  while (cursor < periodEndExclusive) {
    dates.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    year: y,
    month: m,
    startDay,
    endMode,
    endDay: endMode === "day" ? clampDay(endDayInput, 28) : endDayInput,
    periodStartDate,
    periodEndDate,
    periodEndExclusiveDate,
    periodStartIso: `${periodStartDate}T00:00:00.000Z`,
    periodEndExclusiveIso: `${periodEndExclusiveDate}T00:00:00.000Z`,
    dates,
  };
}

export function reportingCycleStorageKey(userId: number | string | undefined): string {
  return `reportingCycle_${userId ?? "anonymous"}`;
}

export function loadReportingCycleFromStorage(userId: number | string | undefined): ReportingCycle {
  try {
    const raw = localStorage.getItem(reportingCycleStorageKey(userId));
    if (!raw) return DEFAULT_REPORTING_CYCLE;
    const parsed = JSON.parse(raw) as Partial<ReportingCycle>;
    return {
      startDay: clampDay(Number(parsed.startDay) || 1, 28),
      endMode: parsed.endMode === "day" ? "day" : "eom",
      endDay: clampDay(Number(parsed.endDay) || 9, 28),
    };
  } catch {
    return DEFAULT_REPORTING_CYCLE;
  }
}

export function saveReportingCycleToStorage(
  userId: number | string | undefined,
  cycle: ReportingCycle,
): void {
  localStorage.setItem(reportingCycleStorageKey(userId), JSON.stringify(cycle));
}
