import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import { MemoryTrainingSessionStore } from "@/lib/training/store";
import { PATCH } from "@/app/api/training/sessions/[id]/route";
import { POST } from "@/app/api/training/sessions/route";
import { DELETE as DELETE_SOURCE, POST as POST_SOURCE } from "@/app/api/training/sessions/[id]/sources/route";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeTrainingStore } from "@/lib/training/runtime";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";
import { getRuntimeLearningRepository } from "@/lib/learning/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";
import { knowledgeSnapshot } from "@/lib/sources/retrieval";
import { answerQuestion } from "@/lib/agent/service";

vi.mock("@/lib/auth/runtime", () => ({ getRuntimeSessionDependencies: vi.fn() }));
vi.mock("@/lib/training/runtime", () => ({ getRuntimeTrainingStore: vi.fn() }));
vi.mock("@/lib/providers/runtime", () => ({ getRuntimeProviderDependencies: vi.fn(), getRuntimeModelRuntime: vi.fn() }));
vi.mock("@/lib/learning/runtime", () => ({ getRuntimeLearningRepository: vi.fn() }));
vi.mock("@/lib/sources/runtime", () => ({ getRuntimeSourceStore: vi.fn() }));
vi.mock("@/lib/sources/retrieval", () => ({ knowledgeSnapshot: vi.fn() }));
vi.mock("@/lib/agent/service", () => ({ answerQuestion: vi.fn() }));

