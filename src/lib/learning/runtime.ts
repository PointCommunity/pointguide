import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { MemoryLearningRepository, PostgresLearningRepository, type LearningRepository } from "./store";

const stores = new Map<string, LearningRepository>();

export function getRuntimeLearningRepository(): LearningRepository {
  const environment = parseEnvironment(process.env);
  const key = environment.AUTH_MODE === "fixture" ? "fixture" : `postgres:${environment.DATABASE_URL ?? "missing"}`;
  const existing = stores.get(key);
  if (existing) return existing;
  if (environment.AUTH_MODE !== "fixture" && !environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const store = environment.AUTH_MODE === "fixture" ? new MemoryLearningRepository() : new PostgresLearningRepository(getDatabase(environment.DATABASE_URL!));
  stores.set(key, store);
  return store;
}
