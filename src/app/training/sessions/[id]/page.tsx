import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { TrainingWorkspace } from "@/components/training-workspace";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Training Session" };

export default async function TrainingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(["TRAINER", "ADMIN", "OWNER"]);
  const { id } = await params;
  return <AppShell><TrainingWorkspace resumeSessionId={id} /></AppShell>;
}
