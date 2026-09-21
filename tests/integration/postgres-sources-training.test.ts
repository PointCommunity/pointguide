import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDatabase } from "@/db/client";
import { PostgresAccountStore } from "@/db/accounts";
import { PostgresLearningRepository } from "@/lib/learning/store";
import { PostgresSourceRepositoryStore } from "@/db/sources";
import { PostgresTrainingSessionStore } from "@/db/training";
import { answerQuestion } from "@/lib/agent/service";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import { validateSourceRepository } from "@/lib/sources/validator";
import { sourceFiles, upstream } from "../fixtures/source-contract";
import { searchCorpus } from "@/lib/evidence/search";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? it : it.skip;

function disposableDatabaseUrl(value: string): string {
  const url = new URL(value);
  const databaseName = url.pathname.slice(1);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) || !databaseName.endsWith("_test")) {
    throw new Error("PostgreSQL integration tests require a local database whose name ends in _test.");
  }
  return value;
}

databaseTest("persists connected sources and wipes a training session with its conversation", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({
    issuer: "https://pointguide.test",
    subject: "source-training-owner",
    email: "owner@example.com",
    displayName: "Owner",
  });

  const sources = new PostgresSourceRepositoryStore(database);
  const validated = await validateSourceRepository("https://github.com/PointCommunity/lighting", { fetcher: upstream(sourceFiles("PointCommunity/lighting", "Verified setup steps."), "PointCommunity/lighting") });
  const linked = await sources.link(actor.id, validated);
  expect(await sources.activeChunks()).toHaveLength(1);

  const learning = new PostgresLearningRepository(database);
  const conversation = await learning.createConversation(actor.id, "Training test");
  const training = new PostgresTrainingSessionStore(database);
  const session = await training.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: linked.fullName, originalQuestion: "How do I set this up?" });
  await training.saveAnswer(session.id, actor.id, { directAnswer: "Use the verified steps." });
  expect(await training.list(actor.id, "verified steps")).toEqual([expect.objectContaining({ id: session.id })]);
  expect(await training.list(actor.id, "not in this session")).toEqual([]);
  await training.saveReport(session.id, actor.id, "HELPFUL", "Clear steps", { summary: "Keep clear steps.", learned: ["Clear steps help."], responseChanges: ["Retain steps."], evidenceBoundary: "Behavior guidance only." });
  await training.acceptReport(session.id, actor.id);
  await training.wipe(session.id, actor.id);
  expect(await learning.ownsConversation(conversation.id, actor.id)).toBe(false);

  const support = await learning.createConversation(actor.id, "PointGuide support");
  await answerQuestion({ actor, conversationId: support.id, question: "red AES50 DL32", deepResearch: false, providers: new MemoryProviderStore(), learning, fixture: true });
  await answerQuestion({ actor, conversationId: support.id, question: "red AES50 DL32 follow-up", deepResearch: true, providers: new MemoryProviderStore(true), learning, fixture: true });
  expect(await learning.listConversations(actor.id, "synchronized")).toEqual([expect.objectContaining({ id: support.id, title: "red AES50 DL32", userTurnCount: 2 })]);
  const persisted = await learning.getConversation(support.id, actor.id);
  expect(persisted.turns.map((turn) => turn.question)).toEqual(["red AES50 DL32 follow-up", "red AES50 DL32"]);
  expect(persisted.turns[1]?.answer.evidence[0]).toMatchObject({ title: "DL32 Quick Start Guide", path: expect.any(String) });

  await sources.archive(actor.id, linked.id, linked.fullName);
  await sources.remove(actor.id, linked.id, linked.fullName);
  expect(await sources.list()).toEqual([]);
});

databaseTest("round-trips source applicability, purpose navigation and provenance through PostgreSQL", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "metadata-owner", email: "owner@example.com", displayName: "Owner" });
  const files = sourceFiles();
  const validated = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files) });
  const store = new PostgresSourceRepositoryStore(database);
  await store.link(actor.id, validated);
  const restarted = new PostgresSourceRepositoryStore(database);
  const snapshot = await restarted.snapshot();
  expect(snapshot.sources[0].validationReport.navigation?.docs).toMatchObject({ purpose: expect.stringContaining("support guides") });
  expect(snapshot.chunks[0].metadata).toMatchObject({ id: "M32R-LOCAL-INPUTS", questions: [expect.stringContaining("M32R")], product: "M32R", capturedAt: "2026-09-18", verifiedAt: "2026-09-18" });
  expect(searchCorpus("M32R local sockets", snapshot.chunks)[0]).toMatchObject({ sourceId: "M32R-LOCAL-INPUTS", product: "M32R", verifiedAt: "2026-09-18" });
});

