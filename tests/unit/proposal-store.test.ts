import { describe, expect, it } from "vitest";
import { MemoryProposalRepository } from "@/lib/git/store";

describe("proposal repository", () => {
  it("retains an exact draft digest for Trainer review", async () => {
    const store = new MemoryProposalRepository();
    const saved = await store.create({ proposerId: "u1", rationale: "Verified", targetRepository: "PointCommunity/pointaudio", baseCommit: "deadbeef", targetPath: "research/test.txt", operation: "CREATE", proposedContent: "fact\n" });
    expect(saved.state).toBe("DRAFT");
    expect(saved.digest).toHaveLength(64);
    expect(await store.list()).toEqual([saved]);
    await expect(store.transition(saved.id, "IN_REVIEW", "reviewer")).resolves.toEqual(expect.objectContaining({ state: "IN_REVIEW" }));
    await expect(store.transition(saved.id, "PR_OPENED", "reviewer")).rejects.toThrow("INVALID_TRANSITION");
    await expect(store.transition("missing", "IN_REVIEW", "reviewer")).rejects.toThrow("INVALID_TRANSITION");
  });
});
