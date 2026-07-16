import { defineConfig } from "vitest/config";
import path from "node:path";

// Live-Supabase suites (src/app/actions/*.test.ts) need real project
// credentials from .env.local — Vitest doesn't load it automatically, unlike
// `pnpm test:rls` which uses `tsx --env-file`. Guarded because most tests
// don't touch Supabase; a checkout without .env.local still runs the rest of
// the suite, and any test that specifically requires these vars throws its
// own clear error when they're missing.
try {
  process.loadEnvFile(path.resolve(__dirname, ".env.local"));
} catch {
  // No .env.local present — fine unless a test specifically requires it.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
