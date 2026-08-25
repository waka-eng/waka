/**
 * LAYER TWO — THE SIGNAL, AND THE SKY IT IS DRAWN IN.
 *
 * The canon's three layers are inspiration → signal → top of mind. This module
 * is the middle one's model: what a forming signal IS on screen, what it is
 * made of, and where the person last put it.
 *
 * One reason to exist: a `Candidate` is a signal that has formed and has not
 * been adopted; a `Neb` is the light that candidate is drawn as; a `Sat` is one
 * piece of its evidence, in orbit around it. Those three shapes are the whole
 * vocabulary of the sky, and nothing here computes a frame: what MOVES them is
 * `sky-engine.ts` beside this file, which for a long time lived in the page and
 * no longer does. No React, no canvas, no network.
 *
 * `sky` is a word for WHERE this is drawn, not a fourth noun beside the canon's
 * three; `docs/architecture.md` keeps that distinction.
 */
import type { EvidenceRef } from "../../lib/data";
import type { Ball } from "../inspiration/orb";

/**
 * At most this many memories orbit one candidate. Past that the highest
 * resonances stay and the rest are simply not drawn — a cloud is a claim, not
 * an inventory, and "and N more" would put a number on the page.
 */
export const SAT_MAX = 8;

/**
 * Sky layout persistence, tier ONE: the personal sky's nebula positions,
 * local to this browser, written through on drag end and pruned to the
 * candidates that still exist. Tier TWO is SHARED per-room persistence,
 * which needs a backend endpoint (coming separately) — the storage shape
 * {candidateId: {x, y}} is chosen so the server version can adopt it
 * unchanged.
 */
const SKY_LAYOUT_KEY = "waka.sky.layout.v1";

export function readSkyLayout(): Record<string, { x: number; y: number }> {
  try {
    const raw = window.localStorage.getItem(SKY_LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, { x: number; y: number }>)
      : {};
  } catch {
    return {};
  }
}

