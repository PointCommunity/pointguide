"use client";
import { useEffect, useState } from "react";
interface Account { email: string; displayName: string | null; role: string; status: string; version: number }
export function AccountWorkspace() {
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => { let active = true; void fetch("/api/session", { cache: "no-store" }).then((response) => response.json() as Promise<Account>).then((value) => { if (active) { setAccount(value); setName(value.displayName ?? ""); } }); return () => { active = false; }; }, []);
  async function saveName() {
    if (!account || name.trim().length < 2) return;
    setSaveState("saving");
    const response = await fetch("/api/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, expectedVersion: account.version }) });
    if (!response.ok) { setSaveState("error"); return; }
    const updated = await response.json() as Account;
    setAccount(updated); setName(updated.displayName ?? ""); setSaveState("saved");
  }
  return <><section className="welcome-panel compact-welcome"><p className="eyebrow">Your access</p><h1>Account</h1><p>Update how your name appears in PointGuide. Your verified email and access are managed separately.</p></section>{account ? <section className="account-summary compact-card"><label className="account-name-field">Display name<input value={name} minLength={2} maxLength={80} onChange={(event) => { setName(event.target.value); setSaveState("idle"); }} /><button type="button" onClick={() => void saveName()} disabled={saveState === "saving" || name.trim().length < 2 || name.trim() === (account.displayName ?? "")}>{saveState === "saving" ? "Saving…" : "Save name"}</button></label>{saveState === "saved" ? <p className="settings-success" role="status">Name updated.</p> : null}{saveState === "error" ? <p className="settings-error" role="alert">Name could not be saved. Refresh and try again.</p> : null}<dl><div><dt>Email</dt><dd>{account.email}</dd></div><div><dt>Role</dt><dd>{account.role}</dd></div><div><dt>Status</dt><dd>{account.status}</dd></div></dl></section> : <p className="loading-state">Loading account…</p>}</>;
}
