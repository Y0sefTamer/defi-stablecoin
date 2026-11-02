"use client";

import { formatHealthFactor, formatPercent } from "@/lib/format";
import { positionHealth, type PositionHealth, type RiskParams, DEFAULT_RISK_PARAMS } from "@/lib/math";
import { Badge, cn } from "./ui";

const HEALTH_META: Record<
  PositionHealth,
  { label: string; tone: "neutral" | "accent" | "warn" | "danger" }
> = {
  "no-debt": { label: "No debt", tone: "neutral" },
  liquidatable: { label: "Liquidatable", tone: "danger" },
  danger: { label: "Danger", tone: "danger" },
  warning: { label: "Tight", tone: "warn" },
  safe: { label: "Healthy", tone: "accent" },
};

export function HealthFactorBadge({ value }: { value: bigint | null }) {
  const health = positionHealth(value);
  const meta = HEALTH_META[health];
  return (
    <Badge tone={meta.tone}>
      {health === "no-debt" ? meta.label : formatHealthFactor(value)}
    </Badge>
  );
}

/**
 * Horizontal gauge on a 0–2.0 axis. The 1.0 tick is the liquidation line, so a
 * glance tells you how much room the position has left.
 */
export function HealthFactorGauge({
  value,
  params = DEFAULT_RISK_PARAMS,
}: {
  value: bigint | null;
  params?: RiskParams;
}) {
  const health = positionHealth(value, params);
  const numeric = value === null ? null : Number(value) / 1e18;
  const ratio = numeric === null ? 0 : Math.min(1, Math.max(0, numeric / 2));

  const barTone =
    health === "liquidatable" || health === "danger"
      ? "bg-danger"
      : health === "warning"
        ? "bg-warn"
        : "bg-accent";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-panel-2">
        <div
          className={cn("h-full rounded-full transition-[width]", barTone)}
          style={{ width: `${(ratio * 100).toFixed(1)}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-ink/50"
          style={{ left: "50%" }}
          aria-hidden="true"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>0.00</span>
        <span className="text-muted">1.00 liquidation line</span>
        <span>2.00+</span>
      </div>
    </div>
  );
}

export function LiquidationDistance({
  value,
  params = DEFAULT_RISK_PARAMS,
}: {
  value: bigint | null;
  params?: RiskParams;
}) {
  if (value === null) return <span className="text-muted">—</span>;

  const min = params.minHealthFactor;
  if (value < min) return <span className="text-danger">below liquidation</span>;

  // A collateral value drop of `1 - 1/HF` takes the position exactly to 1.00.
  const buffer = 1 - 1 / (Number(value) / 1e18);
  return (
    <span className="text-muted">
      {formatPercent(Math.max(0, buffer), 1)} collateral drop buffer
    </span>
  );
}
