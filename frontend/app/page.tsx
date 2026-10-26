import Link from "next/link";

import { CHAIN_IDS, getProductProvenanceAddress, hasDeployment } from "@/lib/contracts";

export default function HomePage() {
  const address = getProductProvenanceAddress();
  const deployed = hasDeployment();

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <p className="text-sm font-medium tracking-wide text-brand-700 uppercase">COMP5565 group project</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Decentralized product provenance &amp; warranty registry
        </h1>
        <p className="max-w-2xl text-slate-600">
          Every unit is registered on-chain by its manufacturer. Each hand-over &mdash; manufacturer to retailer,
          retailer to customer, customer to customer on resale &mdash; is appended to an immutable chain of custody, and
          the warranty terms (duration, claim limit, transferability) travel with the product.
        </p>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/register"
            className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Register a product
          </Link>
          <Link
            href="/product"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Verify a product
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="Provenance">
          Product id, serial number, brand, model, category and an optional metadata URI are stored at registration.
        </Card>
        <Card title="Chain of custody">
          An append-only history records who held the unit, in which role, why it moved, and a hash of the evidence.
        </Card>
        <Card title="Warranty">
          Duration, claim limit and transferability are fixed at registration; claims, expiry and voiding are tracked
          live.
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
            <code className="font-mono">npm run deploy:local</code>, then refresh the frontend bindings with{" "}
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
