import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { SessionsWorkspace } from "@/components/sessions-workspace";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage() {
  await requirePageRole(["USER", "TRAINER", "ADMIN", "OWNER"]);
  return <AppShell><SessionsWorkspace /></AppShell>;
}
