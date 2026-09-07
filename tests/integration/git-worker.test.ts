import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentDigest } from "@/lib/git/proposals";
import { openProposalPullRequest, type CommandRunner } from "@/lib/git/worker";

describe("governed Git worker", () => {
  it("writes only the approved path and passes exact arguments without a shell", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "pointguide-worker-"));
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "remote") return "https://github.com/PointCommunity/pointaudio.git";
      if (args[0] === "rev-parse") return "abc123";
      if (command === "gh") return "https://github.com/PointCommunity/pointaudio/pull/1";
      return "";
    };
    const proposedContent = "verified finding\n";
    const result = await openProposalPullRequest({ id: "42", state: "APPROVED", targetRepository: "PointCommunity/pointaudio", baseCommit: "deadbeef", targetPath: "research/test/finding.txt", proposedContent, digest: contentDigest(proposedContent), rationale: "Verified source" }, checkout, runner);
    expect(await readFile(join(checkout, "research/test/finding.txt"), "utf8")).toBe(proposedContent);
    expect(calls.find((call) => call.args[0] === "add")?.args).toEqual(["add", "--", "research/test/finding.txt"]);
    expect(result).toEqual({ branch: "pointguide/proposal-42", commit: "abc123", pullRequestUrl: "https://github.com/PointCommunity/pointaudio/pull/1" });
  });

  it("refuses changed content and traversal before executing commands", async () => {
    let called = false;
    await expect(openProposalPullRequest({ id: "42", state: "APPROVED", targetRepository: "PointCommunity/pointaudio", baseCommit: "deadbeef", targetPath: "../AGENTS.md", proposedContent: "bad", digest: contentDigest("other"), rationale: "bad" }, "/tmp/safe", async () => { called = true; return ""; })).rejects.toThrow("governed boundary");
    expect(called).toBe(false);
  });

  it("refuses a checkout whose origin does not match the approved repository", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "pointguide-worker-origin-"));
    const content = "verified\n";
    await expect(openProposalPullRequest({ id: "43", state: "APPROVED", targetRepository: "PointCommunity/lighting", baseCommit: "deadbeef", targetPath: "research/training/item.json", proposedContent: content, digest: contentDigest(content), rationale: "Training" }, checkout, async (_command, args) => args[0] === "remote" ? "https://github.com/PointCommunity/pointaudio.git" : "" )).rejects.toThrow("does not match");
  });
});
