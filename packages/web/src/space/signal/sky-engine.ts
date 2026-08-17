/**
 * LAYER TWO'S ENGINE — what MOVES the sky, taken out of the page.
 *
 * `sky.ts` beside this file says what the sky IS: a `Candidate` that has formed
 * and not been adopted, the `Neb` of light it is drawn as, the `Sat` each piece
 * of its evidence orbits it as. This says what happens to those over time — the
 * frame step, the layout, the orbit solved around the words, the focus that
 * brings a candidate's evidence out, and the two places the sky writes
 * something down.
 *
 * WHY THESE THIRTEEN, AND WHY NOT A FOURTEENTH.
 *
 * Two earlier attempts to break Home.tsx up died on this exact boundary, and
 * both died by ARGUMENT: someone asserted the sky was separable, moved as much
 * as looked sky-shaped, and discovered at the end that the moved set still
 * needed half the loop. So the third attempt measured first.
 * `scripts/measure-groups.mjs` reads, per function, which of the frame loop's
 * eleven state objects it touches, and the gate it answers is that a candidate
 * needing FOUR OR MORE of them is not a module — it is a slice of the loop with
 * a new file name. This set needs three: `sky`, `stir`, `view`.
 *
 * `nebAt` and `satAt` are the fourteenth and fifteenth, and they stayed behind.
 * They are hit tests, so they turn a point on the SCREEN into a point in the
 * layout, and that needs `cam` — which takes the unit to four groups and fails
 * the gate. Widening the boundary by one small function to keep two small
 * functions with their friends is exactly the move that produced the previous
 * two failures, so the two hit tests live in the page and read these numbers
 * from the outside, like everything else that draws.
 *
 * WHAT IT IS NOT ALLOWED TO KNOW. No React, no canvas, no network, and no frame
 * scheduling: `wake()` arrives as a dependency rather than being called, so the
 * clock stays the page's. Everything the engine still needs from the page comes
 * through `SkyDeps` — one declared list, checkable at a glance, instead of a
 * closure over the whole loop.
 */
import { NEB_VARIANTS } from "../../canvas/palette";
import { UNDATED_POW, UNDATED_TIER } from "../../canvas/sprites";
import type { EvidenceRef } from "../../lib/data";
import { clamp01, DAY_MS, easeOut, hashStr, kd, lerp, TAU } from "../../lib/num";
import { givenName } from "../../lib/words";
import { makeGroupBall } from "../../space-kinds/group";
import {
  EASE_DIM_IN,
  EASE_DIM_OUT,
  EASE_GLOW_IN,
  EASE_GLOW_OUT,
  EASE_LIGHT,
  tierOf,
} from "../inspiration/field";
import type { Ball } from "../inspiration/orb";
import { SAT_MAX, writeSkyLayout, type Candidate, type Neb, type Sat } from "./sky";

/**
 * SATELLITES. A candidate's evidence ORBITS it — real orbs, drawn with the
 * field's own baked sprites, at this fraction of a field orb's radius so they
 * read as REFERENCES to a memory rather than duplicates of it: the same memory
 * shown as evidence, not a copy.
 */
export const SAT_R = 0.72;
/**
 * ORBITAL PERIOD IS DURABILITY.
 *
 * A forming candidate is a claim gathering THIS WEEK: its satellites orbit
 * tight and quick. One that has been gathering for a season turns visibly
 * slower and wider. The candidate's age is its EVIDENCE SPAN — the distance
 * between its oldest and its newest memory — and it is read as celestial
 * motion, never as a badge.
 */
const ORBIT_MS_NEW = 14_000;
const ORBIT_MS_OLD = 34_000;
/**
 * The span's contribution to the orbit's WIDTH. It is a multiplier on a base
 * that the sentence's own box sets (see measureNeb) — never the base itself:
 * radius is owed to the words it has to clear, and only after that does a long
 * gathering widen it.
 *
 * Which is exactly why the new end is 1 and not the 0.92 an earlier draft of
 * this had: the base IS the clearance, so any multiplier below 1 pulls the
 * ring inside the air the words were promised and a satellite crosses a
 * sentence. A young candidate is read as tight and quick in its PERIOD; the
 * width channel only widens, it never narrows.
 */
const ORBIT_K_NEW = 1;
const ORBIT_K_OLD = 1.18;
/** The span, in days, at which a candidate has fully aged. */
const ORBIT_SPAN_DAYS = 90;
/**
 * THE ORBIT CLEARS THE WORDS.
 *
 * The ellipse is solved from the candidate's own rendered sentence box, so a
 * satellite can never cross a word: this much air outside the box, plus the
 * satellite's own radius. (Sizing the orbit off the CLOUD is what put orbs on
 * top of the text — the cloud is a soft body with no relationship to how the
 * sentence happened to wrap.)
 */
const ORBIT_MARGIN = 26;
/**
 * The world's shallow perspective, kept as a FLOOR on the flattening: ry never
 * exceeds this fraction of rx. A narrow, tall sentence would otherwise stand
 * its orbit up on end, and a vertical ring reads as a different world. When
 * the box would violate it, rx widens — ry is never shrunk into the words.
 */
const ORBIT_FLAT = 0.7;
/**
 * PROGRESSIVE DISCLOSURE. At rest a candidate is its sentence and its faint
 * body — nothing else. A skyful of sentences AND every one of their evidence
 * satellites is noise, and it was unreadable: the sky's job at rest is to read
 * as a few quiet thoughts floating in space.
 *
 * Tapping one makes it the SUBJECT: it eases up in scale, every other
 * candidate dims uniformly (the field's own focus law, one tier, no second
 * kind of highlight), and its satellites EMERGE from behind the sentence —
 * from its centre, at nothing, out to their places on the ellipse.
 */
