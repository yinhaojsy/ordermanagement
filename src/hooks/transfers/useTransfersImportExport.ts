import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { processImportFile } from "../../utils/transfers/transferImport";
import { exportTransfersToExcel } from "../../utils/transfers/transferExport";

interface UseTransfersImportExportParams {
  exportQueryParams: any;
  accounts: any[];
  tags: any[];
  users?: any[];
  addTransfer: any;
  setAlertModal: (modal: { isOpen: boolean; message: string; type?: "error" | "warning" | "info" | "success" }) => void;
  setIsImporting: (isImporting: boolean) => void;
  setImportModalOpen: (isOpen: boolean) => void;
  t: (key: string) => string;
}

export function useTransfersImportExport({
  exportQueryParams,
  accounts,
  tags,
  users = [],
  addTransfer,
  setAlertModal,
  setIsImporting,
  setImportModalOpen,
  t,
}: UseTransfersImportExportParams) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportTransfers = useCallback(async () => {
    try {
      setIsExporting(true);
      const result = await exportTransfersToExcel(exportQueryParams, t);
      setAlertModal({
        isOpen: true,
        message: t("transfers.exportSuccess")
          .replace("{{count}}", result.count.toString())
          .replace("{{fileName}}", result.fileName),
        type: "success",
      });
    } catch (error) {
      setAlertModal({
        isOpen: true,
        message: t("transfers.exportError"),
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
        "Transfer ID": "TRF-1001",
        "Date": "2026-10-26",
        "From Account": "Main USD",
        "To Account": "Secondary USD",
        "Amount": 1000,
        "Currency": "USD",
        "Transaction Fee": 5,
        "Description": "Transfer to secondary account",
        "Created By": "Admin User",
        "Tags": "Internal, Monthly"
      },
      {
        "Transfer ID": "TRF-1002",
        "Date": "2026-10-26",
        "From Account": "Main HKD",
        "To Account": "Secondary HKD",
        "Amount": 5000,
        "Currency": "HKD",
        "Transaction Fee": "",
        "Description": "Fund allocation",
        "Created By": "Admin User",
        "Tags": ""
      }
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, templateSheet, "Transfers");

    // Write file
    XLSX.writeFile(wb, "transfers_import_template.xlsx");
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);

      // Process import file
      const { transfers: validatedTransfers, errors: validationErrors } = await processImportFile(
        file,
        accounts,
        tags,
        users
      );

      // Import validated transfers
      let successCount = 0;
      let errorCount = validationErrors.length;
      const errors = [...validationErrors];

      for (const transferData of validatedTransfers) {
        try {
          // Mark as imported for transaction history
          await addTransfer({ ...transferData, isImported: true }).unwrap();
          successCount++;
        } catch (error: any) {
          errors.push(`Transfer ${transferData.fromAccountId} -> ${transferData.toAccountId}: ${error.message || t("common.unknownError")}`);
          errorCount++;
        }
      }

      // Show results
      let message = t("transfers.importSuccess").replace("{{count}}", successCount.toString());
      if (errorCount > 0) {
        message += `. ${errorCount} ${t("transfers.transfersFailedToImport")}.`;
        if (errors.length > 0) {
          message += `\n\n${t("transfers.errors")}:\n${errors.slice(0, 10).join("\n")}`;
          if (errors.length > 10) {
            message += `\n... ${t("transfers.andMoreErrors").replace("{{count}}", (errors.length - 10).toString())}`;
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
      if (errorMessage.includes("Transfers sheet not found")) {
        setAlertModal({
          isOpen: true,
          message: t("transfers.transfersSheetNotFound"),
          type: "error",
        });
      } else if (errorMessage.includes("No transfers found")) {
        setAlertModal({
          isOpen: true,
          message: t("transfers.noTransfersInFile"),
          type: "error",
        });
      } else {
        setAlertModal({
          isOpen: true,
          message: `${t("transfers.importError")}: ${errorMessage}`,
          type: "error",
        });
      }
    } finally {
      setIsImporting(false);
    }
  }, [accounts, tags, users, addTransfer, t, setIsImporting, setAlertModal, setImportModalOpen]);

  return {
    isExporting,
    handleExportTransfers,
    handleDownloadTemplate,
    handleImportFile,
  };
}

