import { expect, test } from "@playwright/test";

test("revises an answer with feedback and preserves ordered turns after resume", async ({ page }) => {
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  await expect(page.getByLabel("Repository for accepted learning")).not.toHaveValue("");
  await page.getByLabel("Question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();
  await page.getByLabel("Feedback for this answer").fill("Use short numbered steps and explain what I should see after each check.");
  await page.getByRole("button", { name: "Revise answer" }).click();
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept answer" })).toBeEnabled();
  await page.reload();
  await page.getByText("Conversation history", { exact: false }).click();
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept answer" })).toBeEnabled();
  await expect(page.getByText("Rate this response")).toHaveCount(0);
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

  await expect(page.getByRole("button", { name: "Accept answer" })).toBeEnabled();
});
