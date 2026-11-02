import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { anvil, chains, rpcUrls, sepoliaChain } from "./chains";

export const wagmiConfig = createConfig({
  chains: [anvil, sepoliaChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [anvil.id]: http(rpcUrls[anvil.id], { batch: true }),
    [sepoliaChain.id]: http(rpcUrls[sepoliaChain.id], { batch: true }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export { chains };
