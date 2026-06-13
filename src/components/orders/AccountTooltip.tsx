import React, { useState, useEffect, useRef, type ReactNode, memo } from "react";
import { useTranslation } from "react-i18next";

interface AccountTooltipProps {
  accounts: Array<{ accountId: number | null; accountName: string; amount: number }>;
  label: string;
  children: ReactNode;
  profitAmount?: number | null;
  profitCurrency?: string | null;
  profitAccountName?: string | null;
  serviceChargeAmount?: number | null;
  serviceChargeCurrency?: string | null;
  serviceChargeAccountName?: string | null;
  isSellAccount?: boolean;
  accountCount?: number;
  currency?: string;
}

/**
 * Component for account tooltip with overflow handling
 */
export const AccountTooltip = memo(function AccountTooltip({
  accounts,
  label,
  children,
  profitAmount,
  profitCurrency,
  profitAccountName,
  serviceChargeAmount,
  serviceChargeCurrency,
  serviceChargeAccountName,
  isSellAccount = false,
  accountCount,
  currency,
}: AccountTooltipProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<'above' | 'below'>('below');
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Use provided accountCount or calculate from accounts length
  const totalAccountCount = accountCount !== undefined ? accountCount : accounts.length;

  useEffect(() => {
    const checkPosition = () => {
      if (!containerRef.current || !tooltipRef.current) return;
      
      const containerElement = containerRef.current;
      const tooltipElement = tooltipRef.current;
      
      // Use requestAnimationFrame to ensure tooltip is rendered
      requestAnimationFrame(() => {
        const containerRect = containerElement.getBoundingClientRect();
        const tooltipHeight = tooltipElement.offsetHeight || 200; // Approximate height if not measured yet
        const spaceBelow = window.innerHeight - containerRect.bottom;
        const spaceAbove = containerRect.top;
        
        // Position above if there's not enough space below, or if there's more space above
        const shouldPositionAbove = spaceBelow < tooltipHeight || spaceAbove > spaceBelow;
        
        setPosition(shouldPositionAbove ? 'above' : 'below');
      });
    };

    const container = containerRef.current;
    if (container) {
      const handleMouseEnter = () => {
        setIsHovered(true);
        checkPosition();
        // Double-check after a brief delay to ensure tooltip is fully rendered
        setTimeout(checkPosition, 10);
      };
      
      const handleMouseLeave = () => {
        setIsHovered(false);
      };
      
      container.addEventListener('mouseenter', handleMouseEnter);
      container.addEventListener('mouseleave', handleMouseLeave);
      // Also check on scroll
      window.addEventListener('scroll', checkPosition, true);
      return () => {
        container.removeEventListener('mouseenter', handleMouseEnter);
        container.removeEventListener('mouseleave', handleMouseLeave);
        window.removeEventListener('scroll', checkPosition, true);
      };
    }
  }, [accounts.length]);

  return (
    <div ref={containerRef} className="relative group inline-block">
      {children}
      {isHovered && (
        <div
        ref={tooltipRef}
        className={`absolute left-0 z-[100] bg-white border border-slate-200 rounded-lg shadow-xl p-3 min-w-[220px] max-w-[300px] ${
          position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          maxHeight: `${Math.min(window.innerHeight - 40, 400)}px`,
          overflowY: 'auto',
          overflowX: 'visible'
        }}
      >
        <div className="text-xs font-semibold text-slate-700 mb-2 pb-2 border-b border-slate-200">
          {label} ({totalAccountCount})
        </div>
        <div className="space-y-2">
          {accounts.map((acc, idx) => (
            <div key={idx} className="text-xs text-slate-600 flex justify-between items-center gap-3">
              <span className="truncate">{acc.accountName}</span>
              <span className="font-medium text-slate-800 whitespace-nowrap">
                {isSellAccount ? `-${acc.amount.toFixed(2)}` : acc.amount.toFixed(2)} {currency || ""}
              </span>
            </div>
          ))}
          {profitAmount !== null && profitAmount !== undefined && profitAccountName && (
            <div className="text-xs text-blue-700 flex justify-between items-center gap-3 pt-2 border-t border-slate-200">
              <span className="truncate font-semibold">Profit ({profitAccountName})</span>
              <span className="font-medium whitespace-nowrap">
                {profitAmount > 0 ? "+" : ""}{profitAmount.toFixed(2)} {profitCurrency || ""}
              </span>
            </div>
          )}
          {serviceChargeAmount !== null && serviceChargeAmount !== undefined && serviceChargeAccountName && (
            <div className="text-xs flex justify-between items-center gap-3 pt-2 border-t border-slate-200">
              <span className={`truncate font-semibold ${serviceChargeAmount < 0 ? "text-red-600" : "text-green-700"}`}>
                Fees ({serviceChargeAccountName})
              </span>
              <span className={`font-medium whitespace-nowrap ${serviceChargeAmount < 0 ? "text-red-600" : "text-green-700"}`}>
                {serviceChargeAmount > 0 ? "+" : ""}{serviceChargeAmount.toFixed(2)} {serviceChargeCurrency || ""}
              </span>
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
});

