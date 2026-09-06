import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { accounts, auditEvents } from "@/db/schema";

describe("identity database schema", () => {
  it("keeps Cloudflare subjects unique within their issuer", () => {
    const config = getTableConfig(accounts);
    const uniqueColumns = config.uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name));

    expect(uniqueColumns).toContainEqual(["access_issuer", "access_subject"]);
    expect(config.checks.map((check) => check.name)).toContain("accounts_version_positive");
  });

  it("defines append-only audit records without secret-shaped columns", () => {
    const config = getTableConfig(auditEvents);
    const columns = config.columns.map((column) => column.name);

    expect(columns).toEqual(expect.arrayContaining(["actor_id", "action", "target_type", "target_id", "metadata", "occurred_at"]));
    expect(columns.join(" ")).not.toMatch(/secret|token|password|credential/i);
  });

  it("ships an additive SQL migration with database-enforced identity invariants", async () => {
    const sql = await readFile(new URL("../../migrations/0001_identity.sql", import.meta.url), "utf8");

    expect(sql).toContain("CREATE TYPE account_role");
    expect(sql).toContain("CREATE TYPE account_status");
    expect(sql).toContain("UNIQUE (access_issuer, access_subject)");
    expect(sql).toContain("CHECK (version > 0)");
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? audit_events/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|TYPE|COLUMN)/i);
  });
});
