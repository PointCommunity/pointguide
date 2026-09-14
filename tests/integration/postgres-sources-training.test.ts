import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDatabase } from "@/db/client";
import { PostgresAccountStore } from "@/db/accounts";
import { PostgresLearningRepository } from "@/lib/learning/store";
import { PostgresSourceRepositoryStore } from "@/db/sources";
import { PostgresTrainingSessionStore } from "@/db/training";
import { answerQuestion } from "@/lib/agent/service";
import { MemoryProviderStore } from "@/lib/providers/memory-store";

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
  const linked = await sources.link(actor.id, {
    fullName: "PointCommunity/lighting",
    url: "https://github.com/PointCommunity/lighting",
    report: {
      valid: true,
      checkedAt: "2026-09-06T00:00:00.000Z",
      commitSha: "a".repeat(40),
      defaultBranch: "main",
      errors: [],
      warnings: [],
      filesReviewed: 3,
      filesIndexed: 1,
      chunksIndexed: 1,
      requirements: { agentsFile: true, evidenceContent: true, integrityManifest: true },
    },
    chunks: [{
      chunkId: "lighting:setup:0",
      sourceId: "PointCommunity/lighting",
      title: "Setup",
      path: "docs/setup.md",
      locator: "Characters 1-20",
      authority: "Linked repository",
      capturedAt: "2026-09-06T00:00:00.000Z",
      digest: "b".repeat(64),
      text: "Verified setup steps.",
    }],
  });
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

databaseTest("atomically refreshes large snapshots, rolls back failed inserts, and rejects concurrent writers", async () => {
  const database = getDatabase(disposableDatabaseUrl(testDatabaseUrl as string));
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "refresh-owner", email: "owner@example.com", displayName: "Owner" });
  const store = new PostgresSourceRepositoryStore(database);
  const source = { fullName: "PointCommunity/test", url: "https://github.com/PointCommunity/test", report: { valid: true, complete: true, checkedAt: new Date().toISOString(), commitSha: "a".repeat(40), defaultBranch: "main", errors: [], warnings: [], filesReviewed: 1, filesIndexed: 1, chunksIndexed: 1, requirements: { agentsFile: true, evidenceContent: true, integrityManifest: true } }, chunks: [{ chunkId: "old", sourceId: "test", title: "Old", path: "docs/old.txt", locator: "Old commit", authority: "Repository", capturedAt: new Date().toISOString(), digest: "a".repeat(64), text: "old evidence" }] };
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
