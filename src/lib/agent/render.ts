import type { AnswerDraft } from "@/lib/agent/schema";

export function renderGroundedAnswer(draft: AnswerDraft): AnswerDraft {
  const claims = draft.claims.filter((claim) => claim.status !== "REJECTED");
  const supported = claims.filter((claim) => claim.status === "SUPPORTED");
  const unknown = claims.filter((claim) => claim.status === "UNKNOWN");
  const directAnswer = supported.length
    ? supported.map((claim) => claim.text).join(" ")
    : unknown.map((claim) => claim.text).join(" ") || "The available evidence does not support an answer.";
  return { ...draft, directAnswer, claims };
}
