/* The personal list shows the statement. Opening it reveals the supporting evidence. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DialogSurface } from "./DialogSurface";
import { useNativeBack } from "./SurfaceHeader";
import { ReadingPausedNotice } from "./ReadingPausedNotice";
import { useReadingPaused } from "../lib/use-reading-paused";
import { PrinciplesGround } from "./PrinciplesGround";
import { Companion } from "./Companion";
import { TimelessSky } from "./TimelessSky";
import { CrossingCompanion, type CreatureSpot } from "./CrossingCompanion";
import { readProfileText, writeProfileText } from "../lib/profile-storage";
import { createFeedback, fetchPrinciples, type ApiPrinciple } from "../lib/api";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { monthTag } from "../lib/words";
import { useOptionalAuth } from "../lib/auth-context";

type Phase = "loading" | "ready" | "failed";

function heldSince(row: ApiPrinciple, locale: SupportedLocale): string | null {
  if (!row.heldSince) return null;
  const when = new Date(row.heldSince);
  return Number.isNaN(when.getTime()) ? null : monthTag(when.getTime(), locale);
}

/** Where the page keeps its creature, measured off the element that holds it. */
function pageCreature(): CreatureSpot | null {
  const node = document.querySelector<HTMLElement>(".waka-page--timeless [data-crossing-target]");
  if (!node) return null;
  const size = Number(node.dataset.crossingTarget) || 0;
  const canvas = node.querySelector("canvas") ?? node;
  const box = canvas.getBoundingClientRect();
  if (!box.width || !size) return null;
  /* The canvas is the padded box, the same bleed on every side, so its
     centre is the body's centre. */
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, size };
}

/** How far a pull left on the page travels, in CSS px, before it is the walk home. */
const PULL_HOME = 56;
/**
 * The page holds the top three principles, never more. Founder, 2026-10-16:
 * "have max 3 principles only". Ranks past three are NOT deleted, only not
 * shown here — they stay in the ranked set and on each principle's own
 * surface ("fading never deletes"). No "more" control, by the founder's
 * explicit "max 3".
 */
const MAX_HELD = 3;

