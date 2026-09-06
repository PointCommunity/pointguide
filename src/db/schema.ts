import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accountRoles, accountStatuses } from "@/lib/auth/types";

export const accountRole = pgEnum("account_role", accountRoles);
export const accountStatus = pgEnum("account_status", accountStatuses);

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
