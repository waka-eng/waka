/**
 * CHANGING THE WORDS — one owner for the act all three layers share.
 *
 * The canon makes every layer human-modifiable and settles the conflict with
 * regeneration the same way everywhere: a human edit LOCKS the thing. The
 * server never rewrites words a person touched; it keeps attaching evidence
 * underneath them. So editing is not a convenience, it is the act that turns a
 * machine's reading of you into your own sentence — and it is the same gesture
 * on a memory, on a signal and on a poster entry: open the words, change them,
 * keep them.
 *
 * It lives above the three layer directories rather than in one of them
 * because it is the act none of them owns alone. `space/README.md` splits this
 * tree by layer, and this file is the exception that proves the rule holds: it
 * is here precisely because it is not layer 1, 2 or 3.
 *
 * WHY IT IS ONE OBJECT, WHICH IS A MEASUREMENT AND NOT A PREFERENCE.
 *
 * Step 4d of `docs/goals/close-the-two-gaps.md` measured the three JSX blocks
 * still stuck inside `Home.tsx` — the ready field, the sky and the reading
 * panel — and found `edit`, `setEdit` and `saveEdit` free in ALL THREE. One
 * mutable channel written by three panels is the shape `canvas/measured.ts`
 * had just resolved for the DOM, and the same answer applies: give it a name,
 * one owner and a documented seam, so a block that participates in the act
 * takes ONE binding rather than three anonymous ones whose reader has to go
 * find who else holds them.
 *
 * WHY IT IS NOT SHAPED LIKE `measured`, WHICH IS THE PART WORTH READING.
 *
 * `Measured` is one object for the life of the page, every field a ref, because
 * its reader is the frame loop: the loop closes over it ONCE and never re-runs,
 * so anything captured by value there freezes at whatever was true when the
 * loop started. This object's reader is the RENDER, which re-runs every time
 * the words change. So the rules invert. `open` is a plain value and the object
 * is rebuilt when that value changes — that identity change is exactly what
 * tells React the editor on screen is stale — and pretending otherwise, by
 * holding one stable object and mutating a field on it, would leave a panel
 * showing the words as they were and nothing would throw.
 *
 * THE FREEZE THAT WOULD BE SILENT HERE, since it is a different one.
 *
 * The callbacks are stable for the page's life, so they may not close over
 * anything that is re-pointed between renders. Two things are:
 *
 *   - the words themselves. A `keep()` that closed over the render in which
 *     the editor OPENED would send the text as it was before a single
 *     keystroke — the network call succeeds, the panel closes, and the change
 *     is gone. So the draft is held in a ref beside the state and read at call
 *     time. One function writes both, which is why they cannot drift.
 *   - the page's writers. React guarantees `useState` setters are stable, so
 *     capturing today's `deps` would happen to work — and would break the day
 *     someone adds a `useCallback` to the list, in a way no type catches. The
 *     deps object is re-pointed every render and read through the ref at call
 *     time, so that day is uneventful.
 *
 * THE RULE FOR MEMBERSHIP, WHICH IS WHAT KEEPS THIS FROM BECOMING A BAG.
 *
 * A field belongs here if and only if it is part of the one gesture above AND
 * more than one of the page's blocks touches it. That excludes state that
 * looks like a neighbour and is not: `more` and `forget` in the reading panel,
 * `sharing` and `dropAsk` in the sky, `posterAsk` and `groupForm` in the ready
 * field. Every one of those is transient state belonging to a SINGLE block,
 * and folding them in would make this "state in Home.tsx that happens to be
 * temporary", which answers no question and would not survive its first
 * reader.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { ApiError, updateInspiration, updateSignal, updateTopOfMindEntry, type ApiInspiration } from "../lib/api";
import {
  loadTopOfMind,
  type Inspiration,
  type InspirationDetail,
  type Signal,
  type TopOfMind,
} from "../lib/data";
import type { Adopted, JarNote } from "./top-of-mind/board";

/** Which layer's words are open. The three are one gesture, not three. */
export type EditKind = "memory" | "signal" | "entry";

