---
name: pipeliner-audit-backlog
description: Audit and, when explicitly requested, repair Backlog Issue classification without consuming the active work slot.
---

# PointGuide application specialization

Read `AGENTS.md` and `pipeliner.config.json`. Delegate to [pointguide-audit-issues](../pointguide-audit-issues/SKILL.md), which owns the complete operation and all application release safeguards. Do not run an additional generic lifecycle, local PM approval, or completion gate.

Application status and approvals identify the owning Issue and exact candidate; the linked PR is supporting evidence. Framework adoption and updates use `pipeliner-adopt` and `pipeliner-update` directly without an Issue, PM Testing, or application deployment.
