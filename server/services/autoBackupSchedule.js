const FREQUENCIES = new Set(["hourly", "daily", "weekly", "monthly"]);
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

export function defaultAutoBackupSettings() {
  return {
    enabled: false,
    frequency: "daily",
    intervalHours: 1,
    time: "02:00",
    timezone: "UTC",
    weekday: 1,
    dayOfMonth: 1,
    endOfMonth: false,
    includeFiles: false,
    retentionCount: 30,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
  };
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function readBoolean(value, label) {
  if (typeof value !== "boolean") {
    return { ok: false, message: `${label} must be true or false` };
  }
  return { ok: true, value };
}

function readInt(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
}

function normalizeTime(value) {
  if (typeof value !== "string") return null;
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeAutoBackupInput(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, message: "Invalid automatic backup settings" };
  }

  const enabled = readBoolean(input.enabled, "Enabled");
  if (!enabled.ok) return enabled;
  const includeFiles = readBoolean(input.includeFiles, "Include files");
  if (!includeFiles.ok) return includeFiles;
  const endOfMonth = readBoolean(input.endOfMonth, "End of month");
  if (!endOfMonth.ok) return endOfMonth;

  if (!FREQUENCIES.has(input.frequency)) {
    return { ok: false, message: "Frequency must be hourly, daily, weekly, or monthly" };
  }

  const time = normalizeTime(input.time);
  if (!time) {
    return { ok: false, message: "Choose a valid time" };
  }

  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (!isValidTimeZone(timezone)) {
    return { ok: false, message: "Choose a valid time zone" };
  }

  let intervalHours = readInt(input.intervalHours);
  if (input.frequency === "hourly") {
    if (intervalHours == null || intervalHours < 1 || intervalHours > 23) {
      return { ok: false, message: "Hourly interval must be a whole number from 1 to 23" };
    }
  } else if (intervalHours == null || intervalHours < 1 || intervalHours > 23) {
    intervalHours = 1;
  }

  let weekday = readInt(input.weekday);
  if (input.frequency === "weekly") {
    if (weekday == null || weekday < 1 || weekday > 7) {
      return { ok: false, message: "Choose a day of the week" };
    }
  } else if (weekday == null || weekday < 1 || weekday > 7) {
    weekday = 1;
  }

  let dayOfMonth = readInt(input.dayOfMonth);
  if (input.frequency === "monthly" && !endOfMonth.value) {
    if (dayOfMonth == null || dayOfMonth < 1 || dayOfMonth > 27) {
      return { ok: false, message: "Day of month must be a whole number from 1 to 27" };
    }
  } else if (dayOfMonth == null || dayOfMonth < 1 || dayOfMonth > 27) {
    dayOfMonth = 1;
  }

  const retentionCount = readInt(input.retentionCount);
  if (retentionCount == null || retentionCount < 1 || retentionCount > 1000) {
    return { ok: false, message: "Backup limit must be a whole number from 1 to 1000" };
  }

  return {
    ok: true,
    value: {
      enabled: enabled.value,
      frequency: input.frequency,
      intervalHours,
      time,
      timezone,
      weekday,
      dayOfMonth,
      endOfMonth: endOfMonth.value,
      includeFiles: includeFiles.value,
      retentionCount,
    },
  };
}

export function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function isoWeekday(year, month, day) {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function zoneOffsetMs(utcMs, timeZone) {
  const parts = getZonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - utcMs;
}

function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zoneOffsetMs(utcGuess, timeZone);
  let utc = utcGuess - offset;
  const offset2 = zoneOffsetMs(utc, timeZone);
  if (offset2 !== offset) utc = utcGuess - offset2;
  return new Date(utc);
}

function addCalendarDays(year, month, day, days) {
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function addMonths(year, month, count) {
  const dt = new Date(Date.UTC(year, month - 1 + count, 1));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseClock(time) {
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute };
}

function nextHourlyRun(settings, fromDate) {
  const { hour, minute } = parseClock(settings.time);
  const intervalMs = settings.intervalHours * 60 * 60 * 1000;
  const anchorMs = zonedDateTimeToUtc(2020, 1, 1, hour, minute, settings.timezone).getTime();
  const fromMs = fromDate.getTime();
  if (fromMs <= anchorMs) return new Date(anchorMs);
  const elapsed = fromMs - anchorMs;
  let steps = Math.floor((elapsed + intervalMs - 1) / intervalMs);
  let nextMs = anchorMs + steps * intervalMs;
  if (nextMs < fromMs) {
    steps += 1;
    nextMs = anchorMs + steps * intervalMs;
  }
  return new Date(nextMs);
}

function nextDailyRun(settings, fromDate) {
  const { hour, minute } = parseClock(settings.time);
  const parts = getZonedParts(fromDate, settings.timezone);
  let candidate = zonedDateTimeToUtc(parts.year, parts.month, parts.day, hour, minute, settings.timezone);
  if (candidate.getTime() < fromDate.getTime()) {
    const nextDay = addCalendarDays(parts.year, parts.month, parts.day, 1);
    candidate = zonedDateTimeToUtc(nextDay.year, nextDay.month, nextDay.day, hour, minute, settings.timezone);
  }
  return candidate;
}

function nextWeeklyRun(settings, fromDate) {
  const { hour, minute } = parseClock(settings.time);
  const parts = getZonedParts(fromDate, settings.timezone);
  let delta = (settings.weekday - isoWeekday(parts.year, parts.month, parts.day) + 7) % 7;
  let date = addCalendarDays(parts.year, parts.month, parts.day, delta);
  let candidate = zonedDateTimeToUtc(date.year, date.month, date.day, hour, minute, settings.timezone);
  if (candidate.getTime() < fromDate.getTime()) {
    date = addCalendarDays(date.year, date.month, date.day, 7);
    candidate = zonedDateTimeToUtc(date.year, date.month, date.day, hour, minute, settings.timezone);
  }
  return candidate;
}

function nextMonthlyRun(settings, fromDate) {
  const { hour, minute } = parseClock(settings.time);
  const parts = getZonedParts(fromDate, settings.timezone);
  const atMonth = (year, month) => {
    const day = settings.endOfMonth ? lastDayOfMonth(year, month) : settings.dayOfMonth;
    return zonedDateTimeToUtc(year, month, day, hour, minute, settings.timezone);
  };
  let candidate = atMonth(parts.year, parts.month);
  if (candidate.getTime() < fromDate.getTime()) {
    const next = addMonths(parts.year, parts.month, 1);
    candidate = atMonth(next.year, next.month);
  }
  return candidate;
}

/** Next run at or after `fromDate`. The start time is itself a run slot. */
export function computeNextRunAt(settings, fromDate) {
  if (settings.frequency === "hourly") return nextHourlyRun(settings, fromDate);
  if (settings.frequency === "weekly") return nextWeeklyRun(settings, fromDate);
  if (settings.frequency === "monthly") return nextMonthlyRun(settings, fromDate);
  return nextDailyRun(settings, fromDate);
}
