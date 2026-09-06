# API and Integration Requirements Checklist: PointGuide Initial Web Application

**Purpose**: Test external-boundary requirement quality
**Created**: 2026-09-06
**Feature**: [spec.md](../spec.md)

- [x] CHK001 Cloudflare, Codex, Ollama, GitHub, Zot, Gitea, and Argo CD responsibilities are bounded. [Completeness]
- [x] CHK002 Dynamic model and reasoning-effort discovery behavior is specified for removals, omissions, malformed data, and failures. [Coverage, FR-018-FR-019]
- [x] CHK003 Streaming, evidence, review, and error outcomes are independently observable. [Measurability, FR-011, FR-023-FR-024]
- [x] CHK004 Supplemental web data cannot become repository authority without the documented review/merge transition. [Consistency, FR-014-FR-016]
- [x] CHK005 Health and readiness expose dependency state without secret leakage. [Clarity, FR-028]
