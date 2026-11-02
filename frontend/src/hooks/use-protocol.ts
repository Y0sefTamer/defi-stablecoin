"use client";

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { aggregatorV3Abi } from "@/abis/aggregator-v3";
import { dscAbi } from "@/abis/dsc";
import { dscEngineAbi } from "@/abis/dsc-engine";
import type { SupportedChainId } from "@/config/chains";
import { getDeployment } from "@/config/contracts";
import {
  DEFAULT_RISK_PARAMS,
  ORACLE_TIMEOUT_SECONDS,
  usdValue,
  type RiskParams,
} from "@/lib/math";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export type TokenMarket = {
  address: Address;
  symbol: string;
  decimals: number;
  /** Collateral the engine holds for this token, across all users. */
  engineBalance: bigint;
  /** User's wallet balance. */
  walletBalance: bigint;
  /** User's engine collateral (deposited), for this token. */
  deposited: bigint;
  /** User's allowance to the engine. */
  allowance: bigint;
  priceFeed: Address;
  price: bigint;
  priceDecimals: number;
  updatedAt: bigint;
  /** False when the configured address has no contract on this chain. */
  hasCode: boolean;
  /** Feed older than OracleLib's 3 hour timeout, or unreadable. */
  stale: boolean;
  depositedUsd: bigint;
  engineBalanceUsd: bigint;
  walletUsd: bigint;
};

export type ProtocolSnapshot = {
  chainId: number;
  engine: Address;
  dsc: Address;
  deploymentBlock: bigint;
  tokens: TokenMarket[];
  collateralValue: bigint;
  debt: bigint;
  healthFactor: bigint | null;
  dscTotalSupply: bigint;
  dscBalance: bigint;
  dscAllowance: bigint;
  tvl: bigint;
  riskParams: RiskParams;
  /** True when at least one feed is stale: every write will revert. */
  frozen: boolean;
  /** Tokens that can actually receive deposits on this chain. */
  usableTokens: TokenMarket[];
  now: number;
};

function ok<T>(result: { status: "success"; result: T } | { status: "failure"; error: unknown } | undefined, fallback: T): T {
  return result && result.status === "success" ? result.result : fallback;
}

export function protocolQueryKey(chainId: number | undefined, account: Address | undefined) {
  return ["protocol", chainId ?? null, account?.toLowerCase() ?? null] as const;
}

