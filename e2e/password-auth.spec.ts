import { expect, test } from "@playwright/test";
import { createPasswordUser, deletePasswordUser, type PasswordUser } from "./fixtures/password-user";

const GENERIC_ERROR = "Invalid email/username or password.";

test.describe("password auth", () => {
  let user: PasswordUser;

  test.beforeAll(async () => {
    user = await createPasswordUser({ consent: true });
  });
  test.afterAll(async () => {
    await deletePasswordUser(user.userId);
  });

  test("logs in with email", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/login|consent/);
  });

  test("logs in with username", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.username.toUpperCase()); // case-insensitive
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/login/);
  });

  test("wrong password and unknown username produce the identical generic error", async ({ page }) => {
    // Scoped past role="alert": Next.js's route announcer div also carries
    // role="alert" (for a11y route-change announcements), so an unscoped
    // getByRole("alert") resolves to two elements.
    const formError = page.getByRole("alert").filter({ hasText: GENERIC_ERROR });

    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.username);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formError).toHaveText(GENERIC_ERROR);

    await page.getByLabel("Email or username").fill("no_such_user_zz");
    await page.getByLabel("Password", { exact: true }).fill("whatever-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formError).toHaveText(GENERIC_ERROR);
  });

  test("show/hide toggle reveals the typed password", async ({ page }) => {
    await page.goto("/login");
    const pw = page.getByLabel("Password", { exact: true });
    await pw.fill("secret123");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(pw).toHaveAttribute("type", "password");
  });

  test("reset request reports identically for unknown emails", async ({ page }) => {
    await page.goto("/auth/reset");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If that email has an account");
  });

  test("signup requires consent and confirms without leaking existing emails", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(user.email); // existing account
    await page.getByLabel("Password", { exact: true }).fill("valid-password-1");
    // Consent unchecked → native validation blocks submit and we stay on /signup.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/signup/);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
  });
});

test.describe("consent gate", () => {
  let user: PasswordUser;

  test.beforeAll(async () => {
    user = await createPasswordUser({ consent: false });
  });
  test.afterAll(async () => {
    await deletePasswordUser(user.userId);
  });

  test("routes un-consented logins to /consent, then through after accepting", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/consent");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/consent/);
  });
});
