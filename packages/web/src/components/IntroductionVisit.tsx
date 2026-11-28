/**
 * ═══ AN INTRODUCTION, ON HOME (design "Agent introductions", approved
 * 2026-11-27) ═══
 *
 * Founder-approved board: keep the introduction on home as a visitor beside
 * your creature, not a new screen. It needs no new navigation, and the light
 * says who is new.
 *
 *   1. The ask. The bubble says what is compared and what stays private
 *      right under the question. On a match, their light waits faintly at
 *      the edge.
 *   2. The introduction. Their creature comes in beside yours, joined by a
 *      warm to cool light, under "You both hold" and the principle in plain
 *      words. NO NAME AT ALL (review, 2026-11-28): a "first name" leaked whole
 *      names, and with no way to message there is nothing a name is for. The
 *      guest carries no label.
 *   3. Saying no. Their light fades off the edge, and turning introductions
 *      off is one press.
 *
 * THE VISITOR IS THE REAL CREATURE (`Companion`, the same rest pose the
 * world draws), in its cooler light (`cool`), never a drawn stand in. It is
 * a little smaller than yours because it is a guest at your home, and it does
 * not move once it has arrived: the arrival is the one motion, and it
 * explains who is new.
 */
import type { CSSProperties } from "react";

import { Companion } from "./Companion";
import type { Introductions } from "../lib/introductions";
import { t, type SupportedLocale } from "../lib/locales";

/** The guest is drawn at this share of your creature's size. */
const GUEST_SCALE = 0.78;

/** The bubble, in the reading's place. Null when there is nothing to say. */
export function IntroductionBubble({ intro, locale }: { intro: Introductions; locale: SupportedLocale }): JSX.Element | null {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const { stage } = intro;
  if (!stage) return null;
  const act = (label: string, onClick: () => void) => (
    <button type="button" className="jar-char-bubble-act" disabled={intro.busy} onClick={onClick}>{label}</button>
  );
  return (
    <div className="jar-char-bubble waka-intro-bubble" data-jar-chrome="1" data-jar-interactive="1" data-intro-stage={stage}>
      <span className="jar-char-bubble-body">
        {stage === "ask-consent" || stage === "ask-match" ? <>
          <span className="jar-char-bubble-reading">{say(stage === "ask-consent" ? "introAskConsent" : "introAskMatch")}</span>
          <span className="waka-intro-fine">{say("introAskFine")}</span>
          <span className="jar-char-bubble-acts">{act(say("introYes"), intro.introduce)}{act(say("introNotNow"), intro.notNow)}</span>
        </> : stage === "introduced" ? <>
          <span className="jar-char-bubble-of waka-intro-eyebrow">{say("introBothHold")}</span>
          <span className="jar-char-bubble-reading">{intro.principle}</span>
          <span className="jar-char-bubble-acts">{act(say("introDone"), intro.done)}</span>
        </> : stage === "declined" ? <>
          <span className="jar-char-bubble-reading" role="status">{say("introDeclined")}</span>
          <span className="jar-char-bubble-acts">{act(say("introDone"), intro.done)}{act(say("introTurnOff"), intro.turnOff)}</span>
        </> : <>
          <span className="jar-char-bubble-reading" role="status">{say(stage === "on" ? "introOn" : stage === "waiting" ? "introWaiting" : "introOff")}</span>
          <span className="jar-char-bubble-acts">{act(say("introDone"), intro.done)}</span>
        </>}
      </span>
    </div>
  );
}

/**
 * The light and the guest, standing on your creature's line
 * (`--jar-char-mid`). `size` is your creature's drawn size, from the world.
 */
export function IntroductionScene({ intro, locale, size }: { intro: Introductions; locale: SupportedLocale; size: number }): JSX.Element | null {
  const { stage } = intro;
  if (stage === "ask-match" || stage === "declined") {
    /* Their light, at the edge. On a no it leaves the way it would have
       come in: off the edge, fading. */
    return <span className={`waka-intro-edge${stage === "declined" ? " waka-intro-edge--leaving" : ""}`} aria-hidden="true"
      style={{ "--intro-size": `${size}px` } as CSSProperties} />;
  }
  if (stage !== "introduced") return null;
  const guest = Math.round(size * GUEST_SCALE);
  /* Your body's half width, a breath, then the guest's: `aspect` 1.15 puts
     each half at about 0.58 of the size. */
  const reach = Math.round(size * 0.58 + size * 0.1 + guest * 0.58);
  const style = { "--intro-size": `${size}px`, "--intro-guest": `${guest}px`, "--intro-reach": `${reach}px` } as CSSProperties;
  return (
    <span className="waka-intro-scene" style={style}>
      <span className="waka-intro-bridge" aria-hidden="true" />
      <span className="waka-intro-guest">
        <Companion size={guest} cool pressable={false} label={t(locale, "introSomeone")} />
      </span>
    </span>
  );
}
