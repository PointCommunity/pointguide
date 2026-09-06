# Security Requirements Checklist: PointGuide Initial Web Application

**Purpose**: Test authentication, authorization, secrets, model, web, and Git boundary requirements
**Created**: 2026-09-06
**Feature**: [spec.md](../spec.md)

- [x] CHK001 JWT trust fields and the independent database authorization authority are explicit. [Completeness, FR-001-FR-005]
- [x] CHK002 Bootstrap races, self-service restrictions, Owner-only actions, and final-Owner invariants are specified. [Coverage, FR-002-FR-005]
- [x] CHK003 Provider secret input, storage, masking, prompt/log exclusion, and credential-cache sensitivity are specified. [Completeness, FR-017-FR-020]
- [x] CHK004 Model runtime, repository evidence, supplemental web, and Git execution trust boundaries are explicit. [Clarity, FR-007-FR-008, FR-025]
- [x] CHK005 Git path, operation, review, branch, PR, merge, force-push, and cross-repository limits are explicit. [Coverage, FR-016]
- [x] CHK006 Audit coverage and secret/reasoning exclusions are specified. [Completeness, FR-026]
- [x] CHK007 Release approval and immutable candidate identity are explicit. [Consistency, FR-029-FR-030]
