import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  Currency,
  Customer,
  CustomerOptionsResponse,
  CustomerType,
  CustomerListResponse,
  CustomerListSortField,
  CustomerListSortDir,
  User,
  Role,
  Order,
  OrderInput,
  OrderStatus,
  OrderReceipt,
  OrderBeneficiary,
  OrderPayment,
  OrderProfit,
  OrderServiceCharge,
  CustomerBeneficiary,
  AuthResponse,
  Account,
  AccountSummary,
  AccountTransaction,
  Transfer,
  TransferInput,
  TransferChange,
  Expense,
  ExpenseInput,
  ExpenseChange,
  ProfitCalculation,
  ProfitCalculationDetails,
  ProfitAccountMultiplier,
  ProfitExchangeRate,
  Tag,
  TagInput,
  Notification,
  NotificationPreferences,
  CustomerLedgerEntry,
  CustomerLedgerEntryInput,
  CustomerLedgerChange,
  CustomerLedgerSummary,
  CustomerFundingBalances,
  CustomerFundingBalanceRow,
  CustomerLedgerBalanceInfo,
  ReceiptFundedFrom,
  CustomerAccountStatementRow,
  AccountStatementActivityFilter,
  AllCustomersConvertedBalances,
  AllCustomersFundingConverted,
  CustomerTradeProfitLoss,
  CustomerKycSchema,
  CustomerKycResponse,
  CustomerKycProfileDto,
  CustomerKycDocumentDto,
  KycStatus,
  KycBuilderResponse,
  KycSchemaVersion,
  KycV2Schema,
  CustomerType,
  ReferenceRatesResponse,
  ReferenceRatesUpdatePayload,
} from "../types";
import {
  APP_DOCUMENT_TITLE_EN_KEY,
  APP_DOCUMENT_TITLE_ZH_KEY,
  APP_FAVICON_PATH_KEY,
} from "../constants/appBrandSettings";

export type LoginResponse =
  | AuthResponse
  | { requiresTwoFactor: true; pendingToken: string; email: string };

export interface TwoFactorSetupResponse {
  qrCodeDataUrl: string;
  manualEntryKey: string;
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: "/api",
  credentials: "include",
});

const baseQuery: typeof rawBaseQuery = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error && result.error.status === 401) {
    const url = typeof args === "string" ? args : args.url;
    if (
      !url.includes("auth/login") &&
      !url.includes("auth/verify-2fa") &&
      !url.includes("auth/forgot-password") &&
      !url.includes("auth/reset-password")
    ) {
      localStorage.removeItem("auth_user");
    }
  }
  return result;
};

function customerLedgerTagsForCustomer(customerId: number) {
  return [
    { type: "CustomerLedger" as const, id: `LIST-${customerId}` },
    { type: "CustomerLedger" as const, id: `SUMMARY-${customerId}` },
    { type: "CustomerLedger" as const, id: `FUNDING-BALANCES-${customerId}` },
    { type: "CustomerLedger" as const, id: `FUNDING-SUMMARY-${customerId}` },
    { type: "CustomerLedger" as const, id: `ACCOUNT-STATEMENT-${customerId}` },
    { type: "CustomerLedger" as const, id: `BALANCE-${customerId}` },
    { type: "CustomerLedger" as const, id: `TRADE-PROFIT-${customerId}` },
    { type: "CustomerLedger" as const, id: "CONVERTED-BALANCES" },
    { type: "CustomerLedger" as const, id: "FUNDING-CONVERTED-BALANCES" },
    { type: "Customer" as const, id: "LIST" },
  ];
}

