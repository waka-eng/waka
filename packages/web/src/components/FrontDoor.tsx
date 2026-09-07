/**
 * `/`, AND THE THREE THINGS IT CAN ANSWER WITH.
 *
 * `lib/front-door.ts` holds the RULE — which of the three a given visitor
 * gets, and why a person the door remembers must never be shown the sales
 * page. This is the component that asks it, reads the session state it needs,
 * and renders the answer.
 *
 * IT TAKES ITS THREE ANSWERS AS PROPS rather than importing them, and that is
 * the whole reason it is a file instead of a closure inside `main.tsx`.
 *
 *   It makes the wiring executable. The rule was already a pure function with
 *   a suite around it, but "the rule is right" and "the route is wired to the
 *   rule" are two claims, and only the first was checked while this lived in
 *   the entry point — `main.tsx` calls `createRoot` at module scope, so no
 *   test can import it. `docs/architecture.md`: a rule nobody can execute is a
 *   rule nobody has checked.
 *
 *   And it keeps the lazy chunks lazy. Both the world and the landing page are
 *   `lazy()` in `main.tsx`; passing their ELEMENTS in costs nothing, because a
 *   JSX element is a description rather than a render — neither chunk is
 *   fetched until the branch that uses it is the branch that runs. Importing
 *   them here instead would also drag `pages/Home` into the import graph of
 *   every suite that touches this file, which `check-seams.mjs` rightly treats
 *   as mounting the world.
 */

import type { ReactNode } from "react";

import { useAuth } from "../lib/auth-context";
import { readDoorMemory } from "../lib/door-memory";
import { frontDoorFor } from "../lib/front-door";
import { LoadingHome } from "./LoadingHome";

export interface FrontDoorProps {
  /** the world, for a confirmed session */
  home: ReactNode;
  /** the sign-in door, for somebody who has an archive here */
  door: ReactNode;
  /** the page that says what WAKA is, for everybody else */
  landing: ReactNode;
  /** only `/` may sell; every other address is a deep link — see the rule */
  offersLanding?: boolean;
}

export function FrontDoor({ home, door, landing, offersLanding = false }: FrontDoorProps): JSX.Element {
  /* Why this asks the context directly instead of leaning on `RequireAuth`:
     the guard's contract is "send anonymous visitors to the door", and that
     stays exactly right for every OTHER address — a deep link into somebody's
     archive should ask for a password, not sell them the product. `/` is the
     one address where being signed out is a normal condition rather than a
     wrong turn, so it is the one address that answers three ways. */
  const { isAuthenticated, isLoading, serverUnreachable } = useAuth();

  /* STILL HYDRATING IS NOT AN ANSWER. Deciding before `/auth/me` has replied
     would flash the landing page at somebody who has an account — the same
     half-appearance the world forbids inside itself, in the worst place for
     it. The world's own early face is what `RequireAuth` shows here too, so
     the way in never changes clothes. */
  if (isLoading) return <LoadingHome />;

  switch (
    frontDoorFor({
      authenticated: isAuthenticated,
      /* Read at decide-time rather than held in state: this render happens
         once per navigation, and the freshest answer is the right one — a
         person who has just pressed "not you?" on the door and come back
         should not meet their own name again. */
      remembered: readDoorMemory() !== null,
      serverUnreachable,
      offersLanding,
    })
  ) {
    case "home":
      return <>{home}</>;
    case "door":
      return <>{door}</>;
    default:
      return <>{landing}</>;
  }
}

export default FrontDoor;
