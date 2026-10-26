import Link from "next/link";

import { WalletConnect } from "@/components/wallet-connect";

/** Top navigation bar. Server component: the wallet button is the only client part. */
export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-brand-700">
          Provenance<span className="font-normal text-slate-400">Registry</span>
        </Link>

        <nav className="flex items-center gap-5 text-sm font-medium text-slate-600">
          <Link href="/" className="hover:text-brand-700">
            Home
          </Link>
          <Link href="/register" className="hover:text-brand-700">
            Register product
          </Link>
          <Link href="/product" className="hover:text-brand-700">
            Verify / claim
          </Link>
        </nav>

        <WalletConnect />
      </div>
    </header>
  );
}
