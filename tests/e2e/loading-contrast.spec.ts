import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Route } from "@playwright/test";

test("loading text stays readable throughout its entrance animation", async ({ page }) => {
  let held: Route | undefined;
  await page.route("**/api/conversations/*/messages", (route) => { held = route; });
  try {
    await page.goto("/");
    const ask = page.getByRole("button", { name: /Ask PointGuide/ });
    await page.getByLabel("Your question").fill("Which projector is installed?");
    await expect(ask).toBeEnabled();
    await ask.click();
    const status = page.getByRole("status", { name: "PointGuide is working", exact: true });
    await expect(status).toBeVisible();
    const opacity = await status.locator("p").evaluate((element) => {
      const animation = element.getAnimations()[0];
      if (!animation) throw new Error("Expected the loading phase entrance animation");
      animation.pause();
      return [0, 87, 175, 350].map((time) => {
        animation.currentTime = time;
        return Number(getComputedStyle(element).opacity);
      });
    });
    expect(opacity).toEqual([1, 1, 1, 1]);
    const result = await new AxeBuilder({ page }).include(".agent-working").withRules(["color-contrast"]).analyze();
    expect(result.violations).toEqual([]);
    expect(result.incomplete).toEqual([]);
  } finally {
    await held?.abort();
  }
});
