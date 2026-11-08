"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useConnection } from "wagmi";

import { productWarrantyRegistryAbi as registryAbi } from "@/lib/contracts";
import { useRegistryAddress, useRegistryWrite, useRoles } from "@/lib/use-registry";

import { Field, INPUT_CLASS, BUTTON_CLASS, TxFeedback } from "./ui";

const INITIAL_FORM = {
  serialNumber: "",
  brand: "Aurelia",
  modelName: "Chrono X1",
  modelNumber: "AX1-42",
  category: "Luxury smartwatch",
  metadataURI: "",
  durationDays: "730",
  maxClaims: "3",
};

type FormState = typeof INITIAL_FORM;

/**
 * Manufacturer screen: calls `registerProduct` on the registry.
 *
 * Only accounts holding `MANUFACTURER_ROLE` can submit - the contract reverts with
 * `AccessControlUnauthorizedAccount` otherwise, and the banner below warns before
 * the wallet prompt appears.
 */
export function RegisterProductForm() {
  const connection = useConnection();
  const registry = useRegistryAddress();
  const { roles } = useRoles();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const { write, hash, isPending, isConfirming, isSuccess, error } = useRegistryWrite();

  function handleText(key: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setForm((previous) => ({ ...previous, [key]: value }));
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    write({
      address: registry,
      abi: registryAbi,
      functionName: "registerProduct",
      args: [
        form.serialNumber.trim(),
        {
          brand: form.brand,
          modelName: form.modelName,
          modelNumber: form.modelNumber,
          category: form.category,
          metadataURI: form.metadataURI,
        },
        BigInt(Math.max(1, Math.round(Number(form.durationDays) || 0)) * 86_400),
        Number(form.maxClaims) || 0,
      ],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      {!roles.manufacturer && connection.isConnected && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This wallet does not hold <code className="font-mono">MANUFACTURER_ROLE</code>. The registry admin grants it
          with <code className="font-mono">grantRole</code> (or <code className="font-mono">npm run seed:local</code> on
          a local node).
        </p>
      )}

      <Field label="Serial number" hint="Printed on the unit. Hashed on-chain, so it can only be registered once.">
        <input
          required
          value={form.serialNumber}
          onChange={handleText("serialNumber")}
          placeholder="AX1-42-0001"
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Brand">
          <input required value={form.brand} onChange={handleText("brand")} className={INPUT_CLASS} />
        </Field>
        <Field label="Model name">
          <input required value={form.modelName} onChange={handleText("modelName")} className={INPUT_CLASS} />
        </Field>
        <Field label="Model number">
          <input required value={form.modelNumber} onChange={handleText("modelNumber")} className={INPUT_CLASS} />
        </Field>
        <Field label="Category">
          <input value={form.category} onChange={handleText("category")} className={INPUT_CLASS} />
        </Field>
      </div>

      <Field label="Metadata URI" hint="IPFS or HTTPS link to photos, datasheets, certificates.">
        <input
          value={form.metadataURI}
          onChange={handleText("metadataURI")}
          placeholder="ipfs://..."
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Warranty duration (days)" hint="The warranty clock starts at registration.">
          <input
            required
            type="number"
            min={1}
            value={form.durationDays}
            onChange={handleText("durationDays")}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Maximum claims" hint="0 means unlimited.">
          <input
            required
            type="number"
            min={0}
            value={form.maxClaims}
            onChange={handleText("maxClaims")}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={!connection.isConnected || isPending || isConfirming}
        className={`w-full ${BUTTON_CLASS}`}
      >
        {isPending ? "Waiting for wallet..." : isConfirming ? "Mining..." : "Register product"}
      </button>

      <p className="text-xs text-slate-500">
        Registered by the manufacturer of record; the warranty terms are frozen at this point.
      </p>

      <TxFeedback
        hash={hash}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        error={error}
        successLabel="Unit registered"
      />
    </form>
  );
}
