import React from "react";
import { ProfitSection } from "./ProfitSection";
import { ServiceChargeSection } from "./ServiceChargeSection";
import type { Account, AuthResponse, Order, ReceiptFundedFrom } from "../../types";
import { canPerformOrderActions } from "../../utils/orderPermissions";

interface ProfitServiceChargeSectionProps {
  orderId: number | null;
  order: Order | null | undefined;
  accounts: Account[];
  profits?: any[]; // OrderProfit[]
  serviceCharges?: any[]; // OrderServiceCharge[]
  
  // Profit state
  profitAmount: string;
  setProfitAmount: (value: string) => void;
  profitCurrency: string;
  setProfitCurrency: (value: string) => void;
  profitAccountId: string;
  setProfitAccountId: (value: string) => void;
  showProfitSection: boolean;
  setShowProfitSection: (show: boolean) => void;
  
  // Service charge state
  serviceChargeAmount: string;
  setServiceChargeAmount: (value: string) => void;
  serviceChargeCurrency: string;
  setServiceChargeCurrency: (value: string) => void;
  serviceChargeAccountId: string;
  setServiceChargeAccountId: (value: string) => void;
  serviceChargeFundedFrom: ReceiptFundedFrom;
  setServiceChargeFundedFrom: (value: ReceiptFundedFrom) => void;
  showServiceChargeSection: boolean;
  setShowServiceChargeSection: (show: boolean) => void;
  
  // Handlers
  updateOrder: (payload: { id: number; data: any }) => { unwrap: () => Promise<any> };
  handleNumberInputWheel: (e: React.WheelEvent<HTMLInputElement>) => void;
  
  // Configuration
  layout?: "grid" | "vertical";
  authUser?: AuthResponse | null;
  /** When false, hides “Add profit” / “Add service charges” (e.g. view-only order modal). */
  showAddControls?: boolean;

  t: (key: string) => string | undefined;
}

