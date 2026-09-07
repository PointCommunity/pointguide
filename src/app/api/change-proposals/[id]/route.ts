import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeProposalRepository } from "@/lib/git/runtime";
import { proposalStates } from "@/lib/git/proposals";

const schema = z.object({ state: z.enum(proposalStates) }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json().catch(() => null)); const { id } = await context.params;
    if (!parsed.success || !z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_TRANSITION", message: "Proposal transition is invalid." } }, { status: 400 });
    const roles = parsed.data.state === "APPROVED" ? ["ADMIN", "OWNER"] as const : ["TRAINER", "ADMIN", "OWNER"] as const;
    const actor = requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), roles);
    return Response.json({ proposal: await getRuntimeProposalRepository().transition(id, parsed.data.state, actor.id) });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_TRANSITION") return Response.json({ error: { code: "INVALID_TRANSITION", message: "That proposal state change is not allowed." } }, { status: 409 });
    return accountBoundaryErrorResponse(error);
  }
}
