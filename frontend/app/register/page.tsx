import { RegisterProductForm } from "@/components/register-product-form";
import { hasDeployment, getRegistryAddress } from "@/lib/contracts";

export const metadata = {
  title: "Register a product | ProductWarrantyRegistry",
};

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Register a product</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manufacturer only. Creates the on-chain record: product id, serial number, model details, manufacturer, first
          owner and the warranty terms (which are frozen from this point on).
        </p>
      </div>

      {hasDeployment() ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          Registry: <span className="font-mono">{getRegistryAddress()}</span>
        </p>
      ) : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No contract address configured. Run <code className="font-mono">npm run deploy:local</code> in the contracts
          workspace, then <code className="font-mono">npm run export:abi</code>.
        </p>
      )}

      <RegisterProductForm />
    </div>
  );
}
