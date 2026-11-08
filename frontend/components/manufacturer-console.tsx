"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useConnection } from "wagmi";

import { PRODUCT_STATUS, label, productWarrantyRegistryAbi as registryAbi } from "@/lib/contracts";
import { formatTimestamp, shortAddress } from "@/lib/format";
import { useProductList, useRegistryAddress, useRegistryWrite, useRoles } from "@/lib/use-registry";

import { BUTTON_CLASS, BUTTON_GHOST_CLASS, Field, INPUT_CLASS, TxFeedback, WarrantyChip } from "./ui";

/**
 * Manufacturer console: a "my units" dashboard plus the two administrative levers
 * the contract gives the manufacturer *of record* (`voidWarranty`, `recallProduct`)
 * and the public status refresh (`syncWarrantyStatus`).
 *
 * The dashboard is built from `totalProducts()` + `getProduct(i)`; a production
 * deployment would index the `ProductRegistered` event instead.
 */
export function ManufacturerConsole() {
  const connection = useConnection();
  const { roles, isLoading: isLoadingRoles } = useRoles();
  const { rows, isLoading } = useProductList();
  const [selectedId, setSelectedId] = useState("");

  const mine = useMemo(() => {
    if (connection.address === undefined) return [];
    return rows.filter((row) => row.product.manufacturer.toLowerCase() === connection.address?.toLowerCase());
  }, [rows, connection.address]);

  const selected = mine.find((row) => row.id.toString() === selectedId);

  if (!connection.isConnected) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Connect the manufacturer wallet to see the units it registered.
      </p>
    );
  }

  if (!isLoadingRoles && !roles.manufacturer) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This wallet does not hold <code className="font-mono">MANUFACTURER_ROLE</code>. Registration, voiding and
        recalls all require it.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">My units</h2>
          <p className="text-xs text-slate-500">
            {isLoading ? "Reading the registry..." : `${mine.length} of ${rows.length} registered unit(s)`}
          </p>
        </div>

        {mine.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            This wallet has not registered a unit yet. Use the <span className="font-medium">Register</span> page.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">#</th>
                  <th className="py-2 pr-4 font-medium">Serial</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Warranty</th>
                  <th className="py-2 pr-4 font-medium">Claims</th>
                  <th className="py-2 pr-4 font-medium">Owner</th>
                  <th className="py-2 pr-4 font-medium">Registered</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {mine.map((row) => (
                  <tr key={row.id.toString()} className="border-t border-slate-100">
                    <td className="py-2 pr-4 text-slate-500">{row.id.toString()}</td>
                    <td className="py-2 pr-4 font-mono text-slate-800">{row.product.serialNumber}</td>
                    <td className="py-2 pr-4 text-slate-700">
                      {row.product.model.brand} {row.product.model.modelName}
                    </td>
                    <td className="py-2 pr-4 text-slate-700">{label(PRODUCT_STATUS, row.product.status)}</td>
                    <td className="py-2 pr-4">
                      <WarrantyChip status={row.warrantyStatus} />
                    </td>
                    <td className="py-2 pr-4 text-slate-700">
                      {row.product.warranty.claimCount}/
                      {row.product.warranty.maxClaims === 0 ? "∞" : row.product.warranty.maxClaims}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-500">{shortAddress(row.product.currentOwner)}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatTimestamp(row.product.createdAt)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id.toString())}
                        className={BUTTON_GHOST_CLASS}
                      >
                        {selectedId === row.id.toString() ? "Selected" : "Manage"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected !== undefined && (
        <section className="grid gap-6 sm:grid-cols-2">
          <VoidWarrantyForm productId={selected.id} />
          <RecallForm productId={selected.id} />
          <SyncStatusPanel productId={selected.id} />
        </section>
      )}
    </div>
  );
}

/** `voidWarranty` - kills the remaining warranty without recalling the unit. */
function VoidWarrantyForm({ productId }: { productId: bigint }) {
  const registry = useRegistryAddress();
  const [reason, setReason] = useState("");
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    write({ address: registry, abi: registryAbi, functionName: "voidWarranty", args: [productId, reason.trim()] });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-900">Void the warranty</h3>
      <p className="text-xs text-slate-600">
        Use for abuse, a missing serial or a goodwill decision. Reversible only by re-registering the unit, so the
        contract rejects a second voiding.
      </p>
      <Field label="Reason">
        <input
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Liquid damage"
          className={INPUT_CLASS}
        />
      </Field>
      <button type="submit" disabled={isPending || isConfirming} className={BUTTON_CLASS}>
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Void warranty"}
      </button>
      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Warranty voided"
      />
    </form>
  );
}

/** `recallProduct` - marks the unit recalled (no further transfers) and voids the warranty. */
function RecallForm({ productId }: { productId: bigint }) {
  const registry = useRegistryAddress();
  const [reason, setReason] = useState("");
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    write({ address: registry, abi: registryAbi, functionName: "recallProduct", args: [productId, reason.trim()] });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-900">Recall the unit</h3>
      <p className="text-xs text-slate-600">
        Marks the unit <span className="font-medium">Recalled</span> and voids the warranty. Once recalled the unit can
        no longer change hands, which is what stops a dangerous product from being resold.
      </p>
      <Field label="Reason">
        <input
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Battery fire hazard"
          className={INPUT_CLASS}
        />
      </Field>
      <button
        type="submit"
        disabled={isPending || isConfirming}
        className={`${BUTTON_CLASS} bg-rose-600 hover:bg-rose-700`}
      >
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Recall unit"}
      </button>
      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Unit recalled"
      />
    </form>
  );
}

/**
 * `syncWarrantyStatus` - persists an expiry that already happened.
 *
 * The read views derive expiry from the clock, so this is only needed to make the
 * stored status (and the `WarrantyExpired` event indexers listen to) match reality.
 */
function SyncStatusPanel({ productId }: { productId: bigint }) {
  const registry = useRegistryAddress();
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-900">Refresh the stored warranty status</h3>
      <p className="text-xs text-slate-600">
        Anyone may call this. It writes <span className="font-medium">Expired</span> into storage when the duration
        elapsed or the claim limit was reached, and emits <code className="font-mono">WarrantyExpired</code>.
      </p>
      <button
        type="button"
        disabled={isPending || isConfirming}
        onClick={() =>
          write({ address: registry, abi: registryAbi, functionName: "syncWarrantyStatus", args: [productId] })
        }
        className={BUTTON_GHOST_CLASS}
      >
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Sync status"}
      </button>
      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Status synced"
      />
    </div>
  );
}
