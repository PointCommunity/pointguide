import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { answerClaims, answers, claimEvidence, conversations, evidenceItems, feedbackRecords, messages } from "@/db/schema";
import type { OrchestratedAnswer, ReviewMode } from "@/lib/agent/orchestrator";
import type { AnswerClaim, EvidenceItem } from "@/lib/agent/schema";
import type { FeedbackInput, FeedbackRecord } from "@/lib/feedback/store";

export interface StoredConversation { id: string; ownerAccountId: string; title: string; createdAt: string; updatedAt: string; userTurnCount: number }
export interface ConversationMessage { actor: "USER" | "ASSISTANT"; content: string }
export interface StoredAnswer extends OrchestratedAnswer { id: string; evidence: EvidenceItem[] }
export interface SessionTurn { question: string; createdAt: string; answer: StoredAnswer }
export interface SessionSummary extends StoredConversation { latestQuestion: string | null; preview: string | null }
export interface SessionDetail { conversation: StoredConversation; turns: SessionTurn[] }

export function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/gu, " ");
  if (compact.length <= 72) return compact;
  const prefix = compact.slice(0, 72);
  const lastSpace = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, lastSpace >= 48 ? lastSpace : 69).trimEnd()}…`;
}

export interface LearningRepository {
  createConversation(ownerAccountId: string, title: string): Promise<StoredConversation>;
  ownsConversation(id: string, ownerAccountId: string): Promise<boolean>;
  reserveTurn(id: string, ownerAccountId: string, maxTurns?: number): Promise<number>;
  releaseTurn(id: string, ownerAccountId: string): Promise<void>;
  listMessages(id: string, ownerAccountId: string): Promise<ConversationMessage[]>;
  listConversations(ownerAccountId: string, query?: string): Promise<SessionSummary[]>;
  getConversation(id: string, ownerAccountId: string): Promise<SessionDetail>;
  saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer; evidence: EvidenceItem[]; reviewMode: ReviewMode; turnNumber: number }): Promise<OrchestratedAnswer & { id: string }>;
  saveFeedback(input: FeedbackInput): Promise<FeedbackRecord>;
  listFeedback(): Promise<FeedbackRecord[]>;
}

export class MemoryLearningRepository implements LearningRepository {
  private readonly conversations = new Map<string, StoredConversation>();
  private readonly answers = new Map<string, OrchestratedAnswer & { id: string }>();
  private readonly messages = new Map<string, ConversationMessage[]>();
  private readonly turns = new Map<string, SessionTurn[]>();
  private readonly feedback: FeedbackRecord[] = [];

  async createConversation(ownerAccountId: string, title: string): Promise<StoredConversation> {
    const timestamp = new Date().toISOString();
    const value = { id: randomUUID(), ownerAccountId, title: title.slice(0, 120), createdAt: timestamp, updatedAt: timestamp, userTurnCount: 0 };
    this.conversations.set(value.id, value);
    return { ...value };
  }
  async ownsConversation(id: string, ownerAccountId: string): Promise<boolean> { return this.conversations.get(id)?.ownerAccountId === ownerAccountId; }
  async reserveTurn(id: string, ownerAccountId: string, maxTurns = 6): Promise<number> {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.ownerAccountId !== ownerAccountId) throw new Error("CONVERSATION_NOT_FOUND");
    if (conversation.userTurnCount >= maxTurns) throw new Error("TURN_LIMIT_REACHED");
    conversation.userTurnCount += 1;
    conversation.updatedAt = new Date().toISOString();
    return conversation.userTurnCount;
  }
  async releaseTurn(id: string, ownerAccountId: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation?.ownerAccountId === ownerAccountId) {
      conversation.userTurnCount = Math.max(0, conversation.userTurnCount - 1);
      conversation.updatedAt = new Date().toISOString();
    }
  }
  async listMessages(id: string, ownerAccountId: string): Promise<ConversationMessage[]> {
    if (!await this.ownsConversation(id, ownerAccountId)) throw new Error("CONVERSATION_NOT_FOUND");
    return (this.messages.get(id) ?? []).map((message) => ({ ...message }));
  }
  async listConversations(ownerAccountId: string, query = ""): Promise<SessionSummary[]> {
    const needle = query.trim().toLocaleLowerCase("en-US").slice(0, 200);
    return [...this.conversations.values()]
      .filter((conversation) => conversation.ownerAccountId === ownerAccountId)
      .filter((conversation) => conversation.userTurnCount > 0)
      .filter((conversation) => {
        if (!needle) return true;
        const content = (this.messages.get(conversation.id) ?? []).map((message) => message.content).join(" ");
        return `${conversation.title} ${content}`.toLocaleLowerCase("en-US").includes(needle);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 50)
      .map((conversation) => {
        const sessionTurns = this.turns.get(conversation.id) ?? [];
        const latest = sessionTurns.at(-1);
        return { ...conversation, latestQuestion: latest?.question ?? null, preview: latest?.answer.directAnswer ?? null };
      });
  }
  async getConversation(id: string, ownerAccountId: string): Promise<SessionDetail> {
    const conversation = this.conversations.get(id);
    if (!conversation || conversation.ownerAccountId !== ownerAccountId) throw new Error("CONVERSATION_NOT_FOUND");
    return {
      conversation: { ...conversation },
      turns: (this.turns.get(id) ?? []).slice().reverse().map((turn) => ({
        ...turn,
        answer: { ...turn.answer, steps: [...turn.answer.steps], safetyAndAssumptions: [...turn.answer.safetyAndAssumptions], claims: turn.answer.claims.map((claim) => ({ ...claim, evidenceIds: [...claim.evidenceIds] })), evidence: turn.answer.evidence.map((item) => ({ ...item })) },
      })),
    };
  }
  async saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer; evidence: EvidenceItem[]; turnNumber: number }): Promise<OrchestratedAnswer & { id: string }> {
    const value = { ...input.answer, id: randomUUID() };
    this.answers.set(value.id, value);
    const history = this.messages.get(input.conversationId) ?? [];
    history.push({ actor: "USER", content: input.question }, { actor: "ASSISTANT", content: input.answer.directAnswer });
    this.messages.set(input.conversationId, history);
    const conversation = this.conversations.get(input.conversationId);
    const createdAt = new Date().toISOString();
    if (conversation) {
      if (input.turnNumber === 1) conversation.title = titleFromQuestion(input.question);
      conversation.updatedAt = createdAt;
    }
    const turns = this.turns.get(input.conversationId) ?? [];
    turns.push({ question: input.question, createdAt, answer: { ...value, evidence: input.evidence.map((item) => ({ ...item })) } });
    this.turns.set(input.conversationId, turns);
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
    return { id: row.id, ownerAccountId: row.ownerAccountId, title: row.title, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), userTurnCount: row.userTurnCount };
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
      .where(eq(messages.conversationId, id)).orderBy(asc(messages.ordinal));
    return rows.filter((row): row is ConversationMessage => (row.actor === "USER" || row.actor === "ASSISTANT"));
  }
  async listConversations(ownerAccountId: string, query = ""): Promise<SessionSummary[]> {
    const needle = query.trim().slice(0, 200);
    const condition = needle
      ? and(eq(conversations.ownerAccountId, ownerAccountId), gt(conversations.userTurnCount, 0), or(ilike(conversations.title, `%${needle}%`), sql`exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id} and ${messages.content} ilike ${`%${needle}%`})`))
      : and(eq(conversations.ownerAccountId, ownerAccountId), gt(conversations.userTurnCount, 0));
    const rows = await this.database.select().from(conversations).where(condition).orderBy(desc(conversations.updatedAt)).limit(50);
    return Promise.all(rows.map(async (row) => {
      const [latestQuestion] = await this.database.select({ content: messages.content }).from(messages)
        .where(and(eq(messages.conversationId, row.id), eq(messages.actor, "USER"))).orderBy(desc(messages.ordinal)).limit(1);
      const [latestAnswer] = await this.database.select({ content: messages.content }).from(messages)
        .where(and(eq(messages.conversationId, row.id), eq(messages.actor, "ASSISTANT"))).orderBy(desc(messages.ordinal)).limit(1);
      return { id: row.id, ownerAccountId: row.ownerAccountId, title: row.title, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), userTurnCount: row.userTurnCount, latestQuestion: latestQuestion?.content ?? null, preview: latestAnswer?.content ?? null };
    }));
  }
  async getConversation(id: string, ownerAccountId: string): Promise<SessionDetail> {
    const [conversationRow] = await this.database.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.ownerAccountId, ownerAccountId))).limit(1);
    if (!conversationRow) throw new Error("CONVERSATION_NOT_FOUND");
    const messageRows = await this.database.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.ordinal));
    const assistantIds = messageRows.filter((row) => row.actor === "ASSISTANT").map((row) => row.id);
    const answerRows = assistantIds.length ? await this.database.select().from(answers).where(inArray(answers.messageId, assistantIds)) : [];
    const answerIds = answerRows.map((row) => row.id);
    const claimRows = answerIds.length ? await this.database.select().from(answerClaims).where(inArray(answerClaims.answerId, answerIds)).orderBy(asc(answerClaims.ordinal)) : [];
    const claimIds = claimRows.map((row) => row.id);
    const evidenceRows = claimIds.length ? await this.database.select({ claimId: claimEvidence.claimId, item: evidenceItems }).from(claimEvidence).innerJoin(evidenceItems, eq(claimEvidence.evidenceItemId, evidenceItems.id)).where(inArray(claimEvidence.claimId, claimIds)) : [];
    const evidenceIdsByClaim = new Map<string, string[]>();
    const evidenceById = new Map<string, EvidenceItem>();
    for (const row of evidenceRows) {
      evidenceIdsByClaim.set(row.claimId, [...(evidenceIdsByClaim.get(row.claimId) ?? []), row.item.id]);
      evidenceById.set(row.item.id, {
        id: row.item.id,
        kind: row.item.kind as EvidenceItem["kind"],
        ...(row.item.sourceId ? { sourceId: row.item.sourceId } : {}),
        title: row.item.title,
        ...(row.item.path ? { path: row.item.path } : {}),
        ...(row.item.url ? { url: row.item.url } : {}),
        ...(row.item.locator ? { locator: row.item.locator } : {}),
        authority: row.item.authority,
        ...(row.item.versionOrDate ? { versionOrDate: row.item.versionOrDate } : {}),
        capturedAt: row.item.capturedAt.toISOString(), excerpt: row.item.excerpt, digest: row.item.digest,
      });
    }
    const answersByMessage = new Map(answerRows.map((row) => {
      const claims: AnswerClaim[] = claimRows.filter((claim) => claim.answerId === row.id).map((claim) => ({ id: claim.id, text: claim.text, kind: claim.kind as AnswerClaim["kind"], status: claim.status as AnswerClaim["status"], evidenceIds: evidenceIdsByClaim.get(claim.id) ?? [] }));
      const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
      const answer: StoredAnswer = { id: row.id, directAnswer: row.directAnswer, steps: row.steps, safetyAndAssumptions: row.safetyAssumptions, confidence: row.confidence as StoredAnswer["confidence"], reviewStatus: row.reviewStatus as StoredAnswer["reviewStatus"], claims, evidence: [...evidenceIds].flatMap((evidenceId) => evidenceById.get(evidenceId) ?? []) };
      return [row.messageId, answer] as const;
    }));
    const turns: SessionTurn[] = [];
    for (const userMessage of messageRows.filter((row) => row.actor === "USER")) {
      const assistantMessage = messageRows.find((row) => row.ordinal === userMessage.ordinal + 1 && row.actor === "ASSISTANT");
      const answer = assistantMessage ? answersByMessage.get(assistantMessage.id) : undefined;
      if (answer) turns.push({ question: userMessage.content, createdAt: userMessage.createdAt.toISOString(), answer });
    }
    return { conversation: { id: conversationRow.id, ownerAccountId: conversationRow.ownerAccountId, title: conversationRow.title, createdAt: conversationRow.createdAt.toISOString(), updatedAt: conversationRow.updatedAt.toISOString(), userTurnCount: conversationRow.userTurnCount }, turns: turns.reverse() };
  }
  async saveAnswer(input: { conversationId: string; question: string; answer: OrchestratedAnswer; evidence: EvidenceItem[]; reviewMode: ReviewMode; turnNumber: number }): Promise<OrchestratedAnswer & { id: string }> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      await transaction.insert(messages).values({ id: randomUUID(), conversationId: input.conversationId, actor: "USER", content: input.question, status: "COMPLETED", ordinal: input.turnNumber * 2 - 1, createdAt: now });
      const assistantMessageId = randomUUID();
      await transaction.insert(messages).values({ id: assistantMessageId, conversationId: input.conversationId, actor: "ASSISTANT", content: input.answer.directAnswer, status: "COMPLETED", ordinal: input.turnNumber * 2, createdAt: now });
      for (const item of input.evidence) {
        await transaction.insert(evidenceItems).values({
          id: item.id, kind: item.kind, sourceId: item.sourceId, title: item.title, path: item.path ?? item.locator ?? item.title, locator: item.locator, url: item.url,
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
      await transaction.update(conversations).set({ updatedAt: now, ...(input.turnNumber === 1 ? { title: titleFromQuestion(input.question) } : {}) }).where(eq(conversations.id, input.conversationId));
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
