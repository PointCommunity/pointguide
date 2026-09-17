import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeProviderDependencies, getRuntimeModelRuntime } from "@/lib/providers/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { getRuntimeTrainingStore } from "@/lib/training/runtime";
import { answerQuestion } from "@/lib/agent/service";
import { parseEnvironment } from "@/lib/config/env";
import { knowledgeSnapshot } from "@/lib/sources/retrieval";
import { answerFailureDiagnostic, answerFailureMessage } from "@/lib/training/answer-error";

const schema = z.object({ question: z.string().trim().min(1).max(8_000), targetRepository: z.string().regex(/^PointCommunity\/[A-Za-z0-9._-]+$/u) }).strict();
const querySchema = z.string().trim().max(200);
async function trainer(request: Request) { const actor = await authenticateRequest(request, getRuntimeSessionDependencies()); return requireRole(actor, ["TRAINER", "ADMIN", "OWNER"]); }

export async function GET(request: Request) { try { const actor = await trainer(request); const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? ""); if (!query.success) return Response.json({ error: { code: "INVALID_SEARCH", message: "Training session search is too long." } }, { status: 400 }); return Response.json({ sessions: await getRuntimeTrainingStore().list(actor.id, query.data) }); } catch (error) { return accountBoundaryErrorResponse(error); } }
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await trainer(request); const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_TRAINING", message: "Enter a question and choose an active source repository." } }, { status: 400 });
    const source = (await getRuntimeSourceStore().list()).find((candidate) => candidate.status === "ACTIVE" && candidate.fullName === parsed.data.targetRepository);
    if (!source) return Response.json({ error: { code: "SOURCE_NOT_ACTIVE", message: "Choose an active connected source repository." } }, { status: 409 });
    const learning = getRuntimeLearningRepository(); const conversation = await learning.createConversation(actor.id, `Training: ${parsed.data.question.slice(0, 90)}`);
    const session = await getRuntimeTrainingStore().create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: source.fullName, originalQuestion: parsed.data.question });
    try {
      const environment = parseEnvironment(process.env); const fixture = environment.AUTH_MODE === "fixture";
      const { chunks } = await knowledgeSnapshot(getRuntimeSourceStore(), environment);
      const result = await answerQuestion({ actor, conversationId: conversation.id, question: parsed.data.question, deepResearch: false, providers: getRuntimeProviderDependencies().store, learning, fixture, modelRuntime: fixture ? undefined : getRuntimeModelRuntime(), chunks, training: true, guidance: await getRuntimeTrainingStore().activeGuidance() });
      return Response.json({ session: await getRuntimeTrainingStore().saveAnswer(session.id, actor.id, result.answer as unknown as Readonly<Record<string, unknown>>) }, { status: 201 });
    } catch (error) {
      const diagnostic = answerFailureDiagnostic(error);
      const { reason } = diagnostic;
      console.warn("training-answer-failed", { phase: "first", ...diagnostic });
      return Response.json({ session, error: { code: "ANSWER_FAILED", reason, message: answerFailureMessage(reason, false) } }, { status: 202 });
    }
  } catch (error) { return accountBoundaryErrorResponse(error); }
}
