import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { MemoryTrainingSessionStore } from "./store";
import { PostgresTrainingSessionStore } from "@/db/training";
import type { TrainingSessionStore } from "./types";

const stores = new Map<string, TrainingSessionStore>();
export function getRuntimeTrainingStore(): TrainingSessionStore {
  const environment = parseEnvironment(process.env); const key = environment.AUTH_MODE === "fixture" ? "fixture" : `postgres:${environment.DATABASE_URL ?? "missing"}`;
  const existing = stores.get(key); if (existing) return existing;
  if (environment.AUTH_MODE !== "fixture" && !environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const store = environment.AUTH_MODE === "fixture" ? new MemoryTrainingSessionStore() : new PostgresTrainingSessionStore(getDatabase(environment.DATABASE_URL!)); stores.set(key, store); return store;
}
