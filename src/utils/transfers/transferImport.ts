import * as XLSX from "xlsx";
import type { Transfer, Account, Tag, User } from "../../types";
import {
  accountNamePreview,
  groupAccountsByName,
  matchAccountInCurrency,
} from "../accounts/matchAccountForImport";
import { parseImportDate } from "../importExportDate";

export interface ImportTransferData {
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  description?: string;
  transactionFee?: number;
  tagIds: number[];
  currencyCode?: string;
  createdBy?: number;
  createdAt?: string;
  entryDate?: string;
}

export interface ImportValidationResult {
  success: boolean;
  errors: string[];
  transferData?: ImportTransferData;
}

/**
 * Validates and parses a single transfer row from Excel import
 */
function describeAccountMatch(
  rowNumber: number,
  label: string,
  accountName: string,
  currencyCode: string | undefined,
  accountsByName: Map<string, Account[]>,
  matched: ReturnType<typeof matchAccountInCurrency>
): string | null {
  if ("account" in matched) return null;
  if (matched.error === "not_found") {
    return `Row ${rowNumber}: ${label} "${accountName}" not found. Available accounts: ${accountNamePreview(accountsByName)}`;
  }
  if (matched.error === "not_in_currency") {
    return `Row ${rowNumber}: ${label} "${accountName}" was not found in currency "${currencyCode}". It exists in ${matched.currencies.join(", ")}`;
  }
  return `Row ${rowNumber}: ${label} "${accountName}" exists in more than one currency (${matched.currencies.join(", ")}). Set the Currency column.`;
}

export function validateAndParseTransferRow(
  row: any,
  rowNumber: number,
  accountsByName: Map<string, Account[]>,
  tagNameToId: Map<string, number>,
  userNameToId: Map<string, number>,
  existingTransferIds: Set<string>,
  seenTransferIds: Set<string>
): ImportValidationResult {
  const errors: string[] = [];

  // Validate Transfer ID uniqueness (optional field)
  const transferIdRaw = String(row["Transfer ID"] || row["Transfer Id"] || row["transferId"] || "").trim();
  if (transferIdRaw) {
    const normalizedTransferId = transferIdRaw.toLowerCase();
    if (existingTransferIds.has(normalizedTransferId)) {
      errors.push(`Row ${rowNumber}: Transfer ID "${transferIdRaw}" already exists`);
      return { success: false, errors };
    }
    if (seenTransferIds.has(normalizedTransferId)) {
      errors.push(`Row ${rowNumber}: Transfer ID "${transferIdRaw}" is duplicated in the file`);
      return { success: false, errors };
    }
    seenTransferIds.add(normalizedTransferId);
  }

  const parsedDate = parseImportDate(row["Date"] ?? row["date"]);
  if (parsedDate === undefined) {
    errors.push(`Row ${rowNumber}: Date must be YYYY-MM-DD`);
    return { success: false, errors };
  }

  const currencyCodeRaw = String(row["Currency"] || row["currency"] || row["currencyCode"] || "").trim();
  const currencyCode = currencyCodeRaw && currencyCodeRaw !== "-" ? currencyCodeRaw : undefined;

  // Parse from account inside the row's currency pool.
  const fromAccountNameRaw = String(row["From Account"] || row["fromAccount"] || "").trim();
  if (!fromAccountNameRaw) {
    errors.push(`Row ${rowNumber}: From Account is required`);
    return { success: false, errors };
  }
  const fromMatched = matchAccountInCurrency(accountsByName, fromAccountNameRaw, currencyCode);
  const fromError = describeAccountMatch(rowNumber, "From Account", fromAccountNameRaw, currencyCode, accountsByName, fromMatched);
  if (fromError || !("account" in fromMatched)) {
    errors.push(fromError || `Row ${rowNumber}: From Account "${fromAccountNameRaw}" not found`);
    return { success: false, errors };
  }
  const fromAccount = fromMatched.account;

  // Parse to account inside the same currency pool.
  const toAccountNameRaw = String(row["To Account"] || row["toAccount"] || "").trim();
  if (!toAccountNameRaw) {
    errors.push(`Row ${rowNumber}: To Account is required`);
    return { success: false, errors };
  }
  const toMatched = matchAccountInCurrency(accountsByName, toAccountNameRaw, currencyCode);
  const toError = describeAccountMatch(rowNumber, "To Account", toAccountNameRaw, currencyCode, accountsByName, toMatched);
  if (toError || !("account" in toMatched)) {
    errors.push(toError || `Row ${rowNumber}: To Account "${toAccountNameRaw}" not found`);
    return { success: false, errors };
  }
  const toAccount = toMatched.account;

  // Validate that from and to accounts are different
  if (fromAccount.id === toAccount.id) {
    errors.push(`Row ${rowNumber}: From Account and To Account must be different`);
    return { success: false, errors };
  }

  // Validate that both accounts have the same currency
  if (fromAccount.currencyCode.toUpperCase() !== toAccount.currencyCode.toUpperCase()) {
    errors.push(`Row ${rowNumber}: From Account and To Account must have the same currency`);
    return { success: false, errors };
  }

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

  // Parse description (required). "-" is the old empty-cell placeholder.
  const descriptionRaw = String(row["Description"] || row["description"] || "").trim();
  const description = descriptionRaw === "-" ? "" : descriptionRaw;
  if (!description) {
    errors.push(`Row ${rowNumber}: Description is required`);
    return { success: false, errors };
  }

  // Parse transaction fee (optional)
  const transactionFeeRaw = row["Transaction Fee"] ?? row["transactionFee"];
  const transactionFee =
    transactionFeeRaw === undefined || transactionFeeRaw === null || String(transactionFeeRaw).trim() === ""
      ? undefined
      : parseFloat(transactionFeeRaw);
  if (transactionFee !== undefined && (Number.isNaN(transactionFee) || transactionFee < 0)) {
    errors.push(`Row ${rowNumber}: Transaction Fee must be a non-negative number`);
    return { success: false, errors };
  }

  // Parse tags (optional) and validate existence. "-" is the old empty-cell placeholder.
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

  const transferData: ImportTransferData = {
    fromAccountId: fromAccount.id,
    toAccountId: toAccount.id,
    amount,
    description,
    transactionFee,
    tagIds,
    currencyCode: currencyCode || fromAccount.currencyCode,
    createdBy,
    ...(parsedDate ? { createdAt: parsedDate, entryDate: parsedDate } : {}),
  };

  return { success: true, errors: [], transferData };
}

