import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildSessionPdf } from "@/lib/learning/pdf";
import type { SessionDetail } from "@/lib/learning/store";

const detail: SessionDetail = {
  conversation: {
    id: "session-id",
    ownerAccountId: "owner-id",
    title: "AES50 sync troubleshooting",
    createdAt: "2026-09-07T12:00:00.000Z",
    updatedAt: "2026-09-07T12:01:00.000Z",
    userTurnCount: 1,
  },
  turns: [{
    question: "Why is the AES50 light red?",
    createdAt: "2026-09-07T12:00:00.000Z",
    answer: {
      id: "answer-id",
      directAnswer: "The connection is present but not synchronized.",
      steps: ["Confirm the connected device and note whether port A or B is red."],
      safetyAndAssumptions: ["Clock changes can interrupt audio."],
      confidence: "CONFIRMED",
      reviewStatus: "PASSED",
      claims: [{ id: "claim-id", text: "A red AES50 light means not synchronized.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: ["evidence-id"] }],
      evidence: [{ id: "evidence-id", kind: "REPOSITORY", sourceId: "dl32", title: "DL32 Quick Start Guide", path: "research/manuals/dl32.pdf", locator: "Page 8", authority: "Manufacturer", capturedAt: "2026-09-06T00:00:00.000Z", excerpt: "AES50 SYNC LEDs indicate synchronization state.", digest: "a".repeat(64) }],
    },
  }],
};

describe("session PDF export", () => {
  it("creates a readable multi-section PDF without mutating the session", async () => {
    const original = structuredClone(detail);
    const bytes = await buildSessionPdf(detail);
    const document = await PDFDocument.load(bytes);

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(document.getTitle()).toBe("AES50 sync troubleshooting");
    expect(detail).toEqual(original);
  });

  it("wraps long words, normalizes unsupported glyphs, and exports unknown answers", async () => {
    const unknown: SessionDetail = {
      conversation: { ...detail.conversation, title: `Unknown projector ${"x".repeat(120)}` },
      turns: Array.from({ length: 3 }, (_, index) => ({
        question: `Which projector is installed? 🎛 ${"unbroken".repeat(90)}`,
        createdAt: detail.conversation.createdAt,
        answer: { id: `unknown-${index}`, directAnswer: "The current sources do not establish this…", steps: [], safetyAndAssumptions: [], confidence: "UNKNOWN" as const, reviewStatus: "NOT_REQUESTED" as const, claims: [], evidence: [] },
      })),
    };
    const bytes = await buildSessionPdf(unknown);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toContain("Unknown projector");
  });
});
