import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/auth/types";
import { normalizeCodexCatalog, normalizeOllamaCatalog, selectAdvertisedEffort } from "@/lib/providers/catalog";
import { CodexProvider } from "@/lib/providers/codex";
import { OllamaCloudProvider } from "@/lib/providers/ollama";
import { decryptSecret, encryptSecret, maskSecret, redactProviderConnection } from "@/lib/providers/secrets";
import { authorizeProviderMutation } from "@/lib/providers/types";

function account(role: Account["role"]): Account {
  const now = new Date("2026-09-06T00:00:00.000Z");
  return {
    id: crypto.randomUUID(),
    accessIssuer: "fixture://pointguide",
    accessSubject: role.toLowerCase(),
    email: `${role.toLowerCase()}@example.com`,
    displayName: role,
    role,
    status: "APPROVED",
    firstLoginAt: now,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

describe("provider credential boundary", () => {
  it("encrypts secrets and returns only masked connection metadata", () => {
    const key = randomBytes(32).toString("base64");
    const raw = "ollama_example_secret_1234567890";
    const encrypted = encryptSecret(raw, key);

    expect(encrypted).not.toContain(raw);
    expect(decryptSecret(encrypted, key)).toBe(raw);
    expect(maskSecret(raw)).toBe("olla…7890");
    expect(redactProviderConnection({
      provider: "OLLAMA_CLOUD",
      status: "CONNECTED",
      encryptedSecret: encrypted,
      externalSecretRef: null,
      accountLabel: "Ollama Cloud",
      lastErrorCode: null,
    })).toEqual({
      provider: "OLLAMA_CLOUD",
      status: "CONNECTED",
      credentialConfigured: true,
      accountLabel: "Ollama Cloud",
      lastErrorCode: null,
    });
  });

  it("rejects malformed encryption keys and ciphertext", () => {
    expect(() => encryptSecret("secret", "not-base64")).toThrow("32-byte");
    expect(() => decryptSecret("v1.invalid", randomBytes(32).toString("base64"))).toThrow("ciphertext");
  });
});

describe("provider-advertised catalogs", () => {
  it("normalizes Codex models and preserves only advertised efforts", () => {
    const models = normalizeCodexCatalog({
      data: [{
        id: "gpt-6-astra",
        model: "gpt-6-astra",
        displayName: "GPT-6 Astra",
        description: "Evidence reviewer",
        hidden: false,
        isDefault: true,
        inputModalities: ["text", "image"],
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Quick" },
          { reasoningEffort: "high", description: "Thorough" },
        ],
      }],
      nextCursor: null,
    });

    expect(models).toEqual([expect.objectContaining({
      id: "gpt-6-astra",
      displayName: "GPT-6 Astra",
      isDefault: true,
      modalities: ["text", "image"],
      reasoningEfforts: [
        { effort: "low", description: "Quick", isDefault: false },
        { effort: "high", description: "Thorough", isDefault: true },
      ],
    })]);
    expect(selectAdvertisedEffort(models[0], "high")).toBe("high");
    expect(() => selectAdvertisedEffort(models[0], "ultra")).toThrow("not advertised");
  });

  it("normalizes Ollama Cloud models without inventing effort metadata", () => {
    const models = normalizeOllamaCatalog({
      models: [{
        name: "gpt-oss:120b",
        model: "gpt-oss:120b",
        modified_at: "2026-09-06T00:00:00Z",
        size: 1,
        digest: "sha256:fixture",
        details: { family: "gptoss", parameter_size: "120B" },
      }],
    });

    expect(models).toEqual([expect.objectContaining({
      id: "gpt-oss:120b",
      displayName: "gpt-oss:120b",
      reasoningEfforts: [],
      metadata: { family: "gptoss", parameterSize: "120B" },
    })]);
    expect(selectAdvertisedEffort(models[0], null)).toBeNull();
    expect(() => normalizeOllamaCatalog({ models: [{ name: "", model: "" }] })).toThrow();
  });

  it("rejects duplicate provider-stable model IDs", () => {
    const duplicate = {
      data: [
        { id: "same", model: "same", displayName: "One", supportedReasoningEfforts: [] },
        { id: "same", model: "same", displayName: "Two", supportedReasoningEfforts: [] },
      ],
    };
    expect(() => normalizeCodexCatalog(duplicate)).toThrow("duplicate");
  });
});

describe("provider authorization and adapters", () => {
  it.each(["USER", "TRAINER", "ADMIN"] as const)("denies %s provider mutation", (role) => {
    expect(() => authorizeProviderMutation(account(role))).toThrow("Owner");
  });

  it("allows an approved Owner and denies an unapproved Owner", () => {
    expect(authorizeProviderMutation(account("OWNER"))).toBeUndefined();
    expect(() => authorizeProviderMutation({ ...account("OWNER"), status: "PENDING" })).toThrow("pending");
  });

  it("maps the Codex device login and paginated model list without exposing credentials", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        type: "chatgptDeviceCode",
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
      })
      .mockResolvedValueOnce({
        data: [{ id: "model-a", model: "model-a", displayName: "Model A", supportedReasoningEfforts: [] }],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        data: [{ id: "model-b", model: "model-b", displayName: "Model B", supportedReasoningEfforts: [] }],
        nextCursor: null,
      });
    const provider = new CodexProvider({ request });

    await expect(provider.startDeviceLogin()).resolves.toEqual({
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    });
    await expect(provider.listModels()).resolves.toHaveLength(2);
    expect(request).toHaveBeenNthCalledWith(1, "account/login/start", { type: "chatgptDeviceCode" });
    expect(request).toHaveBeenNthCalledWith(2, "model/list", { limit: 20, includeHidden: false });
    expect(request).toHaveBeenNthCalledWith(3, "model/list", { limit: 20, includeHidden: false, cursor: "page-2" });
  });

  it("verifies an Ollama key through the authenticated cloud catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: "qwen3", model: "qwen3" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OllamaCloudProvider({ fetcher });

    await expect(provider.connect("ollama_example_secret_1234")).resolves.toEqual([
      expect.objectContaining({ id: "qwen3" }),
    ]);
    expect(fetcher).toHaveBeenCalledWith("https://ollama.com/api/tags", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer ollama_example_secret_1234" }),
    }));
  });
});
