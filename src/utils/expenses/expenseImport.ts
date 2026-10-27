import * as XLSX from "xlsx";
import type { Expense, Account, Tag, User } from "../../types";
import {
  accountNamePreview,
  groupAccountsByName,
  matchAccountInCurrency,
} from "../accounts/matchAccountForImport";
import { parseImportDate } from "../importExportDate";

export interface ImportExpenseData {
  accountId: number;
  amount: number;
  description?: string;
  tagIds: number[];
  currencyCode?: string;
  createdBy?: number;
  createdAt?: string;
  entryDate?: string;
}

export interface ImportValidationResult {
  success: boolean;
  errors: string[];
  expenseData?: ImportExpenseData;
}

/**
 * Validates and parses a single expense row from Excel import
 */
export function validateAndParseExpenseRow(
  row: any,
  rowNumber: number,
  accountsByName: Map<string, Account[]>,
  tagNameToId: Map<string, number>,
  userNameToId: Map<string, number>,
  existingExpenseIds: Set<string>,
  seenExpenseIds: Set<string>
): ImportValidationResult {
  const errors: string[] = [];

  // Validate Expense ID uniqueness (optional field)
  const expenseIdRaw = String(row["Expense ID"] || row["Expense Id"] || row["expenseId"] || "").trim();
  if (expenseIdRaw) {
    const normalizedExpenseId = expenseIdRaw.toLowerCase();
    if (existingExpenseIds.has(normalizedExpenseId)) {
      errors.push(`Row ${rowNumber}: Expense ID "${expenseIdRaw}" already exists`);
      return { success: false, errors };
    }
    if (seenExpenseIds.has(normalizedExpenseId)) {
      errors.push(`Row ${rowNumber}: Expense ID "${expenseIdRaw}" is duplicated in the file`);
      return { success: false, errors };
    }
    seenExpenseIds.add(normalizedExpenseId);
  }

  const parsedDate = parseImportDate(row["Date"] ?? row["date"]);
  if (parsedDate === undefined) {
    errors.push(`Row ${rowNumber}: Date must be YYYY-MM-DD`);
    return { success: false, errors };
  }

  const currencyCodeRaw = String(row["Currency"] || row["currency"] || row["currencyCode"] || "").trim();
  const currencyCode = currencyCodeRaw && currencyCodeRaw !== "-" ? currencyCodeRaw : undefined;

  // Parse account inside the row's currency pool. The same name can exist in more than one currency.
  const accountNameRaw = String(row["Account"] || row["account"] || "").trim();
  if (!accountNameRaw) {
    errors.push(`Row ${rowNumber}: Account is required`);
    return { success: false, errors };
  }

  const matched = matchAccountInCurrency(accountsByName, accountNameRaw, currencyCode);
  if (!("account" in matched)) {
    if (matched.error === "not_found") {
      const available = accountNamePreview(accountsByName);
      errors.push(`Row ${rowNumber}: Account "${accountNameRaw}" not found. Available accounts: ${available}`);
    } else if (matched.error === "not_in_currency") {
      errors.push(
        `Row ${rowNumber}: Account "${accountNameRaw}" was not found in currency "${currencyCode}". It exists in ${matched.currencies.join(", ")}`
      );
    } else {
      errors.push(
        `Row ${rowNumber}: Account "${accountNameRaw}" exists in more than one currency (${matched.currencies.join(", ")}). Set the Currency column.`
      );
    }
    return { success: false, errors };
  }
  const account = matched.account;

  // Parse amount (required)
  const amount = parseFloat(row["Amount"] || row["amount"] || "0");
  if (!amount || amount <= 0) {
    errors.push(`Row ${rowNumber}: Amount must be a positive number`);
    return { success: false, errors };
  }

  // Parse created by (optional)
  let createdBy: number | undefined = undefined;
  const createdByNameRaw = String(row["Created By"] || row["createdBy"] || "").trim();
  const createdByName = createdByNameRaw && createdByNameRaw !== "-" ? createdByNameRaw : "";
  if (createdByName) {
    const userId = userNameToId.get(createdByName.toLowerCase());
    if (!userId) {
      errors.push(`Row ${rowNumber}: User "${createdByName}" not found`);
      return { success: false, errors };
    }
    createdBy = userId;
  }

  // Parse description (optional). "-" is the old empty-cell placeholder.
  const descriptionRaw = String(row["Description"] || row["description"] || "").trim();
  const description = descriptionRaw && descriptionRaw !== "-" ? descriptionRaw : undefined;

  // Parse tags (optional) and validate existence
  const rawTags = row["Tags"] ?? row["tags"];
  const tagIds: number[] = [];
  const rawTagsText = rawTags === undefined || rawTags === null ? "" : String(rawTags).trim();
  if (rawTagsText && rawTagsText !== "-") {
    const tagNames = rawTagsText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t !== "-");

    for (const tagName of tagNames) {
      const tagId = tagNameToId.get(tagName.toLowerCase());
      if (!tagId) {
        errors.push(`Row ${rowNumber}: Tag "${tagName}" does not exist`);
        return { success: false, errors };
      }
      if (!tagIds.includes(tagId)) {
        tagIds.push(tagId);
      }
    }
  }

  const expenseData: ImportExpenseData = {
    accountId: account.id,
    amount,
    description,
    tagIds,
    currencyCode: currencyCode || account.currencyCode,
    createdBy,
    ...(parsedDate ? { createdAt: parsedDate, entryDate: parsedDate } : {}),
  };

  return { success: true, errors: [], expenseData };
}

/**
 * Processes an Excel file and returns validated expense data
 */
export async function processImportFile(
  file: File,
  accounts: Account[],
  tags: Tag[],
  users: User[] = []
): Promise<{ expenses: ImportExpenseData[]; errors: string[] }> {
  // Read Excel file
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });

  // Read Expenses sheet
  const expensesSheet = workbook.Sheets["Expenses"];
  if (!expensesSheet) {
    throw new Error("Expenses sheet not found in the file");
  }

  const expensesData = XLSX.utils.sheet_to_json(expensesSheet) as any[];

  if (expensesData.length === 0) {
    throw new Error("No expenses found in the file");
  }

  const accountsByName = groupAccountsByName(accounts);
  const tagNameToId = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const userNameToId = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));

  // Fetch existing expenses to prevent importing duplicates by Expense ID
  const existingExpensesResponse = await fetch("/api/expenses/export");
  if (!existingExpensesResponse.ok) {
    throw new Error("Could not load existing expenses to validate Expense IDs");
  }
  const existingExpenses: Expense[] = await existingExpensesResponse.json();
  const existingExpenseIds = new Set(existingExpenses.map((e) => String(e.id).toLowerCase()));
  const seenExpenseIds = new Set<string>();

  const validatedExpenses: ImportExpenseData[] = [];
  const errors: string[] = [];

  // Process each expense
  for (let i = 0; i < expensesData.length; i++) {
    const row = expensesData[i];
    const rowNumber = i + 2;

    const result = validateAndParseExpenseRow(
      row,
      rowNumber,
      accountsByName,
      tagNameToId,
      userNameToId,
      existingExpenseIds,
      seenExpenseIds
    );

    if (result.success && result.expenseData) {
      validatedExpenses.push(result.expenseData);
    } else {
      errors.push(...result.errors);
    }
  }

  return { expenses: validatedExpenses, errors };
}

