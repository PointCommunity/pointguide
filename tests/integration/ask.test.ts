import { describe, expect, it } from "vitest";
import { handleDemoAsk } from "@/app/api/demo/ask/route";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import type { SessionDependencies } from "@/lib/auth/session";

function request(body: unknown, subject = "approved-owner"): Request {
  return new Request("http://localhost/api/demo/ask", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pointguide-fixture-subject": subject,
      "x-pointguide-fixture-email": `${subject}@example.com`,
    },
    body: JSON.stringify(body),
  });
}

function dependencies(): SessionDependencies {
  return {
    store: new MemoryAccountStore(),
    config: { mode: "fixture", nodeEnv: "test", teamDomain: undefined, audience: undefined, fallbackFixtureIdentity: undefined },
  };
}

describe("fixture-grounded Ask API", () => {
  it("returns claim-linked PointAudio evidence for an AES50 sync question", async () => {
    const response = await handleDemoAsk(request({ question: "What does a red AES50 sync light on the DL32 mean?" }), dependencies());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer.confidence).toBe("CONFIRMED");
    expect(payload.answer.reviewStatus).toBe("NOT_REQUESTED");
    expect(payload.answer.claims[0]).toMatchObject({ status: "SUPPORTED", evidenceIds: ["repo:dl32-qsg:sync-leds"] });
    expect(payload.answer.evidence[0]).toMatchObject({ kind: "REPOSITORY", sourceId: "dl32-qsg" });
  });

  it("returns an explicit unknown rather than inventing an unsupported answer", async () => {
    const response = await handleDemoAsk(request({ question: "Which projector is installed in the sanctuary?" }), dependencies());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer.confidence).toBe("UNKNOWN");
    expect(payload.answer.claims).toEqual([expect.objectContaining({ kind: "UNKNOWN", status: "UNKNOWN", evidenceIds: [] })]);
    expect(payload.answer.evidence).toEqual([]);
  });

  it("rejects empty or oversized questions at the boundary", async () => {
    const deps = dependencies();
    const empty = await handleDemoAsk(request({ question: "" }), deps);
    const oversized = await handleDemoAsk(request({ question: "x".repeat(8_001) }), deps);

    expect(empty.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it("rejects a Pending identity before searching protected evidence", async () => {
    const deps = dependencies();
    await handleDemoAsk(request({ question: "bootstrap" }, "owner"), deps);

    const response = await handleDemoAsk(request({ question: "What is the DL32 sync state?" }, "pending"), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ACCOUNT_PENDING", message: "Account approval is pending." } });
  });
});
