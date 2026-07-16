import { defineConfig } from "vitest/config";
import path from "node:path";

// Live-Supabase suites (*.live.test.ts) need real project credentials from
// .env.local — Vitest doesn't load it automatically, unlike `pnpm test:rls`
// which uses `tsx --env-file`. Run explicitly via `pnpm test:live`, kept out
// of the default `pnpm test`/`pnpm check` suite (see vitest.config.ts).
try {
  process.loadEnvFile(path.resolve(__dirname, ".env.local"));
} catch {
  // No .env.local present — the suite's own setup will fail clearly if run
  // without one.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.live.test.ts"],
    environment: "node",
  },
});
