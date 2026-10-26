import { db } from "../db.js";
import { normalizeKycCustomerType, resetCustomerKycForTypeChange } from "./customerKycController.js";
import { scheduleCacheSync } from "../services/cacheSyncBroadcast.js";
import {
  listCustomersPaginated,
  listCustomersForExport,
  listCustomerOptions,
  listPinnedCustomerIds,
  MAX_CUSTOMER_PINS,
} from "../services/customerList.js";
import { getUserIdFromHeader } from "../utils/auth.js";
import { getUserPermissions } from "../utils/orderPermissions.js";
import {
  canPinCustomers,
  canFormatCustomerColors,
  canUpdateCustomer,
  isDisplayColorOnlyUpdate,
} from "../utils/customerPermissions.js";

const trimValue = (value) => (typeof value === "string" ? value.trim() : value);
const sanitizePayload = (payload = {}) =>
  Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, trimValue(value)]));

export const listCustomers = (req, res, next) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const pageRaw = req.query.page;
    const limitRaw = req.query.limit;
    const sortByRaw = req.query.sortBy;
    const sortDirRaw = req.query.sortDir;

    const page = parseInt(pageRaw, 10);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100);

    const usePaging =
      pageRaw !== undefined &&
      pageRaw !== "" &&
      Number.isFinite(page) &&
      page >= 1;

    const sortBy =
      sortByRaw === "balance" || sortByRaw === "profitLoss" ? sortByRaw : undefined;
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

    const customerTypeRaw = req.query.customerType;
    const customerType =
      customerTypeRaw === "individual" || customerTypeRaw === "corporate"
        ? customerTypeRaw
        : undefined;

    const kycStatusRaw = req.query.kycStatus;
    const kycStatus =
      kycStatusRaw === "none" ||
      kycStatusRaw === "submitted" ||
      kycStatusRaw === "approved" ||
      kycStatusRaw === "rejected"
        ? kycStatusRaw
        : undefined;

    const listOpts = {
      search,
      sortBy,
      sortDir: sortBy ? sortDir : undefined,
      customerType,
      kycStatus,
    };

    const result = listCustomersPaginated({
      ...listOpts,
      page: usePaging ? page : 1,
      limit: usePaging ? limit : 20,
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

function customerListFiltersFromQuery(query) {
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const customerTypeRaw = query.customerType;
  const customerType =
    customerTypeRaw === "individual" || customerTypeRaw === "corporate" ? customerTypeRaw : undefined;
  const kycStatusRaw = query.kycStatus;
  const kycStatus =
    kycStatusRaw === "none" ||
    kycStatusRaw === "submitted" ||
    kycStatusRaw === "approved" ||
    kycStatusRaw === "rejected"
      ? kycStatusRaw
      : undefined;
  return { search, customerType, kycStatus };
}

export const exportCustomers = (req, res, next) => {
  try {
    const result = listCustomersForExport(customerListFiltersFromQuery(req.query));
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

function parseImportCustomerType(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "individual" || value === "个人") return "individual";
  if (value === "corporate" || value === "company" || value === "企业") return "corporate";
  return null;
}

export const importCustomers = (req, res, next) => {
  try {
    const rows = req.body?.customers;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No customers to import" });
    }

    const existingNames = new Set(
      db.prepare("SELECT lower(name) AS name FROM customers;").all().map((row) => row.name),
    );
    const seenNames = new Set();
    const errors = [];
    const toInsert = [];

    rows.forEach((row, index) => {
      const rowNumber = Number.isInteger(row?.rowNumber) ? row.rowNumber : index + 2;
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (!name) {
        errors.push(`Row ${rowNumber}: Customer name is required`);
        return;
      }
      const nameKey = name.toLowerCase();
      if (existingNames.has(nameKey)) {
        errors.push(`Row ${rowNumber}: Customer "${name}" already exists`);
        return;
      }
      if (seenNames.has(nameKey)) {
        errors.push(`Row ${rowNumber}: Customer "${name}" is duplicated in the file`);
        return;
      }
      const customerType = parseImportCustomerType(row?.customerType);
      if (!customerType) {
        errors.push(`Row ${rowNumber}: Type must be Individual or Corporate`);
        return;
      }
      seenNames.add(nameKey);
      toInsert.push({
        name,
        email: typeof row.email === "string" ? row.email.trim() : "",
        phone: typeof row.phone === "string" ? row.phone.trim() : "",
        remarks: typeof row.remarks === "string" ? row.remarks.trim() : "",
        customerType,
      });
    });

    const insert = db.prepare(
      `INSERT INTO customers (name, email, phone, remarks, customerType)
       VALUES (@name, @email, @phone, @remarks, @customerType);`,
    );
    const insertMany = db.transaction((items) => {
      items.forEach((item) => insert.run(item));
    });
    insertMany(toInsert);

    if (toInsert.length > 0) {
      scheduleCacheSync({ scopes: ["customers", "customerKyc"] });
    }

    res.json({ created: toInsert.length, errors });
  } catch (error) {
    next(error);
  }
};

export const listCustomerOptionsHandler = (_req, res, next) => {
  try {
    res.json({ customers: listCustomerOptions() });
  } catch (error) {
    next(error);
  }
};

export const getPinnedCustomerIds = (req, res) => {
  res.json({ customerIds: listPinnedCustomerIds() });
};

function notifyCustomerPins() {
  scheduleCacheSync({ scopes: ["customers"] });
}

export const pinCustomer = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinCustomers(userPermissions, userId)) {
    return res.status(403).json({ message: "You do not have permission to pin customers" });
  }
  const customerId = parseInt(req.params.id, 10);
  if (Number.isNaN(customerId)) {
    return res.status(400).json({ message: "Invalid customer id" });
  }
  const exists = db.prepare("SELECT id FROM customers WHERE id = ?;").get(customerId);
  if (!exists) {
    return res.status(404).json({ message: "Customer not found" });
  }
  const already = db.prepare("SELECT 1 FROM customer_pins WHERE customerId = ?;").get(customerId);
  if (already) {
    return res.json({ success: true, customerIds: listPinnedCustomerIds() });
  }
  const countRow = db.prepare("SELECT COUNT(*) as n FROM customer_pins;").get();
  if ((countRow?.n || 0) >= MAX_CUSTOMER_PINS) {
    return res.status(400).json({
      message: `At most ${MAX_CUSTOMER_PINS} customers can be pinned. Unpin one to add another.`,
    });
  }
  const maxSort = db.prepare("SELECT COALESCE(MAX(sortOrder), -1) AS m FROM customer_pins;").get();
  db.prepare("INSERT INTO customer_pins (customerId, sortOrder) VALUES (?, ?);").run(
    customerId,
    (maxSort?.m ?? -1) + 1,
  );
  notifyCustomerPins();
  res.json({ success: true, customerIds: listPinnedCustomerIds() });
};

