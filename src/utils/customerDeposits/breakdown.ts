import type { CustomerDepositCurrencyRow } from "../../types";

export interface CustomerDepositBreakdown {
  totalDeposit: number;
  totalWithdrawal: number;
}

export function getCustomerDepositBreakdown(
  row: Pick<CustomerDepositCurrencyRow, "customers" | "totalPrepaid" | "totalAdvance">,
): CustomerDepositBreakdown {
  const totalDeposit =
    row.totalPrepaid ??
    row.customers.reduce((sum, customer) => {
      return customer.fundedBalance > 0 ? sum + customer.fundedBalance : sum;
    }, 0);

  const totalWithdrawal =
    row.totalAdvance ??
    row.customers.reduce((sum, customer) => {
      return customer.fundedBalance < 0 ? sum + Math.abs(customer.fundedBalance) : sum;
    }, 0);

  return { totalDeposit, totalWithdrawal };
}
