import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  agentProfiles,
  applicationSettings,
  auditEvents,
  promptRevisions,
  providerConnections,
  providerModels,
} from "@/db/schema";
import type { PointGuideDatabase } from "@/db/client";
import { selectAdvertisedEffort } from "@/lib/providers/catalog";
import { ProviderConfigurationError } from "@/lib/providers/memory-store";
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

function connectionFromRow(row: typeof providerConnections.$inferSelect): ProviderConnectionRecord {
  return row;
}

function modelFromRow(row: typeof providerModels.$inferSelect): ProviderModel {
  return {
    id: row.modelId,
    displayName: row.displayName,
    description: row.description,
    isDefault: row.isDefault,
    hidden: row.hidden,
    modalities: row.inputModalities,
    reasoningEfforts: row.reasoningEfforts,
    metadata: row.metadata,
  };
}

function catalogDigest(models: readonly ProviderModel[]): string {
  return createHash("sha256").update(JSON.stringify(models)).digest("hex");
}

export class PostgresProviderStore implements ProviderConfigurationStore {
  constructor(private readonly database: PointGuideDatabase) {}

  async listConnections(): Promise<ProviderConnectionRecord[]> {
    return (await this.database.select().from(providerConnections).orderBy(asc(providerConnections.provider))).map(connectionFromRow);
  }

  async getConnection(provider: ProviderId): Promise<ProviderConnectionRecord | null> {
    const [connection] = await this.database.select().from(providerConnections).where(eq(providerConnections.provider, provider)).limit(1);
    return connection ? connectionFromRow(connection) : null;
  }

  async updateConnection(actorId: string, update: ProviderConnectionUpdate, now = new Date()): Promise<ProviderConnectionRecord> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction.select().from(providerConnections).where(eq(providerConnections.provider, update.provider)).limit(1);
      const connectionId = current?.id ?? randomUUID();
      const [saved] = current
        ? await transaction.update(providerConnections).set({
            status: update.status,
            encryptedSecret: update.externalSecretRef !== undefined ? null : update.encryptedSecret ?? current.encryptedSecret,
            externalSecretRef: update.encryptedSecret !== undefined ? null : update.externalSecretRef ?? current.externalSecretRef,
            credentialLocation: update.credentialLocation ?? current.credentialLocation,
            accountLabel: update.accountLabel ?? current.accountLabel,
            catalogRefreshedAt: update.models ? now : current.catalogRefreshedAt,
            lastErrorCode: update.lastErrorCode ?? null,
            updatedBy: actorId,
            updatedAt: now,
            version: current.version + 1,
          }).where(eq(providerConnections.id, current.id)).returning()
        : await transaction.insert(providerConnections).values({
            id: connectionId,
            provider: update.provider,
            status: update.status,
            encryptedSecret: update.encryptedSecret,
            externalSecretRef: update.externalSecretRef,
            credentialLocation: update.credentialLocation,
            accountLabel: update.accountLabel,
            catalogRefreshedAt: update.models ? now : null,
            lastErrorCode: update.lastErrorCode ?? null,
            createdBy: actorId,
            updatedBy: actorId,
            createdAt: now,
            updatedAt: now,
            version: 1,
          }).returning();
      if (!saved) throw new Error("Provider connection update did not return a record.");

      if (update.models) {
        await transaction.update(providerModels).set({ available: false }).where(eq(providerModels.connectionId, saved.id));
        const digest = catalogDigest(update.models);
        for (const model of update.models) {
          await transaction.insert(providerModels).values({
            connectionId: saved.id,
            modelId: model.id,
            displayName: model.displayName,
            description: model.description,
            isDefault: model.isDefault,
            hidden: model.hidden,
            inputModalities: model.modalities,
            reasoningEfforts: model.reasoningEfforts,
            metadata: model.metadata,
            catalogDigest: digest,
            observedAt: now,
            available: true,
          }).onConflictDoUpdate({
            target: [providerModels.connectionId, providerModels.modelId],
            set: {
              displayName: model.displayName,
              description: model.description,
              isDefault: model.isDefault,
              hidden: model.hidden,
              inputModalities: model.modalities,
              reasoningEfforts: model.reasoningEfforts,
              metadata: model.metadata,
              catalogDigest: digest,
              observedAt: now,
              available: true,
            },
          });
        }
      }

