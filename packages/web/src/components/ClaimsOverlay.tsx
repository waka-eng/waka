/**
 * YOUR CLAIMS — the rung of the ladder that was never given a room.
 *
 * Founder: "Maybe it should be a separate experience for my inspirations,
 * claims, and top of mind and principles rather than have things in one
 * place." And, on the home screen that held all of them at once: "I feel
 * like this page is trying to do too much at once."
 *
 * ── WHY THIS IS THE FOURTH RUNG AND NOT A FOURTH TAB ──────────────────────
 *
 * `page-menu.ts` describes the switcher as "the same material at three
 * depths: what you kept, what it adds up to now, and what has endured". The
 * data model has always had FOUR layers — inspiration, signal, top of mind,
 * principle — and the signals were the one with no door. They were visible
 * only one at a time, on the home screen, in the creature's mouth.
 *
 * That is the right place for ONE of them: a claim arriving unasked is the
 * creature noticing something, and that is the product's whole character. It
 * is the wrong place for a QUEUE. Answering eight in a row is a different
 * activity on a different clock — it is sitting down to work rather than
 * being met — and it had nowhere to happen.
 *
 * So the rungs now read as the ladder they always were:
 *
 *   what you kept  ->  what it is noticing  ->  what it adds up to now
 *                                          ->  what has endured
 *
 * ── WHAT A CLAIM NEEDS THAT THE HOME SCREEN COULD NOT GIVE IT ─────────────
 *
 * THE SAVES UNDERNEATH, EVERY TIME. `api/claims.ts` states the reason and it
 * is the sharpest sentence in that file: "A claim with no material under it
 * can only be agreed or disagreed with on vibes; with the saves visible it
 * can be CHECKED, which is the whole difference between a reading and a
 * horoscope." The creature has room for a sentence and three answers; it has
 * no room for the receipts. Here there is room, so they are always shown and
 * never behind a press.
 *
 * It also changes what "not true" MEANS. With the evidence on screen,
 * rejecting a claim is correcting a misreading — you can see which save was
 * misread. Without it, you are being told who you are and have to argue back
 * from nothing.
 *
 * ── THE ROOM ADVERTISES THE QUEUE. IT NEVER ANSWERS ONE ──────────────────
 *
 * Founder, on the first version of this surface: "your claims are duplicated
 * so that's like even bad."
 *
 * Correct, and it was structural rather than cosmetic. This room rendered the
 * same unanswered claim, with the same three answers, that the creature was
 * asking on the home screen — so the product had two places to do one thing
 * and no rule saying which was real.
 *
 * THE RULE EVERY SHIPPING PRODUCT FOLLOWS, found by looking at six of them:
 * a queue has exactly ONE surface where an item is answerable; other surfaces
 * may advertise that the queue exists and how heavy it is, and must never
 * render an answerable item. GitHub's notification badge carries zero item
 * content and the inbox is the only place anything can be acted on. Anki
 * shows the day's load on the deck screen and NEVER renders a card there —
 * doorway, then work. Linear's Priority and Other are a partition of one
 * inbox, not two copies of it.
 *
 * So the creature is where a claim is answered, always and only. This room is
 * the deck screen: it shows what WAKA is noticing and the saves each reading
 * leans on, and pressing one does not answer it — it HANDS IT TO THE CREATURE
 * and gets out of the way. The duplication is now impossible rather than
 * discouraged, and the room keeps the job the home screen cannot do: the
 * evidence does not fit in a creature's mouth, and here there is room for it.
 *
 * ── WHY NOT A BACKLOG OF ANSWERED ONES ───────────────────────────────────
 *
 * That is the better destination and it is blocked, not declined: `ApiSignal`
 * carries no verdict, so "the claim, and what you said about it" cannot be
 * rendered without a server change. When it can, this room should become
 * exactly that — the correction channel's archive and the evidence trail for
 * how the top of mind got written, which is a reason to visit that is not
 * guilt.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { useFirstVisit } from "../lib/first-visit";
import { listClaims, type ApiClaim } from "../lib/api/claims";
import { t, type SupportedLocale } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";

export interface ClaimsOverlayProps {
  locale: SupportedLocale;
  onClose: () => void;
  /** Hands this claim to the creature and closes. The verdict is filed on the
      home screen, by the one surface allowed to take it. */
  onAsk: (id: string) => void;
  /**
   * Answers already filed this session, so a claim settled with the creature
   * a moment ago is not still advertised here as waiting.
   *
   * WIDER THAN THE THREE ANSWERS, ON PURPOSE: the world's map carries `gone`
   * for a signal that is no longer there to be ruled on. Narrowing it here
   * would make the caller cast, and a cast is how a fifth state arrives
   * unannounced.
   */
  answered?: ReadonlyMap<string, "true" | "partly" | "not_true" | "gone">;
}

