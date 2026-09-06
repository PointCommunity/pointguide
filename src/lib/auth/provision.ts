import type { AccessIdentity, Account, AccountMutation, AccountStore } from "@/lib/auth/types";

export function provisionIdentity(store: AccountStore, identity: AccessIdentity): Promise<Account> {
  return store.provisionAccount(identity);
}

export function manageAccount(
  store: AccountStore,
  actorId: string,
  targetId: string,
  mutation: AccountMutation,
): Promise<Account> {
  return store.updateAccount(actorId, targetId, mutation);
}
