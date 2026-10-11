/**
 * TWO CONTROLS, TWO QUESTIONS — WHOSE, AND WHAT.
 *
 * Founder: "maybe the dropdown for top of mind should be your top of mind,
 * your agent's top of mind, and that's how you move across the agents. I feel
 * like it's so confusing that I go to my agent and then now I have no way to
 * get back to my top of mind without going to my agent's top of mind."
 *
 * THE BUG THAT SENTENCE DESCRIBES, precisely. The top-centre switcher used to
 * list the three VIEWS of whoever you currently were — your inspirations,
 * your top of mind, your principles — and took the owner from a hidden stance
 * set somewhere else. So it could name which depth you were at and could
 * never name whose material you were reading, which is why standing as the
 * agent left no row that said "mine". The one fact you needed back was the
 * one fact the control could not express.
 *
 * It had been six rows for exactly one commit — both owners times all three
 * views — and the founder rejected that too, correctly: "I don't like that
 * there are six options." Six rows was the right diagnosis and the wrong
 * cure. It made every press answer two questions at once, so a list you read
 * to change one thing made you re-choose the other.
 *
 * So the two questions get two controls, and neither can answer the other's:
 *
 *   WHOSE — the top centre. Your top of mind, your agent's top of mind. Two
 *   rows, one axis, and nothing else lives here. That last part is the fix
 *   for "I didn't realise clicking on top of mind would leave me there":
 *   when the only thing a control can do is change the owner, pressing it
 *   can never put you on a different KIND of surface. It is also why the
 *   stance stops being hidden — the owner is now a consequence of the row
 *   you pressed and of the address you are at, never of a remembered
 *   setting.
 *
 *   WHAT — the left corner. Your inspirations, your principles, your
 *   conversations. These are not places; they are things you open OVER the
 *   world and dismiss back out of (see `ViewOpen` in `lib/view-location`).
 *   Listing them beside the owner was the original sin: it made three
 *   overlays and one location look like four peers, so leaving an overlay
 *   meant picking a destination.
 *
 * WHY THE CORNER IS THE RIGHT HOME FOR "WHAT", and survives what is coming.
 * Founder: "I want to add the social feature back soon, so I don't know how
 * to make the interaction good if I replace the top left button with a
 * chat." Rooms are things you open over the world too, so they join this
 * list rather than displacing anything; and a room is also an OWNER whose
 * material can be read, which the top-centre switch already generalises to
 * without changing shape. Neither control has to be renegotiated.
 *
 * WHAT IS STILL NOT HERE, AND WHY:
 *
 *   - Your days. Set aside by ruling. `/days` still answers and every dot on
 *     it still opens the reading on that date.
 *   - Find. It is a thing you do TO your inspirations, so it is a search
 *     field on that overlay rather than an entry of its own.
 */
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { MenuItem } from "../components/Menu";
import { t, type SupportedLocale } from "./locales";
import { setStanding, useStanding, type Standing } from "./standing";
import type { ViewOpen } from "./view-location";

export interface PageMenu {
  /** WHOSE. The top-centre switcher: you, or your agent. */
  items: MenuItem[];
  /** WHAT. The left corner: the three things that open over the world. */
  openRows: MenuItem[];
  /**
   * ME / MY AGENT, as the rest of the product sees it.
   *
   * Still written, because the companion's own form follows it and the save
   * box needs to know who it is saving for. What changed is that it is no
   * longer the SOURCE of whose material a surface shows — the address is.
   * A stance that only reflects the address cannot disagree with it.
   */
  standing: Standing;
  stand: (next: Standing | null) => void;
  /** Which owner is being read, for the switcher's own checkmark. */
  current: string | null;
  onSettings: () => void;
}

/**
 * THE THREE THINGS YOU OPEN, and each says what it is made of.
 *
 * Founder, on the top of mind: "show hover card to explain how this is
 * created." All of them get it, because the question is the same question: a
 * person looking at a page of their own material should be able to find out,
 * without asking anyone, where it came from.
 *
 * ONE PARAGRAPH, NOT A LIST OF FACTS. Founder: "make it a single paragraph,
 * don't split it into separate sentences." Three stacked clauses read as a
 * specification — things you are expected to retain — when the question is
 * only "what is this". A paragraph is read once and understood; a list is
 * scanned and remembered, and nobody wants to remember what a tab means.
 */
const OPENS: ReadonlyArray<{
  what: ViewOpen;
  label: MenuItem["label"];
  /** The same thing, named as the agent's. */
  agentLabel: MenuItem["label"];
  explain?: MenuItem["label"];
}> = [
  { what: "saves", label: "worldMenuField", agentLabel: "worldAgentField", explain: "worldFieldWhatIs" },
  { what: "principles", label: "worldPrinciplesShortcut", agentLabel: "worldAgentPrinciples", explain: "worldPrinciplesWhatIs" },
  { what: "conversations", label: "worldOpenConversations", agentLabel: "worldAgentConversations" },
];

/* The account comes from the caller, the way the locale does. Reaching into
   auth from here would make a hook every page uses depend on a context those
   pages already hold — and would make it unmountable in any test that does
   not happen to mock that context. */
export function usePageMenu(
  locale: SupportedLocale,
  accountId?: string | null,
  /** The account's agent, when it has one. Without one there is only one
      owner, and a switcher with a single row is a label pretending to be a
      control — the caller renders the words instead. */
  agent?: { id: string; name: string } | null,
  /** Opens one of the three over the world. Supplied by whoever owns the
      world's view state, so opening an overlay goes through the same history
      writer as everything else rather than a second one. */
  onOpen?: (what: ViewOpen) => void,
): PageMenu {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const standing = useStanding(accountId);
  return useMemo(() => {
    /* THE ADDRESS SAYS WHOSE, not the stored stance. A wall address is an
       agent's top of mind; "/" is yours. Reading it from the URL is what
       makes the switcher incapable of lying about where you are. */
    const onAWall = pathname.startsWith("/w/");
    const owner = onAWall ? decodeURIComponent(pathname.split("/")[2] ?? "") || null : null;

    const items: MenuItem[] = [
      {
        id: "me",
        label: "worldMenuTopOfMind",
        onSelect: () => {
          /* The stance follows the press, so the companion's form and the
             save box's destination agree with the address immediately
             rather than after whatever writes it next. */
          setStanding(accountId, null);
          navigate("/");
        },
        explain: t(locale, "worldReadingWhatIs"),
      },
    ];
    if (agent) {
      items.push({
        id: `agent:${agent.id}`,
        label: "worldAgentTopOfMind",
        onSelect: () => {
          setStanding(accountId, { id: agent.id, name: agent.name });
          navigate(`/w/${encodeURIComponent(agent.id)}`);
        },
        explain: t(locale, "worldReadingWhatIs"),
      });
    }

    return {
      items,
      openRows: OPENS.map((row) => ({
        id: row.what,
        /* Named for the owner whose world is on screen. The switcher above
           says the same thing; this says it again where a person is about to
           act on it, which is the one place repetition earns its place. */
        label: owner ? row.agentLabel : row.label,
        onSelect: () => onOpen?.(row.what),
        ...(row.explain ? { explain: t(locale, row.explain) } : {}),
      })),
      current: owner ? `agent:${owner}` : "me",
      standing,
      stand: (next: Standing | null) => setStanding(accountId, next),
      onSettings: () => navigate("/profile"),
    };
  }, [accountId, agent?.id, agent?.name, locale, navigate, onOpen, pathname, standing]);
}
