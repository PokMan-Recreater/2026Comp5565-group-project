import { createConfig, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";

/**
 * wagmi configuration.
 *
 * `hardhat` is chain id 31337 and points at http://127.0.0.1:8545, which is
 * exactly what `npx hardhat node` serves. Add more chains to `chains` and
 * `transports` as the project grows.
 *
 * NOTE (wagmi v3): `useAccount` was renamed to `useConnection`, and mutate
 * functions are now `mutate` / `mutateAsync`. See the components for examples.
 */
export const wagmiConfig = createConfig({
  chains: [hardhat, sepolia],
  connectors: [injected()],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(),
  },
  // Required for the Next.js App Router: keeps the server render and the first
  // client render in sync, then reconnects the wallet after hydration.
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
