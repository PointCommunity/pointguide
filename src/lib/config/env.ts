import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_MODE: z.enum(["cloudflare", "fixture"]).default("cloudflare"),
  CF_ACCESS_TEAM_DOMAIN: z.url().optional(),
  CF_ACCESS_AUDIENCE: z.string().min(1).optional(),
  FIXTURE_AUTH_SUBJECT: z.string().trim().min(1).optional(),
  FIXTURE_AUTH_EMAIL: z.string().trim().pipe(z.email()).optional(),
  FIXTURE_AUTH_NAME: z.string().trim().min(1).optional(),
  PROVIDER_SECRET_KEY: z.string().min(1).optional(),
  REVIEW_ENABLED: z.stringbool().default(false),
  LIVE_PROVIDERS_ENABLED: z.stringbool().default(false),
  GIT_WRITES_ENABLED: z.stringbool().default(false),
  WEB_SEARCH_ENABLED: z.stringbool().default(false),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Readonly<Record<string, string | undefined>>): Environment {
  const parsed = environmentSchema.safeParse(values);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
    throw new Error(`Invalid server configuration: ${[...new Set(fields)].join(", ")}`);
  }
  return parsed.data;
}

export function assertProductionEnvironment(environment: Environment): void {
  if (environment.NODE_ENV !== "production") return;
  const missing = [
    environment.DATABASE_URL ? null : "DATABASE_URL",
    environment.AUTH_MODE === "cloudflare" ? null : "AUTH_MODE=cloudflare",
    environment.CF_ACCESS_TEAM_DOMAIN ? null : "CF_ACCESS_TEAM_DOMAIN",
    environment.CF_ACCESS_AUDIENCE ? null : "CF_ACCESS_AUDIENCE",
    environment.PROVIDER_SECRET_KEY ? null : "PROVIDER_SECRET_KEY",
  ].filter((value): value is string => value !== null);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
}
