import { z } from "zod";
import { accountBoundaryErrorResponse } from "@/lib/auth/http";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { authenticateRequest } from "@/lib/auth/session";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_CONVERSATION", message: "Conversation ID is invalid." } }, { status: 400 });
    const detail = await getRuntimeLearningRepository().getConversation(id, actor.id);
    const review = await getRuntimeProviderDependencies().store.getReviewSetting();
    return Response.json({ ...detail, reviewEnabled: review.enabled, usage: { turnNumber: detail.conversation.userTurnCount, maxTurns: 6, followUpsRemaining: Math.max(0, 6 - detail.conversation.userTurnCount) } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CONVERSATION_NOT_FOUND") return Response.json({ error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    return accountBoundaryErrorResponse(error);
  }
}
