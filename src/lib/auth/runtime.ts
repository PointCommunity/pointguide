import { getDatabase } from "@/db/client";
import { PostgresAccountStore } from "@/db/accounts";
import { assertProductionEnvironment, parseEnvironment } from "@/lib/config/env";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import type { AccountStore } from "@/lib/auth/types";
import type { SessionDependencies } from "@/lib/auth/session";

const runtimeStores = new Map<string, AccountStore>();

function runtimeStore(mode: "cloudflare" | "fixture", databaseUrl: string | undefined): AccountStore {
  const key = mode === "fixture" ? "fixture" : `postgres:${databaseUrl ?? "missing"}`;
  const existing = runtimeStores.get(key);
  if (existing) return existing;

  if (mode === "fixture") {
    const store = new MemoryAccountStore();
    runtimeStores.set(key, store);
    return store;
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Cloudflare authentication mode.");
  const store = new PostgresAccountStore(getDatabase(databaseUrl));
  runtimeStores.set(key, store);
  return store;
}

export function getRuntimeSessionDependencies(): SessionDependencies {
  const environment = parseEnvironment(process.env);
  assertProductionEnvironment(environment);
  return {
    store: runtimeStore(environment.AUTH_MODE, environment.DATABASE_URL),
    config: {
      mode: environment.AUTH_MODE,
      nodeEnv: environment.NODE_ENV,
      teamDomain: environment.CF_ACCESS_TEAM_DOMAIN,
      audience: environment.CF_ACCESS_AUDIENCE,
      fallbackFixtureIdentity: environment.FIXTURE_AUTH_SUBJECT && environment.FIXTURE_AUTH_EMAIL
        ? {
            subject: environment.FIXTURE_AUTH_SUBJECT,
            email: environment.FIXTURE_AUTH_EMAIL,
            displayName: environment.FIXTURE_AUTH_NAME ?? null,
          }
        : undefined,
    },
  };
}
