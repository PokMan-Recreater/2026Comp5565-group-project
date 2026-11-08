import Link from "next/link";

import { CHAIN_IDS, getRegistryAddress, hasDeployment } from "@/lib/contracts";

const JOURNEY = [
  {
    href: "/register",
    role: "Manufacturer",
    action: "Register a unit and freeze its warranty terms",
    contract: "registerProduct",
  },
  {
    href: "/transfer",
    role: "Manufacturer → Retailer",
    action: "Ship the unit to a retailer",
    contract: "transferToRetailer",
  },
  {
    href: "/transfer",
    role: "Retailer → Customer",
    action: "Complete the retail sale",
    contract: "transferToCustomer",
  },
  {
    href: "/product",
    role: "Customer",
    action: "Verify the unit, file a warranty claim, resell it",
    contract: "submitWarrantyClaim / transferOwnership",
  },
  {
    href: "/service",
    role: "Service centre",
    action: "Approve or reject claims, log servicing actions",
    contract: "resolveWarrantyClaim / logServiceAction",
  },
  {
    href: "/manage",
    role: "Manufacturer",
    action: "Dashboard, void a warranty, recall a unit",
    contract: "voidWarranty / recallProduct",
  },
];

export default function HomePage() {
  const address = getRegistryAddress();
  const deployed = hasDeployment();

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <p className="text-sm font-medium tracking-wide text-brand-700 uppercase">COMP5565 group project</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Decentralized product provenance &amp; warranty dApp
        </h1>
        <p className="max-w-2xl text-slate-600">
          A role-based registry for high-value consumer electronics. The manufacturer registers each unit, every
          hand-over is appended to an immutable chain of custody, and the warranty state (active, expired, void) is
          derived on-chain from the duration and the claim counter.
        </p>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/product"
            className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Verify a product
          </Link>
          <Link
            href="/transfer"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Transfer ownership
          </Link>
          <Link
            href="/service"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Service centre console
          </Link>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Who does what</h2>
        <p className="mt-1 text-sm text-slate-600">
          Four OpenZeppelin <code className="font-mono">AccessControl</code> roles, one screen per job. A wallet without
          the matching role stays read-only.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs tracking-wide text-slate-400 uppercase">
            <tr>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Job</th>
              <th className="py-2 pr-4 font-medium">Contract call</th>
              <th className="py-2 font-medium">Screen</th>
            </tr>
          </thead>
          <tbody>
            {JOURNEY.map((row) => (
              <tr key={`${row.role}-${row.action}`} className="border-t border-slate-100">
                <td className="py-2 pr-4 font-medium text-slate-800">{row.role}</td>
                <td className="py-2 pr-4 text-slate-600">{row.action}</td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-500">{row.contract}</td>
                <td className="py-2">
                  <Link href={row.href} className="text-brand-700 hover:underline">
                    open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="Provenance">
          Product id, serial number, brand, model, category and an optional metadata URI are stored at registration. The
          serial is hashed into the lookup index, so it can only ever be registered once.
        </Card>
        <Card title="Chain of custody">
          An append-only history records who held the unit, in which role, why it moved, and the keccak256 digest of the
          invoice or delivery note.
        </Card>
        <Card title="Warranty">
          Duration and claim limit are frozen at registration. Expiry is derived from the block timestamp and the claim
          counter, so a warranty can never look active just because nobody poked the contract.
        </Card>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Environment</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-slate-400 uppercase">Contract</dt>
            <dd className="font-mono break-all text-slate-800">{deployed ? address : "not deployed yet"}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-slate-400 uppercase">Chain id</dt>
            <dd className="text-slate-800">{process.env.NEXT_PUBLIC_CHAIN_ID ?? CHAIN_IDS.hardhatLocal}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-slate-400 uppercase">RPC</dt>
            <dd className="font-mono break-all text-slate-800">
              {process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"}
            </dd>
          </div>
        </dl>

        {!deployed && (
          <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Start the local chain with <code className="font-mono">npm run chain</code>, deploy with{" "}
            <code className="font-mono">npm run deploy:local</code>, seed the demo roles with{" "}
            <code className="font-mono">npm run seed:local</code>, then refresh the frontend bindings with{" "}
            <code className="font-mono">npm run export:abi</code>.
          </p>
        )}
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-brand-700">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
    </div>
  );
}
