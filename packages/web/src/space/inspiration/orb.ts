/**
 * ONE MEMORY, AS AN ORB — layer 1's model, drawn as the field.
 *
 * `docs/data-model.md` calls it an inspiration; the world draws it as an orb
 * on the ground below you, and this is where the one becomes the other. A
 * `Ball` is everything the canvas needs to place, light and hit-test a single
 * memory, and nothing about the canvas itself: no context, no sprite, no
 * camera. That is what lets the loop stay in `canvas/` and the meaning stay
 * here.
 *
 * THE LAWS THAT LIVE IN THIS FILE, because they are enforced by what it does
 * and does not carry:
 *
 *   - Radius is seeded from an id hash. It is meaningless variation ON PURPOSE
 *     — size never encodes anything, because light is the only meaning channel
 *     and giving a second channel a meaning would quietly create a second one.
 *   - `alive` is the whole story an orb tells about itself. Brightness says
 *     aliveness; nothing else may.
 *   - `agentId` decides WHICH SPACE a memory stands on, and it is decided once
 *     here and read everywhere. `docs/codebase.md` records what happened when
 *     the layout knew this and the renderer did not: every space's memories
 *     piled at the origin.
 *   - A dormant orb still exists. Fading never deletes.
 */

import { Inspiration, type Evidence, type Signal } from "../../lib/data";
import { hashStr, mix32, TAU } from "../../lib/num";
import { type ApiAgentSignal } from "../../lib/agent-contract";
import { FIELD_CARRY_PROMOTION_EVIDENCE } from "../../lib/aliveness";
import { sizeIdxFor } from "../../canvas/sprites";


