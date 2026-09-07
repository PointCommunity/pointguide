import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { PointGuideDatabase } from "@/db/client";
import { changeProposals, jobs } from "@/db/schema";
import { ChangeProposal, proposalStates, transitionAllowed, type ProposalState } from "./proposals";

export interface ProposalRecord { id: string; proposerId: string; rationale: string; targetRepository: string; baseCommit: string; targetPath: string; operation: "CREATE" | "UPDATE" | "SUPERSEDE"; proposedContent: string; digest: string; state: string; createdAt: string }
export interface ProposalRepository { create(input: Omit<ProposalRecord, "id" | "digest" | "state" | "createdAt">): Promise<ProposalRecord>; list(): Promise<ProposalRecord[]>; transition(id: string, next: ProposalState, reviewerId: string): Promise<ProposalRecord> }

export class MemoryProposalRepository implements ProposalRepository {
  private readonly values: ProposalRecord[] = [];
  async create(input: Omit<ProposalRecord, "id" | "digest" | "state" | "createdAt">): Promise<ProposalRecord> {
    const proposal = new ChangeProposal({ id: randomUUID(), targetRepository: input.targetRepository, targetPath: input.targetPath, operation: input.operation, proposedContent: input.proposedContent });
    const value = { ...input, id: proposal.id, digest: proposal.digest, state: proposal.state, createdAt: new Date().toISOString() };
    this.values.unshift(value); return { ...value };
  }
  async list(): Promise<ProposalRecord[]> { return this.values.map((value) => ({ ...value })); }
  async transition(id: string, next: ProposalState, reviewerId: string): Promise<ProposalRecord> {
    void reviewerId;
    const index = this.values.findIndex((value) => value.id === id);
    const current = this.values[index];
    if (!current || !proposalStates.includes(current.state as ProposalState) || !transitionAllowed(current.state as ProposalState, next)) throw new Error("INVALID_TRANSITION");
    const value = { ...current, state: next }; this.values[index] = value; return { ...value };
  }
}

export class PostgresProposalRepository implements ProposalRepository {
  constructor(private readonly database: PointGuideDatabase) {}
  async create(input: Omit<ProposalRecord, "id" | "digest" | "state" | "createdAt">): Promise<ProposalRecord> {
    const id = randomUUID();
    const domain = new ChangeProposal({ id, targetRepository: input.targetRepository, targetPath: input.targetPath, operation: input.operation, proposedContent: input.proposedContent });
    const now = new Date();
    await this.database.insert(changeProposals).values({ id, proposerId: input.proposerId, rationale: input.rationale, targetRepository: input.targetRepository, baseCommit: input.baseCommit, targetPath: input.targetPath, operation: input.operation, proposedContent: input.proposedContent, contentDigest: domain.digest, state: domain.state, createdAt: now, updatedAt: now });
    return { ...input, id, digest: domain.digest, state: domain.state, createdAt: now.toISOString() };
  }
  async list(): Promise<ProposalRecord[]> {
    const rows = await this.database.select().from(changeProposals).orderBy(desc(changeProposals.createdAt));
    return rows.map((row) => ({ id: row.id, proposerId: row.proposerId, rationale: row.rationale, targetRepository: row.targetRepository, baseCommit: row.baseCommit, targetPath: row.targetPath, operation: row.operation as ProposalRecord["operation"], proposedContent: row.proposedContent, digest: row.contentDigest, state: row.state, createdAt: row.createdAt.toISOString() }));
  }
  async transition(id: string, next: ProposalState, reviewerId: string): Promise<ProposalRecord> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(changeProposals).where(eq(changeProposals.id, id)).limit(1);
      if (!current || !proposalStates.includes(current.state as ProposalState) || !transitionAllowed(current.state as ProposalState, next)) throw new Error("INVALID_TRANSITION");
      const now = new Date();
      const [saved] = await transaction.update(changeProposals).set({ state: next, reviewerId, updatedAt: now, version: current.version + 1 }).where(eq(changeProposals.id, id)).returning();
      if (!saved) throw new Error("Proposal transition failed.");
      if (next === "APPROVED") await transaction.insert(jobs).values({ id: randomUUID(), kind: "APPLY_PROPOSAL", payload: { proposalId: id }, status: "READY", availableAt: now, createdAt: now, updatedAt: now });
      return { id: saved.id, proposerId: saved.proposerId, rationale: saved.rationale, targetRepository: saved.targetRepository, baseCommit: saved.baseCommit, targetPath: saved.targetPath, operation: saved.operation as ProposalRecord["operation"], proposedContent: saved.proposedContent, digest: saved.contentDigest, state: saved.state, createdAt: saved.createdAt.toISOString() };
    });
  }
}
