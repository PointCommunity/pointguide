import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TrainingSessionsWorkspace } from "@/components/training-sessions-workspace";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Training Sessions" };

export default async function TrainingSessionsPage() {
  await requirePageRole(["TRAINER", "ADMIN", "OWNER"]);
  return <AppShell><TrainingSessionsWorkspace /></AppShell>;
}
