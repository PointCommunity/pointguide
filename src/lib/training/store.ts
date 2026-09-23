import { randomUUID } from "node:crypto";
import type { TrainingReport, TrainingSessionRecord, TrainingSessionStore, TrainingSourceContent, TrainingSourceInput, TrainingSourceRecord, TrainingState, TrainingTurn } from "./types";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import { acceptedTrainingArtifact, hasEssentialClarification } from "./artifact";
import { contentDigest } from "@/lib/git/proposals";
import { acceptedGuidanceFromSession } from "./knowledge";
import { assertTrainingSourceCapacity, newTrainingSource } from "./sources";

export class TrainingStateError extends Error { constructor(public readonly code: "TRAINING_NOT_FOUND" | "INVALID_TRAINING_STATE", message: string) { super(message); } }
function copy(value: TrainingSessionRecord): TrainingSessionRecord { return { ...value, currentAnswer: value.currentAnswer ? { ...value.currentAnswer } : null, currentReport: value.currentReport ? { ...value.currentReport, learned: [...value.currentReport.learned], responseChanges: [...value.currentReport.responseChanges] } : null }; }

export class MemoryTrainingSessionStore implements TrainingSessionStore {
  private readonly values = new Map<string, TrainingSessionRecord>(); private readonly turns = new Map<string, TrainingTurn[]>(); private readonly sources = new Map<string, TrainingSourceContent[]>();
  async create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }, queue = false, sources: TrainingSourceInput[] = []) { assertTrainingSourceCapacity([], sources); const now = new Date().toISOString(); const value: TrainingSessionRecord = { id: randomUUID(), ...input, state: queue ? "GENERATING" : "ACTIVE", currentAnswer: null, currentReport: null, proposalId: null, answerError: null, createdAt: now, updatedAt: now, version: 1 }; this.values.set(value.id, value); this.turns.set(value.id, []); this.sources.set(value.id, sources.map(source => newTrainingSource(source, value.id, new Date(now)))); return copy(value); }
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
  async activeGuidance() { return [...this.values.values()].flatMap(session => acceptedGuidanceFromSession(session, { fullName: session.targetRepository, status: "ACTIVE", indexedCommit: session.indexedCommit } as SourceRepositoryRecord) ?? []); }
  async listTurns(id: string, trainerAccountId: string) { await this.get(id, trainerAccountId); return structuredClone(this.turns.get(id) ?? []); }
  async listSources(id: string, trainerAccountId: string): Promise<TrainingSourceRecord[]> { await this.get(id, trainerAccountId); return (this.sources.get(id) ?? []).map(source => { const record = structuredClone(source); delete (record as Partial<TrainingSourceContent>).originalBytes; delete (record as Partial<TrainingSourceContent>).extractedText; return record; }); }
  async listSourceContents(id: string, trainerAccountId: string) { await this.get(id, trainerAccountId); return structuredClone(this.sources.get(id) ?? []); }
  private update(id: string, trainerAccountId: string, expected: TrainingState[], patch: Partial<TrainingSessionRecord>, kind?: string, content?: Readonly<Record<string, unknown>>, expectedVersion?: number, answerId?: string) { const current = this.values.get(id); if (!current || current.trainerAccountId !== trainerAccountId) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); if (!expected.includes(current.state) || (expectedVersion !== undefined && (current.version !== expectedVersion || current.currentAnswer?.id !== answerId))) throw new TrainingStateError("INVALID_TRAINING_STATE", "That action is not available in the current training state or the answer changed."); const value = { ...current, ...patch, updatedAt: new Date().toISOString(), version: current.version + 1 }; this.values.set(id, value); if (kind && content) { const turns = this.turns.get(id) ?? []; turns.push({ ordinal: turns.length + 1, kind, content: structuredClone(content), createdAt: value.updatedAt }); this.turns.set(id, turns); } return copy(value); }
  async saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>) { return this.update(id, trainerAccountId, ["ACTIVE", "GENERATING", "REVISING", "REPORT_READY"], { currentAnswer: answer, currentReport: null, state: "ACTIVE", answerError: null }, "ANSWER", { answer }); }
  async saveFeedback(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, feedback: string) { return this.update(id, trainerAccountId, ["ACTIVE"], { state: "REVISING", answerError: null }, "FEEDBACK", { answerId, feedback }, expectedVersion, answerId); }
  async saveClarification(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, response: string) {
    const current = await this.get(id, trainerAccountId);
    if (current.state !== "ACTIVE" || !hasEssentialClarification(current.currentAnswer)) throw new TrainingStateError("INVALID_TRAINING_STATE", "No essential clarifying question is pending.");
    return this.update(id, trainerAccountId, ["ACTIVE"], { state: "REVISING", answerError: null }, "CLARIFICATION", { answerId, question: current.currentAnswer!.clarifyingQuestion, response }, expectedVersion, answerId);
  }
  async addSources(id: string, trainerAccountId: string, expectedVersion: number, sources: TrainingSourceInput[], queue = false) { const session = await this.get(id, trainerAccountId); if (!sources.length || session.state !== "ACTIVE" || session.version !== expectedVersion) throw new TrainingStateError("INVALID_TRAINING_STATE", "Reload the session before adding source material."); const existing = this.sources.get(id) ?? []; assertTrainingSourceCapacity(existing, sources); this.sources.set(id, [...existing, ...sources.map(source => newTrainingSource(source, id))]); return this.update(id, trainerAccountId, ["ACTIVE"], { state: queue || session.currentAnswer ? "REVISING" : "GENERATING", answerError: null }, "SOURCE", { sourceIds: (this.sources.get(id) ?? []).slice(-sources.length).map(source => source.id) }, expectedVersion, session.currentAnswer?.id as string | undefined); }
  async removeSource(id: string, trainerAccountId: string, expectedVersion: number, sourceId: string, queue = false) { const session = await this.get(id, trainerAccountId); const sources = this.sources.get(id) ?? []; const source = sources.find(item => item.id === sourceId); const removable = session.state === "ACTIVE" || session.state === "REVISING" && Boolean(session.answerError) && source?.status === "FAILED"; if (!removable || session.version !== expectedVersion || !source) throw new TrainingStateError("INVALID_TRAINING_STATE", "Reload the session before removing source material."); this.sources.set(id, sources.filter(item => item.id !== sourceId)); return this.update(id, trainerAccountId, [session.state], { state: queue || session.currentAnswer ? "REVISING" : "GENERATING", answerError: null }, "SOURCE_REMOVED", { sourceId }, expectedVersion, session.currentAnswer?.id as string | undefined); }
  async saveSource(source: TrainingSourceContent) { const sources = this.sources.get(source.sessionId) ?? []; this.sources.set(source.sessionId, sources.map(item => item.id === source.id ? structuredClone(source) : item)); }
  async failSource(id: string, sessionId: string, message: string) { const sources = this.sources.get(sessionId) ?? []; this.sources.set(sessionId, sources.map(source => source.id === id ? { ...source, status: "FAILED", error: message, updatedAt: new Date().toISOString() } : source)); }
  async retryAnswer(id: string, trainerAccountId: string, expectedVersion: number) { const session = await this.get(id, trainerAccountId); if (session.version !== expectedVersion || !session.answerError || (session.state !== "REVISING" && !(session.state === "ACTIVE" && !session.currentAnswer))) throw new TrainingStateError("INVALID_TRAINING_STATE", "Reload the session before retrying the answer."); return this.update(id, trainerAccountId, [session.state], { state: session.currentAnswer ? "REVISING" : "GENERATING", answerError: null }, "RETRY_ANSWER", { answerId: session.currentAnswer?.id ?? null }); }
  async acceptAnswer(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, source: SourceRepositoryRecord) {
    const session = await this.get(id, trainerAccountId);
    if (source.status !== "ACTIVE" || source.fullName !== session.targetRepository) throw new TrainingStateError("INVALID_TRAINING_STATE", "The selected repository is no longer active.");
    if (session.version !== expectedVersion || session.currentAnswer?.id !== answerId || session.state !== "ACTIVE") throw new TrainingStateError("INVALID_TRAINING_STATE", "That answer changed. Reload before acceptance.");
    if (hasEssentialClarification(session.currentAnswer)) throw new TrainingStateError("INVALID_TRAINING_STATE", "Answer the essential clarifying question before accepting this answer.");
    const sources = await this.listSourceContents(id, trainerAccountId);
    if (sources.some(item => item.status !== "READY")) throw new TrainingStateError("INVALID_TRAINING_STATE", "Wait for every trainer source to finish preparing before accepting this answer.");
    const artifact = acceptedTrainingArtifact(session, trainerAccountId, source.indexedCommit, new Date().toISOString(), sources);
    return this.update(id, trainerAccountId, ["ACTIVE"], { state: "PUBLISHING", acceptedContent: artifact.content, acceptedDigest: artifact.digest, acceptedPath: artifact.path, acceptedSourceVersion: source.version }, "ACCEPT_ANSWER", { answerId, digest: artifact.digest }, expectedVersion, answerId);
  }
  async failPublication(id: string, trainerAccountId: string, error: string) { return this.update(id, trainerAccountId, ["PUBLISHING", "ACTIVATING"], { state: "FAILED", publicationError: error }, "PUBLICATION_FAILED", { error }); }
  async retryPublication(id: string, trainerAccountId: string, source: SourceRepositoryRecord) {
    const session = await this.get(id, trainerAccountId);
    if (session.state !== "FAILED" || source.status !== "ACTIVE" || source.fullName !== session.targetRepository || (!session.publishedCommit && (source.version !== session.acceptedSourceVersion || source.indexedCommit !== JSON.parse(session.acceptedContent ?? "{}").sourceCommit)) || !session.acceptedContent || contentDigest(session.acceptedContent) !== session.acceptedDigest) throw new TrainingStateError("INVALID_TRAINING_STATE", "Accepted knowledge cannot be retried until the source and digest are valid.");
    return this.update(id, trainerAccountId, ["FAILED"], { state: session.publishedCommit ? "ACTIVATING" : "PUBLISHING", publicationError: null }, "PUBLICATION_RETRY", { digest: session.acceptedDigest });
  }
  async saveReport(id: string, trainerAccountId: string, _rating: "HELPFUL" | "NOT_HELPFUL", _explanation: string, report: TrainingReport) { return this.update(id, trainerAccountId, ["ACTIVE"], { currentReport: report, state: "REPORT_READY" }); }
  async acceptReport(id: string, trainerAccountId: string) { return this.update(id, trainerAccountId, ["REPORT_READY"], { state: "REPORT_ACCEPTED" }); }
  async markProposed(id: string, trainerAccountId: string, proposalId: string) { return this.update(id, trainerAccountId, ["REPORT_ACCEPTED"], { state: "PROPOSED", proposalId }); }
  async wipe(id: string, trainerAccountId: string) { await this.get(id, trainerAccountId); this.values.delete(id); this.turns.delete(id); this.sources.delete(id); }
}
