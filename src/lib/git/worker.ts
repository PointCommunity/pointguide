import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { allowedRepositoryPath, allowedSourceRepository, contentDigest } from "./proposals";
import { parseManifest } from "@/lib/evidence/corpus";
import { z } from "zod";
import type { SourceRepositoryRecord } from "@/lib/sources/types";

export interface ApprovedProposal { id: string; state: "APPROVED"; targetRepository: string; baseCommit: string; targetPath: string; proposedContent: string; digest: string; rationale: string }
export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<string>;
type PublicationFiles = Record<string, string | Uint8Array>;

export function acceptedArtifactAlreadyIndexed(source: Pick<SourceRepositoryRecord, "indexedCommit" | "validationReport">, commit: string, path: string, digest: string): boolean {
  return source.indexedCommit === commit && source.validationReport.complete === true && source.validationReport.commitSha === commit
    && source.validationReport.acceptedArtifacts?.some(item => item.path === path && item.digest === digest) === true;
}

export const runCommand: CommandRunner = (command, args, cwd) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-512_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1_000)}`)));
});

export async function openProposalPullRequest(proposal: ApprovedProposal, checkout: string, runner: CommandRunner = runCommand, options: { branch?: string; exclusiveCreate?: boolean; companions?: PublicationFiles } = {}): Promise<{ branch: string; commit: string; pullRequestUrl: string }> {
  if (!allowedRepositoryPath(proposal.targetPath) || !allowedSourceRepository(proposal.targetRepository)) throw new Error("Proposal target is outside the governed boundary.");
  if (contentDigest(proposal.proposedContent) !== proposal.digest) throw new Error("Proposal content digest changed after approval.");
  const companionPaths = Object.keys(options.companions ?? {});
  if (companionPaths.length && (!options.exclusiveCreate || !acceptedCompanionPaths(proposal, companionPaths))) throw new Error("Publication companions exceed the accepted training boundary.");
  const root = resolve(checkout); const target = resolve(root, proposal.targetPath);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Proposal target escapes the checkout.");
  const remote = await runner("git", ["remote", "get-url", "origin"], root);
  const remotePath = remote.trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
  if (!remotePath.endsWith(`github.com/${proposal.targetRepository}`)) throw new Error("Checkout origin does not match the approved source repository.");
  await runner("git", ["fetch", "origin", "--prune"], root);
  if (options.exclusiveCreate && await runner("git", ["status", "--porcelain"], root)) throw new Error("Source checkout contains unrelated changes.");
  await runner("git", ["checkout", "--detach", proposal.baseCommit], root);
  const branch = options.branch ?? `pointguide/proposal-${proposal.id}`;
  await runner("git", ["switch", "-c", branch], root);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, proposal.proposedContent, { encoding: "utf8", flag: options.exclusiveCreate ? "wx" : "w" });
  for (const path of companionPaths) {
    const destination = resolve(root, path); if (!destination.startsWith(`${root}${sep}`)) throw new Error("Publication companion escapes the checkout.");
    await mkdir(dirname(destination), { recursive: true }); const value = options.companions![path]; const replace = path === "source-inventory.json" || path === "checksums.sha256";
    if (typeof value === "string") await writeFile(destination, value, { encoding: "utf8", flag: replace ? "w" : "wx" });
    else await writeFile(destination, value, { flag: "wx" });
  }
  await runner("git", ["add", "--", proposal.targetPath, ...companionPaths], root);
  await runner("git", ["diff", "--cached", "--check"], root);
  await runner("git", ["-c", "user.name=PointGuide Agent", "-c", "user.email=pointguide@eaglepass.io", "commit", "-m", `docs: apply PointGuide proposal ${proposal.id}`], root);
  const commit = (await runner("git", ["rev-parse", "HEAD"], root)).trim();
  await runner("git", ["push", "-u", "origin", branch], root);
  const pullRequestUrl = (await runner("gh", ["pr", "create", "--repo", proposal.targetRepository, "--head", branch, "--title", `PointGuide proposal ${proposal.id}`, "--body", `${proposal.rationale}\n\nContent digest: ${proposal.digest}`], root)).trim();
  return { branch, commit, pullRequestUrl };
}

const acceptedArtifactSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal("pointguide-accepted-training"), sessionId: z.uuid(), answerId: z.uuid(), targetRepository: z.string(), answer: z.object({ directAnswer: z.string().min(1) }), trainerSources: z.array(z.object({ id: z.uuid(), originalPath: z.string(), originalDigest: z.string().regex(/^[a-f0-9]{64}$/u), extractedPath: z.string(), extractedDigest: z.string().regex(/^[a-f0-9]{64}$/u) })).default([]) });
const bytesDigest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const gitBlobOid = (value: Uint8Array) => createHash("sha1").update(`blob ${value.byteLength}\0`).update(value).digest("hex");
export async function verifyPublicationFiles(head: string, files: PublicationFiles, checkout: string, runner: CommandRunner = runCommand): Promise<void> {
  for (const [path, expected] of Object.entries(files)) {
    const matches = typeof expected === "string" ? await runner("git", ["show", `${head}:${path}`], checkout) === expected : (await runner("git", ["rev-parse", `${head}:${path}`], checkout)).trim() === gitBlobOid(expected);
    if (!matches) throw new Error(`Accepted publication companion changed: ${path}`);
  }
}

function acceptedCompanionPaths(proposal: Pick<ApprovedProposal, "id" | "targetPath" | "proposedContent">, paths: string[]): boolean {
  let artifact: z.infer<typeof acceptedArtifactSchema>; try { artifact = acceptedArtifactSchema.parse(JSON.parse(proposal.proposedContent)); } catch { return false; }
  const folder = `research/pointguide-training/${proposal.id}`;
  if (proposal.targetPath !== `${folder}/${artifact.answerId}.json` || artifact.sessionId !== proposal.id) return false;
  const sourceReadmes = artifact.trainerSources.length ? [`${folder}/originals/README.md`, `${folder}/sources/README.md`] : [];
  const expected = new Set([`${folder}/README.md`, ...sourceReadmes, "source-inventory.json", "checksums.sha256", ...artifact.trainerSources.flatMap(source => [source.originalPath, source.extractedPath])]);
  return paths.length === expected.size && new Set(paths).size === expected.size && paths.every(path => expected.has(path));
}

function verifySourceFiles(input: Omit<ApprovedProposal, "state" | "rationale">, artifact: z.infer<typeof acceptedArtifactSchema>, files: PublicationFiles): void {
  const folder = `research/pointguide-training/${input.id}`; const expected = new Set<string>();
  for (const source of artifact.trainerSources) {
    if (!source.originalPath.startsWith(`${folder}/originals/${source.id}.`) || source.extractedPath !== `${folder}/sources/${source.id}.md`) throw new Error("Trainer source path exceeds the accepted training boundary.");
    expected.add(source.originalPath); expected.add(source.extractedPath);
    if (!(source.originalPath in files) || bytesDigest(files[source.originalPath]) !== source.originalDigest || !(source.extractedPath in files) || bytesDigest(files[source.extractedPath]) !== source.extractedDigest) throw new Error("Trainer source bytes changed after answer acceptance.");
  }
  if (Object.keys(files).length !== expected.size || Object.keys(files).some(path => !expected.has(path))) throw new Error("Trainer source bundle exceeds the accepted training boundary.");
}

export function acceptedPublicationCompanions(input: Omit<ApprovedProposal, "state" | "rationale">, inventoryText: string, checksumText: string): Record<string, string>;
export function acceptedPublicationCompanions(input: Omit<ApprovedProposal, "state" | "rationale">, inventoryText: string, checksumText: string, sourceFiles: PublicationFiles): PublicationFiles;
export function acceptedPublicationCompanions(input: Omit<ApprovedProposal, "state" | "rationale">, inventoryText: string, checksumText: string, sourceFiles: PublicationFiles = {}): PublicationFiles {
  const artifact = acceptedArtifactSchema.parse(JSON.parse(input.proposedContent));
  verifySourceFiles(input, artifact, sourceFiles);
  const folder = `research/pointguide-training/${input.id}`;
  if (input.targetPath !== `${folder}/${artifact.answerId}.json` || artifact.sessionId !== input.id || artifact.targetRepository !== input.targetRepository || contentDigest(input.proposedContent) !== input.digest) throw new Error("Content is outside the accepted training boundary.");
  const inventory = z.object({ schemaVersion: z.literal(2), repository: z.string(), items: z.array(z.object({ path: z.string() }).passthrough()), excluded: z.array(z.object({ path: z.string(), reason: z.string() })).default([]) }).passthrough().parse(JSON.parse(inventoryText));
  const extractedPaths = artifact.trainerSources.map(source => source.extractedPath);
  if (inventory.repository !== input.targetRepository || [...inventory.items, ...inventory.excluded].some(item => item.path === input.targetPath || extractedPaths.includes(item.path))) throw new Error("Accepted artifact inventory conflict or repository identity mismatch.");
  const readmePath = `${folder}/README.md`;
  const originalsReadmePath = `${folder}/originals/README.md`, sourcesReadmePath = `${folder}/sources/README.md`;
  const sourceReadmes = artifact.trainerSources.length ? {
    [originalsReadmePath]: `# ${folder}/originals\n\nPurpose: preserve byte-identical trainer-provided originals for accepted training session ${input.id}.\n\nExpected content: only the immutable website captures, documents, and images accepted with this session.\n\nThis README is agent navigation only, never answer evidence.\n`,
    [sourcesReadmePath]: `# ${folder}/sources\n\nPurpose: preserve extracted text and provenance for trainer-provided material in accepted training session ${input.id}.\n\nExpected content: deterministic Markdown extraction records linked from the accepted answer artifact.\n\nThis README is agent navigation only, never answer evidence.\n`,
  } : {};
  const entries = new Map(parseManifest(checksumText).map(entry => [entry.path, entry.digest]));
  if (entries.get("source-inventory.json") !== contentDigest(inventoryText) || [input.targetPath, readmePath, ...Object.keys(sourceReadmes), ...Object.keys(sourceFiles)].some(path => entries.has(path))) throw new Error("Accepted publication already exists or root inventory checksum changed.");
  const readme = `# ${folder}\n\nPurpose: hold one immutable accepted training session ${input.id}.\n\nExpected content: immutable accepted answer JSON, trainer-provided originals, extracted source text and provenance, and deterministic publication metadata only.\n\nThis README is agent navigation only, never answer evidence.\n`;
  inventory.excluded.push({ path: input.targetPath, reason: "Accepted training artifact; citable only after publication and activation, never general corpus evidence." });
  for (const path of extractedPaths) inventory.excluded.push({ path, reason: "Trainer-provided source for this accepted session; retrieved only through the accepted training artifact." });
  inventory.excluded.sort((a, b) => a.path.localeCompare(b.path));
  const updatedInventory = `${JSON.stringify(inventory, null, 2)}\n`;
  entries.set(input.targetPath, input.digest); entries.set(readmePath, contentDigest(readme)); entries.set("source-inventory.json", contentDigest(updatedInventory));
  for (const [path, value] of Object.entries(sourceReadmes)) entries.set(path, contentDigest(value));
  for (const [path, value] of Object.entries(sourceFiles)) entries.set(path, bytesDigest(value));
  const updatedChecksums = `${[...entries].sort(([a], [b]) => a.localeCompare(b)).map(([path, digest]) => `${digest}  ${path}`).join("\n")}\n`;
  return { [readmePath]: readme, ...sourceReadmes, ...sourceFiles, "source-inventory.json": updatedInventory, "checksums.sha256": updatedChecksums };
}

