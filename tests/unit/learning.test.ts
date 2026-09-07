import { describe, expect, it } from "vitest";
import { LearningStore } from "@/lib/feedback/store";

describe("governed feedback and training", () => {
  it("retains immutable answer context and treats ratings as usefulness only", () => {
    const store = new LearningStore();
    const feedback = store.record({ answerId:"a1", accountId:"u1", rating:"NOT_HELPFUL", reason:"MISSING_DETAIL", comment:"Need cable type", questionFingerprint:"q", corpusCommit:"abc", profileRevisionIds:["p1"], evidenceIds:["e1"] });
    expect(feedback.id).toBeTruthy();
    expect(store.list()).toEqual([feedback]);
    expect(() => store.record({ ...feedback, answerId:"" })).toThrow();
  });
});
