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
  /** The same view, named as the agent's. */
  agentLabel: MenuItem["label"];
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
    agentLabel: "worldAgentField",
    path: "/inspirations",
    explain: "worldFieldWhatIs",
  },
  {
    id: "top-of-mind",
    label: "worldMenuTopOfMind",
    agentLabel: "worldAgentTopOfMind",
    path: "/",
    explain: "worldReadingWhatIs",
  },
  {
    id: "principles",
    label: "worldPrinciplesShortcut",
    agentLabel: "worldAgentPrinciples",
    path: "/principles",
    explain: "worldPrinciplesWhatIs",
  },
];

/* The account comes from the caller, the way the locale does. Reaching into
   auth from here would make a hook every page uses depend on a context those
   pages already hold — and would make it unmountable in any test that does
   not happen to mock that context. */
export function usePageMenu(
  locale: SupportedLocale,
  accountId?: string | null,
  /** The account's agent, when it has one. Named here so the list can say
      whose material each row leads to. */
  agent?: { id: string; name: string } | null,
): PageMenu {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const standing = useStanding(accountId);
  return useMemo(() => {
    /**
     * THE LIST SAYS WHOSE, ROW BY ROW.
     *
     * Founder: "clicking on your inspirations leads to not my agent's
     * inspiration but mine. Maybe this dropdown should be more clear: your
     * inspirations, your top of mind, your principles, and then your agent's
     * inspirations, your agent's top of mind, your agent's principles."
     *
     * That is the fix for three separate bugs, and they had one cause: whose
     * material you were looking at was a HIDDEN STANCE, and the rows named
     * only the view. So the label said "Your inspirations" while standing as
     * the agent, picking a row changed the view but not the owner, and the
     * control that was supposed to say where you are could not say the one
     * thing that had actually changed.
     *
     * Six rows, each naming both halves of the answer. The stance stops
     * being something you set elsewhere and remember — it is a consequence
     * of the row you pressed, which is the only way a person can be sure
     * what they are about to read.
     */
    /**
     * THREE ROWS, AND THEY FOLLOW THE CREATURE.
     *
     * Founder: "I don't like that there are six options — this should be
     * dynamically changing depending on what I selected in the character."
     *
     * Right, and six was me answering the wrong question. The six rows were
     * a fix for a real bug — the switcher could not say WHOSE material a row
     * led to — but the identity already has a control, and it is the
     * creature. Offering both owners here made the switcher answer a
     * question the creature had already answered, and a list that repeats a
     * choice you have made is a list you have to read twice.
     *
     * So the views follow the stance: three rows, named for whoever you are
     * currently being. The creature says who; this says which.
     */
    /* Longest path first, so "/" does not claim "/inspirations". A wall
       address is the agent's top of mind, which no VIEWS path matches. */
    const onAWall = pathname.startsWith("/w/");
    const view =
      onAWall
        ? "top-of-mind"
        : [...VIEWS]
            .sort((a, b) => b.path.length - a.path.length)
            .find((row) => (row.path === "/" ? pathname === "/" : pathname.startsWith(row.path)))
            ?.id ?? null;
    const owner = onAWall
      ? pathname.split("/")[2] ?? null
      : standing.id;
    const current = view ? `${owner ?? "me"}:${view}` : null;

    return {
      items: VIEWS.map((row) => ({
        id: `${standing.id ?? "me"}:${row.id}`,
        /* Named for the owner you are standing as. The creature's own label
           says the same thing; this says it again where a person is about to
           act on it, which is the one place repetition earns its place. */
        label: standing.id ? row.agentLabel : row.label,
        /**
         * THE TOP OF MIND IS A WALL. "/" is YOUR wall specifically, not "the
         * top of mind" in general — the agent's has its own address, and a
         * row that always navigated to "/" answered a different question
         * than the one asked.
         */
        onSelect: () =>
          navigate(
            row.id === "top-of-mind"
              ? standing.id
                ? `/w/${encodeURIComponent(standing.id)}`
                : "/"
              : row.path,
          ),
        explain: t(locale, row.explain),
      })),
      current,
      standing,
      stand: (next: Standing | null) => setStanding(accountId, next),
      onSettings: () => navigate("/profile"),
    };
  }, [accountId, agent?.id, agent?.name, locale, navigate, pathname, standing]);
}
