export interface Currency {
  id: number;
  code: string;
  name: string;
  baseRateBuy: number;
  conversionRateBuy: number;
  baseRateSell: number;
  conversionRateSell: number;
  active: boolean | number;
  /** When set, amount cells for this currency use custom table styling */
  displayBgColor?: string | null;
  displayPositiveColor?: string | null;
  displayNegativeColor?: string | null;
  /** When true (default), currency code in tables uses amount display colors */
  codeDisplaySameAsAmount?: boolean | number;
  codeDisplayBgColor?: string | null;
  codeDisplayPositiveColor?: string | null;
  codeDisplayNegativeColor?: string | null;
  /** How amounts appear in tables: suffix code (100 USD) or prefix symbol ($100) */
  amountDisplayMode?: "code" | "symbol" | null;
  /** Symbol when amountDisplayMode is symbol, e.g. $ or ¥ */
  currencySymbol?: string | null;
  /** Pool-level default background color for account names in this currency */
  accountPoolDisplayBgColor?: string | null;
  /** Pool-level default text color for account names in this currency */
  accountPoolDisplayTextColor?: string | null;
}

export type CurrencyAmountDisplayMode = "code" | "symbol";

export type ReferenceRatePairId =
  | "CNY_USDT"
  | "PKR_AED"
  | "AED_USDT"
  | "HKD_USDT"
  | "PKR_USDT"
  | "USD_USDT_HK"
  | "USD_USDT_INTL"
  | "HKD_PKR"
  | "CNY_PKR"
  | "PKR_SWIFT";

export type ReferenceRateBaseMode = "average" | "dual" | "chain" | "derived" | null;
export type ReferenceRatePairKind = "standalone" | "benchmark" | "chain" | "derived";

export interface ReferenceRatePairInput {
  id: ReferenceRatePairId;
  label: string;
  kind: ReferenceRatePairKind;
  baseMode: ReferenceRateBaseMode;
  averageBase: number | null;
  baseBuy: number | null;
  baseSell: number | null;
  markup: number;
  markdown: number;
  /** Decimal places for buy/sell on the floating panel (0–8). */
  displayDecimals: number;
}

export interface ReferenceRatePair extends ReferenceRatePairInput {
  computedBuy: number | null;
  computedSell: number | null;
  computeError: string | null;
}

export interface ReferenceRatesResponse {
  version: number;
  updatedAt: string | null;
  pkrSwiftFactor: number;
  pairs: Record<ReferenceRatePairId, ReferenceRatePair>;
}

export interface ReferenceRatesUpdatePayload {
  pkrSwiftFactor?: number;
  pairs: Partial<
    Record<
      ReferenceRatePairId,
      {
        averageBase?: number | null;
        baseBuy?: number | null;
        baseSell?: number | null;
        markup?: number;
        markdown?: number;
        baseMode?: ReferenceRateBaseMode;
        displayDecimals?: number;
      }
    >
  >;
}

export type CustomerType = "individual" | "corporate";

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  remarks?: string;
  /** Defaults to individual when omitted (legacy rows). */
  customerType?: CustomerType;
  displayBgColor?: string | null;
  displayTextColor?: string | null;
  /** Pinned to top of customer list (team-wide; pinOrders permission). */
  pinned?: boolean;
  pinOrder?: number;
  /** Funding total in default profit target currency (list API). */
  listBalance?: number | null;
  /** Trade P/L in default profit target currency (list API). */
  listProfitLoss?: number | null;
  /** KYC review state for list column; draft / no profile omitted. */
  kycStatus?: "submitted" | "approved" | "rejected" | null;
}

/** Lightweight customer row for dropdowns (orders, dashboard, ledger). */
export interface CustomerOption {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  customerType?: CustomerType;
  displayBgColor?: string | null;
  displayTextColor?: string | null;
}

export interface CustomerOptionsResponse {
  customers: CustomerOption[];
}

export interface CustomerListResponse {
  customers: Customer[];
  total: number;
  page: number | null;
  limit: number | null;
  targetCurrency?: string | null;
}

export type CustomerListSortField = "balance" | "profitLoss";
export type CustomerListSortDir = "asc" | "desc";

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  password?: string | null;
  displayBgColor?: string | null;
  displayTextColor?: string | null;
}

