import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const sql = postgres(databaseUrl, { max:1, onnotice:() => {} });
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, digest TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`SELECT pg_advisory_lock(hashtextextended('pointguide:migrations:v1', 0))`;
  for (const name of (await readdir(resolve("migrations"))).filter((value) => /^\d+.*\.sql$/u.test(value)).sort()) {
    const source = await readFile(resolve("migrations", name), "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const [existing] = await sql`SELECT digest FROM schema_migrations WHERE name=${name}`;
    if (existing) { if (existing.digest !== digest) throw new Error(`Applied migration changed: ${name}`); continue; }
    await sql.begin(async (transaction) => { await transaction.unsafe(source); await transaction`INSERT INTO schema_migrations(name,digest) VALUES(${name},${digest})`; });
    process.stdout.write(`applied ${name}\n`);
  }
} finally { await sql`SELECT pg_advisory_unlock(hashtextextended('pointguide:migrations:v1', 0))`.catch(() => undefined); await sql.end(); }
