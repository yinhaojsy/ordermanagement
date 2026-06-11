export function mapWalletRow(row) {
  if (!row) return row;
  return {
    ...row,
    isUsdtBlacklisted: row.isUsdtBlacklisted === 1,
    amlAutoScreenTx: row.amlAutoScreenTx !== 0,
  };
}