const FOCUS_MS = 300;
/** How much bigger the subject sits. Enough to read as nearer, not as a jump. */
export const FOCUS_POP = 0.06;
/**
 * Everything that is not the subject sinks to this alpha, body and sentence.
 *
 * Beside `FOCUS_POP` rather than in the page because the two are one law seen
 * from two ends — the subject rises, everything else sinks — and because both
 * of the things that read it now live in different files: the sky's painter
 * dims the cloud by it, and the page's DOM sync dims the SENTENCE over that
 * cloud by it. Those two numbers going out of step would mean a candidate
 * whose words and whose light disagreed about whether it was the subject.
 */
export const FOCUS_DIM = 0.22;
/** The emergence: out to the ellipse over this long… */
const EMERGE_MS = 420;
/** …one satellite after another, in evidence order. */
const EMERGE_STAGGER = 40;
/** Retraction is the same motion run backwards, and quicker. */
const RETRACT_MS = 260;
const RETRACT_STAGGER = 20;
/** A satellite leaves (and returns to) the sentence at this fraction of size. */
export const EMERGE_SCALE = 0.4;
/** Reduced motion: no emergence at all — the orbit simply fades, this fast. */
const SAT_FADE_MS = 120;
/**
 * Drawn together, two systems NEST rather than intersect: the orbit draws in
 * by this much while its candidate is part of a cluster, and lets go again the
 * moment they are parted. Only the SUBJECT has satellites now, so this can
 * only ever engage on a focused candidate that has been gathered against a
 * neighbour — which is exactly the case where an un-nested ellipse would run
 * its evidence straight through the cloud next door.
 */
const NEST_K = 0.82;
const NEST_MS = 300;
/** The cloud's bright middle: its handle, and what a sentence must keep off. */
export const NEB_CORE = 0.62;
/** Air between one candidate's words and the next candidate's anything. */
const SKY_GAP = 14;
/** Two nebulae belong together once they overlap by this much. */
const CLUSTER_OVERLAP = 0.35;
/** An adopted candidate contracts to a point over this long. */
export const CONDENSE_MS = 700;

/**
 * THE SKY, as the engine needs it — the same object the loop holds, described
 * by the fields this file actually reads and writes rather than by all eleven.
 *
 * Structural on purpose: the page passes its own `sky` object unchanged, and
 * this interface is then a written-down claim about what the engine may touch.
 * Anything the page adds to the group that does not appear here is, by
 * construction, none of the engine's business.
 */
export interface SkyState {
  nebs: Neb[];
  clusterMembers: Set<string>;
  hoverNeb: Neb | null;
  focusNeb: Neb | null;
  selSat: Sat | null;
  satSaid: string;
  satSayW: number;
  heldBall: Ball | null;
}

/** What the world is being drawn into — the four facts the sky is placed by. */
export interface ViewState {
  reduced: boolean;
  w: number;
  h: number;
  layout: { minCam: number };
}

/** How alive the world is right now; every ambient drift scales by it. */
export interface StirState {
  amp: number;
}

/**
 * EVERYTHING THE ENGINE STILL NEEDS FROM THE PAGE, said once.
 *
 * Nine of these are the outward references the 4b measurement found — the
 * functions the sky calls back into the loop for — and they are the reason
 * this is a dependency object and not a pure module: a satellite IS a field
 * orb, so the sky cannot resolve its own evidence without the field's balls,
 * and letting a memory go is the field's verb, not the sky's.
 *
 * The rest are the page's React handles, which the measurement could not see:
 * it reads the frame effect's own closure surface, and a `useRef` declared in
 * the component body above it is invisible to that. They are passed as
 * ACCESSORS rather than as values because every one of them is re-pointed
 * while the effect is still running — `viewerId` is rewritten on every render,
 * `selectedId` on every selection — and a value captured when the deps object
 * was built would freeze the engine at whatever was true when the loop
 * started.
 */
export interface SkyDeps {
  /** The field's own orbs by id: a satellite's memory is often one of them. */
  byId: Map<string, Ball>;
  /** …and the ones that live outside it, a room's evidence included. */
  findBall(id: string): Ball | undefined;
  allBalls(cb: (arr: Ball[]) => void): void;
  /** Where a candidate may be parked, and how wide its orbit may grow there:
      all three read the camera's bounds, which are the page's to own. */
  clampHome(n: Neb): void;
  orbFitX(n: Neb): number;
  orbFitY(n: Neb): number;
  /** Which column a room's memories belong to; the axis of walls is the
      page's, and an agent arriving renumbers it. */
  colOfGroup(groupId: string): number;
  /** Letting a memory go, and telling the clock something happened. */
  release(): void;
  wake(): void;
  /** Room evidence the field has never poured, kept by the page across
      effect runs — makeSat both reads and fills this. */
  groupBalls(): Map<string, Ball>;
  viewerId(): string | null;
  /** The sentence's real DOM element: the orbit is solved from its box. */
  nebEl(id: string): HTMLElement | null;
  /** The whisper beside a satellite. */
  satSayEl(): HTMLElement | null;
  selectedId(): string | null;
  setFocusCandId(id: string | null): void;
}

/** Write-through: every placed cloud's spot, pruned to what exists now.
    (Clusters persist by falling out of the restored positions.) */
export function persistSky(sky: SkyState, view: ViewState) {
  const layout: Record<string, { x: number; y: number }> = {};
  for (const n of sky.nebs) {
    if (n.gone > 0 || !n.pinned) continue;
    /* stored relative to the wall it belongs to: a new agent arriving
       shifts every column, and a spot remembered in layout coordinates
       would come back on somebody else's wall */
    layout[n.id] = { x: Math.round(n.x - n.col * view.w), y: Math.round(n.y) };
  }
  writeSkyLayout(layout);
}

