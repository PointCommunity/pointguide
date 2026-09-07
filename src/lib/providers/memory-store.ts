import { randomUUID } from "node:crypto";
import { selectAdvertisedEffort } from "@/lib/providers/catalog";
import type {
  AgentProfileInput,
  AgentProfileRecord,
  ProviderConfigurationStore,
  ProviderConnectionRecord,
  ProviderConnectionUpdate,
  ProviderId,
  ProviderModel,
  ExecutionProfile,
  ProfileRole,
  ReviewSetting,
} from "@/lib/providers/types";

export class ProviderConfigurationError extends Error {
  constructor(public readonly code: "INVALID_REQUEST" | "CONNECTION_REQUIRED" | "MODEL_UNAVAILABLE" | "INVALID_EFFORT" | "INCOMPLETE_REVIEW_CONFIG", message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

function copyModel(model: ProviderModel): ProviderModel {
  return { ...model, modalities: [...model.modalities], reasoningEfforts: model.reasoningEfforts.map((effort) => ({ ...effort })), metadata: { ...model.metadata } };
}

function copyConnection(connection: ProviderConnectionRecord): ProviderConnectionRecord {
  return { ...connection };
}

export class MemoryProviderStore implements ProviderConfigurationStore {
  private readonly connections = new Map<ProviderId, ProviderConnectionRecord>();
  private readonly models = new Map<ProviderId, ProviderModel[]>();
  private readonly profiles = new Map<string, AgentProfileRecord>();
  private readonly prompts = new Map<string, string>();
  private review: ReviewSetting;
  private lock: Promise<void> = Promise.resolve();

  constructor(reviewEnabled = false) { this.review = { enabled: reviewEnabled, version: 0 }; }

  private async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.lock;
    let release = () => {};
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async listConnections(): Promise<ProviderConnectionRecord[]> {
    return [...this.connections.values()].map(copyConnection);
  }

  async getConnection(provider: ProviderId): Promise<ProviderConnectionRecord | null> {
    const connection = this.connections.get(provider);
    return connection ? copyConnection(connection) : null;
  }

  async updateConnection(_actorId: string, update: ProviderConnectionUpdate, now = new Date()): Promise<ProviderConnectionRecord> {
    return this.transaction(() => {
      const current = this.connections.get(update.provider);
      const connection: ProviderConnectionRecord = {
        id: current?.id ?? randomUUID(),
        provider: update.provider,
        status: update.status,
        encryptedSecret: update.externalSecretRef !== undefined ? null : update.encryptedSecret ?? current?.encryptedSecret ?? null,
        externalSecretRef: update.encryptedSecret !== undefined ? null : update.externalSecretRef ?? current?.externalSecretRef ?? null,
        credentialLocation: update.credentialLocation ?? current?.credentialLocation ?? null,
        accountLabel: update.accountLabel ?? current?.accountLabel ?? null,
        catalogRefreshedAt: update.models ? now : current?.catalogRefreshedAt ?? null,
        lastErrorCode: update.lastErrorCode ?? null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        version: (current?.version ?? 0) + 1,
      };
      this.connections.set(update.provider, connection);
      if (update.models) this.models.set(update.provider, update.models.map(copyModel));
      return copyConnection(connection);
    });
  }

  async listModels(provider: ProviderId): Promise<ProviderModel[]> {
    return (this.models.get(provider) ?? []).map(copyModel);
  }

  async saveProfile(_actorId: string, input: AgentProfileInput, now = new Date()): Promise<AgentProfileRecord> {
    return this.transaction(() => {
      const connection = this.connections.get(input.provider);
      if (!connection || connection.status !== "CONNECTED") {
        throw new ProviderConfigurationError("CONNECTION_REQUIRED", `${input.provider} must be connected first.`);
      }
      const model = (this.models.get(input.provider) ?? []).find((candidate) => candidate.id === input.modelId);
      if (!model) throw new ProviderConfigurationError("MODEL_UNAVAILABLE", "The selected model is not currently available.");
      try {
        selectAdvertisedEffort(model, input.reasoningEffort);
      } catch {
        throw new ProviderConfigurationError("INVALID_EFFORT", "The selected reasoning effort is not advertised by this model.");
      }
      const current = this.profiles.get(input.id);
      const profile: AgentProfileRecord = {
        id: input.id,
        name: input.name,
        role: input.role,
        provider: input.provider,
        connectionId: connection.id,
        modelId: input.modelId,
        reasoningEffort: input.reasoningEffort,
        enabled: input.enabled,
        promptRevisionId: randomUUID(),
        promptRevision: (current?.promptRevision ?? 0) + 1,
        corePolicyRevision: "evidence-policy-v1",
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        version: (current?.version ?? 0) + 1,
      };
      const nextProfiles = new Map(this.profiles);
      if (input.enabled) {
        for (const [id, candidate] of nextProfiles) {
          if (id !== input.id && candidate.role === input.role && candidate.enabled) {
            nextProfiles.set(id, { ...candidate, enabled: false, updatedAt: now, version: candidate.version + 1 });
          }
        }
      }
      nextProfiles.set(profile.id, profile);
      if (this.review.enabled) {
        const enabledRoles = new Set([...nextProfiles.values()].filter((candidate) => candidate.enabled).map((candidate) => candidate.role));
        if (!enabledRoles.has("PRIMARY") || !enabledRoles.has("REVIEWER")) {
          throw new ProviderConfigurationError("INCOMPLETE_REVIEW_CONFIG", "Deep research requires an enabled primary and reviewer profile.");
        }
      }
      this.profiles.clear();
      for (const [id, candidate] of nextProfiles) this.profiles.set(id, candidate);
      this.prompts.set(profile.id, input.ownerPrompt);
      return { ...profile };
    });
  }

  async listProfiles(): Promise<AgentProfileRecord[]> {
    return [...this.profiles.values()].map((profile) => ({ ...profile }));
  }

  async getExecutionProfile(role: ProfileRole): Promise<ExecutionProfile | null> {
    const profile = [...this.profiles.values()].find((candidate) => candidate.role === role && candidate.enabled);
    if (!profile) return null;
    const connection = this.connections.get(profile.provider);
    if (!connection) return null;
    return { ...profile, ownerPrompt: this.prompts.get(profile.id) ?? "", connection: copyConnection(connection) };
  }

  async getReviewSetting(): Promise<ReviewSetting> {
    return { ...this.review };
  }

  async setReviewSetting(_actorId: string, enabled: boolean): Promise<ReviewSetting> {
    return this.transaction(() => {
      if (enabled) {
        const enabledRoles = new Set([...this.profiles.values()].filter((profile) => profile.enabled).map((profile) => profile.role));
        if (!enabledRoles.has("PRIMARY") || !enabledRoles.has("REVIEWER")) {
          throw new ProviderConfigurationError("INCOMPLETE_REVIEW_CONFIG", "Enable a primary and reviewer profile before Deep research.");
        }
      }
      this.review = { enabled, version: this.review.version + 1 };
      return { ...this.review };
    });
  }
}
