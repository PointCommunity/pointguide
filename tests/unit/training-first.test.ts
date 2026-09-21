import { expect, it, vi } from "vitest";
import { planAcceptedTraining, trainingEvidence, trainingDraft } from "@/lib/agent/training-first";
import type { AcceptedGuidance } from "@/lib/training/knowledge";

const answerId = crypto.randomUUID();
const artifact: AcceptedGuidance = {
  id: `training:${"a".repeat(64)}`, repository: "PointCommunity/pointaudio", path: `research/pointguide-training/${crypto.randomUUID()}/${answerId}.json`,
  digest: "a".repeat(64), sourceCommit: "b".repeat(40), indexedCommit: "c".repeat(40),
  question: "How many local mic sockets does the M32R have?", directAnswer: "The M32R has 16 local microphone sockets.", evidenceIds: ["repo:manual"], acceptedAt: "2026-09-15T12:00:00Z",
  answer: { id: answerId, directAnswer: "The M32R has 16 local microphone sockets.", steps: ["Count local sockets on the rear panel."], safetyAndAssumptions: ["Do not equate channel count with physical sockets."], confidence: "SUPPORTED", claims: [
    { id: "count", text: "The M32R has 16 local microphone sockets.", status: "SUPPORTED", evidenceIds: ["repo:manual"] },
    { id: "warning", text: "Do not equate channel count with physical sockets.", status: "SUPPORTED", evidenceIds: ["repo:manual"] },
  ], evidence: [{ id: "repo:manual" }],
  },
};

it("keeps the complete accepted answer and exact indexed artifact as citable primary knowledge", () => {
  const evidence = trainingEvidence(artifact);
  expect(evidence).toMatchObject({ id: artifact.id, kind: "ACCEPTED_TRAINING", path: artifact.path, digest: artifact.digest, locator: expect.stringContaining(artifact.indexedCommit) });
  expect(evidence.excerpt).toContain("Do not equate channel count");
  const draft = trainingDraft(artifact);
  expect(draft.claims.every(claim => claim.evidenceIds.includes(artifact.id))).toBe(true);
  expect(draft.safetyAndAssumptions).toContain("Do not equate channel count with physical sockets.");
});

it("renders one complete direct answer without repeating its atomic factual claims", () => {
  const directAnswer = "The M32R has 16 local sockets. Its 32 channels are processing paths, not 32 local sockets.";
  const record = { ...artifact, answer: { ...artifact.answer!, directAnswer, claims: [
    { id: "sockets", text: "The M32R has 16 local sockets.", status: "SUPPORTED" as const, evidenceIds: [] },
    { id: "channels", text: "Its 32 channels are processing paths, not 32 local sockets.", status: "SUPPORTED" as const, evidenceIds: [] },
  ] } };
  const draft = trainingDraft(record);
  expect(draft.claims.filter(claim => claim.kind === "FACTUAL")).toMatchObject([{ text: directAnswer, evidenceIds: [artifact.id] }]);
});

it("uses semantic assessment but rejects explicit wrong product and unknown IDs", async () => {
  const assess = vi.fn().mockResolvedValue({ selected: [{ id: artifact.id, coverage: "COMPLETE", missing: [], rationale: "matching sockets" }] });
  expect(await planAcceptedTraining("How many local mic sockets does the M32 have?", [artifact], assess, ["M32", "M32R"])).toMatchObject({ coverage: "NONE" });
  expect(assess).not.toHaveBeenCalled();
  const same = await planAcceptedTraining("How many local mic sockets does the M32R have?", [artifact], assess, ["M32", "M32R"]);
  expect(same).toMatchObject({ coverage: "COMPLETE", guidance: [artifact] });
  await expect(planAcceptedTraining("M32R sockets", [artifact], async () => ({ selected: [{ id: "unknown", coverage: "COMPLETE", missing: [], rationale: "" }] }), ["M32R"])).rejects.toThrow(/unknown accepted artifact/i);
});

it("requires supplemental research for partial or conflicting accepted answers", async () => {
  const partial = await planAcceptedTraining("M32R socket count and AES50 routing", [artifact], async () => ({ selected: [{ id: artifact.id, coverage: "PARTIAL", missing: ["AES50 routing on M32R"], rationale: "routing absent" }] }), ["M32R"]);
  expect(partial).toMatchObject({ coverage: "PARTIAL", missing: ["AES50 routing on M32R"] });
  const conflict = await planAcceptedTraining("M32R socket count", [artifact], async () => ({ selected: [{ id: artifact.id, coverage: "CONFLICT", missing: ["verify physical sockets"], rationale: "source disagreement" }] }), ["M32R"]);
  expect(conflict.coverage).toBe("CONFLICT");
  const unknown = { ...artifact, answer: { ...artifact.answer!, confidence: "UNKNOWN" as const, claims: [{ id: "gap", text: "Installed model unknown.", status: "UNKNOWN" as const, evidenceIds: [] }] } };
  const unsafeComplete = await planAcceptedTraining(unknown.question, [unknown], async () => ({ selected: [{ id: unknown.id, coverage: "COMPLETE", missing: [], rationale: "overclaimed" }] }), ["M32R"]);
  expect(unsafeComplete.coverage).toBe("PARTIAL");
  expect(trainingDraft(unknown).claims.every(claim => claim.status !== "SUPPORTED")).toBe(true);
});

it("selects a no-overlap paraphrase, but leaves wrong-version and wrong-site decisions explicit", async () => {
  const assess = vi.fn(async (question: string) => ({ selected: [{ id: artifact.id, coverage: question.includes("downtown") || question.includes("v2") ? "INAPPLICABLE" as const : "COMPLETE" as const, missing: [], rationale: "The installed model and context were compared." }] }));
  expect((await planAcceptedTraining("How many XLR jacks are on the compact console?", [artifact], assess, ["M32R"])).coverage).toBe("COMPLETE");
  expect((await planAcceptedTraining("How many XLR jacks at the downtown site?", [artifact], assess)).coverage).toBe("NONE");
  expect((await planAcceptedTraining("How many XLR jacks on v2?", [artifact], assess)).coverage).toBe("NONE");
  expect(assess).toHaveBeenCalledTimes(3);
});
