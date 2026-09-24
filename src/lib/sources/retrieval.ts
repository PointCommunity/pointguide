import type { Environment } from "@/lib/config/env";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import type { SourceRepositoryStore } from "./types";

export async function knowledgeSnapshot(store: SourceRepositoryStore, environment: Environment, loadBuiltin = getCachedCorpusChunks) {
  const snapshot = await store.snapshot();
  const navigation = Object.fromEntries(snapshot.sources.filter(source => source.status === "ACTIVE" && source.validationReport.complete).map(source => [source.fullName, source.validationReport.navigation ?? {}]));
  const builtin = snapshot.sources.find(source => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE" && !source.validationReport.complete);
  if (!builtin) return { ...snapshot, navigation };
  if (environment.AUTH_MODE === "fixture") return { ...snapshot, navigation, chunks: snapshot.chunks.length ? snapshot.chunks : undefined };
  const chunks = await loadBuiltin(environment.CORPUS_ROOT!, environment.CORPUS_COMMIT!, environment.CORPUS_MANIFEST);
  const complete = snapshot.sources.filter(source => source.status === "ACTIVE" && source.validationReport.complete && source.fullName !== builtin.fullName);
  return { ...snapshot, navigation, chunks: [...chunks, ...snapshot.chunks.filter(chunk => complete.some(source => chunk.chunkId.startsWith(`${source.fullName}:`)))] };
}
