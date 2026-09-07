import { expect, test } from "@playwright/test";

test("shows a clear repository structure report before linking an invalid source", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop-1440"].includes(testInfo.project.name), "Representative compact and wide layouts are sufficient.");
  await page.route("**/api/knowledge/sources", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "SOURCE_INVALID", message: "The repository does not meet the PointGuide source contract." }, report: { valid: false, checkedAt: "2026-09-06T00:00:00.000Z", commitSha: "a".repeat(40), defaultBranch: "main", errors: ["Missing root AGENTS.md with source-handling instructions."], warnings: [], filesReviewed: 2, filesIndexed: 1, chunksIndexed: 1, requirements: { agentsFile: false, evidenceContent: true, integrityManifest: false } } }) });
  });
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await page.getByLabel("GitHub repository URL").fill("https://github.com/PointCommunity/incomplete");
  await page.getByRole("button", { name: "Validate and add" }).click();
  await expect(page.getByRole("region", { name: "Repository validation report" })).toContainText("Repository needs changes");
  await expect(page.getByText("Missing root AGENTS.md", { exact: false })).toBeVisible();
});
