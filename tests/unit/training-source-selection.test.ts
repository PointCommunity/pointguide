import { expect, it } from "vitest";
import { selectTrainingSource } from "@/lib/training/source-selection";
import type { IndexedChunk } from "@/lib/evidence/search";

const sources = [{ fullName: "PointCommunity/pointaudio", status: "ACTIVE" }, { fullName: "PointCommunity/pointplanning", status: "ACTIVE" }] as const;
const chunks = [
  { chunkId: "PointCommunity/pointaudio:one", metadata: { product: "Midas M32R", applicability: { model: "M32R" } } },
  { chunkId: "PointCommunity/pointplanning:one", metadata: { product: "Planning Center Services", applicability: { model: "Services" } } },
] as unknown as IndexedChunk[];

it("routes an explicit model or product to one active source without a repository form", () => {
  expect(selectTrainingSource("How many local M32R sockets?", sources, chunks)).toBe("PointCommunity/pointaudio");
  expect(selectTrainingSource("How do Services schedule responses work?", sources, chunks)).toBe("PointCommunity/pointplanning");
  expect(selectTrainingSource("How many local sockets?", [sources[0]], chunks)).toBe("PointCommunity/pointaudio");
});

it("asks for a subject area when source identity is absent or spans repositories", () => {
  expect(selectTrainingSource("How do we get started?", sources, chunks)).toBeNull();
  expect(selectTrainingSource("How does M32R audio relate to Services schedules?", sources, chunks)).toBeNull();
  expect(selectTrainingSource("How many local M32 sockets?", sources, chunks)).toBeNull();
});
