# PointGuide Canary Release

## Identity and preflight

The candidate is the tuple of the open PointGuide pull request, its exact head SHA, the immutable Zot digest, and the homelab Canary commit. Read all values live; never reuse a prior run's identifiers.

Before mutation, verify the PointGuide branch is clean, GitHub checks are green for its exact head, the homelab canonical checkout and Gitea `origin/master`, current Canary pins, current Argo revision, nodes, pods, applications, and Ceph health. Use an isolated homelab worktree when the canonical checkout contains unrelated changes.

## Package and registry

Export the exact PointGuide head with `git archive` into a temporary directory and build it locally using Podman with `--platform linux/amd64` and `SOURCE_REVISION` set to the full source SHA. Tag Zot with the seven-character SHA. Push, then query the registry or pull by digest to resolve and prove the immutable digest. Do not rely on a mutable local image ID.

Smoke the published artifact with disposable PostgreSQL and the pinned PointAudio corpus. Verify all migrations, `/api/healthz`, `/api/readyz`, non-root UID, source revision, `git`, `gh`, writes-disabled worker startup, security headers, and clean teardown.

## GitOps and live verification

Change only `app-template.controllers.main.initContainers.migrate.image` through the shared YAML anchor in `apps/pointguide-canary/values.yaml`: update both tag and digest. Do not modify Production.

Run the chart's dependency update, `helm lint`, and `helm template`; inspect the rendered migration, web, and worker images. Commit only the intended Canary values file and push current Gitea `master`.

Refresh and wait for `pointguide-canary`. Verify:

- Argo is Synced and Healthy at the expected homelab revision.
- Migration succeeded and the PostgreSQL schema includes the expected migrations.
- Web and worker run the exact registry digest as UID 1000 with zero restarts.
- Liveness and readiness pass; readiness reports the pinned PointAudio commit and a non-zero chunk count.
- Logs and recent events show no unexpected errors or warnings.
- Canary ingress, TLS, DNS, and unauthenticated Cloudflare Access redirect behave correctly.
- Every node is Ready, every Argo application is Synced and Healthy, unexpected non-running pods are absent, and Ceph is `HEALTH_OK`.

## User handoff

Keep the PointGuide pull request open. Record the source SHA, digest, homelab revision, automated results, and live health in its description. Provide a manual checklist derived from the actual diff plus baseline sign-in, role authorization, evidence grounding, mobile layout, and regression checks.

Production stays untouched until the user approves this exact Canary candidate.
