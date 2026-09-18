import { expect, test } from "@playwright/test";

test("revises an answer with feedback and preserves ordered turns after resume", async ({ page }) => {
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  await expect(page.getByLabel("Where accepted guidance is saved")).not.toHaveValue("");
  await expect(page.getByText("Accepting an answer publishes it", { exact: false })).toBeVisible();
  await page.getByLabel("Question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();
  await expect(page.getByText("Publishing makes this exact answer available", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Feedback for this answer")).toHaveAttribute("placeholder", /numbered checks/u);
  await page.route("**/api/training/sessions/*", async route => {
    if (route.request().method() === "PATCH") await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.getByLabel("Feedback for this answer").fill("Use short numbered steps and explain what I should see after each check.");
  await page.getByRole("button", { name: "Revise with feedback" }).click();
  await expect(page.locator(".training-feedback").getByRole("status")).toContainText("Revising");
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Conversation so far" })).toBeVisible();
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
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

  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
});

test("explains first-answer failure and shows a saved-question recovery path", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000091";
  const question = "How do I check AES50 sync?";
  let session: Record<string, unknown>;
  await page.route(`**/api/training/sessions/${id}`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { session, turns: [] } });
    session = { ...session, state: "ACTIVE", currentAnswer: { id: "00000000-0000-4000-8000-000000000092", directAnswer: "Check the documented sync indicator.", evidence: [], claims: [] }, version: 2 };
    return route.fulfill({ status: 200, json: { session, turns: [{ ordinal: 1, kind: "ANSWER", content: { answer: session.currentAnswer } }] } });
  });
  await page.route("**/api/training/sessions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const { targetRepository } = route.request().postDataJSON() as { targetRepository: string };
    session = { id, originalQuestion: question, targetRepository, state: "ACTIVE", currentAnswer: null, version: 1 };
    return route.fulfill({ status: 202, json: { session, error: { code: "ANSWER_FAILED", message: "The first answer failed. Your question is saved." } } });
  });
  await page.goto("/training");
  await page.getByLabel("Question").fill(question);
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByRole("heading", { name: question })).toBeVisible();
  await expect(page.getByText("The first answer did not complete. Your question is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Retry first answer" }).click();
  await expect(page.getByText("Check the documented sync indicator.")).toBeVisible();
  await expect(page.getByLabel("Feedback for this answer")).toBeVisible();
});

test("shows saved feedback and previous answer when revision fails, then resumes on retry", async ({ page }) => {
  await page.goto("/training");
  await page.getByLabel("Question").fill("How do I check AES50 sync?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();
  const original = await page.locator(".training-answer .direct-answer").innerText();
  const feedback = "Keep the original question and explain the sync indicator.";
  let pending: { session: Record<string, unknown>; turns: Record<string, unknown>[] } | null = null;
  await page.route("**/api/training/sessions/*", async route => {
    const request = route.request();
    if (request.method() === "GET" && pending) return route.fulfill({ status: 200, json: pending });
    if (request.method() !== "PATCH") return route.continue();
    const body = request.postDataJSON() as { action: string };
    if (body.action === "FEEDBACK") {
      const response = await page.request.get(request.url());
      const current = await response.json() as { session: Record<string, unknown>; turns: Record<string, unknown>[] };
      pending = { session: { ...current.session, state: "REVISING", version: Number(current.session.version) + 1 }, turns: [...current.turns, { ordinal: current.turns.length + 1, kind: "FEEDBACK", content: { feedback } }] };
      return route.fulfill({ status: 202, json: { ...pending, error: { code: "ANSWER_FAILED", message: "The revision failed. Your feedback is saved. Retry this revision." } } });
    }
    if (body.action === "RETRY" && pending) {
      const saved = pending;
      pending = { session: { ...saved.session, state: "ACTIVE", version: Number(saved.session.version) + 1, currentAnswer: { id: "00000000-0000-4000-8000-000000000093", directAnswer: "Check the documented sync indicator and earlier feedback.", evidence: [], claims: [] } }, turns: [...saved.turns, { ordinal: saved.turns.length + 1, kind: "ANSWER", content: { answer: { id: "00000000-0000-4000-8000-000000000093", directAnswer: "Check the documented sync indicator and earlier feedback." } } }] };
      return route.fulfill({ status: 200, json: pending });
    }
    return route.continue();
  });
  await page.getByLabel("Feedback for this answer").fill(feedback);
  await page.getByRole("button", { name: "Revise with feedback" }).click();
  await expect(page.getByText("The revision failed. Your feedback is saved. Retry this revision.")).toBeVisible();
  await expect(page.locator(".training-answer .direct-answer")).toHaveText(original);
  await expect(page.getByText(feedback).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Retry revision" }).focus();
  await expect(page.getByRole("button", { name: "Retry revision" })).toBeFocused();
  await page.reload();
  await expect(page.getByText("The revision did not complete. Your feedback is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Retry revision" }).click();
  await expect(page.locator(".training-answer .direct-answer")).toHaveText("Check the documented sync indicator and earlier feedback.");
  await expect(page.getByLabel("Feedback for this answer")).toBeVisible();
});

test("distinguishes publication recovery from activation recovery", async ({ page }) => {
  const id = "00000000-0000-4000-8000-000000000094";
  const base = {
    id,
    trainerAccountId: "trainer",
    conversationId: "00000000-0000-4000-8000-000000000095",
    targetRepository: "PointCommunity/pointaudio",
    originalQuestion: "How do I recover accepted guidance?",
    state: "FAILED",
    currentAnswer: { id: "00000000-0000-4000-8000-000000000096", directAnswer: "Use the saved answer.", evidence: [], claims: [] },
    currentReport: null,
    proposalId: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    version: 4,
    publicationError: "Publication or activation failed.",
  };
  let session: Record<string, unknown> = { ...base, publishedCommit: null };
  await page.route(`**/api/training/sessions/${id}`, route => route.fulfill({ status: 200, json: { session, turns: [] } }));
  await page.goto(`/training/sessions/${id}`);
  await expect(page.getByRole("button", { name: "Retry publishing" })).toBeVisible();
  await expect(page.getByText("exact accepted answer is saved", { exact: false })).toBeVisible();

  session = { ...base, publishedCommit: "a".repeat(40) };
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry activation" })).toBeVisible();
  await expect(page.getByText("already published", { exact: false })).toBeVisible();

  const indexedCommit = "b".repeat(40);
  const acceptedPath = `research/pointguide-training/${id}/00000000-0000-4000-8000-000000000096.json`;
  session = { ...base, state: "ACTIVE_KNOWLEDGE", publishedCommit: "a".repeat(40), indexedCommit, acceptedPath };
  await page.reload();
  await expect(page.getByText("accepted guidance is active", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open active repository artifact" })).toHaveAttribute("href", `https://github.com/PointCommunity/pointaudio/blob/${indexedCommit}/${acceptedPath}`);
});
