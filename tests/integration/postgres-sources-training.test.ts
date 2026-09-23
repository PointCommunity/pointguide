import { sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";
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

databaseTest("queues first answers and revisions atomically, with saved feedback and bounded retry", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "queued-owner", email: "queued@example.com", displayName: "Owner" });
  const conversation = await new PostgresLearningRepository(database).createConversation(actor.id, "Queued training test");
  const store = new PostgresTrainingSessionStore(database);
  const started = await store.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I route a channel?" }, true, [{ kind: "FILE", originalName: "routing.txt", mediaType: "text/plain", originalBytes: Buffer.from("Route channel 1 to bus 2.") }]);
  expect(started).toMatchObject({ state: "GENERATING", currentAnswer: null, answerError: null });
  const [firstJob] = await database.execute(sql`select payload from jobs where kind='GENERATE_TRAINING_ANSWER' and payload->>'sessionId'=${started.id}`);
  expect(firstJob.payload).toMatchObject({ sessionId: started.id, version: started.version });
  await store.failAnswer(started.id, started.version, "The first answer failed. Your question is saved. Retry the first answer.");
  const failed = await store.get(started.id, actor.id);
  expect(failed).toMatchObject({ state: "ACTIVE", currentAnswer: null, answerError: expect.stringContaining("Retry") });
  const retried = await store.retryAnswer(started.id, actor.id, failed.version);
  expect(retried).toMatchObject({ state: "GENERATING", answerError: null });
  await expect(store.retryAnswer(started.id, actor.id, retried.version)).rejects.toThrow(/Reload/u);
  const answerId = "00000000-0000-4000-8000-000000000099";
  const answered = await store.saveAnswer(started.id, actor.id, { id: answerId, directAnswer: "Check the documented route." }, undefined, retried.version);
  const revising = await store.saveFeedback(started.id, actor.id, answered.version, answerId, "Clarify the exact bus.", true);
  expect(revising).toMatchObject({ state: "REVISING", answerError: null, currentAnswer: { id: answerId } });
  expect((await store.listTurns(started.id, actor.id)).map(turn => turn.kind)).toEqual(["ANSWER", "FEEDBACK"]);
  const queued = await database.execute(sql`select payload from jobs where kind='GENERATE_TRAINING_ANSWER' and payload->>'sessionId'=${started.id} order by created_at desc limit 1`);
  expect(queued[0].payload).toMatchObject({ version: revising.version });
  await store.failAnswer(started.id, revising.version, "The revision failed. Your feedback is saved. Retry this revision.");
  const failedRevision = await store.get(started.id, actor.id);
  expect(failedRevision).toMatchObject({ state: "REVISING", answerError: expect.stringContaining("Retry this revision") });
  const [failedSource] = await store.listSources(started.id, actor.id);
  await store.failSource(failedSource.id, started.id, "This source could not be prepared.");
  await expect(store.removeSource(started.id, actor.id, failedRevision.version, failedSource.id)).resolves.toMatchObject({ state: "REVISING", answerError: null });
  expect(await store.listSources(started.id, actor.id)).toEqual([]);
});

databaseTest("worker completes a queued answer without holding the start request open", async () => {
  const url = disposableDatabaseUrl(testDatabaseUrl as string);
  const database = getDatabase(url);
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`truncate table jobs`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "worker-owner", email: "worker@example.com", displayName: "Owner" });
  const conversation = await new PostgresLearningRepository(database).createConversation(actor.id, "Worker training test");
  const store = new PostgresTrainingSessionStore(database);
  const pending = await store.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: "PointCommunity/pointaudio", originalQuestion: "Which bus is this?" }, true, [{ kind: "FILE", originalName: "routing.txt", mediaType: "text/plain", originalBytes: Buffer.from("Route channel 1 to bus 2 using sends on fader.") }]);
  execFileSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/worker.ts"], { env: { ...process.env, DATABASE_URL: url, WORKER_ONCE: "true", AUTH_MODE: "fixture", NODE_ENV: "test" }, timeout: 30_000 });
  const completed = await store.get(pending.id, actor.id);
  expect(completed).toMatchObject({ state: "ACTIVE", answerError: null, currentAnswer: { evidence: [expect.objectContaining({ kind: "TRAINER_SOURCE", title: "routing.txt" })] } });
  expect(await store.listSources(pending.id, actor.id)).toEqual([expect.objectContaining({ originalName: "routing.txt", status: "READY", extractedDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) })]);
  expect((await store.listTurns(pending.id, actor.id)).map(turn => turn.kind)).toEqual(["ANSWER"]);
  const [job] = await database.execute(sql`select status from jobs where payload->>'sessionId'=${pending.id}`);
  expect(job.status).toBe("SUCCEEDED");
}, 40_000);

