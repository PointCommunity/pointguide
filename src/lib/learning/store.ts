import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { answerClaims, answers, claimEvidence, conversations, evidenceItems, feedbackRecords, messages } from "@/db/schema";
import type { OrchestratedAnswer, ReviewMode } from "@/lib/agent/orchestrator";
import type { EvidenceItem } from "@/lib/agent/schema";
import type { FeedbackInput, FeedbackRecord } from "@/lib/feedback/store";

export interface StoredConversation { id: string; ownerAccountId: string; title: string; createdAt: string; userTurnCount: number }
export interface ConversationMessage { actor: "USER" | "ASSISTANT"; content: string }

export interface LearningRepository {
  createConversation(ownerAccountId: string, title: string): Promise<StoredConversation>;
  ownsConversation(id: string, ownerAccountId: string): Promise<boolean>;
  reserveTurn(id: string, ownerAccountId: string, maxTurns?: number): Promise<number>;
  releaseTurn(id: string, ownerAccountId: string): Promise<void>;
  listMessages(id: string, ownerAccountId: string): Promise<ConversationMessage[]>;
  saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer; evidence: EvidenceItem[]; reviewMode: ReviewMode }): Promise<OrchestratedAnswer & { id: string }>;
  saveFeedback(input: FeedbackInput): Promise<FeedbackRecord>;
  listFeedback(): Promise<FeedbackRecord[]>;
}

export class MemoryLearningRepository implements LearningRepository {
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly answers = new Map<string, OrchestratedAnswer & { id: string }>();
  private readonly messages = new Map<string, ConversationMessage[]>();
  private readonly feedback: FeedbackRecord[] = [];

  async createConversation(ownerAccountId: string, title: string): Promise<StoredConversation> {
    const value = { id: randomUUID(), ownerAccountId, title: title.slice(0, 120), createdAt: new Date().toISOString(), userTurnCount: 0 };
    this.conversations.set(value.id, value);
    return { ...value };
  }
  async ownsConversation(id: string, ownerAccountId: string): Promise<boolean> { return this.conversations.get(id)?.ownerAccountId === ownerAccountId; }
  async reserveTurn(id: string, ownerAccountId: string, maxTurns = 6): Promise<number> {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.ownerAccountId !== ownerAccountId) throw new Error("CONVERSATION_NOT_FOUND");
    if (conversation.userTurnCount >= maxTurns) throw new Error("TURN_LIMIT_REACHED");
    conversation.userTurnCount += 1;
    return conversation.userTurnCount;
  }
  async releaseTurn(id: string, ownerAccountId: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation?.ownerAccountId === ownerAccountId) conversation.userTurnCount = Math.max(0, conversation.userTurnCount - 1);
  }
  async listMessages(id: string, ownerAccountId: string): Promise<ConversationMessage[]> {
    if (!await this.ownsConversation(id, ownerAccountId)) throw new Error("CONVERSATION_NOT_FOUND");
    return (this.messages.get(id) ?? []).map((message) => ({ ...message }));
  }
  async saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer }): Promise<OrchestratedAnswer & { id: string }> {
    const value = { ...input.answer, id: randomUUID() };
    this.answers.set(value.id, value);
    const history = this.messages.get(input.conversationId) ?? [];
    history.push({ actor: "USER", content: input.question }, { actor: "ASSISTANT", content: input.answer.directAnswer });
    this.messages.set(input.conversationId, history);
    return value;
  }
  async saveFeedback(input: FeedbackInput): Promise<FeedbackRecord> {
    if (this.feedback.some((item) => item.answerId === input.answerId && item.accountId === input.accountId)) throw new Error("FEEDBACK_EXISTS");
    const value = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.feedback.push(value);
    return { ...value };
  }
  async listFeedback(): Promise<FeedbackRecord[]> { return this.feedback.map((item) => ({ ...item })); }
}

export class PostgresLearningRepository implements LearningRepository {
  constructor(private readonly database: PointGuideDatabase) {}

