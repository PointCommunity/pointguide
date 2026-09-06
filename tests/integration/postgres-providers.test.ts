import { describe, expect, it } from "vitest";
import { PostgresAccountStore } from "@/db/accounts";
import { getDatabase } from "@/db/client";
import { PostgresProviderStore } from "@/db/providers";
import {
  accounts,
  agentProfiles,
  applicationSettings,
  auditEvents,
  promptRevisions,
  providerConnections,
  providerModels,
} from "@/db/schema";
import type { ProviderModel } from "@/lib/providers/types";

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

const model: ProviderModel = {
  id: "gpt-5.6-sol",
  displayName: "GPT-5.6 Sol",
  description: "Fixture",
  isDefault: true,
  hidden: false,
  modalities: ["text", "image"],
  reasoningEfforts: [{ effort: "medium", description: "Balanced", isDefault: true }],
  metadata: {},
};

describe("PostgreSQL provider governance", () => {
  databaseTest("persists connections, catalogs, prompt revisions, and review policy", async () => {
    const database = getDatabase(assertDisposableDatabaseUrl(testDatabaseUrl as string));
    await database.delete(applicationSettings);
    await database.delete(promptRevisions);
    await database.delete(agentProfiles);
    await database.delete(providerModels);
    await database.delete(providerConnections);
    await database.delete(auditEvents);
    await database.delete(accounts);

    const owner = await new PostgresAccountStore(database).provisionAccount({
      issuer: "https://provider-test.cloudflareaccess.com",
      subject: "owner",
      email: "owner@example.com",
      displayName: "Owner",
    });
    const store = new PostgresProviderStore(database);
    await store.updateConnection(owner.id, {
      provider: "CODEX",
      status: "CONNECTED",
      credentialLocation: "codex-home",
      models: [model],
    });
    for (const role of ["PRIMARY", "REVIEWER"] as const) {
      const id = crypto.randomUUID();
      await store.saveProfile(owner.id, {
        id,
        name: `${role} guide`,
        role,
        provider: "CODEX",
        modelId: model.id,
        reasoningEffort: "medium",
        enabled: true,
        ownerPrompt: `${role} evidence instructions.`,
      });
      const revision = await store.saveProfile(owner.id, {
        id,
        name: `${role} guide`,
        role,
        provider: "CODEX",
        modelId: model.id,
        reasoningEffort: "medium",
        enabled: true,
        ownerPrompt: `${role} evidence instructions revision two.`,
      });
      expect(revision.promptRevision).toBe(2);
    }

    expect(await store.listModels("CODEX")).toEqual([model]);
    expect(await store.listProfiles()).toHaveLength(2);
    await expect(store.setReviewSetting(owner.id, true)).resolves.toEqual({ enabled: true, version: 1 });
    expect(JSON.stringify(await database.select().from(auditEvents))).not.toContain("evidence instructions");
  });
});