export interface AuthResponse {
  id: number;
  name: string;
  email: string;
  role: string;
  token?: string;
  totpEnabled?: boolean;
  permissions?: RolePermissions;
  roleUpdatedAt?: string; // Timestamp when user's role was last updated (stored at login)
  /** User's preferred sidebar background color (hex, e.g. "#0f172a") */
  sidebarBgColor?: string | null;
  /** User's preferred app background color (hex, e.g. "#f8fafc") */
  displayBgColor?: string | null;
  themeHeaderBg?: string | null;
  themeCardBg?: string | null;
  themeBorder?: string | null;
  themeTextPrimary?: string | null;
  themeTextSecondary?: string | null;
  themeSidebarNavText?: string | null;
}

export interface RolePermissions {
  sections: string[];
  actions: Record<string, boolean>;
}

export type AccountAccessMode = "all" | "selected";

export interface AccountAccessRule {
  mode: AccountAccessMode;
  accountIds: number[];
}

export type RoleAccountAccess = Record<string, AccountAccessRule>;

export interface Role {
  id: number;
  name: string;
  displayName: string;
  permissions: RolePermissions;
  accountAccess?: RoleAccountAccess;
  updatedAt?: string;
}

export type OrderStatus = "saved" | "completed" | "cancelled";
export type PaymentFlow = "receive_first" | "pay_first";

export interface Tag {
  id: number;
  name: string;
  color: string;
  createdAt?: string;
}

export interface TagInput {
  name: string;
  color: string;
}

export interface Order {
  id: number;
  customerId: number;
  customerName?: string;
  fromCurrency: string;
  toCurrency: string;
  amountBuy: number;
  amountSell: number;
  rate: number;
  status: OrderStatus;
  handlerId?: number;
  handlerName?: string;
  createdBy?: number;
  createdByName?: string;
  paymentType?: "CRYPTO" | "FIAT";
  networkChain?: string;
  walletAddresses?: string[];
  bankDetails?: {
    bankName?: string;
    accountTitle?: string;
    accountNumber?: string;
    accountIban?: string;
    swiftCode?: string;
    bankAddress?: string;
  };
  hasBeneficiaries?: boolean;
  buyAccountId?: number;
  sellAccountId?: number;
  buyAccountName?: string;
  sellAccountName?: string;
  buyAccounts?: Array<{ accountId: number | null; accountName: string; amount: number; isCof?: boolean }>;
  sellAccounts?: Array<{ accountId: number | null; accountName: string; amount: number; isCof?: boolean }>;
  paymentFlow?: PaymentFlow;
  actualAmountBuy?: number;
  actualAmountSell?: number;
  actualRate?: number;
  serviceChargeAmount?: number | null;
  serviceChargeCurrency?: string | null;
  serviceChargeAccountId?: number | null;
  profitAmount?: number | null;
  profitCurrency?: string | null;
  profitAccountId?: number | null;
  profitEntries?: Array<{ amount: number; currency: string }>;
  serviceChargeEntries?: Array<{ amount: number; currency: string }>;
  calculatedProfit?: number | null;
  calculatedProfitCurrency?: string | null;
  orderType?: "online" | "otc";
  /** exchange = normal cash/Bal order; ledger_swap = customer deposit currency swap (no company accounts) */
  orderMode?: "exchange" | "ledger_swap";
  tags?: Tag[];
  remarks?: string;
  createdAt: string;
  orderDate?: string | null;
  /** Pinned to top of the list for everyone (team reminder; role action pinOrders) */
  pinned?: boolean;
  /** Order among pinned orders (0 = first); only set when pinned */
  pinOrder?: number;
}

export type ReceiptFundedFrom = "cash" | "customer_balance";

export interface OrderReceipt {
  id: number;
  orderId: number;
  imagePath: string;
  amount: number;
  accountId?: number;
  accountName?: string;
  fundedFrom?: ReceiptFundedFrom;
  status?: "draft" | "confirmed";
  createdAt: string;
}

export interface OrderBeneficiary {
  id: number;
  orderId: number;
  paymentType: "CRYPTO" | "FIAT";
  networkChain?: string;
  walletAddresses?: string[];
  bankName?: string;
  accountTitle?: string;
  accountNumber?: string;
  accountIban?: string;
  swiftCode?: string;
  bankAddress?: string;
  createdAt: string;
}

