# Pipeliner adoption

## Scope and authority

The PM requested adoption directly without a GitHub Issue. Incorporate beneficial existing pipeline work, preserve disabled branch protection, and use brimdor's Apple Silicon Mac for local QA. This supersedes the earlier proposed Issue intake. No application deployment, PM Testing, Issue transition, or bootstrap approval is part of this maintenance operation.

## Design

- Adopt reviewed Pipeliner commit 1372f00be9756592a1e24a5dbd6bf935432885c7 using its conflict-refusing installer and target-owned reconciliation/provenance records.
- Keep PointGuide lifecycle implementations as authoritative application specializations. Pipeliner lifecycle entrypoints route to them. Shared framework adoption/update/monitoring remain Pipeliner operations; scheduling still needs explicit request.
- Preserve immutable promotion and all application/data/evidence safeguards. Local QA is agent-owned; PM Testing remains in Canary. Do not introduce a local PM gate or second completion approval.
- Retain full local tests and builds; replace hosted application/container builds with pinned, lightweight contract/security/whitespace checks. Do not fabricate CI evidence for local builds.
- Keep the live private Project #2 and existing labels. Adapt the Project audit to compare adopter identity rather than upstream example identity.

## Ordered implementation

1. Inventory and reconcile local governance, profile, lifecycle routing, and Actions.
2. Preview managed files, record reviewed collisions, apply conflict-free adoption.
3. Test target Project identity handling and local QA without a duplicate PM gate before changing deterministic behavior.
4. Validate installation, repeat adoption, policy/adapter alignment, CI review, and live Project state.
5. Run complete local source/security/browser/database gates in disposable resources; remediate and verify cleanup.
6. Commit the intended source, publish a focused maintenance PR, merge the verified exact tree, and read back main, checks, and cleanup.

## Acceptance

Configuration matches confirmed topology. No branch protection or application deployment is introduced. Framework work requires no Issue. Application work retains its Issue lifecycle and exact Canary approval. Changed reconciliation bytes reopen conflicts. All required local gates pass and published main contains the verified adoption. Task-owned processes and temporary resources are removed.

## Risks

Existing scripts may encode old hosted build checks; search all policy and executable consumers. Upstream QA assumes a local PM gate; a tested optional release gate must preserve the default behavior for other profiles. Upstream Project audit assumes a public template identity; compare against the configured target and explicit private visibility. Do not mark skipped database tests as successful verification.

## Verification

Run focused contract tests, Pipeliner repository validator, skill alignment, live Project audit, npm run check, npm run test:e2e, npm run security:check, npm audit --omit=dev --audit-level=high, and git diff --check. Rehearse existing migrations in a fresh local PostgreSQL database to enable integration tests. Inspect exact published check results and tree equality.
