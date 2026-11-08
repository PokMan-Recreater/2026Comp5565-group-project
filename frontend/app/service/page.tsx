import { ServiceConsole } from "@/components/service-console";

export const metadata = {
  title: "Service centre | ProductWarrantyRegistry",
};

export default function ServicePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Service centre</h1>
        <p className="mt-1 text-sm text-slate-600">
          Validate pending warranty claims (approve or reject, with a resolution note stored on-chain) and log the
          servicing actions performed on a unit.
        </p>
      </div>

      <ServiceConsole />
    </div>
  );
}
