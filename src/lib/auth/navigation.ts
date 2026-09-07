import type { AccountRole, AccountStatus } from "@/lib/auth/types";

export type NavigationKey = "ask" | "knowledge" | "training" | "admin" | "owner";

const roleNavigation: Record<AccountRole, readonly NavigationKey[]> = {
  USER: ["ask", "knowledge"],
  TRAINER: ["ask", "knowledge", "training"],
  ADMIN: ["ask", "knowledge", "training", "admin"],
  OWNER: ["ask", "knowledge", "training", "admin", "owner"],
};

export function allowedNavigationKeys(role: AccountRole): readonly NavigationKey[] {
  return roleNavigation[role];
}

export function lifecycleDestination(status: AccountStatus): "/pending" | "/suspended" | null {
  if (status === "PENDING") return "/pending";
  if (status === "SUSPENDED") return "/suspended";
  return null;
}
