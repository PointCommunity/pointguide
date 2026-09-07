import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { MemorySourceRepositoryStore } from "./store";
import { PostgresSourceRepositoryStore } from "@/db/sources";
import type { SourceRepositoryStore } from "./types";

const stores = new Map<string, SourceRepositoryStore>();
export function getRuntimeSourceStore(): SourceRepositoryStore {
  const environment = parseEnvironment(process.env);
  const key = environment.AUTH_MODE === "fixture" ? "fixture" : `postgres:${environment.DATABASE_URL ?? "missing"}`;
  const existing = stores.get(key); if (existing) return existing;
  if (environment.AUTH_MODE !== "fixture" && !environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const store = environment.AUTH_MODE === "fixture" ? new MemorySourceRepositoryStore() : new PostgresSourceRepositoryStore(getDatabase(environment.DATABASE_URL!), environment.CORPUS_COMMIT);
  stores.set(key, store); return store;
}
