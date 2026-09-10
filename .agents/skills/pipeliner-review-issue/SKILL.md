---
name: pipeliner-review-issue
description: Perform complete agent QA for the active Issue, remediate findings, identify the exact candidate, and prepare its PM Testing handoff.
---

# PointGuide application specialization

Read `AGENTS.md` and `pipeliner.config.json`. Delegate to [pointguide-review-issue](../pointguide-review-issue/SKILL.md), which owns the complete operation and all application release safeguards. Do not run an additional generic lifecycle, local PM approval, or completion gate.

Application status and approvals identify the owning Issue and exact candidate; the linked PR is supporting evidence. Framework adoption and updates use `pipeliner-adopt` and `pipeliner-update` directly without an Issue, PM Testing, or application deployment.
