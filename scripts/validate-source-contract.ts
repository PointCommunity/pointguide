import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { parse } from "yaml";
import { validateChecksumManifest } from "../src/lib/evidence/corpus";
import { indexContents } from "../src/lib/sources/content";
import { requiredSourcePaths, validateSourceContract } from "../src/lib/sources/contract";
import { validateSourceRepository } from "../src/lib/sources/validator";

const [rootArg, repository] = process.argv.slice(2);
if (!rootArg || !/^PointCommunity\/[A-Za-z0-9._-]+$/u.test(repository ?? "")) throw new Error("Usage: tsx scripts/validate-source-contract.ts <checkout> PointCommunity/<repo>");
const root = await realpath(rootArg);
const paths = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const missing = requiredSourcePaths(new Set(paths));
if (missing.length) throw new Error(missing.join("\n"));
const files = new Map<string, string>(); let bytes = 0;
for (const path of paths) {
  if (!path.endsWith("/README.md") && !/^(?:AGENTS\.md|README\.md|pointguide-source\.yaml|source-inventory\.json|checksums\.sha256|(?:data|docs|research|skills|tools)\/.*\.(?:md|html|txt|json|ya?ml|csv|sha256))$/iu.test(path)) continue;
  const target = resolve(root, path);
  if (!target.startsWith(`${root}${sep}`) || !(await lstat(target)).isFile() || !(await realpath(target)).startsWith(`${root}${sep}`)) throw new Error(`Unsafe source path: ${path}`);
  const buffer = await readFile(target);
  if (buffer.length > 2 * 1024 * 1024) throw new Error(`Source file exceeds 2 MiB: ${path}`);
  bytes += buffer.length;
  if (bytes > 32 * 1024 * 1024) throw new Error("Source text exceeds 32 MiB.");
  files.set(path, new TextDecoder("utf8", { fatal: true }).decode(buffer));
}
await validateChecksumManifest(root, "checksums.sha256");
const branch = parse(files.get("pointguide-source.yaml") ?? "")?.default_branch;
if (typeof branch !== "string") throw new Error("pointguide-source.yaml: default branch is required.");
const contract = validateSourceContract(repository, branch, new Set(paths), files);
const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const chunks = indexContents(repository, commit, new Date().toISOString(), files, contract.activePaths, contract.items);
if (!chunks.length) throw new Error("Source has no searchable evidence.");
const syntheticCommit = "d".repeat(40);
const tree = await Promise.all(paths.map(async path => ({ path, type: "blob", mode: "100644", size: (await stat(resolve(root, path))).size })));
const validated = await validateSourceRepository(`https://github.com/${repository}`, { fetcher: async url => {
  if (url === `https://api.github.com/repos/${repository}`) return Response.json({ full_name: repository, default_branch: branch, html_url: `https://github.com/${repository}`, pushed_at: null });
  if (url.endsWith(`/commits/${branch}`)) return Response.json({ sha: syntheticCommit });
  if (url.includes("/git/trees/")) return Response.json({ sha: syntheticCommit, truncated: false, tree });
  const path = decodeURIComponent(url.split(`/${syntheticCommit}/`)[1] ?? "");
  return files.has(path) ? new Response(files.get(path)) : new Response(null, { status: 404 });
} });
if (validated.chunks.length !== chunks.length) throw new Error("Linked-source validation and local indexing disagree.");
process.stdout.write(JSON.stringify({ repository, baseCommit: commit, workingTree: true, activeFiles: contract.activePaths.length, chunks: chunks.length, checkedBytes: bytes, linkedSourceValidation: "passed with local fetch fixture" }) + "\n");
