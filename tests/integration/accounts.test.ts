import { describe, expect, it } from "vitest";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import { AccountPolicyError, requireApprovedAccount } from "@/lib/auth/policy";
import { manageAccount, provisionIdentity } from "@/lib/auth/provision";
import type { AccessIdentity } from "@/lib/auth/types";

function identity(subject: string): AccessIdentity {
  return {
    issuer: "https://pointguide.cloudflareaccess.com",
    subject,
    email: `${subject}@example.com`,
    displayName: subject.replaceAll("-", " "),
  };
}

describe("account provisioning and governance", () => {
  it("creates exactly one approved Owner when first logins race", async () => {
    const store = new MemoryAccountStore();

    const accounts = await Promise.all([
      provisionIdentity(store, identity("first-person")),
      provisionIdentity(store, identity("second-person")),
    ]);

    expect(accounts.filter((account) => account.role === "OWNER" && account.status === "APPROVED")).toHaveLength(1);
    expect(accounts.filter((account) => account.role === "USER" && account.status === "PENDING")).toHaveLength(1);
    expect(await store.listAccounts()).toHaveLength(2);
  });

  it("returns the same account on later logins without changing its grant", async () => {
    const store = new MemoryAccountStore();
    const first = await provisionIdentity(store, identity("owner"));
    const again = await provisionIdentity(store, { ...identity("owner"), email: "OWNER@EXAMPLE.COM" });

    expect(again.id).toBe(first.id);
    expect(again.role).toBe("OWNER");
    expect(again.status).toBe("APPROVED");
    expect(again.version).toBe(first.version + 1);
    expect(await store.listAccounts()).toHaveLength(1);
  });

  it("blocks Pending and Suspended accounts at the protected-data boundary", async () => {
    const store = new MemoryAccountStore();
    const owner = await provisionIdentity(store, identity("owner"));
    const pending = await provisionIdentity(store, identity("pending"));
    const approved = await manageAccount(store, owner.id, pending.id, {
      expectedVersion: pending.version,
      role: "USER",
      status: "APPROVED",
    });
    const suspended = await manageAccount(store, owner.id, approved.id, {
      expectedVersion: approved.version,
      status: "SUSPENDED",
    });

    expect(() => requireApprovedAccount(pending)).toThrowError(expect.objectContaining({ code: "ACCOUNT_PENDING" }));
    expect(() => requireApprovedAccount(suspended)).toThrowError(expect.objectContaining({ code: "ACCOUNT_SUSPENDED" }));
    expect(requireApprovedAccount(owner)).toBe(owner);
  });

  it("allows Admins to assign non-Owner roles but reserves Owner membership for Owners", async () => {
    const store = new MemoryAccountStore();
    const owner = await provisionIdentity(store, identity("owner"));
    const adminCandidate = await provisionIdentity(store, identity("admin"));
    const admin = await manageAccount(store, owner.id, adminCandidate.id, {
      expectedVersion: adminCandidate.version,
      role: "ADMIN",
      status: "APPROVED",
    });
    const user = await provisionIdentity(store, identity("user"));

    const trainer = await manageAccount(store, admin.id, user.id, {
      expectedVersion: user.version,
      role: "TRAINER",
      status: "APPROVED",
    });
    expect(trainer).toMatchObject({ role: "TRAINER", status: "APPROVED" });

    await expect(manageAccount(store, admin.id, trainer.id, {
      expectedVersion: trainer.version,
      role: "OWNER",
    })).rejects.toMatchObject<Partial<AccountPolicyError>>({ code: "OWNER_ONLY" });

    const promoted = await manageAccount(store, owner.id, trainer.id, {
      expectedVersion: trainer.version,
      role: "OWNER",
    });
    expect(promoted.role).toBe("OWNER");
  });

  it("rejects unsafe self changes, stale versions, and removal of the final active Owner", async () => {
    const store = new MemoryAccountStore();
    const owner = await provisionIdentity(store, identity("owner"));

    await expect(manageAccount(store, owner.id, owner.id, {
      expectedVersion: owner.version,
      status: "SUSPENDED",
    })).rejects.toMatchObject<Partial<AccountPolicyError>>({ code: "FINAL_OWNER" });

    const second = await provisionIdentity(store, identity("second"));
    const secondOwner = await manageAccount(store, owner.id, second.id, {
      expectedVersion: second.version,
      role: "OWNER",
      status: "APPROVED",
    });

    await expect(manageAccount(store, owner.id, owner.id, {
      expectedVersion: owner.version,
      role: "ADMIN",
    })).rejects.toMatchObject<Partial<AccountPolicyError>>({ code: "SELF_CHANGE" });

    await expect(manageAccount(store, secondOwner.id, owner.id, {
      expectedVersion: 999,
      role: "ADMIN",
    })).rejects.toMatchObject<Partial<AccountPolicyError>>({ code: "VERSION_CONFLICT" });
  });

  it("writes bounded audit events for provisioning and account changes", async () => {
    const store = new MemoryAccountStore();
    const owner = await provisionIdentity(store, identity("owner"));
    const pending = await provisionIdentity(store, identity("pending"));
    await manageAccount(store, owner.id, pending.id, {
      expectedVersion: pending.version,
      status: "APPROVED",
    });

    expect(store.auditEvents.map((event) => event.action)).toEqual([
      "account.provisioned",
      "account.provisioned",
      "account.updated",
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain("@example.com");
  });
});
