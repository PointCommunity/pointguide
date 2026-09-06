import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  extractAccessAssertion,
  normalizeTeamDomain,
  verifyAccessAssertion,
} from "@/lib/auth/access";

const issuer = "https://pointguide.cloudflareaccess.com";
const audience = "pointguide-audience";
let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  publicKey = keys.publicKey;
});

async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  const payload: Record<string, unknown> = {
    sub: "identity-1",
    email: " Owner@Example.com ",
    type: "app",
    ...overrides,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(typeof payload.iss === "string" ? payload.iss : issuer)
    .setAudience(typeof payload.aud === "string" ? payload.aud : audience)
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(typeof payload.exp === "number" ? payload.exp : now + 60)
    .sign(privateKey);
}

describe("Cloudflare Access assertions", () => {
  it("verifies signature, issuer, audience, subject, type, expiry, and email", async () => {
    const identity = await verifyAccessAssertion(await token(), {
      teamDomain: issuer,
      audience,
      key: publicKey,
    });

    expect(identity).toEqual({
      issuer,
      subject: "identity-1",
      email: "owner@example.com",
      displayName: null,
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://other.cloudflareaccess.com" }, "INVALID_ASSERTION"],
    ["wrong audience", { aud: "other-app" }, "INVALID_ASSERTION"],
    ["expired", { exp: Math.floor(Date.now() / 1_000) - 60 }, "INVALID_ASSERTION"],
    ["missing subject", { sub: "" }, "INVALID_IDENTITY"],
    ["missing email", { email: "" }, "INVALID_IDENTITY"],
    ["non-app token", { type: "org" }, "INVALID_IDENTITY"],
  ])("rejects %s", async (_name, overrides, code) => {
    await expect(verifyAccessAssertion(await token(overrides), {
      teamDomain: issuer,
      audience,
      key: publicKey,
    })).rejects.toMatchObject({ code });
  });

  it("prefers the Access assertion header and falls back to its cookie", () => {
    const withHeader = new Request("https://pointguide.example.test", {
      headers: {
        cookie: "CF_Authorization=cookie-token",
        "cf-access-jwt-assertion": "header-token",
      },
    });
    const withCookie = new Request("https://pointguide.example.test", {
      headers: { cookie: "other=x; CF_Authorization=cookie-token; last=y" },
    });

    expect(extractAccessAssertion(withHeader)).toBe("header-token");
    expect(extractAccessAssertion(withCookie)).toBe("cookie-token");
    expect(extractAccessAssertion(new Request("https://pointguide.example.test"))).toBeNull();
  });

  it("accepts only a canonical HTTPS Cloudflare Access team domain", () => {
    expect(normalizeTeamDomain("https://PointGuide.cloudflareaccess.com/")).toBe(issuer);
    expect(() => normalizeTeamDomain("http://pointguide.cloudflareaccess.com")).toThrow("HTTPS");
    expect(() => normalizeTeamDomain("https://pointguide.cloudflareaccess.com/path")).toThrow("origin");
    expect(() => normalizeTeamDomain("https://example.com")).toThrow("cloudflareaccess.com");
  });
});
