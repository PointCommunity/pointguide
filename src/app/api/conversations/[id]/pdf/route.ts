import { z } from "zod";
import { accountBoundaryErrorResponse } from "@/lib/auth/http";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { authenticateRequest } from "@/lib/auth/session";
import { buildSessionPdf } from "@/lib/learning/pdf";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";

function filename(title: string): string {
  const slug = title.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 64) || "pointguide-session";
  return `${slug}.pdf`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_CONVERSATION", message: "Conversation ID is invalid." } }, { status: 400 });
    const detail = await getRuntimeLearningRepository().getConversation(id, actor.id);
    if (!detail.turns.length) return Response.json({ error: { code: "EMPTY_CONVERSATION", message: "Ask at least one question before exporting this session." } }, { status: 409 });
    const bytes = await buildSessionPdf(detail);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename(detail.conversation.title)}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CONVERSATION_NOT_FOUND") return Response.json({ error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    return accountBoundaryErrorResponse(error);
  }
}
