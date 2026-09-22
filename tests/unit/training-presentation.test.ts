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

it("distinguishes active generation from a saved answer that needs retry", () => {
  const generating = { ...session, state: "GENERATING", currentAnswer: null, answerError: null } as TrainingSessionRecord;
  expect(trainingStateLabel(generating)).toBe("Preparing answer");
  expect(trainingStateSummary(generating)).toContain("question is saved");
  const revising = { ...generating, state: "REVISING", currentAnswer: { id: "answer" } } as TrainingSessionRecord;
  expect(trainingStateLabel(revising)).toBe("Revising answer");
  expect(trainingStateSummary(revising)).toContain("feedback is saved");
  expect(trainingStateLabel({ ...revising, answerError: "failed" })).toBe("Needs attention");
  expect(trainingStateSummary({ ...revising, answerError: "failed" })).toContain("needs retry");
  expect(trainingStateSummary({ ...generating, state: "ACTIVE" })).toContain("first answer needs retry");
  expect(trainingStateSummary({ ...revising, state: "ACTIVE" })).toContain("ready for your feedback");
});
