# PointGuide local QA

Read AGENTS.md, pipeliner.config.json, and the PointGuide review/release skills. The sole developer is brimdor on macOS ARM64. Run the full configured suite and record source/tree, host, session, results, and verified cleanup.

The configured `pmGate: release` makes local QA agent-owned. Local completion keeps the Issue In Progress and never grants release approval. Deploy and verify Canary through pointguide-review-issue, then request the exact Production approval there. An omitted pmGate retains upstream local approval; invalid gates fail closed. There is no baton or second PM approval.

Use a fresh PostgreSQL 17 cluster on localhost, a database ending in `_test`, matching DATABASE_URL and TEST_DATABASE_URL, and port 3100 for Playwright fixture authentication. Never use a shared database. Follow [local setup and cleanup](../../../../docs/local-qa.html). Record full suite results, not skipped database tests.

Track exact task-owned resources before tests and remove them on success and failure. Stop PostgreSQL using its owned data directory and verify closure before removal. Playwright owns its server; verify port 3100 is closed. Remove only task-owned outputs and image IDs; never prune globally or kill broad process groups.

Framework adoption and updates run agent tests and cleanup without deployment or PM Testing. Application review still requires verified Canary and all PointGuide release gates.
