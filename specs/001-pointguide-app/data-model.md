# Data Model: PointGuide Initial Web Application

All IDs are UUIDs unless a stable content-derived identifier is stated. Timestamps are UTC. Mutable security/governance records carry optimistic version numbers. Raw secrets and model reasoning are not data-model fields.

## Identity and Authorization

### Account

- `id`, `accessIssuer`, `accessSubject` (unique pair), normalized `email`, `displayName`
- `role`: `USER | TRAINER | ADMIN | OWNER`
- `status`: `PENDING | APPROVED | SUSPENDED`
- `firstLoginAt`, `lastLoginAt`, `createdAt`, `updatedAt`, `version`

Rules: exactly one bootstrap transaction may create the first `APPROVED OWNER`; later inserts are `PENDING USER`. Protected routes require `APPROVED`. Only Owner can assign Owner. A transaction must reject demotion/suspension of the final active Owner. Actors cannot approve or alter their own role/status through account-management endpoints.

## Providers and Agent Configuration

### ProviderConnection

- `id`, `provider`: `CODEX | OLLAMA_CLOUD`
- `status`: `DISCONNECTED | CONNECTING | CONNECTED | ERROR`
- `encryptedSecret` or `externalSecretRef` (server-only, mutually exclusive)
- `credentialLocation` (Codex server-side reference only), masked `accountLabel`
- `catalogRefreshedAt`, bounded `lastErrorCode`, `createdBy`, `updatedBy`, timestamps/version

### ProviderModel

- `connectionId`, provider-stable `modelId`, `displayName`, `description`
- `isDefault`, `hidden`, input modalities
- ordered `reasoningEfforts[]`: `{ effort, description, isDefault }`
- `catalogDigest`, `observedAt`, `available`

### AgentProfile and PromptRevision

- Profile: `id`, `name`, `role`: `PRIMARY | REVIEWER`, `connectionId`, `modelId`, optional supported `reasoningEffort`, `enabled`, `activePromptRevisionId`, timestamps/version
- Revision: `id`, `profileId`, bounded `ownerPrompt`, immutable `corePolicyRevision`, `createdBy`, `createdAt`, optional supersession link

Rules: only Owner mutates. Profile activation requires a currently available model and advertised effort. One active primary is required before real questions; reviewer required only when global review is enabled. Core policy is application-owned and cannot be edited through the UI.

### ApplicationSetting

- `key`, typed `value`, `updatedBy`, `updatedAt`, `version`
- Initial key: `review.enabled` (default false)

## Evidence and Knowledge

### CorpusRevision

- `id`, unique `commitSha`, `startedAt`, `completedAt`, `status`, validator version, counts, bounded error summary

### SourceDocument

- stable `sourceId`, `revisionId`, repository `path`, `title`, publisher, authority class
- equipment/domain applicability, version/date, capture date, verification state, limitations
- `contentDigest`, source-file digest, media type, local original path, normalized text path

### SourceChunk

- stable `chunkId` derived from source ID/path/locator/content digest
- `sourceId`, `revisionId`, structural `locator`, ordinal, `text`, digest, search vector

### EvidenceItem

- `id`, `kind`: `REPOSITORY | PRIMARY_WEB | SECONDARY_WEB`
- repository revision/source/chunk references or web-finding reference
- immutable title, locator/URL, publisher, authority, applicability, version/captured date, excerpt, digest

Rules: evidence text is untrusted data and never executed. Repository evidence must belong to one completed corpus revision. Web evidence is supplemental until its change proposal merges and a new corpus revision indexes it.

## Conversations, Answers, and Review

### Conversation and Message

- Conversation: `id`, `ownerAccountId`, `title`, status, `userTurnCount`, created/updated timestamps
- Message: `id`, `conversationId`, `actor`: `USER | ASSISTANT | SYSTEM_EVENT`, bounded content, status, created timestamp

Derived read models:

- SessionSummary: owner-scoped conversation identity/title, created/updated timestamps, turn count, latest bounded question/answer preview, and remaining turns.
- SessionTurn: paired user question and its structured Answer, claims, evidence references, and creation timestamp. Reads are newest-first for display; model context remains chronological.

Rules: session list/detail/search always constrains by `ownerAccountId`. Keyword search is case-insensitive and bounded to title and message content. The first completed question replaces the generic initial title with a bounded human-readable question title.

### Answer

