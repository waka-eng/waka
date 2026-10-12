/**
 * ═══ HOW WAKA WORKS — THE LOOP, IN ITS OWN DOOR ═════════════════════════
 *
 * Founder: "lets add a button next to the settinsg of info icon and in
 * there put all things to explain how waka works (inspirations leading to
 * top of mind leading to principles and anything else that we want to
 * describe)."
 *
 * ── THIS IS THE HOME THE DELETED WALL WAS PROMISED ───────────────────────
 *
 * Four paragraphs defining the layers, plus a fifth about what the loop
 * cannot promise, were deleted from `/profile` earlier the same day. The
 * commit that removed them ("settings answer in the corner, and the
 * explainer wall comes down", a5bd6279) argued the content was on the wrong
 * page rather than wrong — "four hundred-odd words of prose explaining the
 * data model, on the page somebody opens to change their name" — and
 * `SettingsPanel`'s header says the same about the three machinery doors
 * that went with it: they "want a home next to the top of mind rather than
 * next to a language picker".
 *
 * A gear is a door for changing things. An "i" is a door for being told
 * things. Nobody presses an "i" to change their name, and nobody presses it
 * by accident, so prose that was a wall on a settings page is the ENTIRE
 * EXPECTED CONTENT behind this one. The words are restored verbatim from
 * `worldFormation*` rather than rewritten: they were argued over once and
 * the argument was about where they sat, not what they said.
 *
 * ── WHAT IS HERE, AND WHY NOTHING ELSE IS ────────────────────────────────
 *
 * The four rungs in loop order, each named by THE SAME STRING THE SWITCHER
 * AND THE DOCK USE, then the caveat. Naming them with `worldMenuField`,
 * `worldMenuClaims`, `worldMenuTopOfMind` and `worldPrinciplesShortcut`
 * rather than with fresh prose headings is the load-bearing choice: a
 * person reading this is holding it against the words on screen, and an
 * explanation that renames the things it explains is worse than no
 * explanation. Four rungs, not the three the founder listed — claims joined
 * the loop on 2026-10-11, after that copy was written, and leaving it out
 * would describe a product that no longer exists.
 *
 * NO DISCLOSURES, though the panel one door over is nothing but. The reference on
 * collapsibles: "Don't use a collapsible for a single short paragraph; just
 * show the text directly instead." Each of these IS a single short
 * paragraph, and the relationship between them — that each is made from the
 * one above — is the actual content, which is invisible the moment three of
 * the four are folded away. The same reasoning laid the rungs out across the
 * top rather than listing them (see `Menu.tsx`).
 *
 * NO NUMERALS, no "step 1 of 4". "States render, numerals never" is a
 * founder law, and reading order already says what order the loop runs in.
 *
 * ── WHAT IS DELIBERATELY STILL MISSING ───────────────────────────────────
 *
 * THE THREE MACHINERY DOORS — how it reads you, the antechamber, the
 * gardener's asks. They are the obvious next addition and THIS IS THE HOME
 * `SettingsPanel`'s header was pointing at: they SHOW what the product is
 * doing on your behalf, which is a stronger version of the promise these
 * paragraphs only describe. They are not here because their components and
 * their API clients were deleted with the page, and standing three fetching
 * surfaces back up is its own piece of work rather than a line in this one.
 *
 * Everything needed is one commit back. `git show 5df201f6^` has the three
 * panels — `src/components/ReadingPanel.tsx`, `AntechamberPanel.tsx` and
 * `DuplicatesPanel.tsx` — their clients (`src/lib/api/reading.ts`,
 * `consultations.ts`, `signal-duplicates.ts`), the markup that mounted them
 * in `src/pages/Profile.tsx`, and the headings `worldHowItReadsYou`,
 * `worldTheAntechamber` and `worldGardenerAsks`, which went out of both
 * catalogues with everything else and have to come back with them.
 */
import { useId } from "react";

import { t, type SupportedLocale } from "../lib/locales";

/** Each rung, as the loop runs: what you kept, what it noticed, what it
 *  reads now, what has endured. Label and body sit together so the pairing
 *  cannot drift apart in the markup below. */
const RUNGS = [
  { label: "worldMenuField", body: "worldFormationInspirations" },
  { label: "worldMenuClaims", body: "worldFormationClaims" },
  { label: "worldMenuTopOfMind", body: "worldFormationReading" },
  { label: "worldPrinciplesShortcut", body: "worldFormationPrinciples" },
] as const;

export function HowItWorksPanel({ locale }: { locale: SupportedLocale }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  /* THE HEADING NAMES THE PANEL, rather than an `aria-label` repeating it.
     The reference, on a dialog's header: the title "labels the dialog via
     aria-labelledby". A second copy of the same words in an attribute is a
     second place for them to go stale, and a screen reader would be the
     only thing that ever noticed. */
  const titleId = useId();
  return (
    <div className="waka-about" role="group" aria-labelledby={titleId}>
      <h2 className="waka-about-title" id={titleId}>{say("worldHowItWorksTitle")}</h2>
      <p className="waka-about-lead">{say("worldHowItWorksLead")}</p>

      {/* A DEFINITION LIST, because that is what this is: four terms and
          what each one means. It was a `<dl>` on the page it came from and
          the semantics were the one part of that surface nobody complained
          about. */}
      <dl className="waka-about-loop">
        {RUNGS.map((rung) => (
          <div key={rung.label}>
            <dt>{say(rung.label)}</dt>
            <dd>{say(rung.body)}</dd>
          </div>
        ))}
      </dl>

      {/* WHAT THE LOOP PROMISES AND WHAT IT DOES NOT, last. It sat at the
          foot of the original wall and it belongs at the foot of this: a
          person who read four paragraphs about how the machine works is
          owed the part where it says what it cannot do. */}
      <p className="waka-about-caveat">{say("worldFormationKeep")}</p>
    </div>
  );
}
