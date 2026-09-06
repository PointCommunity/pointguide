import { describe, expect, it } from "vitest";
import { validateGroundedAnswer } from "@/lib/agent/claims";
import type { AnswerDraft, EvidenceItem } from "@/lib/agent/schema";

const evidence: EvidenceItem[] = [{
  id: "repo:m32-user:40",
  kind: "REPOSITORY",
  sourceId: "m32-user-manual",
  title: "M32 User Manual",
  path: "research/midas-m32/corpus/M32_User_Manual_EN.txt",
  locator: "Digital I/O > AES50",
  authority: "manufacturer-primary",
  versionOrDate: "2014-08-11",
  capturedAt: "2026-09-06T00:00:00.000Z",
  excerpt: "Clock synchronization is required.",
  digest: "a".repeat(64),
}];

function answer(claim: AnswerDraft["claims"][number]): AnswerDraft {
  return {
    directAnswer: "Check the clock source before changing routing.",
    steps: [],
    safetyAndAssumptions: ["Confirm the exact stage-box model."],
    confidence: "SUPPORTED",
    claims: [claim],
  };
}

describe("validateGroundedAnswer", () => {
  it("accepts a supported claim whose evidence exists", () => {
    const result = validateGroundedAnswer(answer({
      id: "claim-1",
      text: "AES50 requires clock synchronization.",
      kind: "FACTUAL",
      status: "SUPPORTED",
      evidenceIds: ["repo:m32-user:40"],
    }), evidence);

    expect(result.claims[0].evidenceIds).toEqual(["repo:m32-user:40"]);
  });

  it("rejects supported factual claims without evidence", () => {
    expect(() => validateGroundedAnswer(answer({
      id: "claim-1", text: "AES50 always works.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [],
    }), evidence)).toThrow("requires evidence");
  });

  it("rejects dangling evidence identifiers", () => {
    expect(() => validateGroundedAnswer(answer({
      id: "claim-1", text: "A claim.", kind: "ACTIONABLE", status: "SUPPORTED", evidenceIds: ["repo:missing"],
    }), evidence)).toThrow("unknown evidence");
  });

  it("allows an explicit unknown with no evidence", () => {
    const result = validateGroundedAnswer(answer({
      id: "claim-1", text: "The installed firmware version is unknown.", kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [],
    }), evidence);

    expect(result.claims[0].status).toBe("UNKNOWN");
  });

  it("rejects duplicate claim and evidence identifiers", () => {
    const duplicateClaims: AnswerDraft = { ...answer({
      id: "claim-1", text: "One.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id],
    }), claims: [
      { id: "claim-1", text: "One.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id] },
      { id: "claim-1", text: "Two.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id] },
    ] };
    expect(() => validateGroundedAnswer(duplicateClaims, evidence)).toThrow("duplicate claim");
    expect(() => validateGroundedAnswer(answer({
      id: "claim-2", text: "One.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: [evidence[0].id],
    }), [...evidence, evidence[0]])).toThrow("duplicate evidence");
  });
});
