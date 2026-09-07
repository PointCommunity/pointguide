import { TrainingWorkspace } from "@/components/training-workspace";
import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";
export default async function TrainingPage() { await requirePageRole(["TRAINER", "ADMIN", "OWNER"]); return <AppShell><TrainingWorkspace /></AppShell>; }
