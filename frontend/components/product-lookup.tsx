"use client";

import { useState, type FormEvent } from "react";
import { useConnection, useReadContract } from "wagmi";

import {
  CLAIM_STATUS,
  PARTY_ROLE,
  PRODUCT_STATUS,
  TRANSFER_REASON,
  ZERO_HASH,
  label,
  productWarrantyRegistryAbi as registryAbi,
} from "@/lib/contracts";
import { formatDuration, formatTimestamp, shortAddress } from "@/lib/format";
import { useProductDetail, useRegistryAddress, useRegistryWrite, useRoles } from "@/lib/use-registry";

import { BUTTON_CLASS, Field, INPUT_CLASS, Row, StatusChip, TxFeedback, WarrantyChip } from "./ui";

/**
 * Serial-number search box. It first resolves the serial number to a `productId`,
 * then hands that id to {@link ProductDetails} for the heavier reads.
 */
export function ProductLookup() {
  const registry = useRegistryAddress();
  const [serialInput, setSerialInput] = useState("");
  const [serial, setSerial] = useState("");

  const idQuery = useReadContract({
    address: registry,
    abi: registryAbi,
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
          placeholder="Enter a serial number, e.g. AX1-42-0001"
          aria-label="Serial number"
          className={INPUT_CLASS}
        />
        <button type="submit" className={`shrink-0 ${BUTTON_CLASS}`}>
          Look up
        </button>
      </form>

      {idQuery.isLoading && <p className="text-sm text-slate-500">Reading the registry...</p>}
      {idQuery.error !== null && <p className="text-sm text-rose-600">{idQuery.error.message}</p>}
      {notFound && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No product is registered with the serial number &quot;{serial}&quot;. It is either not registered yet or not
          authentic.
        </p>
      )}

      {productId !== undefined && <ProductDetails productId={productId} />}
    </div>
  );
}

