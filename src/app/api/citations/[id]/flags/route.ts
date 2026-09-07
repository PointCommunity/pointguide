import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateRequest } from "@/lib/auth/session";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getDatabase } from "@/db/client";
import { webFindings } from "@/db/schema";
import { parseEnvironment } from "@/lib/config/env";

const schema = z.object({ url: z.url(), excerpt: z.string().min(1).max(2_000), authority: z.string().min(1).max(100), notes: z.string().max(2_000).optional() }).strict();
const fixtureFlags = new Map<string, unknown>();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = requireApprovedAccount(await authenticateRequest(request, getRuntimeSessionDependencies()));
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "INVALID_FINDING", message: "A URL and evidence excerpt are required." } }, { status: 400 });
    const { id: citationId } = await context.params;
    const finding = { id: randomUUID(), ...parsed.data, citationId, capturedAt: new Date(), digest: createHash("sha256").update(parsed.data.excerpt).digest("hex"), reviewState: "FLAGGED", flaggerId: actor.id };
    const environment = parseEnvironment(process.env);
    if (environment.AUTH_MODE === "fixture") fixtureFlags.set(finding.id, finding);
    else if (environment.DATABASE_URL) await getDatabase(environment.DATABASE_URL).insert(webFindings).values(finding);
    return Response.json({ finding: { ...finding, capturedAt: finding.capturedAt.toISOString() } }, { status: 201 });
  } catch (error) { return accountBoundaryErrorResponse(error); }
}
