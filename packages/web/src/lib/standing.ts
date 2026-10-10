/**
 * WHOSE MATERIAL YOU ARE LOOKING AT — one answer, read by every surface.
 *
 * Founder: "my agent should have its own top of mind, your inspirations,
 * principles."
 *
 * The corner switch already moved the CAMERA to an agent's wall, and that was
 * the whole of it: the three views the product offers are routes, and a route
 * knows nothing about which wall a camera happens to be parked on. So you
 * could stand on your agent's wall, open Principles, and read your own — the
 * switch moved the world and left the rest of the product behind.
 *
 * This is the one place that answers "whose", and it is deliberately NOT
 * derived from the route. A profile id in the address would make every link a
 * person could send carry whose archive it was read from, and the pages are
 * about your own account's material either way — the selection is a stance,
 * not a destination.
 *
 * PER ACCOUNT, because one browser can sign into two. Standing as an agent
 * and then signing in as somebody else must not leave the second person
 * reading the first one's agent.
 *
 * THE NAME RIDES ALONG so a page can label the switch without fetching a
 * roster to find out what it is called. It is a label, never an identity —
 * everything that reads is scoped by `id`, and the server checks that id
 * against the session regardless of what any client believes.
 */
import { useSyncExternalStore } from "react";

export interface Standing {
  /** `null` means your own material. */
  id: string | null;
  /** What to call it in the switch. Empty when standing as yourself. */
  name: string;
}

const NOBODY: Standing = { id: null, name: "" };

function keyFor(accountId: string | null | undefined): string | null {
  return accountId ? `waka:standing:${accountId}` : null;
}

/* The live value, so every subscriber reads the same object identity between
   writes — `useSyncExternalStore` compares by reference and would loop
   forever on a fresh object per read. */
let held: Standing = NOBODY;
let heldKey: string | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Read what is stored for this account, or nobody. */
export function readStanding(accountId: string | null | undefined): Standing {
  const key = keyFor(accountId);
  if (key === null) return NOBODY;
  if (key !== heldKey) {
    heldKey = key;
    held = NOBODY;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Standing>;
        /* A stored value that is not the shape this file writes is treated as
           no value at all. Standing somewhere unreadable is worse than
           standing at home, because every read downstream is scoped by it. */
        if (typeof parsed?.id === "string" && parsed.id.length > 0) {
          held = { id: parsed.id, name: typeof parsed.name === "string" ? parsed.name : "" };
        }
      }
    } catch {
      /* A browser that refuses storage simply stands at home every visit. */
    }
  }
  return held;
}

/** Stand somewhere. `null` is your own material. */
export function setStanding(accountId: string | null | undefined, next: Standing | null): void {
  const key = keyFor(accountId);
  if (key === null) return;
  const value = next?.id ? { id: next.id, name: next.name } : NOBODY;
  if (key === heldKey && value.id === held.id && value.name === held.name) return;
  heldKey = key;
  held = value;
  try {
    if (value.id) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    /* Unpersisted is still correct for this visit. */
  }
  announce();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whose material this surface should be reading. */
export function useStanding(accountId: string | null | undefined): Standing {
  return useSyncExternalStore(
    subscribe,
    () => readStanding(accountId),
    () => NOBODY,
  );
}
