import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { openProposalPullRequest, runCommand, type ApprovedProposal } from "../src/lib/git/worker";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const sql = postgres(databaseUrl, { max: 1 });
const owner = `worker-${randomUUID()}`;

async function tick(): Promise<boolean> {
  const [job] = await sql.begin(async (transaction) => transaction`
    UPDATE jobs SET status='LEASED', lease_owner=${owner}, lease_expires_at=now()+interval '60 seconds',
      attempts=attempts+1, updated_at=now()
    WHERE id=(SELECT id FROM jobs WHERE status='READY' AND available_at<=now()
      AND (lease_expires_at IS NULL OR lease_expires_at<now())
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,kind,payload`);
  if (!job) return false;
  try {
    if (job.kind !== "APPLY_PROPOSAL") throw new Error("UNSUPPORTED_JOB_KIND");
    if (process.env.GIT_WRITES_ENABLED !== "true") throw new Error("GIT_WRITES_DISABLED");
    const proposalId = typeof job.payload?.proposalId === "string" ? job.payload.proposalId : "";
    const [proposal] = await sql`SELECT * FROM change_proposals WHERE id=${proposalId}`;
    if (!proposal || proposal.state !== "APPROVED") throw new Error("PROPOSAL_NOT_APPROVED");
    await sql`UPDATE change_proposals SET state='QUEUED',updated_at=now(),version=version+1 WHERE id=${proposal.id}`;
    let temporaryRoot: string | null = null;
    let checkout = proposal.target_repository === "PointCommunity/pointaudio" ? process.env.POINTAUDIO_CHECKOUT : undefined;
    try {
      if (!checkout) {
        temporaryRoot = await mkdtemp(join(tmpdir(), "pointguide-source-"));
        checkout = join(temporaryRoot, "source");
        await runCommand("gh", ["repo", "clone", proposal.target_repository, checkout], temporaryRoot);
      }
      const result = await openProposalPullRequest({
        id: proposal.id, state: "APPROVED", targetRepository: proposal.target_repository,
        baseCommit: proposal.base_commit, targetPath: proposal.target_path,
        proposedContent: proposal.proposed_content, digest: proposal.content_digest, rationale: proposal.rationale,
      } as ApprovedProposal, checkout);
      await sql.begin(async (transaction) => {
        await transaction`UPDATE change_proposals SET state='PR_OPENED',branch_name=${result.branch},commit_sha=${result.commit},
          pull_request_url=${result.pullRequestUrl},updated_at=now(),version=version+1 WHERE id=${proposal.id}`;
        await transaction`UPDATE jobs SET status='SUCCEEDED',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${job.id}`;
      });
    } finally {
      if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKER_FAILED";
    await sql.begin(async (transaction) => {
      await transaction`UPDATE jobs SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='WORKER_FAILED',
        last_error_message=${message.slice(0, 500)},updated_at=now() WHERE id=${job.id}`;
      const proposalId = typeof job.payload?.proposalId === "string" ? job.payload.proposalId : "";
      if (proposalId) await transaction`UPDATE change_proposals SET state='FAILED',updated_at=now(),version=version+1
        WHERE id=${proposalId} AND state='QUEUED'`;
    });
  }
  return true;
}

try {
  if (process.env.WORKER_ONCE === "true") await tick();
  else while (true) if (!await tick()) await new Promise((resolve) => setTimeout(resolve, 1_000));
} finally {
  await sql.end();
}
