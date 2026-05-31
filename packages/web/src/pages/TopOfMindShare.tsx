import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchTopOfMindNotes } from "../lib/api";
import type { ApiTopOfMindNoteSurface } from "../lib/api";
import { useAuth } from "../lib/auth-context";

type LoadState = "loading" | "ready" | "error";

function firstName(name: string, email: string): string {
  const label = (name || email.split("@")[0] || "Yun").trim();
  return label.split(/\s+/)[0] || "Yun";
}

function noteKicker(note: ApiTopOfMindNoteSurface): string {
  return note.ambitionDimension.replace(/_/g, " ");
}

function shortEvidence(note: ApiTopOfMindNoteSurface): string {
  const evidencePreview = note.evidencePreviews[0]?.textPreview;
  const relatedSignalPreview = note.relatedSignals[0]?.preview;
  const text = evidencePreview ?? relatedSignalPreview;
  if (!text) return "This reflection is still looking for stronger evidence.";
  return text.length > 120 ? `${text.slice(0, 117).trim()}...` : text;
}

export function TopOfMindSharePage(): JSX.Element {
  const { user } = useAuth();
  const [notes, setNotes] = useState<ApiTopOfMindNoteSurface[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const ownerName = useMemo(
    () => firstName(user?.name ?? "", user?.email ?? ""),
    [user?.email, user?.name],
  );

  useEffect(() => {
    let alive = true;
    setLoadState("loading");
    fetchTopOfMindNotes({ limit: 5 })
      .then((rows) => {
        if (!alive) return;
        setNotes(rows.filter((note) => note.status === "active"));
        setLoadState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setLoadState("error");
      });

    return () => {
      alive = false;
    };
  }, []);

  const featuredNotes = notes.slice(0, 4);

  return (
    <main className="tom-share-page">
      <section className="tom-share-hero" aria-labelledby="tom-share-title">
        <div className="tom-share-hero-copy">
          <p className="tom-share-eyebrow">Generated from saved signals</p>
          <h1 id="tom-share-title">{ownerName}'s Top of Mind</h1>
          <p className="tom-share-lede">
            Most signals disappear. {ownerName} caught what almost slipped away.
            Slowly, the things they saved began to take shape: who they want to
            think with, where they want to be, and what they might be here to build.
          </p>
          <p className="tom-share-note">
            They did not manually write this page. WAKA generated it from saved
            signals, and it changes as new signals arrive.
          </p>
        </div>

        <aside className="tom-share-proof" aria-label="How this page works">
          <span>not final</span>
          <strong>changes with new signals</strong>
          <p>
            The post-its below are provisional ambition reads about places,
            people, work, taste, tensions, and next experiments. They are not
            permanent identity claims.
          </p>
        </aside>
      </section>

      <section className="tom-share-board" aria-labelledby="tom-share-board-title">
        <div className="tom-share-board-heading">
          <p>Current reflections</p>
          <h2 id="tom-share-board-title">What WAKA is holding up this week</h2>
        </div>

        {loadState === "loading" ? (
          <div className="tom-share-state" role="status">
            Loading Top of Mind...
          </div>
        ) : loadState === "error" ? (
          <div className="tom-share-state" role="alert">
            This generated page could not load its current notes.
          </div>
        ) : featuredNotes.length > 0 ? (
          <div className="tom-share-notes">
            {featuredNotes.map((note, index) => (
              <article className="tom-share-postit" data-tone={index % 4} key={note.id}>
                <div className="tom-share-postit-pin" aria-hidden="true" />
                <span>{noteKicker(note)}</span>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
                <blockquote>{shortEvidence(note)}</blockquote>
              </article>
            ))}
          </div>
        ) : (
          <div className="tom-share-state">
            This page will fill in once more saved signals become active Top of
            Mind notes.
          </div>
        )}
      </section>

      <footer className="tom-share-footer">
        <p>This page was made from the things {ownerName} saved. It changes every week.</p>
        <Link to="/">Open WAKA</Link>
        <span>© WAKA, 2026, for minds that wander.</span>
      </footer>
    </main>
  );
}

export default TopOfMindSharePage;
