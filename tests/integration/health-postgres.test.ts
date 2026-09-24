import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { getDatabase } from "@/db/client";
import { PostgresAccountStore } from "@/db/accounts";
import { PostgresSourceRepositoryStore } from "@/db/sources";
import { GET as readiness } from "@/app/api/readyz/route";
import { validateSourceRepository } from "@/lib/sources/validator";
import { sourceFiles, upstream } from "../fixtures/source-contract";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
(testDatabaseUrl ? it : it.skip)("checks repository readiness without loading every source chunk", async () => {
  const url = new URL(testDatabaseUrl!);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname) || !url.pathname.endsWith("_test")) throw new Error("A local disposable test database is required.");
  const database = getDatabase(url.toString());
  await database.execute(sql`truncate table accounts cascade`);
  await database.execute(sql`delete from source_repositories`);
  const actor = await new PostgresAccountStore(database).provisionAccount({ issuer: "https://pointguide.test", subject: "readiness-owner", email: "readiness@example.com", displayName: "Owner" });
  const source = await validateSourceRepository("https://github.com/PointCommunity/lighting", { fetcher: upstream(sourceFiles("PointCommunity/lighting", "Verified setup steps."), "PointCommunity/lighting") });
  await new PostgresSourceRepositoryStore(database).link(actor.id, source);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_MODE", "cloudflare"); vi.stubEnv("DATABASE_URL", url.toString());
  vi.stubEnv("CORPUS_ROOT", "/unused"); vi.stubEnv("CORPUS_COMMIT", "a".repeat(40));
  vi.spyOn(PostgresSourceRepositoryStore.prototype, "snapshot").mockRejectedValue(new Error("Readiness must not load the corpus."));
  const response = await readiness();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ready", mode: "repository", chunks: 1 });
});
