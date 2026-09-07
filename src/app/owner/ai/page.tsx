import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth/page";

export default async function OwnerAiPage() {
  await requirePageRole(["OWNER"]);
  redirect("/owner/agent");
}
