import { useState, useEffect, useMemo, useRef } from "react";
import type { FormEvent } from "react";
import {
  useAddOrderMutation,
  useUpdateOrderMutation,
  useProcessOrderMutation,
  useGetOrderDetailsQuery,
  useGetCustomerLedgerBalanceQuery,
  useAddReceiptMutation,
  useAddPaymentMutation,
  useDeleteReceiptMutation,
  useDeletePaymentMutation,
  useConfirmReceiptMutation,
  useConfirmPaymentMutation,
  useUpdateOrderStatusMutation,
  useConfirmProfitMutation,
  useConfirmServiceChargeMutation,
  useDeleteProfitMutation,
  useDeleteServiceChargeMutation,
} from "../../services/api";
import { getDefaultOtcHandler } from "../../utils/otcHandlerPreference";
import type { Account, AuthResponse, ReceiptFundedFrom } from "../../types";
import { ORDER_RECEIPT_PAYMENT_TOLERANCE } from "../../utils/orders/orderAmountTolerance";

interface OtcForm {
  customerId: string;
  fromCurrency: string;
  toCurrency: string;
  amountBuy: string;
  amountSell: string;
  rate: string;
  handlerId: string;
}

interface OtcReceipt {
  amount: string;
  accountId: string;
  fundedFrom?: "cash" | "customer_balance";
}

interface OtcPayment {
  amount: string;
  accountId: string;
  fundedFrom?: "cash" | "customer_balance";
}

