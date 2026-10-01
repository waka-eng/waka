/**
 * EVERY SHEET CLOSES THE SAME TWO WAYS.
 *
 * The founder's ruling was made about one of them — the make-another-place
 * sheet, 2026-08-27: "if click outside modal, close it" — and the dial's rail
 * the same day: "timeline line should disappear if clicked outside of it".
 * Neither is a fact about those two surfaces. It is what a person expects of
 * anything that opens over the thing they were reading: press away, and it
 * goes; press Escape, and it goes.
 *
 * The rest of the sheets never learned it. The account sheet, a room's
 * settings, the join sheet, a statement's provenance room and the antechamber
 * each closed only by finding their own small word — which is fine the first
 * time and a trap every time after, because the way out of the LAST sheet is
 * never where the way out of this one is. One hook, so a sheet added later
 * gets both without anyone remembering to.
 *
 * WHY POINTERDOWN AND NOT CLICK. The sheet should be gone before whatever the
 * press was actually for happens, and a click that lands on the world would
 * otherwise arrive first. Capture phase for the same reason the dial uses it:
 * a handler that stops propagation cannot leave a sheet stranded.
 *
 * WHY ESCAPE STOPS PROPAGATING. The world's own key handler reads Escape as
 * "let the open memory go". With a sheet up, the sheet is the nearer subject
 * — one layer at a time, the same rule the reading and its evidence already
 * follow — so the sheet takes the key and the card behind it stays open.
 *
 * AND WHY IT ASKS WHERE THE KEY WAS PRESSED FIRST. Capture runs before
 * anything the target could do, so the first version of this ate the Escape
 * belonging to every field inside a sheet — a room's name box, an agent's
 * name, the reflect answer, each of which handles the key itself because
 * leaving a half-typed name is not the same act as leaving the sheet. The
 * comment here claimed fields kept their key; they did not, and a test
 * written to say so failed the moment it existed. A press inside an editable
 * thing belongs to that thing; the sheet takes Escape everywhere else.
 */
import { useEffect } from "react";

/**
 * @param open   whether the sheet is up
 * @param close  what to do when the person asks for it to go
 * @param keep   selectors that must NOT count as "outside": the sheet itself,
 *               and whatever control opened it (pressing that again is the
 *               control's own business, not a dismissal)
 */
export function useDismissAway(
  open: boolean,
  close: () => void,
  keep: readonly string[],
): void {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent) => {
      const at = e.target as Element | null;
      if (!at) return;
      for (const sel of keep) {
        if (at.closest?.(sel)) return;
      }
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const at = e.target as Element | null;
      // DialogSurface handles Escape after the field's own handler and
      // closes only that dialog. A capture listener must not close parents.
      if (at instanceof Element && at.closest("[data-jar-surface]")) return;
      /* the field's own key, left alone: `isContentEditable` catches the
         rich cases, the tag list the plain ones */
      if (
        at instanceof HTMLElement &&
        (at.isContentEditable ||
          at instanceof HTMLInputElement ||
          at instanceof HTMLTextAreaElement ||
          at instanceof HTMLSelectElement)
      ) {
        return;
      }
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, close, keep]);
}