export function ClaimsOverlay({ locale, onClose, onAsk, answered }: ClaimsOverlayProps) {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const newHere = useFirstVisit(null, "claims");
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<ApiClaim[]>([]);
  const alive = useRef(true);

  const load = useCallback(() => {
    setPhase("loading");
    listClaims({ limit: 40 })
      .then(({ claims }) => {
        if (!alive.current) return;
        setRows(claims);
        setPhase("ready");
      })
      .catch(() => {
        if (alive.current) setPhase("failed");
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const title = say("worldMenuClaims");
  /* Settled with the creature during this session, so it stops being
     advertised here as waiting. */
  const settled = (id: string): boolean => {
    const said = answered?.get(id);
    return said === "true" || said === "partly" || said === "not_true";
  };

  return (
    <div className="waka-page">
      <DialogSurface
        className="waka-over"
        aria-label={title}
        onClose={onClose}
        >
        <header className="waka-over-head">
          <h2 className="waka-over-title">{title}</h2>
        </header>

        {/* SAID ONCE — see `useFirstVisit`. The queue is the surface where
            a stranger is least likely to guess what is being asked of
            them, so it is the one that most wants a sentence on a first
            visit and least wants one on the fortieth. */}
        {newHere ? <p className="waka-over-what">{say("worldClaimsWhatIs")}</p> : null}
        {phase === "loading" ? (
          <p className="waka-over-status" role="status">
            {say("worldClaimsLoading")}
          </p>
        ) : phase === "failed" ? (
          <>
            <p className="waka-over-status" role="alert">
              {say("worldClaimsFailed")}
            </p>
            <button type="button" className="waka-over-retry" onClick={() => load()}>
              {say("worldRetry")}
            </button>
          </>
        ) : rows.length === 0 ? (
          /* NOTHING WAITING IS A GOOD STATE, NOT AN ABSENCE. This surface is
             empty when the person is caught up, which is most of the time for
             somebody who uses the product — so the line says that rather than
             describing a hole. */
          <p className="waka-over-status">{say("worldClaimsEmpty")}</p>
        ) : (
          <ul className="waka-claims">
            {rows.filter((row) => !settled(row.id)).map((row) => {
              const from = row.from ?? [];
              return (
                <li key={row.id} className="waka-claim">
                  {/* THE WHOLE ROW IS A DOORWAY, NOT A JUDGEMENT. Pressing it
                      hands this claim to the creature and closes this surface,
                      so the one place a verdict can be filed stays the one
                      place a verdict can be filed. The verb rides on the
                      statement rather than in a button beside it, because the
                      statement IS the thing you want to go and think about and
                      a separate button would be a second target for one
                      intention. */}
                  <button
                    type="button"
                    className="waka-claim-open"
                    onClick={() => onAsk(row.id)}
                  >
                    <span className="waka-claim-statement">{row.statement}</span>
                  </button>

                  {/* THE RECEIPTS, ALWAYS, NOT BEHIND A PRESS — and this is
                      the room's entire reason to exist. `api/claims.ts` has
                      the sentence: "A claim with no material under it can only
                      be agreed or disagreed with on vibes; with the saves
                      visible it can be CHECKED, which is the whole difference
                      between a reading and a horoscope." The evidence does not
                      fit in a creature's mouth; here there is space for it. */}
                  {from.length > 0 ? (
                    <ul className="waka-claim-from">
                      {from.map((source) => (
                        <li key={source.id}>{source.preview}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </DialogSurface>
    </div>
  );
}
