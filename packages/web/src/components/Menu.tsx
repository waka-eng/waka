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
 * everything about the account, as it always was — and, since 2026-10-11, an
 * "i" beside the cog holding how the product works, because that is a
 * question the chrome had no door for at all. The left corner is talking,
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
import { useEffect, useRef, useState, type ReactNode } from "react";

import { HowItWorksPanel } from "./HowItWorksPanel";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";
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
   * THE ROW THE ONE-PRESS WAY BACK GOES TO — your own top of mind.
   *
   * The back control on a page that is none of the views pressed `items[0]`,
   * on the grounds that the list is ordered you-first. Then the ladder grew
   * a rung on the left — Inspirations, Claims, top of mind, Principles — and
   * `items[0]` became Inspirations, so a button reading "Your top of mind"
   * opened the archive instead. A label and a destination decided by two
   * different facts drift apart; this flag makes them the same fact.
   */
  home?: boolean;
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
  /* `onSettings` IS GONE WITH THE PAGE IT NAVIGATED TO. It was added when
     the founder asked for "more of a hover card ... so that it's not
     moving the page to a new page", which made the corner answer checks in
     place and left the page one press further for everything else. The
     founder has since closed that gap from the other end — "I want all
     setting-related stuff to be only accessible through the drop down and
     not be its own thing" — so there is no page to navigate to, and a prop
     for reaching it would be a door onto nothing. */

  /** Who you are signed in as, for the card to say so. */
  account?: { name?: string | null; email?: string | null } | null;
  /**
   * ═══ ALL OF SETTINGS, IN THE CARD ════════════════════════════════════
   *
   * Founder, twice. "How do I kind of make it more of a drop down when I
   * click on this settings icon rather than a new page", and then, once
   * the card held two of the controls and a link to the rest: "I want all
   * setting-related stuff to be only accessible through the drop down and
   * not be its own thing."
   *
   * So the split by how-often is gone with the page. `SettingsPanel`
   * renders everything that survived the prune and its header says what
   * did not; this component contributes the anchoring, the scrim and the
   * dismissal, which is what a corner owns.
   *
   * ABSENT RATHER THAN DISABLED where a surface cannot offer them: a flat
   * screen has no session wiring into this component, and a card of dead
   * fields is worse than a card with none. The name and address still show
   * in that case, because a check is the other thing this corner is for.
   */
  settings?: Omit<SettingsPanelProps, "locale" | "email" | "onSignOut" | "onClose"> | null;
  /** Leaving. Absent on a surface that cannot sign out. */
  onSignOut?: () => void;
  agentSetup?: { id: string; sequence: number } | null;
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
  actions?: ReactNode;
  /** Hidden while a panel owns the screen, so two sheets never stack. */
  hidden?: boolean;
}

