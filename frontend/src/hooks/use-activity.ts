"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";

import type { SupportedChainId } from "@/config/chains";
import { getDeployment, logChunkSize } from "@/config/contracts";
import { fetchActivity } from "@/lib/activity";

export function useActivity(chainId: SupportedChainId, account?: Address) {
  const deployment = getDeployment(chainId);
  const client = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["activity", chainId, deployment?.engine ?? null, account?.toLowerCase() ?? null],
    enabled: Boolean(client && deployment && account),
    staleTime: 30_000,
    queryFn: async () => {
      if (!client || !deployment || !account) return [];
      return fetchActivity({
        client,
        engine: deployment.engine,
        dsc: deployment.dsc,
        account,
        fromBlock: deployment.deploymentBlock,
        chunkSize: logChunkSize,
      });
    },
  });
}
