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

export const corpusRevisions = pgTable("corpus_revisions", {
  id: uuid("id").primaryKey(),
  commitSha: text("commit_sha").notNull().unique(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  validatorVersion: text("validator_version").notNull(),
  counts: jsonb("counts").$type<Readonly<Record<string, number>>>().notNull().default({}),
  errorSummary: text("error_summary"),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey(),
  ownerAccountId: uuid("owner_account_id").notNull().references(() => accounts.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  userTurnCount: integer("user_turn_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const evidenceItems = pgTable("evidence_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  corpusRevisionId: uuid("corpus_revision_id").references(() => corpusRevisions.id),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  locator: text("locator"),
  url: text("url"),
  publisher: text("publisher"),
  authority: text("authority").notNull(),
  applicability: text("applicability"),
  versionOrDate: text("version_or_date"),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  excerpt: text("excerpt").notNull(),
  digest: text("digest").notNull(),
});

export const answers = pgTable("answers", {
  id: uuid("id").primaryKey(),
  messageId: uuid("message_id").references(() => messages.id),
  corpusRevisionId: uuid("corpus_revision_id").references(() => corpusRevisions.id),
  primaryProfileId: uuid("primary_profile_id").references(() => agentProfiles.id),
  reviewerProfileId: uuid("reviewer_profile_id").references(() => agentProfiles.id),
  reviewMode: text("review_mode").notNull(),
  reviewStatus: text("review_status").notNull(),
  directAnswer: text("direct_answer").notNull(),
  steps: jsonb("steps").$type<string[]>().notNull(),
  safetyAssumptions: jsonb("safety_assumptions").$type<string[]>().notNull(),
  confidence: text("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
});

export const answerClaims = pgTable("answer_claims", {
  id: uuid("id").primaryKey(),
  answerId: uuid("answer_id").notNull().references(() => answers.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  rationaleCode: text("rationale_code"),
}, (table) => [unique("answer_claims_answer_ordinal_unique").on(table.answerId, table.ordinal)]);

export const claimEvidence = pgTable("claim_evidence", {
  claimId: uuid("claim_id").notNull().references(() => answerClaims.id, { onDelete: "cascade" }),
  evidenceItemId: text("evidence_item_id").notNull().references(() => evidenceItems.id),
}, (table) => [primaryKey({ columns: [table.claimId, table.evidenceItemId], name: "claim_evidence_pk" })]);

export const feedbackRecords = pgTable("feedback", {
  id: uuid("id").primaryKey(),
  answerId: uuid("answer_id").notNull().references(() => answers.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  rating: text("rating").notNull(),
  reason: text("reason"),
  comment: text("comment"),
  questionFingerprint: text("question_fingerprint").notNull(),
  corpusCommit: text("corpus_commit").notNull(),
  profileRevisionIds: jsonb("profile_revision_ids").$type<string[]>().notNull(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [unique("feedback_answer_account_unique").on(table.answerId, table.accountId)]);

export const trainingExamples = pgTable("training_examples", {
  id: uuid("id").primaryKey(),
  feedbackId: uuid("feedback_id").references(() => feedbackRecords.id),
  state: text("state").notNull(),
  content: jsonb("content").$type<Readonly<Record<string, unknown>>>().notNull(),
  authorId: uuid("author_id").notNull().references(() => accounts.id),
  reviewerId: uuid("reviewer_id").references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
});

export const trainingSessions = pgTable("training_sessions", {
  id: uuid("id").primaryKey(),
  trainerAccountId: uuid("trainer_account_id").notNull().references(() => accounts.id),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  targetRepository: text("target_repository").notNull(),
  originalQuestion: text("original_question").notNull(),
  state: text("state").notNull().default("ACTIVE"),
  currentAnswer: jsonb("current_answer").$type<Readonly<Record<string, unknown>>>(),
  currentReport: jsonb("current_report").$type<Readonly<Record<string, unknown>>>(),
  proposalId: uuid("proposal_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
});

export const trainingTurns = pgTable("training_turns", {
  id: uuid("id").primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  actor: text("actor").notNull(),
  kind: text("kind").notNull(),
  content: jsonb("content").$type<Readonly<Record<string, unknown>>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [unique("training_turns_session_ordinal_unique").on(table.sessionId, table.ordinal)]);

export const webFindings = pgTable("web_findings", {
  id: uuid("id").primaryKey(),
  url: text("url").notNull(), publisher: text("publisher"),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  digest: text("digest").notNull(), excerpt: text("excerpt").notNull(), authority: text("authority").notNull(),
  reviewState: text("review_state").notNull(), flaggerId: uuid("flagger_id").notNull().references(() => accounts.id),
  reviewerId: uuid("reviewer_id").references(() => accounts.id), notes: text("notes"),
});

export const sourceRepositories = pgTable("source_repositories", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull().unique(),
  url: text("url").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  defaultBranch: text("default_branch").notNull(),
  indexedCommit: text("indexed_commit").notNull(),
  validationReport: jsonb("validation_report").$type<Readonly<Record<string, unknown>>>().notNull(),
  linkedBy: uuid("linked_by").references(() => accounts.id),
  linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [check("source_repositories_version_positive", sql`${table.version} > 0`)]);

export const sourceChunks = pgTable("source_chunks", {
  repositoryId: uuid("repository_id").notNull().references(() => sourceRepositories.id, { onDelete: "cascade" }),
  chunkId: text("chunk_id").notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  path: text("path").notNull(),
  locator: text("locator").notNull(),
  authority: text("authority").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  digest: text("digest").notNull(),
  content: text("content").notNull(),
}, (table) => [primaryKey({ columns: [table.repositoryId, table.chunkId], name: "source_chunks_pk" })]);

export const changeProposals = pgTable("change_proposals", {
  id: uuid("id").primaryKey(), proposerId: uuid("proposer_id").notNull().references(() => accounts.id), reviewerId: uuid("reviewer_id").references(() => accounts.id),
  rationale: text("rationale").notNull(), targetRepository: text("target_repository").notNull(), baseCommit: text("base_commit").notNull(), targetPath: text("target_path").notNull(),
  operation: text("operation").notNull(), proposedContent: text("proposed_content").notNull(), contentDigest: text("content_digest").notNull(), state: text("state").notNull(),
  branchName: text("branch_name"), commitSha: text("commit_sha"), pullRequestUrl: text("pull_request_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(), version: integer("version").notNull().default(1),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey(), kind: text("kind").notNull(), payload: jsonb("payload").$type<Readonly<Record<string, unknown>>>().notNull(),
  status: text("status").notNull().default("READY"), attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
  lastErrorCode: text("last_error_code"), lastErrorMessage: text("last_error_message"), createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
}, (table) => [index("jobs_lease_idx").on(table.status, table.availableAt, table.leaseExpiresAt)]);
