import { z } from "zod";
import type { ProviderModel } from "@/lib/providers/types";

const nonempty = z.string().trim().min(1).max(200);
const codexEffortSchema = z.object({
  reasoningEffort: nonempty,
  description: z.string().trim().max(500).default(""),
});
const codexModelSchema = z.object({
  id: nonempty,
  model: nonempty,
  displayName: nonempty,
  description: z.string().trim().max(2_000).nullish(),
  hidden: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  inputModalities: z.array(nonempty).max(20).default(["text", "image"]),
  defaultReasoningEffort: z.string().trim().min(1).nullish(),
  supportedReasoningEfforts: z.array(codexEffortSchema).max(20).default([]),
});
const codexCatalogSchema = z.object({
  data: z.array(codexModelSchema).max(1_000),
  nextCursor: z.string().trim().min(1).nullish(),
});

const ollamaModelSchema = z.object({
  name: nonempty,
  model: nonempty,
  modified_at: z.string().optional(),
  size: z.number().nonnegative().optional(),
  digest: z.string().optional(),
  details: z.object({
    family: z.string().optional(),
    parameter_size: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();
const ollamaCatalogSchema = z.object({ models: z.array(ollamaModelSchema).max(1_000) });

function assertUniqueModelIds(models: readonly ProviderModel[]): void {
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.id)) throw new Error(`Provider returned duplicate model ID: ${model.id}`);
    seen.add(model.id);
  }
}

export function normalizeCodexCatalog(input: unknown): ProviderModel[] {
  const catalog = codexCatalogSchema.parse(input);
  const models = catalog.data.map((model): ProviderModel => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description ?? null,
    isDefault: model.isDefault,
    hidden: model.hidden,
    modalities: [...model.inputModalities],
    reasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
      effort: effort.reasoningEffort,
      description: effort.description,
      isDefault: effort.reasoningEffort === model.defaultReasoningEffort,
    })),
    metadata: {},
  }));
  assertUniqueModelIds(models);
  return models;
}

export function normalizeOllamaCatalog(input: unknown): ProviderModel[] {
  const catalog = ollamaCatalogSchema.parse(input);
  const models = catalog.models.map((model): ProviderModel => ({
    id: model.model,
    displayName: model.name,
    description: null,
    isDefault: false,
    hidden: false,
    modalities: ["text"],
    reasoningEfforts: [],
    metadata: Object.fromEntries([
      ["family", model.details?.family],
      ["parameterSize", model.details?.parameter_size],
    ].filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  }));
  assertUniqueModelIds(models);
  return models;
}

export function selectAdvertisedEffort(model: ProviderModel, effort: string | null): string | null {
  if (effort === null && model.reasoningEfforts.length === 0) return null;
  if (effort !== null && model.reasoningEfforts.some((candidate) => candidate.effort === effort)) return effort;
  throw new Error(`Reasoning effort ${effort ?? "none"} was not advertised for ${model.id}.`);
}

export function parseCodexCatalogPage(input: unknown) {
  return codexCatalogSchema.parse(input);
}
