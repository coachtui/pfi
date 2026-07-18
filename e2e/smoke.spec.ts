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

test("sign out returns to login", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByText("Send magic link")).toBeVisible();
});

test("no console errors across the whole journey", () => {
  expect(consoleErrors).toEqual([]);
});
