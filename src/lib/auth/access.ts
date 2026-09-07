import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { AccessIdentity } from "@/lib/auth/types";

export type AccessAssertionErrorCode = "MISSING_ASSERTION" | "INVALID_ASSERTION" | "INVALID_IDENTITY" | "INVALID_TEAM_DOMAIN";

export class AccessAssertionError extends Error {
  constructor(public readonly code: AccessAssertionErrorCode, message: string) {
    super(message);
    this.name = "AccessAssertionError";
  }
}

const identityClaimsSchema = z.object({
  sub: z.string().trim().min(1),
  email: z.string().trim().pipe(z.email()).transform((value) => value.toLocaleLowerCase("en-US")),
  type: z.literal("app"),
  name: z.string().trim().min(1).max(160).optional(),
});

const remoteKeys = new Map<string, JWTVerifyGetKey>();

export function normalizeTeamDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AccessAssertionError("INVALID_TEAM_DOMAIN", "Cloudflare Access team domain must be a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new AccessAssertionError("INVALID_TEAM_DOMAIN", "Cloudflare Access team domain must use HTTPS.");
  }
  if (url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new AccessAssertionError("INVALID_TEAM_DOMAIN", "Cloudflare Access team domain must be an origin without credentials, port, path, query, or fragment.");
  }
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(url.hostname)) {
    throw new AccessAssertionError("INVALID_TEAM_DOMAIN", "Cloudflare Access team domain must end in cloudflareaccess.com.");
  }
  return url.origin.toLocaleLowerCase("en-US");
}

function getRemoteKey(teamDomain: string): JWTVerifyGetKey {
  const existing = remoteKeys.get(teamDomain);
  if (existing) return existing;
  // Cloudflare recommends the rotating team-domain JWKS endpoint, and jose caches
  // remote keys with bounded refreshes. Sources:
  // https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
  // https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md
  const key = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", `${teamDomain}/`), {
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
  remoteKeys.set(teamDomain, key);
  return key;
}

export function extractAccessAssertion(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (header) return header;

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const item of cookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== "CF_Authorization") continue;
    const value = item.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

export async function verifyAccessAssertion(
  token: string,
  options: { teamDomain: string; audience: string; key?: CryptoKey | Uint8Array | JWTVerifyGetKey },
): Promise<AccessIdentity> {
  const teamDomain = normalizeTeamDomain(options.teamDomain);
  if (!token.trim()) throw new AccessAssertionError("MISSING_ASSERTION", "Cloudflare Access assertion is required.");
  if (!options.audience.trim()) throw new AccessAssertionError("INVALID_ASSERTION", "Cloudflare Access audience is required.");

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, options.key ?? getRemoteKey(teamDomain), {
      algorithms: ["RS256"],
      issuer: teamDomain,
      audience: options.audience,
      requiredClaims: ["sub", "email", "exp", "iat", "nbf"],
    }));
  } catch {
    throw new AccessAssertionError("INVALID_ASSERTION", "Cloudflare Access assertion could not be verified.");
  }

  const identity = identityClaimsSchema.safeParse(payload);
  if (!identity.success) {
    throw new AccessAssertionError("INVALID_IDENTITY", "Cloudflare Access assertion does not contain a valid application identity.");
  }
  return {
    issuer: teamDomain,
    subject: identity.data.sub,
    email: identity.data.email,
    displayName: identity.data.name ?? null,
  };
}