databaseTest("serializes feedback and exact-answer acceptance, then activates only indexed committed guidance", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "accepted-owner", email: "owner@example.com", displayName: "Owner" });
  const sourceStore = new PostgresSourceRepositoryStore(database);
  const validated = await validateSourceRepository("https://github.com/PointCommunity/pointaudio", { fetcher: upstream(sourceFiles("PointCommunity/pointaudio", "Check the AES50 cable."), "PointCommunity/pointaudio") });
  const source = await sourceStore.link(actor.id, validated);
  const conversation = await new PostgresLearningRepository(database).createConversation(actor.id, "Training test");
  const training = new PostgresTrainingSessionStore(database);
  const started = await training.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: source.fullName, originalQuestion: "Why is the DL32 AES50 link red?" });
  const answerId = "00000000-0000-4000-8000-000000000012";
  const completed = await training.saveAnswer(started.id, actor.id, { id: answerId, directAnswer: "Check the AES50 cable.", evidence: [{ id: "manual:1" }], claims: [{ id: "claim:1", text: "Check the AES50 cable.", status: "SUPPORTED", evidenceIds: ["manual:1"] }] });
  const actions = await Promise.allSettled([
    training.saveFeedback(started.id, actor.id, completed.version, answerId, "Check the connection first."),
    training.acceptAnswer(started.id, actor.id, completed.version, answerId, source),
  ]);
  expect(actions.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const current = await training.get(started.id, actor.id);
  expect((await training.listTurns(started.id, actor.id)).map(turn => turn.kind)).toEqual(["ANSWER", current.state === "REVISING" ? "FEEDBACK" : "ACCEPT_ANSWER"]);
  if (current.state === "REVISING") {
    const revised = await training.saveAnswer(started.id, actor.id, { id: "00000000-0000-4000-8000-000000000013", directAnswer: "Check the connection first.", evidence: [{ id: "manual:1" }] });
    await training.acceptAnswer(started.id, actor.id, revised.version, String(revised.currentAnswer?.id), source);
  }
  const accepted = await training.get(started.id, actor.id);
  expect(accepted.state).toBe("PUBLISHING");
  expect(accepted.acceptedPath).toMatch(/^research\/pointguide-training\//u);
  expect(JSON.parse(String(accepted.acceptedContent))).toMatchObject({ originalQuestion: started.originalQuestion, answerVersion: expect.any(Number), answer: { id: accepted.currentAnswer?.id } });
  expect(await training.activeGuidance()).toEqual([]);
  const jobs = await database.execute(sql`select kind from jobs where payload->>'sessionId' = ${started.id}`);
  expect(jobs).toHaveLength(1);
  await expect(training.acceptAnswer(started.id, actor.id, completed.version, answerId, source)).rejects.toThrow(/answer changed/i);
  const first = await database.execute(sql`update training_sessions set state='ACTIVATING',published_commit=${"b".repeat(40)} where id=${started.id}`);
  expect(first.count).toBe(1);
  const artifactPath = String(accepted.acceptedPath);
  const renewed = await sourceStore.refresh(actor.id, source, { fullName: source.fullName, url: source.url,
    report: { ...source.validationReport, checkedAt: new Date().toISOString(), commitSha: "b".repeat(40), acceptedArtifacts: [{ path: artifactPath, digest: accepted.acceptedDigest! }] },
    chunks: [{ chunkId: "manual:1", sourceId: source.fullName, title: "DL32", path: "docs/dl32.txt", locator: "1-10", authority: "Manual", capturedAt: new Date().toISOString(), digest: "a".repeat(64), text: "Check the AES50 cable." }],
  });
  await training.activateKnowledge(started.id, accepted.acceptedDigest!, renewed.source.indexedCommit);
  expect((await new PostgresTrainingSessionStore(database).activeGuidance()).map(item => item.path)).toEqual([artifactPath]);
  const unrelated = await sourceStore.refresh(actor.id, renewed.source, { fullName: source.fullName, url: source.url,
    report: { ...renewed.source.validationReport, checkedAt: new Date().toISOString(), commitSha: "d".repeat(40) },
    chunks: [{ chunkId: "manual:1", sourceId: source.fullName, title: "DL32", path: "docs/dl32.txt", locator: "1-10", authority: "Manual", capturedAt: new Date().toISOString(), digest: "a".repeat(64), text: "Check the AES50 cable." }],
  });
  expect((await training.activeGuidance()).map(item => item.indexedCommit)).toEqual([unrelated.source.indexedCommit]);
  const secondConversation = await new PostgresLearningRepository(database).createConversation(actor.id, "Training again");
  const second = await training.create({ trainerAccountId: actor.id, conversationId: secondConversation.id, targetRepository: source.fullName, originalQuestion: started.originalQuestion });
  const secondAnswerId = "00000000-0000-4000-8000-000000000014";
  const secondAnswer = await training.saveAnswer(second.id, actor.id, { id: secondAnswerId, directAnswer: "Inspect both AES50 connectors.", evidence: [{ id: "manual:1" }] });
  const secondAccepted = await training.acceptAnswer(second.id, actor.id, secondAnswer.version, secondAnswerId, unrelated.source);
  await database.execute(sql`update training_sessions set state='ACTIVATING',published_commit=${"b".repeat(40)} where id=${second.id}`);
  const secondRenewed = await sourceStore.refresh(actor.id, unrelated.source, { fullName: source.fullName, url: source.url,
    report: { ...unrelated.source.validationReport, checkedAt: new Date().toISOString(), commitSha: "c".repeat(40), acceptedArtifacts: [{ path: artifactPath, digest: accepted.acceptedDigest! }, { path: secondAccepted.acceptedPath!, digest: secondAccepted.acceptedDigest! }] },
    chunks: [{ chunkId: "manual:1", sourceId: source.fullName, title: "DL32", path: "docs/dl32.txt", locator: "1-10", authority: "Manual", capturedAt: new Date().toISOString(), digest: "a".repeat(64), text: "Check the AES50 cable." }],
  });
  await training.activateKnowledge(second.id, secondAccepted.acceptedDigest!, secondRenewed.source.indexedCommit);
  expect((await training.get(started.id, actor.id)).state).toBe("SUPERSEDED");
  expect((await training.activeGuidance()).map(item => item.path)).toEqual([secondAccepted.acceptedPath]);
  await sourceStore.refresh(actor.id, secondRenewed.source, { fullName: source.fullName, url: source.url, report: { ...secondRenewed.source.validationReport, commitSha: "e".repeat(40), acceptedArtifacts: [] }, chunks: [{ chunkId: "manual:1", sourceId: source.fullName, title: "DL32", path: "docs/dl32.txt", locator: "1-10", authority: "Manual", capturedAt: new Date().toISOString(), digest: "a".repeat(64), text: "Check the AES50 cable." }] });
  expect(await training.activeGuidance()).toEqual([]);
});