export interface Ball {
  id: string;
  capturedMs: number;
  updatedMs: number;
  reflections: number;
  hasNotes: boolean;
  /**
   * THE CARRY, AS THREE FACTS. How many patterns cite this memory, and
   * whether any of them reaches layer 3 (the live poster) or layer 4 (a
   * principle). `carryOf` in lib/aliveness.ts turns them into the light —
   * being cited stopped being a boolean the day the field had to say how
   * MUCH of a person stands on a memory, not merely whether anything does.
   */
  roots: number;
  /** one of those patterns has been promoted — the distinction that exists
      from the first week, long before a poster or a principle does */
  promotion: number;
  onPoster: boolean;
  underPrinciple: boolean;
  /** Nothing rests on this memory yet, and it is old enough that something
      could have. The one place the field points forward instead of back. */
  frontier: boolean;
  hasGroup: boolean;
  textPreview: string;
  /** What kind of capture it was — the reflection question is asked about it. */
  kind: string | null;
  /**
   * The words that carried a reading, when this save stands as evidence for
   * one. It is what the panel marks inside the raw text: the passage that led
   * somewhere, shown where it was actually written.
   */
  quote: string | null;
  terms: string[];
  /**
   * Its drawn radius, FITTED to the field it has to share (see assignHomes).
   * Size never encodes meaning — this is the field making room, not the
   * memory saying anything.
   */
  r: number;
  /** What it would be with room to spare. Fitting is never cumulative. */
  rBase: number;
  sizeIdx: number;
  /** Stable per-ball random in [0,1) for scatter. */
  frac: number;
  /**
   * THE FIELD MUST NOT RE-SHUFFLE WHEN A WALL CHANGES.
   *
   * scatterX picks the best of a dozen candidate x's by clearance, and those
   * candidates used to come from Math.random() — so every re-solve dealt the
   * whole field a fresh hand. Now the field is GLOBAL and re-solves every time
   * a wall's peek row is re-elected, a random hand would mean your memories
   * rearranging themselves under you each time you walked to a neighbour. They
   * are the ground; the ground stays put. Twelve fixed draws, off the id.
   */
  scat: number[];
  x: number;
  y: number;
  /** Where this orb belongs in the field. Assigned, never emergent. */
  homeX: number;
  homeY: number;
  /**
   * AND WHERE IT RISES TO WHEN A CLAIM RESTS ON IT.
   *
   * Every memory has ONE place in the field — this one included. Being in a
   * wall's peek row is not a different home, it is a LIFT: standing at
   * headquarters the memories the ambition is built on rise up under it, and
   * as you descend into the field they settle back into their own ground.
   * (Before, a peek orb was carved out of the field's rank ordering and parked
   * on the peek line, and the descent then pushed the whole row down onto the
   * field's top edge — five orbs stacked on the newest few, which is precisely
   * the "bunching at the top" half of the founder's report.)
   */
  peekX: number;
  peekY: number;
  /** Its own slow Lissajous drift around home, scaled with the fitted radius. */
  ampX: number;
  ampY: number;
  ampBaseX: number;
  ampBaseY: number;
  rateX: number;
  rateY: number;
  phX: number;
  phY: number;
  /** 0 → 1 arrival ease: it enters from above its home and settles into it. */
  arrive: number;
  /** How far above home it entered from. */
  entryH: number;
  /** Exists at the current dial time (simulated + drawn). */
  active: boolean;
  /** Fading out in place (scrub-back). */
  leaving: boolean;
  /** 0 present → 1 fully gone; drives the fade-out. */
  gone: number;
  /** Pour schedule in performance.now() ms; -1 once in the jar. */
  spawnAt: number;
  alive: number;
  alivePow: number;
  breathRate: number;
  breathPhase: number;
  /** In section A's peek row — the ones the descent sweeps. */
  peek: boolean;
  /** A reflection was just kept: the memory is coming back to life. */
  relightAt: number;
  relight: number;
  aliveFrom: number;
  aliveTo: number;
  /** 0 free · 1 selected. Never a position target — light only. */
  hold: 0 | 1;
  dim: number;
  glow: number;
  /**
   * CONTACT. The finger is on this one RIGHT NOW — up fast, down slow, and it
   * reaches the bloom and nothing else. A press used to produce literally
   * nothing for the ninety to two hundred and fifty milliseconds it lasted:
   * the world answered on release, which on a device with no hover is how a
   * dormant orb comes to look like scenery rather than something touchable.
   */
  press: number;
  img: { sm: HTMLCanvasElement; lg: HTMLCanvasElement } | null;
  imgUrl: string | null;
  /* ---- room-orb extras (set only for balls living in a room column) ---- */
  /** Which column this orb lives in. Unset = the personal jar. */
  col?: number;
  /** The raw saved-signal id behind a room orb (its `id` is namespaced). */
  sigId?: string;
  /** Whose save this is — the whisper attribution in the panel. */
  authorName?: string;
  /** The viewer's own save, seen inside a room: detail + reflect stay live. */
  own?: boolean;
  /** Titles of the room readings that cited it — the panel's links sentence. */
  citedBy?: string[];
  /**
   * The evidence this was built from named no date of its own (a room
   * proposal's does not). The panel then says WHO rather than inventing a
   * when — omitting a fact is honest, guessing at it is not.
   */
  noDate?: boolean;
  /* ---- the lens (v10): who kept this ---- */
  /**
   * WHO CHOSE TO KEEP THIS. The field is one field — the owner's — and agents
   * write into it, so the only honest way to tell an agent's keeping from a
   * person's is to ask the memory. It is never drawn as a badge: it is what
   * the lens reads, and the lens FADES rather than removes.
   */
  origin: "agent" | "human";
  /** Which agent kept it, where one did. */
  agentId?: string;
  /* set only on a wall that holds more than one person's memories */
  ownerProfileId?: string;
  ownerName?: string;
  /** which member hue this orb is drawn in; -1 is yours, untinted */
  hue?: number;
  /**
   * What produced it, and why it was worth keeping. The explainability the
   * founder asked for: one short phrase, whispered beside the memory when it
   * is in orbit as evidence.
   */
  producedBy?: { ref: string; label: string; why: string };
  /**
   * Everything about this memory is already here — never fetch it. (An agent's
   * memory has no saved-signal detail endpoint behind it, and asking for one
   * would put a spinner where a panel belongs.)
   */
  local?: boolean;
  /**
   * THE ONE BALL THAT IS ALLOWED TO LEAVE THE FIELD.
   *
   * An optimistic newborn whose keep did not land. It never was a memory — it
   * was a promise — so it fades back out (the scrub-away vocabulary, in place,
   * never a flight) and is then genuinely removed, and the field re-fits over
   * the gap. Nothing that EXISTS ever pops out of existence; this is the
   * retraction of something that turned out not to.
   */
  doomed?: boolean;
  /**
   * The lens's haze: 1 when this memory is not what you asked to look at. It
   * is a FADE and never a deletion — nothing that exists pops out of existence,
   * and a filtered field that empties itself would be lying about what is kept.
   */
  lens: number;
}

