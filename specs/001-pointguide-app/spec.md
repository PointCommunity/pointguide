# Feature Specification: PointGuide Initial Web Application

**Feature Branch**: `codex/pointguide-app`
**Created**: 2026-09-06
**Status**: Approved
**Human-readable contract**: [PointGuide product and technical specification](../pointguide-app.html)

## User Scenarios and Testing

### User Story 1 - Receive Evidence-Grounded Help (Priority: P1)

An approved User asks a church-technology question on a phone and receives a concise, safe answer whose factual and actionable claims link to real repository or captured web evidence.

**Why this priority**: This is the product's primary value and a useful MVP on its own.

**Independent Test**: Load a known M32 question against a fixed corpus and provider fixture; verify the direct answer, steps, uncertainty, evidence details, claim ledger, and feedback controls.

**Acceptance Scenarios**:

1. **Given** relevant repository evidence, **When** a User asks a question, **Then** every substantive displayed claim cites at least one evidence item from the indexed commit.
2. **Given** no evidence for a requested fact, **When** an answer is composed, **Then** the app states that the fact is unknown and requests the missing observation rather than guessing.
3. **Given** a potentially disruptive procedure, **When** steps are shown, **Then** applicability, service impact, prerequisites, backup/rollback, and safety warnings precede the steps.
4. **Given** the app at 320 CSS pixels, **When** the User navigates and submits a question, **Then** no page-level horizontal scrolling is needed and touch targets remain at least 44 by 44 CSS pixels.

### User Story 2 - Authenticate and Govern Access (Priority: P1)

The first valid Cloudflare Access identity becomes Owner; all later valid Google identities remain Pending until an Admin or Owner approves and assigns access.

**Why this priority**: No protected feature can ship safely without deterministic bootstrap and server-side authorization.

**Independent Test**: Race two first-login requests, verify exactly one approved Owner, then verify a later identity is Pending and cannot access application data until approved.

**Acceptance Scenarios**:

1. **Given** an empty account table, **When** two valid identities arrive concurrently, **Then** exactly one becomes an approved Owner and the other becomes Pending.
2. **Given** a Pending or Suspended identity, **When** it requests protected data, **Then** the app returns the matching lifecycle screen and no protected record.
3. **Given** an Admin, **When** accounts are managed, **Then** User, Trainer, or Admin can be assigned but Owner cannot.
4. **Given** an Owner, **When** Owner access is changed, **Then** the final active Owner cannot be demoted or suspended.

### User Story 3 - Configure Primary and Reviewing Agents (Priority: P1)

An Owner connects Codex with headless device-code OAuth or Ollama Cloud with an API key, refreshes provider-advertised model choices, configures model/effort/prompt profiles, and optionally enables a second reviewing agent.

**Why this priority**: It establishes the only supported path to real model execution while protecting credentials and keeping policy provider-neutral.

**Independent Test**: Use provider fixtures to complete connection states, populate models/efforts, configure cross-provider primary/reviewer profiles, and prove non-Owners are denied.

**Acceptance Scenarios**:

1. **Given** an Owner and disconnected Codex provider, **When** device login starts, **Then** the UI displays a verification URL and user code without exposing credential cache contents.
2. **Given** a valid Ollama key, **When** the Owner connects it, **Then** the server stores only protected secret material and populates cloud models from the provider catalog.
3. **Given** a model catalog, **When** an Owner selects a model, **Then** only advertised reasoning efforts are selectable.
4. **Given** global review disabled, **When** any User opens Ask, **Then** no Deep research control is rendered.
5. **Given** review enabled and a reviewer configured, **When** a User selects Deep research, **Then** the reviewer checks the primary claim ledger and only supported final wording is displayed.
6. **Given** reviewer failure, **When** Deep research is requested, **Then** the app fails closed with a recoverable review error and never labels an unreviewed answer as reviewed.

### User Story 4 - Rate Answers and Train Deliberately (Priority: P2)

Users rate answers; Trainers curate examples and flagged findings without turning opinions into facts or permitting autonomous self-modification.

**Independent Test**: Submit feedback tied to an exact answer/commit/profile, review it as Trainer, and verify no source or instruction changes without an approved proposal.

**Acceptance Scenarios**:

1. **Given** an answer, **When** a User rates it, **Then** rating, reason, optional comment, answer version, evidence, commit, and model profiles are retained together.
2. **Given** one negative rating, **When** future retrieval runs, **Then** no source fact is edited or globally suppressed.
3. **Given** a reviewed training change, **When** it is accepted, **Then** it becomes a versioned repository proposal with audit history.

