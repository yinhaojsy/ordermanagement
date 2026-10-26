import * as XLSX from "xlsx";

export interface TransferQueryParams {
  dateFrom?: string;
  dateTo?: string;
  fromAccountId?: number;
  toAccountId?: number;
  currencyCode?: string;
  createdBy?: number;
  tagIds?: string;
}

/**
 * Exports transfers to Excel file
 */
export async function exportTransfersToExcel(
  queryParams: TransferQueryParams,
  t: (key: string) => string
): Promise<{ fileName: string; count: number }> {
  // Build query string
  const queryString = new URLSearchParams();
  if (queryParams.dateFrom) queryString.append("dateFrom", queryParams.dateFrom);
  if (queryParams.dateTo) queryString.append("dateTo", queryParams.dateTo);
  if (queryParams.fromAccountId !== undefined) queryString.append("fromAccountId", queryParams.fromAccountId.toString());
  if (queryParams.toAccountId !== undefined) queryString.append("toAccountId", queryParams.toAccountId.toString());
  if (queryParams.currencyCode) queryString.append("currencyCode", queryParams.currencyCode);
  if (queryParams.createdBy !== undefined) queryString.append("createdBy", queryParams.createdBy.toString());
  if (queryParams.tagIds) queryString.append("tagIds", queryParams.tagIds);

  // Fetch transfers
  const response = await fetch(`/api/transfers/export?${queryString.toString()}`);
  if (!response.ok) {
    throw new Error(t("transfers.exportError") || "Failed to export transfers. Please try again.");
  }

  const transfers = await response.json();

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Prepare data for Excel
  const excelData = transfers.map((transfer: any) => ({
    "Transfer ID": transfer.id,
    "Date": transfer.createdAt ? new Date(transfer.createdAt).toLocaleDateString() : "",
    "From Account": transfer.fromAccountName || "",
    "To Account": transfer.toAccountName || "",
    "Amount": transfer.amount,
    "Currency": transfer.currencyCode || "",
    "Transaction Fee": transfer.transactionFee || 0,
    "Description": transfer.description || "",
    "Created By": transfer.createdByName || "",
    "Tags": transfer.tags && transfer.tags.length > 0 ? transfer.tags.map((tag: any) => tag.name).join(", ") : "",
  }));

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Transfers");

  // Generate file name with date
  const fileName = `transfers_export_${new Date().toISOString().split("T")[0]}.xlsx`;

  // Write file
  XLSX.writeFile(workbook, fileName);

  return { fileName, count: transfers.length };
}

