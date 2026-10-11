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
 * ── THE ANSWERS ARE THE PRODUCT'S ONE ANSWER REGISTER ─────────────────────
 *
 * `.jar-char-claim-answers`, shared with the creature's claim and the top of
 * mind's wall — see Law 11 in `docs/six-laws.md`. Three peers, no primary,
 * because lighting "yes" puts a thumb on the scale of every principle written
 * downstream. A person answering eight claims in a row is exactly who that
 * ruling protects.
 *
 * ── AN ANSWERED CLAIM DOES NOT VANISH ─────────────────────────────────────
 *
 * It stays on screen wearing its answer. A row that disappears on press takes
 * its own receipt with it: you cannot tell a successful answer from a lost
 * one, and you cannot change your mind about the thing you just did. The list
 * is re-read on the next open, so the queue is still a queue — it simply does
 * not move under the hand that is working it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { listClaims, type ApiClaim } from "../lib/api/claims";
import { t, type SupportedLocale } from "../lib/locales";

type Phase = "loading" | "ready" | "failed";
type Verdict = "true" | "partly" | "not_true";

export interface ClaimsOverlayProps {
  locale: SupportedLocale;
  onClose: () => void;
  /** Files the verdict. Owned by the world, so this surface goes through the
      same writer as the creature's claim rather than a second one that could
      disagree with it about who is standing here. */
  onAnswer: (id: string, value: Verdict, revision?: string) => void;
  /**
   * Answers already filed this session, so a reopened overlay does not ask
   * again about something that was just settled.
   *
   * WIDER THAN `Verdict`, ON PURPOSE. The world's map carries a fourth state,
   * `gone`, for a signal that is no longer there to be ruled on. Narrowing
   * the world's type to this surface's three would make the caller cast, and
   * a cast is how a fifth state arrives here unannounced one day. The read
   * below ignores anything that is not one of the three answers, so a `gone`
   * claim simply shows its buttons — which is the honest behaviour, since the
   * list it came from only contains claims the server still considers open.
   */
  answered?: ReadonlyMap<string, Verdict | "gone">;
}

export function ClaimsOverlay({ locale, onClose, onAnswer, answered }: ClaimsOverlayProps) {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<ApiClaim[]>([]);
  /* Answers filed from THIS surface, merged over the ones the world already
     knew. Local, because the overlay must show the answer in the same beat it
     was pressed — a judgement about yourself should not wait on a round trip,
     which is the ruling the creature's claim already follows. */
  const [mine, setMine] = useState<Map<string, Verdict>>(new Map());
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
  const verdictOf = (id: string): Verdict | undefined => {
    const said = mine.get(id) ?? answered?.get(id);
    return said === "true" || said === "partly" || said === "not_true" ? said : undefined;
  };

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
          <button
            type="button"
            className="waka-over-close"
            aria-label={say("worldCardClose")}
            onClick={onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path
                d="M2 2l8 8M10 2l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {/* The surface says what it is, in the place the question gets asked —
            the same one line the other three overlays carry. */}
        <p className="waka-over-what">{say("worldClaimsWhatIs")}</p>

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
            {rows.map((row) => {
              const verdict = verdictOf(row.id);
              const from = row.from ?? [];
              return (
                <li key={row.id} className="waka-claim">
                  <p className="waka-claim-statement">{row.statement}</p>

                  {/* THE RECEIPTS, ALWAYS, NOT BEHIND A PRESS. See this file's
                      header: the saves are the difference between a reading
                      and a horoscope. Absent on an older server and empty when
                      every save behind it has since been deleted — in both
                      cases the claim renders without them rather than
                      pretending to a proof it does not have. */}
                  {from.length > 0 ? (
                    <ul className="waka-claim-from">
                      {from.map((source) => (
                        <li key={source.id}>{source.preview}</li>
                      ))}
                    </ul>
                  ) : null}

                  {verdict ? (
                    /* IT WEARS ITS ANSWER RATHER THAN DISAPPEARING. A row that
                       vanishes on press takes its own receipt with it. */
                    <p className="waka-claim-said" role="status">
                      {say(
                        verdict === "true"
                          ? "worldYouAnsweredYes"
                          : verdict === "partly"
                            ? "worldYouAnsweredPartly"
                            : "worldYouAnsweredNotTrue",
                      )}
                    </p>
                  ) : (
                    <p className="jar-char-claim-answers">
                      {(["true", "partly", "not_true"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setMine((prev) => new Map(prev).set(row.id, value));
                            onAnswer(row.id, value, row.statementRevision);
                          }}
                        >
                          {say(
                            value === "true"
                              ? "worldYes"
                              : value === "partly"
                                ? "worldPartly"
                                : "worldNotTrue",
                          )}
                        </button>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogSurface>
    </div>
  );
}
