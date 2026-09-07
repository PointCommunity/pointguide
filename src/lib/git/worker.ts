import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { allowedRepositoryPath, contentDigest } from "./proposals";

export interface ApprovedProposal { id: string; state: "APPROVED"; targetRepository: "PointCommunity/pointaudio"; baseCommit: string; targetPath: string; proposedContent: string; digest: string; rationale: string }
export type CommandRunner = (command: string, args: string[], cwd: string) => Promise<string>;

export const runCommand: CommandRunner = (command, args, cwd) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1_000)}`)));
});

export async function openProposalPullRequest(proposal: ApprovedProposal, checkout: string, runner: CommandRunner = runCommand): Promise<{ branch: string; commit: string; pullRequestUrl: string }> {
  if (!allowedRepositoryPath(proposal.targetPath) || proposal.targetRepository !== "PointCommunity/pointaudio") throw new Error("Proposal target is outside the governed boundary.");
  if (contentDigest(proposal.proposedContent) !== proposal.digest) throw new Error("Proposal content digest changed after approval.");
  const root = resolve(checkout); const target = resolve(root, proposal.targetPath);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Proposal target escapes the checkout.");
  await runner("git", ["fetch", "origin", "--prune"], root);
  await runner("git", ["checkout", "--detach", proposal.baseCommit], root);
  const branch = `pointguide/proposal-${proposal.id}`;
  await runner("git", ["switch", "-c", branch], root);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, proposal.proposedContent, { encoding: "utf8", flag: "w" });
  await runner("git", ["add", "--", proposal.targetPath], root);
  await runner("git", ["diff", "--cached", "--check"], root);
  await runner("git", ["commit", "-m", `docs: apply PointGuide proposal ${proposal.id}`], root);
  const commit = await runner("git", ["rev-parse", "HEAD"], root);
  await runner("git", ["push", "-u", "origin", branch], root);
  const pullRequestUrl = await runner("gh", ["pr", "create", "--repo", proposal.targetRepository, "--base", "main", "--head", branch, "--title", `PointGuide proposal ${proposal.id}`, "--body", `${proposal.rationale}\n\nContent digest: ${proposal.digest}`], root);
  return { branch, commit, pullRequestUrl };
}
