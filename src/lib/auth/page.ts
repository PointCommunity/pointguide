import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateRequest } from "@/lib/auth/session";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { lifecycleDestination } from "@/lib/auth/navigation";
import type { Account, AccountRole } from "@/lib/auth/types";

export async function requirePageRole(roles: readonly AccountRole[]): Promise<Account> {
  const requestHeaders = await headers();
  const dependencies = getRuntimeSessionDependencies();
  let actor: Account;
  if (dependencies.config.mode === "fixture") {
    const host = requestHeaders.get("host") ?? "127.0.0.1:3000";
    const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
    const fixtureHeaders = new Headers();
    for (const name of ["x-pointguide-fixture-subject", "x-pointguide-fixture-email", "x-pointguide-fixture-name"]) {
      const value = requestHeaders.get(name); if (value) fixtureHeaders.set(name, value);
    }
    const response = await fetch(`${protocol}://${host}/api/session`, { headers: fixtureHeaders, cache: "no-store" });
    actor = await response.json() as Account;
  } else {
    actor = await authenticateRequest(new Request("https://pointguide.local", { headers: requestHeaders }), dependencies);
  }
  const destination = lifecycleDestination(actor.status);
  if (destination) redirect(destination);
  if (!roles.includes(actor.role)) redirect("/");
  return actor;
}
