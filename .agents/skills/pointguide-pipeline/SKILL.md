---
name: pointguide-pipeline
description: Implement, validate, package, and deploy PointGuide changes through the mandatory Zot and Argo CD Canary workflow. Use for PointGuide source, UI, API, schema, documentation, agent-skill, container, or deployment changes; Production always requires approval of the exact live Canary candidate.
---

# PointGuide Pipeline

Take authorized PointGuide work through a healthy, user-testable Canary. Canary is the normal completion state, not an optional follow-up.

## Operating boundary

- Application repository: `/Users/chris/Documents/ChatGPT/PointGuide`; GitHub `PointCommunity/pointguide`.
- Evidence repository: `/Users/chris/Documents/ChatGPT/PointAudio`; GitHub `PointCommunity/pointaudio`.
- Deployment repository: `/Users/chris/Documents/Github/homelab`; authoritative Gitea remote `origin`, branch `master`.
- Registry: `10.0.20.11:32309/pointguide`.
- Canary: `apps/pointguide-canary`, Argo application `pointguide-canary`, URL `https://pointguide-canary.eaglepass.io`.
- Production: `apps/pointguide`, Argo application `pointguide`, URL `https://pointguide.eaglepass.io`.

Read the live `AGENTS.md` files in the application, evidence, and deployment repositories before acting. Preserve unrelated changes. Read [references/canary-release.md](references/canary-release.md) before packaging or deploying.

## Required outcome

1. Implement on a focused branch and keep its pull request open during Canary evaluation.
2. Run the complete source, security, database, accessibility, responsive-browser, and production-build gates. Require the pull request Quality and AMD64 checks for the exact head commit to pass.
3. From that exact clean committed pull-request head, build locally with Podman for `linux/amd64`. Never build on a Kubernetes node.
4. Tag and push the image to Zot, resolve the registry digest, and verify architecture, non-root user, source revision, migrations, worker startup, liveness, and readiness.
5. In an isolated homelab worktree based on current Gitea `origin/master`, change only the PointGuide Canary image tag and digest. Render and lint the chart, review the exact diff, commit, and push to Gitea `master`.
6. Refresh and wait for Argo CD. Verify the migration init container, web and worker containers, exact image digest, probes, logs, events, zero restarts, ingress/TLS, Cloudflare Access boundary, and whole-cluster health including Ceph.
7. Update the open pull request description with the candidate tuple and give the user a tailored manual Canary checklist. Stop with the verified candidate running in Canary.

Do not ask for separate permission to build, publish, or deploy Canary after the implementation gates pass. If a Canary finding changes source, dependencies, migrations, image contents, or rendered configuration, treat it as a new candidate and repeat the entire validation and deployment cycle.

## Production lock

Production requires the user to approve the exact tuple of pull request, source SHA, immutable Zot digest, and Canary homelab revision. Before that approval, do not merge the application pull request, modify `apps/pointguide`, or sync the `pointguide` Argo application.

After approval, merge only if the resulting source tree is identical to the approved tree, promote the same approved digest without rebuilding, verify Production and whole-cluster health, and retain rollback to the prior digest.