/**
 * One satellite. The memory behind it is resolved ONCE.
 *
 * The viewer's own saves ARE the balls in the field below — the satellite
 * holds that ball and reads its light live, so it fades, dims and
 * re-lights exactly as its memory does. Another member's save gets the
 * same room-orb record the room's own field would build, under the same
 * namespaced id, which is what lets the reading panel show whose it is
 * with nothing fetched. A personal id with nothing behind it is skipped.
 */
function makeSat(nebId: string, e: EvidenceRef, deps: SkyDeps): Sat | null {
  const mine = deps.byId.get(e.signalId);
  let id: string;
  let ball: Ball | null = null;
  let src: Ball;
  if (mine) {
    id = mine.id;
    ball = mine;
    src = mine;
  } else if (e.groupId) {
    id = `${e.groupId}:${e.signalId}`;
    /* a room column already built has the real record; never overwrite it */
    let rb = deps.groupBalls().get(id);
    if (!rb) {
      rb = makeGroupBall(
        {
          signalId: e.signalId,
          textPreview: e.textPreview,
          quote: e.quote,
          kind: e.kind,
          createdMs: e.createdMs,
          authorUserId: e.authorUserId ?? "",
          authorName: e.authorName ?? "",
          citedBy: [],
        },
        e.groupId,
        deps.colOfGroup(e.groupId),
        deps.viewerId(),
      );
      rb.noDate = !e.dated;
      deps.groupBalls().set(id, rb);
    }
    src = rb;
  } else {
    return null;
  }
  const hk = hashStr(`${nebId}:${e.signalId}`);
  const ph = ((hk % 997) / 997) * TAU;
  /* UNDATED EVIDENCE CLAIMS NO ALIVENESS. `createdMs` is then only a
     borrowed edge of the span — the same number for every memory in the
     ring — so the light it would compute is invented. It takes the one
     declared undated appearance instead, and it takes it EVEN WHEN the
     viewer saved this memory themselves: a live ball would light that one
     orb honestly and leave every other orb in the ring lit by a fiction,
     so the ring would say two different kinds of thing at once. Cutting
     `ball` is what holds that — the draw pass reads the memory's live
     numbers through it. */
  const undated = !e.dated;
  return {
    id,
    sizeIdx: src.sizeIdx,
    r: src.r,
    ph,
    a: ph,
    held: false,
    ball: undated ? null : ball,
    tier: undated ? UNDATED_TIER : tierOf(src),
    alivePow: undated ? UNDATED_POW : src.alivePow,
    who: e.authorName ? givenName(e.authorName) : null,
    x: 0,
    y: 0,
    dr: src.r * SAT_R,
    front: 0,
    glow: 0,
    dim: 0,
    em: 0,
    em0: 0,
  };
}

/**
 * Build a candidate's satellites, and read its ORBIT off them.
 *
 * The period and the width are the mechanism: a claim gathering this week
 * turns tight and quick, one that has been gathering for a season turns
 * slower and wider, and the span is measured between its oldest and its
 * newest memory. Nothing is labelled — mass and time ARE the motion.
 */
export function solveSats(n: Neb, c: Candidate, deps: SkyDeps) {
  /* Over SAT_MAX the highest resonances stay and the rest are simply not
     drawn. There is deliberately no "and N more": a count is a number. */
  const picked =
    c.evidence.length <= SAT_MAX
      ? c.evidence
      : [...c.evidence].sort((a, b) => b.resonance - a.resonance).slice(0, SAT_MAX);
  const sats: Sat[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of picked) {
    const s = makeSat(n.id, e, deps);
    if (!s) continue;
    sats.push(s);
    if (e.dated) {
      if (e.createdMs < lo) lo = e.createdMs;
      if (e.createdMs > hi) hi = e.createdMs;
    }
  }
  n.sats = sats;
  /* the depth order is rebuilt with the satellites and only with them: the
     loop re-sorts it in place every frame and never reallocates */
  n.satOrd = sats.map((_, i) => i);
  n.evSig = c.evidence.map((e) => e.signalId).join(",");
  /* the widest of them sets the clearance: the ellipse has to hold ALL of
     them off the words, not the average one */
  let widest = 0;
  for (const s of sats) if (s.dr > widest) widest = s.dr;
  n.satR = widest;
  const measured = hi > lo ? hi - lo : 0;
  const u = clamp01(Math.max(measured, c.spanMs ?? 0) / (ORBIT_SPAN_DAYS * DAY_MS));
  n.period = lerp(ORBIT_MS_NEW, ORBIT_MS_OLD, u) / 1000;
  n.orbK = lerp(ORBIT_K_NEW, ORBIT_K_OLD, u);
}

export function makeNeb(c: Candidate, i: number, deps: SkyDeps): Neb {
  const h = hashStr(c.id);
  const frac = (h % 1000) / 1000;
  const n: Neb = {
    id: c.id,
    kind: c.kind,
    col: c.col,
    variant: (h >>> 8) % NEB_VARIANTS,
    r: 1,
    frac,
    homeX: 0,
    homeY: 0,
    x: 0,
    y: 0,
    ampX: 14 + frac * 10,
    ampY: 12 + frac * 8,
    rateX: TAU / (16 + frac * 9),
    rateY: TAU / (19 + frac * 7),
    phX: frac * TAU,
    phY: ((h >>> 12) % 1000) / 1000 * TAU,
    breathRate: 0.3 + frac * 0.25,
    breathPhase: ((h >>> 4) % 1000) / 1000 * TAU + i,
    sats: [],
    satOrd: [],
    evSig: "",
    orbK: ORBIT_K_NEW,
    satR: 0,
    orbRx: 0,
    orbRy: 0,
    txtW: 0,
    txtH: 0,
    keepR: 0,
    period: ORBIT_MS_NEW / 1000,
    haloX: 0,
    haloY: 0,
    nest: 1,
    nestFloor: 1,
    focused: false,
    focusAt: 0,
    focus: 0,
    focus0: 0,
    dimN: 0,
    pinned: false,
    dragging: false,
    dragX: 0,
    dragY: 0,
    dimS: 1,
    joining: false,
    pairable: false,
    gone: 0,
    condense: 1,
    condenseAt: 0,
  };
  /* solved here, not later: a candidate and its satellites appear
     together, complete — never satellites arriving after the cloud */
  solveSats(n, c, deps);
  return n;
}

