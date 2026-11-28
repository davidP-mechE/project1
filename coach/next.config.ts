import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This app lives inside another project's repository; keep Next from treating the parent as the root.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["pg"],
};

export default nextConfig;
