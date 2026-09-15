import type { AnswerDraft } from "@/lib/agent/schema";

export function renderGroundedAnswer(draft: AnswerDraft): AnswerDraft {
  const claims = draft.claims.filter((claim) => claim.status !== "REJECTED");
  const supported = claims.filter((claim) => claim.status === "SUPPORTED");
  const unknown = claims.filter((claim) => claim.status === "UNKNOWN");
  const direct = supported.filter(claim => claim.kind === "FACTUAL");
  const leading = direct.length ? direct : supported;
  const directAnswer = supported.length
    ? leading.map((claim) => claim.text).join(" ")
    : unknown.map((claim) => claim.text).join(" ") || "The available evidence does not support an answer.";
  const steps = supported.filter(claim => claim.kind === "ACTIONABLE" && !leading.includes(claim)).map(claim => claim.text);
  const safetyAndAssumptions = [...supported.filter(claim => claim.kind === "SAFETY" && !leading.includes(claim)), ...(supported.length ? unknown : [])].map(claim => claim.text);
  return { ...draft, directAnswer, steps, safetyAndAssumptions, claims };
}
