import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { agentProfiles, applicationSettings, promptRevisions, providerConnections, providerModels } from "@/db/schema";

describe("provider database schema", () => {
  it("models connections, catalogs, profiles, prompt revisions, and settings", () => {
    expect(getTableConfig(providerConnections).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "provider", "status", "encrypted_secret", "external_secret_ref", "credential_location", "account_label", "catalog_refreshed_at", "last_error_code", "version",
    ]));
    expect(getTableConfig(providerModels).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "connection_id", "model_id", "reasoning_efforts", "catalog_digest", "available",
    ]));
    expect(getTableConfig(agentProfiles).columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "role", "connection_id", "model_id", "reasoning_effort", "active_prompt_revision_id", "version",
    ]));
    expect(getTableConfig(promptRevisions).columns.map((column) => column.name)).toContain("core_policy_revision");
    expect(getTableConfig(applicationSettings).columns.map((column) => column.name)).toContain("value");
  });

  it("ships an additive migration with credential and profile invariants", async () => {
    const sql = await readFile(new URL("../../migrations/0002_providers.sql", import.meta.url), "utf8");

    expect(sql).toContain("CREATE TYPE provider_kind");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS provider_connections");
    expect(sql).toContain("provider_connections_secret_exclusive");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS agent_profiles");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS prompt_revisions");
    expect(sql).not.toMatch(/DROP\s+(TABLE|TYPE|COLUMN)/i);
  });
});
