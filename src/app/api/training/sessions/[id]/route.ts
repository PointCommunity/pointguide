import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeTrainingStore } from "@/lib/training/runtime";
import { TrainingStateError } from "@/lib/training/store";
import { getRuntimeProviderDependencies, getRuntimeModelRuntime } from "@/lib/providers/runtime";
import { generateTrainingReport } from "@/lib/agent/models";
import { parseEnvironment } from "@/lib/config/env";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import { answerQuestion } from "@/lib/agent/service";
import { getRuntimeProposalRepository } from "@/lib/git/runtime";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RATE"), rating: z.enum(["HELPFUL", "NOT_HELPFUL"]), explanation: z.string().trim().min(3).max(4_000) }).strict(),
  z.object({ action: z.literal("INSIGHT"), insight: z.string().trim().min(3).max(4_000) }).strict(),
  z.object({ action: z.literal("ACCEPT_REPORT") }).strict(),
  z.object({ action: z.literal("COMMIT"), confirmation: z.string().min(1).max(300) }).strict(),
  z.object({ action: z.literal("WIPE"), confirmation: z.string().min(1).max(300) }).strict(),
]);
async function trainer(request: Request) { return requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]); }
function failure(error: unknown) { return error instanceof TrainingStateError ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "TRAINING_NOT_FOUND" ? 404 : 409 }) : accountBoundaryErrorResponse(error); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const actor = await trainer(request); const { id } = await context.params; if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_TRAINING", message: "Training session ID is invalid." } }, { status: 400 });
    const parsed = actionSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: { code: "INVALID_TRAINING_ACTION", message: "Training action is invalid or incomplete." } }, { status: 400 });
    const store = getRuntimeTrainingStore(); const session = await store.get(id, actor.id);
    if (parsed.data.action === "RATE") {
      if (!session.currentAnswer) throw new TrainingStateError("INVALID_TRAINING_STATE", "An agent answer is required before feedback.");
      const environment = parseEnvironment(process.env); let report;
      if (environment.AUTH_MODE === "fixture") report = { summary: parsed.data.rating === "HELPFUL" ? "The response approach was useful and should retain the highlighted behavior." : "The response needs the trainer's requested behavior adjustment.", learned: [parsed.data.explanation], responseChanges: [parsed.data.rating === "HELPFUL" ? "Keep the helpful structure while remaining concise." : "Apply the trainer's explanation when preparing the next response."], evidenceBoundary: "Trainer feedback guides response behavior; it does not establish or replace repository facts." };
      else { const profile = await getRuntimeProviderDependencies().store.getExecutionProfile("PRIMARY"); if (!profile) throw new Error("PRIMARY_NOT_CONFIGURED"); report = await generateTrainingReport(profile, { question: session.originalQuestion, answer: session.currentAnswer, rating: parsed.data.rating, explanation: parsed.data.explanation, priorReport: session.currentReport }, getRuntimeModelRuntime()); }
      return Response.json({ session: await store.saveReport(id, actor.id, parsed.data.rating, parsed.data.explanation, report) });
    }
    if (parsed.data.action === "INSIGHT") {
      const environment = parseEnvironment(process.env); const fixture = environment.AUTH_MODE === "fixture"; const sourceStore = getRuntimeSourceStore(); const sourceRecords = await sourceStore.list(); const connected = await sourceStore.activeChunks(); const pointAudioActive = sourceRecords.some((item) => item.fullName === "PointCommunity/pointaudio" && item.status === "ACTIVE"); const local = fixture || !pointAudioActive ? [] : await getCachedCorpusChunks(environment.CORPUS_ROOT!, environment.CORPUS_COMMIT!, environment.CORPUS_MANIFEST);
      const question = `Original question: ${session.originalQuestion}\nTrainer's additional guidance: ${parsed.data.insight}\nProvide a revised, evidence-grounded answer to the original question.`;
      const chunks = fixture ? (pointAudioActive && connected.length === 0 ? undefined : connected) : [...local, ...connected];
      const result = await answerQuestion({ actor, conversationId: session.conversationId, question, deepResearch: false, providers: getRuntimeProviderDependencies().store, learning: getRuntimeLearningRepository(), fixture, modelRuntime: fixture ? undefined : getRuntimeModelRuntime(), chunks, maxTurns: 20 });
      return Response.json({ session: await store.saveAnswer(id, actor.id, result.answer as unknown as Readonly<Record<string, unknown>>, parsed.data.insight) });
    }
    if (parsed.data.action === "ACCEPT_REPORT") return Response.json({ session: await store.acceptReport(id, actor.id) });
    if (parsed.data.action === "WIPE") { if (session.state !== "REPORT_ACCEPTED") throw new TrainingStateError("INVALID_TRAINING_STATE", "Accept the learning report before wiping the session."); if (parsed.data.confirmation !== `WIPE ${id}`) return Response.json({ error: { code: "CONFIRMATION_REQUIRED", message: `Type WIPE ${id} to confirm.` } }, { status: 409 }); await store.wipe(id, actor.id); return new Response(null, { status: 204 }); }
    if (parsed.data.confirmation !== `COMMIT ${session.targetRepository}`) return Response.json({ error: { code: "CONFIRMATION_REQUIRED", message: `Type COMMIT ${session.targetRepository} to confirm.` } }, { status: 409 });
    if (session.state !== "REPORT_ACCEPTED" || !session.currentReport) throw new TrainingStateError("INVALID_TRAINING_STATE", "Accept the learning report before committing it.");
    const source = (await getRuntimeSourceStore().list()).find((candidate) => candidate.fullName === session.targetRepository && candidate.status === "ACTIVE"); if (!source) return Response.json({ error: { code: "SOURCE_NOT_ACTIVE", message: "The target source repository is no longer active." } }, { status: 409 });
    const artifact = JSON.stringify({ schemaVersion: 1, kind: "pointguide-training-guidance", sessionId: session.id, originalQuestion: session.originalQuestion, acceptedReport: session.currentReport, evidenceBoundary: "Behavioral guidance only. Repository facts remain authoritative.", createdAt: new Date().toISOString() }, null, 2) + "\n";
    const proposals = getRuntimeProposalRepository();
    const proposal = await proposals.create({ proposerId: actor.id, rationale: `Accepted PointGuide training for: ${session.originalQuestion.slice(0, 180)}`, targetRepository: session.targetRepository, baseCommit: source.indexedCommit, targetPath: `research/pointguide-training/${new Date().toISOString().slice(0, 10)}-${session.id}.json`, operation: "CREATE", proposedContent: artifact });
    const inReview = await proposals.transition(proposal.id, "IN_REVIEW", actor.id);
    return Response.json({ session: await store.markProposed(id, actor.id, proposal.id), proposal: inReview });
  } catch (error) { return failure(error); }
}
