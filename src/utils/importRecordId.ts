/**
 * Positive integer primary key from an import ID cell.
 * Blank and "-" return null. Anything else that is not a positive integer returns undefined.
 */
export function parseImportRecordId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return undefined;
    return value;
  }
  const text = String(value).trim();
  if (!text || text === "-") return null;
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return id;
}
