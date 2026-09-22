import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { contentDigest } from "../src/lib/git/proposals";
import { mergeAcceptedArtifact, openProposalPullRequest, publishAcceptedArtifact, runCommand, type ApprovedProposal } from "../src/lib/git/worker";
import { PostgresSourceRepositoryStore } from "../src/db/sources";
import { PostgresTrainingSessionStore } from "../src/db/training";
import { PostgresAccountStore } from "../src/db/accounts";
import { PostgresLearningRepository } from "../src/lib/learning/store";
import { getDatabase } from "../src/db/client";
import { validateSourceRepository } from "../src/lib/sources/validator";
import { parseEnvironment } from "../src/lib/config/env";
import { getRuntimeProviderDependencies, getRuntimeModelRuntime } from "../src/lib/providers/runtime";
import { knowledgeSnapshot } from "../src/lib/sources/retrieval";
import { answerQuestion } from "../src/lib/agent/service";
import { trainingHistory } from "../src/lib/training/context";
import { answerFailureDiagnostic, answerFailureMessage } from "../src/lib/training/answer-error";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const sql = postgres(databaseUrl, { max: 1 });
const owner = `worker-${randomUUID()}`;

async function generateTrainingAnswer(sessionId: string, version: number) {
  const database = getDatabase(databaseUrl!);
  const store = new PostgresTrainingSessionStore(database);
  const [record] = await sql`SELECT trainer_account_id FROM training_sessions WHERE id=${sessionId}`;
  if (!record) return;
  const session = await store.get(sessionId, record.trainer_account_id);
  if (session.version !== version || !["GENERATING", "REVISING"].includes(session.state) || session.answerError) return;
  const actor = await new PostgresAccountStore(database).getAccount(session.trainerAccountId);
  if (!actor || actor.status !== "APPROVED" || !["TRAINER", "ADMIN", "OWNER"].includes(actor.role)) throw new Error("TRAINER_NOT_AUTHORIZED");
  const environment = parseEnvironment(process.env);
  const { chunks, navigation } = await knowledgeSnapshot(new PostgresSourceRepositoryStore(database), environment);
  const fixture = environment.AUTH_MODE === "fixture";
  const result = await answerQuestion({ actor, conversationId: session.conversationId, question: session.originalQuestion, deepResearch: false, providers: getRuntimeProviderDependencies().store, learning: new PostgresLearningRepository(database), fixture, modelRuntime: fixture ? undefined : getRuntimeModelRuntime(), chunks, navigation, training: true, trainingHistory: trainingHistory(session, await store.listTurns(sessionId, actor.id)), guidance: await store.activeGuidance() });
  await store.saveAnswer(sessionId, actor.id, result.answer as unknown as Readonly<Record<string, unknown>>, undefined, version);
}

