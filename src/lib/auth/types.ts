export const accountRoles = ["USER", "TRAINER", "ADMIN", "OWNER"] as const;
export const accountStatuses = ["PENDING", "APPROVED", "SUSPENDED"] as const;

export type AccountRole = (typeof accountRoles)[number];
export type AccountStatus = (typeof accountStatuses)[number];

export interface AccessIdentity {
  issuer: string;
  subject: string;
  email: string;
  displayName: string | null;
}

export interface Account {
  id: string;
  accessIssuer: string;
  accessSubject: string;
  email: string;
  displayName: string | null;
  role: AccountRole;
  status: AccountStatus;
  firstLoginAt: Date;
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AccountMutation {
  expectedVersion: number;
  role?: AccountRole;
  status?: AccountStatus;
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  action: "account.provisioned" | "account.updated" | "account.name_updated";
  targetType: "account";
  targetId: string;
  outcome: "SUCCEEDED";
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: Date;
}

export interface AccountStore {
  provisionAccount(identity: AccessIdentity, now?: Date): Promise<Account>;
  listAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;
  updateAccount(actorId: string, targetId: string, mutation: AccountMutation, now?: Date): Promise<Account>;
  updateDisplayName(accountId: string, displayName: string, expectedVersion: number, now?: Date): Promise<Account>;
}
