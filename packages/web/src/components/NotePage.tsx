/**
 * ═══ A NOTE, WHICHEVER NOTE IT IS ═══════════════════════════════════════
 *
 * Founder, after opening a saved inspiration and comparing it to a new one:
 * "when clicking on a saved inspiration, it should go to the same exact UI
 * as when I'm creating a new inspiration. So the title should be the same
 * position at like middle center as when I'm creating a new inspiration.
 * And the bottom bar should also change. Remove the all inspirations thing
 * here — actually, maybe just have a back button. But just make sure that
 * when I'm entering from create new inspiration or my past inspiration,
 * it's using the exact same component, and I'm liking the new inspiration
 * component a lot more."
 *
 * ── WHAT WAS ACTUALLY DIFFERENT, AND IT WAS NOT STYLING ──────────────────
 *
 * Two pages for one object, built in two places, that had drifted into
 * disagreeing about every corner:
 *
 *   THE WAY BACK. A chevron top-left on a new note, inside the archive's
 *   own header on a saved one — a different element, in a different place,
 *   at a different size.
 *
 *   WHEN IT IS. Centred at the top of a new note, left-aligned in a row
 *   with Delete on a saved one. The same fact, in two positions, so the eye
 *   had to re-find it depending on how you arrived.
 *
 *   ATTACHING. In the dock on a new note; a floating pair in the
 *   bottom-left corner on a saved one. That corner is the one the founder
 *   has asked about three times — "I don't like this thing on the left",
 *   "this double layer is so weird", and then, with a screenshot of a saved
 *   note, reading the stray pair as a bug. It WAS a bug, of the kind a
 *   duplicated layout always eventually produces: the corner was vacated on
 *   one of the two pages and left standing on the other.
 *
 * None of that is a theme a stylesheet could have fixed. It is two
 * components, so this is one.
 *
 * ── WHAT THIS OWNS, AND WHAT IT DOES NOT ─────────────────────────────────
 *
 * It owns the CHROME — the way back, when it is, the one slot for a verb
 * about the note, and the column the words sit in. It owns no state, no
 * save, no textarea: a new note's field is bound to a draft store and a
 * saved one's to a row, and pretending those are one thing is how a shared
 * component becomes a switch statement wearing a disguise.
 *
 * THE TRAILING SLOT IS FOR A VERB ABOUT THE NOTE, NOT A SECOND WAY OUT.
 * Delete goes there on a saved note; nothing goes there on a new one,
 * because a thing that does not exist yet cannot be destroyed. It is
 * deliberately one slot: a row of verbs at the top of a page you are
 * reading is the form this page exists not to be.
 */
import type { ReactNode } from "react";

import { momentStamp } from "../lib/words";
import { t, type SupportedLocale } from "../lib/locales";

export interface NotePageProps {
  locale: SupportedLocale;
  /** When this note is, in milliseconds. */
  whenMs: number;
  /** The way back, which is a bare chevron — see `aboutBack`. */
  onBack: () => void;
  /** Where the chevron goes, for the label a screen reader reads. */
  backTo: "worldBackToAll";
  /** Disabled while a write is in flight, so leaving cannot race it. */
  backBusy?: boolean;
  /** One verb ABOUT this note — Delete on a saved one, nothing on a new. */
  trailing?: ReactNode;
  children: ReactNode;
}

export function NotePage({
  locale,
  whenMs,
  onBack,
  backTo,
  backBusy,
  trailing,
  children,
}: NotePageProps): JSX.Element {
  return (
    <>
      <div className="jar-note-top">
        {/* A CHEVRON, AND NOT ITS NAME. Founder, with "‹ All inspirations"
            at the top of a note: "remove", and then "maybe just have a back
            button."

            THIS REVERSED "NAMED, LIKE EVERY OTHER WAY BACK", and the old
            argument is worth keeping because it was right about a different
            screen: it came from a bare chevron IN A BOX floating on the
            world, where nothing said where it went. On a note that fills the
            page, having arrived from the list one press ago, the chevron at
            the top-left is the most over-learned control on a phone — and
            the words beside it were the only thing on the page that was not
            the note.

            STILL NAMED WHERE IT COUNTS: the destination is on `aria-label`,
            so nothing is lost to anybody arriving by keyboard or by ear. */}
        <button
          type="button"
          className="jar-note-back"
          aria-label={t(locale, backTo)}
          disabled={backBusy}
          onClick={onBack}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" focusable="false">
            <path
              d="M6.5 1.5 2.5 5.5l4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {/* THE ONE FACT A PAGE LIKE THIS CAN STATE, in the middle, where it
            was on the page the founder said they preferred. On an empty new
            note it is the only thing that exists yet; on a saved one it is
            what tells you which evening this was. Same slot either way. */}
        <span className="jar-note-when">{momentStamp(whenMs, locale)}</span>
        {trailing ? <span className="jar-note-verb">{trailing}</span> : null}
      </div>
      {children}
    </>
  );
}
