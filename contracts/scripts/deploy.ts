import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Deploys `ProductWarrantyRegistry` to the network selected with `--network`.
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *
 * The deployer becomes the `DEFAULT_ADMIN_ROLE` holder (the role administrator).
 * Every supply-chain role (`MANUFACTURER_ROLE`, `RETAILER_ROLE`, `CUSTOMER_ROLE`,
 * `SERVICE_CENTER_ROLE`) is granted afterwards through `grantRole`:
 * `seed-demo.ts` does that for the local demo accounts, `grant-roles.ts` for a
 * public network.
 *
 * The deployment is recorded in `contracts/deployments/<network>.json`, which
 * `npm run export:abi` then copies into the frontend workspace.
 */
const { ethers, networkName } = await network.create();

const [deployer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();

console.log(`Network : ${networkName} (chainId ${chainId})`);
console.log(`Deployer: ${deployer.address}`);

const registry = await ethers.deployContract("ProductWarrantyRegistry", [deployer.address]);
await registry.waitForDeployment();

const address = await registry.getAddress();
const deploymentBlock = await ethers.provider.getBlockNumber();

console.log(`\nProductWarrantyRegistry deployed to ${address}`);
console.log(`Mined in block ${deploymentBlock}`);
console.log(`Admin   : ${deployer.address} (DEFAULT_ADMIN_ROLE - grants every other role)`);

// ---------------------------------------------------------------------------
// Persist the deployment so other tooling can find it
// ---------------------------------------------------------------------------
const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsDir = join(contractsRoot, "deployments");
await mkdir(deploymentsDir, { recursive: true });

const deployment = {
  contract: "ProductWarrantyRegistry",
  networkName,
  chainId: chainId.toString(),
  address,
  deployer: deployer.address,
  deploymentBlock,
  deployedAt: new Date().toISOString(),
};

const outFile = join(deploymentsDir, `${networkName}.json`);
await writeFile(outFile, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

console.log(`\nDeployment record written to contracts/deployments/${networkName}.json`);
console.log("\nNext steps:");
console.log("  1. npm run seed:local   (local only: grant the demo roles + walk a full lifecycle)");
console.log("  2. npm run export:abi   (refresh the frontend ABI and address map)");
console.log(`  3. frontend/.env.local -> NEXT_PUBLIC_PRODUCT_WARRANTY_REGISTRY_ADDRESS=${address}`);
console.log("\nThe constructor only grants DEFAULT_ADMIN_ROLE. On a public network grant the");
console.log("supply-chain roles with: npx hardhat run scripts/grant-roles.ts --network sepolia");
