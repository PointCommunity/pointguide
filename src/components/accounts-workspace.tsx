"use client";

import { useEffect, useState } from "react";

type Role = "USER" | "TRAINER" | "ADMIN" | "OWNER";
type Status = "PENDING" | "APPROVED" | "SUSPENDED";

interface PublicAccount {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: Status;
  version: number;
}

interface AccountListing {
  actor: PublicAccount;
  accounts: PublicAccount[];
}

const roleLabels: Record<Role, string> = { USER: "User", TRAINER: "Trainer", ADMIN: "Admin", OWNER: "Owner" };
const statusLabels: Record<Status, string> = { PENDING: "Pending", APPROVED: "Approved", SUSPENDED: "Suspended" };

function AccountCard({ account, actor, onUpdated }: {
  account: PublicAccount;
  actor: PublicAccount;
  onUpdated: (account: PublicAccount) => void;
}) {
  const [role, setRole] = useState<Role>(account.role);
  const [status, setStatus] = useState<Status>(account.status);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const self = account.id === actor.id;
  const ownerLockedForAdmin = actor.role !== "OWNER" && account.role === "OWNER";
  const locked = self || ownerLockedForAdmin;
  const assignableRoles: Role[] = actor.role === "OWNER" ? ["USER", "TRAINER", "ADMIN", "OWNER"] : ["USER", "TRAINER", "ADMIN"];

  async function save() {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/admin/users/${account.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: account.version, role, status }),
      });
      const payload = await response.json() as PublicAccount | { error?: { message?: string } };
      if (!response.ok || !("id" in payload)) throw new Error("error" in payload ? payload.error?.message : undefined);
      onUpdated(payload);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const name = account.displayName || account.email;
  return (
    <article className="account-card" aria-label={`${name} account`}>
      <header>
        <span className="avatar" aria-hidden="true">{name.slice(0, 2).toLocaleUpperCase("en-US")}</span>
        <span><strong>{name}</strong><small>{account.email}</small></span>
        <span className={`lifecycle ${account.status.toLocaleLowerCase("en-US")}`}>{statusLabels[account.status]}</span>
      </header>
      <div className="account-controls">
        <label>Role
          <select value={role} onChange={(event) => { setRole(event.target.value as Role); setSaveState("idle"); }} disabled={locked}>
            {assignableRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
          </select>
        </label>
        <label>Access
          <select value={status} onChange={(event) => { setStatus(event.target.value as Status); setSaveState("idle"); }} disabled={locked}>
            {(Object.keys(statusLabels) as Status[]).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void save()} disabled={locked || saveState === "saving" || (role === account.role && status === account.status)}>
          {saveState === "saving" ? "Saving…" : "Save access"}
        </button>
      </div>
      {locked ? <p className="account-hint">{self ? "Your own access must be changed by another Owner." : "Only an Owner can change Owner membership."}</p> : null}
      {saveState === "saved" ? <p className="account-success" role="status">Access updated.</p> : null}
      {saveState === "error" ? <p className="account-error" role="alert">The update was not saved. Refresh and try again.</p> : null}
    </article>
  );
}

export function AccountsWorkspace() {
  const [listing, setListing] = useState<AccountListing | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/users", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Account directory unavailable.");
        return response.json() as Promise<AccountListing>;
      })
      .then((payload) => { if (active) setListing(payload); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  function updateAccount(updated: PublicAccount) {
    setListing((current) => current ? {
      ...current,
      accounts: current.accounts.map((account) => account.id === updated.id ? updated : account),
    } : current);
  }

  return (
    <>
      <section className="welcome-panel compact-welcome" aria-labelledby="accounts-title">
        <p className="eyebrow">Access governance</p>
        <h1 id="accounts-title">Accounts</h1>
        <p>Approve verified identities and assign the least access they need. Owner membership remains Owner-only.</p>
      </section>
      {error ? <section className="error-panel" role="alert"><strong>Account directory unavailable.</strong><p>Your permissions may have changed, or the service may be temporarily unavailable.</p></section> : null}
      {!listing && !error ? <p className="loading-state" role="status">Loading verified accounts…</p> : null}
      {listing ? (
        <section className="accounts-section" aria-label="Verified accounts">
          <div className="section-heading"><div><p className="eyebrow">Directory</p><h2>People and access</h2></div><span>{listing.accounts.length} account{listing.accounts.length === 1 ? "" : "s"}</span></div>
          <div className="account-list">
            {listing.accounts.map((account) => <AccountCard key={account.id} account={account} actor={listing.actor} onUpdated={updateAccount} />)}
          </div>
        </section>
      ) : null}
    </>
  );
}