export interface OrderPayment {
  id: number;
  orderId: number;
  imagePath: string;
  amount: number;
  accountId?: number;
  accountName?: string;
  fundedFrom?: ReceiptFundedFrom;
  status?: "draft" | "confirmed";
  createdAt: string;
}

export interface OrderProfit {
  id: number;
  orderId: number;
  amount: number;
  currencyCode: string;
  accountId: number;
  accountName?: string;
  status: "draft" | "confirmed";
  createdAt: string;
}

export interface OrderServiceCharge {
  id: number;
  orderId: number;
  amount: number;
  currencyCode: string;
  accountId?: number | null;
  accountName?: string;
  fundedFrom?: ReceiptFundedFrom;
  status: "draft" | "confirmed";
  createdAt: string;
}

export interface CustomerBeneficiary {
  id: number;
  customerId: number;
  paymentType: "CRYPTO" | "FIAT";
  networkChain?: string;
  walletAddresses?: string[];
  bankName?: string;
  accountTitle?: string;
  accountNumber?: string;
  accountIban?: string;
  swiftCode?: string;
  bankAddress?: string;
  createdAt: string;
}

export interface OrderInput {
  /** When set without customerId, server finds or creates customer by name */
  customerName?: string;
  customerId?: number;
  fromCurrency: string;
  toCurrency: string;
  amountBuy: number;
  amountSell: number;
  rate: number;
  status?: OrderStatus;
  buyAccountId?: number;
  sellAccountId?: number;
  paymentFlow?: PaymentFlow;
  serviceChargeAmount?: number | null;
  serviceChargeCurrency?: string | null;
  serviceChargeAccountId?: number | null;
  profitAmount?: number | null;
  profitCurrency?: string | null;
  profitAccountId?: number | null;
  orderType?: "online" | "otc";
  orderMode?: "exchange" | "ledger_swap";
  handlerId?: number;
  tagIds?: number[];
  remarks?: string;
  orderDate?: string | null;
}

export interface Account {
  id: number;
  currencyCode: string;
  currencyName?: string;
  name: string;
  balance: number;
  createdAt: string;
  displayBgColor?: string | null;
  displayTextColor?: string | null;
}

export interface AccountSummary {
  currencyCode: string;
  currencyName?: string;
  totalBalance: number;
  accountCount: number;
}

export interface AccountTransaction {
  id: number;
  accountId: number;
  type: "add" | "withdraw";
  amount: number;
  description?: string;
  createdAt: string;
}

export interface Transfer {
  id: number;
  fromAccountId: number;
  fromAccountName?: string;
  toAccountId: number;
  toAccountName?: string;
  amount: number;
  currencyCode: string;
  description?: string;
  transactionFee?: number;
  imagePath?: string | null;
  createdBy?: number;
  createdByName?: string;
  createdAt: string;
  entryDate?: string | null;
  updatedBy?: number;
  updatedByName?: string;
  updatedAt?: string;
  tags?: Tag[];
}

export interface TransferChange {
  id: number;
  transferId: number;
  changedBy?: number;
  changedByName?: string;
  changedAt: string;
  fromAccountId: number;
  fromAccountName?: string;
  toAccountId: number;
  toAccountName?: string;
  amount: number;
  description?: string;
  transactionFee?: number;
}

export interface TransferInput {
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  description?: string;
  transactionFee?: number;
  imagePath?: string | null;
  createdBy?: number;
  tagIds?: number[];
  currencyCode?: string;
  createdAt?: string;
  entryDate?: string | null;
}

export type ExpenseType = 'expense' | 'income';

export interface Expense {
  id: number;
  accountId: number;
  accountName?: string;
  amount: number;
  currencyCode: string;
  description?: string;
  imagePath?: string;
  type: ExpenseType;
  createdBy?: number;
  createdByName?: string;
  createdAt: string;
  entryDate?: string | null;
  updatedBy?: number;
  updatedByName?: string;
  updatedAt?: string;
  deletedBy?: number;
  deletedByName?: string;
  deletedAt?: string;
  tags?: Tag[];
}

export interface ExpenseInput {
  accountId: number;
  amount: number;
  description?: string;
  imagePath?: string;
  type?: ExpenseType;
  createdBy?: number;
  tagIds?: number[];
  currencyCode?: string;
  createdAt?: string;
  entryDate?: string | null;
}

