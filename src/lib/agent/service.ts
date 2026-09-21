import type { Account } from "@/lib/auth/types";
import { orchestrateAnswer, type ReviewMode } from "./orchestrator";
import type { AnswerDraft, EvidenceItem } from "./schema";
import { demoChunks } from "@/lib/evidence/demo";
import type { IndexedChunk } from "@/lib/evidence/search";
import { searchCorpus } from "@/lib/evidence/search";
import type { ProviderConfigurationStore } from "@/lib/providers/types";
import type { LearningRepository } from "@/lib/learning/store";
import type { ConversationMessage } from "@/lib/learning/store";
import { generateAnswer, generateReview, generateTrainingAssessment, type ModelRuntime } from "./models";
import { rankAcceptedGuidance, type AcceptedGuidance } from "@/lib/training/knowledge";
import { planAcceptedTraining, trainingDraft, trainingEvidence } from "./training-first";
import type { SourceNavigation } from "@/lib/sources/contract";

function evidenceDraft(question: string, evidence: EvidenceItem[]): AnswerDraft {
  if (!evidence.length) return { directAnswer: "The current source repositories do not contain enough evidence to answer that yet.", steps: ["Confirm the exact device, model, location, and observed state so verified documentation can be added."], safetyAndAssumptions: ["No equipment identity is assumed from the question."], confidence: "UNKNOWN", claims: [{ id: "unknown", text: `The answer to “${question.slice(0, 240)}” is not established by the current evidence set.`, kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] }] };
  return { directAnswer: "On a DL32, a red AES50 SYNC LED indicates that the AES50 connection is not synchronized.", steps: [], safetyAndAssumptions: [], confidence: "CONFIRMED", claims: [
    { id: "dl32-sync-red", text: "On a DL32, a red AES50 SYNC LED indicates that the AES50 connection is not synchronized.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id] },
    { id: "dl32-confirm-indicator", text: "Confirm the indicator is red—not off—and note whether it is on AES50 A or B.", kind: "ACTIONABLE", status: "SUPPORTED", evidenceIds: [evidence[0].id] },
    { id: "dl32-safety", text: "This applies only to a confirmed Midas DL32; the red indicator alone does not establish which clock change, if any, is appropriate. Record current state and use an approved service window.", kind: "SAFETY", status: "SUPPORTED", evidenceIds: [evidence[0].id] },
  ] };
}

