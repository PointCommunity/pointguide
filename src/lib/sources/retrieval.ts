import type { Environment } from "@/lib/config/env";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import type { SourceRepositoryStore } from "./types";

export async function knowledgeSnapshot(store: SourceRepositoryStore, environment: Environment, loadBuiltin = getCachedCorpusChunks) {
  const snapshot = await store.snapshot();
  const builtin = snapshot.sources.find(source => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE" && !source.validationReport.complete);
  if (!builtin) return snapshot;
  if (environment.AUTH_MODE === "fixture") return { ...snapshot, chunks: snapshot.chunks.length ? snapshot.chunks : undefined };
  const chunks = await loadBuiltin(environment.CORPUS_ROOT!, environment.CORPUS_COMMIT!, environment.CORPUS_MANIFEST);
  return { ...snapshot, chunks: [...chunks, ...snapshot.chunks] };
}
