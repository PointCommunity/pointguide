import { z } from "zod";
import type { AcceptedGuidance } from "@/lib/training/knowledge";
import type { AnswerDraft, EvidenceItem } from "./schema";

export const trainingAssessmentSchema = z.object({ selected: z.array(z.object({ id: z.string(), coverage: z.enum(["COMPLETE", "PARTIAL", "CONFLICT", "INAPPLICABLE"]), missing: z.array(z.string()), rationale: z.string() })), unresolvedContext: z.string().nullish() });
export type TrainingAssessment = z.infer<typeof trainingAssessmentSchema>;
export interface TrainingPlan { coverage: "NONE" | "COMPLETE" | "PARTIAL" | "CONFLICT"; guidance: AcceptedGuidance[]; missing: string[]; unresolvedContext?: string }

function namedProduct(text: string, names: string[]): string[] {
  const normalized = ` ${text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return names.filter(name => normalized.includes(` ${name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `));
}

export async function planAcceptedTraining(question: string, records: AcceptedGuidance[], assess: (question: string, candidates: AcceptedGuidance[]) => Promise<TrainingAssessment>, products: string[] = []): Promise<TrainingPlan> {
  const none: TrainingPlan = { coverage: "NONE", guidance: [], missing: [] };
  const askedProducts = namedProduct(question, products);
  const candidates = records.filter(record => record.answer && (!askedProducts.length || namedProduct(`${record.question} ${record.directAnswer}`, products).some(name => askedProducts.includes(name))));
  if (!candidates.length) return none;
  const assessment = trainingAssessmentSchema.parse(await assess(question, candidates));
  const ids = new Map(candidates.map(record => [record.id, record]));
  const seen = new Set<string>();
  for (const item of assessment.selected) {
    if (!ids.has(item.id) || seen.has(item.id)) throw new Error(`Training assessment referenced an unknown accepted artifact or duplicate ID: ${item.id}`);
    seen.add(item.id);
  }
  const selected = assessment.selected.filter(item => item.coverage !== "INAPPLICABLE");
  if (!selected.length) return none;
  for (const item of selected) if (ids.get(item.id)?.answer?.confidence === "UNKNOWN" || ids.get(item.id)?.answer?.claims.some(claim => claim.status === "UNKNOWN")) {
    if (item.coverage === "COMPLETE") item.coverage = "PARTIAL";
    item.missing.push("The accepted answer itself marks this part unresolved.");
  }
  const coverage = selected.some(item => item.coverage === "CONFLICT") || selected.filter(item => item.coverage === "COMPLETE").length > 1 ? "CONFLICT"
    : selected.some(item => item.coverage === "PARTIAL") || assessment.unresolvedContext || selected.some(item => item.missing.length) ? "PARTIAL" : "COMPLETE";
  return { coverage, guidance: selected.map(item => ids.get(item.id)!), missing: [...new Set(selected.flatMap(item => item.missing))], unresolvedContext: assessment.unresolvedContext ?? undefined };
}

export function trainingEvidence(record: AcceptedGuidance): EvidenceItem {
  if (!record.answer || !/^research\/pointguide-training\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json$/u.test(record.path) || !/^[a-f0-9]{64}$/u.test(record.digest)) throw new Error("The accepted training artifact is incomplete or unverified.");
  const excerpt = JSON.stringify({ question: record.question, answer: record.answer, supportingEvidenceIds: record.evidenceIds });
  if (excerpt.length > 64_000) throw new Error("Accepted training exceeds the evidence context limit; it was not truncated.");
  return { id: record.id, kind: "ACCEPTED_TRAINING", sourceId: record.repository, title: `Accepted training: ${record.question}`, path: record.path, locator: `${record.repository}@${record.indexedCommit}; accepted from ${record.sourceCommit}`, authority: "Trainer-accepted primary knowledge; not independent manufacturer verification", capturedAt: record.acceptedAt, excerpt, digest: record.digest };
}

export function trainingDraft(record: AcceptedGuidance): AnswerDraft {
  if (!record.answer) throw new Error("The full accepted answer is unavailable.");
  const answer = record.answer;
  const claims: AnswerDraft["claims"] = answer.claims.filter(claim => claim.status !== "REJECTED" && (claim.status === "UNKNOWN" || !answer.directAnswer.includes(claim.text))).map(claim => ({ id: claim.id, text: claim.text, kind: claim.kind ?? (answer.steps.includes(claim.text) ? "ACTIONABLE" : answer.safetyAndAssumptions.includes(claim.text) ? "SAFETY" : "FACTUAL"), status: claim.status, evidenceIds: claim.status === "SUPPORTED" ? [record.id] : [] }));
  const addMissing = (text: string, kind: "FACTUAL" | "ACTIONABLE" | "SAFETY", id: string) => { if (!claims.some(claim => claim.text === text && claim.kind === kind)) claims.push(answer.confidence === "UNKNOWN" ? { id, text, kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] } : { id, text, kind, status: "SUPPORTED", evidenceIds: [record.id] }); };
  addMissing(answer.directAnswer, "FACTUAL", "accepted-answer");
  answer.steps.forEach((text, index) => addMissing(text, "ACTIONABLE", `accepted-step-${index}`));
  answer.safetyAndAssumptions.forEach((text, index) => addMissing(text, "SAFETY", `accepted-warning-${index}`));
  return { directAnswer: answer.directAnswer, steps: answer.steps, safetyAndAssumptions: answer.safetyAndAssumptions, confidence: answer.confidence === "CONFIRMED" ? "SUPPORTED" : answer.confidence as AnswerDraft["confidence"], claims };
}
