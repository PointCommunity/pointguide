import { z } from "zod";

export const reviewFindingSchema = z.object({
  claimId: z.string().min(1),
  verdict: z.enum(["SUPPORTED", "REJECTED"]),
  rationaleCode: z.enum(["ENTAILED", "CONTRADICTED", "INAPPLICABLE", "INSUFFICIENT", "UNSAFE"]),
});

export const reviewResultSchema = z.object({ findings: z.array(reviewFindingSchema).max(100) });
export type ReviewResult = z.infer<typeof reviewResultSchema>;
