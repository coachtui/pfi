import { expect, test, type Page } from "@playwright/test";
import { createPasswordUser, deletePasswordUser, type PasswordUser } from "./fixtures/password-user";

// One user completes the full loop; steps build on each other.
test.describe.configure({ mode: "serial" });

let page: Page;
let user: PasswordUser;

test.beforeAll(async ({ browser }) => {
  user = await createPasswordUser({ consent: true });
  page = await browser.newPage();
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
});

test.afterAll(async () => {
  // deletePasswordUser must run even if page.close() throws (e.g. a crashed
  // browser/page) — otherwise the ephemeral Supabase test user leaks.
  try {
    await page.close();
  } finally {
    await deletePasswordUser(user.userId);
  }
});

test("academy tab routes to the zero-progress home with no locks", async () => {
  await page.getByRole("link", { name: "Academy" }).click();
  await page.waitForURL("**/academy");
  await expect(page.getByRole("heading", { name: "Academy" })).toBeVisible();
  await expect(page.getByText("0 of 10 lessons")).toBeVisible();
  await expect(page.getByText("Not started").first()).toBeVisible();
  await expect(page.getByText(/locked/i)).toHaveCount(0); // comprehension is never locked
});

test("glossary-only row opens the definition sheet, not a lesson", async () => {
  await page.getByRole("button", { name: /Short-term obligations/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /lesson/i })).toHaveCount(0); // no CTA on glossary terms
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("demo data loads so term surfaces render", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Load / }).first().click();
  await expect(page.getByText("Personal Index")).toBeVisible({ timeout: 30_000 });
});

test("the report's Revenue term offers Take the lesson and deep-links into it", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Revenue — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Take the lesson" })).toBeVisible();
  await dialog.getByRole("link", { name: "Take the lesson" }).click();
  await page.waitForURL("**/academy/revenue");
  await expect(page.getByRole("heading", { name: "1. What is revenue?" })).toBeVisible();
  await expect(page.getByText("Sample data")).toBeVisible(); // generic example is labeled
});

test("answering all checks completes the lesson — right or wrong", async () => {
  const groups = page.getByRole("group", { name: /Knowledge check/ });
  const count = await groups.count();
  // revenue.ts has two knowledge checks, both with correctIndex: 0 — pick a
  // genuinely wrong choice for the first so this test actually exercises the
  // "wrong answer still completes the lesson" behavior it claims to prove.
  expect(count).toBeGreaterThanOrEqual(2);

  // Check 1 ("Which of these is revenue?"): answer WRONG on purpose.
  // Choice 1 ("A transfer from savings into checking") is not correctIndex 0.
  const wrongGroup = groups.nth(0);
  await wrongGroup.getByRole("button").nth(1).click();
  await expect(wrongGroup.getByText("Your answer")).toBeVisible(); // chosen-but-incorrect marker
  await expect(wrongGroup.getByText("Correct answer")).toBeVisible(); // correct choice still revealed
  await expect(
    wrongGroup.getByText(/A paycheck is new money from an outside source/),
  ).toBeVisible(); // explanation still renders even though the answer was wrong

  // Any remaining checks: answer correctly, to confirm the "right" path also completes.
  for (let i = 1; i < count; i++) {
    const group = groups.nth(i);
    await group.getByRole("button").first().click(); // correctIndex: 0 for both revenue checks
    await expect(group.getByText("Correct answer")).toBeVisible();
  }

  const complete = page.getByRole("status").filter({ hasText: "Lesson complete" });
  await expect(complete).toBeVisible(); // lesson completes despite the wrong answer above
});

test("home reflects the completion", async () => {
  await page.getByRole("link", { name: "Back to Academy" }).click();
  await page.waitForURL("**/academy");
  await expect(page.getByText("1 of 10 lessons")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently completed" })).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
});

test("the term sheet unlocks the completed variant", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Revenue — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Lesson completed")).toBeVisible();
  await expect(dialog.getByText("Why it matters")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Review lesson" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("no nested interactive content on the dashboard", async () => {
  await page.goto("/");
  await expect(page.getByText("Personal Index")).toBeVisible();
  expect(await page.locator("main a button, main button a").count()).toBe(0);
});
