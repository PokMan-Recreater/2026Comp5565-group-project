"use client";

import { useState, type FormEvent } from "react";
import { useConnection, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import {
  CLAIM_STATUS,
  PARTY_ROLE,
  PRODUCT_STATUS,
  TRANSFER_REASON,
  getProductProvenanceAddress,
  label,
  productProvenanceAbi,
} from "@/lib/contracts";
import { formatDuration, formatTimestamp, shortAddress } from "@/lib/format";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/**
 * Serial-number search box. It first resolves the serial number to a
 * `productId`, then hands that id to {@link ProductDetails} for the heavy reads.
 */
export function ProductLookup() {
  const connection = useConnection();
  const [serialInput, setSerialInput] = useState("");
  const [serial, setSerial] = useState("");

  const address = getProductProvenanceAddress(connection.chainId);

  const idQuery = useReadContract({
    address,
    abi: productProvenanceAbi,
    functionName: "getProductIdBySerial",
    args: [serial],
    query: { enabled: serial.length > 0 },
  });

  const productId = typeof idQuery.data === "bigint" && idQuery.data > 0n ? idQuery.data : undefined;
  const notFound = serial.length > 0 && idQuery.isSuccess && productId === undefined;

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSerial(serialInput.trim());
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={serialInput}
          onChange={(event) => setSerialInput(event.target.value)}
          placeholder="Enter a serial number, e.g. SW-1000-0001"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Look up
        </button>
      </form>

      {idQuery.isLoading && <p className="text-sm text-slate-500">Reading the registry...</p>}
      {idQuery.error !== null && <p className="text-sm text-rose-600">{idQuery.error.message}</p>}
      {notFound && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No product is registered with the serial number &quot;{serial}&quot;.
        </p>
      )}

      {productId !== undefined && <ProductDetails productId={productId} />}
    </div>
  );
}

/** Reads the product record, its chain of custody and its warranty claims. */
function ProductDetails({ productId }: { productId: bigint }) {
  const connection = useConnection();
  const address = getProductProvenanceAddress(connection.chainId);

  const productQuery = useReadContract({
    address,
    abi: productProvenanceAbi,
    functionName: "getProduct",
    args: [productId],
  });
  const historyQuery = useReadContract({
    address,
    abi: productProvenanceAbi,
    functionName: "getOwnershipHistory",
    args: [productId],
  });
  const claimsQuery = useReadContract({
    address,
    abi: productProvenanceAbi,
    functionName: "getWarrantyClaims",
    args: [productId],
  });
  const validQuery = useReadContract({
    address,
    abi: productProvenanceAbi,
    functionName: "isWarrantyValid",
    args: [productId],
  });

  if (productQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading product #{productId.toString()}...</p>;
  }

  if (productQuery.data === undefined) {
    return <p className="text-sm text-rose-600">Could not load product #{productId.toString()}.</p>;
  }

  const product = productQuery.data;
  const history = historyQuery.data ?? [];
  const claims = claimsQuery.data ?? [];
  const warrantyValid = validQuery.data === true;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {product.model.brand} {product.model.modelName}
            </h2>
            <p className="text-sm text-slate-500">
              #{productId.toString()} &middot; serial <span className="font-mono">{product.serialNumber}</span>
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              warrantyValid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {warrantyValid ? "Warranty valid" : "Warranty not valid"}
          </span>
        </div>

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <Row label="Model number" value={product.model.modelNumber} />
          <Row label="Category" value={product.model.category} />
          <Row label="Manufacturer" value={shortAddress(product.manufacturer)} mono />
          <Row label="Current owner" value={shortAddress(product.currentOwner)} mono />
          <Row label="Status" value={label(PRODUCT_STATUS, product.status)} />
          <Row label="Registered at" value={formatTimestamp(product.registeredAt)} />
          <Row label="Warranty duration" value={formatDuration(product.warrantyTerms.durationSeconds)} />
          <Row label="Warranty expires" value={formatTimestamp(product.warranty.expirationTime)} />
          <Row
            label="Claims used"
            value={`${Number(product.warranty.claimsUsed)} / ${
              Number(product.warrantyTerms.maxClaims) === 0 ? "unlimited" : Number(product.warrantyTerms.maxClaims)
            }`}
          />
          <Row label="Warranty transferable" value={product.warrantyTerms.transferable ? "yes" : "no"} />
        </dl>

        {product.model.metadataURI.length > 0 && (
          <p className="mt-4 text-xs break-all text-slate-500">
            Metadata: <span className="font-mono">{product.model.metadataURI}</span>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Chain of custody</h3>
        <ol className="mt-4 space-y-3">
          {history.map((record, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-slate-800">
                  {label(PARTY_ROLE, record.role)} &middot;{" "}
                  <span className="font-mono">{shortAddress(record.owner)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {label(TRANSFER_REASON, record.reason)} &middot; {formatTimestamp(record.transferredAt)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Warranty claims</h3>
        {claims.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No claims have been filed for this unit.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {claims.map((claim) => (
              <li key={claim.claimId.toString()} className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="font-medium text-slate-800">
                  Claim #{claim.claimId.toString()} &middot; {label(CLAIM_STATUS, claim.status)}
                </p>
                <p className="text-slate-600">{claim.description}</p>
                {claim.resolution.length > 0 && (
                  <p className="text-xs text-slate-500">Resolution: {claim.resolution}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Filed {formatTimestamp(claim.filedAt)} by{" "}
                  <span className="font-mono">{shortAddress(claim.claimant)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}

        <ClaimForm productId={productId} currentOwner={product.currentOwner} />
      </section>
    </div>
  );
}

function Row({ label: name, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-400 uppercase">{name}</dt>
      <dd className={mono === true ? "font-mono text-slate-800" : "text-slate-800"}>{value}</dd>
    </div>
  );
}

/** Lets the current owner file a warranty claim against the unit. */
function ClaimForm({ productId, currentOwner }: { productId: bigint; currentOwner: string }) {
  const connection = useConnection();
  const [description, setDescription] = useState("");

  const { mutate: writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const isOwner = connection.isConnected && connection.address?.toLowerCase() === currentOwner.toLowerCase();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    writeContract({
      address: getProductProvenanceAddress(connection.chainId),
      abi: productProvenanceAbi,
      functionName: "fileWarrantyClaim",
      args: [productId, description, ZERO_HASH],
    });
  }

  if (!isOwner) {
    return (
      <p className="mt-4 text-xs text-slate-500">
        Only the current owner ({shortAddress(currentOwner)}) can file a warranty claim.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-3 border-t border-slate-100 pt-5">
      <span className="block text-sm font-medium text-slate-700">File a warranty claim</span>
      <textarea
        required
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={3}
        placeholder="Describe the fault..."
        className={INPUT_CLASS}
      />
      <button
        type="submit"
        disabled={isPending || receipt.isLoading}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {isPending ? "Waiting for wallet..." : receipt.isLoading ? "Mining..." : "Submit claim"}
      </button>
      {error !== null && <p className="text-sm text-rose-600">{error.message}</p>}
      {receipt.isSuccess && <p className="text-sm text-emerald-700">Claim filed in {hash}.</p>}
    </form>
  );
}
