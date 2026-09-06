import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/ask/route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/demo/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("fixture-grounded Ask API", () => {
  it("returns claim-linked PointAudio evidence for an AES50 sync question", async () => {
    const response = await POST(request({ question: "What does a red AES50 sync light on the DL32 mean?" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer.confidence).toBe("CONFIRMED");
    expect(payload.answer.reviewStatus).toBe("NOT_REQUESTED");
    expect(payload.answer.claims[0]).toMatchObject({ status: "SUPPORTED", evidenceIds: ["repo:dl32-qsg:sync-leds"] });
    expect(payload.answer.evidence[0]).toMatchObject({ kind: "REPOSITORY", sourceId: "dl32-qsg" });
  });

  it("returns an explicit unknown rather than inventing an unsupported answer", async () => {
    const response = await POST(request({ question: "Which projector is installed in the sanctuary?" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer.confidence).toBe("UNKNOWN");
    expect(payload.answer.claims).toEqual([expect.objectContaining({ kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] })]);
    expect(payload.answer.evidence).toEqual([]);
  });

  it("rejects empty or oversized questions at the boundary", async () => {
    const empty = await POST(request({ question: "" }));
    const oversized = await POST(request({ question: "x".repeat(8_001) }));

    expect(empty.status).toBe(400);
    expect(oversized.status).toBe(400);
  });
});
