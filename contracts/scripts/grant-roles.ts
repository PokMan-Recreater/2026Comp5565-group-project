import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Grants supply-chain roles on an already deployed registry.
 *
 *   npx hardhat run scripts/grant-roles.ts --network sepolia
 *
 * The constructor only grants `DEFAULT_ADMIN_ROLE`, so every other role has to be
 * handed out explicitly. The accounts are read from `contracts/.env` (see
 * `.env.example`), as comma separated address lists:
 *
 *   MANUFACTURER_ADDRESSES=0xabc...,0xdef...
 *   RETAILER_ADDRESSES=0xabc...
 *   CUSTOMER_ADDRESSES=0xabc...,0xdef...
 *   SERVICE_CENTER_ADDRESSES=0xabc...
 *
 * The caller must hold `DEFAULT_ADMIN_ROLE`, i.e. be the deployer (or an account it
 * promoted). On `localhost` prefer `npm run seed:local`, which grants the roles to the
 * demo accounts automatically.
 */
const { ethers, networkName } = await network.create();

const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentPath = join(contractsRoot, "deployments", `${networkName}.json`);

let address: string;
try {
  address = (JSON.parse(await readFile(deploymentPath, "utf8")) as { address: string }).address;
} catch {
  throw new Error(`No deployment record for "${networkName}". Run \`npm run deploy\` first.`);
}

const registry = await ethers.getContractAt("ProductWarrantyRegistry", address);
const [admin] = await ethers.getSigners();

/** Env var -> the role constant on the contract. */
const TARGETS = [
  { env: "MANUFACTURER_ADDRESSES", roleName: "MANUFACTURER_ROLE" },
  { env: "RETAILER_ADDRESSES", roleName: "RETAILER_ROLE" },
  { env: "CUSTOMER_ADDRESSES", roleName: "CUSTOMER_ROLE" },
  { env: "SERVICE_CENTER_ADDRESSES", roleName: "SERVICE_CENTER_ROLE" },
] as const;

function addressesFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

console.log(`Network : ${networkName}`);
console.log(`Registry: ${address}`);
console.log(`Admin   : ${admin.address}\n`);

let granted = 0;

for (const target of TARGETS) {
  const accounts = addressesFromEnv(target.env);
  if (accounts.length === 0) continue;

  const role = await registry[target.roleName]();

  for (const account of accounts) {
    if (await registry.hasRole(role, account)) {
      console.log(`${target.roleName.padEnd(20)} ${account} (already granted)`);
      continue;
    }

    await (await registry.grantRole(role, account)).wait();
    granted += 1;
    console.log(`${target.roleName.padEnd(20)} ${account} granted`);
  }
}

console.log(granted === 0 ? "\nNothing to do." : `\nGranted ${granted} role assignment(s).`);
console.log("Note: a customer must hold CUSTOMER_ROLE before it can resell or file a claim.");
