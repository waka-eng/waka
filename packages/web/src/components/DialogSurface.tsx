import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes, type KeyboardEvent } from "react";

interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  onClose: () => void;
  active?: boolean;
  /**
   * `"modal"` — it rises in when it mounts and drops back out before it
   * closes (see `leaveAsModal`). Founder, 2026-10-15: "inspirations and chat
   * should feel like opening a new modal and closing it." Only the note, the
   * chat and their two lists wear it; Principles is walked to, not raised.
   */
  motion?: "modal";
  /**
   * `true` (the default) — a SHEET. It opens over the thing you are still in,
   * it is the only thing you can touch while it is up, and the way out of it
   * is inside it. `role="dialog"`, `aria-modal`, Tab wrapped at both ends.
   *
   * `false` — a PAGE. It is somewhere you went, reached from a bar that never
   * leaves the screen, and the way out of it is that bar. `role="region"`, no
   * `aria-modal`, and Tab walks straight out of it into the bar. See the
   * header above for the whole argument.
   */
  modal?: boolean;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button, a[href], input, textarea, select, summary, [tabindex]',
  )).filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled") ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    let at: HTMLElement | null = element;
    while (at && at !== root) {
      if (at instanceof HTMLDetailsElement && !at.open) {
        const summary = [...at.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return false;
      }
      const style = window.getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden") return false;
      at = at.parentElement;
    }
    return true;
  });
}

/**
 * A native reading/writing surface owns focus, dismissal and scrolling.
 *
 * ═══ FIFTEEN CALL SITES, TWO DIFFERENT THINGS ═══════════════════════════════
 *
 * `docs/component-audit.md` §2.1, the audit's own "highest-value finding":
 *
 *   > "Split the primitive in two, because fifteen call sites are two
 *   >  different things wearing one component. Nine are genuine sheets over a
 *   >  surface you are still in... Four are PAGES: the dock destinations."
 *
 * The four pages are the archive (`SavesOverlay`), the chats list
 * (`ConversationsOverlay`), the principles (`PrinciplesOverlay`) and the
 * claims queue (`ClaimsOverlay`); the conversation itself in `pages/Home.tsx`
 * is a fifth of the same kind. They are not dialogs over a screen. They ARE
 * the screen, reached by pressing a word in a bar that is still there when
 * you arrive. `claims.css` says so in its own voice, on `.waka-page`:
 *
 *   > "UNDER THE DOCK, OVER THE WORLD. [...] The dock (z-60) is the only
 *   >  chrome that outranks a room, because the dock is how you leave one."
 *
 * quoting the founder: *"this should be its own page, so bottom navigation
 * always visible."*
 *
 * ── THE BUG THIS PROP EXISTS TO FIX ────────────────────────────────────────
 *
 * All five rendered with `role="dialog"`, `aria-modal` and a Tab trap, which
 * said three things that were not true at once: that nothing outside them
 * exists, that the screen behind is blocked, and that the exit is inside. The
 * third is the one with teeth. `test/way-out.test.ts` exempts these very
 * surfaces from Law 2 — "every surface you can enter has a visible way out,
 * and it costs one press" — on the stated ground that "the dock is visible the
 * entire time one is open, it never moves, and its first row is called Now.
 * That is a visible way out costing one press." Both could not be true: the
 * trap wrapped Tab back to the first control INSIDE the page, so for anybody
 * working from the keyboard the dock did not exist and these four surfaces had
 * no way out at all. Measured before this change, on the archive opened by
 * keyboard from the dock: sixty presses forward and sixty backward, and not
 * one of them landed on the bar. The gate meant to catch Law 2 failures was
 * the thing excusing the worst one, on the four most-visited surfaces in the
 * product. `tools/e2e/by-keyboard.ts` holds the fix with the keys themselves.
 *
 * `aria-modal` was the quieter half of the same lie: it tells a screen reader
 * that everything outside this node is not there, so the bar the exemption
 * rests on was removed from the accessibility tree as well as from the tab
 * order.
 *
 * ── WHAT A NON-MODAL PAGE KEEPS, AND WHAT IT GIVES UP ─────────────────────
 *
 * KEPT — FOCUS ON ARRIVAL. Travelling somewhere must not drop you on the
 * document; `by-keyboard` already holds that for the two ways out of the wall
 * ("travelling with keys keeps your place"), and arriving at a destination is
 * the same act. So the page still takes focus when it mounts.
 *
 * KEPT — FOCUS RETURN TO THE OPENER. Pressing "Inspirations" and then leaving
 * should put you back on the bar you pressed, not at the top of the document.
 * This costs nothing for a page and is the difference between navigating and
 * being teleported.
 *
 * KEPT — ESCAPE, DELIBERATELY AND WITH A NARROWER MEANING. On a sheet Escape
 * is the dismissal: the sheet is a thing over your work and the key puts it
 * away. On a page it is not a dismissal, it is an accelerator for the press
 * the bar already offers — one key instead of tabbing to "Now". It is kept
 * because people have it in their hands today and taking it away would make
 * the keyboard worse in the same change that was meant to make it better, and
 * because an invisible exit is only a problem when it is the ONLY exit, which
 * is exactly what `way-out.test.ts` says: "'It has Escape' is not a reason."
 * It is not the reason here; the bar is. Escape is a second way, and a second
 * way may be invisible.
 *
 * NOT APPLICABLE — PRESS-AWAY. There is nowhere to press away TO. A sheet
 * floats on a scrim and the scrim is the press target; `.waka-page` is opaque
 * and covers the viewport, and `claims.css` argues the point where it refuses
 * the scrim: "A scrim says 'the thing behind is still the thing you are in,
 * and this is on top of it' — true of a dialog, and the exact opposite of
 * what a room is." None of the five passes a press-away handler and none
 * should: the only thing outside them is the bar, and pressing the bar is
 * navigation, not dismissal. (`lib/dismiss.ts` is untouched by this and still
 * stands aside for anything inside `[data-jar-surface]`, which both kinds
 * still carry.)
 *
 * GIVEN UP — THE TAB TRAP, which is the entire point, and `aria-modal` with
 * it. Tab from the last control in the archive now leaves the archive.
 *
 * ── WHAT STAYS MODAL, AND WHY ──────────────────────────────────────────────
 *
 * The full-page notepad is also nonmodal: its Save and Close live in the
 * sibling dock. Unsaved words are recovered by the draft store.
 * `InspirationSearch`, `PrincipleShare`, `ReadingChanges`, the settings
 * card, and a kept-memory card (`jar-panel`, z-70) remain modal: each sits
 * above a destination and owns the controls needed to leave it. A
 * confirmation is the clearest case of all: it exists to be answered, so
 * trapping Tab is the correct statement about it.
 *
 * ── WHY `role="region"` AND NOT `role="main"` OR NOTHING ───────────────────
 *
 * The audit prescribes `role="region"`, and `region` is the one landmark that
 * is true of all five: a named part of a page. `main` was the first instinct
 * and it is wrong twice — `pages/Days.tsx` already owns `<main className=
 * "waka-page">` for a destination of the same rank, and the conversation page
 * renders `ConversationPanel`, which is itself a `<main>`; a `<main>` inside a
 * `<main>` is two primary landmarks and invalid besides. Dropping the role
 * entirely was also considered and rejected: these nodes take focus on
 * arrival and are announced when they do, and an unnamed `<section>` announces
 * as nothing at all — the arrival would be silent. `region` names the place
 * you just arrived in, which is what a reader needs said.
 *
 * The element follows the role: `<section>` when it is a page, `<div>` when it
 * is a sheet. A `<div role="dialog">` is the honest spelling of a dialog —
 * there is no HTML element for one.
 */
