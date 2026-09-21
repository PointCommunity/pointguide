import { expect, it } from "vitest";
import { trainingRetryLabel, trainingStateLabel, trainingStateSummary } from "@/lib/training/presentation";
import type { TrainingSessionRecord } from "@/lib/training/types";

const session = { state: "FAILED", currentAnswer: { id: "answer" }, publishedCommit: null } as unknown as TrainingSessionRecord;

it("explains training state and recovery in trainer language", () => {
  expect(trainingStateLabel(session)).toBe("Needs attention");
  expect(trainingStateSummary(session)).toContain("publication needs retry");
  expect(trainingRetryLabel(session)).toBe("Retry publishing");
  expect(trainingStateSummary({ ...session, publishedCommit: "a".repeat(40) })).toContain("activation needs retry");
  expect(trainingRetryLabel({ ...session, publishedCommit: "a".repeat(40) })).toBe("Retry activation");
  expect(trainingStateLabel({ ...session, state: "ACTIVE_KNOWLEDGE" })).toBe("Ready to use");
});
