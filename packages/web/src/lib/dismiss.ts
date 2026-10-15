/**
 * ONE SHEET OF SEVEN CLOSES BOTH WAYS, AND THIS IS THE HOOK IT OPTS INTO.
 *
 * ── WHAT THIS HEADER USED TO SAY, AND WHY IT HAD TO STOP ──────────────────
 *
 * It opened "EVERY SHEET CLOSES THE SAME TWO WAYS" and closed "one hook, so a
 * sheet added later gets both without anyone remembering to." The second
 * sentence describes a mechanism that does not exist here: nothing in this
 * file reaches a sheet that has not called it, `grep -c useDismissAway` is
 * zero in every component file, and a sheet added tomorrow gets Escape from
 * `DialogSurface` and nothing else. Counted on 2026-10-11: ten modal
 * `DialogSurface` call sites, three of them covered. Re-counted on
 * 2026-10-12, after rooms were removed (founder: "방 없애"): 7 modal call
 * sites, ONE of them covered. The three that left were a room's settings
 * (`space/settings/SpaceSettings.tsx`, deleted), the room form
 * (`space-kinds/GroupPanel.tsx`, deleted) and the join sheet (`Home.tsx`).
 * Two of those three were covered, which is why the coverage count fell
 * further than the sheet count.
 *
 * That is worse than an uncovered sheet, because the file holding the rule
 * was the one place anybody auditing dismissal would look, and it reported
 * coverage it did not have — "a gate that reads its own documentation as
 * evidence reports work that was never done", in prose rather than in a
 * test. So the claim is now a count, and `dismissal-ledger.test.ts` fails
 * when the count moves, which is what keeps this paragraph true after the
 * next sheet lands.
 *
 * ── WHAT IS STILL TRUE, AND IT IS THE PART THAT MATTERS ───────────────────
 *
 * The founder's ruling was made about one sheet — the make-another-place
 * sheet, 2026-08-27: "if click outside modal, close it" — and the dial's rail
 * the same day: "timeline line should disappear if clicked outside of it".
 * Neither is a fact about those two surfaces. It is what a person expects of
 * anything that opens over the thing they were reading: press away, and it
 * goes; press Escape, and it goes. And the way out of the LAST sheet is never
 * where the way out of this one is, which is why each sheet inventing its own
 * small word is fine the first time and a trap every time after.
 *
 * WHAT THE THREE ACTUALLY TAKE FROM HERE, since all three are
 * `DialogSurface`s and that surface already answers Escape itself: the press
 * away, always — a surface has no way to hear a press that lands outside it —
 * and Escape in the one case the surface cannot hear, which is a press after
 * focus has left the sheet. Click the world behind an open sheet and focus is
 * on the body; the surface's own `onKeyDown` never fires, and the listener
 * here does. So the two halves do not overlap, and the `[data-jar-surface]`
 * check below is this hook standing aside for the half that is not its own.
 *
 * ── THE ONE THAT TAKES IT ─────────────────────────────────────────────────
 *
 * A statement's provenance room (`.jar-prov-room`), driven from
 * `pages/Home.tsx`. It was five, then three, and the list has got shorter
 * every time without a line of this file changing, which is the whole
 * argument for the hook: each surface takes its way out with it. The account
 * sheet became a card under the settings cog and closes itself from inside
 * `components/Menu.tsx`, because it belongs to that bar rather than opening
 * over the world. The antechamber moved to the settings page and owns its
 * dismissal there. A ROOM'S SETTINGS and THE JOIN SHEET went on 2026-10-12
 * with rooms themselves (founder: "방 없애") — the first had been unable to
 * mount since 2026-10-09, and the second was the way into a place with no
 * way out. `KEEP_SHEET`, the list that held `.jar-settings` out of "outside"
 * for those two, went with them.
 *
 * ── THE SEVEN THAT DO NOT, EACH FOR A STATED REASON ───────────────────────
 *
 * Grouped, because they are three different situations and only one of them
 * is a decision. (It was seven with rooms in the product; the room form is
 * struck below rather than renumbered, because the count is what a reader
 * checks the list against.)
 *
 *   REFUSED ON PURPOSE, AND MUST STAY REFUSED — the notepad and the
 *   composer, `components/InspirationComposer.tsx`. `DialogSurface`'s own
 *   header puts it in the list of what stays modal "(unsaved words, and the
 *   audit's §2.1(d) wants them harder to leave by accident, not easier)".
 *   A note is the one thing in this product a stray press must not end:
 *   leaving it commits, every way out is wired to commit, and none of those
 *   ways is a press on the dark behind the page. If press-away is ever
 *   lifted into `DialogSurface` for every modal surface, this one needs an
 *   opt-OUT in the same change.
 *
 *   HOLDING WORDS SOMEBODY IS PARTWAY THROUGH TYPING — the agent's name
 *   sheet (`Home.tsx`, `.jar-seek` + `.jar-roomform-box`) and the archive's
 *   search (`components/InspirationSearch.tsx`). The room form
 *   (`space-kinds/GroupPanel.tsx`) was the third and is gone with rooms.
 *   Same class of harm as the notepad
 *   and a smaller amount of it: a half-typed name or query is cheap to
 *   retype and still annoying to lose. Unanswered rather than decided —
 *   nobody has ruled on these three, and the honest state of the product is
 *   that they were never wired rather than that they were argued about. The
 *   field's own Escape is already protected either way: the key handler
 *   below stands aside for anything editable, because leaving a half-typed
 *   name is not the same act as leaving the sheet.
 *
 *   READ-ONLY SHEETS THAT SIMPLY NEVER OPTED IN, and which are the three a
 *   reader of this file would most reasonably expect to be covered: the
 *   memory card (`Home.tsx`, `.jar-panel`), the reading comparison
 *   (`components/ReadingChanges.tsx`) and the principle's share sheet
 *   (`components/PrincipleShare.tsx`). Nothing is lost by closing them, so
 *   the founder's sentence applies to them as directly as it applied to the
 *   sheet it was said about. The memory card is the one with a complication
 *   worth naming before anybody wires it: it opens over the field, and a
 *   press on the field behind it is how you select ANOTHER memory — so
 *   "close this" and "open that" arrive as one press, and which should win
 *   is a question for the founder rather than for this file. `KEEP_PROV` in
 *   `Home.tsx` already records half of that thought by naming `.jar-panel`
 *   as a place the provenance room must not read as "away".
 *
 * ── THE ALTERNATIVE, AND WHY IT WAS NOT TAKEN HERE ────────────────────────
 *
 * Lift press-away into `DialogSurface` behind `modal === true` — then the
 * original sentence becomes true, and the two halves already do not overlap
 * (see below). It is the better end state and it was deliberately not done
 * in this pass, for one reason that is not scheduling: it would hand
 * press-away to the notepad, against a decision written down in that
 * component's own surface header, and a change that makes a rule universal
 * by breaking the one case the rule was consciously excluded from is not an
 * improvement. The order is: rule on the three read-only sheets, give
 * `DialogSurface` the behaviour with an opt-out, then delete this section.
 *
 * ── AND THE MECHANICS, WHICH BELONG TO THE HOOK RATHER THAN TO THE LIST ───
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
 * belonging to every field inside a sheet — an agent's name, the reflect
 * answer, and while rooms existed a room's name box, each of which handles
 * the key itself because
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
