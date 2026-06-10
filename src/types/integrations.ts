export type IntegrationFieldType = "text" | "password" | "url" | "number" | "select" | "boolean";

export interface IntegrationFieldDef {
  key: string;
  label: string;
  type: IntegrationFieldType;
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
}

export interface IntegrationProviderDef {
  id: string;
  name: string;
  category: string;
  description: string;
  docsUrl: string;
  usedBy: string[];
  capabilities: string[];
  fields: IntegrationFieldDef[];
}

export interface IntegrationConfigMasked {
  providerId: string;
  enabled: boolean;
  config: Record<string, string | number | boolean>;
  secretsMeta: Record<string, string | null>;
  hasSecrets: boolean;
  updatedAt: string | null;
  source?: string;
}

export interface AmlSignal {
  key: string;
  label: string;
  percent: number;
}

export interface AmlCheck {
  id: number;
  walletId: number;
  transactionId: number | null;
  providerId: string;
  checkType: "address" | "address_investigation" | "transaction";
  externalUid: string | null;
  status: string;
  riskPercent: number | null;
  riskLevel: string;
  isBlacklisted: boolean;
  signals: AmlSignal[];
  createdAt: string;
  isPending: boolean;
}
