"use client";

import { useConnection, useSwitchChain } from "wagmi";

import { chains, isSupportedChain } from "@/config/chains";
import { useChainSelection } from "@/hooks/use-chain-selection";
import { cn } from "./ui";

export function ChainSwitcher() {
  const { chainId, setChainId, walletChainId, isConnected, needsSwitch } = useChainSelection();
  const { mutate: switchChain, isPending } = useSwitchChain();
  const { isConnected: connected } = useConnection();

  const unsupportedWalletChain = connected && !isSupportedChain(walletChainId);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="chain-select" className="sr-only">
        Network
      </label>
      <select
        id="chain-select"
        value={chainId}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (isSupportedChain(next)) setChainId(next);
        }}
        className="rounded-lg border border-line-strong bg-panel-2 px-2.5 py-2 text-xs text-ink outline-none focus-visible:border-accent"
      >
        {chains.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </select>

      {unsupportedWalletChain ? (
        <button
          type="button"
          onClick={() => switchChain({ chainId })}
          disabled={isPending}
          className={cn(
            "rounded-lg border border-danger/50 bg-danger-dim px-2.5 py-2 text-xs text-danger",
            isPending && "opacity-50",
          )}
        >
          Wrong network
        </button>
      ) : needsSwitch && isConnected ? (
        <button
          type="button"
          onClick={() => switchChain({ chainId })}
          disabled={isPending}
          className="rounded-lg border border-warn/50 bg-warn-dim px-2.5 py-2 text-xs text-warn disabled:opacity-50"
        >
          {isPending ? "Switching…" : "Switch wallet"}
        </button>
      ) : null}
    </div>
  );
}
