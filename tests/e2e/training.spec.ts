import { expect, test } from "@playwright/test";

test("retains feedback and creates a review-only repository proposal", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: /Ask PointGuide/ }).click();
  await expect(page.getByRole("heading", { name: "What the evidence supports" })).toBeVisible();
  await page.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Rating captured");

  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Training review" })).toBeVisible();
  await expect(page.getByText("HELPFUL").first()).toBeVisible();
  await page.getByLabel("PointAudio target path").fill("research/pointguide/e2e-finding.txt");
  await page.getByLabel("Why this belongs in the corpus").fill("Verified during the controlled browser test.");
  await page.getByLabel("Exact proposed content").fill("Test finding with explicit human review.\n");
  await page.getByRole("button", { name: "Save draft proposal" }).click();
  await expect(page.getByText("research/pointguide/e2e-finding.txt").first()).toBeVisible();
  await expect(page.getByText("DRAFT").first()).toBeVisible();
});
