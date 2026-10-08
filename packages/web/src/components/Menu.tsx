/**
 * THE MENU — where every destination lives, so the landing page holds none.
 *
 * This component exists to be the answer to feature accretion. The pattern it
 * replaces: a feature ships, it needs a way in, and the way in becomes another
 * control on the main screen — until the screen is a list of everything the
 * product can do and no longer says what it is for. The last two things merged
 * before this was written were a cue explaining how inspirations form a
 * reading and a help line explaining the same thing again, both added beside
 * everything else, because the loop was not legible and copy is the cheapest
 * thing to add.
 *
 * So the rule this encodes: THE LANDING PAGE HOLDS THREE THINGS — what you are
 * reading, the character, and the box you keep things in. Every destination is
 * behind here. Nothing earns a permanent place on the landing page by being
 * new, important, or recently broken.
 *
 * Ordered as the loop runs, same as the menu's own argument: you capture, you
 * answer what was read, you read what it adds up to now, you read what
 * endured. A person reading top to bottom is reading their own pipeline.
 */
import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { t, type MessageKey, type SupportedLocale } from "../lib/locales";

interface Destination {
  to: string;
  label: MessageKey;
}

/**
 * EVERYTHING THE PRODUCT SUPPORTS, IN ONE LIST.
 *
 * Founder ruling: the home page holds the character, the box and the reading,
 * and everything else goes in here. So this list is deliberately long. A long
 * menu is not the failure mode — a long HOME PAGE is. Putting all of it behind
 * one door is what lets the front door hold three things without any feature
 * being removed to get there.
 *
 * Ordered as the loop runs: what you kept, what was read from it and is
 * waiting on you, what it adds up to now, what endured — then the surfaces
 * that are about talking and other people rather than about the loop.
 */
const DESTINATIONS: readonly Destination[] = [
  { to: "/field", label: "worldMenuField" },
  { to: "/claims", label: "worldTabClaims" },
  { to: "/field?at=sky", label: "worldPrinciplesShortcut" },
  { to: "/field?at=review", label: "worldMenuReview" },
  { to: "/chat/new", label: "worldMenuTalk" },
  { to: "/field?at=find", label: "worldMenuFind" },
  { to: "/field?at=groups", label: "worldMenuGroups" },
] as const;

export interface MenuProps {
  locale: SupportedLocale;
}

/**
 * Top left opens where to go; top right opens who you are. Two corners, and
 * the whole top of the screen is accounted for without a bar.
 */
export function Menu({ locale }: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const navigate = useNavigate();
  const closer = useRef<HTMLButtonElement | null>(null);

  /* Escape closes, and focus lands on the thing that opened it — a sheet you
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

  return (
    <>
      <div className="waka-corners" data-jar-chrome="1">
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
          onClick={() => navigate("/profile")}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" fill="none" />
            <path
              d="M10 2.6v2.1M10 15.3v2.1M3.6 10H5.7M14.3 10h2.1M5.3 5.3l1.5 1.5M13.2 13.2l1.5 1.5M14.7 5.3l-1.5 1.5M6.8 13.2l-1.5 1.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="waka-menu-scrim" data-jar-chrome="1" onClick={() => setOpen(false)}>
          <nav
            id={panelId}
            className="waka-menu"
            aria-label={t(locale, "worldMenuLabel")}
            onClick={(event) => event.stopPropagation()}
          >
            {DESTINATIONS.map((destination) => (
              <NavLink
                key={destination.to}
                to={destination.to}
                end={destination.to === "/"}
                className="waka-menu-item"
                onClick={() => setOpen(false)}
              >
                {t(locale, destination.label)}
              </NavLink>
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
