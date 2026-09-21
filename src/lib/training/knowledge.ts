import { terms } from "@/lib/evidence/search";
import { contentDigest } from "@/lib/git/proposals";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import type { TrainingSessionRecord } from "./types";
import { z } from "zod";

export interface AcceptedGuidance {
  id: string; repository: string; path: string; digest: string; sourceCommit: string; indexedCommit: string;
  question: string; directAnswer: string; evidenceIds: string[]; acceptedAt: string; answer?: z.infer<typeof artifactSchema>["answer"];
}

const artifactSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal("pointguide-accepted-training"), sessionId: z.uuid(), answerId: z.uuid(), targetRepository: z.string(), sourceCommit: z.string(), acceptedAt: z.string(), originalQuestion: z.string(), answer: z.object({ id: z.uuid(), directAnswer: z.string().min(1), steps: z.array(z.string()), safetyAndAssumptions: z.array(z.string()), confidence: z.enum(["CONFIRMED", "SUPPORTED", "TENTATIVE", "UNKNOWN"]), claims: z.array(z.object({ id: z.string(), text: z.string(), kind: z.enum(["FACTUAL", "ACTIONABLE", "SAFETY", "UNKNOWN"]).optional(), status: z.enum(["SUPPORTED", "UNKNOWN", "REJECTED"]), evidenceIds: z.array(z.string()) })), evidence: z.array(z.object({ id: z.string() })) }) });

export function hasVerifiedAcceptedArtifact(source: Pick<SourceRepositoryRecord, "indexedCommit" | "validationReport">, path: string, digest: string): boolean {
  return source.validationReport?.valid === true && source.validationReport.complete === true && source.validationReport.commitSha === source.indexedCommit && source.validationReport.acceptedArtifacts?.some(item => item.path === path && item.digest === digest) === true;
}

export function acceptedGuidanceFromSession(session: TrainingSessionRecord, source: Pick<SourceRepositoryRecord, "fullName" | "status" | "indexedCommit" | "validationReport">): AcceptedGuidance | null {
  if (session.state !== "ACTIVE_KNOWLEDGE" || source.status !== "ACTIVE" || source.fullName !== session.targetRepository || !session.acceptedContent || !session.acceptedDigest || !session.acceptedPath || !hasVerifiedAcceptedArtifact(source, session.acceptedPath, session.acceptedDigest) || contentDigest(session.acceptedContent) !== session.acceptedDigest) return null;
  try {
    const artifact = artifactSchema.parse(JSON.parse(session.acceptedContent));
    if (artifact.sessionId !== session.id || artifact.targetRepository !== source.fullName || artifact.answer.id !== artifact.answerId || session.acceptedPath !== `research/pointguide-training/${session.id}/${artifact.answerId}.json` || !/^[a-f0-9]{40}$/u.test(artifact.sourceCommit)) return null;
    return { id: `training:${session.acceptedDigest}`, repository: source.fullName, path: session.acceptedPath, digest: session.acceptedDigest, sourceCommit: artifact.sourceCommit, indexedCommit: source.indexedCommit, question: artifact.originalQuestion, directAnswer: artifact.answer.directAnswer, evidenceIds: artifact.answer.evidence.map(item => item.id), acceptedAt: artifact.acceptedAt, answer: artifact.answer };
  } catch { return null; }
}

export function rankAcceptedGuidance(query: string, records: AcceptedGuidance[], limit = 3): AcceptedGuidance[] {
  const asked = terms(query);
  if (!asked.length || limit <= 0) return [];
  // Fixture-only lexical ranking; production uses a semantic applicability assessment.
  return records.map(record => ({ record, matched: asked.filter(term => terms(record.question).includes(term)).length }))
    .filter(item => item.matched >= 2)
    .sort((left, right) => right.matched - left.matched || right.record.acceptedAt.localeCompare(left.record.acceptedAt))
    .slice(0, limit).map(item => item.record);
}
