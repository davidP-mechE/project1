import type { NextConfig } from "next";

// Security headers sent with every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Browsers remember to use HTTPS only (sent only when the site runs on HTTPS).
  ...((process.env.APP_URL ?? "").startsWith("https://") ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];
// The Content-Security-Policy is set per request in src/proxy.ts (it needs a fresh nonce each time).

const nextConfig: NextConfig = {
  // Cache Components is off on purpose: nearly every page is personal to the
  // logged-in student, so there is little to prerender. See PLAN.md.
  cacheComponents: false,
  // Packages that must run as plain Node modules on the server (not bundled).
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "bullmq", "ioredis", "sql.js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