export function Menu({ locale, items, current, label, left, actions, account, settings, onSignOut, hidden, agentSetup }: MenuProps): JSX.Element | null {
  /* THE SWITCHER'S OWN OPEN STATE IS GONE WITH THE SHEET IT OPENED. The
     three rungs are laid out rather than listed (see `.waka-rungs`), so there
     is nothing to expand, nothing to focus into, nothing to close on Escape
     and nothing to close when the bar hides. Four pieces of state and
     lifecycle went with one piece of chrome. */
  /**
   * WHICH CARD IS HANGING OFF THE CORNER — one value, not two booleans.
   *
   * The corner holds two triggers now (the "i" and the cog) and each opens
   * a card the width of the corner. Two independent `open` flags would let
   * both be true, and two 26rem cards stacked on the same right edge is a
   * state nobody can read their way out of. The reference says the same thing
   * about the component class these cards belong to — Popover: "Don't nest
   * popovers inside other popovers; it creates confusing focus and
   * navigation." One slot means pressing either trigger puts the other
   * card away, which is also what a person expects from two buttons 44px
   * apart.
   */
  const [corner, setCorner] = useState<null | "settings" | "info">(null);
  const [setupId, setSetupId] = useState<string | undefined>();
  useEffect(() => { if (agentSetup) { setSetupId(agentSetup.id); setCorner('settings'); } }, [agentSetup]);
  const account_open = corner === "settings";
  useEffect(() => {
    if (hidden) setCorner(null);
  }, [hidden]);

  /**
   * ═══ CLOSING GIVES THE PRESS BACK TO THE BUTTON THAT OPENED IT ═════════
   *
   * This was the real gap, and it is the corner's own standing complaint in
   * a different costume: founder, one surface over, "I feel like I'm lost
   * how to go back." A keyboard user pressed the cog, tabbed into the card,
   * pressed Escape — and focus went to `<body>`, which means the next Tab
   * starts the whole page again from the top. The card has three ways out
   * (the scrim, Escape, a control inside it that is done) and all three left
   * focus nowhere.
   *
   * The reference puts this on dialogs rather than on popovers, but the reason it
   * gives is about the TRIGGER relationship, which these cards have in full:
   * the surface is "anchored to the trigger", so the trigger is where the
   * person was and where they should be put back. Focus moves BEFORE the
   * state change, because after it the element holding focus has unmounted
   * and the browser has already dropped the selection to `<body>`.
   *
   * ── THREE THINGS THE REFERENCE OFFERS THAT ARE DELIBERATELY NOT HERE ───
   *
   * A FOCUS TRAP. The reference reserves it for dialogs, whose backdrop "blocks page
   * interaction" — these cards do not block the page, and trapping focus in
   * a thing a person can click past is a cage with an open door. Our scrim
   * is a dismiss target, not a modal barrier.
   *
   * ARROW-KEY MOVEMENT BETWEEN THE GROUPS. That is DropdownMenu behaviour,
   * and the settings card is explicitly not one — the reference: "Don't use a
   * DropdownMenu for navigation", and more to the point a DropdownMenu is
   * "a list of actionable items". The card is a name field, a language
   * picker and three Collapsibles, and Collapsible takes Tab. Adding arrows
   * would teach a menu model to something that is not a menu.
   *
   * AN EXPLICIT CLOSE BUTTON. The reference, on popovers: "Provide a clear way to close:
   * EITHER by clicking outside OR with an explicit close button." The scrim
   * is the first of those, and it is full-screen, so the clearer of the two
   * is already there. A visible "×" in a corner card would be the one piece
   * of chrome the founder's standing rule rules out: "only the most
   * absolutely necessary things should be shown."
   *
   * ── EXCEPT ON TOUCH, WHERE THE SCRIM IS NOT FINDABLE (2026-10-17) ──────
   * The scrim is invisible by design, and on a phone the card covers most of
   * the screen, so "tap outside" means tapping a sliver nobody can see is a
   * target. The mobile audit watched people swipe Back instead — which left
   * the app. So on a coarse pointer the card carries a plain "Close" inside
   * itself (the corner stays the corner's: no new control lands there). A
   * fine pointer keeps the card as it was. (Back closing the card instead of
   * the page is a follow-up: docs/known-issues.md, "Layer history under
   * replace/reload".)
   */
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const infoTrigger = useRef<HTMLButtonElement>(null);
  const settingsLeave = useRef<(() => Promise<boolean>) | null>(null);
  const leaving = useRef(false);
  const changeCorner = async (next: typeof corner) => {
    if (leaving.current) return;
    if (corner === 'settings' && next !== 'settings' && settingsLeave.current) {
      leaving.current = true;
      const saved = await settingsLeave.current();
      leaving.current = false;
      if (!saved) return;
    }
    if (next === null) (corner === 'info' ? infoTrigger : settingsTrigger).current?.focus();
    setCorner(next);
  };
  const close = () => { void changeCorner(null); };

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
    if (!corner) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [corner]);

  if (hidden) return null;

  /* The name on the trigger is the view you are in; a page that is none of
     them (settings, a conversation) says the first rung rather than a blank
     control, because the switcher's job there is still to offer a way back
     into the three. */

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
              onClick={() => (items.find((item) => item.home) ?? items[0] ?? items.find((item) => item.id === current))?.onSelect()}
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
        ) : items.length ? (
          /**
           * THE THREE WORDS THEMSELVES, NOT A DOOR TO THEM.
           *
           * Founder: "brainstorm better way to help users see their
           * inspirations and principles. i dont like current dropdown way to
           * do it."
           *
           * A dropdown is the wrong instrument for this particular three, and
           * the reason is what they ARE. They are not unrelated destinations
           * that happen to need a list — they are the same material at three
           * depths: what you kept, what it adds up to now, and what has
           * endured. That is one axis, and an axis wants to be SEEN. Behind a
           * caret, a person cannot discover that the other two exist without
           * opening something, and the relationship between them — the whole
           * idea of the product — is invisible until they do.
           *
           * Laid out, the three words teach the model with no explanation at
           * all: left to right is upstream to downstream, and a person moving
           * rightward is moving forward through their own thinking. It also
           * costs a press. The caret is gone, the sheet is gone, and the one
           * you are on is simply the one that is lit — light is this
           * product's only meaning channel and it does the work here without
           * a highlight, a pill or a rule under anything.
           *
           * AND THE INFO ICONS GO WITH IT, which is a gain rather than a
           * loss. Founder, earlier: "there should be like an info icon next
           * to each of the top of mind, principles, the inspirations so that
           * users can see what these are." Three icons in a list answered
           * that question in the one place it is least useful — before you
           * arrive, about a thing you have not seen. Each surface carries its
           * own line now, where the question is actually asked.
           */
          <nav className="waka-rungs" aria-label={t(locale, "worldMenuLabel")}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`waka-rung${item.id === current ? " waka-rung--here" : ""}`}
                aria-current={item.id === current ? "page" : undefined}
                disabled={item.disabled}
                onClick={item.onSelect}
              >
                {t(locale, item.label)}
                {item.note ? <span className="sr-only jar-saved-count">{item.note}</span> : null}
              </button>
            ))}
          </nav>
        ) : null}

        <span className="waka-corner-place">
        {actions}
        {/* ═══ AN "i" BESIDE THE COG ════════════════════════════════════
            Founder: "lets add a button next to the settinsg of info icon
            and in there put all things to explain how waka works."

            LEFT OF THE COG, not right of it. The cog has been the last
            thing on that line since the product had a line, and a hand
            that reaches for the screen's corner should still land on it.
            The new door takes the position that was empty.

            IT IS THE SECOND DOOR THIS CORNER HAS EVER HAD, and it earns
            that by asking a different question. The cog answers "change
            something about me". The "i" answers "what is this thing
            doing" — which until today had no door at all, because the
            answer was buried on the settings page and then deleted from
            it. See `HowItWorksPanel` for what came back and what did
            not. */}
        <button
          type="button"
          ref={infoTrigger}
          className="waka-corner waka-corner--info"
          aria-label={t(locale, "worldHowItWorksTitle")}
          aria-expanded={corner === "info"}
          onClick={() => void changeCorner(corner === "info" ? null : "info")}
        >
          {/* A RING AND AN "i", drawn rather than typed. The glyph has to
              sit on the cog's own optical weight — same 20px box, same
              1.3 stroke, same round joins — or two buttons 44px apart
              read as two different products. Drawn also means it cannot
              be restyled by the type scale or picked up by a font swap,
              which is the whole reason the dock's plus is a path too. */}
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.4" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <circle cx="10" cy="6.3" r="0.85" fill="currentColor" />
            <path
              d="M10 9.1v4.7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>

        <button
          type="button"
          ref={settingsTrigger}
          className="waka-corner waka-corner--settings"
          aria-label={t(locale, "worldSettingsOpen")}
          aria-expanded={account_open}
          onClick={() => { setSetupId(undefined); void changeCorner(corner === "settings" ? null : "settings"); }}
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
        {corner ? (
          <>
            {/* FULL-SCREEN, AND NOT AIMED AT. The same reasoning the list's
                scrim carries: "a way out you have to aim at is not one." It
                is a button rather than a div so it is a real press target
                with a real handler, and `aria-hidden` + `tabIndex={-1}` keep
                it out of the reading order — Escape is the keyboard's way
                out, and it now hands focus back to the trigger. */}
            <button
              type="button"
              className="waka-menu-scrim"
              aria-hidden="true"
              tabIndex={-1}
              onClick={close}
            />
          {/* ═══ ONE PAINTED SURFACE, TWO THINGS SAID ON IT ═══════════
              `.waka-account` is the corner's popover surface — the border,
              the raised ground, the measure, the bound that keeps it on a
              short screen — and both cards wear it so the corner has one
              material rather than two. The reference names this split exactly:
              the "Popover surface" is "owned by Popover", and the
              "Popover content" is "caller-supplied content rendered inside
              the surface".

              NO `role="note"` WHEN THERE IS A FORM INSIDE. It said `note`
              unconditionally, which is a landmark for STATIC commentary —
              and the thing inside it is a name field, a language picker
              and three disclosures. A screen reader announcing a note and
              then reading out editable fields describes a surface that
              does not exist. `SettingsPanel` already carries its own
              `role="group"` with a name, and `HowItWorksPanel` carries a
              group named by its heading, so the content supplies the
              semantics and the surface supplies the paint. The bare
              name-and-address check really IS a note, and keeps it. */}
          {corner === "info" ? (
            <span className="waka-account waka-account--about">
              <button type="button" className="waka-account-close" onClick={close}>{t(locale, "worldClose")}</button>
              <HowItWorksPanel locale={locale} />
            </span>
          ) : settings ? (
            <span className="waka-account waka-account--settings">
              <button type="button" className="waka-account-close" onClick={close}>{t(locale, "worldClose")}</button>
              <SettingsPanel {...settings} locale={locale} initialAgentId={setupId}
                onBeforeLeave={guard => { settingsLeave.current = guard; }}
                email={account?.email ?? null}
                onSignOut={onSignOut ?? (() => undefined)}
                onClose={close} />
            </span>
          ) : (
            /* THE BARE CARD STILL OFFERS THE WAY OUT when the page has one.
               A page without the full settings (your days) showed who you
               are and nothing else, so the corner a person reaches for to
               leave could not leave. It is a group, not a note, once it
               holds a control — a note is static commentary. */
            <span className="waka-account" role={onSignOut ? "group" : "note"}
              aria-label={onSignOut ? t(locale, "worldSettingsOpen") : undefined}>
              {account?.name ? <span className="waka-account-name">{account.name}</span> : null}
              {account?.email ? <span className="waka-account-email">{account.email}</span> : null}
              {onSignOut ? (
                <button type="button" className="waka-account-out" onClick={() => { close(); onSignOut(); }}>
                  {t(locale, "worldSignOutLower")}
                </button>
              ) : null}
            </span>
          )}
          </>
        ) : null}
        </span>
      </div>
    </>
  );
}
