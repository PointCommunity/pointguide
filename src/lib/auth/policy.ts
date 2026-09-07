import type { Account, AccountMutation, AccountRole } from "@/lib/auth/types";

export type AccountPolicyErrorCode =
  | "ACCOUNT_PENDING"
  | "ACCOUNT_SUSPENDED"
  | "FORBIDDEN"
  | "OWNER_ONLY"
  | "SELF_CHANGE"
  | "FINAL_OWNER"
  | "VERSION_CONFLICT"
  | "ACCOUNT_NOT_FOUND"
  | "INVALID_MUTATION";

export class AccountPolicyError extends Error {
  constructor(public readonly code: AccountPolicyErrorCode, message: string) {
    super(message);
    this.name = "AccountPolicyError";
  }
}

export function requireApprovedAccount(account: Account): Account {
  if (account.status === "PENDING") throw new AccountPolicyError("ACCOUNT_PENDING", "Account approval is pending.");
  if (account.status === "SUSPENDED") throw new AccountPolicyError("ACCOUNT_SUSPENDED", "Account access is suspended.");
  return account;
}

export function requireRole(account: Account, roles: readonly AccountRole[]): Account {
  requireApprovedAccount(account);
  if (!roles.includes(account.role)) throw new AccountPolicyError("FORBIDDEN", "This account does not have permission for that action.");
  return account;
}

function removesActiveOwner(target: Account, mutation: AccountMutation): boolean {
  if (target.role !== "OWNER" || target.status !== "APPROVED") return false;
  const nextRole = mutation.role ?? target.role;
  const nextStatus = mutation.status ?? target.status;
  return nextRole !== "OWNER" || nextStatus !== "APPROVED";
}

export function authorizeAccountMutation(
  actor: Account,
  target: Account,
  mutation: AccountMutation,
  activeOwnerCount: number,
): void {
  requireRole(actor, ["ADMIN", "OWNER"]);
  if (mutation.role === undefined && mutation.status === undefined) {
    throw new AccountPolicyError("INVALID_MUTATION", "An account role or status change is required.");
  }
  if (removesActiveOwner(target, mutation) && activeOwnerCount <= 1) {
    throw new AccountPolicyError("FINAL_OWNER", "The final active Owner cannot be demoted or suspended.");
  }
  if (actor.id === target.id) {
    throw new AccountPolicyError("SELF_CHANGE", "Account managers cannot change their own role or status.");
  }
  if (actor.role !== "OWNER" && (target.role === "OWNER" || mutation.role === "OWNER")) {
    throw new AccountPolicyError("OWNER_ONLY", "Only an Owner can change Owner membership.");
  }
}
