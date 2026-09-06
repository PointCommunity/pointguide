import { describe, expect, it } from "vitest";
import { searchCorpus, type IndexedChunk } from "@/lib/evidence/search";

const chunks: IndexedChunk[] = [
  {
    chunkId: "m32-user:40",
    sourceId: "m32-user-manual",
    title: "M32 User Manual",
    path: "research/midas-m32/corpus/M32_User_Manual_EN.txt",
    locator: "Digital I/O > AES50",
    authority: "manufacturer-primary",
    versionOrDate: "2014-08-11",
    capturedAt: "2026-09-06T00:00:00.000Z",
    digest: "a".repeat(64),
    text: "The AES50 ports provide 48 bidirectional channels over shielded CAT5e cable. Clock synchronization is required.",
  },
  {
    chunkId: "dp48:12",
    sourceId: "dp48-qsg",
    title: "DP48 Quick Start Guide",
    path: "research/midas-m32/corpus/DP48_Quick_Start_Guide_WW.txt",
    locator: "Groups",
    authority: "manufacturer-primary",
    versionOrDate: "2024-07-23",
    capturedAt: "2026-09-06T00:00:00.000Z",
    digest: "b".repeat(64),
    text: "Assign input channels to twelve stereo groups for personal monitoring.",
  },
];

describe("searchCorpus", () => {
  it("ranks deterministic repository evidence by meaningful query terms", () => {
    const results = searchCorpus("Why is AES50 clock sync required?", chunks, 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "repo:m32-user:40", kind: "REPOSITORY", sourceId: "m32-user-manual" });
    expect(results[0].excerpt).toContain("Clock synchronization");
  });

  it("returns no evidence when only stop words match", () => {
    expect(searchCorpus("why is the and", chunks, 5)).toEqual([]);
  });

  it("uses a stable tie break and respects the result limit", () => {
    const tied = chunks.map((chunk, index) => ({ ...chunk, chunkId: `chunk-${2 - index}`, text: "monitor input" }));
    const results = searchCorpus("monitor input", tied, 1);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("repo:chunk-1");
  });
});
