/** Small presentation helpers shared by the components. */

/** `0x1234...abcd` */
export function shortAddress(address?: string): string {
  if (address === undefined || address.length < 10) return address ?? "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Unix seconds -> a locale date-time string. `0n` renders as a dash. */
export function formatTimestamp(seconds: bigint | number | undefined): string {
  if (seconds === undefined) return "-";

  const value = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (value === 0) return "-";

  return new Date(value * 1000).toLocaleString();
}

/** Unix seconds -> `730 days` (or a dash when zero). */
export function formatDuration(seconds: bigint | number | undefined): string {
  if (seconds === undefined) return "-";

  const value = typeof seconds === "bigint" ? Number(seconds) : seconds;
  if (value === 0) return "-";

  const days = value / 86_400;
  return Number.isInteger(days) ? `${days} days` : `${days.toFixed(1)} days`;
}

/** Normalises whatever the wallet / user typed into a `0x` address string. */
export function toAddress(value: string): `0x${string}` {
  return value.trim() as `0x${string}`;
}
