import type { EvidenceItem } from "@/lib/agent/schema";

export interface IndexedChunk {
  chunkId: string;
  sourceId: string;
  title: string;
  path: string;
  locator: string;
  authority: string;
  versionOrDate?: string;
  capturedAt: string;
  digest: string;
  text: string;
}

const stopWords = new Set([
  "a", "an", "and", "are", "be", "do", "for", "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "what", "why", "with",
]);

function terms(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length > 1 && !stopWords.has(term)))];
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function scoreChunk(queryTerms: string[], chunk: IndexedChunk): number {
  const title = chunk.title.toLocaleLowerCase();
  const locator = chunk.locator.toLocaleLowerCase();
  const text = chunk.text.toLocaleLowerCase();
  return queryTerms.reduce((score, term) => (
    score + (occurrences(title, term) * 4) + (occurrences(locator, term) * 2) + occurrences(text, term)
  ), 0);
}

function excerpt(text: string, queryTerms: string[]): string {
  const lower = text.toLocaleLowerCase();
  const starts = queryTerms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
  const first = starts.length ? Math.min(...starts) : 0;
  const start = Math.max(0, first - 120);
  const value = text.slice(start, start + 500).trim();
  return `${start > 0 ? "…" : ""}${value}${start + 500 < text.length ? "…" : ""}`;
}

export function searchCorpus(query: string, chunks: IndexedChunk[], limit = 8): EvidenceItem[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0 || limit <= 0) return [];

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTerms, chunk) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId))
    .slice(0, limit)
    .map(({ chunk }) => ({
      id: `repo:${chunk.chunkId}`,
      kind: "REPOSITORY" as const,
      sourceId: chunk.sourceId,
      title: chunk.title,
      path: chunk.path,
      locator: chunk.locator,
      authority: chunk.authority,
      versionOrDate: chunk.versionOrDate,
      capturedAt: chunk.capturedAt,
      excerpt: excerpt(chunk.text, queryTerms),
      digest: chunk.digest,
    }));
}