databaseTest("atomically refreshes large snapshots, rolls back failed inserts, and rejects concurrent writers", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "refresh-owner", email: "owner@example.com", displayName: "Owner" });
  const store = new PostgresSourceRepositoryStore(database);
  const source = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(sourceFiles("PointCommunity/test", "old evidence")) });
  const initial = await store.link(actor.id, source);
  const replacement = { ...source, report: { ...source.report, commitSha: "b".repeat(40), chunksIndexed: 7100 }, chunks: Array.from({ length: 7100 }, (_, i) => ({ ...source.chunks[0], chunkId: `new-${i}`, title: "New", text: "new evidence" })) };
  // Duplicate keys fail after deletion and the first batch; the whole transaction must roll back.
  await expect(store.refresh(actor.id, initial, { ...replacement, chunks: [...replacement.chunks, replacement.chunks[0]] })).rejects.toThrow();
  expect((await store.snapshot()).chunks).toEqual(source.chunks);
  expect((await store.list())[0].indexedCommit).toBe(source.report.commitSha);
  const reads: number[] = [];
  const write = store.refresh(actor.id, initial, replacement);
  for (let i = 0; i < 5; i++) reads.push((await store.snapshot()).chunks.length);
  await write;
  expect(reads.every(size => size === 1 || size === 7100)).toBe(true);
  expect((await store.snapshot()).chunks).toHaveLength(7100);
  await expect(store.refresh(actor.id, initial, source)).rejects.toThrow(/changed/i);
  const current = (await store.list())[0];
  const races = await Promise.allSettled([store.refresh(actor.id, current, replacement), store.refresh(actor.id, current, replacement)]);
  expect(races.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const latest = (await store.list())[0];
  await store.archive(actor.id, latest.id, latest.fullName);
  await expect(store.refresh(actor.id, latest, replacement)).rejects.toThrow(/changed/i);
  await store.refreshFailed(actor.id, latest.id, "SOURCE_CHANGED");
  expect((await store.snapshot()).chunks).toEqual([]);
  const audit = await database.execute(sql`select action, outcome from audit_events where target_id = ${latest.id} order by occurred_at`);
  expect(audit.some(row => row.action === "source_repository.refreshed" && row.outcome === "SUCCEEDED")).toBe(true);
  expect(audit.some(row => row.action === "source_repository.refresh_failed" && row.outcome === "FAILED")).toBe(true);
  await store.remove(actor.id, latest.id, latest.fullName);
  await expect(store.refresh(actor.id, latest, replacement)).rejects.toThrow(/changed/i);
});
