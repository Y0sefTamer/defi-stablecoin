import { defineChain } from "viem";
import { sepolia } from "viem/chains";

const ANVIL_RPC_URL = process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ANVIL_RPC_URL] },
  },
  testnet: true,
});

export const sepoliaChain = {
  ...sepolia,
  rpcUrls: {
    ...sepolia.rpcUrls,
    default: { http: [SEPOLIA_RPC_URL] },
  },
} as const;

export const chains = [anvil, sepoliaChain] as const;

export const rpcUrls: Record<number, string> = {
  [anvil.id]: ANVIL_RPC_URL,
  [sepoliaChain.id]: SEPOLIA_RPC_URL,
};

export type SupportedChainId = (typeof chains)[number]["id"];

export function isSupportedChain(chainId: number | undefined): chainId is SupportedChainId {
  return chains.some((chain) => chain.id === chainId);
}

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  if (chainId === sepoliaChain.id) return `${sepoliaChain.blockExplorers.default.url}/tx/${hash}`;
  return undefined;
}

export function explorerAddressUrl(chainId: number, address: string): string | undefined {
  if (chainId === sepoliaChain.id) {
    return `${sepoliaChain.blockExplorers.default.url}/address/${address}`;
  }
  return undefined;
}