export function PrinciplesOverlay({ locale, profileId, name, title, whose = "own", onClose, onOpen, onShare, onChat, onNewSave, newSaveLabel, crossing = null, onCrossed, gesture = null }: {
  locale: SupportedLocale;
  profileId?: string | null;
  /** Attribution on retained agent cards. */
  name?: string;
  title: string;
  /** Whose principles these are — the bubble must not call an agent's
      principles yours. Chosen by Home the same way it chooses `title`. */
  whose?: "own" | "agent";
  /** The star at the left edge, Escape, the pull left and native back: one handler, Close to home. */
  onClose: () => void;
  /** The page's address, for the native back gestures. */
  gesture?: string | null;
  onOpen: (id: string) => void;
  /** Opens the existing share artifact on an agent wall. */
  onShare?: (id: string) => void;
  /** A chat about what the creature said on the waiting page. */
  onChat?: (said: string) => void;
  onNewSave?: () => void;
  newSaveLabel?: string;
  /**
   * THE WALK FROM NOW, OR BACK TO IT — see `CrossingCompanion`. `home` is
   * where the world's creature stands; "in" walks there and then glides to
   * the page's creature, "out" glides from the page's creature home and
   * walks there. Absent when the page was reached from anywhere but Now.
   */
  crossing?: { going: "in" | "out"; home: CreatureSpot | null } | null;
  /** The walk finished; on the way out, the page may go. */
  onCrossed?: () => void;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  /* Android's back and iOS's edge swipe still close the page, now that no
     header carries them (code review, 2026-11-19). */
  useNativeBack(onClose, gesture);
  /* EVERY VISIBLE LINE SAYS WHOSE THESE ARE (review, 2026-10-16). With the
     title for screen readers only, the page's own words are the only
     attribution left, so on an agent's wall none of them may say "your". */
  const agent = whose === "agent";
  const readingPaused = useReadingPaused(!agent);
  /* Retry restarts a reading on the account: a person's call, not an agent session's. */
  const sessionType = useOptionalAuth()?.profile?.type;
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  /**
   * THE FIRST ONE IS MET, ONCE.
   *
   * After a wait the page has made a point of, the first principle arriving
   * as the top row of an ordinary list would spend the whole build-up on
   * nothing. So the first time this device sees principles on this profile,
   * the page says so above them and the first card comes up in light. Once:
   * the flag is written as soon as it has been shown.
   */
  const [arriving, setArriving] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const arrivalScope = profileId ? { accountId: "p", profileId } : null;
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);
  const pull = useRef<{ id: number; x: number; y: number } | null>(null);
  /* LATCHED. The walk in is decided once, on arrival; the walk out arrives
     later, as a new prop on a page that is already up. The sky reads the
     same object for the whole stay, so finishing a walk never restarts it. */
  const [walk, setWalk] = useState(() => (crossing?.home ? { ...crossing, from: crossing.home } : null));
  const [walking, setWalking] = useState(walk !== null);
  /* THE WAITING GROUND KEEPS THE CREATURE WHERE HOME HAD IT (founder,
     2026-11-26). With principles to show, the list needs the room, so the
     creature still rises to its place above them. */
  const staysHome = () => !document.querySelector(".waka-page--timeless .waka-held");
  const [heldAt, setHeldAt] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const heldAtRef = useRef(heldAt); heldAtRef.current = heldAt;
  useEffect(() => {
    /* Turned round on the way home: walk back in from where the world's
       creature stands, as a new walk (review, 2026-10-15). */
    if (crossing?.going === "in" && walking && walk?.going === "out" && crossing.home) {
      setWalk({ ...crossing, from: crossing.home });
      setWalking(true);
      return;
    }
    if (crossing?.going !== "out") return;
    /* Turned back mid-walk: the creature has not reached the page's spot
       yet, so it walks home from where the world left it. */
    /* Held where home had it (the waiting ground), it walks home from that
       very spot and size: no shrink and grow before the walk (founder,
       2026-11-27: "why does the character become smaller and bigger and
       then move? ... don't do that"). */
    const from = (walking && walk?.going === "in") || heldAtRef.current ? crossing.home : pageCreature();
    if (!crossing.home || !from) { onCrossed?.(); return; }
    setWalk({ ...crossing, from });
    setWalking(true);
    /* once, when the walk out is asked for */
  }, [crossing?.going]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const held = await fetchPrinciples(profileId ? { profile: profileId } : {});
      if (!mounted.current) return;
      setRows(held);
      setPhase("ready");
      if (held.length > 0 && arrivalScope) {
        let met = "1";
        try { met = readProfileText(arrivalScope, "principles:met"); } catch { /* treat as met */ }
        /* "waiting" is written by this page when it opens on an empty
           ground (the branch below). Only a person who
           actually waited is greeted; somebody whose principles were there
           the first time they opened the page has nothing to be met. */
        if (met === "waiting") setArriving(true);
        try { writeProfileText(arrivalScope, "principles:met", "1"); } catch { /* once is best-effort */ }
      } else if (held.length === 0 && arrivalScope) {
        try { writeProfileText(arrivalScope, "principles:met", "waiting"); } catch { /* best-effort */ }
      }
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={`waka-page waka-page--timeless${walking && walk ? ` waka-page--crossing waka-page--crossing-${walk.going}` : ""}`}>
      {/* TIME PASSING, ONCE, AS YOU ARRIVE — see `TimelessSky`. While the
          creature walks, the sky is what moves past it. */}
      <TimelessSky travel={walk ? { dir: walk.going === "in" ? 1 : -1, going: walk.going } : null} />
      {walking && walk ? (
        <CrossingCompanion
          /* A reversal is a new walk, not the old one continuing. */
          key={walk.going}
          from={walk.from}
          to={walk.going === "in" ? pageCreature : walk.home}
          dir={walk.going === "in" ? 1 : -1}
          going={walk.going}
          stay={staysHome}
          onDone={() => {
            /* Where it stayed, the page's own creature takes over at that
               spot and size, so nothing jumps at the hand over. */
            if (walk.going === "in" && staysHome()) {
              const page = pageCreature();
              if (page) setHeldAt({ dx: walk.from.x - page.x, dy: walk.from.y - page.y, scale: walk.from.size / page.size });
            }
            setWalking(false);
            onCrossed?.();
          }}
        />
      ) : null}
      {/* A PAGE, NOT A DIALOG — `modal={false}`. Founder, on this surface by
          name: "how do we even need the close button for inspiration and
          chat? It's supposed to just be moving around. I mean for principles
          too. There's no reason for there to be an X button when we're just
          moving across the pages." The ✕ went on that ruling, and the dock
          took over as the way out — but the markup still said modal, so the
          keyboard lost the exit the mouse kept. A surface that gave up its
          own close control cannot also trap Tab; that combination is the
          only one where there is no way out at all. */}
      {/* THE SAME STAR, ON THE OTHER EDGE (founder, 2026-11-19: "there
          should be the same star on the left to go back. remove the" "<"
          and "Principles" row). Home's star at the right walks here; this
          one at the left walks home. Beside the page, not in it: the
          page's reveal animates a transform that would carry a fixed star
          with it. Gone while the creature walks either way, when the page
          is not yet (or no longer) there; Escape and the pull left work
          throughout. */}
      {/* THE STAR CAME BACK (founder, 2026-11-26, after trying the "<":
          "remove < and bring back the star"). Home's star at the right walks
          here; this one at the left walks home. */}
      {/* THE ASTERISK, CUT BY THE LEFT EDGE (founder, 2026-11-27, choosing
          "an asterisk cut by the edge"): home's mark, mirrored, showing the
          part home kept off screen, so this one says "home is this way" the
          way home's says "Principles". */}
      {walking ? null : <button type="button" className="waka-principles-spark waka-principles-spark--home"
        aria-label={say("worldBackHome")} title={say("worldBackHome")} data-jar-interactive="1" onClick={onClose}
        onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
        <PrinciplesAsterisk edge="left" />
      </button>}
      <DialogSurface
        className="waka-over"
        aria-label={title}
        modal={false}
        onClose={onClose}
        /* A PULL LEFT WALKS HOME — the mirror of the pull right that came
           here (founder, 2026-10-15: Principles is reached by dragging, not
           by a tab). Only from the page itself, never from a control, so a
           drag that starts on a button or a field is that control's own. */
        onPointerDown={event => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('button, a, input, textarea, select, [role="slider"], [data-jar-interactive]')) return;
          pull.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={event => {
          const start = pull.current;
          pull.current = null;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          /* A drag that left text selected was a selection — of a principle
             someone wanted to copy — not a pull home. */
          const selected = typeof window.getSelection === "function" && (window.getSelection()?.toString().length ?? 0) > 0;
          if (!selected && -dx >= PULL_HOME && Math.abs(dy) < -dx) onClose();
        }}
        onPointerCancel={() => { pull.current = null; }}
        >
        {/* The page's name, for a screen reader only: no header row (founder,
            2026-11-19), and the creature's bubble says it in words. */}
        <h2 className="sr-only">{title}</h2>
        {/* A PAUSED READING SAYS SO HERE TOO. Principles are written from
            the reading, so when the model stops answering this page waited
            forever in the creature's patient voice — "the ground is being
            laid" — over work nothing was doing. Own principles only: the
            retry restarts the session's own reading and cannot speak for an
            agent's. */}
        {!agent ? <ReadingPausedNotice state={readingPaused} locale={locale} className="waka-over-status" canRetry={sessionType !== "agent"} /> : null}
        {phase === "loading" ? (
          <p className="waka-over-status" role="status">
            {say("worldPrinciplesLoading")}
          </p>
        ) : phase === "failed" ? (
          <>
            <p className="waka-over-status" role="alert">
              {say(agent ? "worldPrinciplesFailedAgent" : "worldPrinciplesFailed")}
            </p>
            <button type="button" className="waka-over-retry" onClick={() => void load()}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          /* THE WAIT IS THE GROUND BEING LAID — see `PrinciplesGround`. */
          /* No chat act on an agent's ground: the chat would open with the
             agent's line posted as the owner's own first message. Home omits
             it too; this holds even when a caller does not. */
          <PrinciplesGround locale={locale} profileId={profileId} whose={whose} heldAt={heldAt} principleStatus={readingPaused.principleStatus}
            onChat={agent ? undefined : onChat} onNewSave={agent ? undefined : onNewSave} newSaveLabel={newSaveLabel} />
        ) : (
          <>
          {/* THE CREATURE THAT WAITED WITH YOU PRESENTS IT. Same body, same
              bubble as the waiting page, so the arrival reads as the end of
              that wait rather than as a list that happened to fill. */}
          {arriving && !agent && rows[0] && !revealDone ? <FirstPrincipleReveal locale={locale} row={rows[0]}
            onAffirm={() => { setRevealDone(true); void createFeedback({ targetType: "principle", targetId: rows[0]!.id, value: "true" }).catch(() => undefined); }}
            onNotQuite={() => { setRevealDone(true); onOpen(rows[0]!.id); }} /> : null}
          {arriving ? (
            <div className="waka-ground-hero waka-ground-hero--ready waka-held-first-hero" style={{ ["--charge" as string]: 1 }}>
              <div className="jar-char-bubble-body waka-ground-bubble waka-held-first">
                <span className="jar-char-bubble-reading" role="status">{say(agent ? "worldPrinciplesFirstAgent" : "worldPrinciplesFirst")}</span>
              </div>
              <span className="waka-ground-being" data-crossing-target="96" style={{ ["--being" as string]: "98px" }}><Companion size={96} /></span>
            </div>
          ) : (
            /* THE CREATURE COMES WITH YOU, and stays above what it holds.
               Founder: "the character should be a big part of it" — it is the
               one who walked here, so the page keeps it in view. STRIPPED:
               its bubble explaining what principles are; the page's title
               says it. Founder, 2026-11-12: "strip all unnecessary descriptive text across the experience". */
            <div className="waka-ground-hero waka-ground-hero--ready waka-held-hero" style={{ ["--charge" as string]: 1 }}>
              <span className="waka-ground-being" data-crossing-target="88" style={{ ["--being" as string]: "90px" }}><Companion size={88} /></span>
            </div>
          )}
          <ul className="waka-held">
            {/* THREE AT MOST, ONE ABOVE THE OTHER. Founder, 2026-10-16:
                "have max 3 principles only. vertical list of three". The
                rows arrive ranked, so the three are the top three. */}
            {rows.slice(0, MAX_HELD).map((row, index) => {
              const since = agent ? heldSince(row, locale) : null;
              return (
                <li key={row.id} className={`waka-held-card${arriving && index === 0 ? " waka-held-card--arriving" : ""}`}>
                  <button type="button" className="waka-held-open" onClick={() => onOpen(row.id)}>
                    <span className="waka-held-words">{row.statement}</span>
                  </button>
                  {agent ? (
                    <span className="waka-held-foot">
                      <span className="waka-held-proof">
                        {name ? <span className="waka-held-who">{name}</span> : null}
                        {since
                          ? formatMessage(locale, "worldPrincipleSince", { since })
                          : row.citedSignals.length > 0 ? say("worldPrincipleFromAgent") : null}
                      </span>
                      {onShare ? (
                        <button type="button" className="waka-held-share" onClick={() => onShare(row.id)}>
                          {say("worldSharePrinciple")}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </DialogSurface>
    </div>
  );
}

/* ═══ WAKA'S OWN ASTERISK, CUT BY THE EDGE (founder, 2026-11-27, choosing
   "C. An asterisk cut by the edge" of three) ═══ The four-point spark read as
   another company's AI button, and a star is a word WAKA retired. The mark
   is now *, ASCII 42, the wildcard WAKA is named for: six rounded strokes at
   the weight of the Jost text, 56px tall. Part of it is off screen, so it
   says "more this way" with light alone. The 24-unit glyph is cropped by its
   own viewBox, 40 of its 56px showing, so the cut is the svg's edge laid on
   the screen's edge and nothing overflows the page. Home's shows its left
   part at the right edge; Principles' shows the same mark mirrored at the
   left edge, its right part, the part home kept off screen (founder,
   2026-11-19: "there should be the same star on the left to go back"). */
const ASTERISK_SHOWN = (24 * 40) / 56;
const ASTERISK_VIEW = {
  right: `0 0 ${ASTERISK_SHOWN} 24`,
  left: `${24 - ASTERISK_SHOWN} 0 ${ASTERISK_SHOWN} 24`,
} as const;

/** The asterisk both Principles doors wear, cut by the screen edge it sits
    on: home's at the right walks to Principles, Principles' at the left
    walks home. */
export function PrinciplesAsterisk({ edge }: { edge: "left" | "right" }): JSX.Element {
  return (
    <svg viewBox={ASTERISK_VIEW[edge]} aria-hidden="true" focusable="false" data-edge={edge}>
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 3.5v17" />
        <path d="M4.64 7.75l14.72 8.5" />
        <path d="M4.64 16.25l14.72-8.5" />
      </g>
    </svg>
  );
}

/**
 * ═══ THE FIRST PRINCIPLE, ONCE, IN LIGHT (insight goal, phase 5; canvas
 * "Your first principle"; the meeting's "this should be a wow moment") ═══
 * The saves it came from drift into the creature as light, then the
 * principle forms above it in large type, answerable: That's me affirms it,
 * Not quite opens it to be corrected. Shown only the first time a person
 * meets their principles (`arriving`); under reduced motion the drift is
 * skipped and the words are simply there.
 */
/**
 * THE REVEAL'S WORDS, shared with the week's card (`WeeklyCard`), so the two
 * screens are one: a small muted label, the statement in large light type,
 * "From n of your saves", and under them what that screen offers (the
 * reveal's That's me / Not quite, the week's "My week · …" and mark).
 */
export function RevealWords({ label, statement, from, children }: {
  label: string; statement: string; from: string; children?: ReactNode;
}): JSX.Element {
  return (
    <div className="waka-reveal-words">
      <span className="waka-reveal-label">{label}</span>
      <span className="waka-reveal-statement">{statement}</span>
      <span className="waka-reveal-from">{from}</span>
      {children}
    </div>
  );
}

function FirstPrincipleReveal({ locale, row, onAffirm, onNotQuite }: {
  locale: SupportedLocale; row: ApiPrinciple; onAffirm: () => void; onNotQuite: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [formed, setFormed] = useState(Boolean(still));
  useEffect(() => { if (formed) return; const id = window.setTimeout(() => setFormed(true), 2600); return () => window.clearTimeout(id); }, [formed]);
  const motes = row.citedSignals.flatMap(signal => signal.examples ?? []).slice(0, 4);
  const count = new Set(row.citedSignals.flatMap(signal => (signal.examples ?? []).map(example => example.text))).size || row.citedSignals.length;
  return (
    <div className={`waka-reveal${formed ? " waka-reveal--formed" : ""}`} role="dialog" aria-modal="true" aria-label={say("worldPrincipleFirstLabel")}>
      {formed ? null : motes.map((mote, index) => (
        <span key={index} className="waka-reveal-mote" aria-hidden="true"
          style={{ ["--from-x" as string]: `${[-110, 90, -70, 120][index]}px`, ["--from-y" as string]: `${[-250, -210, -150, -110][index]}px`, animationDelay: `${index * 220}ms` }}>
          {mote.text.slice(0, 40)}
        </span>
      ))}
      {formed ? <RevealWords label={say("worldPrincipleFirstLabel")} statement={row.statement}
        from={formatMessage(locale, "worldReadingFromCount", { count })}>
        <span className="waka-reveal-acts">
          <button type="button" autoFocus onClick={onAffirm}>{say("worldPrincipleThatsMe")}</button>
          <button type="button" className="waka-reveal-act--quiet" onClick={onNotQuite}>{say("worldReadingNotQuite")}</button>
        </span>
      </RevealWords> : null}
    </div>
  );
}
