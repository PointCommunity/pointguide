import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";
import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
export default async function KnowledgePage() { await requirePageRole(["TRAINER", "ADMIN", "OWNER"]); return <AppShell><KnowledgeWorkspace /></AppShell>; }
