import type { Metadata } from "next";
import { AccessState } from "@/components/access-state";

export const metadata: Metadata = { title: "Access suspended" };

export default function SuspendedPage() {
  return <AccessState state="suspended" />;
}
