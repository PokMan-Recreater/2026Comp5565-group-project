"use client";

import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

import { shortAddress } from "@/lib/format";

/**
 * Connect / disconnect button.
 *
 * wagmi v3 note: `useAccount` was renamed to `useConnection`, and mutations now
 * expose `mutate` / `mutateAsync` instead of `connect` / `writeContract`.
 */
export function WalletConnect() {
  const connection = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (connection.isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          {connection.chain?.name ?? `chain ${connection.chainId ?? "?"}`}
        </span>
        <span className="font-mono text-sm text-slate-700">{shortAddress(connection.address)}</span>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          type="button"
          disabled={connect.isPending}
          onClick={() => connect.mutate({ connector })}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {connect.isPending ? "Connecting..." : `Connect ${connector.name}`}
        </button>
      ))}

      {connect.error !== null && <span className="text-xs text-rose-600">{connect.error.message}</span>}
    </div>
  );
}
