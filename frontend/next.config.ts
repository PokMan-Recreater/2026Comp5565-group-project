import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // wagmi / viem / WalletConnect ship ESM-only packages that Next.js can bundle
  // directly; nothing extra is required for the local Hardhat node.
};

export default nextConfig;
