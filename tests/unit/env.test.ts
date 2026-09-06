import { describe, expect, it } from "vitest";
import { assertProductionEnvironment, parseEnvironment } from "@/lib/config/env";

describe("server environment", () => {
  it("uses conservative development defaults", () => {
    expect(parseEnvironment({})).toMatchObject({
      NODE_ENV: "development",
      AUTH_MODE: "cloudflare",
      REVIEW_ENABLED: false,
      LIVE_PROVIDERS_ENABLED: false,
      GIT_WRITES_ENABLED: false,
      WEB_SEARCH_ENABLED: false,
    });
  });

  it("parses explicit fixture flags", () => {
    expect(parseEnvironment({ AUTH_MODE: "fixture", REVIEW_ENABLED: "true" })).toMatchObject({
      AUTH_MODE: "fixture",
      REVIEW_ENABLED: true,
    });
  });

  it("reports invalid fields without echoing secret values", () => {
    expect(() => parseEnvironment({ APP_BASE_URL: "not-a-url", PROVIDER_SECRET_KEY: "sensitive" })).toThrow("APP_BASE_URL");
    try {
      parseEnvironment({ APP_BASE_URL: "not-a-url", PROVIDER_SECRET_KEY: "sensitive" });
    } catch (error) {
      expect(String(error)).not.toContain("sensitive");
    }
  });

  it("requires production identity, database, and encryption configuration", () => {
    const environment = parseEnvironment({ NODE_ENV: "production", AUTH_MODE: "fixture" });
    expect(() => assertProductionEnvironment(environment)).toThrow("DATABASE_URL, AUTH_MODE=cloudflare, CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUDIENCE, PROVIDER_SECRET_KEY");
  });

  it("accepts a complete production boundary without returning secrets", () => {
    const environment = parseEnvironment({
      NODE_ENV: "production",
      AUTH_MODE: "cloudflare",
      APP_BASE_URL: "https://pointguide.example.com",
      DATABASE_URL: "postgres://service/database",
      CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      CF_ACCESS_AUDIENCE: "audience",
      PROVIDER_SECRET_KEY: "base64-key",
    });
    expect(() => assertProductionEnvironment(environment)).not.toThrow();
  });
});
