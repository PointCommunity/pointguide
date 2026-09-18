import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validateSourceRepository } from "@/lib/sources/validator";
import { MemorySourceRepositoryStore } from "@/lib/sources/store";

const commit = "b".repeat(40);
function upstream(files: Record<string, string>, overrides: { truncated?: boolean } = {}) {
  const all = { "AGENTS.md": "Source instructions are not executable.", ...files };
  return vi.fn(async (url: string) => {
    if (url.endsWith("/repos/PointCommunity/test")) return Response.json({ full_name: "PointCommunity/test", default_branch: "published", html_url: "https://github.com/PointCommunity/test", pushed_at: "2026-09-14T00:00:00Z" });
    if (url.endsWith("/commits/published") || url.endsWith(`/commits/${commit}`)) return Response.json({ sha: commit });
    if (url.includes("/git/trees/")) return Response.json({ sha: "c".repeat(40), truncated: overrides.truncated ?? false, tree: Object.entries(all).map(([path, content]) => ({ path, type: "blob", mode: "100644", size: Buffer.byteLength(content) })) });
    const path = decodeURIComponent(url.split(`/${commit}/`)[1] ?? "");
    return path in all ? new Response(all[path as keyof typeof all]) : new Response(null, { status: 404 });
  });
}
function files(text = "Validated sermon source") {
  return { "docs/recording.txt": text, "checksums.sha256": `${createHash("sha256").update(text).digest("hex")}  docs/recording.txt\n` };
}

describe("knowledge refresh contract", () => {
  it("pins file fetches and recorded provenance to the commit rather than a moving branch/tree", async () => {
    const fetcher = upstream(files());
    const result = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher });
    expect(result.report).toMatchObject({ commitSha: commit, complete: true });
    expect(fetcher.mock.calls.some(([url]) => url.includes(`/git/trees/${commit}`))).toBe(true);
    expect(result.chunks[0].locator).toContain(commit);
  });
  it("validates an immutable proposed head without falling back to the moving default branch", async () => {
    const fetcher = upstream(files());
    const result = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher, ref: commit });
    expect(result.report.commitSha).toBe(commit);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith(`/commits/${commit}`))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/commits/published"))).toBe(false);
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher, ref: "main?redirect=evil" })).rejects.toThrow(/commit/i);
  });
  it("retains large existing references and rejects truncated or corrupt replacement evidence", async () => {
    const result = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files("M32 evidence. ".repeat(30_000))) });
    expect(result.chunks.length).toBeGreaterThan(200);
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files(), { truncated: true }) })).rejects.toThrow(/truncat/i);
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream({ ...files(), "docs/recording.txt": "corrupted" }) })).rejects.toThrow(/checksum/i);
  });
  it("replaces a source atomically and refuses stale writers or archived sources", async () => {
    const initial = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files("old evidence")) });
    const replacement = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files("new evidence")) });
    const store = new MemorySourceRepositoryStore(false);
    const source = await store.link("owner", initial);
    await store.refresh("owner", source, replacement);
    expect((await store.snapshot()).chunks.map(chunk => chunk.text).join(" ")).toContain("new evidence");
    await expect(store.refresh("owner", source, initial)).rejects.toThrow(/changed/i);
    const current = (await store.list())[0];
    await store.archive("owner", current.id, current.fullName);
    await expect(store.refresh("owner", current, initial)).rejects.toThrow(/changed/i);
    expect((await store.snapshot()).chunks).toEqual([]);
  });
});

