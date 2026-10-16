/**
 * WHAT STANDS IN A NOTE PAGE'S TOP ROW — asked structurally, because the
 * regression does not arrive wearing the old name.
 *
 * Founder, three separate times about a control in that position: "why is
 * this still here?", then "remove the all inspirations thing", then "I still
 * don't get why you have this carrot button when I do new inspiration,
 * because I can just go to all the inspirations using the bottom panel. So
 * don't do that." The row holds a date, and on a saved note one verb about
 * the note, and nothing else you can press.
 *
 * AND THEN THE BAR STOPPED NAMING THE ARCHIVE (2026-10-15). Founder: "at the
 * bottom bar just keep inspiration and chat and clicking on it leads to new
 * inspiration and new chat, and user can go to inspiration list and chat
 * list ONLY from that new page." So a NEW note now holds exactly one press
 * up here — `.jar-note-see-all`, "All inspirations", in words — and a saved
 * note still holds none. Callers assert the exact list (`['jar-note-see-all']`
 * or `[]`), so a chevron or anything else arriving beside it still fails.
 *
 * THIS REPLACES THREE COUNTS OF THREE DEAD CLASS NAMES. `one-note.test.tsx`
 * and `inspiration-composer.test.tsx` between them asserted that
 * `.jar-note-back`, `.waka-over-back`, `.jar-note-tools` and `.jar-note-save`
 * each rendered zero times. Measured on 2026-10-11: zero occurrences of any
 * of the four anywhere in `src` outside the stylesheets, and `jar-note-save`
 * absent from the entire repository but those tests. An assertion that
 * something absent is absent cannot fail, and six of them had been standing
 * in for the guard somebody believed was there.
 *
 * The project's "asserted as absence" idiom is good and is kept — the
 * regression genuinely is a control coming BACK. It is only as strong as the
 * name surviving a rename, and four names did not. So the question is asked
 * about the slot rather than the spelling: whoever restores a way back in
 * 2026 writes `waka-dock-*`, `waka-corner-*`, `waka-over-*`, or no class at
 * all, and this sees all of them.
 *
 * THE TRAILING VERB IS EXEMPT BY ITS SLOT, NOT BY ITS NAME. `NotePage` puts
 * it in `.jar-note-verb`, and which page may have one and what it may say is
 * `one-note.test.tsx`'s own next case. Anything a page puts up there OUTSIDE
 * that slot is what this is watching for.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It is a DOM query its callers
 * run against a tree they rendered themselves.
 */
export function pressesInTopRow(root: ParentNode): string[] {
  const top = root.querySelector(".jar-note-top");
  /* NO ROW AT ALL IS A FAILURE, NOT AN EMPTY LIST. A page that lost the
     shared chrome entirely would otherwise read as "nothing to press up
     there" — the vacuous pass this helper exists to replace, committed by
     the helper itself. */
  if (!top) return ["there is no .jar-note-top on this page at all"];
  return [...top.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [role="button"], [tabindex]',
  )]
    .filter((node) => !node.closest(".jar-note-verb"))
    .map((node) => node.className || node.tagName.toLowerCase());
}
