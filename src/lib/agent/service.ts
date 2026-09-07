import type { Account } from "@/lib/auth/types";
import { orchestrateAnswer, type ReviewMode } from "./orchestrator";
import type { AnswerDraft, EvidenceItem } from "./schema";
import { demoChunks } from "@/lib/evidence/demo";
import type { IndexedChunk } from "@/lib/evidence/search";
import { searchCorpus } from "@/lib/evidence/search";
import type { ProviderConfigurationStore } from "@/lib/providers/types";
import type { LearningRepository } from "@/lib/learning/store";
import { generateAnswer, generateReview, type ModelRuntime } from "./models";

function evidenceDraft(question: string, evidence: EvidenceItem[]): AnswerDraft {
  if (!evidence.length) return { directAnswer: "The current source repositories do not contain enough evidence to answer that yet.", steps: ["Confirm the exact device, model, location, and observed state so verified documentation can be added."], safetyAndAssumptions: ["No equipment identity is assumed from the question."], confidence: "UNKNOWN", claims: [{ id: "unknown", text: `The answer to “${question.slice(0, 240)}” is not established by the current evidence set.`, kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] }] };
  return { directAnswer: "A red AES50 SYNC light means the DL32's AES50 connection is present but not synchronized. Verify the clock relationship and cable path before changing routing.", steps: ["Confirm the indicator is red—not off—and note whether it is on AES50 A or B.", "Verify the connected console and DL32 are configured for one valid clock relationship before changing signal routing."], safetyAndAssumptions: ["This applies to a confirmed Midas DL32. Clock changes can interrupt audio; record current state and use an approved service window."], confidence: "CONFIRMED", claims: [{ id: "dl32-sync-red", text: "On a DL32, a red AES50 SYNC LED indicates that the AES50 connection is not synchronized.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id] }] };
}

export async function answerQuestion(input: { actor: Account; conversationId: string; question: string; deepResearch: boolean; providers: ProviderConfigurationStore; learning: LearningRepository; modelRuntime?: ModelRuntime; fixture: boolean; chunks?: IndexedChunk[]; maxTurns?: number }) {
  if (!await input.learning.ownsConversation(input.conversationId, input.actor.id)) throw new Error("CONVERSATION_NOT_FOUND");
  const maxTurns = input.maxTurns ?? 6;
  const turnNumber = await input.learning.reserveTurn(input.conversationId, input.actor.id, maxTurns);
  try {
  const history = await input.learning.listMessages(input.conversationId, input.actor.id);
  const evidence = searchCorpus(input.question, input.chunks ?? demoChunks);
  const reviewSetting = await input.providers.getReviewSetting();
  if (input.deepResearch && !reviewSetting.enabled) throw new Error("REVIEW_DISABLED");
  const primaryProfile = await input.providers.getExecutionProfile("PRIMARY");
  const reviewerProfile = input.deepResearch ? await input.providers.getExecutionProfile("REVIEWER") : null;
  if (!input.fixture && (!primaryProfile || !input.modelRuntime)) throw new Error("PRIMARY_NOT_CONFIGURED");
  if (input.deepResearch && !input.fixture && !reviewerProfile) throw new Error("REVIEWER_NOT_CONFIGURED");
  const mode: ReviewMode = input.deepResearch ? "DEEP_RESEARCH" : "NONE";
  const answer = await orchestrateAnswer({
    evidence, mode,
    primary: () => primaryProfile && input.modelRuntime ? generateAnswer(primaryProfile, input.question, evidence, input.modelRuntime, history) : Promise.resolve(evidenceDraft(input.question, evidence)),
    reviewer: mode === "DEEP_RESEARCH" ? (draft, items) => reviewerProfile && input.modelRuntime
      ? generateReview(reviewerProfile, draft, items, input.modelRuntime)
      : Promise.resolve({ findings: draft.claims.map((claim) => ({ claimId: claim.id, verdict: claim.status === "SUPPORTED" ? "SUPPORTED" as const : "REJECTED" as const, rationaleCode: claim.status === "SUPPORTED" ? "ENTAILED" as const : "INSUFFICIENT" as const })) }) : undefined,
  });
  const stored = await input.learning.saveAnswer({ conversationId: input.conversationId, question: input.question, answer, evidence, reviewMode: mode });
  return { answer: { ...stored, evidence }, reviewEnabled: reviewSetting.enabled, usage: { turnNumber, maxTurns, followUpsRemaining: Math.max(0, maxTurns - turnNumber) } };
  } catch (error) {
    await input.learning.releaseTurn(input.conversationId, input.actor.id);
    throw error;
  }
}
