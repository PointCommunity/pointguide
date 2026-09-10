---
name: pipeliner-close-issue
description: Complete an active Issue only after exact-candidate release evidence and every configured PM Testing approval gate are current.
---

# PointGuide application specialization

Read `AGENTS.md` and `pipeliner.config.json`. Delegate to [pointguide-close-issue](../pointguide-close-issue/SKILL.md), which owns the complete operation and all application release safeguards. Do not run an additional generic lifecycle, local PM approval, or completion gate.

Application status and approvals identify the owning Issue and exact candidate; the linked PR is supporting evidence. Framework adoption and updates use `pipeliner-adopt` and `pipeliner-update` directly without an Issue, PM Testing, or application deployment.
