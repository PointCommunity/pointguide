import type { EvidenceItem } from "@/lib/agent/schema";
import type { SourceInventoryItem } from "@/lib/sources/contract";

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
  metadata?: SourceInventoryItem;
}

const stopWords = new Set([
  "a", "an", "and", "are", "be", "do", "for", "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "what", "why", "with",
]);
const genericProductTerms = new Set(["audio", "center", "church", "community", "equipment", "family", "midas", "mixed", "planning", "point", "product", "software", "sources"]);

export function terms(value: string): string[] {
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

function excerpt(text: string): string {
  if (text.length > 4_000) throw new Error("Evidence block exceeds the 4,000-character context budget; it was not truncated.");
  return text;
}

function applicableProducts(query: string, chunks: IndexedChunk[]): Set<string> {
  const products = [...new Set(chunks.flatMap(chunk => chunk.metadata?.product ?? []))];
  const asked = new Set(terms(query));
  const normalized = ` ${query.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const exact = products.filter(product => normalized.includes(` ${product.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `));
  if (exact.length) return new Set(exact);
  const unique = new Map<string, number>();
  for (const product of products) for (const term of terms(product)) unique.set(term, (unique.get(term) ?? 0) + 1);
  const scores = products.map(product => ({ product, score: terms(product).filter(term => asked.has(term) && unique.get(term) === 1 && !genericProductTerms.has(term)).length }));
  const best = Math.max(0, ...scores.map(item => item.score));
  return new Set(scores.filter(item => best && item.score === best).map(item => item.product));
}

export function searchCorpus(query: string, chunks: IndexedChunk[], limit = 8): EvidenceItem[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0 || limit <= 0) return [];

  const products = applicableProducts(query, chunks);
  return chunks
    .filter(chunk => !chunk.path.startsWith("research/pointguide-training/"))
    .filter(chunk => !products.size || products.has(chunk.metadata?.product ?? ""))
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
      excerpt: excerpt(chunk.text),
      digest: chunk.digest,
      product: chunk.metadata?.product,
      applicability: chunk.metadata?.applicability,
      verifiedAt: chunk.metadata?.verifiedAt,
      sourceCapturedAt: chunk.metadata?.capturedAt,
    }));
}