/**
 * MEASURE THE WORDS, THEN SOLVE THE ORBIT AROUND THEM.
 *
 * The sentence is real DOM — it wraps where the viewport and the font say
 * it wraps — so the only honest source for how much room it takes is the
 * element itself. Read here and cached on the Neb: on a resize, when the
 * candidate list changes, and at the moment one is tapped (which is also
 * when a late web font would otherwise have moved the words under a
 * solved orbit). NEVER per frame — this forces layout.
 *
 * The width the loop writes is written FIRST, so the height read back is
 * the height at the width the sentence will actually be drawn at.
 */
function measureNeb(n: Neb, deps: SkyDeps) {
  const el = deps.nebEl(n.id);
  if (!el) return;
  const w = Math.round(Math.min(n.r * 1.7, 320));
  const px = `${w}px`;
  if (el.style.width !== px) el.style.width = px;
  const bw = el.offsetWidth || w;
  const bh = el.offsetHeight || 0;
  n.txtW = bw;
  n.txtH = bh;
  const halfW = bw / 2;
  const halfH = bh / 2;
  /* outside the box, by the margin and by the satellite's own radius: the
     nearest a satellite's EDGE ever comes to a word is ORBIT_MARGIN */
  let rx = halfW + ORBIT_MARGIN + n.satR;
  let ry = halfH + ORBIT_MARGIN + n.satR;
  /* the world's shallow perspective, kept by widening rather than by
     squeezing ry back down into the sentence */
  if (ry > rx * ORBIT_FLAT) rx = ry / ORBIT_FLAT;
  /* AND THE CORNERS. Clearing both axes is not the same as clearing the
     box: an ellipse that stands off a rectangle's sides still cuts inside
     its corners, which measured out at a satellite crossing the last word
     of a wrapped line by a few pixels. So the ellipse is grown until it
     encloses the box swollen by the satellite's own radius — the exact
     condition for "no satellite ever touches a word", at every phase and
     not merely at the four cardinal points. Both axes scale, so the
     flattening just settled is kept. */
  const encl = Math.hypot((halfW + n.satR) / rx, (halfH + n.satR) / ry);
  if (encl > 1) {
    rx *= encl;
    ry *= encl;
  }
  /* and only THEN the span's widening: an old claim turns wider, but the
     words set the floor */
  n.orbRx = rx * n.orbK;
  n.orbRy = ry * n.orbK;
  /* AND IT HAS TO FIT THE SKY IT IS PARKED IN. clampHome can only park a
     candidate where its whole system fits while such a spot still exists,
     and the pad it parks by is capped at SKY_PAD_X of the viewport — any
     more and there would be nowhere left to park at all. An orbit wider
     than that has no home, so it runs off BOTH edges every revolution.
     On a phone that is the common case and not the edge one: a whole
     ambition wraps tall enough that ORBIT_FLAT widens rx well past it.

     So the orbit is cut to what the viewport can hold. rx is cut ALONE —
     never by scaling both axes down together, which would drive the ring
     straight through the words it was solved to clear. The flattening is
     a look; the clearance is the promise. What the width can no longer
     give, the height gives back: on a narrow screen the ring stands up a
     little rather than crossing a word or leaving the screen. */
  const fitX = deps.orbFitX(n);
  const fitY = deps.orbFitY(n);
  /* the smallest ry that still encloses the box at the rx in force */
  const needRy = (forRx: number) => {
    const ex = (halfW + n.satR) / forRx;
    return ex < 0.999 ? (halfH + n.satR) / Math.sqrt(1 - ex * ex) : Infinity;
  };
  if (n.orbRx > fitX) {
    n.orbRx = fitX;
    const need = needRy(n.orbRx);
    if (need > n.orbRy) n.orbRy = Number.isFinite(need) ? need : fitY;
  }
  /* Cutting ry to the viewport must never cut it below what the words
     need: on a viewport too small for both, a satellite swinging past the
     top edge for a moment is the lesser failure — it is still where it
     is, and it comes back — whereas a satellite through a word is the
     thing this whole solve exists to prevent. */
  if (n.orbRy > fitY) n.orbRy = Math.max(fitY, Math.min(n.orbRy, needRy(n.orbRx)));
  /* HOW FAR NESTING MAY DRAW IT IN.
     Clustering pulls a system inward so two of them nest rather than
     intersect. What it is allowed to spend is the SPAN's widening — the
     ×1 → ×1.18 a long gathering earned — and nothing else, because
     everything under that is the clearance the words bought and a ring
     drawn inside it is a ring through a sentence. So an old claim, whose
     orbit is wide because it has been gathering for a season, visibly
     draws in when it is gathered against a neighbour; a young one, whose
     orbit is already at the minimum its own words allow, does not move.
     (`rx` here is the solved ellipse BEFORE the span multiplier.) */
  n.nestFloor = clamp01(n.orbRx > 0 ? rx / n.orbRx : 1);
  /* what it keeps its neighbours off: its words or its light, whichever
     reaches further */
  n.keepR = Math.max(n.r * NEB_CORE, Math.hypot(halfW, halfH));
}

