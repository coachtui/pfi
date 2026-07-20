import { expect, test, type Page } from "@playwright/test";
import { readState } from "./global-setup";

// The core journey mutates one shared user; run in order in one context.
test.describe.configure({ mode: "serial" });

let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
});

test.afterAll(async () => {
  await page.close();
});

test("magic link signs in and lands on onboarding", async () => {
  const { loginUrl } = readState();
  await page.goto(loginUrl);
  // The hash-processing effect shows its status while exchanging the tokens.
  await expect(page.getByText("Signing you in…")).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
});

test("onboarding completes with sample data and lands on the dashboard", async () => {
  await page.getByLabel("Company name").fill("Smoke Test Co");
  await page.getByLabel("Ticker (2–5 letters)").fill("SMKE");
  await page.getByLabel("Username").fill(`smoketester${Date.now() % 100000}`);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Age range").selectOption({ label: "40–49" });
  await page.getByLabel("Household income").selectOption({ label: "$100k–$150k" });
  await page.getByLabel("Household type").selectOption({ label: "Single" });
  await page.getByLabel("Cost of living").selectOption({ label: "Mid-Cost Region" });
  await page.getByLabel("Primary objective").selectOption({ label: "Build cash cushion" });
  // "Load sample data" stays checked (its default).
  await page.getByRole("button", { name: "Create my company" }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  // "Smoke Test Co" also appears in the performance-brief paragraph text, so
  // scope to the company-name heading specifically.
  await expect(page.getByRole("heading", { name: "Smoke Test Co" })).toBeVisible();
  await expect(page.getByText("Personal Index")).toBeVisible();
  await expect(page.getByText("PFI Score")).toBeVisible();
  // Keyless run: the deterministic brief must render (AI fallback path).
  await expect(page.getByRole("heading", { name: "Performance brief" })).toBeVisible();
  await expect(page.getByText("Calculated", { exact: true })).toBeVisible();
});

test("driver card expands to the calculated explanation", async () => {
  await page.goto("/");
  const firstCard = page.getByRole("button", { name: /Show explanation/ }).first();
  await firstCard.click();
  // The "What moved your line" section itself is also role="region" (aria-labelledby
  // "what-moved"), so scope to the driver panel's own region by its id prefix rather
  // than getByRole("region"), which would match both ancestor and panel.
  const panel = page.locator('[id^="driver-panel-"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText("How is this generated?")).toBeVisible();
  // Keyless run: deterministic path, chip scoped to the panel ("Calculated"
  // also appears on the performance brief).
  await expect(panel.getByText("Calculated", { exact: true })).toBeVisible();
  // The relocated drill-down keeps its filtered URL.
  const link = panel.getByRole("link", { name: /View transactions/ });
  await expect(link).toHaveAttribute("href", /\/transactions\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&label=/);
  // Collapse works.
  await page.getByRole("button", { name: /Hide explanation/ }).click();
  await expect(panel).not.toBeVisible();
});

test("score screen renders the breakdown", async () => {
  await page.goto("/score");
  await expect(page.getByText("/ 900")).toBeVisible();
  // "Cash Flow Health" also appears in the "What changed" driver list and in
  // per-metric contribution text, so scope to the dimension row itself.
  await expect(page.getByLabel("Score dimensions").getByText("Cash Flow Health", { exact: true })).toBeVisible();
});

test("accounts screen shows the demo data card with Koa active", async () => {
  await page.goto("/accounts");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(page.getByText("Koa Holdings")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("recurring section lists series detected from Koa demo data", async () => {
  await page.goto("/accounts");
  const section = page.locator("#recurring");
  await expect(section.getByRole("heading", { name: "Recurring" })).toBeVisible();
  await expect(section.getByText(/employer payroll/i)).toBeVisible();
  await expect(section.getByText(/mortgage payment/i)).toBeVisible();
});

test("dismissing a recurring series moves it under Dismissed and restore undoes it", async () => {
  await page.goto("/accounts");
  const section = page.locator("#recurring");
  const row = section.getByTestId("recurring-row").filter({ hasText: /auto insurance/i });
  await row.getByRole("button", { name: "Dismiss", exact: true }).click();
  await row.getByRole("button", { name: "Confirm dismiss" }).click();
  // The override triggers a snapshot rebuild before the refresh lands.
  await expect(section.getByText("Dismissed (1)")).toBeVisible({ timeout: 30_000 });
  await section.getByText("Dismissed (1)").click();
  await section.getByTestId("recurring-dismissed-row").getByRole("button", { name: "Restore" }).click();
  await expect(section.getByText(/^Dismissed \(/)).toBeHidden({ timeout: 30_000 });
});

test("anchored CSV import updates the account balance", async () => {
  // Create a fresh manual account to import into. The "Add account" trigger
  // (floating action button) and the in-sheet submit button share the same
  // accessible name, so disambiguate by DOM order: trigger renders first.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  await page.locator("#acct-name").fill("Anchor QA Checking");
  await page.locator("#acct-balance").fill("1000");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Anchor QA Checking")).toBeVisible({ timeout: 30_000 });

  // Import the fixture statement. Headers ("Date", "Description", "Amount")
  // auto-detect, so the map step's "Preview import" is enabled immediately.
  await page.goto("/import");
  await page.locator("#import-account").selectOption({ label: "Anchor QA Checking" });
  await page.locator("#import-file").setInputFiles("e2e/fixtures/checking-statement.csv");
  await page.getByRole("button", { name: "Preview import" }).click();

  // Anchor: ending balance 1500 as of today (so this statement anchor
  // supersedes the account-creation anchor, which is also dated today —
  // same anchorDate, later created_at wins the tiebreak).
  const today = new Date().toISOString().slice(0, 10);
  await page.locator("#anchor-balance").fill("1500");
  await page.locator("#anchor-date").fill(today);
  await page.getByRole("button", { name: /^Import 3 transactions/ }).click();
  await expect(page.getByText(/Balance anchored/)).toBeVisible({ timeout: 30_000 });

  // The account now shows the anchored balance, not the typed 1000. Scope
  // to the account's own Card (not just a nearby ancestor) via its actual
  // container class, since the name and balance live in separate sibling
  // elements a couple of levels apart.
  await page.goto("/accounts");
  const row = page.locator(".rounded-card").filter({ hasText: "Anchor QA Checking" });
  await expect(row.getByText("$1,500")).toBeVisible();
  await expect(row.getByText(/as of/)).toBeVisible();
});

test("undoing the import restores the pre-anchor balance", async () => {
  await page.goto("/accounts");
  // Undo the batch just imported — the only entry in Recent Imports (demo
  // data never sets import_batch_id, so the list starts empty). The control
  // is a real two-step confirm, not an optional one: "Undo" then "Confirm
  // undo" / "Keep".
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Confirm undo" }).click();
  // Anchor removed with the batch → balance re-derives from the creation
  // anchor (1000, dated today, no post-anchor transactions).
  const row = page.locator(".rounded-card").filter({ hasText: "Anchor QA Checking" });
  await expect(row.getByText("$1,000")).toBeVisible({ timeout: 30_000 });
});

test("a back-filled earlier-dated statement anchor reconciles but does not supersede the current balance", async () => {
  // A second, distinct manual account so this test doesn't interfere with
  // the "Anchor QA Checking" account used above. Creation writes a manual
  // anchor dated today at $2000.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).first().click();
  await page.locator("#acct-name").fill("Backfill QA Savings");
  await page.locator("#acct-balance").fill("2000");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Backfill QA Savings")).toBeVisible({ timeout: 30_000 });

  // Import the same fixture, but anchor the statement to a fixed date well
  // before today (not the 35-day staleness window's edge — just clearly
  // earlier than the creation anchor).
  await page.goto("/import");
  await page.locator("#import-account").selectOption({ label: "Backfill QA Savings" });
  await page.locator("#import-file").setInputFiles("e2e/fixtures/checking-statement.csv");
  await page.getByRole("button", { name: "Preview import" }).click();

  await page.locator("#anchor-balance").fill("1900");
  await page.locator("#anchor-date").fill("2026-06-01");
  await page.getByRole("button", { name: /^Import 3 transactions/ }).click();

  // The import commits and reconciliation is surfaced — not blocked by the
  // earlier date.
  await expect(page.getByText(/Balance anchored/)).toBeVisible({ timeout: 30_000 });

  // Critically: the account's displayed balance is still the creation
  // anchor's $2,000, not recomputed from the earlier-dated statement — the
  // later (today-dated) anchor remains effective.
  await page.goto("/accounts");
  const row = page.locator(".rounded-card").filter({ hasText: "Backfill QA Savings" });
  await expect(row.getByText("$2,000")).toBeVisible();
});

test("sign out returns to login", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("no console errors across the whole journey", () => {
  expect(consoleErrors).toEqual([]);
});
