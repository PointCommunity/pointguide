import type { TrainingSessionRecord } from "./types";

export function trainingStateLabel(session: TrainingSessionRecord): string {
  switch (session.state) {
    case "ACTIVE": return session.currentAnswer ? "Answer ready" : "Answer needs retry";
    case "REVISING": return "Revision needs retry";
    case "PUBLISHING": return "Publishing";
    case "ACTIVATING": return "Activating";
    case "ACTIVE_KNOWLEDGE": return "Active guidance";
    case "FAILED": return "Needs attention";
    case "SUPERSEDED": return "Replaced by newer guidance";
    case "REPORT_READY": return "Earlier report ready";
    case "REPORT_ACCEPTED": return "Earlier report accepted";
    case "PROPOSED": return "Earlier proposal created";
  }
}

export function trainingStateSummary(session: TrainingSessionRecord): string {
  switch (session.state) {
    case "ACTIVE": return session.currentAnswer ? "PointGuide's answer is ready for your feedback." : "Your question is saved; the first answer needs retry.";
    case "REVISING": return "Your feedback is saved; the revision needs retry.";
    case "PUBLISHING": return `Saving the exact accepted answer to ${session.targetRepository}.`;
    case "ACTIVATING": return "The answer is published; PointGuide is validating and activating it.";
    case "ACTIVE_KNOWLEDGE": return "The accepted guidance is active and available to future answers.";
    case "FAILED": return session.publishedCommit ? "Your exact accepted answer is already published; activation needs retry." : "Your exact accepted answer is saved; publication needs retry.";
    case "SUPERSEDED": return "A newer accepted answer replaced this guidance.";
    case "REPORT_READY": return session.currentReport?.summary ?? "An earlier learning report is ready.";
    case "REPORT_ACCEPTED": return session.currentReport?.summary ?? "An earlier learning report was accepted.";
    case "PROPOSED": return session.currentReport?.summary ?? "An earlier repository proposal was created.";
  }
}

export function trainingRetryLabel(session: TrainingSessionRecord): string {
  return session.publishedCommit ? "Retry activation" : "Retry publishing";
}
