/**
 * YOUR AGENT'S PICK: your own sentence, in your agent's colder light. No
 * body is drawn beside it; the slip's pixel-stepped corners stand in for the
 * agent (claims.css). The slip and its gestures are `ClaimSlip`'s; this adds
 * the line saying your agent noticed it, and what is on the slip.
 */

import { ClaimSlip, type PickAnswer } from "./ClaimSlip";
import { t, type SupportedLocale } from "../lib/locales";

export type { PickAnswer };

export function AgentPick({ id, text, source, next, locale, onAnswer, onLeft }: {
  id: string;
  /** The person's own words, verbatim. */
  text: string;
  /** Where it was picked from, one short line. */
  source: string;
  /** Whether another pick waits behind this one — shown as an edge only. */
  next?: boolean;
  locale: SupportedLocale;
  onAnswer: (answer: PickAnswer) => void;
  onLeft: (answer: PickAnswer) => void;
}) {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return (
    <ClaimSlip
      id={id}
      tone="pick"
      label={text}
      labelKeep={say("worldHarvestKeep")}
      labelNot={say("worldHarvestNotIt")}
      more={next}
      onAnswer={onAnswer}
      onLeft={onLeft}
      header={(
        <p className="jar-pick-who">
          <span>{say("worldPickNoticed")}</span>
        </p>
      )}
    >
      <p className="jar-pick-words">{text}</p>
      <p className="jar-pick-source">{source}</p>
    </ClaimSlip>
  );
}