/** The words open for changing right now. */
export interface OpenEdit {
  readonly kind: EditKind;
  /** The inspiration, signal or entry whose sentence this is. */
  readonly id: string;
  /** The text as typed, which is ahead of the server until `keep` lands. */
  readonly text: string;
  /** True while the keep is in flight, so the button can say so and refuse a
      second press. */
  readonly saving: boolean;
  /**
   * The words are written and this is the beat that says so.
   *
   * A keep used to close the edit the instant the server answered, which is
   * correct and reads as nothing happening: the card blinks back to its
   * reading face and the person is left wondering whether the press landed.
   * Founder, 2026-08-27: "clicking save, just keep it opened, change the text
   * save to saved, and a few sec later bring back the < >".
   *
   * So the edit stays open, saying `saved`, and closes itself a moment later —
   * which is when the foot's carets return, because they are the reading
   * face's and the reading face is what comes back.
   */
  readonly saved: boolean;
}

/**
 * What the act needs from the page, and nothing else.
 *
 * Refs are passed WHOLE rather than as their current values, for the reason
 * the header gives: a `.current` read here would be read once and be wrong
 * forever after. The writers are the page's own state setters — a kept edit
 * has to be visible on the ground, in the sky and on the poster before the
 * next fetch, because the words are already in the person's hand.
 */
export interface EditingDeps {
  readonly onInspirationSaved?: (inspiration: ApiInspiration) => void;
  readonly reloadReading?: () => Promise<void>;
  readonly onEntrySaved?: () => void;
  readonly beginReadingMutation?: () => () => void;
  /** Whether the page is running on the offline fixture, in which case an edit
      is a local act and the network is never asked. */
  readonly offline: MutableRefObject<boolean>;
  /** The cache of fetched inspiration bodies. A changed memory's cached body
      is stale the instant it is kept. */
  readonly details: MutableRefObject<Map<string, InspirationDetail>>;
  readonly setInspirations: Dispatch<SetStateAction<Inspiration[] | null>>;
  readonly setSignals: Dispatch<SetStateAction<Signal[] | null>>;
  readonly setNotes: Dispatch<SetStateAction<JarNote[] | null>>;
  readonly setTopOfMind: Dispatch<SetStateAction<TopOfMind | null>>;
  readonly setAdopted: Dispatch<SetStateAction<Adopted | null>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
}

/**
 * The act, as a block sees it: what is open, and the four things a person can
 * do to it. A block that participates takes this one binding.
 */
export interface Editing {
  /** The words open right now, or null when nothing is being changed. */
  readonly open: OpenEdit | null;
  /** Open a thing's words. */
  readonly begin: (kind: EditKind, id: string, text: string) => void;
  /** The person typed. */
  readonly retype: (text: string) => void;
  /** Leave it — close without writing anything. */
  readonly leave: () => void;
  /** Keep these words: write them, say so for a beat, then close. */
  readonly keep: () => void;
}

/**
 * How long `saved` stays on screen before the card returns to its reading
 * face. Long enough to read a five-letter word without looking for it, short
 * enough that it never feels like a state you are stuck in.
 */
const SAVED_HELD_MS = 2_200;

