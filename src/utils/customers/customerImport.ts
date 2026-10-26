import * as XLSX from "xlsx";

export interface CustomerImportRow {
  rowNumber: number;
  name: string;
  email: string;
  phone: string;
  remarks: string;
  customerType: string;
}

const HEADER_ALIASES: Record<string, "name" | "customerType" | "email" | "phone" | "remarks"> = {
  name: "name",
  姓名: "name",
  type: "customerType",
  customertype: "customerType",
  "customer type": "customerType",
  类型: "customerType",
  email: "email",
  电子邮件: "email",
  phone: "phone",
  电话: "phone",
  remarks: "remarks",
  备注: "remarks",
};

function cellText(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function headerKey(value: unknown) {
  return cellText(value).toLowerCase();
}

/**
 * Reads the Customers sheet (or the first sheet) and returns rows ready for the import API.
 */
export async function parseCustomerImportFile(file: File): Promise<{
  customers: CustomerImportRow[];
  errors: string[];
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName =
    workbook.SheetNames.find((name) => name.toLowerCase() === "customers") ?? workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Customers sheet not found");
  }
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (matrix.length === 0) {
    throw new Error("No customers found");
  }

  const headerRow = matrix[0] ?? [];
  const columnIndex: Partial<Record<"name" | "customerType" | "email" | "phone" | "remarks", number>> = {};
  headerRow.forEach((header, index) => {
    const field = HEADER_ALIASES[headerKey(header)];
    if (field && columnIndex[field] === undefined) columnIndex[field] = index;
  });
  if (columnIndex.name === undefined) {
    throw new Error("Customers sheet not found");
  }

  const customers: CustomerImportRow[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  for (let i = 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const rowNumber = i + 1;
    const read = (field: keyof typeof columnIndex) => {
      const index = columnIndex[field];
      return index === undefined ? "" : cellText(row[index]);
    };
    const name = read("name");
    const email = read("email");
    const phone = read("phone");
    const remarks = read("remarks");
    const customerType = read("customerType");
    if (!name && !email && !phone && !remarks && !customerType) continue;

    if (!name) {
      errors.push(`Row ${rowNumber}: Customer name is required`);
      continue;
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      errors.push(`Row ${rowNumber}: Customer "${name}" is duplicated in the file`);
      continue;
    }
    seenNames.add(nameKey);
    customers.push({ rowNumber, name, email, phone, remarks, customerType });
  }

  if (customers.length === 0 && errors.length === 0) {
    throw new Error("No customers found");
  }

  return { customers, errors };
}

export function downloadCustomerImportTemplate() {
  const template = [
    {
      Name: "Jane Doe",
      Type: "Individual",
      Email: "jane@example.com",
      Phone: "+1-555-0100",
      Remarks: "",
    },
    {
      Name: "Acme Ltd",
      Type: "Corporate",
      Email: "accounts@acme.example",
      Phone: "",
      Remarks: "Preferred contact is email",
    },
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(template);
  XLSX.utils.book_append_sheet(workbook, sheet, "Customers");
  XLSX.writeFile(workbook, "customers_import_template.xlsx");
}
