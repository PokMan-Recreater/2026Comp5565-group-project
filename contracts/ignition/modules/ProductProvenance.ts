import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Hardhat Ignition deployment module for the provenance registry.
 *
 * Run it with:
 *   npx hardhat ignition deploy ignition/modules/ProductProvenance.ts --network localhost
 *
 * The `initialOwner` parameter defaults to the first account of the target network,
 * but can be overridden at deploy time:
 *   npx hardhat ignition deploy ignition/modules/ProductProvenance.ts \
 *     --network sepolia --parameters '{"ProductProvenanceModule":{"initialOwner":"0x..."}}'
 */
export default buildModule("ProductProvenanceModule", (m) => {
  const initialOwner = m.getParameter("initialOwner", m.getAccount(0));

  const productProvenance = m.contract("ProductProvenance", [initialOwner]);

  return { productProvenance };
});
