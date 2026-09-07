import { describe, expect, it } from "vitest";
import { allowedNavigationKeys, lifecycleDestination } from "@/lib/auth/navigation";

describe("role-aware application navigation", () => {
  it.each([
    ["USER", ["ask", "knowledge"]],
    ["TRAINER", ["ask", "knowledge", "training"]],
    ["ADMIN", ["ask", "knowledge", "training", "admin"]],
    ["OWNER", ["ask", "knowledge", "training", "admin", "owner"]],
  ] as const)("shows only authorized destinations to %s", (role, expected) => {
    expect(allowedNavigationKeys(role)).toEqual(expected);
  });

  it("routes lifecycle states before protected content is rendered", () => {
    expect(lifecycleDestination("PENDING")).toBe("/pending");
    expect(lifecycleDestination("SUSPENDED")).toBe("/suspended");
    expect(lifecycleDestination("APPROVED")).toBeNull();
  });
});
