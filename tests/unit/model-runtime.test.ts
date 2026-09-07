import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { generateAnswer, generateReview } from "@/lib/agent/models";
import { encryptSecret } from "@/lib/providers/secrets";
import type { AppServerClient, ExecutionProfile } from "@/lib/providers/types";
import type { EvidenceItem } from "@/lib/agent/schema";

const evidence: EvidenceItem[] = [{ id: "e1", kind: "REPOSITORY", title: "Manual", path: "docs/manual.html", authority: "manufacturer", capturedAt: "2026-09-06T00:00:00.000Z", excerpt: "Red means not synchronized.", digest: "a".repeat(64) }];
const answer = { directAnswer: "Red means not synchronized.", steps: [], safetyAndAssumptions: [], confidence: "SUPPORTED", claims: [{ id: "c1", text: "Red means not synchronized.", kind: "FACTUAL", status: "SUPPORTED", evidenceIds: ["e1"] }] };

function profile(provider: "CODEX" | "OLLAMA_CLOUD", encryptedSecret: string | null = null): ExecutionProfile {
  const now = new Date();
  return { id: "p1", name: "Primary", role: "PRIMARY", provider, connectionId: "x", modelId: "model", reasoningEffort: "high", enabled: true, systemPrompt: "Be precise.", promptRevisionId: "r1", promptRevision: 1, corePolicyRevision: "v1", createdAt: now, updatedAt: now, version: 1, ownerPrompt: "Be precise.", connection: { id: "x", provider, status: "CONNECTED", encryptedSecret, externalSecretRef: null, credentialLocation: null, accountLabel: null, catalogRefreshedAt: now, lastErrorCode: null, createdAt: now, updatedAt: now, version: 1 } };
}

describe("model execution boundary", () => {
  it("generates and validates structured Ollama answers without leaking the key", async () => {
    const key = randomBytes(32).toString("base64");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify(answer) } }), { status: 200 }));
    await expect(generateAnswer(profile("OLLAMA_CLOUD", encryptSecret("ollama_secret_key_123456", key)), "What is red?", evidence, { secretKey: key, codexClient: { request: vi.fn() }, fetcher })).resolves.toEqual(answer);
    expect(fetcher).toHaveBeenCalledWith("https://ollama.com/api/chat", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer ollama_secret_key_123456" }) }));
  });

  it("collects Codex App Server notifications and validates a review", async () => {
    let listener: ((method: string, params: unknown) => void) | undefined;
    const client: AppServerClient = {
      subscribe(next) { listener = next; return () => { listener = undefined; }; },
      async request(method) {
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        queueMicrotask(() => {
          listener?.("item/agentMessage/delta", { threadId: "thread-1", delta: JSON.stringify({ findings: [{ claimId: "c1", verdict: "SUPPORTED", rationaleCode: "ENTAILED" }] }) });
          listener?.("turn/completed", { threadId: "thread-1" });
        });
        return {};
      },
    };
    await expect(generateReview(profile("CODEX"), answer as never, evidence, { secretKey: randomBytes(32).toString("base64"), codexClient: client })).resolves.toEqual({ findings: [{ claimId: "c1", verdict: "SUPPORTED", rationaleCode: "ENTAILED" }] });
  });

  it("fails on provider errors and invalid JSON", async () => {
    const key = randomBytes(32).toString("base64");
    await expect(generateAnswer(profile("OLLAMA_CLOUD", encryptSecret("ollama_secret_key_123456", key)), "q", evidence, { secretKey: key, codexClient: { request: vi.fn() }, fetcher: async () => new Response("bad", { status: 500 }) })).rejects.toThrow("500");
    await expect(generateAnswer(profile("OLLAMA_CLOUD"), "q", evidence, { secretKey: key, codexClient: { request: vi.fn() } })).rejects.toThrow("credential");
    await expect(generateAnswer(profile("CODEX"), "q", evidence, { secretKey: key, codexClient: { request: vi.fn() } })).rejects.toThrow("notifications");
  });

  it("accepts a fenced structured response but still validates its schema", async () => {
    const key = randomBytes(32).toString("base64");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` } }), { status: 200 }));
    await expect(generateAnswer(profile("OLLAMA_CLOUD", encryptSecret("ollama_secret_key_123456", key)), "q", evidence, { secretKey: key, codexClient: { request: vi.fn() }, fetcher })).resolves.toEqual(answer);
  });
});
