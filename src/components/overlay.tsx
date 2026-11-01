"use client";

import { useEffect, useState } from "react";

type Answer = { answer: string; sources: Array<{ id: string; title: string }>; generatedBy: string };

export function Overlay() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask(value: string) {
    const clean = value.trim();
    if (!clean) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: clean }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not ask LORE.");
      setAnswer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ask LORE.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) {
      setQuestion(initial);
      void ask(initial);
    }
    // Intentionally run once for an OBS URL's initial question.
  }, []);

  return <main className="overlay-stage"><div className="overlay-card"><div className="overlay-brand"><span className="brand-mark">l.</span><span>LORE</span><span className="overlay-live"><i /> COMMUNITY MEMORY</span></div><form className="overlay-form" onSubmit={(event) => { event.preventDefault(); void ask(question); }}><label className="sr-only" htmlFor="overlay-question">Ask about community lore</label><input id="overlay-question" placeholder="What’s the lore?" value={question} onChange={(event) => setQuestion(event.target.value)} /><button type="submit" disabled={loading || !question.trim()}>{loading ? "…" : "↗"}</button></form>{loading && <div className="overlay-result"><span className="eyebrow">REMEMBERING</span><p>Finding the moment…</p></div>}{error && <p className="overlay-error">{error}</p>}{answer && !loading && <div className="overlay-result"><span className="eyebrow">THE COMMUNITY REMEMBERS</span><p>{answer.answer}</p>{answer.sources.length > 0 && <div className="overlay-source">✳ &nbsp; {answer.sources.map((source) => source.title).join(" · ")}</div>}</div>}<div className="overlay-footer">A LIVING MEMORY FOR THIS COMMUNITY <span>✳</span></div></div></main>;
}
