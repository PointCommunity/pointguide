# Tasks: PointGuide Initial Web Application

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [OpenAPI contract](contracts/openapi.yaml)
**Execution**: Sequential vertical slices; tests marked before their implementation and observed failing first.

## Phase 1: Setup

- [x] T001 Create pinned Node/Next project manifests and ignore files in `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.gitignore`, and `.dockerignore`
- [x] T002 [P] Create semantic dark design tokens and responsive application shell in `src/app/globals.css`, `src/app/layout.tsx`, and `src/components/app-shell.tsx`
- [x] T003 [P] Configure Vitest and Playwright in `vitest.config.ts`, `vitest.setup.ts`, and `playwright.config.ts`
- [x] T004 Add validated environment boundary and example values in `src/lib/config/env.ts` and `.env.example`

## Phase 2: Foundational Evidence Slice

- [x] T005 [US1] Write failing corpus-manifest and path/digest tests in `tests/unit/corpus.test.ts`
- [x] T006 [US1] Implement corpus manifest validation in `src/lib/evidence/corpus.ts`
- [x] T007 [US1] Write failing deterministic retrieval and claim-ledger tests in `tests/unit/retrieval.test.ts` and `tests/unit/claims.test.ts`
- [x] T008 [US1] Implement deterministic corpus search, evidence normalization, and supported-claim validation in `src/lib/evidence/search.ts`, `src/lib/agent/schema.ts`, and `src/lib/agent/claims.ts`
- [x] T009 [US1] Write failing health and fixture-answer route tests in `tests/integration/health.test.ts` and `tests/integration/ask.test.ts`
- [x] T010 [US1] Implement health/readiness and a fixture-grounded Ask API in `src/app/api/healthz/route.ts`, `src/app/api/readyz/route.ts`, and `src/app/api/demo/ask/route.ts`
- [x] T011 [US1] Implement the accessible Ask/evidence/feedback demo UI in `src/app/page.tsx` and `src/components/ask-workspace.tsx`
- [x] T012 [US1] Add browser tests for mobile Ask, evidence expansion, Deep research visibility, feedback, keyboard use, touch targets, and overflow in `tests/e2e/ask.spec.ts`

## Phase 3: Identity and Account Governance

- [x] T013 [US2] Write failing JWT, bootstrap-race, lifecycle, role-matrix, self-change, and final-Owner tests in `tests/unit/auth.test.ts` and `tests/integration/accounts.test.ts`
- [x] T014 [US2] Add initial SQL migration and Drizzle schema for accounts/audit in `migrations/0001_identity.sql` and `src/db/schema.ts`
- [x] T015 [US2] Implement Cloudflare assertion verification and transactional provisioning in `src/lib/auth/access.ts`, `src/lib/auth/provision.ts`, and `src/lib/auth/session.ts`
- [x] T016 [US2] Implement role/lifecycle policy and account APIs in `src/lib/auth/policy.ts`, `src/app/api/session/route.ts`, and `src/app/api/admin/users/[id]/route.ts`
- [x] T017 [US2] Implement Pending/Suspended pages and Admin account management in `src/app/pending/page.tsx`, `src/app/suspended/page.tsx`, and `src/app/admin/accounts/page.tsx`
- [x] T018 [US2] Add account-governance browser tests in `tests/e2e/accounts.spec.ts`

## Phase 4: Owner Provider and Profile Control

- [x] T019 [US3] Write failing provider secret-redaction, catalog-normalization, supported-effort, and Owner-policy tests in `tests/unit/providers.test.ts`
- [x] T020 [US3] Add provider/profile/prompt/settings schema and migration in `migrations/0002_providers.sql` and `src/db/schema.ts`
- [x] T021 [US3] Implement provider-neutral interfaces and encrypted secret boundary in `src/lib/providers/types.ts`, `src/lib/providers/secrets.ts`, and `src/lib/providers/catalog.ts`
- [x] T022 [US3] Implement pinned Codex App Server device-login and model-list adapter in `src/lib/providers/codex.ts`
- [x] T023 [US3] Implement Ollama Cloud key verification and `/api/tags` adapter in `src/lib/providers/ollama.ts`
- [x] T024 [US3] Implement Owner-only provider/profile/review APIs under `src/app/api/owner/`
- [x] T025 [US3] Implement Owner AI settings UI with masked status, dynamic models/efforts, profiles, prompts, and review toggle in `src/app/owner/ai/page.tsx`
- [x] T026 [US3] Add deterministic Codex/Ollama contract fixtures and Owner UI browser tests in `tests/fixtures/providers/`, `tests/contract/providers.test.ts`, and `tests/e2e/owner-ai.spec.ts`

## Phase 5: Reviewing Agent and Grounded Answer Pipeline

- [x] T027 [US1] [US3] Write failing orchestration tests for normal, same-model, cross-provider, dangling evidence, contradiction, timeout, and fail-closed paths in `tests/unit/orchestrator.test.ts`
- [x] T028 [US1] [US3] Implement primary structured output, reviewer findings, and deterministic renderer in `src/lib/agent/orchestrator.ts`, `src/lib/agent/reviewer.ts`, and `src/lib/agent/render.ts`
- [x] T029 [US1] Implement bounded supplemental web evidence adapter and SSRF/media/size protections in `src/lib/evidence/web.ts`
- [x] T030 [US1] Replace fixture Ask with persisted streaming conversation route and per-query Deep research in `src/app/api/conversations/[id]/messages/route.ts`
- [x] T031 [US1] Update Ask UI for streaming, global feature discovery, review states, failures, and claim-linked citations in `src/components/ask-workspace.tsx`
- [x] T032 [US1] [US3] Add integrated normal/Deep research success and failure browser tests in `tests/e2e/deep-research.spec.ts`

