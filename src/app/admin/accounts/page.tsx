import type { Metadata } from "next";
import { AccountsWorkspace } from "@/components/accounts-workspace";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return <AppShell><AccountsWorkspace /></AppShell>;
}