export const unpinCustomer = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinCustomers(userPermissions, userId)) {
    return res.status(403).json({ message: "You do not have permission to unpin customers" });
  }
  const customerId = parseInt(req.params.id, 10);
  if (Number.isNaN(customerId)) {
    return res.status(400).json({ message: "Invalid customer id" });
  }
  db.prepare("DELETE FROM customer_pins WHERE customerId = ?;").run(customerId);
  const remaining = listPinnedCustomerIds();
  const normalize = db.transaction((ids) => {
    ids.forEach((cid, i) => {
      db.prepare("UPDATE customer_pins SET sortOrder = ? WHERE customerId = ?;").run(i, cid);
    });
  });
  normalize(remaining);
  notifyCustomerPins();
  res.json({ success: true, customerIds: remaining });
};

export const reorderPinnedCustomers = (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    return res.status(401).json({ message: "User ID is required" });
  }
  const userPermissions = getUserPermissions(userId);
  if (!canPinCustomers(userPermissions, userId)) {
    return res.status(403).json({ message: "You do not have permission to reorder pinned customers" });
  }
  const { customerIds } = req.body || {};
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return res.status(400).json({ message: "customerIds must be a non-empty array" });
  }
  if (!customerIds.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ message: "customerIds must be positive integers" });
  }
  const current = listPinnedCustomerIds();
  if (current.length !== customerIds.length) {
    return res.status(400).json({ message: "Pin list length does not match the current pinned customers" });
  }
  const setCurrent = new Set(current);
  if (customerIds.some((id) => !setCurrent.has(id))) {
    return res.status(400).json({ message: "customerIds must match the current pinned customers exactly" });
  }
  const apply = db.transaction((ids) => {
    ids.forEach((cid, i) => {
      db.prepare("UPDATE customer_pins SET sortOrder = ? WHERE customerId = ?;").run(i, cid);
    });
  });
  apply(customerIds);
  notifyCustomerPins();
  res.json({ success: true, customerIds: listPinnedCustomerIds() });
};

