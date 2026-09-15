import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import { MemorySourceRepositoryStore } from "@/lib/sources/store";
import { POST } from "@/app/api/knowledge/sources/refresh/route";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { getRuntimeSourceStore } from "@/lib/sources/runtime";

vi.mock("@/lib/auth/runtime", () => ({ getRuntimeSessionDependencies: vi.fn() }));
vi.mock("@/lib/sources/runtime", () => ({ getRuntimeSourceStore: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("refresh authorization boundary", () => {
  it.each(["USER", "TRAINER", "ADMIN", "OWNER", "PENDING", "SUSPENDED", "ANONYMOUS", "CROSS_ORIGIN"])("checks %s before reading sources", async role => {
    const accounts = new MemoryAccountStore();
    const identity = (subject: string) => ({ issuer: "https://fixture.pointguide.invalid", subject, email: `${subject}@example.com`, displayName: subject });
    const owner = await accounts.provisionAccount(identity("owner"));
    if (!["OWNER", "ANONYMOUS", "CROSS_ORIGIN"].includes(role)) {
      const user = await accounts.provisionAccount(identity("user"));
      if (role !== "PENDING") await accounts.updateAccount(owner.id, user.id, { expectedVersion: user.version, status: role === "SUSPENDED" ? "SUSPENDED" : "APPROVED", role: ["TRAINER", "ADMIN"].includes(role) ? role as "TRAINER" | "ADMIN" : "USER" });
    }
    vi.mocked(getRuntimeSessionDependencies).mockReturnValue({ store: accounts, config: { mode: "fixture", nodeEnv: "test", teamDomain: undefined, audience: undefined, fallbackFixtureIdentity: undefined } });
    const store = new MemorySourceRepositoryStore(false); const list = vi.spyOn(store, "list");
    vi.mocked(getRuntimeSourceStore).mockReturnValue(store);
    const headers = new Headers();
    if (role !== "ANONYMOUS") { const subject = ["OWNER", "CROSS_ORIGIN"].includes(role) ? "owner" : "user"; headers.set("x-pointguide-fixture-subject", subject); headers.set("x-pointguide-fixture-email", `${subject}@example.com`); }
    if (role === "CROSS_ORIGIN") headers.set("origin", "https://evil.example");
    const response = await POST(new Request("http://localhost/api/knowledge/sources/refresh", { method: "POST", headers }));
    if (["OWNER", "TRAINER", "ADMIN"].includes(role)) { expect(response.status).toBe(200); expect(await response.text()).toContain('"type":"done"'); expect(list).toHaveBeenCalledOnce(); }
    else { expect(response.status).toBe(role === "ANONYMOUS" ? 401 : 403); expect(list).not.toHaveBeenCalled(); }
  });
});
