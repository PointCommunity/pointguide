import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCachedCorpusChunks, loadCorpusChunks } from "@/lib/evidence/runtime-corpus";
import { sourceFiles } from "../fixtures/source-contract";

describe("commit-bound runtime corpus", () => {
  it("loads searchable chunks only after commit and manifest validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pointguide-corpus-"));
    const text = "The M32R has 16 local microphone sockets, not 32 physical microphone sockets.";
    for (const [path, content] of Object.entries(sourceFiles("PointCommunity/test", text))) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content); }
    execFileSync("git", ["init"], { cwd: root }); execFileSync("git", ["remote", "add", "origin", "https://github.com/PointCommunity/test.git"], { cwd: root }); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: root });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await expect(loadCorpusChunks(root, commit)).resolves.toEqual([expect.objectContaining({ sourceId: "M32R-LOCAL-INPUTS", text })]);
    const first = getCachedCorpusChunks(root, commit); const second = getCachedCorpusChunks(root, commit);
    expect(second).toBe(first); await expect(first).resolves.toHaveLength(1);
    await expect(loadCorpusChunks(root, "0".repeat(40))).rejects.toThrow("does not match");
    const broken = await mkdtemp(join(tmpdir(), "pointguide-legacy-corpus-"));
    execFileSync("git", ["init"], { cwd: broken }); execFileSync("git", ["remote", "add", "origin", "https://github.com/PointCommunity/test.git"], { cwd: broken });
    await writeFile(join(broken, "AGENTS.md"), "# Legacy");
    execFileSync("git", ["add", "."], { cwd: broken }); execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "legacy"], { cwd: broken });
    const legacyCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: broken, encoding: "utf8" }).trim();
    await expect(loadCorpusChunks(broken, legacyCommit)).rejects.toThrow(/pointguide-source.yaml/);
  });
});
