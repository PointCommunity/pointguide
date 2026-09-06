import type { Metadata } from "next";
import { AccessState } from "@/components/access-state";

export const metadata: Metadata = { title: "Approval pending" };

export default function PendingPage() {
  return <AccessState state="pending" />;
}
