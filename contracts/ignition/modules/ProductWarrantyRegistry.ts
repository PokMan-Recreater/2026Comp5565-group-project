import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Hardhat Ignition deployment module for the role-based warranty registry.
 *
 * Run it with:
 *   npx hardhat ignition deploy ignition/modules/ProductWarrantyRegistry.ts --network localhost
 *
 * The `initialAdmin` parameter defaults to the first account of the target network,
 * but can be overridden at deploy time:
 *   npx hardhat ignition deploy ignition/modules/ProductWarrantyRegistry.ts \
 *     --network sepolia --parameters '{"ProductWarrantyRegistryModule":{"initialAdmin":"0x..."}}'
 *
 * The constructor only grants `DEFAULT_ADMIN_ROLE`; grant the supply-chain roles
 * afterwards with `scripts/grant-roles.ts`.
 */
export default buildModule("ProductWarrantyRegistryModule", (m) => {
  const initialAdmin = m.getParameter("initialAdmin", m.getAccount(0));

  const productWarrantyRegistry = m.contract("ProductWarrantyRegistry", [initialAdmin]);

  return { productWarrantyRegistry };
});
