import { randomUUID } from "node:crypto";
import { z } from "zod";

const feedbackInput = z.object({
  answerId:z.string().min(1), accountId:z.string().min(1), rating:z.enum(["HELPFUL","NOT_HELPFUL"]),
  reason:z.string().max(100).nullable().optional(), comment:z.string().max(2000).nullable().optional(),
  questionFingerprint:z.string().min(1), corpusCommit:z.string().min(1), profileRevisionIds:z.array(z.string()), evidenceIds:z.array(z.string()),
});
export type FeedbackInput = z.infer<typeof feedbackInput>;
export interface FeedbackRecord extends FeedbackInput { id:string; createdAt:string }

export class LearningStore {
  private readonly feedback: FeedbackRecord[] = [];
  record(raw: FeedbackInput): FeedbackRecord {
    const input = feedbackInput.parse(raw);
    const record = Object.freeze({ ...input, id:randomUUID(), createdAt:new Date().toISOString(), profileRevisionIds:[...input.profileRevisionIds], evidenceIds:[...input.evidenceIds] });
    this.feedback.push(record);
    return record;
  }
  list(): FeedbackRecord[] { return this.feedback.map((item) => ({ ...item, profileRevisionIds:[...item.profileRevisionIds], evidenceIds:[...item.evidenceIds] })); }
}
