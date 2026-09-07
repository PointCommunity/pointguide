"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { AnswerClaim, EvidenceItem } from "@/lib/agent/schema";
import type { SessionTurn } from "@/lib/learning/store";

interface PointGuideAnswer {
  id: string;
  directAnswer: string;
  steps: string[];
  safetyAndAssumptions: string[];
  confidence: "CONFIRMED" | "SUPPORTED" | "TENTATIVE" | "UNKNOWN";
  claims: AnswerClaim[];
  evidence: EvidenceItem[];
  reviewStatus: "NOT_REQUESTED" | "PASSED";
}

interface DisplayTurn {
  key: string;
  question: string;
  answer: PointGuideAnswer | null;
  loading: boolean;
  error: string | null;
  deepResearch: boolean;
}

const starterPool = [
  { title: "Troubleshoot stage-box sync", detail: "DL16, DL32, AES50 and clocking", question: "What does a red AES50 sync light on the DL32 mean?" },
  { title: "Set up a monitor mix", detail: "M32 buses, sends and personal monitoring", question: "How do I set up a monitor mix on the M32?" },
  { title: "Prepare for a firmware update", detail: "Compatibility, backup and rollback checks", question: "How should I prepare for an M32 firmware update?" },
  { title: "Fix a projector problem", detail: "Signal path, source selection and safe checks", question: "What should I check when a ministry room projector has no picture?" },
  { title: "Restore a livestream feed", detail: "Video, audio and network evidence", question: "Help me troubleshoot a missing livestream feed." },
  { title: "Check a wireless microphone", detail: "Power, frequency, receiver and routing", question: "Why is a wireless microphone not reaching the sound system?" },
  { title: "Prepare a room for an event", detail: "A beginner-friendly technology checklist", question: "Give me a step-by-step technology checklist for preparing a room for an event." },
  { title: "Find the right procedure", detail: "Search all connected church technology sources", question: "Where can I find the approved setup procedure for this room?" },
  { title: "Report missing documentation", detail: "Capture facts without guessing", question: "How do I document a technology issue that PointGuide cannot answer yet?" },
] as const;

const minimumWorkingIndicatorMs = 800;

