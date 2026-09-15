/**
 * Live browser QA for Plaid Slices 1–2: login → /accounts → Connect a bank →
 * first-tap disclosure sheet → Plaid Link sandbox (user_good/pass_good) →
 * card states (counter, Sandbox chip) → dashboard drivers/markers → report →
 * desktop width → Sync now → Disconnect.
 *
 * QA_OAUTH=1 switches the institution to the sandbox OAuth bank (ins_127287,
 * "Platypus OAuth Bank") on a mobile device profile, so Link leaves the app for
 * the bank's page and returns through /plaid/oauth. That path needs
 * PLAID_REDIRECT_URI=http://localhost:3219/plaid/oauth in .env.local AND the
 * same URI registered under "Allowed redirect URIs" in the Plaid dashboard.
 *
 * Manual QA tool (not part of pnpm test:*). Needs a dev server on :3219, .env.local with
 * Supabase + Plaid SANDBOX keys, and a minted user in .superpowers/qa-user.json.
 * Run: npx tsx --env-file=.env.local scripts/qa-plaid-link.ts
 */
import { chromium, devices, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";

const BASE = "http://localhost:3219";
const OAUTH = process.env.QA_OAUTH === "1";
const INSTITUTION = OAUTH ? { search: "Platypus OAuth", name: /Platypus OAuth/i } : { search: "First Platypus", name: /First Platypus Bank/i };
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

/**
 * OAuth institution: Link hands the whole page to the sandbox bank; sign in
 * there, and the bank sends the browser back to /plaid/oauth, which resumes
 * Link from the stored session and finishes on /accounts.
 */
async function oauthRoundTrip(page: Page): Promise<void> {
  await page.waitForURL((u) => !u.href.startsWith(BASE), { timeout: 60_000 });
  log(`oauth: at bank page ${page.url().slice(0, 60)}…`);
  await page.waitForTimeout(2000);
  await shot(page, "03-oauth-bank-page");
  for (let i = 0; i < 4; i++) {
    const btn = page.getByRole("button", { name: /sign in|continue|allow|authorize|submit/i }).first();
    try { await btn.waitFor({ state: "visible", timeout: 8000 }); await btn.click(); log(`oauth: clicked bank button ${i + 1}`); }
    catch { break; }
    await page.waitForTimeout(2000);
    if (page.url().startsWith(BASE)) break;
  }
  await page.waitForURL(/\/plaid\/oauth/, { timeout: 60_000 });
  log("oauth: returned to /plaid/oauth");
  await page.waitForTimeout(1500);
  await shot(page, "04-oauth-return");
  // Link re-initializes at the redirect URI and shows its remaining panes.
  const frame = await findLinkFrame(page, 60_000);
  for (let i = 0; i < 4; i++) {
    const clicked = await clickIfVisible(frame, () => frame.getByRole("button", { name: /^continue$|^allow$|^done$|finish/i }), `oauth pane ${i + 1}`, 8000);
    if (!clicked) break;
    await page.waitForTimeout(2500);
  }
}

async function main() {
  const browser = await chromium.launch();
  // OAuth: a real mobile profile so Link uses the full-page redirect (desktop profiles get a popup instead).
  const ctx = await browser.newContext(OAUTH ? { ...devices["iPhone 13"] } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

  // 2b. Slice 2: counter + Sandbox chip, then the first-tap disclosure sheet.
  log(`counter: ${await page.getByTestId("connection-count").innerText()}`);
  log(`sandbox chip present: ${(await page.getByText("Sandbox", { exact: true }).count()) > 0}`);
  await connect.click();
  const sheet = page.getByRole("dialog", { name: "How connecting works" });
  await sheet.waitFor({ timeout: 10_000 });
  await shot(page, "01b-disclosure-sheet");
  await sheet.getByRole("button", { name: "Continue to Plaid" }).click();
  log("disclosure: continued to Plaid");

  // 3. Plaid Link sandbox flow
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
    await search.fill(INSTITUTION.search);
    await page.waitForTimeout(2000);
    await shot(page, "02d-link-search-results");
    await frame.getByText(INSTITUTION.name).first().click();
    log(`link: picked ${INSTITUTION.search}`);
  } catch {
    await shot(page, "02b-link-search-missing");
    throw new Error("Institution search step not found");
  }
  await page.waitForTimeout(2500);
  if (OAUTH) {
    await oauthRoundTrip(page);
  } else {
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
  }
  // Wait for Link to close AND the exchange + first sync to finish (the button
  // reads "Connecting…" while the server action runs), then for the card row.
  await page.waitForURL(/\/accounts/, { timeout: 180_000 });
  await page.getByRole("button", { name: "Connect a bank" }).waitFor({ timeout: 180_000 });
  await page.getByText(/Connected · \d+ accounts|Preparing history/).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, "05-accounts-390-connected");
  log("card shows a connection");

  // 4. Dashboard: notice while history loads (may already be complete) at 390; Slice 2 drivers from derived events.
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await shot(page, "06-dashboard-390");
  const notice = await page.getByTestId("history-loading-notice").count();
  log(`dashboard history-loading notice present: ${notice > 0}`);
  const driverCount = await page.locator('[id^="driver-panel-"], [aria-controls^="driver-panel-"]').count();
  log(`dashboard drivers rendered: ${driverCount}`);
  await page.goto(`${BASE}/report`);
  await page.waitForLoadState("networkidle");
  await shot(page, "06b-report-390");

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
