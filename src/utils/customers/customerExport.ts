import * as XLSX from "xlsx";

export interface CustomerExportQuery {
  search?: string;
  customerType?: string;
  kycStatus?: string;
}

interface ExportCustomer {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  remarks?: string | null;
  customerType?: string | null;
  kycStatus?: string | null;
  listBalance?: number | null;
  listProfitLoss?: number | null;
}

const HEADERS = [
  "Customer ID",
  "Name",
  "Type",
  "Email",
  "Phone",
  "Remarks",
  "KYC",
  "Balance",
  "Profit / Loss",
  "Currency",
];

function typeLabel(customerType: string | null | undefined) {
  if (customerType === "corporate") return "Corporate";
  return "Individual";
}

/**
 * Downloads every customer matching the current list filters as an Excel file.
 */
export async function exportCustomersToExcel(
  query: CustomerExportQuery,
): Promise<{ fileName: string; count: number }> {
  const queryString = new URLSearchParams();
  if (query.search) queryString.append("search", query.search);
  if (query.customerType) queryString.append("customerType", query.customerType);
  if (query.kycStatus) queryString.append("kycStatus", query.kycStatus);

  const response = await fetch(`/api/customers/export?${queryString.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to export customers");
  }

  const payload = (await response.json()) as {
    customers?: ExportCustomer[];
    targetCurrency?: string | null;
  };
  const customers = payload.customers ?? [];
  const currency = payload.targetCurrency ?? "";

  const rows = customers.map((customer) => [
    customer.id,
    customer.name,
    typeLabel(customer.customerType),
    customer.email || "",
    customer.phone || "",
    customer.remarks || "",
    customer.kycStatus || "",
    customer.listBalance ?? "",
    customer.listProfitLoss ?? "",
    currency,
  ]);

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");

  const fileName = `customers_export_${new Date().toISOString().split("T")[0]}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  return { fileName, count: customers.length };
}