export function layoutSky(sky: SkyState, view: ViewState, deps: SkyDeps) {
  const cy = view.layout.minCam + view.h * 0.46;
  const base = Math.min(view.w, view.h);
  const ring = Math.min(view.w * 0.3, view.h * 0.27);
  /* each wall's sky is laid out in its own column, around its own centre */
  const rank = new Map<number, number>();
  for (const n of sky.nebs) {
    const cx = n.col * view.w + view.w / 2;
    n.r = n.kind === "proposal" ? base * 0.21 : base * (n.kind === "draft" ? 0.19 : 0.15);
    /* the words first: the orbit and the keep-out both come off them */
    measureNeb(n, deps);
    if (!n.pinned) {
      if (n.kind === "proposal") {
        n.homeX = cx + (n.frac - 0.5) * 30;
        n.homeY = cy - base * 0.04;
      } else {
        const orbiting = sky.nebs.filter((q) => q.col === n.col && q.kind !== "proposal").length;
        const k = rank.get(n.col) ?? 0;
        rank.set(n.col, k + 1);
        const a = (k / Math.max(orbiting, 1)) * TAU + n.frac * 0.7;
        n.homeX = cx + Math.cos(a) * ring * (0.86 + n.frac * 0.3);
        n.homeY = cy + Math.sin(a) * ring * 0.6 + base * 0.03;
      }
    }
    deps.clampHome(n);
  }

  /* THE SENTENCES ARE PARTED HERE, NOT LEFT TO THE DRIFT.
     The frame-by-frame repulsion can only nudge, and it is pulling
     against each cloud's own home — so two candidates whose HOMES overlap
     (a ring that came out crowded, or two spots kept from a session at
     another viewport, which is exactly how two sentences ended up printed
     on top of each other) stay overlapped forever. So the homes themselves
     are relaxed until every candidate's keep-out — its words or its light,
     whichever reaches further — is clear of every other's. A kept position
     is moved only by the minimum that takes, and the arrangement the
     person made survives it; two sentences in the same place do not
     survive being read. */
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < sky.nebs.length; i++) {
      const a = sky.nebs[i];
      if (a.gone > 0) continue;
      for (let j = i + 1; j < sky.nebs.length; j++) {
        const b = sky.nebs[j];
        if (b.gone > 0) continue;
        let dx = b.homeX - a.homeX;
        let dy = b.homeY - a.homeY;
        const minD = a.keepR + b.keepR + SKY_GAP;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 0.001) {
          /* exactly coincident: part them along a stable axis rather than
             a random one, so the sky lays out the same way twice */
          dx = a.frac <= b.frac ? 1 : -1;
          dy = 0.35;
          d = Math.hypot(dx, dy);
        }
        const push = (minD - d) / 2;
        a.homeX -= (dx / d) * push;
        a.homeY -= (dy / d) * push;
        b.homeX += (dx / d) * push;
        b.homeY += (dy / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
    for (const n of sky.nebs) deps.clampHome(n);
  }

  for (const n of sky.nebs) {
    if (n.x === 0 && n.y === 0) {
      n.x = n.homeX;
      n.y = n.homeY;
    }
    /* a cloud's light starts where the cloud is; it only ever trails it
       afterwards, and never flies in from the origin */
    if (n.haloX === 0 && n.haloY === 0) {
      n.haloX = n.x;
      n.haloY = n.y;
    }
  }
  /* the orbits land with their clouds, in the same beat: a candidate and
     its satellites are one appearance, never a cloud that fills in later */
  const nowMs = performance.now();
  placeSats(sky, view, nowMs / 1000, nowMs);
}

/**
 * TAP A CANDIDATE, GET ITS EVIDENCE. The subject eases up in scale and its
 * satellites emerge from behind its sentence; everything else dims. Tap it
 * again, tap the bare sky, or press Escape, and they retract into the
 * sentence again.
 *
 * The camera does NOT move. A candidate is where it is, its orbit was
 * solved to fit around it there (layoutSky parks it where its whole system
 * fits), and a camera move at the moment of a tap is exactly what the
 * founder had removed from this page once already.
 */
export function focusOn(sky: SkyState, deps: SkyDeps, n: Neb | null) {
  if (sky.focusNeb === n) return;
  const now = performance.now();
  const leaving = sky.focusNeb;
  if (leaving) {
    leaving.focused = false;
    leaving.focusAt = now;
    leaving.focus0 = leaving.focus;
    for (const s of leaving.sats) s.em0 = s.em;
    /* a memory being read from a system that is closing has nothing left
       to sit beside — the same rule adoption's condense already obeys */
    if (sky.selSat && leaving.sats.includes(sky.selSat)) deps.release();
  }
  sky.focusNeb = n;
  /* A fourth discrete fact leaves the loop: WHICH pattern is the subject.
     Its verdict row hangs off it in the DOM, and it exists only while it
     is the one being read — a sky with a row of buttons under every cloud
     is a settings screen, not a sky. */
  deps.setFocusCandId(n ? n.id : null);
  if (n) {
    /* the words may have re-wrapped since they were last measured (a web
       font arriving late is the usual way), and the orbit is only as
       honest as the box it was solved from */
    measureNeb(n, deps);
    n.focused = true;
    n.focusAt = now;
    n.focus0 = n.focus;
    for (const s of n.sats) s.em0 = s.em;
  }
  deps.wake();
}

/**
 * THE ORBITS. Solved in one place — after the clouds have finished moving,
 * so a DRAGGED cloud carries its whole system with it rigidly: the ellipse
 * is measured from wherever the centre ended up, and the satellites go on
 * turning around it. The draw pass, the hit test, the whisper and the
 * panel's spot then all read these same numbers.
 *
 * Reduced motion parks every satellite at its own phase: a static ring, no
 * rotation.
 */
