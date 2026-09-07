import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { AskWorkspace } from "@/components/ask-workspace";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Support session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(["USER", "TRAINER", "ADMIN", "OWNER"]);
  const { id } = await params;
  return <AppShell><AskWorkspace resumeConversationId={id} /></AppShell>;
}
