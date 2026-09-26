import type { Environment } from "@/lib/config/env";
import { getCachedCorpusChunks } from "@/lib/evidence/runtime-corpus";
import type { SourceRepositoryStore } from "./types";
import { acceptedGuidanceFromArtifact, type AcceptedGuidance } from "@/lib/training/knowledge";

export async function knowledgeSnapshot(store: SourceRepositoryStore, environment: Environment, loadBuiltin = getCachedCorpusChunks) {
  const raw = await store.snapshot();
  const reserved = new Map(raw.chunks.filter(chunk => chunk.path.startsWith("research/pointguide-training/")).map(chunk => [chunk.chunkId, chunk]));
  const guidance: AcceptedGuidance[] = raw.sources.flatMap(source => (source.validationReport.acceptedTraining ?? []).flatMap(record => {
    const chunk = reserved.get(`${source.fullName}:training:${record.digest}`);
    if (!chunk || chunk.path !== record.path || chunk.digest !== record.digest || chunk.sourceId !== source.fullName || chunk.locator !== `${source.fullName}@${source.indexedCommit}`) return [];
    const accepted = acceptedGuidanceFromArtifact(chunk.text, record, source);
    return accepted ? [accepted] : [];
  }));
  const snapshot = { ...raw, guidance, chunks: raw.chunks.filter(chunk => !chunk.path.startsWith("research/pointguide-training/")) };
  const navigation = Object.fromEntries(snapshot.sources.filter(source => source.status === "ACTIVE" && source.validationReport.complete).map(source => [source.fullName, source.validationReport.navigation ?? {}]));
  const builtin = snapshot.sources.find(source => source.fullName === "PointCommunity/pointaudio" && source.status === "ACTIVE" && !source.validationReport.complete);
  if (!builtin) return { ...snapshot, navigation };
  if (environment.AUTH_MODE === "fixture") return { ...snapshot, navigation, chunks: snapshot.chunks.length ? snapshot.chunks : undefined };
  const chunks = await loadBuiltin(environment.CORPUS_ROOT!, environment.CORPUS_COMMIT!, environment.CORPUS_MANIFEST);
  const complete = snapshot.sources.filter(source => source.status === "ACTIVE" && source.validationReport.complete && source.fullName !== builtin.fullName);
  return { ...snapshot, navigation, chunks: [...chunks.filter(chunk => !chunk.path.startsWith("research/pointguide-training/")), ...snapshot.chunks.filter(chunk => complete.some(source => chunk.chunkId.startsWith(`${source.fullName}:`)))] };
}