### User Story 5 - Retain Supplemental Findings Through Git (Priority: P2)

A User flags a web finding; a Trainer/Admin/Owner reviews its provenance and proposes a bounded repository change that the service turns into a branch and pull request.

**Independent Test**: Flag a fixed web result, approve an allow-listed proposal, run against a disposable Git repository, and verify the exact branch, commit, checks, and PR request data.

**Acceptance Scenarios**:

1. **Given** a web citation, **When** a User flags it, **Then** URL, publisher, capture time, digest, excerpt, authority, and review state are stored.
2. **Given** an unapproved proposal, **When** indexing runs, **Then** it is never treated as repository truth.
3. **Given** an approved proposal, **When** the worker applies it, **Then** only approved allow-listed paths and content change; force push, merge, arbitrary shell, and cross-repository access remain impossible.

### User Story 6 - Operate and Release Safely (Priority: P3)

Maintainers can index a pinned commit, migrate the database, inspect health, build the exact source for AMD64, publish it to Zot, and deploy a canary through homelab GitOps.

**Independent Test**: Build a clean archive locally, run container smoke checks, inspect AMD64 architecture, and render canary GitOps values with a fixed digest without touching production.

**Acceptance Scenarios**:

1. **Given** a committed source tree, **When** the release build runs, **Then** the resulting image identifies as `linux/amd64` and embeds the source revision.
2. **Given** a published tag, **When** release identity is resolved, **Then** deployment references the registry digest and never rebuilds for promotion.
3. **Given** no production approval, **When** canary passes, **Then** production and Cloudflare remain unchanged.

## Edge Cases

- Cloudflare Access assertion is missing, expired, wrong audience, wrong issuer, or forwarded email is spoofed.
- Two first identities race; an Owner attempts to change their own role; the final Owner is targeted for suspension.
- A provider catalog changes, removes a model, omits effort metadata, rate-limits, times out, or returns malformed structured output.
- Primary or reviewer returns a claim with no evidence ID, cites a missing evidence ID, contradicts a higher-authority source, or invents replacement text during review.
- Web retrieval redirects to a private/link-local address, returns oversized/unsupported data, or lacks trustworthy provenance/licensing.
- Corpus contains prompt injection, executable content, path traversal, broken checksums, malformed text, or evidence applicable to a different model/version.
- Feedback is duplicated, abusive, sparse, or contradictory; Git proposal conflicts with a newer default branch.
- Worker dies while holding a lease; migration or indexing partially completes; GitHub or model provider is unavailable.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST verify Cloudflare Access JWT signature, issuer, audience, subject, expiry, and email for every protected request.
- **FR-002**: The system MUST create exactly one approved Owner during empty-database bootstrap and create every later valid identity as Pending.
- **FR-003**: The system MUST enforce Pending, Approved, and Suspended lifecycle states at every server-side route and data boundary.
- **FR-004**: Admins and Owners MUST be able to approve/suspend accounts and assign User, Trainer, or Admin; only Owners may grant/revoke Owner.
- **FR-005**: The system MUST retain at least one active Owner and reject self-approval and unsafe self role/status changes.
- **FR-006**: The system MUST index only allow-listed content from configured source repositories, initially `PointCommunity/pointaudio`, with repository identity, commit SHA, stable source/chunk ID, path/locator, authority, applicability, version/date, capture date, verification state, digest, and text.
- **FR-007**: The system MUST verify corpus checksums and reject path escapes, executable evidence, malformed text, and unapproved source types.
- **FR-008**: Repository retrieval MUST run before supplemental web search and preserve the distinction between repository, primary-web, and secondary-web evidence.
- **FR-009**: Every substantive factual or actionable displayed claim MUST reference one or more captured evidence IDs; claims without adequate support MUST be omitted or marked Unknown.
- **FR-010**: Potentially disruptive guidance MUST state applicability, current-state prerequisites, service impact, backup/rollback, and safety warning before action steps.
- **FR-011**: Users MUST be able to create/list/open conversations and submit questions through a streaming response interface.
- **FR-012**: Users MUST be able to inspect evidence metadata/excerpts and submit Helpful or Not helpful feedback with structured reasons and an optional bounded comment.
- **FR-013**: Feedback MUST remain linked to the immutable question, answer, claims, citations, commit, prompts, and model profiles and MUST NOT directly edit source facts.
- **FR-014**: Users MUST be able to flag web findings for retention; only reviewed/merged repository content may later be treated as authoritative.
- **FR-015**: Trainers, Admins, and Owners MUST be able to curate training examples and proposed documentation changes with provenance and audit history.
- **FR-016**: The Git worker MUST apply only an approved exact diff to allow-listed paths, validate it, create a scoped branch/commit, and request a pull request without merge or force-push authority.
- **FR-017**: Only Owners MUST be able to create, change, test, or remove provider connections, model profiles, reasoning effort, model prompts, and global review settings.
- **FR-018**: Codex connection MUST use the supported headless device-code OAuth flow and dynamically retrieve advertised models and supported reasoning efforts.
- **FR-019**: Ollama Cloud connection MUST accept an API key through a write-only server boundary and dynamically retrieve the account's advertised cloud models.
- **FR-020**: Raw provider credentials and Codex credential-cache contents MUST never be returned after submission or enter Git, prompts, audit metadata, or application logs.
- **FR-021**: Agent profiles MUST version provider, model, supported effort, primary/reviewer role, Owner prompt overlay, and immutable core evidence-policy revision.
- **FR-022**: Global review disabled MUST remove the Deep research control for all users; enabled MUST expose an off-by-default per-query control when a valid reviewer exists.
- **FR-023**: Deep research MUST support same-model and cross-provider review, independently check each primary claim, and publish only deterministic supported final wording.
- **FR-024**: Reviewer failure or invalid output MUST fail closed and MUST NOT silently present the primary answer as reviewed.
- **FR-025**: Model runtimes MUST receive bounded evidence and typed contracts and MUST NOT receive shell, arbitrary filesystem, Git/database credentials, or unrestricted network access.
- **FR-026**: Account, provider, prompt, answer, feedback, training, proposal, Git, and review-policy changes MUST create bounded audit events without raw secrets or model reasoning.
- **FR-027**: The UI MUST default to dark mode, support keyboard use, visible focus, reduced motion, safe areas, 200% zoom, and 320 CSS-pixel layouts without page-level horizontal scrolling; interactive targets MUST be at least 44 by 44 CSS pixels.
- **FR-028**: The system MUST expose liveness, readiness, and protected operational metrics that reflect database, migrations, indexing, worker, and provider configuration without disclosing secrets.
- **FR-029**: Release tooling MUST build an exact clean committed archive locally for `linux/amd64`, smoke-test it, push to Zot, resolve its digest, and feed only that digest to canary GitOps.
- **FR-030**: Production promotion MUST require explicit approval of exact source, image digest, and GitOps candidate and MUST reuse the canary-tested digest without rebuilding.

