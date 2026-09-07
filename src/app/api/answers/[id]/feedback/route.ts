import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";

const bodySchema = z.object({ rating: z.enum(["HELPFUL", "NOT_HELPFUL"]), reason: z.string().max(100).nullable().optional(), comment: z.string().max(2_000).nullable().optional(), question: z.string().max(8_000), evidenceIds: z.array(z.string()).max(100).default([]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: { code: "INVALID_FEEDBACK", message: "Feedback is invalid." } }, { status: 400 });
    const saved = await getRuntimeLearningRepository().saveFeedback({ answerId: id, accountId: actor.id, rating: parsed.data.rating, reason: parsed.data.reason, comment: parsed.data.comment, questionFingerprint: createHash("sha256").update(parsed.data.question.trim().toLowerCase()).digest("hex"), corpusCommit: process.env.CORPUS_COMMIT ?? "fixture-corpus", profileRevisionIds: [], evidenceIds: parsed.data.evidenceIds });
    return Response.json({ feedback: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message === "FEEDBACK_EXISTS" || error.message.includes("unique"))) return Response.json({ error: { code: "FEEDBACK_EXISTS", message: "This answer has already been rated." } }, { status: 409 });
    return accountBoundaryErrorResponse(error);
  }
}
