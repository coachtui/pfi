/**
 * Live browser QA for Plaid Slice 1 (plan Task 15): login → /accounts →
 * Connect a bank → Plaid Link sandbox (user_good/pass_good) → card states →
 * dashboard notice → desktop width → Sync now → Disconnect.
 * Manual QA tool (not part of pnpm test:*). Needs a dev server on :3219, .env.local with
 * Supabase + Plaid SANDBOX keys, and a minted user in .superpowers/qa-user.json
 * (see scripts/qa-plaid-link.ts header). Run: npx tsx --env-file=.env.local scripts/qa-plaid-link.ts
 */
import { chromium, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = "http://localhost:3219";
const OUT = ".superpowers/qa";
fs.mkdirSync(OUT, { recursive: true });
const user = JSON.parse(fs.readFileSync(".superpowers/qa-user.json", "utf8")) as { email: string; password: string };
const log = (m: string) => console.log(`[qa] ${m}`);
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function findLinkFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => /plaid\.com/.test(fr.url()) && /link/.test(fr.url()));
    if (f) return f;
    await page.waitForTimeout(500);
  }
  throw new Error("Plaid Link iframe did not appear");
}

async function clickIfVisible(frame: Frame, selectorOrRole: () => ReturnType<Frame["getByRole"]>, label: string, timeout = 8000): Promise<boolean> {
  const loc = selectorOrRole().first();
  try {
    await loc.waitFor({ state: "visible", timeout });
    await loc.click();
    log(`link: clicked ${label}`);
    return true;
  } catch {
    log(`link: ${label} not visible (skipped)`);
    return false;
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  // 1. Login
  await page.goto(`${BASE}/login`);
  await page.locator("#identifier").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  log(`logged in → ${page.url()}`);

  // 2. Accounts page, empty state, card present
  await page.goto(`${BASE}/accounts`);
  await page.getByTestId("connected-institutions").waitFor();
  await shot(page, "01-accounts-390-empty");
  const connect = page.getByRole("button", { name: "Connect a bank" });
  await connect.waitFor();

  // 3. Plaid Link sandbox flow
  await connect.click();
  const frame = await findLinkFrame(page);
  log(`link frame: ${frame.url().slice(0, 60)}…`);
  await page.waitForTimeout(2500);
  await shot(page, "02-link-open");
  await clickIfVisible(frame, () => frame.getByText(/Continue without phone number/i), "Continue without phone number");
  await page.waitForTimeout(2500);
  await shot(page, "02a-link-after-phone");
  await clickIfVisible(frame, () => frame.getByRole("button", { name: /^continue$/i }), "Continue (consent)", 5000);
  await page.waitForTimeout(2000);
  await shot(page, "02c-link-institutions");
  // Institution search
  const search = frame.locator('input[placeholder*="Search" i], input[type="search"], input[type="text"]').first();
  try {
    await search.waitFor({ state: "visible", timeout: 10_000 });
    await search.fill("First Platypus");
    await page.waitForTimeout(2000);
    await shot(page, "02d-link-search-results");
    await frame.getByText(/First Platypus Bank/i).first().click();
    log("link: picked First Platypus Bank");
  } catch {
    await shot(page, "02b-link-search-missing");
    throw new Error("Institution search step not found");
  }
  await page.waitForTimeout(2500);
  // Sub-institution pane (non-OAuth variant) when present.
  {
    const item = frame.locator('button:has-text("First Platypus Bank"), [role="button"]:has-text("First Platypus Bank"), li:has-text("First Platypus Bank")')
      .filter({ hasNotText: /OAuth/ }).first();
    try { await item.waitFor({ state: "visible", timeout: 5000 }); await item.click(); log("link: clicked sub-institution item"); }
    catch { log("link: sub-institution pane not present"); }
  }
  await page.waitForTimeout(2500);
  await shot(page, "03-link-credentials");
  const userField = frame.locator('input[type="text"], input[name*="user" i], input[autocomplete="username"]').first();
  const passField = frame.locator('input[type="password"]').first();
  await userField.waitFor({ state: "visible", timeout: 20_000 });
  await userField.fill("user_good");
  await passField.fill("pass_good");
  await frame.getByRole("button", { name: /submit|continue|sign in/i }).first().click();
  log("link: submitted sandbox credentials");
  await page.waitForTimeout(4000);
  await shot(page, "04-link-after-credentials");
  // Account selection / continue panes (sandbox varies); click Continue up to 4 times, tolerate absence.
  for (let i = 0; i < 4; i++) {
    const clicked = await clickIfVisible(frame, () => frame.getByRole("button", { name: /^continue$|^allow$|^done$|finish/i }), `pane ${i + 1}`, 6000);
    if (!clicked) break;
    await page.waitForTimeout(2500);
  }
  // Wait for Link to close AND the exchange + first sync to finish (the button
  // reads "Connecting…" while the server action runs), then for the card row.
  await page.getByRole("button", { name: "Connect a bank" }).waitFor({ timeout: 180_000 });
  await page.getByText(/Connected · \d+ accounts|Preparing history/).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, "05-accounts-390-connected");
  log("card shows a connection");

  // 4. Dashboard: notice while history loads (may already be complete) at 390
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await shot(page, "06-dashboard-390");
  const notice = await page.getByTestId("history-loading-notice").count();
  log(`dashboard history-loading notice present: ${notice > 0}`);

  // 5. Desktop width
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/accounts`);
  await page.getByTestId("connected-institutions").waitFor();
  await shot(page, "07-accounts-1280");
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await shot(page, "08-dashboard-1280");

  // 6. Sync now (server floor may throttle) then Disconnect (two-step)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/accounts`);
  const syncNow = page.getByRole("button", { name: /^Sync now$|Syncing/ }).first();
  if (await syncNow.count()) {
    await syncNow.click();
    await page.waitForTimeout(6000);
    await shot(page, "09-after-sync-now");
  }
  await page.locator('section[aria-labelledby="recent-imports-heading"]').screenshot({ path: `${OUT}/09b-recent-imports.png` }).catch(() => log("no recent-imports section"));
  await page.getByTestId("connected-institutions").screenshot({ path: `${OUT}/09c-card-390.png` });
  const disconnect = page.getByRole("button", { name: /^Disconnect$/ }).first();
  await disconnect.waitFor();
  await disconnect.click();
  await page.getByRole("button", { name: /Confirm disconnect/ }).waitFor();
  await shot(page, "10-disconnect-confirm");
  await page.getByRole("button", { name: /Confirm disconnect/ }).click();
  await page.getByText(/Disconnected|history kept/i).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, "11-after-disconnect");
  log("disconnected");

  log(`console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 10)) log(`  console: ${e.slice(0, 200)}`);
  await browser.close();
}

main().catch(async (e) => {
  console.error(`[qa] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
