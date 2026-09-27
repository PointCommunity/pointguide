import { expect, it, vi } from "vitest";
import * as search from "@/lib/evidence/search";
import { answerQuestion } from "@/lib/agent/service";
import { MemoryLearningRepository } from "@/lib/learning/store";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import type { Account } from "@/lib/auth/types";
import type { AcceptedGuidance } from "@/lib/training/knowledge";
import type { ProviderConfigurationStore } from "@/lib/providers/types";
import * as models from "@/lib/agent/models";

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

it.each([false, true])("preserves complete partial Training through lossy generation; rejected=%s", async rejected => {
  const retrieval = vi.spyOn(search, "searchCorpus");
  const assessment = vi.spyOn(models, "generateTrainingAssessment").mockResolvedValue({ selected: [{ id: guidance.id, coverage: "PARTIAL", missing: ["AES50 routing"], rationale: "Only socket guidance is accepted." }] });
  const generation = vi.spyOn(models, "generateAnswer").mockResolvedValue({ directAnswer: "Routing supplement.", steps: [], safetyAndAssumptions: [], confidence: "SUPPORTED", claims: [{ id: "accepted-step-0", text: "AES50 routing uses the input routing menu.", kind: "ACTIONABLE", status: "SUPPORTED", evidenceIds: ["repo:other"] }] });
  const review = vi.spyOn(models, "generateReview").mockImplementation(async (_profile, draft) => ({ findings: draft.claims.map(claim => ({ claimId: claim.id, verdict: rejected && claim.kind === "SAFETY" ? "REJECTED" : "SUPPORTED", rationaleCode: rejected && claim.kind === "SAFETY" ? "INSUFFICIENT" : "ENTAILED" })), claimOrder: draft.claims.map(claim => claim.id) }));
  const providers = { getReviewSetting: async () => ({ enabled: false }), getExecutionProfile: async () => ({ id: "configured" }) } as unknown as ProviderConfigurationStore;
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "partial synthesis");
  const result = answerQuestion({ actor, conversationId: conversation.id, question: `${question} And how is AES50 routed?`, deepResearch: false, providers, learning, fixture: false, modelRuntime: { secretKey: "unused", codexClient: { request: vi.fn() } }, chunks, guidance: [guidance] });
  try {
    if (rejected) await expect(result).rejects.toThrow("Accepted Training could not be preserved after review");
    else {
      const { answer } = await result;
      expect(answer.steps).toEqual([...guidance.answer!.steps, "AES50 routing uses the input routing menu."]);
      expect(answer.safetyAndAssumptions).toEqual(expect.arrayContaining(guidance.answer!.safetyAndAssumptions));
      expect(answer.confidence).toBe("TENTATIVE");
      expect(answer.claims).toContainEqual(expect.objectContaining({ id: "training-unresolved", text: expect.stringContaining("AES50 routing") }));
      expect(answer.directAnswer).toBe(guidance.answer!.directAnswer);
      expect(answer.claims.filter(claim => claim.evidenceIds.includes(guidance.id))).toHaveLength(3);
    }
    expect(retrieval).toHaveBeenCalledWith("AES50 routing; M32R", chunks);
  } finally { retrieval.mockRestore(); assessment.mockRestore(); generation.mockRestore(); review.mockRestore(); }
});

it.each([false, true])("does not treat unused or rejected supplemental retrieval as a complete answer; rejected=%s", async rejected => {
  const assessment = vi.spyOn(models, "generateTrainingAssessment").mockResolvedValue({ selected: [{ id: guidance.id, coverage: "PARTIAL", missing: ["AES50 routing", "USB recording"], rationale: "Only sockets are accepted." }] });
  const generation = vi.spyOn(models, "generateAnswer").mockResolvedValue({ directAnswer: guidance.directAnswer, steps: [], safetyAndAssumptions: [], confidence: "SUPPORTED", claims: [{ id: "generated", text: rejected ? "AES50 routing uses the input routing menu." : guidance.directAnswer, kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [rejected ? "repo:other" : guidance.id] }] });
  const review = vi.spyOn(models, "generateReview").mockImplementation(async (_profile, draft) => ({ findings: draft.claims.map(claim => ({ claimId: claim.id, verdict: rejected && claim.id === "generated" ? "REJECTED" : "SUPPORTED", rationaleCode: rejected && claim.id === "generated" ? "INSUFFICIENT" : "ENTAILED" })), claimOrder: draft.claims.map(claim => claim.id) }));
  const providers = { getReviewSetting: async () => ({ enabled: false }), getExecutionProfile: async () => ({ id: "configured" }) } as unknown as ProviderConfigurationStore;
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "missing supplement");
  const result = answerQuestion({ actor, conversationId: conversation.id, question: `${question} And how is AES50 routed?`, deepResearch: false, providers, learning, fixture: false, modelRuntime: { secretKey: "unused", codexClient: { request: vi.fn() } }, chunks, guidance: [guidance] });
  try {
    const { answer } = await result;
    expect(answer.confidence).toBe("TENTATIVE");
    expect(answer.claims).toContainEqual(expect.objectContaining({ id: "training-unresolved", kind: "UNKNOWN", status: "UNKNOWN", text: expect.stringContaining("AES50 routing") }));
    expect(answer.claims.find(claim => claim.id === "training-unresolved")?.text).toContain("USB recording");
    expect(answer.steps).toEqual(guidance.answer!.steps);
    expect(answer.safetyAndAssumptions).toContain(guidance.answer!.safetyAndAssumptions[0]);
    expect(answer.claims.some(claim => claim.id === "generated")).toBe(false);
  } finally { assessment.mockRestore(); generation.mockRestore(); review.mockRestore(); }
});

it("retains a bus procedure when trainer feedback names the model only present in its steps", async () => {
  const originalQuestion = "How do I add a channel to a bus?";
  const record = { ...guidance, question: originalQuestion, directAnswer: "Use Sends on Fader.", answer: { ...guidance.answer!, directAnswer: "Use Sends on Fader.", steps: ["On the M32R, select the destination bus.", "Enable Sends on Fader.", "Raise the channel send."], safetyAndAssumptions: ["Verify the selected layer before moving a fader."], claims: [] } };
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "training");
  const result = await answerQuestion({ actor, conversationId: conversation.id, question: originalQuestion, deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true, chunks, guidance: [record], training: true, trainingHistory: [{ actor: "USER", content: "Keep all M32R steps and warnings." }] });
  expect(result.answer.guidance).toEqual([record]);
  expect(result.answer.steps).toEqual(record.answer.steps);
  expect(result.answer.safetyAndAssumptions).toEqual(expect.arrayContaining(record.answer.safetyAndAssumptions));
  expect(result.answer.confidence).toBe("TENTATIVE");
  expect(result.answer.claims).toContainEqual(expect.objectContaining({ id: "training-unresolved", kind: "UNKNOWN" }));
  expect(result.answer.evidence[0].kind).toBe("ACCEPTED_TRAINING");
});
