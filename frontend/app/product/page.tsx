import { ProductLookup } from "@/components/product-lookup";

export const metadata = {
  title: "Verify a product | ProvenanceRegistry",
};

export default function ProductPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Verify a product</h1>
        <p className="mt-1 text-sm text-slate-600">
          Look a unit up by its serial number to inspect its chain of custody and warranty status, and to file a claim
          if you own it.
        </p>
      </div>

      <ProductLookup />
    </div>
  );
}
