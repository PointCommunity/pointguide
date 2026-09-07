import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { validateChecksumManifest } from "./corpus";
import type { IndexedChunk } from "./search";

const inventorySchema = z.object({ snapshotDate: z.string(), sources: z.array(z.object({ id: z.string(), authority: z.string(), title: z.string(), versionOrDate: z.string().optional(), textPath: z.string().optional() })) });
const cache = new Map<string, Promise<IndexedChunk[]>>();

export async function loadCorpusChunks(root: string, commit: string, manifest = "research/midas-m32/checksums.sha256"): Promise<IndexedChunk[]> {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Corpus commit must be an exact SHA.");
  const actual = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actual !== commit) throw new Error("Corpus checkout does not match the configured commit.");
  await validateChecksumManifest(root, manifest);
  const inventory = inventorySchema.parse(JSON.parse(await readFile(resolve(root, "research/midas-m32/source-inventory.json"), "utf8")));
  const capturedAt = `${inventory.snapshotDate}T00:00:00.000Z`;
  const chunks: IndexedChunk[] = [];
  for (const source of inventory.sources) {
    if (!source.textPath) continue;
    const path = `research/midas-m32/${source.textPath}`;
    const text = await readFile(resolve(root, path), "utf8");
    for (let start = 0, ordinal = 0; start < text.length; start += 1_400, ordinal += 1) {
      const segment = text.slice(start, start + 1_600).trim();
      if (!segment) continue;
      const digest = createHash("sha256").update(segment).digest("hex");
      chunks.push({ chunkId: `${source.id}:${ordinal}:${digest.slice(0, 12)}`, sourceId: source.id, title: source.title, path, locator: `Extracted text characters ${start + 1}–${Math.min(start + 1_600, text.length)}`, authority: source.authority, versionOrDate: source.versionOrDate, capturedAt, digest, text: segment });
    }
  }
  if (!chunks.length) throw new Error("Corpus contains no searchable text.");
  return chunks;
}

export function getCachedCorpusChunks(root: string, commit: string, manifest?: string): Promise<IndexedChunk[]> {
  const key = `${root}:${commit}:${manifest ?? "default"}`;
  const existing = cache.get(key); if (existing) return existing;
  const loading = loadCorpusChunks(root, commit, manifest).catch((error) => { cache.delete(key); throw error; });
  cache.set(key, loading); return loading;
}
