import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCachedCorpusChunks, loadCorpusChunks } from "@/lib/evidence/runtime-corpus";

describe("commit-bound runtime corpus", () => {
  it("loads searchable chunks only after commit and manifest validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "pointguide-corpus-"));
    await mkdir(join(root, "research/midas-m32/corpus"), { recursive: true });
    const text = "AES50 red indicates the connection is not synchronized.";
    const inventory = { snapshotDate: "2026-09-06", sources: [{ id: "manual", authority: "primary", title: "Manual", textPath: "corpus/manual.txt" }, { id: "firmware", authority: "primary", title: "Firmware archive" }] };
    await writeFile(join(root, "research/midas-m32/corpus/manual.txt"), text);
    await writeFile(join(root, "research/midas-m32/source-inventory.json"), JSON.stringify(inventory));
    const lines = [
      `${createHash("sha256").update(text).digest("hex")}  research/midas-m32/corpus/manual.txt`,
      `${createHash("sha256").update(JSON.stringify(inventory)).digest("hex")}  research/midas-m32/source-inventory.json`,
    ];
    await writeFile(join(root, "research/midas-m32/checksums.sha256"), `${lines.join("\n")}\n`);
    execFileSync("git", ["init"], { cwd: root }); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "fixture"], { cwd: root });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await expect(loadCorpusChunks(root, commit)).resolves.toEqual([expect.objectContaining({ sourceId: "manual", text })]);
    const first = getCachedCorpusChunks(root, commit); const second = getCachedCorpusChunks(root, commit);
    expect(second).toBe(first); await expect(first).resolves.toHaveLength(1);
    await expect(loadCorpusChunks(root, "0".repeat(40))).rejects.toThrow("does not match");
  });
});
