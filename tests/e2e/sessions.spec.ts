import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const identityHeaders = (subject: string) => ({ "x-pointguide-fixture-subject": subject, "x-pointguide-fixture-email": `${subject}@pointguide.test`, "x-pointguide-fixture-name": "Session User" });

test("searches, opens, resumes, downloads, and isolates an owned support session", async ({ page, playwright }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One complete session-history pass is sufficient.");
  const keyword = "amberprojectorhistory";
  await page.goto("/");
  await page.getByLabel("Your question").fill(`${keyword} which projector is installed?`);
  await page.getByRole("button", { name: /Ask PointGuide/ }).click();
  await expect(page.locator(".conversation-turn .direct-answer")).toBeVisible();

  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sessions", exact: true })).toBeVisible();
  await page.getByLabel("Search questions and answers").fill(keyword);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator(".session-card")).toHaveCount(1);
  await page.getByRole("link", { name: /Open and continue/ }).click();
  await expect(page.getByRole("heading", { name: "Continue this session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `${keyword} which projector is installed?` })).toBeVisible();

  const pdfHref = await page.locator(".thread-heading").getByRole("link", { name: "Download PDF" }).getAttribute("href");
  expect(pdfHref).toBeTruthy();
  const conversationId = pdfHref!.split("/").at(-2)!;
  const subject = "session-ownership-user";
  const pending = await playwright.request.newContext({ baseURL, extraHTTPHeaders: identityHeaders(subject) });
  expect((await pending.get("/api/session")).status()).toBe(202);
  await pending.dispose();
  const users = await (await page.request.get("/api/admin/users")).json() as { accounts: Array<{ id: string; email: string; version: number }> };
  const other = users.accounts.find((account) => account.email === `${subject}@pointguide.test`)!;
  expect((await page.request.patch(`/api/admin/users/${other.id}`, { data: { expectedVersion: other.version, role: "USER", status: "APPROVED" } })).ok()).toBe(true);
  const approved = await playwright.request.newContext({ baseURL, extraHTTPHeaders: identityHeaders(subject) });
  expect((await approved.get(`/api/conversations/${conversationId}`)).status()).toBe(404);
  expect((await approved.get(`/api/conversations/${conversationId}/pdf`)).status()).toBe(404);
  await approved.dispose();

  const downloadPromise = page.waitForEvent("download");
  await page.locator(".thread-heading").getByRole("link", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/u);

  await page.getByLabel("Your question").fill("What details should I collect next?");
  await page.getByRole("button", { name: /Ask follow-up/ }).click();
  await expect(page.locator(".conversation-turn").first().getByRole("heading", { name: "What details should I collect next?" })).toBeVisible();
  await expect(page.getByText("4 follow-ups remaining in this session")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keeps the full Owner navigation clear and responsive at every release viewport", async ({ page }, testInfo) => {
  await page.goto("/sessions");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(6);
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bottomPadding: Number.parseFloat(getComputedStyle(document.querySelector("main")!).paddingBottom),
    navigationHeight: document.querySelector(".bottom-nav")!.getBoundingClientRect().height,
    navigationRows: new Set([...document.querySelectorAll(".bottom-nav a")].map((element) => Math.round(element.getBoundingClientRect().top))).size,
  }));
  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.bottomPadding).toBeGreaterThanOrEqual(geometry.navigationHeight);
  expect(geometry.navigationRows).toBe(testInfo.project.name.startsWith("mobile") ? 2 : 1);
});
