import type { IndexedChunk } from "@/lib/evidence/search";

export type SourceStatus = "ACTIVE" | "ARCHIVED";
export interface SourceValidationReport {
  valid: boolean;
  complete?: boolean;
  bytesIndexed?: number;
  checksumsVerified?: number;
  files?: string[];
  checkedAt: string;
  commitSha: string;
  defaultBranch: string;
  errors: string[];
  warnings: string[];
  filesReviewed: number;
  filesIndexed: number;
  chunksIndexed: number;
  requirements: { agentsFile: boolean; evidenceContent: boolean; integrityManifest: boolean };
}
export interface SourceRepositoryRecord {
  id: string; fullName: string; url: string; status: SourceStatus; defaultBranch: string; indexedCommit: string;
  validationReport: SourceValidationReport; linkedAt: string; updatedAt: string; version: number;
}
export interface ValidatedSource { fullName: string; url: string; report: SourceValidationReport; chunks: IndexedChunk[] }

export interface SourceRepositoryStore {
  snapshot(): Promise<{ sources: SourceRepositoryRecord[]; chunks: IndexedChunk[] }>;
  refresh(actorId: string, expected: SourceRepositoryRecord, source: ValidatedSource): Promise<{ source: SourceRepositoryRecord; outcome: "updated" | "current" }>;
  refreshFailed(actorId: string, id: string, reason: string): Promise<void>;
  list(): Promise<SourceRepositoryRecord[]>;
  link(actorId: string, source: ValidatedSource): Promise<SourceRepositoryRecord>;
  archive(actorId: string, id: string, confirmation: string): Promise<SourceRepositoryRecord>;
  remove(actorId: string, id: string, confirmation: string): Promise<void>;
  activeChunks(): Promise<IndexedChunk[]>;
}
