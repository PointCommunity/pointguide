import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryTrainingSessionStore } from "@/lib/training/store";
import type { SourceRepositoryRecord } from "@/lib/sources/types";

afterEach(() => vi.useRealTimers());

describe("organic training workflow", () => {
  it("persists an essential clarification separately and refuses acceptance until a completed revision", async () => {
    const store = new MemoryTrainingSessionStore();
    const source = { id: crypto.randomUUID(), fullName: "PointCommunity/pointaudio", status: "ACTIVE", indexedCommit: "a".repeat(40), version: 1 } as SourceRepositoryRecord;
    const session = await store.create({ trainerAccountId: "trainer", conversationId: "conversation", targetRepository: source.fullName, originalQuestion: "Which console inputs?" });
    const firstId = crypto.randomUUID();
    const pending = await store.saveAnswer(session.id, "trainer", { id: firstId, directAnswer: "The physical connector count depends on the model.", clarifyingQuestion: "Is the console an M32 or M32R?", evidence: [] });
    await expect(store.acceptAnswer(session.id, "trainer", pending.version, firstId, source)).rejects.toThrow(/clarif|question/i);
    await expect(store.saveClarification(session.id, "trainer", pending.version, firstId, "M32R")).resolves.toMatchObject({ state: "REVISING" });
    const turns = await store.listTurns(session.id, "trainer");
    expect(turns[1]).toMatchObject({ kind: "CLARIFICATION", content: { question: "Is the console an M32 or M32R?", response: "M32R" } });
    const revisedId = crypto.randomUUID();
    const revised = await store.saveAnswer(session.id, "trainer", { id: revisedId, directAnswer: "The M32R has 16 local microphone sockets.", evidence: [] });
    expect((await store.acceptAnswer(session.id, "trainer", revised.version, revisedId, source)).state).toBe("PUBLISHING");
    expect(JSON.parse((await store.get(session.id, "trainer")).acceptedContent!)).not.toHaveProperty("clarifyingQuestion");
  });
  it("preserves ordered feedback and answers, and binds acceptance to the visible answer", async () => {
    const store = new MemoryTrainingSessionStore();
    const source = { id: "00000000-0000-4000-8000-000000000010", fullName: "PointCommunity/pointaudio", status: "ACTIVE", indexedCommit: "a".repeat(40), version: 1 } as SourceRepositoryRecord;
    const session = await store.create({ trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "How should this be explained?" });
    const firstId = crypto.randomUUID(); const secondId = crypto.randomUUID();
    const first = await store.saveAnswer(session.id, "trainer", { id: firstId, directAnswer: "Initial response", evidence: [] });
    await store.saveFeedback(session.id, "trainer", first.version, firstId, "Use beginner steps.");
    const revised = await store.saveAnswer(session.id, "trainer", { id: secondId, directAnswer: "Use beginner steps.", evidence: [] });
    expect((await store.listTurns(session.id, "trainer")).map((turn) => turn.kind)).toEqual(["ANSWER", "FEEDBACK", "ANSWER"]);
    await expect(store.acceptAnswer(session.id, "trainer", first.version, firstId, source)).rejects.toThrow();
    const accepted = await store.acceptAnswer(session.id, "trainer", revised.version, secondId, source);
    expect(accepted.state).toBe("PUBLISHING");
    expect(accepted.currentAnswer).toMatchObject({ id: secondId, directAnswer: "Use beginner steps." });
    expect(accepted.acceptedDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(accepted.acceptedContent!)).toMatchObject({ answerId: secondId, answer: { directAnswer: "Use beginner steps." } });
    await expect(store.saveFeedback(session.id, "trainer", revised.version, secondId, "Too late")).rejects.toThrow();
    await store.failPublication(session.id, "trainer", "SOURCE_CHANGED");
    const retry = await store.retryPublication(session.id, "trainer", source);
    expect(retry).toMatchObject({ state: "PUBLISHING", acceptedDigest: accepted.acceptedDigest, acceptedContent: accepted.acceptedContent });
    await expect(store.retryPublication(session.id, "trainer", source)).rejects.toThrow();
    await expect(store.listTurns(session.id, "other-trainer")).rejects.toThrow("not found");
  });

  it("requires response feedback, an accepted report, then an explicit outcome", async () => {
    const store = new MemoryTrainingSessionStore();
    let session = await store.create({ trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "How should this be explained?" });
    session = await store.saveAnswer(session.id, "trainer", { directAnswer: "Initial response" });
    session = await store.saveReport(session.id, "trainer", "NOT_HELPFUL", "Use beginner steps.", { summary: "Use clearer steps.", learned: ["The user needs more guidance."], responseChanges: ["Use numbered steps."], evidenceBoundary: "Feedback is not factual evidence." });
    expect(session.state).toBe("REPORT_READY");
    await expect(store.markProposed(session.id, "trainer", "proposal")).rejects.toThrow("current training state");
    session = await store.acceptReport(session.id, "trainer");
    expect(session.state).toBe("REPORT_ACCEPTED");
    session = await store.markProposed(session.id, "trainer", "proposal");
    expect(session).toMatchObject({ state: "PROPOSED", proposalId: "proposal" });
  });

  it("isolates each trainer's sessions", async () => {
    const store = new MemoryTrainingSessionStore();
    const session = await store.create({ trainerAccountId: "trainer-a", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "Question" });
    await expect(store.get(session.id, "trainer-b")).rejects.toThrow("not found");
  });

  it("lists, revises, and wipes only the trainer's accepted learning session", async () => {
    const store = new MemoryTrainingSessionStore();
    const first = await store.create({ trainerAccountId: "trainer-a", conversationId: "conversation-a", targetRepository: "PointCommunity/pointaudio", originalQuestion: "Question A" });
    await store.create({ trainerAccountId: "trainer-b", conversationId: "conversation-b", targetRepository: "PointCommunity/lighting", originalQuestion: "Question B" });

    expect(await store.list("trainer-a")).toHaveLength(1);
    expect(await store.get(first.id, "trainer-a")).toMatchObject({ currentAnswer: null, currentReport: null });
    await expect(store.acceptReport(first.id, "trainer-a")).rejects.toThrow("current training state");

    let session = await store.saveAnswer(first.id, "trainer-a", { directAnswer: "First answer" });
    session = await store.saveReport(session.id, "trainer-a", "HELPFUL", "Keep the structure.", { summary: "Keep it concise.", learned: ["Concise works."], responseChanges: ["Retain structure."], evidenceBoundary: "Feedback is behavioral guidance only." });
    session = await store.saveAnswer(session.id, "trainer-a", { directAnswer: "Revised answer" });
    expect(session).toMatchObject({ state: "ACTIVE", currentReport: null });

    session = await store.saveReport(session.id, "trainer-a", "HELPFUL", "Good.", { summary: "Accepted.", learned: ["Clear steps help."], responseChanges: ["Use clear steps."], evidenceBoundary: "No facts learned." });
    session = await store.acceptReport(session.id, "trainer-a");
    await store.wipe(session.id, "trainer-a");
    await expect(store.get(session.id, "trainer-a")).rejects.toThrow("not found");
    await expect(store.wipe("missing", "trainer-a")).rejects.toThrow("not found");
  });

  it("searches only the current trainer's sessions and returns the newest activity first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
    const store = new MemoryTrainingSessionStore();
    const older = await store.create({ trainerAccountId: "trainer-a", conversationId: "conversation-a", targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I route a monitor mix?" });
    vi.setSystemTime(new Date("2026-09-07T12:01:00.000Z"));
    const newer = await store.create({ trainerAccountId: "trainer-a", conversationId: "conversation-b", targetRepository: "PointCommunity/lighting", originalQuestion: "Why is the lobby projector dark?" });
    await store.saveAnswer(newer.id, "trainer-a", { directAnswer: "Check the projector input source." });
    await store.create({ trainerAccountId: "trainer-b", conversationId: "conversation-c", targetRepository: "PointCommunity/lighting", originalQuestion: "Private projector session" });

    expect((await store.list("trainer-a")).map((session) => session.id)).toEqual([newer.id, older.id]);
    expect(await store.list("trainer-a", "projector input")).toEqual([expect.objectContaining({ id: newer.id })]);
    expect(await store.list("trainer-a", "private")).toEqual([]);
  });
});
