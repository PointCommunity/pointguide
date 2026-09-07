import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

const inputSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
const querySchema = z.string().trim().max(200).default("");

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
    if (!parsed.success) return Response.json({ error: { code: "INVALID_QUERY", message: "Search is limited to 200 characters." } }, { status: 400 });
    const sessions = await getRuntimeLearningRepository().listConversations(actor.id, parsed.data);
    return Response.json({ sessions, query: parsed.data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return accountBoundaryErrorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "A conversation title is required." } }, { status: 400 });
    const conversation = await getRuntimeLearningRepository().createConversation(actor.id, parsed.data.title);
    const review = await getRuntimeProviderDependencies().store.getReviewSetting();
    return Response.json({ conversation, reviewEnabled: review.enabled, usage: { turnNumber: 0, maxTurns: 6, followUpsRemaining: 5 } }, { status: 201 });
  } catch (error) { return accountBoundaryErrorResponse(error); }
}
