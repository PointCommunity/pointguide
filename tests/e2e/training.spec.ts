import { expect, test } from "@playwright/test";

test("coaches an answer and accepts a learning report before an outcome", async ({ page }, testInfo) => {
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
  if (testInfo.project.name === "desktop-1440") {
    await page.getByRole("button", { name: "Commit learning" }).click();
    const prompt = page.getByRole("dialog");
    await expect(prompt.getByRole("heading", { name: "Commit accepted learning?" })).toBeVisible();
    await expect(prompt.getByRole("textbox")).toHaveCount(0);
    await prompt.getByRole("button", { name: "Commit accepted learning" }).click();
    await expect(page.getByRole("heading", { name: "Training captured for review" })).toBeVisible();
    return;
  }
  await page.getByRole("button", { name: "Wipe session" }).click();
  const prompt = page.getByRole("dialog");
  const expected = await prompt.locator("label strong").textContent();
  await prompt.getByRole("textbox").fill(expected ?? "");
  await prompt.getByRole("button", { name: "Wipe session" }).click();
  await expect(page.getByRole("heading", { name: "Start a training session" })).toBeVisible();
});

test("keeps accumulated training in a searchable sessions subpage", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One focused viewport covers persistence and resume behavior.");
  const question = "How should we explain the searchable training session archive?";

  await page.goto("/training");
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();

  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Start a training session" })).toBeVisible();
  await page.getByRole("link", { name: "Training Sessions" }).click();
  await expect(page.getByRole("heading", { name: "Training Sessions", exact: true })).toBeVisible();
  await page.getByLabel("Search training sessions").fill("searchable training");
  await page.getByRole("button", { name: "Search" }).click();
  const result = page.getByRole("article").filter({ hasText: question });
  await expect(result).toBeVisible();
  await result.getByRole("link", { name: "Open and continue" }).click();
  await expect(page.getByRole("heading", { name: question })).toBeVisible();

  await page.getByRole("button", { name: "👍 Helpful" }).click();
  await page.getByLabel("Explain what worked or what should change").fill("The response is clear and the session can be retained through search.");
  await page.getByRole("button", { name: "Analyze feedback" }).click();
  await page.getByRole("button", { name: "Accept learning report" }).click();
  await page.getByRole("button", { name: "Wipe session" }).click();
  const prompt = page.getByRole("dialog");
  const expected = await prompt.locator("label strong").textContent();
  await prompt.getByRole("textbox").fill(expected ?? "");
  await prompt.getByRole("button", { name: "Wipe session" }).click();
  await expect(page.getByRole("heading", { name: "Start a training session" })).toBeVisible();
});
