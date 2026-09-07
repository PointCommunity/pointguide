import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeProposalRepository } from "@/lib/git/runtime";

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]);
    return Response.json({ actor: { role: actor.role }, feedback: await getRuntimeLearningRepository().listFeedback(), proposals: await getRuntimeProposalRepository().list() });
  } catch (error) { return accountBoundaryErrorResponse(error); }
}
