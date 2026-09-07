import { sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { demoSourceCount } from "@/lib/evidence/demo";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";

export async function GET(): Promise<Response> {
  try {
    const environment = parseEnvironment(process.env);
    if (environment.AUTH_MODE === "fixture" || environment.NODE_ENV === "test") return Response.json({ status: "ready", mode: "fixture", sources: demoSourceCount });
    if (!environment.DATABASE_URL || !environment.CORPUS_ROOT || !environment.CORPUS_COMMIT) throw new Error("Incomplete readiness configuration.");
    await getDatabase(environment.DATABASE_URL).execute(sql`select 1`);
    const chunks = await getCachedCorpusChunks(environment.CORPUS_ROOT, environment.CORPUS_COMMIT, environment.CORPUS_MANIFEST);
    return Response.json({ status: "ready", mode: "repository", corpusCommit: environment.CORPUS_COMMIT, chunks: chunks.length });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
