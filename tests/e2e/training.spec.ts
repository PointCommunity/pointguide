import { expect, test } from "@playwright/test";

test("coaches an answer and accepts a learning report before an outcome", async ({ page }) => {
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  await expect(page.getByLabel("Repository for accepted learning")).not.toHaveValue("");
  await page.getByLabel("Question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();
  await page.getByRole("button", { name: "👎 Not helpful" }).click();
  await page.getByLabel("Explain what worked or what should change").fill("Use short numbered steps and explain what I should see after each check.");
  await page.getByRole("button", { name: "Analyze feedback" }).click();
  await expect(page.getByText("What PointGuide learned")).toBeVisible();
  await expect(page.getByText("Trainer feedback guides response behavior", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Accept learning report" }).click();
  await expect(page.getByRole("heading", { name: "Finish this training session" })).toBeVisible();
  await page.getByRole("button", { name: "Wipe session" }).click();
  const prompt = page.getByRole("dialog");
  const expected = await prompt.locator("label strong").textContent();
  await prompt.getByRole("textbox").fill(expected ?? "");
  await prompt.getByRole("button", { name: "Wipe session" }).click();
  await expect(page.getByRole("heading", { name: "Start a training session" })).toBeVisible();
});
