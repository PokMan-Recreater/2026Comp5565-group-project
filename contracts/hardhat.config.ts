// Side-effect import so that values in `contracts/.env` are available to
// `configVariable(...)` below. In production prefer `npx hardhat keystore set`.
import "dotenv/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * Hardhat 3 configuration.
 *
 * - `plugins`  : the official Mocha + Ethers.js toolbox (ethers.js, chai matchers,
 *                Hardhat Ignition, hardhat-verify, network-helpers, typechain...).
 * - `solidity` : build profiles. `default` is used by `hardhat compile` / `hardhat test`,
 *                `production` is used for release builds (more optimizer runs).
 * - `networks` : an in-process simulated network for tests, an HTTP network that talks
 *                to `npx hardhat node`, and Sepolia for testnet deployments.
 */
export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],

  paths: {
    sources: "./contracts",
    tests: {
      mocha: "./test",
    },
    cache: "./cache",
    artifacts: "./artifacts",
  },

  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
    },
  },

  networks: {
    // In-process simulated Ethereum network used by `hardhat test`.
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },

    // Connects to the standalone node started with `npx hardhat node`.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },

    // Public testnet. Values come from `contracts/.env` (see .env.example).
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
});
