import { expect, it } from "vitest";
import { rankAcceptedGuidance, acceptedGuidanceFromSession } from "@/lib/training/knowledge";
import { searchCorpus } from "@/lib/evidence/search";
import type { AcceptedGuidance } from "@/lib/training/knowledge";
import { acceptedTrainingArtifact } from "@/lib/training/artifact";
import type { TrainingSessionRecord } from "@/lib/training/types";
import type { SourceRepositoryRecord } from "@/lib/sources/types";

const guidance: AcceptedGuidance = { id: "training:abc", repository: "PointCommunity/pointaudio", path: "research/pointguide-training/a/b.json", digest: "a".repeat(64), sourceCommit: "b".repeat(40), indexedCommit: "c".repeat(40), question: "What does a red AES50 sync light on the DL32 mean?", directAnswer: "The link is not synchronized. Inspect cable and clock safely.", evidenceIds: ["repo:dl32"], acceptedAt: "2026-09-15T12:00:00Z" };

it("prefers accepted guidance for a relevant paraphrase, not an unrelated question", () => {
  expect(rankAcceptedGuidance("Why is the DL32 AES50 link red?", [guidance])).toEqual([guidance]);
  expect(rankAcceptedGuidance("AES50 connection on DL32 shows red; what does that indicate?", [guidance])).toEqual([guidance]);
  expect(rankAcceptedGuidance("How do I set projector brightness?", [guidance])).toEqual([]);
});

it("never presents unvalidated training chunks as repository evidence", () => {
  const chunk = { chunkId: "training:chunk", sourceId: "PointCommunity/pointaudio", title: "Accepted guidance", path: guidance.path, locator: "Verified accepted artifact", authority: "Trainer accepted", capturedAt: guidance.acceptedAt, digest: guidance.digest, text: guidance.directAnswer };
  expect(searchCorpus("DL32 AES50", [chunk])).toEqual([]);
});

it("excludes inactive, archived, and superseded accepted sessions", () => {
  const session = { id: crypto.randomUUID(), trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: guidance.question, state: "ACTIVE_KNOWLEDGE", currentAnswer: { id: crypto.randomUUID(), directAnswer: guidance.directAnswer, evidence: [{ id: "repo:dl32" }] }, currentReport: null, proposalId: null, createdAt: guidance.acceptedAt, updatedAt: guidance.acceptedAt, version: 2 } satisfies TrainingSessionRecord;
  const artifact = acceptedTrainingArtifact(session, "trainer", "a".repeat(40), guidance.acceptedAt);
  const active = { ...session, acceptedContent: artifact.content, acceptedDigest: artifact.digest, acceptedPath: artifact.path, indexedCommit: "b".repeat(40) } satisfies TrainingSessionRecord;
  const source = { fullName: session.targetRepository, status: "ACTIVE", indexedCommit: "b".repeat(40), validationReport: { valid: true, complete: true, commitSha: "b".repeat(40), acceptedArtifacts: [{ path: artifact.path, digest: artifact.digest }] } } as SourceRepositoryRecord;
  expect(acceptedGuidanceFromSession(active, source)).toMatchObject({ path: artifact.path, answer: { directAnswer: guidance.directAnswer, evidence: [{ id: "repo:dl32" }] } });
  expect(acceptedGuidanceFromSession({ ...active, state: "FAILED" }, source)).toBeNull();
  expect(acceptedGuidanceFromSession({ ...active, state: "SUPERSEDED" }, source)).toBeNull();
  expect(acceptedGuidanceFromSession(active, { ...source, status: "ARCHIVED" })).toBeNull();
  expect(acceptedGuidanceFromSession(active, { ...source, indexedCommit: "c".repeat(40), validationReport: { ...source.validationReport, commitSha: "c".repeat(40) } })?.indexedCommit).toBe("c".repeat(40));
  expect(acceptedGuidanceFromSession(active, { ...source, validationReport: { ...source.validationReport, acceptedArtifacts: [] } })).toBeNull();
  expect(acceptedGuidanceFromSession(active, { ...source, validationReport: { ...source.validationReport, acceptedArtifacts: [{ path: artifact.path, digest: "0".repeat(64) }] } })).toBeNull();
});
