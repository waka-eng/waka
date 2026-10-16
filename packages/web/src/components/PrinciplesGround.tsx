/**
 * THE PRINCIPLES PAGE, BEFORE THERE ARE ANY.
 *
 * Founder, 2026-10-15: "in the beginning they wouldn't form because it
 * takes time, but even the waiting time I wanted to have a very thrilling
 * and super exciting waiting time."
 *
 * ── WHAT WAS HERE, AND WHY IT WAS THE WRONG KIND OF TRUE ─────────────────
 *
 * "No principles yet. They take months of the same choice to form." That
 * sentence was a wall: nothing to look at, nothing to do, and a number of
 * months that is not even what the code asks for. The bar in
 * `lib/principle-generation.ts` is three active patterns that have each
 * appeared in a top of mind, and a nightly read that may then propose one.
 * That bar is near, it is visible, and the person moves it every time they
 * answer a claim. The waiting is not a delay. It is ground being laid.
 *
 * ── WHAT IT SHOWS ─────────────────────────────────────────────────────
 *
 * The card a principle will be, empty, with three seats inside it — one
 * for each pattern the bar asks for. A seat a pattern holds carries that
 * pattern's words, quietly; an empty seat is a faint line. Above it, the
 * creature says the state in words, never as a numeral, in the home
 * screen's own bubble — with a way to chat about it, when the page has one.
 *
 * WHY THE PATTERNS' OWN WORDS. They are already the person's to see — each
 * is a claim on the home screen or a light in the sky — so nothing is
 * revealed early. Showing them here says what the principle will be made
 * of, which is the thrill: you can watch your own ground and guess.
 *
 * WHAT IS NEVER SHOWN: the generator's candidate wording. A principle seen
 * before it is minted makes the mint a non-event.
 *
 * ── THE MOTION, AND WHAT IT EXPLAINS ─────────────────────────────────
 *
 * A seat that filled since the last visit lights up once on arrival. The
 * law is that motion explains and never decorates, and this explains the
 * only thing that changed: a pattern arrived while you were away. The
 * creature breathes once anything is holding, and its light is the
 * progress — the waiting, made visible. Under reduced motion the new seat
 * is simply lit and the creature is still.
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

export function PrinciplesGround({ locale, profileId, whose = "own", onChat }: {
  locale: SupportedLocale;
  profileId?: string | null;
  /** Whose ground this is — an agent's wall must not say "you keep". */
  whose?: "own" | "agent";
  /** A chat about what the creature just said. Founder, 2026-10-15: "make
      this also have the chat about it thing." */
  onChat?: (said: string) => void;
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
  }, [profileId]);

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
    /* The old sentence is still true, and it is the honest fallback when the
       ground itself could not be read. */
    return <p className="waka-over-status">{say("worldPrinciplesEmpty")}</p>;
  }

  const count = holding.length;
  /* THE CREATURE SAYS IT, IN ITS OWN VOICE. Founder, 2026-10-15: "the
     character should be a big part of it ... the character should give that
     feeling of an exciting anticipation." The state line became its speech:
     the same facts, said by the one who is waiting with you. */
  const line = count === 0
    ? say(agent ? "worldGroundNoneAgent" : "worldGroundNone")
    : count < GROUND_SEATS
      ? formatMessage(locale, "worldGroundSome", { count, countWords: numWords(count, locale), left: GROUND_SEATS - count })
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
          {onChat ? (
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
        <p className="waka-ground-foot">{say(agent ? "worldGroundFootAgent" : "worldGroundFoot")}</p>
      </div>
    </section>
  );
}
