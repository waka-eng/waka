/**
 * ═══ YOUR TOP OF MIND, ON A PAGE YOU CAN ANSWER ═════════════════════════
 *
 * Founder, with a screen recording of 썸원's question page: "the agent's
 * speech bubble should show its top of mind at the moment. And the user can
 * click on it to go to a new page where the user can engage with it... it
 * should show the text and let the user engage with it. And the bottom part
 * here should also be something they can quickly engage with."
 *
 * THE REFERENCE'S PAGE IS FOUR THINGS and this is the same four: a chevron,
 * the sentence in full with nothing competing with it, a quiet meta line
 * under it, and then the responses — with a bar across the bottom for the one
 * move you are most likely to want.
 *
 * ── WHY IT BECAME A PAGE RATHER THAN AN EXPANSION ────────────────────────
 *
 * The reading used to BE the home screen: a centred `h1` with everything it
 * stands on folded under it, opened by pressing the heading. Two things went
 * wrong with that at once.
 *
 * It was in the creature's way. The reading is what the creature is holding
 * up — so once the bubble carried it (founder: "the speech bubble should show
 * its top of mind at the moment") the home screen printed the same sentence
 * twice, sixty pixels apart, in two registers. That is the duplication this
 * product has already been caught by three times.
 *
 * And the folded block was a page pretending not to be one. Four signals with
 * three answers each, a provenance chain and a correction field do not fit
 * under a creature's chin, and squeezing them there is what made the home
 * screen "try to do too much at once" in the founder's words.
 *
 * ── LAW 11, WHICH IS THE WHOLE OF WHAT IS BELOW THE SENTENCE ─────────────
 *
 * Under a statement that claims to describe a person, the controls must let
 * them RESPOND — yes, not quite, not me — never only administer the artifact.
 * So there is no regenerate, no pin, no reorder here. What the page offers is
 * what the reading stands ON, each one answerable, because a reading is only
 * ever as true as the signals under it and correcting one of those is how you
 * correct the reading itself.
 *
 * ── WHAT STAYED ON THE HOME SCREEN, AND WHY ──────────────────────────────
 *
 * "Back to today" and the dial's own controls: those are about WHERE IN TIME
 * you are standing, which is a fact about the world rather than about the
 * sentence. Moving them here would make the way out of a scrubbed date live
 * inside a page you can only reach from the present.
 */
import { useCallback } from "react";

import { DialogSurface } from "./DialogSurface";
import { t, type SupportedLocale } from "../lib/locales";
import { dateWords } from "../lib/words";

export interface ReadingGround {
  id: string;
  statement: string;
  statementRevision?: string;
  answered: boolean;
  contested: boolean;
}

export function ReadingPage({
  locale,
  statement,
  whenMs,
  grounds,
  builtFrom,
  onGround,
  onBuiltFrom,
  onTalk,
  talking,
  onClose,
}: {
  locale: SupportedLocale;
  statement: string;
  /** When this reading was written. `null` when the board carries no date —
      an older artifact — in which case the line simply does not appear
      rather than printing a guess. */
  whenMs: number | null;
  grounds: ReadingGround[];
  /** Whether there is a chain to open. A reading written by hand has none,
      and saying so is more useful than an empty band. */
  builtFrom: boolean;
  onGround: (id: string, value: "true" | "partly" | "not_true", contested: boolean, revision?: string) => void;
  onBuiltFrom: () => void;
  onTalk: () => void;
  talking: boolean;
  onClose: () => void;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const now = Date.now();

  return (
    <div className="waka-page">
      <DialogSurface className="waka-over waka-over--reading" aria-label={say("worldMenuTopOfMind")} onClose={onClose}>
        {/* THE CHEVRON, WHERE THE NOTEPAD PUTS ITS OWN. Two pages, one way
            back, in the same corner — which is the only reason a chevron can
            be wordless: it means the same thing everywhere it appears. */}
        <header className="waka-over-head waka-over-head--reading">
          <button type="button" className="jar-note-back" aria-label={say("worldBack")} onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" focusable="false">
              <path d="M8 2 3.5 6.5 8 11" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>

        {/* THE SENTENCE, AND NOTHING LEVEL WITH IT. */}
        <h2 className="waka-reading-statement">{statement}</h2>

        {/* The quiet line the reference keeps under its question: when this
            is, and what it rests on, said in words rather than counted. */}
        <p className="waka-reading-when">
          {whenMs !== null ? dateWords(whenMs, now, locale) : null}
          {whenMs !== null && grounds.length > 0 ? <span aria-hidden="true"> · </span> : null}
          {grounds.length > 0 ? say("worldStandingOn") : say("worldWrittenByHand")}
        </p>

        {grounds.length > 0 ? (
          <ul className="waka-reading-grounds">
            {grounds.map((ground) => (
              <li key={ground.id} className="waka-reading-ground">
                <p className={`waka-reading-ground-statement${ground.answered ? " waka-reading-ground-statement--answered" : ""}`}>
                  {ground.statement}
                </p>
                {/* THREE PEERS, NO PRIMARY. The register the product already
                    answers a claim in — `jar-char-claim-answers` — because
                    this is the same act on the layer below: a sentence about
                    you, and somewhere to put the reaction in the second it
                    happens. */}
                <p className="jar-char-claim-answers">
                  <button type="button" onClick={() => onGround(ground.id, "true", ground.contested, ground.statementRevision)}>
                    {say("worldYes")}
                  </button>
                  <button type="button" onClick={() => onGround(ground.id, "partly", ground.contested, ground.statementRevision)}>
                    {say("worldPartly")}
                  </button>
                  <button type="button" onClick={() => onGround(ground.id, "not_true", ground.contested, ground.statementRevision)}>
                    {say("worldNotTrue")}
                  </button>
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {builtFrom ? (
          <button type="button" className="waka-reading-chain jar-label" onClick={onBuiltFrom}>
            {say("worldBuiltFrom")}
          </button>
        ) : null}
      </DialogSurface>

      {/* ═══ THE QUICK ONE, ALONG THE BOTTOM ═══════════════════════════════
          Founder: "the bottom part here should also be something they can
          quickly engage with."

          One move, because there is one that matters: saying more about this
          than three answers can hold. It sits beside the dock rather than
          inside it for the reason the notepad's pill does — the dock is
          places, and this is about the sentence you are reading. */}
      <button type="button" className="waka-reading-talk" disabled={talking} onClick={onTalk}>
        {say(talking ? "worldTalkOpening" : "worldTalkAboutThis")}
      </button>
    </div>
  );
}
