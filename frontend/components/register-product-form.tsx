"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { getProductProvenanceAddress, productProvenanceAbi } from "@/lib/contracts";

/** bytes32(0) means "no off-chain evidence attached". */
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const INITIAL_FORM = {
  serialNumber: "",
  brand: "Acme",
  modelName: "SuperWidget",
  modelNumber: "SW-1000",
  category: "Home appliance",
  metadataURI: "",
  durationDays: "730",
  maxClaims: "2",
  transferable: false,
};

type FormState = typeof INITIAL_FORM;

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/**
 * Manufacturer form that calls `ProductProvenance.registerProduct`.
 * Only accounts authorised via `setManufacturerAuthorization` can submit it.
 */
export function RegisterProductForm() {
  const connection = useConnection();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const { mutate: writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  function handleText(key: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setForm((previous) => ({ ...previous, [key]: value }));
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    writeContract({
      address: getProductProvenanceAddress(connection.chainId),
      abi: productProvenanceAbi,
      functionName: "registerProduct",
      args: [
        form.serialNumber,
        {
          brand: form.brand,
          modelName: form.modelName,
          modelNumber: form.modelNumber,
          category: form.category,
          metadataURI: form.metadataURI,
        },
        {
          durationSeconds: BigInt(Math.round(Number(form.durationDays) * 86_400)),
          maxClaims: Number(form.maxClaims),
          transferable: form.transferable,
        },
        ZERO_HASH,
      ],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <Field label="Serial number" hint="Printed on the unit. Must be globally unique.">
        <input
          required
          value={form.serialNumber}
          onChange={handleText("serialNumber")}
          placeholder="SW-1000-0001"
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
        <Field label="Warranty duration (days)">
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

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.transferable}
          onChange={(event) => setForm((previous) => ({ ...previous, transferable: event.target.checked }))}
          className="size-4 rounded border-slate-300"
        />
        Warranty survives a customer-to-customer resale
      </label>

      <button
        type="submit"
        disabled={!connection.isConnected || isPending || receipt.isLoading}
        className="w-full rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Waiting for wallet..." : receipt.isLoading ? "Mining..." : "Register product"}
      </button>

      {!connection.isConnected && (
        <p className="text-sm text-amber-700">Connect a wallet first - the unit is registered by its manufacturer.</p>
      )}
      {writeError !== null && <p className="text-sm text-rose-600">{writeError.message}</p>}
      {receipt.isSuccess && (
        <p className="text-sm text-emerald-700">
          Registered in transaction <span className="font-mono">{hash}</span>
        </p>
      )}
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
