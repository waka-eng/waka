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
import { MenuRows } from "./MenuRows";

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
  explain?: string;
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
  /**
   * THE FULL SETTINGS PAGE — reached FROM the card, not instead of it.
   *
   * Founder: "when I click on the settings button on the top right, can you
   * make it so that it's more of a hover card that shows so that it's not
   * moving the page to a new page?"
   *
   * Right, and for a reason worth naming: most of what a person wants from
   * that corner is to CHECK something — who am I signed in as, how do I get
   * out — and a whole page navigation to answer a check costs you the screen
   * you were reading. The card answers the checks in place; the page is one
   * press further for the things that genuinely need a page.
   */
  onSettings: () => void;
  /** Who you are signed in as, for the card to say so. */
  account?: { name?: string | null; email?: string | null } | null;
  /** Leaving. Absent on a surface that cannot sign out. */
  onSignOut?: () => void;
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

export function Menu({ locale, items, current, label, left, onSettings, account, onSignOut, hidden }: MenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  /** Which row has its lines open, if any. One at a time: a list where every
      row can be expanded at once is a page of prose wearing a list's shape. */
  /** Whether the account card is showing under the cog. */
  const [account_open, setAccountOpen] = useState(false);
  const panelId = useId();
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

  /* The two things this bar can open are mutually exclusive: one sheet at a
     time, so neither is read through the other. */
  useEffect(() => {
    if (open) setAccountOpen(false);
  }, [open]);
  useEffect(() => {
    if (hidden) setAccountOpen(false);
  }, [hidden]);

  /**
   * ESCAPE CLOSES THE CARD. THE PRESS-AWAY IS THE SCRIM, AND IT WAS MISSING.
   *
   * This comment used to say "and a press anywhere else does too — the same
   * two ways out the list has", above an effect that registers a `keydown`
   * and nothing else. The list had a full-screen scrim; this card had no
   * scrim and no pointer listener, so the only ways out were Escape and
   * finding the cog again. Both of those are invisible, which is precisely
   * the complaint this product keeps getting: founder, on the surface one
   * corner over, "I feel like I'm lost how to go back."
   *
   * The comment is the interesting part of the bug. It described the right
   * behaviour, so every reader after it — including the audit that walked
   * these two corners looking for exactly this — had reason to believe the
   * press-away existed. A comment that states an intention the code does not
   * implement is worse than no comment: it spends the one chance anyone had
   * to notice.
   *
   * The scrim is now rendered beside the card, so the two ways out are real
   * and are the same two the list offers. This effect keeps the key, because
   * the card is not a `DialogSurface` — it is a `role="note"` inside the bar,
   * which is right (it is a check, not a sheet to work in) and means nothing
   * else is listening for Escape on its behalf.
   */
  useEffect(() => {
    if (!account_open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [account_open]);

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
        {/* A PAGE THAT IS NOT ONE OF THE THREE GETS A WAY BACK, NOT A LIST.
            Founder: "I find it so annoying that from talk with WAKA there's
            no one click to go back to top of mind."
            There was not. The switcher opened a list and the list held the
            row — two presses to leave a surface you did not travel to on
            purpose. On a conversation, the settings or your days, the
            question is not "which view" but "how do I get back", and a
            control that answers a different question than the one being
            asked is the whole reason this felt annoying rather than merely
            slow. One press, and it says where it goes. */}
        {label ? (
          <div className="waka-switch">
            <button
              type="button"
              className="waka-switch-trigger"
              /* THE FIRST ROW IS YOUR OWN TOP OF MIND, and that is a
                 property of the list rather than a string to match on.

                 This matched `id.endsWith("top-of-mind")` and silently
                 stopped working the moment the switcher became a list of
                 OWNERS — the ids are "me" and "agent:<id>" now, nothing ends
                 in "top-of-mind", `find` returned undefined, and the one
                 control the founder asked for by name ("I find it so annoying
                 that from talk with Waka, there's no one click to go back to
                 top of mind") became a button that did nothing at all. A
                 press that no-ops is worse than a missing control: it reads
                 as the product being broken rather than as a thing not
                 offered.

                 `items[0]` is the honest expression of the intent. The list
                 is ordered you-first by construction in `lib/page-menu`, and
                 the fallback below means this cannot become a dead press
                 again even if the shape changes under it. */
              onClick={() => (items[0] ?? items.find((item) => item.id === current))?.onSelect()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
                <path
                  d="M6 2L3 5l3 3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span>{t(locale, "worldMenuTopOfMind")}</span>
            </button>
          </div>
        ) : here ? (
          <div
            className="waka-switch"
          >
            <button
              type="button"
              className="waka-switch-trigger"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((value) => !value)}
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
            {/* NOTHING ON HOVER. This carried the explanation of whichever
                view you were on, and the per-row icons in the list replaced
                it — founder: "since u added info icon next to dropdown items,
                remove text that shows when hovering on dropdown button".
                Two places saying the same thing is one too many, and this was
                the weaker of them: it could only ever describe the view you
                had already arrived at, and it could only be reached by a
                pointer. */}
            {open ? (
              <>
                {/* THE WAY OUT IS THE WORLD, AND THE LIST IS UNDER THE
                    CONTROL. The sheet used to be centred on the VIEWPORT,
                    which is only under the trigger when the two corners
                    happen to be the same width — founder: "I want the
                    dropdown to be centered, not skewed towards the left."
                    It hangs from the switch now, so it is centred on the
                    thing that opened it by construction rather than by
                    coincidence. The scrim stays full-screen behind it: a way
                    out you have to aim at is not one. */}
                <button
                  type="button"
                  className="waka-menu-scrim"
                  aria-hidden="true"
                  tabIndex={-1}
                  onClick={() => setOpen(false)}
                />
                <nav
            id={panelId}
            className="waka-menu waka-menu--under"
            aria-label={t(locale, "worldMenuLabel")}
            onClick={(event) => event.stopPropagation()}
          >
            <MenuRows locale={locale} items={items} current={current} first={first}
              onChose={() => setOpen(false)} />
            {/* NO "CLOSE MENU" ROW. Founder, pointing at it: "this also is so
                useless." It was, and three ways out already exist and always
                did: the scrim behind it, Escape, and choosing any destination.
                A row that only undoes the press that opened the sheet is a row
                you read every time you look for a place to go — and it sat at
                the bottom of a four-item list, where it was a quarter of what
                the menu appeared to offer. */}
          </nav>
              </>
            ) : null}
          </div>
        ) : null}

        <span className="waka-corner-place">
        <button
          type="button"
          className="waka-corner"
          aria-label={t(locale, "worldSettingsOpen")}
          aria-expanded={account_open}
          onClick={() => setAccountOpen((value) => !value)}
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

        {/* WHO YOU ARE, AND THE WAY OUT — answered where you asked.
            A check does not deserve a page: "which account is this" and "how
            do I leave" are the two things this corner is reached for, and a
            navigation to answer either costs the screen you were reading.
            Everything that genuinely needs a page is one press further. */}
        {account_open ? (
          <>
            {/* FULL-SCREEN, AND NOT AIMED AT. The same reasoning the list's
                scrim carries: "a way out you have to aim at is not one." It
                is a button rather than a div so it is a real press target
                with a real handler, and `aria-hidden` + `tabIndex={-1}` keep
                it out of the reading order — the card already names its own
                way out for anyone arriving by keyboard. */}
            <button
              type="button"
              className="waka-menu-scrim"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setAccountOpen(false)}
            />
          <span className="waka-account" role="note">
            {account?.name ? <span className="waka-account-name">{account.name}</span> : null}
            {account?.email ? <span className="waka-account-email">{account.email}</span> : null}
            <button
              type="button"
              className="waka-account-go"
              onClick={() => {
                setAccountOpen(false);
                onSettings();
              }}
            >
              {t(locale, "worldAllSettings")}
            </button>
            {onSignOut ? (
              <button
                type="button"
                className="waka-account-out"
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
              >
                {t(locale, "worldSignOutLower")}
              </button>
            ) : null}
          </span>
          </>
        ) : null}
        </span>
      </div>
    </>
  );
}