/** Twelve fixed draws off the id — see Ball.scat. */
export function scatterSeed(id: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < 12; i++) out.push(mix32(hashStr(`${id}/scat/${i}`)) / 4294967296);
  return out;
}

/**
 * EVERYTHING A BALL IS ACTUALLY MADE OF.
 *
 * It is written down because a memory kept HERE, in the mouth, has nothing
 * behind it on the server yet and must not be handed a fabricated one:
 * inventing scores for something the server has not read would put made-up
 * numbers into the one channel this page reserves for meaning.
 *
 * Under the canon a capture knows almost nothing about itself — its words,
 * its time, and what was attached. Everything else a ball wants to show is a
 * fact about the PATTERNS ABOVE IT: whether any of them cites this memory,
 * whether one of those is out loud in a room, which words carried the
 * reading. So the seed is a capture joined to the sky's citation index, and
 * a memory nothing cites honestly carries none of it.
 */
export interface SignalSeed {
  id: string;
  capturedMs: number;
  updatedMs: number;
  /** Answered and skipped both count as attention paid; the panel tells them
      apart, the light does not. */
  reflectionCount: number;
  textPreview: string;
  kind: string | null;
  /** True when at least one pattern cites this memory as evidence. */
  cited: boolean;
  /** The same fact, counted, plus how far up the stack those patterns reach.
      Together they are the memory's CARRY — see lib/aliveness.ts. */
  roots: number;
  promotion: number;
  onPoster: boolean;
  underPrinciple: boolean;
  /** True when a pattern citing it is shared to a room. Captures themselves
      never cross an account boundary — only the patterns above them do. */
  inGroup: boolean;
  /** The words a pattern quoted from this memory, when one named them. */
  quote: string | null;
  /** The statements that rest on this memory, in the server's words. */
  terms: string[];
}

/**
 * A memory said into the mouth during THIS session.
 *
 * It is the seed the ball was built from, kept so that a re-run of the sim
 * effect rebuilds it rather than losing it — a memory you kept five minutes
 * ago must not pop out of existence because a wall arrived.
 */
export interface BornSeed extends SignalSeed {
  /**
   * The saved-signal id the server gave it, once the keep came back. Until
   * then there is nothing to fetch and nothing missing: you typed every word
   * of it, so the reading panel already has the whole thing.
   */
  sigId?: string;
}

/**
 * EVERYTHING ONE MEMORY LEARNS FROM THE SKY ABOVE IT.
 *
 * Under the canon a memory carries no meaning of its own — no score, no theme,
 * no room. What it is FOR is a fact about the patterns that cite it, so these
 * four fields are the whole of what the second layer tells the first, and this
 * is the only place that reading happens.
 *
 * It is split out of `seedOf` because the sky arrives LATE — two requests deep,
 * after the field has already been poured — so the field has to be able to ask
 * this question a second time, of a ball that already exists, without rebuilding
 * anything. Two call sites, one derivation: written twice they would drift, and
 * the drift would be invisible, because both answers are plausible light.
 *
 * A memory nothing cites gets `cited: false`, no quote and no statements, and
 * the field draws it exactly that honestly: present, dated, its own words, and
 * nothing claimed on its behalf.
 */
export interface SkyOverInspiration {
  cited: boolean;
  /** How many patterns cite it — the boolean above, counted. */
  roots: number;
  /** A pattern citing it has been PROMOTED — three memories said the same
      thing, so this one is under something the loop confirmed rather than
      under a guess. The distinction that exists from the first week. */
  promotion: number;
  /** A pattern citing it is cited by the live top of mind. */
  onPoster: boolean;
  /** A pattern citing it is cited by a principle. */
  underPrinciple: boolean;
  inGroup: boolean;
  quote: string | null;
  terms: string[];
}

