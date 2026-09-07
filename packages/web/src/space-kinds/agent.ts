/**
 * AN AGENT AS A SPACE: what an agent's headquarters says, at a moment.
 *
 * One function, and it earns its own file because the rule it encodes is a
 * product law rather than a formatting choice — see the note on the function
 * itself. `AgentBundle` comes from `lib/agent-contract`, which is where the
 * agent wall's shape is declared ahead of the endpoint that will fill it;
 * when the live agent endpoint lands that import moves to `lib/api` and
 * nothing else here changes. It is a shape, not a fixture: this file has
 * never had a reason to know that the only thing producing one today is the
 * one under `lib/fixture/`, and after the swap it still will not.
 */
import { t, type SupportedLocale } from "../lib/locales";
import type { AgentBundle, ApiAgentDirectionReading } from "../lib/agent-contract";
import { monthTag } from "../lib/words";
import { formingWords, type WallChrome } from "../space/top-of-mind/board";

/**
 * WHAT AN AGENT'S HEADQUARTERS SAYS, AT A MOMENT.
 *
 * The dial is the history and there is no second surface for it, so this takes
 * a time: wind back and the poster becomes the identity the agent held then,
 * and an agent that rewrites itself weekly STUTTERS under your thumb while one
 * that has held a line for a season is a long quiet slide with one change in
 * it. Frequency of change becomes a kinetic quality rather than a version list.
 *
 * There is no generated placeholder here and there never will be. Fabricating
 * an ambition for an agent that has not worked yet is the worst thing this
 * product could ship: it would teach the reader that the poster is generated
 * copy, and destroy the credibility of every wall they read afterwards.
 */
export function deriveAgentChrome(
  a: AgentBundle,
  T: number,
  nowMs: number,
  locale: SupportedLocale = "en-US",
): WallChrome {
  const at = (t: number): ApiAgentDirectionReading | null => {
    let best: ApiAgentDirectionReading | null = null;
    for (const h of a.direction.history) {
      const ms = Date.parse(h.createdAt) || 0;
      if (ms <= t && (!best || ms > (Date.parse(best.createdAt) || 0))) best = h;
    }
    return best;
  };
  const held = at(T);
  const heldNow = at(nowMs);
  const notes = a.topOfMind.notes.map((n) => ({
    isProvisional: n.isProvisional === true,
    createdMs: Date.parse(n.createdAt) || nowMs,
  }));
  const empty = a.inspirations.length === 0;
  return {
    text: held?.ambition ?? null,
    awayFrom: held?.awayFrom ?? null,
    /* An agent that has not worked yet says so, in its own voice, once. */
    formingAlt: held ? null : t(locale, "worldAgentFormingAlt"),
    asOf:
      held && heldNow && held.ambition !== heldNow.ambition && nowMs - T > 60_000
        ? monthTag(T, locale)
        : null,
    forming: formingWords(T, null, notes, locale),
    empty,
    prevText: null,
  };
}
