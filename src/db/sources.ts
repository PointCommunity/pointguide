import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { auditEvents, sourceChunks, sourceRepositories } from "@/db/schema";
import { assertRefresh, snapshotMatches, SourceStoreError } from "@/lib/sources/store";
import type { SourceRepositoryRecord, SourceRepositoryStore, ValidatedSource } from "@/lib/sources/types";

function fromRow(row: typeof sourceRepositories.$inferSelect): SourceRepositoryRecord { return { id: row.id, fullName: row.fullName, url: row.url, status: row.status as SourceRepositoryRecord["status"], defaultBranch: row.defaultBranch, indexedCommit: row.indexedCommit, validationReport: row.validationReport as unknown as SourceRepositoryRecord["validationReport"], linkedAt: row.linkedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version }; }
const fromChunk = (chunk: typeof sourceChunks.$inferSelect) => ({ chunkId: chunk.chunkId, sourceId: chunk.sourceId, title: chunk.title, path: chunk.path, locator: chunk.locator, authority: chunk.authority, capturedAt: chunk.capturedAt.toISOString(), digest: chunk.digest, text: chunk.content });
type Transaction = Parameters<Parameters<PointGuideDatabase["transaction"]>[0]>[0];
async function insertChunks(transaction: Transaction, id: string, source: ValidatedSource) {
  // PostgreSQL limits parameters per statement; each batch is well below that limit.
  for (let start = 0; start < source.chunks.length; start += 500) await transaction.insert(sourceChunks).values(source.chunks.slice(start, start + 500).map(chunk => ({ repositoryId: id, chunkId: chunk.chunkId, sourceId: chunk.sourceId, title: chunk.title, path: chunk.path, locator: chunk.locator, authority: chunk.authority, capturedAt: new Date(chunk.capturedAt), digest: chunk.digest, content: chunk.text })));
}
export class PostgresSourceRepositoryStore implements SourceRepositoryStore {
  constructor(private readonly database: PointGuideDatabase, private readonly builtinCommit?: string) {}
  private async syncBuiltin() {
    if (!this.builtinCommit) return;
    const [current] = await this.database.select().from(sourceRepositories).where(eq(sourceRepositories.fullName, "PointCommunity/pointaudio")).limit(1);
    if (current?.indexedCommit !== "configured-at-runtime") return;
    const report = { ...(current.validationReport as Readonly<Record<string, unknown>>), commitSha: this.builtinCommit };
    await this.database.update(sourceRepositories).set({ indexedCommit: this.builtinCommit, validationReport: report, updatedAt: new Date(), version: current.version + 1 }).where(and(eq(sourceRepositories.id, current.id), eq(sourceRepositories.version, current.version)));
  }
  async list() { await this.syncBuiltin(); return (await this.database.select().from(sourceRepositories).orderBy(asc(sourceRepositories.fullName))).map(fromRow); }
  async snapshot() {
    await this.syncBuiltin();
    return this.database.transaction(async transaction => {
      const sources = (await transaction.select().from(sourceRepositories).orderBy(asc(sourceRepositories.fullName))).map(fromRow);
      const rows = await transaction.select({ chunk: sourceChunks }).from(sourceChunks).innerJoin(sourceRepositories, eq(sourceChunks.repositoryId, sourceRepositories.id)).where(eq(sourceRepositories.status, "ACTIVE"));
      return { sources, chunks: rows.map(({ chunk }) => fromChunk(chunk)) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
  async activeChunks() { return (await this.snapshot()).chunks; }
  async refresh(actorId: string, expected: SourceRepositoryRecord, source: ValidatedSource) {
    return this.database.transaction(async transaction => {
      const [current] = await transaction.select().from(sourceRepositories).where(eq(sourceRepositories.id, expected.id)).for("update");
      assertRefresh(current ? fromRow(current) : undefined, expected, source);
      const old = await transaction.select().from(sourceChunks).where(eq(sourceChunks.repositoryId, expected.id));
      const outcome = snapshotMatches(fromRow(current!), old.map(fromChunk), source) ? "current" : "updated";
      const [row] = await transaction.update(sourceRepositories).set({ defaultBranch: source.report.defaultBranch, indexedCommit: source.report.commitSha, validationReport: source.report as unknown as Readonly<Record<string, unknown>>, updatedAt: new Date(), version: expected.version + 1 }).where(eq(sourceRepositories.id, expected.id)).returning();
      if (outcome === "updated") {
        await transaction.delete(sourceChunks).where(eq(sourceChunks.repositoryId, expected.id));
        await insertChunks(transaction, expected.id, source);
      }
      await transaction.insert(auditEvents).values({ id: randomUUID(), actorId, action: "source_repository.refreshed", targetType: "source_repository", targetId: expected.id, outcome: "SUCCEEDED", metadata: { previousCommit: expected.indexedCommit, commit: source.report.commitSha, result: outcome, chunks: source.chunks.length }, occurredAt: new Date() });
      return { source: fromRow(row!), outcome } as const;
    });
  }
  async refreshFailed(actorId: string, id: string, reason: string) { await this.database.insert(auditEvents).values({ id: randomUUID(), actorId, action: "source_repository.refresh_failed", targetType: "source_repository", targetId: id, outcome: "FAILED", metadata: { reason }, occurredAt: new Date() }); }
  async link(actorId: string, source: ValidatedSource) {
    const existing = await this.database.select({ id: sourceRepositories.id }).from(sourceRepositories).where(eq(sourceRepositories.fullName, source.fullName)).limit(1);
    if (existing.length) throw new SourceStoreError("SOURCE_EXISTS", "That repository is already linked.");
    return this.database.transaction(async transaction => {
      const now = new Date(); const id = randomUUID();
      const [row] = await transaction.insert(sourceRepositories).values({ id, fullName: source.fullName, url: source.url, status: "ACTIVE", defaultBranch: source.report.defaultBranch, indexedCommit: source.report.commitSha, validationReport: source.report as unknown as Readonly<Record<string, unknown>>, linkedBy: actorId, linkedAt: now, updatedAt: now, version: 1 }).returning();
      await insertChunks(transaction, id, source);
      await transaction.insert(auditEvents).values({ id: randomUUID(), actorId, action: "source_repository.linked", targetType: "source_repository", targetId: id, outcome: "SUCCEEDED", metadata: { fullName: source.fullName, commit: source.report.commitSha, chunks: source.chunks.length }, occurredAt: now });
      return fromRow(row!);
    });
  }
  private async required(transaction: Transaction, id: string) { const [row] = await transaction.select().from(sourceRepositories).where(eq(sourceRepositories.id, id)).for("update"); if (!row) throw new SourceStoreError("SOURCE_NOT_FOUND", "Source repository was not found."); return row; }
  async archive(actorId: string, id: string, confirmation: string) {
    return this.database.transaction(async transaction => {
      const current = await this.required(transaction, id);
      if (confirmation !== current.fullName) throw new SourceStoreError("CONFIRMATION_REQUIRED", `Type ${current.fullName} to confirm archival.`);
      const [row] = await transaction.update(sourceRepositories).set({ status: "ARCHIVED", updatedAt: new Date(), version: sql`${sourceRepositories.version} + 1` }).where(eq(sourceRepositories.id, id)).returning();
      await transaction.insert(auditEvents).values({ id: randomUUID(), actorId, action: "source_repository.archived", targetType: "source_repository", targetId: id, outcome: "SUCCEEDED", metadata: { fullName: current.fullName }, occurredAt: new Date() }); return fromRow(row!);
    });
  }
  async remove(actorId: string, id: string, confirmation: string) {
    await this.database.transaction(async transaction => {
      const current = await this.required(transaction, id);
      if (current.status !== "ARCHIVED") throw new SourceStoreError("ARCHIVE_REQUIRED", "Archive the repository before deleting it.");
      if (confirmation !== current.fullName) throw new SourceStoreError("CONFIRMATION_REQUIRED", `Type ${current.fullName} to confirm deletion.`);
      await transaction.delete(sourceRepositories).where(eq(sourceRepositories.id, id));
      await transaction.insert(auditEvents).values({ id: randomUUID(), actorId, action: "source_repository.deleted", targetType: "source_repository", targetId: id, outcome: "SUCCEEDED", metadata: { fullName: current.fullName }, occurredAt: new Date() });
    });
  }
}
