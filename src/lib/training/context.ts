import type { ConversationMessage } from "@/lib/learning/store";
import type { TrainingSessionRecord, TrainingTurn } from "./types";

export function trainingHistory(session: TrainingSessionRecord, turns: TrainingTurn[]): ConversationMessage[] {
  const history: ConversationMessage[] = [{ actor: "USER", content: `Original question: ${session.originalQuestion}` }];
  for (const turn of turns) {
    if (turn.kind === "FEEDBACK") history.push({ actor: "USER", content: `Trainer feedback, turn ${turn.ordinal}: ${String(turn.content.feedback ?? "")}` });
    else if (turn.kind === "ANSWER") {
      const answer = turn.content.answer as Readonly<Record<string, unknown>> | undefined;
      if (!answer) continue;
      const evidence = Array.isArray(answer.evidence) ? answer.evidence.map(item => typeof item === "object" && item && "id" in item ? item.id : null).filter(Boolean) : [];
      history.push({ actor: "ASSISTANT", content: JSON.stringify({ answerId: answer.id ?? null, directAnswer: answer.directAnswer ?? null, evidenceIds: evidence }) });
    } else if (turn.kind === "REPORT" && typeof turn.content.explanation === "string") history.push({ actor: "USER", content: `Legacy trainer feedback, turn ${turn.ordinal}: ${turn.content.explanation}` });
  }
  return history;
}
