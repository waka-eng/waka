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
  if (note.status === "stale" || note.status === "replaced") return "fading";
  if (note.type === "tension" || note.ambitionDimension === "tension") return "tension";
  if (note.type === "question" || note.type === "hypothesis" || note.ambitionDimension === "next_experiment") {
    return "needs testing";
  }
  if (note.evidencePreviews.length >= 3 || note.confidence >= 0.8) return "keeps returning";
  if (note.evidencePreviews.some((evidence) => Date.now() - new Date(evidence.createdAt).getTime() > 1000 * 60 * 60 * 24 * 30)) {
    return "came back";
  }
  return "newly forming";
}

function replaceabilityLine(note: ApiTopOfMindNoteSurface): string {
  const state = noteKicker(note);
  if (state === "keeps returning") return "still here because evidence keeps returning";
  if (state === "came back") return "came back after going quiet";
  if (state === "fading") return "ready to be replaced if new signals stop supporting it";
  if (state === "tension") return "kept visible until the tension changes shape";
  if (state === "needs testing") return "not final; asks for a small test";
  return "newly forming; changed by new signals";
}

function evidenceCount(note: ApiTopOfMindNoteSurface): number {
  return new Set([
    ...note.evidencePreviews.map((evidence) => evidence.signalId),
    ...note.relatedSignalIds,
    ...note.relatedSignals.map((signal) => signal.id),
  ]).size;
}

function provenanceLine(note: ApiTopOfMindNoteSurface): string {
  const count = evidenceCount(note);
  const evidenceLabel = count > 0 ? `${count} saved signal${count === 1 ? "" : "s"}` : "saved signals";
  const rationale = note.evidenceRationale?.trim();
  if (rationale) {
    return `${evidenceLabel} shaped this read; the private saved moments stay inside WAKA.`;
  }
  return `${evidenceLabel} and later corrections can keep, replace, or rewrite this post-it.`;
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

  const featuredNotes = notes.slice(0, 5);
  const shareSlots = Array.from({ length: 5 }, (_, index) => featuredNotes[index] ?? null);

  return (
    <main className="tom-share-page">
      <section className="tom-share-hero" aria-labelledby="tom-share-title">
        <div className="tom-share-hero-copy">
          <p className="tom-share-eyebrow">Living Top of Mind</p>
          <h1 id="tom-share-title">{ownerName}'s Top of Mind</h1>
          <p className="tom-share-lede">
            Most inspiration disappears. WAKA catches what moved {ownerName}
            before it slips away, then turns those saved signals into a changing
            map of what they may want to build, who they want around them, and
            where they may need to be.
          </p>
          <p className="tom-share-note">
            These post-its were not typed by {ownerName}. They emerged from what
            they saved, corrected, returned to, and outgrew. The raw saved
            signals stay private.
          </p>
          <div className="tom-share-rhythm" aria-label="What shapes this page">
            <span>saved</span>
            <span>corrected</span>
            <span>returned to</span>
            <span>changed shape</span>
          </div>
        </div>

        <aside className="tom-share-proof" aria-label="How this page works">
          <span>not final</span>
          <strong>personal context is alive</strong>
          <p>
            Five provisional post-its sit on top. They are graph-backed reads
            about places, people, work, taste, tensions, and next experiments.
            New signals and corrections can keep them here or replace them.
          </p>
        </aside>
      </section>

      <section className="tom-share-board" aria-labelledby="tom-share-board-title">
        <div className="tom-share-board-heading">
          <p>Current five</p>
          <h2 id="tom-share-board-title">The living notes on top right now</h2>
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
            {shareSlots.map((note, index) => (
              <article
                className={`tom-share-postit${note ? "" : " tom-share-postit--empty"}`}
                data-tone={index % 4}
                key={note?.id ?? `share-empty-${index}`}
              >
                <div className="tom-share-postit-pin" aria-hidden="true" />
                <span>{note ? noteKicker(note) : "waiting"}</span>
                <h3>{note ? note.ambientSignal || note.title : "Waiting for a stronger signal to earn this spot."}</h3>
                {note ? (
                  <>
                    <p>{note.matchedEnvironment}</p>
                    <p className="tom-share-anti">Not this: {note.antiEnvironment}</p>
                    <blockquote>{provenanceLine(note)}</blockquote>
                    <em>{replaceabilityLine(note)}</em>
                  </>
                ) : (
                  <em>empty on purpose; replaced when memory moves</em>
                )}
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
