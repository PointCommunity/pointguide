import { z } from "zod";
import { extractAccessAssertion, verifyAccessAssertion } from "@/lib/auth/access";
import type { AccessIdentity, Account, AccountStore } from "@/lib/auth/types";

export interface SessionConfig {
  mode: "cloudflare" | "fixture";
  nodeEnv: "development" | "test" | "production";
  teamDomain: string | undefined;
  audience: string | undefined;
  fallbackFixtureIdentity: { subject: string; email: string; displayName?: string | null } | undefined;
}

export interface SessionDependencies {
  store: AccountStore;
  config: SessionConfig;
}

export class SessionError extends Error {
  readonly code = "AUTH_REQUIRED";

  constructor() {
    super("A valid Cloudflare Access identity is required.");
    this.name = "SessionError";
  }
}

const fixtureIdentitySchema = z.object({
  subject: z.string().trim().min(1).max(160),
  email: z.string().trim().pipe(z.email()).transform((value) => value.toLocaleLowerCase("en-US")),
  displayName: z.string().trim().min(1).max(160).nullable().optional(),
});

function fixtureIdentity(request: Request, config: SessionConfig): AccessIdentity {
  if (config.nodeEnv === "production") throw new SessionError();
  const candidate = {
    subject: request.headers.get("x-pointguide-fixture-subject") ?? config.fallbackFixtureIdentity?.subject,
    email: request.headers.get("x-pointguide-fixture-email") ?? config.fallbackFixtureIdentity?.email,
    displayName: request.headers.get("x-pointguide-fixture-name") ?? config.fallbackFixtureIdentity?.displayName ?? null,
  };
  const parsed = fixtureIdentitySchema.safeParse(candidate);
  if (!parsed.success) throw new SessionError();
  return {
    issuer: "https://fixture.pointguide.invalid",
    subject: parsed.data.subject,
    email: parsed.data.email,
    displayName: parsed.data.displayName ?? null,
  };
}

async function cloudflareIdentity(request: Request, config: SessionConfig): Promise<AccessIdentity> {
  const token = extractAccessAssertion(request);
  if (!token || !config.teamDomain || !config.audience) throw new SessionError();
  try {
    return await verifyAccessAssertion(token, {
      teamDomain: config.teamDomain,
      audience: config.audience,
    });
  } catch {
    throw new SessionError();
  }
}

export async function authenticateRequest(request: Request, dependencies: SessionDependencies): Promise<Account> {
  const identity = dependencies.config.mode === "fixture"
    ? fixtureIdentity(request, dependencies.config)
    : await cloudflareIdentity(request, dependencies.config);
  return dependencies.store.provisionAccount(identity);
}