### Key Entities

- **Account**: Cloudflare identity, application role, lifecycle state, and login history.
- **Provider Connection**: Owner-managed Codex or Ollama authentication status and protected secret reference.
- **Agent Profile**: Versioned primary/reviewer provider, model, effort, prompt overlay, and core-policy revision.
- **Conversation / Message**: User-owned support history and immutable message states.
- **Source Document / Chunk**: Commit-bound, provenance-rich searchable evidence.
- **Evidence Item / Answer Claim**: Captured source excerpt and a displayed statement with explicit support relationships.
- **Answer / Review**: Versioned primary draft, reviewer findings, deterministic final answer, and status.
- **Feedback / Training Example**: Helpfulness signal and governed behavior guidance.
- **Web Finding / Change Proposal**: Supplemental evidence intake and an approved bounded Git change.
- **Audit Event / Job**: Security history and durable background work state.

## Success Criteria

- **SC-001**: In a fixed 50-question grounding evaluation, 100% of displayed substantive claims have valid evidence links and 0 unsupported claims are presented as fact.
- **SC-002**: Concurrent bootstrap testing always produces exactly one approved Owner; all later identities are Pending until approved.
- **SC-003**: The complete authorization matrix rejects 100% of disallowed Owner/Admin/Trainer/User/Pending/Suspended operations.
- **SC-004**: A first-time approved phone User can ask a question, inspect evidence, and submit feedback without instruction in no more than three primary interactions after opening Ask.
- **SC-005**: The critical Ask, account approval, provider setup, Deep research, feedback, training, and proposal flows have automated success and failure-path coverage; core logic maintains at least 80% line coverage.
- **SC-006**: Automated and manual checks at 320, 390, 768, 1024, and 1440 CSS-pixel widths find no page-level horizontal overflow, inaccessible control, or touch target below 44 by 44 CSS pixels.
- **SC-007**: Secret scans and purpose-built tests find no raw credential in repository files, browser responses, prompts, audit events, or logs.
- **SC-008**: Corpus validation confirms every recorded checksum, source path, extracted text, PDF, and archive before indexing; failures block the affected source from authoritative retrieval.
- **SC-009**: A release candidate is reproducibly tied to one source commit and one pullable AMD64 Zot digest; canary runtime and GitOps state report that exact digest with zero unexpected restarts before production consideration.

