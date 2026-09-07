# Implementation Plan: PointGuide Initial Web Application

**Branch**: `codex/pointguide-app` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

## Summary

Build a mobile-first support application that answers from a commit-bound evidence corpus, enforces a claim-to-evidence ledger, provisions the first Cloudflare identity as Owner and all others Pending, supports Owner-only Codex/Ollama configuration, optionally verifies answers through a reviewing profile, retains feedback and governed training proposals, and releases an exact AMD64 image through Zot and homelab GitOps.

Implementation proceeds as thin vertical slices: executable shell and static UI; deterministic evidence retrieval/answer contract; authentication/roles; provider catalog/profile control; Deep research; feedback/training/Git proposals; PostgreSQL persistence/worker; container/release gates.

## Technical Context

**Language/Version**: Node.js 22, TypeScript 6.0.3
**Primary Dependencies**: Next.js 16.3.4, React 19.2.8, Zod 4.5.4, JOSE 6.2.12, Drizzle ORM 0.45.2, postgres 3.4.9
**Storage**: PostgreSQL; repository files are source truth; external secret/credential volumes for provider auth
**Testing**: Vitest 5.0.0, Testing Library, Playwright 1.63.0, deterministic provider/Git fixtures
**Target Platform**: Linux container on Kubernetes, built/tested locally as `linux/amd64`; responsive modern browsers
**Project Type**: Single full-stack web application plus worker/migration entrypoints
**Performance Goals**: local knowledge results begin within 500 ms p95 on the expected corpus; non-model pages reach usable content within 2.5 s on a typical phone/LAN; streaming surfaces progress
**Constraints**: private corpus; no model shell/Git secrets; 320 CSS-pixel minimum; 44 CSS-pixel targets; 80% core-logic line coverage; review fails closed
**Scale/Scope**: one church organization, tens to low hundreds of accounts, initially 20 source records/19 PDFs, designed for thousands of versioned documents without architectural replacement

## Constitution Check

| Principle | Status | Plan evidence |
|---|---|---|
| Repository evidence authoritative | Pass | Commit-bound index, evidence records, claim ledger, deterministic renderer |
| Safety before action | Pass | Structured safety/applicability contract and advisory-only runtime |
| Least privilege and human governance | Pass | DB authorization, Owner/provider boundary, typed proposals, no model credentials/tools |
| Spec-first, test-driven, incremental | Pass | Approved spec, traceable tasks, RED/GREEN slices, 80% core threshold |
| Accessible mobile-first quality | Pass | Responsive contract, Playwright/axe/manual viewport matrix |
| Immutable verifiable delivery | Pass | clean archive, AMD64 Podman, Zot digest, GitOps canary, promotion gate |
| Documentation part of change | Pass | dark HTML contract/indexes plus required agent workflow artifacts |

No constitution exception is required.

## Project Structure

```text
src/
├── app/                       Next.js pages and route handlers
├── components/                Accessible mobile-first UI
├── db/                        Drizzle schema, database client, repositories
├── lib/
│   ├── agent/                 answer schema, claim validation, reviewer orchestration
│   ├── auth/                  Cloudflare JWT verification and role policy
│   ├── config/                validated server environment
│   ├── evidence/              corpus validation, indexing, search, web normalization
│   ├── feedback/              rating signals and training workflow
│   ├── git/                   typed proposals and bounded repository worker
│   └── providers/             Codex and Ollama adapters/catalogs
└── styles/                    semantic dark design tokens
migrations/                    forward SQL migrations
scripts/                       migrate, worker, index, security, release verification
tests/
├── unit/                      pure domain policy and schemas
├── integration/               database/API/worker boundaries
├── contract/                  OpenAPI and provider fixtures
└── e2e/                       critical browser flows
research/                      immutable sources and normalized corpus
specs/001-pointguide-app/      feature artifacts and contracts
```

**Structure decision**: One Next.js project avoids a separate API deployment while preserving internal server-only module boundaries. The web, worker, and migration commands share schemas and ship in one immutable image.

## Implementation Slices

1. **Foundation demo**: pinned project, dark responsive shell, health endpoint, corpus manifest validation, deterministic repository search, fixture-grounded answer and feedback UI.
2. **Identity**: Cloudflare JWT verification, transactional bootstrap Owner, Pending states, role matrix, account-management UI/API.

## 2026-09-07 implementation extension

1. Update the shared role policy, add server page guards, add self-service display-name mutation, and replace account cards with a filtered selector/editor.
2. Add atomic six-turn conversation accounting and bounded transcript retrieval, then expose the subtle follow-up counter in the compact Ask composer.
3. Add a validated source-repository registry, bounded GitHub tree/text indexer, lifecycle confirmations, active-chunk retrieval, and dark HTML structure guide.
4. Add the persisted organic Training state machine and agent learning-report generation, then finalize accepted learning through the existing governed proposal/PR worker.
5. Rename and compact Agent Setup, return its active System Prompt, and seed the evidence-first beginner-friendly default.
6. Consolidate all role-aware navigation into a fixed bottom bar, compact shared surfaces, then run focused tests, the full suite, browser matrix, security checks, and an exact AMD64 build.

The extension is delivered as vertical slices in this order because authorization and conversation limits are shared foundations; repository registration precedes training commit targets; final visual compaction follows stable component states.

## 2026-09-07 session continuity extension

1. Extend the learning repository with owner-scoped session summaries and structured turns reconstructed from existing conversation, message, answer, claim, and evidence records. Search remains bounded and server-side across title and message content.
2. Add authenticated session list/detail routes, then make the Ask workspace create or resume one conversation without duplicating state. Use optimistic question insertion and real streamed status events for immediate feedback.
3. Keep transcript state newest-first only at the presentation boundary; persisted/model context remains chronological. Collapse each answer's evidence under one disclosure containing the existing per-source disclosures.
4. Add an all-role Sessions route and a responsive fixed-bottom navigation layout that wraps safely on phones while retaining one row where space permits.
5. Generate owner-scoped PDF exports from the structured session detail using a server-only PDF renderer with bounded text, page-aware wrapping, deterministic metadata, and attachment headers.
6. Exercise repository, API, UI, ownership, accessibility, responsive, and PDF rendering checks before the mandatory exact-archive AMD64 Zot build and Canary-only GitOps deployment.
3. **Providers**: protected provider records, Codex device flow boundary, Ollama write-only key flow, dynamic catalogs, model/effort/profile/prompt UI.
4. **Review**: primary structured claim ledger, optional Deep research reviewer, deterministic supported-claim renderer, global/user controls.
5. **Learning and Git**: durable feedback, training review, web findings, bounded proposal state machine, Git worker fixture and audit.
6. **Production storage and delivery**: PostgreSQL migrations/jobs, indexing worker, container, AMD64 verification, canary manifests and exact-digest release checks.

## Risk Controls

- Feature flags keep live providers, Git writes, and supplemental web search disabled until configured.
- Provider and Git tests use local deterministic fixtures; no test requires a real credential.
- Database migrations are additive and forward-only for the initial unreleased schema.
- PointGuide application code and deployment identity remain separate from configured knowledge-source repositories such as PointAudio.
- Cloudflare, provider login, secret creation, Zot push, Gitea push, Argo sync, and production promotion remain explicit external-stage actions.

## Complexity Tracking

No justified constitution violations.
