import { expect, test } from "@playwright/test";

test("revises an answer with feedback and preserves ordered turns after resume", async ({ page }) => {
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Training", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Training steps" }).getByText("Ask")).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Which area is this about?")).toHaveCount(0);
  await page.getByLabel("Question").fill("What does a red AES50 sync light on the DL32 mean?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("PointGuide response")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Training steps" }).getByText("Improve")).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".training-accept").getByRole("button", { name: "Accept and publish" })).toBeVisible();
  await expect(page.locator(".training-accept")).toContainText("this exact answer available to future answers");
  await expect(page.getByLabel("Feedback for this answer")).toHaveAttribute("placeholder", /numbered checks/u);
  let finishRequest!: () => void;
  const requestHeld = new Promise<void>(resolve => { finishRequest = resolve; });
  await page.route("**/api/training/sessions/*", async route => {
    if (route.request().method() === "PATCH") await requestHeld;
    await route.continue();
  });
  await page.getByLabel("Feedback for this answer").fill("Use short numbered steps and explain what I should see after each check.");
  await page.locator(".training-feedback").getByRole("button", { name: "Submit Feedback" }).click();
  await expect(page.locator(".training-feedback").getByRole("status")).toContainText("Submitting feedback and waiting for an updated answer");
  await expect(page.locator(".training-feedback").getByRole("button", { name: "Submitting feedback…" })).toBeDisabled();
  finishRequest();
  await expect(page.getByRole("heading", { name: "Updated answer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clarifying question" })).toHaveCount(0);
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Conversation so far" })).toBeVisible();
  await expect(page.getByText("Use short numbered steps", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
  await expect(page.getByText("Rate this response")).toHaveCount(0);
});

test("routes a clear training topic without repository setup and asks only when source area is ambiguous", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One focused viewport covers destination clarification.");
  const sources = [{ id: "audio", fullName: "PointCommunity/pointaudio", status: "ACTIVE" }, { id: "planning", fullName: "PointCommunity/pointplanning", status: "ACTIVE" }];
  await page.route("**/api/knowledge/sources", route => route.fulfill({ json: { sources } }));
  const id = "00000000-0000-4000-8000-000000000088";
  await page.route("**/api/training/sessions", route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { question: string; targetRepository?: string };
    if (!body.targetRepository) return route.fulfill({ status: 409, json: { error: { code: "SOURCE_AREA_REQUIRED", message: "Which area is your question about?" } } });
    expect(body.targetRepository).toBe("PointCommunity/pointplanning");
    return route.fulfill({ status: 202, json: { session: { id, originalQuestion: body.question, targetRepository: body.targetRepository, state: "ACTIVE", version: 1, currentAnswer: null }, error: { code: "ANSWER_FAILED", message: "The first answer is saved for retry." } } });
  });
  await page.route(`**/api/training/sessions/${id}`, route => route.fulfill({ json: { session: { id, originalQuestion: "How do schedules work?", targetRepository: "PointCommunity/pointplanning", state: "ACTIVE", version: 1, currentAnswer: null }, turns: [] } }));
  await page.goto("/training");
  await expect(page.getByLabel("Which area is this about?")).toHaveCount(0);
  await page.getByLabel("Question").fill("How do schedules work?");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByLabel("Which area is this about?")).toBeVisible();
  await page.getByLabel("Which area is this about?").selectOption("PointCommunity/pointplanning");
  await page.getByRole("button", { name: "Start training" }).click();
  await expect(page.getByText("Area: Planning Center")).toBeVisible();
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
  await page.locator(".training-feedback").getByRole("button", { name: "Submit Feedback" }).click();
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
  await expect(page.getByRole("navigation", { name: "Training steps" }).getByText("Publish")).toHaveAttribute("aria-current", "step");
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
  await expect(page.getByRole("navigation", { name: "Training steps" }).getByText("Publish")).not.toHaveAttribute("aria-current", "step");
  await expect(page.getByText("accepted guidance is active", { exact: false })).toBeVisible();
  await expect(page.getByText("Ready to use", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open active repository artifact" })).toHaveAttribute("href", `https://github.com/PointCommunity/pointaudio/blob/${indexedCommit}/${acceptedPath}`);
});

