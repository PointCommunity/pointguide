import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { conversations, trainingSessions, trainingTurns } from "@/db/schema";
import { TrainingStateError } from "@/lib/training/store";
import type { TrainingReport, TrainingSessionRecord, TrainingSessionStore, TrainingState } from "@/lib/training/types";

function fromRow(row: typeof trainingSessions.$inferSelect): TrainingSessionRecord { return { id: row.id, trainerAccountId: row.trainerAccountId, conversationId: row.conversationId, targetRepository: row.targetRepository, originalQuestion: row.originalQuestion, state: row.state as TrainingState, currentAnswer: row.currentAnswer, currentReport: row.currentReport as unknown as TrainingReport | null, proposalId: row.proposalId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version }; }
export class PostgresTrainingSessionStore implements TrainingSessionStore {
  constructor(private readonly database: PointGuideDatabase) {}
  async create(input: { trainerAccountId: string; conversationId: string; targetRepository: string; originalQuestion: string }) { const now = new Date(); const [row] = await this.database.insert(trainingSessions).values({ id: randomUUID(), ...input, state: "ACTIVE", createdAt: now, updatedAt: now, version: 1 }).returning(); return fromRow(row!); }
  async list(trainerAccountId: string, query = "") {
    const normalized = query.trim();
    const search = normalized ? sql<boolean>`position(lower(${normalized}) in lower(concat_ws(' ', ${trainingSessions.originalQuestion}, ${trainingSessions.targetRepository}, coalesce(${trainingSessions.currentAnswer}::text, ''), coalesce(${trainingSessions.currentReport}::text, '')))) > 0` : undefined;
    return (await this.database.select().from(trainingSessions)
      .where(search ? and(eq(trainingSessions.trainerAccountId, trainerAccountId), search) : eq(trainingSessions.trainerAccountId, trainerAccountId))
      .orderBy(desc(trainingSessions.updatedAt), desc(trainingSessions.createdAt), desc(trainingSessions.id))
      .limit(50)).map(fromRow);
  }
  async get(id: string, trainerAccountId: string) { const [row] = await this.database.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.trainerAccountId, trainerAccountId))).limit(1); if (!row) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); return fromRow(row); }
  private async update(id: string, trainerAccountId: string, expected: TrainingState[], patch: Partial<typeof trainingSessions.$inferInsert>, kind: string, content: Readonly<Record<string, unknown>>) { return this.database.transaction(async (transaction) => { const [current] = await transaction.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.trainerAccountId, trainerAccountId))).limit(1); if (!current) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); if (!expected.includes(current.state as TrainingState)) throw new TrainingStateError("INVALID_TRAINING_STATE", "That action is not available in the current training state."); const [{ count }] = await transaction.select({ count: sql<number>`count(*)::int` }).from(trainingTurns).where(eq(trainingTurns.sessionId, id)); await transaction.insert(trainingTurns).values({ id: randomUUID(), sessionId: id, ordinal: count + 1, actor: kind === "ANSWER" || kind === "REPORT" ? "AGENT" : "TRAINER", kind, content, createdAt: new Date() }); const [row] = await transaction.update(trainingSessions).set({ ...patch, updatedAt: new Date(), version: current.version + 1 }).where(eq(trainingSessions.id, id)).returning(); return fromRow(row!); }); }
  async saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>, insight?: string) { return this.update(id, trainerAccountId, ["ACTIVE", "REPORT_READY"], { currentAnswer: answer, currentReport: null, state: "ACTIVE" }, "ANSWER", { answer, insight: insight ?? null }); }
  async saveReport(id: string, trainerAccountId: string, rating: "HELPFUL" | "NOT_HELPFUL", explanation: string, report: TrainingReport) { return this.update(id, trainerAccountId, ["ACTIVE"], { currentReport: report as unknown as Readonly<Record<string, unknown>>, state: "REPORT_READY" }, "REPORT", { rating, explanation, report }); }
  async acceptReport(id: string, trainerAccountId: string) { return this.update(id, trainerAccountId, ["REPORT_READY"], { state: "REPORT_ACCEPTED" }, "ACCEPT", { accepted: true }); }
  async markProposed(id: string, trainerAccountId: string, proposalId: string) { return this.update(id, trainerAccountId, ["REPORT_ACCEPTED"], { state: "PROPOSED", proposalId }, "PROPOSE", { proposalId }); }
  async wipe(id: string, trainerAccountId: string) { const session = await this.get(id, trainerAccountId); await this.database.delete(conversations).where(and(eq(conversations.id, session.conversationId), eq(conversations.ownerAccountId, trainerAccountId))); }
}
