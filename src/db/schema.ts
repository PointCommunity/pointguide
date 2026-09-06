import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accountRoles, accountStatuses } from "@/lib/auth/types";
import { profileRoles, providerIds, providerStatuses, type ReasoningEffort } from "@/lib/providers/types";

export const accountRole = pgEnum("account_role", accountRoles);
export const accountStatus = pgEnum("account_status", accountStatuses);
export const providerKind = pgEnum("provider_kind", providerIds);
export const providerConnectionStatus = pgEnum("provider_connection_status", providerStatuses);
export const agentProfileRole = pgEnum("agent_profile_role", profileRoles);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey(),
  accessIssuer: text("access_issuer").notNull(),
  accessSubject: text("access_subject").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  role: accountRole("role").notNull().default("USER"),
  status: accountStatus("status").notNull().default("PENDING"),
  firstLoginAt: timestamp("first_login_at", { withTimezone: true, mode: "date" }).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [
  unique("accounts_access_identity_unique").on(table.accessIssuer, table.accessSubject),
  index("accounts_status_role_idx").on(table.status, table.role),
  check("accounts_version_positive", sql`${table.version} > 0`),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id").references(() => accounts.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  outcome: text("outcome").notNull(),
  correlationId: uuid("correlation_id"),
  metadata: jsonb("metadata").$type<Readonly<Record<string, string | number | boolean | null>>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [
  index("audit_events_target_idx").on(table.targetType, table.targetId, table.occurredAt),
  index("audit_events_actor_idx").on(table.actorId, table.occurredAt),
]);

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").primaryKey(),
  provider: providerKind("provider").notNull(),
  status: providerConnectionStatus("status").notNull().default("DISCONNECTED"),
  encryptedSecret: text("encrypted_secret"),
  externalSecretRef: text("external_secret_ref"),
  credentialLocation: text("credential_location"),
  accountLabel: text("account_label"),
  catalogRefreshedAt: timestamp("catalog_refreshed_at", { withTimezone: true, mode: "date" }),
  lastErrorCode: text("last_error_code"),
  createdBy: uuid("created_by").notNull().references(() => accounts.id),
  updatedBy: uuid("updated_by").notNull().references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [
  unique("provider_connections_provider_unique").on(table.provider),
  check("provider_connections_secret_exclusive", sql`${table.encryptedSecret} IS NULL OR ${table.externalSecretRef} IS NULL`),
  check("provider_connections_version_positive", sql`${table.version} > 0`),
]);

export const providerModels = pgTable("provider_models", {
  connectionId: uuid("connection_id").notNull().references(() => providerConnections.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  inputModalities: jsonb("input_modalities").$type<string[]>().notNull().default([]),
  reasoningEfforts: jsonb("reasoning_efforts").$type<ReasoningEffort[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Readonly<Record<string, string>>>().notNull().default({}),
  catalogDigest: text("catalog_digest").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
  available: boolean("available").notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.connectionId, table.modelId], name: "provider_models_pk" }),
  index("provider_models_availability_idx").on(table.connectionId, table.available),
]);

export const agentProfiles = pgTable("agent_profiles", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  role: agentProfileRole("role").notNull(),
  connectionId: uuid("connection_id").notNull(),
  modelId: text("model_id").notNull(),
  reasoningEffort: text("reasoning_effort"),
  enabled: boolean("enabled").notNull().default(false),
  activePromptRevisionId: uuid("active_prompt_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [
  foreignKey({
    columns: [table.connectionId, table.modelId],
    foreignColumns: [providerModels.connectionId, providerModels.modelId],
    name: "agent_profiles_available_model_fk",
  }),
  uniqueIndex("agent_profiles_one_enabled_role_idx").on(table.role).where(sql`${table.enabled} = true`),
  check("agent_profiles_version_positive", sql`${table.version} > 0`),
]);

export const promptRevisions = pgTable("prompt_revisions", {
  id: uuid("id").primaryKey(),
  profileId: uuid("profile_id").notNull().references(() => agentProfiles.id, { onDelete: "cascade" }),
  ownerPrompt: text("owner_prompt").notNull(),
  corePolicyRevision: text("core_policy_revision").notNull(),
  createdBy: uuid("created_by").notNull().references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  supersedesId: uuid("supersedes_id"),
}, (table) => [
  index("prompt_revisions_profile_idx").on(table.profileId, table.createdAt),
  check("prompt_revisions_owner_prompt_bounded", sql`char_length(${table.ownerPrompt}) <= 12000`),
]);

export const applicationSettings = pgTable("application_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<boolean | string | number | Readonly<Record<string, unknown>>>().notNull(),
  updatedBy: uuid("updated_by").notNull().references(() => accounts.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [check("application_settings_version_positive", sql`${table.version} > 0`)]);
