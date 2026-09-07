import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

function identityHeaders(subject: string, name: string) {
  return {
    "x-pointguide-fixture-subject": subject,
    "x-pointguide-fixture-email": `${subject}@pointguide.test`,
    "x-pointguide-fixture-name": name,
  };
}

test("keeps a later verified identity Pending and outside protected data", async ({ browser, request }, testInfo) => {
  await request.get("/api/session");
  const subject = `pending-${testInfo.project.name}`;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: identityHeaders(subject, "Pending Person"),
  });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page).toHaveURL(/\/pending$/);
  await expect(page.getByRole("heading", { name: "Access request received" })).toBeVisible();
  await expect(page.getByText("What can I help you solve?")).not.toBeVisible();

  const protectedResponse = await context.request.get("/api/admin/users");
  expect(protectedResponse.status()).toBe(403);
  expect(await protectedResponse.json()).toEqual({ error: { code: "ACCOUNT_PENDING", message: "Account approval is pending." } });
  await context.close();
});

test("lets the Owner approve a Trainer from the mobile account screen", async ({ page, playwright }, testInfo) => {
  const subject = `trainer-${testInfo.project.name}`;
  const displayName = `Trainer ${testInfo.project.name}`;
  const pendingApi = await playwright.request.newContext({ baseURL, extraHTTPHeaders: identityHeaders(subject, displayName) });
  const session = await pendingApi.get("/api/session");
  expect(session.status()).toBe(202);
  await pendingApi.dispose();

  await page.goto("/admin/accounts");
  await page.locator(".account-picker select").selectOption({ label: `${displayName} · Pending` });
  const card = page.getByRole("article", { name: `${displayName} account` });
  await expect(card).toBeVisible();
  await card.getByLabel("Role").selectOption("TRAINER");
  await card.getByLabel("Access").selectOption("APPROVED");
  await card.getByRole("button", { name: "Save access" }).click();
  await expect(card.getByText("Access updated.")).toBeVisible();

  const violations = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.violations).toEqual([]);
});

test("keeps account controls touch-sized without page overflow", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile-only layout assertion");
  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();

  const dimensions = await page.locator("main button:visible, main a:visible, main select:visible, .side-rail a:visible, .bottom-nav a:visible").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, label: element.textContent?.trim() || element.getAttribute("aria-label") };
  }));
  expect(dimensions.filter((item) => item.width < 44 || item.height < 44)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("lets a user edit their display name", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One authenticated browser pass is sufficient.");
  await page.goto("/account");
  await page.getByLabel("Display name").fill("PointGuide Owner");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Name updated.")).toBeVisible();
});

test("hides the single-page navigation and redirects a User from protected pages", async ({ browser, page, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One complete authorization browser pass is sufficient.");
  const subject = "user-navigation-boundary";
  const userApi = await playwright.request.newContext({ baseURL, extraHTTPHeaders: identityHeaders(subject, "Standard User") });
  expect((await userApi.get("/api/session")).status()).toBe(202);
  await userApi.dispose();
  const listing = await (await page.request.get("/api/admin/users")).json() as { accounts: Array<{ id: string; accessSubject?: string; email: string; version: number }> };
  const user = listing.accounts.find((account) => account.email === `${subject}@pointguide.test`);
  expect(user).toBeTruthy();
  const approval = await page.request.patch(`/api/admin/users/${user!.id}`, { data: { expectedVersion: user!.version, role: "USER", status: "APPROVED" } });
  expect(approval.ok()).toBe(true);
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, extraHTTPHeaders: identityHeaders(subject, "Standard User") });
  const userPage = await context.newPage();
  await userPage.goto("/");
  await expect(userPage.getByRole("heading", { name: "What can I help you solve?" })).toBeVisible();
  await expect(userPage.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await userPage.goto("/knowledge");
  await expect(userPage).toHaveURL(`${baseURL}/`);
  await context.close();
});