export async function publishAcceptedArtifact(input: Omit<ApprovedProposal, "state" | "rationale">, checkout: string, validateHead: (head: string) => Promise<void>, runner: CommandRunner = runCommand, sourceFiles: PublicationFiles = {}) {
  const path = `research/pointguide-training/${input.id}/`;
  let artifact: z.infer<typeof acceptedArtifactSchema>;
  try { artifact = acceptedArtifactSchema.parse(JSON.parse(input.proposedContent)); }
  catch { throw new Error("Content is outside the accepted training boundary."); }
  if (!input.targetPath.startsWith(path) || input.targetPath !== `${path}${artifact.answerId}.json` || artifact.sessionId !== input.id || artifact.targetRepository !== input.targetRepository || contentDigest(input.proposedContent) !== input.digest || !/^[a-f0-9]{40}$/u.test(input.baseCommit)) throw new Error("Content is outside the accepted training boundary.");
  const companions = acceptedPublicationCompanions(input, await runner("git", ["show", `${input.baseCommit}:source-inventory.json`], checkout), await runner("git", ["show", `${input.baseCommit}:checksums.sha256`], checkout), sourceFiles);
  const result = await openProposalPullRequest({ ...input, state: "APPROVED", rationale: `Accepted PointGuide training answer ${artifact.answerId}` }, checkout, runner, { branch: `pointguide/accepted-${input.id}`, exclusiveCreate: true, companions });
  const publishedCommit = await mergeAcceptedArtifact(input, result.pullRequestUrl, checkout, validateHead, runner, result.commit, sourceFiles);
  return { ...result, publishedCommit, digest: input.digest };
}

