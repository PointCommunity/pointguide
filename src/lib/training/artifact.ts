import { z } from "zod";
import { contentDigest } from "@/lib/git/proposals";
import type { TrainingSessionRecord } from "./types";

const answerSchema = z.object({
  id: z.uuid(), directAnswer: z.string().min(1), steps: z.array(z.string()).default([]),
  safetyAndAssumptions: z.array(z.string()).default([]), confidence: z.string().default("UNKNOWN"),
  claims: z.array(z.object({ id: z.string(), text: z.string(), kind: z.string().optional(), status: z.string(), evidenceIds: z.array(z.string()) })).default([]),
  evidence: z.array(z.object({ id: z.string(), sourceId: z.string().optional(), path: z.string().optional(), locator: z.string().optional(), authority: z.string().optional(), digest: z.string().optional() })).default([]),
});

export function acceptedTrainingArtifact(session: TrainingSessionRecord, actorId: string, sourceCommit: string, acceptedAt: string) {
  if (!/^PointCommunity\/[A-Za-z0-9._-]+$/u.test(session.targetRepository) || !/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error("Accepted training requires a configured repository and immutable source commit.");
  const answer = answerSchema.parse(session.currentAnswer);
  const path = `research/pointguide-training/${session.id}/${answer.id}.json`;
  const content = JSON.stringify({
    schemaVersion: 2, kind: "pointguide-accepted-training", sessionId: session.id,
    answerId: answer.id, answerVersion: session.version, targetRepository: session.targetRepository,
    sourceCommit, acceptedBy: actorId, acceptedAt, originalQuestion: session.originalQuestion,
    applicability: { question: session.originalQuestion }, answer,
    evidenceBoundary: "Trainer acceptance approves guidance, not unsupported facts. Claims still require independent source evidence.",
  }, null, 2) + "\n";
  return { path, content, digest: contentDigest(content) };
}
