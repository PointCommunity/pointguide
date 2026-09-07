import type { Metadata } from "next";
import { AgentSettingsWorkspace } from "@/components/ai-settings-workspace";
import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Agent Setup" };

export default async function OwnerAgentPage() {
  await requirePageRole(["OWNER"]);
  return <AppShell><AgentSettingsWorkspace /></AppShell>;
}