databaseTest("worker prepares later material when an earlier source fails", async () => {
  const url = disposableDatabaseUrl(testDatabaseUrl as string);
  const database = getDatabase(url);
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`truncate table jobs`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "source-failure-owner", email: "source-failure@example.com", displayName: "Owner" });
  const conversation = await new PostgresLearningRepository(database).createConversation(actor.id, "Source failure test");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Route channel 1 to bus 2.", { font });
  const store = new PostgresTrainingSessionStore(database);
  const session = await store.create({ trainerAccountId: actor.id, conversationId: conversation.id, targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do I route a channel?" }, true, [
    { kind: "URL", originalName: "blocked", mediaType: "text/html", sourceUrl: "http://127.0.0.1/" },
    { kind: "FILE", originalName: "routing.pdf", mediaType: "application/pdf", originalBytes: Buffer.from(await pdf.save()) },
  ]);
  const runWorker = () => execFileSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "scripts/worker.ts"], { env: { ...process.env, DATABASE_URL: url, WORKER_ONCE: "true", AUTH_MODE: "fixture", NODE_ENV: "test" }, timeout: 40_000 });
  runWorker();
  const [failedUrl, readyPdf] = await store.listSources(session.id, actor.id);
  expect(failedUrl).toMatchObject({ kind: "URL", status: "FAILED" });
  expect(readyPdf).toMatchObject({ originalName: "routing.pdf", status: "READY", extractedDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  const failed = await store.get(session.id, actor.id);
  expect(failed).toMatchObject({ state: "ACTIVE", answerError: expect.stringContaining("trainer sources") });
  await store.removeSource(session.id, actor.id, failed.version, failedUrl!.id, true);
  runWorker();
  expect(await store.get(session.id, actor.id)).toMatchObject({ state: "ACTIVE", answerError: null, currentAnswer: { evidence: [expect.objectContaining({ kind: "TRAINER_SOURCE", title: "routing.pdf" })] } });
}, 90_000);

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

databaseTest("coalesces concurrent identical refreshes without overwriting a different snapshot", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`); await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "refresh-race-owner", email: "refresh@example.com", displayName: "Owner" });
  const validated = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(sourceFiles()) });
  const store = new PostgresSourceRepositoryStore(database); const linked = await store.link(actor.id, validated);
  const results = await Promise.all([store.refresh(actor.id, linked, validated), store.refresh(actor.id, linked, validated)]);
  expect(results.map(result => result.outcome)).toEqual(["current", "current"]);
  const [current] = await store.list(); expect(current.version).toBe(linked.version + 1);
  await expect(store.refresh(actor.id, linked, { ...validated, report: { ...validated.report, commitSha: "b".repeat(40) } })).rejects.toThrow(/changed during refresh/i);
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
  const manualEvidence = { id: "manual:1", kind: "REPOSITORY", title: "DL32", path: "docs/dl32.txt", locator: "1-10", authority: "Manual", capturedAt: "2026-09-22T00:00:00.000Z", excerpt: "Check the AES50 cable.", digest: "a".repeat(64) };
  const completed = await training.saveAnswer(started.id, actor.id, { id: answerId, directAnswer: "Check the AES50 cable.", evidence: [manualEvidence], claims: [{ id: "claim:1", text: "Check the AES50 cable.", status: "SUPPORTED", evidenceIds: ["manual:1"] }] });
  const actions = await Promise.allSettled([
    training.saveFeedback(started.id, actor.id, completed.version, answerId, "Check the connection first."),
    training.acceptAnswer(started.id, actor.id, completed.version, answerId, source),
  ]);
  expect(actions.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const current = await training.get(started.id, actor.id);
  expect((await training.listTurns(started.id, actor.id)).map(turn => turn.kind)).toEqual(["ANSWER", current.state === "REVISING" ? "FEEDBACK" : "ACCEPT_ANSWER"]);
  if (current.state === "REVISING") {
    const revised = await training.saveAnswer(started.id, actor.id, { id: "00000000-0000-4000-8000-000000000013", directAnswer: "Check the connection first.", evidence: [manualEvidence] });
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
  const secondAnswer = await training.saveAnswer(second.id, actor.id, { id: secondAnswerId, directAnswer: "Inspect both AES50 connectors.", evidence: [manualEvidence] });
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
  expect(races.filter(result => result.status === "fulfilled")).toHaveLength(2);
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
