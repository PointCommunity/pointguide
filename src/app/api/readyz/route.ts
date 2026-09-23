import { inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { sourceChunks } from "@/db/schema";
import { parseEnvironment } from "@/lib/config/env";
import { demoSourceCount } from "@/lib/evidence/demo";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";

export async function GET(): Promise<Response> {
  try {
    const environment = parseEnvironment(process.env);
    if (environment.AUTH_MODE === "fixture" || environment.NODE_ENV === "test") return Response.json({ status: "ready", mode: "fixture", sources: demoSourceCount });
    if (!environment.DATABASE_URL || !environment.CORPUS_ROOT || !environment.CORPUS_COMMIT) throw new Error("Incomplete readiness configuration.");
    const database = getDatabase(environment.DATABASE_URL);
    await database.execute(sql`select 1`);
    const sources = await getRuntimeSourceStore().list();
    const complete = sources.filter(source => source.status === "ACTIVE" && source.validationReport.complete);
    const [count] = complete.length ? await database.select({ value: sql<number>`count(*)::integer` }).from(sourceChunks).where(inArray(sourceChunks.repositoryId, complete.map(source => source.id))) : [];
    const pointAudio = sources.find(source => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE");
    const builtinCount = pointAudio && !pointAudio.validationReport.complete ? (await getCachedCorpusChunks(environment.CORPUS_ROOT, environment.CORPUS_COMMIT, environment.CORPUS_MANIFEST)).length : 0;
    return Response.json({ status: "ready", mode: "repository", corpusCommit: pointAudio?.indexedCommit ?? null, chunks: (count?.value ?? 0) + builtinCount });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
