import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  captureTrainingWebPage,
  assertTrainingSourceCapacity,
  pinnedLookup,
  parseTrainingSourceForm,
  prepareTrainingSource,
  trainingSourceEvidence,
  trainingSourcePublicationFiles,
} from "@/lib/training/sources";
import type { TrainingSourceContent } from "@/lib/training/types";

const sessionId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

function source(overrides: Partial<TrainingSourceContent> = {}): TrainingSourceContent {
  return {
    id: sourceId,
    sessionId,
    kind: "FILE",
    originalName: "routing.txt",
    mediaType: "text/plain",
    sourceUrl: null,
    originalSize: 24,
    originalDigest: "a".repeat(64),
    originalBytes: Buffer.from("Route channel 1 to bus 2."),
    extractedText: null,
    extractedDigest: null,
    status: "PENDING",
    error: null,
    capturedAt: null,
    createdAt: "2026-09-22T14:00:00.000Z",
    updatedAt: "2026-09-22T14:00:00.000Z",
    ...overrides,
  } as TrainingSourceContent;
}

describe("training source intake", () => {
  it("returns the pinned address in Node single- and all-address lookup modes", () => {
    const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 });
    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    callback.mockClear();
    lookup("example.com", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("parses allowed files and website URLs with bounded totals", async () => {
    const data = new FormData();
    data.append("urls", "https://example.com/guide\nhttps://docs.example.com/setup");
    data.append("sources", new File(["# Routing"], "routing\nnotes.md", { type: "application/octet-stream" }));
    const parsed = await parseTrainingSourceForm(data);
    expect(parsed.map(item => item.kind)).toEqual(["URL", "URL", "FILE"]);
    expect(parsed[2]).toMatchObject({ originalName: "routing notes.md", mediaType: "text/markdown" });
  });

  it("rejects unsupported and oversized uploads before persistence", async () => {
    const data = new FormData();
    data.append("sources", new File(["no"], "payload.exe", { type: "application/octet-stream" }));
    await expect(parseTrainingSourceForm(data)).rejects.toThrow(/supported source file/i);
  });

  it("rejects an oversized website URL before persistence", async () => {
    const data = new FormData(); data.append("urls", `https://example.com/${"a".repeat(2_049)}`);
    await expect(parseTrainingSourceForm(data)).rejects.toThrow(/2,048-character limit/i);
  });

  it("enforces source count and uploaded-byte limits across repeated additions", () => {
    expect(() => assertTrainingSourceCapacity(Array.from({ length: 10 }, (_, index) => source({ id: crypto.randomUUID(), originalName: `${index}.txt` })), [{ kind: "URL", originalName: "guide", mediaType: "text/html", sourceUrl: "https://example.com" }])).toThrow(/no more than 10/i);
    expect(() => assertTrainingSourceCapacity([source({ originalSize: 16 * 1024 * 1024 })], [{ kind: "FILE", originalName: "more.pdf", mediaType: "application/pdf", originalBytes: new Uint8Array(15 * 1024 * 1024) }])).toThrow(/30 MiB/i);
  });

  it("blocks private destinations before making a website request", async () => {
    const request = vi.fn();
    await expect(captureTrainingWebPage("http://internal.example/", {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }], request,
    })).rejects.toThrow(/public website/i);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "169.254.1.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "240.0.0.1", "::1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2001:db8::1"])("blocks non-public address %s", async address => {
    const request = vi.fn();
    await expect(captureTrainingWebPage("https://example.test/", { resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }], request })).rejects.toThrow(/public website/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not reject a public address adjacent to a reserved range", async () => {
    const request = vi.fn(async () => ({ status: 200, location: null, mediaType: "text/plain", bytes: Buffer.from("public evidence") }));
    await expect(captureTrainingWebPage("https://example.test/", { resolve: async () => [{ address: "198.51.99.1", family: 4 }], request })).resolves.toMatchObject({ mediaType: "text/plain" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("revalidates a redirect and retains the final HTML bytes", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ status: 302, location: "https://www.example.com/final", mediaType: "text/html", bytes: Buffer.alloc(0) })
      .mockResolvedValueOnce({ status: 200, location: null, mediaType: "text/html; charset=utf-8", bytes: Buffer.from("<h1>Bus routing</h1><p>Use sends on fader.</p>") });
    const page = await captureTrainingWebPage("https://example.com/start", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }], request,
    });
    expect(page.finalUrl).toBe("https://www.example.com/final");
    expect(page.bytes.toString()).toContain("Bus routing");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("training source extraction and publication", () => {
  it("extracts text, HTML, RTF, PDF, and SVG without executing content", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("PDF bus routing evidence", { font });
    const [jpeg, png, webp] = await Promise.all([sharp({ create: { width: 2, height: 2, channels: 3, background: "#71e0c2" } }).jpeg().toBuffer(), sharp({ create: { width: 2, height: 2, channels: 3, background: "#71e0c2" } }).png().toBuffer(), sharp({ create: { width: 2, height: 2, channels: 3, background: "#71e0c2" } }).webp().toBuffer()]);
    const cases = [
      source(),
      source({ originalName: "guide.html", mediaType: "text/html", originalBytes: Buffer.from("<script>bad()</script><main>HTML routing evidence</main>") }),
      source({ originalName: "guide.rtf", mediaType: "application/rtf", originalBytes: Buffer.from("{\\rtf1\\ansi RTF routing \\b evidence\\b0}") }),
      source({ originalName: "guide.pdf", mediaType: "application/pdf", originalBytes: Buffer.from(await pdf.save()) }),
      source({ originalName: "diagram.svg", mediaType: "image/svg+xml", originalBytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><text>SVG routing evidence</text></svg>') }),
      source({ originalName: "photo.jpeg", mediaType: "image/jpeg", originalBytes: jpeg }),
      source({ originalName: "photo.png", mediaType: "image/png", originalBytes: png }),
      source({ originalName: "photo.webp", mediaType: "image/webp", originalBytes: webp }),
    ];
    const expected = ["Route channel", "HTML routing evidence", "RTF routing", "PDF bus routing", "SVG routing evidence", "visible image evidence", "visible image evidence", "visible image evidence"];
    const describeImage = vi.fn(async (bytes: Uint8Array, mediaType: string) => { void bytes; void mediaType; return "visible image evidence"; });
    for (const [index, input] of cases.entries()) {
      const prepared = await prepareTrainingSource(input, { describeImage });
      expect(prepared.extractedText).toContain(expected[index]);
      expect(prepared.extractedText).not.toContain("bad()");
    }
    expect(describeImage.mock.calls.map(([, mediaType]) => mediaType)).toEqual(["image/png", "image/jpeg", "image/png", "image/webp"]);
  });

  it("rejects mismatched and over-expanded Word archives before extraction", async () => {
    const expanded = Buffer.alloc(98); expanded.writeUInt32LE(0x04034b50, 0); expanded.writeUInt32LE(0x02014b50, 30); expanded.writeUInt32LE(31 * 1024 * 1024, 54); expanded.writeUInt32LE(0x06054b50, 76); expanded.writeUInt16LE(1, 84); expanded.writeUInt16LE(1, 86); expanded.writeUInt32LE(46, 88); expanded.writeUInt32LE(30, 92);
    const describeImage = vi.fn();
    await expect(prepareTrainingSource(source({ originalName: "guide.docx", originalBytes: expanded }), { describeImage })).rejects.toThrow(/expanded-content limit/i);
    await expect(prepareTrainingSource(source({ originalName: "guide.doc", originalBytes: Buffer.from("not a Word document") }), { describeImage })).rejects.toThrow(/signature/i);
  });

  it("uses trainer sources first and publishes exact originals beside extracted provenance", () => {
    const ready = source({ status: "READY", extractedText: "Route channel 1 to bus 2 using sends on fader.", extractedDigest: "b".repeat(64), capturedAt: "2026-09-22T14:05:00.000Z" });
    const evidence = trainingSourceEvidence("How do I route channel 1 to bus 2?", [ready]);
    expect(evidence[0]).toMatchObject({ kind: "TRAINER_SOURCE", sourceId, authority: expect.stringMatching(/Trainer-provided/) });
    const files = trainingSourcePublicationFiles(sessionId, [ready]);
    expect(Object.keys(files)).toEqual([
      `research/pointguide-training/${sessionId}/originals/${sourceId}.txt`,
      `research/pointguide-training/${sessionId}/sources/${sourceId}.md`,
    ]);
    expect(Buffer.from(files[`research/pointguide-training/${sessionId}/originals/${sourceId}.txt`] as Uint8Array).toString()).toBe("Route channel 1 to bus 2.");
    expect(String(files[`research/pointguide-training/${sessionId}/sources/${sourceId}.md`])).toContain("Route channel 1 to bus 2 using sends on fader.");
  });
});
