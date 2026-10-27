import * as XLSX from "xlsx";
import type { OrderStatus, Order, Customer, User, Currency, Account, Tag } from "../../types";
import { parseImportDate } from "../importExportDate";

export interface ImportFundingLeg {
  accountId: number | null;
  amount: number;
  isCof?: boolean;
  currency?: string;
}

export interface ImportOrderData {
  customerId: number;
  handlerId: number;
  fromCurrency: string;
  toCurrency: string;
  amountBuy: number;
  amountSell: number;
  rate: number;
  status: OrderStatus;
  orderType: "online" | "otc";
  buyAccountId: number | null;
  sellAccountId: number | null;
  buyLegs: ImportFundingLeg[];
  sellLegs: ImportFundingLeg[];
  tagIds: number[];
  profitAmount?: number | null;
  profitCurrency?: string | null;
  profitAccountId?: number | null;
  profitLegs?: ImportFundingLeg[];
  serviceChargeAmount?: number | null;
  serviceChargeCurrency?: string | null;
  serviceChargeAccountId?: number | null;
  serviceChargeLegs?: ImportFundingLeg[];
  orderDate?: string;
}

export interface ImportValidationResult {
  success: boolean;
  errors: string[];
  orderData?: ImportOrderData;
}

const IMPORT_STATUSES: OrderStatus[] = ["saved", "completed", "cancelled"];
const COF_NAMES = new Set(["cof"]);

function blankText(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text || /^[-–—]+$/.test(text)) return "";
  return text;
}

