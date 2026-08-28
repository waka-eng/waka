/**
 * WHAT `/` ANSWERS WITH, AND WHY IT IS NOT ALWAYS THE SAME THING.
 *
 * Until now `/` had two answers: the world if you were signed in, and a
 * redirect to the door if you were not. That second answer is what an
 * anonymous visitor got as their first and only impression of the product — a
 * sign-in form for a thing they had never heard of, with no sentence anywhere
 * on it saying what WAKA is.
 *
 * So there is a third answer now, and the question this file exists to settle
 * is which of the three a given visitor gets. It is a rule with a real edge on
 * it rather than an `if`, and `docs/architecture.md` is explicit about where
 * those live: "A rule nobody can execute is a rule nobody has checked."
 *
 * THE ONE THAT IS EASY TO GET WRONG is the middle case. A person who already
 * has an archive and whose session has merely lapsed must not be met with a
 * page selling them the product they already use — and the *reason* their
 * session lapsed is not knowable here. Two signals answer it without asking:
 *
 *   THE DOOR REMEMBERS THEM. `lib/door-memory` holds a record written every
 *   time a session was confirmed on this machine, and it deliberately survives
 *   signing out. If it is there, somebody signs in here; show them the door.
 *
 *   WE COULD NOT ASK. `AuthContextValue.serverUnreachable` is set only when
 *   the client never got an answer at all — a status of 0, never a 401. A
 *   signed-in person on a dead network is anonymous as far as this file can
 *   tell, and the marketing page is the worst of all possible answers to give
 *   them. The door already says the true thing in that case ("we couldn't
 *   reach the server"), so send them there and let it.
 *
 * A stranger on a machine somebody else signed in on gets the door rather than
 * the page. That is the deliberate trade: the way out is one press ("not
 * you?"), and it is on the door already.
 */

/**
 * The three faces of `/`.
 *
 * `home` and not `world`: the owner rejected that noun outright and
 * `scripts/check-vocabulary.mjs` enforces it — what a person lands on is Home.
 */
export type FrontDoor = "home" | "door" | "landing";

export interface FrontDoorFacts {
  /** the server confirmed a session */
  authenticated: boolean;
  /** the door holds a record of somebody who has signed in on this machine */
  remembered: boolean;
  /** the client never got an answer, which is not the same as "signed out" */
  serverUnreachable: boolean;
}

export function frontDoorFor({
  authenticated,
  remembered,
  serverUnreachable,
}: FrontDoorFacts): FrontDoor {
  if (authenticated) return "home";
  if (remembered || serverUnreachable) return "door";
  return "landing";
}
