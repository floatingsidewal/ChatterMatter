import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The ChatterMatter core library is ESM; Next.js handles this natively.
  serverExternalPackages: ["@anthropic-ai/sdk"],
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
};

export default nextConfig;
