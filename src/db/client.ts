import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const clients = new Map<string, Database>();

export function getDatabase(databaseUrl: string): Database {
  const existing = clients.get(databaseUrl);
  if (existing) return existing;

  // Official Drizzle postgres.js connection pattern:
  // https://orm.drizzle.team/docs/connect-overview
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
  });
  const database = drizzle({ client, schema });
  clients.set(databaseUrl, database);
  return database;
}

export type PointGuideDatabase = Database;
