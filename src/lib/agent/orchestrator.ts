import { validateGroundedAnswer } from "@/lib/agent/claims";
import { renderGroundedAnswer } from "@/lib/agent/render";
import { reviewResultSchema, type ReviewResult } from "@/lib/agent/reviewer";
import type { AnswerDraft, EvidenceItem } from "@/lib/agent/schema";

export type ReviewMode = "NONE" | "DEEP_RESEARCH";
export type ReviewStatus = "NOT_REQUESTED" | "PASSED" | "REJECTED" | "FAILED";

export class OrchestrationError extends Error {
  constructor(public readonly code: "REVIEW_UNAVAILABLE" | "REVIEW_INVALID" | "REVIEW_TIMEOUT" | "REVIEW_REJECTED", message: string) {
    super(message);
    this.name = "OrchestrationError";
  }
}

interface OrchestrationInput {
  evidence: EvidenceItem[];
  mode: ReviewMode;
  primary(): Promise<AnswerDraft>;
  reviewer?: (draft: AnswerDraft, evidence: EvidenceItem[]) => Promise<ReviewResult>;
  timeoutMs?: number;
}

export interface OrchestratedAnswer extends AnswerDraft { reviewStatus: ReviewStatus }

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new OrchestrationError("REVIEW_TIMEOUT", "The reviewing agent timed out.")), milliseconds); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function orchestrateAnswer(input: OrchestrationInput): Promise<OrchestratedAnswer> {
  const primary = validateGroundedAnswer(await input.primary(), input.evidence);
  if (input.mode === "NONE") return { ...renderGroundedAnswer(primary), reviewStatus: "NOT_REQUESTED" };
  if (!input.reviewer) throw new OrchestrationError("REVIEW_UNAVAILABLE", "Deep research requires a reviewing agent.");

  let review: ReviewResult;
  try {
    review = reviewResultSchema.parse(await bounded(input.reviewer(primary, input.evidence), input.timeoutMs ?? 30_000));
  } catch (error) {
    if (error instanceof OrchestrationError) throw error;
    throw new OrchestrationError("REVIEW_INVALID", "The reviewing agent returned an invalid result.");
  }
  const findings = new Map(review.findings.map((finding) => [finding.claimId, finding]));
  if (findings.size !== primary.claims.length || primary.claims.some((claim) => !findings.has(claim.id))) {
    throw new OrchestrationError("REVIEW_INVALID", "The reviewer did not assess every claim exactly once.");
  }
  const reviewed: AnswerDraft = {
    ...primary,
    claims: primary.claims.map((claim) => claim.kind === "UNKNOWN" ? claim : ({ ...claim, status: findings.get(claim.id)?.verdict === "SUPPORTED" ? claim.status : "REJECTED" })),
  };
  const rendered = renderGroundedAnswer(validateGroundedAnswer(reviewed, input.evidence));
  if (primary.claims.some((claim) => claim.status === "SUPPORTED") && !rendered.claims.some((claim) => claim.status === "SUPPORTED")) {
    throw new OrchestrationError("REVIEW_REJECTED", "The reviewer rejected every supported claim.");
  }
  return { ...rendered, reviewStatus: "PASSED" };
}
