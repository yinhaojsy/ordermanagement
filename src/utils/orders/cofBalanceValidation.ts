import { FUNDING_BALANCE_TOLERANCE } from "./orderAmountTolerance";

type FundedLine = {
  amount: number;
  fundedFrom: "cash" | "customer_balance";
};

type FundedScLine = {
  amount: number;
  currencyCode: string;
  fundedFrom: "cash" | "customer_balance";
};

type FundingRow = {
  currencyCode: string;
  allocatable: number;
  allocatableAdvance: number;
};

function addToCurrencyTotal(map: Map<string, number>, currencyCode: string, amount: number) {
  if (!currencyCode || amount <= 0) return;
  map.set(currencyCode, (map.get(currencyCode) ?? 0) + amount);
}

/** Client-side COF checks mirroring server confirmReceipt / confirmPayment / confirmServiceCharge. */
export function validateCofBalancesBeforeComplete(params: {
  receiptLines: FundedLine[];
  paymentLines: FundedLine[];
  scLines: FundedScLine[];
  fromCurrency: string;
  toCurrency: string;
  isLedgerSwap: boolean;
  fundingCurrencies: FundingRow[];
}): string | null {
  const prepaidByCurrency = new Map<string, number>();

  for (const line of params.receiptLines) {
    if ((line.fundedFrom ?? "cash") !== "customer_balance") continue;
    addToCurrencyTotal(prepaidByCurrency, params.fromCurrency, line.amount);
  }

  for (const sc of params.scLines) {
    if (sc.fundedFrom !== "customer_balance") continue;
    addToCurrencyTotal(prepaidByCurrency, sc.currencyCode, sc.amount);
  }

  const advanceByCurrency = new Map<string, number>();
  if (!params.isLedgerSwap) {
    for (const line of params.paymentLines) {
      if ((line.fundedFrom ?? "cash") !== "customer_balance") continue;
      addToCurrencyTotal(advanceByCurrency, params.toCurrency, line.amount);
    }
  }

  const lookup = new Map(params.fundingCurrencies.map((row) => [row.currencyCode, row]));

  for (const [currencyCode, required] of prepaidByCurrency) {
    const available = lookup.get(currencyCode)?.allocatable ?? 0;
    if (required > available + FUNDING_BALANCE_TOLERANCE) {
      return `Insufficient customer prepaid balance. Available: ${available.toFixed(2)} ${currencyCode}`;
    }
  }

  for (const [currencyCode, required] of advanceByCurrency) {
    const available = lookup.get(currencyCode)?.allocatableAdvance ?? 0;
    if (required > available + FUNDING_BALANCE_TOLERANCE) {
      return `Insufficient customer advance to settle. Available: ${available.toFixed(2)} ${currencyCode}`;
    }
  }

  return null;
}

export function orderUsesCustomerFunding(params: {
  receiptLines: FundedLine[];
  paymentLines: FundedLine[];
  scLines: FundedScLine[];
}): boolean {
  const hasCofLine = (line: FundedLine) =>
    (line.fundedFrom ?? "cash") === "customer_balance" && line.amount > 0;

  return (
    params.receiptLines.some(hasCofLine) ||
    params.paymentLines.some(hasCofLine) ||
    params.scLines.some((sc) => sc.fundedFrom === "customer_balance" && sc.amount > 0)
  );
}
