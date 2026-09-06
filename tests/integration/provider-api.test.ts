import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryAccountStore } from "@/lib/auth/memory-store";
import { authenticateRequest, type SessionDependencies } from "@/lib/auth/session";
import {
  handleCodexLogin,
  handleOllamaConnect,
  handleProfilePut,
  handleProviderList,
  handleProviderModels,
  handleReviewSetting,
  type ProviderHttpDependencies,
} from "@/lib/providers/http";
import { MemoryProviderStore } from "@/lib/providers/memory-store";
import type { ProviderModel } from "@/lib/providers/types";

function request(subject: string, body?: unknown, method = "GET") {
  const headers = new Headers({
    "x-pointguide-fixture-subject": subject,
    "x-pointguide-fixture-email": `${subject}@example.com`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request("http://localhost/api/owner", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function session(store = new MemoryAccountStore()): SessionDependencies {
  return {
    store,
    config: {
      mode: "fixture",
      nodeEnv: "test",
      teamDomain: undefined,
      audience: undefined,
      fallbackFixtureIdentity: undefined,
    },
  };
}

const codexModel: ProviderModel = {
  id: "gpt-5.6-sol",
  displayName: "GPT-5.6 Sol",
  description: null,
  isDefault: true,
  hidden: false,
  modalities: ["text", "image"],
  reasoningEfforts: [{ effort: "medium", description: "Balanced", isDefault: true }],
  metadata: {},
};

function dependencies(): ProviderHttpDependencies {
  return {
    session: session(),
    store: new MemoryProviderStore(),
    secretKey: randomBytes(32).toString("base64"),
    codex: {
      startDeviceLogin: vi.fn().mockResolvedValue({
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
      }),
      listModels: vi.fn().mockResolvedValue([codexModel]),
    },
    ollama: { connect: vi.fn().mockResolvedValue([{ ...codexModel, id: "gpt-oss:120b", displayName: "gpt-oss:120b", reasoningEfforts: [] }]) },
  };
}

describe("Owner provider API boundary", () => {
  it("denies a non-Owner without calling a provider", async () => {
    const deps = dependencies();
    await handleProviderList(request("owner"), deps);
    const user = await authenticateRequest(request("user"), deps.session);
    const accounts = await deps.session.store.listAccounts();
    await deps.session.store.updateAccount(accounts[0].id, user.id, { expectedVersion: user.version, status: "APPROVED" });

    const response = await handleOllamaConnect(request("user", { apiKey: "ollama_secret_12345678" }, "POST"), deps);
    expect(response.status).toBe(403);
    expect(deps.ollama.connect).not.toHaveBeenCalled();
  });

  it("stores an Ollama key through a write-only boundary and exposes its catalog", async () => {
    const deps = dependencies();
    const response = await handleOllamaConnect(request("owner", { apiKey: "ollama_secret_12345678" }, "POST"), deps);
    const listing = await handleProviderList(request("owner"), deps);
    const models = await handleProviderModels(request("owner"), "OLLAMA_CLOUD", false, deps);

    expect(response.status).toBe(204);
    expect(JSON.stringify(await listing.json())).not.toContain("ollama_secret_12345678");
    expect(await models.json()).toEqual([expect.objectContaining({ id: "gpt-oss:120b" })]);
  });

  it("starts Codex device login and refreshes dynamic models", async () => {
    const deps = dependencies();
    const login = await handleCodexLogin(request("owner", undefined, "POST"), deps);
    const refresh = await handleProviderModels(request("owner", undefined, "POST"), "CODEX", true, deps);

    expect(login.status).toBe(202);
    expect(await login.json()).toEqual({
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    });
    expect(await refresh.json()).toEqual([expect.objectContaining({ id: "gpt-5.6-sol" })]);
  });

  it("accepts only provider-advertised profile efforts and versions prompts", async () => {
    const deps = dependencies();
    await handleCodexLogin(request("owner", undefined, "POST"), deps);
    await handleProviderModels(request("owner", undefined, "POST"), "CODEX", true, deps);

    const rejected = await handleProfilePut(request("owner", {
      name: "Primary guide", role: "PRIMARY", provider: "CODEX", modelId: "gpt-5.6-sol",
      reasoningEffort: "ultra", enabled: true, ownerPrompt: "Help with PCC technology.",
    }, "PUT"), crypto.randomUUID(), deps);
    const accepted = await handleProfilePut(request("owner", {
      name: "Primary guide", role: "PRIMARY", provider: "CODEX", modelId: "gpt-5.6-sol",
      reasoningEffort: "medium", enabled: true, ownerPrompt: "Help with PCC technology.",
    }, "PUT"), crypto.randomUUID(), deps);

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ modelId: "gpt-5.6-sol", reasoningEffort: "medium", promptRevision: 1 });
  });

  it("keeps the review feature disabled until an Owner enables it", async () => {
    const deps = dependencies();
    await handleProviderList(request("owner"), deps);
    const rejected = await handleReviewSetting(request("owner", { enabled: true }, "PUT"), deps);
    await handleCodexLogin(request("owner", undefined, "POST"), deps);
    await handleProviderModels(request("owner", undefined, "POST"), "CODEX", true, deps);
    for (const role of ["PRIMARY", "REVIEWER"] as const) {
      await handleProfilePut(request("owner", {
        name: `${role} guide`, role, provider: "CODEX", modelId: "gpt-5.6-sol",
        reasoningEffort: "medium", enabled: true, ownerPrompt: `${role} evidence instructions.`,
      }, "PUT"), crypto.randomUUID(), deps);
    }
    const updated = await handleReviewSetting(request("owner", { enabled: true }, "PUT"), deps);
    const listing = await handleProviderList(request("owner"), deps);
    const reviewer = (await deps.store.listProfiles()).find((profile) => profile.role === "REVIEWER")!;
    const invalidated = await handleProfilePut(request("owner", {
      name: reviewer.name, role: "REVIEWER", provider: "CODEX", modelId: reviewer.modelId,
      reasoningEffort: reviewer.reasoningEffort, enabled: false, ownerPrompt: "Disable reviewer.",
    }, "PUT"), reviewer.id, deps);

    expect(rejected.status).toBe(409);
    expect(await updated.json()).toEqual({ enabled: true, version: 1 });
    expect(await listing.json()).toMatchObject({ review: { enabled: true, version: 1 } });
    expect(invalidated.status).toBe(409);
  });
});
