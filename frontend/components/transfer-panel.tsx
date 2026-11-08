"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useConnection } from "wagmi";

import { PRODUCT_STATUS, hashEvidence, label, productWarrantyRegistryAbi as registryAbi } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";
import { useProductList, useRegistryAddress, useRegistryWrite, useRoles } from "@/lib/use-registry";

import { BUTTON_CLASS, EvidenceField, Field, INPUT_CLASS, Row, TxFeedback, WarrantyChip } from "./ui";

type TransferKind = "distribution" | "retailSale" | "resale";

const TRANSFER_COPY: Record<TransferKind, { title: string; verb: string; hint: string; role: string }> = {
  distribution: {
    title: "Ship to a retailer",
    verb: "transferToRetailer",
    hint: "Manufacturer -> retailer. The receiver must hold RETAILER_ROLE.",
    role: "RETAILER_ROLE",
  },
  retailSale: {
    title: "Complete a retail sale",
    verb: "transferToCustomer",
    hint: "Retailer -> customer. The buyer must hold CUSTOMER_ROLE; the warranty clock keeps running.",
    role: "CUSTOMER_ROLE",
  },
  resale: {
    title: "Resell the unit",
    verb: "transferOwnership",
    hint: "Customer -> customer. Whatever is left of the warranty travels with the unit.",
    role: "CUSTOMER_ROLE",
  },
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Ownership transfer screen: the single place where a unit changes hands.
 *
 * The contract exposes three typed transfer entry points instead of one generic one,
 * so the available action is derived from the connected wallet: a manufacturer ships
 * to a retailer, a retailer sells to a customer, a customer resells to a customer.
 * `evidenceHash` is the optional keccak256 digest of an off-chain document.
 */
export function TransferPanel() {
  const connection = useConnection();
  const registry = useRegistryAddress();
  const { roles } = useRoles();
  const { rows, isLoading } = useProductList();
  const { write, hash, isPending, isConfirming, isSuccess, error, reset } = useRegistryWrite();

  const [selectedId, setSelectedId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<TransferKind>("retailSale");

  const selected = useMemo(() => rows.find((row) => row.id.toString() === selectedId), [rows, selectedId]);

  const available = useMemo<TransferKind[]>(() => {
    if (selected === undefined || connection.address === undefined) return [];
    if (selected.product.currentOwner.toLowerCase() !== connection.address.toLowerCase()) return [];

    const kinds: TransferKind[] = [];
    if (roles.manufacturer) kinds.push("distribution");
    if (roles.retailer) kinds.push("retailSale");
    if (roles.customer) kinds.push("resale");
    return kinds;
  }, [selected, connection.address, roles]);

  const activeKind = available.includes(kind) ? kind : available[0];
  const recipientValid = ADDRESS_PATTERN.test(recipient.trim());

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === undefined || activeKind === undefined) return;

    reset();
    const args = [selected.id, recipient.trim() as `0x${string}`, hashEvidence(note)] as const;

    if (activeKind === "distribution") {
      write({ address: registry, abi: registryAbi, functionName: "transferToRetailer", args });
    } else if (activeKind === "retailSale") {
      write({ address: registry, abi: registryAbi, functionName: "transferToCustomer", args });
    } else {
      write({ address: registry, abi: registryAbi, functionName: "transferOwnership", args });
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <Field label="Unit" hint={isLoading ? "Reading the registry..." : `${rows.length} registered unit(s)`}>
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              reset();
            }}
            className={INPUT_CLASS}
          >
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
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <Row label="Serial" value={selected.product.serialNumber} mono />
            <Row label="Current owner" value={shortAddress(selected.product.currentOwner)} mono />
            <Row label="Status" value={label(PRODUCT_STATUS, selected.product.status)} />
            <div>
              <dt className="text-xs tracking-wide text-slate-400 uppercase">Warranty</dt>
              <dd>
                <WarrantyChip status={selected.warrantyStatus} />
              </dd>
            </div>
          </dl>
        )}
      </section>

      {selected !== undefined && available.length === 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {connection.address === undefined
            ? "Connect the wallet that currently owns this unit."
            : `Only the current owner (${shortAddress(selected.product.currentOwner)}) can transfer this unit, and that wallet must hold a matching supply-chain role.`}
        </p>
      )}

      {selected !== undefined && activeKind !== undefined && (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          {available.length > 1 && (
            <Field label="Action" hint="This wallet holds more than one role, so pick the hand-over.">
              <select
                value={activeKind}
                onChange={(event) => setKind(event.target.value as TransferKind)}
                className={INPUT_CLASS}
              >
                {available.map((option) => (
                  <option key={option} value={option}>
                    {TRANSFER_COPY[option].title}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-800">{TRANSFER_COPY[activeKind].title}</span> &mdash;{" "}
            {TRANSFER_COPY[activeKind].hint}
          </p>

          <Field
            label="Recipient address"
            hint={`Calls ${TRANSFER_COPY[activeKind].verb}. The receiver needs ${TRANSFER_COPY[activeKind].role}.`}
          >
            <input
              required
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x..."
              className={`${INPUT_CLASS} font-mono`}
            />
            {recipient.trim().length > 0 && !recipientValid && (
              <span className="mt-1 block text-xs text-rose-600">That is not a 20 byte address.</span>
            )}
          </Field>

          <EvidenceField value={note} onChange={setNote} />

          <button type="submit" disabled={!recipientValid || isPending || isConfirming} className={BUTTON_CLASS}>
            {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : TRANSFER_COPY[activeKind].title}
          </button>

          <TxFeedback
            hash={hash}
            isPending={isPending}
            isConfirming={isConfirming}
            isSuccess={isSuccess}
            error={error}
            successLabel="Ownership transferred"
          />
        </form>
      )}
    </div>
  );
}
