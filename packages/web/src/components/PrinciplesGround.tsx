/**
 * Principles before the first one exists. Explain the idea and show a
 * labeled example, then replace the example with this profile’s own patterns
 * as evidence arrives. An available pattern is a starting point, not a
 * guarantee that a principle is ready or will arrive at a particular time.
 *
 * Keep the shared companion and bubble. A person without patterns can add
 * an inspiration; an agent’s page explains its own memory without asking
 * the person to write into it. Generator drafts are never previewed here.
 */
import { useEffect, useState } from "react";

import { Companion } from "./Companion";
import { fetchSignals, type ApiSignal } from "../lib/api";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { readProfileText, writeProfileText } from "../lib/profile-storage";
import { numWords } from "../lib/words";

/** Seats on the card. The same number as `PRINCIPLE_MIN_SIGNALS` on the
    server; drawn from it rather than from a design choice. */
const GROUND_SEATS = 3;

type Phase = "loading" | "ready" | "failed";

export function PrinciplesGround({ locale, profileId, whose = "own", onChat, onNewSave, newSaveLabel }: {
  locale: SupportedLocale;
  profileId?: string | null;
  /** Whose ground this is — an agent's wall must not say "you keep". */
  whose?: "own" | "agent";
  /** A chat about what the creature just said. Founder, 2026-10-15: "make
      this also have the chat about it thing." */
  onChat?: (said: string) => void;
  onNewSave?: () => void;
  newSaveLabel?: string;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const agent = whose === "agent";
  const [phase, setPhase] = useState<Phase>("loading");
  const [holding, setHolding] = useState<ApiSignal[]>([]);
  /* How many seats were lit at the last visit, read once before this visit
     writes its own count, so the difference is what arrived in between. */
  const [seenBefore] = useState<number | null>(() => {
    if (!profileId) return null;
    try {
      const raw = readProfileText({ accountId: "p", profileId }, "ground:lit");
      const seen = Number.parseInt(raw, 10);
      /* Nothing stored is a first visit, and on a first visit nothing is
         "new": every lit seat would flash, which explains nothing. */
      return raw === "" || !Number.isFinite(seen) ? null : seen;
    } catch {
      return null;
    }
  });

  /* Bumped by "Try again"; the read below is this effect running again. */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    const profile = profileId ? { profile: profileId } : {};
    void fetchSignals({ ...profile, status: "active", limit: 20 })
      .then((signals) => {
        if (!alive) return;
        /* The ones that have lasted longest first: they are the likeliest
           ground for the first principle. */
        const steady = signals
          .filter((row) => row.status === "active" && !row.dismissed && !row.unsupported)
          .sort((a, b) => b.evidenceCount - a.evidenceCount);
        setHolding(steady);
        setPhase("ready");
      })
      .catch(() => {
        if (alive) setPhase("failed");
      });
    return () => {
      alive = false;
    };
  }, [profileId, attempt]);

  const lit = Math.min(holding.length, GROUND_SEATS);

  useEffect(() => {
    if (phase !== "ready" || !profileId) return;
    try {
      writeProfileText({ accountId: "p", profileId }, "ground:lit", String(lit));
    } catch {
      /* The next visit simply will not know what is new. */
    }
  }, [phase, lit, profileId]);

  if (phase === "loading") {
    return <p className="waka-over-status" role="status">{say("worldGroundLoading")}</p>;
  }
  if (phase === "failed") {
    /* A FAILED READ SAYS IT FAILED. This used to fall back to "no principles
       yet" on the grounds that the sentence was still true — but it is true
       of an account with forty steady signals too, and printing it over a
       dead connection told that person their thinking had added up to
       nothing, with no way to find out otherwise. */
    return (
      <>
        <p className="waka-over-status" role="alert">{say("worldGroundFailed")}</p>
        <button type="button" className="waka-over-retry" onClick={() => setAttempt((n) => n + 1)}>
          {say("worldRetry")}
        </button>
      </>
    );
  }

  const count = holding.length;
  /* THE CREATURE SAYS IT, IN ITS OWN VOICE. Founder, 2026-10-15: "the
     character should be a big part of it ... the character should give that
     feeling of an exciting anticipation." The state line became its speech:
     the same facts, said by the one who is waiting with you. */
  const line = count === 0
    ? say(agent ? "worldGroundNoneAgent" : "worldGroundNone")
    : count < GROUND_SEATS
      ? formatMessage(locale, agent ? "worldGroundSomeAgent" : "worldGroundSome", { count, countWords: numWords(count, locale) })
      : say(agent ? "worldGroundReadyAgent" : "worldGroundReady");
  /* How lit the waiting is, 0 to 1. Light is the only meaning channel: the
     glow around the creature IS the progress, and nothing else measures it. */
  const charge = Math.min(count, GROUND_SEATS) / GROUND_SEATS;

  return (
    <section className="waka-ground" aria-label={say(agent ? "worldGroundLabelAgent" : "worldGroundLabel")}>
      <div
        className={`waka-ground-hero${count > 0 ? " waka-ground-hero--stirring" : ""}${count >= GROUND_SEATS ? " waka-ground-hero--ready" : ""}`}
        style={{ ["--charge" as string]: charge }}
      >
        {/* THE HOME SCREEN'S OWN BUBBLE. Founder, 2026-10-15, of this one
            beside the home screen's: "this also looks different. use exact
            same code ... for both character and the speech bubble." So it
            wears `.jar-char-bubble-body` — the same fill, grain, light and
            tail — and ends in the same foot row. */}
        <div className="jar-char-bubble-body waka-ground-bubble">
          <span className="jar-char-bubble-reading" role="status">{line}</span>
          {!agent && count < GROUND_SEATS && onNewSave ? (
            <span className="jar-char-bubble-acts">
              <button type="button" className="jar-char-bubble-act" onClick={onNewSave}>
                {newSaveLabel ?? say("worldBubbleActAdd")}
              </button>
            </span>
          ) : !agent && onChat ? (
            <span className="jar-char-bubble-acts">
              <button type="button" className="jar-char-bubble-act" onClick={() => onChat(line)}>
                {say("worldTalkAboutThis")}
              </button>
            </span>
          ) : null}
        </div>
        <span className="waka-ground-being" data-crossing-target="104" style={{ ["--being" as string]: "106px" }}>
          <Companion size={104} />
        </span>
      </div>
      <div className={`waka-ground-card${count >= GROUND_SEATS ? " waka-ground-card--full" : ""}`}>
        <p className="waka-ground-definition">{say("worldGroundDefinition")}</p>
        {count === 0 ? (
          <div className="waka-ground-example">
            <p className="waka-ground-label">{say("worldGroundExampleLabel")}</p>
            <blockquote>{say("worldGroundExample")}</blockquote>
          </div>
        ) : (
          <>
            <p className="waka-ground-label">{say("worldGroundPatterns")}</p>
            <ol className="waka-ground-seats">
              {Array.from({ length: GROUND_SEATS }, (_, index) => {
                const signal = holding[index];
                const fresh = signal && seenBefore !== null && index >= seenBefore;
                return (
                  <li
                    key={signal?.id ?? `empty-${index}`}
                    className={`waka-ground-seat${signal ? " waka-ground-seat--held" : ""}${fresh ? " waka-ground-seat--new" : ""}`}
                    aria-hidden={signal ? undefined : true}
                  >
                    {signal ? <span className="waka-ground-words">{signal.statement}</span> : <span className="waka-ground-empty" />}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <p className="waka-ground-how">{say(agent ? "worldGroundHowAgent" : "worldGroundHow")}</p>
        <p className="waka-ground-foot">{say(agent ? "worldGroundFootAgent" : "worldGroundFoot")}</p>
      </div>
    </section>
  );
}
