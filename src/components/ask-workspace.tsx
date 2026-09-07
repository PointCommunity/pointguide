"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { AnswerClaim, EvidenceItem } from "@/lib/agent/schema";

interface DemoAnswer {
  id: string;
  directAnswer: string;
  steps: string[];
  safetyAndAssumptions: string[];
  confidence: "CONFIRMED" | "SUPPORTED" | "TENTATIVE" | "UNKNOWN";
  claims: AnswerClaim[];
  evidence: EvidenceItem[];
  reviewStatus: "NOT_REQUESTED" | "PASSED";
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

function rotatingStarters(seed: string | null) {
  let offset = 0;
  for (const character of seed ?? "") offset = (offset + character.charCodeAt(0)) % starterPool.length;
  return Array.from({ length: 3 }, (_, index) => starterPool[(offset + index) % starterPool.length]);
}

function EvidenceCard({ item, claims }: { item: EvidenceItem; claims: AnswerClaim[] }) {
  const supportedClaims = claims.filter((claim) => claim.evidenceIds.includes(item.id));
  return (
    <details className="evidence-card">
      <summary>
        <span className="source-badge">Repository</span>
        <span><strong>{item.title}</strong><small>{item.locator ?? item.path}</small></span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="evidence-body">
        <blockquote>{item.excerpt}</blockquote>
        <dl>
          <div><dt>Authority</dt><dd>{item.authority}</dd></div>
          {item.versionOrDate ? <div><dt>Version / date</dt><dd>{item.versionOrDate}</dd></div> : null}
          <div><dt>Captured</dt><dd>{new Date(item.capturedAt).toLocaleDateString("en-US", { dateStyle: "long" })}</dd></div>
          <div><dt>Source</dt><dd><code>{item.path}</code></dd></div>
        </dl>
        {supportedClaims.length ? <p className="supports"><strong>Supports:</strong> {supportedClaims.map((claim) => claim.text).join(" ")}</p> : null}
      </div>
    </details>
  );
}

export function AskWorkspace() {
  const statusId = useId();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DemoAnswer | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<"helpful" | "not-helpful" | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  const [progress, setProgress] = useState("");
  const [turnNumber, setTurnNumber] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "PointGuide support" }) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session unavailable");
        return response.json() as Promise<{ conversation: { id: string }; reviewEnabled: boolean; usage: { turnNumber: number } }>;
      })
      .then((payload) => { if (active) { setConversationId(payload.conversation.id); setReviewEnabled(payload.reviewEnabled); setTurnNumber(payload.usage.turnNumber); } })
      .catch(() => { if (active) setError("PointGuide could not start a support session."); });
    return () => { active = false; };
  }, []);

  async function ask(nextQuestion: string) {
    const value = nextQuestion.trim();
    if (!value || status === "loading" || !conversationId) return;
    setQuestion(value);
    setStatus("loading");
    setError("");
    setFeedback(null);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: value, deepResearch }),
      });
      if (!response.ok || !response.body) throw new Error("PointGuide could not answer that question.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: DemoAnswer | null = null;
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const item = JSON.parse(line) as { type: string; data: { message?: string; answer?: DemoAnswer; usage?: { turnNumber: number } } };
          if (item.type === "status") setProgress(item.data.message ?? "Working");
          if (item.type === "error") throw new Error(item.data.message ?? "PointGuide could not verify an answer.");
          if (item.type === "answer" && item.data.answer) { completed = item.data.answer; if (item.data.usage) setTurnNumber(item.data.usage.turnNumber); }
        }
        if (chunk.done) break;
      }
      if (!completed) throw new Error("PointGuide did not return an answer.");
      setAnswer(completed);
      setStatus("idle");
      setProgress("");
    } catch (caught) {
      setAnswer(null);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "PointGuide could not answer that question.");
    }
  }

  async function rate(rating: "helpful" | "not-helpful") {
    if (!answer) return;
    const response = await fetch(`/api/answers/${answer.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: rating === "helpful" ? "HELPFUL" : "NOT_HELPFUL", question, evidenceIds: answer.evidence.map((item) => item.id) }) });
    if (response.ok) setFeedback(rating); else setError("PointGuide could not save that rating.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <>
      <section className="welcome-panel" aria-labelledby="page-title">
        <p className="eyebrow">Evidence before assumption</p>
        <h1 id="page-title">What can I help you solve?</h1>
        <p>Ask for help with Point Community Church technology. PointGuide checks connected source repositories, shows its evidence, and keeps unknowns visible.</p>
      </section>

      <form className="composer-shell" onSubmit={submit} aria-describedby={statusId}>
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          name="question"
          rows={4}
          maxLength={8_000}
          required
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What technology issue can PointGuide help you work through?"
        />
        <div className="composer-actions">
          <div>
            <p><span className="status-dot" aria-hidden="true" /> Connected church sources first</p>
            {reviewEnabled ? <label className="deep-research-toggle"><input type="checkbox" checked={deepResearch} onChange={(event) => setDeepResearch(event.target.checked)} /> Deep research</label> : null}
          </div>
          <button type="submit" disabled={status === "loading" || !question.trim() || !conversationId || turnNumber >= 6}>
            {status === "loading" ? "Checking sources…" : "Ask PointGuide"} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <p className="turn-counter">{turnNumber === 0 ? "Initial question + 5 follow-ups available" : `${Math.max(0, 6 - turnNumber)} follow-up${6 - turnNumber === 1 ? "" : "s"} remaining in this session`}</p>
        <p id={statusId} className="sr-only" aria-live="polite">
          {status === "loading" ? progress || "Checking repository evidence." : status === "error" ? error : answer ? "Answer ready." : ""}
        </p>
      </form>

      {status === "error" ? (
        <section className="error-panel" role="alert">
          <strong>We could not complete that search.</strong><p>{error} Your question is still in the composer; try again when ready.</p>
        </section>
      ) : null}

      {answer ? (
        <article className="answer-panel" aria-labelledby="answer-title">
          <header>
            <div><p className="eyebrow">PointGuide answer</p><h2 id="answer-title">What the evidence supports</h2></div>
            <div className="answer-badges"><span className={`confidence ${answer.confidence.toLowerCase()}`}>{answer.confidence.toLocaleLowerCase()}</span>{answer.reviewStatus === "PASSED" ? <span className="confidence">reviewed</span> : null}</div>
          </header>
          <p className="direct-answer">{answer.directAnswer}</p>
          {answer.safetyAndAssumptions.length ? (
            <aside className="safety-note"><strong>Before you change anything</strong><ul>{answer.safetyAndAssumptions.map((item) => <li key={item}>{item}</li>)}</ul></aside>
          ) : null}
          {answer.steps.length ? <section><h3>Next checks</h3><ol className="answer-steps">{answer.steps.map((step) => <li key={step}>{step}</li>)}</ol></section> : null}
          <section className="claim-ledger" aria-labelledby="claims-title">
            <h3 id="claims-title">Claim check</h3>
            <ul>{answer.claims.map((claim) => (
              <li key={claim.id}><span aria-hidden="true">{claim.status === "SUPPORTED" ? "✓" : "?"}</span><span><strong>{claim.status === "SUPPORTED" ? "Supported" : "Unknown"}</strong>{claim.text}</span></li>
            ))}</ul>
          </section>
          <section className="evidence-section" aria-labelledby="evidence-title">
            <div className="section-heading"><div><p className="eyebrow">Trace the answer</p><h3 id="evidence-title">Evidence</h3></div><span>{answer.evidence.length} source{answer.evidence.length === 1 ? "" : "s"}</span></div>
            {answer.evidence.length ? answer.evidence.map((item) => <EvidenceCard key={item.id} item={item} claims={answer.claims} />) : <p className="empty-evidence">No current source establishes this. The answer is intentionally marked Unknown.</p>}
          </section>
          <footer className="feedback-bar">
            <div><strong>Was this useful?</strong><small>Your rating improves retrieval; it does not rewrite facts.</small></div>
            <div role="group" aria-label="Rate this answer">
              <button className={feedback === "helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "helpful"} onClick={() => void rate("helpful")}>Helpful</button>
              <button className={feedback === "not-helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "not-helpful"} onClick={() => void rate("not-helpful")}>Not helpful</button>
            </div>
            {feedback ? <p className="feedback-status" role="status">Rating captured. Trainers can review this signal; it never rewrites source facts automatically.</p> : null}
          </footer>
        </article>
      ) : (
        <>
          <details className="starter-section starter-accordion">
            <summary><span><span className="eyebrow">Need an idea?</span><strong id="starters-title">Suggested tasks</strong></span><span aria-hidden="true">⌄</span></summary>
            <div className="starter-list" aria-labelledby="starters-title">
              {rotatingStarters(conversationId).map((starter, index) => (
                <button key={starter.title} type="button" onClick={() => void ask(starter.question)}>
                  <span className="starter-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{starter.title}</strong><small>{starter.detail}</small></span><span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </details>
          <aside className="evidence-note" aria-label="Current knowledge status">
            <span aria-hidden="true">✓</span><div><strong>Evidence-led support</strong><p>Answers use validated connected repositories. Missing evidence is reported instead of guessed.</p></div>
          </aside>
        </>
      )}
    </>
  );
}
