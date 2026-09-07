import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeProposalRepository } from "@/lib/git/runtime";

const schema = z.object({ rationale: z.string().trim().min(1).max(2_000), targetRepository: z.literal("PointCommunity/pointaudio"), baseCommit: z.string().regex(/^[a-f0-9]{7,64}$/u), targetPath: z.string().min(1).max(500), operation: z.enum(["CREATE", "UPDATE", "SUPERSEDE"]), proposedContent: z.string().min(1).max(500_000) }).strict();

export async function GET(request: Request): Promise<Response> {
  try { requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]); return Response.json({ proposals: await getRuntimeProposalRepository().list() }); }
  catch (error) { return accountBoundaryErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_PROPOSAL", message: "Proposal content is invalid or outside its bounds." } }, { status: 400 });
    return Response.json({ proposal: await getRuntimeProposalRepository().create({ proposerId: actor.id, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("allow-list")) return Response.json({ error: { code: "PATH_NOT_ALLOWED", message: error.message } }, { status: 400 });
    return accountBoundaryErrorResponse(error);
  }
}
