import { expect, it, vi } from "vitest";
import { withTrainingAvailability } from "@/lib/training/availability";
import { parseEnvironment } from "@/lib/config/env";
import { MemorySourceRepositoryStore } from "@/lib/sources/store";
import { validateSourceRepository } from "@/lib/sources/validator";
import type { TrainingSessionRecord } from "@/lib/training/types";
import { acceptedSourceFiles, commit, digest, upstream } from "../fixtures/source-contract";

const environment = parseEnvironment({ AUTH_MODE: "fixture" });

it("checks current indexed artifact bytes without changing historical acceptance", async () => {
  const { files, path } = acceptedSourceFiles();
  const validated = await validateSourceRepository("https://github.com/PointCommunity/test", { fetcher: upstream(files) });
  const store = new MemorySourceRepositoryStore(false);
  const source = await store.link("owner", validated);
  const session = { state: "ACTIVE_KNOWLEDGE", targetRepository: source.fullName, acceptedPath: path, acceptedContent: files[path], acceptedDigest: digest(files[path]), indexedCommit: "a".repeat(40) } as TrainingSessionRecord;
  const original = structuredClone(session);
  expect(await withTrainingAvailability([session], store, environment)).toEqual([{ ...session, knowledgeAvailable: true, indexedCommit: commit }]);
  expect(session).toEqual(original);
  expect((await withTrainingAvailability([{ ...session, acceptedContent: files[path] + " " }], store, environment))[0].knowledgeAvailable).toBe(false);
  expect((await withTrainingAvailability([{ ...session, targetRepository: "PointCommunity/other" }], store, environment))[0].knowledgeAvailable).toBe(false);
  const snapshot = await store.snapshot();
  vi.spyOn(store, "snapshot").mockResolvedValueOnce({ ...snapshot, chunks: snapshot.chunks.filter(chunk => chunk.path !== path) });
  expect((await withTrainingAvailability([session], store, environment))[0].knowledgeAvailable).toBe(false);
  await store.archive("owner", source.id, source.fullName);
  expect(await withTrainingAvailability([session], store, environment)).toEqual([{ ...session, knowledgeAvailable: false }]);
  expect(session).toEqual(original);
});

it("does not read source knowledge for unfinished sessions", async () => {
  const store = new MemorySourceRepositoryStore(false);
  const snapshot = vi.spyOn(store, "snapshot");
  const sessions = [{ state: "ACTIVE" }] as TrainingSessionRecord[];
  expect(await withTrainingAvailability(sessions, store, environment)).toEqual(sessions);
  expect(snapshot).not.toHaveBeenCalled();
});
