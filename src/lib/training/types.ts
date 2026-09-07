export type TrainingState = "ACTIVE" | "REPORT_READY" | "REPORT_ACCEPTED" | "PROPOSED";
export interface TrainingReport { summary: string; learned: string[]; responseChanges: string[]; evidenceBoundary: string }
export interface TrainingSessionRecord {
  id: string; trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string;
  state: TrainingState; currentAnswer: Readonly<Record<string, unknown>> | null; currentReport: TrainingReport | null;
  proposalId: string | null; createdAt: string; updatedAt: string; version: number;
}
export interface TrainingSessionStore {
  create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }): Promise<TrainingSessionRecord>;
  list(trainerAccountId: string): Promise<TrainingSessionRecord[]>;
  get(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>, insight?: string): Promise<TrainingSessionRecord>;
  saveReport(id: string, trainerAccountId: string, rating: "HELPFUL" | "NOT_HELPFUL", explanation: string, report: TrainingReport): Promise<TrainingSessionRecord>;
  acceptReport(id: string, trainerAccountId: string): Promise<TrainingSessionRecord>;
  markProposed(id: string, trainerAccountId: string, proposalId: string): Promise<TrainingSessionRecord>;
  wipe(id: string, trainerAccountId: string): Promise<void>;
}
