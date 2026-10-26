import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Deploys `ProductProvenance` to the network selected with `--network`.
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *
 * The deployment is recorded in `contracts/deployments/<network>.json`, which
 * `npm run export:abi` then copies into the frontend workspace.
 */
const { ethers, networkName } = await network.create();

const [deployer] = await ethers.getSigners();
const { chainId } = await ethers.provider.getNetwork();

console.log(`Network : ${networkName} (chainId ${chainId})`);
console.log(`Deployer: ${deployer.address}`);

const productProvenance = await ethers.deployContract("ProductProvenance", [deployer.address]);
await productProvenance.waitForDeployment();

const address = await productProvenance.getAddress();
const deploymentBlock = await ethers.provider.getBlockNumber();

console.log(`\nProductProvenance deployed to ${address}`);
console.log(`Mined in block ${deploymentBlock}`);

// ---------------------------------------------------------------------------
// Persist the deployment so other tooling can find it
// ---------------------------------------------------------------------------
const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsDir = join(contractsRoot, "deployments");
await mkdir(deploymentsDir, { recursive: true });

const deployment = {
  contract: "ProductProvenance",
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
console.log("  1. npm run export:abi   (refresh the frontend ABI and address map)");
console.log(`  2. frontend/.env.local -> NEXT_PUBLIC_PRODUCT_PROVENANCE_ADDRESS=${address}`);
