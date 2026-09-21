export type TrainingState = "ACTIVE" | "REVISING" | "PUBLISHING" | "ACTIVATING" | "ACTIVE_KNOWLEDGE" | "SUPERSEDED" | "FAILED" | "REPORT_READY" | "REPORT_ACCEPTED" | "PROPOSED";
export interface TrainingTurn { ordinal: number; kind: string; content: Readonly<Record<string, unknown>>; createdAt: string }
export interface TrainingReport { summary: string; learned: string[]; responseChanges: string[]; evidenceBoundary: string }
export interface TrainingSessionRecord {
  id: string; trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string;
  state: TrainingState; currentAnswer: Readonly<Record<string, unknown>> | null; currentReport: TrainingReport | null;
  proposalId: string | null; createdAt: string; updatedAt: string; version: number;
  acceptedContent?: string | null; acceptedDigest?: string | null; acceptedPath?: string | null; acceptedSourceVersion?: number | null;
  publishedCommit?: string | null; indexedCommit?: string | null; publicationError?: string | null;
}
export interface TrainingSessionStore {
  create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }): Promise<TrainingSessionRecord>;
  list(trainerAccountId: string, query?: string): Promise<TrainingSessionRecord[]>;
  get(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  listTurns(id: string, trainerAccountId: string): Promise<TrainingTurn[]>;
  saveFeedback(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, feedback: string): Promise<TrainingSessionRecord>;
  saveClarification(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, response: string): Promise<TrainingSessionRecord>;
  acceptAnswer(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, source: import("@/lib/sources/types").SourceRepositoryRecord): Promise<TrainingSessionRecord>;
  retryPublication(id: string, trainerAccountId: string, source: import("@/lib/sources/types").SourceRepositoryRecord): Promise<TrainingSessionRecord>;
  activeGuidance(): Promise<import("./knowledge").AcceptedGuidance[]>;
  saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>, insight?: string): Promise<TrainingSessionRecord>;
  saveReport(id: string, trainerAccountId: string, rating: "HELPFUL" | "NOT_HELPFUL", explanation: string, report: TrainingReport): Promise<TrainingSessionRecord>;
  acceptReport(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  markProposed(id: string, trainerAccountId: string, proposalId: string): Promise<TrainingSessionRecord>;
  wipe(id: string, trainerAccountId: string): Promise<void>;
}
