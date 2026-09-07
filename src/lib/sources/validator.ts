import { createHash } from "node:crypto";
import { z } from "zod";
import type { IndexedChunk } from "@/lib/evidence/search";
import type { SourceValidationReport, ValidatedSource } from "./types";

type SourceFetch = (input: string, init?: RequestInit) => Promise<Response>;
const repoSchema = z.object({ full_name: z.string(), default_branch: z.string(), html_url: z.string(), pushed_at: z.string().nullable() });
const treeSchema = z.object({ sha: z.string(), truncated: z.boolean().default(false), tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional() })) });
const supportedExtension = /\.(?:md|html|txt|json|ya?ml|csv)$/iu;
const evidenceRoot = /^(?:data|docs|research|skills)\//u;

export class SourceValidationError extends Error {
  constructor(public readonly code: "INVALID_SOURCE_URL" | "SOURCE_NOT_FOUND" | "SOURCE_INVALID" | "SOURCE_FETCH_FAILED", message: string, public readonly report?: SourceValidationReport) { super(message); }
}

function parseRepositoryUrl(value: string, allowedOwners: readonly string[]): { owner: string; name: string; url: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceValidationError("INVALID_SOURCE_URL", "Enter a complete GitHub repository URL."); }
  const parts = url.pathname.replace(/\.git$/u, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || parts.length !== 2 || !allowedOwners.includes(parts[0]) || !/^[A-Za-z0-9._-]+$/u.test(parts[1])) {
    throw new SourceValidationError("INVALID_SOURCE_URL", `Only approved GitHub organizations are allowed: ${allowedOwners.join(", ")}.`);
  }
  return { owner: parts[0], name: parts[1], url: `https://github.com/${parts[0]}/${parts[1]}` };
}

export async function validateSourceRepository(value: string, options: { fetcher?: SourceFetch; token?: string; allowedOwners?: readonly string[] } = {}): Promise<ValidatedSource> {
  const fetcher = options.fetcher ?? fetch;
  const parsed = parseRepositoryUrl(value, options.allowedOwners ?? ["PointCommunity"]);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "PointGuide/1.0" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const repoResponse = await fetcher(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (repoResponse.status === 404) throw new SourceValidationError("SOURCE_NOT_FOUND", "The repository was not found or the configured GitHub token cannot read it.");
  if (!repoResponse.ok) throw new SourceValidationError("SOURCE_FETCH_FAILED", `GitHub repository validation failed (${repoResponse.status}).`);
  const repo = repoSchema.parse(await repoResponse.json());
  const treeResponse = await fetcher(`https://api.github.com/repos/${parsed.owner}/${parsed.name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!treeResponse.ok) throw new SourceValidationError("SOURCE_FETCH_FAILED", `GitHub tree validation failed (${treeResponse.status}).`);
  const tree = treeSchema.parse(await treeResponse.json());
  const paths = new Set(tree.tree.filter((item) => item.type === "blob").map((item) => item.path));
  const requirements = {
    agentsFile: paths.has("AGENTS.md"),
    evidenceContent: [...paths].some((path) => evidenceRoot.test(path) && supportedExtension.test(path)),
    integrityManifest: paths.has("pointguide-source.yaml") || [...paths].some((path) => /(?:^|\/)checksums\.sha256$/u.test(path)),
  };
  const errors = [!requirements.agentsFile ? "Missing root AGENTS.md with source-handling instructions." : "", !requirements.evidenceContent ? "No supported evidence files were found under data/, docs/, research/, or skills/." : "", !requirements.integrityManifest ? "Missing pointguide-source.yaml or a checksums.sha256 integrity manifest." : ""].filter(Boolean);
  const warnings = tree.truncated ? ["GitHub truncated the repository tree; reduce repository size or provide a narrower source repository."] : [];
  const candidates = tree.tree.filter((item) => item.type === "blob" && evidenceRoot.test(item.path) && supportedExtension.test(item.path) && (item.size ?? 0) <= 262_144).slice(0, 100);
  const chunks: IndexedChunk[] = [];
  let totalBytes = 0;
  for (const file of candidates) {
    if (totalBytes >= 5_000_000) { warnings.push("Indexing stopped at the 5 MB validation limit."); break; }
    const raw = await fetcher(`https://raw.githubusercontent.com/${repo.full_name}/${tree.sha}/${file.path}`, { headers: options.token ? { authorization: `Bearer ${options.token}` } : undefined, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!raw.ok) { warnings.push(`Could not read ${file.path}.`); continue; }
    const text = await raw.text(); totalBytes += text.length;
    for (let start = 0, ordinal = 0; start < text.length; start += 1_400, ordinal += 1) {
      const content = text.slice(start, start + 1_600).trim(); if (!content) continue;
      const digest = createHash("sha256").update(content).digest("hex");
      chunks.push({ chunkId: `${repo.full_name}:${file.path}:${ordinal}:${digest.slice(0, 12)}`, sourceId: repo.full_name, title: file.path.split("/").pop() ?? file.path, path: file.path, locator: `Characters ${start + 1}-${Math.min(start + 1_600, text.length)}`, authority: "Linked repository", capturedAt: repo.pushed_at ?? new Date().toISOString(), digest, text: content });
    }
  }
  const report: SourceValidationReport = { valid: errors.length === 0, checkedAt: new Date().toISOString(), commitSha: tree.sha, defaultBranch: repo.default_branch, errors, warnings, filesReviewed: tree.tree.length, filesIndexed: candidates.length, chunksIndexed: chunks.length, requirements };
  if (!report.valid) throw new SourceValidationError("SOURCE_INVALID", "The repository does not meet the PointGuide source contract.", report);
  return { fullName: repo.full_name, url: repo.html_url || parsed.url, report, chunks };
}
