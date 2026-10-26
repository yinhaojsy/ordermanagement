import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { processImportFile } from "../../utils/expenses/expenseImport";
import { exportExpensesToExcel } from "../../utils/expenses/expenseExport";

interface UseExpensesImportExportParams {
  exportQueryParams: any;
  accounts: any[];
  tags: any[];
  users?: any[];
  addExpense: any;
  setAlertModal: (modal: { isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }) => void;
  setIsImporting: (isImporting: boolean) => void;
  setImportModalOpen: (isOpen: boolean) => void;
  t: (key: string) => string;
}

export function useExpensesImportExport({
  exportQueryParams,
  accounts,
  tags,
  users = [],
  addExpense,
  setAlertModal,
  setIsImporting,
  setImportModalOpen,
  t,
}: UseExpensesImportExportParams) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportExpenses = useCallback(async () => {
    try {
      setIsExporting(true);
      const result = await exportExpensesToExcel(exportQueryParams, t);
      setAlertModal({
        isOpen: true,
        message: t("expenses.exportSuccess")
          .replace("{{count}}", result.count.toString())
          .replace("{{fileName}}", result.fileName),
        type: "success",
      });
    } catch (error) {
      setAlertModal({
        isOpen: true,
        message: t("expenses.exportError"),
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
        "Expense ID": "EXT-1001",
        "Date": "2026-10-26",
        "Account": "Main USD",
        "Amount": 100.50,
        "Currency": "USD",
        "Description": "Office supplies",
        "Created By": "Admin User",
        "Tags": "Office, Monthly"
      },
      {
        "Expense ID": "EXT-1002",
        "Date": "2026-10-26",
        "Account": "Main HKD",
        "Amount": 500,
        "Currency": "HKD",
        "Description": "Travel expenses",
        "Created By": "Admin User",
        "Tags": "Travel"
      }
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, templateSheet, "Expenses");

    // Write file
    XLSX.writeFile(wb, "expenses_import_template.xlsx");
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);

      // Process import file
      const { expenses: validatedExpenses, errors: validationErrors } = await processImportFile(
        file,
        accounts,
        tags,
        users
      );

      // Import validated expenses
      let successCount = 0;
      let errorCount = validationErrors.length;
      const errors = [...validationErrors];

      for (const expenseData of validatedExpenses) {
        try {
          // Mark as imported for transaction history
          await addExpense({ ...expenseData, isImported: true }).unwrap();
          successCount++;
        } catch (error: any) {
          errors.push(`Expense ${expenseData.accountId}: ${error.message || t("common.unknownError")}`);
          errorCount++;
        }
      }

      // Show results
      let message = t("expenses.importSuccess").replace("{{count}}", successCount.toString());
      if (errorCount > 0) {
        message += `. ${errorCount} ${t("expenses.expensesFailedToImport")}.`;
        if (errors.length > 0) {
          message += `\n\n${t("expenses.errors")}:\n${errors.slice(0, 10).join("\n")}`;
          if (errors.length > 10) {
            message += `\n... ${t("expenses.andMoreErrors").replace("{{count}}", (errors.length - 10).toString())}`;
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
      const errorMessage = error.message || t("common.unknownError");
      if (errorMessage.includes("Expenses sheet not found")) {
        setAlertModal({
          isOpen: true,
          message: t("expenses.expensesSheetNotFound"),
          type: "error",
        });
      } else if (errorMessage.includes("No expenses found")) {
        setAlertModal({
          isOpen: true,
          message: t("expenses.noExpensesInFile"),
          type: "error",
        });
      } else {
        setAlertModal({
          isOpen: true,
          message: `${t("expenses.importError")}: ${errorMessage}`,
          type: "error",
        });
      }
    } finally {
      setIsImporting(false);
    }
  }, [accounts, tags, users, addExpense, t, setIsImporting, setAlertModal, setImportModalOpen]);

  return {
    isExporting,
    handleExportExpenses,
    handleDownloadTemplate,
    handleImportFile,
  };
}

