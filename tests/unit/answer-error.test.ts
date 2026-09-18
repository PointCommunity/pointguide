import { describe, expect, it } from "vitest";
import { OrchestrationError } from "@/lib/agent/orchestrator";
import { answerFailureDiagnostic } from "@/lib/training/answer-error";

describe("answer failure diagnostics", () => {
  it("keeps logs safe while distinguishing review, grounding, provider, and output failures", () => {
    expect(answerFailureDiagnostic(new OrchestrationError("REVIEW_INVALID", "unsafe provider detail"))).toEqual({ reason: "GENERATION_FAILED", detail: "REVIEW_INVALID" });
    expect(answerFailureDiagnostic(new Error("claim c1 references unknown evidence: invented"))).toEqual({ reason: "GENERATION_FAILED", detail: "GROUNDING_INVALID" });
    expect(answerFailureDiagnostic(new Error("Codex generation failed."))).toEqual({ reason: "GENERATION_FAILED", detail: "PROVIDER_GENERATION_FAILED" });
    expect(answerFailureDiagnostic(new SyntaxError("secret provider output"))).toEqual({ reason: "INVALID_PROVIDER_OUTPUT", detail: "INVALID_PROVIDER_OUTPUT" });
  });
});
