import type { IndexedChunk } from "@/lib/evidence/search";

const normalized = (value: string) => ` ${value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

export function selectTrainingSource(question: string, sources: readonly { fullName: string; status: string }[], chunks: IndexedChunk[]): string | null {
  const active = sources.filter(source => source.status === "ACTIVE");
  if (active.length === 1) return active[0].fullName;
  const query = normalized(question);
  const matches = active.filter(source => chunks.some(chunk => chunk.chunkId.startsWith(`${source.fullName}:`) && [chunk.metadata?.product, chunk.metadata?.applicability?.model].some(name => name && query.includes(normalized(name)))));
  return matches.length === 1 ? matches[0].fullName : null;
}