## Clarifications

- 2026-09-06: First login is Owner; all subsequent accounts default Pending.
- 2026-09-06: Only Owners control provider credentials, models, efforts, prompts, review policy, and Owner membership.
- 2026-09-06: Codex device OAuth and Ollama Cloud API-key providers are both initial scope; catalogs are provider-discovered.
- 2026-09-06: Deep research is globally controlled and user-selected per query; same-model and cross-provider review are allowed.
- 2026-09-06: Every agent statement must be evidence-grounded; no evidence means Unknown.
- 2026-09-06: `PointGuide` is the approved application name; `PointCommunity/pointaudio` is its initial governed knowledge source rather than the application repository or identity.

## 2026-09-07 usability and learning amendment

### Role and navigation contract

- Every approved role can use Ask. A User has no application navigation because Ask is their only application destination; Account remains reachable from the identity control.
- Trainers, Admins, and Owners can use Knowledge and Training. Admins and Owners can use Accounts. Only Owners can see or open Agent Setup.
- Restricted pages enforce the same role policy on the server as their APIs; hiding a navigation item is not an authorization control.
- Navigation remains a fixed bottom bar at phone, tablet, and desktop widths and must not overlap page content or safe areas.

### Compact Ask experience

- The Ask page uses general Point Community Church technology language rather than promising only PointAudio or M32 coverage.
- Suggested tasks rotate between sessions and are collapsed by default in a single accessible accordion.
- One support session contains one initial question and at most five follow-up questions. The server rejects a seventh user turn, and the remaining allowance is shown immediately below the submit action.
- Each model request receives the bounded prior session transcript so follow-up questions retain context.

### Account and administration

- Users can edit their own display name without changing their Cloudflare identity or email.
- Account management uses one scalable account selector and one editor. Admins cannot list Owners, target themselves, grant Owner, or modify an Owner. Owners can manage every other account, including Owner membership, while neither role can change its own access.

### Knowledge repositories

- Knowledge managers can register a repository only after a server-side structural validation of an allow-listed GitHub repository URL, branch, governing instructions, evidence content, and integrity/index metadata.
- A validation report records the checked commit, errors, warnings, supported files, skipped files, and indexed chunk count. Invalid repositories are not linked or searched.
- Linked repository text is indexed into bounded database chunks and joins the configured local corpus during retrieval.
- Archive removes a repository from active retrieval; deletion is allowed only after archival. Both actions require an explicit, server-validated confirmation value.

### Organic Training workflow

- A Trainer, Admin, or Owner starts with a real question and receives a grounded answer from the configured primary agent while the full bounded training-session context is retained.
- Every agent answer is rated helpful or not helpful with an explanation. The agent returns a concise learning report that separates behavior guidance from factual evidence and invites further trainer insight.
- The trainer may provide more insight, receive a revised answer, and repeat rating/report cycles until accepting the report.
- After acceptance, the trainer must explicitly choose either to wipe the session or commit the accepted learning. Wipe permanently removes the draft session after typed confirmation. Commit creates a versioned training artifact through the governed repository proposal/PR workflow; it is not source truth until merged and reindexed.

### Agent Setup language and default system prompt

- The product calls the Owner-only page “Agent Setup” and calls profile direction “System Prompt.”
- The active system prompt is returned to the Owner and remains editable. A new profile starts with a default prompt requiring concise evidence-grounded answers, explicit unknowns, safety boundaries, and clear one-action-per-step guidance written for non-technical beginners.

### Amendment success criteria

- Role-matrix unit, API, and direct-route tests reject every disallowed page and operation.
- Conversation tests prove bounded history reaches the model and that one initial plus five follow-ups succeeds while the next turn fails.
- Repository tests prove URL allow-listing, validation reports, indexing, archive/delete confirmations, and exclusion of archived chunks.
- Training tests prove the question → answer → rated explanation → learning report → further insight → accepted report → wipe/commit state machine.
- Playwright verifies compact layouts, fixed bottom navigation, User navigation removal, rotating collapsed suggestions, editable name, scalable account selection, confirmations, keyboard access, and no overflow at 320, 390, 768, 1024, and 1440 CSS pixels.
