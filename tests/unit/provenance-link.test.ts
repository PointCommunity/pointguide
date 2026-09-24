import { expect, it } from "vitest";
import { repositoryEvidenceUrl } from "@/lib/evidence/provenance-link";
import type { EvidenceItem } from "@/lib/agent/schema";

it("links only exact source paths and immutable revisions", () => {
  const item = { path: "research/pointguide-training/abc/answer.json", locator: `PointCommunity/pointaudio@${"a".repeat(40)}; accepted`, kind: "ACCEPTED_TRAINING" } as EvidenceItem;
  expect(repositoryEvidenceUrl(item)).toBe(`https://github.com/PointCommunity/pointaudio/blob/${"a".repeat(40)}/research/pointguide-training/abc/answer.json`);
  expect(repositoryEvidenceUrl({ ...item, locator: "repo@main" })).toBeNull();
  expect(repositoryEvidenceUrl({ ...item, path: "../AGENTS.md" })).toBeNull();
});
