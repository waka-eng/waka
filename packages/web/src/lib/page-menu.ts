/**
 * THE THREE VIEWS OF YOUR OWN MATERIAL, and the two corners beside them.
 *
 * THIS WAS A HAMBURGER AND IT IS NOT ANY MORE. Founder: "maybe the top center
 * of the page should stay top of mind with a carrot and then clicking that can
 * let the user change to your inspirations and principles... then the left
 * button we no longer need a hamburger and maybe that can be the entry point
 * into the chat."
 *
 * WHY THIS IS RIGHT, AND NOT JUST SMALLER. A hamburger is a door with no
 * label: it can tell you that other places exist but never which one you are
 * standing in. These three are not unrelated places that happen to need a
 * list — they are the SAME MATERIAL AT THREE DEPTHS. What you kept, what it
 * adds up to now, and what has endured. One axis, so the honest control is a
 * switcher that names the rung you are on, not a menu that hides all of them
 * equally.
 *
 * It also costs the home screen nothing. The words "Top of mind" were already
 * printed above the statement; they are the control now. A label became a
 * control, and a door disappeared.
 *
 * AND TALKING LIVES IN THE BOX, NOT IN A CORNER. It spent one commit as a
 * speech bubble on the left, which was a misreading: the founder had asked
 * for that corner to switch which of your things you are standing on, and
 * said talking should be reachable from the box you type in. It is — "Chat
 * about this" sits beside Keep, as a second destination for whatever you
 * just wrote. The corner went back to what it was asked for.
 *
 * WHAT IS STILL NOT HERE, AND WHY:
 *
 *   - Rooms and agents. Set aside by ruling. The walls exist and the camera
 *     still travels them; they are not places the product offers.
 *   - Your days. Set aside by ruling. `/days` still answers and every dot on
 *     it still opens the reading on that date.
 *   - Find. It is a thing you do TO your inspirations, so it is a search
 *     field on that page rather than a destination of its own.
 */
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { MenuItem } from "../components/Menu";
import { t, type SupportedLocale } from "./locales";

export interface PageMenu {
  items: MenuItem[];
  /** Which of the three is being looked at, or null on a page that is none. */
  current: string | null;
  onSettings: () => void;
}

/**
 * The three, in the order the loop runs — and each says how it is made.
 *
 * Founder, on the top of mind: "show hover card to explain how this is
 * created." The other two get the same treatment because the question is the
 * same question: a person looking at a page of their own material should be
 * able to find out, without asking anyone, where it came from.
 */
const VIEWS: ReadonlyArray<{
  id: string;
  label: MenuItem["label"];
  path: string;
  explain: ReadonlyArray<MenuItem["label"]>;
}> = [
  {
    id: "inspirations",
    label: "worldMenuField",
    path: "/inspirations",
    explain: ["worldFieldWhatMade", "worldFieldWhatShelves"],
  },
  {
    id: "top-of-mind",
    label: "worldMenuTopOfMind",
    path: "/",
    explain: ["worldReadingWhatMade", "worldReadingWhatCounts", "worldReadingWhatChanges"],
  },
  {
    id: "principles",
    label: "worldPrinciplesShortcut",
    path: "/principles",
    explain: ["worldPrinciplesWhatMade", "worldPrinciplesWhatChanges"],
  },
];

export function usePageMenu(locale: SupportedLocale): PageMenu {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useMemo(() => {
    /* Longest path first, so "/" does not claim "/inspirations". */
    const here =
      [...VIEWS]
        .sort((a, b) => b.path.length - a.path.length)
        .find((view) => (view.path === "/" ? pathname === "/" : pathname.startsWith(view.path)))
        ?.id ?? null;
    return {
      items: VIEWS.map((view) => ({
        id: view.id,
        label: view.label,
        onSelect: () => navigate(view.path),
        explain: view.explain.map((key) => t(locale, key)),
      })),
      current: here,
      onSettings: () => navigate("/profile"),
    };
  }, [locale, navigate, pathname]);
}
