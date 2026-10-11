/**
 * WHAT TO OPEN OVER THE WORLD — the left corner.
 *
 * Founder: "for your inspirations, after I click on it, I feel like I'm lost
 * how to go back, and I didn't realise clicking on top of mind would leave me
 * there." And separately: "I want to add the social feature back soon, so I
 * don't know how to make the interaction good if I replace the top left
 * button with a chat."
 *
 * Both sentences are about the same confusion, and this corner is the half of
 * the fix that the overlays alone could not deliver. Your inspirations, your
 * principles and your conversations used to be rows in the top-centre
 * switcher, listed beside your top of mind — so four entries looked like four
 * peers, and leaving one of the three meant choosing a destination from a
 * list rather than simply closing what you had opened. Three of those four
 * were never places. They are things you hold up in front of the world and
 * then put down.
 *
 * So they are here, and the switcher is left to do the one thing only it can
 * do: say whose material you are reading. Neither control can answer the
 * other's question, which is why pressing either one can no longer strand
 * you.
 *
 * WHY A LIST AND NOT THREE BUTTONS. Three corner buttons would spend the
 * whole corner on controls that are each used occasionally, on a screen whose
 * entire design argument is that the middle is empty and the edges are quiet.
 * One press to ask "what do I have", a second to pick — and the second press
 * is where the labels can afford to say "Your agent's inspirations" in full
 * rather than being squeezed into an icon's tooltip.
 *
 * AND IT IS WHERE ROOMS WILL GO. A room is a thing you open over the world
 * too, so it joins this list without displacing anything; a room is also an
 * owner whose material can be read, which the top-centre switcher already
 * generalises to. The social feature does not have to take this corner back,
 * because the corner was never about identity.
 */
import { useState } from "react";

import { DialogSurface } from "./DialogSurface";
import { MenuRows } from "./MenuRows";
import type { MenuItem } from "./Menu";
import { t, type SupportedLocale } from "../lib/locales";

export function OpenCorner({ locale, items }: {
  locale: SupportedLocale;
  items: readonly MenuItem[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);

  return (
    <span className="waka-corner-place">
      <button
        type="button"
        className="waka-corner"
        aria-label={say("worldOpen")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {/* THREE STACKED SHEETS, because that is what is behind the press:
            things of yours, layered, that come up over what you are looking
            at. It was a speech bubble while this corner was chat alone, and a
            bubble would now name one of the three rows and mislead about the
            other two. */}
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M3.2 6.6 10 3.2l6.8 3.4L10 10zM3.2 10.2 10 13.6l6.8-3.4M3.2 13.6 10 17l6.8-3.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>

      {open ? (
        /* The scrim is the corner's own, so a press anywhere else closes the
           list without also reaching the world behind it and moving the
           camera — the world never moves unless the user moved it. */
        <>
          <div className="waka-menu-scrim" onClick={() => setOpen(false)} />
          {/* A DialogSurface rather than a bare <nav>, for the three things
              it brings that a list opened by a press has to have: Escape
              closes it, Tab cannot walk out of it into the world behind, and
              closing returns focus to this corner instead of the top of the
              document. The conversations list that used to live here was
              already one — dropping to a plain element would have quietly
              lost all three. */}
          <DialogSurface
            className="waka-opens"
            aria-label={say("worldOpen")}
            onClose={() => setOpen(false)}
            onClick={(event) => event.stopPropagation()}
          >
            <MenuRows locale={locale} items={items} onChose={() => setOpen(false)} />
          </DialogSurface>
        </>
      ) : null}
    </span>
  );
}
