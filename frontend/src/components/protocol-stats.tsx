"use client";

import type { ProtocolSnapshot } from "@/hooks/use-protocol";
import { formatAmount, formatPercent, formatUsd } from "@/lib/format";
import { Card, CardHeader, Skeleton, Stat } from "./ui";

export function ProtocolStats({ snapshot }: { snapshot: ProtocolSnapshot }) {
  const ratio =
    snapshot.dscTotalSupply > 0n
      ? Number(snapshot.tvl) / Number(snapshot.dscTotalSupply)
      : null;

  return (
    <Card>
      <CardHeader
        title="Protocol"
        description="Everything the engine holds, priced by the live Chainlink feeds."
      />
      <div className="grid grid-cols-2 gap-6 px-5 py-5 sm:grid-cols-4">
        <Stat
          label="Total collateral"
          value={formatUsd(snapshot.tvl)}
          hint="Across every user"
          tone="accent"
        />
        <Stat
          label="DSC supply"
          value={formatAmount(snapshot.dscTotalSupply, 18, 2)}
          hint="Minted and outstanding"
        />
        <Stat
          label="Collateral ratio"
          value={ratio === null ? "—" : `${ratio.toFixed(2)}×`}
          hint={ratio === null ? "Nothing minted yet" : "Collateral value / DSC supply"}
          tone={ratio !== null && ratio < 1.5 ? "warn" : "default"}
        />
        <Stat
          label="Live markets"
          value={`${snapshot.usableTokens.length}/${snapshot.tokens.length}`}
          hint="Usable collateral tokens"
        />
      </div>
    </Card>
  );
}

export function StatisticsSkeleton() {
  return (
    <Card>
      <CardHeader title="Protocol" />
      <div className="grid grid-cols-2 gap-6 px-5 py-5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RiskParameters({ snapshot }: { snapshot: ProtocolSnapshot }) {
  const { riskParams } = snapshot;
  const threshold =
    Number(riskParams.liquidationThreshold) / Number(riskParams.liquidationPrecision);
  const bonus = Number(riskParams.liquidationBonus) / Number(riskParams.liquidationPrecision);
  const minimum = Number(riskParams.minHealthFactor) / 1e18;

  const rows = [
    {
      label: "Liquidation threshold",
      value: formatPercent(threshold, 0),
      hint: "Share of collateral value counted as backing",
    },
    {
      label: "Liquidation bonus",
      value: formatPercent(bonus, 0),
      hint: "Extra collateral paid to a liquidator",
    },
    {
      label: "Minimum health factor",
      value: minimum.toFixed(2),
      hint: "Below this a position can be liquidated",
    },
    {
      label: "Oracle timeout",
      value: "3h",
      hint: "Stale feeds freeze the engine on purpose",
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Risk parameters"
        description="Read from the engine, not hardcoded in the app."
      />
      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 px-5 py-3">
            <div>
              <dt className="text-sm text-ink">{row.label}</dt>
              <p className="text-xs text-muted">{row.hint}</p>
            </div>
            <dd className="tabular shrink-0 text-sm text-accent">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