it("publishes per-repository results, keeps failed knowledge, and skips archives", async () => {
  const { refreshKnowledge } = await import("@/lib/sources/refresh");
  const first = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files()) });
  const store = new MemorySourceRepositoryStore(false);
  const a = await store.link("owner", first);
  const b = await store.link("owner", { ...first, fullName: "PointCommunity/second", url: "https://github.com/PointCommunity/second" });
  const c = await store.link("owner", { ...first, fullName: "PointCommunity/archived" });
  await store.archive("owner", c.id, c.fullName);
  const validate = vi.fn(async (url: string) => { if (url === b.url) throw new Error("private upstream error"); return first; });
  const emit = vi.fn(); const audit = vi.spyOn(store, "refreshFailed");
  await refreshKnowledge("owner", store, validate, emit, new AbortController().signal);
  expect(validate).toHaveBeenCalledTimes(2);
  expect(emit.mock.calls.map(([event]) => event)).toContainEqual(expect.objectContaining({ id: a.id, outcome: "current" }));
  expect(emit.mock.calls.map(([event]) => event)).toContainEqual(expect.objectContaining({ id: b.id, outcome: "failed" }));
  expect(JSON.stringify(emit.mock.calls)).not.toContain("private upstream error");
  expect(audit).toHaveBeenCalledWith("owner", b.id, "REFRESH_FAILED");
  expect((await store.list()).find(source => source.id === b.id)?.version).toBe(1);
});

it("repairs same-commit missing chunks and never mixes refreshed PointAudio with bootstrap evidence", async () => {
  const { knowledgeSnapshot } = await import("@/lib/sources/retrieval");
  const { parseEnvironment } = await import("@/lib/config/env");
  const source = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files()) });
  const store = new MemorySourceRepositoryStore(false);
  const initial = await store.link("owner", { ...source, fullName: "PointCommunity/pointaudio", chunks: [], report: { ...source.report, complete: false } });
  const builtin = vi.fn().mockResolvedValue([{ text: "stale M32" }]);
  const environment = parseEnvironment({ AUTH_MODE: "cloudflare" });
  expect((await knowledgeSnapshot(store, environment, builtin)).chunks).toHaveLength(1);
  const result = await store.refresh("owner", initial, { ...source, fullName: initial.fullName });
  expect(result.outcome).toBe("updated");
  builtin.mockClear();
  const snapshot = await knowledgeSnapshot(store, environment, builtin);
  expect(snapshot.chunks).toHaveLength(source.chunks.length);
  expect(builtin).not.toHaveBeenCalled();
  await store.archive("owner", initial.id, initial.fullName);
  expect((await knowledgeSnapshot(store, environment, builtin)).chunks).toEqual([]);
});

it("aborts before publication and rejects unsafe paths, limits, missing files and invalid structure", async () => {
  const { refreshKnowledge } = await import("@/lib/sources/refresh");
  const source = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files()) });
  const store = new MemorySourceRepositoryStore(false); const record = await store.link("owner", source);
  const abort = new AbortController();
  await expect(refreshKnowledge("owner", store, async () => { abort.abort(); return source; }, vi.fn(), abort.signal)).rejects.toThrow();
  expect((await store.list())[0].version).toBe(record.version);
  for (const broken of [{ "docs/../escape.txt": "escape", "pointguide-source.yaml": "contract" }, files("x".repeat(2 * 1024 * 1024 + 1)), { "docs/test.txt": "missing manifest" }]) {
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(broken as Record<string, string>) })).rejects.toThrow();
  }
  const fetcher = upstream(files());
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: async (url) => url.includes("raw.githubusercontent.com") ? new Response(null, { status: 503 }) : fetcher(url) })).rejects.toThrow(/Cannot read/);
});

it("extracts inert HTML page evidence with decoded text, inventory authority and stable provenance", async () => {
  const { indexContents } = await import("@/lib/sources/content");
  const text = "Record & save the sermon. ";
  const contents = new Map([
    ["research/manual/source-inventory.json", JSON.stringify({ sources: [{ id: "REAPER", title: "REAPER Guide", authority: "Primary guide", publisher: "Author", versionOrDate: "7.80", capturedAt: "2026-09-14", textPaths: ["corpus/01.html"] }], pageMap: "pages.json" })],
    ["research/manual/pages.json", JSON.stringify([{ evidenceId: "REAPER-P0001", pdfPage: 1, path: "corpus/01.html", textSha256: createHash("sha256").update(text).digest("hex") }])],
    ["research/manual/corpus/01.html", '<head>noise</head><nav>noise</nav><script>throw evil</script><section id="REAPER-P0001"><pre class="source-text">Record &amp; save the sermon.&#32;</pre></section>'],
  ]);
  const chunks = indexContents("PointCommunity/test", commit, new Date().toISOString(), contents, ["research/manual/corpus/01.html"]);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatchObject({ text: text.trim(), sourceId: "REAPER", authority: "Primary guide; Author", versionOrDate: "7.80" });
  expect(chunks[0].locator).toContain("REAPER-P0001");
  contents.set("research/manual/corpus/01.html", "corrupt");
  expect(() => indexContents("PointCommunity/test", commit, new Date().toISOString(), contents, ["research/manual/corpus/01.html"])).toThrow(/checksum/);
});

