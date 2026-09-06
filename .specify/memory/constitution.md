# PointGuide Project Constitution

## Core Principles

### I. Repository Evidence Is Authoritative

Every substantive factual or actionable claim presented to a user must point to captured evidence. Repository evidence is preferred; web evidence remains supplemental until reviewed and merged. Unsupported facts are explicitly unknown. Original source files and provenance are immutable.

### II. Safety Before Action

The application is advisory and has no live-system control. Potentially disruptive technology procedures identify exact applicability, prerequisites, service impact, backup or rollback, and uncertainty before steps are shown.

### III. Least Privilege and Human Governance

Cloudflare authenticates identities; the application database authorizes them. New accounts are Pending, the first account is Owner, provider control is Owner-only, and the final active Owner cannot be removed. Models never receive secrets, shell access, unrestricted networking, or direct Git authority. Repository changes use reviewed proposals and pull requests.

### IV. Spec-First, Test-Driven, Incremental Delivery

Material behavior begins with testable requirements and is delivered in independently runnable vertical slices. Behavioral code follows a recorded failing test. Core logic maintains at least 80% line coverage; authentication, authorization, evidence grounding, provider boundaries, and Git path controls require explicit tests.

### V. Accessible Mobile-First Product Quality

The default interface is dark, keyboard accessible, usable at 320 CSS pixels without page-level horizontal scrolling, uses at least 44 by 44 CSS-pixel touch targets, respects safe areas and reduced motion, and remains usable at 200% zoom.

### VI. Immutable, Verifiable Delivery

Release images are built locally from an exact clean committed archive for `linux/amd64`, tested under emulation, pushed to Zot, resolved to a digest, and promoted through Gitea and Argo CD without rebuilding. Production requires explicit approval of the exact source tree, digest, and GitOps commit.

### VII. Documentation Is Part of the Change

Human-facing documents and diagrams are responsive dark-mode HTML. Agent workflow artifacts may remain Markdown where their tools require it. Changes update affected indexes, dates, contracts, tasks, and validation evidence together.

## Mandatory Gates

- Specification and cross-artifact review before implementation.
- Tests, type checking, lint, production build, security checks, and container smoke before release.
- No secrets or sensitive personal/private-network data in Git, logs, prompts, or browser payloads.
- No Cloudflare, 1Password, Gitea, Argo CD, registry, production, or live-system mutation without the applicable explicit authorization.

## Project Capabilities

### Identity and Account Governance

- Cloudflare Access application assertions are verified against the configured issuer, audience, RS256 signature, expiry, subject, application-token type, and identity-provider email.
- A serialized PostgreSQL bootstrap transaction creates one approved Owner; later identities start Pending.
- Server-side account policy enforces lifecycle access, Admin and Owner role boundaries, optimistic versions, self-change protection, and retention of an active Owner.
- The protected account API and mobile account directory expose only public account fields and emit bounded audit metadata.

### Owner AI Governance

- Only an approved Owner can connect Codex or Ollama Cloud, refresh catalogs, select models and advertised reasoning efforts, revise agent prompts, or change global review policy.
- Codex uses the initialized App Server device-code flow and keeps its credential directory server-only. Ollama keys cross a write-only boundary and are stored only as AES-256-GCM ciphertext.
- Provider catalogs, primary/reviewer profiles, immutable prompt revisions, and review policy persist in PostgreSQL with bounded audit metadata that excludes prompts and credentials.
- Deep research cannot be enabled until both an enabled primary profile and enabled reviewer profile are valid; same-model and cross-provider profiles remain supported.

### Established Patterns

- Route handlers delegate authentication and authorization to testable server-only boundaries.
- Production uses PostgreSQL while local deterministic browser tests use an in-memory store that is prohibited in production mode.
- Navigation is derived from the approved account role; lifecycle redirects never replace server-side authorization.

## Governance

Principle changes require stakeholder discussion and a major version increment. New compatible capabilities increment the minor version after validation; wording-only changes increment the patch version. Each feature must report constitution compliance and justified exceptions.

| Version | Date | Changes |
|---|---|---|
| 1.2.0 | 2026-09-07 | Added Owner-only provider connections, dynamic catalogs, encrypted secrets, versioned agent profiles, and governed review policy. |
| 1.1.0 | 2026-09-06 | Added verified identity, transactional Owner bootstrap, account governance, and lifecycle capabilities. |
| 1.0.0 | 2026-09-06 | Initial PointGuide governance derived from repository instructions and approved product decisions. |

**Version**: 1.2.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-07
