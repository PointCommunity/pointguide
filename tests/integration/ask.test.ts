import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDemoAsk } from "@/app/api/demo/ask/route";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import type { SessionDependencies } from "@/lib/auth/session";
import { POST as ask } from "@/app/api/conversations/[id]/messages/route";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { getRuntimeTrainingStore } from "@/lib/training/runtime";
import { MemoryLearningRepository } from "@/lib/learning/store";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import { MemorySourceRepositoryStore } from "@/lib/sources/store";
import { validateSourceRepository } from "@/lib/sources/validator";
import { acceptedSourceFiles, upstream } from "../fixtures/source-contract";
import * as search from "@/lib/evidence/search";

vi.mock("@/lib/auth/runtime", () => ({ getRuntimeSessionDependencies: vi.fn() }));
vi.mock("@/lib/learning/runtime", () => ({ getRuntimeLearningRepository: vi.fn() }));
vi.mock("@/lib/providers/runtime", () => ({ getRuntimeProviderDependencies: vi.fn(), getRuntimeModelRuntime: vi.fn() }));
vi.mock("@/lib/sources/runtime", () => ({ getRuntimeSourceStore: vi.fn() }));
vi.mock("@/lib/training/runtime", () => ({ getRuntimeTrainingStore: vi.fn(() => { throw new Error("No local Training sessions in this environment"); }) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("answers Ask from published source Training with no local Training lookup", async () => {
  vi.stubEnv("AUTH_MODE", "fixture"); const deps = dependencies();
  const actor = await deps.store.provisionAccount({ issuer: "https://fixture.pointguide.invalid", subject: "approved-owner", email: "approved-owner@example.com", displayName: "Owner" });
  vi.mocked(getRuntimeSessionDependencies).mockReturnValue(deps);
  const learning = new MemoryLearningRepository(); const conversation = await learning.createConversation(actor.id, "Portable Training");
  vi.mocked(getRuntimeLearningRepository).mockReturnValue(learning);
  vi.mocked(getRuntimeProviderDependencies).mockReturnValue({ store: new MemoryProviderStore(), session: deps, secretKey: "unused", codex: { startDeviceLogin: vi.fn(), listModels: vi.fn() }, ollama: { connect: vi.fn() } });
  const { files, path, question } = acceptedSourceFiles(); const validated = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files) });
  const sources = new MemorySourceRepositoryStore(false); await sources.link(actor.id, validated);
  vi.mocked(getRuntimeSourceStore).mockReturnValue(sources);
  const retrieve = vi.spyOn(search, "searchCorpus");
  const response = await ask(request({ question }), { params: Promise.resolve({ id: conversation.id }) });
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events.map(event => event.type)).toEqual(["status", "answer", "done"]);
  expect(events[1].data.answer).toMatchObject({ steps: ["Select the channel.", "Raise the bus send."], safetyAndAssumptions: ["Check the destination before raising the send."], evidence: [{ kind: "ACCEPTED_TRAINING", path, digest: validated.report.acceptedTraining![0].digest, locator: expect.stringContaining(validated.report.commitSha) }] });
  expect(getRuntimeTrainingStore).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled();
});

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