function placeSats(sky: SkyState, view: ViewState, t: number, now: number) {
  for (const n of sky.nebs) {
    if (n.sats.length === 0 || n.gone >= 1) continue;
    /* THE ELLIPSE IS THE SENTENCE'S, not the cloud's: measureNeb solved it
       from the words' own box, so nothing on it can cross a word. The
       subject is a little nearer, and its whole system scales with it —
       words, body and orbit together — which is what keeps that clearance
       exact while it grows. Condensing draws them inward over the same
       beat the cloud takes, still turning, so it reads as a spiral rather
       than a shrink. */
    const grow = 1 + FOCUS_POP * n.focus;
    /* nesting spends the margin and stops at the words (see nestFloor);
       condensing and dispersing are exits and are floored by nothing —
       what is leaving is allowed to pass through anything on its way out */
    const nest = Math.max(n.nest, n.nestFloor);
    const k = nest * n.condense * (1 + n.gone * 0.5) * grow;
    const rx = n.orbRx * k;
    const ry = n.orbRy * k;
    const w = TAU / n.period;
    const count = n.sats.length;
    const dur = view.reduced ? SAT_FADE_MS : n.focused ? EMERGE_MS : RETRACT_MS;
    for (let i = 0; i < count; i++) {
      const s = n.sats[i];
      /* THE EMERGENCE. One after another, in evidence order, out from the
         sentence's own centre — and back into it in the exact reverse
         order, which is what makes the retraction read as the same
         movement run backwards rather than as a second effect. Reduced
         motion holds the ring at its places and fades it instead. */
      const stagger = view.reduced
        ? 0
        : n.focused
          ? i * EMERGE_STAGGER
          : (count - 1 - i) * RETRACT_STAGGER;
      const u = clamp01((now - n.focusAt - stagger) / dur);
      s.em = lerp(s.em0, n.focused ? 1 : 0, view.reduced ? u : easeOut(u));
      /* under reduced motion it never travels: the fade is the whole event */
      const out = view.reduced ? 1 : s.em;
      if (s.held) {
        /* the memory being read holds still under its panel, exactly as a
           focused orb does — and its phase is re-based while it waits, so
           letting go carries it on from where it stopped rather than
           snapping to wherever it would have travelled to meanwhile */
        s.ph = s.a - (view.reduced ? 0 : t * w);
      } else {
        s.a = view.reduced ? s.ph : s.ph + t * w;
      }
      s.x = n.x + Math.cos(s.a) * rx * out;
      s.y = n.y + Math.sin(s.a) * ry * out;
      /* the near half of a shallow ellipse is the lower one */
      s.front = Math.sin(s.a);
      s.dr = s.r * SAT_R * (view.reduced ? 1 : lerp(EMERGE_SCALE, 1, s.em));
    }
    /* AND THEIR DEPTH. Evidence order is not depth order: painting in it
       lets a satellite at the near bottom of the ellipse be covered by one
       barely past the cloud's edge, which inverts the cue and reads as the
       ring turning backwards. Sorted by `front` ascending — far first —
       the same insertion sort over a preallocated index array the field's
       own depth pass uses, so it allocates nothing and is O(n) on the
       near-sorted frame-to-frame case. */
    const ord = n.satOrd;
    for (let i = 1; i < ord.length; i++) {
      const v = ord[i];
      const f = n.sats[v].front;
      let j = i - 1;
      while (j >= 0 && n.sats[ord[j]].front > f) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v;
    }
  }
}

