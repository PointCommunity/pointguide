import { describe, expect, it, vi } from "vitest";
import { validateSourceRepository, SourceValidationError } from "@/lib/sources/validator";
import { MemorySourceRepositoryStore } from "@/lib/sources/store";

function validFetcher() {
  return vi.fn(async (input: string) => {
    if (input === "https://api.github.com/repos/PointCommunity/lighting") return Response.json({ full_name: "PointCommunity/lighting", default_branch: "main", html_url: "https://github.com/PointCommunity/lighting", pushed_at: "2026-09-06T00:00:00Z" });
    if (input.includes("/git/trees/")) return Response.json({ sha: "a".repeat(40), truncated: false, tree: [{ path: "AGENTS.md", type: "blob", size: 50 }, { path: "pointguide-source.yaml", type: "blob", size: 50 }, { path: "docs/setup.md", type: "blob", size: 80 }] });
    if (input.includes("raw.githubusercontent.com")) return new Response("Verified lighting setup instructions.");
    return new Response(null, { status: 404 });
  });
}

describe("connected source repositories", () => {
  it("validates structure and creates bounded searchable chunks", async () => {
    const source = await validateSourceRepository("https://github.com/PointCommunity/lighting", { fetcher: validFetcher() });
    expect(source.report.valid).toBe(true);
    expect(source.report.requirements).toEqual({ agentsFile: true, evidenceContent: true, integrityManifest: true });
    expect(source.chunks).toHaveLength(1);
  });

  it("rejects unapproved organizations before making a network request", async () => {
    const fetcher = validFetcher();
    await expect(validateSourceRepository("https://github.com/not-approved/lighting", { fetcher })).rejects.toBeInstanceOf(SourceValidationError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires archive and exact typed confirmations before deletion", async () => {
    const source = await validateSourceRepository("https://github.com/PointCommunity/lighting", { fetcher: validFetcher() });
    const store = new MemorySourceRepositoryStore(false);
    const linked = await store.link("owner", source);
    await expect(store.remove("owner", linked.id, linked.fullName)).rejects.toThrow("Archive");
    await expect(store.archive("owner", linked.id, "wrong")).rejects.toThrow("Type");
    await store.archive("owner", linked.id, linked.fullName);
    expect(await store.activeChunks()).toHaveLength(0);
    await store.remove("owner", linked.id, linked.fullName);
    expect(await store.list()).toHaveLength(0);
  });

  it("protects the source registry from duplicates and unknown identifiers", async () => {
    const source = await validateSourceRepository("https://github.com/PointCommunity/lighting", { fetcher: validFetcher() });
    const store = new MemorySourceRepositoryStore();
    const seeded = await store.list();
    expect(seeded[0]).toMatchObject({ fullName: "PointCommunity/pointaudio", status: "ACTIVE" });
    (store as unknown as { chunks: Map<string, unknown[]> }).chunks.clear();
    expect(await store.activeChunks()).toEqual([]);

    const linked = await store.link("owner", source);
    await expect(store.link("owner", { ...source, fullName: "pointcommunity/LIGHTING" })).rejects.toThrow("already linked");
    await expect(store.archive("owner", "missing", "anything")).rejects.toThrow("not found");
    await expect(store.remove("owner", "missing", "anything")).rejects.toThrow("not found");

    await store.archive("owner", linked.id, linked.fullName);
    await expect(store.remove("owner", linked.id, "wrong")).rejects.toThrow("confirm deletion");
  });
});
