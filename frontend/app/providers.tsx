"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/lib/wagmi";

/**
 * Client-side provider stack. It must wrap every component that uses wagmi
 * hooks, so `app/layout.tsx` mounts it once for the whole application.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Creating the client inside `useState` keeps one instance per browser
  // session instead of one per render.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
