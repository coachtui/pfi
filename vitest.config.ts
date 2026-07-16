import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // *.live.test.ts suites hit the real, linked Supabase project (see
    // vitest.live.config.ts) and are excluded here so `pnpm test`/`pnpm check`
    // stay fast, offline, and deterministic — matching `pnpm test:rls`'s
    // existing separation of live-infra tests from the default suite.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    environment: "node",
  },
});
