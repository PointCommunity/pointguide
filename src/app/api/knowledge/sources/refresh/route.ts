import { authenticateRequest } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/policy";
import { accountBoundaryErrorResponse, assertSameOrigin } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { validateSourceRepository } from "@/lib/sources/validator";
import { refreshKnowledge, type RefreshEvent } from "@/lib/sources/refresh";
import { parseEnvironment } from "@/lib/config/env";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = requireRole(await authenticateRequest(request, getRuntimeSessionDependencies()), ["TRAINER", "ADMIN", "OWNER"]);
    const environment = parseEnvironment(process.env);
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: RefreshEvent) => { if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
        const heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000);
        try {
          await refreshKnowledge(actor.id, getRuntimeSourceStore(), url => validateSourceRepository(url, { token: environment.GITHUB_TOKEN, allowedOwners: environment.POINTGUIDE_SOURCE_OWNERS.split(",").map(value => value.trim()).filter(Boolean), signal }), emit, signal);
        } catch { if (!signal.aborted) controller.error(new Error("Refresh interrupted. Check repository status and try again.")); }
        finally { clearInterval(heartbeat); if (!signal.aborted) controller.close(); }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (error) { return accountBoundaryErrorResponse(error); }
}
