"use client";

import { useConnection } from "wagmi";

import { ActionPanel } from "@/components/action-panel";
import { ConnectPrompt } from "@/components/connect-prompt";
import { OracleBanner } from "@/components/oracle-banner";
import { PositionSummary } from "@/components/position-summary";
import { Badge, Button, Card, CardHeader, Notice, Skeleton } from "@/components/ui";
import { getDeployment } from "@/config/contracts";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { useProtocolSnapshot } from "@/hooks/use-protocol";
import { formatHealthFactor } from "@/lib/format";
import { positionHealth } from "@/lib/math";

export default function PositionPage() {
  const { chainId } = useChainSelection();
  const { address } = useConnection();
  const deployment = getDeployment(chainId);
  const snapshot = useProtocolSnapshot(chainId, address);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your position</h1>
        <p className="text-sm text-muted">
          Deposit collateral, mint DSC against it, and repay to unlock the collateral again.
        </p>
      </div>

      {!deployment ? (
        <Notice tone="warn" title="No deployment for this network">
          There is no engine address for chain {chainId}. Set{" "}
          <code>NEXT_PUBLIC_DSC_ENGINE_{chainId}</code> or sync a deployment first.
        </Notice>
      ) : !address ? (
        <ConnectPrompt title="Connect to manage a position" />
      ) : snapshot.error ? (
        <Notice tone="danger" title="Could not load your position">
          <div className="flex flex-col gap-2">
            <span>{snapshot.error instanceof Error ? snapshot.error.message : "Unknown error"}</span>
            <Button size="sm" variant="secondary" onClick={() => void snapshot.refetch()}>
              Retry
            </Button>
          </div>
        </Notice>
      ) : !snapshot.data ? (
        <PositionSkeleton />
      ) : (
        <>
          <OracleBanner
            markets={snapshot.data.tokens}
            frozen={snapshot.data.frozen}
            now={snapshot.data.now}
          />

          {positionHealth(snapshot.data.healthFactor, snapshot.data.riskParams) ===
          "liquidatable" ? (
            <Notice tone="danger" title="This position can be liquidated">
              Health factor is {formatHealthFactor(snapshot.data.healthFactor)}, below 1.00. Repay
              DSC or add collateral now — anyone can seize collateral with a 10% bonus until it is
              back above the line.
            </Notice>
          ) : null}

          <PositionSummary snapshot={snapshot.data} />

          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wider text-faint uppercase">Actions</h2>
            {snapshot.isFetching ? <Badge tone="info">refreshing</Badge> : null}
          </div>

          <ActionPanel snapshot={snapshot.data} />
        </>
      )}
    </div>
  );
}

function PositionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Your position" />
        <div className="grid grid-cols-2 gap-6 px-5 py-5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </Card>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
