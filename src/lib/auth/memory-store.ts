import { randomUUID } from "node:crypto";
import { authorizeAccountMutation, AccountPolicyError } from "@/lib/auth/policy";
import type { AccessIdentity, Account, AccountMutation, AccountStore, AuditEvent } from "@/lib/auth/types";

function copyAccount(account: Account): Account {
  return { ...account };
}

export class MemoryAccountStore implements AccountStore {
  readonly auditEvents: AuditEvent[] = [];
  private readonly accounts = new Map<string, Account>();
  private lock: Promise<void> = Promise.resolve();

  private async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.lock;
    let release: () => void = () => {};
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async provisionAccount(identity: AccessIdentity, now = new Date()): Promise<Account> {
    return this.transaction(() => {
      const existing = [...this.accounts.values()].find(
        (account) => account.accessIssuer === identity.issuer && account.accessSubject === identity.subject,
      );
      if (existing) {
        const updated = {
          ...existing,
          email: identity.email,
          displayName: identity.displayName,
          lastLoginAt: now,
          updatedAt: now,
          version: existing.version + 1,
        };
        this.accounts.set(updated.id, updated);
        return copyAccount(updated);
      }

      const bootstrap = this.accounts.size === 0;
      const account: Account = {
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
      };
      this.accounts.set(account.id, account);
      this.auditEvents.push({
        id: randomUUID(),
        actorId: null,
        action: "account.provisioned",
        targetType: "account",
        targetId: account.id,
        outcome: "SUCCEEDED",
        metadata: { bootstrap, role: account.role, status: account.status },
        occurredAt: now,
      });
      return copyAccount(account);
    });
  }

  async listAccounts(): Promise<Account[]> {
    return [...this.accounts.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(copyAccount);
  }

  async getAccount(id: string): Promise<Account | null> {
    const account = this.accounts.get(id);
    return account ? copyAccount(account) : null;
  }

  async updateAccount(actorId: string, targetId: string, mutation: AccountMutation, now = new Date()): Promise<Account> {
    return this.transaction(() => {
      const actor = this.accounts.get(actorId);
      const target = this.accounts.get(targetId);
      if (!actor || !target) throw new AccountPolicyError("ACCOUNT_NOT_FOUND", "Account was not found.");
      if (target.version !== mutation.expectedVersion) {
        throw new AccountPolicyError("VERSION_CONFLICT", "Account changed since it was loaded.");
      }
      const activeOwnerCount = [...this.accounts.values()].filter(
        (account) => account.role === "OWNER" && account.status === "APPROVED",
      ).length;
      authorizeAccountMutation(actor, target, mutation, activeOwnerCount);

      const updated: Account = {
        ...target,
        role: mutation.role ?? target.role,
        status: mutation.status ?? target.status,
        updatedAt: now,
        version: target.version + 1,
      };
      this.accounts.set(updated.id, updated);
      this.auditEvents.push({
        id: randomUUID(),
        actorId: actor.id,
        action: "account.updated",
        targetType: "account",
        targetId: updated.id,
        outcome: "SUCCEEDED",
        metadata: { role: updated.role, status: updated.status, version: updated.version },
        occurredAt: now,
      });
      return copyAccount(updated);
    });
  }
}
