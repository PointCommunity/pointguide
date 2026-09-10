---
name: pointguide-pipeline
description: Route complete PointGuide work through its Issue, review, Canary, approval, Production, closure, and health skills. Use for lifecycle-wide PointGuide work or when the correct specialized workflow is not yet clear.
---

# PointGuide Pipeline

Coordinate the complete governed lifecycle. Shared invariants live in `AGENTS.md` and `.agents/pointguide-pipeline-policy.html`; use the specialized skill that owns each mutation.

## Operating boundary

- Application repository: `/Users/chris/Documents/ChatGPT/PointGuide`; GitHub `PointCommunity/pointguide`.
- Evidence repository: `/Users/chris/Documents/ChatGPT/PointAudio`; GitHub `PointCommunity/pointaudio`.
- Deployment repository: `/Users/chris/Documents/Github/homelab`; authoritative Gitea remote `origin`, branch `master`.
- Registry: `10.0.20.11:32309/pointguide`.
- Canary: `apps/pointguide-canary`, Argo application `pointguide-canary`, URL `https://pointguide-canary.eaglepass.io`.
- Production: `apps/pointguide`, Argo application `pointguide`, URL `https://pointguide.eaglepass.io`.

Read the live `AGENTS.md` files in the application, evidence, and deployment repositories before acting. Preserve unrelated changes.

## Route by intent

- Adopt or update Pipeliner: `pipeliner-adopt` or `pipeliner-update`, directly without an Issue, PM Testing, or deployment. This maintenance exception takes precedence over application lifecycle selection.

- Draft or create work: `pointguide-create-issue`.
- Audit or reprioritize Backlog metadata: `pointguide-audit-issues`.
- Select, resume, pause, or implement an Issue: `pointguide-work-issue`.
- Review and remediate an implementation: `pointguide-review-issue`.
- Package, publish, and deploy Canary: `pointguide-release-canary`; read [references/canary-release.md](references/canary-release.md) first.
- Approve, merge, promote, verify, and close: `pointguide-close-issue`, which invokes `pointguide-release-production`.
- Read-only status and drift checks: `pointguide-pipeline-health`.
- Policy, skill, adapter, or workflow-check maintenance: `pointguide-maintain-skills`.

Start every lifecycle request with the read-only health audit appropriate to its scope. Enforce one active Issue, agent-owned Project movement, exact metadata readback, local browser QA, immutable same-digest promotion, and data-safe GitOps throughout.

## Production lock

Production requires the PM to approve the exact candidate with `Approved to merge and deploy production`. Before that approval, do not merge the application pull request, modify `apps/pointguide`, or sync the `pointguide` Argo application.

After approval, proceed immediately through exact-tree merge, same-digest Production promotion, verification, registry cleanup, Issue closure, and `Done`. Stop only for a failed gate, destructive data action, or external blocker.
