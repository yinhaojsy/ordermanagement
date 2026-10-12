import { useMemo, useState, useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Badge from "../components/common/Badge";
import SectionCard from "../components/common/SectionCard";
import AlertModal from "../components/common/AlertModal";
import ConfirmModal from "../components/common/ConfirmModal";
import {
  useAddRoleMutation,
  useDeleteRoleMutation,
  useGetRolesQuery,
  useUpdateRoleMutation,
  useForceLogoutUsersByRoleMutation,
  useGetAccountsQuery,
} from "../services/api";
import { useAppSelector, useAppDispatch } from "../app/hooks";
import { setUser } from "../app/authSlice";
import type { Account, RoleAccountAccess, RolePermissions } from "../types";

const SECTION_OPTIONS = ["dashboard", "currencies", "customers", "users", "roles", "orders", "transfers", "accounts", "expenses", "profit", "dividends", "wallets", "tags", "referenceRates"];

// Group actions by their related pages/sections
const ACTION_GROUPS = [
  {
    section: "currencies",
    actions: [
      { key: "createCurrency", labelKey: "roles.createCurrency" },
      { key: "updateCurrency", labelKey: "roles.updateCurrency" },
    ],
  },
  {
    section: "referenceRates",
    actions: [
      { key: "displayReferenceRatesPanel", labelKey: "roles.displayReferenceRatesPanel" },
      { key: "editReferenceRates", labelKey: "roles.editReferenceRates" },
    ],
  },
  {
    section: "customers",
    actions: [
      { key: "createCustomer", labelKey: "roles.createCustomer" },
      { key: "formatCustomerColors", labelKey: "roles.formatCustomerColors" },
      { key: "updateCustomer", labelKey: "roles.updateCustomer" },
      { key: "pinCustomers", labelKey: "roles.pinCustomers" },
      { key: "deleteCustomer", labelKey: "roles.deleteCustomer" },
      { key: "submitCustomerKyc", labelKey: "roles.submitCustomerKyc" },
      { key: "approveCustomerKyc", labelKey: "roles.approveCustomerKyc" },
      { key: "reopenCustomerKyc", labelKey: "roles.reopenCustomerKyc" },
      { key: "manageKycPolicy", labelKey: "roles.manageKycPolicy" },
      { key: "viewCustomerLedger", labelKey: "roles.viewCustomerLedger" },
      { key: "createLedgerDepositWithdraw", labelKey: "roles.createLedgerDepositWithdraw" },
      { key: "editDeleteCustomerLedger", labelKey: "roles.editDeleteCustomerLedger" },
    ],
  },
  {
    section: "users",
    actions: [
      { key: "createUser", labelKey: "roles.createUser" },
      { key: "editDeleteUser", labelKey: "roles.editDeleteUser" },
    ],
  },
  {
    section: "orders",
    actions: [
      { key: "createOrder", labelKey: "roles.createOrder" },
      { key: "editAnyOrder", labelKey: "roles.editAnyOrder" },
      { key: "cancelOrder", labelKey: "roles.cancelOrder" },
      { key: "deleteOrder", labelKey: "roles.deleteOrder" },
      { key: "deleteManyOrders", labelKey: "roles.deleteManyOrders" },
      { key: "importOrder", labelKey: "roles.importOrder" },
      { key: "exportOrder", labelKey: "roles.exportOrder" },
      { key: "assignUnassignOrderTag", labelKey: "roles.assignUnassignOrderTag" },
      { key: "pinOrders", labelKey: "roles.pinOrders" },
    ],
  },
  {
    section: "transfers",
    actions: [
      { key: "createTransfer", labelKey: "roles.createTransfer" },
      { key: "updateTransfer", labelKey: "roles.updateTransfer" },
      { key: "deleteTransfer", labelKey: "roles.deleteTransfer" },
      { key: "viewTransferAuditTrail", labelKey: "roles.viewTransferAuditTrail" },
      { key: "importTransfer", labelKey: "roles.importTransfer" },
      { key: "exportTransfer", labelKey: "roles.exportTransfer" },
      { key: "assignUnassignTransferTag", labelKey: "roles.assignUnassignTransferTag" },
    ],
  },
  {
    section: "accounts",
    actions: [
      { key: "createAccount", labelKey: "roles.createAccount" },
      { key: "updateAccount", labelKey: "roles.updateAccount" },
      { key: "deleteAccount", labelKey: "roles.deleteAccount" },
      { key: "deleteManyAccounts", labelKey: "roles.deleteManyAccounts" },
      { key: "viewAccountTransaction", labelKey: "roles.viewAccountTransaction" },
      { key: "importAccount", labelKey: "roles.importAccount" },
      { key: "exportAccount", labelKey: "roles.exportAccount" },
      { key: "clearTransactionLogs", labelKey: "roles.clearTransactionLogs" },
      { key: "manageAccountsDisplay", labelKey: "roles.manageAccountsDisplay" },
    ],
  },
  {
    section: "expenses",
    actions: [
      { key: "createExpense", labelKey: "roles.createExpense" },
      { key: "editExpense", labelKey: "roles.editExpense" },
      { key: "deleteExpense", labelKey: "roles.deleteExpense" },
      { key: "viewExpenseAuditTrail", labelKey: "roles.viewExpenseAuditTrail" },
      { key: "importExpense", labelKey: "roles.importExpense" },
      { key: "exportExpense", labelKey: "roles.exportExpense" },
      { key: "assignUnassignExpenseTag", labelKey: "roles.assignUnassignExpenseTag" },
    ],
  },
  {
    section: "wallets",
    actions: [
      { key: "createWallet", labelKey: "roles.createWallet" },
      { key: "updateWallet", labelKey: "roles.updateWallet" },
      { key: "deleteWallet", labelKey: "roles.deleteWallet" },
      { key: "viewWalletTransactions", labelKey: "roles.viewWalletTransactions" },
    ],
  },
  {
    section: "tags",
    actions: [
      { key: "createTag", labelKey: "roles.createTag" },
      { key: "deleteTag", labelKey: "roles.deleteTag" },
    ],
  },
];

// Flatten all actions for backward compatibility
const ACTION_OPTIONS = ACTION_GROUPS.flatMap((group) => group.actions);

const ACCOUNT_SCOPE_GROUPS = [
  {
    title: "Accounts Page",
    scopes: [{ key: "account.view", label: "Visible accounts" }],
  },
  {
    title: "Expenses",
    scopes: [{ key: "expense.account", label: "Expense account" }],
  },
  {
    title: "Internal Transfers",
    scopes: [{ key: "transfer.account", label: "Transfer accounts" }],
  },
  {
    title: "Orders",
    scopes: [{ key: "order.account", label: "Order accounts" }],
  },
  {
    title: "Profit / Service Charges",
    scopes: [
      { key: "profit.account", label: "Profit accounts" },
      { key: "serviceCharge.account", label: "Service charge accounts" },
    ],
  },
];

const getDefaultAccountAccess = (): RoleAccountAccess =>
  ACCOUNT_SCOPE_GROUPS.flatMap((group) => group.scopes).reduce<RoleAccountAccess>((acc, scope) => {
    acc[scope.key] = { mode: "all", accountIds: [] };
    return acc;
  }, {});

const normalizeAccountAccess = (access?: RoleAccountAccess): RoleAccountAccess => ({
  ...getDefaultAccountAccess(),
  ...(access || {}),
});

function AccountAccessEditor({
  accountAccess,
  onChange,
  accounts,
}: {
  accountAccess: RoleAccountAccess;
  onChange: (accountAccess: RoleAccountAccess) => void;
  accounts: Account[];
}) {
  const normalizedAccess = normalizeAccountAccess(accountAccess);

  const updateScope = (scope: string, nextValue: RoleAccountAccess[string]) => {
    onChange({
      ...normalizedAccess,
      [scope]: nextValue,
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-700">Account Access</div>
        <p className="text-xs text-slate-500">
          Choose whether this role can use all accounts or only selected accounts in each area.
        </p>
      </div>

      <div className="space-y-5">
        {ACCOUNT_SCOPE_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group.title}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {group.scopes.map((scope) => {
                const rule = normalizedAccess[scope.key] || { mode: "all", accountIds: [] };
                const selectedIds = new Set(rule.accountIds || []);

                return (
                  <div key={scope.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 text-sm font-medium text-slate-700">{scope.label}</div>
                    <div className="mb-3 flex gap-3 text-xs text-slate-600">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          checked={rule.mode !== "selected"}
                          onChange={() => updateScope(scope.key, { mode: "all", accountIds: [] })}
                          className="border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        All accounts
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          checked={rule.mode === "selected"}
                          onChange={() => updateScope(scope.key, { mode: "selected", accountIds: rule.accountIds || [] })}
                          className="border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        Selected only
                      </label>
                    </div>

                    {rule.mode === "selected" && (
                      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md bg-slate-50 p-2">
                        {accounts.map((account) => (
                          <label key={account.id} className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(account.id)}
                              onChange={(event) => {
                                const nextIds = event.target.checked
                                  ? [...selectedIds, account.id]
                                  : [...selectedIds].filter((id) => id !== account.id);
                                updateScope(scope.key, { mode: "selected", accountIds: nextIds });
                              }}
                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span>
                              {account.name} ({account.currencyCode})
                            </span>
                          </label>
                        ))}
                        {!accounts.length && (
                          <div className="text-xs text-slate-500">No accounts available.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RolesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.auth.user);
  const { data: roles = [], isLoading } = useGetRolesQuery();
  const { data: accounts = [] } = useGetAccountsQuery();
  const [addRole, { isLoading: isSaving }] = useAddRoleMutation();
  const [updateRole] = useUpdateRoleMutation();
  const [deleteRole, { isLoading: isDeleting }] = useDeleteRoleMutation();
  const [forceLogoutUsers, { isLoading: isLoggingOut }] = useForceLogoutUsersByRoleMutation();

  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }>({
    isOpen: false,
    message: "",
    type: "error",
  });

  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string; roleId: number | null }>({
    isOpen: false,
    message: "",
    roleId: null,
  });

  const [logoutConfirmModal, setLogoutConfirmModal] = useState<{ 
    isOpen: boolean; 
    message: string; 
    roleId: number | null;
    roleName: string;
  }>({
    isOpen: false,
    message: "",
    roleId: null,
    roleName: "",
  });

  const [form, setForm] = useState<{
    name: string;
    displayName: string;
    permissions: RolePermissions;
    accountAccess: RoleAccountAccess;
  }>({
    name: "",
    displayName: "",
    permissions: {
      sections: ["dashboard", "orders"],
      actions: { createOrder: true, processOrder: true },
    },
    accountAccess: getDefaultAccountAccess(),
  });

  const actionEnabled = useMemo(
    () => (action: string) => Boolean(form.permissions.actions[action]),
    [form.permissions.actions],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name || !form.displayName) return;
    await addRole(form);
    setForm({
      name: "",
      displayName: "",
      permissions: { sections: ["dashboard"], actions: {} },
      accountAccess: getDefaultAccountAccess(),
    });
    setAddActiveTab("dashboard");
    setShowForm(false);
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof form | null>(null);
  const [editActiveTab, setEditActiveTab] = useState<string | null>(null);
  const [addActiveTab, setAddActiveTab] = useState<string | null>("dashboard");
  const [showForm, setShowForm] = useState(false);

  const startEdit = (id: number) => {
    const current = roles.find((r) => r.id === id);
    if (!current) return;
    setEditingId(id);
    setEditForm({
      name: current.name,
      displayName: current.displayName,
      permissions: current.permissions,
      accountAccess: normalizeAccountAccess(current.accountAccess),
    });
    // Initialize the active tab for editing to the first visible section
    const visibleGroups = ACTION_GROUPS.filter((group) =>
      current.permissions.sections.includes(group.section)
    );
    setEditActiveTab(visibleGroups.length > 0 ? visibleGroups[0].section : null);
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditActiveTab(null);
    setShowForm(false);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editForm) return;
    
    const updatedRole = await updateRole({
      id: editingId,
      data: editForm,
    }).unwrap();
    
    // Check if the updated role matches the current user's role
    // If so, force logout so they need to login again with new permissions
    // Note: Other users with this role will be logged out automatically via SSE in AppLayout
    if (currentUser && updatedRole.name === currentUser.role) {
      dispatch(setUser(null));
      setAlertModal({
        isOpen: true,
        message: t("roles.roleUpdatedLogout") || "Your role permissions have been updated. Please login again to apply the new permissions.",
        type: "info",
      });
      // Navigate to login after a short delay
      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 2000);
      return;
    }
    
    cancelEdit();
  };

  const handleDeleteClick = (id: number) => {
    const role = roles.find((r) => r.id === id);
    if (!role) return;
    
    setConfirmModal({
      isOpen: true,
      message: t("roles.confirmDelete") || `Are you sure you want to delete ${role.displayName}?`,
      roleId: id,
    });
  };

  const remove = async (id: number) => {
    try {
      await deleteRole(id).unwrap();
      setConfirmModal({ isOpen: false, message: "", roleId: null });
    } catch (err: any) {
      let message = t("roles.cannotDeleteReferenced");
      
      if (err?.data) {
        let errorMessage = '';
        if (typeof err.data === 'string') {
          errorMessage = err.data;
        } else if (err.data.message) {
          errorMessage = err.data.message;
        }
        
        // Check if it's the generic server error message and translate it
        if (errorMessage === "Cannot delete this item because it is referenced by other records.") {
          message = t("roles.cannotDeleteReferenced");
        } else if (errorMessage) {
          // Check if it's the role deletion error with users
          const roleErrorMatch = errorMessage.match(/Cannot delete role "([^"]+)" because it is assigned to (\d+) user\(s\)\. Please reassign or remove those users first\./);
          if (roleErrorMatch) {
            const [, roleName, userCount] = roleErrorMatch;
            message = t("roles.cannotDeleteRoleWithUsers", { roleName, count: Number(userCount) });
          } else {
            message = errorMessage;
          }
        }
      }
      
      setConfirmModal({ isOpen: false, message: "", roleId: null });
      setAlertModal({ isOpen: true, message, type: "error" });
    }
  };

  const handleForceLogoutClick = (id: number) => {
    const role = roles.find((r) => r.id === id);
    if (!role) return;
    
    setLogoutConfirmModal({
      isOpen: true,
      message: t("roles.confirmForceLogout") || `Are you sure you want to force logout all users with role "${role.displayName}"?`,
      roleId: id,
      roleName: role.name,
    });
  };

  const confirmForceLogout = async (id: number) => {
    try {
      const result = await forceLogoutUsers(id).unwrap();
      setLogoutConfirmModal({ isOpen: false, message: "", roleId: null, roleName: "" });
      setAlertModal({
        isOpen: true,
        message: result.message || t("roles.forceLogoutSuccess") || "Users will be logged out immediately.",
        type: "success",
      });
      
      // If current user has this role, they will be logged out automatically via SSE
      // But let's also handle it locally for immediate feedback
      const role = roles.find((r) => r.id === id);
      if (currentUser && role && currentUser.role === role.name) {
        setTimeout(() => {
          dispatch(setUser(null));
          navigate("/login", { replace: true });
        }, 2000);
      }
    } catch (err: any) {
      setLogoutConfirmModal({ isOpen: false, message: "", roleId: null, roleName: "" });
      setAlertModal({
        isOpen: true,
        message: err?.data?.message || t("roles.forceLogoutError") || "Failed to force logout users.",
        type: "error",
      });
    }
  };

  // Component to render sections and actions in 2-column layout with tabs
  const SectionsAndActionsEditor = ({
    permissions,
    onChange,
    activeTab,
    setActiveTab,
  }: {
    permissions: RolePermissions;
    onChange: (permissions: RolePermissions) => void;
    activeTab: string | null;
    setActiveTab: (tab: string | null) => void;
  }) => {
    // Filter groups to only show sections that are selected
    const visibleGroups = ACTION_GROUPS.filter((group) =>
      permissions.sections.includes(group.section)
    );

    // Update active tab when visible groups change
    useEffect(() => {
      if (visibleGroups.length > 0) {
        const firstVisible = visibleGroups[0].section;
        if (activeTab === null || !visibleGroups.find((g) => g.section === activeTab)) {
          setActiveTab(firstVisible);
        }
      } else {
        setActiveTab(null);
      }
    }, [permissions.sections.join(",")]);

    const handleSectionToggle = (section: string, checked: boolean) => {
      const nextSections = checked
        ? [...permissions.sections, section]
        : permissions.sections.filter((s) => s !== section);

      // If section is unchecked, uncheck all its actions
      let nextActions = { ...permissions.actions };
      if (!checked) {
        const group = ACTION_GROUPS.find((g) => g.section === section);
        if (group) {
          group.actions.forEach((action) => {
            nextActions[action.key] = false;
          });
        }
        // If the unchecked section was the active tab, switch to first available
        if (activeTab === section && visibleGroups.length > 1) {
          const remainingGroups = visibleGroups.filter((g) => g.section !== section);
          if (remainingGroups.length > 0) {
            setActiveTab(remainingGroups[0].section);
          }
        }
      } else {
        // If section is checked and no tab is active, make it active
        if (activeTab === null) {
          setActiveTab(section);
        }
      }

      onChange({
        ...permissions,
        sections: nextSections,
        actions: nextActions,
      });
    };

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Sections */}
        <div>
          <div className="mb-3 text-sm font-semibold text-slate-700">{t("roles.sectionsLabel")}</div>
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
            {SECTION_OPTIONS.map((section) => {
              const isChecked = permissions.sections.includes(section);
              const sectionName = t(`sections.${section}`) || section;
              const group = ACTION_GROUPS.find((g) => g.section === section);
              const actionCount = group ? group.actions.length : 0;

              return (
                <label
                  key={section}
                  className={`flex items-center justify-between gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-white border-2 border-amber-500 shadow-sm"
                      : "bg-slate-100 border-2 border-transparent hover:bg-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => handleSectionToggle(section, e.target.checked)}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{sectionName}</span>
                  </div>
                  {actionCount > 0 && (
                    <Badge tone={isChecked ? "emerald" : "slate"}>
                      {actionCount}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Right Column: Actions in Tabs */}
        <div className="lg:col-span-2">
          <div className="mb-3 text-sm font-semibold text-slate-700">{t("roles.actionsLabel")}</div>
          {visibleGroups.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm text-slate-500">
                {t("roles.selectSectionFirst") || "Please select at least one section to see available actions."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              {/* Tabs */}
              <div className="border-b border-slate-200 bg-slate-50">
                <div className="flex flex-wrap">
                  {visibleGroups.map((group) => {
                    const sectionName = t(`sections.${group.section}`) || group.section;
                    const isActive = activeTab === group.section;
                    
                    // Count how many permissions are selected for this group
                    const selectedCount = group.actions.filter((action) =>
                      Boolean(permissions.actions[action.key])
                    ).length;
                    const totalCount = group.actions.length;
                    const allSelected = selectedCount === totalCount;
                    
                    return (
                      <button
                        key={group.section}
                        type="button"
                        onClick={() => setActiveTab(group.section)}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                          isActive
                            ? "border-amber-500 text-amber-600 bg-white"
                            : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                        }`}
                      >
                        {sectionName}
                        <Badge tone={allSelected ? "emerald" : selectedCount > 0 ? "amber" : "slate"}>
                          {selectedCount}/{totalCount}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab Content */}
              {activeTab && (
                <div className="p-4">
                  {(() => {
                    const activeGroup = visibleGroups.find((g) => g.section === activeTab);
                    if (!activeGroup) return null;

                    // Check if all actions for this group are selected
                    const allSelected = activeGroup.actions.every((action) =>
                      Boolean(permissions.actions[action.key])
                    );
                    const someSelected = activeGroup.actions.some((action) =>
                      Boolean(permissions.actions[action.key])
                    );

                    const handleSelectAll = () => {
                      const newActions = { ...permissions.actions };
                      activeGroup.actions.forEach((action) => {
                        newActions[action.key] = !allSelected; // Toggle: select all if not all selected, deselect all if all selected
                      });
                      onChange({
                        ...permissions,
                        actions: newActions,
                      });
                    };

                    return (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {activeGroup.actions.map((action) => (
                            <label
                              key={action.key}
                              className="flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 p-2 rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(permissions.actions[action.key])}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  onChange({
                                    ...permissions,
                                    actions: {
                                      ...permissions.actions,
                                      [action.key]: checked,
                                    },
                                  });
                                }}
                                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                              />
                              <span>{t(action.labelKey)}</span>
                            </label>
                          ))}
                        </div>
                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={handleSelectAll}
                            className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline"
                          >
                            {allSelected
                              ? t("roles.deselectAll") || "Deselect All"
                              : t("roles.selectAll") || "Select All"}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {!showForm && (
        <SectionCard
          title={t("roles.title")}
             // 我 REMOVED DESCRIPTION UNDER THE TITLE BEING DISPLAYED
          // description={t("roles.description")}
          actions={
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-600">
                {isLoading ? t("common.loading") : `${roles.length} ${t("roles.roles")}`}
              </span>
              <button
                onClick={() => setShowForm(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
              >
                {t("roles.addTitle") || "Add Role"}
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2">{t("roles.name")}</th>
                  <th className="py-2">{t("roles.display")}</th>
                  <th className="py-2">{t("roles.sections")}</th>
                  <th className="py-2">{t("roles.actions")}</th>
                  <th className="py-2">{t("roles.manage")}</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 font-semibold">{role.name}</td>
                    <td className="py-2">{role.displayName}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {role.permissions.sections.map((section) => (
                          <Badge key={section} tone="slate">
                            {t(`sections.${section}`) || section}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(role.permissions.actions || {})
                          .filter(([, allowed]) => allowed)
                          .map(([actionKey]) => {
                            const actionOption = ACTION_OPTIONS.find(opt => opt.key === actionKey);
                            return (
                              <Badge key={actionKey} tone="emerald">
                                {actionOption ? t(actionOption.labelKey) : actionKey}
                              </Badge>
                            );
                          })}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2 text-sm font-semibold">
                        <button
                          className="text-amber-600 hover:text-amber-700"
                          onClick={() => startEdit(role.id)}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          className="text-blue-600 hover:text-blue-700"
                          onClick={() => handleForceLogoutClick(role.id)}
                          disabled={isLoggingOut}
                        >
                          {t("roles.forceLogout") || "Force Logout"}
                        </button>
                        <button
                          className="text-rose-600 hover:text-rose-700"
                          onClick={() => handleDeleteClick(role.id)}
                          disabled={isDeleting}
                        >
                          {t("common.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!roles.length && (
                  <tr>
                    <td className="py-4 text-sm text-slate-500" colSpan={5}>
                      {t("roles.noRoles")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {showForm && (
        <SectionCard 
          title={editingId ? t("roles.editTitle") : t("roles.addTitle")}
          description={editingId ? t("roles.editDesc") : undefined}
          actions={
            <button 
              onClick={cancelEdit} 
              className="text-sm font-semibold text-slate-600 hover:text-slate-800"
            >
              {t("common.cancel")}
            </button>
          }
        >
        <form className="space-y-4" onSubmit={editingId ? submitEdit : handleSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder={t("roles.namePlaceholder")}
              value={editingId ? editForm?.name : form.name}
              onChange={(e) => {
                if (editingId) {
                  setEditForm((p) => (p ? { ...p, name: e.target.value } : p));
                } else {
                  setForm((p) => ({ ...p, name: e.target.value }));
                }
              }}
              required
            />
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder={t("roles.displayNamePlaceholder")}
              value={editingId ? editForm?.displayName : form.displayName}
              onChange={(e) => {
                if (editingId) {
                  setEditForm((p) => (p ? { ...p, displayName: e.target.value } : p));
                } else {
                  setForm((p) => ({ ...p, displayName: e.target.value }));
                }
              }}
              required
            />
          </div>

          <SectionsAndActionsEditor
            permissions={editingId ? editForm!.permissions : form.permissions}
            onChange={(newPermissions) => {
              if (editingId) {
                setEditForm((prev) => (prev ? { ...prev, permissions: newPermissions } : prev));
              } else {
                setForm((prev) => ({ ...prev, permissions: newPermissions }));
              }
            }}
            activeTab={editingId ? editActiveTab : addActiveTab}
            setActiveTab={editingId ? setEditActiveTab : setAddActiveTab}
          />

          <AccountAccessEditor
            accountAccess={editingId ? editForm!.accountAccess : form.accountAccess}
            accounts={accounts}
            onChange={(newAccountAccess) => {
              if (editingId) {
                setEditForm((prev) => (prev ? { ...prev, accountAccess: newAccountAccess } : prev));
              } else {
                setForm((prev) => ({ ...prev, accountAccess: newAccountAccess }));
              }
            }}
          />

          <button
            type="submit"
            disabled={editingId ? false : isSaving}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60 ${
              editingId 
                ? "bg-amber-600 hover:bg-amber-700" 
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {editingId 
              ? t("roles.updateRole") 
              : (isSaving ? t("common.saving") : t("roles.saveRole"))
            }
          </button>
        </form>
      </SectionCard>
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
        onConfirm={() => confirmModal.roleId && remove(confirmModal.roleId)}
        onCancel={() => setConfirmModal({ isOpen: false, message: "", roleId: null })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        type="warning"
      />

      <ConfirmModal
        isOpen={logoutConfirmModal.isOpen}
        message={logoutConfirmModal.message}
        onConfirm={() => logoutConfirmModal.roleId && confirmForceLogout(logoutConfirmModal.roleId)}
        onCancel={() => setLogoutConfirmModal({ isOpen: false, message: "", roleId: null, roleName: "" })}
        confirmText={t("common.confirm") || "Confirm"}
        cancelText={t("common.cancel")}
        type="warning"
      />
    </div>
  );
}


