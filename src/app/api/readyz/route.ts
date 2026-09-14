import { sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { demoSourceCount } from "@/lib/evidence/demo";
import { knowledgeSnapshot } from "@/lib/sources/retrieval";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";

export async function GET(): Promise<Response> {
  try {
    const environment = parseEnvironment(process.env);
    if (environment.AUTH_MODE === "fixture" || environment.NODE_ENV === "test") return Response.json({ status: "ready", mode: "fixture", sources: demoSourceCount });
    if (!environment.DATABASE_URL || !environment.CORPUS_ROOT || !environment.CORPUS_COMMIT) throw new Error("Incomplete readiness configuration.");
    await getDatabase(environment.DATABASE_URL).execute(sql`select 1`);
    const { sources, chunks } = await knowledgeSnapshot(getRuntimeSourceStore(), environment);
    return Response.json({ status: "ready", mode: "repository", corpusCommit: sources.find(source => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE")?.indexedCommit ?? null, chunks: chunks?.length ?? 0 });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
