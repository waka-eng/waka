/**
 * YOUR PRINCIPLES — cards you would hold up, not lines in a list.
 *
 * Founder: "I want your principles page to be something where people would
 * love to share them. Brainstorm different ways to design an experience where
 * people have the urge and motivation to want to share this publicly. And
 * that also means principles might not be its own section, or something
 * else."
 *
 * WHY NOBODY WOULD HAVE SHARED THE LIST. The machinery for sharing was
 * already finished and good — `PrincipleShare` renders a real image, offers a
 * square or a story, remembers drafts. None of that was the problem. The
 * problem was upstream of it: the surface you arrived at was a column of
 * sentences in a text colour, and a list is not a thing a person shares.
 * You share ONE statement with a shape around it. A screenshot of a list is
 * illegible, which is the honest test of whether something was ever
 * shareable, and the list failed it.
 *
 * So the urge is not created by a share button. It is created by the artifact
 * ALREADY BEING ON SCREEN. These cards are the artifact at reading size — the
 * same statement, the same display face, the same attribution and the same
 * proof line that the exported image carries. By the time anyone presses
 * share they have already seen the thing they would be sharing and decided
 * they like it. The button stops persuading and starts obeying.
 *
 * THE PROOF LINE IS THE WHOLE DIFFERENCE between this and a fortune cookie.
 * "I'd rather ship something ugly than wait for perfect" is a nice sentence
 * anyone could type. "Held since August, drawn from 14 things you kept" is
 * the part a stranger cannot fake and cannot look away from, because it says
 * the sentence was EARNED by a year of small honest acts rather than written
 * in a moment of self-regard. That is what makes the card worth showing and
 * what makes it true. It comes from `heldSince` and `citedSignals`, which the
 * reader was already returning and the list was already throwing away.
 *
 * ONE LINE EACH, AND NOTHING ELSE ON THE CARD. Founder ruling, still
 * standing: "a principle shouldn't be overly explained. It should be so good
 * the user reads it and goes yeah, this is like me." No confidence score, no
 * citation list, no kind, no state. All of it exists and all of it is a press
 * away on the principle itself. What this surface is FOR is recognising
 * yourself, and every number beside a sentence is something to read instead
 * of the sentence. The proof line survives that rule because it is not about
 * the statement — it is about you.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { PrinciplesGround } from "./PrinciplesGround";
import { Companion } from "./Companion";
import { TimelessSky } from "./TimelessSky";
import { CrossingCompanion, type CreatureSpot } from "./CrossingCompanion";
import { readProfileText, writeProfileText } from "../lib/profile-storage";
import { fetchPrinciples, type ApiPrinciple } from "../lib/api";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { monthTag, numWords } from "../lib/words";

type Phase = "loading" | "ready" | "failed";

/**
 * HOW MANY KEPT THINGS STAND BEHIND A PRINCIPLE.
 *
 * The examples under each cited signal are the actual saves, so they are what
 * the line should count — a person recognises "14 things I kept" and has no
 * feel at all for "3 signals". Signals are the fallback only, because an
 * older server returns the citation without its examples and a card that
 * silently claims zero would be the one lie on a surface whose entire value
 * is that its numbers are real.
 */
function evidenceCount(row: ApiPrinciple): number {
  const saves = row.citedSignals.reduce((sum, signal) => sum + (signal.examples?.length ?? 0), 0);
  return saves || row.citedSignals.length;
}

