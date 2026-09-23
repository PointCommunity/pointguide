import { ZodError } from "zod";

export function answerFailureReason(error: unknown) {
  if (error instanceof SyntaxError || error instanceof ZodError) return "INVALID_PROVIDER_OUTPUT";
  if (error instanceof Error && /timed out|timeout/iu.test(error.message)) return "PROVIDER_TIMEOUT";
  if (error instanceof Error && /generation failed \(429\)/iu.test(error.message)) return "PROVIDER_RATE_LIMIT";
  if (error instanceof Error && error.message.startsWith("Training context capacity exceeded")) return "CONTEXT_LIMIT";
  if (error instanceof Error && error.message === "TRAINING_SOURCE_FAILED") return "TRAINING_SOURCE_FAILED";
  if (error instanceof Error && /PRIMARY_NOT_CONFIGURED|PROVIDER_SECRET_KEY is required/iu.test(error.message)) return "PROVIDER_NOT_CONFIGURED";
  return "GENERATION_FAILED";
}

export function answerFailureDiagnostic(error: unknown): { reason: ReturnType<typeof answerFailureReason>; detail: string } {
  const reason = answerFailureReason(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (/^REVIEW_(?:UNAVAILABLE|INVALID|TIMEOUT|REJECTED)$/u.test(code)) return { reason, detail: code };
  if (reason !== "GENERATION_FAILED") return { reason, detail: reason };
  if (error instanceof Error && /unknown evidence|requires evidence|duplicate (?:evidence|claim) identifier/iu.test(error.message)) return { reason, detail: "GROUNDING_INVALID" };
  if (error instanceof Error && /Codex generation|Ollama generation|returned no answer|model (?:is unavailable|.*not supported)/iu.test(error.message)) return { reason, detail: "PROVIDER_GENERATION_FAILED" };
  return { reason, detail: "UNCLASSIFIED_ERROR" };
}

export function answerFailureMessage(reason: ReturnType<typeof answerFailureReason>, revision: boolean) {
  const prefix = reason === "INVALID_PROVIDER_OUTPUT" ? "The provider returned an unusable answer."
    : reason === "PROVIDER_TIMEOUT" ? "The provider timed out."
    : reason === "PROVIDER_RATE_LIMIT" ? "The provider is rate-limited."
    : reason === "CONTEXT_LIMIT" ? "The saved training context reached provider capacity."
    : reason === "TRAINING_SOURCE_FAILED" ? "One or more trainer sources could not be prepared."
    : reason === "PROVIDER_NOT_CONFIGURED" ? "The provider is not configured."
    : revision ? "The revision failed." : "The first answer failed.";
  return `${prefix} ${revision ? "Your feedback is saved. Retry this revision." : "Your question is saved. Retry the first answer."}`;
}
