import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/lib/agent/service";
import type { Account } from "@/lib/auth/types";
import { MemoryLearningRepository, titleFromQuestion } from "@/lib/learning/store";
import { MemoryProviderStore } from "@/lib/providers/memory-store";

const now = new Date("2026-09-07T12:00:00.000Z");
const owner: Account = {
  id: crypto.randomUUID(),
  accessIssuer: "fixture",
  accessSubject: "session-owner",
  email: "owner@example.com",
  displayName: "Session Owner",
  role: "USER",
  status: "APPROVED",
  firstLoginAt: now,
  lastLoginAt: now,
  createdAt: now,
  updatedAt: now,
  version: 1,
};

describe("owned support sessions", () => {
  it("creates bounded readable titles for short, long, and unbroken questions", () => {
    expect(titleFromQuestion("  Short   question  ")).toBe("Short question");
    expect(titleFromQuestion("This is a long question with enough words to require a readable cutoff before the maximum title length is reached for history")).toBe("This is a long question with enough words to require a readable cutoff…");
    expect(titleFromQuestion("x".repeat(100))).toBe(`${"x".repeat(69)}…`);
  });

  it("hides empty sessions and enforces owner and turn boundaries", async () => {
    const learning = new MemoryLearningRepository();
    const session = await learning.createConversation(owner.id, "Empty session");
    expect(await learning.listConversations(owner.id)).toEqual([]);
    expect(await learning.listConversations(owner.id, "missing")).toEqual([]);
    await expect(learning.reserveTurn(session.id, crypto.randomUUID())).rejects.toThrow("CONVERSATION_NOT_FOUND");
    await learning.releaseTurn(session.id, crypto.randomUUID());
    expect((await learning.getConversation(session.id, owner.id)).conversation.userTurnCount).toBe(0);
  });

  it("derives a useful title and searches question and answer content", async () => {
    const learning = new MemoryLearningRepository();
    const session = await learning.createConversation(owner.id, "PointGuide support");
    await answerQuestion({
      actor: owner,
      conversationId: session.id,
      question: "What does a red AES50 sync light on the DL32 mean?",
      deepResearch: false,
      providers: new MemoryProviderStore(),
      learning,
      fixture: true,
    });

    const byQuestion = await learning.listConversations(owner.id, "AES50");
    const byAnswer = await learning.listConversations(owner.id, "not synchronized");

    expect(byQuestion).toHaveLength(1);
    expect(byQuestion[0]).toMatchObject({
      id: session.id,
      title: "What does a red AES50 sync light on the DL32 mean?",
      userTurnCount: 1,
      latestQuestion: "What does a red AES50 sync light on the DL32 mean?",
    });
    expect(byAnswer).toHaveLength(1);
    expect(await learning.listConversations(owner.id, "aes50")).toHaveLength(1);
    expect(await learning.listConversations(crypto.randomUUID(), "AES50")).toEqual([]);
  });

  it("returns structured turns newest first and isolates ownership", async () => {
    const learning = new MemoryLearningRepository();
    const session = await learning.createConversation(owner.id, "PointGuide support");
    await answerQuestion({ actor: owner, conversationId: session.id, question: "red AES50 DL32 first", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true });
    await answerQuestion({ actor: owner, conversationId: session.id, question: "red AES50 DL32 follow-up", deepResearch: true, providers: new MemoryProviderStore(true), learning, fixture: true });

    const detail = await learning.getConversation(session.id, owner.id);
    expect(detail.conversation.userTurnCount).toBe(2);
    expect(detail.turns.map((turn) => turn.question)).toEqual([
      "red AES50 DL32 follow-up",
      "red AES50 DL32 first",
    ]);
    expect(detail.turns[0]?.answer).toMatchObject({ reviewStatus: "PASSED", confidence: "CONFIRMED" });
    expect(detail.turns[0]?.answer.evidence).toHaveLength(1);
    await expect(learning.getConversation(session.id, crypto.randomUUID())).rejects.toThrow("CONVERSATION_NOT_FOUND");
  });
});
