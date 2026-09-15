import { terms } from "@/lib/evidence/search";
import { contentDigest } from "@/lib/git/proposals";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import type { TrainingSessionRecord } from "./types";
import { z } from "zod";

export interface AcceptedGuidance {
  id: string; repository: string; path: string; digest: string; sourceCommit: string; indexedCommit: string;
  question: string; directAnswer: string; evidenceIds: string[]; acceptedAt: string;
}

const artifactSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal("pointguide-accepted-training"), sessionId: z.uuid(), targetRepository: z.string(), sourceCommit: z.string(), acceptedAt: z.string(), originalQuestion: z.string(), answer: z.object({ directAnswer: z.string(), evidence: z.array(z.object({ id: z.string() })) }) });

export function acceptedGuidanceFromSession(session: TrainingSessionRecord, source: Pick<SourceRepositoryRecord, "fullName" | "status" | "indexedCommit">): AcceptedGuidance | null {
  if (session.state !== "ACTIVE_KNOWLEDGE" || source.status !== "ACTIVE" || source.fullName !== session.targetRepository || !session.acceptedContent || !session.acceptedDigest || !session.acceptedPath || session.indexedCommit !== source.indexedCommit || contentDigest(session.acceptedContent) !== session.acceptedDigest) return null;
  try {
    const artifact = artifactSchema.parse(JSON.parse(session.acceptedContent));
    if (artifact.sessionId !== session.id || artifact.targetRepository !== source.fullName || !session.acceptedPath.startsWith(`research/pointguide-training/${session.id}/`)) return null;
    return { id: `training:${session.acceptedDigest}`, repository: source.fullName, path: session.acceptedPath, digest: session.acceptedDigest, sourceCommit: artifact.sourceCommit, indexedCommit: source.indexedCommit, question: artifact.originalQuestion, directAnswer: artifact.answer.directAnswer, evidenceIds: artifact.answer.evidence.map(item => item.id), acceptedAt: artifact.acceptedAt };
  } catch { return null; }
}

export function rankAcceptedGuidance(query: string, records: AcceptedGuidance[], limit = 3): AcceptedGuidance[] {
  const asked = terms(query);
  if (!asked.length || limit <= 0) return [];
  // ponytail: lexical overlap handles shared equipment/topic terms; use an approved semantic index if zero-overlap paraphrases become a verified need.
  return records.map(record => ({ record, matched: asked.filter(term => terms(record.question).includes(term)).length }))
    .filter(item => item.matched >= 2)
    .sort((left, right) => right.matched - left.matched || right.record.acceptedAt.localeCompare(left.record.acceptedAt))
    .slice(0, limit).map(item => item.record);
}
