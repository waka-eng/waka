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
import type { SupportedLocale } from "../lib/locales";

export interface NotePageProps {
  locale: SupportedLocale;
  /** When this note is, in milliseconds. */
  whenMs: number;
  /** The way to the archive — on a NEW note only. See the note in the row. */
  leading?: ReactNode;
  /** One verb ABOUT this note — Delete on a saved one, nothing on a new. */
  trailing?: ReactNode;
  children: ReactNode;
}

export function NotePage({
  locale,
  whenMs,
  leading,
  trailing,
  children,
}: NotePageProps): JSX.Element {
  return (
    <>
      <div className="jar-note-top">
        {/* ═══ THE FIRST TRACK HAS A TENANT AGAIN, ON A NEW NOTE ════════
            Founder, 2026-10-15: "at the bottom bar just keep inspiration and
            chat and clicking on it leads to new inspiration and new chat, and
            user can go to inspiration list and chat list ONLY from that new
            page." The bar no longer names the archive, so the one-door rule
            below now points the other way: this is the archive's only door,
            not a second one. Words, not a chevron — the chevron lost on
            being a glyph that says nothing about where it goes. */}
        {leading ? <span className="jar-note-lead">{leading}</span> : null}
        {/* ═══ AND THE WAY BACK IS THE BAR ═══════════════════════════
            Founder: "I still don't get why you have this carrot button
            when I do new inspiration, because I can just go to all the
            inspirations using the bottom panel. So don't do that."

            Correct, and the chevron had already been losing arguments on
            its way to this one. It was a boxed button with a destination
            printed beside it; the box went ("why is this still here?"),
            then the words went ("remove the all inspirations thing"), and
            what was left was a glyph in the corner pointing at a place the
            dock already names in words and reaches in one press. Three
            rounds of making a control quieter, when the answer was that it
            was a second door onto one room.

            LAW 2 IS SATISFIED BY THE BAR, NOT BY NOTHING. "Every surface
            you can enter has a visible way out and it costs one press" —
            the dock is on screen on both of these pages, always, and
            "Inspirations" is the way out, in a word rather than a glyph.
            It is also the way out that was there the whole time: the
            founder found it before we removed the chevron.

            THE EMPTY TRACK STAYS. `.jar-note-top` is `1fr auto 1fr` so the
            date sits in the middle of the PAGE; collapsing the first track
            now would hang the date off the left margin. Nothing is a
            perfectly good tenant for a track whose job is to be half the
            page. */}
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
