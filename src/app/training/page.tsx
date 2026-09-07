import { TrainingWorkspace } from "@/components/training-workspace";
import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Training" };
export default async function TrainingPage() { await requirePageRole(["TRAINER", "ADMIN", "OWNER"]); return <AppShell><TrainingWorkspace /></AppShell>; }