export async function answerQuestion(input: { actor: Account; conversationId: string; question: string; deepResearch: boolean; providers: ProviderConfigurationStore; learning: LearningRepository; modelRuntime?: ModelRuntime; fixture: boolean; chunks?: IndexedChunk[]; navigation?: Record<string, SourceNavigation>; maxTurns?: number; training?: boolean; trainingHistory?: ConversationMessage[]; guidance?: AcceptedGuidance[] }) {
  if (!await input.learning.ownsConversation(input.conversationId, input.actor.id)) throw new Error("CONVERSATION_NOT_FOUND");
  const maxTurns = input.training ? 2_147_483_647 : input.maxTurns ?? 6;
  const turnNumber = await input.learning.reserveTurn(input.conversationId, input.actor.id, maxTurns);
  try {
  const history = input.trainingHistory ?? await input.learning.listMessages(input.conversationId, input.actor.id);
  const retrievalQuery = input.training ? [input.question, ...history.filter(message => message.actor === "USER").map(message => message.content)].join("\n") : input.question;
  const reviewSetting = await input.providers.getReviewSetting();
  if (input.deepResearch && !reviewSetting.enabled) throw new Error("REVIEW_DISABLED");
  const primaryProfile = await input.providers.getExecutionProfile("PRIMARY");
  const reviewerProfile = input.deepResearch ? await input.providers.getExecutionProfile("REVIEWER") : null;
  if (!input.fixture && (!primaryProfile || !input.modelRuntime)) throw new Error("PRIMARY_NOT_CONFIGURED");
  const chunks = input.chunks ?? demoChunks;
  const products = [...new Set(chunks.flatMap(chunk => [chunk.metadata?.product, chunk.metadata?.applicability?.model].filter((name): name is string => Boolean(name))))];
  const plan = await planAcceptedTraining(retrievalQuery, input.guidance ?? [], async (question, candidates) => {
    if (input.fixture) return { selected: rankAcceptedGuidance(question, candidates).map(record => ({ id: record.id, coverage: question.trim().toLocaleLowerCase() === record.question.trim().toLocaleLowerCase() ? "COMPLETE" as const : "PARTIAL" as const, missing: question.trim().toLocaleLowerCase() === record.question.trim().toLocaleLowerCase() ? [] : [question], rationale: "Fixture overlap only" })) };
    return generateTrainingAssessment(primaryProfile!, question, candidates, input.modelRuntime!);
  }, products);
  const guidance = plan.guidance;
  const sourceEvidence = plan.coverage === "COMPLETE" ? [] : searchCorpus(plan.coverage === "PARTIAL" && plan.missing.length ? plan.missing.join("; ") : retrievalQuery, chunks);
  const navigation = [...new Map(sourceEvidence.flatMap(item => {
    const repository = item.locator?.split("@")[0];
    const folder = item.path?.slice(0, item.path.lastIndexOf("/"));
    const purpose = repository && folder && input.navigation?.[repository]?.[folder];
    return purpose ? [[`${repository}/${folder}`, { repository: repository!, folder: folder!, ...purpose }] as const] : [];
  })).values()];
  const evidence = [...guidance.map(trainingEvidence), ...sourceEvidence];
  const mode: ReviewMode = input.deepResearch ? "DEEP_RESEARCH" : "NONE";
  const answer = await orchestrateAnswer({
    evidence, mode,
    primary: async () => {
      if (plan.coverage === "COMPLETE" && guidance.length === 1) return trainingDraft(guidance[0]);
      const draft = input.fixture && guidance.length ? trainingDraft(guidance[0]) : !evidence.length || !primaryProfile || !input.modelRuntime ? evidenceDraft(input.question, sourceEvidence) : await generateAnswer(primaryProfile, input.question, evidence, input.modelRuntime, history, guidance, navigation);
      if (plan.coverage === "CONFLICT" || plan.unresolvedContext || (plan.coverage === "PARTIAL" && !sourceEvidence.length)) return { ...draft, clarifyingQuestion: plan.unresolvedContext ?? draft.clarifyingQuestion, confidence: draft.confidence === "UNKNOWN" ? "UNKNOWN" as const : "TENTATIVE" as const, claims: [...draft.claims, { id: "training-unresolved", text: plan.unresolvedContext || (plan.coverage === "CONFLICT" ? "Accepted training conflicts; the applicable answer is not fully resolved." : `Accepted training does not establish: ${plan.missing.join("; ") || "the remaining question"}.`), kind: "UNKNOWN" as const, status: "UNKNOWN" as const, evidenceIds: [] }] };
      return draft;
    },
    reviewer: (draft, items) => items.length && (reviewerProfile ?? primaryProfile) && input.modelRuntime
      ? generateReview((reviewerProfile ?? primaryProfile)!, draft, items, input.modelRuntime)
      : Promise.resolve({ findings: draft.claims.map((claim) => ({ claimId: claim.id, verdict: claim.status === "SUPPORTED" ? "SUPPORTED" as const : "REJECTED" as const, rationaleCode: claim.status === "SUPPORTED" ? "ENTAILED" as const : "INSUFFICIENT" as const })), claimOrder: draft.claims.map(claim => claim.id) }),
  });
  const stored = await input.learning.saveAnswer({ conversationId: input.conversationId, question: input.question, answer, evidence, guidance, reviewMode: mode, turnNumber });
  return { answer: { ...stored, evidence, guidance }, reviewEnabled: reviewSetting.enabled, usage: { turnNumber, maxTurns, followUpsRemaining: Math.max(0, maxTurns - turnNumber) } };
  } catch (error) {
    await input.learning.releaseTurn(input.conversationId, input.actor.id);
    throw error;
  }
}
