import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import StatCard from "../components/common/StatCard";
import { CustomerDepositDashboardCard } from "../components/customerDeposits/CustomerDepositPoolsSection";
import {
  useGetAccountsQuery,
  useGetCurrenciesQuery,
  useGetCustomerOptionsQuery,
  useGetOrdersQuery,
  useGetUsersQuery,
  useGetProfitCalculationsQuery,
  useGetProfitCalculationQuery,
  useGetCustomerDepositTotalsByCurrencyQuery,
} from "../services/api";
import { useProfitSummary } from "../hooks/useProfitSummary";
import type { Account } from "../types";
import { OrderStatus } from "../types";

// ── Shared SVG icons ─────────────────────────────────────────────────────────

function GripIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Sortable account card ────────────────────────────────────────────────────

function SortableAccountCard({ account }: { account: Account }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: account.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
      }}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">
            {account.name}
          </div>
          <div
            className={`mt-1 text-xl font-semibold leading-tight ${
              account.balance < 0
                ? "text-red-600"
                : account.balance > 0
                  ? "text-emerald-600"
                  : "text-slate-800"
            }`}
          >
            {account.balance.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            <span className="text-sm font-medium text-slate-500">
              {account.currencyCode}
            </span>
          </div>
        </div>
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 flex-shrink-0 cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          tabIndex={-1}
          aria-label="Drag to reorder account"
        >
          <GripIcon />
        </button>
      </div>
    </div>
  );
}

// ── Sortable currency pool section ───────────────────────────────────────────

