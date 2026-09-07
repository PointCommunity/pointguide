import { describe, expect, it } from "vitest";
import { MemoryTrainingSessionStore } from "@/lib/training/store";

describe("organic training workflow", () => {
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
});
