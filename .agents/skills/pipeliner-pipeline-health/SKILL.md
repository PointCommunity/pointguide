---
name: pipeliner-pipeline-health
description: Perform a read-only audit of repository, Issue, Project, pull-request, check, candidate, deployment, and runtime pipeline health.
---

# PointGuide application specialization

Read `AGENTS.md` and `pipeliner.config.json`. Delegate to [pointguide-pipeline-health](../pointguide-pipeline-health/SKILL.md), which owns the complete operation and all application release safeguards. Do not run an additional generic lifecycle, local PM approval, or completion gate.

Application status and approvals identify the owning Issue and exact candidate; the linked PR is supporting evidence. Framework adoption and updates use `pipeliner-adopt` and `pipeliner-update` directly without an Issue, PM Testing, or application deployment.
