import { parseManifest } from "@/lib/evidence/corpus";
import { indexContents, safePath, sha256 } from "./content";
import { z } from "zod";
import type { SourceValidationReport, ValidatedSource } from "./types";

type SourceFetch = (input: string, init?: RequestInit) => Promise<Response>;
const repoSchema = z.object({ full_name: z.string(), default_branch: z.string(), html_url: z.string(), pushed_at: z.string().nullable() });
const treeSchema = z.object({ sha: z.string(), truncated: z.boolean().default(false), tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional(), mode: z.string().optional() })) });
const supportedExtension = /\.(?:md|html|txt|json|ya?ml|csv)$/iu;
const evidenceRoot = /^(?:data|docs|research|skills)\//u;

export class SourceValidationError extends Error {
  constructor(public readonly code: "INVALID_SOURCE_URL" | "SOURCE_NOT_FOUND" | "SOURCE_INVALID" | "SOURCE_FETCH_FAILED", message: string, public readonly report?: SourceValidationReport) { super(message); }
}

function parseRepositoryUrl(value: string, allowedOwners: readonly string[]): { owner: string; name: string; url: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceValidationError("INVALID_SOURCE_URL", "Enter a complete GitHub repository URL."); }
  const parts = url.pathname.replace(/\.git$/u, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2 || !allowedOwners.includes(parts[0]) || !/^[A-Za-z0-9._-]+$/u.test(parts[1])) {
    throw new SourceValidationError("INVALID_SOURCE_URL", `Only approved GitHub organizations are allowed: ${allowedOwners.join(", ")}.`);
  }
  return { owner: parts[0], name: parts[1], url: `https://github.com/${parts[0]}/${parts[1]}` };
}

export async function validateSourceRepository(value: string, options: { fetcher?: SourceFetch; token?: string; allowedOwners?: readonly string[]; signal?: AbortSignal } = {}): Promise<ValidatedSource> {
  const fetcher = options.fetcher ?? fetch;
  const parsed = parseRepositoryUrl(value, options.allowedOwners ?? ["PointCommunity"]);
  const fullName = `${parsed.owner}/${parsed.name}`;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "PointGuide/1.0" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const api = async (path: string) => {
    const response = await fetcher(`https://api.github.com/repos/${fullName}${path}`, { headers, cache: "no-store", redirect: "error", signal });
    if (response.status === 404) throw new SourceValidationError("SOURCE_NOT_FOUND", "The repository or commit was not found, or the configured GitHub token cannot read it.");
    if (!response.ok) throw new SourceValidationError("SOURCE_FETCH_FAILED", `GitHub validation failed (${response.status}).`);
    return JSON.parse(await boundedText(response, 10 * 1024 * 1024));
  };
  try {
    const repo = repoSchema.parse(await api(""));
    if (repo.full_name.toLowerCase() !== fullName.toLowerCase()) throw new Error("Repository identity changed. Relink the approved repository.");
    const { sha: commit } = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) }).parse(await api(`/commits/${encodeURIComponent(repo.default_branch)}`));
    const tree = treeSchema.parse(await api(`/git/trees/${commit}?recursive=1`));
    if (tree.truncated) throw new Error("GitHub truncated the repository tree; refresh cannot publish incomplete knowledge.");
    const blobs = tree.tree.filter(item => item.type === "blob");
    const paths = new Set(blobs.map(item => safePath(item.path)));
    if (paths.size !== blobs.length) throw new Error("Duplicate repository paths.");
    const manifests = [...paths].filter(path => /(?:^|\/)checksums\.sha256$/u.test(path));
    const candidates = blobs.filter(item => evidenceRoot.test(item.path) && supportedExtension.test(item.path));
    const requirements = { agentsFile: paths.has("AGENTS.md"), evidenceContent: candidates.length > 0, integrityManifest: paths.has("pointguide-source.yaml") || manifests.length > 0 };
    const errors = [!requirements.agentsFile ? "Missing root AGENTS.md with source-handling instructions." : "", !requirements.evidenceContent ? "No supported evidence files were found under data/, docs/, research/, or skills/." : "", !requirements.integrityManifest ? "Missing pointguide-source.yaml or a checksums.sha256 integrity manifest." : ""].filter(Boolean);
    const report: SourceValidationReport = { valid: !errors.length, checkedAt: new Date().toISOString(), commitSha: commit, defaultBranch: repo.default_branch, errors, warnings: [], filesReviewed: tree.tree.length, filesIndexed: candidates.length, chunksIndexed: 0, requirements };
    if (errors.length) throw new SourceValidationError("SOURCE_INVALID", "The repository does not meet the PointGuide source contract.", report);
    const downloadPaths = [...new Set([...candidates.map(item => item.path), ...manifests])];
    if (downloadPaths.length > 1000) throw new Error("Repository exceeds the 1000 text file limit.");
    const contents = new Map<string, string>();
    let totalBytes = 0;
    let next = 0;
    const download = async (path: string) => {
      if (contents.size >= 1000) throw new Error("Repository exceeds the 1000 text file limit.");
      const entry = blobs.find(item => item.path === path);
      if (!entry || entry.mode === "120000" || (entry.size ?? 0) > 2 * 1024 * 1024) throw new Error(`Evidence exceeds the 2 MiB file limit or is not a regular file: ${path}`);
      const response = await fetcher(`https://raw.githubusercontent.com/${fullName}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers, cache: "no-store", redirect: "error", signal });
      if (!response.ok) throw new Error(`Cannot read repository evidence (${response.status}): ${path}`);
      const text = await boundedText(response, 2 * 1024 * 1024);
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > 32 * 1024 * 1024) throw new Error("Repository exceeds the 32 MiB text limit.");
      contents.set(path, text);
    };
    await Promise.all(Array.from({ length: 4 }, async () => { while (next < downloadPaths.length) { const path = downloadPaths[next++]; await download(path); } }));
    let checksumsVerified = 0;
    let excluded = 0;
    for (const manifest of manifests) for (const entry of parseManifest(contents.get(manifest)!)) {
      safePath(entry.path);
      if (!paths.has(entry.path)) throw new Error(`Checksum target missing: ${entry.path}`);
      // Manifests use repository-root paths. Binary originals stay upstream; only bounded text is indexed.
      if (!supportedExtension.test(entry.path)) { excluded++; continue; }
      if (!contents.has(entry.path)) await download(entry.path);
      if (sha256(contents.get(entry.path)!) !== entry.digest) throw new Error(`Evidence checksum mismatch: ${entry.path}`);
      checksumsVerified++;
    }
    signal.throwIfAborted();
    const chunks = indexContents(fullName, commit, report.checkedAt, contents, candidates.map(item => item.path));
    if (!chunks.length) throw new Error("Repository contains no searchable evidence.");
    return { fullName, url: parsed.url, chunks, report: { ...report, complete: true, bytesIndexed: totalBytes, checksumsVerified, files: candidates.map(item => item.path), chunksIndexed: chunks.length, warnings: excluded ? [`${excluded} non-text manifest entries retained upstream; not indexed or downloaded.`] : [] } };
  } catch (error) {
    controller.abort();
    if (error instanceof SourceValidationError) throw error;
    if (signal.aborted && (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) throw new SourceValidationError("SOURCE_FETCH_FAILED", "Refresh interrupted or timed out. Previous knowledge is unchanged.");
    throw new SourceValidationError("SOURCE_INVALID", error instanceof Error ? error.message : "Repository validation failed.");
  }
}

async function boundedText(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Repository response exceeds its byte limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty repository response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) throw new Error("Repository response exceeds its byte limit."); chunks.push(part.value); }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
