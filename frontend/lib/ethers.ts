import { BrowserProvider, Contract, JsonRpcProvider, type Eip1193Provider, type Provider } from "ethers";

import productProvenanceArtifact from "./abi/ProductProvenance.json";
import { DEFAULT_CHAIN_ID, getProductProvenanceAddress } from "./contracts";

const LOCAL_RPC_URL = "http://127.0.0.1:8545";

/** Plain JSON ABI, which is the shape ethers.js expects. */
export const productProvenanceAbiJson = productProvenanceArtifact.abi;

/**
 * Read-only provider that works without a wallet. Useful for server components,
 * scripts and "browse the registry without connecting" flows.
 */
export function getReadOnlyProvider(): Provider {
  return new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL ?? LOCAL_RPC_URL);
}

/**
 * Provider backed by the wallet injected into the page (MetaMask, Rabby, ...).
 * Returns `undefined` when running on the server or when no wallet is present.
 */
export function getBrowserProvider(): BrowserProvider | undefined {
  if (typeof window === "undefined") return undefined;

  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (injected === undefined) return undefined;

  return new BrowserProvider(injected);
}

/** `ethers.Contract` for the registry, read-only unless a signer is passed in. */
export async function getProvenanceContract(options?: {
  signer?: Awaited<ReturnType<BrowserProvider["getSigner"]>>;
  chainId?: number;
}): Promise<Contract> {
  const chainId = options?.chainId ?? DEFAULT_CHAIN_ID;

  if (options?.signer !== undefined) {
    return new Contract(getProductProvenanceAddress(chainId), productProvenanceAbiJson, options.signer);
  }

  const browserProvider = getBrowserProvider();
  if (browserProvider !== undefined) {
    return new Contract(getProductProvenanceAddress(chainId), productProvenanceAbiJson, browserProvider);
  }

  return new Contract(getProductProvenanceAddress(chainId), productProvenanceAbiJson, getReadOnlyProvider());
}
