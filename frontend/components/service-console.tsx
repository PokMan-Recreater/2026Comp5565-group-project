"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useConnection } from "wagmi";

import {
  CLAIM_STATUS,
  PRODUCT_STATUS,
  hashEvidence,
  label,
  productWarrantyRegistryAbi as registryAbi,
} from "@/lib/contracts";
import { formatTimestamp, shortAddress } from "@/lib/format";
import { useProductDetail, useProductList, useRegistryAddress, useRegistryWrite, useRoles } from "@/lib/use-registry";

import {
  BUTTON_CLASS,
  BUTTON_GHOST_CLASS,
  EvidenceField,
  Field,
  INPUT_CLASS,
  StatusChip,
  TxFeedback,
  WarrantyChip,
  claimTone,
} from "./ui";

/**
 * Service-centre console: both halves of the role the specification asks for.
 *
 * 1. **Validate claims** - `resolveWarrantyClaim` approves or rejects a pending claim
 *    and stores the resolution note on-chain.
 * 2. **Log servicing actions** - `logServiceAction` appends a repair record to the
 *    unit's service log, independently of the warranty state.
 */
export function ServiceConsole() {
  const connection = useConnection();
  const { roles, isLoading: isLoadingRoles } = useRoles();
  const { rows, isLoading } = useProductList();
  const [selectedId, setSelectedId] = useState("");

  const selected = useMemo(() => rows.find((row) => row.id.toString() === selectedId), [rows, selectedId]);
  const detail = useProductDetail(selected?.id);
  const pendingClaims = detail.claims.filter((claim) => claim.status === 0);

  if (!connection.isConnected) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Connect the service-centre wallet. The console only writes through{" "}
        <code className="font-mono">SERVICE_CENTER_ROLE</code>.
      </p>
    );
  }

  if (!isLoadingRoles && !roles.serviceCenter) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This wallet does not hold <code className="font-mono">SERVICE_CENTER_ROLE</code>, so claims cannot be validated
        and servicing cannot be logged. The registry admin grants the role with{" "}
        <code className="font-mono">grantRole</code>.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <Field label="Unit" hint={isLoading ? "Reading the registry..." : `${rows.length} registered unit(s)`}>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className={INPUT_CLASS}>
            <option value="">Select a unit...</option>
            {rows.map((row) => (
              <option key={row.id.toString()} value={row.id.toString()}>
                #{row.id.toString()} · {row.product.serialNumber} · {row.product.model.brand}{" "}
                {row.product.model.modelName}
              </option>
            ))}
          </select>
        </Field>

        {selected !== undefined && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-slate-800">
                {selected.product.model.brand} {selected.product.model.modelName}
              </p>
              <p className="text-xs text-slate-500">
                Owner <span className="font-mono">{shortAddress(selected.product.currentOwner)}</span> &middot;{" "}
                {label(PRODUCT_STATUS, selected.product.status)} &middot; claims {selected.product.warranty.claimCount}/
                {selected.product.warranty.maxClaims === 0 ? "unlimited" : selected.product.warranty.maxClaims}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <WarrantyChip status={detail.warrantyStatus} />
              <StatusChip
                tone={pendingClaims.length > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}
              >
                {pendingClaims.length} pending
              </StatusChip>
            </div>
          </div>
        )}
      </section>

      {selected !== undefined && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">Warranty claims</h2>
          <p className="mt-1 text-sm text-slate-600">
            Approving or rejecting a claim is a permanent on-chain verdict. The claim slot is already consumed, so a
            rejection never gives the warranty a second life.
          </p>

          {detail.claims.length === 0 && <p className="mt-3 text-sm text-slate-500">No claims filed for this unit.</p>}

          <ul className="mt-4 space-y-3">
            {detail.claims.map((claim) => (
              <li key={claim.claimId.toString()} className="rounded-lg border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">Claim #{claim.claimId.toString()}</p>
                  <StatusChip tone={claimTone(claim.status)}>{label(CLAIM_STATUS, claim.status)}</StatusChip>
                </div>
                <p className="mt-1 text-slate-600">{claim.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Filed {formatTimestamp(claim.filedAt)} by{" "}
                  <span className="font-mono">{shortAddress(claim.claimant)}</span>
                </p>
                {claim.status === 0 ? (
                  <ResolveClaim productId={selected.id} claimId={claim.claimId} />
                ) : (
                  claim.resolution.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500">Resolution: {claim.resolution}</p>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected !== undefined && <ServiceLogForm productId={selected.id} />}
    </div>
  );
}

/** Approve / reject buttons plus a resolution note for one pending claim. */
function ResolveClaim({ productId, claimId }: { productId: bigint; claimId: bigint }) {
  const registry = useRegistryAddress();
  const [resolution, setResolution] = useState("");
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  function resolve(approved: boolean) {
    write({
      address: registry,
      abi: registryAbi,
      functionName: "resolveWarrantyClaim",
      args: [productId, claimId, approved, resolution.trim()],
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <Field label="Resolution note" hint="Stored on-chain, visible to the customer and the manufacturer.">
        <input
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          placeholder="Replacement unit shipped"
          className={INPUT_CLASS}
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => resolve(true)}
          disabled={isPending || isConfirming}
          className={BUTTON_CLASS}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => resolve(false)}
          disabled={isPending || isConfirming}
          className={BUTTON_GHOST_CLASS}
        >
          Reject
        </button>
      </div>
      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Claim resolved"
      />
    </div>
  );
}

/** Appends a servicing action to the unit's service log. */
function ServiceLogForm({ productId }: { productId: bigint }) {
  const registry = useRegistryAddress();
  const [action, setAction] = useState("");
  const [note, setNote] = useState("");
  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    write({
      address: registry,
      abi: registryAbi,
      functionName: "logServiceAction",
      args: [productId, action.trim(), hashEvidence(note)],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">Log a servicing action</h2>
      <p className="text-sm text-slate-600">
        Records what was done without touching the warranty: no claim slot is consumed, and servicing is still logged on
        a recalled or expired unit.
      </p>

      <Field label="Work performed">
        <textarea
          required
          rows={2}
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="Replaced display module"
          className={INPUT_CLASS}
        />
      </Field>

      <EvidenceField value={note} onChange={setNote} />

      <button type="submit" disabled={isPending || isConfirming} className={BUTTON_CLASS}>
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Log servicing action"}
      </button>

      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Servicing logged"
      />
    </form>
  );
}
