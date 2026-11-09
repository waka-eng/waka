/**
 * ═══ READING THE THREE, THEN THE FIRST READ ══════════════════════════════
 *
 * `OnboardingReading` holds the screen while the first read is made: three
 * lights drift into the creature, eyes closed. `OnboardingReveal` puts the
 * read in the creature's bubble, labelled as early — no count, no numeral —
 * with the two acts every read on home carries: Why? (the saves behind it)
 * and Talk about this. Continue lands on the normal home.
 */
import { useState } from "react";

import { t, type SupportedLocale } from "../../lib/locales";
import type { MessageKey } from "../../lib/i18n";
import { CreatureSlot } from "./CreatureStage";
import { SayBubble } from "./SayBubble";

const ORBS: Array<[number, string, string]> = [
  [12, "#f1e9d6", "onb-drift-a 2.4s"],
  [10, "#e9dcc0", "onb-drift-b 2.8s"],
  [11, "#f6f0e3", "onb-drift-c 2.2s"],
];

export function OnboardingReading({ locale, error = "", busy = false, onContinue }: {
  locale: SupportedLocale;
  /** Set when going in failed; the way in is then offered by hand. */
  error?: string;
  busy?: boolean;
  onContinue?: () => void;
}): JSX.Element {
  const say = (key: MessageKey) => t(locale, key);
  return (
    <main className="onb onb--deep onb-arrive">
      <div className="onb-stage onb-reading">
        <div className="onb-orbs">
          {ORBS.map(([size, colour, motion]) => (
            <span key={motion} className="onb-orb" style={{ width: size, height: size, background: colour,
              boxShadow: `0 0 18px ${colour}`, animation: `${motion} ease-in-out infinite alternate` }} />
          ))}
          <CreatureSlot size="large" eyes="closed" glasses style={{ position: "absolute", left: 0, top: 0 }} />
        </div>
        <p className="onb-reading-words" role="status">{say("onboardingReading")}</p>
        {error && onContinue ? (
          <div className="onb-reading-wait">
            <p className="onb-error" role="alert">{error}</p>
            <button type="button" className="onb-go" disabled={busy} onClick={onContinue}>{say("onboardingContinue")}</button>
          </div>
        ) : <p className="onb-reading-wait">{say("onboardingReadingWait")}</p>}
      </div>
    </main>
  );
}

export function OnboardingReveal({ locale, reading, behind, busy, error, onTalk, onContinue }: {
  locale: SupportedLocale;
  reading: string;
  /** The answers the read was made from, as their first lines. */
  behind: string[];
  busy: boolean;
  error: string;
  onTalk: () => void;
  onContinue: () => void;
}): JSX.Element {
  const say = (key: MessageKey) => t(locale, key);
  const [why, setWhy] = useState(false);
  return (
    <main className="onb onb--lift onb-arrive">
      <div className="onb-stage onb-reveal">
        <div className="onb-center">
          <div className="onb-group">
        <SayBubble say="read" className="onb-read" label={say("onboardingEarlyRead")}>
          <span className="jar-char-bubble-of">{say("onboardingEarlyRead")}</span>
          <p className="onb-say-line">{reading}</p>
          {why && behind.length ? (
            <ul className="onb-read-why" aria-label={say("onboardingWhyFrom")}>
              {behind.map((line, at) => <li key={at}>{line}</li>)}
            </ul>
          ) : null}
          <span className="jar-char-bubble-acts">
            <button type="button" className="jar-char-bubble-act" aria-expanded={why} disabled={!behind.length} onClick={() => setWhy((open) => !open)}>{say("onboardingWhy")}</button>
            <button type="button" className="jar-char-bubble-act" disabled={busy} onClick={onTalk}>{say("onboardingTalk")}</button>
          </span>
        </SayBubble>
        <div className="onb-tail-gap" />
        <CreatureSlot size="large" />
          </div>
        </div>
        {error ? <p className="onb-error" role="alert">{error}</p> : null}
        <button type="button" className="onb-go" disabled={busy} onClick={onContinue}>{say("onboardingContinue")}</button>
      </div>
    </main>
  );
}
