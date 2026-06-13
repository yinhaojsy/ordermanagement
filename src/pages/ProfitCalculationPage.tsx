import { useState, useEffect, useMemo, useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import ProfitSummaryDisplay from "../components/profit/ProfitSummaryDisplay";
import { GroupAssignmentModal } from "../components/profit/GroupAssignmentModal";
import {
  useGetAccountsQuery,
  useGetCurrenciesQuery,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
  useCreateProfitCalculationMutation,
  useUpdateProfitCalculationMutation,
  useDeleteProfitCalculationMutation,
  useUpdateAccountMultiplierMutation,
  useUpdateExchangeRateMutation,
  useUpdateDepositExchangeRateMutation,
  useGetCustomerDepositTotalsByCurrencyQuery,
  useDeleteGroupMutation,
  useRenameGroupMutation,
  useSetDefaultProfitCalculationMutation,
  useUnsetDefaultProfitCalculationMutation,
} from "../services/api";
import { useProfitSummary } from "../hooks/useProfitSummary";
import { convertCurrency } from "../utils/orders/orderCalculations";
import {
  buildDepositExchangeRateMap,
  buildEffectiveExchangeRateMap,
  computeCustomerDepositConverted,
  convertDepositCurrencyAmount,
  resolveLiveExchangeRate,
} from "../utils/profit/customerDepositConversion";
import type { Account, ProfitAccountMultiplier, ProfitExchangeRate } from "../types";

// Helper function to format currency with proper number formatting
const formatCurrency = (amount: number, currencyCode: string) => {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencyCode}`;
};

export default function ProfitCalculationPage() {
  const { t } = useTranslation();
  const { data: accounts = [], isLoading: isLoadingAccounts } = useGetAccountsQuery();
  const { data: currencies = [] } = useGetCurrenciesQuery();
  const { data: calculations = [] } = useGetProfitCalculationsQuery();
  const [createCalculation, { isLoading: isCreating }] = useCreateProfitCalculationMutation();
  const [updateCalculation] = useUpdateProfitCalculationMutation();
  const [deleteCalculation, { isLoading: isDeleting }] = useDeleteProfitCalculationMutation();
  const [updateMultiplier] = useUpdateAccountMultiplierMutation();
  const [updateRate] = useUpdateExchangeRateMutation();
  const [updateDepositRate] = useUpdateDepositExchangeRateMutation();
  const { data: depositTotalsData } = useGetCustomerDepositTotalsByCurrencyQuery();
  const [deleteGroup] = useDeleteGroupMutation();
  const [renameGroup] = useRenameGroupMutation();
  const [setDefaultCalculation] = useSetDefaultProfitCalculationMutation();
  const [unsetDefaultCalculation] = useUnsetDefaultProfitCalculationMutation();

  const [selectedCalculationId, setSelectedCalculationId] = useState<number | null>(null);
  const [newCalculationName, setNewCalculationName] = useState("");
  const [newCalculationCurrency, setNewCalculationCurrency] = useState("");
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }>({
    isOpen: false,
    message: "",
    type: "error",
  });
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string; calculationId: number | null }>({
    isOpen: false,
    message: "",
    calculationId: null,
  });
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [creatingGroupForAccount, setCreatingGroupForAccount] = useState<number | null>(null);
  const [createdGroups, setCreatedGroups] = useState<string[]>([]);
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupNewName, setEditingGroupNewName] = useState("");
  const [deleteGroupModal, setDeleteGroupModal] = useState<{ isOpen: boolean; groupName: string | null }>({
    isOpen: false,
    groupName: null,
  });
  const [groupAssignmentModalOpen, setGroupAssignmentModalOpen] = useState(false);
  // Track multiplier input values to allow empty state
  const [multiplierInputs, setMultiplierInputs] = useState<Map<number, string>>(new Map());
  // Track exchange rate input values as raw strings to allow 0 and partial input
  const [exchangeRateInputs, setExchangeRateInputs] = useState<Map<string, string>>(new Map());
  const [depositExchangeRateInputs, setDepositExchangeRateInputs] = useState<Map<string, string>>(new Map());
  
  // Track pending changes that haven't been saved to DB
  const [pendingMultipliers, setPendingMultipliers] = useState<Map<number, { multiplier: number; groupId?: string; groupName?: string }>>(new Map());
  const [pendingExchangeRates, setPendingExchangeRates] = useState<Map<string, number>>(new Map());
  const [pendingDepositExchangeRates, setPendingDepositExchangeRates] = useState<Map<string, number>>(new Map());
  const [pendingUseLinkedDepositExchangeRates, setPendingUseLinkedDepositExchangeRates] = useState<boolean | null>(null);
  const [pendingInitialInvestment, setPendingInitialInvestment] = useState<number | null>(null);
  const [pendingGroupAssignments, setPendingGroupAssignments] = useState<Map<number, { groupId: string; groupName: string }>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  const { data: calculationDetails } = useGetProfitCalculationQuery(
    selectedCalculationId || 0,
    { skip: !selectedCalculationId }
  );

  // Reset createdGroups when calculation changes and sync with database groups
  useEffect(() => {
    setCreatedGroups([]);
    setMultiplierInputs(new Map()); // Reset multiplier inputs when calculation changes
    setExchangeRateInputs(new Map());
    setDepositExchangeRateInputs(new Map());
    // Reset all pending changes when calculation changes
    setPendingMultipliers(new Map());
    setPendingExchangeRates(new Map());
    setPendingDepositExchangeRates(new Map());
    setPendingUseLinkedDepositExchangeRates(null);
    setPendingInitialInvestment(null);
    setPendingGroupAssignments(new Map());
    // Sync createdGroups with database groups when calculation loads
    if (calculationDetails?.groups) {
      // Groups from database will be shown via availableGroups
      // createdGroups is only for newly created groups not yet saved
    }
  }, [selectedCalculationId, calculationDetails]);

  // Real-time balance updates: Account balances are automatically updated via RTK Query cache
  // The useMemo hooks below will automatically recalculate when accounts change

  // Create a map of account multipliers for quick lookup
  const multiplierMap = useMemo(() => {
    if (!calculationDetails) return new Map<number, ProfitAccountMultiplier>();
    const map = new Map<number, ProfitAccountMultiplier>();
    calculationDetails.multipliers.forEach((m) => {
      map.set(m.accountId, m);
    });
    return map;
  }, [calculationDetails]);

  // Create a map of exchange rates (merge with pending changes)
  const exchangeRateMap = useMemo(() => {
    if (!calculationDetails) return new Map<string, number>();
    const map = new Map<string, number>();
    calculationDetails.exchangeRates.forEach((er) => {
      const key = `${er.fromCurrencyCode}_${er.toCurrencyCode}`;
      map.set(key, er.rate);
    });
    // Override with pending changes
    pendingExchangeRates.forEach((rate, key) => {
      map.set(key, rate);
    });
    return map;
  }, [calculationDetails, pendingExchangeRates]);

  // Get all unique group names
  const availableGroups = useMemo(() => {
    const groupSet = new Set<string>();
    // Get groups from database
    if (calculationDetails?.groups) {
      calculationDetails.groups.forEach((groupName) => {
        groupSet.add(groupName);
      });
    }
    // Get groups from multipliers (for backward compatibility)
    calculationDetails?.multipliers.forEach((m) => {
      if (m.groupName) {
        groupSet.add(m.groupName);
      }
    });
    // Also include groups that were created but not yet saved
    createdGroups.forEach((groupName) => {
      groupSet.add(groupName);
    });
    return Array.from(groupSet).sort();
  }, [calculationDetails, createdGroups]);

  // Calculate account values with current balances (merge with pending changes)
  const accountCalculations = useMemo(() => {
    if (!calculationDetails) return [];
    
    return accounts.map((account) => {
      const multiplier = multiplierMap.get(account.id);
      // Check if there's a local input value (empty string means 0)
      const inputValue = multiplierInputs.get(account.id);
      let mult: number;
      if (inputValue !== undefined) {
        // If input is empty string, treat as 0, otherwise parse the value
        mult = inputValue === "" ? 0 : (isNaN(parseFloat(inputValue)) ? (multiplier?.multiplier ?? 1.0) : parseFloat(inputValue));
      } else {
        mult = multiplier?.multiplier ?? 1.0;
      }
      const calculated = account.balance * mult;
      
      // Check for pending group assignment (from pending multiplier or pending group assignments)
      const pendingMult = pendingMultipliers.get(account.id);
      const pendingGroup = pendingGroupAssignments.get(account.id);
      const groupId = pendingMult?.groupId ?? pendingGroup?.groupId ?? (multiplier?.groupId || null);
      const groupName = pendingMult?.groupName ?? pendingGroup?.groupName ?? (multiplier?.groupName || null);
      
      return {
        account,
        multiplier: multiplier || null,
        calculated,
        groupId,
        groupName,
        effectiveMultiplier: mult, // Store the effective multiplier for display
      };
    });
  }, [accounts, calculationDetails, multiplierMap, multiplierInputs, pendingMultipliers, pendingGroupAssignments]);

  // Group accounts by groupId
  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, typeof accountCalculations>();
    
    accountCalculations.forEach((item) => {
      const groupId = item.groupId || "ungrouped";
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push(item);
    });
    
    return groups;
  }, [accountCalculations]);

  // Calculate group sums by currency
  const groupSums = useMemo(() => {
    const sums = new Map<string, Map<string, number>>(); // groupId -> currency -> sum
    
    groupedAccounts.forEach((items, groupId) => {
      // Exclude "ungrouped" accounts from group sums - only include assigned groups
      if (groupId && groupId !== "ungrouped") {
        const currencySums = new Map<string, number>();
        items.forEach((item) => {
          const currency = item.account.currencyCode;
          const current = currencySums.get(currency) || 0;
          currencySums.set(currency, current + item.calculated);
        });
        sums.set(groupId, currencySums);
      }
    });
    
    return sums;
  }, [groupedAccounts]);

  // Get unique currencies from groups
  const uniqueCurrencies = useMemo(() => {
    const currenciesSet = new Set<string>();
    accountCalculations.forEach((item) => {
      if (item.groupId) {
        currenciesSet.add(item.account.currencyCode);
      }
    });
    return Array.from(currenciesSet);
  }, [accountCalculations]);

  const customerDepositTotals = useMemo(
    () => depositTotalsData?.currencies ?? [],
    [depositTotalsData],
  );

  const depositCurrencies = useMemo(
    () => customerDepositTotals.map((row) => row.currencyCode),
    [customerDepositTotals],
  );

  const depositTotalsByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    customerDepositTotals.forEach((row) => {
      map.set(row.currencyCode, row.totalFundedBalance);
    });
    return map;
  }, [customerDepositTotals]);

  const isDepositRatesLinked = useMemo(() => {
    if (pendingUseLinkedDepositExchangeRates !== null) {
      return pendingUseLinkedDepositExchangeRates;
    }
    if (!calculationDetails) return true;
    return (
      calculationDetails.useLinkedDepositExchangeRates !== false &&
      calculationDetails.useLinkedDepositExchangeRates !== 0
    );
  }, [calculationDetails, pendingUseLinkedDepositExchangeRates]);

  const effectiveExchangeRateMap = useMemo(() => {
    if (!calculationDetails) return new Map<string, number>();
    return buildEffectiveExchangeRateMap(
      calculationDetails.targetCurrencyCode,
      uniqueCurrencies,
      exchangeRateMap,
      exchangeRateInputs,
    );
  }, [calculationDetails, uniqueCurrencies, exchangeRateMap, exchangeRateInputs]);

  const depositExchangeRateMap = useMemo(() => {
    if (!calculationDetails) return new Map<string, number>();
    return buildDepositExchangeRateMap(
      calculationDetails.targetCurrencyCode,
      exchangeRateMap,
      calculationDetails.depositExchangeRates ?? [],
      isDepositRatesLinked,
      pendingDepositExchangeRates,
    );
  }, [
    calculationDetails,
    exchangeRateMap,
    isDepositRatesLinked,
    pendingDepositExchangeRates,
  ]);

  const effectiveDepositExchangeRateMap = useMemo(() => {
    if (!calculationDetails) return new Map<string, number>();
    if (isDepositRatesLinked) {
      const linkedCurrencies = Array.from(
        new Set([...uniqueCurrencies, ...depositCurrencies]),
      );
      return buildEffectiveExchangeRateMap(
        calculationDetails.targetCurrencyCode,
        linkedCurrencies,
        exchangeRateMap,
        exchangeRateInputs,
      );
    }
    return buildEffectiveExchangeRateMap(
      calculationDetails.targetCurrencyCode,
      depositCurrencies,
      depositExchangeRateMap,
      depositExchangeRateInputs,
    );
  }, [
    calculationDetails,
    isDepositRatesLinked,
    uniqueCurrencies,
    depositCurrencies,
    exchangeRateMap,
    exchangeRateInputs,
    depositExchangeRateMap,
    depositExchangeRateInputs,
  ]);

  // Calculate converted amounts
  const convertedAmounts = useMemo(() => {
    if (!calculationDetails) return new Map<string, number>();
    
    const converted = new Map<string, number>(); // currency -> converted amount
    
    groupSums.forEach((currencySums) => {
      currencySums.forEach((sum, currency) => {
        if (currency === calculationDetails.targetCurrencyCode) {
          // Same currency, no conversion needed
          const current = converted.get(currency) || 0;
          converted.set(currency, current + sum);
        } else {
          // Need to convert
          const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
          const rate = effectiveExchangeRateMap.get(key) || 0;
          if (rate > 0) {
            const convertedAmount = convertCurrency(sum, rate, currency, calculationDetails.targetCurrencyCode, currencies);
            const current = converted.get(calculationDetails.targetCurrencyCode) || 0;
            converted.set(calculationDetails.targetCurrencyCode, current + convertedAmount);
          }
        }
      });
    });
    
    return converted;
  }, [calculationDetails, groupSums, effectiveExchangeRateMap, currencies]);

  // Calculate total converted amount
  const totalConverted = useMemo(() => {
    if (!calculationDetails) return 0;
    return convertedAmounts.get(calculationDetails.targetCurrencyCode) || 0;
  }, [calculationDetails, convertedAmounts]);

  const totalCustomerDepositConverted = useMemo(() => {
    if (!calculationDetails) return 0;
    return computeCustomerDepositConverted(
      customerDepositTotals,
      calculationDetails.targetCurrencyCode,
      effectiveDepositExchangeRateMap,
      currencies,
    );
  }, [calculationDetails, customerDepositTotals, effectiveDepositExchangeRateMap, currencies]);

  // Calculate profit (use pending initial investment if available)
  const profit = useMemo(() => {
    if (!calculationDetails) return 0;
    const investment = pendingInitialInvestment !== null ? pendingInitialInvestment : calculationDetails.initialInvestment;
    return totalConverted - totalCustomerDepositConverted - investment;
  }, [calculationDetails, totalConverted, totalCustomerDepositConverted, pendingInitialInvestment]);
  
  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    // Simple check: if any pending changes exist, show the button
    const hasChanges = pendingMultipliers.size > 0 || 
           pendingExchangeRates.size > 0 ||
           pendingDepositExchangeRates.size > 0 ||
           pendingUseLinkedDepositExchangeRates !== null ||
           pendingInitialInvestment !== null ||
           pendingGroupAssignments.size > 0;
    // Debug log (remove in production)
    if (hasChanges) {
      console.log('Has unsaved changes:', {
        multipliers: pendingMultipliers.size,
        rates: pendingExchangeRates.size,
        investment: pendingInitialInvestment,
        groups: pendingGroupAssignments.size
      });
    }
    return hasChanges;
  }, [
    pendingMultipliers,
    pendingExchangeRates,
    pendingDepositExchangeRates,
    pendingUseLinkedDepositExchangeRates,
    pendingInitialInvestment,
    pendingGroupAssignments,
  ]);

  const handleCreateCalculation = async () => {
    if (!newCalculationName || !newCalculationCurrency) {
      setAlertModal({
        isOpen: true,
        message: t("profit.nameAndCurrencyRequired"),
        type: "error",
      });
      return;
    }

    try {
      const result = await createCalculation({
        name: newCalculationName,
        targetCurrencyCode: newCalculationCurrency,
        initialInvestment: 0,
      }).unwrap();
      setSelectedCalculationId(result.id);
      setNewCalculationName("");
      setNewCalculationCurrency("");
      setAlertModal({
        isOpen: true,
        message: t("profit.calculationCreated"),
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorCreating"),
        type: "error",
      });
    }
  };

  const handleDeleteClick = (id: number) => {
    const calculation = calculations.find((c) => c.id === id);
    setConfirmModal({
      isOpen: true,
      message: t("profit.confirmDelete") || `Are you sure you want to delete ${calculation?.name}?`,
      calculationId: id,
    });
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCalculation(id).unwrap();
      if (selectedCalculationId === id) {
        setSelectedCalculationId(null);
      }
      setConfirmModal({ isOpen: false, message: "", calculationId: null });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorDeleting"),
        type: "error",
      });
    }
  };

  // Save all pending changes to database
  const handleSaveAllChanges = async () => {
    if (!selectedCalculationId || !hasUnsavedChanges) return;
    
    setIsSaving(true);
    try {
      const promises: Promise<any>[] = [];
      
      // Save pending multipliers
      pendingMultipliers.forEach((data, accountId) => {
        promises.push(
          updateMultiplier({
            calculationId: selectedCalculationId,
            accountId,
            multiplier: data.multiplier,
            groupId: data.groupId,
            groupName: data.groupName,
          }).unwrap()
        );
      });
      
      // Save pending exchange rates
      pendingExchangeRates.forEach((rate, key) => {
        const [fromCurrency, toCurrency] = key.split('_');
        promises.push(
          updateRate({
            calculationId: selectedCalculationId,
            fromCurrencyCode: fromCurrency,
            toCurrencyCode: toCurrency,
            rate,
          }).unwrap()
        );
      });

      if (pendingUseLinkedDepositExchangeRates !== null) {
        promises.push(
          updateCalculation({
            id: selectedCalculationId,
            data: { useLinkedDepositExchangeRates: pendingUseLinkedDepositExchangeRates },
          }).unwrap(),
        );
      }

      if (pendingUseLinkedDepositExchangeRates !== true) {
        pendingDepositExchangeRates.forEach((rate, key) => {
          const [fromCurrency, toCurrency] = key.split("_");
          promises.push(
            updateDepositRate({
              calculationId: selectedCalculationId,
              fromCurrencyCode: fromCurrency,
              toCurrencyCode: toCurrency,
              rate,
            }).unwrap(),
          );
        });
      }
      
      // Save pending initial investment
      if (pendingInitialInvestment !== null) {
        promises.push(
          updateCalculation({
            id: selectedCalculationId,
            data: { initialInvestment: pendingInitialInvestment },
          }).unwrap()
        );
      }
      
      // Note: Group assignments are already included in pendingMultipliers above,
      // so we don't need to save them separately
      
      await Promise.all(promises);
      
      setPendingMultipliers(new Map());
      setPendingExchangeRates(new Map());
      setPendingDepositExchangeRates(new Map());
      setPendingUseLinkedDepositExchangeRates(null);
      setPendingInitialInvestment(null);
      setPendingGroupAssignments(new Map());
      // Clear multiplier and exchange rate inputs to sync with database
      setMultiplierInputs(new Map());
      setExchangeRateInputs(new Map());
      setDepositExchangeRateInputs(new Map());

      setAlertModal({
        isOpen: true,
        message: t("profit.changesSaved") || "All changes saved successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorSaving") || "Error saving changes",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditGroup = (groupName: string) => {
    setEditingGroupName(groupName);
    setEditingGroupNewName(groupName);
  };

  const handleSaveGroupEdit = async () => {
    if (!selectedCalculationId || !editingGroupName || !editingGroupNewName.trim()) {
      setEditingGroupName(null);
      setEditingGroupNewName("");
      return;
    }

    if (editingGroupName === editingGroupNewName.trim()) {
      setEditingGroupName(null);
      setEditingGroupNewName("");
      return;
    }

    try {
      await renameGroup({
        calculationId: selectedCalculationId,
        oldGroupName: editingGroupName,
        newGroupName: editingGroupNewName.trim(),
      }).unwrap();
      setEditingGroupName(null);
      setEditingGroupNewName("");
      setAlertModal({
        isOpen: true,
        message: t("profit.groupRenamed") || `Group renamed successfully.`,
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorRenamingGroup") || "Error renaming group",
        type: "error",
      });
    }
  };

  const handleCancelGroupEdit = () => {
    setEditingGroupName(null);
    setEditingGroupNewName("");
  };

  const handleDeleteGroupClick = (groupName: string) => {
    setDeleteGroupModal({
      isOpen: true,
      groupName,
    });
  };

  const handleDeleteGroup = async () => {
    if (!selectedCalculationId || !deleteGroupModal.groupName) {
      setDeleteGroupModal({ isOpen: false, groupName: null });
      return;
    }

    try {
      await deleteGroup({
        calculationId: selectedCalculationId,
        groupName: deleteGroupModal.groupName,
      }).unwrap();
      setDeleteGroupModal({ isOpen: false, groupName: null });
      setAlertModal({
        isOpen: true,
        message: t("profit.groupDeleted") || `Group deleted successfully. Accounts have been unassigned.`,
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorDeletingGroup") || "Error deleting group",
        type: "error",
      });
    }
  };

  const handleGroupNameChange = (accountId: number, groupId: string, groupName: string) => {
    // Get current multiplier value (from pending or database)
    const pendingMult = pendingMultipliers.get(accountId);
    const multiplier = multiplierMap.get(accountId);
    const mult = pendingMult?.multiplier ?? multiplier?.multiplier ?? 1.0;
    
    // Update pending multiplier with group info (this handles both multiplier and group changes)
    setPendingMultipliers((prev) => {
      const newMap = new Map(prev);
      newMap.set(accountId, {
        multiplier: mult,
        groupId: groupId || undefined,
        groupName: groupName || undefined,
      });
      return newMap;
    });
    
    // Also update pending group assignments for tracking
    setPendingGroupAssignments((prev) => {
      const newMap = new Map(prev);
      if (groupId && groupName) {
        newMap.set(accountId, { groupId, groupName });
      } else {
        newMap.delete(accountId);
      }
      return newMap;
    });
  };

  const handleGroupSelect = (accountId: number, groupName: string) => {
    const newGroupId = groupName ? `GROUP_${groupName.toUpperCase().replace(/\s+/g, "_")}` : "";
    handleGroupNameChange(accountId, newGroupId, groupName);
  };

  const handleCreateNewGroup = async () => {
    if (!newGroupName.trim() || !selectedCalculationId) {
      setShowNewGroupInput(false);
      setNewGroupName("");
      setCreatingGroupForAccount(null);
      return;
    }
    
    const groupNameTrimmed = newGroupName.trim();
    
    // Check if group already exists
    const existingGroups = new Set<string>();
    if (calculationDetails?.groups) {
      calculationDetails.groups.forEach((g) => existingGroups.add(g));
    }
    calculationDetails?.multipliers.forEach((m) => {
      if (m.groupName) {
        existingGroups.add(m.groupName);
      }
    });
    createdGroups.forEach((g) => existingGroups.add(g));
    
    if (existingGroups.has(groupNameTrimmed)) {
      setAlertModal({
        isOpen: true,
        message: t("profit.groupAlreadyExists") || `Group "${groupNameTrimmed}" already exists.`,
        type: "warning",
      });
      setShowNewGroupInput(false);
      setNewGroupName("");
      setCreatingGroupForAccount(null);
      return;
    }
    
    try {
      // Get current groups from database
      const currentGroups = calculationDetails?.groups || [];
      const updatedGroups = [...currentGroups, groupNameTrimmed];
      
      // Save to database
      await updateCalculation({
        id: selectedCalculationId,
        data: { groups: updatedGroups },
      }).unwrap();

      // If we're creating a group for a specific account, assign it immediately
      if (creatingGroupForAccount !== null) {
        const newGroupId = `GROUP_${groupNameTrimmed.toUpperCase().replace(/\s+/g, "_")}`;
        await handleGroupNameChange(creatingGroupForAccount, newGroupId, groupNameTrimmed);
      }
      
      setShowNewGroupInput(false);
      setNewGroupName("");
      setCreatingGroupForAccount(null);
      
      setAlertModal({
        isOpen: true,
        message: t("profit.groupCreated") || `Group "${groupNameTrimmed}" created. You can now assign accounts to it.`,
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorCreatingGroup") || "Error creating group",
        type: "error",
      });
    }
  };

  // Handler for creating group from modal
  const handleModalCreateGroup = async (groupName: string) => {
    if (!selectedCalculationId) {
      throw new Error("No calculation selected");
    }

    const groupNameTrimmed = groupName.trim();
    
    // Check if group already exists
    const existingGroups = new Set<string>();
    if (calculationDetails?.groups) {
      calculationDetails.groups.forEach((g) => existingGroups.add(g));
    }
    calculationDetails?.multipliers.forEach((m) => {
      if (m.groupName) {
        existingGroups.add(m.groupName);
      }
    });
    createdGroups.forEach((g) => existingGroups.add(g));
    
    if (existingGroups.has(groupNameTrimmed)) {
      const error = new Error(t("profit.groupAlreadyExists") || `Group "${groupNameTrimmed}" already exists.`);
      setAlertModal({
        isOpen: true,
        message: error.message,
        type: "warning",
      });
      throw error;
    }
    
    // Get current groups from database
    const currentGroups = calculationDetails?.groups || [];
    const updatedGroups = [...currentGroups, groupNameTrimmed];
    
    // Save to database
    await updateCalculation({
      id: selectedCalculationId,
      data: { groups: updatedGroups },
    }).unwrap();
  };

  // Handler for applying group assignments from modal
  const handleModalApplyGroup = async (groupId: string, groupName: string, accountIds: number[]) => {
    if (!selectedCalculationId) {
      throw new Error("No calculation selected");
    }

    try {
      // Get all accounts that should be in this group
      const accountsToAssign = new Set(accountIds);
      
      // Get all accounts currently in this group
      const currentAccountsInGroup = calculationDetails?.multipliers
        .filter((m: ProfitAccountMultiplier) => m.groupId === groupId || m.groupName === groupName)
        .map((m: ProfitAccountMultiplier) => m.accountId) || [];
      
      // Assign new accounts or update existing ones
      const promises: Promise<any>[] = [];
      
      // Process all accounts - assign or unassign as needed
      for (const account of accounts) {
        const shouldBeInGroup = accountsToAssign.has(account.id);
        const isCurrentlyInGroup = currentAccountsInGroup.includes(account.id);
        
        if (shouldBeInGroup && !isCurrentlyInGroup) {
          // Assign to group
          const multiplier = multiplierMap.get(account.id);
          const mult = multiplier?.multiplier ?? 1.0;
          promises.push(
            updateMultiplier({
              calculationId: selectedCalculationId,
              accountId: account.id,
              multiplier: mult,
              groupId,
              groupName,
            }).unwrap()
          );
        } else if (!shouldBeInGroup && isCurrentlyInGroup) {
          // Unassign from group
          const multiplier = multiplierMap.get(account.id);
          const mult = multiplier?.multiplier ?? 1.0;
          promises.push(
            updateMultiplier({
              calculationId: selectedCalculationId,
              accountId: account.id,
              multiplier: mult,
              groupId: undefined,
              groupName: undefined,
            }).unwrap()
          );
        }
      }
      
      await Promise.all(promises);
      
      setAlertModal({
        isOpen: true,
        message: t("profit.groupAssignmentsSaved") || "Group assignments saved successfully",
        type: "success",
      });
    } catch (error: any) {
      setAlertModal({
        isOpen: true,
        message: error?.data?.message || t("profit.errorSaving") || "Error saving group assignments",
        type: "error",
      });
      throw error;
    }
  };

  // Find default calculation
  const defaultCalculation = calculations.find((calc) => calc.isDefault === 1 || calc.isDefault === true);
  const { data: defaultCalculationDetails } = useGetProfitCalculationQuery(
    defaultCalculation?.id || 0,
    { skip: !defaultCalculation }
  );

  // Use shared hook for profit summary calculation
  const defaultSummary = useProfitSummary(
    defaultCalculationDetails,
    accounts,
    currencies,
    customerDepositTotals,
  );

  const handleStartDepositRatesEdit = useCallback(() => {
    if (!calculationDetails) return;
    setPendingUseLinkedDepositExchangeRates(false);

    const seeded = new Map<string, number>();
    depositCurrencies.forEach((currency) => {
      const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
      const linkedRate = exchangeRateMap.get(key);
      if (linkedRate && linkedRate > 0) {
        seeded.set(key, linkedRate);
        return;
      }
      const customRate = calculationDetails.depositExchangeRates?.find(
        (er) =>
          er.fromCurrencyCode === currency &&
          er.toCurrencyCode === calculationDetails.targetCurrencyCode,
      )?.rate;
      if (customRate && customRate > 0) {
        seeded.set(key, customRate);
      }
    });
    setPendingDepositExchangeRates(seeded);
    setDepositExchangeRateInputs(new Map());
  }, [calculationDetails, depositCurrencies, exchangeRateMap]);

  const handleResetDepositRatesToMatch = useCallback(() => {
    setPendingUseLinkedDepositExchangeRates(true);
    setPendingDepositExchangeRates(new Map());
    setDepositExchangeRateInputs(new Map());
  }, []);

  return (
    <div className="space-y-6">
      {/* Default Calculation Summary */}
      {defaultCalculation && defaultSummary && (
        <SectionCard
          title={t("profit.defaultCalculationSummary") || `Default Calculation: ${defaultCalculation.name}`}
             // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
          // description={t("profit.defaultCalculationSummaryDesc") || "Summary of the default profit calculation"}
          
        >
          <ProfitSummaryDisplay summary={defaultSummary} currencies={currencies} />
        </SectionCard>
      )}

      {/* Calculation Selection */}
      <SectionCard
        title={t("profit.calculationSelection")}
           // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
        // description={t("profit.calculationSelectionDesc")}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              {t("profit.selectCalculation")}
            </label>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={selectedCalculationId || ""}
              onChange={(e) => setSelectedCalculationId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t("profit.selectCalculation")}</option>
              {calculations.map((calc) => (
                <option key={calc.id} value={calc.id}>
                  {calc.name}
                </option>
              ))}
            </select>
          </div>
          {selectedCalculationId && (
            <div className="flex items-end gap-2">
              {(() => {
                const selectedCalc = calculations.find((c) => c.id === selectedCalculationId);
                const isDefault = selectedCalc?.isDefault === 1 || selectedCalc?.isDefault === true;
                return (
                  <button
                    onClick={async () => {
                      try {
                        if (isDefault) {
                          await unsetDefaultCalculation({ id: selectedCalculationId }).unwrap();
                          setAlertModal({
                            isOpen: true,
                            message: t("profit.defaultUnset") || "Default calculation unset successfully",
                            type: "success",
                          });
                        } else {
                          await setDefaultCalculation({ id: selectedCalculationId }).unwrap();
                          setAlertModal({
                            isOpen: true,
                            message: t("profit.defaultSet") || "Default calculation set successfully",
                            type: "success",
                          });
                        }
                      } catch (error: any) {
                        setAlertModal({
                          isOpen: true,
                          message: error?.data?.message || t("profit.errorSettingDefault") || "Error setting default calculation",
                          type: "error",
                        });
                      }
                    }}
                    className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                      isDefault
                        ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                        : "border-blue-300 text-blue-700 hover:bg-blue-50"
                    }`}
                  >
                    {isDefault ? (t("profit.unsetDefault") || "Unset Default") : (t("profit.setDefault") || "Set as Default")}
                  </button>
                );
              })()}
              <button
                onClick={() => handleDeleteClick(selectedCalculationId)}
                disabled={isDeleting}
                className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              >
                {t("common.delete")}
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{t("profit.createNew")}</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder={t("profit.calculationName")}
              value={newCalculationName}
              onChange={(e) => setNewCalculationName(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={newCalculationCurrency}
              onChange={(e) => setNewCalculationCurrency(e.target.value)}
            >
              <option value="">{t("profit.selectTargetCurrency")}</option>
              {currencies
                .filter((c) => Boolean(c.active))
                .map((currency) => (
                  <option key={currency.id} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
            </select>
            <button
              onClick={handleCreateCalculation}
              disabled={isCreating || !newCalculationName || !newCalculationCurrency}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
            >
              {isCreating ? t("common.saving") : t("profit.createCalculation")}
            </button>
          </div>
        </div>
      </SectionCard>

      {selectedCalculationId && calculationDetails && (
        <>
          {/* Accounts with Multipliers */}
          <SectionCard
            title={t("profit.accountsWithMultipliers")}
               // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
            // description={t("profit.accountsWithMultipliersDesc")}
            actions={
              <button
                onClick={() => setGroupAssignmentModalOpen(true)}
                className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {t("profit.assignUnassignGroup") || "Assign/Unassign Group"}
              </button>
            }
          >
            {isLoadingAccounts ? (
              <div className="text-sm text-slate-500">{t("common.loading")}</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(
                  accounts.reduce((acc, account) => {
                    if (!acc[account.currencyCode]) {
                      acc[account.currencyCode] = [];
                    }
                    acc[account.currencyCode].push(account);
                    return acc;
                  }, {} as Record<string, Account[]>)
                ).map(([currencyCode, currencyAccounts]) => {
                  const currency = currencies.find((c) => c.code === currencyCode);
                  return (
                    <div
                      key={currencyCode}
                      className="border border-slate-200 rounded-lg p-4 bg-slate-50"
                    >
                      <h3 className="text-lg font-semibold text-slate-900 mb-3">
                        {currencyCode} {t("profit.currencyPool")}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-600">
                              <th className="py-2">{t("profit.accountName")}</th>
                              <th className="py-2">{t("profit.funds")}</th>
                              <th className="py-2">{t("profit.multiplier")}</th>
                              <th className="py-2">{t("profit.calculated")}</th>
                              <th className="py-2">{t("profit.group")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currencyAccounts.map((account) => {
                              const calc = accountCalculations.find((c) => c.account.id === account.id);
                              const mult = calc?.effectiveMultiplier ?? 1.0;
                              const calculated = calc?.calculated ?? (account.balance * mult);
                              const groupId = calc?.groupId || "";
                              const groupName = calc?.groupName || "";
                              
                              // Get the display value for the input
                              const inputValue = multiplierInputs.get(account.id);
                              const displayValue = inputValue !== undefined ? inputValue : mult.toString();
                              
                              return (
                                <tr key={account.id} className="border-b border-slate-100">
                                  <td className="py-2 font-semibold">{account.name}</td>
                                  <td className="py-2">
                                    {formatCurrency(account.balance, currencyCode)}
                                  </td>
                                  <td className="py-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="w-24 rounded border border-slate-200 px-2 py-1"
                                      value={displayValue}
                                      onChange={(e) => {
                                        const inputValue = e.target.value;
                                        // Update local state immediately for responsive UI
                                        setMultiplierInputs((prev) => {
                                          const newMap = new Map(prev);
                                          newMap.set(account.id, inputValue);
                                          return newMap;
                                        });
                                        
                                        // Parse and store as pending change
                                        const parsed = parseFloat(inputValue);
                                        const newMult = inputValue === "" ? 0 : (isNaN(parsed) ? 1.0 : Math.max(0, parsed));
                                        
                                        // Store as pending change
                                        setPendingMultipliers((prev) => {
                                          const newMap = new Map(prev);
                                          newMap.set(account.id, {
                                            multiplier: newMult,
                                            groupId: groupId || undefined,
                                            groupName: groupName || undefined,
                                          });
                                          return newMap;
                                        });
                                      }}
                                      onBlur={(e) => {
                                        // When field loses focus, if empty, set to 0
                                        const inputValue = e.target.value;
                                        if (inputValue === "") {
                                          setMultiplierInputs((prev) => {
                                            const newMap = new Map(prev);
                                            newMap.set(account.id, "0");
                                            return newMap;
                                          });
                                          setPendingMultipliers((prev) => {
                                            const newMap = new Map(prev);
                                            newMap.set(account.id, {
                                              multiplier: 0,
                                              groupId: groupId || undefined,
                                              groupName: groupName || undefined,
                                            });
                                            return newMap;
                                          });
                                        }
                                      }}
                                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                    />
                                  </td>
                                  <td className="py-2 font-semibold">
                                    {formatCurrency(calculated, currencyCode)}
                                  </td>
                                  <td className="py-2">
                                    <select
                                      key={`group-select-${account.id}-${availableGroups.length}`}
                                      className="w-40 rounded border border-slate-200 px-2 py-1 text-sm"
                                      value={groupName || ""}
                                      onChange={(e) => {
                                        if (e.target.value === "") {
                                          handleGroupNameChange(account.id, "", "");
                                        } else {
                                          handleGroupSelect(account.id, e.target.value);
                                        }
                                      }}
                                    >
                                      <option value="">{t("profit.noGroup")}</option>
                                      {availableGroups.map((g: string) => (
                                        <option key={g} value={g}>
                                          {g}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Groups Section */}
          <SectionCard
            title={t("profit.groups")}
               // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
            // description={t("profit.groupsDesc")}
            actions={
              <div className="flex gap-2">
                {!showNewGroupInput ? (
                  <button
                    onClick={() => {
                      setShowNewGroupInput(true);
                      setCreatingGroupForAccount(null);
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  >
                    {t("profit.createNewGroup")}
                  </button>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="rounded border border-slate-200 px-3 py-2 text-sm"
                      placeholder={t("profit.newGroupName")}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleCreateNewGroup();
                        } else if (e.key === "Escape") {
                          setShowNewGroupInput(false);
                          setNewGroupName("");
                          setCreatingGroupForAccount(null);
                        }
                      }}
                      autoFocus
                    />
                    <button
                      onClick={handleCreateNewGroup}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      onClick={() => {
                        setShowNewGroupInput(false);
                        setNewGroupName("");
                        setCreatingGroupForAccount(null);
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                )}
              </div>
            }
          >
            {availableGroups.length === 0 ? (
              <div className="text-sm text-slate-500">{t("profit.noGroups")}</div>
            ) : (
              availableGroups.map((groupName) => {
                // Find the groupId for this group name
                const groupId = `GROUP_${groupName.toUpperCase().replace(/\s+/g, "_")}`;
                const items = groupedAccounts.get(groupId) || [];
                const currencySums = groupSums.get(groupId) || new Map();
                
                return (
                  <div key={groupName} className="border border-slate-200 rounded-lg p-4 bg-white mb-4">
                    <div className="flex justify-between items-center mb-3">
                      {editingGroupName === groupName ? (
                        <div className="flex gap-2 items-center flex-1">
                          <input
                            type="text"
                            className="flex-1 rounded border border-slate-200 px-3 py-2 text-sm font-semibold"
                            value={editingGroupNewName}
                            onChange={(e) => setEditingGroupNewName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleSaveGroupEdit();
                              } else if (e.key === "Escape") {
                                handleCancelGroupEdit();
                              }
                            }}
                            autoFocus
                          />
                          <button
                            onClick={handleSaveGroupEdit}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
                            title={t("common.save")}
                          >
                            ✓
                          </button>
                          <button
                            onClick={handleCancelGroupEdit}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            title={t("common.cancel")}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <h3 className="text-lg font-semibold text-slate-900">{groupName}</h3>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditGroup(groupName)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                              title={t("common.edit")}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              onClick={() => handleDeleteGroupClick(groupName)}
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                              title={t("common.delete")}
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    {items.length > 0 ? (
                      <>
                        <div className="space-y-2 mb-4">
                          {items.map((item) => (
                            <div key={item.account.id} className="flex justify-between text-sm">
                              <span>
                                {item.account.name}: {formatCurrency(item.account.balance, item.account.currencyCode)} × {item.multiplier?.multiplier.toFixed(2) || "1.00"} = {formatCurrency(item.calculated, item.account.currencyCode)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-slate-200 pt-2">
                          <div className="text-sm font-semibold text-slate-900">
                            {t("profit.groupSum")}:
                            {Array.from(currencySums.entries()).map(([currency, sum]) => (
                              <span key={currency} className="ml-2">
                                {formatCurrency(sum, currency)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-500 italic">
                        {t("profit.noAccountsInGroup") || "No accounts assigned to this group"}
                        <div className="mt-2 text-xs">
                          {t("profit.groupSum")}: {calculationDetails?.targetCurrencyCode ? formatCurrency(0, calculationDetails.targetCurrencyCode) : "0.00"}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </SectionCard>

          {/* Currency Conversion */}
          <SectionCard
            title={t("profit.currencyConversion")}
               // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
            // description={t("profit.currencyConversionDesc")}
          >
            <div className="space-y-4">
              {uniqueCurrencies.map((currency) => {
                const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
                const rate = resolveLiveExchangeRate(
                  key,
                  currency,
                  calculationDetails.targetCurrencyCode,
                  exchangeRateMap,
                  exchangeRateInputs,
                );
                const currencySum = Array.from(groupSums.values())
                  .reduce((sum, currencySums) => sum + (currencySums.get(currency) || 0), 0);
                const converted = rate > 0
                  ? convertCurrency(currencySum, rate, currency, calculationDetails.targetCurrencyCode, currencies)
                  : currencySum;
                
                return (
                  <div key={currency} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          {currency} {t("profit.sum")}
                        </label>
                        <div className="text-lg font-semibold">
                          {formatCurrency(currencySum, currency)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          {t("profit.exchangeRate")} ({currency} → {calculationDetails.targetCurrencyCode})
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          className="w-full rounded border border-slate-200 px-2 py-1"
                          value={
                            exchangeRateInputs.has(key)
                              ? exchangeRateInputs.get(key)
                              : (rate > 0 ? rate : (currency === calculationDetails.targetCurrencyCode ? 1 : ""))
                          }
                          onChange={(e) => {
                            const inputValue = e.target.value;
                            // Track raw string for display (allows "0", "", partial input)
                            setExchangeRateInputs((prev) => {
                              const newMap = new Map(prev);
                              newMap.set(key, inputValue);
                              return newMap;
                            });
                            const parsed = parseFloat(inputValue);
                            const newRate = Number.isFinite(parsed) && parsed >= 0
                              ? parsed
                              : (currency === calculationDetails.targetCurrencyCode ? 1 : 0);
                            setPendingExchangeRates((prev) => {
                              const newMap = new Map(prev);
                              newMap.set(key, newRate);
                              return newMap;
                            });
                          }}
                          onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          {t("profit.converted")} ({calculationDetails.targetCurrencyCode})
                        </label>
                        <div className="text-lg font-bold">
                          {formatCurrency(converted, calculationDetails.targetCurrencyCode)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              <div className="border-t-2 border-slate-300 pt-4 mt-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-slate-900">
                    {t("profit.totalConverted")} ({calculationDetails.targetCurrencyCode}):
                  </span>
                  <span className="text-2xl font-bold text-slate-900">
                    {formatCurrency(totalConverted, calculationDetails.targetCurrencyCode)}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Customer deposit currency conversion */}
          <SectionCard
            title={t("profit.customerDepositConversion")}
            actions={
              <div className="flex items-center gap-2">
                {!isDepositRatesLinked && (
                  <button
                    type="button"
                    onClick={handleResetDepositRatesToMatch}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {t("profit.resetDepositRatesToMatch")}
                  </button>
                )}
                {isDepositRatesLinked ? (
                  <button
                    type="button"
                    onClick={handleStartDepositRatesEdit}
                    className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    title={t("profit.editDepositRates")}
                    aria-label={t("profit.editDepositRates")}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                ) : null}
              </div>
            }
          >
            <p className="mb-4 text-sm text-slate-500">
              {isDepositRatesLinked
                ? t("profit.depositRatesLinked")
                : t("profit.depositRatesCustom")}
            </p>
            <div className="space-y-4">
              {depositCurrencies.length === 0 ? (
                <p className="text-sm text-slate-400">{t("profit.noCustomerDeposits")}</p>
              ) : (
                depositCurrencies.map((currency) => {
                  const key = `${currency}_${calculationDetails.targetCurrencyCode}`;
                  const currencySum = depositTotalsByCurrency.get(currency) ?? 0;
                  const rate = resolveLiveExchangeRate(
                    key,
                    currency,
                    calculationDetails.targetCurrencyCode,
                    depositExchangeRateMap,
                    isDepositRatesLinked ? exchangeRateInputs : depositExchangeRateInputs,
                  );
                  const converted =
                    rate > 0
                      ? convertDepositCurrencyAmount(
                          currencySum,
                          currency,
                          calculationDetails.targetCurrencyCode,
                          effectiveDepositExchangeRateMap,
                          currencies,
                          isDepositRatesLinked ? exchangeRateInputs : depositExchangeRateInputs,
                        )
                      : currencySum;
                  const rateInputValue = depositExchangeRateInputs.has(key)
                    ? depositExchangeRateInputs.get(key)
                    : rate > 0
                      ? rate
                      : currency === calculationDetails.targetCurrencyCode
                        ? 1
                        : "";

                  return (
                    <div key={currency} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-sm font-semibold text-slate-700">
                            {t("profit.customerDepositSum", { currency })}
                          </label>
                          <div
                            className={`text-lg font-semibold ${
                              currencySum < 0 ? "text-rose-600" : "text-slate-900"
                            }`}
                          >
                            {currencySum < 0 ? "-" : ""}
                            {formatCurrency(Math.abs(currencySum), currency)}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-semibold text-slate-700">
                            {t("profit.exchangeRate")} ({currency} →{" "}
                            {calculationDetails.targetCurrencyCode})
                          </label>
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            readOnly={isDepositRatesLinked}
                            className={`w-full rounded border px-2 py-1 ${
                              isDepositRatesLinked
                                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-600"
                                : "border-slate-200"
                            }`}
                            value={rateInputValue}
                            onChange={(e) => {
                              if (isDepositRatesLinked) return;
                              const inputValue = e.target.value;
                              setDepositExchangeRateInputs((prev) => {
                                const newMap = new Map(prev);
                                newMap.set(key, inputValue);
                                return newMap;
                              });
                              const parsed = parseFloat(inputValue);
                              const newRate =
                                Number.isFinite(parsed) && parsed >= 0
                                  ? parsed
                                  : currency === calculationDetails.targetCurrencyCode
                                    ? 1
                                    : 0;
                              setPendingDepositExchangeRates((prev) => {
                                const newMap = new Map(prev);
                                newMap.set(key, newRate);
                                return newMap;
                              });
                            }}
                            onWheel={(e) => (e.target as HTMLInputElement).blur()}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-semibold text-slate-700">
                            {t("profit.converted")} ({calculationDetails.targetCurrencyCode})
                          </label>
                          <div
                            className={`text-lg font-bold ${
                              converted < 0 ? "text-rose-600" : "text-slate-900"
                            }`}
                          >
                            {converted < 0 ? "-" : ""}
                            {formatCurrency(
                              Math.abs(converted),
                              calculationDetails.targetCurrencyCode,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <div className="mt-4 border-t-2 border-slate-300 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-900">
                    {t("profit.totalCustomerDeposit")} ({calculationDetails.targetCurrencyCode}):
                  </span>
                  <span
                    className={`text-2xl font-bold ${
                      totalCustomerDepositConverted < 0 ? "text-rose-600" : "text-indigo-900"
                    }`}
                  >
                    {totalCustomerDepositConverted < 0 ? "-" : ""}
                    {formatCurrency(
                      Math.abs(totalCustomerDepositConverted),
                      calculationDetails.targetCurrencyCode,
                    )}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Final Profit Calculation */}
          <SectionCard
            title={t("profit.finalProfit")}
               // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
            // description={t("profit.finalProfitDesc")}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  {t("profit.initialInvestment")} ({calculationDetails.targetCurrencyCode})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full md:w-64 rounded-lg border border-slate-200 px-3 py-2"
                  value={pendingInitialInvestment !== null ? pendingInitialInvestment : calculationDetails.initialInvestment}
                  onChange={(e) => {
                    const investment = parseFloat(e.target.value) || 0;
                    setPendingInitialInvestment(investment);
                  }}
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                />
              </div>
              
              <div className="grid gap-4 md:grid-cols-3">
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="text-sm text-slate-600 mb-1">{t("profit.totalConverted")}</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {formatCurrency(totalConverted, calculationDetails.targetCurrencyCode)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 bg-indigo-50">
                  <div className="text-sm text-slate-600 mb-1">{t("profit.totalCustomerDeposit")}</div>
                  <div className="text-2xl font-bold text-indigo-900">
                    {formatCurrency(totalCustomerDepositConverted, calculationDetails.targetCurrencyCode)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <div className="text-sm text-slate-600 mb-1">{t("profit.initialInvestment")}</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {formatCurrency(pendingInitialInvestment !== null ? pendingInitialInvestment : calculationDetails.initialInvestment, calculationDetails.targetCurrencyCode)}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {t("profit.profitFormula")}
              </div>
              
              <div className="border-t-2 border-slate-300 pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-xl font-semibold text-slate-900">
                    {t("profit.profit")}:
                  </span>
                  <span className={`text-3xl font-bold ${
                    profit >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}>
                    {formatCurrency(profit, calculationDetails.targetCurrencyCode)}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>
          
          {/* Save Button - Show when there are unsaved changes */}
          {hasUnsavedChanges ? (
            <SectionCard title={t("common.saveAll") || "Save All Changes"}>
              <div className="flex items-center justify-between">
                <div className="text-sm text-amber-600 font-semibold">
                  {t("profit.unsavedChanges") || "You have unsaved changes"}
                </div>
                <button
                  onClick={handleSaveAllChanges}
                  disabled={isSaving}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSaving ? (t("common.saving") || "Saving...") : (t("common.saveAll") || "Save All Changes")}
                </button>
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      {!selectedCalculationId && (
        <div className="text-center py-12 text-slate-500">
          {t("profit.selectOrCreateCalculation")}
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        message={alertModal.message}
        type={alertModal.type || "error"}
        onClose={() => setAlertModal({ isOpen: false, message: "", type: "error" })}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        message={confirmModal.message}
        onConfirm={() => confirmModal.calculationId && handleDelete(confirmModal.calculationId)}
        onCancel={() => setConfirmModal({ isOpen: false, message: "", calculationId: null })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />

      <ConfirmModal
        isOpen={deleteGroupModal.isOpen}
        message={deleteGroupModal.groupName ? t("profit.confirmDeleteGroup")?.replace("{groupName}", deleteGroupModal.groupName) || `Are you sure you want to delete the group "${deleteGroupModal.groupName}"? All accounts in this group will be unassigned.` : ""}
        onConfirm={handleDeleteGroup}
        onCancel={() => setDeleteGroupModal({ isOpen: false, groupName: null })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />

      {selectedCalculationId && calculationDetails && (
        <GroupAssignmentModal
          isOpen={groupAssignmentModalOpen}
          onClose={() => setGroupAssignmentModalOpen(false)}
          accounts={accounts}
          availableGroups={availableGroups}
          calculationId={selectedCalculationId}
          multipliers={calculationDetails.multipliers}
          onCreateGroup={handleModalCreateGroup}
          onApply={handleModalApplyGroup}
        />
      )}
    </div>
  );
}

