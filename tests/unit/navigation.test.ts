import { describe, expect, it } from "vitest";
import { allowedNavigationKeys, lifecycleDestination, rolesForPath } from "@/lib/auth/navigation";

describe("role-aware application navigation", () => {
  it.each([
    ["USER", ["ask"]],
    ["TRAINER", ["ask", "knowledge", "training"]],
    ["ADMIN", ["ask", "knowledge", "training", "admin"]],
    ["OWNER", ["ask", "knowledge", "training", "admin", "owner"]],
  ] as const)("shows only authorized destinations to %s", (role, expected) => {
    expect(allowedNavigationKeys(role)).toEqual(expected);
  });

  it("maps protected pages to the same roles used by their APIs", () => {
    expect(rolesForPath("/admin/accounts")).toEqual(["ADMIN", "OWNER"]);
    expect(rolesForPath("/knowledge")).toEqual(["TRAINER", "ADMIN", "OWNER"]);
    expect(rolesForPath("/training/session")).toEqual(["TRAINER", "ADMIN", "OWNER"]);
    expect(rolesForPath("/more")).toEqual(["TRAINER", "ADMIN", "OWNER"]);
    expect(rolesForPath("/owner/agent")).toEqual(["OWNER"]);
    expect(rolesForPath("/")).toEqual(["USER", "TRAINER", "ADMIN", "OWNER"]);
  });

  it("routes lifecycle states before protected content is rendered", () => {
    expect(lifecycleDestination("PENDING")).toBe("/pending");
    expect(lifecycleDestination("SUSPENDED")).toBe("/suspended");
    expect(lifecycleDestination("APPROVED")).toBeNull();
  });
});