/** Reads the product record, its chain of custody, warranty claims and service log. */
function ProductDetails({ productId }: { productId: bigint }) {
  const { product, history, claims, serviceLog, warrantyStatus, remainingClaims, isLoading } =
    useProductDetail(productId);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading product #{productId.toString()}...</p>;
  }

  if (product === undefined) {
    return <p className="text-sm text-rose-600">Could not load product #{productId.toString()}.</p>;
  }

  const unlimited = product.warranty.maxClaims === 0;

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
          <div className="flex flex-wrap items-center gap-2">
            <WarrantyChip status={warrantyStatus} />
            <StatusChip tone="bg-slate-100 text-slate-600">{label(PRODUCT_STATUS, product.status)}</StatusChip>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <Row label="Authenticity" value="Registered on-chain by its manufacturer" />
          <Row label="Model number" value={product.model.modelNumber} />
          <Row label="Category" value={product.model.category.length > 0 ? product.model.category : "-"} />
          <Row label="Manufacturer" value={shortAddress(product.manufacturer)} mono />
          <Row label="Current owner" value={shortAddress(product.currentOwner)} mono />
          <Row label="Registered at" value={formatTimestamp(product.createdAt)} />
          <Row label="Warranty started" value={formatTimestamp(product.warranty.startDate)} />
          <Row label="Warranty expires" value={formatTimestamp(product.warranty.expirationDate)} />
          <Row
            label="Claims used"
            value={`${product.warranty.claimCount} / ${unlimited ? "unlimited" : product.warranty.maxClaims}`}
          />
          <Row label="Claims left" value={remainingClaims >= 2n ** 200n ? "unlimited" : remainingClaims.toString()} />
          <Row label="Duration" value={formatDuration(product.warranty.expirationDate - product.warranty.startDate)} />
        </dl>

        {product.model.metadataURI.length > 0 && (
          <p className="mt-4 text-xs break-all text-slate-500">
            Metadata: <span className="font-mono">{product.model.metadataURI}</span>
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Chain of custody</h3>
        <p className="mt-1 text-sm text-slate-600">
          Append-only history: every hand-over is a block, not a database row.
        </p>
        <ol className="mt-4 space-y-3">
          {history.map((record, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-slate-800">
                  {shortAddress(record.from)} &rarr; <span className="font-mono">{shortAddress(record.to)}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {label(PARTY_ROLE, record.toRole)} &middot; {label(TRANSFER_REASON, record.reason)} &middot;{" "}
                  {formatTimestamp(record.transferredAt)}
                </p>
                {record.evidenceHash !== ZERO_HASH && (
                  <p className="text-xs break-all text-slate-400">evidence {record.evidenceHash}</p>
                )}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">Claim #{claim.claimId.toString()}</p>
                  <StatusChip
                    tone={
                      claim.status === 1
                        ? "bg-emerald-50 text-emerald-700"
                        : claim.status === 2
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-800"
                    }
                  >
                    {label(CLAIM_STATUS, claim.status)}
                  </StatusChip>
                </div>
                <p className="mt-1 text-slate-600">{claim.description}</p>
                {claim.resolution.length > 0 && (
                  <p className="text-xs text-slate-500">Resolution: {claim.resolution}</p>
                )}
                <p className="mt-1 text-xs text-slate-400">
                  Filed {formatTimestamp(claim.filedAt)} by{" "}
                  <span className="font-mono">{shortAddress(claim.claimant)}</span>
                  {claim.resolvedAt > 0n && ` · resolved ${formatTimestamp(claim.resolvedAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}

        <ClaimForm productId={productId} currentOwner={product.currentOwner} remainingClaims={remainingClaims} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-base font-semibold text-slate-900">Servicing log</h3>
        {serviceLog.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No servicing actions have been logged for this unit.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {serviceLog.map((record) => (
              <li key={record.recordId.toString()} className="rounded-lg border border-slate-200 p-4 text-sm">
                <p className="font-medium text-slate-800">{record.action}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatTimestamp(record.loggedAt)} by{" "}
                  <span className="font-mono">{shortAddress(record.serviceCenter)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Lets the current owner file a warranty claim.
 *
 * The contract asks for two conditions at once: `CUSTOMER_ROLE` and current
 * ownership. Every submission burns a claim slot, and the warranty expires the
 * moment the last slot is consumed - which is why the slot counter is shown.
 */
function ClaimForm({
  productId,
  currentOwner,
  remainingClaims,
}: {
  productId: bigint;
  currentOwner: `0x${string}`;
  remainingClaims: bigint;
}) {
  const registry = useRegistryAddress();
  const connection = useConnection();
  const { roles } = useRoles();
  const [description, setDescription] = useState("");
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  const isOwner = connection.address?.toLowerCase() === currentOwner.toLowerCase();
  const canClaim = connection.isConnected && isOwner && roles.customer;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    write({
      address: registry,
      abi: registryAbi,
      functionName: "submitWarrantyClaim",
      args: [productId, description],
    });
  }

  if (!canClaim) {
    return (
      <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
        Only the current owner ({shortAddress(currentOwner)}) holding <code className="font-mono">CUSTOMER_ROLE</code>{" "}
        can file a claim.
        {connection.isConnected &&
          isOwner &&
          !roles.customer &&
          " This wallet owns the unit but holds no customer role."}
      </p>
    );
  }

  if (remainingClaims === 0n) {
    return (
      <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
        This warranty has no claims left - it expired when the last slot was used.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-3 border-t border-slate-100 pt-5">
      <Field label="File a warranty claim" hint="Every submission consumes a claim slot, approved or not.">
        <textarea
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="Describe the fault..."
          className={INPUT_CLASS}
        />
      </Field>
      <button type="submit" disabled={isPending || isConfirming} className={BUTTON_CLASS}>
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Submit claim"}
      </button>
      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Claim filed"
      />
    </form>
  );
}
