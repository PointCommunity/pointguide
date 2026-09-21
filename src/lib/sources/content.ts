import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { z } from "zod";
import type { IndexedChunk } from "@/lib/evidence/search";
import type { SourceInventoryItem } from "./contract";

interface HtmlNode { textContent: string; getAttribute(name: string): string | undefined; querySelectorAll(selector: string): HtmlNode[]; querySelector(selector: string): HtmlNode | null; remove(): void }
// Next already ships this inert parser. Never evaluate scripts or load HTML resources.
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser") as { parse(html: string): HtmlNode };
const inventorySchema = z.object({ sources: z.array(z.object({ id: z.string(), title: z.string().optional(), authority: z.string(), publisher: z.string().optional(), versionOrDate: z.string().optional(), capturedAt: z.string().optional(), textPath: z.string().optional(), textPaths: z.array(z.string()).optional(), pages: z.number().int().positive().optional() })), pageMap: z.string().optional() });
const pageSchema = z.array(z.object({ evidenceId: z.string(), pdfPage: z.number().int().positive(), path: z.string(), textSha256: z.string() }));
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export function safePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f\x7f]/u.test(path)) throw new Error("Invalid repository evidence path.");
  return path;
}

export function indexContents(fullName: string, commit: string, capturedAt: string, files: Map<string, string>, candidates: string[], items: SourceInventoryItem[] = []): IndexedChunk[] {
  const metadata = new Map<string, z.infer<typeof inventorySchema>["sources"][number]>();
  const rootMetadata = new Map(items.map(item => [item.path, item]));
  for (const [path, text] of files) {
    if (!path.endsWith("/source-inventory.json")) continue;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !("sources" in parsed) || !Array.isArray(parsed.sources)) throw new Error(`Invalid source inventory: ${path}`);
    // Captured-source catalogs document upstream provenance; only text/page maps bind indexed files.
    if (!("pageMap" in parsed && parsed.pageMap) && !parsed.sources.some((source: unknown) => source && typeof source === "object" && ("textPath" in source || "textPaths" in source))) continue;
    const inventory = inventorySchema.parse(parsed);
    const directory = posix.dirname(path);
    for (const source of inventory.sources) for (const relative of source.textPaths ?? (source.textPath ? [source.textPath] : [])) {
      const target = safePath(`${directory}/${safePath(relative)}`);
      if (!files.has(target) || !candidates.includes(target)) throw new Error(`Inventory text missing from snapshot: ${target}`);
      metadata.set(target, source);
    }
    if (inventory.pageMap) {
      const pageMapPath = safePath(`${directory}/${safePath(inventory.pageMap)}`);
      const pages = pageSchema.parse(JSON.parse(files.get(pageMapPath) ?? "null"));
      const seen = new Set<string>();
      const documents = new Map<string, HtmlNode>();
      for (const page of pages) {
        const target = safePath(`${directory}/${safePath(page.path)}`);
        let document = documents.get(target);
        if (!document) { document = parse(files.get(target) ?? ""); documents.set(target, document); }
        const section = document.querySelectorAll("section[id]").find(node => node.getAttribute("id") === page.evidenceId);
        const content = section?.querySelector("pre.source-text")?.textContent;
        if (seen.has(page.evidenceId) || content === undefined || sha256(content) !== page.textSha256) throw new Error(`Page evidence checksum mismatch: ${page.evidenceId}`);
        seen.add(page.evidenceId);
      }
      for (const source of inventory.sources) {
        if (!source.pages || !source.textPaths) continue;
        const expectedPages = source.pages;
        const represented = pages.filter(page => source.textPaths!.includes(page.path));
        const numbers = new Set(represented.map(page => page.pdfPage));
        if (numbers.size !== source.pages || represented.length !== source.pages || [...numbers].some(page => page > expectedPages)) throw new Error(`Incomplete page coverage: ${source.id}`);
      }
      if (!pages.length) throw new Error("Empty page map.");
    }
  }
  const chunks: IndexedChunk[] = [];
  for (const path of candidates) {
    const raw = files.get(path)!;
    const source = metadata.get(path);
    const item = rootMetadata.get(path);
    let blocks: { text: string; locator: string; title?: string }[];
    if (/\.html$/iu.test(path)) {
      const document = parse(raw);
      document.querySelectorAll("head,script,style,nav,noscript").forEach(node => node.remove());
      const pages = document.querySelectorAll("section[id]").filter(node => node.querySelector("pre.source-text"));
      if (pages.length) blocks = pages.map(node => ({ text: node.querySelector("pre.source-text")!.textContent, locator: node.getAttribute("id")! }));
      else {
        const sections = document.querySelectorAll("section[id]");
        blocks = sections.flatMap(section => {
          const id = section.getAttribute("id")!;
          if (id === "topics" && section.textContent.length > 8_000 && section.querySelectorAll("li").length > 20) return []; // Source maps navigate to articles; they are not answer content.
          const children = section.textContent.length > 4_000 ? section.querySelectorAll("article,details") : [];
          if (!children.length) return [{ text: section.textContent, locator: id }];
          const intro = `${section.querySelector("h2")?.textContent ?? ""}. ${section.querySelector("p")?.textContent ?? ""}`.slice(0, 500);
          return children.map((child, index) => ({ text: `${intro} ${child.textContent}`, locator: `${id}; entry ${index + 1}` }));
        });
        sections.forEach(section => section.remove());
        blocks.unshift({ text: document.textContent, locator: "Document introduction" });
      }
    } else if (/\.json$/iu.test(path) && Array.isArray(JSON.parse(raw).records)) {
      const records = JSON.parse(raw).records as { articleId: string; title: string; canonicalUrl?: string; applicability?: string[]; sourceExcerpt?: string; synthesis: Record<string, unknown> }[];
      blocks = records.flatMap(record => {
        if (!record.articleId || !record.title || !record.synthesis || typeof record.synthesis !== "object") throw new Error(`Malformed structured record: ${path}`);
        const common = { articleId: record.articleId, title: record.title, canonicalUrl: record.canonicalUrl, applicability: record.applicability };
        const action = JSON.stringify({ ...common, sourceExcerpt: record.sourceExcerpt, purpose: record.synthesis.purpose, prerequisites: record.synthesis.prerequisites, permissions: record.synthesis.permissions, procedure: record.synthesis.procedure, warnings: record.synthesis.warnings });
        const recovery = JSON.stringify({ ...common, warnings: record.synthesis.warnings, recovery: record.synthesis.recovery, crossProductEffects: record.synthesis.crossProductEffects, supportEscalation: record.synthesis.supportEscalation });
        if (action.length > 4_000 || recovery.length > 4_000) throw new Error(`Structured record exceeds the 4,000-character context budget: ${path}#${record.articleId}`);
        return [{ text: action, locator: `${record.articleId}; procedure`, title: record.title }, { text: recovery, locator: `${record.articleId}; recovery`, title: record.title }];
      });
    } else {
      const parts = raw.split(/={3,}\s*PDF PAGE (\d+)\s*={3,}/u);
      blocks = parts.length > 1 ? [{ text: parts[0], locator: "Front matter" }, ...Array.from({ length: (parts.length - 1) / 2 }, (_, i) => ({ text: parts[i * 2 + 2], locator: `PDF page ${parts[i * 2 + 1]}` }))] : [{ text: raw, locator: "Document" }];
    }
    let ordinal = 0;
    for (const block of blocks) for (let start = 0; start < block.text.length; start += block.text.length <= 4_000 ? 4_000 : 1400) {
      const end = block.text.length <= 4_000 ? block.text.length : Math.min(start + 1600, block.text.length);
      const text = block.text.slice(start, end).trim(); if (!text) continue;
      const digest = sha256(text);
      chunks.push({ chunkId: `${fullName}:${commit}:${path}:${ordinal++}:${digest.slice(0, 12)}`, sourceId: source?.id ?? item?.id ?? fullName, title: block.title ?? source?.title ?? item?.title ?? path.split("/").pop()!, path, locator: `${fullName}@${commit}; ${block.locator}; characters ${start + 1}-${end}${source?.versionOrDate ? `; ${source.versionOrDate}` : ""}`, authority: source ? `${source.authority}${source.publisher ? `; ${source.publisher}` : ""}` : item?.authority ?? "Linked repository guidance", versionOrDate: source?.versionOrDate, capturedAt: source?.capturedAt ? new Date(source.capturedAt).toISOString() : item?.capturedAt ? new Date(item.capturedAt).toISOString() : capturedAt, digest, text, metadata: item });
    }
  }
  return chunks;
}
