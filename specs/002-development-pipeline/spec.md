# Spec: PointGuide Development Pipeline

Historical foundation: current adoption and workflow authority is specs/003-pipeliner-adoption/spec.md and AGENTS.md. Hosted application/container builds are retired. Framework maintenance does not deploy the application or require an Issue or PM approval. Preserve these original design notes as history; do not execute superseded delivery instructions.

## Objective

Adopt Versa's proven Issue-to-Production operating model for PointGuide without importing Versa product assumptions or altering the currently deployed PointGuide application state. Future work is governed through the private organization Project `PointGuide`, one active Issue at a time, an exact immutable Canary candidate, explicit user approval, and immediate same-digest Production promotion.

## Tech Stack

- GitHub repository: `PointCommunity/pointguide`
- GitHub Project: private organization Project `PointGuide`
- Runtime: Next.js 16, React 19, TypeScript 6, Node.js 22, PostgreSQL 17
- CI: GitHub Actions `Quality / verify` and `Container / amd64`
- Images: local Podman `linux/amd64` builds published to homelab Zot
- Deployment: Gitea-backed homelab GitOps, Argo CD, and bjw-s app-template

## Commands

- Complete source gate: `npm run check`
- Browser gate: `npm run test:e2e`
- Security gate: `npm run security:check && npm audit --omit=dev --audit-level=high`
- Workflow alignment: `npm run skills:check`
- Project audit: `npm run pipeline:health`
- Diff integrity: `git diff --check`
- Canary candidate render: `node .agents/skills/pointguide-release-canary/scripts/check-candidate.mjs canary <source-sha> <digest> /Users/chris/Documents/Github/homelab`
- Live release verification: `node .agents/skills/pointguide-release-canary/scripts/verify-live.mjs <canary|production> <digest> <homelab-sha>`

## Project Structure

- `AGENTS.md`: durable PointGuide product and delivery authority
- `.agents/pointguide-pipeline-policy.html`: accessible human-readable shared policy
- `.agents/skills/pointguide-*`: canonical lifecycle skills and deterministic checks
- `.agents/skills/{awesome-design,design-taste-frontend,image-to-code,playwright-cli,web-design-guidelines}`: additive shared product skills
- `.claude/skills/*`: regular-file adapters pointing to canonical skills
- `CLAUDE.md`, `GEMINI.md`: imports of `AGENTS.md`
- `.github/workflows/*`: required source and AMD64 build checks
- `specs/002-development-pipeline/*`: migration specification, plan, and tasks

## Code Style

Scripts are ESM, fail closed on ambiguous live state, invoke `gh`, `git`, `helm`, and `kubectl` without a shell, and print only non-secret evidence:

```js
const output = execFileSync("gh", args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
```

Skills keep shared invariants in the policy and contain only role-specific decisions and transitions.

## Testing Strategy

- Validate every canonical skill's frontmatter and every Claude adapter.
- Deterministically audit Project fields, Issue metadata, one-active-Issue state, PR linkage, and exact CI evidence.
- Reject malformed candidate SHAs/digests and rendered image-count drift.
- Compare Helm render output before and after the bjw-s chart update; accept only understood, non-data-destructive differences.
- Run full PointGuide typecheck, lint, unit/integration/contract coverage, production build, security checks, browser tests, and AMD64 container validation before Canary.
- Verify the exact Canary digest, init containers, migrations, web/worker identity, probes, restarts, ingress boundary, Argo state, nodes, pods, applications, and Ceph before review.

## Boundaries

- Always: preserve unrelated changes; read live GitHub, Zot, GitOps, Argo, Kubernetes, and data state; keep one active Issue; build from an exact clean archive; deploy Canary before review; promote the identical digest after approval; verify every mutation.
- Ask first: create an Issue from a specific draft; merge and promote the exact Canary candidate; perform destructive schema/data rollback; broaden Issue scope.
- Never: rebuild between Canary and Production; build on a Kubernetes node; edit live workloads as the durable fix; expose secrets; delete a referenced image; alter Production before exact approval; change PVC identity, database ownership, secret identity, or release identity implicitly.

## Success Criteria

- A private organization Project titled `PointGuide` is linked to the repository and has exact Status, Priority, Impact, and Effort options.
- Repository labels support exactly one governed `type:*` and one or more `area:*` values.
- PointGuide has adapted lifecycle skills for Issue creation, backlog audit, implementation, review, Canary, closure, Production, pipeline health, skill maintenance, and umbrella routing.
- The policy and `AGENTS.md` enforce agent-owned status movement, one active Issue, `Refs #N`, exact-candidate approval, same-digest promotion, immediate Production deployment after approval, rollback, and registry cleanup.
- CI runs the repository alignment checks and retains full Quality and AMD64 gates.
- Both PointGuide deployment charts use the latest verified compatible bjw-s app-template release and render safely without changing live image, data, secret, ingress, or workload identity.
- Existing Canary and Production remain healthy until a separately approved candidate promotion changes Production.

## Open Questions

None. The current request defines the Project name, Canary-first release order, homelab/Gitea/Argo deployment authority, Zot registry, and Production approval boundary. The current private PointCommunity organization, `brimdor` PM identity, five Versa statuses, and PointGuide's existing runtime layout supply the remaining repository-specific values.
