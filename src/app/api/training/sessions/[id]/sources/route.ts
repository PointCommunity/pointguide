import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeTrainingStore } from "@/lib/training/runtime";
import { TrainingStateError } from "@/lib/training/store";
import { assertPreparedTrainingSourceCapacity, parseTrainingSourceForm, prepareTrainingSource, trainingSourceEvidence, TrainingSourceError } from "@/lib/training/sources";
import { parseEnvironment } from "@/lib/config/env";
import { knowledgeSnapshot } from "@/lib/sources/retrieval";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { answerQuestion } from "@/lib/agent/service";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { trainingHistory } from "@/lib/training/context";

const deleteSchema = z.object({ sourceId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();
async function trainer(request: Request) { return requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]); }
function failure(error: unknown) {
  if (error instanceof TrainingSourceError) return Response.json({ error: { code: "INVALID_TRAINING_SOURCE", message: error.message } }, { status: 400 });
  return error instanceof TrainingStateError ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "TRAINING_NOT_FOUND" ? 404 : 409 }) : accountBoundaryErrorResponse(error);
}

async function fixtureAnswer(id: string, actor: Awaited<ReturnType<typeof trainer>>) {
  const store = getRuntimeTrainingStore();
  const current = await store.get(id, actor.id); const turns = await store.listTurns(id, actor.id);
  for (const source of (await store.listSourceContents(id, actor.id)).filter(item => item.status !== "READY")) {
    const prepared = await prepareTrainingSource(source, { describeImage: async () => "Visible trainer-provided image source." });
    assertPreparedTrainingSourceCapacity(await store.listSourceContents(id, actor.id), prepared);
    await store.saveSource(prepared);
  }
  const sources = await store.listSourceContents(id, actor.id); const environment = parseEnvironment(process.env);
  const { chunks, navigation } = await knowledgeSnapshot(getRuntimeSourceStore(), environment);
  const history = trainingHistory(current, turns);
  const result = await answerQuestion({ actor, conversationId: current.conversationId, question: current.originalQuestion, deepResearch: false, providers: getRuntimeProviderDependencies().store, learning: getRuntimeLearningRepository(), fixture: true, chunks, navigation, training: true, trainingHistory: history, guidance: await store.activeGuidance(), sessionEvidence: trainingSourceEvidence([current.originalQuestion, ...history.map(item => item.content)].join("\n"), sources) });
  return Response.json({ session: await store.saveAnswer(id, actor.id, result.answer as unknown as Readonly<Record<string, unknown>>), turns: await store.listTurns(id, actor.id), sources: await store.listSources(id, actor.id) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await trainer(request); const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_TRAINING", message: "Training session ID is invalid." } }, { status: 400 });
    const form = await request.formData(); const expectedVersion = Number(form.get("expectedVersion"));
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return Response.json({ error: { code: "INVALID_TRAINING_SOURCE", message: "Reload the session before adding source material." } }, { status: 400 });
    const inputs = await parseTrainingSourceForm(form);
    if (!inputs.length) return Response.json({ error: { code: "INVALID_TRAINING_SOURCE", message: "Add a website URL or source file." } }, { status: 400 });
    const fixture = parseEnvironment(process.env).AUTH_MODE === "fixture"; const store = getRuntimeTrainingStore();
    await store.addSources(id, actor.id, expectedVersion, inputs, !fixture);
    if (fixture) return fixtureAnswer(id, actor);
    return Response.json({ session: await store.get(id, actor.id), turns: await store.listTurns(id, actor.id), sources: await store.listSources(id, actor.id) }, { status: 202 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await trainer(request); const { id } = await context.params;
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: { code: "INVALID_TRAINING_SOURCE", message: "Reload the session before removing source material." } }, { status: 400 });
    const fixture = parseEnvironment(process.env).AUTH_MODE === "fixture"; const store = getRuntimeTrainingStore();
    await store.removeSource(id, actor.id, parsed.data.expectedVersion, parsed.data.sourceId, !fixture);
    if (fixture) return fixtureAnswer(id, actor);
    return Response.json({ session: await store.get(id, actor.id), turns: await store.listTurns(id, actor.id), sources: await store.listSources(id, actor.id) }, { status: 202 });
  } catch (error) { return failure(error); }
}
