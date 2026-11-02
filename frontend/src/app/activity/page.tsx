"use client";

import { useMemo } from "react";
import { useConnection } from "wagmi";

import { ActivityTable, type TokenMeta } from "@/components/activity-table";
import { ConnectPrompt } from "@/components/connect-prompt";
import { Button, Notice } from "@/components/ui";
import { getDeployment } from "@/config/contracts";
import { useActivity } from "@/hooks/use-activity";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { useProtocolSnapshot } from "@/hooks/use-protocol";

const DSC_META: TokenMeta = { symbol: "DSC", decimals: 18 };

export default function ActivityPage() {
  const { chainId } = useChainSelection();
  const { address } = useConnection();
  const deployment = getDeployment(chainId);
  const snapshot = useProtocolSnapshot(chainId, address);
  const activity = useActivity(chainId, address);

  const tokens = useMemo(() => {
    const map: Record<string, TokenMeta> = {};
    for (const token of snapshot.data?.tokens ?? []) {
      map[token.address.toLowerCase()] = { symbol: token.symbol, decimals: token.decimals };
    }
    return map;
  }, [snapshot.data?.tokens]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Activity</h1>
        <p className="max-w-2xl text-sm text-muted">
          Every position change for your address, rebuilt from engine and DSC logs since the
          deployment block. The engine has no mint or liquidate events, so those rows are inferred.
        </p>
      </div>

      {!deployment ? (
        <Notice tone="warn" title="No deployment for this network">
          There is no engine address for chain {chainId}, so there is no history to read.
        </Notice>
      ) : !address ? (
        <ConnectPrompt title="Connect to see your history" />
      ) : activity.error ? (
        <Notice tone="danger" title="Could not load activity">
          <div className="flex flex-col gap-2">
            <span>{activity.error instanceof Error ? activity.error.message : "Unknown error"}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void activity.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        </Notice>
      ) : (
        <ActivityTable
          items={activity.data ?? []}
          isLoading={activity.isLoading}
          chainId={chainId}
          tokens={tokens}
          dsc={DSC_META}
        />
      )}

      {address && deployment ? (
        <p className="text-xs text-faint">
          Scanned from block {deployment.deploymentBlock.toString()}. Large ranges are split into
          chunks; if your RPC rejects them, lower <code>NEXT_PUBLIC_LOG_CHUNK_SIZE</code>.
        </p>
      ) : null}
    </div>
  );
}
