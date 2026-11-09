import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside Next's server bundle; in tests it's a no-op.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/helpers/setup-env.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    // Integration tests share one test database, so run files one at a time.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
  },
});
