import { terms } from "@/lib/evidence/search";
import { contentDigest } from "@/lib/git/proposals";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import { z } from "zod";
import type { AcceptedTrainingRecord } from "@/lib/sources/contract";
import { evidenceItemSchema } from "@/lib/agent/schema";

export interface AcceptedGuidance {
  id: string; repository: string; path: string; digest: string; sourceCommit: string; indexedCommit: string;
  question: string; directAnswer: string; evidenceIds: string[]; acceptedAt: string; answer?: z.infer<typeof artifactSchema>["answer"]; trainerSources?: z.infer<typeof artifactSchema>["trainerSources"];
}

const artifactSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal("pointguide-accepted-training"), sessionId: z.uuid(), answerId: z.uuid(), targetRepository: z.string(), sourceCommit: z.string(), acceptedAt: z.string(), originalQuestion: z.string(), answer: z.object({ id: z.uuid(), directAnswer: z.string().min(1), steps: z.array(z.string()), safetyAndAssumptions: z.array(z.string()), confidence: z.enum(["CONFIRMED", "SUPPORTED", "TENTATIVE", "UNKNOWN"]), claims: z.array(z.object({ id: z.string(), text: z.string(), kind: z.enum(["FACTUAL", "ACTIONABLE", "SAFETY", "UNKNOWN"]).optional(), status: z.enum(["SUPPORTED", "UNKNOWN", "REJECTED"]), evidenceIds: z.array(z.string()) })), evidence: z.array(z.object({ id: z.string() }).passthrough()) }), trainerSources: z.array(z.object({ id: z.uuid(), kind: z.enum(["FILE", "URL"]), originalName: z.string(), mediaType: z.string(), sourceUrl: z.string().nullable(), finalUrl: z.string().nullable(), capturedAt: z.string(), originalPath: z.string(), originalDigest: z.string(), extractedPath: z.string(), extractedDigest: z.string() })).default([]) });

export function hasVerifiedAcceptedArtifact(source: Pick<SourceRepositoryRecord, "indexedCommit" | "validationReport">, path: string, digest: string): boolean {
  return source.validationReport?.valid === true && source.validationReport.complete === true && source.validationReport.commitSha === source.indexedCommit && source.validationReport.acceptedArtifacts?.some(item => item.path === path && item.digest === digest) === true;
}

export function parseAcceptedArtifact(content: string, path: string, digest: string, repository: string) {
  const artifact = artifactSchema.parse(JSON.parse(content));
  if (contentDigest(content) !== digest || artifact.targetRepository !== repository || artifact.answer.id !== artifact.answerId || path !== `research/pointguide-training/${artifact.sessionId}/${artifact.answerId}.json` || !/^[a-f0-9]{40}$/u.test(artifact.sourceCommit) || !artifact.originalQuestion.trim() || !Number.isFinite(Date.parse(artifact.acceptedAt))) throw new Error(`Invalid accepted Training artifact: ${path}`);
  const evidenceIds = new Set<string>(); const claimIds = new Set<string>();
  for (const evidence of artifact.answer.evidence) {
    evidenceItemSchema.parse(evidence);
    if (evidenceIds.has(evidence.id)) throw new Error(`Duplicate accepted supporting evidence: ${path}`);
    evidenceIds.add(evidence.id);
  }
  for (const claim of artifact.answer.claims) {
    if (claimIds.has(claim.id) || claim.evidenceIds.some(id => !evidenceIds.has(id)) || (claim.status === "SUPPORTED" && !claim.evidenceIds.length)) throw new Error(`Invalid accepted claim evidence: ${path}`);
    claimIds.add(claim.id);
  }
  const folder = `research/pointguide-training/${artifact.sessionId}`; const sourceIds = new Set<string>();
  for (const source of artifact.trainerSources) {
    const originalPrefix = `${folder}/originals/${source.id}.`;
    if (sourceIds.has(source.id) || !source.originalPath.startsWith(originalPrefix) || !/^[a-z0-9]+$/u.test(source.originalPath.slice(originalPrefix.length)) || source.extractedPath !== `${folder}/sources/${source.id}.md` || !/^[a-f0-9]{64}$/u.test(source.originalDigest) || !/^[a-f0-9]{64}$/u.test(source.extractedDigest) || !Number.isFinite(Date.parse(source.capturedAt))) throw new Error(`Invalid trainer-source provenance: ${path}`);
    sourceIds.add(source.id);
  }
  return artifact;
}

export function acceptedGuidanceFromArtifact(content: string, record: AcceptedTrainingRecord, source: Pick<SourceRepositoryRecord, "fullName" | "status" | "indexedCommit" | "validationReport">): AcceptedGuidance | null {
  if (source.status !== "ACTIVE" || record.lifecycle !== "active" || !hasVerifiedAcceptedArtifact(source, record.path, record.digest) || !source.validationReport.acceptedTraining?.some(item => item.path === record.path && item.digest === record.digest && item.question === record.question && item.lifecycle === "active")) return null;
  try {
    const artifact = parseAcceptedArtifact(content, record.path, record.digest, source.fullName);
    if (artifact.originalQuestion.trim() !== record.question.trim()) return null;
    return { id: `training:${record.digest}`, repository: source.fullName, path: record.path, digest: record.digest, sourceCommit: artifact.sourceCommit, indexedCommit: source.indexedCommit, question: artifact.originalQuestion, directAnswer: artifact.answer.directAnswer, evidenceIds: artifact.answer.evidence.map(item => item.id), acceptedAt: artifact.acceptedAt, answer: artifact.answer, trainerSources: artifact.trainerSources };
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
