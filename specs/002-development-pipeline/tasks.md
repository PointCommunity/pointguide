# Tasks: PointGuide Development Pipeline

Historical foundation: current adoption and workflow authority is specs/003-pipeliner-adoption/spec.md and AGENTS.md. Hosted application/container builds are retired. Framework maintenance does not deploy the application or require an Issue or PM approval. Preserve these original design notes as history; do not execute superseded delivery instructions.

- [ ] Create and verify the private PointGuide Project and governed labels.
  - Acceptance: exact fields/options exist, the repository is linked, and no Issue is activated or created.
  - Verify: live `gh project view`, `field-list`, and `gh label list` readback.
- [ ] Add PointGuide lifecycle skills, policy, adapters, and deterministic scripts.
  - Acceptance: all adapted paths and values are PointGuide-specific and every skill has focused frontmatter.
  - Verify: quick skill validation and `npm run skills:check`.
- [ ] Merge workflow authority into repository instructions and CI.
  - Acceptance: `AGENTS.md`, imports, package scripts, and GitHub workflows agree on the gates and approval boundary.
  - Verify: alignment audit, workflow inspection, and `git diff --check`.
- [ ] Adopt the latest compatible bjw-s app-template chart for both tracks.
  - Acceptance: both charts use the verified release; render differences are understood; image, PVC, secret, ingress, namespace, and workload identities are preserved.
  - Verify: Helm dependency update, lint, render, and semantic diff in an isolated homelab worktree.
- [ ] Run complete local and CI validation.
  - Acceptance: repository source, browser, security, build, alignment, AMD64, and Project checks pass.
  - Verify: full command output and exact PR-head GitHub checks.
- [ ] Deploy and verify the exact Canary candidate.
  - Acceptance: Zot digest, Canary GitOps revision, runtime identity, migration, probes, restarts, ingress boundary, and all homelab layers are green; Production is unchanged.
  - Verify: candidate and live-verification scripts plus direct logs/events/readiness evidence.