export interface ExpenseChange {
  id: number;
  expenseId: number;
  changedBy?: number;
  changedByName?: string;
  changedAt: string;
  accountId: number;
  accountName?: string;
  amount: number;
  description?: string;
  type?: ExpenseType;
}

export interface ProfitCalculation {
  id: number;
  name: string;
  targetCurrencyCode: string;
  initialInvestment: number;
  groups?: string[];
  isDefault?: number | boolean;
  useLinkedDepositExchangeRates?: number | boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfitAccountMultiplier {
  id: number;
  profitCalculationId: number;
  accountId: number;
  accountName?: string;
  currencyCode?: string;
  currencyName?: string;
  balance?: number;
  multiplier: number;
  groupId?: string | null;
  groupName?: string | null;
  createdAt: string;
}

export interface ProfitExchangeRate {
  id: number;
  profitCalculationId: number;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: number;
  createdAt: string;
}

export interface ProfitCalculationDetails extends ProfitCalculation {
  multipliers: ProfitAccountMultiplier[];
  exchangeRates: ProfitExchangeRate[];
  depositExchangeRates: ProfitExchangeRate[];
}

export interface CustomerDepositTotalByCurrency {
  currencyCode: string;
  totalFundedBalance: number;
  totalPrepaid?: number;
  totalAdvance?: number;
}

export interface CustomerDepositTotalsResponse {
  currencies: CustomerDepositTotalByCurrency[];
}

export interface CustomerDepositCustomerRow {
  customerId: number;
  customerName: string;
  fundedBalance: number;
  allocatable: number;
  allocatableAdvance: number;
}

export interface CustomerDepositCurrencyRow {
  currencyCode: string;
  totalFundedBalance: number;
  totalPrepaid?: number;
  totalAdvance?: number;
  customers: CustomerDepositCustomerRow[];
}

export interface CustomerDepositByCurrencyResponse {
  targetCurrency: string | null;
  totalConverted: number | null;
  totalPrepaidConverted?: number | null;
  totalAdvanceConverted?: number | null;
  hasUnknownRate: boolean;
  currencies: CustomerDepositCurrencyRow[];
}

export interface CustomerDepositTraceEntry {
  id: number;
  type: "credit" | "debit";
  amount: number;
  description?: string | null;
  entryDate?: string | null;
  createdAt: string;
  accountId?: number | null;
  accountName?: string | null;
}

export interface CustomerLedgerEntry {
  id: number;
  customerId: number;
  customerName?: string;
  currencyCode: string;
  type: "credit" | "debit";
  amount: number;
  description?: string;
  createdBy?: number;
  createdByName?: string;
  createdAt: string;
  entryDate?: string | null;
  updatedBy?: number;
  updatedByName?: string;
  updatedAt?: string;
  deletedBy?: number;
  deletedByName?: string;
  deletedAt?: string;
  orderId?: number | null;
  source?: "manual" | "order" | "order_reversal";
  reversalReason?: "cancelled" | "deleted" | "adjusted" | null;
  leg?: "receipt" | "payment" | "service_charge" | null;
  ledgerBatch?: number | null;
  reversesBatch?: number | null;
  accountId?: number | null;
  accountName?: string | null;
}

export type AccountStatementActivityFilter = "all" | "funding" | "trade";

interface CustomerAccountStatementRowBase {
  activityDate: string;
  description: string;
  createdByName: string | null;
  isReversal: boolean;
}

export interface CustomerAccountStatementTradeRow extends CustomerAccountStatementRowBase {
  activity: "trade";
  orderId: number;
  currencyPair: string;
  exchangeRate: number | null;
  creditAmount: number | null;
  creditCurrency: string | null;
  debitAmount: number | null;
  debitCurrency: string | null;
  serviceCharges: string | null;
  remarks: string | null;
  ledgerBatch: number;
  source: "order" | "order_reversal";
  reversalReason: "cancelled" | "deleted" | "adjusted" | null;
}

export interface CustomerAccountStatementFundingRow extends CustomerAccountStatementRowBase {
  activity: "funding";
  entryId: number;
  fundingType: "deposit" | "withdrawal";
  currencyCode: string;
  amount: number;
  accountName: string | null;
}

export type CustomerAccountStatementRow =
  | CustomerAccountStatementTradeRow
  | CustomerAccountStatementFundingRow;

export interface FundingEffect {
  currencyCode: string;
  delta: number;
}

/** Enriched row for bank-style deposit account statement (running funding balance). */
export interface CustomerDepositStatementFundingRow extends CustomerAccountStatementFundingRow {
  fundingEffects: FundingEffect[];
  usesDeposit: boolean;
  prepaidUsed: null;
  depositCredited: null;
  serviceChargeFromDeposit: [];
  orderMode: null;
}

export interface CustomerDepositStatementTradeRow extends CustomerAccountStatementTradeRow {
  orderMode: "exchange" | "ledger_swap";
  prepaidUsed: { amount: number; currency: string } | null;
  depositCredited: { amount: number; currency: string } | null;
  serviceChargeFromDeposit: { amount: number; currency: string }[];
  fundingEffects: FundingEffect[];
  usesDeposit: boolean;
}

export type CustomerDepositStatementRow =
  | CustomerDepositStatementFundingRow
  | CustomerDepositStatementTradeRow;

export type CustomerDepositStatementRowWithBalance = CustomerDepositStatementRow & {
  runningBalances: Record<string, number>;
};

export interface CustomerLedgerEntryInput {
  customerId: number;
  currencyCode: string;
  type: "credit" | "debit";
  amount: number;
  accountId: number;
  description?: string;
  entryDate?: string | null;
}

export interface CustomerFundingBalanceRow {
  currencyCode: string;
  fundedBalance: number;
  allocatable: number;
  allocatableAdvance: number;
  convertedAmount: number | null;
}

export interface CustomerFundingBalances {
  targetCurrency: string | null;
  totalConverted: number | null;
  hasUnknownRate: boolean;
  currencies: CustomerFundingBalanceRow[];
}

/** @deprecated Use CustomerFundingBalanceRow from funding-balances API */
export type CustomerFundingSummaryItem = CustomerFundingBalanceRow;

export interface CustomerLedgerBalanceInfo {
  currencyCode: string;
  /** Total ledger balance (deposits/withdrawals + trades). */
  balance: number;
  /** Net funding after Bal usage on completed orders (not raw manual-only). */
  fundedBalance: number;
  /** Manual deposits/withdrawals only, before order Bal consumption. */
  manualFundedBalance?: number;
  /** Net from order / reversal postings. */
  tradePosition: number;
  /** Prepaid (deposit) available for receipt Bal — funded only. */
  allocatable: number;
  reserved: number;
  /** Advance to settle (funded negative balance) available for payment Bal. */
  allocatableAdvance?: number;
  reservedAdvance?: number;
}

export interface CustomerLedgerChange {
  id: number;
  entryId: number;
  changedBy?: number;
  changedByName?: string;
  changedAt: string;
  type: "credit" | "debit";
  amount: number;
  description?: string;
  currencyCode: string;
}

export interface CustomerLedgerSummary {
  currencyCode: string;
  totalCredit: number;
  totalDebit: number;
  balance: number;
}

export interface CustomerConvertedBalance {
  customerId: number;
  /** Company P/L from trades only (excludes funding), in target currency. */
  profitLoss: number;
  hasUnknownRate: boolean;
  /** Per-currency trade position (customer sign); negate for company view. */
  currencyBreakdown: Array<{ currencyCode: string; balance: number }>;
}

export interface AllCustomersConvertedBalances {
  targetCurrency: string | null;
  result: CustomerConvertedBalance[];
}

export interface CustomerFundingConvertedRow {
  customerId: number;
  totalBalance: number;
  hasUnknownRate: boolean;
  currencyBreakdown: Array<{ currencyCode: string; fundedBalance: number }>;
}

export interface AllCustomersFundingConverted {
  targetCurrency: string | null;
  result: CustomerFundingConvertedRow[];
}

/** Trade-only P/L for one customer (same logic as customer list Profit/Loss). */
export interface CustomerTradeProfitLoss {
  targetCurrency: string | null;
  profitLoss: number | null;
  hasUnknownRate: boolean;
  currencyBreakdown: Array<{ currencyCode: string; balance: number }>;
}

// Notification types
export type NotificationType = 
  | 'approval_approved'
  | 'approval_rejected'
  | 'approval_pending'
  | 'order_assigned'
  | 'order_unassigned'
  | 'order_created'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_deleted'
  | 'expense_created'
  | 'expense_deleted'
  | 'transfer_created'
  | 'transfer_deleted';

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: number;
  actionUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  id?: number;
  userId?: number;
  notifyApprovalApproved: boolean;
  notifyApprovalRejected: boolean;
  notifyApprovalPending: boolean;
  notifyOrderAssigned: boolean;
  notifyOrderUnassigned: boolean;
  notifyOrderCreated: boolean;
  notifyOrderCompleted: boolean;
  notifyOrderCancelled: boolean;
  notifyOrderDeleted: boolean;
  notifyExpenseCreated: boolean;
  notifyExpenseDeleted: boolean;
  notifyTransferCreated: boolean;
  notifyTransferDeleted: boolean;
  notifyWalletIncoming: boolean;
  notifyWalletOutgoing: boolean;
  enableEmailNotifications: boolean;
  enablePushNotifications: boolean;
  enableTelegramNotifications: boolean;
  updatedAt?: string;
}

