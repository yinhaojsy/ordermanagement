import * as XLSX from "xlsx";

export interface ExpenseQueryParams {
  dateFrom?: string;
  dateTo?: string;
  accountId?: number;
  currencyCode?: string;
  createdBy?: number;
  tagIds?: string;
}

/**
 * Exports expenses to Excel file
 */
export async function exportExpensesToExcel(
  queryParams: ExpenseQueryParams,
  t: (key: string) => string
): Promise<{ fileName: string; count: number }> {
  // Build query string
  const queryString = new URLSearchParams();
  if (queryParams.dateFrom) queryString.append("dateFrom", queryParams.dateFrom);
  if (queryParams.dateTo) queryString.append("dateTo", queryParams.dateTo);
  if (queryParams.accountId !== undefined) queryString.append("accountId", queryParams.accountId.toString());
  if (queryParams.currencyCode) queryString.append("currencyCode", queryParams.currencyCode);
  if (queryParams.createdBy !== undefined) queryString.append("createdBy", queryParams.createdBy.toString());
  if (queryParams.tagIds) queryString.append("tagIds", queryParams.tagIds);

  // Fetch expenses
  const response = await fetch(`/api/expenses/export?${queryString.toString()}`);
  if (!response.ok) {
    throw new Error(t("expenses.exportError") || "Failed to export expenses. Please try again.");
  }

  const expenses = await response.json();

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Prepare data for Excel
  const excelData = expenses.map((expense: any) => ({
    "Expense ID": expense.id,
    "Type": expense.type === 'income' ? 'Income' : 'Expense',
    "Date": expense.createdAt ? new Date(expense.createdAt).toLocaleDateString() : "",
    "Account": expense.accountName || "",
    "Amount": expense.amount,
    "Currency": expense.currencyCode || "",
    "Description": expense.description || "",
    "Created By": expense.createdByName || "",
    "Tags": expense.tags && expense.tags.length > 0 ? expense.tags.map((tag: any) => tag.name).join(", ") : "",
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses");

  // Generate file name with date
  const fileName = `expenses_export_${new Date().toISOString().split("T")[0]}.xlsx`;

  // Write file
  XLSX.writeFile(workbook, fileName);

  return { fileName, count: expenses.length };
}