export const createCustomer = (req, res, next) => {
  try {
    const payload = sanitizePayload(req.body);
    const trimmedName = payload.name;

    if (!trimmedName) {
      return res.status(400).json({ message: "Customer name is required" });
    }

    const existing = db.prepare("SELECT id FROM customers WHERE lower(name) = lower(?);").get(trimmedName);
    if (existing) {
      return res.status(409).json({ message: "Customer with this name already exists" });
    }

    const customerType = normalizeKycCustomerType(payload.customerType);
    const stmt = db.prepare(
      `INSERT INTO customers (name, email, phone, remarks, customerType) VALUES (@name, @email, @phone, @remarks, @customerType);`,
    );
    const result = stmt.run({ ...payload, customerType });
    const row = db.prepare("SELECT * FROM customers WHERE id = ?;").get(result.lastInsertRowid);
    res.status(201).json(row);
    scheduleCacheSync({
      scopes: ["customers", "customerKyc"],
      customerId: Number(result.lastInsertRowid),
    });
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = (req, res, next) => {
  try {
    const userId = getUserIdFromHeader(req);
    if (!userId) {
      return res.status(401).json({ message: "User ID is required" });
    }
    const userPermissions = getUserPermissions(userId);
    const { id } = req.params;
    const before = db.prepare("SELECT * FROM customers WHERE id = ?;").get(id);
    if (!before) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const updates = sanitizePayload(req.body);
    const fields = Object.keys(updates);
    if (!fields.length) {
      return res.status(400).json({ message: "No updates provided" });
    }
    const colorOnly = isDisplayColorOnlyUpdate(updates);
    if (colorOnly) {
      if (!canFormatCustomerColors(userPermissions, userId) && !canUpdateCustomer(userPermissions, userId)) {
        return res.status(403).json({ message: "You do not have permission to format customer colors" });
      }
    } else if (!canUpdateCustomer(userPermissions, userId)) {
      return res.status(403).json({ message: "You do not have permission to update customers" });
    }
    if (updates.customerType !== undefined) {
      updates.customerType = normalizeKycCustomerType(updates.customerType);
    }
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    db.prepare(`UPDATE customers SET ${assignments} WHERE id = @id;`).run({
      ...updates,
      id,
    });
    const row = db.prepare("SELECT * FROM customers WHERE id = ?;").get(id);
    if (updates.customerType !== undefined) {
      const oldType = normalizeKycCustomerType(before.customerType);
      const newType = updates.customerType;
      if (oldType !== newType) {
        resetCustomerKycForTypeChange(Number(id), newType);
      }
    }
    res.json(row);
    const scopes = ["customers"];
    if (updates.customerType !== undefined) scopes.push("customerKyc");
    scheduleCacheSync({ scopes, customerId: Number(id) });
  } catch (error) {
    next(error);
  }
};

export const deleteCustomer = (req, res, next) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare("DELETE FROM customers WHERE id = ?;");
    const result = stmt.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.status(204).send();
    scheduleCacheSync({
      scopes: ["customers", "orders"],
      customerId: Number(id),
    });
  } catch (error) {
    next(error);
  }
};

export const listCustomerBeneficiaries = (req, res, next) => {
  try {
    const { id } = req.params;
    const rows = db
      .prepare("SELECT * FROM customer_beneficiaries WHERE customerId = ? ORDER BY createdAt ASC;")
      .all(id);

    const normalized = rows.map((row) => ({
      ...row,
      walletAddresses: row.walletAddresses ? JSON.parse(row.walletAddresses) : null,
    }));

    res.json(normalized);
  } catch (error) {
    next(error);
  }
};

