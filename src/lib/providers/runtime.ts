import { PostgresProviderStore } from "@/db/providers";
import { getDatabase } from "@/db/client";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { parseEnvironment } from "@/lib/config/env";
import { normalizeCodexCatalog, normalizeOllamaCatalog } from "@/lib/providers/catalog";
import { CodexProvider } from "@/lib/providers/codex";
import { CodexAppServerProcessClient } from "@/lib/providers/codex-process";
import type { CodexOperations, OllamaOperations, ProviderConfigurationStore } from "@/lib/providers/types";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import { OllamaCloudProvider } from "@/lib/providers/ollama";
import type { ProviderHttpDependencies } from "@/lib/providers/http";

const stores = new Map<string, ProviderConfigurationStore>();
let codexProcess: CodexAppServerProcessClient | null = null;

const fixtureCodexCatalog = normalizeCodexCatalog({
  data: [{
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    description: "Reliable agentic workhorse",
    hidden: false,
    isDefault: true,
    inputModalities: ["text", "image"],
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast" },
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "high", description: "Thorough" },
    ],
  }],
  nextCursor: null,
});
const fixtureOllamaCatalog = normalizeOllamaCatalog({
  models: [{ name: "gpt-oss:120b", model: "gpt-oss:120b", details: { family: "gptoss", parameter_size: "120B" } }],
});

function storeFor(mode: "cloudflare" | "fixture", databaseUrl: string | undefined): ProviderConfigurationStore {
  const key = mode === "fixture" ? "fixture" : `postgres:${databaseUrl ?? "missing"}`;
  const existing = stores.get(key);
  if (existing) return existing;
  const store = mode === "fixture"
    ? new MemoryProviderStore()
    : new PostgresProviderStore(getDatabase(databaseUrl ?? ""));
  stores.set(key, store);
  return store;
}

function disabledProvider(name: string): never {
  throw new Error(`${name} provider access is disabled by configuration.`);
}

function codexFor(fixture: boolean, live: boolean): CodexOperations {
  if (fixture) return {
    startDeviceLogin: async () => ({ loginId: "fixture-login", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" }),
    listModels: async () => fixtureCodexCatalog,
  };
  if (!live) return { startDeviceLogin: async () => disabledProvider("Codex"), listModels: async () => disabledProvider("Codex") };
  codexProcess ??= new CodexAppServerProcessClient();
  return new CodexProvider(codexProcess);
}

function ollamaFor(fixture: boolean, live: boolean): OllamaOperations {
  if (fixture) return { connect: async () => fixtureOllamaCatalog };
  if (!live) return { connect: async () => disabledProvider("Ollama") };
  return new OllamaCloudProvider();
}

export function getRuntimeProviderDependencies(): ProviderHttpDependencies {
  const environment = parseEnvironment(process.env);
  const fixture = environment.AUTH_MODE === "fixture";
  const secretKey = fixture
    ? Buffer.alloc(32, 7).toString("base64")
    : environment.PROVIDER_SECRET_KEY;
  if (!secretKey) throw new Error("PROVIDER_SECRET_KEY is required outside fixture mode.");
  return {
    session: getRuntimeSessionDependencies(),
    store: storeFor(environment.AUTH_MODE, environment.DATABASE_URL),
    secretKey,
    codex: codexFor(fixture, environment.LIVE_PROVIDERS_ENABLED),
    ollama: ollamaFor(fixture, environment.LIVE_PROVIDERS_ENABLED),
  };
}
