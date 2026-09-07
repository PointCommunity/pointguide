"use client";
import { useEffect, useState } from "react";
interface Account { email: string; displayName: string | null; role: string; status: string }
export function AccountWorkspace() {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => { let active = true; void fetch("/api/session", { cache: "no-store" }).then((response) => response.json() as Promise<Account>).then((value) => { if (active) setAccount(value); }); return () => { active = false; }; }, []);
  return <><section className="welcome-panel compact-welcome"><p className="eyebrow">Your access</p><h1>Account</h1><p>Identity comes from Cloudflare Access. Permissions are approved and managed inside PointGuide.</p></section>{account ? <dl className="account-summary"><div><dt>Name</dt><dd>{account.displayName || "Not provided"}</dd></div><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Role</dt><dd>{account.role}</dd></div><div><dt>Status</dt><dd>{account.status}</dd></div></dl> : <p className="loading-state">Loading account…</p>}</>;
}
