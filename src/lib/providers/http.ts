import { z } from "zod";
import { authenticateRequest, SessionError, type SessionDependencies } from "@/lib/auth/session";
import { AccountPolicyError } from "@/lib/auth/policy";
import { assertSameOrigin } from "@/lib/auth/http";
import { ProviderConfigurationError } from "@/lib/providers/memory-store";
import { decryptSecret, encryptSecret, redactProviderConnection } from "@/lib/providers/secrets";
import {
  authorizeProviderMutation,
  profileRoles,
  providerIds,
  type CodexOperations,
  type OllamaOperations,
  type ProviderConfigurationStore,
  type ProviderId,
} from "@/lib/providers/types";

const ollamaKeySchema = z.object({ apiKey: z.string().trim().min(16).max(4_096) }).strict();
const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(profileRoles),
  provider: z.enum(providerIds),
  modelId: z.string().trim().min(1).max(200),
  reasoningEffort: z.string().trim().min(1).max(100).nullable().default(null),
  enabled: z.boolean(),
  systemPrompt: z.string().trim().min(1).max(12_000).optional(),
  ownerPrompt: z.string().trim().min(1).max(12_000).optional(),
}).strict().refine((value) => Boolean(value.systemPrompt || value.ownerPrompt));
const reviewSchema = z.object({ enabled: z.boolean() }).strict();

export interface ProviderHttpDependencies {
  session: SessionDependencies;
  store: ProviderConfigurationStore;
  secretKey: string;
  codex: CodexOperations;
  ollama: OllamaOperations;
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function boundaryError(error: unknown): Response {
  if (error instanceof SessionError) return errorResponse(error.code, error.message, 401);
  if (error instanceof AccountPolicyError) return errorResponse(error.code, error.message, 403);
  if (error instanceof ProviderConfigurationError) {
    return errorResponse(error.code, error.message, error.code === "INCOMPLETE_REVIEW_CONFIG" ? 409 : 400);
  }
  return errorResponse("PROVIDER_ERROR", "The provider request could not be completed.", 502);
}

async function owner(request: Request, dependencies: ProviderHttpDependencies) {
  const actor = await authenticateRequest(request, dependencies.session);
  authorizeProviderMutation(actor);
  return actor;
}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProviderConfigurationError("INVALID_REQUEST", "The request body is invalid.");
  }
}

export async function handleProviderList(request: Request, dependencies: ProviderHttpDependencies): Promise<Response> {
  try {
    await owner(request, dependencies);
    const stored = await dependencies.store.listConnections();
    const providers = providerIds.map((provider) => {
      const connection = stored.find((candidate) => candidate.provider === provider);
      return connection ? redactProviderConnection(connection) : {
        provider,
        status: "DISCONNECTED" as const,
        credentialConfigured: false,
        accountLabel: null,
        lastErrorCode: null,
      };
    });
    return Response.json({
      providers,
      profiles: await dependencies.store.listProfiles(),
      review: await dependencies.store.getReviewSetting(),
    });
  } catch (error) {
    return boundaryError(error);
  }
}

export async function handleCodexLogin(request: Request, dependencies: ProviderHttpDependencies): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await owner(request, dependencies);
    const login = await dependencies.codex.startDeviceLogin();
    await dependencies.store.updateConnection(actor.id, {
      provider: "CODEX",
      status: "CONNECTING",
      credentialLocation: "codex-home",
      accountLabel: "ChatGPT account",
    });
    return Response.json(login, { status: 202 });
  } catch (error) {
    return boundaryError(error);
  }
}

export async function handleOllamaConnect(request: Request, dependencies: ProviderHttpDependencies): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await owner(request, dependencies);
    const parsed = ollamaKeySchema.safeParse(await parseBody(request));
    if (!parsed.success) return errorResponse("INVALID_REQUEST", "A valid Ollama API key is required.", 400);
    const models = await dependencies.ollama.connect(parsed.data.apiKey);
    await dependencies.store.updateConnection(actor.id, {
      provider: "OLLAMA_CLOUD",
      status: "CONNECTED",
      encryptedSecret: encryptSecret(parsed.data.apiKey, dependencies.secretKey),
      accountLabel: "Ollama Cloud",
      models,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return boundaryError(error);
  }
}

export async function handleProviderModels(
  request: Request,
  provider: string,
  refresh: boolean,
  dependencies: ProviderHttpDependencies,
): Promise<Response> {
  try {
    if (refresh) assertSameOrigin(request);
    const actor = await owner(request, dependencies);
    const parsedProvider = z.enum(providerIds).safeParse(provider);
    if (!parsedProvider.success) return errorResponse("INVALID_PROVIDER", "Provider is invalid.", 404);
    const providerId: ProviderId = parsedProvider.data;
    if (refresh) {
      let models;
      if (providerId === "CODEX") {
        models = await dependencies.codex.listModels();
      } else {
        const connection = await dependencies.store.getConnection(providerId);
        if (!connection?.encryptedSecret) {
          throw new ProviderConfigurationError("CONNECTION_REQUIRED", "Ollama Cloud must be connected first.");
        }
        models = await dependencies.ollama.connect(decryptSecret(connection.encryptedSecret, dependencies.secretKey));
      }
      await dependencies.store.updateConnection(actor.id, { provider: providerId, status: "CONNECTED", models });
    }
    return Response.json(await dependencies.store.listModels(providerId));
  } catch (error) {
    return boundaryError(error);
  }
}

export async function handleProfilePut(
  request: Request,
  id: string,
  dependencies: ProviderHttpDependencies,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await owner(request, dependencies);
    const parsedId = z.uuid().safeParse(id);
    const parsed = profileSchema.safeParse(await parseBody(request));
    if (!parsedId.success || !parsed.success) return errorResponse("INVALID_REQUEST", "Agent profile is invalid.", 400);
    return Response.json(await dependencies.store.saveProfile(actor.id, {
      id,
      name: parsed.data.name,
      role: parsed.data.role,
      provider: parsed.data.provider,
      modelId: parsed.data.modelId,
      reasoningEffort: parsed.data.reasoningEffort,
      enabled: parsed.data.enabled,
      ownerPrompt: parsed.data.systemPrompt ?? parsed.data.ownerPrompt!,
    }));
  } catch (error) {
    return boundaryError(error);
  }
}

export async function handleReviewSetting(request: Request, dependencies: ProviderHttpDependencies): Promise<Response> {
  try {
    assertSameOrigin(request);
    const actor = await owner(request, dependencies);
    const parsed = reviewSchema.safeParse(await parseBody(request));
    if (!parsed.success) return errorResponse("INVALID_REQUEST", "Review setting is invalid.", 400);
    return Response.json(await dependencies.store.setReviewSetting(actor.id, parsed.data.enabled));
  } catch (error) {
    return boundaryError(error);
  }
}
