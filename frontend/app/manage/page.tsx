import { ManufacturerConsole } from "@/components/manufacturer-console";

export const metadata = {
  title: "Manufacturer console | ProductWarrantyRegistry",
};

export default function ManagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Manufacturer console</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every unit this manufacturer registered, its live warranty state, and the administrative levers: void the
          warranty, recall the unit, or persist an expiry that already happened.
        </p>
      </div>

      <ManufacturerConsole />
    </div>
  );
}