export function useEditing(deps: EditingDeps): Editing {
  const [open, setOpen] = useState<OpenEdit | null>(null);

  /* the `saved` beat's timer, so every route out of an edit can cancel it */
  const holdRef = useRef<number | null>(null);
  const clearHold = useCallback(() => {
    if (holdRef.current !== null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  }, []);
  useEffect(() => clearHold, [clearHold]);

  /* The draft, again, where a callback can reach it. Written by `put` and by
     nothing else, so it cannot fall behind the state it mirrors. */
  const heldRef = useRef<OpenEdit | null>(null);
  const put = useCallback((next: OpenEdit | null) => {
    heldRef.current = next;
    setOpen(next);
  }, []);

  /* Re-pointed during render rather than in an effect: a callback created this
     render must be reachable by a click that happens in this render, and an
     effect would leave the act writing through the previous one. Every member
     is stable today, which is what makes this cheap; the point is that it stays
     correct when one of them stops being. */
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const begin = useCallback(
    (kind: EditKind, id: string, text: string) => {
      /* a new edit cancels the previous one's `saved` beat, or the old one
         would close the new one out from under the person */
      clearHold();
      put({ kind, id, text, saving: false, saved: false });
    },
    [put],
  );

  const retype = useCallback(
    (text: string) => {
      const held = heldRef.current;
      if (held) put({ ...held, text });
    },
    [put],
  );

  const leave = useCallback(() => {
    clearHold();
    put(null);
  }, [put, clearHold]);

  const keep = useCallback(() => {
    const held = heldRef.current;
    if (!held || held.saving) return;
    const text = held.text.trim();
    if (text === "") return;
    const d = depsRef.current;
    put({ ...held, saving: true });
    /**
     * THE BEAT BETWEEN WRITTEN AND GONE.
     *
     * `done` used to be `put(null)`. The words landed, the edit closed in the
     * same frame, and the only evidence the press had done anything was that
     * the card looked exactly as it had before you started typing.
     *
     * Now it says `saved` where it said `save`, holds there long enough to be
     * read, and then closes — and the carets come back with the reading face
     * they belong to. The timer is cleared by `leave`, by a new `begin`, and
     * on unmount, so a closed card can never be reopened by an old beat.
     */
    const done = () => {
      const still = heldRef.current;
      put(still ? { ...still, saving: false, saved: true } : null);
      clearHold();
      holdRef.current = window.setTimeout(() => {
        holdRef.current = null;
        /* only if it is still the same saved edit: stepping to another memory
           or beginning a new one has already replaced it */
        if (heldRef.current?.saved === true) put(null);
      }, SAVED_HELD_MS);
    };
    /**
     * A FAILED EDIT, AND THE ONE FAILURE THAT IS NOT AN ERROR.
     *
     * Ported from the archive before deleting it (main's `da92630`). A 404 on
     * curating a board line does not mean the click failed — it means the
     * artifact was regenerated while you were reading it and this line is no
     * longer in the live version. The server resolves ids forward when the
     * text survived, so reaching this branch means the text did not.
     *
     * Leaving the old words on screen beside a dead control invites the same
     * dead click again, so the board is reloaded to show what is actually
     * there now. The words changing under you IS the explanation.
     */
    const fail = (err?: unknown) => {
      const still = heldRef.current;
      put(still ? { ...still, saving: false, saved: false } : null);
      if (err instanceof ApiError && err.status === 404) {
        put(null);
        if (d.reloadReading) { void d.reloadReading().catch(() => undefined); return; }
        void loadTopOfMind()
          .then((tom) => {
            d.setTopOfMind(tom);
            d.setNotes(tom ? tom.entries : []);
            d.setAdopted(null);
          })
          .catch(() => {
            /* the reload is best-effort: if it also fails the board simply
               stays as it was, which is no worse than before */
          });
      }
    };
    if (d.offline.current) return done();
    if (held.kind === "memory") {
      updateInspiration(held.id, { text })
        .then((made) => {
          if (made) d.onInspirationSaved?.(made);
          d.setInspirations((prev) =>
            prev ? prev.map((c) => (c.id === held.id ? { ...c, preview: text } : c)) : prev,
          );
          d.details.current.delete(held.id);
          /* THE CARD STAYS OPEN. This deselected the memory on success, which
             closed the whole card in the same breath the `saved` beat was
             trying to hold it — so the founder's ruling ("just keep it
             opened") was being obeyed by the edit face and overruled by this
             line one commit older than the ruling. You kept the words; you
             are still reading them. The card leaves when you send it away.
             (founder, 2026-08-27, after it closed on them again.) */
          done();
        })
        .catch(fail);
    } else if (held.kind === "signal") {
      updateSignal(held.id, { statement: text })
        .then(() => {
          d.setSignals((prev) =>
            prev
              ? prev.map((p) => (p.id === held.id ? { ...p, statement: text, locked: true } : p))
              : prev,
          );
          done();
        })
        .catch(fail);
    } else {
      const finish = d.beginReadingMutation?.() ?? (() => {});
      updateTopOfMindEntry(held.id, { body: text })
        .then(() => {
          finish();
          d.onEntrySaved?.();
          d.setNotes((prev) =>
            prev ? prev.map((n) => (n.id === held.id ? { ...n, body: text, locked: true } : n)) : prev,
          );
          d.setAdopted(null);
          done();
        })
        .catch((error) => { finish(); fail(error); }).finally(finish);
    }
  }, [put]);

  /* Rebuilt only when the words change, which is the one thing a reader of the
     act can see. The four callbacks never change identity, so this is also the
     memo that would let a block become a `React.memo` child without every
     keystroke elsewhere on the page redrawing it. */
  return useMemo(
    () => ({ open, begin, retype, leave, keep }),
    [open, begin, retype, leave, keep],
  );
}
