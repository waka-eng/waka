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
 * ── AND THE THREE MACHINERY DOORS, WHICH ARE WHY THIS PANEL IS NOT PROSE ─
 *
 * How it reads you, the antechamber, the gardener's asks. They were deleted
 * with the settings page in the morning of the same day, under a note
 * calling that "the removal most worth disagreeing with", and
 * `SettingsPanel`'s header said where they belonged: "next to the top of
 * mind rather than next to a language picker". This is that home.
 *
 * THEY ARE THE PART THAT CANNOT BE FAKED. The five paragraphs above DESCRIBE
 * what the machine does; these three SHOW it doing it — the rules it is
 * actually enforcing, the sentences it refused and why, the pairs it thinks
 * are one thing. The vague-explanation research is the whole argument (docs/
 * craft/the-legible-loop.md, finding 8): an explanation disconnected from
 * mechanism costs more trust than silence. An explainer panel with no door
 * onto the mechanism is exactly that explanation.
 *
 * ── WHY THEY OPEN OVER THE WORLD AND NOT IN HERE ─────────────────────────
 *
 * This card is 26rem wide and already scrolls. Three fetching diagnostic
 * surfaces — one of them a list of statement pairs with four verbs each —
 * cannot be nested in it, and nesting them would also break the rule this
 * corner was built on: the reference, on the component class these cards
 * belong to, "Don't nest popovers inside other popovers". `Menu` holds ONE
 * corner slot for exactly that reason.
 *
 * So pressing a door CLOSES THIS CARD and opens the door over the world,
 * which is how every other destination in the product arrives. That is one
 * surface on screen at a time, never two — the founder has twice rejected a
 * surface stacking on another surface — and it is also what these three
 * already were: each is a `DialogSurface` that was opened from a row on a
 * page, so the interaction is recovered rather than invented. The state and
 * the fetches live in `Menu`, which owns the corner; this component is the
 * rows, and says nothing about what is behind them.
 *
 * ── WHY THE ROWS CARRY A MARK AND THE RUNGS DO NOT ───────────────────────
 *
 * The four rungs above are `dt`s set in ink. The three doors are buttons set
 * in ink. Light is this product's only meaning channel and it has nothing
 * left to say here — so without a mark the two groups are typographically
 * identical and only one of them does anything when pressed. A chevron is
 * the smallest honest difference, and it is the switcher's own chevron
 * turned round, because "this opens" is the thing it already means
 * elsewhere in the same bar.
 *
 * WHERE THEY LAND, MEASURED RATHER THAN ASSUMED. On a laptop and on a
 * 390x844 phone all three rows are on screen with the card open and all
 * three hit-test clean — the dock is the one thing that could have painted
 * over the last of them and does not. On a 390x667 phone the card scrolls
 * and the doors are below its fold, which is the card's designed behaviour
 * and the cost of putting them last. It is the right cost: "the
 * antechamber" means nothing until the paragraph above has said what it is
 * an antechamber of, and a person who pressed an "i" came to read.
 *
 * ONE SENTENCE OVER ALL THREE, not a gloss under each. `worldMachineryLead`
 * is recovered copy — it was the settings section's subtitle — and it names
 * the three in order, so the person reads one line instead of three. Its
 * title is NOT recovered: it said "How WAKA works", which is this panel's
 * own heading, and a second copy of the heading four paragraphs down is the
 * duplication Law 4 is about.
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

/** The three doors, in the order `worldMachineryLead` names them: what it
 *  reads you by, what it set aside, what it thinks it is hearing twice. */
const DOORS = ["reading", "antechamber", "duplicates"] as const;

export type MachineryDoor = (typeof DOORS)[number];

const DOOR_LABEL: Record<MachineryDoor, Parameters<typeof t>[1]> = {
  reading: "worldHowItReadsYou",
  antechamber: "worldTheAntechamber",
  duplicates: "worldGardenerAsks",
};

export interface HowItWorksPanelProps {
  locale: SupportedLocale;
  /**
   * Open one of the three doors.
   *
   * REQUIRED, NOT `onOpen?.()`. An optional handler with no default is the
   * exact shape Law 8 records as having shipped three times here: the row
   * renders, it is enabled, it is pressed, and nothing happens. A caller
   * that cannot open these panels must not render this panel.
   */
  onOpenDoor: (door: MachineryDoor) => void;
}

export function HowItWorksPanel({ locale, onOpenDoor }: HowItWorksPanelProps): JSX.Element {
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

      {/* ═══ THE MACHINERY ITSELF, LAST AND BEHIND THREE ROWS ═══════════
          Last because none of these three names means anything until the
          loop has been described: "the antechamber" is a room of something,
          and the paragraph above is what it is a room of. See the header
          for why they open over the world rather than in here. */}
      <div className="waka-about-doors">
        <p className="waka-about-lead">{say("worldMachineryLead")}</p>
        {DOORS.map((door) => (
          <button
            key={door}
            type="button"
            className="waka-about-door"
            /* It opens a dialog, and says so rather than leaving a screen
               reader to find out by arriving in one. */
            aria-haspopup="dialog"
            onClick={() => onOpenDoor(door)}
          >
            {say(DOOR_LABEL[door])}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path
                d="M4 2l3 3-3 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
