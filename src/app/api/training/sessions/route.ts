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
import { selectTrainingSource } from "@/lib/training/source-selection";
import { assertPreparedTrainingSourceCapacity, parseTrainingSourceForm, prepareTrainingSource, trainingSourceEvidence, TrainingSourceError } from "@/lib/training/sources";

const schema = z.object({ question: z.string().trim().min(1).max(8_000), targetRepository: z.string().regex(/^PointCommunity\/[A-Za-z0-9._-]+$/u).optional() }).strict();
const querySchema = z.string().trim().max(200);
async function trainer(request: Request) { const actor = await authenticateRequest(request, getRuntimeSessionDependencies()); return requireRole(actor, ["TRAINER", "ADMIN", "OWNER"]); }

export async function GET(request: Request) { try { const actor = await trainer(request); const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? ""); if (!query.success) return Response.json({ error: { code: "INVALID_SEARCH", message: "Training session search is too long." } }, { status: 400 }); return Response.json({ sessions: await getRuntimeTrainingStore().list(actor.id, query.data) }); } catch (error) { return accountBoundaryErrorResponse(error); } }
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const actor = await trainer(request);
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") ?? false;
    const form = multipart ? await request.formData() : null;
    const parsed = schema.safeParse(form ? { question: form.get("question"), targetRepository: form.get("targetRepository") || undefined } : await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_TRAINING", message: "Enter a question to start Training." } }, { status: 400 });
    const sourceInputs = form ? await parseTrainingSourceForm(form) : [];
    const sourceStore = getRuntimeSourceStore();
    const snapshot = await sourceStore.snapshot();
    const target = parsed.data.targetRepository ?? selectTrainingSource(parsed.data.question, snapshot.sources, snapshot.chunks);
    if (!target) return Response.json({ error: { code: "SOURCE_AREA_REQUIRED", message: "Which area is your question about? Choose one below, then start Training." } }, { status: 409 });
    const source = snapshot.sources.find((candidate) => candidate.status === "ACTIVE" && candidate.fullName === target);
    if (!source) return Response.json({ error: { code: "SOURCE_NOT_ACTIVE", message: "That area is not available for Training right now." } }, { status: 409 });
    const environment = parseEnvironment(process.env); const fixture = environment.AUTH_MODE === "fixture";
    const learning = getRuntimeLearningRepository(); const conversation = await learning.createConversation(actor.id, `Training: ${parsed.data.question.slice(0, 90)}`);
    const trainingStore = getRuntimeTrainingStore();
    const session = await trainingStore.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: source.fullName, originalQuestion: parsed.data.question }, !fixture, sourceInputs);
    if (!fixture) return Response.json({ session }, { status: 202 });
    try {
      const { chunks, navigation } = await knowledgeSnapshot(getRuntimeSourceStore(), environment);
      for (const item of await trainingStore.listSourceContents(session.id, actor.id)) {
        const prepared = await prepareTrainingSource(item, { describeImage: async () => "Visible trainer-provided image source." });
        assertPreparedTrainingSourceCapacity(await trainingStore.listSourceContents(session.id, actor.id), prepared);
        await trainingStore.saveSource(prepared);
      }
      const prepared = await trainingStore.listSourceContents(session.id, actor.id);
      const result = await answerQuestion({ actor, conversationId: conversation.id, question: parsed.data.question, deepResearch: false, providers: getRuntimeProviderDependencies().store, learning, fixture, modelRuntime: fixture ? undefined : getRuntimeModelRuntime(), chunks, navigation, training: true, guidance: await trainingStore.activeGuidance(), sessionEvidence: trainingSourceEvidence(parsed.data.question, prepared) });
      return Response.json({ session: await trainingStore.saveAnswer(session.id, actor.id, result.answer as unknown as Readonly<Record<string, unknown>>), sources: await trainingStore.listSources(session.id, actor.id) }, { status: 201 });
    } catch (error) {
      const diagnostic = answerFailureDiagnostic(error);
      const { reason } = diagnostic;
      console.warn("training-answer-failed", { phase: "first", ...diagnostic });
      return Response.json({ session, error: { code: "ANSWER_FAILED", reason, message: answerFailureMessage(reason, false) } }, { status: 202 });
    }
  } catch (error) { return error instanceof TrainingSourceError ? Response.json({ error: { code: "INVALID_TRAINING_SOURCE", message: error.message } }, { status: 400 }) : accountBoundaryErrorResponse(error); }
}
