import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import type { Account, AccountTransaction } from "../../types";
import { formatDate } from "../../utils/format";
import { translateAccountTransactionDescription } from "../../utils/accounts/translateAccountTransactionDescription";

interface Props {
  account: Account;
  transactions: AccountTransaction[];
}

export function AccountTransactionsTable({ account, transactions }: Props) {
  const { t } = useTranslation();

  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 z-[1] bg-white">
        <tr className="border-b border-slate-200 text-slate-600">
          <th className="py-2 pr-3">{t("accounts.date")}</th>
          <th className="py-2 pr-3">{t("accounts.type")}</th>
          <th className="py-2 pr-3">{t("accounts.amount")}</th>
          <th className="py-2">{t("accounts.description")}</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((transaction) => (
          <tr key={transaction.id} className="border-b border-slate-100">
            <td className="whitespace-nowrap py-2 pr-3">{formatDate(transaction.createdAt)}</td>
            <td className="py-2 pr-3">
              <Badge tone={transaction.type === "add" ? "emerald" : "rose"}>
                {transaction.type === "add" ? t("accounts.add") : t("accounts.withdraw")}
              </Badge>
            </td>
            <td
              className={`whitespace-nowrap py-2 pr-3 font-semibold ${
                transaction.type === "add" ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {transaction.type === "add" ? "+" : "-"}
              {transaction.amount.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {account.currencyCode}
            </td>
            <td className="py-2 text-slate-600">
              {translateAccountTransactionDescription(transaction.description || "-", t)}
            </td>
          </tr>
        ))}
        {transactions.length === 0 && (
          <tr>
            <td className="py-4 text-sm text-slate-500" colSpan={4}>
              {t("accounts.noTransactions")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