function SortableCurrencyPool({
  currencyCode,
  currencyName,
  accounts,
  onReorderAccounts,
}: {
  currencyCode: string;
  currencyName?: string;
  accounts: Account[];
  onReorderAccounts: (currencyCode: string, newOrder: Account[]) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Sortable for the pool itself (outer DnD)
  const {
    attributes: poolAttributes,
    listeners: poolListeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: currencyCode });

  // Inner DnD for accounts within this pool
  const accountSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  function handleAccountDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = accounts.findIndex((a) => a.id === active.id);
      const newIndex = accounts.findIndex((a) => a.id === over.id);
      onReorderAccounts(currencyCode, arrayMove(accounts, oldIndex, newIndex));
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : undefined,
      }}
      className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden"
    >
      {/* Pool header */}
      <div className="flex items-center gap-2 px-3 py-3 hover:bg-slate-100 transition-colors">
        {/* Pool drag handle */}
        <button
          {...poolAttributes}
          {...poolListeners}
          className="flex-shrink-0 cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing p-0.5"
          tabIndex={-1}
          aria-label="Drag to reorder pool"
        >
          <GripIcon size={14} />
        </button>

        {/* Expand/collapse — takes up remaining space */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center justify-between gap-3 min-w-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-semibold text-slate-800 text-sm">
              {currencyName ? `${currencyName} (${currencyCode})` : currencyCode}
            </span>
            <span
              className={`text-sm whitespace-nowrap font-medium ${
                totalBalance < 0
                  ? "text-red-600"
                  : totalBalance > 0
                    ? "text-emerald-600"
                    : "text-slate-500"
              }`}
            >
              {totalBalance.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {currencyCode}
            </span>
            <span className="text-xs text-slate-400 bg-slate-200 rounded-full px-2 py-0.5 flex-shrink-0">
              {accounts.length}
            </span>
          </div>
          <ChevronIcon open={expanded} />
        </button>
      </div>

      {/* Account cards */}
      {expanded && (
        <div className="px-4 pb-4">
          <DndContext
            sensors={accountSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleAccountDragEnd}
          >
            <SortableContext
              items={accounts.map((a) => a.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {accounts.map((account) => (
                  <SortableAccountCard key={account.id} account={account} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

// ── Dashboard page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userId = useAppSelector((s) => s.auth.user?.id);

  const { data: currencies = [] } = useGetCurrenciesQuery();
  const { data: customersData } = useGetCustomerOptionsQuery();
  const customers = customersData?.customers ?? [];
  const { data: users = [] } = useGetUsersQuery();
  const { data: ordersData } = useGetOrdersQuery({ limit: 10000 });
  const { data: fetchedAccounts = [] } = useGetAccountsQuery();

  // Profit calculation (same as AccountsPage)
  const { data: calculations = [] } = useGetProfitCalculationsQuery();
  const defaultCalculation = calculations.find((calc) => calc.isDefault === 1 || calc.isDefault === true);
  const { data: defaultCalculationDetails } = useGetProfitCalculationQuery(
    defaultCalculation?.id || 0,
    { skip: !defaultCalculation }
  );
  const { data: depositTotalsData } = useGetCustomerDepositTotalsByCurrencyQuery();
  const profitSummary = useProfitSummary(
    defaultCalculationDetails,
    fetchedAccounts,
    currencies,
    depositTotalsData?.currencies ?? [],
  );

  // localStorage keys scoped to the logged-in user
  const poolOrderKey = `dashboard_pool_order_${userId}`;
  const accountOrderKey = `dashboard_account_order_${userId}`;

  // Per-pool account drag order: { currencyCode: [accountId, ...] }
  const [accountOrders, setAccountOrders] = useState<Record<string, number[]>>(() => {
    try {
      const saved = localStorage.getItem(accountOrderKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Pool section drag order: [currencyCode, ...]
  const [poolOrder, setPoolOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(poolOrderKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist orders to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(poolOrderKey, JSON.stringify(poolOrder));
  }, [poolOrder, poolOrderKey]);

  useEffect(() => {
    localStorage.setItem(accountOrderKey, JSON.stringify(accountOrders));
  }, [accountOrders, accountOrderKey]);

  const orders = ordersData?.orders ?? [];
  const totalOrders = ordersData?.total ?? 0;

  const stats = useMemo(() => {
    const ordersArray = Array.isArray(orders) ? orders : [];
    return {
      orders: totalOrders,
      saved: ordersArray.filter((o) => o.status === "saved").length,
      completed: ordersArray.filter((o) => o.status === "completed").length,
      cancelled: ordersArray.filter((o) => o.status === "cancelled").length,
      currencies: currencies.length,
      customers: customers.length,
      users: users.length,
    };
  }, [orders, totalOrders, currencies.length, customers.length, users.length]);

  // Build ordered pool list
  const orderedPools = useMemo(() => {
    const map: Record<string, { currencyName?: string; accounts: Account[] }> = {};
    for (const account of fetchedAccounts) {
      if (!map[account.currencyCode]) {
        map[account.currencyCode] = {
          currencyName: account.currencyName,
          accounts: [],
        };
      }
      map[account.currencyCode].accounts.push(account);
    }

    // Apply per-pool account drag order; append accounts not in saved order so stale IDs cannot hide them
    for (const code of Object.keys(map)) {
      const order = accountOrders[code];
      if (!order?.length) continue;

      const allAccounts = map[code].accounts;
      const indexed = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
      const knownIds = new Set<number>();
      const ordered: Account[] = [];
      for (const id of order) {
        const account = indexed[id];
        if (account) {
          ordered.push(account);
          knownIds.add(id);
        }
      }
      const remainder = allAccounts.filter((a) => !knownIds.has(a.id));
      map[code].accounts = [...ordered, ...remainder];
    }

    // Apply pool section drag order
    const allCodes = Object.keys(map);
    const ordered = poolOrder.length
      ? [
          ...poolOrder.filter((c) => allCodes.includes(c)),
          ...allCodes.filter((c) => !poolOrder.includes(c)),
        ]
      : allCodes;

    return ordered.map((code) => ({ code, ...map[code] }));
  }, [fetchedAccounts, accountOrders, poolOrder]);

  function handleAccountReorder(currencyCode: string, newOrder: Account[]) {
    setAccountOrders((prev) => ({
      ...prev,
      [currencyCode]: newOrder.map((a) => a.id),
    }));
  }

  const poolSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handlePoolDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const codes = orderedPools.map((p) => p.code);
      const oldIndex = codes.indexOf(active.id as string);
      const newIndex = codes.indexOf(over.id as string);
      setPoolOrder(arrayMove(codes, oldIndex, newIndex));
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t("dashboard.totalOrders")}
          value={stats.orders}
          tone="amber"
          onClick={() => navigate("/orders")}
        />
        <StatCard
          label={t("dashboard.pendingOrders")}
          value={stats.saved}
          tone="amber"
          onClick={() =>
            navigate("/orders", {
              state: { initialFilters: { status: "saved" as OrderStatus } },
            })
          }
        />
        <StatCard
          label={t("dashboard.completedOrders")}
          value={stats.completed}
          tone="emerald"
          onClick={() =>
            navigate("/orders", {
              state: { initialFilters: { status: "completed" as OrderStatus } },
            })
          }
        />
        <StatCard
          label={t("dashboard.cancelledOrders")}
          value={stats.cancelled}
          tone="rose"
          onClick={() =>
            navigate("/orders", {
              state: { initialFilters: { status: "cancelled" as OrderStatus } },
            })
          }
        />
        {profitSummary ? (
          <div
            className={`rounded-xl border-2 px-4 py-3 shadow-sm ${
              profitSummary.totalProfit > 0
                ? "border-emerald-400 bg-emerald-50"
                : profitSummary.totalProfit < 0
                  ? "border-red-400 bg-red-50"
                  : "border-slate-200 bg-white"
            }`}
          >
            <div className="text-sm text-slate-600">{t("dashboard.totalProfit")}</div>
            <div
              className={`mt-1.5 text-xl font-semibold tabular-nums leading-tight ${
                profitSummary.totalProfit > 0
                  ? "text-emerald-600"
                  : profitSummary.totalProfit < 0
                    ? "text-red-600"
                    : "text-slate-800"
              }`}
            >
              {profitSummary.totalProfit.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <span className="ml-1 text-sm font-medium text-slate-500">
                {profitSummary.targetCurrency}
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm text-slate-600">{t("dashboard.totalProfit")}</div>
            <div className="mt-1.5 text-xl font-semibold text-slate-300">—</div>
          </div>
        )}
        <CustomerDepositDashboardCard />
      </div>

      {orderedPools.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
            {t("dashboard.currencyPools")}
          </h2>

          <DndContext
            sensors={poolSensors}
            collisionDetection={closestCenter}
            onDragEnd={handlePoolDragEnd}
          >
            <SortableContext
              items={orderedPools.map((p) => p.code)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {orderedPools.map((pool) => (
                  <SortableCurrencyPool
                    key={pool.code}
                    currencyCode={pool.code}
                    currencyName={pool.currencyName}
                    accounts={pool.accounts}
                    onReorderAccounts={handleAccountReorder}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