export function skyOf(
  inspirationId: string,
  citations: Map<string, Evidence[]>,
  signalById: Map<string, Signal>,
  /**
   * The layers above the sky, as the ids of the patterns they stand on.
   * Optional because two callers legitimately have no layer 3 or 4 to speak
   * of — an agent's ground and a room's — and an absent set must read as
   * "nothing above", never as an error.
   */
  posterSignalIds?: ReadonlySet<string>,
  principleSignalIds?: ReadonlySet<string>,
): SkyOverInspiration {
  const cites = citations.get(inspirationId) ?? [];
  const above = cites
    .map((e) => signalById.get(e.signalId))
    .filter((p): p is Signal => Boolean(p));
  /* Counted over the patterns that RESOLVE, not over the citation rows: a
     citation whose pattern is not in hand is not a root the field can claim,
     and counting it would light a memory for something invisible. */
  const roots = above.length;
  return {
    cited: cites.length > 0,
    roots,
    /* HOW FAR THE FURTHEST-ALONG PATTERN ABOVE THIS ONE HAS GOT, graded
       rather than a cliff. `some(status === "active")` was true for nothing
       in a young archive — no signal has three memories behind it yet — so
       the term that was supposed to move the light contributed nothing and
       the whole field came out one brightness. Progress toward promotion is
       the same fact with a slope: one memory behind the candidate is a
       guess, two is the loop starting to believe it, three promotes.
       A signal that HAS promoted reads full without depending on the count,
       so a row served without `evidenceCount` cannot dim a confirmed
       pattern's memories. */
    promotion: above.reduce(
      (best, p) =>
        Math.max(
          best,
          p.status === "active"
            ? 1
            : Math.min(p.evidenceCount ?? 0, FIELD_CARRY_PROMOTION_EVIDENCE) /
                FIELD_CARRY_PROMOTION_EVIDENCE,
        ),
      0,
    ),
    onPoster: posterSignalIds ? above.some((p) => posterSignalIds.has(p.id)) : false,
    underPrinciple: principleSignalIds
      ? above.some((p) => principleSignalIds.has(p.id))
      : false,
    /* A memory is never in a room. What can be is a PATTERN resting on it —
       so this says "something you shared out loud stands on this", which is
       true, without the memory itself having gone anywhere. */
    inGroup: above.some((p) => p.sharedGroupIds.length > 0),
    quote: cites.find((e) => e.quote)?.quote ?? null,
    terms: above.map((p) => p.statement),
  };
}

/** A CAPTURE JOINED TO THE SKY ABOVE IT — the seed a ball is built from. */
export function seedOf(
  c: Inspiration,
  citations: Map<string, Evidence[]>,
  signalById: Map<string, Signal>,
  posterSignalIds?: ReadonlySet<string>,
  principleSignalIds?: ReadonlySet<string>,
): SignalSeed {
  return {
    id: c.id,
    capturedMs: c.capturedMs,
    updatedMs: c.updatedMs,
    reflectionCount: c.reflectionCount,
    textPreview: c.preview,
    kind: c.kind,
    ...skyOf(c.id, citations, signalById, posterSignalIds, principleSignalIds),
  };
}

export function makeBall(s: SignalSeed, agentId = ""): Ball {
  const capturedMs = s.capturedMs || Date.now();
  const updatedMs = s.updatedMs || capturedMs;
  /* Radius seeded by id hash: meaningless variation only — size never
     encodes meaning. */
  const r = 24 + ((hashStr(s.id + "r") % 1000) / 1000) * 8;
  const b: Ball = {
    id: s.id,
    capturedMs,
    updatedMs,
    reflections: s.reflectionCount,
    hasNotes: s.cited,
    roots: s.roots,
    promotion: s.promotion,
    onPoster: s.onPoster,
    underPrinciple: s.underPrinciple,
    frontier: false,
    hasGroup: s.inGroup,
    textPreview: s.textPreview,
    kind: s.kind,
    quote: s.quote ?? null,
    terms: s.terms,
    r,
    rBase: r,
    sizeIdx: sizeIdxFor(r),
    frac: (hashStr(s.id) % 1000) / 1000,
    scat: scatterSeed(s.id),
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    peekX: 0,
    peekY: 0,
    /* drift: amplitude 10-18px, period 7-13s, independent phase per axis */
    ampX: 10 + Math.random() * 8,
    ampY: 10 + Math.random() * 8,
    ampBaseX: 0,
    ampBaseY: 0,
    rateX: TAU / (7 + Math.random() * 6),
    rateY: TAU / (7 + Math.random() * 6),
    phX: Math.random() * TAU,
    phY: Math.random() * TAU,
    arrive: 1,
    entryH: 0,
    active: true,
    leaving: false,
    gone: 0,
    spawnAt: -1,
    peek: false,
    relightAt: 0,
    relight: 0,
    aliveFrom: 0,
    aliveTo: 0,
    alive: 0,
    alivePow: 0,
    breathRate: 0.9 + Math.random() * 0.5,
    breathPhase: Math.random() * TAU,
    hold: 0,
    dim: 0,
    glow: 0,
    press: 0,
    img: null,
    imgUrl: null,
    origin: "human",
    lens: 0,
  };
  /* the drift it would have with room to spare; assignHomes scales it down
     with the radius when the field is crowded */
  /* WHICH WALL'S GROUND THIS SITS ON. Empty string is your own wall, which
     is the id the self wall actually carries — so `b.agentId === wall.id` is
     a comparison between two real values everywhere. It was left unset here,
     which meant every ball read as belonging to no wall: the aliveness pass
     compares against the wall id and `undefined` matches nothing, so every
     wall but yours counted zero memories and glowed identically. */
  b.agentId = agentId;
  b.ampBaseX = b.ampX;
  b.ampBaseY = b.ampY;
  return b;
}

