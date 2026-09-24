import { expect, it } from "vitest";
import { acceptedTrainingArtifact } from "@/lib/training/artifact";
import { contentDigest } from "@/lib/git/proposals";
import type { TrainingSessionRecord } from "@/lib/training/types";

it("publishes the exact accepted answer with source and claim provenance, never the raw conversation", () => {
  const session = { id: "00000000-0000-4000-8000-000000000011", trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I check sync?", state: "ACTIVE", currentAnswer: { id: "00000000-0000-4000-8000-000000000012", directAnswer: "Check cable before clock.", steps: ["Inspect cable."], confidence: "SUPPORTED", claims: [{ id: "claim", text: "Check cable.", status: "SUPPORTED", evidenceIds: ["source-1"] }], evidence: [{ id: "source-1", kind: "REPOSITORY", title: "M32 manual", path: "docs/m32.txt", digest: "a".repeat(64), locator: "M32@abc; page 1", authority: "Manufacturer manual", capturedAt: "2026-09-15T00:00:00.000Z", excerpt: "Check cable before clock." }] }, currentReport: null, proposalId: null, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z", version: 3 } satisfies TrainingSessionRecord;
  const result = acceptedTrainingArtifact(session, "trainer", "a".repeat(40), "2026-09-15T12:00:00.000Z");
  const artifact = JSON.parse(result.content);
  expect(result.path).toBe(`research/pointguide-training/${session.id}/${session.currentAnswer.id}.json`);
  expect(result.digest).toBe(contentDigest(result.content));
  expect(artifact).toMatchObject({ schemaVersion: 2, kind: "pointguide-accepted-training", answerId: session.currentAnswer.id, answerVersion: 3, targetRepository: "PointCommunity/pointaudio", sourceCommit: "a".repeat(40), answer: { directAnswer: "Check cable before clock.", evidence: [{ id: "source-1" }] } });
  expect(result.content).not.toContain("rawConversation");
});
