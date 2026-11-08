import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Populates a freshly deployed registry with a realistic demo lifecycle so the
 * frontend has something to show:
 *
 *   Manufacturer -> Retailer -> Customer -> (resale) -> Customer #2
 *   plus one warranty claim (submitted by the customer, resolved by the service
 *   centre) and one servicing action logged by the service centre.
 *
 * It also grants every supply-chain role, because the `ProductWarrantyRegistry`
 * constructor only grants `DEFAULT_ADMIN_ROLE`.
 *
 * Run it against a local node:
 *   npx hardhat node                                      # terminal 1
 *   npx hardhat run scripts/deploy.ts --network localhost  # terminal 2
 *   npx hardhat run scripts/seed-demo.ts --network localhost
 */
const { ethers, networkName } = await network.create();

const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentPath = join(contractsRoot, "deployments", `${networkName}.json`);

let address: string;
try {
  address = (JSON.parse(await readFile(deploymentPath, "utf8")) as { address: string }).address;
} catch {
  throw new Error(`No deployment record for "${networkName}". Run \`npm run deploy:local\` first.`);
}

const DAY = 24n * 60n * 60n;

// Account 0 is the deployer and therefore the DEFAULT_ADMIN_ROLE holder.
const [admin, retailer, customer, reseller, serviceCenter] = await ethers.getSigners();
const registry = await ethers.getContractAt("ProductWarrantyRegistry", address);

console.log(`Seeding demo data on "${networkName}" at ${address}`);
console.log(`  admin / manufacturer : ${admin.address}`);
console.log(`  retailer             : ${retailer.address}`);
console.log(`  customer             : ${customer.address}`);
console.log(`  reseller (customer)  : ${reseller.address}`);
console.log(`  service centre       : ${serviceCenter.address}\n`);

// 0. Roles ---------------------------------------------------------------
const ROLES = [
  { role: await registry.MANUFACTURER_ROLE(), account: admin.address, label: "MANUFACTURER_ROLE" },
  { role: await registry.RETAILER_ROLE(), account: retailer.address, label: "RETAILER_ROLE" },
  { role: await registry.CUSTOMER_ROLE(), account: customer.address, label: "CUSTOMER_ROLE" },
  { role: await registry.CUSTOMER_ROLE(), account: reseller.address, label: "CUSTOMER_ROLE" },
  { role: await registry.SERVICE_CENTER_ROLE(), account: serviceCenter.address, label: "SERVICE_CENTER_ROLE" },
];

for (const { role, account, label } of ROLES) {
  if (await registry.hasRole(role, account)) {
    console.log(`${label.padEnd(20)} ${account} (already granted)`);
    continue;
  }

  await (await registry.connect(admin).grantRole(role, account)).wait();
  console.log(`${label.padEnd(20)} ${account} granted`);
}

const MODEL = {
  brand: "Aurelia",
  modelName: "Chrono X1",
  modelNumber: "AX1-42",
  category: "Luxury smartwatch",
  metadataURI: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

const SERIAL = `DEMO-${Date.now()}`;
const DURATION = 730n * DAY;
const MAX_CLAIMS = 3;

// 1. Manufacture -------------------------------------------------------------
await (await registry.connect(admin).registerProduct(SERIAL, MODEL, DURATION, MAX_CLAIMS)).wait();

const productId = await registry.getProductIdBySerial(SERIAL);
console.log(`\nRegistered "${SERIAL}" as productId ${productId}`);

// 2. Ship to the retailer ----------------------------------------------------
await (await registry.connect(admin).transferToRetailer(productId, retailer.address, ethers.ZeroHash)).wait();
console.log("Manufacturer -> Retailer");

// 3. Retail sale -------------------------------------------------------------
await (await registry.connect(retailer).transferToCustomer(productId, customer.address, ethers.ZeroHash)).wait();
console.log("Retailer -> Customer");

// 4. Warranty claim, resolved by the service centre --------------------------
await (await registry.connect(customer).submitWarrantyClaim(productId, "Screen flickers at low brightness")).wait();
await (
  await registry
    .connect(serviceCenter)
    .resolveWarrantyClaim(productId, 0n, true, "Replacement unit shipped under warranty")
).wait();
console.log("Customer filed claim #0, service centre approved it");

// 5. Servicing action logged by the service centre ---------------------------
await (
  await registry.connect(serviceCenter).logServiceAction(productId, "Replaced display module", ethers.ZeroHash)
).wait();
console.log("Service centre logged a servicing action");

// 6. Secondary resale --------------------------------------------------------
await (await registry.connect(customer).transferOwnership(productId, reseller.address, ethers.ZeroHash)).wait();
console.log("Customer -> Customer (resale); the remaining warranty travels with the unit");

// Summary --------------------------------------------------------------------
const product = await registry.getProduct(productId);
const history = await registry.getOwnershipHistory(productId);
const claims = await registry.getWarrantyClaims(productId);
const serviceLog = await registry.getServiceLog(productId);

console.log(`\nProduct  : ${product.serialNumber} (${product.model.brand} ${product.model.modelName})`);
console.log(`Owner    : ${product.currentOwner}`);
console.log(`Warranty : status ${product.warranty.status} (0 none / 1 active / 2 expired / 3 void)`);
console.log(`Claims   : ${product.warranty.claimCount}/${product.warranty.maxClaims}`);
console.log(`History  : ${history.length} hops`);
for (const [index, record] of history.entries()) {
  console.log(`  ${index}: ${record.from} -> ${record.to} (role ${record.toRole}, reason ${record.reason})`);
}
console.log(`Claims   : ${claims.length}`);
for (const claim of claims) {
  console.log(`  #${claim.claimId}: status ${claim.status} - ${claim.description}`);
}
console.log(`Service  : ${serviceLog.length} entr${serviceLog.length === 1 ? "y" : "ies"}`);
for (const record of serviceLog) {
  console.log(`  #${record.recordId}: ${record.action} by ${record.serviceCenter}`);
}

console.log("\nFrontend tip: import one of the Hardhat accounts into MetaMask to act as a role.");
console.log(`  productId ${productId}, serial ${SERIAL}`);
