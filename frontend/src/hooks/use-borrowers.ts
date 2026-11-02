"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";

import { dscEngineAbi } from "@/abis/dsc-engine";
import type { SupportedChainId } from "@/config/chains";
import { getDeployment, logChunkSize } from "@/config/contracts";
import { collateralDepositedEvent } from "@/lib/activity";

/** Discovery is capped so a popular deployment cannot melt the RPC. */
const MAX_ACCOUNTS = 60;

export type BorrowerRow = {
  address: Address;
  debt: bigint;
  collateralValue: bigint;
  healthFactor: bigint;
  collateral: bigint[];
};

async function discoverAccounts(
  client: PublicClient,
  engine: Address,
  fromBlock: bigint,
  chunkSize: number,
): Promise<Address[]> {
  const head = await client.getBlockNumber();
  const size = BigInt(Math.max(1, chunkSize));
  const accounts = new Set<string>();

  for (let start = fromBlock; start <= head; start += size) {
    const end = start + size - 1n > head ? head : start + size - 1n;
    const logs = await client.getLogs({
      address: engine,
      event: collateralDepositedEvent,
      fromBlock: start,
      toBlock: end,
    });

    for (const log of logs) {
      if (!log.args.user) continue;
      accounts.add(log.args.user);
      if (accounts.size >= MAX_ACCOUNTS) return [...accounts] as Address[];
    }
  }

  return [...accounts] as Address[];
}

export function useBorrowers(chainId: SupportedChainId) {
  const deployment = getDeployment(chainId);
  const client = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["borrowers", chainId, deployment?.engine ?? null],
    enabled: Boolean(client && deployment),
    staleTime: 30_000,
    queryFn: async (): Promise<BorrowerRow[]> => {
      if (!client || !deployment) return [];

      const accounts = await discoverAccounts(
        client,
        deployment.engine,
        deployment.deploymentBlock,
        logChunkSize,
      );
      if (accounts.length === 0) return [];

      const [infos, healths, collaterals] = await Promise.all([
        client.multicall({
          allowFailure: true,
          contracts: accounts.map((account) => ({
            address: deployment.engine,
            abi: dscEngineAbi,
            functionName: "getAccountInformation" as const,
            args: [account],
          })),
        }),
        client.multicall({
          allowFailure: true,
          contracts: accounts.map((account) => ({
            address: deployment.engine,
            abi: dscEngineAbi,
            functionName: "getHealthFactorFor" as const,
            args: [account],
          })),
        }),
        client.multicall({
          allowFailure: true,
          contracts: accounts.map((account) => ({
            address: deployment.engine,
            abi: dscEngineAbi,
            functionName: "getCollateralBalances" as const,
            args: [account],
          })),
        }),
      ]);

      const rows: BorrowerRow[] = [];

      accounts.forEach((account, index) => {
        const info = infos[index];
        const health = healths[index];
        const collateral = collaterals[index];

        if (!info || info.status !== "success" || !health || health.status !== "success") return;

        const [debt, collateralValue] = info.result;
        if (debt === 0n) return;

        rows.push({
          address: account,
          debt,
          collateralValue,
          healthFactor: health.result,
          collateral:
            collateral && collateral.status === "success" ? [...collateral.result] : [],
        });
      });

      return rows.sort((a, b) => (a.healthFactor < b.healthFactor ? -1 : 1));
    },
  });
}
