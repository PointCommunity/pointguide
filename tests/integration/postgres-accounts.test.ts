import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDatabase } from "@/db/client";
import { PostgresAccountStore } from "@/db/accounts";
import { accounts, auditEvents } from "@/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseTest = testDatabaseUrl ? it : it.skip;

function assertDisposableDatabaseUrl(value: string): string {
  const url = new URL(value);
  const databaseName = url.pathname.slice(1);
  const localHost = ["127.0.0.1", "localhost", "postgres"].includes(url.hostname);
  if (!localHost || !databaseName.endsWith("_test")) {
    throw new Error("PostgreSQL integration tests require a local database whose name ends in _test.");
  }
  return value;
}

describe("PostgreSQL account governance", () => {
  databaseTest("serializes a real empty-table bootstrap without a stale transaction snapshot", async () => {
    const database = getDatabase(assertDisposableDatabaseUrl(testDatabaseUrl as string));
    await database.delete(auditEvents);
    await database.delete(accounts);
    const store = new PostgresAccountStore(database);
    const issuer = `https://test-${randomUUID()}.cloudflareaccess.com`;
    const identity = (subject: string) => ({ issuer, subject, email: `${subject}@example.com`, displayName: subject });

    const results = await Promise.all([
      store.provisionAccount(identity("race-a")),
      store.provisionAccount(identity("race-b")),
    ]);

    expect(results.filter((account) => account.role === "OWNER" && account.status === "APPROVED")).toHaveLength(1);
    expect(results.filter((account) => account.role === "USER" && account.status === "PENDING")).toHaveLength(1);
  });
});
