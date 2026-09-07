import type { Metadata } from "next";
import { AccountsWorkspace } from "@/components/accounts-workspace";
import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requirePageRole(["ADMIN", "OWNER"]);
  return <AppShell><AccountsWorkspace /></AppShell>;
}