export function stepSky(
  sky: SkyState,
  view: ViewState,
  stir: StirState,
  deps: SkyDeps,
  dt: number,
  now: number,
  t: number,
) {
  /**
   * WHAT THIS ONE WOULD JOIN IF YOU LET GO NOW.
   *
   * Nothing on screen said that dragging two signals together does
   * anything — the founder could not tell it was possible, which means
   * the sky's one act of meaning-making was invisible. So the world
   * answers in the only channel it has: lift a pattern and the one it is
   * about to join LIGHTS. No cursor change, no dashed target ring, no
   * sentence telling you to try it. Move toward something and it responds;
   * move away and it goes quiet again.
   */
  /**
   * AND WHICH ONES COULD BE JOINED AT ALL, BEFORE ANY DRAG.
   *
   * The approach glow answers "is this the right one to drop on" — but it
   * only ever fires once someone has ALREADY picked a pattern up, so a
   * person who never tries the gesture never learns it exists. Limbo ran
   * this exact experiment: they made the character reach out near the
   * grabbable object and it still was not enough, because reaching is
   * confirmation and not discovery. Gorogoa — a game whose entire verb is
   * dragging one panel onto another, five years of work, no text anywhere —
   * still shipped a layer that marks which objects participate.
   *
   * This is that layer, and it obeys the world's law that nothing moves
   * unless you moved it: no drift, no pulse, no demonstration playing
   * itself. Two signals near enough to be joined simply lean into each
   * other's light while sitting perfectly still.
   */
  for (const n of sky.nebs) n.pairable = false;
  if (!sky.focusNeb) {
    for (let i = 0; i < sky.nebs.length; i++) {
      const a = sky.nebs[i];
      if (a.gone > 0 || sky.clusterMembers.has(a.id)) continue;
      for (let j = i + 1; j < sky.nebs.length; j++) {
        const b = sky.nebs[j];
        if (b.gone > 0 || sky.clusterMembers.has(b.id)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        /* generous — this is an invitation, not the drop test */
        const reach = (a.r + b.r) * 1.6;
        if (dx * dx + dy * dy < reach * reach) {
          a.pairable = true;
          b.pairable = true;
        }
      }
    }
  }
  let joinNeb: Neb | null = null;
  {
    const held = sky.nebs.find((n) => n.dragging);
    if (held) {
      let best = Infinity;
      for (const n of sky.nebs) {
        if (n === held || n.gone > 0) continue;
        const dx = n.x - held.x;
        const dy = n.y - held.y;
        const d2 = dx * dx + dy * dy;
        /* the same distance the release actually clusters at, so the
           light is a promise the drop keeps */
        const reach = (n.r + held.r) * 0.9;
        if (d2 < reach * reach && d2 < best) {
          best = d2;
          joinNeb = n;
        }
      }
    }
  }
  for (const n of sky.nebs) {
    n.joining = n === joinNeb;
    /* A clustered member steps BACK, it does not switch off. It used to
       fall to a quarter, which made the words of a group you had just
       built unreadable — "grayed out", and the reader's own act punished
       by the surface. Two thirds still reads as secondary to the group's
       own line while every word stays legible.

       And the candidate about to receive a drop is at full strength,
       whatever else it is: that is the only thing on screen saying the
       gesture exists. */
    const wantS =
      n === joinNeb
        ? 1
        : sky.clusterMembers.has(n.id) && sky.hoverNeb !== n && !n.dragging
          ? 0.62
          : 1;
    n.dimS = view.reduced
      ? wantS
      : Math.abs(n.dimS - wantS) < 0.01
        ? wantS
        : lerp(n.dimS, wantS, 1 - Math.pow(0.02, dt));
    /* THE SUBJECT. It eases up in scale on the page's own curve; everything
       else sinks, body and words together, on the field's focus law —
       there is exactly one lit thing on screen and no second tier of
       highlight. */
    const wantN = sky.focusNeb !== null && sky.focusNeb !== n ? 1 : 0;
    n.dimN = view.reduced
      ? wantN
      : Math.abs(n.dimN - wantN) < 0.01
        ? wantN
        : lerp(n.dimN, wantN, kd(EASE_LIGHT, dt));
    const fu = clamp01((now - n.focusAt) / FOCUS_MS);
    n.focus = view.reduced
      ? n.focused
        ? 1
        : 0
      : lerp(n.focus0, n.focused ? 1 : 0, easeOut(fu));
    /* Drawn together, two systems NEST rather than intersect: the orbit
       draws in over NEST_MS, and lets go again the moment they are parted.
       Only the subject carries satellites now, so this engages exactly
       when a focused candidate has been gathered against a neighbour —
       the one case where the ellipse would otherwise run its evidence
       through the cloud next door. */
    const wantNest = sky.clusterMembers.has(n.id) ? NEST_K : 1;
    if (view.reduced) {
      n.nest = wantNest;
    } else if (n.nest !== wantNest) {
      const d = dt * (1000 / NEST_MS) * (1 - NEST_K);
      n.nest =
        wantNest < n.nest ? Math.max(wantNest, n.nest - d) : Math.min(wantNest, n.nest + d);
    }
    if (n.condenseAt > 0) {
      const u = clamp01((now - n.condenseAt) / CONDENSE_MS);
      n.condense = view.reduced ? 0.06 : lerp(1, 0.06, u * u);
    }
    if (n.gone > 0 && n.gone < 1) n.gone = Math.min(1, n.gone + dt * 1.6);
    if (n.dragging) {
      /* EXACTLY 1:1 WITH THE POINTER. This used to lerp at a quarter per
         frame under a comment claiming it was 1:1 — three frames of lag,
         which is forty pixels at a normal drag speed, and onUp then wrote
         that LAGGED position as the cloud's new home. You aimed, and the
         layout put it forty pixels short, every time, on the gesture that
         performs this product's central act of meaning-making.
         The weight moves to the halo below: the light has inertia, the
         object does not. That is what "made of light" means, said in the
         hand instead of in a caption. */
      n.x = n.dragX;
      n.y = n.dragY;
      /* AND THE CLOUD COMES WITH IT, 1:1.
         The words used to lead and the body used to trail on a very long
         time constant. Written as "the light has inertia, the object does
         not", which is a good sentence about a halo and a wrong one here:
         this sprite is the BODY, the thing in your hand. A held object
         that arrives late does not read as weight, it reads as broken —
         the founder's word was "weird" — and it also means you aim with
         one thing and drop another somewhere else. Under the hand, the
         candidate is ONE object. */
      n.haloX = n.x;
      n.haloY = n.y;
      continue;
    }
    const dx = view.reduced ? 0 : n.ampX * stir.amp * Math.sin(t * n.rateX + n.phX);
    const dy = view.reduced ? 0 : n.ampY * stir.amp * Math.sin(t * n.rateY + n.phY);
    const k = view.reduced ? 1 : kd(0.02, dt);
    n.x = lerp(n.x, n.homeX + dx, k);
    n.y = lerp(n.y, n.homeY + dy, k);
    /* At rest the halo simply is where the cloud is — and it catches up
       fast after a release, rather than sliding in from where the drag
       started. The softness that was wanted lives in the drift above.

       READ THE UNITS BEFORE TOUCHING THIS. `kd`'s first argument is the
       fraction of the distance STILL REMAINING after one second, so a
       LARGER number is SLOWER. This line was 0.35 for a while — a time
       constant of 952ms and 2.2 seconds to close — sitting directly under
       a comment promising the opposite, and it smeared the light behind
       every released cloud for a second and a half. 1e-3 is τ≈145ms,
       slightly ahead of the body's own re-home at τ≈256ms, so the light
       arrives first and the cloud settles into it. */
    n.haloX = view.reduced ? n.x : lerp(n.haloX, n.x, kd(1e-3, dt));
    n.haloY = view.reduced ? n.y : lerp(n.haloY, n.y, kd(1e-3, dt));
  }
  /* They mingle, they never collide — and "collide" now includes the
     WORDS. A candidate's keep-out is whichever of its light and its
     sentence reaches further (measureNeb), so at rest no sentence can sit
     on a neighbour's sentence or on a neighbour's body. A cloud being
     dragged is exempt, as it always was: drawing two together is how a
     draft is gathered. */
  for (let i = 0; i < sky.nebs.length; i++) {
    const a = sky.nebs[i];
    if (a.dragging || a.gone > 0) continue;
    for (let j = i + 1; j < sky.nebs.length; j++) {
      const b = sky.nebs[j];
      if (b.dragging || b.gone > 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      /* TWO TIERS, AND THE SECOND ONE IS WHY CLUSTERS DISSOLVED.
         Strangers keep the sentence-aware keep-out: no candidate's words
         may sit on another's words or light, and that rule is correct.
         But it also applied to a pair the person had just deliberately
         drawn TOGETHER — and since the keep-out is the text's half
         diagonal, a candidate with a long sentence was being shoved back
         out past the clustering threshold the instant it was released. A
         long sentence made clustering literally impossible, a short one
         made it a coin flip, which is exactly the shape of "sometimes
         they don't merge". Once they are one group, only their LIGHT has
         to stay apart. */
      const minD = sky.clusterMembers.has(a.id) && sky.clusterMembers.has(b.id)
        ? (a.r + b.r) * 0.5
        : a.keepR + b.keepR + SKY_GAP;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = ((minD - d) / 2) * Math.min(1, dt * 3);
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      b.x += (dx / d) * push;
      b.y += (dy / d) * push;
    }
  }

  placeSats(sky, view, t, now);

  /* Focus reaches the orbits too, because a satellite IS a memory: the one
     being read lights, and every other one sinks into the haze with the
     rest of the field. One eased fade each, on the field's own curve. */
  const selId = deps.selectedId();
  const selOn = selId !== null;
  for (const n of sky.nebs) {
    for (const s of n.sats) {
      const wantGlow = s.id === selId ? 1 : 0;
      const wantDim = selOn && s.id !== selId ? 1 : 0;
      if (view.reduced) {
        s.glow = wantGlow;
        s.dim = wantDim;
      } else {
        const kg = kd(wantGlow > s.glow ? EASE_GLOW_IN : EASE_GLOW_OUT, dt);
        const km = kd(wantDim > s.dim ? EASE_DIM_IN : EASE_DIM_OUT, dt);
        s.glow = Math.abs(s.glow - wantGlow) < 0.01 ? wantGlow : lerp(s.glow, wantGlow, kg);
        s.dim = Math.abs(s.dim - wantDim) < 0.01 ? wantDim : lerp(s.dim, wantDim, km);
      }
    }
  }
}

/**
 * Which nebulae have been drawn together. Proximity IS belonging: once two
 * clouds overlap by more than a third of their radii they are one group,
 * and the group can be drafted from. Connected components, computed on the
 * loop but only handed to React when the answer changes.
 */
export function computeClusters(sky: SkyState): string {
  const parent = sky.nebs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sky.nebs.length; i++)
    for (let j = i + 1; j < sky.nebs.length; j++) {
      const a = sky.nebs[i];
      const b = sky.nebs[j];
      if (a.gone > 0 || b.gone > 0 || a.condenseAt > 0 || b.condenseAt > 0) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < (a.r + b.r) * (1 - CLUSTER_OVERLAP)) parent[find(i)] = find(j);
    }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < sky.nebs.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(sky.nebs[i].id);
    else groups.set(root, [sky.nebs[i].id]);
  }
  const sig: string[] = [];
  for (const ids of groups.values()) if (ids.length > 1) sig.push(ids.join("+"));
  sig.sort();
  return sig.join("|");
}

