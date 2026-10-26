import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Product Provenance & Warranty dApp",
  description: "COMP5565 group project: a decentralized registry for product provenance and warranty management.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto w-full max-w-5xl px-4 pb-10 text-sm text-slate-500">
            COMP5565 group project &middot; Hardhat 3 + Next.js 15 + ethers.js / viem
          </footer>
        </Providers>
      </body>
    </html>
  );
}