function cellList(value: unknown): string[] {
  const text = blankText(value);
  if (!text) return [];
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

function isCofName(name: string): boolean {
  return COF_NAMES.has(name.trim().toLowerCase());
}

function accountForCurrency(
  accountsByName: Map<string, Account[]>,
  name: string,
  currency: string,
): Account | undefined {
  const list = accountsByName.get(name.toLowerCase()) || [];
  if (list.length === 0) return undefined;
  const wanted = currency.toUpperCase();
  if (wanted) {
    const match = list.find((account) => (account.currencyCode || "").toUpperCase() === wanted);
    if (match) return match;
  }
  return list.length === 1 ? list[0] : undefined;
}

/** "Account Name 1250.5" or a bare account name. */
function parseNamedAmount(part: string): { name: string; amount: number | null } {
  const match = part.trim().match(/^(.*)\s+(-?\d+(?:\.\d+)?)$/);
  if (!match) return { name: part.trim(), amount: null };
  const name = match[1].trim();
  const amount = parseFloat(match[2]);
  if (!name || Number.isNaN(amount)) return { name: part.trim(), amount: null };
  return { name, amount };
}

function resolveAccountLegs(
  cell: unknown,
  orderAmount: number,
  currency: string,
  accountsByName: Map<string, Account[]>,
  rowNumber: number,
  label: string,
): { legs: ImportFundingLeg[]; primaryAccountId: number | null; error?: string } {
  const parts = cellList(cell);
  if (parts.length === 0) {
    return { legs: [], primaryAccountId: null, error: `Row ${rowNumber}: ${label} is required` };
  }
  const parsed = parts.map(parseNamedAmount);
  const legs: ImportFundingLeg[] = [];
  for (const part of parsed) {
    const amount = part.amount == null ? (parsed.length === 1 ? orderAmount : null) : part.amount;
    if (amount == null || Number.isNaN(amount) || amount === 0) {
      return {
        legs: [],
        primaryAccountId: null,
        error: `Row ${rowNumber}: ${label} "${part.name}" must include an amount`,
      };
    }
    if (isCofName(part.name)) {
      legs.push({ accountId: null, amount, isCof: true });
      continue;
    }
    const account = accountForCurrency(accountsByName, part.name, currency);
    if (!account) {
      return {
        legs: [],
        primaryAccountId: null,
        error: `Row ${rowNumber}: ${label} "${part.name}" not found for ${currency}`,
      };
    }
    if ((account.currencyCode || "").toUpperCase() !== currency) {
      return {
        legs: [],
        primaryAccountId: null,
        error: `Row ${rowNumber}: ${label} "${part.name}" currency (${account.currencyCode}) does not match ${currency}`,
      };
    }
    legs.push({ accountId: account.id, amount, isCof: false });
  }
  const primary = legs.find((leg) => !leg.isCof && leg.accountId != null);
  return { legs, primaryAccountId: primary?.accountId ?? null };
}

function resolveChargeLegs(
  amountCell: unknown,
  currencyCell: unknown,
  accountCell: unknown,
  accountsByName: Map<string, Account[]>,
  rowNumber: number,
  label: string,
): { legs: ImportFundingLeg[]; error?: string } {
  const amounts = cellList(amountCell);
  const currencies = cellList(currencyCell);
  const accounts = cellList(accountCell);
  if (amounts.length === 0 && currencies.length === 0 && accounts.length === 0) {
    return { legs: [] };
  }
  if (amounts.length === 1 && Number(amounts[0]) === 0 && currencies.length === 0 && accounts.length === 0) {
    return { legs: [] };
  }
  const size = Math.max(amounts.length, currencies.length, accounts.length);
  if (
    (amounts.length > 0 && amounts.length !== size) ||
    (currencies.length > 0 && currencies.length !== size) ||
    (accounts.length > 0 && accounts.length !== size)
  ) {
    return { legs: [], error: `Row ${rowNumber}: ${label} amount, currency, and account counts must match` };
  }
  const legs: ImportFundingLeg[] = [];
  for (let i = 0; i < size; i += 1) {
    const amount = parseFloat(amounts[i] || "");
    const currency = (currencies[i] || "").toUpperCase();
    const accountName = accounts[i] || "";
    if (Number.isNaN(amount) || amount === 0) {
      return { legs: [], error: `Row ${rowNumber}: ${label} amount is invalid` };
    }
    if (!currency || !accountName) {
      return { legs: [], error: `Row ${rowNumber}: ${label} amount, currency, and account must all be provided` };
    }
    if (isCofName(accountName)) {
      legs.push({ accountId: null, amount, currency, isCof: true });
      continue;
    }
    const account = accountForCurrency(accountsByName, accountName, currency);
    if (!account) {
      return { legs: [], error: `Row ${rowNumber}: ${label} account "${accountName}" not found for ${currency}` };
    }
    if ((account.currencyCode || "").toUpperCase() !== currency) {
      return {
        legs: [],
        error: `Row ${rowNumber}: ${label} account "${accountName}" currency (${account.currencyCode}) must match ${currency}`,
      };
    }
    legs.push({ accountId: account.id, amount, currency, isCof: false });
  }
  return { legs };
}

/**
 * Validates and parses a single order row from Excel import
 */
export function validateAndParseOrderRow(
  row: any,
  rowNumber: number,
  customerMap: Map<string, number>,
  userMap: Map<string, number>,
  activeCurrencyCodes: Set<string>,
  currencyPairSet: Set<string>,
  tagNameToId: Map<string, number>,
  accountsByName: Map<string, Account[]>,
  existingOrderIds: Set<string>,
  seenOrderIds: Set<string>
): ImportValidationResult {
  const errors: string[] = [];

  // Validate Order ID uniqueness
  const orderIdRaw = String(row["Order ID"] || row["Order Id"] || row["orderId"] || "").trim();
  if (!orderIdRaw) {
    errors.push(`Row ${rowNumber}: Order ID is required`);
    return { success: false, errors };
  }
  const normalizedOrderId = orderIdRaw.toLowerCase();
  if (existingOrderIds.has(normalizedOrderId)) {
    errors.push(`Row ${rowNumber}: Order ID "${orderIdRaw}" already exists`);
    return { success: false, errors };
  }
  if (seenOrderIds.has(normalizedOrderId)) {
    errors.push(`Row ${rowNumber}: Order ID "${orderIdRaw}" is duplicated in the file`);
    return { success: false, errors };
  }

  // Find customer by name. A dash is an empty placeholder, not a customer.
  const customerName = blankText(row["Customer"] || row["customer"]);
  if (!customerName) {
    errors.push(`Row ${rowNumber}: Customer is required`);
    return { success: false, errors };
  }
  const customerId = customerMap.get(customerName.toLowerCase());
  if (!customerId) {
    errors.push(`Row ${rowNumber}: Customer "${customerName}" not found`);
    return { success: false, errors };
  }

  // Handler is the assigned user, or the creator when the order had no handler.
  const handlerName = blankText(row["Handler"] || row["handler"]);
  if (!handlerName) {
    errors.push(`Row ${rowNumber}: Handler is required`);
    return { success: false, errors };
  }
  const handlerId = userMap.get(handlerName.toLowerCase());
  if (!handlerId) {
    errors.push(`Row ${rowNumber}: Handler "${handlerName}" not found`);
    return { success: false, errors };
  }

  // Parse currency pair
  const currencyPair = String(row["Currency Pair"] || row["currencyPair"] || "").trim();
  const [fromCurrencyRaw, toCurrencyRaw] = currencyPair.split("/").map((c) => c.trim());
  const fromCurrency = fromCurrencyRaw?.toUpperCase() || "";
  const toCurrency = toCurrencyRaw?.toUpperCase() || "";
  if (!fromCurrency || !toCurrency) {
    errors.push(`Row ${rowNumber}: Invalid currency pair "${currencyPair}"`);
    return { success: false, errors };
  }
  if (!activeCurrencyCodes.has(fromCurrency) || !activeCurrencyCodes.has(toCurrency)) {
    errors.push(`Row ${rowNumber}: Currency pair uses unknown currencies (${fromCurrency}/${toCurrency})`);
    return { success: false, errors };
  }
  const normalizedPair = `${fromCurrency}/${toCurrency}`;
  if (!currencyPairSet.has(normalizedPair)) {
    errors.push(`Row ${rowNumber}: Currency pair "${normalizedPair}" is not allowed`);
    return { success: false, errors };
  }

  // Parse amounts and rate
  const amountBuy = parseFloat(row["Amount Buy"] || row["amountBuy"] || "0");
  const amountSell = parseFloat(row["Amount Sell"] || row["amountSell"] || "0");
  const rate = parseFloat(row["Rate"] || row["rate"] || "0");

  if (!amountBuy || !amountSell || !rate) {
    errors.push(`Row ${rowNumber}: Missing required fields (Amount Buy, Amount Sell, or Rate)`);
    return { success: false, errors };
  }

  const buySide = resolveAccountLegs(
    row["Buy Account"] || row["buyAccount"],
    amountBuy,
    fromCurrency,
    accountsByName,
    rowNumber,
    "Buy Account",
  );
  if (buySide.error) {
    errors.push(buySide.error);
    return { success: false, errors };
  }

  const sellSide = resolveAccountLegs(
    row["Sell Account"] || row["sellAccount"],
    amountSell,
    toCurrency,
    accountsByName,
    rowNumber,
    "Sell Account",
  );
  if (sellSide.error) {
    errors.push(sellSide.error);
    return { success: false, errors };
  }

  const profitSide = resolveChargeLegs(
    row["Profit Amount"] ?? row["profitAmount"],
    row["Profit Currency"] || row["profitCurrency"],
    row["Profit Account"] || row["profitAccount"],
    accountsByName,
    rowNumber,
    "Profit",
  );
  if (profitSide.error) {
    errors.push(profitSide.error);
    return { success: false, errors };
  }
  const profitLegs = profitSide.legs;
  const firstProfit = profitLegs[0];

  const serviceChargeSide = resolveChargeLegs(
    row["Service Charges Amount"] ?? row["Service Charge Amount"] ?? row["serviceChargeAmount"],
    row["Service Charges Currency"] || row["Service Charge Currency"] || row["serviceChargeCurrency"],
    row["Service Charges Account"] || row["Service Charge Account"] || row["serviceChargeAccount"],
    accountsByName,
    rowNumber,
    "Service charges",
  );
  if (serviceChargeSide.error) {
    errors.push(serviceChargeSide.error);
    return { success: false, errors };
  }
  const serviceChargeLegs = serviceChargeSide.legs;
  const firstServiceCharge = serviceChargeLegs[0];

  // Parse status
  const statusStr = blankText(row["Status"] || row["status"]).toLowerCase();
  if (!IMPORT_STATUSES.includes(statusStr as OrderStatus)) {
    errors.push(`Row ${rowNumber}: Status must be saved, completed, or cancelled`);
    return { success: false, errors };
  }
  const status = statusStr as OrderStatus;

  // Optional legacy column: default to online when missing or invalid
  const orderTypeStr = blankText(row["Order Type"] || row["OrderType"] || row["orderType"]).toLowerCase();
  const orderType: "online" | "otc" = orderTypeStr === "otc" ? "otc" : "online";

  // Parse tags (optional). A dash means no tags.
  const rawTags = blankText(row["Tags"] ?? row["tags"]);
  const tagIds: number[] = [];
  if (rawTags) {
    const tagNames = rawTags
      .split(",")
      .map((t) => blankText(t))
      .filter(Boolean);

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

  const parsedDate = parseImportDate(row["Date"] ?? row["date"]);
  if (parsedDate === undefined) {
    errors.push(`Row ${rowNumber}: Date must be YYYY-MM-DD`);
    return { success: false, errors };
  }

  // Build order data
  const orderData: ImportOrderData = {
    customerId,
    handlerId,
    fromCurrency,
    toCurrency,
    amountBuy,
    amountSell,
    rate,
    status,
    orderType,
    buyAccountId: buySide.primaryAccountId,
    sellAccountId: sellSide.primaryAccountId,
    buyLegs: buySide.legs,
    sellLegs: sellSide.legs,
    tagIds,
    ...(profitLegs.length > 0 ? { profitLegs } : {}),
    ...(firstProfit && !firstProfit.isCof && firstProfit.accountId != null
      ? {
          profitAmount: firstProfit.amount,
          profitCurrency: firstProfit.currency,
          profitAccountId: firstProfit.accountId,
        }
      : {}),
    ...(serviceChargeLegs.length > 0 ? { serviceChargeLegs } : {}),
    ...(firstServiceCharge && !firstServiceCharge.isCof && firstServiceCharge.accountId != null
      ? {
          serviceChargeAmount: firstServiceCharge.amount,
          serviceChargeCurrency: firstServiceCharge.currency,
          serviceChargeAccountId: firstServiceCharge.accountId,
        }
      : {}),
    ...(parsedDate ? { orderDate: parsedDate } : {}),
  };

  return { success: true, errors: [], orderData };
}

/**
 * Processes an Excel file and returns validated order data
 */
export async function processImportFile(
  file: File,
  customers: Customer[],
  users: User[],
  currencies: Currency[],
  currencyPairs: string[],
  accounts: Account[],
  tags: Tag[]
): Promise<{ orders: ImportOrderData[]; errors: string[] }> {
  // Read Excel file
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });

  // Read Orders sheet
  const ordersSheet = workbook.Sheets["Orders"];
  if (!ordersSheet) {
    throw new Error("Orders sheet not found in the file");
  }

  const ordersData = XLSX.utils.sheet_to_json(ordersSheet) as any[];

  if (ordersData.length === 0) {
    throw new Error("No orders found in the file");
  }

  // Build maps for validation
  const customerMap = new Map(customers.map((c) => [c.name.toLowerCase(), c.id]));
  const userMap = new Map(users.map((u) => [u.name.toLowerCase(), u.id]));
  const activeCurrencyCodes = new Set(currencies.filter((c) => c.active).map((c) => c.code.toUpperCase()));
  const currencyPairSet = new Set(currencyPairs.map((p) => p.toUpperCase()));
  const tagNameToId = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const accountsByName = new Map<string, Account[]>();
  for (const account of accounts) {
    const key = account.name.toLowerCase();
    const list = accountsByName.get(key) || [];
    list.push(account);
    accountsByName.set(key, list);
  }

  // Fetch existing orders to prevent importing duplicates by Order ID
  const existingOrdersResponse = await fetch("/api/orders/export");
  if (!existingOrdersResponse.ok) {
    throw new Error("Could not load existing orders to validate Order IDs");
  }
  const existingOrders: Order[] = await existingOrdersResponse.json();
  const existingOrderIds = new Set(existingOrders.map((o) => String(o.id).toLowerCase()));
  const seenOrderIds = new Set<string>();

  const validatedOrders: ImportOrderData[] = [];
  const errors: string[] = [];

  // Process each order
  for (let i = 0; i < ordersData.length; i++) {
    const row = ordersData[i];
    const rowNumber = i + 2;

    const result = validateAndParseOrderRow(
      row,
      rowNumber,
      customerMap,
      userMap,
      activeCurrencyCodes,
      currencyPairSet,
      tagNameToId,
      accountsByName,
      existingOrderIds,
      seenOrderIds
    );

    if (result.success && result.orderData) {
      // Track seen order IDs
      const orderIdRaw = String(row["Order ID"] || row["Order Id"] || row["orderId"] || "").trim();
      seenOrderIds.add(orderIdRaw.toLowerCase());
      validatedOrders.push(result.orderData);
    } else {
      errors.push(...result.errors);
    }
  }

  return { orders: validatedOrders, errors };
}

