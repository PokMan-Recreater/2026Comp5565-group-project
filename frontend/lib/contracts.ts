import deployedContracts from "./deployed-contracts.json";
import { productProvenanceAbi } from "./abi/ProductProvenance";

export { productProvenanceAbi };

/** Chain ids the dApp knows about. */
export const CHAIN_IDS = {
  hardhatLocal: 31337,
  sepolia: 11155111,
} as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

type DeploymentRecord = { address: string; chainId: string; networkName: string };
type AddressMap = Record<string, DeploymentRecord>;

/** The chain the UI defaults to. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_IDS.hardhatLocal);

/**
 * Resolves the deployed registry address for a chain.
 *
 * 1. `NEXT_PUBLIC_PRODUCT_PROVENANCE_ADDRESS` (see `.env.local.example`) wins.
 * 2. Otherwise the address recorded by `npm run export:abi` is used.
 * 3. Falls back to the zero address so the app still renders before deployment.
 */
export function getProductProvenanceAddress(chainId: number = DEFAULT_CHAIN_ID): `0x${string}` {
  const fromEnv = process.env.NEXT_PUBLIC_PRODUCT_PROVENANCE_ADDRESS;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim() as `0x${string}`;
  }

  const forContract = (deployedContracts as Record<string, AddressMap>).ProductProvenance;
  const recorded = forContract?.[String(chainId)];
  if (recorded !== undefined) {
    return recorded.address as `0x${string}`;
  }

  return ZERO_ADDRESS;
}

/** True when an address was configured, i.e. the UI can talk to a real deployment. */
export function hasDeployment(chainId: number = DEFAULT_CHAIN_ID): boolean {
  return getProductProvenanceAddress(chainId) !== ZERO_ADDRESS;
}

/**
 * Enum values mirrored from the Solidity contract, so components can render
 * human readable labels instead of raw numbers. The keys are strings because
 * ABI decoders may hand back either `number` or `bigint`.
 */
export const PARTY_ROLE: Record<string, string> = {
  "0": "Unknown",
  "1": "Manufacturer",
  "2": "Retailer",
  "3": "Customer",
  "4": "Reseller",
  "5": "Service centre",
};

export const PRODUCT_STATUS: Record<string, string> = {
  "0": "Not registered",
  "1": "Registered",
  "2": "In transit",
  "3": "Sold",
  "4": "Recalled",
};

export const TRANSFER_REASON: Record<string, string> = {
  "0": "Manufactured",
  "1": "Distribution",
  "2": "Retail sale",
  "3": "Resale",
  "4": "Return",
  "5": "Servicing",
  "6": "Recall",
};

export const CLAIM_STATUS: Record<string, string> = {
  "0": "Pending",
  "1": "Approved",
  "2": "Rejected",
};

/** Looks a value up in one of the label maps above, falling back to the raw value. */
export function label(map: Record<string, string>, value: number | bigint | undefined): string {
  if (value === undefined) return "-";
  return map[String(value)] ?? String(value);
}