/**
 * A memory kept in this session, from the mouth.
 *
 * It is the SAME ball as anything else in the ground — same constructor, same
 * light, same fitting, same place in the count — carrying one extra fact:
 * everything about it is already here, because the person typed it. That is
 * what `local` has always meant, and it is why the reading panel does not go
 * and fetch a reading that does not exist yet.
 */
export function bornBall(seed: BornSeed): Ball {
  const b = makeBall(seed);
  b.local = true;
  if (seed.sigId !== undefined) b.sigId = seed.sigId;
  return b;
}

/**
 * A memory an AGENT kept, in the owner's own field.
 *
 * THE FIELD IS ONE FIELD. An agent does not get a jar of its own — it writes
 * into the memory layer it shares with the person, which is the whole point of
 * the direction. So this is the same ball, from the same constructor discipline
 * as a saved signal, carrying two extra facts: who kept it, and what work it
 * came out of. Its light obeys the same decay as everything else, which is why
 * an agent that has been idle for a month has a visibly cold end of the field
 * and needs no "last active" line anywhere.
 */
/* Kept for the agent walls, which render an agent's memories on ITS OWN wall.
   Exported so it survives while unused: it is NOT part of the owner's field —
   see the field construction and the founder ruling there. */
export function makeAgentBall(s: ApiAgentSignal): Ball {
  const capturedMs = Date.parse(s.capturedAt) || Date.now();
  const r = 24 + ((hashStr(s.id + "r") % 1000) / 1000) * 8;
  const b: Ball = {
    id: s.id,
    capturedMs,
    updatedMs: Date.parse(s.updatedAt) || capturedMs,
    reflections: 0,
    hasNotes: false,
    /* An agent's own memory, on an agent's own wall: the viewer's poster and
       principles say nothing about it, and the agent's are its own business.
       Zero is the truthful answer here, not a missing one. */
    roots: 0,
    promotion: 0,
    onPoster: false,
    underPrinciple: false,
    frontier: false,
    hasGroup: false,
    textPreview: s.textPreview,
    kind: s.kind,
    quote: s.quote,
    terms: [],
    r,
    rBase: r,
    sizeIdx: sizeIdxFor(r),
    frac: (hashStr(s.id) % 1000) / 1000,
    scat: scatterSeed(s.id),
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    peekX: 0,
    peekY: 0,
    ampX: 10 + Math.random() * 8,
    ampY: 10 + Math.random() * 8,
    ampBaseX: 0,
    ampBaseY: 0,
    rateX: TAU / (7 + Math.random() * 6),
    rateY: TAU / (7 + Math.random() * 6),
    phX: Math.random() * TAU,
    phY: Math.random() * TAU,
    arrive: 1,
    entryH: 0,
    active: true,
    leaving: false,
    gone: 0,
    spawnAt: -1,
    peek: false,
    relightAt: 0,
    relight: 0,
    aliveFrom: 0,
    aliveTo: 0,
    alive: 0,
    alivePow: 0,
    breathRate: 0.9 + Math.random() * 0.5,
    breathPhase: Math.random() * TAU,
    hold: 0,
    dim: 0,
    glow: 0,
    press: 0,
    img: null,
    imgUrl: null,
    origin: s.origin,
    agentId: s.agentId,
    ownerProfileId: s.ownerProfileId,
    ownerName: s.ownerName,
    producedBy: s.producedBy ?? undefined,
    local: true,
    lens: 0,
  };
  b.ampBaseX = b.ampX;
  b.ampBaseY = b.ampY;
  return b;
}