## Phase 6: Feedback, Training, and Governed Git

- [x] T033 [US4] [US5] Write failing feedback, training state, web finding, proposal transition, path allow-list, and exact-diff tests in `tests/unit/learning.test.ts` and `tests/unit/git-proposals.test.ts`
- [x] T034 [US4] [US5] Add conversation/evidence/answer/feedback/training/proposal/job schema in `migrations/0003_learning.sql` and `src/db/schema.ts`
- [x] T035 [US4] Implement immutable feedback and training services/APIs in `src/lib/feedback/`, `src/app/api/answers/[id]/feedback/route.ts`, and `src/app/api/training/`
- [x] T036 [US5] Implement web-finding intake and typed proposal state machine in `src/lib/git/proposals.ts`, `src/app/api/citations/[id]/flags/route.ts`, and `src/app/api/change-proposals/route.ts`
- [x] T037 [US5] Implement bounded GitHub branch/commit/PR worker adapter with disposable-repo integration tests in `src/lib/git/worker.ts` and `tests/integration/git-worker.test.ts`
- [x] T038 [US4] [US5] Implement Trainer review and proposal UI in `src/app/training/page.tsx`
- [x] T039 [US4] [US5] Add feedback/training/proposal browser tests in `tests/e2e/training.spec.ts`

## Phase 7: Operations and Delivery

- [x] T040 [US6] Implement migration, leased worker, and commit-pinned index commands in `scripts/migrate.ts`, `scripts/worker.ts`, and `scripts/index-repo.ts`
- [x] T041 [US6] Create a multi-stage non-root AMD64-capable image and local compose stack in `Dockerfile` and `compose.yaml`
- [x] T042 [US6] Add corpus, secret, dependency, contract, and release-identity checks in `scripts/security-check.mjs`, `scripts/verify-corpus.mjs`, and `scripts/verify-release.mjs`
- [x] T043 [US6] Add source quality and exact-head container workflows in `.github/workflows/quality.yml` and `.github/workflows/container.yml`
- [x] T044 [US6] Prepare dark HTML operating/runbook documentation in `docs/development.html`, `docs/identity-and-providers.html`, and `docs/release.html`
- [x] T045 [US6] After explicit publication authorization, build an exact clean archive locally for `linux/amd64`, smoke it, publish to Zot, and record the immutable digest
- [x] T046 [US6] After explicit GitOps authorization, create/update `apps/pointguide-canary` from current Gitea `origin/master`, push, reconcile, and verify exact digest plus whole-cluster health
- [x] T047 [US6] After explicit production authorization, promote the same reviewed digest and verify production/edge behavior

## Phase 8: Final Validation and Handoff

- [x] T048 Run unit/integration/contract tests with core coverage at or above 80%, typecheck, lint, build, security checks, and `git diff --check`
- [x] T049 Run Playwright at 320, 390, 768, 1024, and 1440 widths; check critical interactions, keyboard/focus, reduced motion, 200% zoom, console errors, touch targets, and page overflow
- [x] T050 Build and smoke the local `linux/amd64` container under emulation; verify non-root user, source revision, liveness/readiness, migrations, worker, and clean shutdown
- [x] T051 Update this task list, constitution capabilities, source/document indexes, and a dark HTML validation report with exact performed checks and residual gaps

## Dependencies and Traceability

- Setup T001-T004 blocks all behavioral work.
- Evidence foundation T005-T012 is the independently runnable MVP and covers FR-006-FR-013 and FR-027-FR-028.
- Identity T013-T018 covers FR-001-FR-005 and blocks all real protected/provider/training APIs.
- Providers T019-T026 covers FR-017-FR-022 and must precede real orchestration.
- Review T027-T032 covers FR-008-FR-010 and FR-023-FR-025.
- Learning/Git T033-T039 covers FR-012-FR-016 and FR-026.
- Operations T040-T047 covers FR-006-FR-007 and FR-028-FR-030; T045-T047 are explicit external authorization gates.
- Final validation T048-T051 covers every success criterion and cannot claim gated external actions that were not performed.

## Phase 9: Compact role-aware support and organic learning

- [x] T052 Update the role/navigation contract and add server-enforced restricted-page guards
- [x] T053 Add self-service display-name editing and scalable, filtered account administration
- [x] T054 Add atomic one-plus-five conversation turns, bounded transcript context, and the Ask counter
- [x] T055 Add validated source repository registration, indexing, archive/delete confirmation, retrieval, and source-structure documentation
- [x] T056 Add persisted organic Training sessions, iterative ratings/reports, accepted wipe/commit outcomes, and governed training artifacts
- [x] T057 Rename Agent Setup/System Prompt, return the active prompt, and add the evidence-first beginner-friendly default
- [x] T058 Compact all page surfaces and implement fixed bottom navigation at every viewport, with no navigation for Users
- [x] T059 Run focused RED/GREEN tests per slice, full quality/security gates, responsive Playwright validation, and exact AMD64 image verification

## Phase 10: Searchable support sessions and exports

- [x] T060 Add RED tests for owned session listing/search/detail, recognizable first-question titles, and structured historical turns
- [x] T061 Implement bounded session repository queries and authenticated list/detail APIs
- [x] T062 Add RED browser tests for visible Ask phases, cleared composer, newest-first turns, nested evidence, and resumed follow-ups
- [x] T063 Refactor Ask into a persisted transcript with accessible progress and top-level Evidence disclosure
- [x] T064 Add Sessions navigation/page with keyword search, recent-session summaries, and owned session continuation
- [x] T065 Add RED tests and implement an authenticated, print-friendly PDF session export
- [x] T066 Validate the complete source/security/browser suite, build the exact committed `linux/amd64` image locally, publish to Zot, and deploy/verify the immutable Canary candidate
