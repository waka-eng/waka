/**
 * LAYER 3 — the one artifact, drawn as headquarters.
 *
 * `docs/data-model.md` is blunt about the shape: there is exactly ONE top of
 * mind per profile — and one per room, until rooms were removed on
 * 2026-10-12 (founder: "방 없애"). So nothing here is a list of competing
 * boards — it is the entries of the single board, in the server's order, plus
 * the two things the page has to decide about them: which sentence leads, and
 * what to say when none does yet.
 *
 * `deriveAmbition` is the fix for a bug worth remembering. `adopted` is an
 * OVERRIDE on top of the board, and a loop over groups used to write a group's
 * ambition into it — so your own headquarters displayed a room's sentence,
 * carrying the room's name, seconds after painting your own. One slot, N
 * spaces. The `groupName` field below is what made the mislabelling visible;
 * it is kept because adopting a group's ambition as your own is a real act
 * that should say where the words came from.
 *
 * `formingWords` obeys the numerals law: "Four signals are forming", never
 * "4". The count is legible because the words are.
 */

import { formatMessage, t, type SupportedLocale } from "../../lib/locales";
import { numWords } from "../../lib/words";
import type { Entry, EvidenceRef } from "../../lib/data";

/**
 * One statement of the artifact headquarters stands on. There is exactly one
 * artifact per profile under the canon, so this is never a list of competing
 * boards — it is the entries of the single board, in the server's order.
 */
export type JarNote = Entry;

export interface Adopted {
  ambition: string;
  /**
   * Null at every site that builds one, and kept anyway.
   *
   * It was the room whose board this is. `canvas/simulation.ts` reads this
   * type and is owned by a change in flight, so the field cannot come out
   * from here — and the HEADER above is the reason it would be worth keeping
   * even if it could: this field is what made the mislabelling visible when
   * a loop over rooms wrote a room's ambition into your one slot. A reader
   * who deletes it should know what it caught.
   */
  groupName: string | null;
  createdMs: number;
}

/** The reflect action's one-at-a-time life inside the panel. */
export interface ReflectState {
  step: "rest" | "asking" | "open" | "keeping" | "kept";
  question: string;
  answer: string;
  /** the row just written, so it can be taken back without a refetch */
  lastId?: string;
}

/**
 * The raw captures the adopted ambition was built from, and the words of theirs
 * that carried it. The peek row beneath the poster is THIS: not "the newest
 * five" but "what led to what you are looking at".
 */
export type Provenance = Map<string, string | null>;

/**
 * THE ROOM'S PENDING REWRITE OF THE AMBITION — the one adoptable candidate,
 * for a room that no longer exists.
 *
 * Nothing constructs this and nothing reads it: `pages/Home`'s `proposal`
 * state went with rooms on 2026-10-12 (founder: "방 없애"), and its one
 * consumer — `formingWords`'s `proposalMs` — now receives `null` at both
 * call sites. The TYPE stays for one turn longer than the state because
 * `canvas/simulation.ts` is owned by a change in flight and this module is
 * one of its imports; it goes with the loop's group branches.
 */
export interface Proposal {
  groupId: string;
  proposalId: string;
  ambition: string;
  changeSummary: string | null;
  createdMs: number;
  evidence: EvidenceRef[];
  /** The span the server declared across that evidence; its orbit reads it. */
  spanMs: number | null;
}

export function deriveAmbition(
  T: number,
  adopted: Adopted | null,
  notes: JarNote[] | null,
): { text: string | null } {
  if (adopted && adopted.createdMs <= T) return { text: adopted.ambition };
  const avail = notes ? notes.filter((n) => n.createdMs <= T) : [];
  const pinned = avail.find((n) => n.pinned);
  if (pinned) return { text: pinned.body };
  /* No confidence on an entry any more, and none is invented: the server's
     own order is the ranking, so the head of it is what the board leads with. */
  let best: JarNote | null = null;
  for (const n of avail) if (!best || n.sortOrder < best.sortOrder) best = n;
  if (best) return { text: best.body };
  return { text: null };
}

/**
 * What is FORMING, in one line and always in words.
 *
 * The adopted ambition and the things that might replace it are separate
 * entities, and the page says so: the poster is the ambition the person holds
 * today, and this line — the only other thing under it — reports that
 * candidates exist without putting them on the same footing. A pending
 * proposal is a whole new ambition and outranks the readings; provisional
 * top-of-mind notes are counted, never listed, and never as a digit.
 */
export function formingWords(
  T: number,
  proposalMs: number | null,
  forming: Array<{ createdMs: number }> | null,
  locale: SupportedLocale = "en-US",
): string | null {
  if (proposalMs !== null && proposalMs <= T) return t(locale, "worldNewAmbitionForming");
  let n = 0;
  for (const f of forming ?? []) if (f.createdMs <= T) n++;
  if (n === 0) return null;
  const w = numWords(n, locale);
  const countWords = locale === "ko-KR" ? w : `${w[0].toUpperCase()}${w.slice(1)}`;
  return formatMessage(locale, "worldSignalsForming", { countWords, count: n });
}
/**
 * WHAT A WALL'S HEADQUARTERS SAYS. One shape for every kind of wall — yours,
 * a room's, an agent's — because headquarters is the same five things
 * everywhere: whose wall this is, what it holds, what it turned away from,
 * whether it is looking at a moment other than now, and whether something else
 * is forming.
 */
export interface WallChrome {
  /* THE EYEBROW IS GONE, FIELD AND ALL (founder, 2026-08-27: "just remove
     the word top of mind").

     It was already dark: on 2026-08-25 the slot stopped carrying the wall's
     name and the JSX wrote "top of mind" literally instead, so this field
     was computed by three producers and read by none. It was kept anyway —
     "the ruling is a choice and choices get revisited" — and parked in
     `wall-chrome.test.ts`'s DARK_BY_DECISION with that reason.

     Today the choice was revisited the other way: the words themselves are
     gone from the poster, so the reason the field was being kept ("the JSX
     writes those words literally") describes nothing that happens any more.
     A field kept for a decision that has been reversed is just dead code
     with a note on it. Found by `e2e:dead-css`, which reported
     `.jar-eyebrow` as a selector no source file can put on an element. */
  text: string | null;
  /**
   * AND WHAT IT STOPPED DOING. A portrait that says only what it is, is a
   * brochure; one that says what it turned away from has paid for the claim —
   * it is the most credible thing a self-description can contain, because it
   * costs something to say. It renders as a second clause in the same
   * sentence, one step down the luminance channel: the assertion is nearer
   * than the renunciation. It is not a second element — headquarters is never
   * two-headed.
   */
  awayFrom: string | null;
  /** The forming register, when nothing is adopted: what the wall itself says. */
  formingAlt: string | null;
  asOf: string | null;
  /** The one line under the ambition, or nothing when nothing is forming. */
  forming: string | null;
  /** Nothing kept here at all. Youth, not failure — and never filled in. */
  empty: boolean;
  /**
   * What this wall said a moment ago, so the poster can tell the words that
   * survived the rewrite from the words that are new. See posterWords.
   */
  prevText: string | null;
}
