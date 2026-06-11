export interface TronWallet {
  id: number;
  nickname: string;
  walletAddress: string;
  remarks: string | null;
  currentBalance: number;
  lastBalanceCheck: string | null;
  isUsdtBlacklisted: boolean;
  usdtBlacklistCheckedAt: string | null;
  amlAutoScreenTx: boolean;
  createdAt: string;
  updatedAt: string | null;
}
