import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("asks a grounded question and traces the answer to PointAudio evidence", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-320") await page.route("**/api/conversations/*/messages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_900));
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "What can I help you solve?" })).toBeVisible();
  await expect(page.getByText("Initial question + 5 follow-ups available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Troubleshoot stage-box sync" })).not.toBeVisible();
  await page.getByLabel("Your question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: /Ask PointGuide/ }).click();

  await expect(page.getByLabel("Your question")).toHaveValue("");
  await expect(page.getByText("Point Question", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "PointGuide is working" })).toBeVisible();
  if (testInfo.project.name === "mobile-320") await expect(page.getByText("Searching connected knowledge…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the evidence supports" })).toBeVisible();
  await expect(page.getByText("5 follow-ups remaining in this session")).toBeVisible();
  await expect(page.locator(".direct-answer")).toContainText("On a DL32, a red AES50 SYNC LED");
  await expect(page.locator(".claim-ledger li").getByText("On a DL32, a red AES50 SYNC LED", { exact: false })).toBeVisible();
  await page.getByText("Evidence", { exact: true }).click();
  await page.getByText("DL32 Quick Start Guide").click();
  await expect(page.getByText("AES50 SYNC LEDs indicate proper clock synchronisation", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rating captured");
});

test("keeps follow-up context visible with the newest question first", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One interaction pass is sufficient.");
  await page.goto("/");
  await page.getByLabel("Your question").fill("red AES50 DL32 first question");
  await page.getByRole("button", { name: /Ask PointGuide/ }).click();
  await expect(page.locator(".conversation-turn")).toHaveCount(1);
  await page.getByLabel("Your question").fill("red AES50 DL32 latest follow-up");
  await page.getByRole("button", { name: /Ask follow-up/ }).click();
  await expect(page.locator(".conversation-turn")).toHaveCount(2);
  await expect(page.locator(".conversation-turn").first().getByRole("heading", { name: "red AES50 DL32 latest follow-up" })).toBeVisible();
  await expect(page.locator(".conversation-turn").last().getByRole("heading", { name: "red AES50 DL32 first question" })).toBeVisible();
});

test("keeps the phone layout inside the viewport with touch-sized controls", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile geometry assertion");
  await page.goto("/");

  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    undersized: [...document.querySelectorAll("button, a, textarea")]
      .filter((element) => {
        const rectangle = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visible = rectangle.width > 0 && rectangle.height > 0 && style.visibility !== "hidden";
        return visible && (rectangle.width < 44 || rectangle.height < 44);
      })
      .map((element) => element.textContent?.trim() || element.getAttribute("aria-label")),
  }));

  expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  expect(geometry.undersized).toEqual([]);
});

test("supports keyboard entry and has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What can I help you solve?" })).toBeVisible();
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  for (let index = 0; index < 3 && !await skipLink.evaluate((element) => element === document.activeElement); index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();

  await page.getByLabel("Your question").focus();
  await page.keyboard.type("Which projector is installed in the sanctuary?");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.getByText("Evidence", { exact: true }).click();
  await expect(page.getByText("No current source establishes this.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
