import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareProjectSnapshot } from "../../scripts/lib/validation.mjs";
import { evaluateQA, validateQA } from "../../scripts/lib/qa.mjs";
import { isFrameworkMaintenance } from "../../.agents/skills/pointguide-pipeline-health/scripts/classify-pr.mjs";
import { planAdoption, applyAdoptionPlan } from "../../scripts/lib/adoption.mjs";
import { auditCI, digest } from "../../scripts/lib/ci.mjs";

const blueprint = JSON.parse(readFileSync("blueprints/github-project.json", "utf8"));
const profile = JSON.parse(readFileSync("pipeliner.config.json", "utf8"));

describe("PointGuide framework specializations", () => {
  it("refuses collisions and reopens reconciliation when reviewed target bytes change", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pointguide-adoption-test-"));
    try {
      const sourceRoot = path.join(dir, "source");
      const targetRoot = path.join(dir, "target");
      await mkdir(sourceRoot); await mkdir(targetRoot);
      await writeFile(path.join(sourceRoot, "AGENTS.md"), "upstream");
      await writeFile(path.join(targetRoot, "AGENTS.md"), "custom");
      const args = { sourceRoot, targetRoot, profile };
      await expect(applyAdoptionPlan(await planAdoption(args))).rejects.toThrow("refusing to overwrite");
      const reconciliation = { version: 1, files: { "AGENTS.md": { sourceSha256: digest("upstream"), targetSha256: digest("custom"), rationale: "Preserve custom authority" } } };
      const plan = await planAdoption({ ...args, reconciliation });
      expect(plan.conflicts).toHaveLength(0);
      await applyAdoptionPlan(plan);
      expect(await readFile(path.join(targetRoot, "AGENTS.md"), "utf8")).toBe("custom");
      expect((await planAdoption({ ...args, reconciliation })).create).toHaveLength(0);
      await writeFile(path.join(targetRoot, "AGENTS.md"), "changed");
      expect((await planAdoption({ ...args, reconciliation })).conflicts).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects missing or stale workflow review evidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pointguide-ci-test-"));
    try {
      await mkdir(path.join(dir, ".github/workflows"), { recursive: true });
      const file = ".github/workflows/check.yml";
      await writeFile(path.join(dir, file), "reviewed");
      const review = { version: 1, workflows: { [file]: { rationale: "Fixed read-only check", files: { [file]: digest("reviewed") } } } };
      expect(await auditCI(dir, review)).toEqual([]);
      await writeFile(path.join(dir, file), "changed");
      expect(await auditCI(dir, review)).toContain(`CI review stale: ${file}`);
      expect((await auditCI(dir)).length).toBeGreaterThan(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("recognizes scoped no-Issue maintenance without exempting application changes", () => {
    const pr = { headRefName: "codex/adopt-pipeliner", body: "<!-- pipeliner-maintenance -->" };
    expect(isFrameworkMaintenance(pr, ["AGENTS.md", "scripts/lib/qa.mjs"])).toBe(true);
    expect(isFrameworkMaintenance(pr, ["src/app/page.tsx"])).toBe(false);
    expect(isFrameworkMaintenance(pr, [])).toBe(false);
    expect(isFrameworkMaintenance({ ...pr, body: "" }, ["AGENTS.md"])).toBe(false);
    expect(isFrameworkMaintenance({ ...pr, headRefName: "issue/9-feature" }, ["AGENTS.md"])).toBe(false);
  });
  it("audits the private adopter without confusing it with the public upstream example", () => {
    const target = { title: "PointGuide", visibility: "PRIVATE", repository: "PointCommunity/pointguide" };
    const snapshot = { title: target.title, public: false, repositories: [target.repository], fields: blueprint.fields, views: blueprint.views, workflows: blueprint.workflows };
    expect(compareProjectSnapshot(blueprint, snapshot, target)).toEqual([]);
    expect(compareProjectSnapshot(blueprint, { ...snapshot, public: true }, target)).toContain("visibility mismatch: expected PRIVATE");
    expect(compareProjectSnapshot(blueprint, { ...snapshot, repositories: [] }, target)).toContain("repository link missing: PointCommunity/pointguide");
  });

  const candidate = { sourceCommit: "source", gitTree: "tree" };
  function evidence(qa = profile.qa) {
    const turn = qa.turns[0];
    const environment = qa.environments[0];
    return [{ turn: turn.id, developer: turn.developer, environment: turn.environment, candidate,
      host: { available: true, os: environment.os, architecture: environment.architecture },
      candidateAvailable: true, pickedUp: true, session: "test-session",
      suite: environment.suite.map((command) => ({ command, exitCode: 0, evidence: "test-log" })),
      cleanup: { verified: true, evidence: "cleanup-log", resources: [] },
    }];
  }
  it("allows verified local agent QA to proceed to Canary without a duplicate PM gate", () => {
    const qa = structuredClone(profile.qa);
    qa.turns[0].pmGate = "release";
    expect(evaluateQA(qa, candidate, evidence(qa))).toMatchObject({ state: "complete", projectStatus: "In Progress" });
    const stale = evidence(qa);
    stale[0].candidate = { ...candidate, gitTree: "old" };
    expect(evaluateQA(qa, candidate, stale).state).toBe("remediation");
    const failed = evidence(qa);
    failed[0].suite[0].exitCode = 1;
    expect(evaluateQA(qa, candidate, failed).state).toBe("remediation");
    const dirty = evidence(qa);
    dirty[0].cleanup.verified = false;
    expect(evaluateQA(qa, candidate, dirty).state).toBe("waiting");
  });
  it("preserves the upstream local PM gate by default and rejects unknown gates", () => {
    const qa = structuredClone(profile.qa);
    delete qa.turns[0].pmGate;
    expect(evaluateQA(qa, candidate, evidence(qa)).reason).toContain("PM Testing approval required");
    qa.turns[0].pmGate = "skip";
    expect(() => validateQA(qa)).toThrow("pmGate");
  });
});
