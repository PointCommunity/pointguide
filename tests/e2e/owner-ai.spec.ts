import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Owner configures providers and the global review feature", async ({ page }) => {
  await page.goto("/owner/ai");

  await expect(page.getByRole("heading", { name: "AI setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex" })).toBeVisible();
  await page.getByRole("button", { name: "Start Codex sign-in" }).click();
  await expect(page.getByText("ABCD-1234")).toBeVisible();
  await page.getByRole("button", { name: "Refresh Codex models" }).click();
  await expect(page.getByRole("list", { name: "Codex models" }).getByText("GPT-5.6 Sol")).toBeVisible();

  for (const name of ["Primary profile", "Reviewer profile"]) {
    const profile = page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
    await profile.getByLabel("Owner direction").fill(`${name} must validate every claim against supplied evidence.`);
    await profile.getByRole("checkbox").check();
    await profile.getByRole("button", { name: "Save profile" }).click();
    await expect(profile.getByText("Profile saved as a new prompt revision.")).toBeVisible();
  }

  await page.getByLabel("Ollama API key").fill("ollama_fixture_key_123456789");
  await page.getByRole("button", { name: "Connect Ollama" }).click();
  await expect(page.getByRole("list", { name: "Ollama Cloud models" }).getByText("gpt-oss:120b")).toBeVisible();

  await page.getByRole("checkbox", { name: "Enable Deep research" }).check();
  await expect(page.getByText("Deep research is available")).toBeVisible();

  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("Owner setup stays touch-friendly without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only geometry assertion.");
  await page.goto("/owner/ai");
  const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  for (const control of await page.locator("#main-content button, #main-content input:not([type=checkbox]), #main-content select, #main-content label.switch-row").all()) {
    const box = await control.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
