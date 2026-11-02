"use client";

import type { ProtocolSnapshot } from "@/hooks/use-protocol";
import { formatAmount, formatPercent, formatUsd } from "@/lib/format";
import {
  maxAdditionalDsc,
  maxWithdrawUsd,
  priceDropToLiquidation,
} from "@/lib/math";
import { HealthFactorBadge, HealthFactorGauge, LiquidationDistance } from "./health-factor";
import { Card, CardHeader, Stat } from "./ui";

export function PositionSummary({ snapshot }: { snapshot: ProtocolSnapshot }) {
  const { debt, collateralValue, healthFactor, riskParams, tokens } = snapshot;

  const borrowingPower = maxAdditionalDsc(debt, collateralValue, riskParams);
  const withdrawable = maxWithdrawUsd(debt, collateralValue, riskParams);
  const drop = priceDropToLiquidation(debt, collateralValue, riskParams);
  const deposited = tokens.filter((token) => token.deposited > 0n);

  return (
    <Card>
      <CardHeader
        title="Your position"
        description={
          deposited.length === 0
            ? "Nothing deposited yet."
            : deposited
                .map(
                  (token) =>
                    `${formatAmount(token.deposited, token.decimals, 4)} ${token.symbol}`,
                )
                .join(" · ")
        }
        actions={<HealthFactorBadge value={healthFactor} />}
      />

      <div className="flex flex-col gap-6 px-5 py-5">
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat
            label="Collateral"
            value={formatUsd(collateralValue)}
            hint="Raw value, before the threshold"
          />
          <Stat
            label="Debt"
            value={formatUsd(debt)}
            hint={debt === 0n ? "No DSC minted" : "DSC you owe"}
            tone={debt > 0n ? "default" : "accent"}
          />
          <Stat
            label="Mintable"
            value={formatUsd(borrowingPower)}
            hint="Before hitting health factor 1.00"
            tone="accent"
          />
          <Stat
            label="Withdrawable"
            value={formatUsd(withdrawable)}
            hint="Collateral value you can pull out"
          />
        </div>

        <div className="flex flex-col gap-2">
          <HealthFactorGauge value={healthFactor} params={riskParams} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <LiquidationDistance value={healthFactor} params={riskParams} />
            <span className="text-muted">
              {drop === null
                ? "No collateral at risk"
                : `Prices would need to fall ${formatPercent(drop, 1)} to make this liquidatable`}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
