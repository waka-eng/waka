/**
 * THE WHOLE TOP OF THE SCREEN: where you are, where else you could be, and
 * the two things that are not places.
 *
 * WHAT THIS REPLACED, AND WHY. It was a hamburger on the left and a cog on
 * the right. The hamburger held four rows and could tell you that other
 * places existed, but never which one you were standing in — a door with no
 * label. Three of its four rows were not unrelated places at all: your
 * inspirations, your top of mind and your principles are the SAME MATERIAL AT
 * THREE DEPTHS, and the honest control for one axis is a switcher that names
 * the rung you are on.
 *
 * So the centre names the view and opens the other two. The right corner is
 * everything about the account, as it always was. The left corner is talking,
 * which until now could only be reached in the ten seconds after a save — the
 * receipt still offers it and that conversation still arrives with a subject,
 * but a corner is a door you can use on a day you have nothing to keep.
 *
 * IT COSTS THE HOME SCREEN NOTHING. "Top of mind" was already printed above
 * the statement. A label became a control, and a door disappeared.
 *
 * The rule the old file encoded still holds and still matters: THE HOME PAGE
 * HOLDS THREE THINGS — the top of mind, the character, and the box you keep
 * things in. Nothing earns a permanent place on it by being new, important,
 * or recently broken. This is the chrome around that page, and it is three
 * controls, which is the whole navigation of the product.
 *
 * A long switcher list is not the failure mode. A long home page is.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
   * HOW THIS VIEW IS MADE, in plain lines, shown on hover of the switcher.
   *
   * Founder, on the top of mind: "show hover card to explain how this is
   * created." The sentence under that label is the product's whole claim
   * about a person, and they are entitled to know how it was arrived at
   * before deciding whether to believe it.
   *
   * It hangs off the switcher rather than off a second label beside the
   * statement, because the switcher is now the only place the view is named
   * — and two labels saying "Top of mind" on one screen is the duplication
   * this whole change removed.
   *
   * Hovering explains, pressing switches. They are separate states on
   * purpose: a person reaching to read is not reaching to navigate.
   */
  explain?: string[];
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
  /** The three views, ordered as the loop runs. */
  items: readonly MenuItem[];
  /** Which one is being looked at; `null` on a page that is none of them. */
  current?: string | null;
  /**
   * What to call a page that is none of the three.
   *
   * The switcher's job is to say where you are, and falling back to the first
   * rung would have it say "Your inspirations" while you are in a
   * conversation — a control that misnames your location is worse than one
   * that says nothing. A page outside the three names itself here and the
   * list still opens, so the way back is unchanged.
   */
  label?: MenuItem["label"];
  /** Everything about this account and its agents. */
  onSettings: () => void;
  /**
   * WHOSE GROUND YOU ARE STANDING ON — the top-left corner's whole job.
   *
   * Founder: "the top left should be a drop-down modal that lets you switch
   * between your things. So like Agent 1, me." It briefly held a speech
   * bubble for talking, which was my mistake: talking moved into the box, as
   * a second destination for whatever you typed, and the corner was supposed
   * to go to the thing it was vacated for.
   *
   * Only the world has walls, so only the world passes this. A page with no
   * ground to stand on leaves the corner empty rather than inventing
   * something to put there — an empty corner is honest, and the switcher and
   * the cog are the navigation either way.
   */
  left?: ReactNode;
  /** Hidden while a panel owns the screen, so two sheets never stack. */
  hidden?: boolean;
}

export function Menu({ locale, items, current, label, left, onSettings, hidden }: MenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const panelId = useId();
  const explainId = useId();
  /* Focus lands on the first destination, not on a way out — see below. */
  const first = useRef<HTMLButtonElement | null>(null);

  /* Escape closes, and focus moves into the sheet when it opens — a sheet you
     cannot leave by keyboard is a sheet that traps a person on this screen.
     Focus goes to the FIRST DESTINATION rather than to a close control:
     opening a menu is a reach for somewhere to go, so the first thing under
     the keyboard should be somewhere to go. */
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
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

  /* The name on the trigger is the view you are in; a page that is none of
     them (settings, a conversation) says the first rung rather than a blank
     control, because the switcher's job there is still to offer a way back
     into the three. */
  const here = items.find((item) => item.id === current) ?? items[0];
  const name = label ?? here?.label;

  return (
    <>
      <div className="waka-corners" data-jar-chrome="1" data-jar-interactive="1">
        {/* The corner belongs to whoever is standing here. See `left`. */}
        {left ?? <span className="waka-corner" aria-hidden="true" />}

        {/* WHERE YOU ARE, AND THE WAY TO THE OTHER TWO. */}
        {here ? (
          <div
            className="waka-switch"
            /* The explanation follows the pointer, not the list: opening the
               list closes it, because a card over the rungs you are choosing
               between is in the way of the choice. */
            onPointerEnter={() => setExplaining(true)}
            onPointerLeave={() => setExplaining(false)}
          >
            <button
              type="button"
              className="waka-switch-trigger"
              aria-expanded={open}
              aria-controls={panelId}
              aria-describedby={explaining && !open ? explainId : undefined}
              onFocus={() => setExplaining(true)}
              onBlur={() => setExplaining(false)}
              onClick={() => { setExplaining(false); setOpen((value) => !value); }}
            >
              <span>{name ? t(locale, name) : ""}</span>
              {/* The caret turns over when the list is down: the one piece of
                  motion here, and it explains rather than decorates. */}
              <svg
                className="waka-switch-caret"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M2 4l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </button>
            {explaining && !open && !label && here.explain?.length ? (
              <span id={explainId} role="note" className="waka-switch-card">
                {here.explain.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="waka-corner"
          aria-label={t(locale, "worldSettingsOpen")}
          onClick={onSettings}
        >
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
          className="waka-menu-scrim waka-menu-scrim--under"
          data-jar-chrome="1"
          data-jar-interactive="1"
          onClick={() => setOpen(false)}
        >
          <nav
            id={panelId}
            className="waka-menu waka-menu--under"
            aria-label={t(locale, "worldMenuLabel")}
            onClick={(event) => event.stopPropagation()}
          >
            {items.map((item, index) => (
              <button
                key={item.id}
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
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {t(locale, item.label)}
                {item.note ? <span className="sr-only jar-saved-count">{item.note}</span> : null}
              </button>
            ))}
            {/* NO "CLOSE MENU" ROW. Founder, pointing at it: "this also is so
                useless." It was, and three ways out already exist and always
                did: the scrim behind it, Escape, and choosing any destination.
                A row that only undoes the press that opened the sheet is a row
                you read every time you look for a place to go — and it sat at
                the bottom of a four-item list, where it was a quarter of what
                the menu appeared to offer. */}
          </nav>
        </div>
      ) : null}
    </>
  );
}
