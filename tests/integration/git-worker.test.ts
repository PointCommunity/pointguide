import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentDigest } from "@/lib/git/proposals";
import { mergeAcceptedArtifact, openProposalPullRequest, publishAcceptedArtifact, type CommandRunner } from "@/lib/git/worker";

describe("governed Git worker", () => {
  it("merges only the exact accepted training artifact after path and head verification", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "pointguide-accepted-"));
    const content = JSON.stringify({ schemaVersion: 2, kind: "pointguide-accepted-training", sessionId: "00000000-0000-4000-8000-000000000011", answerId: "00000000-0000-4000-8000-000000000012", targetRepository: "PointCommunity/pointaudio", answer: { directAnswer: "Check cable." } }) + "\n";
    const path = "research/pointguide-training/00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000012.json";
    const calls: string[] = [];
    const validateHead = async (head: string) => { calls.push(`validate source ${head}`); expect(head).toBe("a".repeat(40)); };
    let merged = false;
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (args[0] === "remote") return "https://github.com/PointCommunity/pointaudio.git";
      if (args[0] === "rev-parse") return "a".repeat(40);
      if (command === "gh" && args[0] === "pr" && args[1] === "create") return "https://github.com/PointCommunity/pointaudio/pull/10";
      if (command === "gh" && args[0] === "pr" && args[1] === "diff") return path;
      if (command === "gh" && args[0] === "pr" && args[1] === "view") return merged ? JSON.stringify({ state: "MERGED", mergeCommit: { oid: "c".repeat(40) } }) : JSON.stringify({ state: "OPEN", headRefOid: "a".repeat(40) });
      if (command === "gh" && args[0] === "pr" && args[1] === "merge") { merged = true; return ""; }
      if (args[0] === "show") return content;
      return "";
    };
    try {
      const result = await publishAcceptedArtifact({ id: "00000000-0000-4000-8000-000000000011", targetRepository: "PointCommunity/pointaudio", baseCommit: "b".repeat(40), targetPath: path, proposedContent: content, digest: contentDigest(content) }, checkout, validateHead, runner);
      expect(result).toMatchObject({ commit: "a".repeat(40), publishedCommit: "c".repeat(40), digest: contentDigest(content) });
      const merge = calls.findIndex(call => call.includes("gh pr merge"));
      expect(merge).toBeGreaterThan(calls.findIndex(call => call.includes("gh pr diff")));
      expect(merge).toBeGreaterThan(calls.findIndex(call => call.includes("gh pr view")));
      expect(merge).toBeGreaterThan(calls.findIndex(call => call.includes("validate source")));
    } finally { await rm(checkout, { recursive: true }); }
  });

  it("refuses automatic merge for unrelated proposals and changed content", async () => {
    let called = false;
    const runner: CommandRunner = async () => { called = true; return ""; };
    await expect(publishAcceptedArtifact({ id: "x", targetRepository: "PointCommunity/pointaudio", baseCommit: "a".repeat(40), targetPath: "docs/unrelated.json", proposedContent: "{}", digest: contentDigest("{}") }, "/tmp/unused", async () => {}, runner)).rejects.toThrow("accepted training boundary");
    expect(called).toBe(false);
  });

  it("does not merge when the proposed repository fails its full source contract", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000011", answerId = "00000000-0000-4000-8000-000000000012";
    const path = `research/pointguide-training/${sessionId}/${answerId}.json`;
    const content = JSON.stringify({ schemaVersion: 2, kind: "pointguide-accepted-training", sessionId, answerId, targetRepository: "PointCommunity/pointaudio", answer: { directAnswer: "Check cable." } });
    const input = { id: sessionId, targetRepository: "PointCommunity/pointaudio", baseCommit: "b".repeat(40), targetPath: path, proposedContent: content, digest: contentDigest(content) };
    let merged = false;
    const runner: CommandRunner = async (command, args) => {
      if (args[0] === "remote") return "https://github.com/PointCommunity/pointaudio.git";
      if (command === "gh" && args[1] === "diff") return path;
      if (command === "gh" && args[1] === "view") return JSON.stringify({ state: "OPEN", headRefOid: "a".repeat(40) });
      if (command === "gh" && args[1] === "merge") merged = true;
      if (args[0] === "show") return content;
      return "";
    };
    await expect(mergeAcceptedArtifact(input, "https://github.com/PointCommunity/pointaudio/pull/10", "/tmp/unused", async () => { throw new Error("Source checksum mismatch"); }, runner)).rejects.toThrow(/checksum/i);
    expect(merged).toBe(false);
  });

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
