import { randomUUID } from "node:crypto";
import type { IndexedChunk } from "@/lib/evidence/search";
import type { SourceRepositoryRecord, SourceRepositoryStore, ValidatedSource } from "./types";

export class SourceStoreError extends Error {
  constructor(public readonly code: "SOURCE_EXISTS" | "SOURCE_NOT_FOUND" | "CONFIRMATION_REQUIRED" | "ARCHIVE_REQUIRED" | "SOURCE_CHANGED", message: string) { super(message); }
}

function copy(record: SourceRepositoryRecord): SourceRepositoryRecord { return { ...record, validationReport: { ...record.validationReport, errors: [...record.validationReport.errors], warnings: [...record.validationReport.warnings], requirements: { ...record.validationReport.requirements } } }; }

export class MemorySourceRepositoryStore implements SourceRepositoryStore {
  async refreshFailed(_actorId: string, _id: string, _reason: string) { void _actorId; void _id; void _reason; }
  async snapshot() { return { sources: [...this.records.values()].map(copy), chunks: [...this.records.values()].filter(record => record.status === "ACTIVE").flatMap(record => this.chunks.get(record.id) ?? []).map(item => ({ ...item })) }; }
  async refresh(_actorId: string, expected: SourceRepositoryRecord, source: ValidatedSource) {
    const current = this.records.get(expected.id);
    assertRefresh(current, expected, source);
    const outcome = snapshotMatches(current!, this.chunks.get(expected.id) ?? [], source) ? "current" : "updated";
    const updated = { ...current!, indexedCommit: source.report.commitSha, defaultBranch: source.report.defaultBranch, validationReport: source.report, updatedAt: new Date().toISOString(), version: current!.version + 1 };
    this.records.set(expected.id, updated); this.chunks.set(expected.id, structuredClone(source.chunks));
    return { source: copy(updated), outcome } as const;
  }
  private readonly records = new Map<string, SourceRepositoryRecord>();
  private readonly chunks = new Map<string, IndexedChunk[]>();
  constructor(seed = true) {
    if (seed) {
      const now = new Date().toISOString();
      const record: SourceRepositoryRecord = { id: "00000000-0000-4000-8000-000000000010", fullName: "PointCommunity/pointaudio", url: "https://github.com/PointCommunity/pointaudio", status: "ACTIVE", defaultBranch: "main", indexedCommit: "a".repeat(40), validationReport: { valid: true, checkedAt: now, commitSha: "a".repeat(40), defaultBranch: "main", errors: [], warnings: [], filesReviewed: 41, filesIndexed: 20, chunksIndexed: 20, requirements: { agentsFile: true, evidenceContent: true, integrityManifest: true } }, linkedAt: now, updatedAt: now, version: 1 };
      this.records.set(record.id, record); this.chunks.set(record.id, []);
    }
  }
  async list() { return [...this.records.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)).map(copy); }
  async link(_actorId: string, source: ValidatedSource) {
    if ([...this.records.values()].some((item) => item.fullName.toLocaleLowerCase() === source.fullName.toLocaleLowerCase())) throw new SourceStoreError("SOURCE_EXISTS", "That repository is already linked.");
    const now = new Date().toISOString();
    const record: SourceRepositoryRecord = { id: randomUUID(), fullName: source.fullName, url: source.url, status: "ACTIVE", defaultBranch: source.report.defaultBranch, indexedCommit: source.report.commitSha, validationReport: source.report, linkedAt: now, updatedAt: now, version: 1 };
    this.records.set(record.id, record); this.chunks.set(record.id, source.chunks.map((item) => ({ ...item })));
    return copy(record);
  }
  async archive(_actorId: string, id: string, confirmation: string) {
    const record = this.records.get(id); if (!record) throw new SourceStoreError("SOURCE_NOT_FOUND", "Source repository was not found.");
    if (confirmation !== record.fullName) throw new SourceStoreError("CONFIRMATION_REQUIRED", `Type ${record.fullName} to confirm archival.`);
    const updated = { ...record, status: "ARCHIVED" as const, updatedAt: new Date().toISOString(), version: record.version + 1 };
    this.records.set(id, updated); return copy(updated);
  }
  async remove(_actorId: string, id: string, confirmation: string) {
    const record = this.records.get(id); if (!record) throw new SourceStoreError("SOURCE_NOT_FOUND", "Source repository was not found.");
    if (record.status !== "ARCHIVED") throw new SourceStoreError("ARCHIVE_REQUIRED", "Archive the repository before deleting it.");
    if (confirmation !== record.fullName) throw new SourceStoreError("CONFIRMATION_REQUIRED", `Type ${record.fullName} to confirm deletion.`);
    this.records.delete(id); this.chunks.delete(id);
  }
  async activeChunks() { return [...this.records.values()].filter((record) => record.status === "ACTIVE").flatMap((record) => this.chunks.get(record.id) ?? []).map((item) => ({ ...item })); }
}

export function assertRefresh(current: SourceRepositoryRecord | undefined, expected: SourceRepositoryRecord, source: ValidatedSource) {
  if (!current || current.status !== "ACTIVE" || current.version !== expected.version || current.fullName !== source.fullName) throw new SourceStoreError("SOURCE_CHANGED", "Repository changed during refresh. Pull latest knowledge again.");
  if (!source.report.valid || !source.report.complete || !source.chunks.length) throw new Error("A complete validated snapshot is required.");
}

export function snapshotMatches(current: SourceRepositoryRecord, chunks: IndexedChunk[], source: ValidatedSource) {
  const fingerprint = (items: IndexedChunk[]) => JSON.stringify(items.map(item => [item.chunkId, item.digest, item.text, item.locator, item.sourceId, item.title, item.authority]).sort((a, b) => a[0].localeCompare(b[0])));
  return current.indexedCommit === source.report.commitSha && current.validationReport.complete === true && fingerprint(chunks) === fingerprint(source.chunks);
}
