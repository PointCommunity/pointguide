import { expect, test } from "@playwright/test";

test("has no console errors, honors reduced motion, and remains usable at each release viewport", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What can I help you solve?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  const headingSize = await page.getByRole("heading", { level: 1 }).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(headingSize).toBeLessThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const behavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  expect(behavior).toBe("auto");
  expect(errors).toEqual([]);
});