export const ProfitServiceChargeSection: React.FC<ProfitServiceChargeSectionProps> = ({
  orderId,
  order,
  accounts,
  profits = [],
  serviceCharges = [],
  profitAmount,
  setProfitAmount,
  profitCurrency,
  setProfitCurrency,
  profitAccountId,
  setProfitAccountId,
  showProfitSection,
  setShowProfitSection,
  serviceChargeAmount,
  setServiceChargeAmount,
  serviceChargeCurrency,
  setServiceChargeCurrency,
  serviceChargeAccountId,
  setServiceChargeAccountId,
  serviceChargeFundedFrom,
  setServiceChargeFundedFrom,
  showServiceChargeSection,
  setShowServiceChargeSection,
  updateOrder,
  handleNumberInputWheel,
  layout = "vertical",
  authUser,
  showAddControls = true,
  t,
}) => {
  const canPerformActions = order ? canPerformOrderActions(order, authUser || null) : true;
  
  // Check if there are existing draft entries
  const hasDraftProfit = profits && profits.some((p: any) => p.status === 'draft');
  const hasDraftServiceCharge = serviceCharges && serviceCharges.some((sc: any) => sc.status === 'draft');
  
  const handleRemoveProfit = async () => {
    if (!orderId || !order) return;
    // If there's a draft profit, send null values to clear it
    if (hasDraftProfit) {
      try {
        await updateOrder({
          id: orderId,
          data: {
            profitAmount: null,
            profitCurrency: null,
            profitAccountId: null,
          },
        }).unwrap();
      } catch (error: any) {
        console.error("Error removing profit:", error);
        const errorMessage = error?.data?.message || error?.message || t("orders.failedToRemoveProfit");
        alert(errorMessage);
        return;
      }
    }
    // Close the section and clear form fields
    setShowProfitSection(false);
    setProfitAmount("");
    setProfitCurrency("");
    setProfitAccountId("");
  };

  const handleRemoveServiceCharge = async () => {
    if (!orderId || !order) return;
    // If there's a draft service charge, send null values to clear it
    if (hasDraftServiceCharge) {
      try {
        await updateOrder({
          id: orderId,
          data: {
            serviceChargeAmount: null,
            serviceChargeCurrency: null,
            serviceChargeAccountId: null,
          },
        }).unwrap();
      } catch (error: any) {
        console.error("Error removing service charge:", error);
        const errorMessage = error?.data?.message || error?.message || t("orders.failedToRemoveServiceCharge");
        alert(errorMessage);
        return;
      }
    }
    // Close the section and clear form fields
    setShowServiceChargeSection(false);
    setServiceChargeAmount("");
    setServiceChargeCurrency("");
    setServiceChargeAccountId("");
    setServiceChargeFundedFrom("cash");
  };

  const handleSaveProfit = async () => {
    if (!orderId || !order) return;
    // Allow saving 0 or empty to clear existing drafts
    const amount = profitAmount ? Number(profitAmount) : 0;
    if (isNaN(amount) || amount < 0) {
      alert(t("orders.pleaseEnterValidAmount"));
      return;
    }
    
    // If amount is 0 or empty, clear the draft
    if (amount === 0 || !profitAmount || !profitCurrency || !profitAccountId) {
      if (hasDraftProfit) {
        try {
          await updateOrder({
            id: orderId,
            data: {
              profitAmount: null,
              profitCurrency: null,
              profitAccountId: null,
            },
          }).unwrap();
          setShowProfitSection(false);
          setProfitAmount("");
          setProfitCurrency("");
          setProfitAccountId("");
        } catch (error: any) {
          console.error("Error clearing profit:", error);
          const errorMessage = error?.data?.message || error?.message || t("orders.failedToRemoveProfit");
          alert(errorMessage);
        }
      } else {
        // No draft to clear, just close the form
        setShowProfitSection(false);
        setProfitAmount("");
        setProfitCurrency("");
        setProfitAccountId("");
      }
      return;
    }
    
    // Save new profit
    try {
      await updateOrder({
        id: orderId,
        data: {
          profitAmount: amount,
          profitCurrency: profitCurrency,
          profitAccountId: Number(profitAccountId),
        },
      }).unwrap();
      // Close the section after successful save
      setShowProfitSection(false);
      // Clear the form fields
      setProfitAmount("");
      setProfitCurrency("");
      setProfitAccountId("");
    } catch (error: any) {
      console.error("Error updating profit:", error);
      const errorMessage = error?.data?.message || error?.message || t("orders.failedToUpdateProfit");
      alert(errorMessage);
    }
  };

  const handleSaveServiceCharge = async () => {
    if (!orderId || !order) return;
    // Allow saving 0 or empty to clear existing drafts
    const amount = serviceChargeAmount ? Number(serviceChargeAmount) : 0;
    if (isNaN(amount)) {
      alert(t("orders.pleaseEnterValidAmount"));
      return;
    }
    
    const isBalanceFunded = serviceChargeFundedFrom === "customer_balance";
    const missingAccount = !isBalanceFunded && !serviceChargeAccountId;
    // If amount is 0 or empty, clear the draft
    if (amount === 0 || !serviceChargeAmount || !serviceChargeCurrency || missingAccount) {
      if (hasDraftServiceCharge) {
        try {
          await updateOrder({
            id: orderId,
            data: {
              serviceChargeAmount: null,
              serviceChargeCurrency: null,
              serviceChargeAccountId: null,
            },
          }).unwrap();
          setShowServiceChargeSection(false);
          setServiceChargeAmount("");
          setServiceChargeCurrency("");
          setServiceChargeAccountId("");
          setServiceChargeFundedFrom("cash");
        } catch (error: any) {
          console.error("Error clearing service charge:", error);
          const errorMessage = error?.data?.message || error?.message || t("orders.failedToRemoveServiceCharge");
          alert(errorMessage);
        }
      } else {
        // No draft to clear, just close the form
        setShowServiceChargeSection(false);
        setServiceChargeAmount("");
        setServiceChargeCurrency("");
        setServiceChargeAccountId("");
        setServiceChargeFundedFrom("cash");
      }
      return;
    }
    
    // Save new service charge
    try {
      await updateOrder({
        id: orderId,
        data: {
          serviceChargeAmount: amount,
          serviceChargeCurrency: serviceChargeCurrency,
          serviceChargeAccountId: isBalanceFunded ? null : Number(serviceChargeAccountId),
          serviceChargeFundedFrom: serviceChargeFundedFrom,
        },
      }).unwrap();
      // Close the section after successful save
      setShowServiceChargeSection(false);
      // Clear the form fields
      setServiceChargeAmount("");
      setServiceChargeCurrency("");
      setServiceChargeAccountId("");
      setServiceChargeFundedFrom("cash");
    } catch (error: any) {
      console.error("Error updating service charge:", error);
      const errorMessage = error?.data?.message || error?.message || t("orders.failedToUpdateServiceCharge");
      alert(errorMessage);
    }
  };

  const containerClassName = layout === "grid" ? "border-t pt-4 mt-4 space-y-4" : "border-t pt-4 mt-4 space-y-4";

  // Check if there are any profit or service charge entries (draft or confirmed)
  const hasProfit = profits && profits.length > 0;
  const hasServiceCharge = serviceCharges && serviceCharges.length > 0;

  if (!showAddControls && !showProfitSection && !showServiceChargeSection) {
    return null;
  }

  return (
    <div className={containerClassName}>
      {/* Profit Section */}
      <ProfitSection
        profitAmount={profitAmount}
        setProfitAmount={setProfitAmount}
        profitCurrency={profitCurrency}
        setProfitCurrency={setProfitCurrency}
        profitAccountId={profitAccountId}
        setProfitAccountId={setProfitAccountId}
        showProfitSection={showProfitSection}
        setShowProfitSection={setShowProfitSection}
        onSave={handleSaveProfit}
        onRemove={handleRemoveProfit}
        order={order}
        accounts={accounts}
        handleNumberInputWheel={handleNumberInputWheel}
        t={t}
      />

      {/* Service Charge Section */}
      <ServiceChargeSection
        serviceChargeAmount={serviceChargeAmount}
        setServiceChargeAmount={setServiceChargeAmount}
        serviceChargeCurrency={serviceChargeCurrency}
        setServiceChargeCurrency={setServiceChargeCurrency}
        serviceChargeAccountId={serviceChargeAccountId}
        setServiceChargeAccountId={setServiceChargeAccountId}
        serviceChargeFundedFrom={serviceChargeFundedFrom}
        setServiceChargeFundedFrom={setServiceChargeFundedFrom}
        showServiceChargeSection={showServiceChargeSection}
        setShowServiceChargeSection={setShowServiceChargeSection}
        onSave={handleSaveServiceCharge}
        onRemove={handleRemoveServiceCharge}
        order={order}
        accounts={accounts}
        handleNumberInputWheel={handleNumberInputWheel}
        t={t}
      />

      {showAddControls && canPerformActions && (
        <div className="flex gap-2">
          {!showProfitSection && !hasProfit && (
            <button
              type="button"
              onClick={() => setShowProfitSection(true)}
              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              {t("orders.addProfit")}
            </button>
          )}
          {!showServiceChargeSection && !hasServiceCharge && (
            <button
              type="button"
              onClick={() => setShowServiceChargeSection(true)}
              className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
            >
              {t("orders.addServiceCharges")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