/**
 * THE MONTH A PRINCIPLE STARTED BEING TRUE, which is as precise as anyone
 * needs. A day would imply the statement arrived at 14:32 on a Tuesday.
 *
 * THE WORDS ARE `words.ts`'S, NOT THIS FILE'S — the same correction
 * `Home.tsx` records against the dial's own label, for the same reason, one
 * surface later. This function carried
 * `toLocaleDateString(locale, { month: "long", year: "numeric" })` and so
 * printed `October 2026` in English and `2026년 10월` in Korean, while
 * `monthTag` — the module function whose doc comment answers this exact
 * question — says `October twenty twenty-six` and `이천이십육년 시월`.
 *
 * Both of those are wrong in a way worth naming rather than just fixing. The
 * English broke this module's year rule; the Korean broke its own stated law,
 * "counts are prose here, never digits". And it broke them on the PROOF
 * LINE — the half of the card a stranger cannot fake, which is the whole
 * reason the card is shareable (see this file's header). A person reading the
 * dial and then this page saw one fact in two registers.
 *
 * WHAT IS LEFT HERE is the part that is genuinely this surface's decision:
 * which GRAIN of date to ask for (a month, not a day) and what an unreadable
 * timestamp means (no line at all, rather than a line that says "Invalid
 * Date"). The phrasing belongs to the module. `monthTag` is called rather
 * than copied so that the next change to how this world speaks a month
 * reaches this card without anybody remembering it exists.
 */
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

