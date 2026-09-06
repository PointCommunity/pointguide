import type { Account } from "@/lib/auth/types";
import { requireRole } from "@/lib/auth/policy";

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

export interface AppServerClient {
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function authorizeProviderMutation(actor: Account): void {
  try {
    requireRole(actor, ["OWNER"]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("permission")) {
      throw new Error("Only an Owner can manage AI providers.");
    }
    throw error;
  }
}