export function useOtcOrder(
  accounts: Account[],
  setOpenMenuId: (id: number | null) => void,
  setIsCreateCustomerModalOpen: (open: boolean) => void,
  authUser: AuthResponse | null
) {
  const [isOtcOrderModalOpen, setIsOtcOrderModalOpen] = useState(false);
  const [otcEditingOrderId, setOtcEditingOrderId] = useState<number | null>(null);
  const [isOtcSaving, setIsOtcSaving] = useState(false);
  const isSubmittingRef = useRef(false); // Use ref to prevent race conditions
  
  const [otcForm, setOtcForm] = useState<OtcForm>({
    customerId: "",
    fromCurrency: "",
    toCurrency: "",
    amountBuy: "",
    amountSell: "",
    rate: "",
    handlerId: "",
  });
  const [otcReceipts, setOtcReceipts] = useState<OtcReceipt[]>([]);
  const [otcPayments, setOtcPayments] = useState<OtcPayment[]>([]);
  const [otcProfitAmount, setOtcProfitAmount] = useState<string>("");
  const [otcProfitCurrency, setOtcProfitCurrency] = useState<string>("");
  const [otcProfitAccountId, setOtcProfitAccountId] = useState<string>("");
  const [otcServiceChargeAmount, setOtcServiceChargeAmount] = useState<string>("");
  const [otcServiceChargeCurrency, setOtcServiceChargeCurrency] = useState<string>("");
  const [otcServiceChargeAccountId, setOtcServiceChargeAccountId] = useState<string>("");
  const [otcServiceChargeFundedFrom, setOtcServiceChargeFundedFrom] = useState<ReceiptFundedFrom>("cash");
  const [showOtcProfitSection, setShowOtcProfitSection] = useState(false);
  const [showOtcServiceChargeSection, setShowOtcServiceChargeSection] = useState(false);
  const [otcCalculatedField, setOtcCalculatedField] = useState<"buy" | "sell" | null>(null);
  const [otcRemarks, setOtcRemarks] = useState<string>("");
  const [showOtcRemarks, setShowOtcRemarks] = useState(false);
  // Track if there were draft profit/service charges when editing started
  const [hadDraftProfit, setHadDraftProfit] = useState(false);
  const [hadDraftServiceCharge, setHadDraftServiceCharge] = useState(false);
  // Track if there were remarks when editing started
  const [hadRemarks, setHadRemarks] = useState(false);

  const { data: otcOrderDetails } = useGetOrderDetailsQuery(otcEditingOrderId || 0, {
    skip: !otcEditingOrderId,
  });

  const [addOrder] = useAddOrderMutation();
  const [updateOrder] = useUpdateOrderMutation();
  const [updateOrderStatus] = useUpdateOrderStatusMutation();
  const [processOrder] = useProcessOrderMutation();
  const [addReceipt] = useAddReceiptMutation();
  const [addPayment] = useAddPaymentMutation();
  const [deleteReceipt] = useDeleteReceiptMutation();
  const [deletePayment] = useDeletePaymentMutation();
  const [deleteProfit] = useDeleteProfitMutation();
  const [deleteServiceCharge] = useDeleteServiceChargeMutation();
  const [confirmReceipt] = useConfirmReceiptMutation();
  const [confirmPayment] = useConfirmPaymentMutation();
  const [confirmProfit] = useConfirmProfitMutation();
  const [confirmServiceCharge] = useConfirmServiceChargeMutation();

  // Cancelled OTC orders stay view-only; completed orders remain editable
  const isOtcCompleted = useMemo(() => {
    return Boolean(
      otcEditingOrderId &&
      otcOrderDetails?.order &&
      otcOrderDetails.order.status === "cancelled",
    );
  }, [otcEditingOrderId, otcOrderDetails]);

  // Load OTC order details when editing
  useEffect(() => {
    if (otcEditingOrderId && otcOrderDetails && otcOrderDetails.order) {
      const order = otcOrderDetails.order;
      setOtcForm({
        customerId: String(order.customerId),
        fromCurrency: order.fromCurrency,
        toCurrency: order.toCurrency,
        amountBuy: String(order.amountBuy),
        amountSell: String(order.amountSell),
        rate: String(order.rate),
        handlerId: order.handlerId ? String(order.handlerId) : "",
      });
      // Load receipts and payments - ensure we have valid arrays
      const receipts = Array.isArray(otcOrderDetails.receipts) ? otcOrderDetails.receipts : [];
      const payments = Array.isArray(otcOrderDetails.payments) ? otcOrderDetails.payments : [];
      
      setOtcReceipts(
        receipts.map((r) => ({
          amount: String(r.amount || ""),
          accountId: r.accountId ? String(r.accountId) : "",
          fundedFrom: r.fundedFrom === "customer_balance" ? "customer_balance" : "cash",
        })),
      );
      
      setOtcPayments(
        payments.map((p) => ({
          amount: String(p.amount || ""),
          accountId: p.accountId ? String(p.accountId) : "",
          fundedFrom: p.fundedFrom === "customer_balance" ? "customer_balance" : "cash",
        })),
      );
      
      // Load profit and service charges from separate tables (like receipts/payments)
      // Check confirmed entries first, then fall back to order table fields
      const profits = Array.isArray(otcOrderDetails.profits) ? otcOrderDetails.profits : [];
      const serviceCharges = Array.isArray(otcOrderDetails.serviceCharges) ? otcOrderDetails.serviceCharges : [];
      
      // Check if there are draft entries
      const draftProfit = profits.find((p: any) => p.status === 'draft');
      const draftServiceCharge = serviceCharges.find((sc: any) => sc.status === 'draft');
      setHadDraftProfit(!!draftProfit);
      setHadDraftServiceCharge(!!draftServiceCharge);
      
      // Find confirmed profit entry (or use the latest one if no confirmed exists)
      const confirmedProfit = profits.find((p: any) => p.status === 'confirmed') || profits[profits.length - 1];
      if (confirmedProfit) {
        setOtcProfitAmount(String(confirmedProfit.amount || ""));
        setOtcProfitCurrency(confirmedProfit.currencyCode || "");
        setOtcProfitAccountId(confirmedProfit.accountId ? String(confirmedProfit.accountId) : "");
        setShowOtcProfitSection(true);
      } else if (draftProfit) {
        // Use draft profit
        setOtcProfitAmount(String(draftProfit.amount || ""));
        setOtcProfitCurrency(draftProfit.currencyCode || "");
        setOtcProfitAccountId(draftProfit.accountId ? String(draftProfit.accountId) : "");
        setShowOtcProfitSection(true);
      } else if (order.profitAmount !== null && order.profitAmount !== undefined) {
        // Fall back to order table fields
        setOtcProfitAmount(String(order.profitAmount));
        setOtcProfitCurrency(order.profitCurrency || "");
        setOtcProfitAccountId(order.profitAccountId ? String(order.profitAccountId) : "");
        setShowOtcProfitSection(true);
      }
      
      // Find confirmed service charge entry (or use the latest one if no confirmed exists)
      const confirmedServiceCharge = serviceCharges.find((sc: any) => sc.status === 'confirmed') || serviceCharges[serviceCharges.length - 1];
      if (confirmedServiceCharge) {
        setOtcServiceChargeAmount(String(confirmedServiceCharge.amount || ""));
        setOtcServiceChargeCurrency(confirmedServiceCharge.currencyCode || "");
        setOtcServiceChargeAccountId(confirmedServiceCharge.accountId ? String(confirmedServiceCharge.accountId) : "");
        setOtcServiceChargeFundedFrom(
          confirmedServiceCharge.fundedFrom === "customer_balance" ? "customer_balance" : "cash",
        );
        setShowOtcServiceChargeSection(true);
      } else if (draftServiceCharge) {
        // Use draft service charge
        setOtcServiceChargeAmount(String(draftServiceCharge.amount || ""));
        setOtcServiceChargeCurrency(draftServiceCharge.currencyCode || "");
        setOtcServiceChargeAccountId(draftServiceCharge.accountId ? String(draftServiceCharge.accountId) : "");
        setOtcServiceChargeFundedFrom(
          draftServiceCharge.fundedFrom === "customer_balance" ? "customer_balance" : "cash",
        );
        setShowOtcServiceChargeSection(true);
      } else if (order.serviceChargeAmount !== null && order.serviceChargeAmount !== undefined) {
        // Fall back to order table fields
        setOtcServiceChargeAmount(String(order.serviceChargeAmount));
        setOtcServiceChargeCurrency(order.serviceChargeCurrency || "");
        setOtcServiceChargeAccountId(order.serviceChargeAccountId ? String(order.serviceChargeAccountId) : "");
        setOtcServiceChargeFundedFrom("cash");
        setShowOtcServiceChargeSection(true);
      }
      // Load remarks if available
      // Check if remarks exists (could be string, null, or undefined)
      const remarksValue = (order as any).remarks;
      if (remarksValue !== null && remarksValue !== undefined && remarksValue.trim() !== "") {
        setOtcRemarks(remarksValue);
        setShowOtcRemarks(true);
        setHadRemarks(true);
      } else {
        // Reset remarks state if no remarks exist
        setOtcRemarks("");
        setShowOtcRemarks(false);
        setHadRemarks(false);
      }
    }
  }, [otcEditingOrderId, otcOrderDetails]);

  // Load default handler when creating new OTC order (not editing)
  useEffect(() => {
    if (!otcEditingOrderId && isOtcOrderModalOpen && authUser?.id) {
      const defaultHandlerId = getDefaultOtcHandler(authUser.id);
      if (defaultHandlerId) {
        setOtcForm((prev) => {
          // Only set if handlerId is empty (don't override if already set)
          if (!prev.handlerId) {
            return {
              ...prev,
              handlerId: defaultHandlerId,
            };
          }
          return prev;
        });
      }
    }
  }, [isOtcOrderModalOpen, otcEditingOrderId, authUser?.id]);

  const resetOtcForm = () => {
    setOtcForm({
      customerId: "",
      fromCurrency: "",
      toCurrency: "",
      amountBuy: "",
      amountSell: "",
      rate: "",
      handlerId: "",
    });
    setOtcReceipts([]);
    setOtcPayments([]);
    setOtcProfitAmount("");
    setOtcProfitCurrency("");
    setOtcProfitAccountId("");
    setOtcServiceChargeAmount("");
    setOtcServiceChargeCurrency("");
    setOtcServiceChargeAccountId("");
    setOtcServiceChargeFundedFrom("cash");
    setShowOtcProfitSection(false);
    setShowOtcServiceChargeSection(false);
    setOtcCalculatedField(null);
    setOtcRemarks("");
    setShowOtcRemarks(false);
    setHadDraftProfit(false);
    setHadDraftServiceCharge(false);
    setHadRemarks(false);
  };

  const closeOtcModal = () => {
    resetOtcForm();
    setIsOtcOrderModalOpen(false);
    setOtcEditingOrderId(null);
    isSubmittingRef.current = false;
    setIsOtcSaving(false);
  };

  // Handler to remove profit (clears draft) - uses DELETE endpoint like receipts/payments
  const handleRemoveOtcProfit = async () => {
    if (!otcEditingOrderId) {
      // Not editing, just clear local state
      setShowOtcProfitSection(false);
      setOtcProfitAmount("");
      setOtcProfitCurrency("");
      setOtcProfitAccountId("");
      setHadDraftProfit(false);
      return;
    }

    try {
      // Find draft profit entry to delete
      if (otcOrderDetails && otcOrderDetails.profits) {
        const draftProfit = otcOrderDetails.profits.find((p: any) => p.status === 'draft');
        if (draftProfit && draftProfit.id) {
          // Use DELETE endpoint like receipts/payments
          await deleteProfit(draftProfit.id).unwrap();
        }
      }
      // Clear local state
      setShowOtcProfitSection(false);
      setOtcProfitAmount("");
      setOtcProfitCurrency("");
      setOtcProfitAccountId("");
      setHadDraftProfit(false);
    } catch (error: any) {
      console.error("Error removing profit:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to remove profit";
      alert(errorMessage);
    }
  };

  // Handler to remove service charge (clears draft) - uses DELETE endpoint like receipts/payments
  const handleRemoveOtcServiceCharge = async () => {
    if (!otcEditingOrderId) {
      // Not editing, just clear local state
      setShowOtcServiceChargeSection(false);
      setOtcServiceChargeAmount("");
      setOtcServiceChargeCurrency("");
      setOtcServiceChargeAccountId("");
      setHadDraftServiceCharge(false);
      return;
    }

    try {
      // Find draft service charge entry to delete
      if (otcOrderDetails && otcOrderDetails.serviceCharges) {
        const draftServiceCharge = otcOrderDetails.serviceCharges.find((sc: any) => sc.status === 'draft');
        if (draftServiceCharge && draftServiceCharge.id) {
          // Use DELETE endpoint like receipts/payments
          await deleteServiceCharge(draftServiceCharge.id).unwrap();
        }
      }
      // Clear local state
      setShowOtcServiceChargeSection(false);
      setOtcServiceChargeAmount("");
      setOtcServiceChargeCurrency("");
      setOtcServiceChargeAccountId("");
      setHadDraftServiceCharge(false);
    } catch (error: any) {
      console.error("Error removing service charge:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to remove service charge";
      alert(errorMessage);
    }
  };

  // Handler to remove remarks (clears from backend)
  const handleRemoveOtcRemarks = async () => {
    if (!otcEditingOrderId) {
      // Not editing, just clear local state
      setShowOtcRemarks(false);
      setOtcRemarks("");
      setHadRemarks(false);
      return;
    }

    try {
      // Send null to clear remarks
      await updateOrder({
        id: otcEditingOrderId,
        data: {
          remarks: null as unknown as string,
        },
      }).unwrap();
      // Clear local state
      setShowOtcRemarks(false);
      setOtcRemarks("");
      setHadRemarks(false);
    } catch (error: any) {
      console.error("Error removing remarks:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to remove remarks";
      alert(errorMessage);
    }
  };

  const handleOtcOrderSave = async (event: FormEvent) => {
    event.preventDefault();
    
    // Double-guard against concurrent submissions
    if (isOtcSaving || isSubmittingRef.current) return;
    
    if (!otcForm.customerId || !otcForm.fromCurrency || !otcForm.toCurrency) return;
    const handlerId = Number(otcForm.handlerId);
    if (!otcForm.handlerId || Number.isNaN(handlerId)) {
      alert("Handler is required");
      return;
    }
    const buyAccountId = otcReceipts.find(
      (r) => r.accountId && (r.fundedFrom ?? "cash") === "cash",
    )?.accountId
      ? Number(otcReceipts.find((r) => r.accountId && (r.fundedFrom ?? "cash") === "cash")!.accountId)
      : null;
    const sellAccountId = otcPayments.find(
      (p) => p.accountId && (p.fundedFrom ?? "cash") === "cash",
    )?.accountId
      ? Number(otcPayments.find((p) => p.accountId && (p.fundedFrom ?? "cash") === "cash")!.accountId)
      : null;
    const buyAccountIdValue: number | undefined = buyAccountId === null ? undefined : buyAccountId;
    const sellAccountIdValue: number | undefined = sellAccountId === null ? undefined : sellAccountId;

    isSubmittingRef.current = true;
    setIsOtcSaving(true);
    try {
      let orderId: number;
      
      // Prepare order data with remarks
      const orderData: any = {
        customerId: Number(otcForm.customerId),
        fromCurrency: otcForm.fromCurrency,
        toCurrency: otcForm.toCurrency,
        amountBuy: Number(otcForm.amountBuy || 0),
        amountSell: Number(otcForm.amountSell || 0),
        rate: Number(otcForm.rate || 1),
        handlerId,
        buyAccountId: buyAccountIdValue,
        sellAccountId: sellAccountIdValue,
      };
      
      // Handle remarks: if section is shown, include remarks (null if empty to remove from DB)
      // Also clear remarks if section was closed but there were remarks before
      if (showOtcRemarks) {
        if (otcRemarks && otcRemarks.trim() !== "") {
          orderData.remarks = otcRemarks.trim();
        } else {
          // Empty remarks - set to null to remove from database
          orderData.remarks = null as unknown as string;
        }
      } else if (hadRemarks) {
        // Section is closed but there were remarks before - clear them
        orderData.remarks = null as unknown as string;
      }

      // Include profit and service charges in orderData (like handleOtcOrderComplete)
      // Backend's updateOrder automatically deletes existing drafts and creates new ones
      if (otcProfitAmount && otcProfitAccountId && otcProfitCurrency) {
        orderData.profitAmount = Number(otcProfitAmount);
        orderData.profitCurrency = otcProfitCurrency;
        orderData.profitAccountId = Number(otcProfitAccountId);
      } else if (showOtcProfitSection || hadDraftProfit) {
        // If section is shown but fields are empty, or if there was a draft, clear it
        orderData.profitAmount = null as unknown as number;
        orderData.profitCurrency = null as unknown as string;
        orderData.profitAccountId = null as unknown as number;
      }
      
      const otcScBal = otcServiceChargeFundedFrom === "customer_balance";
      const otcScAmount = Number(otcServiceChargeAmount);
      const otcScValid =
        otcServiceChargeAmount &&
        otcServiceChargeCurrency &&
        (!otcScBal ? otcServiceChargeAccountId : true) &&
        otcScAmount !== 0;
      if (otcScValid) {
        orderData.serviceChargeAmount = otcScAmount;
        orderData.serviceChargeCurrency = otcServiceChargeCurrency;
        orderData.serviceChargeFundedFrom = otcServiceChargeFundedFrom;
        orderData.serviceChargeAccountId = otcScBal
          ? (null as unknown as number)
          : Number(otcServiceChargeAccountId);
      } else if (showOtcServiceChargeSection || hadDraftServiceCharge) {
        orderData.serviceChargeAmount = null as unknown as number;
        orderData.serviceChargeCurrency = null as unknown as string;
        orderData.serviceChargeAccountId = null as unknown as number;
        orderData.serviceChargeFundedFrom = null as unknown as ReceiptFundedFrom;
      }

      if (otcEditingOrderId) {
        // Update existing order
        // Backend's updateOrder handles profit/service charge drafts automatically
        await updateOrder({
          id: otcEditingOrderId,
          data: orderData,
        }).unwrap();
        orderId = otcEditingOrderId;
      } else {
        // Create new OTC order
        const newOrder = await addOrder({
          ...orderData,
          status: "saved",
          orderType: "otc",
        }).unwrap();
        orderId = newOrder.id;
      }

      // Delete existing receipts and payments when editing, then recreate from form
      if (otcEditingOrderId && otcOrderDetails) {
        // Delete existing receipts
        for (const receipt of otcOrderDetails.receipts || []) {
          try {
            await deleteReceipt(receipt.id).unwrap();
          } catch (error) {
            console.error("Error deleting receipt:", error);
          }
        }
        // Delete existing payments
        for (const payment of otcOrderDetails.payments || []) {
          try {
            await deletePayment(payment.id).unwrap();
          } catch (error) {
            console.error("Error deleting payment:", error);
          }
        }
      }

      // Create receipts (without image for OTC orders)
      for (const receipt of otcReceipts) {
        const receiptAmount = Number(receipt.amount) || 0;
        if (receiptAmount <= 0) continue;
        const fundedFrom = receipt.fundedFrom ?? "cash";
        if (fundedFrom === "cash" && !receipt.accountId) continue;
        await addReceipt({
          id: orderId,
          amount: receiptAmount,
          accountId: fundedFrom === "cash" ? Number(receipt.accountId) : undefined,
          fundedFrom,
          imagePath: "",
        } as any).unwrap();
      }

      // Create payments (without image for OTC orders)
      for (const payment of otcPayments) {
        const paymentAmount = Number(payment.amount) || 0;
        if (paymentAmount <= 0) continue;
        const fundedFrom = payment.fundedFrom ?? "cash";
        if (fundedFrom === "cash" && !payment.accountId) continue;
        await addPayment({
          id: orderId,
          amount: paymentAmount,
          accountId: fundedFrom === "cash" ? Number(payment.accountId) : undefined,
          fundedFrom,
          imagePath: "",
        } as any).unwrap();
      }

      closeOtcModal();
    } catch (error: any) {
      console.error("Error saving OTC order:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to save OTC order";
      alert(errorMessage);
    } finally {
      isSubmittingRef.current = false;
      setIsOtcSaving(false);
    }
  };

  const handleOtcOrderComplete = async (event: FormEvent) => {
    event.preventDefault();
    
    // Double-guard against concurrent submissions
    if (isOtcSaving || isSubmittingRef.current) return;
    
    if (!otcForm.customerId || !otcForm.fromCurrency || !otcForm.toCurrency) return;

    // Validate handler is assigned
    const handlerId = Number(otcForm.handlerId);
    if (!otcForm.handlerId || Number.isNaN(handlerId)) {
      alert("Handler must be assigned before completing the order");
      return;
    }

    const cashReceipt = otcReceipts.find(
      (r) => r.accountId && (r.fundedFrom ?? "cash") === "cash",
    );
    const buyAccountId = cashReceipt?.accountId
      ? Number(cashReceipt.accountId)
      : accounts.find((a) => a.currencyCode === otcForm.fromCurrency)?.id;
    const cashPayment = otcPayments.find(
      (p) => p.accountId && (p.fundedFrom ?? "cash") === "cash",
    );
    const sellAccountId = cashPayment?.accountId
      ? Number(cashPayment.accountId)
      : accounts.find((a) => a.currencyCode === otcForm.toCurrency)?.id;
    const buyAccountIdValue = buyAccountId ?? undefined;
    const sellAccountIdValue = cashPayment ? (sellAccountId ?? undefined) : undefined;
    const hasValidReceipt = otcReceipts.some((r) => {
      const amt = Number(r.amount) || 0;
      if (amt <= 0) return false;
      return (r.fundedFrom ?? "cash") === "customer_balance" || !!r.accountId;
    });
    const hasValidPayment = otcPayments.some((p) => {
      const amt = Number(p.amount) || 0;
      if (amt <= 0) return false;
      return (p.fundedFrom ?? "cash") === "customer_balance" || !!p.accountId;
    });
    if (!hasValidReceipt) {
      alert("Add at least one receipt with amount (prepaid balance or cash account).");
      return;
    }
    if (!hasValidPayment) {
      alert("Add at least one payment with amount (customer advance Bal or cash account).");
      return;
    }
    if (cashPayment && !sellAccountId) {
      alert("Please select a payment account for cash payout before completing.");
      return;
    }

    const receiptsWithoutAccounts = otcReceipts.filter((r) => {
      const amt = Number(r.amount) || 0;
      if (amt <= 0) return false;
      return (r.fundedFrom ?? "cash") === "cash" && !r.accountId;
    });
    if (receiptsWithoutAccounts.length > 0) {
      alert("Cash receipt lines need a company account selected.");
      return;
    }

    // Validate that all payments with amounts have accounts selected
    const paymentsWithoutAccounts = otcPayments.filter((p) => {
      const amt = Number(p.amount) || 0;
      if (amt <= 0) return false;
      return (p.fundedFrom ?? "cash") === "cash" && !p.accountId;
    });
    if (paymentsWithoutAccounts.length > 0) {
      alert("Cash payment lines need a company account selected.");
      return;
    }

    // Validate receipt total equals amountBuy (with tolerance for floating-point precision)
    const receiptTotal = otcReceipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const amountBuy = Number(otcForm.amountBuy || 0);
    if (Math.abs(receiptTotal - amountBuy) > ORDER_RECEIPT_PAYMENT_TOLERANCE) {
      alert(`Receipt total (${receiptTotal.toFixed(2)}) must equal Amount Buy (${amountBuy.toFixed(2)})`);
      return;
    }

    // Validate payment total equals amountSell (with tolerance for floating-point precision)
    const paymentTotal = otcPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const amountSell = Number(otcForm.amountSell || 0);
    if (Math.abs(paymentTotal - amountSell) > ORDER_RECEIPT_PAYMENT_TOLERANCE) {
      alert(`Payment total (${paymentTotal.toFixed(2)}) must equal Amount Sell (${amountSell.toFixed(2)})`);
      return;
    }

    isSubmittingRef.current = true;
    setIsOtcSaving(true);
    try {
      let orderId: number;
      
      // Prepare order data with remarks, profit, and service charges
      // Include all fields in one call, matching the amountBuy/amountSell pattern
      const orderData: any = {
        customerId: Number(otcForm.customerId),
        fromCurrency: otcForm.fromCurrency,
        toCurrency: otcForm.toCurrency,
        amountBuy: Number(otcForm.amountBuy || 0),
        amountSell: Number(otcForm.amountSell || 0),
        rate: Number(otcForm.rate || 1),
        handlerId,
        buyAccountId: buyAccountIdValue,
        sellAccountId: sellAccountIdValue,
      };
      
      // Handle remarks: save if not empty, regardless of whether section is shown
      if (otcRemarks && otcRemarks.trim() !== "") {
        orderData.remarks = otcRemarks.trim();
      } else if (showOtcRemarks) {
        // If section is shown but remarks are empty, set to null to remove from database
        orderData.remarks = null;
      }
      
      // Include profit and service charges in the same call (like amountBuy/amountSell)
      if (otcProfitAmount && otcProfitAccountId && otcProfitCurrency) {
        orderData.profitAmount = Number(otcProfitAmount);
        orderData.profitCurrency = otcProfitCurrency;
        orderData.profitAccountId = Number(otcProfitAccountId);
      }
      
      const completeScBal = otcServiceChargeFundedFrom === "customer_balance";
      const completeScAmount = Number(otcServiceChargeAmount);
      const completeScValid =
        otcServiceChargeAmount &&
        otcServiceChargeCurrency &&
        (!completeScBal ? otcServiceChargeAccountId : true) &&
        completeScAmount !== 0;
      if (completeScValid) {
        orderData.serviceChargeAmount = completeScAmount;
        orderData.serviceChargeCurrency = otcServiceChargeCurrency;
        orderData.serviceChargeFundedFrom = otcServiceChargeFundedFrom;
        orderData.serviceChargeAccountId = completeScBal
          ? (null as unknown as number)
          : Number(otcServiceChargeAccountId);
      }

      if (otcEditingOrderId) {
        // Update existing order
        const updateResult = await updateOrder({
          id: otcEditingOrderId,
          data: orderData,
        }).unwrap();
        orderId = otcEditingOrderId;
        
        // Confirm profit/service charge if they were created (for OTC orders)
        // The backend now returns createdProfitId and createdServiceChargeId
        if ((updateResult as any).createdProfitId) {
          await confirmProfit((updateResult as any).createdProfitId).unwrap();
        }
        if ((updateResult as any).createdServiceChargeId) {
          await confirmServiceCharge((updateResult as any).createdServiceChargeId).unwrap();
        }
      } else {
        // Create new OTC order
        // Profit and service charges are handled in createOrder backend (creates confirmed entries directly)
        const newOrder = await addOrder({
          ...orderData,
          status: "saved",
          orderType: "otc",
        }).unwrap();
        orderId = newOrder.id;
      }

      // For OTC orders, handler is already set in orderData, so no need to call processOrder
      // OTC orders stay in "saved" so they can be edited until completed

      // Delete existing receipts and payments when editing, then recreate from form
      if (otcEditingOrderId && otcOrderDetails) {
        // Delete existing receipts
        for (const receipt of otcOrderDetails.receipts || []) {
          try {
            await deleteReceipt(receipt.id).unwrap();
          } catch (error) {
            console.error("Error deleting receipt:", error);
          }
        }
        // Delete existing payments
        for (const payment of otcOrderDetails.payments || []) {
          try {
            await deletePayment(payment.id).unwrap();
          } catch (error) {
            console.error("Error deleting payment:", error);
          }
        }
      }

      // Create and confirm receipts
      for (const receipt of otcReceipts) {
        const receiptAmount = Number(receipt.amount) || 0;
        if (receiptAmount <= 0) continue;
        const fundedFrom = receipt.fundedFrom ?? "cash";
        if (fundedFrom === "cash" && !receipt.accountId) continue;
        const receiptResult = await addReceipt({
          id: orderId,
          amount: receiptAmount,
          accountId: fundedFrom === "cash" ? Number(receipt.accountId) : undefined,
          fundedFrom,
          imagePath: "",
        } as any).unwrap();
        await confirmReceipt((receiptResult as { id: number }).id).unwrap();
      }

      // Create and confirm payments
      for (const payment of otcPayments) {
        const paymentAmount = Number(payment.amount) || 0;
        if (paymentAmount <= 0) continue;
        const fundedFrom = payment.fundedFrom ?? "cash";
        if (fundedFrom === "cash" && !payment.accountId) continue;
        const paymentResult = await addPayment({
          id: orderId,
          amount: paymentAmount,
          accountId: fundedFrom === "cash" ? Number(payment.accountId) : undefined,
          fundedFrom,
          imagePath: "",
        } as any).unwrap();
        await confirmPayment((paymentResult as { id: number }).id).unwrap();
      }

      // Profit and service charges are now handled in the addOrder/updateOrder call above
      // The backend will create confirmed entries directly for OTC orders
      // This matches the amountBuy/amountSell pattern - all in one call!

      // Ensure remarks are saved before completing (in case they weren't saved earlier)
      if (otcRemarks && otcRemarks.trim() !== "") {
        await updateOrder({
          id: orderId,
          data: {
            remarks: otcRemarks.trim(),
          },
        }).unwrap();
      } else if (showOtcRemarks && (!otcRemarks || otcRemarks.trim() === "")) {
        // If section is shown but remarks are empty, remove from database
        await updateOrder({
          id: orderId,
          data: {
            // API expects null to clear remarks; cast to satisfy typing
            remarks: null as unknown as string,
          },
        }).unwrap();
      }

      // Complete the order
      await updateOrderStatus({
        id: orderId,
        status: "completed",
      }).unwrap();

      closeOtcModal();
    } catch (error: any) {
      console.error("Error completing OTC order:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to complete OTC order";
      alert(errorMessage);
    } finally {
      isSubmittingRef.current = false;
      setIsOtcSaving(false);
    }
  };

  return {
    // State
    isOtcOrderModalOpen,
    setIsOtcOrderModalOpen,
    otcEditingOrderId,
    setOtcEditingOrderId,
    isOtcSaving,
    otcForm,
    setOtcForm,
    otcReceipts,
    setOtcReceipts,
    otcPayments,
    setOtcPayments,
    otcProfitAmount,
    setOtcProfitAmount,
    otcProfitCurrency,
    setOtcProfitCurrency,
    otcProfitAccountId,
    setOtcProfitAccountId,
    otcServiceChargeAmount,
    setOtcServiceChargeAmount,
    otcServiceChargeCurrency,
    setOtcServiceChargeCurrency,
    otcServiceChargeAccountId,
    setOtcServiceChargeAccountId,
    otcServiceChargeFundedFrom,
    setOtcServiceChargeFundedFrom,
    showOtcProfitSection,
    setShowOtcProfitSection,
    showOtcServiceChargeSection,
    setShowOtcServiceChargeSection,
    otcCalculatedField,
    setOtcCalculatedField,
    otcRemarks,
    setOtcRemarks,
    showOtcRemarks,
    setShowOtcRemarks,
    otcOrderDetails,
    isOtcCompleted,
    // Handlers
    handleOtcOrderSave,
    handleOtcOrderComplete,
    resetOtcForm,
    handleRemoveOtcProfit,
    handleRemoveOtcServiceCharge,
    handleRemoveOtcRemarks,
    closeOtcModal,
  };
}

