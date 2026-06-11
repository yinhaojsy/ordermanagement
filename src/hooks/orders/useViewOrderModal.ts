import { useState, useCallback } from "react";
import type { ReceiptFundedFrom } from "../../types";

export interface UploadItem {
  image: string;
  file?: File;
  amount: string;
  accountId: string;
}

export function useViewOrderModal() {
  const [viewModalOrderId, setViewModalOrderId] = useState<number | null>(null);
  const [makePaymentModalOrderId, setMakePaymentModalOrderId] = useState<number | null>(null);

  const [profitAmount, setProfitAmount] = useState<string>("");
  const [profitCurrency, setProfitCurrency] = useState<string>("");
  const [profitAccountId, setProfitAccountId] = useState<string>("");
  const [serviceChargeAmount, setServiceChargeAmount] = useState<string>("");
  const [serviceChargeCurrency, setServiceChargeCurrency] = useState<string>("");
  const [serviceChargeAccountId, setServiceChargeAccountId] = useState<string>("");
  const [serviceChargeFundedFrom, setServiceChargeFundedFrom] = useState<ReceiptFundedFrom>("cash");
  const [showProfitSection, setShowProfitSection] = useState(false);
  const [showServiceChargeSection, setShowServiceChargeSection] = useState(false);

  const [remarks, setRemarks] = useState<string>("");
  const [showRemarks, setShowRemarks] = useState(false);

  const closeViewModal = useCallback(() => {
    setViewModalOrderId(null);
    setProfitAmount("");
    setProfitCurrency("");
    setProfitAccountId("");
    setServiceChargeAmount("");
    setServiceChargeCurrency("");
    setServiceChargeAccountId("");
    setServiceChargeFundedFrom("cash");
    setShowProfitSection(false);
    setShowServiceChargeSection(false);
    setRemarks("");
    setShowRemarks(false);
  }, []);

  return {
    viewModalOrderId,
    setViewModalOrderId,
    makePaymentModalOrderId,
    setMakePaymentModalOrderId,
    closeViewModal,
    profitAmount,
    setProfitAmount,
    profitCurrency,
    setProfitCurrency,
    profitAccountId,
    setProfitAccountId,
    serviceChargeAmount,
    setServiceChargeAmount,
    serviceChargeCurrency,
    setServiceChargeCurrency,
    serviceChargeAccountId,
    setServiceChargeAccountId,
    serviceChargeFundedFrom,
    setServiceChargeFundedFrom,
    showProfitSection,
    setShowProfitSection,
    showServiceChargeSection,
    setShowServiceChargeSection,
    remarks,
    setRemarks,
    showRemarks,
    setShowRemarks,
  };
}
