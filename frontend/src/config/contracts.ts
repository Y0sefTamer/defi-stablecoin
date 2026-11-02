import { getAddress, isAddress, type Address } from "viem";

import generated from "./deployments.generated.json";
import { anvil, isSupportedChain, sepoliaChain, type SupportedChainId } from "./chains";

export type Deployment = {
  chainId: SupportedChainId;
  engine: Address;
  dsc: Address;
  /** Block the engine was deployed at, used as `fromBlock` when scanning logs. */
  deploymentBlock: bigint;
  /** Optional: only present when the deployment came from a broadcast artifact. */
  oracleLib?: Address;
};

type GeneratedDeployment = {
  chainId: number;
  engine: string;
  dsc: string;
  oracleLib?: string;
  deploymentBlock?: number;
};

const generatedDeployments = generated as Record<string, GeneratedDeployment | undefined>;

function parseAddress(value: string | undefined | null): Address | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!isAddress(trimmed, { strict: false })) return undefined;
  return getAddress(trimmed.toLowerCase());
}

function parseBlock(value: string | number | undefined | null): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const ENV_ENGINE: Record<SupportedChainId, string | undefined> = {
  [anvil.id]: process.env.NEXT_PUBLIC_DSC_ENGINE_31337,
  [sepoliaChain.id]: process.env.NEXT_PUBLIC_DSC_ENGINE_11155111,
};

const ENV_BLOCK: Record<SupportedChainId, string | undefined> = {
  [anvil.id]: process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK_31337,
  [sepoliaChain.id]: process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK_11155111,
};

/**
 * Resolves a deployment for a chain. Priority: explicit env override, then the
 * broadcast artifact written by `pnpm sync:deployments`. Nothing is hardcoded
 * in components and no address is ever guessed.
 */
export function getDeployment(chainId: number | undefined): Deployment | undefined {
  if (!isSupportedChain(chainId)) return undefined;

  const generatedEntry = generatedDeployments[String(chainId)];
  const engine =
    parseAddress(ENV_ENGINE[chainId]) ?? parseAddress(generatedEntry?.engine) ?? undefined;
  const dsc = parseAddress(generatedEntry?.dsc);
  const deploymentBlock = parseBlock(ENV_BLOCK[chainId]) ?? parseBlock(generatedEntry?.deploymentBlock);

  if (!engine || !dsc || deploymentBlock === undefined) return undefined;

  return {
    chainId,
    engine,
    dsc,
    deploymentBlock,
    oracleLib: parseAddress(generatedEntry?.oracleLib),
  };
}

export const supportedChainIds: SupportedChainId[] = [anvil.id, sepoliaChain.id];

export const logChunkSize = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_LOG_CHUNK_SIZE ?? "10000");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10_000;
})();
