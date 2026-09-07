import { expect, test } from "@playwright/test";

test("uses the configured reviewing profile and labels the reviewed answer", async ({ page }) => {
  await page.goto("/owner/ai");
  await page.getByRole("button", { name: "Start Codex sign-in" }).click();
  await page.getByRole("button", { name: "Refresh Codex models" }).click();
  for (const name of ["Primary profile", "Reviewer profile"]) {
    const profile = page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
    await profile.getByLabel("Owner direction").fill("Independently validate every claim against supplied evidence.");
    await profile.getByRole("checkbox").check();
    await profile.getByRole("button", { name: "Save profile" }).click();
  }
  const reviewToggle = page.getByRole("checkbox", { name: "Enable Deep research" });
  if (!await reviewToggle.isChecked()) {
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/owner/settings/review") && response.request().method() === "PUT" && response.ok()),
      reviewToggle.check(),
    ]);
  }

  await page.goto("/");
  await page.getByLabel("Deep research").check();
  await page.getByLabel("Your question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: /Ask PointGuide/ }).click();
  await expect(page.getByText("reviewed", { exact: true })).toBeVisible();
  await expect(page.locator(".direct-answer")).toContainText("On a DL32, a red AES50 SYNC LED");
});
