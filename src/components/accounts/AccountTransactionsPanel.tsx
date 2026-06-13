import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useAppSelector } from "../../app/hooks";
import { RightSidebar } from "../common/RightSidebar";
import type { Account, AccountTransaction } from "../../types";
import {
  getTransactionLogViewPreference,
  saveTransactionLogViewPreference,
  type TransactionLogViewMode,
} from "../../utils/accounts/transactionLogViewPreference";
import { AccountTransactionsTable } from "./AccountTransactionsTable";
import {
  TransactionLogExportButton,
  TransactionLogViewToggle,
} from "./TransactionLogViewToggle";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  account: Account;
  transactions: AccountTransaction[];
  onExport: () => void;
}

function useTransactionLogViewPreference() {
  const userId = useAppSelector((state) => state.auth.user?.id);
  const [viewMode, setViewMode] = useState<TransactionLogViewMode>(() =>
    getTransactionLogViewPreference(userId),
  );

  const setPreference = useCallback(
    (mode: TransactionLogViewMode) => {
      setViewMode(mode);
      saveTransactionLogViewPreference(userId, mode);
    },
    [userId],
  );

  const toggleViewMode = useCallback(() => {
    setPreference(viewMode === "sidebar" ? "modal" : "sidebar");
  }, [setPreference, viewMode]);

  return { viewMode, toggleViewMode };
}

function useOverlayLock(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);
}

export function AccountTransactionsPanel({
  isOpen,
  onClose,
  account,
  transactions,
  onExport,
}: Props) {
  const { t } = useTranslation();
  const { viewMode, toggleViewMode } = useTransactionLogViewPreference();
  const title = `${t("accounts.transactionsTitle")} - ${account.name}`;

  const headerActions = (
    <>
      <TransactionLogViewToggle viewMode={viewMode} onToggle={toggleViewMode} />
      <TransactionLogExportButton onExport={onExport} />
    </>
  );

  const table = (
    <div className="overflow-x-auto p-4">
      <AccountTransactionsTable account={account} transactions={transactions} />
    </div>
  );

  if (!isOpen) return null;

  if (viewMode === "sidebar") {
    return (
      <RightSidebar
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        size="xl"
        headerActions={headerActions}
      >
        {table}
      </RightSidebar>
    );
  }

  return <AccountTransactionsModal title={title} onClose={onClose} headerActions={headerActions}>
    {table}
  </AccountTransactionsModal>;
}

function AccountTransactionsModal({
  title,
  onClose,
  headerActions,
  children,
}: {
  title: string;
  onClose: () => void;
  headerActions: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  useOverlayLock(true, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label={t("common.close")}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate pr-2 text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label={t("common.close")}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** @deprecated Use AccountTransactionsPanel */
export { AccountTransactionsPanel as AccountTransactionsSidebar };
