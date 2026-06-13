import { useState, type FormEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Badge from "../components/common/Badge";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import ProfitSummaryDisplay from "../components/profit/ProfitSummaryDisplay";
import { CustomerDepositPoolsSection } from "../components/customerDeposits/CustomerDepositPoolsSection";
import { AccountTransactionsPanel } from "../components/accounts/AccountTransactionsPanel";
import {
  useGetAccountsQuery,
  useGetAccountsSummaryQuery,
  useGetAccountsByCurrencyQuery,
  useGetCurrenciesQuery,
  useCreateAccountMutation,
  useUpdateAccountMutation,
  useDeleteAccountMutation,
  useAddFundsMutation,
  useWithdrawFundsMutation,
  useGetAccountTransactionsQuery,
  useClearAllTransactionLogsMutation,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
  useGetCustomerDepositTotalsByCurrencyQuery,
  useGetSettingQuery,
  useSetSettingMutation,
  useAddCurrencyMutation,
  useUpdateCurrencyMutation,
} from "../services/api";
import { formatDate } from "../utils/format";
import { useAppSelector } from "../app/hooks";
import { hasActionPermission } from "../utils/permissions";
import { useProfitSummary } from "../hooks/useProfitSummary";
import { useBatchDelete } from "../hooks/useBatchDelete";
import { ColorInput } from "../components/common/CurrencyDisplayColorFields";
import * as XLSX from "xlsx";
import { store } from "../app/store";
import { api } from "../services/api";
import {
  exportAccountTransactionsToExcel,
  exportMultipleAccountTransactionsToExcel,
} from "../utils/accounts/accountTransactionExport";

// Helper function to format currency with proper number formatting
const formatCurrency = (amount: number, currencyCode: string) => {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencyCode}`;
};

export default function AccountsPage() {
  const { t } = useTranslation();
  const authUser = useAppSelector((s) => s.auth.user);
  const { data: accounts = [], isLoading: isLoadingAccounts, refetch: refetchAccounts } = useGetAccountsQuery();
  const { data: summary = [], isLoading: isLoadingSummary } = useGetAccountsSummaryQuery();
  const { data: currencies = [], refetch: refetchCurrencies } = useGetCurrenciesQuery();
  const [createAccount, { isLoading: isCreating }] = useCreateAccountMutation();
  const [updateAccount] = useUpdateAccountMutation();
  const [updateCurrency] = useUpdateCurrencyMutation();
  const [deleteAccount, { isLoading: isDeleting }] = useDeleteAccountMutation();
  const [addFunds] = useAddFundsMutation();
  const [withdrawFunds] = useWithdrawFundsMutation();
  const { data: calculations = [] } = useGetProfitCalculationsQuery();
  const { data: accountsDisplaySetting } = useGetSettingQuery("accountsDisplayType");
  const [setSetting] = useSetSettingMutation();

  const displayType = accountsDisplaySetting?.value === "profit" ? "profit" : "currency";

  // Find default calculation
  const defaultCalculation = calculations.find((calc) => calc.isDefault === 1 || calc.isDefault === true);
  const { data: defaultCalculationDetails } = useGetProfitCalculationQuery(
    defaultCalculation?.id || 0,
    { skip: !defaultCalculation || displayType !== "profit" }
  );
  const { data: depositTotalsData } = useGetCustomerDepositTotalsByCurrencyQuery(undefined, {
    skip: displayType !== "profit",
  });

  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }>({
    isOpen: false,
    message: "",
    type: "error",
  });


  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Pool color editor: which currency pool is currently being configured
  const [poolColorEditCode, setPoolColorEditCode] = useState<string | null>(null);
  const [poolColorForm, setPoolColorForm] = useState({ displayBgColor: "", displayTextColor: "" });
  const [fundsModalAccountId, setFundsModalAccountId] = useState<number | null>(null);
  const [fundsModalType, setFundsModalType] = useState<"add" | "withdraw" | null>(null);
  const [transactionsModalAccountId, setTransactionsModalAccountId] = useState<number | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<number>>(new Set());
  const [transactionExportModalOpen, setTransactionExportModalOpen] = useState(false);
  const [transactionExportCurrencyFilter, setTransactionExportCurrencyFilter] = useState("all");
  const [selectedTransactionExportAccountIds, setSelectedTransactionExportAccountIds] = useState<Set<number>>(new Set());
  const [isExportingTransactionLogs, setIsExportingTransactionLogs] = useState(false);
  const [clearLogsConfirmModal, setClearLogsConfirmModal] = useState(false);
  const [clearTransactionLogs] = useClearAllTransactionLogsMutation();

  // Batch delete hook
  const {
    isBatchDeleteMode,
    selectedIds: selectedAccountIdsForDelete,
    setSelectedIds: setSelectedAccountIdsForDelete,
    setIsBatchDeleteMode,
    handleDeleteClick: handleBatchDeleteClick,
    handleDelete: handleBatchDelete,
    handleBulkDelete,
    toggleBatchDeleteMode,
    exitBatchDeleteMode,
    confirmModal: batchDeleteConfirmModal,
    setConfirmModal: setBatchDeleteConfirmModal,
  } = useBatchDelete({
    deleteSingle: (id: number) => deleteAccount(id),
    confirmMessage: t("accounts.confirmDelete") || "Are you sure you want to delete this account?",
    confirmBulkMessage: t("accounts.confirmDeleteSelected") || "Are you sure you want to delete the selected accounts?",
    errorMessage: t("accounts.errorDeleting") || "Error deleting account",
    onError: (error: any, setAlertModalFn?: (modal: { isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }) => void) => {
      let message = t("accounts.cannotDeleteReferenced");
      
      if (error?.data) {
        let errorMessage = '';
        if (typeof error.data === 'string') {
          errorMessage = error.data;
        } else if (error.data.message) {
          errorMessage = error.data.message;
        }
        
        // Check for specific error messages and translate them
        if (errorMessage === "Cannot delete this item because it is referenced by other records.") {
          message = t("accounts.cannotDeleteReferenced");
        } else if (errorMessage === "Cannot delete account that is linked to existing orders") {
          message = t("accounts.cannotDeleteLinkedToOrders");
        } else if (errorMessage === "Cannot delete account that is linked to existing transfers") {
          message = t("accounts.cannotDeleteLinkedToTransfers");
        } else if (errorMessage === "Cannot delete account that is linked to existing expenses") {
          message = t("accounts.cannotDeleteLinkedToExpenses");
        } else if (errorMessage) {
          message = errorMessage;
        }
      }
      
      if (setAlertModalFn) {
        setAlertModalFn({ isOpen: true, message, type: "error" });
      } else {
        setAlertModal({ isOpen: true, message, type: "error" });
      }
    },
    onSuccess: () => {
      refetchAccounts();
    },
    t,
    setAlertModal: (modal: { isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }) => setAlertModal(modal),
  });

  // Custom handleDeleteClick to show account name in confirmation
  const handleDeleteClick = (id: number) => {
    const account = accounts.find((a) => a.id === id);
    if (!account) return;
    
    setBatchDeleteConfirmModal({
      isOpen: true,
      message: t("accounts.confirmDelete")?.replace("{{accountName}}", account.name) || `Are you sure you want to delete ${account.name}?`,
      entityId: id,
      isBulk: false,
    });
  };
  const [addCurrency] = useAddCurrencyMutation();

  const { data: accountsByCurrency = [] } = useGetAccountsByCurrencyQuery(
    selectedCurrency || "",
    { skip: !selectedCurrency }
  );
  const { data: transactions = [] } = useGetAccountTransactionsQuery(
    transactionsModalAccountId || 0,
    { skip: !transactionsModalAccountId }
  );

  const [form, setForm] = useState({
    currencyCode: "",
    name: "",
    initialFunds: "",
  });

  const [editForm, setEditForm] = useState({
    name: "",
    balance: "",
    displayBgColor: "",
    displayTextColor: "",
  });

  const [fundsForm, setFundsForm] = useState({
    amount: "",
    description: "",
  });

  const resetForm = () => {
    setForm({
      currencyCode: "",
      name: "",
      initialFunds: "",
    });
  };

  const resetFundsForm = () => {
    setFundsForm({
      amount: "",
      description: "",
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.currencyCode || !form.name) return;

    // Check if account with same name already exists within the same currency
    const duplicateAccount = accounts.find(
      (a) => a.name.toLowerCase().trim() === form.name.toLowerCase().trim() && a.currencyCode === form.currencyCode
    );
    if (duplicateAccount) {
      setAlertModal({
        isOpen: true,
        message: t("accounts.duplicateNameError") || "An account with this name already exists",
        type: "error",
      });
      return;
    }

    try {
      await createAccount({
        currencyCode: form.currencyCode,
        name: form.name,
        initialFunds: form.initialFunds ? parseFloat(form.initialFunds) : 0,
      }).unwrap();
      resetForm();
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("accounts.errorCreating") || "Error creating account",
        type: "error",
      });
    }
  };

  const startEdit = (accountId: number) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      console.error('Account not found:', accountId);
      setAlertModal({
        isOpen: true,
        message: t("accounts.accountNotFound") || "Account not found",
        type: "error",
      });
      return;
    }
    setEditingId(accountId);
    setEditForm({ 
      name: account.name,
      balance: (account.balance ?? 0).toString(),
      displayBgColor: account.displayBgColor ?? "",
      displayTextColor: account.displayTextColor ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: "", balance: "", displayBgColor: "", displayTextColor: "" });
  };

  const openPoolColorEditor = (currencyCode: string) => {
    const currency = currencies.find((c) => c.code === currencyCode);
    setPoolColorForm({
      displayBgColor: currency?.accountPoolDisplayBgColor ?? "",
      displayTextColor: currency?.accountPoolDisplayTextColor ?? "",
    });
    setPoolColorEditCode(currencyCode);
  };

  const closePoolColorEditor = () => {
    setPoolColorEditCode(null);
    setPoolColorForm({ displayBgColor: "", displayTextColor: "" });
  };

  const savePoolColor = async () => {
    if (!poolColorEditCode) return;
    const currency = currencies.find((c) => c.code === poolColorEditCode);
    if (!currency) return;
    try {
      await updateCurrency({
        id: currency.id,
        data: {
          accountPoolDisplayBgColor: poolColorForm.displayBgColor.trim() || null,
          accountPoolDisplayTextColor: poolColorForm.displayTextColor.trim() || null,
        },
      }).unwrap();
      closePoolColorEditor();
    } catch (error: any) {
      setAlertModal({ isOpen: true, message: error?.data?.message || t("common.errorSaving") || "Error saving", type: "error" });
    }
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    
    // Check if another account with same name already exists within the same currency (excluding current account)
    const editingAccount = accounts.find((a) => a.id === editingId);
    const duplicateAccount = accounts.find(
      (a) => a.id !== editingId && a.name.toLowerCase().trim() === editForm.name.toLowerCase().trim() && a.currencyCode === editingAccount?.currencyCode
    );
    if (duplicateAccount) {
      setAlertModal({
        isOpen: true,
        message: t("accounts.duplicateNameError") || "An account with this name already exists",
        type: "error",
      });
      return;
    }

    // Validate balance if provided
    let balanceValue: number | undefined = undefined;
    if (editForm.balance !== undefined && editForm.balance !== null && editForm.balance !== "") {
      const parsedBalance = parseFloat(editForm.balance);
      if (isNaN(parsedBalance)) {
        setAlertModal({
          isOpen: true,
          message: t("accounts.invalidBalance") || "Invalid balance value",
          type: "error",
        });
        return;
      }
      balanceValue = parsedBalance;
    }

    try {
      const updateData: { id: number; name: string; balance?: number; displayBgColor?: string | null; displayTextColor?: string | null } = {
        id: editingId,
        name: editForm.name,
        displayBgColor: editForm.displayBgColor.trim() || null,
        displayTextColor: editForm.displayTextColor.trim() || null,
      };
      if (balanceValue !== undefined) {
        updateData.balance = balanceValue;
      }
      await updateAccount(updateData).unwrap();
      cancelEdit();
    } catch (error: any) {
      setAlertModal({ 
        isOpen: true, 
        message: error?.data?.message || t("accounts.errorUpdating"), 
        type: "error" 
      });
    }
  };


  const openFundsModal = (accountId: number, type: "add" | "withdraw") => {
    setFundsModalAccountId(accountId);
    setFundsModalType(type);
    resetFundsForm();
  };

  const closeFundsModal = () => {
    setFundsModalAccountId(null);
    setFundsModalType(null);
    resetFundsForm();
  };

  const handleFundsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!fundsModalAccountId || !fundsModalType || !fundsForm.amount) return;

    try {
      if (fundsModalType === "add") {
        await addFunds({
          id: fundsModalAccountId,
          amount: parseFloat(fundsForm.amount),
          description: fundsForm.description || undefined,
        });
      } else {
        await withdrawFunds({
          id: fundsModalAccountId,
          amount: parseFloat(fundsForm.amount),
          description: fundsForm.description || undefined,
        });
      }
      closeFundsModal();
    } catch (error: any) {
      setAlertModal({ 
        isOpen: true, 
        message: error?.data?.message || t("accounts.errorProcessing"), 
        type: "error" 
      });
    }
  };

  const accountsByCurrencyMap = accounts.reduce((acc, account) => {
    if (!acc[account.currencyCode]) {
      acc[account.currencyCode] = [];
    }
    acc[account.currencyCode].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  const selectedAccount = accounts.find((a) => a.id === transactionsModalAccountId);

  // Check if user has any account action permissions (updateAccount or viewAccountTransaction)
  const hasAccountActions = hasActionPermission(authUser, "updateAccount") || hasActionPermission(authUser, "viewAccountTransaction");

  // Handle Esc key to close edit account modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editingId) {
        cancelEdit();
      }
    };

    if (editingId) {
      document.addEventListener("keydown", handleEscKey);
      return () => {
        document.removeEventListener("keydown", handleEscKey);
      };
    }
  }, [editingId]);

  // Handle Esc key to close funds modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fundsModalAccountId) {
        closeFundsModal();
      }
    };

    if (fundsModalAccountId) {
      document.addEventListener("keydown", handleEscKey);
      return () => {
        document.removeEventListener("keydown", handleEscKey);
      };
    }
  }, [fundsModalAccountId]);

  // Use shared hook for profit summary calculation
  const profitSummary = useProfitSummary(
    displayType === "profit" ? defaultCalculationDetails : undefined,
    accounts,
    currencies,
    depositTotalsData?.currencies ?? [],
  );

  const handleToggleDisplay = async (newType: "currency" | "profit") => {
    try {
      await setSetting({ key: "accountsDisplayType", value: newType }).unwrap();
      setAlertModal({
        isOpen: true,
        message: t("accounts.displaySettingSaved") || "Display setting saved successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("accounts.errorSavingDisplaySetting") || "Error saving display setting",
        type: "error",
      });
    }
  };

  const handleExportClick = () => {
    setExportModalOpen(true);
    setSelectedAccountIds(new Set());
  };

  const handleImportClick = () => {
    setImportModalOpen(true);
  };

  const handleClearLogsClick = () => {
    setClearLogsConfirmModal(true);
  };

  const handleConfirmClearLogs = async () => {
    try {
      const result = await clearTransactionLogs().unwrap();
      setClearLogsConfirmModal(false);
      setAlertModal({
        isOpen: true,
        message: result.message || t("accounts.transactionLogsCleared") || "Transaction logs cleared successfully",
        type: "success",
      });
      // Refetch accounts to update any cached transaction data
      await refetchAccounts();
    } catch (error: any) {
      setClearLogsConfirmModal(false);
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("accounts.errorClearingLogs") || "Error clearing transaction logs",
        type: "error",
      });
    }
  };

  const handleSelectAllAccounts = () => {
    if (selectedAccountIds.size === accounts.length) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(new Set(accounts.map((a) => a.id)));
    }
  };

  const handleToggleAccountSelection = (accountId: number) => {
    const newSelection = new Set(selectedAccountIds);
    if (newSelection.has(accountId)) {
      newSelection.delete(accountId);
    } else {
      newSelection.add(accountId);
    }
    setSelectedAccountIds(newSelection);
  };

  const handleTransactionExportClick = () => {
    setTransactionExportModalOpen(true);
    setTransactionExportCurrencyFilter("all");
    setSelectedTransactionExportAccountIds(new Set());
  };

  const closeTransactionExportModal = () => {
    setTransactionExportModalOpen(false);
    setTransactionExportCurrencyFilter("all");
    setSelectedTransactionExportAccountIds(new Set());
  };

  const filteredAccountsForTransactionExport =
    transactionExportCurrencyFilter === "all"
      ? accounts
      : accounts.filter((a) => a.currencyCode === transactionExportCurrencyFilter);

  const handleToggleTransactionExportSelection = (accountId: number) => {
    const next = new Set(selectedTransactionExportAccountIds);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    setSelectedTransactionExportAccountIds(next);
  };

  const handleSelectAllVisibleForTransactionExport = () => {
    const visibleIds = filteredAccountsForTransactionExport.map((a) => a.id);
    const allVisibleSelected = visibleIds.every((id) =>
      selectedTransactionExportAccountIds.has(id)
    );
    const next = new Set(selectedTransactionExportAccountIds);
    if (allVisibleSelected) {
      visibleIds.forEach((id) => next.delete(id));
    } else {
      visibleIds.forEach((id) => next.add(id));
    }
    setSelectedTransactionExportAccountIds(next);
  };

  const handleExportSingleAccountTransactions = () => {
    if (!selectedAccount) return;
    exportAccountTransactionsToExcel(selectedAccount, transactions);
  };

  const handleExportSelectedTransactionLogs = async () => {
    if (selectedTransactionExportAccountIds.size === 0) {
      setAlertModal({
        isOpen: true,
        message: t("accounts.selectAccountsToExportTransactions") || "Please select at least one account to export transaction logs",
        type: "warning",
      });
      return;
    }

    setIsExportingTransactionLogs(true);
    try {
      const selectedAccounts = accounts.filter((a) =>
        selectedTransactionExportAccountIds.has(a.id)
      );

      const accountsWithTransactions = await Promise.all(
        selectedAccounts.map(async (account) => {
          const result = await store.dispatch(
            api.endpoints.getAccountTransactions.initiate(account.id)
          );
          return {
            account,
            transactions: result.data ?? [],
          };
        })
      );

      exportMultipleAccountTransactionsToExcel(accountsWithTransactions);
      closeTransactionExportModal();
      setAlertModal({
        isOpen: true,
        message: t("accounts.exportTransactionLogsSuccess") || "Transaction logs exported successfully",
        type: "success",
      });
    } catch {
      setAlertModal({
        isOpen: true,
        message: t("accounts.exportTransactionLogsError") || "Failed to export transaction logs",
        type: "error",
      });
    } finally {
      setIsExportingTransactionLogs(false);
    }
  };

  const handleExportAccounts = () => {
    if (selectedAccountIds.size === 0) {
      setAlertModal({
        isOpen: true,
        message: t("accounts.selectAccountsToExport") || "Please select at least one account to export",
        type: "warning",
      });
      return;
    }

    const accountsToExport = accounts.filter((a) => selectedAccountIds.has(a.id));
    const currencyCodes = new Set(accountsToExport.map((a) => a.currencyCode));
    const currenciesToExport = currencies.filter((c) => currencyCodes.has(c.code));

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Accounts sheet
    const accountsData = accountsToExport.map((account) => ({
      "Account Name": account.name,
      "Currency Code": account.currencyCode,
      "Balance": account.balance,
      "Created At": formatDate(account.createdAt),
    }));
    const accountsSheet = XLSX.utils.json_to_sheet(accountsData);
    XLSX.utils.book_append_sheet(wb, accountsSheet, "Accounts");

    // Currencies sheet
    const currenciesData = currenciesToExport.map((currency) => ({
      "Currency Code": currency.code,
      "Currency Name": currency.name,
      "Base Rate Buy": currency.baseRateBuy,
      "Base Rate Sell": currency.baseRateSell,
      "Conversion Rate Buy": currency.conversionRateBuy,
      "Conversion Rate Sell": currency.conversionRateSell,
      "Active": currency.active ? "Yes" : "No",
    }));
    const currenciesSheet = XLSX.utils.json_to_sheet(currenciesData);
    XLSX.utils.book_append_sheet(wb, currenciesSheet, "Currencies");

    // Write file
    XLSX.writeFile(wb, `accounts_export_${new Date().toISOString().split("T")[0]}.xlsx`);

    setExportModalOpen(false);
    setSelectedAccountIds(new Set());
    setAlertModal({
      isOpen: true,
      message: t("accounts.exportSuccess") || "Accounts exported successfully",
      type: "success",
    });
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });

      // Read currencies sheet
      const currenciesSheet = workbook.Sheets["Currencies"];
      if (!currenciesSheet) {
        setAlertModal({
          isOpen: true,
          message: t("accounts.currenciesSheetNotFound") || "Currencies sheet not found in the file",
          type: "error",
        });
        return;
      }
      const currenciesData = XLSX.utils.sheet_to_json(currenciesSheet) as any[];

      // Read accounts sheet
      const accountsSheet = workbook.Sheets["Accounts"];
      if (!accountsSheet) {
        setAlertModal({
          isOpen: true,
          message: t("accounts.accountsSheetNotFound") || "Accounts sheet not found in the file",
          type: "error",
        });
        return;
      }
      const accountsData = XLSX.utils.sheet_to_json(accountsSheet) as any[];

      // Get current currencies list
      let currentCurrencies = [...currencies];

      // Validate and process currencies
      const currenciesToCreate: any[] = [];
      for (const currencyRow of currenciesData) {
        const code = String(currencyRow["Currency Code"] || "").trim().toUpperCase();
        const name = String(currencyRow["Currency Name"] || "").trim();
        
        if (!code || !name) {
          continue;
        }

        const existingCurrency = currentCurrencies.find((c) => c.code === code);
        if (!existingCurrency) {
          currenciesToCreate.push({
            code,
            name,
            baseRateBuy: parseFloat(currencyRow["Base Rate Buy"] || "0") || 0,
            baseRateSell: parseFloat(currencyRow["Base Rate Sell"] || "0") || 0,
            conversionRateBuy: parseFloat(currencyRow["Conversion Rate Buy"] || currencyRow["Base Rate Buy"] || "0") || 0,
            conversionRateSell: parseFloat(currencyRow["Conversion Rate Sell"] || currencyRow["Base Rate Sell"] || "0") || 0,
            active: String(currencyRow["Active"] || "").toLowerCase() === "yes" ? true : false,
          });
        }
      }

      // Show confirmation for currencies to create
      if (currenciesToCreate.length > 0) {
        const currencyList = currenciesToCreate.map((c) => `${c.code} - ${c.name}`).join("\n");
        const confirmed = window.confirm(
          t("accounts.confirmCreateCurrencies")?.replace("{count}", String(currenciesToCreate.length))?.replace("{currencies}", currencyList) ||
          `The following ${currenciesToCreate.length} currencies will be created:\n\n${currencyList}\n\nDo you want to continue?`
        );
        if (!confirmed) {
          return;
        }

        // Create currencies
        for (const currency of currenciesToCreate) {
          try {
            await addCurrency(currency).unwrap();
          } catch (error: any) {
            console.error(`Error creating currency ${currency.code}:`, error);
          }
        }

        // Refetch currencies to include newly created ones
        const { data: updatedCurrencies = [] } = await refetchCurrencies();
        currentCurrencies = updatedCurrencies;
      }

      // Process accounts
      let createdCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (const accountRow of accountsData) {
        const name = String(accountRow["Account Name"] || "").trim();
        const currencyCode = String(accountRow["Currency Code"] || "").trim().toUpperCase();
        const balance = parseFloat(accountRow["Balance"] || "0") || 0;

        if (!name || !currencyCode) {
          skippedCount++;
          continue;
        }

        // Check if currency exists (after creating new ones)
        const currencyExists = currentCurrencies.find((c) => c.code === currencyCode);
        if (!currencyExists) {
          errors.push(`Currency ${currencyCode} not found for account ${name}`);
          skippedCount++;
          continue;
        }

        // Check if account already exists
        const accountExists = accounts.find(
          (a) => a.name.toLowerCase().trim() === name.toLowerCase().trim() && a.currencyCode === currencyCode
        );
        if (accountExists) {
          skippedCount++;
          continue;
        }

        try {
          await createAccount({
            currencyCode,
            name,
            initialFunds: balance,
          }).unwrap();
          createdCount++;
        } catch (error: any) {
          errors.push(`Error creating account ${name}: ${error?.data?.message || "Unknown error"}`);
          skippedCount++;
        }
      }

      // Show results
      let message = t("accounts.importComplete")?.replace("{created}", String(createdCount))?.replace("{skipped}", String(skippedCount)) ||
        `Import complete. Created: ${createdCount}, Skipped: ${skippedCount}`;
      if (errors.length > 0) {
        message += `\n\nErrors:\n${errors.slice(0, 5).join("\n")}`;
        if (errors.length > 5) {
          message += `\n... and ${errors.length - 5} more errors`;
        }
      }

      setAlertModal({
        isOpen: true,
        message,
        type: errors.length > 0 ? "warning" : "success",
      });

      // Refetch accounts to show newly imported ones
      await refetchAccounts();

      setImportModalOpen(false);
      // Reset file input
      event.target.value = "";
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: t("accounts.importError") || `Error importing file: ${error?.message || "Unknown error"}`,
        type: "error",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Section */}
      <SectionCard
        title={t("accounts.summaryTitle")}
        // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
        // description={t("accounts.summaryDescription")}
        actions={
          hasActionPermission(authUser, "manageAccountsDisplay") ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleToggleDisplay("currency")}
                className={`px-3 py-1 text-sm rounded ${
                  displayType === "currency"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
              >
                {t("accounts.currencySummary") || "Currency Summary"}
              </button>
              <button
                onClick={() => handleToggleDisplay("profit")}
                className={`px-3 py-1 text-sm rounded ${
                  displayType === "profit"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
              >
                {t("accounts.profitSummary") || "Profit Summary"}
              </button>
            </div>
          ) : undefined
        }
      >
        {displayType === "profit" && profitSummary ? (
          <ProfitSummaryDisplay summary={profitSummary} currencies={currencies} />
        ) : (
          <>
            {isLoadingSummary ? (
              <div className="text-sm text-slate-500">{t("common.loading")}</div>
            ) : summary.length === 0 ? (
              <div className="text-sm text-slate-500">{t("accounts.noAccounts")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.map((item) => (
                  <div
                    key={item.currencyCode}
                    className="p-4 border border-slate-200 rounded-lg bg-slate-50"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-slate-900">
                        {item.currencyCode}
                      </span>
                      <Badge tone="blue">{item.accountCount} {t("accounts.accounts")}</Badge>
                    </div>
                    <div className={`text-2xl font-bold ${
                      item.totalBalance < 0 ? "text-red-600" : "text-slate-900"
                    }`}>
                      {formatCurrency(item.totalBalance, item.currencyCode)}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {item.currencyName || item.currencyCode}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SectionCard>

      <CustomerDepositPoolsSection variant="detailed" />

      {/* Currency Pools */}
      <SectionCard
        title={t("accounts.currencyPoolsTitle")}
           // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
        // description={t("accounts.currencyPoolsDescription")}
        actions={
          <div className="flex items-center gap-2">
            {hasActionPermission(authUser, "viewAccountTransaction") && (
              <button
                onClick={handleTransactionExportClick}
                className="px-3 py-1 text-sm rounded bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
              >
                {t("accounts.exportTransactionLogs") || "Export Transaction Logs"}
              </button>
            )}
            {hasActionPermission(authUser, "importAccount") && (
              <button
                onClick={handleImportClick}
                className="px-3 py-1 text-sm rounded bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
              >
                {t("accounts.importAccounts") || "Import Accounts"}
              </button>
            )}
            {hasActionPermission(authUser, "exportAccount") && (
              <button
                onClick={handleExportClick}
                className="px-3 py-1 text-sm rounded bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
              >
                {t("accounts.exportAccounts") || "Export Accounts"}
              </button>
            )}
            {hasActionPermission(authUser, "clearTransactionLogs") && (
              <button
                onClick={handleClearLogsClick}
                className="px-3 py-1 text-sm rounded bg-rose-200 text-rose-700 hover:bg-rose-300 transition-colors"
              >
                {t("accounts.clearTransactionLogs") || "Clear Transaction Logs"}
              </button>
            )}
            {hasActionPermission(authUser, "deleteManyAccounts") && (
              <button
                onClick={async () => {
                  if (!isBatchDeleteMode) {
                    setIsBatchDeleteMode(true);
                    setSelectedAccountIdsForDelete([]);
                  } else {
                    if (!selectedAccountIdsForDelete.length) {
                      setIsBatchDeleteMode(false);
                      setSelectedAccountIdsForDelete([]);
                      return;
                    }
                    setBatchDeleteConfirmModal({
                      isOpen: true,
                      message: t("accounts.confirmDeleteSelected") || "Are you sure you want to delete the selected accounts?",
                      entityId: -1,
                      isBulk: true,
                    });
                  }
                }}
                disabled={isDeleting}
                className="px-3 py-1 text-sm rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition-colors"
              >
                {isDeleting
                  ? t("common.deleting")
                  : isBatchDeleteMode
                    ? (selectedAccountIdsForDelete.length > 0 ? t("accounts.deleteSelected") || "Delete Selected" : t("common.cancel"))
                    : t("accounts.batchDelete") || "Batch Delete"}
              </button>
            )}
          </div>
        }
      >
        {isLoadingAccounts ? (
          <div className="text-sm text-slate-500">{t("common.loading")}</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(accountsByCurrencyMap).map(([currencyCode, currencyAccounts]) => {
              const totalBalance = currencyAccounts.reduce((sum, acc) => sum + acc.balance, 0);
              const currency = currencies.find((c) => c.code === currencyCode);
              const isEditingPoolColor = poolColorEditCode === currencyCode;
              return (
                <div
                  key={currencyCode}
                  className="border border-slate-200 rounded-lg p-4 bg-white"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">
                          {currencyCode} {t("accounts.currencyPool")}
                        </h3>
                        {hasActionPermission(authUser, "updateCurrency") && (
                          <button
                            type="button"
                            title={t("accounts.configurePoolColor") || "Configure pool color"}
                            onClick={() => isEditingPoolColor ? closePoolColorEditor() : openPoolColorEditor(currencyCode)}
                            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                              isEditingPoolColor
                                ? "bg-blue-100 text-blue-700"
                                : currency?.accountPoolDisplayBgColor
                                  ? "text-slate-600 hover:text-slate-800"
                                  : "text-slate-400 hover:text-slate-600"
                            }`}
                          >
                            {currency?.accountPoolDisplayBgColor ? (
                              <span
                                className="inline-block w-3 h-3 rounded-sm border border-slate-300"
                                style={{ backgroundColor: currency.accountPoolDisplayBgColor }}
                              />
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                              </svg>
                            )}
                            {t("accounts.poolColor") || "Pool color"}
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {currency?.name || currencyCode}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${
                        totalBalance < 0 ? "text-red-600" : "text-slate-900"
                      }`}>
                        {formatCurrency(totalBalance, currencyCode)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {currencyAccounts.length} {t("accounts.accounts")}
                      </div>
                    </div>
                  </div>
                  {isEditingPoolColor && (
                    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-blue-900">
                          {t("accounts.poolColorTitle") || "Pool Color — applies to all accounts in this pool"}
                        </span>
                        <button type="button" onClick={closePoolColorEditor} className="text-slate-400 hover:text-slate-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <p className="mb-3 text-xs text-slate-500">
                        {t("accounts.poolColorHint") || "Individual account colors take priority over the pool color."}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ColorInput
                          label={t("accounts.displayBgColor") || "Background Color"}
                          value={poolColorForm.displayBgColor}
                          placeholder="#1e3a8a"
                          onChange={(v) => setPoolColorForm((p) => ({ ...p, displayBgColor: v }))}
                        />
                        <ColorInput
                          label={t("accounts.displayTextColor") || "Text Color"}
                          value={poolColorForm.displayTextColor}
                          placeholder="#ffffff"
                          onChange={(v) => setPoolColorForm((p) => ({ ...p, displayTextColor: v }))}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        {poolColorForm.displayBgColor.trim() ? (
                          <>
                            <span className="text-xs font-medium text-slate-600">{t("common.preview") || "Preview"}:</span>
                            {currencyAccounts.slice(0, 3).map((a) => (
                              <span
                                key={a.id}
                                className="inline-block rounded-md px-2 py-0.5 text-sm font-semibold"
                                style={{
                                  backgroundColor: a.displayBgColor || poolColorForm.displayBgColor,
                                  color: a.displayTextColor || poolColorForm.displayTextColor || "#ffffff",
                                }}
                              >
                                {a.name}
                              </span>
                            ))}
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">{t("accounts.nameDisplayPreviewDefault") || "No custom styling."}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => setPoolColorForm({ displayBgColor: "", displayTextColor: "" })}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-800"
                        >
                          {t("accounts.clearDisplayColors") || "Clear colors"}
                        </button>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button type="button" onClick={closePoolColorEditor} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          {t("common.cancel")}
                        </button>
                        <button type="button" onClick={savePoolColor} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
                          {t("accounts.savePoolColor") || "Save pool color"}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600">
                          {isBatchDeleteMode && (
                            <th className="py-2 w-8">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={
                                  !!currencyAccounts.length &&
                                  currencyAccounts.every(acc => selectedAccountIdsForDelete.includes(acc.id))
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedAccountIdsForDelete((prev: number[]) => {
                                      const newIds = currencyAccounts.map(acc => acc.id).filter(id => !prev.includes(id));
                                      return [...prev, ...newIds];
                                    });
                                  } else {
                                    setSelectedAccountIdsForDelete((prev: number[]) => 
                                      prev.filter(id => !currencyAccounts.some(acc => acc.id === id))
                                    );
                                  }
                                }}
                              />
                            </th>
                          )}
                          <th className="py-2">{t("accounts.accountName")}</th>
                          <th className="py-2">{t("accounts.balance")}</th>
                          {!isBatchDeleteMode && hasAccountActions && <th className="py-2">{t("accounts.actions")}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {currencyAccounts.map((account) => (
                          <tr key={account.id} className="border-b border-slate-100">
                            {isBatchDeleteMode && (
                              <td className="py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={selectedAccountIdsForDelete.includes(account.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedAccountIdsForDelete((prev: number[]) =>
                                        prev.includes(account.id) ? prev : [...prev, account.id]
                                      );
                                    } else {
                                      setSelectedAccountIdsForDelete((prev: number[]) =>
                                        prev.filter(id => id !== account.id)
                                      );
                                    }
                                  }}
                                />
                              </td>
                            )}
                            <td className="py-2 font-semibold">
                              {(() => {
                                const effectiveBg = account.displayBgColor || currency?.accountPoolDisplayBgColor;
                                const effectiveText = account.displayBgColor
                                  ? (account.displayTextColor || "#ffffff")
                                  : (currency?.accountPoolDisplayTextColor || "#ffffff");
                                return effectiveBg ? (
                                  <span
                                    className="inline-block rounded-md px-2 py-0.5"
                                    style={{ backgroundColor: effectiveBg, color: effectiveText, fontWeight: 700 }}
                                  >
                                    {account.name}
                                  </span>
                                ) : account.name;
                              })()}
                            </td>
                            <td className="py-2">
                              <span className={`font-semibold ${
                                account.balance < 0 ? "text-red-600" : "text-slate-900"
                              }`}>
                                {formatCurrency(account.balance, currencyCode)}
                              </span>
                            </td>
                            {!isBatchDeleteMode && hasAccountActions && (
                              <td className="py-2">
                                <div className="flex gap-2 text-sm">
                                  {hasActionPermission(authUser, "updateAccount") && (
                                    <>
                                      <button
                                        className="text-blue-600 hover:text-blue-700"
                                        onClick={() => openFundsModal(account.id, "add")}
                                      >
                                        {t("accounts.addFunds")}
                                      </button>
                                      <button
                                        className="text-amber-600 hover:text-amber-700"
                                        onClick={() => openFundsModal(account.id, "withdraw")}
                                      >
                                        {t("accounts.withdrawFunds")}
                                      </button>
                                      <button
                                        type="button"
                                        className="text-amber-600 hover:text-amber-700"
                                        onClick={() => startEdit(account.id)}
                                      >
                                        {t("common.edit")}
                                      </button>
                                      <button
                                        className="text-rose-600 hover:text-rose-700"
                                        onClick={() => handleDeleteClick(account.id)}
                                        disabled={isDeleting}
                                      >
                                        {t("common.delete")}
                                      </button>
                                    </>
                                  )}
                                  {hasActionPermission(authUser, "viewAccountTransaction") && (
                                    <button
                                      className="text-purple-600 hover:text-purple-700"
                                      onClick={() => setTransactionsModalAccountId(account.id)}
                                    >
                                      {t("accounts.transactions")}
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {Object.keys(accountsByCurrencyMap).length === 0 && (
              <div className="text-sm text-slate-500 text-center py-4">
                {t("accounts.noAccounts")}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Create Account Form */}
      {hasActionPermission(authUser, "createAccount") && (
        <SectionCard
          title={t("accounts.createAccountTitle")}
             // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
          // description={t("accounts.createAccountDescription")} 
        >
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={form.currencyCode}
              onChange={(e) => setForm((p) => ({ ...p, currencyCode: e.target.value }))}
              required
            >
              <option value="">{t("accounts.selectCurrency")}</option>
              {currencies
                .filter((c) => Boolean(c.active))
                .map((currency) => (
                  <option key={currency.id} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
            </select>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder={t("accounts.accountNamePlaceholder")}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder={t("accounts.initialFundsPlaceholder")}
              value={form.initialFunds}
              onChange={(e) => setForm((p) => ({ ...p, initialFunds: e.target.value }))}
              type="number"
              step="0.01"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
            />
            <button
              type="submit"
              disabled={isCreating}
              className="col-span-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            >
              {isCreating ? t("common.saving") : t("accounts.createAccount")}
            </button>
          </form>
        </SectionCard>
      )}

      {/* Edit Account Modal */}
      {editingId && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("accounts.editAccountTitle")}
              </h2>
              <button
                onClick={cancelEdit}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <form className="grid gap-3" onSubmit={submitEdit}>
              {editingId && (() => {
                const account = accounts.find((a) => a.id === editingId);
                return account && (
                  <div className="text-sm text-slate-600">
                    {t("accounts.account")}:{" "}
                    <span className="font-semibold">{account.name}</span>
                  </div>
                );
              })()}
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder={t("accounts.accountNamePlaceholder")}
                value={editForm.name}
                onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2"
                  placeholder={t("accounts.balance")}
                  value={editForm.balance}
                  onChange={(e) => setEditForm((p) => ({ ...p, balance: e.target.value }))}
                  type="number"
                  step="0.01"
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                />
                {editingId && (() => {
                  const account = accounts.find((a) => a.id === editingId);
                  return account && (
                    <span className="text-sm text-slate-600 whitespace-nowrap">
                      {account.currencyCode}
                    </span>
                  );
                })()}
              </div>
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-800">{t("accounts.nameDisplayTitle") || "Name Display"}</legend>
                <p className="mb-3 text-xs text-slate-500">{t("accounts.nameDisplayHint") || "Optionally style this account name with a background and text color in tables."}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColorInput
                    label={t("accounts.displayBgColor") || "Background Color"}
                    value={editForm.displayBgColor}
                    placeholder="#1e3a8a"
                    onChange={(v) => setEditForm((p) => ({ ...p, displayBgColor: v }))}
                  />
                  <ColorInput
                    label={t("accounts.displayTextColor") || "Text Color"}
                    value={editForm.displayTextColor}
                    placeholder="#ffffff"
                    onChange={(v) => setEditForm((p) => ({ ...p, displayTextColor: v }))}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {editForm.displayBgColor.trim() ? (
                    <>
                      <span className="text-xs font-medium text-slate-600">{t("common.preview") || "Preview"}:</span>
                      <span
                        className="inline-block rounded-md px-2 py-0.5 text-sm font-semibold"
                        style={{
                          backgroundColor: editForm.displayBgColor,
                          color: editForm.displayTextColor || "#ffffff",
                        }}
                      >
                        {editForm.name || t("accounts.accountNamePlaceholder")}
                      </span>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">{t("accounts.nameDisplayPreviewDefault") || "No custom styling — account name will appear as plain text."}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditForm((p) => ({ ...p, displayBgColor: "", displayTextColor: "" }))}
                    className="text-sm font-semibold text-slate-600 hover:text-slate-800"
                  >
                    {t("accounts.clearDisplayColors") || "Clear colors"}
                  </button>
                </div>
              </fieldset>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-700 transition-colors"
                >
                  {t("accounts.updateAccount")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Withdraw Funds Modal */}
      {fundsModalAccountId && fundsModalType && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {fundsModalType === "add"
                  ? t("accounts.addFundsTitle")
                  : t("accounts.withdrawFundsTitle")}
              </h2>
              <button
                onClick={closeFundsModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <form className="grid gap-3" onSubmit={handleFundsSubmit}>
              <div className="text-sm text-slate-600">
                {t("accounts.account")}:{" "}
                <span className="font-semibold">
                  {accounts.find((a) => a.id === fundsModalAccountId)?.name}
                </span>
              </div>
              {fundsModalType === "withdraw" && (() => {
                const account = accounts.find((a) => a.id === fundsModalAccountId);
                return account ? (
                  <div className="text-sm text-slate-600">
                    {t("accounts.currentBalance")}:{" "}
                    <span className={`font-semibold ${
                      account.balance < 0 ? "text-red-600" : "text-slate-900"
                    }`}>
                      {formatCurrency(account.balance, account.currencyCode)}
                    </span>
                  </div>
                ) : null;
              })()}
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder={t("accounts.amount")}
                value={fundsForm.amount}
                onChange={(e) =>
                  setFundsForm((p) => ({ ...p, amount: e.target.value }))
                }
                required
                type="number"
                step="0.01"
                min="0"
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2"
                placeholder={t("accounts.description")}
                value={fundsForm.description}
                onChange={(e) =>
                  setFundsForm((p) => ({ ...p, description: e.target.value }))
                }
              />
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeFundsModal}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow transition-colors ${
                    fundsModalType === "add"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {fundsModalType === "add"
                    ? t("accounts.addFunds")
                    : t("accounts.withdrawFunds")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedAccount ? (
        <AccountTransactionsPanel
          isOpen={!!transactionsModalAccountId}
          onClose={() => setTransactionsModalAccountId(null)}
          account={selectedAccount}
          transactions={transactions}
          onExport={handleExportSingleAccountTransactions}
        />
      ) : null}

      {/* Export Transaction Logs Modal */}
      {transactionExportModalOpen && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("accounts.exportTransactionLogs") || "Export Transaction Logs"}
              </h2>
              <button
                onClick={closeTransactionExportModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("accounts.currencyPoolFilter") || "Currency Pool"}
              </label>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                value={transactionExportCurrencyFilter}
                onChange={(e) => setTransactionExportCurrencyFilter(e.target.value)}
              >
                <option value="all">{t("accounts.allPools") || "All Pools"}</option>
                {Object.keys(accountsByCurrencyMap).map((currencyCode) => (
                  <option key={currencyCode} value={currencyCode}>
                    {currencyCode} {t("accounts.currencyPool")}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAllVisibleForTransactionExport}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {filteredAccountsForTransactionExport.every((a) =>
                  selectedTransactionExportAccountIds.has(a.id)
                ) && filteredAccountsForTransactionExport.length > 0
                  ? t("accounts.deselectAllVisible") || "Deselect All Visible"
                  : t("accounts.selectAllVisible") || "Select All Visible"}
              </button>
              <span className="text-sm text-slate-500">
                {t("accounts.selectedAccountsCount", {
                  count: selectedTransactionExportAccountIds.size,
                  total: accounts.length,
                }) || `Selected: ${selectedTransactionExportAccountIds.size} of ${accounts.length}`}
              </span>
            </div>

            <div className="mb-4 max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 w-12">
                      <input
                        type="checkbox"
                        checked={
                          filteredAccountsForTransactionExport.length > 0 &&
                          filteredAccountsForTransactionExport.every((a) =>
                            selectedTransactionExportAccountIds.has(a.id)
                          )
                        }
                        onChange={handleSelectAllVisibleForTransactionExport}
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="px-4 py-2">{t("accounts.accountName")}</th>
                    <th className="px-4 py-2">{t("accounts.currencyCode") || "Currency"}</th>
                    <th className="px-4 py-2">{t("accounts.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccountsForTransactionExport.map((account) => (
                    <tr
                      key={account.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selectedTransactionExportAccountIds.has(account.id)}
                          onChange={() => handleToggleTransactionExportSelection(account.id)}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-2 font-semibold">{account.name}</td>
                      <td className="px-4 py-2">{account.currencyCode}</td>
                      <td className="px-4 py-2">
                        {formatCurrency(account.balance, account.currencyCode)}
                      </td>
                    </tr>
                  ))}
                  {filteredAccountsForTransactionExport.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-sm text-slate-500 text-center" colSpan={4}>
                        {t("accounts.noAccounts")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeTransactionExportModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleExportSelectedTransactionLogs}
                disabled={isExportingTransactionLogs}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {isExportingTransactionLogs
                  ? t("accounts.exportingTransactionLogs") || "Exporting..."
                  : t("accounts.export") || "Export"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        message={alertModal.message}
        type={alertModal.type || "error"}
        onClose={() => setAlertModal({ isOpen: false, message: "", type: "error" })}
      />

      <ConfirmModal
        isOpen={batchDeleteConfirmModal.isOpen}
        message={batchDeleteConfirmModal.message}
        onConfirm={() => {
          if (batchDeleteConfirmModal.isBulk) {
            handleBulkDelete();
          } else if (batchDeleteConfirmModal.entityId !== null && batchDeleteConfirmModal.entityId !== undefined) {
            handleBatchDelete(batchDeleteConfirmModal.entityId);
          }
        }}
        onCancel={() => setBatchDeleteConfirmModal({ isOpen: false, message: "", entityId: null, isBulk: false })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />

      <ConfirmModal
        isOpen={clearLogsConfirmModal}
        message={t("accounts.confirmClearTransactionLogs") || "Are you sure you want to clear all transaction logs for all accounts? This action cannot be undone."}
        onConfirm={handleConfirmClearLogs}
        onCancel={() => setClearLogsConfirmModal(false)}
        confirmText={t("accounts.clearLogs") || "Clear Logs"}
        cancelText={t("common.cancel")}
        type="warning"
      />

      {/* Export Accounts Modal */}
      {exportModalOpen && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("accounts.exportAccounts") || "Export Accounts"}
              </h2>
              <button
                onClick={() => {
                  setExportModalOpen(false);
                  setSelectedAccountIds(new Set());
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="mb-4">
              <button
                onClick={handleSelectAllAccounts}
                className="text-sm text-blue-600 hover:text-blue-700 mb-3"
              >
                {selectedAccountIds.size === accounts.length
                  ? t("accounts.deselectAll") || "Deselect All"
                  : t("accounts.selectAll") || "Select All"}
              </button>
              <div className="max-h-96 overflow-y-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 w-12">
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.size === accounts.length && accounts.length > 0}
                          onChange={handleSelectAllAccounts}
                          className="rounded border-slate-300"
                        />
                      </th>
                      <th className="px-4 py-2">{t("accounts.accountName")}</th>
                      <th className="px-4 py-2">{t("accounts.currencyCode") || "Currency"}</th>
                      <th className="px-4 py-2">{t("accounts.balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr
                        key={account.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedAccountIds.has(account.id)}
                            onChange={() => handleToggleAccountSelection(account.id)}
                            className="rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-2 font-semibold">{account.name}</td>
                        <td className="px-4 py-2">{account.currencyCode}</td>
                        <td className="px-4 py-2">
                          {formatCurrency(account.balance, account.currencyCode)}
                        </td>
                      </tr>
                    ))}
                    {accounts.length === 0 && (
                      <tr>
                        <td className="px-4 py-4 text-sm text-slate-500 text-center" colSpan={4}>
                          {t("accounts.noAccounts")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setExportModalOpen(false);
                  setSelectedAccountIds(new Set());
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleExportAccounts}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition-colors"
              >
                {t("accounts.export") || "Export"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Accounts Modal */}
      {importModalOpen && (
        <div className="fixed top-0 left-0 right-0 bottom-0 w-full h-full z-[9999] flex items-center justify-center bg-black bg-opacity-50" style={{ margin: 0, padding: 0 }}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">
                {t("accounts.importAccounts") || "Import Accounts"}
              </h2>
              <button
                onClick={() => {
                  setImportModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                aria-label={t("common.close")}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-slate-600 mb-4">
                {t("accounts.importDescription") || "Select an Excel file (.xlsx) to import accounts. The file should contain 'Accounts' and 'Currencies' sheets. Missing currencies will be created automatically."}
              </p>
              <label className="block">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportFile}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </label>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setImportModalOpen(false);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

