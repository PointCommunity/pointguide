import type { Account } from "@/lib/auth/types";
import { AccountPolicyError, requireRole } from "@/lib/auth/policy";

export const providerIds = ["CODEX", "OLLAMA_CLOUD"] as const;
export const providerStatuses = ["DISCONNECTED", "CONNECTING", "CONNECTED", "ERROR"] as const;
export const profileRoles = ["PRIMARY", "REVIEWER"] as const;

export type ProviderId = (typeof providerIds)[number];
export type ProviderStatus = (typeof providerStatuses)[number];
export type ProfileRole = (typeof profileRoles)[number];

export interface ReasoningEffort {
  effort: string;
  description: string;
  isDefault: boolean;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description: string | null;
  isDefault: boolean;
  hidden: boolean;
  modalities: string[];
  reasoningEfforts: ReasoningEffort[];
  metadata: Readonly<Record<string, string>>;
}

export interface StoredProviderConnection {
  provider: ProviderId;
  status: ProviderStatus;
  encryptedSecret: string | null;
  externalSecretRef: string | null;
  credentialLocation?: string | null;
  accountLabel: string | null;
  lastErrorCode: string | null;
}

export interface PublicProviderConnection {
  provider: ProviderId;
  status: ProviderStatus;
  credentialConfigured: boolean;
  accountLabel: string | null;
  lastErrorCode: string | null;
}

export interface DeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface ProviderConnectionRecord extends StoredProviderConnection {
  id: string;
  credentialLocation: string | null;
  catalogRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AgentProfileInput {
  id: string;
  name: string;
  role: ProfileRole;
  provider: ProviderId;
  modelId: string;
  reasoningEffort: string | null;
  enabled: boolean;
  ownerPrompt: string;
}

export interface AgentProfileRecord extends Omit<AgentProfileInput, "ownerPrompt"> {
  systemPrompt: string;
  connectionId: string;
  promptRevisionId: string;
  promptRevision: number;
  corePolicyRevision: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ExecutionProfile extends AgentProfileRecord {
  ownerPrompt: string;
  connection: ProviderConnectionRecord;
}

export interface ReviewSetting {
  enabled: boolean;
  version: number;
}

export interface ProviderConnectionUpdate {
  provider: ProviderId;
  status: ProviderStatus;
  encryptedSecret?: string;
  externalSecretRef?: string;
  credentialLocation?: string;
  accountLabel?: string;
  lastErrorCode?: string | null;
  models?: ProviderModel[];
}

export interface ProviderConfigurationStore {
  listConnections(): Promise<ProviderConnectionRecord[]>;
  getConnection(provider: ProviderId): Promise<ProviderConnectionRecord | null>;
  updateConnection(actorId: string, update: ProviderConnectionUpdate, now?: Date): Promise<ProviderConnectionRecord>;
  listModels(provider: ProviderId): Promise<ProviderModel[]>;
  saveProfile(actorId: string, input: AgentProfileInput, now?: Date): Promise<AgentProfileRecord>;
  listProfiles(): Promise<AgentProfileRecord[]>;
  getExecutionProfile(role: ProfileRole): Promise<ExecutionProfile | null>;
  getReviewSetting(): Promise<ReviewSetting>;
  setReviewSetting(actorId: string, enabled: boolean, now?: Date): Promise<ReviewSetting>;
}

export interface CodexOperations {
  startDeviceLogin(): Promise<DeviceLogin>;
  listModels(): Promise<ProviderModel[]>;
}

export interface OllamaOperations {
  connect(apiKey: string): Promise<ProviderModel[]>;
}

export interface AppServerClient {
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown>;
  subscribe?(listener: (method: string, params: unknown) => void): () => void;
}

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function authorizeProviderMutation(actor: Account): void {
  try {
    requireRole(actor, ["OWNER"]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("permission")) {
      throw new AccountPolicyError("OWNER_ONLY", "Only an Owner can manage AI providers.");
    }
    throw error;
  }
}
