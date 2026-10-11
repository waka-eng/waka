/**
 * THE ACCOUNT'S AGENT, if it has one.
 *
 * The view switcher names six rows — three of yours and three of your
 * agent's — so every surface carrying that switcher needs to know whether
 * there is an agent and what it is called. The world builds this from the
 * same place as part of its wall axis; a page has no axis, so it asks here.
 *
 * ONE AGENT, DELIBERATELY. The product currently holds you and one agent,
 * and the switcher is shaped to that. When there are several this returns a
 * list and the rows group by owner — the shape is a list already.
 *
 * A ROSTER THAT CANNOT BE READ IS AN ACCOUNT WITH NO AGENT, not an error on
 * a page about something else: the three agent rows simply do not appear and
 * everything else on the page still works.
 */
import { useEffect, useState } from "react";

import { fetchProfiles } from "./api";

export interface AgentHandle {
  id: string;
  name: string;
}

export function useAgent(): AgentHandle | null {
  const [agent, setAgent] = useState<AgentHandle | null>(null);
  useEffect(() => {
    let live = true;
    void fetchProfiles()
      .then((rows) => {
        if (!live) return;
        const first = rows.find((row) => row.type === "agent");
        setAgent(first ? { id: first.id, name: first.name } : null);
      })
      .catch(() => {
        if (live) setAgent(null);
      });
    return () => {
      live = false;
    };
  }, []);
  return agent;
}
