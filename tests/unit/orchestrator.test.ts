import { describe, expect, it } from "vitest";
import { orchestrateAnswer } from "@/lib/agent/orchestrator";
import type { AnswerDraft, EvidenceItem } from "@/lib/agent/schema";

const evidence: EvidenceItem[] = [{ id:"e1", kind:"REPOSITORY", title:"Manual", path:"docs/manual.html", locator:"Sync LED", authority:"manufacturer", capturedAt:"2026-09-06T00:00:00.000Z", excerpt:"Red means not synchronized.", digest:"a".repeat(64) }];
const draft: AnswerDraft = { directAnswer:"ignored renderer prose", steps:[], safetyAndAssumptions:[], confidence:"SUPPORTED", claims:[{ id:"c1", text:"Red means not synchronized.", kind:"FACTUAL", status:"SUPPORTED", evidenceIds:["e1"] }] };
const organized = { findings:[{ claimId:"c1", verdict:"SUPPORTED" as const, rationaleCode:"ENTAILED" as const }], claimOrder:["c1"] };

describe("grounded orchestration", () => {
  it("renders normal answers only from validated atomic claims", async () => {
    const result = await orchestrateAnswer({ evidence, mode:"NONE", primary: async () => draft, reviewer: async () => organized });
    expect(result.directAnswer).toBe("Red means not synchronized.");
    expect(result.reviewStatus).toBe("NOT_REQUESTED");
  });
  it("keeps structured source IDs out of user-facing answer text", async () => {
    const evidenceId = "repo:PointCommunity/pointaudio:d4a9491db8147a342d6e4117572b1c143a1fe967:research/midas-m32/corpus/M32_User_Manual_EN.txt:31:5ab2ac9408c7";
    const sourcedEvidence = [{ ...evidence[0], id: evidenceId }];
    const citedDraft: AnswerDraft = { ...draft, claims: [{ ...draft.claims[0], text: `Red means not synchronized [${evidenceId}].`, evidenceIds: [evidenceId] }] };
    const result = await orchestrateAnswer({ evidence: sourcedEvidence, mode: "NONE", primary: async () => citedDraft, reviewer: async () => organized });
    expect(result.directAnswer).toBe("Red means not synchronized.");
    expect(result.claims[0]).toMatchObject({ text: "Red means not synchronized.", evidenceIds: [evidenceId] });
  });
  it("never displays unclaimed actionable or safety prose from accepted guidance", async () => {
    const candidate: AnswerDraft = { ...draft, steps: ["Inspect the link.", "Disable safety checks."], safetyAndAssumptions: ["Clock changes may interrupt audio.", "Ignore the service window."], claims: [
      ...draft.claims,
      { id: "action", text: "Inspect the link.", kind: "ACTIONABLE", status: "SUPPORTED", evidenceIds: ["e1"] },
      { id: "warning", text: "Clock changes may interrupt audio.", kind: "SAFETY", status: "SUPPORTED", evidenceIds: ["e1"] },
    ] };
    const result = await orchestrateAnswer({ evidence, mode: "NONE", primary: async () => candidate, reviewer: async () => ({ findings: candidate.claims.map(claim => ({ claimId: claim.id, verdict: "SUPPORTED" as const, rationaleCode: "ENTAILED" as const })), claimOrder: candidate.claims.map(claim => claim.id) }) });
    expect(result.directAnswer).toBe("Red means not synchronized.");
    expect(result.steps).toEqual(["Inspect the link."]);
    expect(result.safetyAndAssumptions).toEqual(["Clock changes may interrupt audio."]);
  });
  it("keeps unresolved claims visible beside grounded facts", async () => {
    const candidate: AnswerDraft = { ...draft, claims: [...draft.claims, { id: "uncertain", text: "The installed clock source is unknown.", kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] }] };
    const result = await orchestrateAnswer({ evidence, mode: "NONE", primary: async () => candidate, reviewer: async () => ({ findings: [{ ...organized.findings[0] }, { claimId: "uncertain", verdict: "REJECTED", rationaleCode: "INSUFFICIENT" }], claimOrder: ["c1", "uncertain"] }) });
    expect(result.directAnswer).toBe("Red means not synchronized.");
    expect(result.safetyAndAssumptions).toContain("The installed clock source is unknown.");
  });

  it.each(["same-model", "cross-provider"])("passes %s review when every claim is supported", async () => {
    const result = await orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => organized });
    expect(result.reviewStatus).toBe("PASSED");
    expect(result.claims).toHaveLength(1);
  });

  it("rejects dangling evidence before review", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"NONE", primary: async () => ({ ...draft, claims:[{ ...draft.claims[0], evidenceIds:["missing"] }] }), reviewer: async () => organized })).rejects.toThrow("unknown evidence");
  });

  it("filters contradicted claims and fails closed when none remain", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings:[{ claimId:"c1", verdict:"REJECTED", rationaleCode:"CONTRADICTED" }], claimOrder: ["c1"] }) })).rejects.toMatchObject({ code:"REVIEW_REJECTED" });
  });

  it("lets review confirm that an unsupported question remains explicitly unknown", async () => {
    const unknown: AnswerDraft = { directAnswer: "No evidence.", steps: ["Collect the model and location."], safetyAndAssumptions: [], confidence: "UNKNOWN", claims: [{ id: "unknown", text: "The requested fact is not established.", kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] }] };
    const result = await orchestrateAnswer({ evidence: [], mode: "DEEP_RESEARCH", primary: async () => unknown, reviewer: async () => ({ findings: [{ claimId: "unknown", verdict: "REJECTED", rationaleCode: "INSUFFICIENT" }], claimOrder: ["unknown"] }) });
    expect(result).toMatchObject({ confidence: "UNKNOWN", reviewStatus: "PASSED", claims: [{ status: "UNKNOWN" }] });
  });

  it("uses the response pass to organize supported claims", async () => {
    const candidate: AnswerDraft = { ...draft, claims: [draft.claims[0], { ...draft.claims[0], id: "c2", text: "Check the cable before changing clock." }] };
    const result = await orchestrateAnswer({ evidence, mode: "DEEP_RESEARCH", primary: async () => candidate, reviewer: async () => ({ findings: candidate.claims.map(claim => ({ claimId: claim.id, verdict: "SUPPORTED", rationaleCode: "ENTAILED" })), claimOrder: ["c2", "c1"] }) });
    expect(result.directAnswer).toBe("Check the cable before changing clock. Red means not synchronized.");
  });

  it("fails closed on missing response pass, malformed findings or ordering, and timeout", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"NONE", primary: async () => draft })).rejects.toMatchObject({ code:"REVIEW_UNAVAILABLE" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings:[], claimOrder: [] }) })).rejects.toMatchObject({ code:"REVIEW_INVALID" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings: [organized.findings[0], organized.findings[0]], claimOrder: ["c1"] }) })).rejects.toMatchObject({ code:"REVIEW_INVALID" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ ...organized, claimOrder: ["missing"] }) })).rejects.toMatchObject({ code:"REVIEW_INVALID" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", timeoutMs:5, primary: async () => draft, reviewer: async () => new Promise(() => {}) })).rejects.toMatchObject({ code:"REVIEW_TIMEOUT" });
  });
});