async function acceptedTraining(sessionId: string) {
  if (process.env.GIT_WRITES_ENABLED !== "true") throw new Error("GIT_WRITES_DISABLED");
  const [session] = await sql`SELECT * FROM training_sessions WHERE id=${sessionId}`;
  if (!session || !["PUBLISHING", "ACTIVATING", "FAILED"].includes(session.state) || !session.accepted_content || !session.accepted_digest || !session.accepted_path) throw new Error("ACCEPTED_TRAINING_NOT_READY");
  if (contentDigest(session.accepted_content) !== session.accepted_digest) throw new Error("ACCEPTED_TRAINING_DIGEST_CHANGED");
  const [source] = await sql`SELECT * FROM source_repositories WHERE full_name=${session.target_repository}`;
  if (!source || source.status !== "ACTIVE" || (!session.published_commit && source.version !== session.accepted_source_version)) throw new Error("ACCEPTED_SOURCE_CHANGED");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pointguide-accepted-"));
  try {
    const checkout = join(temporaryRoot, "source");
    await runCommand("gh", ["repo", "clone", source.full_name, checkout], temporaryRoot);
    const remote = (await runCommand("git", ["remote", "get-url", "origin"], checkout)).trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
    if (remote !== `https://github.com/${source.full_name}`) throw new Error("ACCEPTED_SOURCE_ORIGIN_CHANGED");
    await runCommand("git", ["fetch", "origin", "--prune"], checkout);
    const latest = (await runCommand("git", ["rev-parse", `origin/${source.default_branch}`], checkout)).trim();
    const artifact = { id: session.id, targetRepository: source.full_name, baseCommit: latest, targetPath: session.accepted_path, proposedContent: session.accepted_content, digest: session.accepted_digest };
    const validationOptions = { token: process.env.GITHUB_TOKEN, allowedOwners: (process.env.POINTGUIDE_SOURCE_OWNERS ?? "PointCommunity").split(",").map(value => value.trim()).filter(Boolean) };
    const validateHead = async (head: string) => {
      const proposed = await validateSourceRepository(source.url, { ...validationOptions, ref: head });
      if (!proposed.report.complete || proposed.report.commitSha !== head || !proposed.report.acceptedArtifacts?.some(item => item.path === session.accepted_path && item.digest === session.accepted_digest)) throw new Error("ACCEPTED_PROPOSED_SOURCE_INVALID");
    };
    let publishedCommit = session.published_commit as string | null;
    if (!publishedCommit) {
      const existing = await runCommand("git", ["show", `${latest}:${session.accepted_path}`], checkout).catch(() => null);
      if (existing !== null) {
        if (contentDigest(existing) !== session.accepted_digest) throw new Error("ACCEPTED_ARTIFACT_PATH_CONFLICT");
        publishedCommit = latest;
      } else {
        const branch = `pointguide/accepted-${session.id}`;
        const open = JSON.parse(await runCommand("gh", ["pr", "list", "--repo", source.full_name, "--state", "open", "--head", branch, "--json", "url"], checkout)) as Array<{ url: string }>;
        if (open.length > 1) throw new Error("ACCEPTED_PUBLICATION_PR_CONFLICT");
        if (open.length) {
          const existingHead = JSON.parse(await runCommand("gh", ["pr", "view", open[0].url, "--repo", source.full_name, "--json", "headRefOid"], checkout)) as { headRefOid: string };
          if (!/^[a-f0-9]{40}$/u.test(existingHead.headRefOid)) throw new Error("ACCEPTED_PUBLICATION_HEAD_UNKNOWN");
          await runCommand("git", ["fetch", "origin", "--prune"], checkout);
          const proposedBase = (await runCommand("git", ["rev-parse", `${existingHead.headRefOid}^`], checkout)).trim();
          publishedCommit = await mergeAcceptedArtifact({ ...artifact, baseCommit: proposedBase }, open[0].url, checkout, validateHead, runCommand, existingHead.headRefOid);
        } else publishedCommit = (await publishAcceptedArtifact(artifact, checkout, validateHead)).publishedCommit;
      }
      await sql`UPDATE training_sessions SET state='ACTIVATING',published_commit=${publishedCommit},publication_error=NULL,updated_at=now(),version=version+1 WHERE id=${session.id} AND state IN ('PUBLISHING','FAILED')`;
    }
    await runCommand("git", ["fetch", "origin", "--prune"], checkout);
    const current = (await runCommand("git", ["rev-parse", `origin/${source.default_branch}`], checkout)).trim();
    const persisted = await runCommand("git", ["show", `${current}:${session.accepted_path}`], checkout);
    if (contentDigest(persisted) !== session.accepted_digest) throw new Error("ACCEPTED_ARTIFACT_CHANGED_AFTER_MERGE");
    const currentSource = (await new PostgresSourceRepositoryStore(getDatabase(databaseUrl!)).list()).find(item => item.id === source.id && item.status === "ACTIVE");
    if (!currentSource) throw new Error("ACCEPTED_SOURCE_ARCHIVED");
    const validated = await validateSourceRepository(currentSource.url, validationOptions);
    if (!validated.report.complete || !validated.report.acceptedArtifacts?.some(item => item.path === session.accepted_path && item.digest === session.accepted_digest)) throw new Error("ACCEPTED_ARTIFACT_NOT_INDEXED");
    const store = new PostgresSourceRepositoryStore(getDatabase(databaseUrl!));
    const indexed = await store.refresh(session.trainer_account_id, currentSource, validated);
    const readback = await store.snapshot();
    if (readback.sources.find(item => item.id === source.id)?.indexedCommit !== indexed.source.indexedCommit || !readback.sources.find(item => item.id === source.id)?.validationReport.acceptedArtifacts?.some(item => item.path === session.accepted_path && item.digest === session.accepted_digest)) throw new Error("ACCEPTED_ACTIVATION_READBACK_FAILED");
    await new PostgresTrainingSessionStore(getDatabase(databaseUrl!)).activateKnowledge(session.id, session.accepted_digest, indexed.source.indexedCommit);
  } finally { await rm(temporaryRoot, { recursive: true }); }
}

