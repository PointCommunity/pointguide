import { randomUUID } from "node:crypto";
import type { TrainingReport, TrainingSessionRecord, TrainingSessionStore, TrainingState } from "./types";

export class TrainingStateError extends Error { constructor(public readonly code: "TRAINING_NOT_FOUND" | "INVALID_TRAINING_STATE", message: string) { super(message); } }
function copy(value: TrainingSessionRecord): TrainingSessionRecord { return { ...value, currentAnswer: value.currentAnswer ? { ...value.currentAnswer } : null, currentReport: value.currentReport ? { ...value.currentReport, learned: [...value.currentReport.learned], responseChanges: [...value.currentReport.responseChanges] } : null }; }

export class MemoryTrainingSessionStore implements TrainingSessionStore {
  private readonly values = new Map<string, TrainingSessionRecord>(); private readonly turns = new Map<string, number>();
  async create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }) { const now = new Date().toISOString(); const value: TrainingSessionRecord = { id: randomUUID(), ...input, state: "ACTIVE", currentAnswer: null, currentReport: null, proposalId: null, createdAt: now, updatedAt: now, version: 1 }; this.values.set(value.id, value); this.turns.set(value.id, 0); return copy(value); }
  async list(trainerAccountId: string, query = "") {
    const normalized = query.trim().toLocaleLowerCase();
    return [...this.values.values()]
      .filter((value) => value.trainerAccountId === trainerAccountId)
      .filter((value) => !normalized || [value.originalQuestion, value.targetRepository, JSON.stringify(value.currentAnswer), JSON.stringify(value.currentReport)].join(" ").toLocaleLowerCase().includes(normalized))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 50)
      .map(copy);
  }
  async get(id: string, trainerAccountId: string) { const value = this.values.get(id); if (!value || value.trainerAccountId !== trainerAccountId) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); return copy(value); }
  private update(id: string, trainerAccountId: string, expected: TrainingState[], patch: Partial<TrainingSessionRecord>) { const current = this.values.get(id); if (!current || current.trainerAccountId !== trainerAccountId) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); if (!expected.includes(current.state)) throw new TrainingStateError("INVALID_TRAINING_STATE", "That action is not available in the current training state."); const value = { ...current, ...patch, updatedAt: new Date().toISOString(), version: current.version + 1 }; this.values.set(id, value); this.turns.set(id, (this.turns.get(id) ?? 0) + 1); return copy(value); }
  async saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>) { return this.update(id, trainerAccountId, ["ACTIVE", "REPORT_READY"], { currentAnswer: answer, currentReport: null, state: "ACTIVE" }); }
  async saveReport(id: string, trainerAccountId: string, _rating: "HELPFUL" | "NOT_HELPFUL", _explanation: string, report: TrainingReport) { return this.update(id, trainerAccountId, ["ACTIVE"], { currentReport: report, state: "REPORT_READY" }); }
  async acceptReport(id: string, trainerAccountId: string) { return this.update(id, trainerAccountId, ["REPORT_READY"], { state: "REPORT_ACCEPTED" }); }
  async markProposed(id: string, trainerAccountId: string, proposalId: string) { return this.update(id, trainerAccountId, ["REPORT_ACCEPTED"], { state: "PROPOSED", proposalId }); }
  async wipe(id: string, trainerAccountId: string) { await this.get(id, trainerAccountId); this.values.delete(id); this.turns.delete(id); }
}
