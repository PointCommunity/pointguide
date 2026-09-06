// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessState } from "@/components/access-state";
import { AccountsWorkspace } from "@/components/accounts-workspace";

const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.com",
  displayName: "Owner Person",
  role: "OWNER",
  status: "APPROVED",
  version: 2,
};
const pending = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "new@example.com",
  displayName: "New Person",
  role: "USER",
  status: "PENDING",
  version: 1,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("account governance interface", () => {
  it("explains Pending and Suspended lifecycle states without exposing app data", () => {
    const { rerender } = render(<AccessState state="pending" />);
    expect(screen.getByRole("heading", { name: "Access request received" })).toBeTruthy();
    expect(screen.getByText(/Owner or Admin approves/)).toBeTruthy();

    rerender(<AccessState state="suspended" />);
    expect(screen.getByRole("heading", { name: "Account access suspended" })).toBeTruthy();
    expect(screen.getByText(/contact a PointGuide Owner or Admin/i)).toBeTruthy();
  });

  it("lets an Owner assign role and lifecycle from a touch-friendly account card", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ actor: owner, accounts: [owner, pending] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...pending, role: "TRAINER", status: "APPROVED", version: 2 })));

    render(<AccountsWorkspace />);
    const card = await screen.findByRole("article", { name: "New Person account" });
    fireEvent.change(within(card).getByLabelText("Role"), { target: { value: "TRAINER" } });
    fireEvent.change(within(card).getByLabelText("Access"), { target: { value: "APPROVED" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save access" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/admin/users/${pending.id}`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(await screen.findByText("Access updated.")).toBeTruthy();
  });

  it("does not render Owner as an assignable role for an Admin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      actor: { ...owner, role: "ADMIN" },
      accounts: [{ ...pending, status: "APPROVED" }],
    })));

    render(<AccountsWorkspace />);
    const role = await screen.findByLabelText("Role");
    expect(within(role).queryByRole("option", { name: "Owner" })).toBeNull();
  });
});
