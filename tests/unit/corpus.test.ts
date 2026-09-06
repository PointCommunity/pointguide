import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateChecksumManifest } from "@/lib/evidence/corpus";

const temporaryRoots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointguide-corpus-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "research", "corpus"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validateChecksumManifest", () => {
  it("accepts files whose digest matches a repository-root-relative manifest", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "research", "corpus", "guide.txt"), "verified evidence\n");
    await writeFile(
      join(root, "checksums.sha256"),
      "b24a2402711c6985de0ac87631f4fb00beefe92734c75cefb0e7029697811295  research/corpus/guide.txt\n",
    );

    const result = await validateChecksumManifest(root, "checksums.sha256");

    expect(result).toEqual({ checked: 1, files: ["research/corpus/guide.txt"] });
  });

  it("rejects a manifest entry that escapes the repository root", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "checksums.sha256"), `${"0".repeat(64)}  ../secret.txt\n`);

    await expect(validateChecksumManifest(root, "checksums.sha256")).rejects.toThrow("escapes repository root");
  });

  it("rejects duplicate paths before trusting the manifest", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "research", "corpus", "guide.txt"), "evidence\n");
    const line = `${"0".repeat(64)}  research/corpus/guide.txt\n`;
    await writeFile(join(root, "checksums.sha256"), line + line);

    await expect(validateChecksumManifest(root, "checksums.sha256")).rejects.toThrow("duplicate path");
  });

  it("rejects content that does not match the recorded digest", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "research", "corpus", "guide.txt"), "changed\n");
    await writeFile(join(root, "checksums.sha256"), `${"0".repeat(64)}  research/corpus/guide.txt\n`);

    await expect(validateChecksumManifest(root, "checksums.sha256")).rejects.toThrow("checksum mismatch");
  });
});