async function tick(): Promise<boolean> {
  const [job] = await sql.begin(async (transaction) => transaction`
    -- ponytail: 10-minute lease covers bounded GitHub validation and merge; add heartbeat renewals if source repositories outgrow this window.
    UPDATE jobs SET status='LEASED', lease_owner=${owner}, lease_expires_at=now()+CASE WHEN kind='GENERATE_TRAINING_ANSWER' THEN interval '2 minutes' ELSE interval '10 minutes' END,
      attempts=attempts+1, updated_at=now()
    WHERE id=(SELECT id FROM jobs WHERE (status='READY' OR (status='LEASED' AND lease_expires_at<now())) AND available_at<=now()
      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,kind,payload`);
  if (!job) return false;
  const heartbeat = job.kind === "GENERATE_TRAINING_ANSWER" ? setInterval(() => {
    void sql`UPDATE jobs SET lease_expires_at=now()+interval '2 minutes' WHERE id=${job.id} AND lease_owner=${owner} AND status='LEASED'`.catch(() => console.warn("training-job-heartbeat-failed"));
  }, 30_000) : null;
  try {
    if (job.kind === "GENERATE_TRAINING_ANSWER") {
      const sessionId = typeof job.payload?.sessionId === "string" ? job.payload.sessionId : "";
      const version = job.payload?.version;
      if (!sessionId || typeof version !== "number") throw new Error("INVALID_GENERATION_JOB");
      await generateTrainingAnswer(sessionId, version);
      await sql`UPDATE jobs SET status='SUCCEEDED',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${job.id} AND lease_owner=${owner}`;
      return true;
    }
    if (job.kind === "PUBLISH_ACCEPTED_TRAINING") {
      const sessionId = typeof job.payload?.sessionId === "string" ? job.payload.sessionId : "";
      await acceptedTraining(sessionId);
      await sql`UPDATE jobs SET status='SUCCEEDED',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${job.id}`;
      return true;
    }
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
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKER_FAILED";
    if (job.kind === "GENERATE_TRAINING_ANSWER") {
      const diagnostic = answerFailureDiagnostic(error);
      console.warn("training-answer-failed", { phase: "worker", ...diagnostic });
      const sessionId = typeof job.payload?.sessionId === "string" ? job.payload.sessionId : "";
      const version = job.payload?.version;
      if (sessionId && typeof version === "number") {
        const [session] = await sql`SELECT current_answer IS NOT NULL AS revision FROM training_sessions WHERE id=${sessionId}`;
        await new PostgresTrainingSessionStore(getDatabase(databaseUrl!)).failAnswer(sessionId, version, answerFailureMessage(diagnostic.reason, Boolean(session?.revision)));
      }
      await sql`UPDATE jobs SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=${diagnostic.reason},last_error_message='Training answer generation failed.',updated_at=now() WHERE id=${job.id} AND lease_owner=${owner}`;
      return true;
    }
    if (job.kind === "PUBLISH_ACCEPTED_TRAINING") {
      const sessionId = typeof job.payload?.sessionId === "string" ? job.payload.sessionId : "";
      await sql.begin(async transaction => {
        await transaction`UPDATE jobs SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='ACCEPTED_TRAINING_FAILED',last_error_message='Accepted training publication or activation failed.',updated_at=now() WHERE id=${job.id}`;
        if (sessionId) await transaction`UPDATE training_sessions SET state='FAILED',publication_error=${message.startsWith("ACCEPTED_") ? message : "Publication or activation failed. Retry after checking worker and repository access."},updated_at=now(),version=version+1 WHERE id=${sessionId} AND state IN ('PUBLISHING','ACTIVATING')`;
      });
      return true;
    }
    await sql.begin(async (transaction) => {
      await transaction`UPDATE jobs SET status='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code='WORKER_FAILED',
        last_error_message=${message.slice(0, 500)},updated_at=now() WHERE id=${job.id}`;
      const proposalId = typeof job.payload?.proposalId === "string" ? job.payload.proposalId : "";
      if (proposalId) await transaction`UPDATE change_proposals SET state='FAILED',updated_at=now(),version=version+1
        WHERE id=${proposalId} AND state='QUEUED'`;
    });
    return true;
  } finally { if (heartbeat) clearInterval(heartbeat); }
}

try {
  if (process.env.WORKER_ONCE === "true") await tick();
  else while (true) if (!await tick()) await new Promise((resolve) => setTimeout(resolve, 1_000));
} finally {
  await sql.end();
}
