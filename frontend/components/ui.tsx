"use client";

import type { ReactNode } from "react";

import { WARRANTY_STATUS, hashEvidence, label } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";

/**
 * Small presentational pieces shared by every console.
 *
 * Keeping them in one module means the four role screens (manufacturer, retailer,
 * customer, service centre) look and behave identically, which is what the report's
 * "Accessibility & Usability" section describes: same labels, same feedback, same
 * focus order everywhere.
 */

export const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export const BUTTON_CLASS =
  "rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";

export const BUTTON_GHOST_CLASS =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description !== undefined && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({ label: name, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{name}</span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Row({ label: name, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-400 uppercase">{name}</dt>
      <dd className={mono === true ? "font-mono text-slate-800" : "text-slate-800"}>{value}</dd>
    </div>
  );
}

/** Colour tone for a `WarrantyStatus` value (0 none / 1 active / 2 expired / 3 void). */
export function warrantyTone(status: number): string {
  if (status === 1) return "bg-emerald-50 text-emerald-700";
  if (status === 3) return "bg-rose-50 text-rose-700";
  if (status === 2) return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

/** Colour tone for a `ClaimStatus` value (0 pending / 1 approved / 2 rejected). */
export function claimTone(status: number): string {
  if (status === 1) return "bg-emerald-50 text-emerald-700";
  if (status === 2) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-800";
}

export function StatusChip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{children}</span>;
}

/** Warranty-status pill that always renders the contract's own label. */
export function WarrantyChip({ status }: { status: number }) {
  return <StatusChip tone={warrantyTone(status)}>{label(WARRANTY_STATUS, status)}</StatusChip>;
}

export function RoleBadges({ roles }: { roles: { label: string; held: boolean }[] }) {
  const held = roles.filter((role) => role.held);

  if (held.length === 0) {
    return <StatusChip tone="bg-slate-100 text-slate-600">No role on this registry</StatusChip>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {held.map((role) => (
        <StatusChip key={role.label} tone="bg-brand-50 text-brand-700">
          {role.label}
        </StatusChip>
      ))}
    </div>
  );
}

/**
 * Optional free-text evidence note. Only `keccak256(note)` goes on-chain, which is
 * the privacy compromise documented in the report: the invoice stays off-chain,
 * the digest proves it did not change.
 */
export function EvidenceField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hash = hashEvidence(value);

  return (
    <Field label="Evidence note (optional)" hint="Hashed with keccak256 - the note itself never leaves this page.">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Invoice INV-2026-0042"
        className={INPUT_CLASS}
      />
      <span className="mt-1 block font-mono text-xs break-all text-slate-400">
        {hash === hashEvidence("") ? "no evidence" : hash}
      </span>
    </Field>
  );
}

/** Transaction lifecycle feedback: wallet prompt -> mining -> mined -> error. */
export function TxFeedback({
  hash,
  isPending,
  isConfirming,
  isSuccess,
  error,
  successLabel = "Confirmed",
}: {
  hash?: `0x${string}`;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error?: Error;
  successLabel?: string;
}) {
  return (
    <div aria-live="polite" className="space-y-1 text-sm">
      {isPending && <p className="text-slate-600">Waiting for the wallet...</p>}
      {isConfirming && <p className="text-slate-600">Mining transaction {shortAddress(hash)}...</p>}
      {isSuccess && (
        <p className="text-emerald-700">
          {successLabel}. Transaction <span className="font-mono">{shortAddress(hash)}</span>
        </p>
      )}
      {error !== undefined && <p className="text-rose-600">{error.message}</p>}
    </div>
  );
}
