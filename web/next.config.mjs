/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["chattermatter"],
  webpack: (config, { isServer }) => {
    // The core library uses TypeScript ESM imports with .js extensions
    // (e.g., import { x } from "./types.js"). Tell webpack to also try .ts.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
