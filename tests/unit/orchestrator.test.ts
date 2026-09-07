import { describe, expect, it } from "vitest";
import { orchestrateAnswer } from "@/lib/agent/orchestrator";
import type { AnswerDraft, EvidenceItem } from "@/lib/agent/schema";

const evidence: EvidenceItem[] = [{ id:"e1", kind:"REPOSITORY", title:"Manual", path:"docs/manual.html", locator:"Sync LED", authority:"manufacturer", capturedAt:"2026-09-06T00:00:00.000Z", excerpt:"Red means not synchronized.", digest:"a".repeat(64) }];
const draft: AnswerDraft = { directAnswer:"ignored renderer prose", steps:[], safetyAndAssumptions:[], confidence:"SUPPORTED", claims:[{ id:"c1", text:"Red means not synchronized.", kind:"FACTUAL", status:"SUPPORTED", evidenceIds:["e1"] }] };

describe("grounded orchestration", () => {
  it("renders normal answers only from validated atomic claims", async () => {
    const result = await orchestrateAnswer({ evidence, mode:"NONE", primary: async () => draft });
    expect(result.directAnswer).toBe("Red means not synchronized.");
    expect(result.reviewStatus).toBe("NOT_REQUESTED");
  });

  it.each(["same-model", "cross-provider"])("passes %s review when every claim is supported", async () => {
    const result = await orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings:[{ claimId:"c1", verdict:"SUPPORTED", rationaleCode:"ENTAILED" }] }) });
    expect(result.reviewStatus).toBe("PASSED");
    expect(result.claims).toHaveLength(1);
  });

  it("rejects dangling evidence before review", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"NONE", primary: async () => ({ ...draft, claims:[{ ...draft.claims[0], evidenceIds:["missing"] }] }) })).rejects.toThrow("unknown evidence");
  });

  it("filters contradicted claims and fails closed when none remain", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings:[{ claimId:"c1", verdict:"REJECTED", rationaleCode:"CONTRADICTED" }] }) })).rejects.toMatchObject({ code:"REVIEW_REJECTED" });
  });

  it("lets review confirm that an unsupported question remains explicitly unknown", async () => {
    const unknown: AnswerDraft = { directAnswer: "No evidence.", steps: ["Collect the model and location."], safetyAndAssumptions: [], confidence: "UNKNOWN", claims: [{ id: "unknown", text: "The requested fact is not established.", kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] }] };
    const result = await orchestrateAnswer({ evidence: [], mode: "DEEP_RESEARCH", primary: async () => unknown, reviewer: async () => ({ findings: [{ claimId: "unknown", verdict: "REJECTED", rationaleCode: "INSUFFICIENT" }] }) });
    expect(result).toMatchObject({ confidence: "UNKNOWN", reviewStatus: "PASSED", claims: [{ status: "UNKNOWN" }] });
  });

  it("fails closed on missing reviewer, malformed findings, and timeout", async () => {
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft })).rejects.toMatchObject({ code:"REVIEW_UNAVAILABLE" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", primary: async () => draft, reviewer: async () => ({ findings:[] }) })).rejects.toMatchObject({ code:"REVIEW_INVALID" });
    await expect(orchestrateAnswer({ evidence, mode:"DEEP_RESEARCH", timeoutMs:5, primary: async () => draft, reviewer: async () => new Promise(() => {}) })).rejects.toMatchObject({ code:"REVIEW_TIMEOUT" });
  });
});
