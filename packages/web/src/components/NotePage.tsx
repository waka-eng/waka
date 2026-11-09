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
import { SurfaceHeader, type SurfaceBack } from "./SurfaceHeader";

export interface NotePageProps {
  locale: SupportedLocale;
  /** When this note is, in milliseconds. */
  whenMs: number;
  /** The "<": Close on a new note (it goes home), Back on a saved one (to the list or sheet). */
  back: SurfaceBack;
  /** A page's address, for the native back gestures. */
  gesture?: string | null;
  /** One verb ABOUT this note: the saved note's "⋯"; nothing on a new one. */
  trailing?: ReactNode;
  /** Whose note: "Saving to {name}" on a new one, the name on a saved one. */
  owner?: string;
  children: ReactNode;
}

/** THE HEADER IS THE SHARED ONE (nav system): "<", the owner and the moment centred, the "⋯". */
export function NotePage({ locale, whenMs, owner, back, gesture = null, trailing, children }: NotePageProps): JSX.Element {
  const when = momentStamp(whenMs, locale);
  return (
    <>
      <SurfaceHeader locale={locale} back={back} gesture={gesture} title={owner ? `${owner} · ${when}` : when} right={trailing} />
      {children}
    </>
  );
}
