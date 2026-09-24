export type TrainingState = "ACTIVE" | "GENERATING" | "REVISING" | "PUBLISHING" | "ACTIVATING" | "ACTIVE_KNOWLEDGE" | "SUPERSEDED" | "FAILED" | "REPORT_READY" | "REPORT_ACCEPTED" | "PROPOSED";
export interface TrainingTurn { ordinal: number; kind: string; content: Readonly<Record<string, unknown>>; createdAt: string }
export interface TrainingReport { summary: string; learned: string[]; responseChanges: string[]; evidenceBoundary: string }
export type TrainingSourceKind = "FILE" | "URL";
export type TrainingSourceStatus = "PENDING" | "READY" | "FAILED";
export const trainingSourceAccept = ".md,.markdown,.txt,.rtf,.pdf,.doc,.docx,.html,.htm,.jpeg,.jpg,.png,.webp,.svg";
export interface TrainingSourceInput { kind: TrainingSourceKind; originalName: string; mediaType: string; sourceUrl?: string; originalBytes?: Uint8Array }
export interface TrainingSourceRecord {
  id: string; sessionId: string; kind: TrainingSourceKind; originalName: string; mediaType: string;
  sourceUrl: string | null; finalUrl: string | null; originalSize: number | null; originalDigest: string | null;
  extractedDigest: string | null; status: TrainingSourceStatus; error: string | null; capturedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface TrainingSourceContent extends TrainingSourceRecord { originalBytes: Uint8Array | null; extractedText: string | null }
export interface AcceptedTrainingSource {
  id: string; kind: TrainingSourceKind; originalName: string; mediaType: string; sourceUrl: string | null; finalUrl: string | null; capturedAt: string;
  originalPath: string; originalDigest: string; extractedPath: string; extractedDigest: string;
}
export interface TrainingSessionRecord {
  id: string; trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string;
  state: TrainingState; currentAnswer: Readonly<Record<string, unknown>> | null; currentReport: TrainingReport | null;
  proposalId: string | null; createdAt: string; updatedAt: string; version: number;
  acceptedContent?: string | null; acceptedDigest?: string | null; acceptedPath?: string | null; acceptedSourceVersion?: number | null;
  publishedCommit?: string | null; indexedCommit?: string | null; publicationError?: string | null;
  answerError?: string | null;
}
export interface TrainingSessionStore {
  create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }, queue?: boolean, sources?: TrainingSourceInput[]): Promise<TrainingSessionRecord>;
  list(trainerAccountId: string, query?: string): Promise<TrainingSessionRecord[]>;
  get(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  listTurns(id: string, trainerAccountId: string): Promise<TrainingTurn[]>;
  listSources(id: string, trainerAccountId: string): Promise<TrainingSourceRecord[]>;
  listSourceContents(id: string, trainerAccountId: string): Promise<TrainingSourceContent[]>;
  addSources(id: string, trainerAccountId: string, expectedVersion: number, sources: TrainingSourceInput[], queue?: boolean): Promise<TrainingSessionRecord>;
  removeSource(id: string, trainerAccountId: string, expectedVersion: number, sourceId: string, queue?: boolean): Promise<TrainingSessionRecord>;
  saveSource(source: TrainingSourceContent): Promise<void>;
  failSource(id: string, sessionId: string, message: string): Promise<void>;
  saveFeedback(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, feedback: string, queue?: boolean): Promise<TrainingSessionRecord>;
  saveClarification(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, response: string, queue?: boolean): Promise<TrainingSessionRecord>;
  retryAnswer(id: string, trainerAccountId: string, expectedVersion: number): Promise<TrainingSessionRecord>;
  acceptAnswer(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, source: import("@/lib/sources/types").SourceRepositoryRecord): Promise<TrainingSessionRecord>;
  retryPublication(id: string, trainerAccountId: string, source: import("@/lib/sources/types").SourceRepositoryRecord): Promise<TrainingSessionRecord>;
  activeGuidance(): Promise<import("./knowledge").AcceptedGuidance[]>;
  saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>, insight?: string): Promise<TrainingSessionRecord>;
  saveReport(id: string, trainerAccountId: string, rating: "HELPFUL" | "NOT_HELPFUL", explanation: string, report: TrainingReport): Promise<TrainingSessionRecord>;
  acceptReport(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  markProposed(id: string, trainerAccountId: string, proposalId: string): Promise<TrainingSessionRecord>;
  wipe(id: string, trainerAccountId: string): Promise<void>;
}