- `id`, response message, corpus revision, primary profile/prompt revision
- optional reviewer profile/prompt revision
- `reviewMode`: `NONE | DEEP_RESEARCH`; `reviewStatus`: `NOT_REQUESTED | PENDING | PASSED | REJECTED | FAILED`
- structured direct answer, safety/assumptions, ordered steps, confidence label, timestamps

### AnswerClaim and ClaimEvidence

- Claim: `id`, `answerId`, ordinal, atomic `text`, `kind`: `FACTUAL | ACTIONABLE | SAFETY | UNKNOWN`, `status`: `SUPPORTED | UNKNOWN | REJECTED`, reviewer rationale code
- Join: `claimId`, `evidenceItemId`

Rules: factual/actionable/safety claims shown as supported require at least one existing evidence join. Reviewer replacement text is subject to the same rule. A deterministic renderer filters rejected claims and refuses dangling evidence IDs.

### AnswerReview

- `id`, `answerId`, reviewer profile/prompt revision, status
- per-claim finding: entailment, authority, applicability, contradiction, completeness, safety; bounded correction referencing evidence IDs
- timestamps, bounded provider error code; no raw chain of thought

## Feedback, Training, and Git

### Feedback

- `id`, unique `(answerId, actorId)`, `rating`: `HELPFUL | NOT_HELPFUL`
- `reasons[]`: `INCORRECT | UNCLEAR | INCOMPLETE | UNSAFE | WRONG_CONTEXT | POOR_SOURCE | OTHER`
- optional bounded comment, question fingerprint, answer/profile/revision references, timestamps

### TrainingExample

- `id`, question pattern, context tags, preferred behavior, anti-pattern, provenance references
- `status`: `DRAFT | IN_REVIEW | APPROVED | SUPERSEDED | REJECTED`
- author/reviewer, repository proposal link, timestamps/version

### SourceRepository and SourceChunk

- SourceRepository: repository identity, canonical GitHub URL, default branch, indexed commit, lifecycle state, validation state/report, actor/timestamps/version
- SourceChunk: repository ID, stable chunk ID, source path/locator, title, authority, captured time, digest, bounded searchable text

Rules: only `PointCommunity/*` GitHub repositories are accepted initially. Validation requires `AGENTS.md`, supported evidence content, and either `pointguide-source.yaml` or a checksum manifest. Invalid or archived repositories contribute no chunks. Archive and delete require exact confirmation; deletion requires archived state.

### TrainingSession and TrainingTurn

- TrainingSession: trainer, target repository, backing conversation, original question, workflow state, current answer/report, accepted report, timestamps/version
- TrainingTurn: session, ordinal, actor, content, optional rating/explanation, optional answer ID, created timestamp

Rules: only Trainer/Admin/Owner access is allowed. Agent answers must be rated with an explanation before a learning report exists. Reports can be refined through additional insight. Only an accepted report can be wiped or committed. Commit creates a governed repository artifact/proposal; wipe deletes the uncommitted session.

### Conversation turn budget

- `userTurnCount`: atomically reserved count from 0 through 6

Rules: one initial question and five follow-ups are allowed. Failed generation releases its reservation. Model context contains at most the preceding five user/assistant pairs.

### WebFinding

- `id`, URL, resolved URL, title, publisher, retrieved time, media type, bounded excerpt
- content digest, authority, license/provenance, flagger, review state, reviewer/notes

### ChangeProposal

- `id`, proposer, reviewer, rationale, target repository, base commit, allow-listed target path
- `operation`: `CREATE | UPDATE | SUPERSEDE`; exact proposed content/diff digest
- `state`: `DRAFT | IN_REVIEW | APPROVED | APPLYING | VALIDATED | PR_OPEN | MERGED | REJECTED | CONFLICT | FAILED`
- branch, commit SHA, pull-request URL/number, validation result, timestamps/version

Transitions are forward-only except `CONFLICT` or `FAILED` may return to `DRAFT` through a new version. Only an approved exact proposal may reach `APPLYING`. Merge state is observed from GitHub, not performed by the application.

## Operations

### Job

- `id`, type, payload reference, `state`: `READY | LEASED | SUCCEEDED | FAILED | DEAD`
- attempts, `availableAt`, `leaseOwner`, `leaseExpiresAt`, bounded last-error code/message, timestamps

### AuditEvent

- `id`, actor (nullable for system), action, target type/ID, outcome, correlation ID
- bounded redacted metadata, occurred timestamp

Audit inserts are append-only. Provider secrets, JWTs, full prompts containing secrets, raw reasoning, private network credentials, and unnecessary personal data are prohibited.