let store: MemoryTrainingSessionStore;
let actorId: string;
const answerId = "00000000-0000-4000-8000-000000000081";
const revisedId = "00000000-0000-4000-8000-000000000082";
const headers = { "content-type": "application/json", "x-pointguide-fixture-subject": "owner", "x-pointguide-fixture-email": "owner@example.com" };
async function action(id: string, body: Record<string, unknown>) {
  return PATCH(new Request(`http://localhost/api/training/sessions/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  vi.stubEnv("AUTH_MODE", "fixture");
  const accounts = new MemoryAccountStore();
  actorId = (await accounts.provisionAccount({ issuer: "https://fixture.pointguide.invalid", subject: "owner", email: "owner@example.com", displayName: "Owner" })).id;
  vi.mocked(getRuntimeSessionDependencies).mockReturnValue({ store: accounts, config: { mode: "fixture", nodeEnv: "test", teamDomain: undefined, audience: undefined, fallbackFixtureIdentity: undefined } });
  store = new MemoryTrainingSessionStore();
  vi.mocked(getRuntimeTrainingStore).mockReturnValue(store);
  vi.mocked(getRuntimeProviderDependencies).mockReturnValue({ store: {} } as ReturnType<typeof getRuntimeProviderDependencies>);
  vi.mocked(getRuntimeLearningRepository).mockReturnValue({} as ReturnType<typeof getRuntimeLearningRepository>);
  vi.mocked(getRuntimeSourceStore).mockReturnValue({} as ReturnType<typeof getRuntimeSourceStore>);
  vi.mocked(knowledgeSnapshot).mockResolvedValue({ chunks: [], sources: [], navigation: {} });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("keeps the previous answer and feedback after revision failure, then retries the same history", async () => {
  const session = await store.create({ trainerAccountId: actorId, conversationId: crypto.randomUUID(), targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I check sync?" });
  const first = await store.saveAnswer(session.id, actorId, { id: answerId, directAnswer: "Check the documented sync indicator." });
  vi.mocked(answerQuestion).mockRejectedValueOnce(new Error("private provider failure"))
    .mockResolvedValueOnce({ answer: { id: revisedId, directAnswer: "Check the documented sync indicator before changing clock." } } as Awaited<ReturnType<typeof answerQuestion>>);
  const failed = await action(session.id, { action: "FEEDBACK", answerId, expectedVersion: first.version, feedback: "Do not change clock before checking sync." });
  expect(failed.status).toBe(202);
  const pending = await failed.json();
  expect(pending.error).toMatchObject({ code: "ANSWER_FAILED", message: "The revision failed. Your feedback is saved. Retry this revision." });
  expect(JSON.stringify(pending)).not.toContain("private provider failure");
  expect(pending.session).toMatchObject({ state: "REVISING", currentAnswer: { id: answerId } });
  expect(pending.turns.map((turn: { kind: string }) => turn.kind)).toEqual(["ANSWER", "FEEDBACK"]);
  const retried = await action(session.id, { action: "RETRY", expectedVersion: pending.session.version });
  expect(retried.status).toBe(200);
  expect((await retried.json()).session).toMatchObject({ state: "ACTIVE", currentAnswer: { id: revisedId } });
  expect(vi.mocked(answerQuestion).mock.calls[1]?.[0]?.trainingHistory).toEqual(expect.arrayContaining([{ actor: "USER", content: "Trainer feedback, turn 2: Do not change clock before checking sync." }]));
});

it("returns a saved-question retry when the first answer fails", async () => {
  const session = await store.create({ trainerAccountId: actorId, conversationId: crypto.randomUUID(), targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I check sync?" });
  vi.mocked(answerQuestion).mockRejectedValueOnce(new Error("private provider failure"));
  const failed = await action(session.id, { action: "RETRY", expectedVersion: session.version });
  expect(failed.status).toBe(202);
  expect(await failed.json()).toMatchObject({ session: { state: "ACTIVE", currentAnswer: null }, error: { code: "ANSWER_FAILED", message: "The first answer failed. Your question is saved. Retry the first answer." } });
});

it("keeps an essential clarifying question separate, revises from the response, and blocks stale acceptance", async () => {
  const session = await store.create({ trainerAccountId: actorId, conversationId: crypto.randomUUID(), targetRepository: "PointCommunity/pointaudio", originalQuestion: "Which inputs?" });
  const pending = await store.saveAnswer(session.id, actorId, { id: answerId, directAnswer: "The model determines physical sockets.", clarifyingQuestion: "Is it an M32R?" });
  vi.mocked(answerQuestion).mockResolvedValueOnce({ answer: { id: revisedId, directAnswer: "The M32R has 16 local mic sockets.", clarifyingQuestion: null } } as Awaited<ReturnType<typeof answerQuestion>>);
  const response = await action(session.id, { action: "CLARIFY", answerId, expectedVersion: pending.version, response: "Yes, M32R" });
  expect(response.status).toBe(200);
  expect((await response.json()).session).toMatchObject({ state: "ACTIVE", currentAnswer: { id: revisedId, clarifyingQuestion: null } });
  expect(vi.mocked(answerQuestion).mock.calls[0]?.[0]?.trainingHistory).toEqual(expect.arrayContaining([{ actor: "USER", content: "Clarification for Is it an M32R?, turn 2: Yes, M32R" }]));
  const stale = await action(session.id, { action: "CLARIFY", answerId, expectedVersion: pending.version, response: "No" });
  expect(stale.status).toBe(409);
});

it("reports invalid provider output without exposing its contents", async () => {
  const session = await store.create({ trainerAccountId: actorId, conversationId: crypto.randomUUID(), targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I check sync?" });
  vi.mocked(answerQuestion).mockRejectedValueOnce(new SyntaxError("private output content"));
  const failed = await action(session.id, { action: "RETRY", expectedVersion: session.version });
  const payload = await failed.json();
  expect(payload.error).toMatchObject({ code: "ANSWER_FAILED", reason: "INVALID_PROVIDER_OUTPUT", message: "The provider returned an unusable answer. Your question is saved. Retry the first answer." });
  expect(JSON.stringify(payload)).not.toContain("private output content");
});

it("routes a named model automatically but requires a subject-area answer for ambiguity", async () => {
  const sources = [{ id: "audio", fullName: "PointCommunity/pointaudio", status: "ACTIVE" }, { id: "planning", fullName: "PointCommunity/pointplanning", status: "ACTIVE" }];
  vi.mocked(getRuntimeSourceStore).mockReturnValue({ snapshot: async () => ({ sources, chunks: [{ chunkId: "PointCommunity/pointaudio:one", metadata: { product: "Midas M32R", applicability: { model: "M32R" } } }] }) } as unknown as ReturnType<typeof getRuntimeSourceStore>);
  vi.mocked(getRuntimeLearningRepository).mockReturnValue({ createConversation: async () => ({ id: crypto.randomUUID() }) } as unknown as ReturnType<typeof getRuntimeLearningRepository>);
  const request = (question: string) => new Request("http://localhost/api/training/sessions", { method: "POST", headers, body: JSON.stringify({ question }) });
  const ambiguous = await POST(request("How do we get started?"));
  expect(ambiguous.status).toBe(409);
  expect(await ambiguous.json()).toMatchObject({ error: { code: "SOURCE_AREA_REQUIRED" } });
  vi.mocked(answerQuestion).mockResolvedValue({ answer: { id: crypto.randomUUID(), directAnswer: "The M32R has 16 local microphone sockets." } } as Awaited<ReturnType<typeof answerQuestion>>);
  const routed = await POST(request("How many local M32R sockets?"));
  expect(routed.status).toBe(201);
  expect(await routed.json()).toMatchObject({ session: { targetRepository: "PointCommunity/pointaudio" } });
});

it("returns saved live sessions and feedback before the provider runs", async () => {
  vi.stubEnv("AUTH_MODE", "cloudflare");
  const sources = [{ id: "audio", fullName: "PointCommunity/pointaudio", status: "ACTIVE" }];
  vi.mocked(getRuntimeSourceStore).mockReturnValue({ list: async () => sources } as unknown as ReturnType<typeof getRuntimeSourceStore>);
  const conversationId = crypto.randomUUID();
  vi.mocked(getRuntimeLearningRepository).mockReturnValue({ createConversation: async () => ({ id: conversationId }) } as unknown as ReturnType<typeof getRuntimeLearningRepository>);
  const response = await POST(new Request("http://localhost/api/training/sessions", { method: "POST", headers, body: JSON.stringify({ question: "How do I route a channel?", targetRepository: "PointCommunity/pointaudio" }) }));
  expect(response.status).toBe(202);
  const { session } = await response.json();
  expect(session).toMatchObject({ state: "GENERATING", currentAnswer: null, targetRepository: "PointCommunity/pointaudio" });
  expect(answerQuestion).not.toHaveBeenCalled();
  const answerId = crypto.randomUUID();
  const answered = await store.saveAnswer(session.id, actorId, { id: answerId, directAnswer: "Check the route." });
  const revised = await action(session.id, { action: "FEEDBACK", answerId, expectedVersion: answered.version, feedback: "Check the right bus first." });
  expect(revised.status).toBe(202);
  expect(await revised.json()).toMatchObject({ session: { state: "REVISING", answerError: null }, turns: [{ kind: "ANSWER" }, { kind: "FEEDBACK" }] });
  expect(answerQuestion).not.toHaveBeenCalled();
});

it("starts selected-area training with material without loading the indexed corpus", async () => {
  vi.stubEnv("AUTH_MODE", "cloudflare");
  const sourceStore = {
    list: vi.fn().mockResolvedValue([{ id: "audio", fullName: "PointCommunity/pointaudio", status: "ACTIVE" }]),
    snapshot: vi.fn().mockRejectedValue(new Error("full corpus must not load during session creation")),
  };
  vi.mocked(getRuntimeSourceStore).mockReturnValue(sourceStore as unknown as ReturnType<typeof getRuntimeSourceStore>);
  vi.mocked(getRuntimeLearningRepository).mockReturnValue({ createConversation: async () => ({ id: crypto.randomUUID() }) } as unknown as ReturnType<typeof getRuntimeLearningRepository>);
  const form = new FormData();
  form.set("question", "How do I add a channel to a bus?");
  form.set("targetRepository", "PointCommunity/pointaudio");
  form.set("urls", "https://example.com/manual");
  form.set("sources", new File(["%PDF-1.7\n"], "manual.pdf", { type: "application/pdf" }));
  const response = await POST(new Request("http://localhost/api/training/sessions", { method: "POST", headers: { "x-pointguide-fixture-subject": "owner", "x-pointguide-fixture-email": "owner@example.com" }, body: form }));
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ session: { state: "GENERATING", targetRepository: "PointCommunity/pointaudio" } });
  expect(sourceStore.snapshot).not.toHaveBeenCalled();
  expect(answerQuestion).not.toHaveBeenCalled();
});

it("uses uploaded trainer material immediately and republishes the answer when material changes", async () => {
  const sourceRepository = { id: "audio", fullName: "PointCommunity/pointaudio", status: "ACTIVE" };
  vi.mocked(getRuntimeSourceStore).mockReturnValue({ list: async () => [sourceRepository] } as unknown as ReturnType<typeof getRuntimeSourceStore>);
  vi.mocked(getRuntimeLearningRepository).mockReturnValue({ createConversation: async () => ({ id: crypto.randomUUID() }) } as unknown as ReturnType<typeof getRuntimeLearningRepository>);
  vi.mocked(answerQuestion).mockResolvedValue({ answer: { id: crypto.randomUUID(), directAnswer: "Use the trainer-provided routing note." } } as Awaited<ReturnType<typeof answerQuestion>>);
  const form = new FormData(); form.set("question", "How do I route this channel?"); form.set("targetRepository", sourceRepository.fullName); form.set("sources", new File(["Route channel 1 to bus 2."], "routing.txt", { type: "text/plain" }));
  const created = await POST(new Request("http://localhost/api/training/sessions", { method: "POST", headers: { "x-pointguide-fixture-subject": "owner", "x-pointguide-fixture-email": "owner@example.com" }, body: form }));
  expect(created.status).toBe(201);
  const initial = await created.json();
  expect(initial).toMatchObject({ session: { state: "ACTIVE", targetRepository: sourceRepository.fullName }, sources: [{ originalName: "routing.txt", status: "READY" }] });
  expect(vi.mocked(answerQuestion).mock.calls[0]?.[0].sessionEvidence).toEqual([expect.objectContaining({ kind: "TRAINER_SOURCE", title: "routing.txt" })]);

  const add = new FormData(); add.set("expectedVersion", String(initial.session.version)); add.set("sources", new File(["Keep the channel muted until patched."], "safety.md", { type: "text/markdown" }));
  const added = await POST_SOURCE(new Request(`http://localhost/api/training/sessions/${initial.session.id}/sources`, { method: "POST", headers: { "x-pointguide-fixture-subject": "owner", "x-pointguide-fixture-email": "owner@example.com" }, body: add }), { params: Promise.resolve({ id: initial.session.id }) });
  expect(added.status).toBe(200);
  const revised = await added.json();
  expect(revised.sources).toEqual(expect.arrayContaining([expect.objectContaining({ originalName: "routing.txt", status: "READY" }), expect.objectContaining({ originalName: "safety.md", status: "READY" })]));

  const removed = await DELETE_SOURCE(new Request(`http://localhost/api/training/sessions/${initial.session.id}/sources`, { method: "DELETE", headers, body: JSON.stringify({ sourceId: revised.sources[1].id, expectedVersion: revised.session.version }) }), { params: Promise.resolve({ id: initial.session.id }) });
  expect(removed.status).toBe(200);
  expect((await removed.json()).sources).toEqual([expect.objectContaining({ originalName: "routing.txt" })]);
});
