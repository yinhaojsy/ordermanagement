import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { processImportFile } from "../../utils/orders/orderImport";
import { exportOrdersToExcel } from "../../utils/orders/orderExport";

interface UseOrdersImportExportParams {
  exportQueryParams: any;
  customers: any[];
  users: any[];
  currencies: any[];
  currencyPairs: string[];
  accounts: any[];
  tags: any[];
  addOrder: any;
  setAlertModal: (modal: { isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }) => void;
  setIsImporting: (isImporting: boolean) => void;
  setImportModalOpen: (isOpen: boolean) => void;
  t: (key: string) => string;
}

export function useOrdersImportExport({
  exportQueryParams,
  customers,
  users,
  currencies,
  currencyPairs,
  accounts,
  tags,
  addOrder,
  setAlertModal,
  setIsImporting,
  setImportModalOpen,
  t,
}: UseOrdersImportExportParams) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportOrders = useCallback(async () => {
    try {
      setIsExporting(true);
      const result = await exportOrdersToExcel(exportQueryParams, t);
      setAlertModal({
        isOpen: true,
        message: (t("orders.exportSuccess") || "Successfully exported {{count}} orders to {{fileName}}")
          .replace("{{count}}", result.count.toString())
          .replace("{{fileName}}", result.fileName),
        type: "success",
      });
    } catch (error) {
      setAlertModal({
        isOpen: true,
        message: t("orders.exportError") || "Failed to export orders. Please try again.",
        type: "error",
      });
    } finally {
      setIsExporting(false);
    }
  }, [exportQueryParams, t, setAlertModal]);

  const handleDownloadTemplate = useCallback(() => {
    // Create template data with example rows
    const templateData = [
      {
        "Order ID": 1001,
        "Date": "2026-10-26",
        "Customer": "Example Customer",
        "Handler": "John Doe",
        "Currency Pair": "USD/HKD",
        "Amount Buy": 1000,
        "Buy Account": "Main USD",
        "Amount Sell": 7800,
        "Sell Account": "Main HKD",
        "Rate": 7.8,
        "Profit Amount": 50,
        "Profit Currency": "USD",
        "Profit Account": "Main USD",
        "Service Charges Amount": -10,
        "Service Charges Currency": "HKD",
        "Service Charges Account": "Main HKD",
        "Status": "completed",
        "Order Type": "online",
        "Tags": "Priority, VIP"
      },
      {
        "Order ID": 1002,
        "Date": "2026-10-26",
        "Customer": "Another Customer",
        "Handler": "Jane Smith",
        "Currency Pair": "USDT/USD",
        "Amount Buy": 500,
        "Buy Account": "USDT Wallet",
        "Amount Sell": 500,
        "Sell Account": "USD Wallet",
        "Rate": 1.0,
        "Profit Amount": "",
        "Profit Currency": "",
        "Profit Account": "",
        "Service Charges Amount": "",
        "Service Charges Currency": "",
        "Service Charges Account": "",
        "Status": "completed",
        "Order Type": "otc",
        "Tags": ""
      }
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, templateSheet, "Orders");

    // Write file
    XLSX.writeFile(wb, "orders_import_template.xlsx");
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);

      // Process import file
      const { orders: validatedOrders, errors: validationErrors } = await processImportFile(
        file,
        customers,
        users,
        currencies,
        currencyPairs,
        accounts,
        tags
      );

      // Import validated orders
      let successCount = 0;
      let errorCount = validationErrors.length;
      const errors = [...validationErrors];

      for (const orderData of validatedOrders) {
        try {
          // Convert null values to undefined for API compatibility
          const apiOrderData = {
            ...orderData,
            profitAmount: orderData.profitAmount ?? undefined,
            profitCurrency: orderData.profitCurrency ?? undefined,
            profitAccountId: orderData.profitAccountId ?? undefined,
            serviceChargeAmount: orderData.serviceChargeAmount ?? undefined,
            serviceChargeCurrency: orderData.serviceChargeCurrency ?? undefined,
            serviceChargeAccountId: orderData.serviceChargeAccountId ?? undefined,
          };
          await addOrder(apiOrderData).unwrap();
          successCount++;
        } catch (error: any) {
          errors.push(`Order ${orderData.customerId}: ${error.message || "Unknown error"}`);
          errorCount++;
        }
      }

      // Show results
      let message = (t("orders.importSuccess") || "Successfully imported {{count}} orders").replace("{{count}}", successCount.toString());
      if (errorCount > 0) {
        message += `. ${errorCount} orders failed to import.`;
        if (errors.length > 0) {
          message += `\n\nErrors:\n${errors.slice(0, 10).join("\n")}`;
          if (errors.length > 10) {
            message += `\n... and ${errors.length - 10} more errors`;
          }
        }
      }

      setAlertModal({
        isOpen: true,
        message,
        type: errorCount > 0 ? "warning" : "success",
      });

      setImportModalOpen(false);
      // Reset file input
      e.target.value = "";
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      if (errorMessage.includes("Orders sheet not found")) {
        setAlertModal({
          isOpen: true,
          message: t("orders.ordersSheetNotFound") || "Orders sheet not found in the file",
          type: "error",
        });
      } else if (errorMessage.includes("No orders found")) {
        setAlertModal({
          isOpen: true,
          message: t("orders.noOrdersInFile") || "No orders found in the file",
          type: "error",
        });
      } else {
        setAlertModal({
          isOpen: true,
          message: t("orders.importError") || `Failed to import orders: ${errorMessage}`,
          type: "error",
        });
      }
    } finally {
      setIsImporting(false);
    }
  }, [customers, users, currencies, currencyPairs, accounts, tags, addOrder, t, setIsImporting, setAlertModal, setImportModalOpen]);

  return {
    isExporting,
    handleExportOrders,
    handleDownloadTemplate,
    handleImportFile,
  };
}

