import { useTranslation } from "react-i18next";
import AccountMonthlyStatisticsPanel from "../components/reports/AccountMonthlyStatisticsPanel";

export default function AccountMonthlyReportPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("reports.pageTitle")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("reports.pageDesc")}</p>
      </div>
      <AccountMonthlyStatisticsPanel />
    </div>
  );
}
