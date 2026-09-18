import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { allowedRepositoryPath, allowedSourceRepository, contentDigest } from "./proposals";
import { z } from "zod";

export interface ApprovedProposal { id: string; state: "APPROVED"; targetRepository: string; baseCommit: string; targetPath: string; proposedContent: string; digest: string; rationale: string }
export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<string>;

export const runCommand: CommandRunner = (command, args, cwd) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-512_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1_000)}`)));
});

export async function openProposalPullRequest(proposal: ApprovedProposal, checkout: string, runner: CommandRunner = runCommand, options: { branch?: string; exclusiveCreate?: boolean } = {}): Promise<{ branch: string; commit: string; pullRequestUrl: string }> {
  if (!allowedRepositoryPath(proposal.targetPath) || !allowedSourceRepository(proposal.targetRepository)) throw new Error("Proposal target is outside the governed boundary.");
  if (contentDigest(proposal.proposedContent) !== proposal.digest) throw new Error("Proposal content digest changed after approval.");
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
  await runner("git", ["add", "--", proposal.targetPath], root);
  await runner("git", ["diff", "--cached", "--check"], root);
  await runner("git", ["-c", "user.name=PointGuide Agent", "-c", "user.email=pointguide@eaglepass.io", "commit", "-m", `docs: apply PointGuide proposal ${proposal.id}`], root);
  const commit = (await runner("git", ["rev-parse", "HEAD"], root)).trim();
  await runner("git", ["push", "-u", "origin", branch], root);
  const pullRequestUrl = (await runner("gh", ["pr", "create", "--repo", proposal.targetRepository, "--head", branch, "--title", `PointGuide proposal ${proposal.id}`, "--body", `${proposal.rationale}\n\nContent digest: ${proposal.digest}`], root)).trim();
  return { branch, commit, pullRequestUrl };
}

const acceptedArtifactSchema = z.object({ schemaVersion: z.literal(2), kind: z.literal("pointguide-accepted-training"), sessionId: z.uuid(), answerId: z.uuid(), targetRepository: z.string(), answer: z.object({ directAnswer: z.string().min(1) }) });

export async function publishAcceptedArtifact(input: Omit<ApprovedProposal, "state" | "rationale">, checkout: string, validateHead: (head: string) => Promise<void>, runner: CommandRunner = runCommand) {
  const path = `research/pointguide-training/${input.id}/`;
  let artifact: z.infer<typeof acceptedArtifactSchema>;
  try { artifact = acceptedArtifactSchema.parse(JSON.parse(input.proposedContent)); }
  catch { throw new Error("Content is outside the accepted training boundary."); }
  if (!input.targetPath.startsWith(path) || input.targetPath !== `${path}${artifact.answerId}.json` || artifact.sessionId !== input.id || artifact.targetRepository !== input.targetRepository || contentDigest(input.proposedContent) !== input.digest || !/^[a-f0-9]{40}$/u.test(input.baseCommit)) throw new Error("Content is outside the accepted training boundary.");
  const result = await openProposalPullRequest({ ...input, state: "APPROVED", rationale: `Accepted PointGuide training answer ${artifact.answerId}` }, checkout, runner, { branch: `pointguide/accepted-${input.id}`, exclusiveCreate: true });
  const publishedCommit = await mergeAcceptedArtifact(input, result.pullRequestUrl, checkout, validateHead, runner, result.commit);
  return { ...result, publishedCommit, digest: input.digest };
}

export async function mergeAcceptedArtifact(input: Omit<ApprovedProposal, "state" | "rationale">, pullRequestUrl: string, checkout: string, validateHead: (head: string) => Promise<void>, runner: CommandRunner = runCommand, expectedHead?: string) {
  const artifact = acceptedArtifactSchema.parse(JSON.parse(input.proposedContent));
  if (input.targetPath !== `research/pointguide-training/${input.id}/${artifact.answerId}.json` || artifact.sessionId !== input.id || artifact.targetRepository !== input.targetRepository || contentDigest(input.proposedContent) !== input.digest) throw new Error("Content is outside the accepted training boundary.");
  if (!new RegExp(`^https://github\\.com/${input.targetRepository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/pull/[1-9][0-9]*$`, "u").test(pullRequestUrl)) throw new Error("Accepted pull request belongs to another repository.");
  const remote = (await runner("git", ["remote", "get-url", "origin"], checkout)).trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
  if (remote !== `https://github.com/${input.targetRepository}`) throw new Error("Checkout origin does not match accepted source repository.");
  const changed = (await runner("gh", ["pr", "diff", pullRequestUrl, "--repo", input.targetRepository, "--name-only"], checkout)).trim().split("\n");
  if (changed.length !== 1 || changed[0] !== input.targetPath) throw new Error("Accepted training pull request changes unrelated paths.");
  const prior = z.object({ state: z.literal("OPEN"), headRefOid: z.string().regex(/^[a-f0-9]{40}$/u) }).parse(JSON.parse(await runner("gh", ["pr", "view", pullRequestUrl, "--repo", input.targetRepository, "--json", "state,headRefOid"], checkout)));
  if ((expectedHead && prior.headRefOid !== expectedHead)) throw new Error("Accepted training pull request head changed.");
  await runner("git", ["fetch", "origin", "--prune"], checkout);
  if (contentDigest(await runner("git", ["show", `${prior.headRefOid}:${input.targetPath}`], checkout)) !== input.digest) throw new Error("Accepted training pull request content changed.");
  await validateHead(prior.headRefOid);
  await runner("gh", ["pr", "merge", pullRequestUrl, "--repo", input.targetRepository, "--squash", "--delete-branch", "--match-head-commit", prior.headRefOid], checkout);
  const merged = z.object({ state: z.literal("MERGED"), mergeCommit: z.object({ oid: z.string().regex(/^[a-f0-9]{40}$/u) }) }).parse(JSON.parse(await runner("gh", ["pr", "view", pullRequestUrl, "--repo", input.targetRepository, "--json", "state,mergeCommit"], checkout)));
  await runner("git", ["fetch", "origin", "--prune"], checkout);
  if (contentDigest(await runner("git", ["show", `${merged.mergeCommit.oid}:${input.targetPath}`], checkout)) !== input.digest) throw new Error("Merged accepted artifact differs from trainer acceptance.");
  return merged.mergeCommit.oid;
}
