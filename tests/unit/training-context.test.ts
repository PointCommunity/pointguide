import { expect, it } from "vitest";
import { MemoryTrainingSessionStore } from "@/lib/training/store";
import { trainingHistory } from "@/lib/training/context";

it("reconstructs original question, every feedback and answer evidence after more than 20 revisions", async () => {
  const store = new MemoryTrainingSessionStore();
  let session = await store.create({ trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "How do we check sync?" });
  for (let index = 0; index <= 20; index += 1) {
    session = await store.saveAnswer(session.id, "trainer", {
      id: `answer-${index}`,
      directAnswer: `Answer ${index}`,
      steps: [`Step ${index}`],
      safetyAndAssumptions: [`Safety ${index}`],
      confidence: "SUPPORTED",
      claims: [{ id: `claim-${index}`, text: `Claim ${index}`, kind: "ACTIONABLE", status: "SUPPORTED", evidenceIds: [`evidence-${index}`] }],
      evidence: [{ id: `evidence-${index}` }],
    });
    if (index < 20) await store.saveFeedback(session.id, "trainer", session.version, `answer-${index}`, index === 0 ? "Never change the clock without approval." : `Constraint ${index}`);
  }
  const history = trainingHistory(session, await store.listTurns(session.id, "trainer"));
  expect(history[0].content).toContain("How do we check sync?");
  expect(history.map(turn => turn.content).join(" ")).toContain("Never change the clock without approval.");
  expect(history.map(turn => turn.content).join(" ")).toContain("Constraint 19");
  expect(history.at(-1)?.content).toContain("evidence-20");
  expect(history.find(turn => turn.content.includes("Answer 0"))?.content).toContain('"steps":["Step 0"]');
  expect(history.find(turn => turn.content.includes("Answer 0"))?.content).toContain('"safetyAndAssumptions":["Safety 0"]');
  expect(history.find(turn => turn.content.includes("Answer 0"))?.content).toContain('"claims":[{"id":"claim-0"');
  expect(history).toHaveLength(42);
});

it("keeps a pending clarifying question and its response across leave and resume", async () => {
  const store = new MemoryTrainingSessionStore();
  const session = await store.create({ trainerAccountId: "trainer", conversationId: "conversation", targetRepository: "PointCommunity/pointaudio", originalQuestion: "Which input?" });
  const answerId = crypto.randomUUID();
  const answered = await store.saveAnswer(session.id, "trainer", { id: answerId, directAnswer: "Identify the console first.", clarifyingQuestion: "Is it an M32R?" });
  await store.saveClarification(session.id, "trainer", answered.version, answerId, "Yes, M32R");
  const loaded = await store.get(session.id, "trainer");
  const history = trainingHistory(loaded, await store.listTurns(session.id, "trainer"));
  expect(history.map(item => item.content).join(" ")).toContain("Is it an M32R?");
  expect(history.map(item => item.content).join(" ")).toContain("Yes, M32R");
});
