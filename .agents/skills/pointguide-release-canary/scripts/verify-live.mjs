#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const [, , track, sourceSha, imageDigest, homelabSha] = process.argv;
if (!track || !sourceSha || !imageDigest || !homelabSha || process.argv.length !== 6) {
  console.error("usage: verify-live.mjs <canary|production> <full-source-sha> <sha256-digest> <full-homelab-sha>");
  process.exit(2);
}
if (!new Set(["canary", "production"]).has(track)) {
  console.error("release track must be canary or production");
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(sourceSha) || !/^sha256:[0-9a-f]{64}$/.test(imageDigest) || !/^[0-9a-f]{40}$/.test(homelabSha)) {
  console.error("source SHA, digest, or homelab SHA format is invalid");
  process.exit(2);
}

const appName = track === "canary" ? "pointguide-canary" : "pointguide";
const namespace = appName;
const run = (args) => execFileSync("kubectl", args, {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
const json = (args) => JSON.parse(run(args));

try {
  const application = json(["get", "application", appName, "-n", "argocd", "-o", "json"]);
  const actualRevision = application.status?.sync?.revision;
  const sync = application.status?.sync?.status;
  const health = application.status?.health?.status;
  const operation = application.status?.operationState?.phase;
  if (actualRevision !== homelabSha || sync !== "Synced" || health !== "Healthy" || operation !== "Succeeded") {
    throw new Error(`Argo mismatch: revision=${actualRevision} sync=${sync} health=${health} operation=${operation}`);
  }

  const appPods = json(["get", "pods", "-n", namespace, "-l", "app.kubernetes.io/controller=main", "-o", "json"]).items;
  const postgresPods = json(["get", "pods", "-n", namespace, "-l", "app.kubernetes.io/controller=postgres", "-o", "json"]).items;
  if (appPods.length !== 1 || postgresPods.length !== 1) {
    throw new Error(`expected one application pod and one PostgreSQL pod; found app=${appPods.length} postgres=${postgresPods.length}`);
  }
  const pod = appPods[0];
  const postgresPod = postgresPods[0];
  const initContainers = new Map((pod.status?.initContainerStatuses || []).map((container) => [container.name, container]));
  for (const initName of ["corpus", "migrate"]) {
    if (initContainers.get(initName)?.state?.terminated?.exitCode !== 0) throw new Error(`init container ${initName} did not complete successfully`);
  }
  const appContainers = (pod.status?.containerStatuses || []).filter((container) => ["web", "worker"].includes(container.name));
  const postgresReady = postgresPod.status?.phase === "Running"
    && (postgresPod.status?.containerStatuses || []).every((container) => container.ready && container.restartCount === 0);
  if (pod.status?.phase !== "Running" || appContainers.length !== 2 || !postgresReady) {
    throw new Error(`workload mismatch for ${pod.metadata.name} or ${postgresPod.metadata.name}`);
  }
  for (const container of appContainers) {
    if (!container.ready || container.restartCount !== 0 || !container.imageID?.endsWith(`@${imageDigest}`)) {
      throw new Error(`container ${container.name} is not ready on ${imageDigest} with zero restarts`);
    }
  }

  const runtimeSource = run(["exec", "-n", namespace, pod.metadata.name, "-c", "web", "--", "printenv", "SOURCE_REVISION"]);
  const runtimeUid = run(["exec", "-n", namespace, pod.metadata.name, "-c", "web", "--", "id", "-u"]);
  if (runtimeSource !== sourceSha || runtimeUid !== "1000") {
    throw new Error(`runtime identity mismatch: source=${runtimeSource} uid=${runtimeUid}`);
  }

  const readiness = run(["exec", "-n", namespace, pod.metadata.name, "-c", "web", "--", "node", "--input-type=module", "-e",
    'const results={}; for (const p of ["/api/healthz","/api/readyz"]) { const r=await fetch(`http://127.0.0.1:3000${p}`); if (!r.ok) throw new Error(`${p} ${r.status}`); results[p]=await r.json(); } console.log(JSON.stringify(results));']);
  const readinessJson = JSON.parse(readiness);
  const ready = readinessJson["/api/readyz"];
  if (readinessJson["/api/healthz"]?.status !== "alive" || ready?.status !== "ready" || !ready.corpusCommit || !(ready.chunks > 0)) {
    throw new Error(`health/readiness payload mismatch: ${readiness}`);
  }

  const expectedMigrations = run(["exec", "-n", namespace, pod.metadata.name, "-c", "web", "--", "node", "--input-type=module", "-e",
    'import {createHash} from "node:crypto"; import {readdirSync,readFileSync} from "node:fs"; for (const name of readdirSync("migrations").filter((v)=>/^\\d+.*\\.sql$/.test(v)).sort()) console.log(`${name}\\t${createHash("sha256").update(readFileSync(`migrations/${name}`)).digest("hex")}`);']);
  const appliedMigrations = run(["exec", "-n", namespace, postgresPod.metadata.name, "-c", "main", "--", "psql", "-U", "pointguide", "-d", "pointguide", "-At", "-F", "\t", "-c", "SELECT name,digest FROM schema_migrations ORDER BY name"]);
  if (expectedMigrations !== appliedMigrations) throw new Error("database migration names or digests do not match the running image");

  const warnings = json(["get", "events", "-n", namespace, "--field-selector", `involvedObject.name=${pod.metadata.name},type=Warning`, "-o", "json"]).items.length;
  const nodes = json(["get", "nodes", "-o", "json"]).items;
  const badNodes = nodes.filter((node) => {
    const conditions = node.status?.conditions || [];
    return conditions.find((condition) => condition.type === "Ready")?.status !== "True"
      || conditions.some((condition) => condition.type.endsWith("Pressure") && condition.status === "True");
  });
  const applications = json(["get", "applications", "-n", "argocd", "-o", "json"]).items;
  const badApps = applications.filter((app) => app.status?.sync?.status !== "Synced" || app.status?.health?.status !== "Healthy");
  const allPods = json(["get", "pods", "-A", "-o", "json"]).items;
  const badPods = allPods.filter((candidate) => {
    if (!["Running", "Succeeded"].includes(candidate.status?.phase)) return true;
    return candidate.status?.phase === "Running" && (candidate.status?.containerStatuses || []).some((container) => !container.ready);
  });
  const ceph = run(["exec", "-n", "rook-ceph", "deploy/rook-ceph-tools", "--", "ceph", "health"]);
  if (warnings || badNodes.length || badApps.length || badPods.length || ceph !== "HEALTH_OK") {
    throw new Error(`all-green failed: warnings=${warnings} nodes=${badNodes.length} apps=${badApps.length} pods=${badPods.length} ceph=${ceph}`);
  }

  console.log(`track=${track}`);
  console.log(`source_sha=${runtimeSource}`);
  console.log(`homelab_revision=${actualRevision}`);
  console.log(`pod=${pod.metadata.name}`);
  console.log(`image_digest=${imageDigest}`);
  console.log(`corpus_commit=${ready.corpusCommit}`);
  console.log(`chunks=${ready.chunks}`);
  console.log(`migrations=${expectedMigrations.split("\n").filter(Boolean).length}`);
  console.log("health=green");
} catch (error) {
  console.error(error.stderr?.toString().trim() || error.message);
  process.exit(1);
}
