import { describe, expect, it } from "vitest";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import { handleAccountList, handleAccountUpdate, handleDisplayNameUpdate, handleSession } from "@/lib/auth/http";
import type { SessionDependencies } from "@/lib/auth/session";

function request(subject: string, email = `${subject}@example.com`, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("x-pointguide-fixture-subject", subject);
  headers.set("x-pointguide-fixture-email", email);
  return new Request("http://localhost/api/session", { ...init, headers });
}

function dependencies(store = new MemoryAccountStore()): SessionDependencies {
  return {
    store,
    config: {
      mode: "fixture",
      nodeEnv: "test",
      teamDomain: undefined,
      audience: undefined,
      fallbackFixtureIdentity: undefined,
    },
  };
}

describe("account API boundary", () => {
  it("returns 200 for the bootstrap Owner and 202 for a later Pending account", async () => {
    const deps = dependencies();

    const ownerResponse = await handleSession(request("owner"), deps);
    const pendingResponse = await handleSession(request("pending"), deps);

    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toMatchObject({ email: "owner@example.com", role: "OWNER", status: "APPROVED" });
    expect(pendingResponse.status).toBe(202);
    expect(await pendingResponse.json()).toMatchObject({ email: "pending@example.com", role: "USER", status: "PENDING" });
  });

  it("does not expose protected account data to a Pending identity", async () => {
    const deps = dependencies();
    await handleSession(request("owner"), deps);

    const response = await handleAccountList(request("pending"), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ACCOUNT_PENDING", message: "Account approval is pending." } });
  });

  it("lets an Owner approve a Pending identity and then lists only public account fields", async () => {
    const deps = dependencies();
    const owner = await (await handleSession(request("owner"), deps)).json();
    const pending = await (await handleSession(request("pending"), deps)).json();
    const updateRequest = request("owner", undefined, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: pending.version, role: "TRAINER", status: "APPROVED" }),
    });

    const update = await handleAccountUpdate(updateRequest, pending.id, deps);
    const listing = await handleAccountList(request("owner"), deps);
    const body = await listing.json();

    expect(owner.role).toBe("OWNER");
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ id: pending.id, role: "TRAINER", status: "APPROVED" });
    expect(body.accounts).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/accessIssuer|accessSubject/i);
  });

  it("returns bounded errors for malformed input and forbidden Owner assignment", async () => {
    const deps = dependencies();
    const owner = await (await handleSession(request("owner"), deps)).json();
    const adminCandidate = await (await handleSession(request("admin"), deps)).json();
    const adminUpdate = request("owner", undefined, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: adminCandidate.version, role: "ADMIN", status: "APPROVED" }),
    });
    const admin = await (await handleAccountUpdate(adminUpdate, adminCandidate.id, deps)).json();
    const user = await (await handleSession(request("user"), deps)).json();

    const malformed = await handleAccountUpdate(request("owner", undefined, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: "stale", role: "ROOT" }),
    }), user.id, deps);
    const forbidden = await handleAccountUpdate(request("admin", undefined, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: user.version, role: "OWNER" }),
    }), user.id, deps);

    expect(owner.role).toBe("OWNER");
    expect(admin.role).toBe("ADMIN");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "Account update is invalid." } });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: { code: "OWNER_ONLY", message: "Only an Owner can change Owner membership." } });
  });

  it("rejects fixture identity headers in production", async () => {
    const deps = dependencies();
    deps.config.nodeEnv = "production";

    const response = await handleSession(request("spoofed"), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED", message: "A valid Cloudflare Access identity is required." } });
  });

  it("lets an approved account edit its display name without changing access", async () => {
    const deps = dependencies();
    const original = await (await handleSession(request("owner"), deps)).json();
    const response = await handleDisplayNameUpdate(request("owner", undefined, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "  Chris Nelson  ", expectedVersion: original.version }),
    }), deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Chris Nelson", role: "OWNER", status: "APPROVED" });
  });

  it("hides Owners from Admin account listings while Owners see every account", async () => {
    const deps = dependencies();
    const owner = await (await handleSession(request("owner"), deps)).json();
    const pendingAdmin = await (await handleSession(request("admin"), deps)).json();
    await handleAccountUpdate(request("owner", undefined, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: pendingAdmin.version, role: "ADMIN", status: "APPROVED" }),
    }), pendingAdmin.id, deps);

    const adminListing = await (await handleAccountList(request("admin"), deps)).json();
    const ownerListing = await (await handleAccountList(request("owner"), deps)).json();

    expect(adminListing.accounts.map((account: { role: string }) => account.role)).not.toContain("OWNER");
    expect(ownerListing.accounts.map((account: { id: string }) => account.id)).toContain(owner.id);
  });
});
