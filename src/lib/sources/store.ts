import { randomUUID } from "node:crypto";
import type { IndexedChunk } from "@/lib/evidence/search";
import type { SourceRepositoryRecord, SourceRepositoryStore, ValidatedSource } from "./types";

export class SourceStoreError extends Error {
  constructor(public readonly code: "SOURCE_EXISTS" | "SOURCE_NOT_FOUND" | "CONFIRMATION_REQUIRED" | "ARCHIVE_REQUIRED", message: string) { super(message); }
}

function copy(record: SourceRepositoryRecord): SourceRepositoryRecord { return { ...record, validationReport: { ...record.validationReport, errors: [...record.validationReport.errors], warnings: [...record.validationReport.warnings], requirements: { ...record.validationReport.requirements } } }; }

export class MemorySourceRepositoryStore implements SourceRepositoryStore {
  private readonly records = new Map<string, SourceRepositoryRecord>();
  private readonly chunks = new Map<string, IndexedChunk[]>();
  constructor(seed = true) {
    if (seed) {
      const now = new Date().toISOString();
      const record: SourceRepositoryRecord = { id: "00000000-0000-4000-8000-000000000010", fullName: "PointCommunity/pointaudio", url: "https://github.com/PointCommunity/pointaudio", status: "ACTIVE", defaultBranch: "main", indexedCommit: "fixture", validationReport: { valid: true, checkedAt: now, commitSha: "fixture", defaultBranch: "main", errors: [], warnings: [], filesReviewed: 41, filesIndexed: 20, chunksIndexed: 20, requirements: { agentsFile: true, evidenceContent: true, integrityManifest: true } }, linkedAt: now, updatedAt: now, version: 1 };
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
