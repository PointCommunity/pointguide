---
name: pointguide-maintain-skills
description: "Create, update, and validate PointGuide repository skills, shared policy, AGENTS imports, Claude adapters, and deterministic workflow checks without allowing cross-agent drift."
---

# Maintain PointGuide Skills

Framework adoption and updates run directly without an Issue via `pipeliner-adopt` and `pipeliner-update`; this skill remains their PointGuide alignment gate.

Use this skill for every change to `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.agents/`, `.claude/skills/`, or workflow validation scripts.

- `.agents/skills/` is canonical. Do not put PointGuide workflow authority in user-global skills.
- Keep the ten `pointguide-*` workflow packages, including the umbrella router, separate from additive shared design packages. Shared packages may guide implementation or review but must not weaken, replace, or duplicate pipeline authority.
- Every canonical skill needs valid `name` and `description` frontmatter and focused instructions.
- Every Claude adapter must be a regular file that points to its canonical relative `SKILL.md`; never copy full instructions or use symlinks.
- Keep `CLAUDE.md` and `GEMINI.md` as imports of `AGENTS.md`, not duplicate policies.
- Keep shared invariants in `.agents/pointguide-pipeline-policy.html`, with Dark Mode styling, and avoid repeating conditional release details across skills.
- Validate every changed skill with the current skill validator when available, then run `node .agents/skills/pointguide-maintain-skills/scripts/audit-alignment.mjs` and `npm run check`. The alignment script owns both registries: governed `pointguide-*` workflow skills and approved shared design skills.
- Test realistic positive and negative routing prompts when trigger descriptions change. Never weaken approval, one-active-Issue, exact-candidate, no-rebuild, or Production completion gates to make a test pass.
