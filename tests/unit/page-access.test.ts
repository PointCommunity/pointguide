import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getRuntimeSessionDependencies: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`); }),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/auth/runtime", () => ({ getRuntimeSessionDependencies: mocks.getRuntimeSessionDependencies }));

import { requirePageRole } from "@/lib/auth/page";
import type { Account } from "@/lib/auth/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    accessIssuer: "https://pointguide.test",
    accessSubject: "subject-1",
    email: "user@example.com",
    displayName: "PointGuide User",
    role: "USER",
    status: "APPROVED",
    firstLoginAt: new Date("2026-09-06T00:00:00.000Z"),
    lastLoginAt: new Date("2026-09-06T00:00:00.000Z"),
    createdAt: new Date("2026-09-06T00:00:00.000Z"),
    updatedAt: new Date("2026-09-06T00:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

describe("server page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeSessionDependencies.mockReturnValue({ config: { mode: "fixture" } });
  });

  it("uses the fixture session endpoint and forwards fixture identity headers", async () => {
    const requestHeaders = new Headers({
      host: "pointguide.test",
      "x-forwarded-proto": "https",
      "x-pointguide-fixture-subject": "fixture-owner",
      "x-pointguide-fixture-email": "owner@example.com",
      "x-pointguide-fixture-name": "Owner",
    });
    mocks.headers.mockResolvedValue(requestHeaders);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(account({ role: "OWNER" })));

    await expect(requirePageRole(["OWNER"])).resolves.toMatchObject({ role: "OWNER" });
    expect(fetcher).toHaveBeenCalledWith("https://pointguide.test/api/session", expect.objectContaining({ cache: "no-store" }));
    const sentHeaders = (fetcher.mock.calls[0]?.[1] as RequestInit).headers as Headers;
    expect(sentHeaders.get("x-pointguide-fixture-name")).toBe("Owner");
    fetcher.mockRestore();
  });

  it("uses safe fixture defaults and redirects pending accounts", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(account({ status: "PENDING" })));

    await expect(requirePageRole(["USER"])).rejects.toThrow("REDIRECT:/pending");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3000/api/session", expect.any(Object));
    fetcher.mockRestore();
  });

  it("redirects approved accounts that lack the page role", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(account()));

    await expect(requirePageRole(["ADMIN"])).rejects.toThrow("REDIRECT:/");
    fetcher.mockRestore();
  });

  it("authenticates directly outside fixture mode", async () => {
    const requestHeaders = new Headers({ "cf-access-authenticated-user-email": "admin@example.com" });
    mocks.headers.mockResolvedValue(requestHeaders);
    const dependencies = { config: { mode: "production" } };
    mocks.getRuntimeSessionDependencies.mockReturnValue(dependencies);
    mocks.authenticateRequest.mockResolvedValue(account({ role: "ADMIN" }));

    await expect(requirePageRole(["ADMIN", "OWNER"])).resolves.toMatchObject({ role: "ADMIN" });
    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), dependencies);
  });
});
