/**
 * THE ROWS OF A CHOICE LIST, used by both controls that have one.
 *
 * There are two such lists in the chrome and they are deliberately different
 * questions — WHOSE material you are reading (the top-centre switcher) and
 * WHAT you want to open over the world (the left corner). See `lib/page-menu`
 * for why those are two controls and not one.
 *
 * What they are NOT different about is what a row is. A row is a label, the
 * thing it does, whether it is the one you are already on, and — when a
 * person could reasonably not know what it means — a way to ask. That was
 * written once for the switcher, and the corner needed every part of it. Two
 * copies of this markup would have been two copies of the press-not-hover
 * ruling, the in-place explanation, the current-row marking and the focus
 * handoff, and the second copy would have started drifting from the first the
 * day either one was touched.
 */
import { useState, type RefObject } from "react";

import { t, type SupportedLocale } from "../lib/locales";
import type { MenuItem } from "./Menu";

export function MenuRows({ locale, items, current, first, onChose }: {
  locale: SupportedLocale;
  items: readonly MenuItem[];
  /** The row already being read, marked and still pressable. */
  current?: string | null;
  /** Focus lands on the first row when the list opens. */
  first?: RefObject<HTMLButtonElement>;
  /** Closing is the caller's business: it owns the thing that was opened. */
  onChose: () => void;
}): JSX.Element {
  /* Closing the list forgets which row was explained: reopening to a sheet
     of prose you left behind is not where anyone meant to be. */
  const [explained, setExplained] = useState<string | null>(null);
  return (
    <>
        {items.map((item, index) => (
          /* A ROW IS THE DESTINATION PLUS WHAT IT IS.
             Founder: "there should be like an info icon next to each of
             the top of mind, principles, the inspirations so that users
             can see what these are."
             The explanation used to hang off the switcher's own trigger,
             which could only ever describe the view you were ALREADY on —
             so the one person it could not help was the one who does not
             yet know what these three are. Per row it can be read before
             going anywhere, which is the whole point of asking. */
          <span key={item.id} className="waka-menu-row">
            <button
              ref={index === 0 ? first : undefined}
              type="button"
              className={`waka-menu-item${item.id === current ? " waka-menu-item--here" : ""}${item.className ? ` ${item.className}` : ""}`}
              /* The rung you are standing on is marked and still pressable:
                 pressing it closes the list, which is the same thing the
                 caret does and the thing a person expects from a control
                 they opened by mistake. */
              aria-current={item.id === current ? "page" : undefined}
              disabled={item.disabled}
              onClick={() => {
                onChose();
                item.onSelect();
              }}
            >
              {t(locale, item.label)}
              {item.note ? <span className="sr-only jar-saved-count">{item.note}</span> : null}
            </button>
            {item.explain ? (
              <>
                {/* PRESS, NOT HOVER. This list is opened by a press and is
                    used on a phone, where there is no hover to reveal
                    anything with — an explanation only a mouse can reach
                    is not an explanation. It opens the lines IN PLACE
                    rather than over the rows, so the list never covers
                    the thing you are choosing between. */}
                <button
                  type="button"
                  className="waka-menu-why"
                  aria-expanded={explained === item.id}
                  aria-label={t(locale, "worldWhatIsThis")}
                  onClick={() => setExplained((shown) => (shown === item.id ? null : item.id))}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" focusable="false">
                    <circle cx="7.5" cy="7.5" r="6.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <path d="M7.5 6.6v4.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <circle cx="7.5" cy="4.5" r="0.85" fill="currentColor" />
                  </svg>
                </button>
                {explained === item.id ? (
                  <span className="waka-menu-explain" role="note">{item.explain}</span>
                ) : null}
              </>
            ) : null}
          </span>
        ))}
    </>
  );
}
