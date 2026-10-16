/**
 * "NOT IT" — AND, IF THE PERSON WANTS TO SAY, WHY NOT.
 *
 * Founder, 2026-10-15: "if I use the WAKA MCP, then the agent would derive
 * 'oh, this looks like inspiration, this looks important' ... so in here we
 * need more than a yes and a no. When the user says no, select why not."
 *
 * A reading WAKA made of you is answered with yes or no. A sentence a
 * collector picked out of your day is different: when it is wrong, it is
 * wrong for a REASON, and the reason is what lets tomorrow's pick be better.
 * Six reasons: five from the Harvest design, each one a different lesson
 * for the collector, and a sixth in the person's own words. "Cut wrong" is
 * not a no at all: it is a good thought with
 * a bad edge, so it opens the words to be fixed and kept. That is the one
 * place in the confirm loop where typing appears, and it is a correction,
 * which is the one kind of typing the loop allows.
 *
 * Every reason is optional. Skip is a full answer: the words go either way.
 */
import { useEffect, useRef, useState } from "react";
import { takeCarriedFocus } from "./ClaimSlip";

import type { HarvestReason } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";

/* Each reason with the one line that says what it means, both from the
   Harvest design — "남이 한 말이거나, AI가 한 말을 따라 한 거예요" and the rest. */
const REASONS: Array<{ value: HarvestReason; key: Parameters<typeof t>[1]; hint: Parameters<typeof t>[1] }> = [
  { value: "not_mine", key: "worldHarvestNotMine", hint: "worldHarvestNotMineHint" },
  { value: "already_kept", key: "worldHarvestAlreadyKept", hint: "worldHarvestAlreadyKeptHint" },
  { value: "private", key: "worldHarvestPrivate", hint: "worldHarvestPrivateHint" },
  { value: "trivial", key: "worldHarvestTrivial", hint: "worldHarvestTrivialHint" },
  { value: "miscut", key: "worldHarvestMiscut", hint: "worldHarvestMiscutHint" },
];

export function HarvestReasons({ text, locale, busy, failed, onReason, onKeepFixed }: {
  /** The sentence being let go, so the person can see which one this is. */
  text: string;
  locale: SupportedLocale;
  busy: boolean;
  failed: boolean;
  /** Let it go, with a reason or without one; `note` is the person's own
      reason, with `other`. */
  onReason: (reason?: HarvestReason, note?: string) => void;
  /** "Cut wrong", fixed: keep these words instead. */
  onKeepFixed: (words: string) => void;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [fixing, setFixing] = useState(false);
  const [words, setWords] = useState(text);
  /* THEIR OWN ANSWER. Founder, 2026-10-15: "let user provide their own
     answers." The five reasons are guesses at the common cases; the sixth
     row opens a line to say it plainly. */
  const [own, setOwn] = useState<string | null>(null);
  /* Answered from the keyboard, the list takes focus at its first reason. */
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (takeCarriedFocus()) list.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, []);

  /* A LIST, NOT A WRAP OF WORDS. Founder, 2026-10-15, on the reasons
     flowing across two ragged lines: "maybe it should just be a list of
     buttons rather than kind of ugly shaped like this." One row per reason,
     each saying in a line what it means, so choosing is reading down a list
     rather than decoding a cloud of labels. */
  return (
    <div className="jar-pick jar-harvest-why" role="group" aria-label={say("worldHarvestWhyTitle")}>
      <p className="jar-pick-who jar-harvest-head">
        <span>{say("worldHarvestWhyTitle")}</span>
        {/* SKIP IN THE HEADER, where it costs no row: on a phone the list
            has to fit beside the creature, not under it. */}
        {!fixing && own === null ? (
          <button type="button" className="jar-harvest-skip" disabled={busy} onClick={() => onReason()}>
            {say("worldHarvestSkip")}
          </button>
        ) : null}
      </p>
      <p className="jar-harvest-quote">{text}</p>
      {own !== null ? (
        <>
          <label className="jar-harvest-fix">
            <span>{say("worldHarvestOtherLabel")}</span>
            <textarea rows={2} maxLength={280} value={own} disabled={busy} autoFocus
              placeholder={say("worldHarvestOtherPlaceholder")}
              onChange={(event) => setOwn(event.target.value)} />
          </label>
          <p className="jar-harvest-acts">
            <button type="button" className="jar-harvest-act" disabled={busy} onClick={() => setOwn(null)}>
              {say("worldHarvestOtherBack")}
            </button>
            <button type="button" className="jar-harvest-act jar-harvest-act--keep" disabled={busy || !own.trim()} onClick={() => onReason("other", own.trim())}>
              {say("worldHarvestLetGo")}
            </button>
          </p>
        </>
      ) : fixing ? (
        <>
          <label className="jar-harvest-fix">
            <span>{say("worldHarvestFixLabel")}</span>
            <textarea rows={3} maxLength={2000} value={words} disabled={busy} onChange={(event) => setWords(event.target.value)} />
          </label>
          <p className="jar-harvest-acts">
            <button type="button" className="jar-harvest-act" disabled={busy} onClick={() => onReason("miscut")}>
              {say("worldHarvestLetGo")}
            </button>
            <button type="button" className="jar-harvest-act jar-harvest-act--keep" disabled={busy || !words.trim()} onClick={() => onKeepFixed(words.trim())}>
              {say("worldHarvestKeepFixed")}
            </button>
          </p>
        </>
      ) : (
        <>
          <ul className="jar-harvest-list" ref={list}>
            {REASONS.map((reason) => (
              <li key={reason.value}>
                <button
                  type="button"
                  className="jar-harvest-row"
                  title={say(reason.hint)}
                  disabled={busy}
                  onClick={() => (reason.value === "miscut" ? setFixing(true) : onReason(reason.value))}
                >
                  <span className="jar-harvest-row-text">
                    <span className="jar-harvest-row-label">{say(reason.key)}</span>
                    <span className="jar-harvest-row-hint">{say(reason.hint)}</span>
                  </span>
                  <svg viewBox="0 0 7 12" width="7" height="12" aria-hidden="true"><path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="jar-harvest-row" disabled={busy} onClick={() => setOwn("")}>
                <span className="jar-harvest-row-text">
                  <span className="jar-harvest-row-label">{say("worldHarvestOther")}</span>
                  <span className="jar-harvest-row-hint">{say("worldHarvestOtherHint")}</span>
                </span>
                <svg viewBox="0 0 7 12" width="7" height="12" aria-hidden="true"><path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </li>
          </ul>
          <p className="jar-harvest-foot">{say("worldHarvestWhyHelps")}</p>
        </>
      )}
      {failed ? <p className="jar-harvest-failed" role="alert">{say("worldHarvestFailed")}</p> : null}
    </div>
  );
}
