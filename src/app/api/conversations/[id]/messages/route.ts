import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeModelRuntime, getRuntimeProviderDependencies } from "@/lib/providers/runtime";
import { parseEnvironment } from "@/lib/config/env";
import { answerQuestion } from "@/lib/agent/service";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";

const bodySchema = z.object({ question: z.string().trim().min(1).max(8_000), deepResearch: z.boolean().default(false) }).strict();
const encoder = new TextEncoder();

function event(type: string, data: unknown): Uint8Array { return encoder.encode(`${JSON.stringify({ type, data })}\n`); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try { assertSameOrigin(request); actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies())); }
  catch (error) { return accountBoundaryErrorResponse(error); }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_CONVERSATION", message: "Conversation ID is invalid." } }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "INVALID_QUESTION", message: "Enter a question between 1 and 8,000 characters." } }, { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(event("status", { stage: "retrieval", message: "Checking repository evidence" }));
      try {
        const environment = parseEnvironment(process.env);
        if (parsed.data.deepResearch) controller.enqueue(event("status", { stage: "review", message: "Independent review requested" }));
        const fixture = environment.AUTH_MODE === "fixture";
        const sourceStore = getRuntimeSourceStore();
        const configuredSources = await sourceStore.list();
        const configuredChunks = await sourceStore.activeChunks();
        const pointAudioActive = configuredSources.some((source) => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE");
        const localChunks = fixture || !pointAudioActive ? [] : await getCachedCorpusChunks(environment.CORPUS_ROOT!, environment.CORPUS_COMMIT!, environment.CORPUS_MANIFEST);
        const chunks = fixture ? (pointAudioActive && configuredChunks.length === 0 ? undefined : configuredChunks) : [...localChunks, ...configuredChunks];
        const result = await answerQuestion({ actor, conversationId: id, question: parsed.data.question, deepResearch: parsed.data.deepResearch, providers: getRuntimeProviderDependencies().store, learning: getRuntimeLearningRepository(), fixture, chunks, modelRuntime: fixture ? undefined : getRuntimeModelRuntime() });
        controller.enqueue(event("answer", result));
        controller.enqueue(event("done", {}));
      } catch (error) {
        const code = error instanceof Error ? error.message : "ANSWER_FAILED";
        controller.enqueue(event("error", { code, message: code === "TURN_LIMIT_REACHED" ? "This support session has reached its limit of five follow-up questions. Start a new session to continue." : code === "REVIEW_DISABLED" ? "Deep research is disabled by the Owner." : code === "CONVERSATION_NOT_FOUND" ? "Conversation was not found." : code.includes("CONFIGURED") ? "The required agent profile is not configured." : "PointGuide could not produce a verified answer." }));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
