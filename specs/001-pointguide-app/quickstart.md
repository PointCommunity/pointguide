# PointGuide Development Quickstart

This is an agent/developer workflow artifact. Human-facing product and operational documentation remains responsive dark HTML.

## Prerequisites

- Node.js 22 and npm 10
- PostgreSQL for integration/runtime work
- Podman 5+ with AMD64 emulation for release validation
- No real provider, Cloudflare, GitHub, registry, or homelab credential is required for deterministic local tests

## Local Workflow

1. Copy `.env.example` to `.env.local` and use non-secret development values.
2. Install the committed dependency graph with `npm ci`.
3. Run migrations against an isolated development database with `npm run migrate`.
4. Validate and index the repository corpus with `npm run index:repo -- --ref HEAD`.
5. Start the app with `npm run dev` and the worker with `npm run worker` when job behavior is under test.
6. Run `npm run check` before review and `npm run test:e2e` for critical browser flows.

## Initial Deterministic Scenario

1. Enable development auth fixtures; do not bypass authorization in production mode.
2. Sign in as the fixture Owner and open Owner settings.
3. Load fixture Codex and Ollama catalogs, select a primary and reviewer, and enable review.
4. Ask the fixed M32 question, enable Deep research, inspect claim-linked repository evidence, and submit feedback.
5. Flag a fixture web finding and review its proposal without sending a real GitHub request.

## Release Candidate Gate

The release script must reject a dirty or uncommitted source candidate, build from a clean archive using `--platform linux/amd64`, inspect the resulting architecture, run health/readiness smoke checks, and print the source revision. Publishing or deploying is a separate explicitly authorized action.
