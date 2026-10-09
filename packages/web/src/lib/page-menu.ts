/**
 * THE MENU A PAGE WEARS.
 *
 * The hamburger first existed only on the home screen, because that is where
 * the destinations were taken from. The effect was that walking into Claims or
 * Inspirations removed the only way out of them — a door that disappears once
 * you are through it. Every page gets the same two corners now.
 *
 * WHY THIS IS A HOOK AND NOT A LIST. Home's rows are camera verbs and live
 * state (it owns the field's counts, the wall picker, the search field), while
 * a standalone page's rows are plain navigation. Rather than give the Menu two
 * modes, the pages share this — the destinations that are just addresses —
 * and Home keeps building its own richer set. One component, two callers, no
 * branch inside it.
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
      /* Ordered as the loop runs, the same order Home uses: what you kept,
         what was read from it and is waiting on you, what it adds up to. */
      items: [
        { id: "inspirations", label: "worldMenuField", onSelect: () => navigate("/inspirations") },
        { id: "claims", label: "worldTabClaims", onSelect: () => navigate("/claims") },
        { id: "principles", label: "worldPrinciplesShortcut", onSelect: () => navigate("/principles") },
        { id: "days", label: "worldMenuDays", onSelect: () => navigate("/days") },
        { id: "home", label: "worldPersonalHome", onSelect: () => navigate("/") },
      ],
      /* A page has no account panel of its own; settings is a route from here. */
      onSettings: () => navigate("/profile"),
    }),
    [navigate],
  );
}