// ─── Customer KYC v1 (legacy flat schema) ────────────────────────
export type KycFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";

export interface KycSchemaField {
  key: string;
  label: string;
  labelZh?: string;
  labelEn?: string;
  type: KycFieldType;
  required?: boolean;
  options?: string[];
  optionsZh?: string[];
  optionsEn?: string[];
  placeholder?: string;
  placeholderZh?: string;
  placeholderEn?: string;
}

export interface KycRequiredDocument {
  code: string;
  label: string;
  labelZh?: string;
  labelEn?: string;
}

export interface CustomerKycSchema {
  version: number;
  title?: string;
  titleZh?: string;
  titleEn?: string;
  fields: KycSchemaField[];
  requiredDocuments?: KycRequiredDocument[];
}

// ─── Customer KYC v2 (section-based builder schema) ──────────────

export type KycV2FieldType = "text" | "textarea" | "number" | "date" | "select" | "radio" | "checkbox" | "file" | "statement";

export interface KycV2FieldOption {
  value: string;
  labelEn: string;
  labelZh?: string;
}

export interface KycV2Field {
  id: string;
  key: string;
  type: KycV2FieldType;
  labelEn: string;
  labelZh?: string;
  placeholderEn?: string;
  placeholderZh?: string;
  required?: boolean;
  options?: KycV2FieldOption[];
  helpTextEn?: string;
  helpTextZh?: string;
  width?: "half" | "full";
}

