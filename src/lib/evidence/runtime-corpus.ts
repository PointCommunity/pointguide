import { execFileSync } from "node:child_process";
import { validateSourceRepository } from "@/lib/sources/validator";
import type { IndexedChunk } from "./search";

const cache = new Map<string, Promise<IndexedChunk[]>>();

export async function loadCorpusChunks(root: string, commit: string, _manifest?: string): Promise<IndexedChunk[]> {
  void _manifest; // The canonical validator checks root and nested manifests; a legacy selector cannot bypass them.
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Corpus commit must be an exact SHA.");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 3 * 1024 * 1024 });
  if (git("rev-parse", "HEAD").trim() !== commit) throw new Error("Corpus checkout does not match the configured commit.");
  const remote = git("remote", "get-url", "origin").trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
  const match = /^https:\/\/github\.com\/(PointCommunity\/[A-Za-z0-9._-]+)$/u.exec(remote);
  if (!match) throw new Error("Corpus origin is not an approved PointCommunity GitHub repository.");
  const repository = match[1];
  const tree = git("ls-tree", "-r", "-l", commit).split("\n").filter(Boolean).map(line => {
    const match = /^(\d{6}) blob [a-f0-9]{40}\s+(\d+)\t(.+)$/u.exec(line);
    if (!match) throw new Error("Corpus tree contains an unsupported entry.");
    return { path: match[3], type: "blob", mode: match[1], size: Number(match[2]) };
  });
  if (!tree.some(item => item.path === "pointguide-source.yaml")) throw new Error("pointguide-source.yaml: required source contract is missing.");
  const branchText = git("show", `${commit}:pointguide-source.yaml`);
  const branch = branchText.match(/^default_branch:\s*([A-Za-z0-9._/-]+)$/mu)?.[1];
  if (!branch) throw new Error("pointguide-source.yaml: default_branch is missing.");
  const validated = await validateSourceRepository(`https://github.com/${repository}`, { ref: commit, fetcher: async url => {
    if (url === `https://api.github.com/repos/${repository}`) return Response.json({ full_name: repository, default_branch: branch, html_url: remote, pushed_at: null });
    if (url.endsWith(`/commits/${commit}`)) return Response.json({ sha: commit });
    if (url.includes("/git/trees/")) return Response.json({ sha: commit, truncated: false, tree });
    const path = decodeURIComponent(url.split(`/${commit}/`)[1] ?? "");
    try { return new Response(git("show", `${commit}:${path}`)); }
    catch { return new Response(null, { status: 404 }); }
  } });
  if (!validated.report.complete || validated.report.commitSha !== commit) throw new Error("Built-in source failed the canonical contract.");
  return validated.chunks;
}

export function getCachedCorpusChunks(root: string, commit: string, manifest?: string): Promise<IndexedChunk[]> {
  const key = `${root}:${commit}:${manifest ?? "default"}`;
  const existing = cache.get(key); if (existing) return existing;
  const loading = loadCorpusChunks(root, commit, manifest).catch(error => { cache.delete(key); throw error; });
  cache.set(key, loading); return loading;
}