export function writeSkyLayout(layout: Record<string, { x: number; y: number }>): void {
  try {
    window.localStorage.setItem(SKY_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable (private mode, quota): the sky still works */
  }
}

/**
 * A candidate for the ambition: something that has formed but has not been
 * adopted. Either the room's pending PROPOSAL (a whole rewrite, adoptable) or
 * a provisional top-of-mind reading (a machine claim, not adoptable yet), or
 * a DRAFT the person assembled up in the sky.
 */
export interface Candidate {
  id: string;
  kind: "proposal" | "reading" | "draft";
  /**
   * The person edited this statement, so the server never rewords it — on
   * screen that state is the star. Only your own sky's readings can carry
   * it: a room's wall statement may be starred in its OWNER'S sky, and a
   * proposal or draft is nobody's frozen sentence.
   */
  locked: boolean;
  /**
   * For a statement on a room's wall: the real signal id a verdict targets
   * (the candidate's own id is a composite the server would refuse), whether
   * the statement is the viewer's own — you do not answer yourself in a room;
   * that is private curation — and who has answered it so far, latest word
   * per member, named. Null everywhere that is not a wall statement.
   */
  wallTarget: {
    signalId: string;
    mine: boolean;
    reactions: Array<{
      profileId: string;
      name: string;
      value: "true" | "partly" | "not_true";
    }>;
  } | null;
  /**
   * WHOSE SKY THIS IS. Every wall that has a sky has its own — an agent's
   * forming candidates are the things it is distilling and has not adopted,
   * which is the same relationship your own sky has to your own ambition.
   * Rooms have no sky, so nothing is ever built at their column.
   */
  col: number;
  text: string;
  /** The memories it is made of. Each one ORBITS it, as a satellite. */
  evidence: EvidenceRef[];
  /**
   * The evidence span the server declared, where it knows it better than the
   * satellites do: a room's proposal carries a span but no per-save dates.
   * The orbit takes the WIDER of this and what the satellites measure.
   */
  spanMs: number | null;
  /** Only the room's real proposal can be adopted; the rest are honest about it. */
  adopt: { groupId: string; proposalId: string } | null;
  /** A draft is born between the nebulae it was drawn from. */
  originIds: string[];
}


/**
 * A SATELLITE: one evidence memory, in orbit around the candidate it is
 * evidence FOR. It is a reference, never a second memory — the very sprite the
 * field draws, at SAT_R of the radius, so provenance is legible rather than
 * implied. (The same principle the peek row already obeys downstairs: the row
 * IS the ambition's evidence.)
 */
export interface Sat {
  /** What a tap focuses: the memory itself, wherever in the world it lives. */
  id: string;
  sizeIdx: number;
  /** The memory's own radius; the satellite draws at SAT_R of it. */
  r: number;
  /** Its own place on the ellipse — every satellite on its own phase. */
  ph: number;
  /** The angle it is at right now, kept so a held one can be let go without
      snapping to wherever it would have travelled to meanwhile. */
  a: number;
  /** Being read: it holds still under its panel, as a focused orb does. */
  held: boolean;
  /**
   * The field ball behind it, when the memory is one of the viewer's own: the
   * satellite then fades, dims and re-lights EXACTLY as its memory does,
   * because it is reading the same numbers.
   */
  ball: Ball | null;
  /** Otherwise, the appearance it was built with. */
  tier: number;
  alivePow: number;
  /** Room evidence: the given name the whisper says. */
  who: string | null;
  /** Written every frame; the hit test, the whisper and the panel read these. */
  x: number;
  y: number;
  /** Its drawn radius this frame — the hit test uses the same number. */
  dr: number;
  /** Greater than zero in front of the cloud, at or below it behind. */
  front: number;
  /** One eased fade each: focus lights this one and dims the rest. */
  glow: number;
  dim: number;
  /**
   * EMERGENCE. 0 is inside the sentence at nothing, 1 is out on the ellipse
   * whole. It is the satellite's alpha, its scale and its distance from the
   * centre at once, because those are one movement: coming out from behind
   * the words. Under reduced motion it is the alpha alone.
   */
  em: number;
  /** Where it was when the subject last changed — so a reversal never pops. */
  em0: number;
}

/** A candidate's body in the sky: light that has not condensed. */
export interface Neb {
  id: string;
  kind: Candidate["kind"];
  /** which wall's sky it floats in; its whole system lives at that column */
  col: number;
  /** Which of the baked cloud SHAPES it is; its light is everyone's light. */
  variant: number;
  r: number;
  frac: number;
  homeX: number;
  homeY: number;
  /**
   * WHERE THIS STATEMENT WAITS WHEN YOU ARE NOT IN THE SKY.
   *
   * The field has had this since it was built: some memories are elected to
   * rise toward headquarters so the ground is CUT BY THE BOTTOM EDGE, and
   * "there is more down there" needs no words. The sky never had it, so from
   * headquarters the top edge was empty black and nothing said the sky
   * existed at all.
   *
   * Measured 2026-08-23 standing at headquarters: the bottom edge read
   * avg 7.20, the top edge avg 0.05 — the field announced itself 144x more
   * loudly than the sky, and the sky's own lowest statement rested about
   * 340px above the viewport.
   *
   * Equal to `homeY` for every statement that is not elected, so the lerp
   * that reads it is a no-op for them.
   */
  peekY: number;
  x: number;
  y: number;
  ampX: number;
  ampY: number;
  rateX: number;
  rateY: number;
  phX: number;
  phY: number;
  breathRate: number;
  breathPhase: number;
  /** The memories it is made of, in orbit around it. */
  sats: Sat[];
  /**
   * Painter's order for those satellites: far side first, nearest last, so an
   * orb low on the ellipse covers one behind it rather than the other way
   * round. Written once per frame in placeSats over a preallocated index
   * array (the field's own sortByDepth convention), read forward by the draw
   * pass and BACKWARD by the hit test — one ordering, so what answers a tap
   * is always what the eye has on top.
   */
  satOrd: number[];
  /** Which evidence built them, so a re-drafted candidate re-solves once. */
  evSig: string;
  /** The span's widening, as a multiplier on the box-derived base. */
  orbK: number;
  /** The widest satellite it carries: the orbit has to clear the words by it. */
  satR: number;
  /**
   * The ellipse the satellites turn on, solved from the SENTENCE's measured
   * box (plus the margin, the satellite and the span) — read every frame,
   * measured only on resize, on a text change and on focus.
   */
  orbRx: number;
  orbRy: number;
  /** The sentence's own box, as the DOM last rendered it. */
  txtW: number;
  txtH: number;
  /**
   * What this candidate keeps every other candidate off: whichever is bigger,
   * its light or its words. At rest no sentence may sit on a neighbour's
   * sentence or on a neighbour's body.
   */
  keepR: number;
  /** Seconds for one turn — slower the longer it has gathered. */
  period: number;
  /** Clustered: nested rather than intersecting. 1 apart, NEST_K drawn in. */
  nest: number;
  /** The most nesting may draw it in: the span's widening, and nothing under. */
  nestFloor: number;
  /** The subject: tapped, so it carries its evidence. One at a time. */
  focused: boolean;
  /** When that last changed, and where the eases were at the time. */
  focusAt: number;
  focus: number;
  focus0: number;
  /** Not the subject while another one is: one uniform sink, body and words. */
  dimN: number;
  /** Dragged: it keeps the place it was put (for this session only). */
  pinned: boolean;
  dragging: boolean;
  dragX: number;
  dragY: number;
  /**
   * The sentence's own light. Clustered members whisper at a quarter
   * strength — the cluster speaks with its one draft line — and a member
   * under the pointer (or a finger) comes back to full for as long as the
   * touch lasts. Eased in the loop: a single fade, never a movement.
   */
  dimS: number;
  /** About to receive the pattern in your hand: the drop target, said in
      light because nothing else on screen says the gesture exists. */
  joining: boolean;
  /** Near enough to another pattern that they could be joined — said at rest,
      before any drag, so the gesture is discoverable rather than merely
      confirmable once attempted. */
  pairable: boolean;
  /** 0 present → 1 dispersed (dragged off the top of the sky). */
  gone: number;
  /** 1 open → 0 condensed to a point, on adoption. */
  condense: number;
  condenseAt: number;
}
