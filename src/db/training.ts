import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { conversations, jobs, sourceRepositories, trainingSessions, trainingTurns } from "@/db/schema";
import { TrainingStateError } from "@/lib/training/store";
import { acceptedTrainingArtifact, hasEssentialClarification } from "@/lib/training/artifact";
import { contentDigest } from "@/lib/git/proposals";
import { acceptedGuidanceFromSession, hasVerifiedAcceptedArtifact } from "@/lib/training/knowledge";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import type { TrainingReport, TrainingSessionRecord, TrainingSessionStore, TrainingState } from "@/lib/training/types";

function fromRow(row: typeof trainingSessions.$inferSelect): TrainingSessionRecord { return { id: row.id, trainerAccountId: row.trainerAccountId, conversationId: row.conversationId, targetRepository: row.targetRepository, originalQuestion: row.originalQuestion, state: row.state as TrainingState, currentAnswer: row.currentAnswer, currentReport: row.currentReport as unknown as TrainingReport | null, proposalId: row.proposalId, acceptedContent: row.acceptedContent, acceptedDigest: row.acceptedDigest, acceptedPath: row.acceptedPath, acceptedSourceVersion: row.acceptedSourceVersion, publishedCommit: row.publishedCommit, indexedCommit: row.indexedCommit, publicationError: row.publicationError, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version }; }
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
  async activeGuidance() {
    const rows = await this.database.select({ session: trainingSessions, source: sourceRepositories }).from(trainingSessions)
      .innerJoin(sourceRepositories, eq(trainingSessions.targetRepository, sourceRepositories.fullName))
      .where(and(eq(trainingSessions.state, "ACTIVE_KNOWLEDGE"), eq(sourceRepositories.status, "ACTIVE")));
    return rows.flatMap(row => acceptedGuidanceFromSession(fromRow(row.session), { fullName: row.source.fullName, status: row.source.status as SourceRepositoryRecord["status"], indexedCommit: row.source.indexedCommit, validationReport: row.source.validationReport as unknown as SourceRepositoryRecord["validationReport"] }) ?? []);
  }
  async listTurns(id: string, trainerAccountId: string) { await this.get(id, trainerAccountId); return (await this.database.select().from(trainingTurns).where(eq(trainingTurns.sessionId, id)).orderBy(asc(trainingTurns.ordinal))).map(row => ({ ordinal: row.ordinal, kind: row.kind, content: row.content, createdAt: row.createdAt.toISOString() })); }
  private async update(id: string, trainerAccountId: string, expected: TrainingState[], patch: Partial<typeof trainingSessions.$inferInsert>, kind: string, content: Readonly<Record<string, unknown>>, expectedVersion?: number, answerId?: string) { return this.database.transaction(async (transaction) => { const [current] = await transaction.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.trainerAccountId, trainerAccountId))).for("update"); if (!current) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found."); if (!expected.includes(current.state as TrainingState) || (expectedVersion !== undefined && (current.version !== expectedVersion || current.currentAnswer?.id !== answerId))) throw new TrainingStateError("INVALID_TRAINING_STATE", "That action is not available in the current training state or the answer changed."); const [{ count }] = await transaction.select({ count: sql<number>`count(*)::int` }).from(trainingTurns).where(eq(trainingTurns.sessionId, id)); await transaction.insert(trainingTurns).values({ id: randomUUID(), sessionId: id, ordinal: count + 1, actor: kind === "ANSWER" || kind === "REPORT" ? "AGENT" : "TRAINER", kind, content, createdAt: new Date() }); const [row] = await transaction.update(trainingSessions).set({ ...patch, updatedAt: new Date(), version: current.version + 1 }).where(eq(trainingSessions.id, id)).returning(); return fromRow(row!); }); }
  async saveAnswer(id: string, trainerAccountId: string, answer: Readonly<Record<string, unknown>>, insight?: string) { return this.update(id, trainerAccountId, ["ACTIVE", "REVISING", "REPORT_READY"], { currentAnswer: answer, currentReport: null, state: "ACTIVE" }, "ANSWER", { answer, insight: insight ?? null }); }
  async saveFeedback(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, feedback: string) { return this.update(id, trainerAccountId, ["ACTIVE"], { state: "REVISING" }, "FEEDBACK", { answerId, feedback }, expectedVersion, answerId); }
  async saveClarification(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, response: string) {
    const current = await this.get(id, trainerAccountId);
    if (current.state !== "ACTIVE" || !hasEssentialClarification(current.currentAnswer)) throw new TrainingStateError("INVALID_TRAINING_STATE", "No essential clarifying question is pending.");
    return this.update(id, trainerAccountId, ["ACTIVE"], { state: "REVISING" }, "CLARIFICATION", { answerId, question: current.currentAnswer!.clarifyingQuestion, response }, expectedVersion, answerId);
  }
  async acceptAnswer(id: string, trainerAccountId: string, expectedVersion: number, answerId: string, source: SourceRepositoryRecord) {
    return this.database.transaction(async transaction => {
      const [current] = await transaction.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.trainerAccountId, trainerAccountId))).for("update");
      if (!current) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found.");
      if (current.state !== "ACTIVE" || current.version !== expectedVersion || current.currentAnswer?.id !== answerId) throw new TrainingStateError("INVALID_TRAINING_STATE", "That answer changed. Reload before acceptance.");
      if (hasEssentialClarification(current.currentAnswer)) throw new TrainingStateError("INVALID_TRAINING_STATE", "Answer the essential clarifying question before accepting this answer.");
      const [registered] = await transaction.select().from(sourceRepositories).where(eq(sourceRepositories.id, source.id)).for("update");
      if (!registered || registered.status !== "ACTIVE" || registered.fullName !== current.targetRepository || registered.version !== source.version || registered.indexedCommit !== source.indexedCommit) throw new TrainingStateError("INVALID_TRAINING_STATE", "The selected repository changed. Reload before acceptance.");
      const now = new Date(); const artifact = acceptedTrainingArtifact(fromRow(current), trainerAccountId, registered.indexedCommit, now.toISOString());
      const [{ count }] = await transaction.select({ count: sql<number>`count(*)::int` }).from(trainingTurns).where(eq(trainingTurns.sessionId, id));
      await transaction.insert(trainingTurns).values({ id: randomUUID(), sessionId: id, ordinal: count + 1, actor: "TRAINER", kind: "ACCEPT_ANSWER", content: { answerId, digest: artifact.digest, sourceCommit: registered.indexedCommit }, createdAt: now });
      const [saved] = await transaction.update(trainingSessions).set({ state: "PUBLISHING", acceptedContent: artifact.content, acceptedDigest: artifact.digest, acceptedPath: artifact.path, acceptedSourceVersion: registered.version, updatedAt: now, version: current.version + 1 }).where(eq(trainingSessions.id, id)).returning();
      await transaction.insert(jobs).values({ id: randomUUID(), kind: "PUBLISH_ACCEPTED_TRAINING", payload: { sessionId: id }, status: "READY", availableAt: now, createdAt: now, updatedAt: now });
      return fromRow(saved!);
    });
  }
  async retryPublication(id: string, trainerAccountId: string, source: SourceRepositoryRecord) {
    return this.database.transaction(async transaction => {
      const [current] = await transaction.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), eq(trainingSessions.trainerAccountId, trainerAccountId))).for("update");
      if (!current) throw new TrainingStateError("TRAINING_NOT_FOUND", "Training session was not found.");
      const [registered] = await transaction.select().from(sourceRepositories).where(eq(sourceRepositories.id, source.id)).for("update");
      if (current.state !== "FAILED" || !current.acceptedContent || contentDigest(current.acceptedContent) !== current.acceptedDigest || !registered || registered.status !== "ACTIVE" || registered.fullName !== current.targetRepository || (!current.publishedCommit && (registered.version !== current.acceptedSourceVersion || registered.indexedCommit !== JSON.parse(current.acceptedContent).sourceCommit))) throw new TrainingStateError("INVALID_TRAINING_STATE", "Accepted knowledge cannot be retried until the source and digest are valid.");
      const now = new Date(); const state = current.publishedCommit ? "ACTIVATING" : "PUBLISHING";
      const [saved] = await transaction.update(trainingSessions).set({ state, publicationError: null, updatedAt: now, version: current.version + 1 }).where(eq(trainingSessions.id, id)).returning();
      await transaction.insert(jobs).values({ id: randomUUID(), kind: "PUBLISH_ACCEPTED_TRAINING", payload: { sessionId: id }, status: "READY", availableAt: now, createdAt: now, updatedAt: now });
      return fromRow(saved!);
    });
  }
  async activateKnowledge(id: string, digest: string, indexedCommit: string) {
    await this.database.transaction(async transaction => {
      const [current] = await transaction.select().from(trainingSessions).where(eq(trainingSessions.id, id)).for("update");
      if (!current || current.state !== "ACTIVATING" || !current.publishedCommit || !current.acceptedPath || !current.acceptedContent || current.acceptedDigest !== digest || contentDigest(current.acceptedContent) !== digest) throw new TrainingStateError("INVALID_TRAINING_STATE", "Accepted publication changed before activation.");
      const [source] = await transaction.select().from(sourceRepositories).where(eq(sourceRepositories.fullName, current.targetRepository)).for("update");
      if (!source || source.status !== "ACTIVE" || source.indexedCommit !== indexedCommit) throw new TrainingStateError("INVALID_TRAINING_STATE", "The indexed repository changed before activation.");
      if (!hasVerifiedAcceptedArtifact({ indexedCommit: source.indexedCommit, validationReport: source.validationReport as unknown as SourceRepositoryRecord["validationReport"] }, current.acceptedPath, digest)) throw new TrainingStateError("INVALID_TRAINING_STATE", "The accepted artifact is absent from the validated repository snapshot.");
      await transaction.update(trainingSessions).set({ state: "SUPERSEDED", updatedAt: new Date(), version: sql`${trainingSessions.version}+1` }).where(and(sql`${trainingSessions.id}<>${id}`, eq(trainingSessions.state, "ACTIVE_KNOWLEDGE"), eq(trainingSessions.targetRepository, current.targetRepository), sql`lower(trim(${trainingSessions.originalQuestion}))=lower(trim(${current.originalQuestion}))`));
      await transaction.update(trainingSessions).set({ state: "ACTIVE_KNOWLEDGE", indexedCommit, publicationError: null, updatedAt: new Date(), version: current.version + 1 }).where(eq(trainingSessions.id, id));
    });
  }
  async saveReport(id: string, trainerAccountId: string, rating: "HELPFUL" | "NOT_HELPFUL", explanation: string, report: TrainingReport) { return this.update(id, trainerAccountId, ["ACTIVE"], { currentReport: report as unknown as Readonly<Record<string, unknown>>, state: "REPORT_READY" }, "REPORT", { rating, explanation, report }); }
  async acceptReport(id: string, trainerAccountId: string) { return this.update(id, trainerAccountId, ["REPORT_READY"], { state: "REPORT_ACCEPTED" }, "ACCEPT", { accepted: true }); }
  async markProposed(id: string, trainerAccountId: string, proposalId: string) { return this.update(id, trainerAccountId, ["REPORT_ACCEPTED"], { state: "PROPOSED", proposalId }, "PROPOSE", { proposalId }); }
  async wipe(id: string, trainerAccountId: string) { const session = await this.get(id, trainerAccountId); await this.database.delete(conversations).where(and(eq(conversations.id, session.conversationId), eq(conversations.ownerAccountId, trainerAccountId))); }
}
