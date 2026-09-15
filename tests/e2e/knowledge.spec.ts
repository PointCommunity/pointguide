import AxeBuilder from "@axe-core/playwright";
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

test("pulls latest knowledge with progress, independent outcomes, keyboard access and retry", async ({ page }, testInfo) => {
  test.skip(!["mobile-320", "desktop-1440"].includes(testInfo.project.name), "Compact and wide refresh layouts.");
  const report = { valid: true, complete: true, checkedAt: "2026-09-14T10:00:00Z", commitSha: "a".repeat(40), defaultBranch: "main", errors: [], warnings: [], filesReviewed: 1, filesIndexed: 1, chunksIndexed: 2, requirements: { agentsFile: true, evidenceContent: true, integrityManifest: true } };
  const sources = ["pointaudio", "pointplanning", "archive"].map((name, i) => ({ id: String(i), fullName: `PointCommunity/${name}`, url: `https://github.com/PointCommunity/${name}`, status: i === 2 ? "ARCHIVED" : "ACTIVE", indexedCommit: report.commitSha, defaultBranch: "main", validationReport: report, linkedAt: report.checkedAt, updatedAt: report.checkedAt, version: 1 }));
  await page.route("**/api/knowledge/sources", route => route.fulfill({ json: { sources } }));
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  await page.route("**/api/knowledge/sources/refresh", async route => {
    calls++; await pending;
    sources[0] = { ...sources[0], indexedCommit: "b".repeat(40), validationReport: { ...report, commitSha: "b".repeat(40), checkedAt: "2026-09-14T11:00:00Z" } };
    await route.fulfill({ contentType: "application/x-ndjson", body: [ { type: "checking", id: "0", fullName: sources[0].fullName }, { type: "result", id: "0", fullName: sources[0].fullName, outcome: calls === 1 ? "updated" : "current", source: sources[0] }, { type: "result", id: "1", fullName: sources[1].fullName, outcome: "failed", message: "GitHub unavailable. Previous knowledge retained." }, { type: "done" } ].map(event => JSON.stringify(event) + "\n").join("") });
  });
  await page.goto("/knowledge");
  const button = page.getByRole("button", { name: "Pull latest knowledge", exact: true });
  await expect(button).toBeEnabled(); await button.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Pulling latest knowledge…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Archive", exact: true }).first()).toBeDisabled();
  finish();
  await expect(page.getByText("Updated", { exact: true })).toBeVisible();
  await expect(page.getByText("Failed: GitHub unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByText("2 chunks · commit bbbbbbbbbbbb")).toBeVisible();
  await button.click(); await expect(page.getByText("Already current", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === "mobile-320") await page.setViewportSize({ width: 640, height: 1200 }); // 200% zoom retains a 320 CSS-pixel layout.
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(button).toBeVisible();
});

test("allows retry after an interrupted refresh stream", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One stream interruption is sufficient.");
  await page.route("**/api/knowledge/sources/refresh", route => route.fulfill({ contentType: "application/x-ndjson", body: '{"type":"heartbeat"}\n' }));
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Pull latest knowledge", exact: true }).click();
  await expect(page.getByText("Refresh interrupted. Completed repositories are saved; pull again to retry the rest.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pull latest knowledge", exact: true })).toBeEnabled();
});
