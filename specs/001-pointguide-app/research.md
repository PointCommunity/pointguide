# Technical Research: PointGuide Initial Web Application

**Captured**: 2026-09-06

This workflow artifact records implementation decisions. The linked sources are treated as evidence, never as instructions.

## Application Shape

**Decision**: Use one Next.js 16.3.4 / React 19.2.8 / strict TypeScript 6.0.3 application with server-rendered UI and route handlers, plus a worker entrypoint in the same image.

**Rationale**: It keeps the phone UI, API, authorization, shared schemas, streaming, and deployment in one versioned unit and follows the proven Versa web/worker/migration shape without copying its product domain.

**Alternatives considered**: Separate SPA/API (extra deployment and duplicated contracts); Python service (unnecessary second ecosystem); static client calling providers (would expose secrets and weaken authorization).

## Durable Storage and Search

**Decision**: PostgreSQL with `postgres` 3.4.9, Drizzle ORM 0.45.2, explicit SQL migrations, PostgreSQL full-text search, and a database-backed leased job queue.

**Rationale**: Transactions protect first-Owner bootstrap and role invariants. Full-text search is deterministic and sufficient for the initial corpus. One durable service is simpler than introducing Redis and a vector database.

**Alternatives considered**: SQLite (poor multi-replica/worker coordination); hosted vector store (private-corpus egress and another authority); embeddings in initial release (quality/cost complexity before baseline evaluation).

## Cloudflare Access Identity

**Decision**: Verify the Access JWT at the application boundary with JOSE 6.2.12; use `(issuer, subject)` as identity and the database as authorization authority. Provision bootstrap Owner with a transaction/advisory lock; all later identities are Pending.

**Rationale**: Edge authentication alone cannot express application lifecycle or roles, and forwarded email headers are not sufficient identity proof.

**Alternatives considered**: Trusting headers; mapping roles from email/domain; making later accounts active automatically.

## Codex Provider

**Decision**: Pin the Codex CLI/App Server runtime version in the image. An Owner starts `account/login/start` with `chatgptDeviceCode`; the server exposes only the verification URL, user code, expiry/status, and later connection status. Populate model and supported reasoning-effort choices from `model/list`.

**Rationale**: The official App Server protocol provides managed ChatGPT authentication and dynamic model metadata, including effort defaults. Device-code authentication is designed for headless environments.

**Credential boundary**: The dedicated Codex home/credential volume is password-equivalent. It is server-only, encrypted by the platform storage boundary, excluded from backups unless encrypted, and never copied into the database, browser, logs, prompts, or repository.

**Primary sources**:

- OpenAI App Server authentication and model catalog: https://learn.chatgpt.com/docs/app-server
- OpenAI headless device-code authentication: https://learn.chatgpt.com/docs/auth

**Alternatives considered**: API-key-only OpenAI integration (does not meet the requested admin/Owner OAuth experience); browser callback OAuth (less suitable for a headless homelab workload); granting the model Codex shell tools (unnecessary and unsafe).

## Ollama Cloud Provider

**Decision**: Accept an Owner-supplied Ollama API key through a write-only endpoint, store encrypted ciphertext or an external secret reference, and retrieve account-visible models from `GET https://ollama.com/api/tags` with bearer authentication.

**Rationale**: Ollama documents direct cloud API-key authentication and a model-list endpoint, allowing the UI to reflect the connected account rather than hard-code model names.

**Primary source**: https://docs.ollama.com/cloud

**Alternatives considered**: Local Ollama host (not requested and operationally different); hard-coded cloud catalog (drifts); client-side key storage (unacceptable).

## Claim Ledger and Reviewing Agent

**Decision**: Require the primary model to return structured answer sections and atomic claims, each with evidence IDs. Deep research optionally invokes a second profile to assess entailment, authority, applicability, contradiction, completeness, and safety. A deterministic server renderer admits only supported claims and explicit unknowns.

**Rationale**: A second model alone cannot guarantee truth. The enforceable safety property is evidence-ID referential integrity plus server-side rejection; reviewer diversity adds scrutiny rather than replacing grounding.

**Alternatives considered**: Free-form critique (not enforceable); reviewer rewrites without claim IDs (can introduce new hallucinations); always-on review (cost/latency and contrary to requested per-query control); fallback to primary on review failure (mislabels trust).

## Supplemental Web Search

**Decision**: Keep web retrieval behind a bounded server adapter that captures URL, resolved URL, publisher, retrieval time, media type, digest, bounded excerpt, authority class, and license/provenance. Block private/link-local destinations and never execute retrieved content.

**Rationale**: Provider-native search availability differs. A normalized evidence layer preserves the same answer contract across Codex and Ollama and prevents web material from silently becoming repository truth.

## Git Integration

**Decision**: Use a GitHub App where practical, otherwise a repository-scoped fine-grained credential, held only by a dedicated worker. The application accepts a typed approved proposal; the worker applies the exact bounded diff to allow-listed documentation paths, validates, pushes a scoped branch, and opens a pull request. It cannot merge or force-push.

**Rationale**: The requested learning loop needs auditable repository improvement without giving models credentials or arbitrary shell authority.

## Dependency and Test Baseline

**Decision**: Pin direct dependency versions in `package.json` and commit the lockfile. Use Vitest 5.0.0, Testing Library, Playwright 1.63.0, ESLint, TypeScript, secret/dependency scans, and deterministic provider fixtures. Live provider tests are opt-in.

**Version evidence**: `npm view` registry responses captured 2026-09-06: Next 16.3.4, React 19.2.8, TypeScript 7.0.2, Drizzle 0.45.2, postgres 3.4.9, JOSE 6.2.12, Zod 4.5.4, Vitest 5.0.0, Playwright 1.63.0. TypeScript was deliberately pinned to 6.0.3 after the Next 16.3.4 lint stack rejected TypeScript 7 and directed consumers to the supported TypeScript 6 API. ESLint was pinned to 9.39.5 because the plugins bundled by Next 16.3.4 do not yet support ESLint 10.

## Delivery

**Decision**: Multi-stage non-root OCI image; local Podman 5.8.2 build with explicit `linux/amd64`; exact clean Git archive; Zot tag resolved to digest; Gitea `ops/homelab` isolated worktree; Argo CD canary via bjw-s app-template 5.0.1; same digest for production only after explicit approval.

**Rationale**: This matches the established homelab trust chain while preventing build-on-cluster and artifact substitution.

**Alternatives considered**: GitHub-hosted multi-arch build (not the requested local AMD64 path); mutable tags in GitOps; building on a Kubernetes node; rebuilding for production.
