import * as XLSX from "xlsx";

/** Calendar date written by export and read by import: YYYY-MM-DD. */
export function formatExportDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDateIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
}

/**
 * Parse a Date cell into an ISO timestamp at local noon.
 * Empty values return null. Invalid values return undefined.
 * Accepts YYYY-MM-DD, Excel dates, and the older M/D/YYYY export text.
 */
export function parseImportDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return calendarDateIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return undefined;
    return calendarDateIso(parsed.y, parsed.m, parsed.d);
  }

  const text = String(value).trim();
  if (!text || text === "-") return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return calendarDateIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return calendarDateIso(year, month, day);
  }

  return undefined;
}
