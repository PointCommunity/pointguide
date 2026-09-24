import type { SourceRepositoryRecord, SourceRepositoryStore, ValidatedSource } from "./types";
import { SourceValidationError } from "./validator";
import { SourceStoreError } from "./store";

export type RefreshEvent = { type: "checking"; id: string; fullName: string } | { type: "result"; id: string; fullName: string; outcome: "updated" | "current" | "failed"; source?: SourceRepositoryRecord; message?: string } | { type: "done" } | { type: "heartbeat" };

export async function refreshKnowledge(actorId: string, store: SourceRepositoryStore, validate: (url: string) => Promise<ValidatedSource>, emit: (event: RefreshEvent) => void, signal: AbortSignal) {
  const sources = (await store.list()).filter(source => source.status === "ACTIVE");
  for (const source of sources) {
    signal.throwIfAborted();
    emit({ type: "checking", id: source.id, fullName: source.fullName });
    try {
      let expected = source;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const validated = await validate(expected.url);
        signal.throwIfAborted();
        try {
          const result = await store.refresh(actorId, expected, validated);
          emit({ type: "result", id: source.id, fullName: source.fullName, ...result });
          break;
        } catch (error) {
          if (!(error instanceof SourceStoreError && error.code === "SOURCE_CHANGED" && attempt === 0)) throw error;
          const latest = (await store.list()).find(item => item.id === source.id && item.status === "ACTIVE");
          if (!latest) throw error;
          expected = latest;
        }
      }
    } catch (error) {
      const known = error instanceof SourceValidationError || error instanceof SourceStoreError;
      const message = known ? error.message : "Refresh failed. Previous knowledge remains available; try again.";
      await store.refreshFailed(actorId, source.id, known ? error.code : "REFRESH_FAILED");
      signal.throwIfAborted();
      emit({ type: "result", id: source.id, fullName: source.fullName, outcome: "failed", message });
    }
  }
  emit({ type: "done" });
}
