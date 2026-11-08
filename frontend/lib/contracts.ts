import { keccak256, toHex } from "viem";

import deployedContracts from "./deployed-contracts.json";
import { productWarrantyRegistryAbi } from "./abi/ProductWarrantyRegistry";

export { productWarrantyRegistryAbi };

/** Chain ids the dApp knows about. */
export const CHAIN_IDS = {
  hardhatLocal: 31337,
  sepolia: 11155111,
} as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** `bytes32(0)` means "no off-chain evidence attached". */
export const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

type DeploymentRecord = { address: string; chainId: string; networkName: string };
type AddressMap = Record<string, DeploymentRecord>;

/** The chain the UI defaults to. */
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_IDS.hardhatLocal);

/**
 * Resolves the deployed `ProductWarrantyRegistry` address for a chain.
 *
 * 1. `NEXT_PUBLIC_PRODUCT_WARRANTY_REGISTRY_ADDRESS` (see `.env.local.example`) wins.
 * 2. `NEXT_PUBLIC_PRODUCT_PROVENANCE_ADDRESS` is accepted as a legacy alias.
 * 3. Otherwise the address recorded by `npm run export:abi` is used.
 * 4. Falls back to the zero address so the app still renders before deployment.
 */
export function getRegistryAddress(chainId: number = DEFAULT_CHAIN_ID): `0x${string}` {
  const fromEnv =
    process.env.NEXT_PUBLIC_PRODUCT_WARRANTY_REGISTRY_ADDRESS ?? process.env.NEXT_PUBLIC_PRODUCT_PROVENANCE_ADDRESS;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim() as `0x${string}`;
  }

  const forContract = (deployedContracts as Record<string, AddressMap>).ProductWarrantyRegistry;
  const recorded = forContract?.[String(chainId)];
  if (recorded !== undefined) {
    return recorded.address as `0x${string}`;
  }

  return ZERO_ADDRESS;
}

/** True when an address was configured, i.e. the UI can talk to a real deployment. */
export function hasDeployment(chainId: number = DEFAULT_CHAIN_ID): boolean {
  return getRegistryAddress(chainId) !== ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// Roles (OpenZeppelin AccessControl: role id == keccak256 of the role name)
// ---------------------------------------------------------------------------

export const ROLE_HASH = {
  admin: keccak256(toHex("DEFAULT_ADMIN_ROLE")),
  manufacturer: keccak256(toHex("MANUFACTURER_ROLE")),
  retailer: keccak256(toHex("RETAILER_ROLE")),
  customer: keccak256(toHex("CUSTOMER_ROLE")),
  serviceCenter: keccak256(toHex("SERVICE_CENTER_ROLE")),
} as const;

export type RoleName = keyof typeof ROLE_HASH;

export const ROLE_LABEL: Record<RoleName, string> = {
  admin: "Registry admin",
  manufacturer: "Manufacturer",
  retailer: "Retailer",
  customer: "Customer",
  serviceCenter: "Service centre",
};

// ---------------------------------------------------------------------------
// Enums, mirrored from the Solidity contract so components can render labels
// instead of raw numbers. Keys are strings because ABI decoders may hand back
// either `number` or `bigint`.
// ---------------------------------------------------------------------------

export const PARTY_ROLE: Record<string, string> = {
  "0": "Unknown",
  "1": "Manufacturer",
  "2": "Retailer",
  "3": "Customer",
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
  "4": "Recall",
};

export const CLAIM_STATUS: Record<string, string> = {
  "0": "Pending",
  "1": "Approved",
  "2": "Rejected",
};

export const WARRANTY_STATUS: Record<string, string> = {
  "0": "No warranty",
  "1": "Active",
  "2": "Expired",
  "3": "Void",
};

export const EXPIRATION_REASON: Record<string, string> = {
  "0": "Duration elapsed",
  "1": "Claim limit reached",
};

/** Looks a value up in one of the label maps above, falling back to the raw value. */
export function label(map: Record<string, string>, value: number | bigint | undefined): string {
  if (value === undefined) return "-";
  return map[String(value)] ?? String(value);
}

/**
 * Hashes a free-text evidence note (invoice number, job sheet, photo caption...)
 * so only the 32 byte digest ever reaches the chain. An empty note means
 * "no evidence attached" and maps to `bytes32(0)`.
 */
export function hashEvidence(note: string): `0x${string}` {
  const trimmed = note.trim();
  return trimmed.length === 0 ? ZERO_HASH : keccak256(toHex(trimmed));
}

// ---------------------------------------------------------------------------
// Struct shapes returned by the contract, used by the read hooks
// ---------------------------------------------------------------------------

export type ProductModelRecord = {
  brand: string;
  modelName: string;
  modelNumber: string;
  category: string;
  metadataURI: string;
};

export type WarrantyRecord = {
  startDate: bigint;
  expirationDate: bigint;
  maxClaims: number;
  claimCount: number;
  status: number;
};

export type ProductRecord = {
  id: bigint;
  serialNumber: string;
  model: ProductModelRecord;
  manufacturer: `0x${string}`;
  createdAt: bigint;
  status: number;
  currentOwner: `0x${string}`;
  warranty: WarrantyRecord;
};

export type OwnershipRecord = {
  from: `0x${string}`;
  to: `0x${string}`;
  toRole: number;
  reason: number;
  transferredAt: bigint;
  evidenceHash: string;
};

export type WarrantyClaimRecord = {
  claimId: bigint;
  claimant: `0x${string}`;
  filedAt: bigint;
  resolvedAt: bigint;
  status: number;
  description: string;
  resolution: string;
};

export type ServiceRecord = {
  recordId: bigint;
  serviceCenter: `0x${string}`;
  loggedAt: bigint;
  action: string;
  evidenceHash: string;
};
