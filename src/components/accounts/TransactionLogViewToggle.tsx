import { useTranslation } from "react-i18next";
import type { TransactionLogViewMode } from "../../utils/accounts/transactionLogViewPreference";

const actionButtonClass =
  "rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800";

function SidebarLayoutIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="8" height="13" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="11.5"
        y="3.5"
        width="6"
        height="13"
        rx="1.25"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ModalLayoutIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="5.5"
        y="6.5"
        width="9"
        height="7"
        rx="1"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

interface Props {
  viewMode: TransactionLogViewMode;
  onToggle: () => void;
}

export function TransactionLogViewToggle({ viewMode, onToggle }: Props) {
  const { t } = useTranslation();
  const isSidebar = viewMode === "sidebar";

  return (
    <button
      type="button"
      onClick={onToggle}
      className={actionButtonClass}
      aria-label={
        isSidebar
          ? t("accounts.switchToModalView")
          : t("accounts.switchToSidebarView")
      }
      title={isSidebar ? t("accounts.switchToModalView") : t("accounts.switchToSidebarView")}
    >
      {isSidebar ? <ModalLayoutIcon /> : <SidebarLayoutIcon />}
    </button>
  );
}

export function TransactionLogExportButton({ onExport }: { onExport: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onExport}
      className={actionButtonClass}
      aria-label={t("accounts.exportToExcel") || "Export to Excel"}
      title={t("accounts.exportToExcel") || "Export to Excel"}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
        />
      </svg>
    </button>
  );
}
