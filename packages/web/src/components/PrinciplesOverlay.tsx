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
import { fetchPrinciples, type ApiPrinciple } from "../lib/api";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";

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

/** The month a principle started being true, which is as precise as anyone
    needs. A day would imply the statement arrived at 14:32 on a Tuesday. */
function heldSince(row: ApiPrinciple, locale: SupportedLocale): string | null {
  if (!row.heldSince) return null;
  const when = new Date(row.heldSince);
  return Number.isNaN(when.getTime())
    ? null
    : when.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function PrinciplesOverlay({ locale, profileId, name, title, onClose, onOpen, onShare }: {
  locale: SupportedLocale;
  profileId?: string | null;
  /** Whose name goes on the card. The attribution is half of why a card is
      worth showing anyone, so an unnamed profile simply drops the line
      rather than printing an empty byline. */
  name: string;
  title: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  /** Straight to the artifact. Optional so a surface that cannot share —
      somebody else's principles, read-only — simply does not offer it. */
  onShare?: (id: string) => void;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [rows, setRows] = useState<ApiPrinciple[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const mounted = useRef(true);

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
    } catch {
      if (!mounted.current) return;
      setPhase("failed");
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="waka-over-scrim" onClick={onClose}>
      <DialogSurface
        className="waka-over"
        aria-label={title}
        onClose={onClose}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="waka-over-head">
          <h2 className="waka-over-title">{title}</h2>
          <button type="button" className="waka-over-close" aria-label={say("worldCardClose")} onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {phase === "loading" ? (
          <p className="waka-over-status" role="status">
            {say("worldPrinciplesLoading")}
          </p>
        ) : phase === "failed" ? (
          <>
            <p className="waka-over-status" role="alert">
              {say("worldPrinciplesFailed")}
            </p>
            <button type="button" className="waka-over-retry" onClick={() => void load()}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          <p className="waka-over-status">{say("worldPrinciplesEmpty")}</p>
        ) : (
          <ul className="waka-held">
            {rows.map((row) => {
              const since = heldSince(row, locale);
              const from = evidenceCount(row);
              return (
                <li key={row.id} className="waka-held-card">
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
                      {since && from
                        ? formatMessage(locale, "worldPrincipleEarned", { since, count: from })
                        : since
                          ? formatMessage(locale, "worldPrincipleSince", { since })
                          : from
                            ? formatMessage(locale, "worldPrincipleFrom", { count: from })
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
        )}
      </DialogSurface>
    </div>
  );
}
