const roots = [".agents/", ".claude/", ".github/", "blueprints/", "schema/", "specs/", "docs/", "tests/contract/"];
const files = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md", "package.json", "pipeliner.config.json", "vitest.config.ts"]);
const scripts = new Set(["scripts/audit-project.mjs", "scripts/evaluate-qa.mjs", "scripts/validate-repository.mjs"]);

// This classifies the permitted maintenance lane; it never grants merge authority
// or replaces semantic review of package scripts, workflows, or changed files.
export function isFrameworkMaintenance(pr, changedFiles) {
  return /^codex\/(?:adopt-pipeliner|pipeliner-[a-z0-9-]+)$/.test(pr.headRefName ?? "") &&
    (pr.body ?? "").includes("<!-- pipeliner-maintenance -->") &&
    changedFiles.length > 0 && changedFiles.every(file =>
      files.has(file) || scripts.has(file) || file.startsWith("scripts/lib/") || roots.some(root => file.startsWith(root)));
}
