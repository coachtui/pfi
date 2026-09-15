import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  // One worker: the smoke journey mutates one shared test user's data.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    // Keyless on purpose: e2e never depends on a developer's AI key or Plaid
    // credentials. With PLAID_* unset the Connected-institutions card renders
    // its "not configured" state (DECISIONS #43).
    env: {
      ...process.env,
      AI_GATEWAY_API_KEY: "",
      PLAID_CLIENT_ID: "",
      PLAID_SECRET: "",
      PLAID_TOKEN_ENCRYPTION_KEY: "",
      PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS: "",
      PLAID_REDIRECT_URI: "",
    },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
