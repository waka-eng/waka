/**
 * THE MENU — ONE LIST, THE SAME ON EVERY SCREEN.
 *
 * It was two. Home built its own set out of camera verbs and live field
 * state while every other page used a shorter one from here, so the menu
 * changed depending on where you were standing — which is the thing a menu
 * exists not to do. Founder: "why is the hamburger menu changing depending on
 * what screen I'm in? That's also weird." It was, and it was duplication
 * wearing the costume of context.
 *
 * So this is the only definition. Home imports it exactly as the pages do,
 * and there is nowhere left for a second one to drift.
 *
 * WHAT IS NOT HERE, AND WHY:
 *
 *   - Rooms and agents. Set aside for now by ruling. The walls still exist
 *     and the space switcher still reaches them; they are simply not
 *     destinations the menu offers.
 *   - Review. Claims is the one place that asks you to rule on something, and
 *     two surfaces for "go back through your own material" is the duplication
 *     this list is being cut to remove.
 *   - Find. It is a thing you do TO your inspirations, so it belongs on that
 *     page as a search field rather than as a destination of its own — a verb
 *     in a list of places was always the odd one out.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import type { MenuItem } from "../components/Menu";

export interface PageMenu {
  items: MenuItem[];
  onSettings: () => void;
}

export function usePageMenu(): PageMenu {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      /* Ordered as the loop runs: what you kept, what was read from it and is
         waiting on you, what it adds up to now, what endured — then the two
         that are about the whole of it rather than a step in it. */
      items: [
        { id: "inspirations", label: "worldMenuField", onSelect: () => navigate("/inspirations") },
        { id: "claims", label: "worldTabClaims", onSelect: () => navigate("/claims") },
        { id: "top-of-mind", label: "worldMenuTopOfMind", onSelect: () => navigate("/") },
        { id: "principles", label: "worldPrinciplesShortcut", onSelect: () => navigate("/principles") },
        { id: "talk", label: "worldMenuTalk", onSelect: () => navigate("/chat/new") },
        { id: "days", label: "worldMenuDays", onSelect: () => navigate("/days") },
      ],
      onSettings: () => navigate("/profile"),
    }),
    [navigate],
  );
}