test("separates an essential clarification from the saved answer and gates acceptance until revision", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One narrow viewport covers the clarification flow.");
  const id = "00000000-0000-4000-8000-000000000097";
  const firstId = "00000000-0000-4000-8000-000000000098";
  let session: Record<string, unknown> = { id, targetRepository: "PointCommunity/pointaudio", originalQuestion: "How many local inputs?", state: "ACTIVE", version: 2, currentAnswer: { id: firstId, directAnswer: "The count depends on the console model.", clarifyingQuestion: "Is the console an M32R?", steps: [], safetyAndAssumptions: [], evidence: [], claims: [] } };
  let turns: Record<string, unknown>[] = [{ ordinal: 1, kind: "ANSWER", content: { answer: session.currentAnswer } }];
  let finishRequest!: () => void;
  const requestHeld = new Promise<void>(resolve => { finishRequest = resolve; });
  await page.route(`**/api/training/sessions/${id}`, async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: { session, turns } });
    const body = route.request().postDataJSON() as { action: string; response: string };
    expect(body).toMatchObject({ action: "CLARIFY", response: "Yes, M32R" });
    await requestHeld;
    turns = [...turns, { ordinal: 2, kind: "CLARIFICATION", content: { question: "Is the console an M32R?", response: body.response } }, { ordinal: 3, kind: "ANSWER", content: { answer: { id: "00000000-0000-4000-8000-000000000099", directAnswer: "The M32R has 16 local microphone sockets.", clarifyingQuestion: null } } }];
    session = { ...session, state: "ACTIVE", version: 4, currentAnswer: { id: "00000000-0000-4000-8000-000000000099", directAnswer: "The M32R has 16 local microphone sockets.", clarifyingQuestion: null, evidence: [], claims: [] } };
    return route.fulfill({ status: 200, json: { session, turns } });
  });
  await page.goto(`/training/sessions/${id}`);
  await expect(page.getByRole("heading", { name: "PointGuide response" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clarifying question" })).toBeVisible();
  await expect(page.getByText("The count depends on the console model.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeDisabled();
  await page.getByLabel("Your response").fill("Yes, M32R");
  await page.locator(".training-clarification").getByRole("button", { name: "Submit Feedback" }).click();
  await expect(page.locator(".training-clarification").getByRole("status")).toContainText("Submitting feedback and waiting for an updated answer");
  await expect(page.locator(".training-clarification").getByRole("button", { name: "Submitting feedback…" })).toBeDisabled();
  finishRequest();
  await expect(page.getByRole("heading", { name: "Updated answer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clarifying question" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept and publish" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Updated answer" })).toBeVisible();
  await expect(page.getByText("Yes, M32R")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("does not claim feedback was saved when the response is lost", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "One focused viewport covers uncertain submission recovery.");
  const id = "00000000-0000-4000-8000-000000000101";
  const session = { id, targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I route the M32?", state: "ACTIVE", version: 2, currentAnswer: { id: "00000000-0000-4000-8000-000000000102", directAnswer: "Check the routing page.", steps: [], safetyAndAssumptions: [], evidence: [], claims: [] } };
  await page.route(`**/api/training/sessions/${id}`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.fulfill({ json: { session, turns: [] } }));
  await page.goto(`/training/sessions/${id}`);
  const feedback = page.locator(".training-feedback");
  await feedback.getByLabel("Feedback for this answer").fill("Explain which M32 routing page and why.");
  await feedback.getByRole("button", { name: "Submit Feedback" }).click();
  await expect(feedback.getByRole("alert")).toContainText("Feedback may have been saved. Reload this session to check before submitting again.");
  await expect(feedback.getByRole("button", { name: "Submit Feedback" })).toBeEnabled();
  await expect(feedback.getByLabel("Feedback for this answer")).toHaveValue("Explain which M32 routing page and why.");
});
