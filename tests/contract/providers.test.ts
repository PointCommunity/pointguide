import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeCodexCatalog, normalizeOllamaCatalog } from "@/lib/providers/catalog";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../fixtures/providers/${name}`, import.meta.url), "utf8"));
}

describe("pinned provider response fixtures", () => {
  it("matches the supported Codex model/list response", async () => {
    expect(normalizeCodexCatalog(await fixture("codex-models-page-1.json"))).toEqual([
      expect.objectContaining({ id: "gpt-5.6-sol", reasoningEfforts: expect.arrayContaining([
        expect.objectContaining({ effort: "medium", isDefault: true }),
      ]) }),
    ]);
  });

  it("matches the Ollama Cloud /api/tags response", async () => {
    expect(normalizeOllamaCatalog(await fixture("ollama-tags.json"))).toEqual([
      expect.objectContaining({ id: "gpt-oss:120b", reasoningEfforts: [] }),
    ]);
  });
});