export async function mergeAcceptedArtifact(input: Omit<ApprovedProposal, "state" | "rationale">, pullRequestUrl: string, checkout: string, validateHead: (head: string) => Promise<void>, runner: CommandRunner = runCommand, expectedHead?: string, sourceFiles: PublicationFiles = {}) {
  const artifact = acceptedArtifactSchema.parse(JSON.parse(input.proposedContent));
  if (input.targetPath !== `research/pointguide-training/${input.id}/${artifact.answerId}.json` || artifact.sessionId !== input.id || artifact.targetRepository !== input.targetRepository || contentDigest(input.proposedContent) !== input.digest) throw new Error("Content is outside the accepted training boundary.");
  if (!new RegExp(`^https://github\\.com/${input.targetRepository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/pull/[1-9][0-9]*$`, "u").test(pullRequestUrl)) throw new Error("Accepted pull request belongs to another repository.");
  const remote = (await runner("git", ["remote", "get-url", "origin"], checkout)).trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
  if (remote !== `https://github.com/${input.targetRepository}`) throw new Error("Checkout origin does not match accepted source repository.");
  const companions = acceptedPublicationCompanions(input, await runner("git", ["show", `${input.baseCommit}:source-inventory.json`], checkout), await runner("git", ["show", `${input.baseCommit}:checksums.sha256`], checkout), sourceFiles);
  const changed = (await runner("gh", ["pr", "diff", pullRequestUrl, "--repo", input.targetRepository, "--name-only"], checkout)).trim().split("\n");
  const permitted = [input.targetPath, ...Object.keys(companions)];
  if (changed.length !== permitted.length || new Set(changed).size !== permitted.length || changed.some(path => !permitted.includes(path))) throw new Error("Accepted training pull request changes unrelated paths.");
  const prior = z.object({ state: z.literal("OPEN"), headRefOid: z.string().regex(/^[a-f0-9]{40}$/u) }).parse(JSON.parse(await runner("gh", ["pr", "view", pullRequestUrl, "--repo", input.targetRepository, "--json", "state,headRefOid"], checkout)));
  if ((expectedHead && prior.headRefOid !== expectedHead)) throw new Error("Accepted training pull request head changed.");
  await runner("git", ["fetch", "origin", "--prune"], checkout);
  if (contentDigest(await runner("git", ["show", `${prior.headRefOid}:${input.targetPath}`], checkout)) !== input.digest) throw new Error("Accepted training pull request content changed.");
  await verifyPublicationFiles(prior.headRefOid, companions, checkout, runner);
  await validateHead(prior.headRefOid);
  await runner("gh", ["pr", "merge", pullRequestUrl, "--repo", input.targetRepository, "--squash", "--delete-branch", "--match-head-commit", prior.headRefOid], checkout);
  const merged = z.object({ state: z.literal("MERGED"), mergeCommit: z.object({ oid: z.string().regex(/^[a-f0-9]{40}$/u) }) }).parse(JSON.parse(await runner("gh", ["pr", "view", pullRequestUrl, "--repo", input.targetRepository, "--json", "state,mergeCommit"], checkout)));
  await runner("git", ["fetch", "origin", "--prune"], checkout);
  if (contentDigest(await runner("git", ["show", `${merged.mergeCommit.oid}:${input.targetPath}`], checkout)) !== input.digest) throw new Error("Merged accepted artifact differs from trainer acceptance.");
  await verifyPublicationFiles(merged.mergeCommit.oid, sourceFiles, checkout, runner).catch(error => { throw new Error(`Merged trainer source differs from trainer acceptance: ${error instanceof Error ? error.message : "unknown"}`); });
  return merged.mergeCommit.oid;
}
