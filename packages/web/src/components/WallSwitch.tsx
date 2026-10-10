/**
 * ME / MY AGENT, on a page with no world to travel.
 *
 * The home screen's version of this control moves a camera: the walls are
 * real places there, laid out along an axis, and switching is travel. The
 * archive, the principles and a conversation have no camera and no axis —
 * they have only WHOSE material is being read. So the same control, the same
 * two sides, the same inked state, writing the stance directly and letting
 * the page reload under it.
 *
 * Deliberately not shared with the home screen's copy. They look identical
 * and they are not the same act, and a single component taking an `onSwitch`
 * prop would hide that difference behind an argument — the version that
 * travels has to stay in the file that owns the camera.
 *
 * ONLY WHEN THERE IS AN AGENT. A toggle showing one option is a label wearing
 * a control's clothes, so with no agent the corner is empty. The roster is
 * read from the account's own profiles, which is the same source the world
 * builds its walls from.
 */
import { useEffect, useRef, useState } from "react";

import { fetchProfiles } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";
import type { PageMenu } from "../lib/page-menu";

interface Agent {
  id: string;
  name: string;
}

export function WallSwitch({
  menu,
  locale,
}: {
  menu: PageMenu;
  locale: SupportedLocale;
}): JSX.Element | null {
  const [agent, setAgent] = useState<Agent | null>(null);

  /* The stance is read through a ref so this runs once on mount rather than
     on every change to it — the check below is about the roster landing, not
     about the person switching. */
  const stance = useRef(menu);
  stance.current = menu;
  useEffect(() => {
    let live = true;
    /* A roster that cannot be read is an account with no agent, not an error
       on a page about something else entirely: the corner simply stays
       empty and every other thing here still works. */
    void fetchProfiles()
      .then((rows) => {
        if (!live) return;
        const first = rows.find((row) => row.type === "agent");
        setAgent(first ? { id: first.id, name: first.name } : null);
        /* A STANCE OUTLIVES THE THING IT NAMES. Standing is remembered across
           visits; an agent can be deleted between them. Left alone, every
           read on every page would be scoped to a profile that is gone —
           empty archive, empty principles, no claim, and nothing on screen
           saying why. So a stance the roster cannot account for is dropped
           and the person is standing in their own material again, which is
           the only honest place to put them. */
        const named = stance.current.standing.id;
        if (named && !rows.some((row) => row.id === named)) stance.current.stand(null);
      })
      .catch(() => {
        if (live) setAgent(null);
      });
    return () => {
      live = false;
    };
  }, []);

  /* The stance can name an agent the roster has not landed yet — standing is
     remembered across visits and the roster is a fetch. Trust the stance for
     the label so the corner never flickers through "me" on its way back to
     where the person actually was. */
  const standingName = menu.standing.name;
  if (!agent && !menu.standing.id) return null;

  const sides: Array<{ id: string | null; label: string }> = [
    { id: null, label: t(locale, "worldWallMe") },
    {
      id: agent?.id ?? menu.standing.id,
      label: agent || standingName ? t(locale, "worldWallMyAgent") : "",
    },
  ];

  return (
    <span className="jar-here-split" role="group" aria-label={t(locale, "worldGoToAnotherWall")}>
      {sides.map((side) => {
        const standing = (menu.standing.id ?? null) === (side.id ?? null);
        return (
          <button
            key={side.id ?? "me"}
            type="button"
            className={`jar-here jar-label${standing ? " jar-here--standing" : ""}`}
            aria-pressed={standing}
            onClick={() => {
              if (standing) return;
              menu.stand(side.id ? { id: side.id, name: agent?.name ?? standingName } : null);
            }}
          >
            {side.label}
          </button>
        );
      })}
    </span>
  );
}