      await transaction.insert(auditEvents).values({
        id: randomUUID(),
        actorId,
        action: update.models ? "provider.catalog_refreshed" : "provider.updated",
        targetType: "provider_connection",
        targetId: saved.id,
        outcome: "SUCCEEDED",
        metadata: { provider: update.provider, status: update.status, modelCount: update.models?.length ?? 0 },
        occurredAt: now,
      });
      return connectionFromRow(saved);
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }

  async listModels(provider: ProviderId): Promise<ProviderModel[]> {
    const rows = await this.database.select({ model: providerModels }).from(providerModels)
      .innerJoin(providerConnections, eq(providerModels.connectionId, providerConnections.id))
      .where(and(eq(providerConnections.provider, provider), eq(providerModels.available, true)))
      .orderBy(asc(providerModels.displayName));
    return rows.map(({ model }) => modelFromRow(model));
  }

  async saveProfile(actorId: string, input: AgentProfileInput, now = new Date()): Promise<AgentProfileRecord> {
    return this.database.transaction(async (transaction) => {
      const [connection] = await transaction.select().from(providerConnections).where(and(
        eq(providerConnections.provider, input.provider),
        eq(providerConnections.status, "CONNECTED"),
      )).limit(1);
      if (!connection) throw new ProviderConfigurationError("CONNECTION_REQUIRED", `${input.provider} must be connected first.`);
      const [modelRow] = await transaction.select().from(providerModels).where(and(
        eq(providerModels.connectionId, connection.id),
        eq(providerModels.modelId, input.modelId),
        eq(providerModels.available, true),
      )).limit(1);
      if (!modelRow) throw new ProviderConfigurationError("MODEL_UNAVAILABLE", "The selected model is not currently available.");
      try {
        selectAdvertisedEffort(modelFromRow(modelRow), input.reasoningEffort);
      } catch {
        throw new ProviderConfigurationError("INVALID_EFFORT", "The selected reasoning effort is not advertised by this model.");
      }

      const [current] = await transaction.select().from(agentProfiles).where(eq(agentProfiles.id, input.id)).limit(1);
      if (input.enabled) {
        await transaction.update(agentProfiles).set({ enabled: false, updatedAt: now })
          .where(and(eq(agentProfiles.role, input.role), eq(agentProfiles.enabled, true)));
      }
      if (current) {
        await transaction.update(agentProfiles).set({
          name: input.name,
          role: input.role,
          connectionId: connection.id,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          enabled: input.enabled,
          updatedAt: now,
          version: current.version + 1,
        }).where(eq(agentProfiles.id, input.id));
      } else {
        await transaction.insert(agentProfiles).values({
          id: input.id,
          name: input.name,
          role: input.role,
          connectionId: connection.id,
          modelId: input.modelId,
          reasoningEffort: input.reasoningEffort,
          enabled: input.enabled,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }

      const existingRevisions = await transaction.select({ id: promptRevisions.id }).from(promptRevisions)
        .where(eq(promptRevisions.profileId, input.id));
      const promptRevisionId = randomUUID();
      await transaction.insert(promptRevisions).values({
        id: promptRevisionId,
        profileId: input.id,
        ownerPrompt: input.ownerPrompt,
        corePolicyRevision: "evidence-policy-v1",
        createdBy: actorId,
        createdAt: now,
        supersedesId: current?.activePromptRevisionId ?? null,
      });
      const [saved] = await transaction.update(agentProfiles).set({ activePromptRevisionId: promptRevisionId })
        .where(eq(agentProfiles.id, input.id)).returning();
      if (!saved) throw new Error("Agent profile update did not return a record.");

      const [reviewSetting] = await transaction.select().from(applicationSettings)
        .where(eq(applicationSettings.key, "review.enabled")).limit(1);
      if (reviewSetting?.value === true) {
        const enabledProfiles = await transaction.select({ role: agentProfiles.role }).from(agentProfiles)
          .where(eq(agentProfiles.enabled, true));
        const enabledRoles = new Set(enabledProfiles.map((profile) => profile.role));
        if (!enabledRoles.has("PRIMARY") || !enabledRoles.has("REVIEWER")) {
          throw new ProviderConfigurationError("INCOMPLETE_REVIEW_CONFIG", "Deep research requires an enabled primary and reviewer profile.");
        }
      }

      await transaction.insert(auditEvents).values({
        id: randomUUID(), actorId, action: "agent_profile.updated", targetType: "agent_profile", targetId: saved.id,
        outcome: "SUCCEEDED", metadata: { provider: input.provider, modelId: input.modelId, role: input.role, version: saved.version }, occurredAt: now,
      });
      return {
        id: saved.id,
        name: saved.name,
        role: saved.role,
        provider: input.provider,
        connectionId: saved.connectionId,
        modelId: saved.modelId,
        reasoningEffort: saved.reasoningEffort,
        enabled: saved.enabled,
        systemPrompt: input.ownerPrompt,
        promptRevisionId,
        promptRevision: existingRevisions.length + 1,
        corePolicyRevision: "evidence-policy-v1",
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        version: saved.version,
      };
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }

  async listProfiles(): Promise<AgentProfileRecord[]> {
    const rows = await this.database.select({ profile: agentProfiles, provider: providerConnections.provider })
      .from(agentProfiles).innerJoin(providerConnections, eq(agentProfiles.connectionId, providerConnections.id))
      .orderBy(asc(agentProfiles.role));
    const revisions = await this.database.select().from(promptRevisions);
    return rows.map(({ profile, provider }) => ({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      provider,
      connectionId: profile.connectionId,
      modelId: profile.modelId,
      reasoningEffort: profile.reasoningEffort,
      enabled: profile.enabled,
      systemPrompt: revisions.find((revision) => revision.id === profile.activePromptRevisionId)?.ownerPrompt ?? "",
      promptRevisionId: profile.activePromptRevisionId ?? "",
      promptRevision: revisions.filter((revision) => revision.profileId === profile.id).length,
      corePolicyRevision: revisions.find((revision) => revision.id === profile.activePromptRevisionId)?.corePolicyRevision ?? "evidence-policy-v1",
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      version: profile.version,
    }));
  }

  async getExecutionProfile(role: ProfileRole): Promise<ExecutionProfile | null> {
    const [row] = await this.database.select({ profile: agentProfiles, connection: providerConnections, prompt: promptRevisions.ownerPrompt })
      .from(agentProfiles)
      .innerJoin(providerConnections, eq(agentProfiles.connectionId, providerConnections.id))
      .innerJoin(promptRevisions, eq(agentProfiles.activePromptRevisionId, promptRevisions.id))
      .where(and(eq(agentProfiles.role, role), eq(agentProfiles.enabled, true), eq(providerConnections.status, "CONNECTED"))).limit(1);
    if (!row) return null;
    return {
      id: row.profile.id, name: row.profile.name, role: row.profile.role, provider: row.connection.provider,
      connectionId: row.profile.connectionId, modelId: row.profile.modelId, reasoningEffort: row.profile.reasoningEffort,
      enabled: row.profile.enabled, systemPrompt: row.prompt, promptRevisionId: row.profile.activePromptRevisionId!, promptRevision: row.profile.version,
      corePolicyRevision: "evidence-policy-v1", createdAt: row.profile.createdAt, updatedAt: row.profile.updatedAt,
      version: row.profile.version, ownerPrompt: row.prompt, connection: connectionFromRow(row.connection),
    };
  }

  async getReviewSetting(): Promise<ReviewSetting> {
    const [setting] = await this.database.select().from(applicationSettings).where(eq(applicationSettings.key, "review.enabled")).limit(1);
    return { enabled: setting?.value === true, version: setting?.version ?? 0 };
  }

  async setReviewSetting(actorId: string, enabled: boolean, now = new Date()): Promise<ReviewSetting> {
    return this.database.transaction(async (transaction) => {
      if (enabled) {
        const enabledProfiles = await transaction.select({ role: agentProfiles.role }).from(agentProfiles)
          .where(eq(agentProfiles.enabled, true));
        const enabledRoles = new Set(enabledProfiles.map((profile) => profile.role));
        if (!enabledRoles.has("PRIMARY") || !enabledRoles.has("REVIEWER")) {
          throw new ProviderConfigurationError("INCOMPLETE_REVIEW_CONFIG", "Enable a primary and reviewer profile before Deep research.");
        }
      }
      const [current] = await transaction.select().from(applicationSettings).where(eq(applicationSettings.key, "review.enabled")).limit(1);
      const version = (current?.version ?? 0) + 1;
      if (current) {
        await transaction.update(applicationSettings).set({ value: enabled, updatedBy: actorId, updatedAt: now, version })
          .where(eq(applicationSettings.key, "review.enabled"));
      } else {
        await transaction.insert(applicationSettings).values({ key: "review.enabled", value: enabled, updatedBy: actorId, updatedAt: now, version });
      }
      await transaction.insert(auditEvents).values({
        id: randomUUID(), actorId, action: "review_setting.updated", targetType: "application_setting", targetId: actorId,
        outcome: "SUCCEEDED", metadata: { key: "review.enabled", enabled, version }, occurredAt: now,
      });
      return { enabled, version };
    }, { isolationLevel: "read committed", accessMode: "read write" });
  }
}