it("rejects hostile URLs and failed upstream resolution before publication", async () => {
  for (const url of ["not a url", "https://user:password@github.com/PointCommunity/test", "https://github.com/PointCommunity/test?redirect=evil", "https://github.com/PointCommunity/test#fragment"]) await expect(validateSourceRepository(url, { fetcher: upstream(files()) })).rejects.toThrow();
  for (const status of [404, 403]) await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: async () => new Response(null, { status }) })).rejects.toThrow();
  const valid = upstream(files());
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: async url => url.endsWith("/repos/PointCommunity/test") ? Response.json({ full_name: "Hostile/test", default_branch: "main", html_url: "https://evil.example", pushed_at: null }) : valid(url) })).rejects.toThrow(/identity changed/);
  const abort = new AbortController(); abort.abort();
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { signal: abort.signal, fetcher: async () => { throw new DOMException("aborted", "AbortError"); } })).rejects.toThrow(/interrupted/);
});

it("enforces actual streamed byte limits, file count, and manifest target safety", async () => {
  const valid = upstream(files());
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: async url => url.includes("raw.githubusercontent.com") ? new Response("x", { headers: { "content-length": String(3 * 1024 * 1024) } }) : valid(url) })).rejects.toThrow(/byte limit/);
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: async url => url.includes("raw.githubusercontent.com") ? new Response("x".repeat(2 * 1024 * 1024 + 1)) : valid(url) })).rejects.toThrow(/byte limit/);
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream({ ...files(), ...Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`docs/${i}.txt`, "text"])) }) })).rejects.toThrow(/1000/);
  await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream({ ...files(), "checksums.sha256": `${"a".repeat(64)}  docs/missing.txt` }) })).rejects.toThrow(/target missing/);
  const original = files();
  const result = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream({ ...original, "original.pdf": "binary", "README.md": "readme", "checksums.sha256": `${original["checksums.sha256"]}${"a".repeat(64)}  original.pdf\n${createHash("sha256").update("readme").digest("hex")}  README.md\n` }) });
  expect(result.report.checksumsVerified).toBe(2); expect(result.report.warnings).toHaveLength(1);
});

it("retains generic HTML, M32 page boundaries, and detects missing inventory pages", async () => {
  const { indexContents } = await import("@/lib/sources/content");
  const contents = new Map([
    ["docs/page.html", "<html><body><p>Sermon <strong>recording</strong></p><script>evil()</script></body></html>"],
    ["research/manual/source-inventory.json", JSON.stringify({ sources: [{ id: "m32", title: "M32", authority: "primary", textPath: "manual.txt" }] })],
    ["research/manual/manual.txt", "Preface\n===== PDF PAGE 1 =====\nFirst page\n===== PDF PAGE 2 =====\nSecond page"],
  ]);
  const chunks = indexContents("PointCommunity/test", commit, new Date().toISOString(), contents, ["docs/page.html", "research/manual/manual.txt"]);
  expect(chunks.map(chunk => chunk.text).join(" ")).not.toContain("evil()");
  expect(chunks.filter(chunk => chunk.locator.includes("PDF page"))).toHaveLength(2);
  contents.delete("research/manual/manual.txt");
  expect(() => indexContents("PointCommunity/test", commit, new Date().toISOString(), contents, ["docs/page.html"])).toThrow(/Inventory text missing/);
});
