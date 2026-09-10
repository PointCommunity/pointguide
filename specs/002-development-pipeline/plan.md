# Plan: PointGuide Development Pipeline

Historical foundation: current adoption and workflow authority is specs/003-pipeliner-adoption/spec.md and AGENTS.md. Hosted application/container builds are retired. Framework maintenance does not deploy the application or require an Issue or PM approval. Preserve these original design notes as history; do not execute superseded delivery instructions.

1. Capture the live PointGuide, Versa, GitHub Project, GitHub Actions, homelab chart, registry, and runtime contracts.
2. Create and configure the private `PointGuide` GitHub Project and governed repository labels, then read them back.
3. Add the adapted PointGuide lifecycle skills, shared policy, deterministic checks, tool adapters, and shared design/browser skills.
4. Merge the lifecycle contract into `AGENTS.md` and wire repository checks into `package.json` and GitHub Actions.
5. Upgrade Canary and Production chart dependencies to the latest verified bjw-s app-template release in an isolated homelab worktree, compare rendered output, and preserve every data/runtime identity.
6. Run skill, Project, source, browser, security, build, container, chart, and diff validation.
7. Commit and open a focused PointGuide pull request; require exact-head checks.
8. Build the exact head locally for AMD64, publish it to Zot, update only Canary image identity, reconcile through Gitea/Argo CD, and verify PointGuide plus whole-cluster health.
9. Keep Production unchanged and hand off the exact candidate and tailored Canary checklist. After the user approves that candidate, squash-merge, promote the same digest immediately, verify, clean obsolete unreferenced images, close the Issue when one exists, and set Done.

## Risks and mitigations

- Existing live service or data disruption: inspect PVCs/backups and compare Helm renders; do not change image/data/secret/namespace identities during chart adoption.
- GitHub Project drift: discover field and option IDs live and verify all mutations immediately.
- Cross-agent instruction drift: keep one canonical skill registry, regular-file adapters, and deterministic alignment checks.
- Candidate mismatch: bind review and approval to Issue, PR, source commit/tree, Zot digest, and Canary GitOps revision.
- Registry cleanup data loss: resolve all active GitOps references and prove retained digest pullability before removing only unreferenced manifests.

## Verification checkpoints

- Project schema and labels read back exactly.
- Skills and adapters validate with zero alignment findings.
- Source, security, browser, and build gates pass.
- Chart update produces only reviewed, compatible render changes.
- PR checks pass for the exact committed head.
- Canary and whole homelab are green at the exact candidate identity.
