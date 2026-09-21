import { describe, expect, it } from "vitest";
import { validateSourceRepository } from "@/lib/sources/validator";
import { seal, sourceFiles, upstream } from "../fixtures/source-contract";

describe("mandatory source contract", () => {
  it("accepts a canonical source, retaining purpose metadata outside answer chunks", async () => {
    const result = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(sourceFiles()) });
    expect(result.report.valid).toBe(true);
    expect(result.report.checksumsVerified).toBe(Object.keys(sourceFiles()).length - 1);
    expect(result.chunks.map(chunk => chunk.path)).toEqual(["docs/setup.txt"]);
    expect(JSON.stringify(result.chunks)).not.toContain("agent navigation only");
  });

  it.each(["README.md", "data/README.md", "research/pointguide-training/README.md", "tools/README.md", "source-inventory.json", "checksums.sha256", "pointguide-source.yaml"])("rejects missing %s before activation", async path => {
    const files = sourceFiles(); delete files[path]; seal(files);
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files) })).rejects.toThrow(path);
  });

  it("rejects an inventory digest mismatch and an unsupported contract version", async () => {
    const files = sourceFiles(); files["docs/setup.txt"] = "changed but checksum not updated";
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files) })).rejects.toThrow(/docs\/setup\.txt/);
    const version = sourceFiles(); version["pointguide-source.yaml"] = version["pointguide-source.yaml"].replace("schema_version: 2", "schema_version: 99"); seal(version);
    await expect(validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(version) })).rejects.toThrow(/version|pointguide-source\.yaml/i);
  });
});
