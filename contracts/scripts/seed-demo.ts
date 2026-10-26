import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

/**
 * Populates a freshly deployed registry with a realistic demo lifecycle so the
 * frontend has something to show:
 *
 *   Manufacturer -> Retailer -> Customer -> (non-transferable) Resale -> Customer #2
 *   plus one warranty claim that the manufacturer approves.
 *
 * Run it against a local node:
 *   npx hardhat node                                     # terminal 1
 *   npx hardhat run scripts/deploy.ts --network localhost # terminal 2
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

/** Mirrors the Solidity enums. */
const Role = { Manufacturer: 1n, Retailer: 2n, Customer: 3n, Reseller: 4n } as const;
const Reason = { Manufactured: 0n, Distribution: 1n, RetailSale: 2n, Resale: 3n } as const;

// Account 0 is the deployer and therefore the first authorised manufacturer.
const [manufacturer, retailer, customer, reseller] = await ethers.getSigners();
const provenance = await ethers.getContractAt("ProductProvenance", address);

console.log(`Seeding demo data on "${networkName}" at ${address}`);
console.log(`  manufacturer: ${manufacturer.address}`);
console.log(`  retailer    : ${retailer.address}`);
console.log(`  customer    : ${customer.address}`);
console.log(`  reseller    : ${reseller.address}\n`);

const MODEL = {
  brand: "Acme",
  modelName: "SuperWidget",
  modelNumber: "SW-1000",
  category: "Home appliance",
  metadataURI: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

const TERMS = {
  durationSeconds: 730n * DAY,
  maxClaims: 2,
  transferable: false,
};

const SERIAL = `DEMO-${Date.now()}`;

// 1. Manufacture -------------------------------------------------------------
await (await provenance.connect(manufacturer).registerProduct(SERIAL, MODEL, TERMS, ethers.ZeroHash)).wait();

const productId = await provenance.getProductIdBySerial(SERIAL);
console.log(`Registered "${SERIAL}" as productId ${productId}`);

// 2. Ship to the retailer ----------------------------------------------------
await (
  await provenance
    .connect(manufacturer)
    .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ethers.ZeroHash)
).wait();
console.log("Manufacturer -> Retailer");

// 3. Retail sale -------------------------------------------------------------
await (
  await provenance
    .connect(retailer)
    .transferProductOwnership(productId, customer.address, Role.Customer, Reason.RetailSale, ethers.ZeroHash)
).wait();
console.log("Retailer -> Customer");

// 4. Warranty claim ----------------------------------------------------------
await (await provenance.connect(customer).fileWarrantyClaim(productId, "Screen flickers", ethers.ZeroHash)).wait();
await (
  await provenance.connect(manufacturer).resolveWarrantyClaim(productId, 0n, true, "Replacement unit shipped")
).wait();
console.log("Customer filed claim #0, manufacturer approved it");

// 5. Customer resale (voids the non-transferable warranty) -------------------
await (
  await provenance
    .connect(customer)
    .transferProductOwnership(productId, reseller.address, Role.Reseller, Reason.Resale, ethers.ZeroHash)
).wait();
console.log("Customer -> Reseller (non-transferable warranty is now void)");

// Summary --------------------------------------------------------------------
const product = await provenance.getProduct(productId);
const history = await provenance.getOwnershipHistory(productId);

console.log(`\nProduct  : ${product.serialNumber} (${product.model.brand} ${product.model.modelName})`);
console.log(`Owner    : ${product.currentOwner}`);
console.log(
  `Warranty : ${(await provenance.isWarrantyValid(productId)) ? "valid" : "invalid"} (voided: ${product.warranty.voided})`,
);
console.log(`Claims   : ${product.warranty.claimsUsed}/${product.warrantyTerms.maxClaims}`);
console.log(`History  : ${history.length} hops`);
for (const [index, record] of history.entries()) {
  console.log(`  ${index}: ${record.owner} (role ${record.role}, reason ${record.reason})`);
}
