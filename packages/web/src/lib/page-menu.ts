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
import { setStanding, useStanding, type Standing } from "./standing";

export interface PageMenu {
  items: MenuItem[];
  /**
   * ME / MY AGENT, on a page that has no world to travel.
   *
   * The corner is a wall switch, and on the home screen pressing it moves a
   * camera. On the archive and the principles there is no camera — there is
   * only whose material is being read — so the same control writes the stance
   * directly and the page reloads under it. One control, one meaning, two
   * mechanisms, because the two surfaces are genuinely different machines.
   */
  standing: Standing;
  stand: (next: Standing | null) => void;
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
  /**
   * ONE PARAGRAPH, NOT A LIST OF FACTS.
   *
   * Founder: "make it a single paragraph. Don't split it into separate
   * sentences. Just have one to two sentences in the same paragraph that
   * explains it intuitively."
   *
   * The list form was wrong for what this is. Three stacked clauses read as
   * a specification — things you are expected to retain — when the question
   * is only "what is this". A paragraph is read once and understood; a list
   * is scanned and remembered, and nobody wants to remember what a tab
   * means.
   */
  explain: MenuItem["label"];
}> = [
  {
    id: "inspirations",
    label: "worldMenuField",
    path: "/inspirations",
    explain: "worldFieldWhatIs",
  },
  {
    id: "top-of-mind",
    label: "worldMenuTopOfMind",
    path: "/",
    explain: "worldReadingWhatIs",
  },
  {
    id: "principles",
    label: "worldPrinciplesShortcut",
    path: "/principles",
    explain: "worldPrinciplesWhatIs",
  },
];

/* The account comes from the caller, the way the locale does. Reaching into
   auth from here would make a hook every page uses depend on a context those
   pages already hold — and would make it unmountable in any test that does
   not happen to mock that context. */
export function usePageMenu(locale: SupportedLocale, accountId?: string | null): PageMenu {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const standing = useStanding(accountId);
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
        /**
         * THE TOP OF MIND IS A WALL, AND THE WALL YOU ARE IN IS THE ONE YOU
         * GET.
         *
         * Founder: "when I go to my agent and click on top of mind, it moves
         * me to me. That's not the right interpretation."
         *
         * It is not. "/" is YOUR wall specifically, not "the top of mind" in
         * general — so a row that always navigated there silently answered a
         * different question than the one asked. Standing as your agent and
         * asking for the top of mind means the AGENT's, and the agent's top
         * of mind has an address: its own wall.
         *
         * The archive and the principles do not need this. They are one page
         * each, scoped by the stance they read from `lib/standing`, so they
         * already serve whoever you are standing as.
         */
        onSelect: () =>
          navigate(
            view.id === "top-of-mind" && standing.id
              ? `/w/${encodeURIComponent(standing.id)}`
              : view.path,
          ),
        explain: t(locale, view.explain),
      })),
      current: here,
      standing,
      stand: (next: Standing | null) => setStanding(accountId, next),
      onSettings: () => navigate("/profile"),
    };
  }, [accountId, locale, navigate, pathname, standing]);
}
