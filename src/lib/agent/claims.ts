import { answerDraftSchema, evidenceItemSchema, type AnswerDraft, type EvidenceItem } from "./schema";

function assertUnique(values: string[], label: string): void {
  const observed = new Set<string>();
  for (const value of values) {
    if (observed.has(value)) throw new Error(`duplicate ${label} identifier: ${value}`);
    observed.add(value);
  }
}

export function validateGroundedAnswer(draft: AnswerDraft, rawEvidence: EvidenceItem[]): AnswerDraft {
  const answer = answerDraftSchema.parse(draft);
  const evidence = rawEvidence.map((item) => evidenceItemSchema.parse(item));
  assertUnique(evidence.map((item) => item.id), "evidence");
  assertUnique(answer.claims.map((claim) => claim.id), "claim");
  const evidenceIds = new Set(evidence.map((item) => item.id));

  for (const claim of answer.claims) {
    assertUnique(claim.evidenceIds, `evidence on claim ${claim.id}`);
    if (claim.status === "SUPPORTED" && claim.evidenceIds.length === 0) {
      throw new Error(`supported ${claim.kind.toLowerCase()} claim ${claim.id} requires evidence`);
    }
    if (claim.kind === "UNKNOWN" && claim.status !== "UNKNOWN") {
      throw new Error(`unknown claim ${claim.id} must use UNKNOWN status`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) throw new Error(`claim ${claim.id} references unknown evidence: ${evidenceId}`);
    }
  }

  return answer;
}
