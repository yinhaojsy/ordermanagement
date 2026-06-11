import { useTranslation } from "react-i18next";
import Badge from "../common/Badge";
import type { AmlCheck } from "../../types/integrations";
import type { TronWallet } from "../../types/wallets";

type Tone = "emerald" | "amber" | "rose" | "slate";

function isAmlProviderFlagged(check: AmlCheck | null | undefined): boolean {
  if (!check || check.isPending) return false;
  return check.isBlacklisted;
}

export default function WalletBlacklistBadges({
  wallet,
  amlCheck,
  compact = false,
}: {
  wallet: TronWallet;
  amlCheck?: AmlCheck | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const usdtTone: Tone =
    wallet.usdtBlacklistCheckedAt == null
      ? "slate"
      : wallet.isUsdtBlacklisted
        ? "rose"
        : "emerald";

  const usdtLabel =
    wallet.usdtBlacklistCheckedAt == null
      ? t("wallets.usdtBlacklistUnknown")
      : wallet.isUsdtBlacklisted
        ? t("wallets.usdtBlacklisted")
        : t("wallets.usdtBlacklistClear");

  const amlFlagged = isAmlProviderFlagged(amlCheck);

  return (
    <div className={`flex ${compact ? "flex-row flex-wrap gap-1" : "flex-col gap-1"}`}>
      <Badge tone={usdtTone} title={t("wallets.usdtBlacklistHint")}>
        {usdtLabel}
      </Badge>
      {amlCheck != null ? (
        <Badge
          tone={amlFlagged ? "rose" : amlCheck.isPending ? "blue" : "slate"}
          title={t("wallets.amlProviderFlagHint")}
        >
          {amlCheck.isPending
            ? t("wallets.amlProviderPending")
            : amlFlagged
              ? t("wallets.amlProviderFlagged")
              : t("wallets.amlProviderClear")}
        </Badge>
      ) : null}
    </div>
  );
}
