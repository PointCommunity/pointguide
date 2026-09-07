import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { SourceStoreError } from "@/lib/sources/store";

const bodySchema = z.object({ confirmation: z.string().min(1).max(250) }).strict();
async function actor(request: Request) { const value = await authenticateRequest(request, getRuntimeSessionDependencies()); requireRole(value, ["TRAINER", "ADMIN", "OWNER"]); return value; }
function failure(error: unknown) { return error instanceof SourceStoreError ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "SOURCE_NOT_FOUND" ? 404 : 409 }) : accountBoundaryErrorResponse(error); }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const current = await actor(request); const { id } = await context.params; if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_SOURCE", message: "Source ID is invalid." } }, { status: 400 }); const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Type the repository name to confirm archival." } }, { status: 400 }); return Response.json(await getRuntimeSourceStore().archive(current.id, id, parsed.data.confirmation)); } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); const current = await actor(request); const { id } = await context.params; if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_SOURCE", message: "Source ID is invalid." } }, { status: 400 }); const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Type the repository name to confirm deletion." } }, { status: 400 }); await getRuntimeSourceStore().remove(current.id, id, parsed.data.confirmation); return new Response(null, { status: 204 }); } catch (error) { return failure(error); }
}