export function useProtocolSnapshot(chainId: SupportedChainId, account?: Address) {
  const deployment = getDeployment(chainId);
  const client = usePublicClient({ chainId });

  return useQuery({
    queryKey: [...protocolQueryKey(chainId, account), deployment?.engine ?? null],
    enabled: Boolean(client && deployment),
    refetchInterval: 20_000,
    queryFn: async (): Promise<ProtocolSnapshot> => {
      if (!client || !deployment) throw new Error("No deployment configured for this chain");

      const reader = account ?? ZERO_ADDRESS;

      const tokens = await client.readContract({
        address: deployment.engine,
        abi: dscEngineAbi,
        functionName: "getCollateralTokens",
      });

      const [tokenDetails, accountDetails, bytecodes] = await Promise.all([
        Promise.all(
          tokens.map(async (token) => {
            const [symbol, decimals, engineBalance, walletBalance, allowance, priceFeed, deposited] =
              await client.multicall({
                allowFailure: true,
                contracts: [
                  { address: token, abi: erc20Abi, functionName: "symbol" },
                  { address: token, abi: erc20Abi, functionName: "decimals" },
                  {
                    address: token,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [deployment.engine],
                  },
                  { address: token, abi: erc20Abi, functionName: "balanceOf", args: [reader] },
                  {
                    address: token,
                    abi: erc20Abi,
                    functionName: "allowance",
                    args: [reader, deployment.engine],
                  },
                  {
                    address: deployment.engine,
                    abi: dscEngineAbi,
                    functionName: "getCollateralTokenPriceFeed",
                    args: [token],
                  },
                  {
                    address: deployment.engine,
                    abi: dscEngineAbi,
                    functionName: "getCollateralBalanceOf",
                    args: [reader, token],
                  },
                ] as const,
              });

            return {
              address: token,
              symbol: ok(symbol, "???"),
              decimals: ok(decimals, 18),
              engineBalance: ok(engineBalance, 0n),
              walletBalance: ok(walletBalance, 0n),
              allowance: ok(allowance, 0n),
              priceFeed: ok(priceFeed, ZERO_ADDRESS),
              deposited: ok(deposited, 0n),
            };
          }),
        ),
        client.multicall({
          allowFailure: true,
          contracts: [
            {
              address: deployment.engine,
              abi: dscEngineAbi,
              functionName: "getAccountInformation",
              args: [reader],
            },
            {
              address: deployment.engine,
              abi: dscEngineAbi,
              functionName: "getHealthFactorFor",
              args: [reader],
            },
            { address: deployment.dsc, abi: dscAbi, functionName: "totalSupply" },
            { address: deployment.dsc, abi: dscAbi, functionName: "balanceOf", args: [reader] },
            {
              address: deployment.dsc,
              abi: dscAbi,
              functionName: "allowance",
              args: [reader, deployment.engine],
            },
            {
              address: deployment.engine,
              abi: dscEngineAbi,
              functionName: "getLiquidationThreshold",
            },
            {
              address: deployment.engine,
              abi: dscEngineAbi,
              functionName: "getLiquidationPrecision",
            },
            { address: deployment.engine, abi: dscEngineAbi, functionName: "getLiquidationBonus" },
            { address: deployment.engine, abi: dscEngineAbi, functionName: "getMinHealthFactor" },
          ] as const,
        }),
        Promise.all(
          tokens.map(async (token) => {
            try {
              const code = await client.getBytecode({ address: token });
              return Boolean(code && code !== "0x");
            } catch {
              return false;
            }
          }),
        ),
      ]);

      const [accountInfo, rawHealthFactor, totalSupply, dscBalance, dscAllowance, threshold, precision, bonus, minHealthFactor] =
        accountDetails;

      const riskParams: RiskParams = {
        liquidationThreshold: ok(threshold, DEFAULT_RISK_PARAMS.liquidationThreshold),
        liquidationPrecision: ok(precision, DEFAULT_RISK_PARAMS.liquidationPrecision),
        liquidationBonus: ok(bonus, DEFAULT_RISK_PARAMS.liquidationBonus),
        minHealthFactor: ok(minHealthFactor, DEFAULT_RISK_PARAMS.minHealthFactor),
      };

      const now = Math.floor(Date.now() / 1000);

      const markets: TokenMarket[] = await Promise.all(
        tokenDetails.map(async (detail, index) => {
          const hasCode = bytecodes[index] ?? false;
          let price = 0n;
          let priceDecimals = 8;
          let updatedAt = 0n;

          if (detail.priceFeed !== ZERO_ADDRESS) {
            const [roundData, feedDecimals] = await client.multicall({
              allowFailure: true,
              contracts: [
                {
                  address: detail.priceFeed,
                  abi: aggregatorV3Abi,
                  functionName: "latestRoundData",
                },
                { address: detail.priceFeed, abi: aggregatorV3Abi, functionName: "decimals" },
              ] as const,
            });

            const round = ok(roundData, undefined);
            if (round) {
              price = round[1] > 0n ? round[1] : 0n;
              updatedAt = round[3];
            }
            priceDecimals = ok(feedDecimals, 8);
          }

          const stale =
            updatedAt === 0n ||
            price === 0n ||
            BigInt(now) - updatedAt > ORACLE_TIMEOUT_SECONDS;

          return {
            ...detail,
            price,
            priceDecimals,
            updatedAt,
            hasCode,
            stale,
            depositedUsd: usdValue(detail.deposited, price, detail.decimals, priceDecimals),
            engineBalanceUsd: usdValue(detail.engineBalance, price, detail.decimals, priceDecimals),
            walletUsd: usdValue(detail.walletBalance, price, detail.decimals, priceDecimals),
          };
        }),
      );

      const [debt, collateralValue] = ok(accountInfo, [0n, 0n] as const);
      const rawHealth = ok(rawHealthFactor, 0n);
      const infinite = rawHealth === 2n ** 256n - 1n;

      return {
        chainId,
        engine: deployment.engine,
        dsc: deployment.dsc,
        deploymentBlock: deployment.deploymentBlock,
        tokens: markets,
        collateralValue,
        debt,
        healthFactor: infinite || debt === 0n ? null : rawHealth,
        dscTotalSupply: ok(totalSupply, 0n),
        dscBalance: ok(dscBalance, 0n),
        dscAllowance: ok(dscAllowance, 0n),
        tvl: markets.reduce((sum, market) => sum + market.engineBalanceUsd, 0n),
        riskParams,
        // A stale feed on a real market freezes the whole engine (OracleLib reverts).
        frozen: markets.some((market) => market.hasCode && market.stale),
        usableTokens: markets.filter((market) => market.hasCode && !market.stale),
        now,
      };
    },
  });
}
