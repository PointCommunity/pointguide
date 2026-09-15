"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import type { TrainingSessionRecord, TrainingTurn } from "@/lib/training/types";
import type { EvidenceItem, AnswerClaim } from "@/lib/agent/schema";
import type { AcceptedGuidance } from "@/lib/training/knowledge";

interface TrainingAnswer { id?: string; directAnswer?: string; steps?: string[]; safetyAndAssumptions?: string[]; confidence?: string; evidence?: EvidenceItem[]; claims?: AnswerClaim[]; guidance?: AcceptedGuidance[] }

export function TrainingWorkspace({ resumeSessionId }: { resumeSessionId?: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceRepositoryRecord[]>([]);
  const [session, setSession] = useState<TrainingSessionRecord | null>(null);
  const [turns, setTurns] = useState<TrainingTurn[]>([]);
  const [question, setQuestion] = useState(""); const [targetRepository, setTargetRepository] = useState(""); const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState("Loading training workspace…"); const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/knowledge/sources", { cache: "no-store" }), resumeSessionId ? fetch(`/api/training/sessions/${resumeSessionId}`, { cache: "no-store" }) : Promise.resolve(null)])
      .then(async ([sourcesResponse, sessionResponse]) => {
        if (!sourcesResponse.ok || (sessionResponse && !sessionResponse.ok)) throw new Error();
        const sourcePayload = await sourcesResponse.json() as { sources: SourceRepositoryRecord[] };
        const sessionPayload = sessionResponse ? await sessionResponse.json() as { session: TrainingSessionRecord; turns: TrainingTurn[] } : null;
        if (!active) return;
        const activeSources = sourcePayload.sources.filter(source => source.status === "ACTIVE");
        setSources(activeSources); setTargetRepository(activeSources[0]?.fullName ?? "");
        setSession(sessionPayload?.session ?? null); setTurns(sessionPayload?.turns ?? []); setStatus("");
      }).catch(() => { if (active) setStatus(resumeSessionId ? "Training session could not be loaded." : "Training workspace could not be loaded."); });
    return () => { active = false; };
  }, [resumeSessionId]);

  const pollingSessionId = session?.id; const pollingState = session?.state;
  useEffect(() => {
    if (!pollingSessionId || !pollingState || !["PUBLISHING", "ACTIVATING"].includes(pollingState)) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/training/sessions/${pollingSessionId}`, { cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ session: TrainingSessionRecord; turns: TrainingTurn[] }> : null).then(payload => { if (payload) { setSession(payload.session); setTurns(payload.turns); setStatus(""); } else setStatus("Publication status unavailable. Reload to check the accepted answer."); }).catch(() => setStatus("Publication status unavailable. Reload to check the accepted answer."));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [pollingSessionId, pollingState]);

  async function start(event: FormEvent) {
    event.preventDefault(); setBusy(true); setStatus("PointGuide is checking sources and preparing the first answer…");
    try {
      const response = await fetch("/api/training/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, targetRepository }) });
      const payload = await response.json() as { session?: TrainingSessionRecord; error?: { message?: string } };
      if (!response.ok || !payload.session) { setStatus(payload.error?.message ?? "Training session could not be started."); return; }
      router.replace(`/training/sessions/${payload.session.id}`);
    } catch { setStatus("Training session could not be started. Try again."); }
    finally { setBusy(false); }
  }

  async function action(body: Readonly<Record<string, unknown>>) {
    if (!session) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/training/sessions/${session.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { session?: TrainingSessionRecord; turns?: TrainingTurn[]; error?: { message?: string } };
      if (!response.ok || !payload.session) { setStatus(payload.error?.message ?? "Training action failed. Reload or retry."); return; }
      setSession(payload.session); if (payload.turns) setTurns(payload.turns); setFeedback(""); setStatus(payload.error?.message ?? "");
    } catch { setStatus("Training action failed. Reload or retry."); }
    finally { setBusy(false); }
  }

  async function revise(event: FormEvent) {
    event.preventDefault(); const answer = session?.currentAnswer as TrainingAnswer | null;
    if (!session || !answer?.id) return;
    setStatus("Revising answer with your feedback and session history…");
    await action({ action: "FEEDBACK", answerId: answer.id, expectedVersion: session.version, feedback });
  }

  const answer = session?.currentAnswer as TrainingAnswer | null;
  const activeSource = sources.some(source => source.fullName === session?.targetRepository);
  const canCoach = session?.state === "ACTIVE" && Boolean(answer?.id);
  const needsRetry = session?.state === "REVISING" || (session?.state === "ACTIVE" && !answer);
  const pendingFeedback = session?.state === "REVISING" ? [...turns].reverse().find(turn => turn.kind === "FEEDBACK") : null;
  const earlierTurns = turns.filter(turn => turn.kind !== "ANSWER" || (turn.content.answer as TrainingAnswer | undefined)?.id !== answer?.id);

  return <>
    <section className="welcome-panel compact-welcome"><p className="eyebrow">Guided improvement</p><h1>Training</h1><p>Ask a question. Give feedback until the answer is ready. Accept that exact answer for the selected repository.</p><Link className="subpage-link" href="/training/sessions">Training Sessions <span aria-hidden="true">→</span></Link></section>
    {status && !needsRetry ? <p className="training-status" role="status">{status}</p> : null}
    {!session ? <form className="training-session-card compact-card" onSubmit={start}>
      <h2>Start a training session</h2>
      <label>Question<textarea required maxLength={8000} value={question} onChange={event => setQuestion(event.target.value)} /></label>
      <label>Repository for accepted learning<select required value={targetRepository} onChange={event => setTargetRepository(event.target.value)}>{sources.map(source => <option key={source.id} value={source.fullName}>{source.fullName}</option>)}</select></label>
      <button type="submit" disabled={busy || !targetRepository || !question.trim()}>{busy ? "Preparing answer…" : "Start training"}</button>
    </form> : <section className="training-session" aria-label="Training session">
      <header className="training-session-header"><div><p className="eyebrow">Original question</p><h2>{session.originalQuestion}</h2><p>Accepted knowledge repository: {session.targetRepository}</p></div><span>{session.state === "REVISING" ? "Revision interrupted" : canCoach ? "Answer ready" : session.state === "ACTIVE" ? "Answer interrupted" : session.state.replaceAll("_", " ")}</span></header>
      {needsRetry ? <section className="training-status" role="alert"><p>{status || (session.state === "REVISING" ? "The revision did not complete. Your feedback is saved." : "The first answer did not complete. Your question is saved.")}</p>{pendingFeedback ? <p><strong>Feedback waiting for revision:</strong> {String(pendingFeedback.content.feedback ?? "")}</p> : null}<button type="button" disabled={busy} onClick={() => { setStatus(session.state === "REVISING" ? "Retrying revision with your saved feedback…" : "Retrying the first answer…"); void action({ action: "RETRY", expectedVersion: session.version }); }}>{session.state === "REVISING" ? "Retry revision" : "Retry first answer"}</button></section> : null}
      {earlierTurns.length ? <section className="training-history" aria-label="Conversation so far"><h3>Conversation so far</h3><ol>{earlierTurns.map(turn => <li key={turn.ordinal}>{turn.kind === "FEEDBACK" ? <><strong>Your feedback:</strong> {String(turn.content.feedback ?? "")}</> : turn.kind === "ANSWER" ? <><strong>Earlier PointGuide answer:</strong> {String((turn.content.answer as TrainingAnswer | undefined)?.directAnswer ?? "")}</> : <><strong>{turn.kind}:</strong> Earlier session record</>}</li>)}</ol></section> : null}
      {answer ? <article className="training-answer compact-card"><header><strong>{session.state === "REVISING" ? "Previous PointGuide response" : "PointGuide response"}</strong>{answer.confidence ? <span className="confidence">{answer.confidence}</span> : null}</header>
        <p className="direct-answer">{answer.directAnswer}</p>
        {answer.safetyAndAssumptions?.length ? <aside className="safety-note"><strong>Before changing anything</strong><ul>{answer.safetyAndAssumptions.map(item => <li key={item}>{item}</li>)}</ul></aside> : null}
        {answer.steps?.length ? <ol>{answer.steps.map(step => <li key={step}>{step}</li>)}</ol> : null}
        <details className="evidence-section evidence-accordion"><summary><strong>Sources</strong><span>{(answer.evidence?.length ?? 0) + (answer.guidance?.length ?? 0)} sources</span></summary><div className="evidence-list">
          {answer.evidence?.map(item => <div key={item.id}><strong>{item.title}</strong><p>{item.excerpt}</p><small>{item.locator ?? item.path ?? item.url} · {item.authority}</small></div>)}
          {answer.guidance?.map(item => <article key={item.id}><strong>Accepted training guidance</strong><p>{item.directAnswer}</p><p>Trainer acceptance guides the answer; supporting source evidence remains separate.</p><a href={`https://github.com/${item.repository}/blob/${item.indexedCommit}/${item.path}`} target="_blank" rel="noopener noreferrer">Repository artifact and revision</a></article>)}
          {answer.claims?.length ? <section aria-label="Claim check"><h3>Claim check</h3><ul>{answer.claims.map(claim => <li key={claim.id}>{claim.status}: {claim.text} ({claim.evidenceIds.join(", ") || "no supporting source"})</li>)}</ul></section> : null}
        </div></details>
      </article> : null}
      {canCoach ? <section className="training-feedback compact-card"><button type="button" disabled={busy || !activeSource} onClick={() => void action({ action: "ACCEPT_ANSWER", answerId: answer?.id, expectedVersion: session.version })}>Accept answer</button>
        <form onSubmit={revise}><label>Feedback for this answer<textarea required minLength={3} maxLength={4000} value={feedback} onChange={event => setFeedback(event.target.value)} /></label><button type="submit" className="secondary-button" disabled={busy || feedback.trim().length < 3}>Revise answer</button></form>
      </section> : null}
      {["PUBLISHING", "ACTIVATING", "ACTIVE_KNOWLEDGE", "FAILED"].includes(session.state) ? <div className="training-status" role="status"><p>{session.state === "ACTIVE_KNOWLEDGE" ? `Accepted knowledge is active at ${session.indexedCommit}.` : session.state === "FAILED" ? session.publicationError ?? "Publication or activation failed." : session.state === "ACTIVATING" ? "Published; validating and activating repository knowledge." : "Publishing accepted answer…"}</p>{session.state === "FAILED" ? <button type="button" disabled={busy || !activeSource} onClick={() => void action({ action: "RETRY_PUBLICATION" })}>Retry publication</button> : null}</div> : null}
      {["REPORT_READY", "REPORT_ACCEPTED", "PROPOSED"].includes(session.state) ? <details className="starter-accordion"><summary>Earlier learning-report workflow</summary><p>{session.currentReport?.summary ?? "Historical repository proposal: " + (session.proposalId ?? "none")}</p></details> : null}
    </section>}
  </>;
}
