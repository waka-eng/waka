/**
 * THE MENU — where every destination lives, so the home page holds none.
 *
 * This exists to be the answer to feature accretion. The pattern it replaces:
 * a feature ships, it needs a way in, and the way in becomes another control
 * on the main screen — until the screen is a list of everything the product
 * can do and no longer says what it is for. The two changes merged immediately
 * before this was written were a cue explaining how inspirations form a
 * reading and a help line explaining the same thing again, both added beside
 * everything else, because the loop was not legible and copy is the cheapest
 * thing to add.
 *
 * So the rule this encodes, founder ruling: THE HOME PAGE HOLDS THREE THINGS —
 * the top of mind, the character, and the box you keep things in. Everything
 * else is behind the hamburger on the left; everything about the account and
 * its agents is behind the gear on the right. Nothing earns a permanent place
 * on the home page by being new, important, or recently broken.
 *
 * ITEMS CARRY ACTIONS, NOT URLS. Home navigates by moving a camera through its
 * own world, not by changing the path, so a menu of links could only reach the
 * handful of screens that happen to have addresses. Taking a callback per item
 * is what lets this hold "Inspirations", which is a place in the field, beside
 * "Claims", which is a route — without the menu knowing which is which.
 *
 * A long menu is not the failure mode. A long home page is.
 */
import { useEffect, useId, useRef, useState } from "react";

import { t, type MessageKey, type SupportedLocale } from "../lib/locales";

export interface MenuItem {
  /** Stable key; also what a test names a row by. */
  id: string;
  label: MessageKey;
  onSelect: () => void;
  /**
   * A row may be busy or broken, and must say so HERE.
   *
   * The Inspirations button used to live on the page and carried the field's
   * own state — "Opening inspirations…" while a page was in flight, "Try
   * again" after one failed, disabled so a second press could not stack a
   * second fetch. Moving the destination into this menu without bringing that
   * with it would have turned a visible failure into a silent one, which is a
   * worse bug than the crowded page the move was fixing.
   */
  disabled?: boolean;
  /** Carried onto the row so the field's own styles and tests still find it. */
  className?: string;
  /**
   * How much is behind this door, announced but not printed.
   *
   * The archive's size rode on the old Inspirations button as a screen-reader
   * span. It is a fact about the destination, so it moved with the
   * destination — and it stays sr-only here for the same reason it was
   * sr-only there: "states render, numerals never" governs the SCREEN, and a
   * count is still the honest thing to say out loud.
   */
  note?: string;
}

export interface MenuProps {
  locale: SupportedLocale;
  /** Ordered as the loop runs. The caller owns the order — see Home. */
  items: readonly MenuItem[];
  /** Everything about this account and its agents. */
  onSettings: () => void;
  /** Hidden while a panel owns the screen, so two sheets never stack. */
  hidden?: boolean;
}

export function Menu({ locale, items, onSettings, hidden }: MenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const closer = useRef<HTMLButtonElement | null>(null);

  /* Escape closes, and focus moves into the sheet when it opens — a sheet you
     cannot leave by keyboard is a sheet that traps a person on this screen. */
  useEffect(() => {
    if (!open) return;
    closer.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* A hidden menu closes rather than lingering behind whatever took the
     screen: reopening to a sheet you left ten minutes ago is a small haunt. */
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  if (hidden) return null;

  return (
    <>
      <div className="waka-corners" data-jar-chrome="1" data-jar-interactive="1">
        <button
          type="button"
          className="waka-corner"
          aria-label={t(locale, "worldMenuOpen")}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
        >
          {/* Three rules, not an icon font: the glyph is the shape it means. */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M3 6h14M3 10h14M3 14h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>

        <button
          type="button"
          className="waka-corner"
          aria-label={t(locale, "worldSettingsOpen")}
          onClick={onSettings}
        >
          {/* A COG, NOT A SUN.
              What was here was a small circle with eight even rays around it,
              and in a product whose only meaning channel is LIGHT — the
              companion dims, the field's orbs burn, a busy day is a brighter
              day — a radiating circle reads as brightness. Founder, pointing
              at this corner: "doesn't look like settings." It looked like a
              theme toggle, because it was drawn like one.
              This is a six-toothed gear: teeth, a root circle between them,
              and a hub. Six rather than eight so the teeth survive at 20px. */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M10.00 4.10 A5.9 5.9 0 0 1 11.13 4.21 L12.47 2.39 A8.0 8.0 0 0 1 15.35 4.05 L14.45 6.13 A5.9 5.9 0 0 1 15.11 7.05 A5.9 5.9 0 0 1 15.58 8.08 L17.83 8.34 A8.0 8.0 0 0 1 17.83 11.66 L15.58 11.92 A5.9 5.9 0 0 1 15.11 12.95 A5.9 5.9 0 0 1 14.45 13.87 L15.35 15.95 A8.0 8.0 0 0 1 12.47 17.61 L11.13 15.79 A5.9 5.9 0 0 1 10.00 15.90 A5.9 5.9 0 0 1 8.87 15.79 L7.53 17.61 A8.0 8.0 0 0 1 4.65 15.95 L5.55 13.87 A5.9 5.9 0 0 1 4.89 12.95 A5.9 5.9 0 0 1 4.42 11.92 L2.17 11.66 A8.0 8.0 0 0 1 2.17 8.34 L4.42 8.08 A5.9 5.9 0 0 1 4.89 7.05 A5.9 5.9 0 0 1 5.55 6.13 L4.65 4.05 A8.0 8.0 0 0 1 7.53 2.39 L8.87 4.21 A5.9 5.9 0 0 1 10.00 4.10 Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              fill="none"
            />
            <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
          </svg>
        </button>
      </div>

      {open ? (
        <div
          className="waka-menu-scrim"
          data-jar-chrome="1"
          data-jar-interactive="1"
          onClick={() => setOpen(false)}
        >
          <nav
            id={panelId}
            className="waka-menu"
            aria-label={t(locale, "worldMenuLabel")}
            onClick={(event) => event.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`waka-menu-item${item.className ? ` ${item.className}` : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {t(locale, item.label)}
                {item.note ? <span className="sr-only jar-saved-count">{item.note}</span> : null}
              </button>
            ))}
            <button
              type="button"
              ref={closer}
              className="waka-menu-close"
              onClick={() => setOpen(false)}
            >
              {t(locale, "worldMenuClose")}
            </button>
          </nav>
        </div>
      ) : null}
    </>
  );
}
