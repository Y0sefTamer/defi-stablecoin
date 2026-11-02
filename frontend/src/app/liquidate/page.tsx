"use client";

import { useConnection } from "wagmi";

import { LiquidatePanel } from "@/components/liquidate-panel";
import { OracleBanner } from "@/components/oracle-banner";
import { Badge, Button, Notice, Skeleton } from "@/components/ui";
import { getDeployment } from "@/config/contracts";
import { useBorrowers } from "@/hooks/use-borrowers";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { useProtocolSnapshot } from "@/hooks/use-protocol";

export default function LiquidatePage() {
  const { chainId } = useChainSelection();
  const { address } = useConnection();
  const deployment = getDeployment(chainId);
  const snapshot = useProtocolSnapshot(chainId, address);
  const borrowers = useBorrowers(chainId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Liquidations</h1>
        <p className="max-w-2xl text-sm text-muted">
          When a position falls below a 1.00 health factor, anyone can repay its DSC and receive the
          same value of collateral plus a 10% bonus. The protocol does not need a keeper.
        </p>
      </div>

      {!deployment ? (
        <Notice tone="warn" title="No deployment for this network">
          There is no engine address for chain {chainId}, so there are no positions to inspect.
        </Notice>
      ) : snapshot.error ? (
        <Notice tone="danger" title="Could not read the protocol">
          <div className="flex flex-col gap-2">
            <span>{snapshot.error instanceof Error ? snapshot.error.message : "Unknown error"}</span>
            <Button size="sm" variant="secondary" onClick={() => void snapshot.refetch()}>
              Retry
            </Button>
          </div>
        </Notice>
      ) : !snapshot.data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <OracleBanner
            markets={snapshot.data.tokens}
            frozen={snapshot.data.frozen}
            now={snapshot.data.now}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              minimum health factor {formatMin(snapshot.data.riskParams.minHealthFactor)}
            </Badge>
            <Badge tone="neutral">bonus {formatBonus(snapshot.data)}</Badge>
            {borrowers.isFetching ? <Badge tone="info">scanning events</Badge> : null}
          </div>

          {!address ? (
            <Notice tone="info" title="Read-only mode">
              You can inspect every account below. Connect a wallet from the header to send a
              liquidation.
            </Notice>
          ) : null}

          {borrowers.error ? (
            <Notice tone="danger" title="Could not scan for borrowers">
              {borrowers.error instanceof Error ? borrowers.error.message : "Unknown error"}
            </Notice>
          ) : null}

          <LiquidatePanel
            snapshot={snapshot.data}
            borrowers={borrowers.data ?? []}
            isLoading={borrowers.isLoading}
            account={address}
          />
        </>
      )}
    </div>
  );
}

function formatMin(value: bigint): string {
  return (Number(value) / 1e18).toFixed(2);
}

function formatBonus(snapshot: { riskParams: { liquidationBonus: bigint; liquidationPrecision: bigint } }) {
  return `${(Number(snapshot.riskParams.liquidationBonus) / Number(snapshot.riskParams.liquidationPrecision) * 100).toFixed(0)}%`;
}