/**
 * NOTHING MOVES POSITION ON SELECT — an orb's place in the field already
 * encodes its age, and dragging it to a focus point (or hauling its kin
 * into a ring, as v1 did) destroys the only spatial meaning the jar has.
 * The camera frames it instead; light does the rest. This only has to
 * notice a selection whose orb has scrubbed out from under it.
 */
export function springs(sky: SkyState, deps: SkyDeps) {
  /* a satellite holds its own selection: the memory it stands for may
     live in a field that has never been poured (another room's), and that
     is not a reason to close what is being read */
  if (sky.selSat) return;
  const id = deps.selectedId();
  const sel = id ? deps.findBall(id) : undefined;
  if (!sel || !sel.active) deps.release();
}

export function releaseHolds(sky: SkyState, deps: SkyDeps) {
  deps.allBalls((arr) => {
    for (const b of arr) b.hold = 0;
  });
  if (sky.heldBall) {
    sky.heldBall.hold = 0;
    sky.heldBall = null;
  }
  if (sky.selSat) sky.selSat.held = false;
}

/** The whisper beside a satellite: whose memory it is, once, in words. */
export function sayWho(sky: SkyState, deps: SkyDeps, s: Sat | null) {
  const el = deps.satSayEl();
  if (!el) return;
  const who = s && s.who ? s.who : "";
  if (who === sky.satSaid) return;
  sky.satSaid = who;
  /* the element carries no React children, so writing it here is safe —
     the same way the dial writes its own date. The words STAY through the
     fade-out: swapping them to nothing is what would make it flicker. */
  if (who) {
    el.textContent = who;
    /* measured here and only here: the words just changed, and the loop
       reads this number to keep the name inside the sky */
    sky.satSayW = el.offsetWidth || 0;
  }
  el.classList.toggle("jar-satsay--on", who !== "");
}
