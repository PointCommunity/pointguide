---
name: pipeliner-release-candidate
description: Build or prepare and verify the exact review or native candidate required by the configured release strategy without crossing the Production gate.
---

# PointGuide application specialization

Read `AGENTS.md` and `pipeliner.config.json`. Delegate to [pointguide-release-canary](../pointguide-release-canary/SKILL.md), which owns the complete operation and all application release safeguards. Do not run an additional generic lifecycle, local PM approval, or completion gate.

Application status and approvals identify the owning Issue and exact candidate; the linked PR is supporting evidence. Framework adoption and updates use `pipeliner-adopt` and `pipeliner-update` directly without an Issue, PM Testing, or application deployment.