export const addCustomerBeneficiary = (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      paymentType,
      networkChain,
      walletAddresses,
      bankName,
      accountTitle,
      accountNumber,
      accountIban,
      swiftCode,
      bankAddress,
    } = req.body;

    if (!paymentType) {
      return res.status(400).json({ message: "Payment type is required" });
    }

    const stmt = db.prepare(
      `INSERT INTO customer_beneficiaries
       (customerId, paymentType, networkChain, walletAddresses, bankName, accountTitle, accountNumber, accountIban, swiftCode, bankAddress, createdAt)
       VALUES (@customerId, @paymentType, @networkChain, @walletAddresses, @bankName, @accountTitle, @accountNumber, @accountIban, @swiftCode, @bankAddress, @createdAt);`,
    );

    const result = stmt.run({
      customerId: id,
      paymentType,
      networkChain: networkChain || null,
      walletAddresses: walletAddresses ? JSON.stringify(walletAddresses) : null,
      bankName: bankName || null,
      accountTitle: accountTitle || null,
      accountNumber: accountNumber || null,
      accountIban: accountIban || null,
      swiftCode: swiftCode || null,
      bankAddress: bankAddress || null,
      createdAt: new Date().toISOString(),
    });

    const beneficiary = db
      .prepare("SELECT * FROM customer_beneficiaries WHERE id = ?;")
      .get(result.lastInsertRowid);

    res.json({
      ...beneficiary,
      walletAddresses: beneficiary.walletAddresses ? JSON.parse(beneficiary.walletAddresses) : null,
    });
    scheduleCacheSync({
      scopes: ["customers", "customerBeneficiaries"],
      customerId: Number(id),
      beneficiaryId: Number(result.lastInsertRowid),
    });
  } catch (error) {
    next(error);
  }
};

export const updateCustomerBeneficiary = (req, res, next) => {
  try {
    const { id: customerId, beneficiaryId } = req.params;
    const {
      paymentType,
      networkChain,
      walletAddresses,
      bankName,
      accountTitle,
      accountNumber,
      accountIban,
      swiftCode,
      bankAddress,
    } = req.body;

    if (!paymentType) {
      return res.status(400).json({ message: "Payment type is required" });
    }

    db.prepare(
      `UPDATE customer_beneficiaries
       SET paymentType=@paymentType,
           networkChain=@networkChain,
           walletAddresses=@walletAddresses,
           bankName=@bankName,
           accountTitle=@accountTitle,
           accountNumber=@accountNumber,
           accountIban=@accountIban,
           swiftCode=@swiftCode,
           bankAddress=@bankAddress
       WHERE id=@beneficiaryId AND customerId=@customerId;`,
    ).run({
      paymentType,
      networkChain: networkChain || null,
      walletAddresses: walletAddresses ? JSON.stringify(walletAddresses) : null,
      bankName: bankName || null,
      accountTitle: accountTitle || null,
      accountNumber: accountNumber || null,
      accountIban: accountIban || null,
      swiftCode: swiftCode || null,
      bankAddress: bankAddress || null,
      beneficiaryId,
      customerId,
    });

    const updated = db
      .prepare("SELECT * FROM customer_beneficiaries WHERE id = ? AND customerId = ?;")
      .get(beneficiaryId, customerId);

    if (!updated) {
      return res.status(404).json({ message: "Beneficiary not found" });
    }

    res.json({
      ...updated,
      walletAddresses: updated.walletAddresses ? JSON.parse(updated.walletAddresses) : null,
    });
    scheduleCacheSync({
      scopes: ["customers", "customerBeneficiaries"],
      customerId: Number(customerId),
      beneficiaryId: Number(beneficiaryId),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCustomerBeneficiary = (req, res, next) => {
  try {
    const { id: customerId, beneficiaryId } = req.params;
    const result = db
      .prepare("DELETE FROM customer_beneficiaries WHERE id = ? AND customerId = ?;")
      .run(beneficiaryId, customerId);

    if (result.changes === 0) {
      return res.status(404).json({ message: "Beneficiary not found" });
    }

    res.status(204).send();
    scheduleCacheSync({
      scopes: ["customers", "customerBeneficiaries"],
      customerId: Number(customerId),
      beneficiaryId: Number(beneficiaryId),
    });
  } catch (error) {
    next(error);
  }
};