  async createConversation(ownerAccountId: string, title: string): Promise<StoredConversation> {
    const now = new Date();
    const [row] = await this.database.insert(conversations).values({ id: randomUUID(), ownerAccountId, title: title.slice(0, 120), createdAt: now, updatedAt: now }).returning();
    if (!row) throw new Error("Conversation insert failed.");
    return { id: row.id, ownerAccountId: row.ownerAccountId, title: row.title, createdAt: row.createdAt.toISOString(), userTurnCount: row.userTurnCount };
  }
  async ownsConversation(id: string, ownerAccountId: string): Promise<boolean> {
    const [row] = await this.database.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.ownerAccountId, ownerAccountId))).limit(1);
    return Boolean(row);
  }
  async reserveTurn(id: string, ownerAccountId: string, maxTurns = 6): Promise<number> {
    const [row] = await this.database.update(conversations).set({ userTurnCount: sql`${conversations.userTurnCount} + 1`, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.ownerAccountId, ownerAccountId), sql`${conversations.userTurnCount} < ${maxTurns}`))
      .returning({ count: conversations.userTurnCount });
    if (row) return row.count;
    if (!await this.ownsConversation(id, ownerAccountId)) throw new Error("CONVERSATION_NOT_FOUND");
    throw new Error("TURN_LIMIT_REACHED");
  }
  async releaseTurn(id: string, ownerAccountId: string): Promise<void> {
    await this.database.update(conversations).set({ userTurnCount: sql`greatest(0, ${conversations.userTurnCount} - 1)`, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.ownerAccountId, ownerAccountId)));
  }
  async listMessages(id: string, ownerAccountId: string): Promise<ConversationMessage[]> {
    if (!await this.ownsConversation(id, ownerAccountId)) throw new Error("CONVERSATION_NOT_FOUND");
    const rows = await this.database.select({ actor: messages.actor, content: messages.content }).from(messages)
      .where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
    return rows.filter((row): row is ConversationMessage => (row.actor === "USER" || row.actor === "ASSISTANT"));
  }
  async saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer; evidence: EvidenceItem[]; reviewMode: ReviewMode }): Promise<OrchestratedAnswer & { id: string }> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      await transaction.insert(messages).values({ id: randomUUID(), conversationId: input.conversationId, actor: "USER", content: input.question, status: "COMPLETED", createdAt: now });
      const assistantMessageId = randomUUID();
      await transaction.insert(messages).values({ id: assistantMessageId, conversationId: input.conversationId, actor: "ASSISTANT", content: input.answer.directAnswer, status: "COMPLETED", createdAt: now });
      for (const item of input.evidence) {
        await transaction.insert(evidenceItems).values({
          id: item.id, kind: item.kind, sourceId: item.sourceId, title: item.title, locator: item.locator, url: item.url,
          authority: item.authority, versionOrDate: item.versionOrDate,
          capturedAt: new Date(item.capturedAt), excerpt: item.excerpt, digest: item.digest,
        }).onConflictDoNothing();
      }
      const answerId = randomUUID();
      await transaction.insert(answers).values({ id: answerId, messageId: assistantMessageId, reviewMode: input.reviewMode, reviewStatus: input.answer.reviewStatus, directAnswer: input.answer.directAnswer, steps: input.answer.steps, safetyAssumptions: input.answer.safetyAndAssumptions, confidence: input.answer.confidence, createdAt: now });
      const persistedClaims = [];
      for (const [ordinal, claim] of input.answer.claims.entries()) {
        const claimId = randomUUID();
        persistedClaims.push({ ...claim, id: claimId });
        await transaction.insert(answerClaims).values({ id: claimId, answerId, ordinal, text: claim.text, kind: claim.kind, status: claim.status });
        if (claim.evidenceIds.length) await transaction.insert(claimEvidence).values(claim.evidenceIds.map((evidenceItemId) => ({ claimId, evidenceItemId })));
      }
      await transaction.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, input.conversationId));
      return { ...input.answer, id: answerId, claims: persistedClaims };
    });
  }
  async saveFeedback(input: FeedbackInput): Promise<FeedbackRecord> {
    const createdAt = new Date();
    const [row] = await this.database.insert(feedbackRecords).values({ id: randomUUID(), ...input, createdAt }).returning();
    if (!row) throw new Error("Feedback insert failed.");
    return { ...input, id: row.id, createdAt: createdAt.toISOString() };
  }
  async listFeedback(): Promise<FeedbackRecord[]> {
    const rows = await this.database.select().from(feedbackRecords).orderBy(desc(feedbackRecords.createdAt));
    return rows.map((row) => ({ answerId: row.answerId, accountId: row.accountId, rating: row.rating as FeedbackInput["rating"], reason: row.reason, comment: row.comment, questionFingerprint: row.questionFingerprint, corpusCommit: row.corpusCommit, profileRevisionIds: row.profileRevisionIds, evidenceIds: row.evidenceIds, id: row.id, createdAt: row.createdAt.toISOString() }));
  }
}
