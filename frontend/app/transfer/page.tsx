import { TransferPanel } from "@/components/transfer-panel";

export const metadata = {
  title: "Transfer ownership | ProductWarrantyRegistry",
};

export default function TransferPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Transfer ownership</h1>
        <p className="mt-1 text-sm text-slate-600">
          The chain of custody is append-only: manufacturer &rarr; retailer &rarr; customer &rarr; resale. Pick a unit
          you currently own and the available hand-over is derived from the roles your wallet holds.
        </p>
      </div>

      <TransferPanel />
    </div>
  );
}
