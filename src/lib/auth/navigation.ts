import type { AccountRole, AccountStatus } from "@/lib/auth/types";

export type NavigationKey = "ask" | "knowledge" | "training" | "admin" | "owner";

const roleNavigation: Record<AccountRole, readonly NavigationKey[]> = {
  USER: ["ask"],
  TRAINER: ["ask", "knowledge", "training"],
  ADMIN: ["ask", "knowledge", "training", "admin"],
  OWNER: ["ask", "knowledge", "training", "admin", "owner"],
};

export function allowedNavigationKeys(role: AccountRole): readonly NavigationKey[] {
  return roleNavigation[role];
}

const allApprovedRoles = ["USER", "TRAINER", "ADMIN", "OWNER"] as const;

export function rolesForPath(pathname: string): readonly AccountRole[] {
  if (pathname.startsWith("/owner/")) return ["OWNER"];
  if (pathname.startsWith("/admin/")) return ["ADMIN", "OWNER"];
  if (pathname === "/knowledge" || pathname === "/more" || pathname.startsWith("/training")) return ["TRAINER", "ADMIN", "OWNER"];
  return allApprovedRoles;
}

export function lifecycleDestination(status: AccountStatus): "/pending" | "/suspended" | null {
  if (status === "PENDING") return "/pending";
  if (status === "SUSPENDED") return "/suspended";
  return null;
}
