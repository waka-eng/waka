/**
 * THE THREE VIEWS IN THE CENTRE, CONVERSATIONS IN THE CORNER, IDENTITY ON THE
 * CREATURE.
 *
 * Founder: "top left button should be chat history since moving between
 * inspirations, top of mind, principles is done with the middle center
 * dropdown (that should restore these 3 options)."
 *
 * ── WHY THIS IS THE SHAPE THAT HOLDS, AFTER THREE THAT DID NOT ────────────
 *
 * The centre has been three views, then six rows (both owners times all three
 * views), then two owners. Each move was a real fix for a real complaint and
 * each one put the WRONG QUESTION in the middle of the screen.
 *
 * The thing that changed underneath is that identity found a better home. The
 * creature IS the identity — the canvas dissolves between its two forms and
 * holds the aura constant to say it is the same companion throughout — so
 * "me / my agent" lives on the creature, where a person is already looking
 * when they think about whose material this is. Once that is true, the centre
 * no longer has to answer "whose", and it can go back to answering "which",
 * which is the question it was shaped for and the one three rows fit.
 *
 * So the three controls now ask three different questions and none of them
 * can answer another's:
 *
 *   WHICH — the centre. Your inspirations, your top of mind, your principles.
 *   The same material at three depths: what you kept, what it adds up to now,
 *   and what has endured. One axis, so the honest control names the rung you
 *   are on.
 *
 *   WHOSE — the creature. Two faces, one companion.
 *
 *   WHAT YOU HAVE TALKED ABOUT — the corner. Conversations are not a depth of
 *   your material and not an owner; they are a history, which is why they
 *   never sat right among the three and why the corner is where they belong.
 *
 * ── AND THE ROWS STILL SAY WHOSE, BECAUSE THEY STILL CAN ──────────────────
 *
 * Founder, earlier: "clicking on your inspirations leads to not my agent's
 * inspiration but mine." The labels follow the ADDRESS — the wall you are
 * standing on — so standing as the agent the rows read "Your agent's
 * inspirations". The centre does not CHANGE the owner any more; it only
 * reports it, which is the distinction that made six rows wrong.
 *
 * ── TOP OF MIND IS A CLOSE, NOT A TRIP ────────────────────────────────────
 *
 * Your inspirations and your principles open OVER the world. Your top of mind
 * IS the world, so its row puts down whatever is held up rather than
 * navigating anywhere. That is why pressing it can no longer strand you,
 * which was the original complaint: "I didn't realise clicking on top of mind
 * would leave me there."
 *
 * WHAT IS STILL NOT HERE: your days, set aside by ruling (`/days` still
 * answers); and find, which is a thing you do TO your inspirations and so is
 * a search field on that overlay rather than a destination.
 */
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { MenuItem } from "../components/Menu";
import { t, type SupportedLocale } from "./locales";
import { setStanding, useStanding, type Standing } from "./standing";
import type { ViewOpen } from "./view-location";

export interface PageMenu {
  /** WHICH. The top-centre switcher: the same material at three depths. */
  items: MenuItem[];
  /**
   * ME / MY AGENT, as the rest of the product sees it.
   *
   * The creature owns this control now. It is still written here because the
   * save box needs to know who it is saving for and the overlays need to know
   * whose material to read — but it is no longer the SOURCE of whose material
   * a surface shows. The address is. A stance that only reflects the address
   * cannot disagree with it.
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
const VIEWS: ReadonlyArray<{
  /** `null` means your top of mind — the world itself, nothing held up. */
  what: ViewOpen | null;
  id: string;
  label: MenuItem["label"];
  /** The same view, named as the agent's. */
  agentLabel: MenuItem["label"];
  /**
   * ONE PARAGRAPH, NOT A LIST OF FACTS. Founder: "make it a single paragraph.
   * Don't split it into separate sentences." Three stacked clauses read as a
   * specification — things you are expected to retain — when the question is
   * only "what is this".
   */
  explain: MenuItem["label"];
}> = [
  { what: "saves", id: "saves", label: "worldMenuField", agentLabel: "worldAgentField", explain: "worldFieldWhatIs" },
  { what: null, id: "top-of-mind", label: "worldMenuTopOfMind", agentLabel: "worldAgentTopOfMind", explain: "worldReadingWhatIs" },
  { what: "principles", id: "principles", label: "worldPrinciplesShortcut", agentLabel: "worldAgentPrinciples", explain: "worldPrinciplesWhatIs" },
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
  /** Holds one of the three up over the world, or — for `null`, your top of
      mind — puts down whatever is held. Supplied by whoever owns the world's
      view state, so this goes through the same history writer as everything
      else rather than a second one. */
  onOpen?: (what: ViewOpen | null) => void,
): PageMenu {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const standing = useStanding(accountId);
  return useMemo(() => {
    /* THE ADDRESS SAYS WHOSE, not the stored stance. A wall address is an
       agent's top of mind; "/" is yours. Reading it from the URL is what
       makes the switcher incapable of lying about where you are. */
    const onAWall = pathname.startsWith("/w/");
    const open = new URLSearchParams(search).get("open");
    const owner = onAWall ? decodeURIComponent(pathname.split("/")[2] ?? "") || null : null;

    const items: MenuItem[] = VIEWS.map((row) => ({
      id: row.id,
      /* Named for the owner whose world is on screen — the ADDRESS, never the
         stored stance, so a row cannot promise one person's material and open
         another's. */
      label: owner ? row.agentLabel : row.label,
      onSelect: () =>
        onOpen
          ? onOpen(row.what)
          : navigate(
              `${owner ? `/w/${encodeURIComponent(owner)}` : "/"}${row.what ? `?open=${row.what}` : ""}`,
            ),
      explain: t(locale, row.explain),
    }));

    return {
      items,
      /* WHICH RUNG IS BEING READ. The world is your top of mind when nothing
         is held up over it; the overlay's own parameter says otherwise. */
      current: open ?? "top-of-mind",
      standing,
      stand: (next: Standing | null) => setStanding(accountId, next),
      onSettings: () => navigate("/profile"),
    };
  }, [accountId, agent?.id, agent?.name, locale, navigate, onOpen, pathname, search, standing]);
}
