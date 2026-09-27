import type { Environment } from "@/lib/config/env";
import { contentDigest } from "@/lib/git/proposals";
import { knowledgeSnapshot } from "@/lib/sources/retrieval";
import type { SourceRepositoryStore } from "@/lib/sources/types";
import type { TrainingSessionRecord } from "./types";

export async function withTrainingAvailability(sessions: TrainingSessionRecord[], store: SourceRepositoryStore, environment: Environment): Promise<TrainingSessionRecord[]> {
  if (!sessions.some(session => session.state === "ACTIVE_KNOWLEDGE")) return sessions;
  // Only the indexed snapshot can establish Training availability; built-in ordinary chunks cannot.
  const { guidance } = await knowledgeSnapshot(store, environment, async () => []);
  return sessions.map(session => {
    if (session.state !== "ACTIVE_KNOWLEDGE") return session;
    const accepted = session.acceptedContent && contentDigest(session.acceptedContent) === session.acceptedDigest
      ? guidance.find(item => item.repository === session.targetRepository && item.path === session.acceptedPath && item.digest === session.acceptedDigest) : undefined;
    return { ...session, knowledgeAvailable: Boolean(accepted), ...(accepted ? { indexedCommit: accepted.indexedCommit } : {}) };
  });
}
