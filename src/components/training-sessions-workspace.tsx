"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { TrainingSessionRecord } from "@/lib/training/types";

export function TrainingSessionsWorkspace() {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<TrainingSessionRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (search: string) => {
    setStatus("loading");
    try {
      const response = await fetch(`/api/training/sessions?q=${encodeURIComponent(search.trim())}`, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("Training session search failed");
      const payload = await response.json() as { sessions: TrainingSessionRecord[] };
      setSessions(payload.sessions); setStatus("ready");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/training/sessions?q=", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Training session search failed");
        return response.json() as Promise<{ sessions: TrainingSessionRecord[] }>;
      })
      .then((payload) => { if (active) { setSessions(payload.sessions); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(query); }

  return <>
    <section className="welcome-panel compact-welcome" aria-labelledby="training-sessions-title"><p className="eyebrow">Your coaching history</p><h1 id="training-sessions-title">Training Sessions</h1><p>Search earlier coaching sessions, review what happened, or continue an unfinished session.</p><Link className="subpage-link" href="/training">Start new training <span aria-hidden="true">→</span></Link></section>
    <form className="session-search" role="search" onSubmit={search}><label htmlFor="training-session-query">Search training sessions</label><div><input id="training-session-query" type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try projector, AES50, or a learned behavior" /><button type="submit">Search</button></div></form>
    <section className="sessions-section" aria-live="polite" aria-busy={status === "loading"}>
      <div className="section-heading"><div><p className="eyebrow">Most recent activity first</p><h2>{query.trim() ? "Search results" : "Your training sessions"}</h2></div>{status === "ready" ? <span>{sessions.length} found</span> : null}</div>
      {status === "loading" ? <div className="session-loading"><span aria-hidden="true" /><p>Searching your training history…</p></div> : null}
      {status === "error" ? <div className="error-panel" role="alert"><strong>Training sessions are unavailable.</strong><p>Try the search again in a moment.</p></div> : null}
      {status === "ready" && !sessions.length ? <div className="empty-state"><strong>No training sessions found.</strong><p>{query.trim() ? "Try a keyword from the original question, response, report, or repository." : "Your coaching sessions will appear here after you start training."}</p><Link href="/training">Start new training</Link></div> : null}
      {status === "ready" && sessions.length ? <div className="session-list">{sessions.map((session) => <article className="session-card training-session-summary" key={session.id}>
        <div className="session-card-meta"><span>{session.state.replaceAll("_", " ")}</span><time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</time></div>
        <h3>{session.originalQuestion}</h3>
        <p>{session.currentReport?.summary ?? (session.currentAnswer ? "PointGuide response ready for trainer feedback." : "Waiting for the first response.")}</p>
        <div><span>{session.targetRepository}</span><Link href={`/training/sessions/${session.id}`}>{session.state === "PROPOSED" ? "View session" : "Open and continue"}<span aria-hidden="true"> →</span></Link></div>
      </article>)}</div> : null}
    </section>
  </>;
}
