import { describe, expect, it } from "vitest";
import { searchCorpus, type IndexedChunk } from "@/lib/evidence/search";
import { sourceFiles } from "../fixtures/source-contract";
import { indexContents } from "@/lib/sources/content";

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

  it("prefers explicit product and model identity over repeated wrong-product terms", () => {
    const item = JSON.parse(sourceFiles()["source-inventory.json"]).items[0];
    const wrong = { ...chunks[0], chunkId: "church-center", title: "Church Center", text: "Planning Center Services schedule responses. ".repeat(8), metadata: { ...item, product: "Church Center", applicability: { product: "Church Center" } } };
    const right = { ...chunks[0], chunkId: "services", title: "Services", text: "Schedule responses are visible in Services.", metadata: { ...item, product: "Planning Center Services", applicability: { product: "Services" } } };
    expect(searchCorpus("How do Planning Center Services schedule responses work?", [wrong, right]).map(result => result.id)).toEqual(["repo:services"]);
    const family = { ...wrong, chunkId: "full-m32", metadata: { ...item, product: "M32 family" }, text: "M32R input channels. ".repeat(8) };
    const model = { ...right, chunkId: "m32r", metadata: { ...item, product: "Midas M32R" }, text: "M32R local sockets are separate from channels." };
    expect(searchCorpus("How many local sockets does our M32R have?", [family, model]).map(result => result.id)).toEqual(["repo:m32r"]);
  });

  it("keeps a procedure's steps, warning and outcome together beyond the old 500-character excerpt", () => {
    const procedure = `# Service preparation ${"Identify the approved scene. ".repeat(22)} Never recall a scene without approval. Verify a short recording at the destination.`;
    const html = `<html><body><nav>Untrusted navigation</nav><section id="prepare"><h2>Preparation</h2><p>${procedure}</p></section><section id="other"><h2>Other topic</h2><p>Unrelated setup.</p></section></body></html>`;
    const indexed = indexContents("PointCommunity/pointaudio", "c".repeat(40), "2026-09-18T00:00:00Z", new Map([["docs/service.html", html]]), ["docs/service.html"]);
    expect(indexed.find(item => item.locator.includes("prepare"))?.text).toContain("Never recall a scene without approval.");
    const result = searchCorpus("service preparation approved scene", indexed, 1);
    expect(result[0].excerpt).toContain("Never recall a scene without approval.");
    expect(result[0].excerpt).toContain("Verify a short recording at the destination.");
    expect(result[0].locator).toContain("prepare");
  });
});