/** How long the drop-out takes; `claims.css` `waka-modal-out` is the same. */
export const MODAL_LEAVE_MS = 180;

/**
 * CLOSE A RAISED PAGE THE WAY IT OPENED: it drops back out, then `then` runs.
 * With no raised page on screen, under reduced motion, or where the platform
 * cannot animate (jsdom has no `getAnimations`), `then` runs at once — so a
 * close is never held up by a page that is not going to move.
 */
export function leaveAsModal(then: () => void, from?: Element | null): void {
  const node = (from ?? document.querySelector('[data-motion="modal"]')) as HTMLElement | null;
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!node || still || typeof node.getAnimations !== "function") { then(); return; }
  /* ONE CLOSE PER LEAVE. A second Escape or a double-pressed Close inside
     the drop-out used to run the close twice (once now, once from the
     timer); it is the same leave, so it is ignored. */
  if (node.dataset.leaving) return;
  node.dataset.leaving = "1";
  window.setTimeout(() => {
    /* AND IF THE PAGE IS STILL HERE AFTERWARDS — a close that waits on
       something that failed — it comes back rather than staying on screen
       invisible and unpressable with no way out. */
    /* 1.5s, not one more drop-out: a draft's close waits on the recorder
       stopping, and the page must not flicker back while it does. Scheduled
       BEFORE `then`, so a close that throws still brings the page back. */
    window.setTimeout(() => { if (node.isConnected) delete node.dataset.leaving; }, 1500);
    then();
  }, MODAL_LEAVE_MS);
}

