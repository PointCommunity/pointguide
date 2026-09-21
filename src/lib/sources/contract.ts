import { parse } from "yaml";
import { z } from "zod";
import { parseManifest } from "@/lib/evidence/corpus";
import { safePath, sha256 } from "./content";

const folders = ["data", "docs", "research", "research/pointguide-training", "skills", "tools"];
const evidenceFile = /^(?:data|docs|research|skills)\/.*\.(?:md|html|txt|json|ya?ml|csv)$/iu;
const purposeFile = /(?:^|\/)README\.md$/u;
const catalogFile = /(?:^|\/)(?:source-inventory\.json|checksums\.sha256)$/u;
const manifestSchema = z.object({ schema_version: z.literal(2), repository: z.string(), default_branch: z.string(), evidence_roots: z.array(z.string()).min(1) });
const itemSchema = z.object({
  id: z.string().min(1), path: z.string().min(1), title: z.string().min(1), terms: z.array(z.string().min(1)).min(1),
  contentType: z.string().min(1), product: z.string().min(1), applicability: z.record(z.string(), z.string()),
  prerequisites: z.array(z.string()), unknowns: z.array(z.string()), authority: z.string().min(1), locator: z.string().min(1),
  capturedAt: z.iso.date(), verifiedAt: z.iso.date().nullable(), digest: z.string().regex(/^[a-f0-9]{64}$/u),
  lifecycle: z.enum(["active", "archived", "superseded"]), supersededBy: z.string().optional(),
});
const inventorySchema = z.object({ schemaVersion: z.literal(2), repository: z.string(), items: z.array(itemSchema).min(1) });

export function requiredSourcePaths(paths: Set<string>): string[] {
  const required = ["AGENTS.md", "README.md", "pointguide-source.yaml", "source-inventory.json", "checksums.sha256", ...folders.map(folder => `${folder}/README.md`)];
  const directories = new Set([...paths].flatMap(path => path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))));
  return [...new Set([...required, ...[...directories].map(directory => `${directory}/README.md`)])].filter(path => !paths.has(path)).map(path => `Missing ${path}.`);
}

export function contractDownloadPaths(paths: Set<string>): string[] {
  return [...paths].filter(path => ["AGENTS.md", "README.md", "pointguide-source.yaml", "source-inventory.json", "checksums.sha256"].includes(path) || purposeFile.test(path));
}

export function validateSourceContract(fullName: string, branch: string, paths: Set<string>, files: Map<string, string>): string[] {
  let manifest: z.infer<typeof manifestSchema>;
  let inventory: z.infer<typeof inventorySchema>;
  try { manifest = manifestSchema.parse(parse(files.get("pointguide-source.yaml") ?? "")); }
  catch { throw new Error("pointguide-source.yaml: invalid or unsupported schema version 2."); }
  try { inventory = inventorySchema.parse(JSON.parse(files.get("source-inventory.json") ?? "")); }
  catch { throw new Error("source-inventory.json: invalid or unsupported schema version 2."); }
  if (manifest.repository !== fullName || inventory.repository !== fullName || manifest.default_branch !== branch) throw new Error("pointguide-source.yaml/source-inventory.json: repository or branch identity mismatch.");
  for (const root of manifest.evidence_roots) if (!/^(?:data|docs|research|skills)(?:\/[a-z0-9-]+)*$/u.test(root) || !paths.has(`${root}/README.md`)) throw new Error(`pointguide-source.yaml: invalid evidence root ${root}.`);
  for (const path of paths) {
    if (!purposeFile.test(path)) continue;
    const content = files.get(path);
    if (!content || !/^# .+\n/u.test(content) || !/purpose:/iu.test(content) || !/expected content:/iu.test(content) || !/agent navigation only, never answer evidence/iu.test(content)) throw new Error(`${path}: purpose, expected content, and agent-only evidence boundary are required.`);
  }
  const entries = parseManifest(files.get("checksums.sha256") ?? "");
  const checksums = new Map(entries.map(entry => [safePath(entry.path), entry.digest]));
  if (checksums.has("checksums.sha256")) throw new Error("checksums.sha256: cannot hash itself.");
  const governed = [...paths].filter(path => ["AGENTS.md", "README.md", "pointguide-source.yaml", "source-inventory.json"].includes(path) || purposeFile.test(path) || (evidenceFile.test(path) && !catalogFile.test(path)));
  for (const path of governed) if (!checksums.has(path)) throw new Error(`checksums.sha256: missing ${path}.`);
  const ids = new Set<string>(); const itemPaths = new Set<string>();
  for (const item of inventory.items) {
    const path = safePath(item.path);
    if (ids.has(item.id) || itemPaths.has(path)) throw new Error(`source-inventory.json: duplicate item ${item.id} or ${path}.`);
    ids.add(item.id); itemPaths.add(path);
    if (!paths.has(path) || !evidenceFile.test(path) || purposeFile.test(path) || catalogFile.test(path) || path.startsWith("research/pointguide-training/")) throw new Error(`source-inventory.json: invalid evidence path ${path}.`);
    if (files.get(path) === undefined) throw new Error(`source-inventory.json: unreadable evidence path ${path}.`);
    if (sha256(files.get(path)!) !== item.digest) throw new Error(`source-inventory.json: digest mismatch ${path}.`);
    if (item.supersededBy && !inventory.items.some(other => other.id === item.supersededBy)) throw new Error(`source-inventory.json: unresolved supersession ${item.supersededBy}.`);
  }
  const candidates = [...itemPaths].filter(path => inventory.items.some(item => item.path === path && item.lifecycle === "active"));
  if (!candidates.length) throw new Error("source-inventory.json: no active evidence files.");
  return candidates;
}
