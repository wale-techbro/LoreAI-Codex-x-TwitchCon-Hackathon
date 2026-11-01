"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LoreEntry } from "@/lib/types";

type Status = { mode: string; twitchConfigured: boolean; aiConfigured: boolean };
type Answer = {
  answer: string;
  sources: Array<{ id: string; title: string; summary: string; chat_messages: Array<{ user_name: string; message_text: string; sent_at: string }> }>;
  generatedBy: string;
  warning?: string;
};

const starterQuestions = ["What was the Banana Incident?", "Why is there a banana on the ceiling?", "What does chat want next?"];

export function Lorebook({ initialEntries, status }: { initialEntries: LoreEntry[]; status: Status }) {
  const [entries, setEntries] = useState(initialEntries);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const approved = useMemo(() => entries.filter((entry) => entry.status === "approved"), [entries]);
  const proposed = useMemo(() => entries.filter((entry) => entry.status === "proposed"), [entries]);
  const rejected = useMemo(() => entries.filter((entry) => entry.status === "rejected"), [entries]);

  async function ask(value = question) {
    const clean = value.trim();
    if (!clean || loading) return;
    setQuestion(clean);
    setLoading(true);
    setError("");
    setAnswer(null);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: clean }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't ask LORE just now.");
      setAnswer(data as Answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach LORE. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function moderate(id: string, nextStatus: "approved" | "rejected") {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/lore/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't update this entry.");
      setEntries((current) => current.map((entry) => entry.id === id ? data.entry as LoreEntry : entry));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update this entry.");
    } finally {
      setBusyId(null);
    }
  }

  return <main className="shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="LORE home"><span className="brand-mark">l.</span><span>LORE</span></Link>
      <nav><a className="nav-active" href="#memory">Memory</a><a href="#review">Review queue <span className="nav-count">{proposed.length}</span></a></nav>
      <div className="topbar-right"><Link className="overlay-link" href="/overlay" target="_blank">↗ <span>Open overlay</span></Link><span className={`connection-pill ${status.twitchConfigured ? "ready" : "demo"}`}><i />{status.twitchConfigured ? "Twitch configured" : "Demo mode"}</span></div>
    </header>

    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> A COMMUNITY THAT REMEMBERS</div><h1>The inside jokes<br />live <em>forever.</em></h1><p>Little moments become community lore. Ask LORE, and get the story with receipts.</p></div>
      <div className="hero-stamp"><div className="stamp-orbit"><span>MEMORY<br />IS A TEAM<br />SPORT</span><b>✳</b></div><div className="stamp-caption">VOL. 001 <span>•</span> FERN’S CORNER</div></div>
      <div className="hero-decoration" aria-hidden="true">✳</div>
    </section>

    {!status.twitchConfigured && <div className="demo-banner"><span className="demo-icon">✦</span><span><strong>You’re exploring a seeded demo community.</strong> Add Twitch credentials to start collecting live moments.</span><a href="#setup">Setup guide ↗</a></div>}

    <section className="ask-section" aria-labelledby="ask-title">
      <div className="ask-heading"><span className="section-index">01</span><div><span className="eyebrow">ASK THE COMMUNITY</span><h2 id="ask-title">What’s the lore?</h2></div></div>
      <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label className="sr-only" htmlFor="question">Ask about community lore</label><span className="ask-spark">✳</span>
        <input id="question" maxLength={400} placeholder="Ask about that thing chat keeps referencing…" value={question} onChange={(event) => setQuestion(event.target.value)} />
        <button className="ask-button" type="submit" disabled={loading || !question.trim()}>{loading ? <><span className="spinner" /> Looking</> : <>Ask LORE <span>↗</span></>}</button>
      </form>
      <div className="suggestions"><span>TRY ASKING</span>{starterQuestions.map((item) => <button key={item} onClick={() => { setQuestion(item); void ask(item); }}>{item}</button>)}</div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {loading && <div className="answer-card answer-loading"><span className="answer-sigil">✳</span><div><span className="eyebrow">LORE IS REMEMBERING</span><p>Pulling the right moments together…</p></div><span className="answer-dots">•••</span></div>}
      {answer && <article className="answer-card" aria-live="polite"><div className="answer-sigil">✳</div><div className="answer-body"><div className="answer-kicker"><span className="eyebrow">THE COMMUNITY REMEMBERS</span><span className="source-count">{answer.sources.length} {answer.sources.length === 1 ? "LORE ENTRY" : "LORE ENTRIES"}</span></div><p className="answer-text">{answer.answer}</p>{answer.warning && <p className="answer-note">{answer.warning}</p>}<div className="answer-sources"><span className="eyebrow">PULLED FROM</span>{answer.sources.map((source, index) => <details key={source.id} className="source-item"><summary><span className="source-number">0{index + 1}</span><span>{source.title}</span><span className="source-chevron">⌄</span></summary><p>{source.summary}</p>{source.chat_messages.slice(0, 3).map((message, i) => <blockquote key={`${source.id}-${i}`}><span>@{message.user_name.toLowerCase()}</span> “{message.message_text}”</blockquote>)}</details>)}</div></div></article>}
    </section>

    <section className="memory-section" id="memory">
      <div className="section-heading"><div className="section-heading-main"><span className="section-index">02</span><div><span className="eyebrow">THE COMMUNITY ARCHIVE</span><h2>Memory, made together<span className="heading-period">.</span></h2></div></div><span className="entry-count">{approved.length.toString().padStart(2, "0")} MEMORIES</span></div>
      <div className="lore-grid">{approved.map((entry, index) => <article className={`lore-card ${index === 0 ? "feature-card" : ""}`} key={entry.id}><div className="card-top"><span className="card-number">MEMORY / {String(index + 1).padStart(2, "0")}</span><span className="approved-tag"><i /> REMEMBERED</span></div><h3>{entry.title}</h3><p>{entry.summary}</p><div className="card-bottom"><span>{entry.source_message_ids.length.toString().padStart(2, "0")} CHAT MOMENTS</span><span className="card-arrow">↗</span></div></article>)}{approved.length === 0 && <div className="empty-card">No approved lore yet. Review a proposed moment below to start your community archive.</div>}</div>
    </section>

    <section className="review-section" id="review"><div className="section-heading"><div className="section-heading-main"><span className="section-index">03</span><div><span className="eyebrow">STREAMER’S DESK</span><h2>Make it official<span className="heading-period">.</span></h2></div></div><span className="review-count">{proposed.length.toString().padStart(2, "0")} WAITING</span></div>
      {proposed.length > 0 ? <div className="proposal-list">{proposed.map((entry) => <article className="proposal" key={entry.id}><div className="proposal-marker">✳</div><div className="proposal-content"><div className="proposal-meta"><span>LORE CANDIDATE</span><span>·</span><time>{new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time></div><h3>{entry.title}</h3><p>{entry.summary}</p><span className="proposal-sources">{entry.source_message_ids.length} SOURCE MOMENTS ATTACHED</span></div><div className="proposal-actions"><button className="reject-button" disabled={busyId === entry.id} onClick={() => void moderate(entry.id, "rejected")}>Dismiss</button><button className="approve-button" disabled={busyId === entry.id} onClick={() => void moderate(entry.id, "approved")}>{busyId === entry.id ? "Saving…" : "Approve lore"} <span>↗</span></button></div></article>)}</div> : <div className="review-empty"><span>✓</span> You’re all caught up. New lore candidates appear here.</div>}
      {rejected.length > 0 && <p className="dismissed-note">{rejected.length} dismissed candidate{rejected.length === 1 ? "" : "s"} hidden from the archive.</p>}
    </section>

    <footer className="footer" id="setup"><div className="footer-brand"><span className="brand-mark">l.</span><span>LORE</span></div><span>Every community has a story. This one’s yours to keep.</span><div className="footer-status"><i className={status.aiConfigured ? "on" : ""} /> {status.aiConfigured ? "AI answers enabled" : "Grounded demo answers"}<span>·</span><i className={status.mode === "supabase" ? "on" : ""} /> {status.mode === "supabase" ? "Synced database" : "Local demo data"}</div></footer>
  </main>;
}
