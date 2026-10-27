/**
 * Optional positive integer primary key from a create/import body.
 * Blank means the database should assign the id.
 */
export function parseOptionalRecordId(value, label = "ID") {
  if (value === undefined || value === null || value === "") return { id: null };
  const text = String(value).trim();
  if (!text || text === "-") return { id: null };
  if (!/^[1-9]\d*$/.test(text)) {
    return { error: `${label} must be a positive integer` };
  }
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { error: `${label} must be a positive integer` };
  }
  return { id };
}
