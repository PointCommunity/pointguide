"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SourceRepositoryRecord, SourceValidationReport } from "@/lib/sources/types";

type ConfirmAction = { kind: "archive" | "delete"; source: SourceRepositoryRecord };

function ValidationReport({ report }: { report: SourceValidationReport }) {
  return <section className={`validation-report ${report.valid ? "valid" : "invalid"}`} aria-label="Repository validation report">
    <header><strong>{report.valid ? "Repository passed validation" : "Repository needs changes"}</strong><span>{report.chunksIndexed} searchable chunks</span></header>
    <ul><li className={report.requirements.agentsFile ? "pass" : "fail"}>Root AGENTS.md</li><li className={report.requirements.evidenceContent ? "pass" : "fail"}>Supported evidence content</li><li className={report.requirements.integrityManifest ? "pass" : "fail"}>Integrity manifest</li></ul>
    {report.errors.length ? <div><strong>Required changes</strong><ul>{report.errors.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {report.warnings.length ? <div><strong>Warnings</strong><ul>{report.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    <small>Checked commit {report.commitSha.slice(0, 12)} on {new Date(report.checkedAt).toLocaleString()}.</small>
  </section>;
}

export function KnowledgeWorkspace() {
  const [sources, setSources] = useState<SourceRepositoryRecord[]>([]);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [report, setReport] = useState<SourceValidationReport | null>(null);
  const [status, setStatus] = useState("Loading connected repositories…");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function refresh() { const response = await fetch("/api/knowledge/sources", { cache: "no-store" }); if (!response.ok) throw new Error(); const payload = await response.json() as { sources: SourceRepositoryRecord[] }; setSources(payload.sources); }
  useEffect(() => { let active = true; void fetch("/api/knowledge/sources", { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ sources: SourceRepositoryRecord[] }>; }).then((payload) => { if (active) { setSources(payload.sources); setStatus(""); } }).catch(() => { if (active) setStatus("Connected repositories could not be loaded."); }); return () => { active = false; }; }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus("Validating repository structure and indexing supported evidence…"); setReport(null);
    const response = await fetch("/api/knowledge/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repositoryUrl }) });
    const payload = await response.json() as { report?: SourceValidationReport; error?: { message?: string } };
    if (payload.report) setReport(payload.report);
    if (!response.ok) { setStatus(payload.error?.message ?? "Repository validation failed."); return; }
    setRepositoryUrl(""); setStatus("Repository linked and indexed."); await refresh();
  }

  async function completeConfirmation() {
    if (!confirm || confirmation !== confirm.source.fullName) return;
    setStatus(confirm.kind === "archive" ? "Archiving source…" : "Deleting archived source…");
    const response = await fetch(`/api/knowledge/sources/${confirm.source.id}`, { method: confirm.kind === "archive" ? "PATCH" : "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation }) });
    if (!response.ok) { const payload = await response.json() as { error?: { message?: string } }; setStatus(payload.error?.message ?? "Source change failed."); return; }
    setConfirm(null); setConfirmation(""); setStatus(confirm.kind === "archive" ? "Source archived. It is no longer searched." : "Archived source deleted."); await refresh();
  }

  return <>
    <section className="welcome-panel compact-welcome"><p className="eyebrow">Checked source repositories</p><h1>Knowledge</h1><p>Add and maintain the validated repositories PointGuide can use as church technology evidence.</p></section>
    <form className="source-add-form compact-card" onSubmit={add}><div><h2>Add a repository</h2><p>PointGuide validates structure and integrity before indexing anything.</p></div><label>GitHub repository URL<input type="url" required value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/PointCommunity/example" /></label><button type="submit">Validate and add</button><a href="/docs/source-repository-structure.html" target="_blank">Source repository guide <span aria-hidden="true">↗</span></a></form>
    {status ? <p className="training-status" role="status">{status}</p> : null}
    {report ? <ValidationReport report={report} /> : null}
    <section className="sources-section" aria-labelledby="sources-title"><div className="section-heading"><div><p className="eyebrow">Source registry</p><h2 id="sources-title">Connected repositories</h2></div><span>{sources.length}</span></div><div className="source-list">{sources.map((source) => <article className="knowledge-card compact-card" key={source.id}><span className="source-badge">{source.status}</span><div><h3>{source.fullName}</h3><p>{source.validationReport.chunksIndexed} chunks · commit {source.indexedCommit.slice(0, 12)}</p><a href={source.url} rel="noreferrer" target="_blank">Open repository <span aria-hidden="true">↗</span></a></div><div className="source-actions">{source.status === "ACTIVE" ? <button type="button" onClick={() => { setConfirm({ kind: "archive", source }); setConfirmation(""); }}>Archive</button> : <button className="danger-button" type="button" onClick={() => { setConfirm({ kind: "delete", source }); setConfirmation(""); }}>Delete</button>}</div></article>)}</div></section>
    {confirm ? <div className="confirmation-backdrop" role="presentation"><section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title"><p className="eyebrow">Confirmation required</p><h2 id="confirmation-title">{confirm.kind === "archive" ? "Archive source?" : "Delete archived source?"}</h2><p>{confirm.kind === "archive" ? "Archiving stops this repository from appearing in search results. Its registry record remains recoverable." : "Deletion permanently removes the registry record and indexed chunks. The GitHub repository is not changed."}</p><label>Type <strong>{confirm.source.fullName}</strong><input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div><button type="button" onClick={() => { setConfirm(null); setConfirmation(""); }}>Cancel</button><button className={confirm.kind === "delete" ? "danger-button" : undefined} type="button" disabled={confirmation !== confirm.source.fullName} onClick={() => void completeConfirmation()}>{confirm.kind === "archive" ? "Archive source" : "Delete source"}</button></div></section></div> : null}
  </>;
}
