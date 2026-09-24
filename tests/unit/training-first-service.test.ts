import { expect, it, vi } from "vitest";
import * as search from "@/lib/evidence/search";
import { answerQuestion } from "@/lib/agent/service";
import { MemoryLearningRepository } from "@/lib/learning/store";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import type { Account } from "@/lib/auth/types";
import type { AcceptedGuidance } from "@/lib/training/knowledge";

const now = new Date();
const actor: Account = { id: crypto.randomUUID(), accessIssuer: "fixture", accessSubject: "owner", email: "owner@example.com", displayName: "Owner", role: "OWNER", status: "APPROVED", firstLoginAt: now, lastLoginAt: now, createdAt: now, updatedAt: now, version: 1 };
const question = "How many local mic sockets does the M32R have?";
const answerId = crypto.randomUUID();
const guidance: AcceptedGuidance = { id: `training:${"a".repeat(64)}`, repository: "PointCommunity/pointaudio", path: `research/pointguide-training/${crypto.randomUUID()}/${answerId}.json`, digest: "a".repeat(64), sourceCommit: "b".repeat(40), indexedCommit: "c".repeat(40), question, directAnswer: "The M32R has 16 local mic sockets.", evidenceIds: ["repo:manual"], acceptedAt: "2026-09-15T12:00:00Z", answer: { id: answerId, directAnswer: "The M32R has 16 local mic sockets.", steps: ["Inspect local sockets."], safetyAndAssumptions: ["Do not infer physical sockets from channel count."], confidence: "SUPPORTED", claims: [], evidence: [{ id: "repo:manual" }] } };
const chunks = [{ chunkId: "other", sourceId: "manual", title: "M32R routing", path: "docs/routing.txt", locator: "Routing", authority: "manufacturer", capturedAt: now.toISOString(), digest: "d".repeat(64), text: "AES50 routing uses the input routing menu.", metadata: { product: "M32R" } }] as unknown as search.IndexedChunk[];

it("answers a complete match from training before corpus search and cites its published artifact", async () => {
  const spy = vi.spyOn(search, "searchCorpus");
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "support");
  const result = await answerQuestion({ actor, conversationId: conversation.id, question, deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true, chunks, guidance: [guidance] });
  expect(spy).not.toHaveBeenCalled();
  expect(result.answer.evidence).toMatchObject([{ kind: "ACCEPTED_TRAINING", path: guidance.path, digest: guidance.digest }]);
  expect(result.answer.steps).toContain("Inspect local sockets.");
  expect(result.answer.safetyAndAssumptions).toContain("Do not infer physical sockets from channel count.");
  expect(result.answer.claims.every(claim => claim.evidenceIds.includes(guidance.id))).toBe(true);
  expect((await learning.getConversation(conversation.id, actor.id)).turns[0]?.answer.evidence[0]).toMatchObject({ path: guidance.path, locator: expect.stringContaining(guidance.indexedCommit) });
  spy.mockRestore();
});

it("keeps partial training and searches for the missing part", async () => {
  const spy = vi.spyOn(search, "searchCorpus");
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "support");
  const result = await answerQuestion({ actor, conversationId: conversation.id, question: `${question} And how is AES50 routed?`, deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true, chunks, guidance: [guidance] });
  expect(spy).toHaveBeenCalledOnce();
  expect(result.answer.evidence.map(item => item.kind)).toEqual(["ACCEPTED_TRAINING", "REPOSITORY"]);
  expect(result.answer.confidence).not.toBe("CONFIRMED");
  spy.mockRestore();
});
