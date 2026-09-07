import type { IndexedChunk } from "@/lib/evidence/search";

export type SourceStatus = "ACTIVE" | "ARCHIVED";
export interface SourceValidationReport {
  valid: boolean;
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
  list(): Promise<SourceRepositoryRecord[]>;
  link(actorId: string, source: ValidatedSource): Promise<SourceRepositoryRecord>;
  archive(actorId: string, id: string, confirmation: string): Promise<SourceRepositoryRecord>;
  remove(actorId: string, id: string, confirmation: string): Promise<void>;
  activeChunks(): Promise<IndexedChunk[]>;
}
