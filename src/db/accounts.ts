import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { accounts, auditEvents } from "@/db/schema";
import type { PointGuideDatabase } from "@/db/client";
import { authorizeAccountMutation, AccountPolicyError } from "@/lib/auth/policy";
import type { AccessIdentity, Account, AccountMutation, AccountStore } from "@/lib/auth/types";

const governanceLockName = "pointguide:account-governance:v1";

function accountFromRow(row: typeof accounts.$inferSelect): Account {
  return row;
}

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly database: PointGuideDatabase) {}

  async provisionAccount(identity: AccessIdentity, now = new Date()): Promise<Account> {
    // One transaction and one database-scoped advisory lock serialize the empty-table
    // bootstrap decision. Drizzle transaction source: https://orm.drizzle.team/docs/transactions
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${governanceLockName}, 0))`);
      const [existing] = await transaction.select().from(accounts).where(and(
        eq(accounts.accessIssuer, identity.issuer),
        eq(accounts.accessSubject, identity.subject),
      )).limit(1);

      if (existing) {
        const [updated] = await transaction.update(accounts).set({
          email: identity.email,
          displayName: existing.displayName ?? identity.displayName,
          lastLoginAt: now,
          updatedAt: now,
          version: existing.version,
        }).where(eq(accounts.id, existing.id)).returning();
        if (!updated) throw new AccountPolicyError("ACCOUNT_NOT_FOUND", "Account was not found.");
        return accountFromRow(updated);
      }

      const [{ value: accountCount }] = await transaction.select({ value: count() }).from(accounts);
      const bootstrap = accountCount === 0;
      const [created] = await transaction.insert(accounts).values({
        id: randomUUID(),
        accessIssuer: identity.issuer,
        accessSubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        role: bootstrap ? "OWNER" : "USER",
        status: bootstrap ? "APPROVED" : "PENDING",
        firstLoginAt: now,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }).returning();
      if (!created) throw new Error("Account insert did not return a record.");

      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        actorId: null,
        action: "account.provisioned",
        targetType: "account",
        targetId: created.id,
        outcome: "SUCCEEDED",
        metadata: { bootstrap, role: created.role, status: created.status },
        occurredAt: now,
      });
      return accountFromRow(created);
    // READ COMMITTED takes a fresh snapshot after a waiter acquires the advisory
    // lock; SERIALIZABLE can retain the pre-wait empty-table snapshot and abort.
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await this.database.select().from(accounts).orderBy(asc(accounts.createdAt));
    return rows.map(accountFromRow);
  }

  async getAccount(id: string): Promise<Account | null> {
    const [account] = await this.database.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return account ? accountFromRow(account) : null;
  }

  async updateAccount(actorId: string, targetId: string, mutation: AccountMutation, now = new Date()): Promise<Account> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${governanceLockName}, 0))`);
      const [actor] = await transaction.select().from(accounts).where(eq(accounts.id, actorId)).limit(1);
      const [target] = await transaction.select().from(accounts).where(eq(accounts.id, targetId)).limit(1);
      if (!actor || !target) throw new AccountPolicyError("ACCOUNT_NOT_FOUND", "Account was not found.");
      if (target.version !== mutation.expectedVersion) {
        throw new AccountPolicyError("VERSION_CONFLICT", "Account changed since it was loaded.");
      }

      const [{ value: activeOwnerCount }] = await transaction.select({ value: count() }).from(accounts).where(and(
        eq(accounts.role, "OWNER"),
        eq(accounts.status, "APPROVED"),
      ));
      authorizeAccountMutation(accountFromRow(actor), accountFromRow(target), mutation, activeOwnerCount);

      const [updated] = await transaction.update(accounts).set({
        role: mutation.role ?? target.role,
        status: mutation.status ?? target.status,
        updatedAt: now,
        version: target.version + 1,
      }).where(and(eq(accounts.id, target.id), eq(accounts.version, target.version))).returning();
      if (!updated) throw new AccountPolicyError("VERSION_CONFLICT", "Account changed since it was loaded.");

      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        actorId: actor.id,
        action: "account.updated",
        targetType: "account",
        targetId: updated.id,
        outcome: "SUCCEEDED",
        metadata: { role: updated.role, status: updated.status, version: updated.version },
        occurredAt: now,
      });
      return accountFromRow(updated);
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }

  async updateDisplayName(accountId: string, displayName: string, expectedVersion: number, now = new Date()): Promise<Account> {
    return this.database.transaction(async (transaction) => {
      const [account] = await transaction.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!account) throw new AccountPolicyError("ACCOUNT_NOT_FOUND", "Account was not found.");
      if (account.version !== expectedVersion) throw new AccountPolicyError("VERSION_CONFLICT", "Account changed since it was loaded.");
      const [updated] = await transaction.update(accounts).set({ displayName, updatedAt: now, version: account.version + 1 })
        .where(and(eq(accounts.id, accountId), eq(accounts.version, expectedVersion))).returning();
      if (!updated) throw new AccountPolicyError("VERSION_CONFLICT", "Account changed since it was loaded.");
      await transaction.insert(auditEvents).values({
        id: randomUUID(), actorId: accountId, action: "account.name_updated", targetType: "account", targetId: accountId,
        outcome: "SUCCEEDED", metadata: { version: updated.version }, occurredAt: now,
      });
      return accountFromRow(updated);
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }
}
