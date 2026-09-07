import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateGroundedAnswer } from "@/lib/agent/claims";
import type { AnswerDraft } from "@/lib/agent/schema";
import { demoChunks } from "@/lib/evidence/demo";
import { searchCorpus } from "@/lib/evidence/search";
import { accountBoundaryErrorResponse } from "@/lib/auth/http";
import { requireApprovedAccount } from "@/lib/auth/policy";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";
import { authenticateRequest, type SessionDependencies } from "@/lib/auth/session";

const requestSchema = z.object({ question: z.string().trim().min(1).max(8_000) });

function unknownAnswer(question: string): AnswerDraft {
  return {
    directAnswer: "The current source repositories do not contain enough evidence to answer that yet.",
    steps: ["Confirm the exact device, model, location, and current observed state so a Trainer can add verified documentation."],
    safetyAndAssumptions: ["No equipment identity is assumed from the question."],
    confidence: "UNKNOWN",
    claims: [{
      id: "claim:unknown",
      text: `The answer to “${question.slice(0, 240)}” is not established by the current evidence set.`,
      kind: "UNKNOWN",
      status: "UNKNOWN",
      evidenceIds: [],
    }],
  };
}

export async function handleDemoAsk(request: Request, dependencies: SessionDependencies): Promise<Response> {
  try {
    requireApprovedAccount(await authenticateRequest(request, dependencies));
  } catch (error) {
    return accountBoundaryErrorResponse(error);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID_QUESTION", message: "Enter a question between 1 and 8,000 characters." } }, { status: 400 });
  }

  const evidence = searchCorpus(parsed.data.question, demoChunks);
  const draft: AnswerDraft = evidence.length === 0 ? unknownAnswer(parsed.data.question) : {
    directAnswer: "A red AES50 SYNC light means the DL32's AES50 connection is present but not synchronized. Verify the clock relationship and cable path before changing routing.",
    steps: [
      "Confirm the indicator is red—not off—and note whether it is on AES50 A or B.",
      "Verify the connected console and DL32 are configured for one valid clock relationship before changing signal routing.",
    ],
    safetyAndAssumptions: [
      "This answer applies to a confirmed Midas DL32. Clock changes can interrupt all audio on the link; make them only during an approved service window with the current state recorded.",
    ],
    confidence: "CONFIRMED",
    claims: [{
      id: "claim:dl32-sync-red",
      text: "On a DL32, a red AES50 SYNC LED indicates that the AES50 connection is not synchronized.",
      kind: "FACTUAL",
      status: "SUPPORTED",
      evidenceIds: [evidence[0].id],
    }],
  };
  const grounded = validateGroundedAnswer(draft, evidence);

  return Response.json({
    answer: {
      id: randomUUID(),
      ...grounded,
      evidence,
      reviewStatus: "NOT_REQUESTED",
    },
  });
}

export function POST(request: Request): Promise<Response> {
  return handleDemoAsk(request, getRuntimeSessionDependencies());
}
