import type { NextConfig } from "next";

// Security headers sent with every response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Cache Components is off on purpose: nearly every page is personal to the
  // logged-in student, so there is little to prerender. See PLAN.md.
  cacheComponents: false,
  // Packages that must run as plain Node modules on the server (not bundled).
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "bullmq", "ioredis", "sql.js"],
  // The Anki export loads SQLite's WebAssembly file at runtime; make sure deployments include it.
  outputFileTracingIncludes: {
    "/api/courses/[courseId]/export": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
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
