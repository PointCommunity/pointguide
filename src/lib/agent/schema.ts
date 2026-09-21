import { z } from "zod";

export const evidenceItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["REPOSITORY", "ACCEPTED_TRAINING", "PRIMARY_WEB", "SECONDARY_WEB"]),
  sourceId: z.string().min(1).optional(),
  title: z.string().min(1),
  path: z.string().min(1).optional(),
  url: z.url().optional(),
  locator: z.string().min(1).optional(),
  authority: z.string().min(1),
  versionOrDate: z.string().min(1).optional(),
  capturedAt: z.iso.datetime(),
  excerpt: z.string().min(1).max(64_000),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  product: z.string().optional(),
  applicability: z.record(z.string(), z.string()).optional(),
  verifiedAt: z.iso.date().nullable().optional(),
  sourceCapturedAt: z.iso.date().nullable().optional(),
});

export const answerClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2_000),
  kind: z.enum(["FACTUAL", "ACTIONABLE", "SAFETY", "UNKNOWN"]),
  status: z.enum(["SUPPORTED", "UNKNOWN", "REJECTED"]),
  evidenceIds: z.array(z.string().min(1)).max(20),
});

export const answerDraftSchema = z.object({
  directAnswer: z.string().min(1).max(8_000),
  steps: z.array(z.string().min(1).max(2_000)).max(20),
  safetyAndAssumptions: z.array(z.string().min(1).max(2_000)).max(20),
  confidence: z.enum(["CONFIRMED", "SUPPORTED", "TENTATIVE", "UNKNOWN"]),
  clarifyingQuestion: z.string().min(1).max(1_000).nullable().optional(),
  claims: z.array(answerClaimSchema).max(100),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type AnswerClaim = z.infer<typeof answerClaimSchema>;
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
