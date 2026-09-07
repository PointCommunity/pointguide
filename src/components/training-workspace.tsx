"use client";
import { useEffect, useState, type FormEvent } from "react";

interface Feedback { id: string; rating: string; reason?: string | null; comment?: string | null; createdAt: string }
interface Proposal { id: string; targetPath: string; state: string; digest: string }

export function TrainingWorkspace() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [status, setStatus] = useState("Loading review queue…");
  const [path, setPath] = useState("research/pointguide/");
  const [rationale, setRationale] = useState("");
  const [content, setContent] = useState("");
  const [role, setRole] = useState("");

  async function refresh() {
    const response = await fetch("/api/training/review", { cache: "no-store" });
    if (!response.ok) { setStatus("This queue requires Trainer, Admin, or Owner access."); return; }
    const payload = await response.json() as { actor: { role: string }; feedback: Feedback[]; proposals: Proposal[] };
    setFeedback(payload.feedback); setProposals(payload.proposals); setRole(payload.actor.role); setStatus("");
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/training/review", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("restricted");
      return response.json() as Promise<{ actor: { role: string }; feedback: Feedback[]; proposals: Proposal[] }>;
    }).then((payload) => { if (active) { setFeedback(payload.feedback); setProposals(payload.proposals); setRole(payload.actor.role); setStatus(""); } })
      .catch(() => { if (active) setStatus("This queue requires Trainer, Admin, or Owner access."); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setStatus("Saving governed proposal…");
    const response = await fetch("/api/change-proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rationale, targetRepository: "PointCommunity/pointaudio", baseCommit: "0000000", targetPath: path, operation: "CREATE", proposedContent: content }) });
    if (!response.ok) { const payload = await response.json() as { error?: { message?: string } }; setStatus(payload.error?.message ?? "Proposal could not be saved."); return; }
    setRationale(""); setContent(""); setStatus("Draft saved for human review. No repository change was made."); await refresh();
  }
  async function transition(id: string, state: "IN_REVIEW" | "APPROVED") {
    setStatus("Updating proposal state…");
    const response = await fetch(`/api/change-proposals/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ state }) });
    setStatus(response.ok ? "Proposal state updated." : "That proposal transition was not allowed."); await refresh();
  }
  return <>
    <section className="welcome-panel compact-welcome"><p className="eyebrow">Governed learning</p><h1>Training review</h1><p>Turn feedback and verified findings into reviewable PointAudio changes. PointGuide never rewrites its sources automatically.</p></section>
    {status ? <p className="training-status" role="status">{status}</p> : null}
    <section className="training-grid" aria-label="Training queues">
      <article className="training-card"><header><h2>Feedback</h2><span>{feedback.length}</span></header>{feedback.length ? <ul>{feedback.map((item) => <li key={item.id}><strong>{item.rating.replace("_", " ")}</strong><span>{item.comment || item.reason || "No comment supplied"}</span><small>{new Date(item.createdAt).toLocaleString()}</small></li>)}</ul> : <p>No ratings are waiting for review.</p>}</article>
      <article className="training-card"><header><h2>Proposals</h2><span>{proposals.length}</span></header>{proposals.length ? <ul>{proposals.map((item) => <li key={item.id}><strong>{item.state}</strong><span>{item.targetPath}</span><small>{item.digest.slice(0, 12)}</small>{item.state === "DRAFT" ? <button type="button" onClick={() => void transition(item.id, "IN_REVIEW")}>Submit for review</button> : null}{item.state === "IN_REVIEW" && ["ADMIN", "OWNER"].includes(role) ? <button type="button" onClick={() => void transition(item.id, "APPROVED")}>Approve exact proposal</button> : null}</li>)}</ul> : <p>No repository proposals yet.</p>}</article>
    </section>
    <form className="proposal-form" onSubmit={submit}><p className="eyebrow">Human-reviewed change</p><h2>Create a draft proposal</h2><label>PointAudio target path<input required value={path} onChange={(event) => setPath(event.target.value)} placeholder="research/topic/finding.html" /></label><label>Why this belongs in the corpus<textarea required value={rationale} onChange={(event) => setRationale(event.target.value)} /></label><label>Exact proposed content<textarea required value={content} onChange={(event) => setContent(event.target.value)} /></label><button type="submit">Save draft proposal</button></form>
  </>;
}