/**
 * Processes an Excel file and returns validated transfer data
 */
export async function processImportFile(
  file: File,
  accounts: Account[],
  tags: Tag[],
  users: User[] = []
): Promise<{ transfers: ImportTransferData[]; errors: string[] }> {
  // Read Excel file
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });

  // Read Transfers sheet
  const transfersSheet = workbook.Sheets["Transfers"];
  if (!transfersSheet) {
    throw new Error("Transfers sheet not found in the file");
  }

  const transfersData = XLSX.utils.sheet_to_json(transfersSheet, { cellDates: true }) as any[];

  if (transfersData.length === 0) {
    throw new Error("No transfers found in the file");
  }

  const accountsByName = groupAccountsByName(accounts);
  const tagNameToId = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const userNameToId = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));

  // Fetch existing transfers to prevent importing duplicates by Transfer ID
  const existingTransfersResponse = await fetch("/api/transfers/export");
  if (!existingTransfersResponse.ok) {
    throw new Error("Could not load existing transfers to validate Transfer IDs");
  }
  const existingTransfers: Transfer[] = await existingTransfersResponse.json();
  const existingTransferIds = new Set(existingTransfers.map((t) => String(t.id).toLowerCase()));
  const seenTransferIds = new Set<string>();

  const validatedTransfers: ImportTransferData[] = [];
  const errors: string[] = [];

  // Process each transfer
  for (let i = 0; i < transfersData.length; i++) {
    const row = transfersData[i];
    const rowNumber = i + 2;

    const result = validateAndParseTransferRow(
      row,
      rowNumber,
      accountsByName,
      tagNameToId,
      userNameToId,
      existingTransferIds,
      seenTransferIds
    );

    if (result.success && result.transferData) {
      validatedTransfers.push(result.transferData);
    } else {
      errors.push(...result.errors);
    }
  }

  return { transfers: validatedTransfers, errors };
}

