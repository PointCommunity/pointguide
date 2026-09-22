"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { SourceRepositoryRecord } from "@/lib/sources/types";
import type { TrainingSessionRecord, TrainingTurn } from "@/lib/training/types";
import type { EvidenceItem, AnswerClaim } from "@/lib/agent/schema";
import type { AcceptedGuidance } from "@/lib/training/knowledge";
import { trainingRetryLabel, trainingStateLabel, trainingStateSummary } from "@/lib/training/presentation";
import { repositoryEvidenceUrl } from "@/lib/evidence/provenance-link";

interface TrainingAnswer { id?: string; directAnswer?: string; steps?: string[]; safetyAndAssumptions?: string[]; confidence?: string; clarifyingQuestion?: string | null; evidence?: EvidenceItem[]; claims?: AnswerClaim[]; guidance?: AcceptedGuidance[] }
const sourceAreaLabel = (repository: string) => repository === "PointCommunity/pointaudio" ? "Audio equipment and recording" : repository === "PointCommunity/pointplanning" ? "Planning Center" : repository.split("/").at(-1) ?? repository;

export function TrainingWorkspace({ resumeSessionId }: { resumeSessionId?: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceRepositoryRecord[]>([]);
  const [session, setSession] = useState<TrainingSessionRecord | null>(null);
  const [turns, setTurns] = useState<TrainingTurn[]>([]);
  const [question, setQuestion] = useState(""); const [targetRepository, setTargetRepository] = useState(""); const [feedback, setFeedback] = useState(""); const [clarification, setClarification] = useState("");
  const [needsArea, setNeedsArea] = useState(false);
  const [status, setStatus] = useState("Loading training workspace…"); const [busy, setBusy] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState<"FEEDBACK" | "CLARIFY" | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/knowledge/sources", { cache: "no-store" }), resumeSessionId ? fetch(`/api/training/sessions/${resumeSessionId}`, { cache: "no-store" }) : Promise.resolve(null)])
      .then(async ([sourcesResponse, sessionResponse]) => {
        if (!sourcesResponse.ok || (sessionResponse && !sessionResponse.ok)) throw new Error();
        const sourcePayload = await sourcesResponse.json() as { sources: SourceRepositoryRecord[] };
        const sessionPayload = sessionResponse ? await sessionResponse.json() as { session: TrainingSessionRecord; turns: TrainingTurn[] } : null;
        if (!active) return;
        const activeSources = sourcePayload.sources.filter(source => source.status === "ACTIVE");
        setSources(activeSources); setTargetRepository(activeSources.length === 1 ? activeSources[0].fullName : "");
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
      const response = await fetch("/api/training/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, ...(targetRepository ? { targetRepository } : {}) }) });
      const payload = await response.json() as { session?: TrainingSessionRecord; error?: { code?: string; message?: string } };
      if (payload.error?.code === "SOURCE_AREA_REQUIRED") { setNeedsArea(true); setStatus(payload.error.message ?? "Choose the subject area for this question."); return; }
      if (!response.ok || !payload.session) { setStatus(payload.error?.message ?? "Training session could not be started."); return; }
      router.replace(`/training/sessions/${payload.session.id}`);
    } catch { setStatus("Training session could not be started. Try again."); }
    finally { setBusy(false); }
  }

  async function action(body: Readonly<Record<string, unknown>>) {
    if (!session) return;
    const submittingFeedback = body.action === "FEEDBACK" || body.action === "CLARIFY";
    setFeedbackAction(submittingFeedback ? body.action as "FEEDBACK" | "CLARIFY" : null);
    setBusy(true);
    try {
      const response = await fetch(`/api/training/sessions/${session.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { session?: TrainingSessionRecord; turns?: TrainingTurn[]; error?: { message?: string } };
      if (!response.ok || !payload.session) { setStatus(payload.error?.message ?? "Training action failed. Reload or retry."); return; }
      setSession(payload.session); if (payload.turns) setTurns(payload.turns); setFeedback(""); setClarification(""); setStatus(payload.error?.message ?? "");
      if (!payload.error) setFeedbackAction(null);
    } catch { setStatus(submittingFeedback ? "Response unavailable. Feedback may have been saved. Reload this session to check before submitting again." : "Training action failed. Reload or retry."); }
    finally { setBusy(false); }
  }

  async function revise(event: FormEvent) {
    event.preventDefault(); const answer = session?.currentAnswer as TrainingAnswer | null;
    if (!session || !answer?.id) return;
    setStatus("Submitting feedback and waiting for an updated answer. This can take a moment.");
    await action({ action: "FEEDBACK", answerId: answer.id, expectedVersion: session.version, feedback });
  }

  async function clarify(event: FormEvent) {
    event.preventDefault(); const answer = session?.currentAnswer as TrainingAnswer | null;
    if (!session || !answer?.id || !answer.clarifyingQuestion) return;
    setStatus("Submitting feedback and waiting for an updated answer. This can take a moment.");
    await action({ action: "CLARIFY", answerId: answer.id, expectedVersion: session.version, response: clarification });
  }

  const answer = session?.currentAnswer as TrainingAnswer | null;
  const activeSource = sources.some(source => source.fullName === session?.targetRepository);
  const canCoach = session?.state === "ACTIVE" && Boolean(answer?.id);
  const needsRetry = session?.state === "REVISING" || (session?.state === "ACTIVE" && !answer);
  const pendingFeedback = session?.state === "REVISING" ? [...turns].reverse().find(turn => turn.kind === "FEEDBACK") : null;
  const pendingClarification = session?.state === "REVISING" ? [...turns].reverse().find(turn => turn.kind === "CLARIFICATION") : null;
  const updated = turns.some(turn => turn.kind === "FEEDBACK" || turn.kind === "CLARIFICATION");
  const earlierTurns = turns.filter(turn => turn.kind !== "ANSWER" || (turn.content.answer as TrainingAnswer | undefined)?.id !== answer?.id);
  const feedbackStatus = status && feedbackAction ? <p className={`training-inline-status${busy ? " training-progress" : ""}`} role={busy ? "status" : "alert"}>{busy ? <span aria-hidden="true" /> : null}{status}</p> : null;
  const stage = !session ? 1 : session.state === "ACTIVE_KNOWLEDGE" ? 4 : ["PUBLISHING", "ACTIVATING", "FAILED"].includes(session.state) ? 3 : 2;

  return <>
    <section className="welcome-panel compact-welcome"><p className="eyebrow">Guided improvement</p><h1>Training</h1>{!session ? <p>Ask a question. Give feedback until the answer is ready. Accept that exact answer for future answers.</p> : null}<Link className="subpage-link" href="/training/sessions">Training Sessions <span aria-hidden="true">→</span></Link></section>
    <nav className="training-steps" aria-label="Training steps"><ol>{["Ask", "Improve", "Publish"].map((label, index) => <li key={label} className={stage > index + 1 ? "complete" : ""}><span aria-current={stage === index + 1 ? "step" : undefined}><small>{index + 1}</small>{label}</span></li>)}</ol></nav>
    {status && !session ? <p className={`training-status${busy ? " training-progress" : ""}`} role="status">{busy ? <span aria-hidden="true" /> : null}{status}</p> : null}
    {!session ? <form className="training-session-card compact-card" onSubmit={start}>
      <h2>Start a training session</h2>
      <label>Question<textarea required maxLength={8000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask the question you want PointGuide to answer" /></label>
      {needsArea ? <label>Which area is this about?<select required value={targetRepository} onChange={event => setTargetRepository(event.target.value)}><option value="">Choose an area</option>{sources.map(source => <option key={source.id} value={source.fullName}>{sourceAreaLabel(source.fullName)}</option>)}</select><span className="field-hint">This helps keep accepted guidance with the right knowledge.</span></label> : null}
      <button type="submit" disabled={busy || !question.trim() || (needsArea && !targetRepository) || !sources.length}>{busy ? "Preparing answer…" : "Start training"}</button>
    </form> : <section className="training-session" aria-label="Training session">
      <header className="training-session-header"><div><p className="eyebrow">Original question</p><h2>{session.originalQuestion}</h2><p>Area: {sourceAreaLabel(session.targetRepository)}</p></div><span>{session.state === "ACTIVE" && answer ? "Draft saved" : trainingStateLabel(session)}</span></header>
      {earlierTurns.length ? <section className="training-history" aria-label="Conversation so far"><h3>Conversation so far</h3><ol>{earlierTurns.map(turn => {
        if (turn.kind === "FEEDBACK") return <li key={turn.ordinal}><strong>Your feedback:</strong> {String(turn.content.feedback ?? "")}</li>;
        if (turn.kind === "CLARIFICATION") return <li key={turn.ordinal}><strong>Your clarification:</strong> {String(turn.content.response ?? "")} <small>In response to: {String(turn.content.question ?? "")}</small></li>;
        if (turn.kind !== "ANSWER") return <li key={turn.ordinal}><strong>{turn.kind}:</strong> Earlier session record</li>;
        const earlier = turn.content.answer as TrainingAnswer | undefined;
        return <li className="training-history-answer" key={turn.ordinal}><details><summary>Earlier PointGuide answer</summary><div><p>{earlier?.directAnswer}</p>{earlier?.safetyAndAssumptions?.length ? <><small>Safety and assumptions</small><ul>{earlier.safetyAndAssumptions.map(item => <li key={item}>{item}</li>)}</ul></> : null}{earlier?.steps?.length ? <><small>Steps</small><ol>{earlier.steps.map(item => <li key={item}>{item}</li>)}</ol></> : null}</div></details></li>;
      })}</ol></section> : null}
      {answer ? <article className="training-answer compact-card" aria-label={session.state === "REVISING" ? "Previous answer" : updated ? "Updated answer" : "PointGuide response"}><header><h3>{session.state === "REVISING" ? "Previous answer" : updated ? "Updated answer" : "PointGuide response"}</h3>{answer.confidence ? <span className="confidence">{answer.confidence}</span> : null}</header>
        <p className="direct-answer">{answer.directAnswer}</p>
        {answer.safetyAndAssumptions?.length ? <aside className="safety-note"><strong>Before changing anything</strong><ul>{answer.safetyAndAssumptions.map(item => <li key={item}>{item}</li>)}</ul></aside> : null}
        {answer.steps?.length ? <ol>{answer.steps.map(step => <li key={step}>{step}</li>)}</ol> : null}
        <details className="evidence-section evidence-accordion"><summary><strong>Sources</strong><span>{(answer.evidence?.length ?? 0) + (answer.guidance?.filter(item => !answer.evidence?.some(evidence => evidence.id === item.id)).length ?? 0)} sources</span></summary><div className="evidence-list">
          {answer.evidence?.map(item => <div key={item.id}><strong>{item.kind === "ACCEPTED_TRAINING" ? "Accepted training · " : "Supplemental source · "}{item.title}</strong><p>{item.excerpt}</p><small>{item.locator ?? item.path ?? item.url} · {item.authority}</small>{repositoryEvidenceUrl(item) ? <p><a href={repositoryEvidenceUrl(item)!} target="_blank" rel="noopener noreferrer">Exact repository artifact and revision</a></p> : null}</div>)}
          {answer.guidance?.filter(item => !answer.evidence?.some(evidence => evidence.id === item.id)).map(item => <article key={item.id}><strong>Historical accepted guidance</strong><p>{item.directAnswer}</p><p>This earlier response was saved as guidance; its cited source status is shown separately.</p><a href={`https://github.com/${item.repository}/blob/${item.indexedCommit}/${item.path}`} target="_blank" rel="noopener noreferrer">Repository artifact and revision</a></article>)}
          {answer.claims?.length ? <section aria-label="Claim check"><h3>Claim check</h3><ul>{answer.claims.map(claim => <li key={claim.id}>{claim.status}: {claim.text} ({claim.evidenceIds.join(", ") || "no supporting source"})</li>)}</ul></section> : null}
        </div></details>
      </article> : null}
      {canCoach && answer?.clarifyingQuestion ? <section className="training-clarification compact-card" aria-labelledby="clarifying-question-heading"><h3 id="clarifying-question-heading">Clarifying question</h3><p>{answer.clarifyingQuestion}</p><form onSubmit={clarify} aria-busy={busy && feedbackAction === "CLARIFY"}><label>Your response<input required maxLength={1000} value={clarification} onChange={event => setClarification(event.target.value)} /></label><button type="submit" disabled={busy || !clarification.trim()}>{busy && feedbackAction === "CLARIFY" ? "Submitting feedback…" : "Submit Feedback"}</button></form>{feedbackAction === "CLARIFY" ? feedbackStatus : null}<p className="field-hint">The answer above is saved, but this essential gap must be resolved before acceptance. Your response is not published as part of the accepted answer.</p></section> : null}
      {needsRetry ? <section className="training-status" role="alert"><p>{status || (session.state === "REVISING" ? "The revision did not complete. Your feedback is saved." : "The first answer did not complete. Your question is saved.")}</p>{pendingFeedback ? <p><strong>Feedback waiting for revision:</strong> {String(pendingFeedback.content.feedback ?? "")}</p> : null}{pendingClarification ? <p><strong>Clarification waiting for revision:</strong> {String(pendingClarification.content.response ?? "")}</p> : null}<button type="button" disabled={busy} onClick={() => { setStatus(session.state === "REVISING" ? "Retrying revision with your saved feedback…" : "Retrying the first answer…"); void action({ action: "RETRY", expectedVersion: session.version }); }}>{session.state === "REVISING" ? "Retry revision" : "Retry first answer"}</button></section> : null}
      {canCoach ? <section className="training-feedback compact-card"><div><h3>Improve this answer</h3><p className="training-guidance">Describe what should change. PointGuide will use this entire session, including earlier corrections and constraints.</p></div>
        <form onSubmit={revise} aria-busy={busy && feedbackAction === "FEEDBACK"}><label>Feedback for this answer<textarea required minLength={3} maxLength={4000} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="Example: Use three short numbered checks and explain what I should see after each one." /></label><button type="submit" className="secondary-button" disabled={busy || feedback.trim().length < 3}>{busy && feedbackAction === "FEEDBACK" ? "Submitting feedback…" : "Submit Feedback"}</button></form>
        {feedbackAction === "FEEDBACK" ? feedbackStatus : null}
      </section> : null}
      {canCoach ? <section className="training-accept compact-card"><h3>Ready to publish?</h3><p>Accepting makes this exact answer available to future answers in {sourceAreaLabel(session.targetRepository)}. If anything is incorrect, submit feedback first.</p>{answer?.clarifyingQuestion ? <p className="field-hint">Answer the essential clarifying question above before accepting this response.</p> : null}<button type="button" disabled={busy || !activeSource || Boolean(answer?.clarifyingQuestion)} onClick={() => { setStatus("Accepting this exact answer and preparing it for publishing…"); void action({ action: "ACCEPT_ANSWER", answerId: answer?.id, expectedVersion: session.version }); }}>Accept and publish</button>{status && !feedbackAction ? <p className={`training-inline-status${busy ? " training-progress" : ""}`} role={busy ? "status" : "alert"}>{busy ? <span aria-hidden="true" /> : null}{status}</p> : null}</section> : null}
      {["PUBLISHING", "ACTIVATING", "ACTIVE_KNOWLEDGE", "FAILED"].includes(session.state) ? <div className="training-status" role={session.state === "FAILED" ? "alert" : "status"}><p className={!status && (session.state === "PUBLISHING" || session.state === "ACTIVATING") ? "training-progress" : ""}>{!status && (session.state === "PUBLISHING" || session.state === "ACTIVATING") ? <span aria-hidden="true" /> : null}<strong>{trainingStateLabel(session)}.</strong> {trainingStateSummary(session)}</p>{session.state === "PUBLISHING" || session.state === "ACTIVATING" ? <p>Progress is saved; you can safely leave this page and return from Training Sessions.</p> : null}{session.state === "FAILED" && session.publicationError ? <p>{session.publicationError}</p> : null}{status ? <p>{status}</p> : null}{session.state === "ACTIVE_KNOWLEDGE" && session.indexedCommit && session.acceptedPath ? <p><a href={`https://github.com/${session.targetRepository}/blob/${session.indexedCommit}/${session.acceptedPath}`} target="_blank" rel="noopener noreferrer">Open active repository artifact</a><br /><small>Indexed revision: {session.indexedCommit}</small></p> : null}{session.state === "FAILED" ? <button type="button" disabled={busy || !activeSource} onClick={() => { setStatus(session.publishedCommit ? "Retrying activation without republishing…" : "Retrying publication of the saved answer…"); void action({ action: "RETRY_PUBLICATION" }); }}>{trainingRetryLabel(session)}</button> : null}</div> : null}
      {["REPORT_READY", "REPORT_ACCEPTED", "PROPOSED"].includes(session.state) ? <details className="starter-accordion"><summary>Earlier learning-report workflow</summary><p>{session.currentReport?.summary ?? "Historical repository proposal: " + (session.proposalId ?? "none")}</p></details> : null}
    </section>}
  </>;
}
