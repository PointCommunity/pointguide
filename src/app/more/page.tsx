import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requirePageRole } from "@/lib/auth/page";
export default async function MorePage() { await requirePageRole(["TRAINER", "ADMIN", "OWNER"]); return <AppShell><section className="welcome-panel compact-welcome"><p className="eyebrow">PointGuide</p><h1>More</h1><p>Your role-specific tools remain in the bottom navigation.</p></section><nav className="more-links" aria-label="Additional destinations"><Link href="/account">Account</Link><Link href="/knowledge">Knowledge sources</Link></nav></AppShell>; }