export const DialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function DialogSurface(
  { active = true, modal = true, motion, onClose, onKeyDown, children, role, ...props }, forwardedRef,
) {
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useImperativeHandle(forwardedRef, () => surface.current!, []);
  useLayoutEffect(() => {
    const node = surface.current, viewport = window.visualViewport;
    if (!active || !node || !viewport) return;
    // iOS keeps the layout viewport behind the keyboard. Only opt-in centered
    // writing sheets use these values; anchored menus keep their own position.
    const update = () => {
      if (!Number.isFinite(viewport.height) || viewport.height <= 0 || !Number.isFinite(viewport.offsetTop)) return;
      node.style.setProperty('--dialog-visible-height', `${viewport.height}px`);
      node.style.setProperty('--dialog-visible-top', `${viewport.offsetTop}px`);
      node.dataset.visualViewport = 'true';
    };
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update);
      delete node.dataset.visualViewport;
      node.style.removeProperty('--dialog-visible-height'); node.style.removeProperty('--dialog-visible-top');
    };
  }, [active]);
  useLayoutEffect(() => {
    const node = surface.current;
    if (!active || !node) return;
    if (!node.contains(document.activeElement)) {
      (focusableWithin(node)[0] ?? node).focus({ preventScroll: true });
    }
    return () => {
      if (opener.current?.isConnected &&
        (node.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.current.focus({ preventScroll: true });
      }
    };
  }, [active]);
  useLayoutEffect(() => {
    // Saving/advancing can remove the focused action. Keep Escape and Tab
    // inside the active sheet while the next content is loading, without
    // moving focus away from an editor or another deliberate focus target.
    //
    // THIS ONE IS NOT A TRAP AND SO IT APPLIES TO BOTH KINDS. It only fires
    // when focus is on the BODY, which is nowhere — the browser's answer to
    // "the element you were on was just removed". Putting focus back on the
    // surface is keeping somebody's place, not holding them in; a page that
    // drops you on the document when a row disappears is the same lost
    // feeling the law is about, one layer down. Tabbing out to the dock
    // leaves focus on a dock button rather than on the body, so a page the
    // person has deliberately left is not pulled back.
    const node=surface.current;
    if(active&&node&&document.activeElement===document.body)node.focus({preventScroll:true});
  });

  /* THE ATTRIBUTES BOTH KINDS SHARE, so the two spellings below differ only
     in the element and in what each kind claims about the screen behind it.
     `data-jar-surface` stays on both: `lib/surface-input.ts` uses it to give
     a surface its keys before the spatial world's shortcuts, `lib/dismiss.ts`
     uses it to stand aside from an Escape a surface handles itself, and
     `home.css` dresses focus rings through it. None of that is about being
     modal, and a page wants every bit of it. */
  const attrs = {
    ...props,
    ref: surface,
    role: role ?? (modal ? "dialog" : "region"),
    /* ONLY A SHEET CLAIMS THE REST OF THE SCREEN IS NOT THERE. On a page this
       attribute deleted the dock from the accessibility tree — the very
       control `way-out.test.ts` points at as the way out. */
    "aria-modal": modal && active ? true : undefined,
    "aria-hidden": active ? undefined : true,
    tabIndex: -1,
    "data-jar-surface": "1",
    "data-motion": motion,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (!active || event.defaultPrevented || event.nativeEvent.isComposing ||
        event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (motion === "modal") leaveAsModal(onClose, event.currentTarget);
        else onClose();
      } else if (event.key === "Tab" && modal) {
        /* ═══ THE TRAP, AND ONLY FOR A SHEET ══════════════════════════════
           A trap is a true statement about a dialog: the rest of the screen
           is inert behind its scrim, so wrapping Tab round its own controls
           is the keyboard's version of what the eye already sees.

           It is a false statement about a page, and an expensive one. The
           four dock destinations wrapped Tab back to their own first control
           — so the bar that `way-out.test.ts` calls their way out, the bar
           that `claims.css` says "is how you leave one", could not be
           reached with the keyboard at all. Letting the key through is the
           whole fix: Tab walks out of the page and into the chrome, which is
           what Tab means. */
        const items = focusableWithin(event.currentTarget);
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
  };

  return modal
    ? <div {...attrs}>{children}</div>
    /* A PAGE IS A `<section>`. See "WHY `role=\"region\"`" in the header: it
       is the one landmark true of all five, `<main>` is taken by `Days.tsx`
       and by `ConversationPanel` inside the conversation page, and no role at
       all would make arriving somewhere silent. */
    : <section {...attrs}>{children}</section>;
});
