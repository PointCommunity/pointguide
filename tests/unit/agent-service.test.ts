import { describe, expect, it } from "vitest";
import { answerQuestion } from "@/lib/agent/service";
import { MemoryLearningRepository } from "@/lib/learning/store";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import type { Account } from "@/lib/auth/types";

const now = new Date();
const actor: Account = { id: crypto.randomUUID(), accessIssuer: "fixture", accessSubject: "owner", email: "owner@example.com", displayName: "Owner", role: "OWNER", status: "APPROVED", firstLoginAt: now, lastLoginAt: now, createdAt: now, updatedAt: now, version: 1 };

describe("persisted answer service", () => {
  it("persists normal and reviewed evidence-grounded answers", async () => {
    const learning = new MemoryLearningRepository();
    const conversation = await learning.createConversation(actor.id, "support");
    const normal = await answerQuestion({ actor, conversationId: conversation.id, question: "red AES50 DL32", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true });
    expect(normal.answer.reviewStatus).toBe("NOT_REQUESTED");
    expect(normal.answer.evidence).toHaveLength(1);
    const reviewed = await answerQuestion({ actor, conversationId: conversation.id, question: "red AES50 DL32", deepResearch: true, providers: new MemoryProviderStore(true), learning, fixture: true });
    expect(reviewed.answer.reviewStatus).toBe("PASSED");
    const unknown = await answerQuestion({ actor, conversationId: conversation.id, question: "Which projector is installed?", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true });
    expect(unknown.answer.confidence).toBe("UNKNOWN");
  });

  it("rejects unavailable review and another account's conversation", async () => {
    const learning = new MemoryLearningRepository();
    const conversation = await learning.createConversation(actor.id, "support");
    await expect(answerQuestion({ actor, conversationId: conversation.id, question: "q", deepResearch: true, providers: new MemoryProviderStore(), learning, fixture: true })).rejects.toThrow("REVIEW_DISABLED");
    await expect(answerQuestion({ actor: { ...actor, id: crypto.randomUUID() }, conversationId: conversation.id, question: "q", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true })).rejects.toThrow("CONVERSATION_NOT_FOUND");
    await expect(answerQuestion({ actor, conversationId: conversation.id, question: "q", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: false })).rejects.toThrow("PRIMARY_NOT_CONFIGURED");
  });

  it("retains context for one initial question and five follow-ups, then stops", async () => {
    const learning = new MemoryLearningRepository();
    const conversation = await learning.createConversation(actor.id, "bounded support");
    for (let turn = 1; turn <= 6; turn += 1) {
      const result = await answerQuestion({ actor, conversationId: conversation.id, question: `red AES50 DL32 turn ${turn}`, deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true });
      expect(result.usage.turnNumber).toBe(turn);
      expect(result.usage.followUpsRemaining).toBe(6 - turn);
    }
    expect(await learning.listMessages(conversation.id, actor.id)).toHaveLength(12);
    await expect(answerQuestion({ actor, conversationId: conversation.id, question: "one more", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true })).rejects.toThrow("TURN_LIMIT_REACHED");
  });

  it("stores immutable feedback context and rejects duplicate ratings", async () => {
    const learning = new MemoryLearningRepository();
    const input = { answerId: "a", accountId: "u", rating: "HELPFUL" as const, questionFingerprint: "q", corpusCommit: "c", profileRevisionIds: [], evidenceIds: [] };
    await learning.saveFeedback(input);
    expect(await learning.listFeedback()).toHaveLength(1);
    await expect(learning.saveFeedback(input)).rejects.toThrow("FEEDBACK_EXISTS");
  });
});
