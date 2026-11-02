"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useConnection, useSwitchChain } from "wagmi";

import { anvil, isSupportedChain, sepoliaChain, type SupportedChainId } from "@/config/chains";
import { getDeployment } from "@/config/contracts";

type ChainSelection = {
  /** Chain the app is actually reading from and writing to. */
  chainId: SupportedChainId;
  /** What the user picked. Differs from `chainId` only until the wallet switches. */
  preferredChainId: SupportedChainId;
  /** Select a chain. When a wallet is connected it is asked to switch too. */
  setChainId: (chainId: SupportedChainId) => void;
  /** Chain the wallet is currently connected to, if any. */
  walletChainId: number | undefined;
  isConnected: boolean;
  /** Connected wallet is on a supported chain that the user has not adopted yet. */
  needsSwitch: boolean;
};

const ChainSelectionContext = createContext<ChainSelection | undefined>(undefined);

function defaultChainId(): SupportedChainId {
  if (getDeployment(sepoliaChain.id)) return sepoliaChain.id;
  if (getDeployment(anvil.id)) return anvil.id;
  return sepoliaChain.id;
}

export function ChainSelectionProvider({ children }: { children: React.ReactNode }) {
  const { chainId: walletChainId, isConnected } = useConnection();
  const { mutate: switchChain } = useSwitchChain();
  const [preferredChainId, setPreferredChainId] = useState<SupportedChainId>(defaultChainId);

  const walletOnSupportedChain = isConnected && isSupportedChain(walletChainId);

  // While connected, the app follows the wallet: signing happens there, so
  // reading from another chain would show a position the wallet cannot touch.
  const chainId = walletOnSupportedChain ? walletChainId : preferredChainId;

  const setChainId = useCallback(
    (next: SupportedChainId) => {
      if (!isSupportedChain(next)) return;
      setPreferredChainId(next);
      if (isConnected && walletChainId !== next) switchChain({ chainId: next });
    },
    [isConnected, switchChain, walletChainId],
  );

  const value = useMemo<ChainSelection>(
    () => ({
      chainId,
      preferredChainId,
      setChainId,
      walletChainId,
      isConnected,
      needsSwitch: walletOnSupportedChain && walletChainId !== preferredChainId,
    }),
    [chainId, preferredChainId, setChainId, walletChainId, isConnected, walletOnSupportedChain],
  );

  return <ChainSelectionContext.Provider value={value}>{children}</ChainSelectionContext.Provider>;
}

export function useChainSelection(): ChainSelection {
  const context = useContext(ChainSelectionContext);
  if (!context) throw new Error("useChainSelection must be used inside <ChainSelectionProvider>");
  return context;
}
