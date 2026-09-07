import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { SourceStoreError } from "@/lib/sources/store";
import { SourceValidationError, validateSourceRepository } from "@/lib/sources/validator";
import { parseEnvironment } from "@/lib/config/env";

const addSchema = z.object({ repositoryUrl: z.url().max(500) }).strict();
async function actor(request: Request) { const value = await authenticateRequest(request, getRuntimeSessionDependencies()); requireRole(value, ["TRAINER", "ADMIN", "OWNER"]); return value; }
function failure(error: unknown) {
  if (error instanceof SourceValidationError) return Response.json({ error: { code: error.code, message: error.message }, report: error.report }, { status: error.code === "SOURCE_INVALID" ? 422 : 400 });
  if (error instanceof SourceStoreError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "SOURCE_EXISTS" ? 409 : 400 });
  return accountBoundaryErrorResponse(error);
}

export async function GET(request: Request) { try { await actor(request); return Response.json({ sources: await getRuntimeSourceStore().list() }); } catch (error) { return failure(error); } }
export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const current = await actor(request);
    const parsed = addSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Enter a valid GitHub repository URL." } }, { status: 400 });
    const environment = parseEnvironment(process.env);
    const allowedOwners = environment.POINTGUIDE_SOURCE_OWNERS.split(",").map((value) => value.trim()).filter(Boolean);
    const validated = await validateSourceRepository(parsed.data.repositoryUrl, { token: environment.GITHUB_TOKEN, allowedOwners });
    return Response.json({ source: await getRuntimeSourceStore().link(current.id, validated), report: validated.report }, { status: 201 });
  } catch (error) { return failure(error); }
}
