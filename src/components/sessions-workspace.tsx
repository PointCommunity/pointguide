"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { SessionSummary } from "@/lib/learning/store";

export function SessionsWorkspace() {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (search: string) => {
    setStatus("loading");
    try {
      const response = await fetch(`/api/conversations?q=${encodeURIComponent(search.trim())}`, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("Session search failed");
      const payload = await response.json() as { sessions: SessionSummary[] };
      setSessions(payload.sessions);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/conversations?q=", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session search failed");
        return response.json() as Promise<{ sessions: SessionSummary[] }>;
      })
      .then((payload) => { if (active) { setSessions(payload.sessions); setStatus("ready"); } })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query);
  }

  return (
    <>
      <section className="welcome-panel compact-welcome" aria-labelledby="sessions-title">
        <p className="eyebrow">Your support history</p>
        <h1 id="sessions-title">Sessions</h1>
        <p>Find an earlier question, review its evidence, or continue a session that still has follow-ups available.</p>
      </section>
      <form className="session-search" role="search" onSubmit={search}>
        <label htmlFor="session-query">Search questions and answers</label>
        <div><input id="session-query" type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try AES50, projector, or monitor mix" /><button type="submit">Search</button></div>
      </form>
      <section className="sessions-section" aria-live="polite" aria-busy={status === "loading"}>
        <div className="section-heading"><div><p className="eyebrow">Most recent first</p><h2>{query.trim() ? "Search results" : "Your sessions"}</h2></div>{status === "ready" ? <span>{sessions.length} found</span> : null}</div>
        {status === "loading" ? <div className="session-loading"><span aria-hidden="true" /><p>Searching your support history…</p></div> : null}
        {status === "error" ? <div className="error-panel" role="alert"><strong>Sessions are unavailable.</strong><p>Try the search again in a moment.</p></div> : null}
        {status === "ready" && !sessions.length ? <div className="empty-state"><strong>No sessions found.</strong><p>{query.trim() ? "Try a different keyword from your question or answer." : "Your completed PointGuide questions will appear here."}</p><Link href="/">Ask a question</Link></div> : null}
        {status === "ready" && sessions.length ? <div className="session-list">{sessions.map((session) => (
          <article key={session.id} className="session-card">
            <div className="session-card-meta"><span>{session.userTurnCount} of 6 used</span><time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</time></div>
            <h3>{session.title}</h3>
            {session.preview ? <p>{session.preview}</p> : <p className="muted">No completed answer yet.</p>}
            <div><span>{Math.max(0, 6 - session.userTurnCount)} follow-up{6 - session.userTurnCount === 1 ? "" : "s"} available</span><Link href={`/sessions/${session.id}`}>{session.userTurnCount < 6 ? "Open and continue" : "View session"}<span aria-hidden="true"> →</span></Link></div>
          </article>
        ))}</div> : null}
      </section>
    </>
  );
}