export interface KycV2Section {
  id: string;
  titleEn: string;
  titleZh?: string;
  order: number;
  fields: KycV2Field[];
}

export interface KycV2Document {
  id: string;
  code: string;
  labelEn: string;
  labelZh?: string;
  required?: boolean;
}

export interface KycV2Schema {
  schemaType: "v2";
  titleEn: string;
  titleZh?: string;
  sections: KycV2Section[];
  documents: KycV2Document[];
}

export interface KycSchemaVersion {
  id: number;
  customerType: CustomerType;
  version: number;
  status: "draft" | "published";
  schema: KycV2Schema;
  schemaJson?: string;
  publishedAt?: string | null;
  publishedBy?: number | null;
  createdAt: string;
}

export interface KycBuilderResponse {
  draft: KycSchemaVersion | null;
  published: KycSchemaVersion | null;
  versions: Omit<KycSchemaVersion, "schema">[];
}

export type KycStatus = "draft" | "submitted" | "approved" | "rejected";

export interface CustomerKycProfileDto {
  id: number;
  customerId: number;
  schemaVersion: number;
  answers: Record<string, unknown>;
  status: KycStatus;
  submittedAt?: string | null;
  submittedBy?: number | null;
  reviewedAt?: string | null;
  reviewedBy?: number | null;
  rejectionReason?: string | null;
  updatedAt?: string | null;
}

export interface CustomerKycDocumentDto {
  id: number;
  customerId: number;
  profileId: number;
  documentCode: string;
  filePath: string;
  originalName?: string | null;
  mimeType?: string | null;
  uploadedBy?: number | null;
  createdAt: string;
  fileUrl?: string | null;
}

export interface CustomerKycResponse {
  customer: Customer;
  schema: CustomerKycSchema;
  profile: CustomerKycProfileDto;
  documents: CustomerKycDocumentDto[];
}


