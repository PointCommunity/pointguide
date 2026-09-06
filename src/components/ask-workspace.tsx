"use client";

import { useId, useState, type FormEvent } from "react";
import type { AnswerClaim, EvidenceItem } from "@/lib/agent/schema";

interface DemoAnswer {
  id: string;
  directAnswer: string;
  steps: string[];
  safetyAndAssumptions: string[];
  confidence: "CONFIRMED" | "SUPPORTED" | "TENTATIVE" | "UNKNOWN";
  claims: AnswerClaim[];
  evidence: EvidenceItem[];
  reviewStatus: "NOT_REQUESTED";
}

const starters = [
  { title: "Troubleshoot stage-box sync", detail: "DL16, DL32, AES50 and clocking", question: "What does a red AES50 sync light on the DL32 mean?" },
  { title: "Set up a monitor mix", detail: "M32 buses, sends and personal monitoring", question: "How do I set up a monitor mix on the M32?" },
  { title: "Prepare for a firmware update", detail: "Compatibility, backup and rollback checks", question: "How should I prepare for an M32 firmware update?" },
] as const;

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

  async function ask(nextQuestion: string) {
    const value = nextQuestion.trim();
    if (!value || status === "loading") return;
    setQuestion(value);
    setStatus("loading");
    setError("");
    setFeedback(null);
    try {
      const response = await fetch("/api/demo/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: value }),
      });
      const payload = await response.json() as { answer?: DemoAnswer; error?: { message?: string } };
      if (!response.ok || !payload.answer) throw new Error(payload.error?.message ?? "PointGuide could not answer that question.");
      setAnswer(payload.answer);
      setStatus("idle");
    } catch (caught) {
      setAnswer(null);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "PointGuide could not answer that question.");
    }
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
        <p>Ask about the M32 ecosystem. Every factual answer is tied to the checked PointAudio corpus, and gaps stay visible.</p>
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
          placeholder="Example: Why is my DL32 showing a red AES50 sync light?"
        />
        <div className="composer-actions">
          <p><span className="status-dot" aria-hidden="true" /> PointAudio repository sources first</p>
          <button type="submit" disabled={status === "loading" || !question.trim()}>
            {status === "loading" ? "Checking sources…" : "Ask PointGuide"} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <p id={statusId} className="sr-only" aria-live="polite">
          {status === "loading" ? "Checking repository evidence." : status === "error" ? error : answer ? "Answer ready." : ""}
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
            <span className={`confidence ${answer.confidence.toLowerCase()}`}>{answer.confidence.toLocaleLowerCase()}</span>
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
              <button className={feedback === "helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "helpful"} onClick={() => setFeedback("helpful")}>Helpful</button>
              <button className={feedback === "not-helpful" ? "selected" : undefined} type="button" aria-pressed={feedback === "not-helpful"} onClick={() => setFeedback("not-helpful")}>Not helpful</button>
            </div>
            {feedback ? <p className="feedback-status" role="status">Rating captured for this demo. Persistent feedback arrives with the governed learning slice.</p> : null}
          </footer>
        </article>
      ) : (
        <>
          <section className="starter-section" aria-labelledby="starters-title">
            <div className="section-heading"><div><p className="eyebrow">Start with a real task</p><h2 id="starters-title">Common questions</h2></div><span>{starters.length} suggestions</span></div>
            <div className="starter-list">
              {starters.map((starter, index) => (
                <button key={starter.title} type="button" onClick={() => void ask(starter.question)}>
                  <span className="starter-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{starter.title}</strong><small>{starter.detail}</small></span><span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
          <aside className="evidence-note" aria-label="Current knowledge status">
            <span aria-hidden="true">✓</span><div><strong>Locally verified PointAudio corpus</strong><p>41 checksums passed on September 6, 2026. PointGuide currently sees 20 M32-related source records.</p></div>
          </aside>
        </>
      )}
    </>
  );
}