export function PrinciplesOverlay({ locale, profileId, name, title, whose = "own", onClose, onOpen, onShare, onChat, crossing = null, onCrossed }: {
  locale: SupportedLocale;
  profileId?: string | null;
  /** Whose name goes on the card. The attribution is half of why a card is
      worth showing anyone, so an unnamed profile simply drops the line
      rather than printing an empty byline. */
  name: string;
  title: string;
  /** Whose principles these are — the bubble must not call an agent's
      principles yours. Chosen by Home the same way it chooses `title`. */
  whose?: "own" | "agent";
  onClose: () => void;
  onOpen: (id: string) => void;
  /** Straight to the artifact. Optional so a surface that cannot share —
      somebody else's principles, read-only — simply does not offer it. */
  onShare?: (id: string) => void;
  /** A chat about what the creature said on the waiting page. */
  onChat?: (said: string) => void;
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
  /* EVERY VISIBLE LINE SAYS WHOSE THESE ARE (review, 2026-10-16). With the
     title for screen readers only, the page's own words are the only
     attribution left, so on an agent's wall none of them may say "your". */
  const agent = whose === "agent";
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
  const arrivalScope = profileId ? { accountId: "p", profileId } : null;
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);
  const pull = useRef<{ id: number; x: number; y: number } | null>(null);
  /* LATCHED. The walk in is decided once, on arrival; the walk out arrives
     later, as a new prop on a page that is already up. The sky reads the
     same object for the whole stay, so finishing a walk never restarts it. */
  const [walk, setWalk] = useState(() => (crossing?.home ? { ...crossing, from: crossing.home } : null));
  const [walking, setWalking] = useState(walk !== null);
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
    const from = walking && walk?.going === "in" ? crossing.home : pageCreature();
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
          onDone={() => {
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
        {/* NO TITLE ON THE PAGE; THE CREATURE SAYS WHERE YOU ARE. Founder,
            2026-10-16: "remove your principles text at the top. ensure the
            character always mention sth principle so its clear this page is
            principles". The heading stays for screen readers only; what a
            sighted reader learns it from is the bubble below. The one-visit
            "what is this" line went with it — the bubble now says it every
            visit, in the creature's voice. */}
        <header className="waka-over-head sr-only">
          <h2 className="waka-over-title">{title}</h2>
        </header>
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
          <PrinciplesGround locale={locale} profileId={profileId} whose={whose} onChat={agent ? undefined : onChat} />
        ) : (
          <>
          {/* THE CREATURE THAT WAITED WITH YOU PRESENTS IT. Same body, same
              bubble as the waiting page, so the arrival reads as the end of
              that wait rather than as a list that happened to fill. */}
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
               one who walked here, so the page keeps it in view. */
            <div className="waka-ground-hero waka-ground-hero--ready waka-held-hero" style={{ ["--charge" as string]: 1 }}>
              <div className="jar-char-bubble-body waka-ground-bubble waka-held-says">
                <span className="jar-char-bubble-reading">{say(agent ? "worldPrinciplesWhatIsAgent" : "worldPrinciplesWhatIs")}</span>
              </div>
              <span className="waka-ground-being" data-crossing-target="88" style={{ ["--being" as string]: "90px" }}><Companion size={88} /></span>
            </div>
          )}
          <ul className="waka-held">
            {/* THREE AT MOST, ONE ABOVE THE OTHER. Founder, 2026-10-16:
                "have max 3 principles only. vertical list of three". The
                rows arrive ranked, so the three are the top three. */}
            {rows.slice(0, MAX_HELD).map((row, index) => {
              const since = heldSince(row, locale);
              const from = evidenceCount(row);
              return (
                <li key={row.id} className={`waka-held-card${arriving && index === 0 ? " waka-held-card--arriving" : ""}`}>
                  {/* THE STATEMENT IS THE PRESS, AND SHARING IS ITS OWN.
                      This was one button wrapping the whole card, which was
                      right when the card did one thing. It does two now, and
                      a button inside a button is not markup — so the card is
                      a container and the statement is the control that fills
                      it. Pressing anywhere in the empty space still opens the
                      principle, because the statement's button is the part
                      that grows. */}
                  <button type="button" className="waka-held-open" onClick={() => onOpen(row.id)}>
                    <span className="waka-held-words">{row.statement}</span>
                  </button>
                  <span className="waka-held-foot">
                    <span className="waka-held-proof">
                      {name ? <span className="waka-held-who">{name}</span> : null}
                      {/* THE TWO HALVES OF THE PROOF ARE ONE SENTENCE, because
                          "held since August" alone reads as a timestamp and
                          "from 14 things you kept" alone reads as a statistic.
                          Together they say the only thing worth saying: this
                          took a while and it came from somewhere real. */}
                      {/* THE COUNT IS SPOKEN, THE NUMBER IS ONLY FOR THE PLURAL.
                          "states render, numerals never" — and this line read
                          "drawn from 14 things you kept" in English and
                          "저장한 14개에서" in Korean, which is the law broken in
                          both languages on a surface whose whole job is to say
                          a principle was earned rather than counted. `words.ts`
                          already held `numWords`; nothing routed through it.

                          BOTH ARGUMENTS ARE PASSED ON PURPOSE. ICU selects the
                          plural branch from a NUMBER, so `count` has to stay —
                          it is never printed. `countWords` is what the reader
                          sees. Giving the selector words would silently pick
                          "other" for every value including one. */}
                      {since && from
                        ? formatMessage(locale, agent ? "worldPrincipleEarnedAgent" : "worldPrincipleEarned", { since, count: from, countWords: numWords(from, locale) })
                        : since
                          ? formatMessage(locale, "worldPrincipleSince", { since })
                          : from
                            ? formatMessage(locale, agent ? "worldPrincipleFromAgent" : "worldPrincipleFrom", { count: from, countWords: numWords(from, locale) })
                            : null}
                    </span>
                    {/* ONE PRESS FROM SEEING IT TO SHARING IT.
                        Founder: "I want your principles page to be something
                        where people would love to share them... design an
                        experience where people have the urge and motivation
                        to want to share this publicly."

                        The urge is made by the card; this is what it costs to
                        act on it, and it used to cost two more presses —
                        open the principle, find "Make a share card" there.
                        A want that has to be carried through two screens is
                        mostly abandoned on the first. The share surface is
                        also simply the bigger version of what is already on
                        screen, so this reads as "yes, that one" rather than
                        as going somewhere else.

                        It keeps its full words rather than becoming an icon:
                        founder, on a cog that did not look like settings,
                        "make settings look like settings". A glyph for an act
                        nobody performs often is a guess the reader has to
                        make. */}
                    {onShare ? (
                      <button type="button" className="waka-held-share" onClick={() => onShare(row.id)}>
                        {say("worldSharePrinciple")}
                      </button>
                    ) : null}
                  </span>
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
