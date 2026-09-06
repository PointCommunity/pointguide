import { describe, expect, it, vi } from "vitest";
import { fetchSupplementalEvidence } from "@/lib/evidence/web";

describe("supplemental web evidence boundary", () => {
  it.each(["http://example.com", "https://127.0.0.1/a", "https://169.254.169.254/latest", "https://user:pass@example.com"])("rejects unsafe URL %s", async (url) => {
    await expect(fetchSupplementalEvidence(url)).rejects.toThrow();
  });

  it("captures bounded HTTPS text as supplemental evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Verified manufacturer guidance", { headers:{ "content-type":"text/plain", "content-length":"30" } }));
    const item = await fetchSupplementalEvidence("https://example.com/guide", { fetcher, resolve: async () => ["93.184.216.34"], now: new Date("2026-09-07T00:00:00Z") });
    expect(item).toMatchObject({ kind:"PRIMARY_WEB", url:"https://example.com/guide", capturedAt:"2026-09-07T00:00:00.000Z" });
    expect(item.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects private DNS answers, redirects, media, and oversized responses", async () => {
    await expect(fetchSupplementalEvidence("https://example.com", { resolve: async () => ["10.0.0.1"] })).rejects.toThrow("private");
    await expect(fetchSupplementalEvidence("https://example.com", { resolve: async () => ["93.184.216.34"], fetcher: async () => new Response(null,{status:302,headers:{location:"https://other.example"}}) })).rejects.toThrow("redirect");
    await expect(fetchSupplementalEvidence("https://example.com", { resolve: async () => ["93.184.216.34"], fetcher: async () => new Response("x",{headers:{"content-type":"image/png"}}) })).rejects.toThrow("content type");
    await expect(fetchSupplementalEvidence("https://example.com", { resolve: async () => ["93.184.216.34"], fetcher: async () => new Response("x",{headers:{"content-type":"text/plain","content-length":"9999999"}}) })).rejects.toThrow("size");
  });
});