export const api = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: ["Currency", "Customer", "CustomerBeneficiary", "CustomerLedger", "CustomerKyc", "User", "Role", "Order", "Auth", "Account", "Transfer", "Expense", "ProfitCalculation", "Setting", "PublicBranding", "Tag", "Notification", "Wallet", "ReferenceRates", "Integration", "AmlCheck"],
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    getCurrencies: builder.query<Currency[], void>({
      query: () => "currencies",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Currency" as const, id })),
              { type: "Currency" as const, id: "LIST" },
            ]
          : [{ type: "Currency" as const, id: "LIST" }],
    }),
    addCurrency: builder.mutation<Currency, Omit<Currency, "id">>({
      query: (body) => ({
        url: "currencies",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Currency", id: "LIST" }],
    }),
    deleteCurrency: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `currencies/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Currency", id },
        { type: "Currency", id: "LIST" },
      ],
    }),
    updateCurrency: builder.mutation<
      Currency,
      { id: number; data: Partial<Currency> }
    >({
      query: ({ id, data }) => ({
        url: `currencies/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Currency", id },
        { type: "Currency", id: "LIST" },
      ],
    }),
    getCustomers: builder.query<
      CustomerListResponse,
      | {
          page?: number;
          limit?: number;
          search?: string;
          sortBy?: CustomerListSortField;
          sortDir?: CustomerListSortDir;
          customerType?: "individual" | "corporate";
          kycStatus?: "none" | "submitted" | "approved" | "rejected";
        }
      | void
    >({
      query: (arg) => {
        const params = new URLSearchParams();
        if (arg && arg.page != null) params.set("page", String(arg.page));
        if (arg && arg.limit != null) params.set("limit", String(arg.limit));
        if (arg && arg.search != null && arg.search.trim() !== "")
          params.set("search", arg.search.trim());
        if (arg?.sortBy) params.set("sortBy", arg.sortBy);
        if (arg?.sortDir) params.set("sortDir", arg.sortDir);
        if (arg?.customerType) params.set("customerType", arg.customerType);
        if (arg?.kycStatus) params.set("kycStatus", arg.kycStatus);
        const qs = params.toString();
        return qs ? `customers?${qs}` : "customers";
      },
      providesTags: (result) =>
        result?.customers?.length
          ? [
              ...result.customers.map(({ id }) => ({
                type: "Customer" as const,
                id,
              })),
              { type: "Customer" as const, id: "LIST" },
              { type: "Customer" as const, id: "PINS" },
            ]
          : [
              { type: "Customer" as const, id: "LIST" },
              { type: "Customer" as const, id: "PINS" },
            ],
    }),
    getCustomerOptions: builder.query<CustomerOptionsResponse, void>({
      query: () => "customers/options",
      providesTags: [{ type: "Customer", id: "OPTIONS" }],
    }),
    getCustomerPins: builder.query<{ customerIds: number[] }, void>({
      query: () => "customers/pins",
      providesTags: [{ type: "Customer" as const, id: "PINS" }],
    }),
    pinCustomer: builder.mutation<{ success: boolean; customerIds: number[] }, number>({
      query: (id) => ({ url: `customers/${id}/pin`, method: "POST" }),
      invalidatesTags: [
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "PINS" },
      ],
    }),
    unpinCustomer: builder.mutation<{ success: boolean; customerIds: number[] }, number>({
      query: (id) => ({ url: `customers/${id}/pin`, method: "DELETE" }),
      invalidatesTags: [
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "PINS" },
      ],
    }),
    reorderPinnedCustomers: builder.mutation<
      { success: boolean; customerIds: number[] },
      { customerIds: number[] }
    >({
      query: (body) => ({ url: "customers/pins/reorder", method: "PUT", body }),
      invalidatesTags: [
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "PINS" },
      ],
    }),
    addCustomer: builder.mutation<
      Customer,
      Omit<Customer, "id"> & { id?: number }
    >({
      query: (body) => ({
        url: "customers",
        method: "POST",
        body,
      }),
      invalidatesTags: [
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "OPTIONS" },
      ],
    }),
    updateCustomer: builder.mutation<
      Customer,
      { id: number; data: Partial<Customer> }
    >({
      query: ({ id, data }) => ({
        url: `customers/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Customer", id },
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "OPTIONS" },
        { type: "CustomerKyc", id },
      ],
    }),
    deleteCustomer: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `customers/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Customer", id },
        { type: "Customer", id: "LIST" },
        { type: "Customer", id: "OPTIONS" },
      ],
    }),
    getCustomerBeneficiaries: builder.query<CustomerBeneficiary[], number>({
      query: (id) => `customers/${id}/beneficiaries`,
      providesTags: (result, _err, id) =>
        result
          ? [
              ...result.map(({ id: beneficiaryId }) => ({
                type: "CustomerBeneficiary" as const,
                id: beneficiaryId,
              })),
              { type: "CustomerBeneficiary" as const, id: `LIST-${id}` },
            ]
          : [{ type: "CustomerBeneficiary" as const, id: `LIST-${id}` }],
    }),
    addCustomerBeneficiary: builder.mutation<
      CustomerBeneficiary,
      {
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
      }
    >({
      query: ({ customerId, ...body }) => ({
        url: `customers/${customerId}/beneficiaries`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { customerId }) => [
        { type: "CustomerBeneficiary", id: `LIST-${customerId}` },
      ],
    }),
    updateCustomerBeneficiary: builder.mutation<
      CustomerBeneficiary,
      {
        customerId: number;
        beneficiaryId: number;
        paymentType: "CRYPTO" | "FIAT";
        networkChain?: string;
        walletAddresses?: string[];
        bankName?: string;
        accountTitle?: string;
        accountNumber?: string;
        accountIban?: string;
        swiftCode?: string;
        bankAddress?: string;
      }
    >({
      query: ({ customerId, beneficiaryId, ...body }) => ({
        url: `customers/${customerId}/beneficiaries/${beneficiaryId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { customerId, beneficiaryId }) => [
        { type: "CustomerBeneficiary", id: beneficiaryId },
        { type: "CustomerBeneficiary", id: `LIST-${customerId}` },
      ],
    }),
    deleteCustomerBeneficiary: builder.mutation<
      { success?: boolean },
      { customerId: number; beneficiaryId: number }
    >({
      query: ({ customerId, beneficiaryId }) => ({
        url: `customers/${customerId}/beneficiaries/${beneficiaryId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, { customerId, beneficiaryId }) => [
        { type: "CustomerBeneficiary", id: beneficiaryId },
        { type: "CustomerBeneficiary", id: `LIST-${customerId}` },
      ],
    }),

    // ─── Customer Ledger ───────────────────────────────────
    getAllCustomersConvertedBalances: builder.query<AllCustomersConvertedBalances, void>({
      query: () => "customers/ledger/converted-balances",
      providesTags: [{ type: "CustomerLedger" as const, id: "CONVERTED-BALANCES" }],
    }),
    getAllCustomersFundingConvertedBalances: builder.query<AllCustomersFundingConverted, void>({
      query: () => "customers/ledger/funding-converted-balances",
      providesTags: [{ type: "CustomerLedger" as const, id: "FUNDING-CONVERTED-BALANCES" }],
    }),
    getCustomerLedgerEntries: builder.query<
      CustomerLedgerEntry[],
      { customerId: number; currencyCode?: string; dateFrom?: string; dateTo?: string; showDeleted?: boolean }
    >({
      query: ({ customerId, ...params }) => {
        const search = new URLSearchParams();
        if (params.currencyCode) search.set("currencyCode", params.currencyCode);
        if (params.dateFrom) search.set("dateFrom", params.dateFrom);
        if (params.dateTo) search.set("dateTo", params.dateTo);
        if (params.showDeleted) search.set("showDeleted", "true");
        const qs = search.toString();
        return `customers/${customerId}/ledger${qs ? `?${qs}` : ""}`;
      },
      providesTags: (_res, _err, { customerId }) => [
        { type: "CustomerLedger" as const, id: `LIST-${customerId}` },
      ],
    }),
    getCustomerLedgerSummary: builder.query<CustomerLedgerSummary[], number>({
      query: (customerId) => `customers/${customerId}/ledger/summary`,
      providesTags: (_res, _err, customerId) => [
        { type: "CustomerLedger" as const, id: `SUMMARY-${customerId}` },
      ],
    }),
    getCustomerTradeProfitLoss: builder.query<CustomerTradeProfitLoss, number>({
      query: (customerId) => `customers/${customerId}/ledger/trade-profit-loss`,
      providesTags: (_res, _err, customerId) => [
        { type: "CustomerLedger" as const, id: `TRADE-PROFIT-${customerId}` },
        { type: "CustomerLedger" as const, id: "CONVERTED-BALANCES" },
      ],
    }),
    getCustomerFundingBalances: builder.query<CustomerFundingBalances, number>({
      query: (customerId) => `customers/${customerId}/ledger/funding-balances`,
      providesTags: (_res, _err, customerId) => [
        { type: "CustomerLedger" as const, id: `FUNDING-BALANCES-${customerId}` },
        { type: "CustomerLedger" as const, id: `FUNDING-SUMMARY-${customerId}` },
      ],
    }),
    getCustomerLedgerBalance: builder.query<
      CustomerLedgerBalanceInfo,
      { customerId: number; currencyCode: string }
    >({
      query: ({ customerId, currencyCode }) =>
        `customers/${customerId}/ledger/balance/${encodeURIComponent(currencyCode)}`,
      providesTags: (_res, _err, { customerId, currencyCode }) => [
        { type: "CustomerLedger" as const, id: `BALANCE-${customerId}-${currencyCode}` },
      ],
    }),
    getCustomerAccountStatement: builder.query<
      CustomerAccountStatementRow[],
      {
        customerId: number;
        activity?: AccountStatementActivityFilter;
        includeReversals?: boolean;
      }
    >({
      query: ({ customerId, activity = "all", includeReversals = false }) => {
        const params = new URLSearchParams();
        if (activity !== "all") params.set("activity", activity);
        if (includeReversals) params.set("includeReversals", "true");
        const qs = params.toString();
        return `customers/${customerId}/ledger/account-statement${qs ? `?${qs}` : ""}`;
      },
      providesTags: (_res, _err, { customerId }) => [
        { type: "CustomerLedger" as const, id: `ACCOUNT-STATEMENT-${customerId}` },
      ],
    }),
    rebuildCustomerLedgerFromOrders: builder.mutation<{ ordersProcessed: number }, number>({
      query: (customerId) => ({
        url: `customers/${customerId}/ledger/rebuild-from-orders`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, customerId) => [
        { type: "CustomerLedger", id: `LIST-${customerId}` },
        { type: "CustomerLedger", id: `SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-BALANCES-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `TRADE-PROFIT-${customerId}` },
        { type: "CustomerLedger", id: `ACCOUNT-STATEMENT-${customerId}` },
        { type: "CustomerLedger", id: "CONVERTED-BALANCES" },
        { type: "CustomerLedger", id: "FUNDING-CONVERTED-BALANCES" },
      ],
    }),
    createLedgerEntry: builder.mutation<CustomerLedgerEntry, CustomerLedgerEntryInput>({
      query: ({ customerId, ...body }) => ({
        url: `customers/${customerId}/ledger`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { customerId }) => [
        { type: "CustomerLedger", id: `LIST-${customerId}` },
        { type: "CustomerLedger", id: `SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-BALANCES-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `TRADE-PROFIT-${customerId}` },
        { type: "CustomerLedger", id: `ACCOUNT-STATEMENT-${customerId}` },
        { type: "CustomerLedger", id: "CONVERTED-BALANCES" },
        { type: "CustomerLedger", id: "FUNDING-CONVERTED-BALANCES" },
        { type: "Account", id: "LIST" },
        { type: "CustomerLedger", id: `BALANCE-${customerId}` },
      ],
    }),
    updateLedgerEntry: builder.mutation<
      CustomerLedgerEntry,
      { customerId: number; entryId: number; data: Partial<CustomerLedgerEntryInput> }
    >({
      query: ({ customerId, entryId, data }) => ({
        url: `customers/${customerId}/ledger/${entryId}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { customerId, entryId }) => [
        { type: "CustomerLedger", id: `LIST-${customerId}` },
        { type: "CustomerLedger", id: `SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-BALANCES-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `TRADE-PROFIT-${customerId}` },
        { type: "CustomerLedger", id: `ACCOUNT-STATEMENT-${customerId}` },
        { type: "CustomerLedger", id: entryId },
        { type: "CustomerLedger", id: "CONVERTED-BALANCES" },
        { type: "CustomerLedger", id: "FUNDING-CONVERTED-BALANCES" },
        { type: "Account", id: "LIST" },
        { type: "CustomerLedger", id: `BALANCE-${customerId}` },
      ],
    }),
    deleteLedgerEntry: builder.mutation<void, { customerId: number; entryId: number }>({
      query: ({ customerId, entryId }) => ({
        url: `customers/${customerId}/ledger/${entryId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, { customerId }) => [
        { type: "CustomerLedger", id: `LIST-${customerId}` },
        { type: "CustomerLedger", id: `SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-BALANCES-${customerId}` },
        { type: "CustomerLedger", id: `FUNDING-SUMMARY-${customerId}` },
        { type: "CustomerLedger", id: `TRADE-PROFIT-${customerId}` },
        { type: "CustomerLedger", id: `ACCOUNT-STATEMENT-${customerId}` },
        { type: "CustomerLedger", id: "CONVERTED-BALANCES" },
        { type: "CustomerLedger", id: "FUNDING-CONVERTED-BALANCES" },
        { type: "Account", id: "LIST" },
        { type: "CustomerLedger", id: `BALANCE-${customerId}` },
      ],
    }),
    getLedgerEntryChanges: builder.query<CustomerLedgerChange[], number>({
      query: (entryId) => `customers/ledger/${entryId}/changes`,
      providesTags: (_res, _err, entryId) => [
        { type: "CustomerLedger" as const, id: `CHANGES-${entryId}` },
      ],
    }),

    getKycSchema: builder.query<
      { schema: CustomerKycSchema; customerType: CustomerType },
      CustomerType
    >({
      query: (customerType) =>
        `kyc/schema?customerType=${encodeURIComponent(customerType)}`,
      providesTags: (_res, _err, customerType) => [
        { type: "Setting", id: `kyc_schema_${customerType}` },
      ],
    }),
    putKycSchema: builder.mutation<
      { schema: CustomerKycSchema; customerType: CustomerType; message?: string },
      { schema: CustomerKycSchema; customerType: CustomerType }
    >({
      query: (body) => ({
        url: "kyc/schema",
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { customerType }) => [
        { type: "Setting", id: `kyc_schema_${customerType}` },
        { type: "CustomerKyc", id: "LIST" },
      ],
    }),
    getCustomerKyc: builder.query<CustomerKycResponse, number>({
      query: (customerId) => `customers/${customerId}/kyc`,
      providesTags: (_res, _err, customerId) => [
        { type: "CustomerKyc" as const, id: customerId },
        { type: "CustomerKyc" as const, id: "LIST" },
        { type: "Customer" as const, id: customerId },
      ],
    }),
    updateCustomerKyc: builder.mutation<
      { profile: CustomerKycProfileDto; documents: CustomerKycDocumentDto[] },
      {
        customerId: number;
        answers?: Record<string, unknown>;
        status?: KycStatus;
        rejectionReason?: string;
      }
    >({
      query: ({ customerId, ...body }) => ({
        url: `customers/${customerId}/kyc`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { customerId }) => [
        { type: "CustomerKyc", id: customerId },
        { type: "Customer", id: customerId },
      ],
    }),
    uploadCustomerKycDocument: builder.mutation<
      { document: CustomerKycDocumentDto },
      { customerId: number; documentCode: string; file: File }
    >({
      query: ({ customerId, documentCode, file }) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("documentCode", documentCode);
        return {
          url: `customers/${customerId}/kyc/documents`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: (_res, _err, { customerId }) => [{ type: "CustomerKyc", id: customerId }],
    }),
    deleteCustomerKycDocument: builder.mutation<
      void,
      { customerId: number; documentId: number }
    >({
      query: ({ customerId, documentId }) => ({
        url: `customers/${customerId}/kyc/documents/${documentId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, { customerId }) => [{ type: "CustomerKyc", id: customerId }],
    }),

    // ── KYC Schema Builder v2 ──────────────────────────────────────────────

    getKycBuilderSchema: builder.query<KycBuilderResponse, CustomerType>({
      query: (customerType) => `kyc/builder/schema?customerType=${encodeURIComponent(customerType)}`,
      providesTags: (_res, _err, customerType) => [
        { type: "Setting", id: `kyc_builder_${customerType}` },
      ],
    }),
    putKycBuilderSchema: builder.mutation<
      { draft: KycSchemaVersion },
      { customerType: CustomerType; schema: KycV2Schema }
    >({
      query: (body) => ({ url: "kyc/builder/schema", method: "PUT", body }),
      invalidatesTags: (_res, _err, { customerType }) => [
        { type: "Setting", id: `kyc_builder_${customerType}` },
      ],
    }),
    publishKycBuilderSchema: builder.mutation<
      { published: KycSchemaVersion; message: string },
      { customerType: CustomerType }
    >({
      query: (body) => ({ url: "kyc/builder/schema/publish", method: "POST", body }),
      invalidatesTags: (_res, _err, { customerType }) => [
        { type: "Setting", id: `kyc_builder_${customerType}` },
        { type: "CustomerKyc", id: "LIST" },
      ],
    }),
    getKycBuilderVersions: builder.query<
      { versions: Omit<KycSchemaVersion, "schema">[] },
      CustomerType
    >({
      query: (customerType) =>
        `kyc/builder/schema/versions?customerType=${encodeURIComponent(customerType)}`,
      providesTags: (_res, _err, customerType) => [
        { type: "Setting", id: `kyc_builder_versions_${customerType}` },
      ],
    }),
    getKycBuilderSchemaVersion: builder.query<KycSchemaVersion, number>({
      query: (id) => `kyc/builder/schema/version/${id}`,
    }),
    deleteKycBuilderSchemaVersion: builder.mutation<{ message: string }, { id: number; customerType: CustomerType }>({
      query: ({ id }) => ({ url: `kyc/builder/schema/version/${id}`, method: "DELETE" }),
      invalidatesTags: (_res, _err, { customerType }) => [
        { type: "Setting", id: `kyc_builder_${customerType}` },
        { type: "Setting", id: `kyc_builder_versions_${customerType}` },
      ],
    }),

    login: builder.mutation<LoginResponse, { email: string; password: string }>({
      query: (body) => ({
        url: "auth/login",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Auth", id: "CURRENT" }],
    }),
    verify2fa: builder.mutation<AuthResponse, { pendingToken: string; code: string }>({
      query: (body) => ({
        url: "auth/verify-2fa",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Auth", id: "CURRENT" }],
    }),
    forgotPassword: builder.mutation<{ success: boolean; message: string }, { email: string }>({
      query: (body) => ({
        url: "auth/forgot-password",
        method: "POST",
        body,
      }),
    }),
    resetPassword: builder.mutation<
      { success: boolean; message: string },
      { email: string; code: string; newPassword: string }
    >({
      query: (body) => ({
        url: "auth/reset-password",
        method: "POST",
        body,
      }),
    }),
    logout: builder.mutation<{ success: boolean }, void>({
      query: () => ({
        url: "auth/logout",
        method: "POST",
      }),
    }),
    get2faStatus: builder.query<{ enabled: boolean }, void>({
      query: () => "auth/2fa/status",
    }),
    setup2fa: builder.mutation<TwoFactorSetupResponse, void>({
      query: () => ({
        url: "auth/2fa/setup",
        method: "POST",
      }),
    }),
    enable2fa: builder.mutation<{ success: boolean; enabled: boolean }, { code: string }>({
      query: (body) => ({
        url: "auth/2fa/enable",
        method: "POST",
        body,
      }),
    }),
    disable2fa: builder.mutation<{ success: boolean; enabled: boolean }, { code: string; password: string }>({
      query: (body) => ({
        url: "auth/2fa/disable",
        method: "POST",
        body,
      }),
    }),
    changePassword: builder.mutation<
      { success: boolean; message: string },
      { currentPassword: string; newPassword: string; code?: string }
    >({
      query: (body) => ({
        url: "auth/change-password",
        method: "POST",
        body,
      }),
    }),
    changeEmail: builder.mutation<
      { success: boolean; email: string; message: string },
      { newEmail: string; password: string; code?: string }
    >({
      query: (body) => ({
        url: "auth/change-email",
        method: "POST",
        body,
      }),
    }),
    getUsers: builder.query<User[], void>({
      query: () => "users",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "User" as const, id })),
              { type: "User" as const, id: "LIST" },
            ]
          : [{ type: "User" as const, id: "LIST" }],
    }),
    addUser: builder.mutation<User, Omit<User, "id">>({
      query: (body) => ({
        url: "users",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "User", id: "LIST" }],
    }),
    updateUser: builder.mutation<User, { id: number; data: Partial<User> }>({
      query: ({ id, data }) => ({
        url: `users/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "User", id },
        { type: "User", id: "LIST" },
      ],
    }),
    deleteUser: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `users/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "User", id },
        { type: "User", id: "LIST" },
      ],
    }),
    updateUserPreferences: builder.mutation<
      { id: number; sidebarBgColor?: string | null; displayBgColor?: string | null; themeHeaderBg?: string | null; themeCardBg?: string | null; themeBorder?: string | null; themeTextPrimary?: string | null; themeTextSecondary?: string | null; themeSidebarNavText?: string | null },
      { id: number; sidebarBgColor?: string | null; displayBgColor?: string | null; themeHeaderBg?: string | null; themeCardBg?: string | null; themeBorder?: string | null; themeTextPrimary?: string | null; themeTextSecondary?: string | null; themeSidebarNavText?: string | null }
    >({
      query: ({ id, ...body }) => ({
        url: `users/${id}/preferences`,
        method: "PATCH",
        body,
      }),
    }),
    getRoles: builder.query<Role[], void>({
      query: () => "roles",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Role" as const, id })),
              { type: "Role" as const, id: "LIST" },
            ]
          : [{ type: "Role", id: "LIST" }],
    }),
    addRole: builder.mutation<Role, Omit<Role, "id">>({
      query: (body) => ({
        url: "roles",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Role", id: "LIST" }],
    }),
    updateRole: builder.mutation<Role, { id: number; data: Partial<Role> }>({
      query: ({ id, data }) => ({
        url: `roles/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Role", id },
        { type: "Role", id: "LIST" },
      ],
    }),
    deleteRole: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `roles/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Role", id },
        { type: "Role", id: "LIST" },
      ],
    }),
    forceLogoutUsersByRole: builder.mutation<
      { success: boolean; message: string; userCount: number },
      number
    >({
      query: (id) => ({
        url: `roles/${id}/force-logout`,
        method: "POST",
      }),
      invalidatesTags: [{ type: "Role", id: "LIST" }],
    }),
    getOrders: builder.query<
      {
        orders: Order[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        totalCalculatedProfit: number | null;
        totalCalculatedProfitCurrency: string | null;
      },
      {
        dateFrom?: string;
        dateTo?: string;
        handlerId?: number;
        customerId?: number;
        currencyPairs?: string;
        accountId?: number;
        accountRole?: "any" | "buy" | "sell";
        status?: OrderStatus;
        orderType?: "online" | "otc";
        tagIds?: string;
        page?: number;
        limit?: number;
      }
    >({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.dateFrom) queryParams.append("dateFrom", params.dateFrom);
        if (params.dateTo) queryParams.append("dateTo", params.dateTo);
        if (params.handlerId !== undefined) queryParams.append("handlerId", params.handlerId.toString());
        if (params.customerId !== undefined) queryParams.append("customerId", params.customerId.toString());
        if (params.currencyPairs) queryParams.append("currencyPairs", params.currencyPairs);
        if (params.accountId !== undefined) queryParams.append("accountId", params.accountId.toString());
        if (params.accountRole && params.accountRole !== "any") {
          queryParams.append("accountRole", params.accountRole);
        }
        if (params.status) queryParams.append("status", params.status);
        if (params.orderType) queryParams.append("orderType", params.orderType);
        if (params.tagIds) queryParams.append("tagIds", params.tagIds);
        if (params.page !== undefined) queryParams.append("page", params.page.toString());
        if (params.limit !== undefined) queryParams.append("limit", params.limit.toString());
        const queryString = queryParams.toString();
        return `orders${queryString ? `?${queryString}` : ""}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.orders.map(({ id }) => ({ type: "Order" as const, id })),
              { type: "Order" as const, id: "LIST" },
            ]
          : [{ type: "Order", id: "LIST" }],
    }),
    exportOrders: builder.query<
      Order[],
      {
        dateFrom?: string;
        dateTo?: string;
        handlerId?: number;
        customerId?: number;
        currencyPairs?: string;
        accountId?: number;
        accountRole?: "any" | "buy" | "sell";
        status?: OrderStatus;
        orderType?: "online" | "otc";
        tagIds?: string;
      }
    >({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.dateFrom) queryParams.append("dateFrom", params.dateFrom);
        if (params.dateTo) queryParams.append("dateTo", params.dateTo);
        if (params.handlerId !== undefined) queryParams.append("handlerId", params.handlerId.toString());
        if (params.customerId !== undefined) queryParams.append("customerId", params.customerId.toString());
        if (params.currencyPairs) queryParams.append("currencyPairs", params.currencyPairs);
        if (params.accountId !== undefined) queryParams.append("accountId", params.accountId.toString());
        if (params.accountRole && params.accountRole !== "any") {
          queryParams.append("accountRole", params.accountRole);
        }
        if (params.status) queryParams.append("status", params.status);
        if (params.orderType) queryParams.append("orderType", params.orderType);
        if (params.tagIds) queryParams.append("tagIds", params.tagIds);
        const queryString = queryParams.toString();
        return `orders/export${queryString ? `?${queryString}` : ""}`;
      },
    }),
    getOrderPins: builder.query<{ orderIds: number[] }, void>({
      query: () => "orders/pins",
      providesTags: [{ type: "Order", id: "PINS" }],
    }),
    pinOrder: builder.mutation<{ success: boolean; orderIds: number[] }, number>({
      query: (id) => ({
        url: `orders/${id}/pin`,
        method: "POST",
      }),
      invalidatesTags: [
        { type: "Order", id: "LIST" },
        { type: "Order", id: "PINS" },
      ],
    }),
    unpinOrder: builder.mutation<{ success: boolean; orderIds: number[] }, number>({
      query: (id) => ({
        url: `orders/${id}/pin`,
        method: "DELETE",
      }),
      invalidatesTags: [
        { type: "Order", id: "LIST" },
        { type: "Order", id: "PINS" },
      ],
    }),
    reorderPinnedOrders: builder.mutation<
      { success: boolean; orderIds: number[] },
      { orderIds: number[] }
    >({
      query: (body) => ({
        url: "orders/pins/reorder",
        method: "PUT",
        body,
      }),
      invalidatesTags: [
        { type: "Order", id: "LIST" },
        { type: "Order", id: "PINS" },
      ],
    }),
    addOrder: builder.mutation<Order, OrderInput>({
      query: (body) => ({
        url: "orders",
        method: "POST",
        body,
      }),
      invalidatesTags: (res) => {
        const tags: Array<{ type: "Order" | "CustomerLedger"; id: number | string }> = [
          { type: "Order", id: "LIST" },
        ];
        if (res?.customerId) tags.push(...customerLedgerTagsForCustomer(res.customerId));
        return tags;
      },
    }),
    updateOrder: builder.mutation<
      Order,
      { id: number; data: Partial<OrderInput> }
    >({
      query: ({ id, data }) => ({
        url: `orders/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (res, _err, { id }) => {
        const tags: Array<{ type: "Order" | "CustomerLedger"; id: number | string }> = [
          { type: "Order", id },
          { type: "Order", id: "LIST" },
        ];
        if (res?.customerId) tags.push(...customerLedgerTagsForCustomer(res.customerId));
        return tags;
      },
    }),
    updateOrderStatus: builder.mutation<
      Order & { affectedAccountIds?: number[] },
      { id: number; status: OrderStatus }
    >({
      query: ({ id, status }) => ({
        url: `orders/${id}/status`,
        method: "PATCH",
        body: { status },
      }),
      invalidatesTags: (res, _err, { id }) => {
        const tags: Array<{ type: "Order" | "Account" | "CustomerLedger"; id: number | string }> = [
          { type: "Order", id },
          { type: "Order", id: "LIST" },
        ];
        if (res?.customerId) tags.push(...customerLedgerTagsForCustomer(res.customerId));
        if (res?.affectedAccountIds?.length) {
          tags.push({ type: "Account", id: "LIST" });
          res.affectedAccountIds.forEach((accountId) => {
            tags.push({ type: "Account", id: accountId });
          });
        }
        return tags;
      },
    }),
    deleteOrder: builder.mutation<{ success: boolean; affectedAccountIds?: number[] }, number>({
      query: (id) => ({
        url: `orders/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, _err, id) => {
        const tags: Array<{ type: "Order" | "Account"; id: number | "LIST" | "PINS" }> = [
          { type: "Order", id },
          { type: "Order", id: "LIST" },
          { type: "Order", id: "PINS" },
          { type: "Account", id: "LIST" }, // Invalidate account list to refresh balances
        ];
        
        // Invalidate specific account transaction caches for affected accounts
        if (res?.affectedAccountIds) {
          res.affectedAccountIds.forEach((accountId) => {
            tags.push({ type: "Account", id: accountId });
          });
        }
        
        return tags;
      },
    }),
    getOrderDetails: builder.query<
      {
        order: Order;
        receipts: OrderReceipt[];
        beneficiaries: OrderBeneficiary[];
        payments: OrderPayment[];
        profits: OrderProfit[];
        serviceCharges: OrderServiceCharge[];
        totalReceiptAmount: number;
        totalPaymentAmount: number;
        receiptBalance: number;
        paymentBalance: number;
      },
      number
    >({
      query: (id) => `orders/${id}/details`,
      providesTags: (_res, _err, id) => [{ type: "Order", id }],
    }),
    processOrder: builder.mutation<
      Order,
      {
        id: number;
        handlerId: number;
        paymentFlow?: "receive_first" | "pay_first";
        // Commented out for future use:
        // paymentType: "CRYPTO" | "FIAT";
        // networkChain?: string;
        // walletAddresses?: string[];
        // bankDetails?: {
        //   bankName?: string;
        //   accountTitle?: string;
        //   accountNumber?: string;
        //   accountIban?: string;
        //   swiftCode?: string;
        //   bankAddress?: string;
        // };
      }
    >({
      query: ({ id, ...body }) => ({
        url: `orders/${id}/process`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Order", id },
        { type: "Order", id: "LIST" },
      ],
    }),
    addReceipt: builder.mutation<
      OrderReceipt,
      {
        id: number;
        file?: File;
        imagePath?: string;
        amount: number;
        accountId?: number;
        fundedFrom?: ReceiptFundedFrom;
      }
    >({
      query: ({ id, file, imagePath, ...body }) => {
        if (file) {
          // Use FormData for file upload
          const formData = new FormData();
          formData.append("file", file);
          formData.append("amount", String(body.amount));
          if (body.accountId !== undefined) {
            formData.append("accountId", String(body.accountId));
          }
          if (body.fundedFrom) {
            formData.append("fundedFrom", body.fundedFrom);
          }
          return {
            url: `orders/${id}/receipts`,
            method: "POST",
            body: formData,
          };
        } else {
          // Backward compatibility: use JSON with base64
          return {
            url: `orders/${id}/receipts`,
            method: "POST",
            body: { ...body, imagePath },
          };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Order", id },
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    addBeneficiary: builder.mutation<
      { success: boolean; message?: string },
      {
        id: number;
        paymentAccountId: number;
        // Commented out for future use:
        // paymentType: "CRYPTO" | "FIAT";
        // networkChain?: string;
        // walletAddresses?: string[];
        // bankName?: string;
        // accountTitle?: string;
        // accountNumber?: string;
        // accountIban?: string;
        // swiftCode?: string;
        // bankAddress?: string;
      }
    >({
      query: ({ id, ...body }) => ({
        url: `orders/${id}/beneficiaries`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Order", id },
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    addPayment: builder.mutation<
      OrderPayment,
      {
        id: number;
        file?: File;
        imagePath?: string;
        amount: number;
        accountId?: number;
        fundedFrom?: ReceiptFundedFrom;
      }
    >({
      query: ({ id, file, imagePath, ...body }) => {
        if (file) {
          // Use FormData for file upload
          const formData = new FormData();
          formData.append("file", file);
          formData.append("amount", String(body.amount));
          if (body.accountId !== undefined) {
            formData.append("accountId", String(body.accountId));
          }
          if (body.fundedFrom) {
            formData.append("fundedFrom", body.fundedFrom);
          }
          return {
            url: `orders/${id}/payments`,
            method: "POST",
            body: formData,
          };
        } else {
          // Backward compatibility: use JSON with base64
          return {
            url: `orders/${id}/payments`,
            method: "POST",
            body: { ...body, imagePath },
          };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Order", id },
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    updateReceipt: builder.mutation<
      OrderReceipt,
      { receiptId: number; file?: File; amount?: number; accountId?: number }
    >({
      query: ({ receiptId, file, ...body }) => {
        if (file) {
          const formData = new FormData();
          formData.append("file", file);
          if (body.amount !== undefined) {
            formData.append("amount", String(body.amount));
          }
          if (body.accountId !== undefined) {
            formData.append("accountId", String(body.accountId));
          }
          return {
            url: `orders/receipts/${receiptId}`,
            method: "PUT",
            body: formData,
          };
        } else {
          return {
            url: `orders/receipts/${receiptId}`,
            method: "PUT",
            body,
          };
        }
      },
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order"; id: number | "LIST" } | { type: "Account"; id: "LIST" }> = [
          { type: "Order", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        if (result?.orderId != null) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    deleteReceipt: builder.mutation<{ success: boolean; orderId?: number }, number>({
      query: (receiptId) => ({
        url: `orders/receipts/${receiptId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order"; id: number | "LIST" }> = [
          { type: "Order", id: "LIST" },
        ];
        if (result?.orderId) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    confirmReceipt: builder.mutation<OrderReceipt, number>({
      query: (receiptId) => ({
        url: `orders/receipts/${receiptId}/confirm`,
        method: "POST",
      }),
      invalidatesTags: (result) => {
        if (result) {
          return [
            { type: "Order", id: result.orderId },
            { type: "Order", id: "LIST" },
            { type: "Account", id: "LIST" },
          ];
        }
        return [{ type: "Order", id: "LIST" }, { type: "Account", id: "LIST" }];
      },
    }),
    updatePayment: builder.mutation<
      OrderPayment,
      { paymentId: number; file?: File; amount?: number; accountId?: number }
    >({
      query: ({ paymentId, file, ...body }) => {
        if (file) {
          const formData = new FormData();
          formData.append("file", file);
          if (body.amount !== undefined) {
            formData.append("amount", String(body.amount));
          }
          if (body.accountId !== undefined) {
            formData.append("accountId", String(body.accountId));
          }
          return {
            url: `orders/payments/${paymentId}`,
            method: "PUT",
            body: formData,
          };
        } else {
          return {
            url: `orders/payments/${paymentId}`,
            method: "PUT",
            body,
          };
        }
      },
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order"; id: number | "LIST" } | { type: "Account"; id: "LIST" }> = [
          { type: "Order", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        if (result?.orderId != null) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    deletePayment: builder.mutation<{ success: boolean; orderId?: number }, number>({
      query: (paymentId) => ({
        url: `orders/payments/${paymentId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order"; id: number | "LIST" }> = [
          { type: "Order", id: "LIST" },
        ];
        if (result?.orderId) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    confirmPayment: builder.mutation<OrderPayment, number>({
      query: (paymentId) => ({
        url: `orders/payments/${paymentId}/confirm`,
        method: "POST",
      }),
      invalidatesTags: (result) => {
        if (result) {
          return [
            { type: "Order", id: result.orderId },
            { type: "Order", id: "LIST" },
            { type: "Account", id: "LIST" },
          ];
        }
        return [{ type: "Order", id: "LIST" }, { type: "Account", id: "LIST" }];
      },
    }),
    addProfitToOrder: builder.mutation<
      OrderProfit,
      { orderId: number; amount: number; currencyCode: string; accountId: number }
    >({
      query: ({ orderId, ...body }) => ({
        url: `orders/${orderId}/profits`,
        method: "POST",
        body,
      }),
      invalidatesTags: () => [
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    updateProfit: builder.mutation<
      OrderProfit,
      { profitId: number; amount?: number; accountId?: number; currencyCode?: string }
    >({
      query: ({ profitId, ...body }) => ({
        url: `orders/profits/${profitId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: () => [
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    deleteProfit: builder.mutation<{ success: boolean; orderId?: number }, number>({
      query: (profitId) => ({
        url: `orders/profits/${profitId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order" | "Account"; id: number | "LIST" }> = [
          { type: "Order", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        if (result?.orderId) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    confirmProfit: builder.mutation<OrderProfit, number>({
      query: (profitId) => ({
        url: `orders/profits/${profitId}/confirm`,
        method: "POST",
      }),
      invalidatesTags: (result) => {
        if (result) {
          return [
            { type: "Order", id: result.orderId },
            { type: "Order", id: "LIST" },
            { type: "Account", id: "LIST" },
          ];
        }
        return [{ type: "Order", id: "LIST" }, { type: "Account", id: "LIST" }];
      },
    }),
    addServiceChargeToOrder: builder.mutation<
      OrderServiceCharge,
      { orderId: number; amount: number; currencyCode: string; accountId: number }
    >({
      query: ({ orderId, ...body }) => ({
        url: `orders/${orderId}/service-charges`,
        method: "POST",
        body,
      }),
      invalidatesTags: () => [
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    updateServiceCharge: builder.mutation<
      OrderServiceCharge,
      { serviceChargeId: number; amount?: number; accountId?: number; currencyCode?: string }
    >({
      query: ({ serviceChargeId, ...body }) => ({
        url: `orders/service-charges/${serviceChargeId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: () => [
        { type: "Order", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    deleteServiceCharge: builder.mutation<{ success: boolean; orderId?: number }, number>({
      query: (serviceChargeId) => ({
        url: `orders/service-charges/${serviceChargeId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Order" | "Account"; id: number | "LIST" }> = [
          { type: "Order", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        if (result?.orderId) {
          tags.push({ type: "Order", id: result.orderId });
        }
        return tags;
      },
    }),
    confirmServiceCharge: builder.mutation<OrderServiceCharge, number>({
      query: (serviceChargeId) => ({
        url: `orders/service-charges/${serviceChargeId}/confirm`,
        method: "POST",
      }),
      invalidatesTags: (result) => {
        if (result) {
          return [
            { type: "Order", id: result.orderId },
            { type: "Order", id: "LIST" },
            { type: "Account", id: "LIST" },
          ];
        }
        return [{ type: "Order", id: "LIST" }, { type: "Account", id: "LIST" }];
      },
    }),
    getAccounts: builder.query<Account[], { scope?: string } | void>({
      query: (arg) => {
        const params = new URLSearchParams();
        if (arg?.scope) params.set("scope", arg.scope);
        const qs = params.toString();
        return qs ? `accounts?${qs}` : "accounts";
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Account" as const, id })),
              { type: "Account" as const, id: "LIST" },
            ]
          : [{ type: "Account" as const, id: "LIST" }],
    }),
    getAccountsSummary: builder.query<AccountSummary[], void>({
      query: () => "accounts/summary",
      providesTags: [{ type: "Account", id: "LIST" }],
    }),
    getAccountsByCurrency: builder.query<Account[], string | { currencyCode: string; scope?: string }>({
      query: (arg) => {
        const currencyCode = typeof arg === "string" ? arg : arg.currencyCode;
        const params = new URLSearchParams();
        if (typeof arg !== "string" && arg.scope) params.set("scope", arg.scope);
        const qs = params.toString();
        return qs ? `accounts/currency/${currencyCode}?${qs}` : `accounts/currency/${currencyCode}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Account" as const, id })),
              { type: "Account" as const, id: "LIST" },
            ]
          : [{ type: "Account" as const, id: "LIST" }],
    }),
    createAccount: builder.mutation<
      Account,
      { currencyCode: string; name: string; initialFunds?: number }
    >({
      query: (body) => ({
        url: "accounts",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Account", id: "LIST" }],
    }),
    updateAccount: builder.mutation<Account, { id: number; name: string; balance?: number; displayBgColor?: string | null; displayTextColor?: string | null }>({
      query: ({ id, ...body }) => ({
        url: `accounts/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Account", id },
        { type: "Account", id: "LIST" },
      ],
    }),
    deleteAccount: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `accounts/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Account", id },
        { type: "Account", id: "LIST" },
      ],
    }),
    addFunds: builder.mutation<
      Account,
      { id: number; amount: number; description?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `accounts/${id}/add-funds`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Account", id },
        { type: "Account", id: "LIST" },
      ],
    }),
    withdrawFunds: builder.mutation<
      Account,
      { id: number; amount: number; description?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `accounts/${id}/withdraw-funds`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Account", id },
        { type: "Account", id: "LIST" },
      ],
    }),
    getAccountTransactions: builder.query<AccountTransaction[], number>({
      query: (id) => `accounts/${id}/transactions`,
      providesTags: (_res, _err, id) => [{ type: "Account", id }],
    }),
    clearAllTransactionLogs: builder.mutation<{ success: boolean; deletedCount: number; initialFundsLogged?: number; message: string }, void>({
      query: () => ({
        url: "accounts/transactions/clear-all",
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "Account", id: "LIST" }, { type: "Account" }],
    }),
    getTransfers: builder.query<
      Transfer[],
      {
        dateFrom?: string;
        dateTo?: string;
        fromAccountId?: number;
        toAccountId?: number;
        currencyCode?: string;
        createdBy?: number;
        tagIds?: string;
      }
    >({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.dateFrom) queryParams.append("dateFrom", params.dateFrom);
        if (params.dateTo) queryParams.append("dateTo", params.dateTo);
        if (params.fromAccountId !== undefined && params.fromAccountId !== null) queryParams.append("fromAccountId", params.fromAccountId.toString());
        if (params.toAccountId !== undefined && params.toAccountId !== null) queryParams.append("toAccountId", params.toAccountId.toString());
        if (params.currencyCode) queryParams.append("currencyCode", params.currencyCode);
        if (params.createdBy !== undefined && params.createdBy !== null) queryParams.append("createdBy", params.createdBy.toString());
        if (params.tagIds) queryParams.append("tagIds", params.tagIds);
        const queryString = queryParams.toString();
        return `transfers${queryString ? `?${queryString}` : ""}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Transfer" as const, id })),
              { type: "Transfer" as const, id: "LIST" },
            ]
          : [{ type: "Transfer", id: "LIST" }],
    }),
    createTransfer: builder.mutation<Transfer, TransferInput & { file?: File }>({
      query: ({ file, ...body }) => {
        if (file) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("fromAccountId", String(body.fromAccountId));
          formData.append("toAccountId", String(body.toAccountId));
          formData.append("amount", String(body.amount));
          formData.append("description", body.description || "");
          if (body.transactionFee !== undefined) formData.append("transactionFee", String(body.transactionFee));
          if (body.createdBy !== undefined) formData.append("createdBy", String(body.createdBy));
          if (body.entryDate) formData.append("entryDate", body.entryDate);
          return { url: "transfers", method: "POST", body: formData };
        }
        return { url: "transfers", method: "POST", body };
      },
      invalidatesTags: (result) => {
        const tags: Array<{ type: "Transfer" | "Account"; id: number | "LIST" }> = [
          { type: "Transfer", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        
        // Invalidate specific account transaction caches for affected accounts
        if (result) {
          tags.push({ type: "Account", id: result.fromAccountId });
          tags.push({ type: "Account", id: result.toAccountId });
        }
        
        return tags;
      },
    }),
    updateTransfer: builder.mutation<
      Transfer,
      { id: number; data: Partial<TransferInput> & { updatedBy?: number; file?: File } }
    >({
      query: ({ id, data }) => {
        const { file, ...body } = data;
        if (file) {
          const formData = new FormData();
          formData.append("file", file);
          if (body.fromAccountId !== undefined) formData.append("fromAccountId", String(body.fromAccountId));
          if (body.toAccountId !== undefined) formData.append("toAccountId", String(body.toAccountId));
          if (body.amount !== undefined) formData.append("amount", String(body.amount));
          if (body.description !== undefined) formData.append("description", body.description || "");
          if (body.transactionFee !== undefined) formData.append("transactionFee", String(body.transactionFee));
          if (body.updatedBy !== undefined) formData.append("updatedBy", String(body.updatedBy));
          if (body.entryDate) formData.append("entryDate", body.entryDate);
          if (body.imagePath !== undefined) formData.append("imagePath", body.imagePath || "");
          return { url: `transfers/${id}`, method: "PUT", body: formData };
        }
        return { url: `transfers/${id}`, method: "PUT", body };
      },
      invalidatesTags: (result, _err, { id, data }) => {
        const tags: Array<{ type: "Transfer" | "Account"; id: number | "LIST" }> = [
          { type: "Transfer", id },
          { type: "Transfer", id: "LIST" },
          { type: "Account", id: "LIST" },
        ];
        
        // Invalidate specific account transaction caches for affected accounts
        if (result) {
          // Invalidate new account IDs from the result
          tags.push({ type: "Account", id: result.fromAccountId });
          tags.push({ type: "Account", id: result.toAccountId });
        }
        
        return tags;
      },
      async onQueryStarted({ id, data }, { dispatch, queryFulfilled, getState }) {
        // Get the old transfer from cache to invalidate old account IDs
        const state = getState() as any;
        const transfersQuery = state?.api?.queries?.[`getTransfers(undefined)`];
        const oldTransfer = transfersQuery?.data?.find((t: Transfer) => t.id === id);
        
        // Invalidate old account IDs if they exist
        if (oldTransfer) {
          dispatch(
            api.util.invalidateTags([
              { type: "Account", id: oldTransfer.fromAccountId },
              { type: "Account", id: oldTransfer.toAccountId },
            ])
          );
        }
        
        try {
          const result = await queryFulfilled;
          // Invalidate new account IDs from the result
          if (result.data) {
            dispatch(
              api.util.invalidateTags([
                { type: "Account", id: result.data.fromAccountId },
                { type: "Account", id: result.data.toAccountId },
              ])
            );
          }
        } catch {
          // If query fails, we still invalidated the old account IDs
        }
      },
    }),
    deleteTransfer: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `transfers/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "Transfer", id: "LIST" }, { type: "Account", id: "LIST" }],
    }),
    getTransferChanges: builder.query<TransferChange[], number>({
      query: (id) => `transfers/${id}/changes`,
      providesTags: (_res, _err, id) => [{ type: "Transfer", id, variant: "CHANGES" }],
    }),
    getExpenses: builder.query<
      Expense[],
      {
        dateFrom?: string;
        dateTo?: string;
        accountId?: number;
        currencyCode?: string;
        createdBy?: number;
        tagIds?: string;
      }
    >({
      query: (params = {}) => {
        const queryParams = new URLSearchParams();
        if (params.dateFrom) queryParams.append("dateFrom", params.dateFrom);
        if (params.dateTo) queryParams.append("dateTo", params.dateTo);
        if (params.accountId !== undefined && params.accountId !== null) queryParams.append("accountId", params.accountId.toString());
        if (params.currencyCode) queryParams.append("currencyCode", params.currencyCode);
        if (params.createdBy !== undefined && params.createdBy !== null) queryParams.append("createdBy", params.createdBy.toString());
        if (params.tagIds) queryParams.append("tagIds", params.tagIds);
        const queryString = queryParams.toString();
        return `expenses${queryString ? `?${queryString}` : ""}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Expense" as const, id })),
              { type: "Expense" as const, id: "LIST" },
            ]
          : [{ type: "Expense", id: "LIST" }],
    }),
    createExpense: builder.mutation<Expense, ExpenseInput & { file?: File }>({
      query: ({ file, ...body }) => {
        if (file) {
          // Use FormData for file upload
          const formData = new FormData();
          formData.append("file", file);
          formData.append("accountId", String(body.accountId));
          formData.append("amount", String(body.amount));
          // Always append description (even if empty) since backend requires it
          formData.append("description", body.description || "");
          formData.append("type", body.type || "expense");
          if (body.createdBy !== undefined) {
            formData.append("createdBy", String(body.createdBy));
          }
          return {
            url: "expenses",
            method: "POST",
            body: formData,
          };
        } else {
          // Backward compatibility: use JSON with base64
          return {
            url: "expenses",
            method: "POST",
            body,
          };
        }
      },
      invalidatesTags: [
        { type: "Expense", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    updateExpense: builder.mutation<
      Expense,
      { id: number; data: Partial<ExpenseInput> & { updatedBy?: number; file?: File } }
    >({
      query: ({ id, data }) => {
        const { file, ...body } = data;
        if (file) {
          // Use FormData for file upload
          const formData = new FormData();
          formData.append("file", file);
          if (body.accountId !== undefined) {
            formData.append("accountId", String(body.accountId));
          }
          if (body.amount !== undefined) {
            formData.append("amount", String(body.amount));
          }
          if (body.description !== undefined) {
            formData.append("description", body.description || "");
          }
          if (body.imagePath !== undefined) {
            // For removing image, send empty string
            formData.append("imagePath", body.imagePath || "");
          }
          if (body.type !== undefined) {
            formData.append("type", body.type);
          }
          if (body.updatedBy !== undefined) {
            formData.append("updatedBy", String(body.updatedBy));
          }
          return {
            url: `expenses/${id}`,
            method: "PUT",
            body: formData,
          };
        } else {
          // Backward compatibility: use JSON with base64
          return {
            url: `expenses/${id}`,
            method: "PUT",
            body,
          };
        }
      },
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Expense", id },
        { type: "Expense", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    deleteExpense: builder.mutation<{ success: boolean }, { id: number; deletedBy?: number }>({
      query: ({ id, ...body }) => ({
        url: `expenses/${id}`,
        method: "DELETE",
        body,
      }),
      invalidatesTags: [
        { type: "Expense", id: "LIST" },
        { type: "Account", id: "LIST" },
      ],
    }),
    getExpenseChanges: builder.query<ExpenseChange[], number>({
      query: (id) => `expenses/${id}/changes`,
      providesTags: (_res, _err, id) => [{ type: "Expense", id, variant: "CHANGES" }],
    }),
    getProfitCalculations: builder.query<ProfitCalculation[], void>({
      query: () => "profit-calculations",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "ProfitCalculation" as const, id })),
              { type: "ProfitCalculation" as const, id: "LIST" },
            ]
          : [{ type: "ProfitCalculation" as const, id: "LIST" }],
    }),
    getProfitCalculation: builder.query<ProfitCalculationDetails, number>({
      query: (id) => `profit-calculations/${id}`,
      providesTags: (_res, _err, id) => [{ type: "ProfitCalculation", id }],
    }),
    createProfitCalculation: builder.mutation<
      ProfitCalculationDetails,
      { name: string; targetCurrencyCode: string; initialInvestment?: number }
    >({
      query: (body) => ({
        url: "profit-calculations",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "ProfitCalculation", id: "LIST" }],
    }),
    updateProfitCalculation: builder.mutation<
      ProfitCalculation,
      { id: number; data: Partial<Pick<ProfitCalculation, "name" | "targetCurrencyCode" | "initialInvestment" | "groups">> }
    >({
      query: ({ id, data }) => ({
        url: `profit-calculations/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "ProfitCalculation", id },
        { type: "ProfitCalculation", id: "LIST" },
      ],
    }),
    deleteProfitCalculation: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `profit-calculations/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "ProfitCalculation", id },
        { type: "ProfitCalculation", id: "LIST" },
      ],
    }),
    updateAccountMultiplier: builder.mutation<
      ProfitAccountMultiplier,
      { calculationId: number; accountId: number; multiplier: number; groupId?: string; groupName?: string }
    >({
      query: ({ calculationId, accountId, ...body }) => ({
        url: `profit-calculations/${calculationId}/multipliers/${accountId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { calculationId }) => [
        { type: "ProfitCalculation", id: calculationId },
        { type: "Account", id: "LIST" },
      ],
    }),
    updateExchangeRate: builder.mutation<
      ProfitExchangeRate,
      { calculationId: number; fromCurrencyCode: string; toCurrencyCode: string; rate: number }
    >({
      query: ({ calculationId, ...body }) => ({
        url: `profit-calculations/${calculationId}/exchange-rates`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { calculationId }) => [
        { type: "ProfitCalculation", id: calculationId },
      ],
    }),
    deleteGroup: builder.mutation<
      { message: string },
      { calculationId: number; groupName: string }
    >({
      query: ({ calculationId, ...body }) => ({
        url: `profit-calculations/${calculationId}/groups`,
        method: "DELETE",
        body,
      }),
      invalidatesTags: (_res, _err, { calculationId }) => [
        { type: "ProfitCalculation", id: calculationId },
      ],
    }),
    renameGroup: builder.mutation<
      { message: string },
      { calculationId: number; oldGroupName: string; newGroupName: string }
    >({
      query: ({ calculationId, ...body }) => ({
        url: `profit-calculations/${calculationId}/groups`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { calculationId }) => [
        { type: "ProfitCalculation", id: calculationId },
      ],
    }),
    setDefaultProfitCalculation: builder.mutation<
      { message: string },
      { id: number }
    >({
      query: ({ id }) => ({
        url: `profit-calculations/${id}/set-default`,
        method: "PUT",
      }),
      invalidatesTags: [
        { type: "ProfitCalculation", id: "LIST" },
      ],
    }),
    unsetDefaultProfitCalculation: builder.mutation<
      { message: string },
      { id: number }
    >({
      query: ({ id }) => ({
        url: `profit-calculations/${id}/unset-default`,
        method: "PUT",
      }),
      invalidatesTags: [
        { type: "ProfitCalculation", id: "LIST" },
      ],
    }),
    getSetting: builder.query<{ key: string; value: string | null }, string>({
      query: (key) => `settings/${key}`,
      providesTags: (_res, _err, key) => [{ type: "Setting", id: key }],
    }),
    getPublicBranding: builder.query<
      { documentTitleEn: string; documentTitleZh: string; faviconUrl: string | null },
      void
    >({
      query: () => "settings/branding/public",
      providesTags: ["PublicBranding"],
    }),
    uploadSiteFavicon: builder.mutation<
      { path: string; url: string; message: string },
      FormData
    >({
      query: (formData) => ({
        url: "settings/branding/favicon",
        method: "POST",
        body: formData,
      }),
      invalidatesTags: ["PublicBranding", { type: "Setting", id: APP_FAVICON_PATH_KEY }],
    }),
    deleteSiteFavicon: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: "settings/branding/favicon",
        method: "DELETE",
      }),
      invalidatesTags: ["PublicBranding", { type: "Setting", id: APP_FAVICON_PATH_KEY }],
    }),
    setSetting: builder.mutation<
      { key: string; value: string; message: string },
      { key: string; value: string }
    >({
      query: (body) => ({
        url: "settings",
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { key }) => {
        const tags: Array<"PublicBranding" | { type: "Setting"; id: string }> = [
          { type: "Setting", id: key },
        ];
        if (
          key === APP_DOCUMENT_TITLE_EN_KEY ||
          key === APP_DOCUMENT_TITLE_ZH_KEY ||
          key === APP_FAVICON_PATH_KEY
        ) {
          tags.push("PublicBranding");
        }
        return tags;
      },
    }),
    createBackup: builder.mutation<Blob, { includeFiles: boolean }>({
      query: (body) => ({
        url: "settings/backup",
        method: "POST",
        body,
        responseHandler: (response) => response.blob(),
      }),
    }),
    restoreBackup: builder.mutation<{ message: string; safetyBackup?: string }, FormData>({
      query: (formData) => ({
        url: "settings/restore",
        method: "POST",
        body: formData,
      }),
      invalidatesTags: ["Currency", "Customer", "User", "Role", "Order", "Account", "Transfer", "Expense", "ProfitCalculation", "Tag"],
    }),
    restoreSafetyBackup: builder.mutation<{ message: string; safetyBackup?: string }, { file?: string | null }>({
      query: (body) => ({
        url: "settings/restore/safety",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Currency", "Customer", "User", "Role", "Order", "Account", "Transfer", "Expense", "ProfitCalculation", "Tag"],
    }),
    listSafetyBackups: builder.query<{ backups: Array<{ file: string; path: string; modifiedAt: string; size: number }> }, void>({
      query: () => "settings/restore/safety/list",
    }),
    deleteSafetyBackup: builder.mutation<{ message: string; file: string }, { file: string }>({
      query: (body) => ({
        url: "settings/restore/safety/delete",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Currency", "Customer", "User", "Role", "Order", "Account", "Transfer", "Expense", "ProfitCalculation", "Tag"],
    }),
    resetTableIds: builder.mutation<
      { results: Array<{ table: string; success: boolean; message: string; currentMaxId?: number }> },
      { tables: string[] }
    >({
      query: (body) => ({
        url: "settings/reset-ids",
        method: "POST",
        body,
      }),
    }),
    getDbSchema: builder.query<{
      schema: Array<{
        name: string;
        rowCount: number;
        columns: Array<{
          name: string;
          type: string;
          notNull: boolean;
          defaultValue: string | null;
          primaryKey: boolean;
        }>;
      }>;
    }, void>({
      query: () => "settings/debug/schema",
    }),
    executeQuery: builder.mutation<
      { success: boolean; rowCount?: number; results?: any[]; message?: string },
      { sql: string }
    >({
      query: (body) => ({
        url: "settings/debug/query",
        method: "POST",
        body,
      }),
    }),
    clearDatabase: builder.mutation<{ message: string }, { confirmPhrase: string }>({
      query: (body) => ({
        url: "settings/clear-database",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Currency", "Customer", "User", "Role", "Order", "Account", "Transfer", "Expense", "ProfitCalculation", "Tag", "Notification"],
    }),
    getTags: builder.query<Tag[], void>({
      query: () => "tags",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Tag" as const, id })),
              { type: "Tag" as const, id: "LIST" },
            ]
          : [{ type: "Tag" as const, id: "LIST" }],
    }),
    createTag: builder.mutation<Tag, TagInput>({
      query: (body) => ({
        url: "tags",
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "Tag", id: "LIST" }],
    }),
    updateTag: builder.mutation<Tag, { id: number; data: Partial<TagInput> }>({
      query: ({ id, data }) => ({
        url: `tags/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Tag", id },
        { type: "Tag", id: "LIST" },
        { type: "Order", id: "LIST" },
        { type: "Transfer", id: "LIST" },
        { type: "Expense", id: "LIST" },
      ],
    }),
    deleteTag: builder.mutation<{ success: boolean; message?: string }, number>({
      query: (id) => ({
        url: `tags/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Tag", id },
        { type: "Tag", id: "LIST" },
        { type: "Order", id: "LIST" },
        { type: "Transfer", id: "LIST" },
        { type: "Expense", id: "LIST" },
      ],
    }),
    batchAssignTags: builder.mutation<
      { success: boolean; message: string },
      { entityType: "order" | "transfer" | "expense"; entityIds: number[]; tagIds: number[] }
    >({
      query: (body) => ({
        url: "tags/batch-assign",
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { entityType, entityIds }) => {
        const type: "Order" | "Transfer" | "Expense" = entityType === "order" ? "Order" : entityType === "transfer" ? "Transfer" : "Expense";
        return [
          { type, id: "LIST" as const },
          ...(entityIds || []).map((id: number) => ({ type, id })),
        ];
      },
    }),
    batchUnassignTags: builder.mutation<
      { success: boolean; message: string },
      { entityType: "order" | "transfer" | "expense"; entityIds: number[]; tagIds: number[] }
    >({
      query: (body) => ({
        url: "tags/batch-unassign",
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, { entityType, entityIds }) => {
        const type: "Order" | "Transfer" | "Expense" =
          entityType === "order" ? "Order" : entityType === "transfer" ? "Transfer" : "Expense";
        return [
          { type, id: "LIST" as const },
          ...(entityIds || []).map((id: number) => ({ type, id })),
        ];
      },
    }),
    // Notification endpoints
    getNotifications: builder.query<{ notifications: Notification[] }, { limit?: number; offset?: number }>({
      query: ({ limit = 20, offset = 0 }) => `notifications?limit=${limit}&offset=${offset}`,
      providesTags: (result) =>
        result
          ? [
              ...result.notifications.map(({ id }) => ({ type: "Notification" as const, id })),
              { type: "Notification" as const, id: "LIST" },
            ]
          : [{ type: "Notification", id: "LIST" }],
    }),
    getUnreadCount: builder.query<{ count: number }, void>({
      query: () => "notifications/unread-count",
      providesTags: [{ type: "Notification", id: "UNREAD_COUNT" }],
    }),
    markNotificationAsRead: builder.mutation<{ success: boolean; message: string }, number>({
      query: (id) => ({
        url: `notifications/${id}/read`,
        method: "PATCH",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Notification", id },
        { type: "Notification", id: "LIST" },
        { type: "Notification", id: "UNREAD_COUNT" },
      ],
    }),
    markAllNotificationsAsRead: builder.mutation<{ success: boolean; count: number; message: string }, void>({
      query: () => ({
        url: "notifications/read-all",
        method: "PATCH",
      }),
      invalidatesTags: [
        { type: "Notification", id: "LIST" },
        { type: "Notification", id: "UNREAD_COUNT" },
      ],
    }),
    deleteNotification: builder.mutation<{ success: boolean; message: string }, number>({
      query: (id) => ({
        url: `notifications/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Notification", id },
        { type: "Notification", id: "LIST" },
        { type: "Notification", id: "UNREAD_COUNT" },
      ],
    }),
    clearAllNotifications: builder.mutation<{ success: boolean; count: number; message: string }, void>({
      query: () => ({
        url: "notifications/clear-all",
        method: "DELETE",
      }),
      invalidatesTags: [
        { type: "Notification", id: "LIST" },
        { type: "Notification", id: "UNREAD_COUNT" },
      ],
    }),
    getNotificationPreferences: builder.query<{ preferences: NotificationPreferences }, void>({
      query: () => "notifications/preferences",
      providesTags: [{ type: "Notification", id: "PREFERENCES" }],
    }),
    updateNotificationPreferences: builder.mutation<{ success: boolean; preferences: NotificationPreferences }, Partial<NotificationPreferences>>({
      query: (preferences) => ({
        url: "notifications/preferences",
        method: "PUT",
        body: preferences,
      }),
      invalidatesTags: [{ type: "Notification", id: "PREFERENCES" }],
    }),

    // Wallet endpoints
    getWallets: builder.query<any[], void>({
      query: () => "wallets",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Wallet" as const, id })),
              { type: "Wallet" as const, id: "LIST" },
            ]
          : [{ type: "Wallet" as const, id: "LIST" }],
    }),
    getWalletsSummary: builder.query<any[], void>({
      query: () => "wallets/summary",
      providesTags: [{ type: "Wallet" as const, id: "SUMMARY" }],
    }),
    createWallet: builder.mutation<any, { nickname: string; walletAddress: string; remarks?: string }>({
      query: (body) => ({
        url: "wallets",
        method: "POST",
        body,
      }),
      invalidatesTags: [
        { type: "Wallet", id: "LIST" },
        { type: "Wallet", id: "SUMMARY" },
      ],
    }),
    updateWallet: builder.mutation<any, { id: number; nickname: string; remarks?: string }>({
      query: ({ id, ...body }) => ({
        url: `wallets/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_res, _err, { id }) => [
        { type: "Wallet", id },
        { type: "Wallet", id: "LIST" },
        { type: "Wallet", id: "SUMMARY" },
      ],
    }),
    deleteWallet: builder.mutation<{ success: boolean }, number>({
      query: (id) => ({
        url: `wallets/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Wallet", id },
        { type: "Wallet", id: "LIST" },
        { type: "Wallet", id: "SUMMARY" },
      ],
    }),
    refreshWalletBalance: builder.mutation<any, number>({
      query: (id) => ({
        url: `wallets/${id}/refresh`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [
        { type: "Wallet", id },
        { type: "Wallet", id: "LIST" },
        { type: "Wallet", id: "SUMMARY" },
      ],
    }),
    getWalletTransactions: builder.query<any[], { id: number; refresh?: boolean }>({
      query: ({ id, refresh = false }) => `wallets/${id}/transactions?refresh=${refresh}`,
      providesTags: (_result, _error, { id }) => [
        { type: "Wallet" as const, id: `TRANSACTIONS_${id}` },
        { type: "Wallet" as const, id },
      ],
    }),
    refreshAllWallets: builder.mutation<any, void>({
      query: () => ({
        url: "wallets/refresh-all",
        method: "POST",
      }),
      invalidatesTags: [
        { type: "Wallet", id: "LIST" },
        { type: "Wallet", id: "SUMMARY" },
      ],
    }),
    getPollingStatus: builder.query<{ isActive: boolean; interval: number; enabled: boolean }, void>({
      query: () => "wallets/polling/status",
    }),
    stopWalletPolling: builder.mutation<{ success: boolean; message: string }, void>({
      query: () => ({
        url: "wallets/polling/stop",
        method: "POST",
      }),
    }),
    startWalletPolling: builder.mutation<{ success: boolean; message: string; interval?: number }, void>({
      query: () => ({
        url: "wallets/polling/start",
        method: "POST",
      }),
    }),
    getReferenceRates: builder.query<ReferenceRatesResponse, void>({
      query: () => "reference-rates",
      providesTags: [{ type: "ReferenceRates", id: "CONFIG" }],
    }),
    updateReferenceRates: builder.mutation<ReferenceRatesResponse, ReferenceRatesUpdatePayload>({
      query: (body) => ({
        url: "reference-rates",
        method: "PUT",
        body,
      }),
      invalidatesTags: [{ type: "ReferenceRates", id: "CONFIG" }],
    }),
    sendReferenceRatesToTelegram: builder.mutation<{ ok: boolean; message: string }, void>({
      query: () => ({
        url: "reference-rates/send-telegram",
        method: "POST",
      }),
    }),

    getIntegrationProviders: builder.query<{ providers: import("../types/integrations").IntegrationProviderDef[] }, void>({
      query: () => "integrations/providers",
      providesTags: [{ type: "Integration", id: "PROVIDERS" }],
    }),
    getIntegrationConfigs: builder.query<{ configs: import("../types/integrations").IntegrationConfigMasked[] }, void>({
      query: () => "integrations/configs",
      providesTags: [{ type: "Integration", id: "CONFIGS" }],
    }),
    getIntegrationConfig: builder.query<
      import("../types/integrations").IntegrationConfigAdmin,
      string
    >({
      query: (providerId) => `integrations/configs/${providerId}`,
      providesTags: (_result, _error, providerId) => [{ type: "Integration", id: providerId }],
    }),
    saveIntegrationConfig: builder.mutation<
      import("../types/integrations").IntegrationConfigAdmin,
      {
        providerId: string;
        enabled: boolean;
        config: Record<string, string>;
        secrets?: Record<string, string>;
      }
    >({
      query: ({ providerId, ...body }) => ({
        url: `integrations/configs/${providerId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_result, _error, { providerId }) => [
        { type: "Integration", id: "CONFIGS" },
        { type: "Integration", id: providerId },
      ],
    }),
    testIntegrationConnection: builder.mutation<{ ok: boolean; message: string }, string>({
      query: (providerId) => ({
        url: `integrations/configs/${providerId}/test`,
        method: "POST",
      }),
    }),

    getAmlStatus: builder.query<{ enabled: boolean }, void>({
      query: () => "wallets/aml/status",
    }),
    getWalletAmlSummaries: builder.query<{ summaries: Record<number, import("../types/integrations").AmlCheck> }, void>({
      query: () => "wallets/aml/summaries",
      providesTags: [{ type: "AmlCheck", id: "WALLET_SUMMARIES" }],
    }),
    getWalletTransactionAmlSummaries: builder.query<
      { summaries: Record<number, import("../types/integrations").AmlCheck> },
      number
    >({
      query: (walletId) => `wallets/${walletId}/aml/transactions`,
      providesTags: (_r, _e, walletId) => [{ type: "AmlCheck", id: `TX_SUMMARIES_${walletId}` }],
    }),
    getWalletAmlHistory: builder.query<{ history: import("../types/integrations").AmlCheck[] }, number>({
      query: (walletId) => `wallets/${walletId}/aml/history`,
      providesTags: (_r, _e, walletId) => [{ type: "AmlCheck", id: `HISTORY_${walletId}` }],
    }),
    getWalletAddressAmlReports: builder.query<
      { screen: import("../types/integrations").AmlCheck | null; investigation: import("../types/integrations").AmlCheck | null },
      number
    >({
      query: (walletId) => `wallets/${walletId}/aml/reports`,
      providesTags: (_r, _e, walletId) => [{ type: "AmlCheck", id: `WALLET_REPORTS_${walletId}` }],
    }),
    getAmlCheck: builder.query<
      { check: import("../types/integrations").AmlCheck; rawResponse: unknown },
      number
    >({
      query: (checkId) => `wallets/aml/checks/${checkId}`,
      providesTags: (_r, _e, checkId) => [{ type: "AmlCheck", id: `CHECK_${checkId}` }],
    }),
    checkWalletAddressAml: builder.mutation<{ check: import("../types/integrations").AmlCheck }, number>({
      query: (walletId) => ({
        url: `wallets/${walletId}/aml/check-address`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: [
        { type: "AmlCheck", id: "WALLET_SUMMARIES" },
        (_r, _e, walletId) => ({ type: "AmlCheck", id: `HISTORY_${walletId}` }),
        (_r, _e, walletId) => ({ type: "AmlCheck", id: `WALLET_REPORTS_${walletId}` }),
      ],
    }),
    investigateWalletAddressAml: builder.mutation<{ check: import("../types/integrations").AmlCheck }, number>({
      query: (walletId) => ({
        url: `wallets/${walletId}/aml/investigate-address`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: [
        { type: "AmlCheck", id: "WALLET_SUMMARIES" },
        (_r, _e, walletId) => ({ type: "AmlCheck", id: `HISTORY_${walletId}` }),
        (_r, _e, walletId) => ({ type: "AmlCheck", id: `WALLET_REPORTS_${walletId}` }),
      ],
    }),
    checkWalletTransactionAml: builder.mutation<
      { check: import("../types/integrations").AmlCheck },
      { walletId: number; txId: number }
    >({
      query: ({ walletId, txId }) => ({
        url: `wallets/${walletId}/transactions/${txId}/aml/check`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: (_r, _e, { walletId }) => [
        { type: "AmlCheck", id: `TX_SUMMARIES_${walletId}` },
        { type: "AmlCheck", id: `HISTORY_${walletId}` },
      ],
    }),
    recheckAml: builder.mutation<
      { check: import("../types/integrations").AmlCheck },
      { checkId?: number; uid?: string }
    >({
      query: (body) => ({
        url: "wallets/aml/recheck",
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, body) => [
        { type: "AmlCheck", id: "WALLET_SUMMARIES" },
        ...(body.checkId ? [{ type: "AmlCheck" as const, id: `CHECK_${body.checkId}` }] : []),
      ],
    }),
    updateWalletAmlAutoScreenTx: builder.mutation<
      { wallet: { id: number; amlAutoScreenTx: number } },
      { id: number; enabled: boolean }
    >({
      query: ({ id, enabled }) => ({
        url: `wallets/${id}/aml/auto-screen-tx`,
        method: "PATCH",
        body: { enabled },
      }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: "Wallet", id },
        { type: "Wallet", id: "LIST" },
      ],
    }),
  }),
});

export const {
  useGetCurrenciesQuery,
  useAddCurrencyMutation,
  useUpdateCurrencyMutation,
  useDeleteCurrencyMutation,
  useGetCustomersQuery,
  useGetCustomerOptionsQuery,
  useGetCustomerPinsQuery,
  usePinCustomerMutation,
  useUnpinCustomerMutation,
  useReorderPinnedCustomersMutation,
  useAddCustomerMutation,
  useGetCustomerBeneficiariesQuery,
  useAddCustomerBeneficiaryMutation,
  useUpdateCustomerBeneficiaryMutation,
  useDeleteCustomerBeneficiaryMutation,
  useLoginMutation,
  useVerify2faMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useLogoutMutation,
  useGet2faStatusQuery,
  useSetup2faMutation,
  useEnable2faMutation,
  useDisable2faMutation,
  useChangePasswordMutation,
  useChangeEmailMutation,
  useUpdateCustomerMutation,
  useDeleteCustomerMutation,
  useGetUsersQuery,
  useAddUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useUpdateUserPreferencesMutation,
  useGetRolesQuery,
  useAddRoleMutation,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
  useForceLogoutUsersByRoleMutation,
  useGetOrdersQuery,
  useGetOrderPinsQuery,
  usePinOrderMutation,
  useUnpinOrderMutation,
  useReorderPinnedOrdersMutation,
  useAddOrderMutation,
  useUpdateOrderMutation,
  useUpdateOrderStatusMutation,
  useDeleteOrderMutation,
  useGetOrderDetailsQuery,
  useProcessOrderMutation,
  useAddReceiptMutation,
  useUpdateReceiptMutation,
  useDeleteReceiptMutation,
  useConfirmReceiptMutation,
  useAddProfitToOrderMutation,
  useUpdateProfitMutation,
  useDeleteProfitMutation,
  useConfirmProfitMutation,
  useAddServiceChargeToOrderMutation,
  useUpdateServiceChargeMutation,
  useDeleteServiceChargeMutation,
  useConfirmServiceChargeMutation,
  useAddBeneficiaryMutation,
  useAddPaymentMutation,
  useUpdatePaymentMutation,
  useDeletePaymentMutation,
  useConfirmPaymentMutation,
  useGetAccountsQuery,
  useGetAccountsSummaryQuery,
  useGetAccountsByCurrencyQuery,
  useCreateAccountMutation,
  useUpdateAccountMutation,
  useDeleteAccountMutation,
  useAddFundsMutation,
  useWithdrawFundsMutation,
  useGetAccountTransactionsQuery,
  useClearAllTransactionLogsMutation,
  useGetTransfersQuery,
  useCreateTransferMutation,
  useUpdateTransferMutation,
  useDeleteTransferMutation,
  useGetTransferChangesQuery,
  useGetExpensesQuery,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useDeleteExpenseMutation,
  useGetExpenseChangesQuery,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
  useCreateProfitCalculationMutation,
  useUpdateProfitCalculationMutation,
  useDeleteProfitCalculationMutation,
  useUpdateAccountMultiplierMutation,
  useUpdateExchangeRateMutation,
  useDeleteGroupMutation,
  useRenameGroupMutation,
  useSetDefaultProfitCalculationMutation,
  useUnsetDefaultProfitCalculationMutation,
    useGetSettingQuery,
    useGetPublicBrandingQuery,
    useUploadSiteFaviconMutation,
    useDeleteSiteFaviconMutation,
    useSetSettingMutation,
    useCreateBackupMutation,
    useRestoreBackupMutation,
    useRestoreSafetyBackupMutation,
    useListSafetyBackupsQuery,
    useDeleteSafetyBackupMutation,
    useResetTableIdsMutation,
    useGetDbSchemaQuery,
    useExecuteQueryMutation,
    useClearDatabaseMutation,
    useGetTagsQuery,
    useCreateTagMutation,
    useUpdateTagMutation,
    useDeleteTagMutation,
  useBatchAssignTagsMutation,
  useBatchUnassignTagsMutation,
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkNotificationAsReadMutation,
  useMarkAllNotificationsAsReadMutation,
  useDeleteNotificationMutation,
  useClearAllNotificationsMutation,
  useGetNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
  useGetWalletsQuery,
  useGetWalletsSummaryQuery,
  useCreateWalletMutation,
  useUpdateWalletMutation,
  useDeleteWalletMutation,
  useRefreshWalletBalanceMutation,
  useGetWalletTransactionsQuery,
  useRefreshAllWalletsMutation,
  useGetPollingStatusQuery,
  useStopWalletPollingMutation,
  useStartWalletPollingMutation,
  useGetAllCustomersConvertedBalancesQuery,
  useGetAllCustomersFundingConvertedBalancesQuery,
  useGetCustomerLedgerEntriesQuery,
  useGetCustomerLedgerSummaryQuery,
  useGetCustomerTradeProfitLossQuery,
  useGetCustomerFundingBalancesQuery,
  useGetCustomerLedgerBalanceQuery,
  useGetCustomerAccountStatementQuery,
  useRebuildCustomerLedgerFromOrdersMutation,
  useCreateLedgerEntryMutation,
  useUpdateLedgerEntryMutation,
  useDeleteLedgerEntryMutation,
  useGetLedgerEntryChangesQuery,
  useGetKycSchemaQuery,
  usePutKycSchemaMutation,
  useGetCustomerKycQuery,
  useUpdateCustomerKycMutation,
  useUploadCustomerKycDocumentMutation,
  useDeleteCustomerKycDocumentMutation,
  useGetKycBuilderSchemaQuery,
  usePutKycBuilderSchemaMutation,
  usePublishKycBuilderSchemaMutation,
  useGetKycBuilderVersionsQuery,
  useGetKycBuilderSchemaVersionQuery,
  useDeleteKycBuilderSchemaVersionMutation,
  useGetReferenceRatesQuery,
  useUpdateReferenceRatesMutation,
  useSendReferenceRatesToTelegramMutation,
  useGetIntegrationProvidersQuery,
  useGetIntegrationConfigsQuery,
  useGetIntegrationConfigQuery,
  useSaveIntegrationConfigMutation,
  useTestIntegrationConnectionMutation,
  useGetAmlStatusQuery,
  useGetWalletAmlSummariesQuery,
  useGetWalletTransactionAmlSummariesQuery,
  useGetWalletAmlHistoryQuery,
  useGetWalletAddressAmlReportsQuery,
  useGetAmlCheckQuery,
  useCheckWalletAddressAmlMutation,
  useInvestigateWalletAddressAmlMutation,
  useCheckWalletTransactionAmlMutation,
  useRecheckAmlMutation,
  useUpdateWalletAmlAutoScreenTxMutation,
} = api;