async function keepWorkingIndicatorVisible(startedAt: number) {
  const remaining = minimumWorkingIndicatorMs - (performance.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function rotatingStarters(seed: string | null) {
  let offset = 0;
  for (const character of seed ?? "") offset = (offset + character.charCodeAt(0)) % starterPool.length;
  return Array.from({ length: 3 }, (_, index) => starterPool[(offset + index) % starterPool.length]);
}

function EvidenceCard({ item, claims }: { item: EvidenceItem; claims: AnswerClaim[] }) {
  const supportedClaims = claims.filter((claim) => claim.evidenceIds.includes(item.id));
  const sourceLabel = item.kind === "REPOSITORY" ? "Repository" : item.kind === "PRIMARY_WEB" ? "Primary web" : "Web";
  return (
    <details className="evidence-card">
      <summary>
        <span className="source-badge">{sourceLabel}</span>
        <span><strong>{item.title}</strong><small>{item.locator ?? item.path ?? item.url}</small></span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="evidence-body">
        <blockquote>{item.excerpt}</blockquote>
        <dl>
          <div><dt>Authority</dt><dd>{item.authority}</dd></div>
          {item.versionOrDate ? <div><dt>Version / date</dt><dd>{item.versionOrDate}</dd></div> : null}
          <div><dt>Captured</dt><dd>{new Date(item.capturedAt).toLocaleDateString("en-US", { dateStyle: "long" })}</dd></div>
          <div><dt>Source</dt><dd><code>{item.path ?? item.url ?? item.sourceId}</code></dd></div>
        </dl>
        {supportedClaims.length ? <p className="supports"><strong>Supports:</strong> {supportedClaims.map((claim) => claim.text).join(" ")}</p> : null}
      </div>
    </details>
  );
}

function WorkingState({ deepResearch, phase }: { deepResearch: boolean; phase: number }) {
  const phases = deepResearch
    ? ["Reading your question", "Searching connected knowledge", "Checking supporting evidence", "Reviewing supported claims", "Preparing a clear response"]
    : ["Reading your question", "Searching connected knowledge", "Checking supporting evidence", "Preparing a clear response"];
  return (
    <div className="agent-working" role="status" aria-live="polite" aria-label="PointGuide is working">
      <span className="working-orbit" aria-hidden="true"><i /></span>
      <div><strong>PointGuide is working</strong><p key={phase}>{phases[phase % phases.length]}…</p></div>
    </div>
  );
}

function AnswerContent({ turn, feedback, onRate }: { turn: DisplayTurn; feedback: "helpful" | "not-helpful" | null; onRate(rating: "helpful" | "not-helpful"): void }) {
  const answer = turn.answer;
  if (!answer) return null;
  return (
    <div className="turn-answer">
      <header>
        <div><p className="eyebrow">PointGuide answer</p><h3>What the evidence supports</h3></div>
        <div className="answer-badges"><span className={`confidence ${answer.confidence.toLowerCase()}`}>{answer.confidence.toLocaleLowerCase()}</span>{answer.reviewStatus === "PASSED" ? <span className="confidence">reviewed</span> : null}</div>
      </header>
      <p className="direct-answer">{answer.directAnswer}</p>
      {answer.safetyAndAssumptions.length ? <aside className="safety-note"><strong>Before you change anything</strong><ul>{answer.safetyAndAssumptions.map((item) => <li key={item}>{item}</li>)}</ul></aside> : null}
      {answer.steps.length ? <section><h4>Next checks</h4><ol className="answer-steps">{answer.steps.map((step) => <li key={step}>{step}</li>)}</ol></section> : null}
      <section className="claim-ledger" aria-label="Claim check">
        <h4>Claim check</h4>
        <ul>{answer.claims.map((claim) => <li key={claim.id}><span aria-hidden="true">{claim.status === "SUPPORTED" ? "✓" : "?"}</span><span><strong>{claim.status === "SUPPORTED" ? "Supported" : "Unknown"}</strong>{claim.text}</span></li>)}</ul>
      </section>
      <details className="evidence-section evidence-accordion">
        <summary><span><span className="eyebrow">Trace the answer</span><strong>Evidence</strong></span><span>{answer.evidence.length} source{answer.evidence.length === 1 ? "" : "s"} <i aria-hidden="true">⌄</i></span></summary>
        <div className="evidence-list">{answer.evidence.length ? answer.evidence.map((item) => <EvidenceCard key={item.id} item={item} claims={answer.claims} />) : <p className="empty-evidence">No current source establishes this. The answer is intentionally marked Unknown.</p>}</div>
      </details>
      <footer className="feedback-bar">
        <div><strong>Was this useful?</strong><small>Your rating improves retrieval; it does not rewrite facts.</small></div>
        <div role="group" aria-label="Rate this answer">
          <button className={feedback === "helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "helpful"} onClick={() => onRate("helpful")}>Helpful</button>
          <button className={feedback === "not-helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "not-helpful"} onClick={() => onRate("not-helpful")}>Not helpful</button>
        </div>
        {feedback ? <p className="feedback-status" role="status">Rating captured. Trainers can review this signal; it never rewrites source facts automatically.</p> : null}
      </footer>
    </div>
  );
}

export function AskWorkspace({ resumeConversationId }: { resumeConversationId?: string }) {
  const statusId = useId();
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<"initializing" | "idle" | "loading" | "error">("initializing");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Record<string, "helpful" | "not-helpful">>({});
  const [conversationId, setConversationId] = useState<string | null>(resumeConversationId ?? null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [turnNumber, setTurnNumber] = useState(0);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let active = true;
    const operation = resumeConversationId
      ? fetch(`/api/conversations/${resumeConversationId}`, { headers: { accept: "application/json" }, cache: "no-store" })
      : fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "PointGuide support" }) });
    void operation.then(async (response) => {
      if (!response.ok) throw new Error(resumeConversationId ? "Session unavailable" : "Could not start a session");
      return response.json() as Promise<{ conversation: { id: string; title: string }; turns?: SessionTurn[]; reviewEnabled: boolean; usage: { turnNumber: number } }>;
    }).then((payload) => {
      if (!active) return;
      setConversationId(payload.conversation.id);
      setSessionTitle(payload.conversation.title);
      setReviewEnabled(payload.reviewEnabled);
      setTurnNumber(payload.usage.turnNumber);
      setTurns((payload.turns ?? []).map((turn) => ({ key: turn.answer.id, question: turn.question, answer: turn.answer as PointGuideAnswer, loading: false, error: null, deepResearch: turn.answer.reviewStatus === "PASSED" })));
      setStatus("idle");
    }).catch(() => { if (active) { setStatus("error"); setError(resumeConversationId ? "PointGuide could not open this support session." : "PointGuide could not start a support session."); } });
    return () => { active = false; };
  }, [resumeConversationId]);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setInterval(() => setPhase((value) => value + 1), 1_600);
    return () => window.clearInterval(timer);
  }, [status]);

  const starters = useMemo(() => rotatingStarters(conversationId), [conversationId]);

  async function ask(nextQuestion: string) {
    const value = nextQuestion.trim();
    if (!value || status === "loading" || !conversationId || turnNumber >= 6) return;
    const key = crypto.randomUUID();
    const startedAt = performance.now();
    const selectedDeepResearch = deepResearch;
    const firstTurn = turnNumber === 0;
    setPhase(0);
    setQuestion("");
    setStatus("loading");
    setError("");
    setTurns((current) => [{ key, question: value, answer: null, loading: true, error: null, deepResearch: selectedDeepResearch }, ...current]);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: value, deepResearch: selectedDeepResearch }) });
      if (!response.ok || !response.body) throw new Error("PointGuide could not answer that question.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: PointGuideAnswer | null = null;
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const item = JSON.parse(line) as { type: string; data: { message?: string; answer?: PointGuideAnswer; usage?: { turnNumber: number } } };
          if (item.type === "error") throw new Error(item.data.message ?? "PointGuide could not verify an answer.");
          if (item.type === "answer" && item.data.answer) { completed = item.data.answer; if (item.data.usage) setTurnNumber(item.data.usage.turnNumber); }
        }
        if (chunk.done) break;
      }
      if (!completed) throw new Error("PointGuide did not return an answer.");
      await keepWorkingIndicatorVisible(startedAt);
      const ready = completed;
      setTurns((current) => current.map((turn) => turn.key === key ? { ...turn, answer: ready, loading: false } : turn));
      if (firstTurn) setSessionTitle(value.length <= 72 ? value : `${value.slice(0, 69)}…`);
      setStatus("idle");
    } catch (caught) {
      await keepWorkingIndicatorVisible(startedAt);
      const message = caught instanceof Error ? caught.message : "PointGuide could not answer that question.";
      setTurns((current) => current.map((turn) => turn.key === key ? { ...turn, loading: false, error: message } : turn));
      setStatus("error");
      setError(message);
    }
  }

  async function rate(turn: DisplayTurn, rating: "helpful" | "not-helpful") {
    if (!turn.answer) return;
    const response = await fetch(`/api/answers/${turn.answer.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: rating === "helpful" ? "HELPFUL" : "NOT_HELPFUL", question: turn.question, evidenceIds: turn.answer.evidence.map((item) => item.id) }) });
    if (response.ok) setFeedback((current) => ({ ...current, [turn.answer!.id]: rating })); else setError("PointGuide could not save that rating.");
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void ask(question); }
  const completedTurns = turns.filter((turn) => turn.answer);
  const remaining = Math.max(0, 6 - turnNumber);

  return (
    <>
      <section className="welcome-panel" aria-labelledby="page-title">
        <p className="eyebrow">Evidence before assumption</p>
        <h1 id="page-title">{resumeConversationId ? "Continue this session" : "What can I help you solve?"}</h1>
        <p>{resumeConversationId ? sessionTitle : "Ask for help with Point Community Church technology. PointGuide checks connected source repositories, shows its evidence, and keeps unknowns visible."}</p>
      </section>

      {resumeConversationId ? <div className="session-toolbar"><Link href="/sessions">← All sessions</Link>{completedTurns.length && conversationId ? <a href={`/api/conversations/${conversationId}/pdf`} download>Download PDF</a> : null}</div> : null}

      <form className="composer-shell" onSubmit={submit} aria-describedby={statusId}>
        <label htmlFor="question">Your question</label>
        <textarea id="question" name="question" rows={4} maxLength={8_000} required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={turnNumber ? "Ask a follow-up question" : "What technology issue can PointGuide help you work through?"} disabled={status === "initializing" || turnNumber >= 6} />
        <div className="composer-actions">
          <div><p><span className="status-dot" aria-hidden="true" /> Connected church sources first</p>{reviewEnabled ? <label className="deep-research-toggle"><input type="checkbox" checked={deepResearch} onChange={(event) => setDeepResearch(event.target.checked)} /> Deep research</label> : null}</div>
          <button type="submit" disabled={status === "loading" || status === "initializing" || !question.trim() || !conversationId || turnNumber >= 6}>{status === "loading" ? "PointGuide is working…" : turnNumber >= 6 ? "Session complete" : turnNumber ? "Ask follow-up" : "Ask PointGuide"} <span aria-hidden="true">↗</span></button>
        </div>
        <p className="turn-counter">{turnNumber === 0 ? "Initial question + 5 follow-ups available" : remaining ? `${remaining} follow-up${remaining === 1 ? "" : "s"} remaining in this session` : "All 5 follow-ups used · start a new session to ask more"}</p>
        <p id={statusId} className="sr-only" aria-live="polite">{status === "loading" ? "PointGuide is working on your question." : status === "error" ? error : completedTurns.length ? "Answer ready." : ""}</p>
      </form>

      {turns.length ? <section className="conversation-thread" aria-label="Session questions and answers">
        <div className="thread-heading"><div><p className="eyebrow">Latest first</p><h2>Session</h2></div>{completedTurns.length && conversationId ? <a href={`/api/conversations/${conversationId}/pdf`} download>Download PDF</a> : null}</div>
        {turns.map((turn) => <article className="conversation-turn" key={turn.key}>
          <header className="point-question"><p className="eyebrow">Point Question</p><h2>{turn.question}</h2></header>
          {turn.loading ? <WorkingState deepResearch={turn.deepResearch} phase={phase} /> : null}
          {turn.error ? <div className="turn-error" role="alert"><strong>PointGuide could not complete this answer.</strong><p>{turn.error}</p></div> : null}
          <AnswerContent turn={turn} feedback={turn.answer ? feedback[turn.answer.id] ?? null : null} onRate={(rating) => void rate(turn, rating)} />
        </article>)}
      </section> : status === "error" ? <section className="error-panel" role="alert"><strong>We could not open PointGuide.</strong><p>{error}</p></section> : (
        <>
          <details className="starter-section starter-accordion"><summary><span><span className="eyebrow">Need an idea?</span><strong id="starters-title">Suggested tasks</strong></span><span aria-hidden="true">⌄</span></summary><div className="starter-list" aria-labelledby="starters-title">{starters.map((starter, index) => <button key={starter.title} type="button" onClick={() => void ask(starter.question)}><span className="starter-index">{String(index + 1).padStart(2, "0")}</span><span><strong>{starter.title}</strong><small>{starter.detail}</small></span><span aria-hidden="true">→</span></button>)}</div></details>
          <aside className="evidence-note" aria-label="Current knowledge status"><span aria-hidden="true">✓</span><div><strong>Evidence-led support</strong><p>Answers use validated connected repositories. Missing evidence is reported instead of guessed.</p></div></aside>
        </>
      )}
    </>
  );
}
