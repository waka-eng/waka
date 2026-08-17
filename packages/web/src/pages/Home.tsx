/**
 * WAKA — the world. Home, at `/`.
 *
 * A mobile-first, full-viewport space you descend into, Inside Out's long-term
 * memory drawn literally. A ruler time-dial fixed at the bottom scrubs the
 * whole page through time.
 *
 * THE THREE LAYERS ARE THE THREE SECTIONS. `docs/data-model.md` is the
 * vocabulary of record and this page is its picture, top to bottom:
 *
 *   the sky            LAYER 2 — signals: evidence-backed patterns. What is
 *                      `emerging` hangs overhead with the memories it cites
 *                      orbiting it, which is where a pattern's "why" is
 *                      finally readable.
 *   headquarters       LAYER 3 — the one top-of-mind artifact. Exactly one
 *                      per profile, so the poster is never one of several;
 *                      beneath it, the patterns it stands on.
 *   the field          LAYER 1 — inspirations: every capture this profile
 *                      owns, one orb each, always the whole set.
 *
 * The horizontal axis is WHOSE wall you are standing on — agents to the left,
 * you at the origin, rooms to the right. The field never changes with it: the
 * ground is always your own archive ("3번째 섹션에서는 양옆 못 움직여야 해").
 *
 * A room is a wall of STATEMENTS. Members share signals, never captures, so
 * another person's raw memories never appear here — not as orbs, not as
 * quotes, not in an orbit.
 *
 * Founder rulings implemented here, not decorated around:
 *   - Light is the only meaning channel. Glow = aliveness as a continuum;
 *     fading = losing light/saturation (frosted glass); size never encodes
 *     meaning; no numbers rendered (dates and "grounded in N pulses" prose
 *     excepted by ruling).
 *   - Motion explains the mechanism: the pour-in explains stratification
 *     (oldest sink deepest), the scrub lift-out explains "didn't exist yet".
 *   - Fading never deletes: dormant orbs stay as frosted sediment.
 *   - TAP IS FOCUS, NOT REARRANGEMENT. Nothing changes position on select:
 *     an orb's position already encodes its depth and age, and moving it
 *     would destroy the only spatial meaning the jar has. The camera moves
 *     instead, the orb blooms, its kin light up where they already sit.
 *
 * The orbs are glass SPHERES, not discs: light from the upper left, a shaded
 * terminator to the lower right, a bright rim arc, a cool counter-rim, a
 * specular, an inner luminous core and a contact shadow. All of that is
 * BAKED INTO OFFSCREEN SPRITES at load / skin switch / DPR change — the
 * frame loop never touches createRadialGradient, ctx.filter or shadowBlur.
 *
 * Rendering is one rAF loop over a single 2D canvas (OrbitBoard's regime):
 * per-frame state lives in refs and plain objects, React state holds only
 * discrete facts.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  FIELD_CITED_LIFT,
  FIELD_DECAY_HALF_LIFE_DAYS,
  FIELD_FLOOR_ANSWERED,
  FIELD_FLOOR_CITED,
  FIELD_FLOOR_IN_GROUP,
  FIELD_FRONTIER_DAYS,
  FIELD_REFLECTION_SATURATION,
  FIELD_REFLECTION_WEIGHT,
} from "../lib/aliveness";
import { hueCss, tintRamp, type Ramp } from "../lib/appearance";
import { clamp, clamp01, DAY_MS, easeOut, hashStr, kd, lerp, mix32, TAU } from "../lib/num";
import {
  daysAgo,
  MOCK_AGENTS,
  MOCK_AGENT_BUNDLES,
  type AgentBundle,
  type ApiAgentDirectionReading,
  type ApiAgentSignal,
} from "../lib/fixture";
import {
  agoWords,
  citedWords,
  dateWords,
  givenName,
  groupCompany,
  monthTag,
  numWords,
} from "../lib/words";

import {
  affirmGroupProposal,
  declineGroupProposal,
  createInspiration,
  createGroup,
  createProfile,
  createReflection,
  deleteReflection,
  fetchGroupProposals,
  createGroupProposal,
  fetchGroupMembers,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  deleteGroup,
  fetchGroupTopOfMind,
  fetchGroups,
  fetchGroupField,
  fetchGroupWall,
  fetchInspirations,
  fetchTopOfMindVersions,
  finalizeAttachment,
  presignAttachment,
  uploadToPresignedUrl,
  joinGroup,
  shareSignal,
  unshareSignal,
  deleteInspiration,
  createFeedback,
  deleteSignal,
  dismissTopOfMindEntry,
  restoreTopOfMindEntry,
  holdTopOfMindEntry,
  refreshTopOfMind,
  updateInspiration,
  updateSignal,
  updateTopOfMindEntry,
  fetchProfiles,
  type ApiGroupProposal,
  type ApiGroupMember,
  type ApiGroupSummary,
  type ApiGroupTopOfMind,
  type ApiGroupFieldCapture,
  type ApiGroupWallSignal,
  type ApiTopOfMindVersion,
  ApiError,
} from "../lib/api";
import {
  loadInspiration,
  loadInspirations,
  loadTopOfMind,
  loadSignal,
  loadSignals,
  toInspiration,
  type Inspiration,
  type InspirationDetail,
  type Entry,
  type Evidence,
  type Signal,
  type TopOfMind,
} from "../lib/data";
import { useOptionalAuth } from "../lib/auth-context";

import "../styles/home.css";

/** Same rule Surface.tsx uses for the Debug pill. */
function showsDebug(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true || env.VITE_SHOW_INTERNAL === "1";
}

/**
 * MOONLIGHT — the surface, chosen.
 *
 * Three committed directions were built and judged by eye in motion (ember,
 * moonlight, hanji); the founder chose this one and the other two are gone,
 * along with the chooser that switched between them. There is one look now,
 * and no branch that selects it.
 *
 * The world is night photography: a cold, clean, genuinely black ground, cool
 * silver light, fine film grain and a soft vignette. What replaced the six
 * hash-picked pastel tints is a single ramp driven by ALIVENESS — see rampAt,
 * which carries the law.
 */

/** Size buckets the orb + halo sprites are rastered at (radius is 24-32). */
/**
 * THE SIZES A DISC IS ACTUALLY BAKED AT — and they have to cover the range the
 * field really draws at, which these did not.
 *
 * There were three, at 25 / 28.5 / 32, chosen for the meaningless per-orb
 * radius jitter. But the field FITS its orbs to the band: crowd it and the
 * radius falls all the way to ORB_R_MIN, six. A six-pixel orb was being drawn
 * from a sprite baked for twenty-five and scaled down four times over, and a
 * bilinear downscale of that depth turns a crisp rim and a small specular into
 * a smear. Every sphere term above was being destroyed at draw time.
 *
 * Nine steps across the whole real range, spaced closer at the small end where
 * a given percentage error is most visible. Any drawn radius now lands within
 * a few percent of a sprite baked for it. Nine sizes × four tiers is thirty-six
 * discs baked once at load — nothing per frame, which is the standing rule.
 */
const SIZE_R = [6, 8.5, 11.5, 15, 19, 23, 26.5, 29.5, 32];
/** Sprite bleed so the rim arc's outer antialiasing is never clipped. */
const ORB_PAD = 2;
/** Drifting dust motes — the atmosphere, not decoration. */
const MOTES = 40;
/** Dim sparkle points scattered in the deep background. */
const SPARKS = 26;
/* The theme-hash gradient pairs are GONE. An orb's colour said which theme its
   first term hashed to, which is a fact nobody can read off a screen and which
   the page's own law forbids putting into light. What remains is aliveness —
   see rampAt, which carries the law. */
/**
 * How far the field breaks the bottom edge of section A, measured above the
 * time dial. A fixed promise at EVERY viewport height — the founder's
 * most-repeated note.
 */
const PEEK = 96;
/**
 * The dial's strip, as a FALLBACK ONLY — the real number is measured off the
 * dial itself every time the world is measured (see `measure`).
 *
 * It was a constant 92, and the extra 40 of air under it made the field's
 * bottom reserve 132px at every viewport height: a tenth of a 1400px screen,
 * a fifth of a 620px one, a quarter of a 560px one. That is the whole of the
 * bug the founder reported four times — nothing was ever pushed OFF screen, so
 * every count passed, while the field visibly abandoned the bottom quarter of
 * a short viewport. It also passed at 700 and 1400 and failed at 620, which is
 * exactly the shape of a fixed reserve against a variable screen.
 *
 * The dial knows its own height, including the safe-area inset on a phone
 * where a hard-coded 92 was simply wrong. So the world asks it, the way
 * measureNeb asks a sentence for its box rather than guessing at it.
 */
const DIAL_H = 92;
/**
 * THE MOUTH'S OWN STRIP, at the seam between headquarters and the field.
 *
 * It is reserved whether or not the mouth is open, and that is the whole
 * point of it being a constant: the companion's slot is solved against
 * `fieldTop − MOUTH_H`, so opening the mouth cannot move the companion. A
 * reserve measured off the mouth's live height would make the world lurch
 * every time a line of typing wrapped, which is the one thing this page does
 * not do.
 */
const MOUTH_H = 52;
/** The least the topmost orb is ever left clear of the top edge. */
const FIELD_EDGE = 6;
/**
 * The smallest the companion is ever drawn. It shrinks before anything else in
 * headquarters gives way, but below this its two eyes stop resolving and it
 * reads as one more orb rather than as the thing that is looking at you — so
 * this is where the shrinking stops and a genuinely too-short section is
 * allowed to be too short.
 */
const CHAR_MIN = 32;
/** An orb eases down into its home over this long. */
const ARRIVE_MS = 520;
/** How many of the newest orbs share the peek row in section A. */
const PEEK_ORBS = 5;
/**
 * And the most a wall's provenance may lift, however much of it there is.
 * Volume is the whole risk on an agent's wall: eight lumpy, honestly-lit orbs
 * are evidence, and forty are inventory.
 */
const PEEK_MAX = 8;
/** However crowded the field gets, an orb never shrinks past this. */
const ORB_R_MIN = 6;
/**
 * A flick faster than this always commits to the next section. Lowered from
 * 500 once the snap started INHERITING the flick's speed: at 500 a genuine
 * throw was being read as a nudge and then re-timed from scratch.
 */
const FLICK = 380;
/**
 * CULL AT THE REAL SPRITE EXTENT. The widest bloom reaches
 * 32 × BLOOM_R × 1.12 ≈ 79px from its centre and the widest disc
 * 32 + ORB_PAD = 34px, so these are the true margins. The old
 * ±300/±260 additively blended a couple of million device pixels of orbs
 * entirely below the fold, every frame.
 */
const CULL_BLOOM = 82;
const CULL_ORB = 40;
/** The whole pour fits in this, however many memories there are to pour. */
const POUR_MS = 2400;
/**
 * THE SETTLE — a moving hold, not a freeze.
 *
 * Everything here carried a permanent Lissajous drift, sixty times a second,
 * forever. That is decoration by this file's own definition, and it costs
 * more than power: it spends the most powerful thing an animator owns BEFORE
 * anything has happened, so the genuinely good things — a room arriving, a
 * memory coming back to life — land in a frame that was already busy and
 * read as nothing. There was no stillness anywhere for an event to be
 * measured against.
 *
 * A field that stops dead looks broken (correctly rejected before), so this
 * is amplitude, not motion: after a couple of seconds with no hand and
 * nothing pending, every ambient amplitude eases down to a fifth of itself.
 * The world is then at rest and still breathing. Anything real — a touch, a
 * pour, a scrub, a relight, a travel, an adoption, a room waking — restores
 * it instantly, and that restoration is part of the event's punch: the world
 * wakes up because something happened.
 */
const SETTLE_IDLE = 2500;
const SETTLE_MIN = 0.2;
/** How fast the world eases back down into its hold. */
const EASE_SETTLE = 0.08;
/**
 * EVERY CONTINUOUS EASE IN THE WORLD, AS A RATE. Each is the fraction of the
 * distance still remaining one second later, fed to kd() with the frame's own
 * dt — so all of these mean the same thing on a 60Hz Android and a 120Hz
 * iPhone. They were per-frame constants (0.14, 0.16, 0.2) and therefore meant
 * two different things on the two devices sitting side by side.
 */
const EASE_LIGHT = 1.2e-4;
/** Light in fast, out slow: τ ≈ 28ms arriving, ≈ 180ms leaving. */
const EASE_GLOW_IN = 1e-16;
const EASE_GLOW_OUT = 3.8e-3;
/** The haze the other way round: it closes in slowly and lifts briskly. */
const EASE_DIM_IN = 1.1e-2;
const EASE_DIM_OUT = 4.5e-4;
/** Contact: present within a frame, gone over a couple of hundred ms. */
const EASE_PRESS_IN = 1e-16;
const EASE_PRESS_OUT = 3.8e-3;
/** The camera's rubber band at the ends of the world. */
const EASE_BAND = 2.6e-5;
/**
 * THE HAND'S OWN SPEED, SMOOTHED — the last per-frame rate in the input path,
 * and the one that mattered most.
 *
 * It read `v = v * 0.6 + instant * 0.4`, a blend per EVENT, so the estimate
 * converged twice as fast where the pointer reports twice as often. That was
 * harmless while the snap threw the number away. It is not harmless now that
 * the snap is SEEDED with it: the same flick, on two phones, would be handed
 * two different speeds and therefore timed two different ways — which is
 * exactly the failure the rest of this pass exists to remove, hiding one
 * level below the eases everybody had already fixed. This is the same 0.4 at
 * 60Hz, said as a rate, and it is fed the interval between the two samples it
 * is actually blending.
 */
const EASE_VEL = 4.89e-14;
/** The companion's turn: with the dial, and with a travel. */
const EASE_YAW_SCRUB = 1.6e-6;
const EASE_YAW_TRAVEL = 2.6e-5;
/** A scrubbed-away bubble fades out in place over this long. It never flies. */
const FADE_MS = 260;
/** A reflected-on memory climbs back to its new aliveness over this long. */
const RELIGHT_MS = 900;
/**
 * How far the companion turns across the WHOLE dial: two full turns. It is a
 * TURNAROUND about its own vertical axis — wind time back and you see its
 * back — and the yaw follows the dial's position, never a timer. Winding back
 * a month turns it a month's worth, and holding still holds the angle.
 */
const SPIN_TURNS = 2;
/** Let go and it eases back to front-facing, the short way round. */
const UNWIND_MS = 650;
/**
 * The turn is a PLANET, not a card: the silhouette never changes, and it is
 * the features that travel across it. An eye sits on the equator at this
 * longitude; the pair are ~1 radian apart, which is what puts them where they
 * have always sat when the companion is facing you.
 */
const EYE_LON = 0.5;
/** The equator's radius as seen head-on, as a fraction of the body's width. */
const FACE_R = 0.34;
/** How many baked shapes a nebula chooses between, per tint pair. */
const NEB_VARIANTS = 2;
/** The radius the nebula sprites are baked at; they are scaled at draw. */
const NEB_PX = 150;
/** At most this many candidates get a body in the sky. */
const SKY_MAX = 9;
/** Two nebulae belong together once they overlap by this much. */
const CLUSTER_OVERLAP = 0.35;
/** An adopted candidate contracts to a point over this long. */
const CONDENSE_MS = 700;
/**
 * The traveler (v8). Pressing toward a neighbouring column, the companion
 * turns and glides ahead of the world over this long, easing in…
 */
const TRAVEL_LEAD_MS = 450;
/** …and the world sets off this much later, so the character visibly leads. */
const TRAVEL_LAG_MS = 140;
/** How far ahead of centre the traveler rides, as a fraction of the viewport. */
const TRAVEL_LEAD_X = 0.21;
/**
 * The world's slide is a FIXED cubic-out, not a physical throw: travel is a
 * camera move with a known destination. Ninety percent of the distance is
 * crossed by ~500ms in (lag included), and arrival COMMITS the moment the
 * world is within a few pixels — the asymptotic tail is not worth a second
 * of dead input, which is exactly what read as "stuck".
 */
const TRAVEL_MS = 670;
/** Arrival commits inside this distance; the tail is finished by the snap. */
const TRAVEL_SNAP = 8;
/**
 * How far the companion leads during a HELD drag at the commit distance —
 * it sets off with the first centimetres of the pull, walking toward where
 * the finger says the page is going. Also the walk normaliser: at this much
 * offset the bob has fully quickened and the lean is full.
 */
const DRAG_LEAD_PX = 90;
/**
 * THE COMPANION ANSWERS ALL FOUR DIRECTIONS.
 *
 * It used to notice only the horizontal axis — it turned and walked when you
 * travelled between walls, and turned when you scrubbed the dial — while the
 * vertical axis, which is how you reach the sky and the field and therefore
 * the one people use far more, produced nothing from it at all. A character
 * that notices half the world is a character you stop believing in.
 *
 * The response is the same shape as the horizontal one, because it is the
 * same idea: it LEADS. Rising, it lifts ahead of the camera and stretches a
 * little, and its bob lengthens as though buoyant; descending, it settles,
 * compresses, and the bob quickens. It looks where the world is going — the
 * eyes are dots on a turning form, so a vertical look is a LATITUDE offset
 * exactly as the yaw is a longitude one, and it foreshortens by the same
 * rule. At each resting place it turns its attention to what is there: up in
 * the sky, level at headquarters, down into the field.
 *
 * The two axes are independent terms on one body — a longitude and a
 * latitude — so a diagonal composes instead of fighting.
 */
const PITCH_LEAD_PX = 26;
/** How far the eyes travel on the form for a full-speed vertical move. */
const PITCH_LOOK = 0.5;
/** Buoyant going up, settled coming down: a few percent, never a rocket. */
const PITCH_STRETCH = 0.05;
/** The camera speed at which all of the above is fully expressed. */
const PITCH_FULL = 1400;

/**
 * SATELLITES. A candidate's evidence ORBITS it — real orbs, drawn with the
 * field's own baked sprites, at this fraction of a field orb's radius so they
 * read as REFERENCES to a memory rather than duplicates of it: the same memory
 * shown as evidence, not a copy.
 */
const SAT_R = 0.72;
/**
 * At most this many memories orbit one candidate. Past that the highest
 * resonances stay and the rest are simply not drawn — a cloud is a claim, not
 * an inventory, and "and N more" would put a number on the page.
 */
const SAT_MAX = 8;
/**
 * Air between a satellite and the name of whoever saved it — and the least the
 * name is ever left from the edge of the sky, which clips.
 */
const SAT_SAY_GAP = 12;
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
 * Passing BEHIND its candidate a satellite dims by this much and draws before
 * the cloud's blooms; in front it draws after them. Occlusion only — nothing
 * that exists ever pops out of existence.
 */
const ORBIT_BEHIND = 0.18;
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
const FOCUS_POP = 0.06;
/** Everything that is not the subject sinks to this alpha, body and sentence. */
const FOCUS_DIM = 0.22;
/** The emergence: out to the ellipse over this long… */
const EMERGE_MS = 420;
/** …one satellite after another, in evidence order. */
const EMERGE_STAGGER = 40;
/** Retraction is the same motion run backwards, and quicker. */
const RETRACT_MS = 260;
const RETRACT_STAGGER = 20;
/** A satellite leaves (and returns to) the sentence at this fraction of size. */
const EMERGE_SCALE = 0.4;
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
const NEB_CORE = 0.62;
/** Air between one candidate's words and the next candidate's anything. */
const SKY_GAP = 14;
/**
 * THE MOST OF THE VIEWPORT ONE CANDIDATE'S SYSTEM MAY CLAIM.
 *
 * clampHome parks a candidate by a pad the size of its whole system, so the
 * range it may be parked in is what is left over — and at half the viewport
 * that range is empty. These are the pads' ceiling, and therefore also the
 * ceiling measureNeb cuts an orbit down to: an orbit wider than a pad may be
 * has nowhere at all to sit, and runs off both edges every revolution.
 */
const SKY_PAD_X = 0.45;
const SKY_PAD_Y = 0.42;
/** The least of the viewport an orbit is ever left clear of an edge. */
const SKY_EDGE = 12;

/**
 * Sky layout persistence, tier ONE: the personal sky's nebula positions,
 * local to this browser, written through on drag end and pruned to the
 * candidates that still exist. Tier TWO is SHARED per-room persistence,
 * which needs a backend endpoint (coming separately) — the storage shape
 * {candidateId: {x, y}} is chosen so the server version can adopt it
 * unchanged.
 */
const SKY_LAYOUT_KEY = "waka.sky.layout.v1";

function readSkyLayout(): Record<string, { x: number; y: number }> {
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

function writeSkyLayout(layout: Record<string, { x: number; y: number }>): void {
  try {
    window.localStorage.setItem(SKY_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable (private mode, quota): the sky still works */
  }
}

// ---------------------------------------------------------------------------
// THE SPECIES: one companion, many beings
// ---------------------------------------------------------------------------

/**
 * A companion is A DROP OF LIGHT THAT CAME TO REST, LIT BY THE SAME MOON AS
 * EVERYTHING ELSE. Nine things are invariant across every being in the world,
 * and each one is load-bearing for a law rather than a style choice:
 *
 *   1. ONE SILHOUETTE TOPOLOGY — one closed outline, four bezier segments, in
 *      the order bodyPath traces them. Dome above, flat-ish base below, no
 *      neck, no limbs, no appendage that is not a nub. Individuals move the
 *      control points inside a bounded envelope; nobody adds or removes one.
 *      This is what makes a stranger's companion legible as the same KIND of
 *      thing as yours inside the first hundred milliseconds.
 *   2. THE LATHE/PLANET MODEL — lathe-symmetric about a vertical axis; yaw is
 *      a longitude, features travel across the surface, the silhouette never
 *      scales and features are OCCLUDED rather than hidden. Two rotation
 *      physics in one world is two worlds.
 *   3. ONE KEY — KEY_X / KEY_Y. No companion carries its own light source.
 *   4. ONE RAMP — bodyTier off ramp.bodyLit/bodyShade. Two beings at the same
 *      aliveness are the same colour at the same luminance. Temperature and
 *      luminance mean aliveness and NOTHING else. This is the hard one, and it
 *      is the one that makes the whole system safe.
 *   5. ONE MASS — w·h is constant at a given charSize, whatever the aspect. A
 *      wide being is not a big being: size would read as rank, and agents are
 *      not ranked.
 *   6. THE AURA, ENTIRELY — four layers, the radius law and the alpha law. A
 *      three-layer aura reads as a dimmer being, and dimmer means less alive.
 *      The aura is the aliveness channel wearing a halo; identity may not
 *      touch it. (Its drift RATE may vary: that is rhythm, not light.)
 *   7. TWO EYES, dark dots on the equator, symmetric about the meridian. No
 *      whites, no pupils, no brows, no mouth. A blink is a vertical squash.
 *   8. TWO NUBS at longitude ±π/2, radius gated on inspiration. The nub radius
 *      IS the light channel expressed as body language; identity does not get
 *      to scale it.
 *   9. ONE EMULSION — the same grain tile, the same overlay, the same dither.
 *      Film grain belongs to the lens, not to the world.
 *
 * What an individual gets is two channels and only two: FORM (baked, and so it
 * survives reduced motion) and RHYTHM (per-frame constants, silent under it).
 * Hue is forbidden and temperature is spoken for.
 */
export interface Being {
  /** width / height. Solved against mass, so it changes shape, never size. */
  aspect: number;
  /** the dome's overshoot pair; the differential is held at 0.04 */
  dome: [number, number];
  /** the base inset: table, settle, rocker */
  base: number;
  /** shoulder bulge + base contact only, signed. The APEX tilt stays canonical:
      an off-centre apex is the term that exposes the planet fiction under yaw,
      and a lean that survives a 180° turn is a visible lie. */
  asym: number;
  eyeR: number;
  eyeLon: number;
  eyeLat: number;
  nubLat: number;
  bobRate: number;
  blinkMs: number;
  blinkDouble: boolean;
  sqPhase: number;
  sqDepth: number;
  auraDrift: number;
  /** anti-cloning texture, not an identity signal */
  grainPhase: [number, number];
}

/**
 * ONE namespace, VERSIONED. Bumping the version re-rolls every being in the
 * world — that is a migration, not an edit. An agent whose face changed is a
 * stranger, and nothing in this world turns into a stranger.
 */
const BEING_NS = "waka/being/1";

const pick = <T,>(id: string, salt: string, ladder: readonly T[]): T =>
  ladder[mix32(hashStr(`${BEING_NS}/${salt}/${id}`)) % ladder.length];

const unit = (id: string, salt: string): number =>
  mix32(hashStr(`${BEING_NS}/${salt}/${id}`)) / 4294967296;

/**
 * THE OWNER'S BEING — exactly today's numbers, to the digit. It is not merely
 * the default: the aspect and eye-height ladders below have these two values
 * PUNCHED OUT, so no hash can ever produce them. The owner's companion is the
 * only being in the world that is the species median on both of the axes the
 * eye reads first, and standing beside any agent its face sits at a height no
 * agent's face can occupy. That is a still-frame mark, achieved structurally
 * rather than by a check.
 */
const OWNER_BEING: Being = {
  aspect: 1.15,
  dome: [0.16, 0.2],
  base: 0.2,
  asym: 0.02,
  eyeR: 0.038,
  eyeLon: 0.5,
  eyeLat: -0.06,
  nubLat: 0.24,
  bobRate: 1.4,
  blinkMs: 3400,
  blinkDouble: false,
  sqPhase: 1.5,
  sqDepth: 0.022,
  auraDrift: 1,
  grainPhase: [0, 0],
};

/**
 * A being, drawn from an id and from nothing else.
 *
 * DO NOT SALT BY WALL OWNER. `${ownerId}/${agentId}` would give the same agent
 * a different face for each person it works for. An agent is an entity, not a
 * rendering of a relationship; it should be itself everywhere.
 *
 * FORM IS ARBITRARY BUT STABLE, LIKE A FACE — it does not encode what an agent
 * DOES. Function-shaped form is hue-per-category wearing a different hat: it
 * needs a legend, and a legend is jargon in picture form. It is also not
 * stable, and this is a memory product — an agent that gets re-scoped would
 * change shape, and a being that changes shape is a being that popped out of
 * existence and was replaced. Lookup is what the wall's NAME is for; a face is
 * for recognition, which text is bad at.
 */
function agentBeing(id: string): Being {
  const sq = pick(id, "sq", [
    [0.9, 0.029], /* heavy landing */
    [1.5, 0.022], /* canonical */
    [2.2, 0.016], /* buoyant lead */
  ] as const);
  return {
    aspect: pick(id, "asp", [1.02, 1.08, 1.23, 1.32]), /* 1.15 reserved */
    dome: pick(id, "dome", [
      [0.1, 0.14],
      [0.16, 0.2],
      [0.22, 0.26],
      [0.28, 0.32],
    ] as const),
    base: pick(id, "base", [0.28, 0.2, 0.11]),
    asym: pick(id, "asym", [-0.06, -0.02, 0.02, 0.06]),
    eyeR: pick(id, "eyeR", [0.03, 0.038, 0.047]),
    eyeLon: pick(id, "eyeL", [0.38, 0.5, 0.63]),
    eyeLat: pick(id, "eyeH", [-0.15, -0.11, -0.01, 0.03]), /* -0.06 reserved */
    nubLat: pick(id, "nub", [0.18, 0.24, 0.3]),
    bobRate: pick(id, "bob", [1.12, 1.4, 1.58, 1.76]),
    blinkMs: pick(id, "blkT", [2900, 3400, 4100]),
    blinkDouble: pick(id, "blkD", [false, true]),
    sqPhase: sq[0],
    sqDepth: sq[1],
    auraDrift: pick(id, "aura", [0.78, 1, 1.28]),
    grainPhase: [
      unit(id, "gx") * GRAIN_TILE * GRAIN_PX,
      unit(id, "gy") * GRAIN_TILE * GRAIN_PX,
    ],
  };
}

function parseColor(input: string): [number, number, number] {
  const s = input.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [128, 128, 128];
}

/* rgbToHsl went with the tint pairs: it existed to pick the lighter end of a
   gradient pair, and there are no pairs left to pick between. */



/**
 * Mark passages INSIDE the memory rather than lifting them out of it.
 *
 * A spark is not a section — it is a sentence of the text that carried the
 * reading, and the honest way to show that is the way a person marks their own
 * book: a line under the words where they sit. Two tiers: `source` is the
 * passage that fed a top-of-mind (a wash and a line), `spark` is a passage the
 * judge picked out (a line alone).
 *
 * Matching normalises whitespace and NEVER approximates: a snippet that does
 * not appear verbatim is simply not marked, because a highlight in the wrong
 * place is a lie about what was said.
 */
function markPassages(
  text: string,
  marks: Array<{ text: string; tier: "source" | "spark" }>,
): JSX.Element {
  /* a whitespace-collapsed copy, remembering where each character came from */
  const norm: string[] = [];
  const at: number[] = [];
  let wasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
      if (wasSpace || norm.length === 0) continue;
      norm.push(" ");
      at.push(i);
      wasSpace = true;
    } else {
      norm.push(ch);
      at.push(i);
      wasSpace = false;
    }
  }
  const hay = norm.join("");
  const spans: Array<{ a: number; b: number; tier: "source" | "spark" }> = [];
  /* the stronger tier claims its ground first */
  const ordered = [...marks].sort((x, y) => (x.tier === y.tier ? 0 : x.tier === "source" ? -1 : 1));
  for (const m of ordered) {
    const needle = m.text.replace(/\s+/g, " ").trim();
    if (needle.length < 6) continue;
    const hit = hay.indexOf(needle);
    if (hit < 0) continue;
    const a = at[hit];
    const b = (at[hit + needle.length - 1] ?? a) + 1;
    if (spans.some((sp) => a < sp.b && b > sp.a)) continue; /* no double marks */
    spans.push({ a, b, tier: m.tier });
  }
  if (spans.length === 0) return <>{text}</>;
  spans.sort((x, y) => x.a - y.a);
  const out: Array<JSX.Element | string> = [];
  let cursor = 0;
  spans.forEach((sp, i) => {
    if (sp.a > cursor) out.push(text.slice(cursor, sp.a));
    out.push(
      <mark key={`m${i}`} className={`jar-mark jar-mark--${sp.tier}`}>
        {text.slice(sp.a, sp.b)}
      </mark>,
    );
    cursor = sp.b;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Ball model + world geometry
// ---------------------------------------------------------------------------

interface Ball {
  id: string;
  capturedMs: number;
  updatedMs: number;
  reflections: number;
  hasNotes: boolean;
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
function scatterSeed(id: string): number[] {
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
interface SignalSeed {
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
  /** True when a pattern citing it is shared to a room. Captures themselves
      never cross an account boundary — only the patterns above them do. */
  inRoom: boolean;
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
interface BornSeed extends SignalSeed {
  /**
   * The saved-signal id the server gave it, once the keep came back. Until
   * then there is nothing to fetch and nothing missing: you typed every word
   * of it, so the reading panel already has the whole thing.
   */
  sigId?: string;
}

/**
 * A CAPTURE JOINED TO THE SKY ABOVE IT.
 *
 * Under the canon a memory carries no meaning of its own — no score, no theme,
 * no room. What it is FOR is a fact about the patterns that cite it, so this
 * is where the two layers meet, and it is the only place they do.
 *
 * A memory nothing cites gets `cited: false`, no quote and no statements, and
 * the field draws it exactly that honestly: present, dated, its own words, and
 * nothing claimed on its behalf.
 */
function seedOf(
  c: Inspiration,
  citations: Map<string, Evidence[]>,
  patternById: Map<string, Signal>,
): SignalSeed {
  const cites = citations.get(c.id) ?? [];
  const above = cites
    .map((e) => patternById.get(e.signalId))
    .filter((p): p is Signal => Boolean(p));
  return {
    id: c.id,
    capturedMs: c.capturedMs,
    updatedMs: c.updatedMs,
    reflectionCount: c.reflectionCount,
    textPreview: c.preview,
    kind: c.kind,
    cited: cites.length > 0,
    /* A memory is never in a room. What can be is a PATTERN resting on it —
       so this says "something you shared out loud stands on this", which is
       true, without the memory itself having gone anywhere. */
    inRoom: above.some((p) => p.sharedGroupIds.length > 0),
    quote: cites.find((e) => e.quote)?.quote ?? null,
    terms: above.map((p) => p.statement),
  };
}

function makeBall(s: SignalSeed, agentId = ""): Ball {
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
    frontier: false,
    hasGroup: s.inRoom,
    textPreview: s.textPreview,
    kind: s.kind,
    quote: s.quote ?? null,
    terms: s.terms,
    r,
    rBase: r,
    sizeIdx: r < 26.5 ? 0 : r < 29.8 ? 1 : 2,
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
function bornBall(seed: BornSeed): Ball {
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
    frontier: false,
    hasGroup: false,
    textPreview: s.textPreview,
    kind: s.kind,
    quote: s.quote,
    terms: [],
    r,
    rBase: r,
    sizeIdx: r < 26.5 ? 0 : r < 29.8 ? 1 : 2,
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

// ---------------------------------------------------------------------------
// Rooms: side-by-side jars on the horizontal axis (v8)
// ---------------------------------------------------------------------------

/** One deduped evidence signal: a save this room's readings cited. */
interface RoomEvidence {
  signalId: string;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  authorUserId: string;
  authorName: string;
  /** Every reading of the room's that cited it — the panel's links sentence. */
  citedBy: string[];
}

/** Everything a room needs before it is allowed to wake. Cached per session. */
interface RoomData {
  evidence: RoomEvidence[];
  top: ApiGroupTopOfMind | null;
}

/**
 * A ROOM IS A WALL OF STATEMENTS, AND EVERYTHING ELSE STAYS HOME.
 *
 * This used to build a room's orbs out of the evidence its readings cited —
 * other people's raw memories, previewed and quoted. The canon closed that:
 * sharing is a per-signal choice, an inspiration never crosses an account
 * boundary, and "a member may see that someone's shared signal fed an entry,
 * never which one".
 *
 * So a room's orbs are the shared PATTERNS themselves. Each carries whose it
 * is, and what it says. There is no quote, because the words behind it were
 * never sent and inventing one here would be the leak the canon forbids.
 * `citedBy` names the readings this member contributed to — attribution by
 * person, which is the finest grain the room is allowed to know.
 */
function roomWallOrbs(wall: ApiGroupWallSignal[], top: ApiGroupTopOfMind | null): RoomEvidence[] {
  const fedBy = new Map<string, string[]>();
  for (const entry of top?.entries ?? []) {
    for (const c of entry.contributors) {
      const got = fedBy.get(c.profileId);
      if (got) {
        if (!got.includes(entry.body)) got.push(entry.body);
      } else fedBy.set(c.profileId, [entry.body]);
    }
  }
  const seen = new Map<string, RoomEvidence>();
  for (const s of wall) {
    if (seen.has(s.signalId)) continue;
    seen.set(s.signalId, {
      signalId: s.signalId,
      textPreview: s.statement,
      quote: null,
      kind: null,
      createdMs: Date.parse(s.sharedAt) || Date.now(),
      authorUserId: s.ownerProfileId,
      authorName: s.ownerName,
      citedBy: fedBy.get(s.ownerProfileId) ?? [],
    });
  }
  return [...seen.values()];
}

/**
 * A room orb: the same ball, built from an evidence preview. Aliveness decays
 * from `createdAt` on the personal jar's own half-life; the reflection and
 * note boosts are omitted because the payload cannot know them. Tint hashes
 * the signal id — evidence previews carry no theme terms.
 */
function makeRoomBall(
  ev: RoomEvidence,
  groupId: string,
  colIdx: number,
  viewerId: string | null,
): Ball {
  const r = 24 + ((hashStr(ev.signalId + "r") % 1000) / 1000) * 8;
  const b: Ball = {
    id: `${groupId}:${ev.signalId}`,
    capturedMs: ev.createdMs,
    updatedMs: ev.createdMs,
    reflections: 0,
    hasNotes: false,
    frontier: false,
    hasGroup: false,
    textPreview: ev.textPreview,
    kind: ev.kind,
    quote: ev.quote,
    terms: [],
    r,
    rBase: r,
    sizeIdx: r < 26.5 ? 0 : r < 29.8 ? 1 : 2,
    frac: (hashStr(ev.signalId) % 1000) / 1000,
    scat: scatterSeed(ev.signalId),
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
    active: false,
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
    col: colIdx,
    sigId: ev.signalId,
    authorName: ev.authorName,
    own: viewerId !== null && ev.authorUserId === viewerId,
    citedBy: ev.citedBy,
    origin: "human",
    lens: 0,
  };
  b.ampBaseX = b.ampX;
  b.ampBaseY = b.ampY;
  colorBall(b, Date.now());
  return b;
}

/**
 * What the room's HQ will say, resolved before the room may wake.
 *
 * A group's artifact is the same one-artifact shape as a person's: entries,
 * pinned or in order, changed together through proposals. The room's poster is
 * its lead entry — pinned first, otherwise the top of the order — and there is
 * no generated stand-in when there is none.
 */
function deriveRoomChrome(
  name: string,
  top: ApiGroupTopOfMind,
  openProposalMs: number | null,
  evidence: RoomEvidence[],
  company: string | null,
): WallChrome {
  const lead = top.entries.find((e) => e.pinnedAt) ?? top.entries[0] ?? null;
  const ambition = lead?.body ?? null;
  return {
    eyebrow: company ? `${name} \u00b7 ${company}` : name,
    text: ambition,
    awayFrom: null,
    formingAlt: ambition ? null : "Forming — nothing read together yet",
    asOf: null,
    /* A room forms through proposals, not through patterns overhead: members'
       patterns stay on their own walls, so an open proposal is the only thing
       a room has that is on its way to becoming what it believes. */
    forming: formingWords(Date.now(), openProposalMs, null),
    empty: evidence.length === 0,
    prevText: null,
  };
}

/**
 * WHAT AN AGENT'S HEADQUARTERS SAYS, AT A MOMENT.
 *
 * The dial is the history and there is no second surface for it, so this takes
 * a time: wind back and the poster becomes the identity the agent held then,
 * and an agent that rewrites itself weekly STUTTERS under your thumb while one
 * that has held a line for a season is a long quiet slide with one change in
 * it. Frequency of change becomes a kinetic quality rather than a version list.
 *
 * There is no generated placeholder here and there never will be. Fabricating
 * an ambition for an agent that has not worked yet is the worst thing this
 * product could ship: it would teach the reader that the poster is generated
 * copy, and destroy the credibility of every wall they read afterwards.
 */
function deriveAgentChrome(a: AgentBundle, T: number, nowMs: number): WallChrome {
  const at = (t: number): ApiAgentDirectionReading | null => {
    let best: ApiAgentDirectionReading | null = null;
    for (const h of a.direction.history) {
      const ms = Date.parse(h.createdAt) || 0;
      if (ms <= t && (!best || ms > (Date.parse(best.createdAt) || 0))) best = h;
    }
    return best;
  };
  const held = at(T);
  const heldNow = at(nowMs);
  const notes = a.topOfMind.notes.map((n) => ({
    isProvisional: n.isProvisional === true,
    createdMs: Date.parse(n.createdAt) || nowMs,
  }));
  const empty = a.captures.length === 0;
  return {
    eyebrow: a.agent.name,
    text: held?.ambition ?? null,
    awayFrom: held?.awayFrom ?? null,
    /* An agent that has not worked yet says so, in its own voice, once. */
    formingAlt: held ? null : "I haven’t formed anything yet",
    asOf:
      held && heldNow && held.ambition !== heldNow.ambition && nowMs - T > 60_000
        ? monthTag(T)
        : null,
    forming: formingWords(T, null, notes),
    empty,
    prevText: null,
  };
}

/**
 * THE POSTER, AND WHICH OF ITS WORDS ARE NEW.
 *
 * Every poster used to replay every word on every change, which is beautiful
 * once and useless afterwards: scrubbing a wall's history was a stream of
 * identical assemblies, and the one question a person actually has about a
 * self-description — HAS THIS BEEN THE SAME THING? — had no answer on screen.
 *
 * So a word that survived the rewrite stays lit and still, and only new words
 * arrive. The spine of an identity is the text that does not move; the drift
 * is the flicker. That is a drift readout with no numerals, no timeline and no
 * diff view, and it answers the question better than a version list could.
 *
 * Matching is a multiset, not a diff: a word that was in the previous sentence
 * is a word that survived, wherever it moved to. Order changes are not drift.
 *
 * Reduced motion keeps the distinction — it just spends the world's own
 * channel on it instead of movement (see jar.css): a new word arrives as a
 * step in luminance, a carried one is simply already lit.
 */
function posterWords(text: string, prev: string | null): JSX.Element[] {
  const words = text.split(/\s+/);
  const pool = new Map<string, number>();
  if (prev) for (const w of prev.split(/\s+/)) pool.set(w, (pool.get(w) ?? 0) + 1);
  let arriving = 0;
  return words.map((word, i) => {
    const have = pool.get(word) ?? 0;
    const carried = have > 0;
    if (carried) pool.set(word, have - 1);
    return (
      /* the space lives OUTSIDE the inline-block, or it collapses and the
         whole ambition runs together */
      <Fragment key={`${i}-${word}`}>
        <span
          className={carried ? "jar-word jar-word--held" : "jar-word"}
          style={carried ? undefined : { animationDelay: `${arriving++ * 28}ms` }}
        >
          {word}
        </span>{" "}
      </Fragment>
    );
  });
}

// ---------------------------------------------------------------------------
// Walls: the horizontal axis, and what stands on it (v10)
// ---------------------------------------------------------------------------

/**
 * THE AXIS IS SEMANTIC NOW.
 *
 *     ← your agents      |   WAKA (you)   |   rooms (people) →
 *
 * A "room" was only ever the first kind of wall; an agent's profile is the
 * second. Everything already written — travel and its choreography, the wake
 * on arrival, the peek invariant, the panels — is kind-agnostic from here, and
 * direction now MEANS kind, which is most of the wayfinding for free.
 */
type WallKind = "self" | "room" | "agent";

interface Wall {
  kind: WallKind;
  /** the group id, the agent id, or "" for the owner's own wall */
  id: string;
  /** the eyebrow, and the name a neighbouring wall's edge says */
  name: string;
  /** where it stands: agents negative, the owner at the origin, rooms positive */
  col: number;
}

const wallKey = (w: Wall): string => `${w.kind}:${w.id}`;
/**
 * A ROOM IS THE ONLY WALL WITHOUT A SKY OR A DIAL, and that carve-out is not
 * inherited by anything: an agent's own history IS the dial (there is no second
 * surface for it), and the things it is still forming are its sky.
 */
/**
 * EVERY WALL HAS A SKY, INCLUDING A ROOM'S.
 *
 * Rooms were carved out of this when a room had nothing to put up there. Under
 * the canon they do: members share SIGNALS to a room, and what hangs on its
 * wall is exactly that — statements, other people's, not yet agreed. That is
 * the definition of a sky. Without one those shared statements have nowhere to
 * live at all: the field is always your own memories by ruling, and the room's
 * headquarters holds only what the room has already settled on.
 *
 * So the shape is the same everywhere, which is the point: what is forming
 * above, what is held in the middle, your own memories below. In a room the
 * top is what people have said out loud and the middle is what you have agreed.
 */
const hasSky = (k: WallKind): boolean => k === "self" || k === "agent" || k === "room";
/* The dial stays out of a room. It winds ONE archive through time, and a room
   is several people's statements arriving on their own clocks — there is no
   single history there to scrub. */
const hasDial = (k: WallKind): boolean => k !== "room";

// ---------------------------------------------------------------------------
// MOCK AGENTS — replaced by GET /api/agents when that lands
// ---------------------------------------------------------------------------

/**
 * The agents, exactly as the endpoints will hand them over. When the backend
 * lands this becomes the four fetches and everything downstream is unchanged.
 */
/**
 * THE WALLS TO THE LEFT — real profiles first, and mocks only in their absence.
 *
 * The canon made agent separation structural: `GET /api/profiles` returns every
 * profile this account owns, and each agent profile owns a full inspiration →
 * signal → top-of-mind stack of its own. So the IDENTITY of an agent wall is
 * real from today — its name, its kind, when it came into being.
 *
 * ITS CONTENTS ARE NOT REACHABLE YET, and this is the one gap worth naming:
 * `/inspirations`, `/signals` and `/top-of-mind` are each scoped to the
 * session's OWN bound profile, with no way to ask for another's. The canon says
 * the human is admin of every profile in their account and can see everything
 * in it; the server has not grown the parameter for that yet. Until it does, a
 * real agent wall stands there with an honest empty headquarters — which is
 * exactly what a newly created agent looks like anyway, and is never filled in
 * with something invented.
 *
 * The mocks are the founder's own two from the meeting, and they appear ONLY
 * in dev AND ONLY when the account has no real agent profiles. Standing an
 * invented wall beside a real one is the same class of mistake as mixing
 * invented memories into a real archive, and it is not made twice.
 */
async function loadAgentWalls(): Promise<AgentBundle[]> {
  const real = await fetchProfiles()
    .then((rows) => rows.filter((p) => p.type === "agent"))
    .catch(() => []);
  if (real.length > 0) {
    /* ITS OWN MEMORY, NOT A VIEW OF MINE.
       Every layer endpoint takes `?profile=`, and a human-profile session is
       admin over every profile in its account — so an agent's wall is built
       from the agent's OWN captures, its OWN patterns and its OWN top of mind.
       The database has kept them separate all along; nothing is merged with
       the owner's, and a wall whose fetch fails stands empty rather than
       borrowing anything to fill itself. */
    return Promise.all(
      real.map(async (p) => {
        const [captures, patterns, tom] = await Promise.all([
          loadInspirations(p.id).catch(() => [] as Inspiration[]),
          loadSignals(p.id).catch(() => [] as Signal[]),
          loadTopOfMind(p.id).catch(() => null),
        ]);
        const entries = (tom?.entries ?? []).slice().sort((a, b) => a.createdMs - b.createdMs);
        const lead = tom?.entries.find((e) => e.pinned) ?? tom?.entries[0] ?? null;
        const iso = (ms: number) => new Date(ms).toISOString();
        const reading = (e: Entry) => ({
          ambition: e.body,
          awayFrom: null,
          /* what the claim rests on: the patterns it cites, which is what an
             entry cites under the canon — never straight down at raw memories */
          groundedIn: e.citedSignals.map((c) => c.id),
          createdAt: iso(e.createdMs),
        });
        return {
          agent: {
            id: p.id,
            name: p.name,
            kind: "agent" as const,
            /* the profile row carries no creation time; its oldest memory is
               the honest stand-in, and an agent that has kept nothing has no
               date because it has no history yet */
            createdAt: captures.length
              ? iso(Math.min(...captures.map((c) => c.capturedMs)))
              : "",
          },
          /* THE DIAL NEEDS REAL DATES OR IT SCRUBS NOTHING. Each entry of the
             board is a moment this agent said something about itself, so the
             board's entries ARE its history. */
          direction: { current: lead ? reading(lead) : null, history: entries.map(reading) },
          /* its sky: what it is still forming and has not adopted */
          topOfMind: {
            notes: patterns
              .filter((s) => s.status === "emerging")
              .map((s) => ({
                id: s.id,
                title: s.statement,
                isProvisional: true,
                createdAt: iso(s.createdMs),
                evidenceSignalIds: [],
              })),
          },
          captures: captures.map((c) => ({
            id: c.id,
            agentId: p.id,
            /* the canon's own distinction: content the agent initiated versus
               content a person relayed through it */
            origin: c.source === "agent" ? ("agent" as const) : ("human" as const),
            textPreview: c.preview,
            /* no pattern has quoted it from here: the quote belongs to the
               evidence row, which this wall does not fetch */
            quote: null,
            kind: c.kind,
            capturedAt: iso(c.capturedMs),
            updatedAt: iso(c.updatedMs),
            producedBy: null,
          })),
        };
      }),
    );
  }
  if (!MOCK_AGENTS) return [];
  return MOCK_AGENT_BUNDLES;
}

/**
 * A candidate for the ambition: something that has formed but has not been
 * adopted. Either the room's pending PROPOSAL (a whole rewrite, adoptable) or
 * a provisional top-of-mind reading (a machine claim, not adoptable yet), or
 * a DRAFT the person assembled up in the sky.
 */
interface Candidate {
  id: string;
  kind: "proposal" | "reading" | "draft";
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
 * One memory a candidate is made of.
 *
 * A PERSONAL candidate resolves its evidence against the captures already
 * loaded and SKIPS anything that is not there — an id with nothing behind it
 * is not a memory, and inventing one would be a lie about what was saved. ROOM
 * evidence stands on its own: it arrives carrying its author and its words,
 * exactly as a room's own orbs do, so a satellite can say whose memory it is
 * without ever fetching another member's signal.
 */
interface EvidenceRef {
  signalId: string;
  /** The room it came from, when it came from one. */
  groupId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  /**
   * WHY THIS WAS WORTH KEEPING, in one short phrase — the whisper an agent's
   * satellite carries instead of an author's name. "얘가 이걸 만든 이유가
   * 이거다", rendered with the element that already exists.
   */
  why?: string | null;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  /** False when the payload named no date and `createdMs` is only a reference
      for the light — the panel then prints who, and no when. */
  dated: boolean;
  resonance: number;
}

/** One memory, once, however many candidates cited it — strongest first. */
function dedupeEvidence(all: EvidenceRef[]): EvidenceRef[] {
  const seen = new Map<string, EvidenceRef>();
  for (const e of all) {
    const key = e.groupId ? `${e.groupId}:${e.signalId}` : e.signalId;
    const got = seen.get(key);
    if (!got || e.resonance > got.resonance) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => b.resonance - a.resonance).slice(0, SAT_MAX);
}

/**
 * A SATELLITE: one evidence memory, in orbit around the candidate it is
 * evidence FOR. It is a reference, never a second memory — the very sprite the
 * field draws, at SAT_R of the radius, so provenance is legible rather than
 * implied. (The same principle the peek row already obeys downstairs: the row
 * IS the ambition's evidence.)
 */
interface Sat {
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
interface Neb {
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
  /** Where its LIGHT is. It trails the body, which is the only thing with
      weight here — the cloud itself is exactly where the finger put it. */
  haloX: number;
  haloY: number;
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

interface World {
  wallL: number;
  wallR: number;
  worldH: number;
  /** The deepest the camera goes: standing in the jar. */
  maxCam: number;
  /** The highest the camera goes: standing in the sky, one viewport above HQ. */
  minCam: number;
  /** The peek line: the top edge of the highest orb in the field. */
  fieldTop: number;
  /** The deepest an orb's centre may sit, clear of the dial. */
  fieldBottom: number;
}

/**
 * The page is THREE full viewports in one continuous scroll: section S (camera
 * −vh) is the sky where ambitions are still forming, section A (camera 0) is
 * headquarters, section B (camera +vh) is the jar owning the screen. Nothing
 * rests in between — the camera always snaps to one of the three, and a flick
 * can never jump two of them.
 *
 * HQ keeps world coordinate zero, so the field, the peek and every piece of
 * jar math below is untouched by the sky's arrival.
 *
 * There is no floor and no gravity. The orbs FLOAT in a field whose extent is
 * declared here, and their homes are assigned into it (assignHomes) so the
 * peek is solved directly rather than emerging from a pile settling.
 */
function computeWorld(vw: number, vh: number, dialH: number): World {
  const interior = Math.min(vw - 24, 560);
  const wallL = (vw - interior) / 2;
  const wallR = vw - wallL;
  const worldH = vh * 2;
  return {
    wallL,
    wallR,
    worldH,
    maxCam: vh,
    minCam: -vh,
    /* The peek line sits clear of the time dial, which is fixed to the
       bottom of the viewport in both sections — otherwise the topmost orbs
       and the dial occupy the same strip. */
    fieldTop: vh - dialH - PEEK,
    /* AND THE FIELD ENDS EXACTLY WHERE THE DIAL BEGINS — not forty pixels of
       air above it. The reserve is a real, measured piece of chrome, so it is
       the only thing the field owes the bottom of the screen. */
    fieldBottom: worldH - dialH,
  };
}

// ---------------------------------------------------------------------------
// Palette + sprites (rastered once at load and on DPR change, never per frame)
// ---------------------------------------------------------------------------


interface Palette {
  dpr: number;
  ramp: Ramp;
  /** The dormant colour as CSS — a photo orb desaturates toward it. */
  gray: string;
  /**
   * [sizeBucket][alivenessTier] — the disc itself. There is no tint axis: two
   * memories at the same aliveness are the same light, whatever they are about.
   */
  orbs: HTMLCanvasElement[][];
  /**
   * [hue][size][tier], baked on first sight rather than up front. Five hues x
   * nine sizes x five tiers is 225 more canvases, and most sessions never
   * enter a room with four other people in it — so a hue costs nothing until
   * somebody's memory is actually on the ground in front of you.
   */
  hued: Map<string, HTMLCanvasElement[][]>;
  /** [sizeBucket][alivenessTier] — the diffuse outer bloom, additive. */
  blooms: HTMLCanvasElement[][];
  /** The second, much wider and dimmer ring the focused orb wears. */
  aura: HTMLCanvasElement;
  /**
   * The companion's four aura layers. They are baked separately from the orb
   * blooms so each can carry a slightly different falloff curve — four
   * identical curves stacked at four radii is exactly how faint banding
   * becomes visible banding.
   */
  auraLayers: HTMLCanvasElement[];
  /** One tiny point; motes and background sparkles share it. */
  mote: HTMLCanvasElement;
  /** The lit seam that travels across the companion as it turns. */
  seam: HTMLCanvasElement;
  /** [variant] — a forming ambition's body, up in the sky. */
  nebulae: HTMLCanvasElement[];
  /**
   * THE FILM GRAIN LIVES ON A DOM LAYER, NOT IN THE CANVAS.
   *
   * `overlay` blends against its BACKDROP, and the canvas is transparent
   * wherever nothing was drawn — where alpha is zero the blend degenerates to
   * source-over, so a grain tile centred on mid-grey was laying a flat 7%
   * grey sheet over the whole frame, every frame. The image had no true black
   * anywhere and read as milky: the pass did the exact opposite of what its
   * own comment said it did.
   *
   * On a DOM layer above the canvas the backdrop is opaque, so overlay runs
   * its real response curve (peaking in the midtones, leaving black black);
   * the tile is sized in CSS pixels rather than device pixels; it covers the
   * TYPE as well as the world, so the poster wears the same emulsion as the
   * frame; and it costs no per-frame work at all. The grain belongs to the
   * LENS, not to the world — which is also why it must not ride the camera.
   */
  grainUrl: string | null;
  /** Baked once, stretched over the viewport: the photographic corner fall. */
  vignette: HTMLCanvasElement;
  /** [dimTier] — the OWNER's companion, matte and hand-made. */
  body: HTMLCanvasElement[];
  /**
   * The same emulsion, as a pattern, kept so a being baked later in the
   * session wears the identical film — with only its ORIGIN moved. Phase is
   * anti-cloning texture, never an identity signal.
   */
  bodyGrain: CanvasPattern | null;
  /**
   * Every other being in the world, baked once each on the wall's first wake
   * and held for the session. A wall never renders half-baked: the sprites
   * exist before the column is ever drawn.
   */
  beings: Map<string, BeingSprites>;
}

/** One being's whole appearance: four dim tiers of body, four aura layers. */
interface BeingSprites {
  body: HTMLCanvasElement[];
  aura: HTMLCanvasElement[];
}

/**
 * HOW COARSE A MACHINE'S FORM IS. Roughly how many cells the body is quantised
 * to across its width — low enough to be unmistakable at a glance on a phone,
 * high enough that the silhouette is still the same species.
 */
const MACHINE_CELLS = 20;

/**
 * SNAP A BAKED FORM TO A GRID.
 *
 * An agent is not another individual, it is another KIND of mind, and the hash
 * ladders alone could never say that — they vary proportion, which reads as
 * "someone else", not as "something else". So a machine's body is baked once
 * through a grid: rendered small and blown back up with interpolation off, so
 * its edges are steps rather than curves.
 *
 * It happens HERE, at the bake, and that is the whole point — the sprite that
 * comes out is the same size as every other body sprite, so the draw pass
 * cannot tell the difference and the frame loop does no extra work at all.
 */
function pixelate(src: HTMLCanvasElement, cells: number): HTMLCanvasElement {
  const small = Math.max(4, Math.round(cells));
  const [lo, lg] = makeSprite(small);
  if (!lg) return src;
  lg.imageSmoothingEnabled = true;
  lg.drawImage(src, 0, 0, small, small);
  const [out, og] = makeSprite(src.width);
  if (!og) return src;
  /* the step: no interpolation on the way back up, or the grid dissolves into
     exactly the smooth edge it exists to replace */
  og.imageSmoothingEnabled = false;
  og.drawImage(lo, 0, 0, src.width, src.height);
  return out;
}

/**
 * Bake a being. Called once per wall, never per frame — the frame loop has no
 * business making a gradient, and that rule does not soften because there is
 * more than one companion now.
 */
function bakeBeing(
  pal: Palette,
  key: string,
  be: Being,
  cool: boolean,
  machine: boolean,
): BeingSprites {
  const got = pal.beings.get(key);
  if (got) return got;
  const ramp = coolRamp(pal.ramp, cool);
  let grain = pal.bodyGrain;
  if (grain && (be.grainPhase[0] !== 0 || be.grainPhase[1] !== 0)) {
    try {
      grain.setTransform(
        new DOMMatrix().translate(be.grainPhase[0], be.grainPhase[1]),
      );
    } catch {
      /* no DOMMatrix on this engine: the film is simply in phase, which costs
         nothing but a little anti-cloning texture */
    }
  }
  const body: HTMLCanvasElement[] = [];
  for (let t = 0; t < BODY_TIERS; t++) {
    const tier = rasterBody(pal.dpr, t, grain, ramp, be);
    body.push(machine ? pixelate(tier, MACHINE_CELLS) : tier);
  }
  if (grain) {
    try {
      grain.setTransform(new DOMMatrix());
    } catch {
      /* as above */
    }
  }
  /* THE AURA'S LAW IS UNTOUCHABLE — four layers, the same radii, the same
     alphas. Only its CORE temperature moves, and only for a being of colder
     light, which is the same one channel the body already spent. */
  const aura = [0, 1, 2, 3].map((i) => {
    const warm = mix(pal.ramp.liveBloom, pal.ramp.live, i * 0.18);
    return rasterBloom(
      cool ? mix(warm, pal.ramp.fade, COOL_BODY) : warm,
      NEB_PX * 0.55,
      pal.dpr,
      2 + i * 0.2,
    );
  });
  const made = { body, aura };
  pal.beings.set(key, made);
  return made;
}

/* ---------- the light, in numbers ----------
   A bright point through a night lens: the bloom is WIDE and THIN, nothing
   like a hot little flame. Reach first, then the alpha it peaks at, then how
   fast it falls away. */
const BLOOM_R = 2.2;
const BLOOM_PEAK = 0.2;
const BLOOM_EXP = 2.2;
/**
 * How much of the disc's radius is feather.
 *
 * This said "Crisp: this is photography" over a value of 0.07 — seven percent
 * of the radius, about three and a half device pixels of gradient on every
 * perimeter. Nothing with that much feather reads as an object; it reads as a
 * smudge, and with the bloom sitting under it the orb dissolved into its own
 * light. The whole sphere treatment above — terminator, rim, counter-rim,
 * specular — was being spent on something with no edge to hold it.
 *
 * Two point two percent is under one device pixel: enough to kill the jaggies
 * a hard circle would show, and nothing beyond that.
 */
const EDGE_SOFT = 0.022;
/**
 * THE KEY LIGHT — one source, and the whole world agrees about it.
 *
 * This REVERSES AN EARLIER FOUNDER RULING, deliberately and with approval.
 * That ruling ("no rim, no terminator, no contact shadow — these are lit from
 * within and float") came from a reference image of flat pastel gradient
 * orbs, and it was right for that world. This world is night photography, and
 * in night photography things have SURFACES: a dormant orb measured as a
 * mathematically flat disc — sixty-one, sixty-one, sixty-one all the way
 * across — which is a fill, not an object, and a large part of why the frame
 * read as drawn rather than photographed.
 *
 * So: one motivated source, high and to the upper left, stated once here and
 * obeyed by the orbs, the clouds and the companion alike. Everything in a
 * frame agreeing about where the light is is most of what "one place" means.
 *
 * It is NIGHT-PHOTOGRAPHY SUBTLE. If it reads as a shiny 3D ball it has
 * overshot: this is a surface catching a little light, at the threshold of
 * noticing. And it introduces NO hue — the rim is the same warm-white the
 * ramp already has, the shadow is the ground's own colour, and the counter-
 * rim is the cool end. Temperature and luminance only, always.
 */
const KEY_X = -0.62;
const KEY_Y = -0.78;
/**
 * THE SURFACE, TURNED UP UNTIL IT IS ACTUALLY A SURFACE.
 *
 * Every one of these terms was already written and every one was set so faint
 * that none of it survived the bloom underneath — the orbs read as flat cream
 * blobs, which is exactly what they were being drawn as. A sphere is not a
 * gradient; it is a bright grazing rim, a dark terminator, a cold bounce on
 * the far edge and one small specular, and all four have to be strong enough
 * to be seen through the light the orb is sitting in.
 *
 * They still encode nothing. Aliveness is temperature and luminance; this is
 * form, and form is the same on a bright memory and a dark one — which is the
 * whole reason a cooled coal still looks like an object.
 */
const KEY_SHADE = 0.46;
const KEY_RIM = 0.5;
const KEY_COUNTER = 0.17;
const KEY_SPEC = 0.42;
/** The broad wrap across the lit third — the old sheen, now motivated. */
const SHEEN = 0.26;
/**
 * FILM GRAIN, AND IT HAS TO BE VISIBLE. One noise value per CELL rather than
 * per device pixel — a one-device-pixel cell on a retina display is half a CSS
 * pixel, which is to say invisible, and invisible texture is what made the
 * previous surface read as vector-clean. Two device px is fine film and still
 * perceptible at 100%.
 */
const GRAIN_PX = 2;
/** The tile is GRAIN_TILE cells square, in CSS pixels. */
const GRAIN_TILE = 64;
const GRAIN_AMP = 0.09;
/* The strength lives in jar.css with the layer that carries it: opacity on a
   real element, blended against an opaque backdrop. */
/** The corners fall away. A photographic idea, so it is kept photographic. */
const VIGNETTE = 0.34;
/** A candidate's unformed light: the same ramp, spread out and faint. */
const NEB_PEAK = 0.12;

/** Dim tiers the character's body is baked at. */
const BODY_TIERS = 4;
/** The character's baked sprite size in logical px; it is scaled at draw. */
const BODY_PX = 240;

/** How many aliveness tiers the orb sprites are baked at. */
const TIERS = 5;

/* the per-member hue system lives in lib/appearance.ts — see the note
   there for why, and docs/architecture.md for the seams generally */

/**
 * HOW COARSE A MACHINE'S MEMORY IS. Four device pixels to one of the orb's
 * own, which at the smallest baked size still leaves roughly a dozen steps
 * across the disc — enough that the edge reads as stepped rather than as a
 * blurry circle, and few enough that it reads as a resolution rather than as
 * a texture.
 */
const PIXEL_STEP = 4;

/**
 * AN AGENT'S MEMORY IS THE SAME LIGHT AT A COARSER RESOLUTION.
 *
 * Not a different colour, not a different size, not a different shape: the
 * identical disc, the identical ramp, the identical aliveness tier — rendered
 * on a grid a quarter as fine and scaled up without smoothing. Everything the
 * light says still says it; what changes is how finely the thing can be
 * described, which is the honest difference between a memory somebody had and
 * a memory something recorded.
 *
 * This is the same sentence the rest of the world already speaks: the machine
 * hand on an agent's poster, the quantized positions when you cross into an
 * agent's wall, the stepped tick that replaces the companion's float. One
 * grammar, said again in the one place it had not been said yet.
 */
function rasterOrbPixel(ramp: Ramp, r: number, dpr: number, tier: number): HTMLCanvasElement {
  /* the small render: the real orb, drawn at a fraction of the resolution */
  const small = rasterOrb(ramp, r, dpr / PIXEL_STEP, tier);
  const D = Math.max(8, Math.ceil((r + ORB_PAD) * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return small;
  /* nearest-neighbour on the way up — this is the whole effect, and doing it
     at bake time means the frame loop never touches a smoothing flag */
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, D, D);
  return c;
}

/**
 * A sprite sheet for one (hue, resolution) pair, baked the first time such a
 * memory is about to be drawn and held for the life of the palette. Called
 * from inside the frame loop, which is normally forbidden — but only ever on
 * the frame a combination first appears, and there are at most a handful, so
 * this is a bounded one-off rather than per-frame work.
 */
function orbsForHue(pal: Palette, hue: number, pixel: boolean): HTMLCanvasElement[][] {
  const key = `${hue}:${pixel ? "p" : "s"}`;
  const got = pal.hued.get(key);
  if (got) return got;
  const ramp = hue >= 0 ? tintRamp(pal.ramp, hue) : pal.ramp;
  const tiers = Array.from({ length: TIERS }, (_, i) => i);
  const bake = pixel ? rasterOrbPixel : rasterOrb;
  const made = SIZE_R.map((r) => tiers.map((t) => bake(ramp, r, pal.dpr, t)));
  pal.hued.set(key, made);
  return made;
}

/**
 * WHAT AN UNDATED MEMORY LOOKS LIKE.
 *
 * Aliveness is a claim about WHEN something was saved and how it has been
 * returned to since. A room's proposal names no per-save date, so there is no
 * such claim to make about the memories it cites — and lighting them from the
 * newest edge of the declared span would print a number nobody measured, in
 * the one channel this page reserves for meaning.
 *
 * So an undated memory declares itself undated instead: one fixed tier, one
 * fixed power, the same for every satellite in that ring including any the
 * viewer saved themselves. A ring then says one kind of thing throughout,
 * which is the only honest thing it can say. The panel already prints who and
 * no when for these.
 */
const UNDATED_TIER = Math.round((TIERS - 1) / 2);
const UNDATED_POW = 0.5;

function makeSprite(px: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  return [c, c.getContext("2d")];
}

const rgbCss = (c: [number, number, number], a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * WHERE A TIER SITS ON THE RAMP — and the law this whole surface is built on.
 *
 * THE ONLY WARM THING ON SCREEN IS WHAT IS MOST ALIVE.
 *
 * Colour TEMPERATURE is the aliveness signal and luminance is the second
 * channel, and nothing else varies at all:
 *
 *   alive   — a slightly warm white, the single warm note in a cold frame
 *   fading  — through neutral, then cool: a silver that has lost its warmth
 *   dormant — cold and near-invisible, barely separated from the ground
 *
 * Read down a field of these and the warm ones are the live ones; that is the
 * entire readout, and it works at a glance and at a distance because warmth
 * against cold is pre-attentive in a way that six pastel hues never were.
 *
 * HUE-PER-THEME IS DELETED FOREVER. It said which theme an id happened to hash
 * to — unreadable by anyone, and a direct contradiction of the page's own law
 * that light is the only meaning channel. Do not reintroduce a colour that
 * encodes a category: if something needs to be told apart from its neighbour,
 * it is either alive or it is not.
 *
 * Below the half-way point a tier walks from dormant up to fading, above it
 * from fading up to alive — one continuum, quantised only because the sprites
 * are baked.
 */
function rampAt(ramp: Ramp, life: number): {
  core: [number, number, number];
  edge: [number, number, number];
  bloom: [number, number, number];
} {
  const core =
    life < 0.5 ? mix(ramp.dorm, ramp.fade, life * 2) : mix(ramp.fade, ramp.live, (life - 0.5) * 2);
  const edge =
    life < 0.5
      ? mix(ramp.dorm, ramp.fade, life * 2)
      : mix(ramp.fade, ramp.liveEdge, (life - 0.5) * 2);
  /* a dormant orb's bloom is its own cold colour, which additively is very
     nearly nothing — it stops glowing without ever leaving the field */
  return { core, edge, bloom: mix(ramp.dorm, ramp.liveBloom, Math.pow(life, 1.2)) };
}

/**
 * The orb: a disc of light with a diffuse bloom. No rim light, no terminator,
 * no contact shadow — these are lit from within and they float, so nothing
 * about them implies an outside source.
 *
 * What varies from orb to orb is ALIVENESS and nothing else. `tier` walks that
 * continuum: 0 is dormant — dim, cold and nearly colourless, still holding its
 * place in the field — and TIERS-1 is fully alive, the brightest and warmest
 * the skin has.
 *
 * The edge is built rather than gradient-masked, because one skin needs it to
 * be IMPERFECT: the mask is a stack of rim paths from R down to R(1-soft),
 * each laid at 1/K alpha under `lighter`, which sums to a linear feather that
 * follows whatever silhouette the rim traced. A perfect circle is what reads
 * as digital, and hanji is the argument against it.
 */
function rasterOrb(ramp: Ramp, r: number, dpr: number, tier: number): HTMLCanvasElement {
  const D = Math.max(8, Math.ceil((r + ORB_PAD) * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const R = r * dpr;
  const cx = D / 2;
  const cy = D / 2;
  const life = tier / (TIERS - 1);
  const at = rampAt(ramp, life);
  const ca = at.core;
  const cb = at.edge;

  /* the disc: a 135-degree ramp, top-left to bottom-right. Both ends are the
     same light at the same aliveness — this is shading, not two colours */
  const k = R * 0.72;
  const disc = g.createLinearGradient(cx - k, cy - k, cx + k, cy + k);
  disc.addColorStop(0, rgbCss(ca, 1));
  disc.addColorStop(1, rgbCss(cb, 1));
  g.fillStyle = disc;
  g.fillRect(0, 0, D, D);

  /* ---- THE SURFACE. All of it baked, all of it agreeing with KEY_X/KEY_Y,
     and none of it costing a single instruction at draw time. ----

     A dormant orb keeps a surface too: it is the SPECULAR and the wrap that
     belong to its own light and fade with it, while the terminator and the
     counter-rim belong to the WORLD's light and are there whatever the memory
     has left. That is why a dead coal still looks like an object. */
  const lx = cx + KEY_X * R;
  const ly = cy + KEY_Y * R;

  /* the terminator: the form falling away from the key, into the ground's own
     colour so the dark side sinks into the world rather than going grey */
  const shade = g.createRadialGradient(lx, ly, R * 0.2, cx - KEY_X * R * 0.3, cy - KEY_Y * R * 0.3, R * 1.6);
  shade.addColorStop(0, "rgba(6,8,13,0)");
  shade.addColorStop(0.55, `rgba(6,8,13,${(KEY_SHADE * 0.35).toFixed(3)})`);
  shade.addColorStop(1, `rgba(6,8,13,${KEY_SHADE.toFixed(3)})`);
  g.fillStyle = shade;
  g.fillRect(0, 0, D, D);

  /* the rim: a soft arc where the key grazes the edge */
  const rimX = cx + KEY_X * R * 0.94;
  const rimY = cy + KEY_Y * R * 0.94;
  const rim = g.createRadialGradient(rimX, rimY, 0, rimX, rimY, R * 0.62);
  rim.addColorStop(0, `rgba(255,252,246,${(KEY_RIM * (0.42 + 0.58 * life)).toFixed(3)})`);
  rim.addColorStop(0.5, `rgba(255,252,246,${(KEY_RIM * 0.22 * (0.42 + 0.58 * life)).toFixed(3)})`);
  rim.addColorStop(1, "rgba(255,252,246,0)");
  g.fillStyle = rim;
  g.fillRect(0, 0, D, D);

  /* the counter-rim: the cold bounce off everything else in the room, on the
     opposite edge and much weaker — this is the term that reads as "night" */
  const ccx = cx - KEY_X * R * 0.9;
  const ccy = cy - KEY_Y * R * 0.9;
  const counter = g.createRadialGradient(ccx, ccy, 0, ccx, ccy, R * 0.75);
  counter.addColorStop(0, `rgba(176,196,222,${KEY_COUNTER.toFixed(3)})`);
  counter.addColorStop(1, "rgba(176,196,222,0)");
  g.fillStyle = counter;
  g.fillRect(0, 0, D, D);

  /* the broad wrap across the lit side — the old sheen, now pointed at a
     source that exists */
  if (life > 0.05) {
    const sheen = g.createLinearGradient(lx, ly, cx - KEY_X * k, cy - KEY_Y * k);
    sheen.addColorStop(0, `rgba(255,255,255,${(SHEEN * life).toFixed(3)})`);
    sheen.addColorStop(0.45, `rgba(255,255,255,${(SHEEN * 0.33 * life).toFixed(3)})`);
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sheen;
    g.fillRect(0, 0, D, D);
  }

  /* and the specular: small, soft, well inside the rim, and it belongs to the
     memory's own light — a dormant one barely catches anything */
  const spX = cx + KEY_X * R * 0.46;
  const spY = cy + KEY_Y * R * 0.46;
  /* smaller and tighter: a big soft specular is a haze, a small one is glass */
  const spR = R * 0.19;
  const spec = g.createRadialGradient(spX, spY, 0, spX, spY, spR);
  spec.addColorStop(0, `rgba(255,255,255,${(KEY_SPEC * (0.25 + 0.75 * life)).toFixed(3)})`);
  spec.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = spec;
  g.fillRect(0, 0, D, D);

  /* THE EDGE. A stack of discs, R down to R(1−soft), each at 1/K alpha under
     `lighter` so they sum to a linear feather — the perimeter is never a
     cut-out, and the disc melts into its own bloom. */
  const [mc, mg] = makeSprite(D);
  if (!mg) return c;
  const K = 12;
  /* ONE DEVICE PIXEL, AND THE FLOOR MUST BE IN THE SAME UNITS AS R.
     This read `(2 * dpr) / R`, but R is ALREADY in device pixels — so the
     dpr multiply was applied twice and the floor came out at four device
     pixels of feather on a retina screen. It overrode EDGE_SOFT entirely at
     every size, which is why the perimeter stayed a smudge no matter what
     that constant said. One over R is exactly one device pixel: enough to
     antialias the circle and not one step more. */
  const soft = Math.max(EDGE_SOFT, 1 / Math.max(R, 1));
  mg.globalCompositeOperation = "lighter";
  mg.fillStyle = `rgba(255,255,255,${(1 / K).toFixed(4)})`;
  for (let i = 0; i < K; i++) {
    mg.beginPath();
    mg.arc(cx, cy, R * (1 - soft * (i / (K - 1))), 0, TAU);
    mg.fill();
  }
  g.globalCompositeOperation = "destination-in";
  g.drawImage(mc, 0, 0);
  g.globalCompositeOperation = "source-over";
  return c;
}

/**
 * Break the 8-bit contour rings out of a baked falloff.
 *
 * A soft radial gradient laid on a near-black ground quantises to whole alpha
 * levels, and the eye reads those level boundaries as concentric "microlines"
 * — the more so when four aura layers stack their rings on top of each other.
 * One level of random alpha jitter per pixel scatters each boundary into a
 * dither pattern the eye cannot assemble into a ring. It costs nothing at
 * runtime: this happens once, at bake, like every other pixel in this file.
 */
function ditherAlpha(g: CanvasRenderingContext2D, d: number): void {
  let img: ImageData;
  try {
    img = g.getImageData(0, 0, d, d);
  } catch {
    return; /* never tainted in practice; if it ever is, skip silently */
  }
  const px = img.data;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    /* only the ramp: the solid middle and the empty outside have no bands */
    if (a === 0 || a === 255) continue;
    px[i] = a + (Math.random() < 0.5 ? -1 : 1);
  }
  g.putImageData(img, 0, 0);
}

/**
 * The diffuse outer bloom. Additive, so a dense pile glows hotter for free.
 *
 * Ten stops sampled off a smooth curve rather than two or three, so the ramp
 * has no straight segments to band along; it reaches nothing at 92% of the
 * sprite rather than at its edge, so no falloff is ever clipped into a seam;
 * and the whole thing is dithered afterwards. `exp` varies the curve between
 * the companion's stacked aura layers so residual bands cannot align.
 */
function rasterBloom(
  rgb: [number, number, number],
  radius: number,
  dpr: number,
  exp = 2.6,
): HTMLCanvasElement {
  const d = Math.max(8, Math.ceil(radius * 2 * dpr));
  const [c, g] = makeSprite(d);
  if (!g) return c;
  const grd = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
  /* brightest in the middle, nothing left well inside the sprite's edge */
  const END = 0.92;
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    grd.addColorStop(t * END, rgbCss(rgb, Number(Math.pow(1 - t, exp).toFixed(4))));
  }
  grd.addColorStop(1, rgbCss(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, d, d);
  ditherAlpha(g, d);
  return c;
}

/**
 * The companion's SILHOUETTE, traced in draw space about its own centre — the
 * same normalised pebble-drop rasterBody bakes. Everything that lives ON the
 * turning form (the seam, the shading, the eyes) is clipped to this, so no
 * feature ever floats outside the outline.
 */
function bodyPath(g: CanvasRenderingContext2D, bw: number, bh: number, be: Being): void {
  /* MASS IS CONSTANT, ASPECT IS NOT. w·h is the same number at every aspect —
     a wide being is not a big being — and at aspect 1.15 this reduces to the
     canonical geometry byte for byte. At the extremes W runs 0.810 → 0.921 of
     the sprite, so nothing ever clips. */
  const K = Math.sqrt(be.aspect / 1.15);
  const W = 0.86 * K;
  const H = W / be.aspect;
  const A = be.asym;
  const F = be.base;
  const cy = 0.5 + H * 0.04;
  const l = 0.5 - W / 2;
  const r = 0.5 + W / 2;
  const top = cy - H / 2;
  const bot = cy + H / 2;
  const X = (u: number) => (u - 0.5) * bw;
  const Y = (v: number) => (v - 0.5) * bh;
  g.beginPath();
  g.moveTo(X(l), Y(cy + H * 0.1));
  /* the dome. Its APEX tilt (r − W·0.06) is canonical for every being: an
     off-centre apex is what exposes the planet fiction under yaw. */
  g.bezierCurveTo(
    X(l),
    Y(top - H * be.dome[0]),
    X(r - W * 0.06),
    Y(top - H * be.dome[1]),
    X(r),
    Y(cy + H * 0.04),
  );
  /* right shoulder down into the resting curve, then the flat-ish base */
  g.bezierCurveTo(X(r + W * A), Y(cy + H * 0.32), X(r - W * F), Y(bot), X(0.5 + W * A), Y(bot));
  g.bezierCurveTo(X(l + W * (F - A)), Y(bot), X(l - W * A), Y(cy + H * 0.34), X(l), Y(cy + H * 0.1));
  g.closePath();
}

/**
 * A NEBULA: light that has not condensed yet.
 *
 * Three or four overlapping soft blooms in one tint pair, additive and very
 * faint, with a cloudy rather than circular edge. Baked twice per tint so a
 * skyful of candidates does not read as a row of identical clouds — and baked
 * ONCE, like everything else here: the frame loop never makes a gradient.
 */
function rasterNebula(ramp: Ramp, r: number, dpr: number, variant: number): HTMLCanvasElement {
  const D = Math.max(8, Math.ceil(r * 2 * dpr));
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const R = r * dpr;
  const cx = D / 2;
  const cy = D / 2;
  /* fixed lobes, mirrored for the second variant — deterministic, so the two
     variants are stable across re-rasters (a DPR change). A candidate is the
     same light as everything else, spread out and not yet condensed. */
  const k0 = NEB_PEAK / 0.15;
  const lobes: Array<[number, number, number, number]> = [
    [0, 0, 0.92, 0.15 * k0],
    [0.2, -0.16, 0.66, 0.12 * k0],
    [-0.22, 0.14, 0.6, 0.1 * k0],
    [0.1, 0.24, 0.5, 0.08 * k0],
  ];
  const flip = variant === 0 ? 1 : -1;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < lobes.length; i++) {
    const [ox, oy, k, peak0] = lobes[i];
    const lx = cx + ox * R * flip;
    const ly = cy + oy * R * flip;
    const lr = R * k;
    /* A cloud emits rather than reflects, so it gets no rim — but it is in
       the same room as everything else, and the side facing the key is the
       side that reads brighter. Agreement, not shading. */
    const facing = (ox * flip * KEY_X + oy * flip * KEY_Y) * 0.5;
    const peak = peak0 * (1 + clamp(facing, -0.3, 0.3));
    const rgb = i % 2 === 0 ? ramp.live : ramp.liveBloom;
    const grd = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
    for (let stop = 0; stop <= 8; stop++) {
      const u = stop / 8;
      grd.addColorStop(u, rgbCss(rgb, Number((peak * Math.pow(1 - u, 2.4)).toFixed(4))));
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, D, D);
  }
  /* and a soft mask so nothing ever reaches the sprite's edge */
  g.globalCompositeOperation = "destination-in";
  const mask = g.createRadialGradient(cx, cy, R * 0.18, cx, cy, R);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,0.8)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = mask;
  g.fillRect(0, 0, D, D);
  g.globalCompositeOperation = "source-over";
  ditherAlpha(g, D);
  return c;
}

/**
 * A soft vertical band of light — the lit seam that drifts across the
 * companion as it turns, and the only thing that keeps the rotation legible
 * once the eyes have gone round the back. Baked once; the frame loop only
 * moves it.
 */
function rasterSeam(dpr: number): HTMLCanvasElement {
  const w = Math.max(8, Math.ceil(64 * dpr));
  const h = Math.max(2, Math.ceil(4 * dpr));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, "rgba(255,255,255,0)");
  grd.addColorStop(0.5, "rgba(255,255,255,1)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return c;
}

/** A plain soft-edged dot, in the air's own colour. */
function rasterDot(
  dpr: number,
  px: number,
  falloff: number,
  rgb: [number, number, number] = [255, 255, 255],
): HTMLCanvasElement {
  const D = Math.ceil(px * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const grd = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  grd.addColorStop(0, rgbCss(rgb, 1));
  grd.addColorStop(Math.max(0, 1 - falloff), rgbCss(rgb, 1));
  grd.addColorStop(1, rgbCss(rgb, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, D, D);
  return c;
}

/**
 * TEXTURE, AND ENOUGH OF IT TO SEE.
 *
 * A tile of noise laid over the whole canvas every frame, as one fillRect with
 * a baked pattern — no filter, no per-frame noise. The previous pass ran it at
 * 0.05 alpha with a one-device-pixel cell, which is to say invisibly, and that
 * smooth vector cleanliness is a named cause of the look the founder rejected.
 * So each skin sets its own CELL SIZE (coarse grain is what you can actually
 * see), its own swing, and its own colour cast — grain that is purely
 * luminance reads as a filter, grain that carries the ground's own warmth
 * reads as the material.
 */
function rasterGrain(cast: [number, number, number]): HTMLCanvasElement | null {
  /* CSS pixels, NOT device pixels. Sized in device px, the texture's scale
     was an accident of the viewer's hardware — the same emulsion looked twice
     as fine on a retina screen. A tile in CSS px is the same film everywhere. */
  const cell = GRAIN_PX;
  const cells = GRAIN_TILE;
  const D = cell * cells;
  const [c, g] = makeSprite(D);
  if (!g) return null;
  const img = g.createImageData(D, D);
  const px = img.data;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      /* one value per CELL, not per pixel: this is what makes it visible */
      const n = (Math.random() - 0.5) * 255 * GRAIN_AMP;
      const r = 128 + n + (cast[0] - 128) * 0.16;
      const gr = 128 + n + (cast[1] - 128) * 0.16;
      const b = 128 + n + (cast[2] - 128) * 0.16;
      for (let y = 0; y < cell; y++) {
        const row = ((cy * cell + y) * D + cx * cell) * 4;
        for (let x = 0; x < cell; x++) {
          const i = row + x * 4;
          px[i] = r;
          px[i + 1] = gr;
          px[i + 2] = b;
          px[i + 3] = 255;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * A photographic vignette: nothing in the middle, darkening to the corners.
 * Baked square and stretched over whatever viewport it finds — a vignette is
 * soft enough that the stretch is invisible, and this way a resize costs
 * nothing. Moonlight only; it is a photographic idea, not a page-wide one.
 */
function rasterVignette(dpr: number): HTMLCanvasElement {
  const D = Math.ceil(256 * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const grd = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    grd.addColorStop(t, `rgba(0,0,0,${(Math.pow(t, 2.4)).toFixed(4)})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, D, D);
  ditherAlpha(g, D);
  return c;
}

/**
 * The WAKA companion: a drop of light that came to rest.
 *
 * Not Auwa's character — that is another brand's illustrated being by a named
 * artist. We take only the register (small, soft, luminous, matte, tiny dot
 * eyes on a dark ground) and draw WAKA's own silhouette: a rounded pebble-drop,
 * a wide slightly asymmetric oval with a generous dome and a flat-ish resting
 * base. No arms, no legs, no dome-head proportions.
 *
 * `tier` dims it toward quiet: at full inspiration it is warm off-white, and
 * with nothing alive in the jar it fades to a muted stone. That the companion
 * goes quiet when the jar does is the whole point.
 */
/**
 * COLDER LIGHT IS THE ONE THING AN AGENT'S BODY MAY CHANGE.
 *
 * Invariant 4 says two beings at the same aliveness are the same colour. This
 * shifts an agent's BODY a step down the temperature channel and nothing else
 * — and it does not break the law, because the warm end still belongs to what
 * is most alive, and on an agent's wall that is the memories in its peek row,
 * which stay exactly as warm as they are anywhere. What it says is that YOUR
 * companion is the warmest body on any wall in the world, and an agent's is a
 * creature of the same species made of colder light. One channel, no badge,
 * read before you read a word.
 */
const COOL_BODY = 0.42;
function coolRamp(ramp: Ramp, cool: boolean): Ramp {
  if (!cool) return ramp;
  return {
    ...ramp,
    bodyLit: mix(ramp.bodyLit, ramp.fade, COOL_BODY),
    bodyShade: mix(ramp.bodyShade, ramp.dorm, COOL_BODY * 0.5),
  };
}

function rasterBody(
  dpr: number,
  tier: number,
  grain: CanvasPattern | null,
  ramp: Ramp,
  be: Being,
): HTMLCanvasElement {
  const D = Math.ceil(BODY_PX * dpr);
  const [c, g] = makeSprite(D);
  if (!g) return c;
  const life = tier / (BODY_TIERS - 1);
  /* The companion belongs to the same light as everything else: it is the
     brightest thing in an ember room, a cool silver form under moonlight, and
     lantern-warm on hanji. With nothing alive in the jar it fades toward the
     the ground's own shadow — that it goes quiet when the field does is the
     point. */
  const lit = mix(ramp.bodyShade, ramp.bodyLit, life);
  const shade = mix(mix(ramp.bodyShade, ramp.dorm, 0.45), ramp.bodyShade, life);

  /* the pebble-drop, at THIS being's proportions. The silhouette is traced by
     the one tracer the draw pass clips its features to, so the bake and the
     clip can never drift apart. */
  const K = Math.sqrt(be.aspect / 1.15);
  const w = D * 0.86 * K;
  const h = w / be.aspect;
  const cx = D / 2;
  const cy = D / 2 + h * 0.04;
  const bot = cy + h / 2;
  g.save();
  g.translate(cx, D / 2);
  bodyPath(g, D, D, be);
  g.restore();
  g.clip();

  /* THE SAME KEY. It used to be lit straight down, which is a different light
     from the one every orb in the frame obeys — and a frame with two lights in
     it is a frame that was drawn, not photographed. */
  const body = g.createLinearGradient(
    cx + KEY_X * w * 0.6,
    cy + KEY_Y * h * 0.7,
    cx - KEY_X * w * 0.5,
    bot,
  );
  body.addColorStop(0, rgbCss(lit, 1));
  body.addColorStop(0.55, rgbCss(mix(lit, shade, 0.25), 1));
  body.addColorStop(1, rgbCss(shade, 1));
  g.fillStyle = body;
  g.fillRect(0, 0, D, D);

  /* its own rim, on the key side, and the cold bounce opposite */
  const bRimX = cx + KEY_X * w * 0.46;
  const bRimY = cy + KEY_Y * h * 0.5;
  const bRim = g.createRadialGradient(bRimX, bRimY, 0, bRimX, bRimY, w * 0.5);
  bRim.addColorStop(0, `rgba(255,252,246,${(0.16 * (0.4 + 0.6 * life)).toFixed(3)})`);
  bRim.addColorStop(1, "rgba(255,252,246,0)");
  g.fillStyle = bRim;
  g.fillRect(0, 0, D, D);
  const bCx = cx - KEY_X * w * 0.44;
  const bCy = cy - KEY_Y * h * 0.42;
  const bCounter = g.createRadialGradient(bCx, bCy, 0, bCx, bCy, w * 0.55);
  bCounter.addColorStop(0, "rgba(176,196,222,0.09)");
  bCounter.addColorStop(1, "rgba(176,196,222,0)");
  g.fillStyle = bCounter;
  g.fillRect(0, 0, D, D);

  /* a faint darker underside so it reads as volume, not a sticker */
  const under = g.createLinearGradient(0, cy + h * 0.1, 0, bot);
  under.addColorStop(0, "rgba(90,86,78,0)");
  under.addColorStop(1, "rgba(90,86,78,0.22)");
  g.fillStyle = under;
  g.fillRect(0, 0, D, D);

  /* matte and handmade: the same grain the rest of the page wears */
  if (grain) {
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = 0.14;
    g.fillStyle = grain;
    g.fillRect(0, 0, D, D);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  ditherAlpha(g, D);
  return c;
}

function buildPalette(
  root: HTMLElement,
  dpr: number,
  ctx: CanvasRenderingContext2D,
): Palette {
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) =>
    parseColor(cs.getPropertyValue(name).trim() || fallback);
  /* Every colour the canvas paints with lives in jar.css beside the ones the
     DOM paints with, so the surface is ONE block to read and one to change. */
  const ramp: Ramp = {
    live: v("--jar-live", "#fff2dc"),
    liveEdge: v("--jar-live-edge", "#f7ead4"),
    liveBloom: v("--jar-live-bloom", "#ffedd0"),
    fade: v("--jar-fade", "#b9c4d1"),
    dorm: v("--jar-dorm", "#28323f"),
    dust: v("--jar-dust", "#cdd8e6"),
    /* These fallbacks MUST match jar.css's warm ivory. A cold fallback here
       deletes the one channel that tells an agent's body from yours —
       coolRamp() shifts an agent a step colder, and a companion that starts
       cold has nothing left to step. pal.body is baked once, so a single
       miss (stylesheet not yet applied, or a root outside `.jar`) would bake
       a cold companion for the whole session. */
    bodyLit: v("--jar-body-lit", "#f7f1e4"),
    bodyShade: v("--jar-body-shade", "#a49b8c"),
  };
  const grayCss = cs.getPropertyValue("--jar-dorm").trim() || "#28323f";
  const tiers: number[] = [];
  for (let t = 0; t < TIERS; t++) tiers.push(t);
  const grainTile = rasterGrain(ramp.dorm);
  /* the same tile, as a pattern, for the one bake that genuinely has an
     opaque backdrop to blend against: the companion's own body */
  const bodyGrain = grainTile ? ctx.createPattern(grainTile, "repeat") : null;
  const bodyTiers: HTMLCanvasElement[] = [];
  for (let t = 0; t < BODY_TIERS; t++)
    bodyTiers.push(rasterBody(dpr, t, bodyGrain, ramp, OWNER_BEING));
  return {
    dpr,
    ramp,
    gray: grayCss,
    /* [size][tier]: aliveness picks the light, and nothing else picks anything */
    orbs: SIZE_R.map((r) => tiers.map((t) => rasterOrb(ramp, r, dpr, t))),
    hued: new Map(),
    blooms: SIZE_R.map((r) =>
      tiers.map((t) => rasterBloom(rampAt(ramp, t / (TIERS - 1)).bloom, r * BLOOM_R, dpr, BLOOM_EXP)),
    ),
    aura: rasterBloom(ramp.liveBloom, 96, dpr, BLOOM_EXP * 0.8),
    auraLayers: [0, 1, 2, 3].map((i) =>
      rasterBloom(mix(ramp.liveBloom, ramp.live, i * 0.18), NEB_PX * 0.55, dpr, 2 + i * 0.2),
    ),
    mote: rasterDot(dpr, 16, 0.9, ramp.dust),
    seam: rasterSeam(dpr),
    nebulae: (() => {
      const out: HTMLCanvasElement[] = [];
      for (let i = 0; i < NEB_VARIANTS; i++) out.push(rasterNebula(ramp, NEB_PX, dpr, i));
      return out;
    })(),
    /* nothing tainted has ever touched this canvas — it is generated noise —
       so reading it back is safe */
    grainUrl: grainTile ? grainTile.toDataURL() : null,
    vignette: rasterVignette(dpr),
    body: bodyTiers,
    bodyGrain,
    beings: new Map(),
  };
}

/**
 * Aliveness mirrors the real activation engine's constants (7-day half-life,
 * reflection charge 0.25 — scoring/activation.ts). With the live archive's
 * June–July gap most balls WILL be dim; that is honest and desired.
 */
function colorBall(b: Ball, T: number): void {
  const ref = Math.min(Math.max(b.updatedMs, b.capturedMs), T);
  const days = Math.max(0, (T - ref) / DAY_MS);
  const decay = Math.pow(0.5, days / FIELD_DECAY_HALF_LIFE_DAYS);
  /**
   * WHAT YOU BUILT ON DOES NOT ROT.
   *
   * Every memory used to decay on the same curve — including the ones a
   * pattern is standing on and the ones you came back and answered. Animal
   * Crossing has the better rule and has had it for twenty years: weeds grow
   * in the parts of the island you never developed, and never in the parts
   * you did. Come back after two months and what you made is exactly as you
   * left it; only the untended edges show the time.
   *
   * So a memory that is load-bearing — cited by a pattern, or answered in
   * your own words — has a floor under it and cannot sink to dark. The rest
   * of the field still fades exactly as it did, which is where the passage
   * of time is supposed to be visible.
   */
  const tended =
    (b.hasNotes ? FIELD_FLOOR_CITED : 0) +
    (b.reflections > 0 ? FIELD_FLOOR_ANSWERED : 0) +
    (b.hasGroup ? FIELD_FLOOR_IN_GROUP : 0);
  const a = clamp01(
    Math.max(
      decay +
        FIELD_REFLECTION_WEIGHT *
          Math.min(b.reflections, FIELD_REFLECTION_SATURATION) *
          decay,
      tended,
    ) + (b.hasNotes ? FIELD_CITED_LIFT : 0),
  );
  b.alive = a;
  b.alivePow = Math.pow(a, 1.4);
  /**
   * THE FRONTIER. A memory nothing rests on is where this person's
   * self-knowledge stops — and it was the one thing the world could not show,
   * because brightness only ever said "recent". Outer Wilds' log marks the
   * places you have BEEN that still hold something unfound; it never nags
   * about somewhere you have not gone. Same rule here: only a memory old
   * enough to have been read, and still cited by nothing, is a frontier.
   */
  b.frontier = !b.hasNotes && days > FIELD_FRONTIER_DAYS;
}

/**
 * The aliveness continuum, quantised to the baked sprite tiers. Five steps is
 * below what the eye resolves in a gradient this soft, so it still reads as a
 * continuum — and it keeps every appearance pre-rendered.
 */
function tierOf(b: Ball): number {
  return Math.round(clamp01((b.alive - 0.05) / 0.55) * (TIERS - 1));
}

/**
 * THE FIELD SHOWS EVERYTHING — INVARIANT, not a layout preference.
 *
 * Standing in the field, EVERY inspiration that exists at the dial's time is
 * on screen at once. Not a slice you scroll through, not the newest few with
 * the rest somewhere below the fold: all of them, on every wall, at every
 * viewport height. The founder has asked for this twice, and the honest way
 * to keep the promise as an archive grows is to make the ORBS give way, not
 * the archive: the field fits its inhabitants by shrinking them and their
 * drift, down to a floor, and past that floor the oldest compress into denser
 * sediment at the bottom rather than anything being pushed off the screen.
 *
 * Size still encodes nothing. It is the field making room, which is a fact
 * about the field and not about any memory in it.
 */
function fitField(arr: Ball[], bandW: number, bandH: number): number {
  const n = Math.max(arr.length, 1);
  /* the radius at which n of them share this band without stacking */
  const fitR = Math.sqrt((bandW * bandH) / n) / 2.6;
  for (const b of arr) {
    const r = clamp(Math.min(b.rBase, fitR), ORB_R_MIN, b.rBase);
    b.r = r;
    /* nearest baked size, so nothing is ever scaled by more than a few
       percent — the sphere's rim and specular only survive at 1:1 */
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < SIZE_R.length; i++) {
      const d = Math.abs(SIZE_R[i] - r);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (SIZE_R[bi] > r && bi > 0) bi -= 1;
    b.sizeIdx = bi;
    /* and it is DRAWN at the size it was baked at. The radius jitter was
       always meaningless variation — size encodes nothing here, by law — so
       snapping it to a baked value costs the design nothing and buys a
       pixel-exact edge on every orb in the field.

       DOWN, NEVER UP. The radius arriving here is what the band could FIT;
       rounding it up would hand every orb a few extra pixels at exactly the
       moment the field is crowded enough for that to matter, and the fit
       would quietly stop holding. The smallest baked size is the floor. */
    b.r = SIZE_R[bi];
    /* the drift shrinks with the orb, or a crowded field would stir itself
       into a collision every few seconds */
    const k = r / Math.max(b.rBase, 1);
    b.ampX = b.ampBaseX * k;
    b.ampY = b.ampBaseY * k;
  }
  /* 0 while there is room to spare, 1 once even the floor is crowded: how
     hard the oldest have to be compressed to keep everyone on screen */
  return clamp01((n * Math.pow(2.6 * ORB_R_MIN, 2)) / Math.max(bandW * bandH, 1));
}

/**
 * Blue-noise-ish x for a home assignment: the best of up to 12 candidates by
 * clearance from what is already placed. Shared by the personal field and by
 * every room's field — the same discipline, one column over.
 */
function scatterX(
  b: Ball,
  y: number,
  px: number[],
  py: number[],
  lo: number,
  hi: number,
): number {
  let best = (lo + hi) / 2;
  let bestGap = -1;
  for (let tries = 0; tries < 12; tries++) {
    /* the twelve draws are the BALL's, not the moment's — see Ball.scat */
    const cand = lo + b.r + b.scat[tries] * Math.max(1, hi - lo - b.r * 2);
    let gap = Infinity;
    for (let i = 0; i < px.length; i++) {
      const dx = cand - px[i];
      const dy = y - py[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < gap) gap = d;
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = cand;
    }
    if (gap > b.r * 2.2) break;
  }
  return clamp(best, lo + b.r, hi - b.r);
}

// ---------------------------------------------------------------------------
// Ambition fallback chain
// ---------------------------------------------------------------------------

/**
 * One statement of the artifact headquarters stands on. There is exactly one
 * artifact per profile under the canon, so this is never a list of competing
 * boards — it is the entries of the single board, in the server's order.
 */
type JarNote = Entry;

interface Adopted {
  ambition: string;
  /** The room whose board this is, or null when it is your own. */
  groupName: string | null;
  createdMs: number;
}

/** The reflect action's one-at-a-time life inside the panel. */
interface ReflectState {
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
type Provenance = Map<string, string | null>;

/** The room's pending rewrite of the ambition — the one adoptable candidate. */
interface Proposal {
  groupId: string;
  proposalId: string;
  ambition: string;
  changeSummary: string | null;
  createdMs: number;
  evidence: EvidenceRef[];
  /** The span the server declared across that evidence; its orbit reads it. */
  spanMs: number | null;
}

function deriveAmbition(
  T: number,
  adopted: Adopted | null,
  notes: JarNote[] | null,
): { text: string | null; eyebrow: string } {
  if (adopted && adopted.createdMs <= T)
    return { text: adopted.ambition, eyebrow: adopted.groupName ?? "Top of mind" };
  const avail = notes ? notes.filter((n) => n.createdMs <= T) : [];
  const pinned = avail.find((n) => n.pinned);
  if (pinned) return { text: pinned.body, eyebrow: "Top of mind" };
  /* No confidence on an entry any more, and none is invented: the server's
     own order is the ranking, so the head of it is what the board leads with. */
  let best: JarNote | null = null;
  for (const n of avail) if (!best || n.sortOrder < best.sortOrder) best = n;
  if (best) return { text: best.body, eyebrow: "Top of mind" };
  return { text: null, eyebrow: "Top of mind" };
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
function formingWords(
  T: number,
  proposalMs: number | null,
  forming: Array<{ createdMs: number }> | null,
): string | null {
  if (proposalMs !== null && proposalMs <= T) return "A new ambition is forming";
  let n = 0;
  for (const f of forming ?? []) if (f.createdMs <= T) n++;
  if (n === 0) return null;
  const w = numWords(n);
  return `${w[0].toUpperCase()}${w.slice(1)} ${n === 1 ? "pattern is" : "patterns are"} forming`;
}

// ---------------------------------------------------------------------------
// THE OFFLINE FIXTURE — the world with nothing behind it
// ---------------------------------------------------------------------------

/**
 * ====================== A FIXTURE, AND ONLY ON FAILURE ======================
 *
 * The database this app talks to can be somebody else's for an afternoon — a
 * schema pushed underneath a running server, every authenticated call 500 —
 * and when that happens there is nothing to draw and no frontend work can be
 * looked at, let alone judged. That is a backend-side situation; this is how
 * the surface stops being blocked by it.
 *
 * FOUR RULES, AND THEY ARE THE WHOLE DESIGN. An earlier version of this idea
 * spread twenty-four invented memories through the owner's real archive and a
 * check then passed a broken build because it counted forty-eight against
 * twenty-four saved. That is the failure mode, and every rule here exists
 * because of it:
 *
 *   1. DEV ONLY. `showsDebug()`, the same rule the Debug pill and the mock
 *      agent walls obey, and the same rule the page itself is gated on — a
 *      production visitor is redirected out of /jar before any of this is
 *      reachable at all.
 *   2. ONLY ON FAILURE, AND NEVER A DEFAULT. Nothing here is constructed
 *      until the archive fetch has actually rejected: `offlineWorld()` is
 *      called from one catch and from nowhere else, and every memory below
 *      lives inside its body rather than at module scope, so an app whose API
 *      answers never allocates a single one of them.
 *   3. NEVER MERGED. It is one source or the other. When this world is taken
 *      up it REPLACES everything — the archive, the sky, the poster, the peek
 *      row — and every other fetch still in flight is dropped on arrival. A
 *      fixture memory can therefore never stand beside a real one, in the
 *      field or in a count.
 *   4. VISIBLY MARKED, AND IT NEVER WRITES. While this is what you are
 *      looking at, one quiet line says so and says that nothing is being
 *      kept; the mouth still opens and still drops an orb into the ground so
 *      the gesture can be exercised, but it does not ask a server to save
 *      anything and does not pretend one agreed.
 *
 * The shapes are the API's own, to the field — see `lib/api.ts` — so the swap
 * is invisible to everything downstream: the ball constructor, the sky, the
 * peek election and the panel all read exactly what they read from the wire.
 *
 * ==========================================================================
 */

/** Everything the world is built from, when it is built from nothing. */
interface OfflineWorld {
  /** The ground: the field is made of these, and of nothing else. */
  captures: Inspiration[];
  /** The sky: patterns still forming, each citing memories that exist. */
  patterns: Signal[];
  /** Which patterns rest on which memory — the field reads its meaning here. */
  citations: Map<string, Evidence[]>;
  /** The board headquarters stands on. */
  notes: Entry[];
  /** The poster. */
  adopted: Adopted;
  /** What the poster rests on — the peek row is elected out of this. */
  provenance: Provenance;
}

/** The quote a fixture pattern took from a fixture memory, kept out of band
    so the two producers below can be written independently of each other. */
const OFFLINE_QUOTES = new Map<string, string>();

/** One capture, exactly as `GET /inspirations` hands one over. */
function offlineSignal(
  n: number,
  day: number,
  text: string,
  extra: {
    /** The words a pattern carried out of it. Verbatim inside `text`, or the
        panel simply does not mark them — see markPassages. */
    quote?: string;
    /** The patterns this memory fed. Real statements, and its light reads them. */
    fed?: string[];
    reflections?: number;
    /** Returned to since: an old memory that is honestly warm again. */
    touched?: number;
  } = {},
): Inspiration {
  /**
   * NEVER AT THE VERY INSTANT OF LOADING.
   *
   * The dial's present is fixed when the page mounts, which is a moment
   * BEFORE this world is built — so a memory dated `now` is dated after the
   * end of its own rail, does not exist at T, and is left out of the field
   * and out of the count. Six hours back is the nearest a memory is allowed
   * to be, and `agoWords` still says "Today" about it.
   */
  const back = (d: number) => daysAgo(Math.max(d, 0.25));
  const capturedAt = back(day);
  const id = `offline-m${n}`;
  if (extra.quote) OFFLINE_QUOTES.set(id, extra.quote);
  if (extra.fed?.length) OFFLINE_FED.set(id, extra.fed);
  return {
    id,
    preview: text,
    /* the dev fixture keeps everything to itself */
    isPublic: false,
    kind: "note",
    source: "app",
    capturedMs: Date.parse(capturedAt),
    updatedMs: Date.parse(extra.touched === undefined ? capturedAt : back(extra.touched)),
    attachments: [],
    reflectionCount: extra.reflections ?? 0,
  };
}

/** memory id → the statements it fed, as the fixture declares them. */
const OFFLINE_FED = new Map<string, string[]>();

/**
 * One provisional reading — a candidate up in the sky, with the memories it
 * was drawn from named by id. Those ids are resolved against the archive the
 * same way a real one's are, so every satellite in orbit stands for a memory
 * that genuinely exists down in the field.
 */
function offlineReading(
  n: number,
  day: number,
  title: string,
  evidence: Array<[number, string | null]>,
): { pattern: Signal; evidence: Evidence[] } {
  const at = Date.parse(daysAgo(day));
  return {
    pattern: {
      id: `offline-p${n}`,
      statement: title,
      /* still overhead: a fixture has adopted nothing */
      status: "emerging",
      /* NOT SCORED, SO NOT CLAIMING A SCORE. Confidence is the server's
         reading of a pattern; a fixture has no server, and inventing a
         plausible number would put a made-up value into the one channel this
         page reserves for meaning. Zero is "not scored", and the sky's layout
         then keeps the order the fixture declares. */
      confidence: 0,
      evidenceCount: evidence.length,
      lastEvidenceMs: at,
      createdMs: at,
      locked: false,
      unsupported: false,
      sharedGroupIds: [],
    },
    evidence: evidence.map(([m, quote]) => ({
      signalId: `offline-p${n}`,
      inspirationId: `offline-m${m}`,
      preview: "",
      quote,
      reason: null,
      createdMs: at,
    })),
  };
}

/**
 * THE WORLD, BUILT ONCE AND ONLY WHEN THERE IS NOTHING ELSE.
 *
 * Twenty-four memories across about three months, so the aliveness ramp has
 * its whole range to run: warm and close at the top, a middle band, and a
 * genuinely cold floor where the oldest draw together into sediment. A mix of
 * lengths, and Hangul throughout, because the archive this is standing in for
 * is majority Korean and Korean text is what has found the layout bugs.
 *
 * Returns null outside dev — and then the page's own failure line stands, as
 * it did before any of this existed.
 */
function offlineWorld(): OfflineWorld | null {
  if (!showsDebug()) return null;

  const R1 = "I am becoming someone who shows the thing instead of describing it.";
  const R2 = "The work I keep returning to is the work nobody asked me for.";
  const R3 = "I trust a surface more once I have watched it fail.";
  const R4 = "What I call taste is mostly a list of things I refuse to ship.";

  const captures: Inspiration[] = [
    offlineSignal(
      1,
      0,
      "빛이 유일한 의미 채널이라면 크기는 아무 말도 하면 안 된다. 오늘 화면에서 큰 공이 중요해 보였는데, 그건 내가 만든 거짓말이었다.",
    ),
    offlineSignal(
      2,
      1,
      "Showed it to J with no explanation at all and she had the depth of it in about four seconds. Every word I had prepared was a word I did not need.",
      {
        quote: "Every word I had prepared was a word I did not need.",
        fed: [R1],
        reflections: 1,
      },
    ),
    offlineSignal(
      3,
      2,
      "설명을 잘하는 사람이 되려고 십 년을 썼는데, 정작 필요한 건 설명이 필요 없는 화면이었다. 말로 이기는 습관이 제품을 망친다는 걸 오늘 아침에 처음으로 몸으로 이해했다.",
      { quote: "설명이 필요 없는 화면이었다", fed: [R1] },
    ),
    offlineSignal(4, 3, "Motion should explain the mechanism, or it is decoration."),
    offlineSignal(
      5,
      5,
      "Spent the afternoon defending a feature nobody had attacked. The honest version of that meeting is that I wanted to be told it was good, and I dressed the wanting up as a design review.",
      { quote: "I wanted to be told it was good", reflections: 2 },
    ),
    offlineSignal(
      6,
      7,
      "오래된 기억은 사라지는 게 아니라 차가워지는 것 — 이 한 문장 차이가 제품 전체를 결정한다.",
    ),
    offlineSignal(
      7,
      9,
      "A number on the screen is a claim I have to defend. Prose is a claim I can be wrong about gracefully.",
    ),
    offlineSignal(
      8,
      12,
      "Watched someone use it on a short phone and the bottom quarter of the field was simply empty. It passed on my machine and on the big monitor, which is exactly how a fixed reserve hides.",
      { fed: [R3] },
    ),
    offlineSignal(9, 15, "내가 확인하지 않은 것을 먼저 말하는 게 신뢰의 시작이다."),
    offlineSignal(
      10,
      18,
      "Deleted the six pastel tints today. Six hues that meant nothing were louder than one hue that meant something.",
      {
        quote: "Six hues that meant nothing were louder than one hue that meant something.",
        fed: [R4],
      },
    ),
    offlineSignal(
      11,
      22,
      "사람들이 저장하는 건 정보가 아니라 그때의 자기 자신이다. 그래서 목록으로 보여주면 아무 감흥이 없고, 쌓인 걸로 보여주면 갑자기 자기 얘기가 된다. 이걸 반년 걸려서 알았다.",
    ),
    offlineSignal(12, 26, "Stop asking what it does. Ask what it makes a person willing to say."),
    offlineSignal(
      13,
      30,
      "The thing I return to every week is not the roadmap. It is the one screen I built for myself over a weekend and never told anybody about.",
      { fed: [R2] },
    ),
    offlineSignal(
      14,
      34,
      "아무도 시키지 않은 일을 자꾸 하고 있으면 그게 방향이고, 시킨 일만 하고 있으면 그건 직업이다.",
      { fed: [R2] },
    ),
    offlineSignal(
      15,
      39,
      "Tried to write the pitch again and it came out as a list of features, again. The version that actually landed was me showing the screen and shutting up for ninety seconds.",
      {
        quote: "me showing the screen and shutting up for ninety seconds",
        fed: [R1],
        touched: 9,
      },
    ),
    offlineSignal(16, 44, "A tool I have never seen break is a tool I do not trust yet.", {
      fed: [R3],
    }),
    offlineSignal(17, 49, "취향이라고 부르는 것의 대부분은 안 하기로 한 것들의 목록이다.", {
      fed: [R4],
    }),
    offlineSignal(
      18,
      55,
      "Turned down the collaboration. It would have been good for the number and wrong for the thing.",
      { fed: [R4] },
    ),
    offlineSignal(
      19,
      61,
      "First honest session with someone who had never seen it. She scrolled to the bottom, sat there for a while, and said “this is a year of me”. I had built it as an archive and she read it as a portrait, and she was right.",
      { quote: "I had built it as an archive and she read it as a portrait" },
    ),
    offlineSignal(20, 67, "고장 나는 걸 한 번도 못 본 도구는 아직 믿을 수 없다.", { fed: [R3] }),
    offlineSignal(
      21,
      73,
      "Every product I have loved had one gesture I could do without looking. Everything else in them was menus.",
      { touched: 11 },
    ),
    offlineSignal(22, 79, "Kept the ugly version that ran.", { fed: [R4] }),
    offlineSignal(
      23,
      85,
      "설명서를 써야 이해되는 화면은 화면이 아니라 설명서다. 오늘에서야 그걸 인정했다.",
      { quote: "설명서를 써야 이해되는 화면은 화면이 아니라 설명서다" },
    ),
    offlineSignal(
      24,
      91,
      "Started this because I have four years of saved things and no idea who they say I am. That is the whole product, and I keep forgetting it and building something else instead.",
      { fed: [R2] },
    ),
  ];

  const readings = [
    offlineReading(1, 5, R1, [
      [2, "Every word I had prepared was a word I did not need."],
      [3, "설명이 필요 없는 화면이었다"],
      [15, "me showing the screen and shutting up for ninety seconds"],
      [23, null],
    ]),
    offlineReading(2, 12, R2, [
      [13, null],
      [14, null],
      [24, null],
    ]),
    offlineReading(3, 21, R3, [
      [8, null],
      [16, null],
      [20, null],
    ]),
    offlineReading(4, 30, R4, [
      [10, "Six hues that meant nothing were louder than one hue that meant something."],
      [17, null],
      [18, null],
      [22, null],
    ]),
  ];

  /* WHICH PATTERNS REST ON WHICH MEMORY, built the same way the real sky
     builds it: from the patterns' own evidence, never declared per memory. */
  const citations = new Map<string, Evidence[]>();
  for (const r of readings) {
    for (const e of r.evidence) {
      const q = e.quote ?? OFFLINE_QUOTES.get(e.inspirationId) ?? null;
      const row = { ...e, quote: q };
      const got = citations.get(e.inspirationId);
      if (got) got.push(row);
      else citations.set(e.inspirationId, [row]);
    }
  }

  /* The board headquarters stands on: one artifact, and its entries cite the
     patterns beneath them — layer 3 pointing at layer 2, never at memories. */
  const boardMs = Date.now() - 9 * DAY_MS;
  const notes: Entry[] = readings.map((r, i) => ({
    id: `offline-e${i + 1}`,
    type: "pattern" as const,
    body: r.pattern.statement,
    belief: null,
    prompt: null,
    locked: false,
    pinned: i === 0,
    dismissed: false,
    sortOrder: i,
    citedSignals: [{ id: r.pattern.id, statement: r.pattern.statement }],
    createdMs: boardMs,
  }));

  /* What the poster rests on: the patterns under it, in their own words. This
     is the peek row — not the newest few, but what led to what you are
     reading. It points at layer 2 because that is what an entry cites. */
  const provenance: Provenance = new Map(
    readings.map((r) => [r.pattern.id, r.pattern.statement] as const),
  );

  return {
    captures,
    patterns: readings.map((r) => r.pattern),
    citations,
    notes,
    adopted: {
      ambition: "I am making the surface that shows what I meant, so I stop having to explain it.",
      /* your own board, so there is no room to name */
      groupName: null,
      createdMs: boardMs,
    },
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * WHAT A WALL'S HEADQUARTERS SAYS. One shape for every kind of wall — yours,
 * a room's, an agent's — because headquarters is the same five things
 * everywhere: whose wall this is, what it holds, what it turned away from,
 * whether it is looking at a moment other than now, and whether something else
 * is forming.
 */
interface WallChrome {
  /** the wall's name, and nothing else in that slot, ever */
  eyebrow: string;
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

/**
 * Where the reading panel sits, in viewport coordinates. Either `top` or
 * `bottom` is given, never both: side-anchored panels are placed from the top,
 * the narrow-viewport panel hangs off the bottom so it stays put whatever its
 * content weighs.
 */
interface PanelSpot {
  left: number;
  top: number | null;
  bottom: number | null;
}

/**
 * A panel's ENTIRE content, resolved before it is ever rendered. The panel
 * appears once, whole, and never reflows under the reader: no placeholder
 * text swapping for real text, no sections arriving late. `partial` marks the
 * one honest degradation — the network failed or took too long, so the
 * preview stands alone and says so.
 */
interface PanelData {
  id: string;
  detail: InspirationDetail | null;
  partial: boolean;
}

/**
 * The kinds of moment the companion can tell apart. Named rather than
 * numbered so a call site reads as what happened, not as an intensity.
 */
type Moment = "touch" | "kept" | "answered" | "arrived" | "shared" | "let-go";

interface SimApi {
  scrubTo: (T: number, pos: number) => void;
  select: (id: string) => void;
  release: () => void;
  wake: () => void;
  /** The companion glows for a beat — a tap was heard. */
  acknowledge: (moment?: Moment) => void;
  /**
   * Where the reading panel should sit beside the focused orb — and, only if
   * the orb would otherwise be off-screen or behind the panel, a camera nudge
   * that brings it back into view NEXT TO it. A panel is not an event: most
   * selections move the camera not at all.
   */
  place: () => PanelSpot | null;
  /** Glide back to headquarters. */
  toTop: () => void;
  /** Glide up into the sky, where the ambitions are still forming. */
  toSky: () => void;
  /** The traveler: one column left or right, the companion leading. */
  travel: (dir: 1 | -1) => void;
  /** Hand the loop the current candidate list. */
  syncSky: (list: Candidate[]) => void;
  /** An adopted candidate contracts to a point. */
  condense: (id: string) => void;
  /** Join this pattern to its nearest neighbour without a drag — the
      keyboard-and-pointer path for the one gesture that had none. */
  joinTo: (id: string) => void;
  /** Walk to a wall by column, from the axis map along the bottom. */
  goToWall: (col: number) => void;
  /**
   * FOLLOW THE CHAIN DOWNWARD. A pattern in the sky names the memories it was
   * read from; pressing one of them travels to that memory in the field and
   * opens it. This is the only navigation in the world that is caused by
   * reading rather than by moving, and it is the whole point of provenance:
   * a claim about you that you cannot walk back to its source is just an
   * assertion.
   */
  revealMemory: (inspirationId: string) => void;
  /** A reflection was kept: this memory's light genuinely comes back up. */
  relight: (id: string) => void;
  /**
   * A MEMORY IS BORN AT THE MOUTH.
   *
   * It joins the ground as an equal — fitted, homed, counted, lit by the same
   * decay — and enters from where the words were, falling to the home the
   * field just solved for it. The camera does not move: the geography is the
   * teacher, and a world that jumped to show you the result would be teaching
   * something else.
   */
  born: (seed: BornSeed) => void;
  /** The keep landed: the memory now has a reading to open. */
  identify: (id: string, sigId: string) => void;
  /** The keep did not land: the newborn fades out in place and leaves. */
  unborn: (id: string) => void;
  /** The captures the ambition was built from — the peek row is made of these. */
  /** What each wall's claim rests on, keyed by wall. The peek row reads it. */
  setProvenance: (byWall: Map<string, Provenance>) => void;
  /**
   * THE FIELD-SHOWS-EVERYTHING INVARIANT, AS A COUNT.
   *
   * This exists because the invariant kept being verified BY IMPRESSION — a
   * glance at two viewport heights, a "looks right" — and it kept coming back
   * broken at a third. An invariant that can only be checked by eye is not an
   * invariant, it is a hope. So the field will state, in numbers, how many
   * present memories there are and how many of them are actually inside the
   * visible band with the camera standing in the field. Dev-gated with the
   * rest of the page; it reads state and changes none.
   */
  audit: () => FieldAudit;
}

interface FieldAudit {
  vh: number;
  vw: number;
  /** where the camera was standing when this was counted */
  camY: number;
  /** and where it has to stand for the count to mean anything */
  fieldRest: number;
  /** every memory that exists at the dial's time */
  present: number;
  /** …of those, how many are wholly inside the field's visible band */
  onScreen: number;
  /** and where the ones that are not went */
  clippedTop: number;
  clippedBottom: number;
  /** the deepest and shallowest drawn edge, in screen px at the field rest */
  highest: number;
  lowest: number;
  /** the band the fit was solved into */
  bandTop: number;
  bandBottom: number;
}

export default function HomePage(): JSX.Element {
  /* No gate. This is home now — it is what a signed-in person lands on, in
     every build. The dev gate that used to stand here existed while this was
     a prototype living beside the real surface; the only things still behind
     `showsDebug()` are the offline fixture and the mock walls, which is where
     that gate belongs. */
  return <WorldExperience />;
}

function WorldExperience(): JSX.Element {
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  /**
   * NOTHING BEHIND THIS WORLD BUT THE FIXTURE — see offlineWorld().
   *
   * Set exactly once, from the archive fetch's own failure, and never unset:
   * a page that swapped a fixture out for real data underneath the reader
   * would be the merge this whole thing exists to forbid. Everything that can
   * write to a server reads it, and one quiet line says it out loud.
   */
  const [offline, setOffline] = useState(false);
  /**
   * STILLNESS, CHOSEN FROM INSIDE THE PAGE AND REMEMBERED.
   *
   * `prefers-reduced-motion` is honoured everywhere already, but a surface
   * whose sky drifts on its own owes a way to stop it that does not require
   * changing an operating-system setting first — and somebody who needs that
   * needs it every visit, so it persists. Declared here, above the sim effect,
   * because the loop reads it at construction.
   */
  /**
   * WHEN YOU WERE LAST HERE — read once, before anything is written.
   *
   * The founder's own use of this product is "open it after the agent has been
   * working", and that moment had no design at all: the world simply rendered,
   * fuller than before, with nothing to say which part was new.
   *
   * The answer is not a digest. Announcing "3 new patterns" before the world
   * draws converts the discovery into a receipt — the reward for opening it
   * was seeing, and telling first spends that. Animal Crossing greets a
   * two-month absence with no summary screen at all; it just gives you a
   * fuller island. Outer Wilds does the other half: come back knowing more and
   * the log PANS ALONG THE EDGE from what you knew to what you have just
   * learned, then pulls out to frame the whole thing again. You get "what
   * changed" and "where that sits" in one move, and no modal.
   */
  const lastSeenRef = useRef<number>(0);
  if (lastSeenRef.current === 0) {
    try {
      lastSeenRef.current = Number(window.localStorage.getItem("waka.seen")) || 0;
    } catch {
      lastSeenRef.current = 0;
    }
  }
  const offlineRef = useRef(false);
  const [captures, setCaptures] = useState<Inspiration[] | null>(null);
  const [notes, setNotes] = useState<JarNote[] | null>(null);
  /**
   * THE SKY, IN THE CANON'S SENSE — layer 2. Each is an evidence-backed
   * pattern: `emerging` is still forming overhead, `active` is what
   * headquarters stands on, `retired` has sunk. Null until the answer is in.
   */
  const [patterns, setPatterns] = useState<Signal[] | null>(null);
  /**
   * WHICH PATTERNS REST ON WHICH MEMORY — built from the sky, consumed by the
   * field. A capture under the canon knows nothing about its own meaning, so
   * everything a ball shows beyond its words and its clock is read from here,
   * and a memory nothing cites shows none of it rather than a default.
   */
  const [citations, setCitations] = useState<Map<string, Evidence[]>>(new Map());
  /** LAYER 3 — the one artifact this profile stands on. Null before the first
      synthesis, which the world says in words rather than leaving blank. */
  const [topOfMind, setTopOfMind] = useState<TopOfMind | null>(null);
  /** The background sweep has finished. The only thing that waits for it is
      imagery, which must appear all at once or not at all. */
  const [sweepDone, setSweepDone] = useState(false);
  /** pattern id → what it rests on. Filled by the sky's background sweep;
      read by the orbit, which never fetches on tap. */
  const evidenceByPatternRef = useRef<Map<string, Evidence[]>>(new Map());

  /**
   * READING THE SKY — the one owner, so it can happen more than once.
   *
   * This was written inline inside the world-load effect, which closes `}, []`,
   * so it ran exactly once per page load and never again. That is the whole
   * shape of the freeze: signals are DERIVED BY A BACKGROUND JOB, so the
   * result of anything you keep is guaranteed to arrive after the page stopped
   * listening. An agent writing through its CLI all afternoon, or a memory
   * kept on your phone, reached the database and never the screen.
   *
   * It lives in a ref rather than a plain `useCallback` because the effect
   * that calls it must keep its empty dependency list — the first pour is a
   * mount concern and must not re-run — while this body is re-created on every
   * render like any closure. The ref is the seam between the two.
   *
   * There is no `dead` flag here on purpose. React 18 makes a setState on an
   * unmounted component a no-op, and the alternative — threading a cancel
   * token through both callers — buys nothing this does not already have.
   */
  const readSkyRef = useRef<() => Promise<void>>(async () => {});
  readSkyRef.current = async () => {
    const rows = await loadSignals();
    if (offlineRef.current) return;
    setPatterns(rows);
    const index = new Map<string, Evidence[]>();
    for (const p of rows) {
      if (offlineRef.current) return;
      if (p.evidenceCount === 0) continue;
      try {
        const full = await loadSignal(p.id);
        for (const e of full.evidence) {
          const have = index.get(e.inspirationId);
          if (have) have.push(e);
          else index.set(e.inspirationId, [e]);
        }
        evidenceByPatternRef.current.set(p.id, full.evidence);
      } catch {
        /* this signal draws no orbit; the statement still stands */
      }
    }
    if (offlineRef.current) return;
    setCitations(index);
    /* AND NOW THE PEEK ROW CAN BE BUILT. The board's statement cites signals;
       those signals cite memories; the row beneath the poster is those
       memories, with the words each of them was quoted on. This is the only
       place both halves of the chain are in hand. */
    setNotes((cur) => {
      const board = cur ?? [];
      const lead = board.find((e) => e.pinned) ?? board[0];
      if (!lead) return cur;
      const prov: Provenance = new Map();
      for (const c of lead.citedSignals)
        for (const e of evidenceByPatternRef.current.get(c.id) ?? [])
          if (!prov.has(e.inspirationId)) prov.set(e.inspirationId, e.quote);
      if (prov.size > 0) setProvenance(prov);
      return cur;
    });
  };

  /** room id → the statements hanging on its wall, with whose they are. */
  const wallSignalsRef = useRef<Map<string, ApiGroupWallSignal[]>>(new Map());
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  /** What the adopted ambition was built from: signal id → its quote. */
  const [provenance, setProvenance] = useState<Provenance>(new Map());
  /**
   * The room's pending proposal: a whole ambition trying to replace the
   * adopted one. It is the only candidate that can actually be adopted, so it
   * carries the ids the adopt call needs.
   */
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  /* parked at now? then the date label and the return button say nothing */
  const [atNow, setAtNow] = useState(true);
  const [chrome, setChrome] = useState<WallChrome>({
    text: null,
    eyebrow: "Top of mind",
    awayFrom: null,
    formingAlt: null,
    asOf: null,
    forming: null,
    empty: false,
    prevText: null,
  });
  /** What the companion is glowing about; set only when it is tapped. */
  const [charSay, setCharSay] = useState("");
  /* The panel and the selection are ONE state: opening is selecting, and
     closing — by Esc, by a tap on the dimmed field, by tapping the same orb
     again — releases. It lags `selectedId` at BOTH ends: it does not appear
     until its content is whole, and it stays mounted through its fade-out. */
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  /* The sky's two discrete facts, pushed up from the loop: is the camera
     standing in it (the dial has no meaning among candidates), and which
     nebulae have been drawn together. */
  const [inSky, setInSky] = useState(false);
  /* whether the camera is down on the ground, where the memories are */
  const [inField, setInField] = useState(false);
  /** Which pattern in the sky is being read. Its verdict row belongs to it. */
  const [focusCandId, setFocusCandId] = useState<string | null>(null);
  /** Patterns with a neighbour close enough to join. Pushed from the loop so
      the one word that teaches the gesture can exist in the DOM. */
  const [pairableIds, setPairableIds] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * WHAT YOU HAVE SAID ABOUT A PATTERN, THIS SESSION.
   *
   * The server keeps the feedback; this is only so the row can answer in the
   * same beat rather than sitting inert until a refetch. `gone` is a pattern
   * you deleted — it leaves the sky at once, and never comes back on a stale
   * render.
   */
  const [verdicts, setVerdicts] = useState<Map<string, "true" | "partly" | "not_true" | "gone">>(
    () => new Map(),
  );
  /** Which pattern the let-go has already been pressed for, so the word can
      change to "gone" while the request is in flight. */
  const [dropAsk] = useState<string | null>(null);
  /** The board's own state: at rest, asked about, or being rewritten. */
  const [board, setBoard] = useState<{ step: "rest" | "asking" | "working" }>({ step: "rest" });

  /** The statement the poster is currently showing, as an entry we can act on. */
  const lead = useMemo<Entry | null>(() => {
    if (!notes || notes.length === 0) return null;
    return notes.find((n) => n.pinned) ?? [...notes].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  }, [notes]);

  /**
   * READ EVERYTHING AGAIN.
   *
   * Regeneration is the only verb that reaches all the way down: it rebuilds
   * the artifact from the patterns as they now stand, so every "yes" and
   * "not true" said in the sky finally arrives somewhere visible. Without it
   * answering a pattern was a row in a table nobody would ever see again.
   *
   * The board is re-fetched rather than assumed — the server writes a new
   * VERSION, and guessing at its contents would be inventing the one thing
   * this page is not allowed to invent.
   */
  const rebuildBoard = useCallback(() => {
    setBoard({ step: "working" });
    refreshTopOfMind()
      .then(() => loadTopOfMind())
      .then((tom) => {
        setTopOfMind(tom);
        setNotes(tom?.entries ?? []);
        setBoard({ step: "rest" });
        /* the poster re-arrives word by word, and the words that survived the
           rewrite stay lit — which is how you see what held */
        simApiRef.current?.toTop();
      })
      .catch(() => setBoard({ step: "rest" }));
  }, []);

  /**
   * HOLD THIS ONE UP — and there is no un-holding, by the canon's design.
   * You either keep a statement or you say it is not you; a toggle back
   * through "held" would be a third state that means nothing. So the button
   * disappears once it has been used, rather than offering to undo itself.
   */
  const holdLead = useCallback((entry: Entry) => {
    setNotes((prev) =>
      prev ? prev.map((n) => (n.id === entry.id ? { ...n, pinned: true } : n)) : prev,
    );
    if (offlineRef.current) return;
    holdTopOfMindEntry(entry.id).catch(() => {
      setNotes((prev) =>
        prev ? prev.map((n) => (n.id === entry.id ? { ...n, pinned: false } : n)) : prev,
      );
    });
  }, []);

  /**
   * NOT THIS ONE. Dismissing is not deleting: the canon keeps the entry and
   * marks it, so the board can be told it was wrong without losing the record
   * that it once said this. The next statement in the order takes the poster.
   */
  const dropLead = useCallback((entry: Entry) => {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== entry.id) : prev));
    setAdopted(null);
    /* WHAT WAS PUT DOWN CAN BE PICKED BACK UP. Dismissing is not deleting —
       the entry stays, marked — so saying "not this" about your own board must
       be undoable in the same breath, before the moment passes. Without it,
       one press on the least reversible word here was permanent. */
    setUndrop({ id: entry.id, body: entry.body });
    window.setTimeout(() => setUndrop((u) => (u?.id === entry.id ? null : u)), 9000);
    if (offlineRef.current) return;
    dismissTopOfMindEntry(entry.id).catch(() => {
      loadTopOfMind()
        .then((tom) => setNotes(tom?.entries ?? []))
        .catch(() => undefined);
    });
  }, []);

  /** The statement just taken down, for as long as taking it back still makes
      sense as one gesture rather than as an archaeology. */
  const [undrop, setUndrop] = useState<{ id: string; body: string } | null>(null);
  const restoreLead = useCallback(() => {
    if (!undrop) return;
    const id = undrop.id;
    setUndrop(null);
    if (offlineRef.current) return;
    restoreTopOfMindEntry(id)
      .then(() => loadTopOfMind())
      .then((tom) => {
        setNotes(tom?.entries ?? []);
        setTopOfMind(tom);
      })
      .catch(() => undefined);
  }, [undrop]);
  const [clusterSig, setClusterSig] = useState("");
  /* ---- walls (v10): the columns either side of the owner's own ---- */
  /** The rooms, newest first: the columns to the RIGHT. */
  const [groups, setGroups] = useState<ApiGroupSummary[]>([]);
  /**
   * The agents: the columns to the LEFT. Mock until the endpoints land.
   * Null until the answer is in — the field is built from the owner's captures
   * AND the agents' kept memories together, and it is built once, whole.
   */
  const [agents, setAgents] = useState<AgentBundle[] | null>(null);
  /** Rooms that have woken this session: their words exist, whole. */
  const [wokenRooms, setWokenRooms] = useState<ReadonlySet<string>>(() => new Set());
  /* the ref's change signal: the ball list is rebuilt when a room's ground lands */
  const [roomFieldTick, setRoomFieldTick] = useState(0);
  const setMembersRef = useRef<(m: Map<string, ApiGroupMember[]>) => void>(() => {});
  /** Rooms whose data could not be fetched: the column says so, quietly. */
  const [failedRooms, setFailedRooms] = useState<ReadonlySet<string>>(() => new Set());
  /** Which wall the camera is standing on. Discrete, pushed from the loop. */
  const [atWall, setAtWall] = useState<Wall>({ kind: "self", id: "", name: "Waka", col: 0 });
  /** The camera is over a wall that has no dial: the dial fades, as in the sky. */
  const [dialAway, setDialAway] = useState(false);
  /** Drafts assembled here, in this session. They live nowhere else. */
  const [drafts, setDrafts] = useState<Candidate[]>([]);
  const [adopting, setAdopting] = useState(false);
  /* ---- the mouth: the one verb this world was missing ----
     At rest it is a phrase. Open, it is a plain field at the seam between
     headquarters and the field, so what you type sits just above where the
     orb it becomes will appear — the geography teaches itself in one beat and
     there is no tutorial anywhere. */
  /**
   * WORDS YOU TYPED SURVIVE THE TAB CLOSING.
   *
   * The archive kept an unfinished capture across reloads and this did not, so
   * a stray refresh threw away a sentence someone was in the middle of. In a
   * product whose whole promise is "I will hold this for you", losing what a
   * person is actively typing is the smallest and worst possible version of
   * breaking that promise.
   */
  const [draft, setDraft] = useState(() => {
    try {
      return window.localStorage.getItem("waka.draft") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (draft) window.localStorage.setItem("waka.draft", draft);
      else window.localStorage.removeItem("waka.draft");
    } catch {
      /* private mode: the draft lives as long as the tab does */
    }
  }, [draft]);
  /* an unfinished sentence found on arrival opens the mouth holding it, rather
     than sitting invisible behind a phrase that says nothing about it */
  /* where the memory being written is headed; private unless said otherwise,
     and reset after every keep so a one-off never becomes a standing setting */
  const [keepPublic, setKeepPublic] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(() => {
    try {
      return (window.localStorage.getItem("waka.draft") ?? "") !== "";
    } catch {
      return false;
    }
  });
  /** The one honest line: it did not keep. Never a modal, never a silence. */
  const [mouthNote, setMouthNote] = useState("");
  /**
   * THE DIAL'S RIGHT-HAND END IS NOW, AND KEEPING SOMETHING HAPPENS NOW.
   *
   * It was fixed at the moment the archive loaded, so a memory kept ten
   * minutes into a session sat past the end of its own dial: scrub to the
   * right-hand end — which reads as "today" — and the newest thing you own
   * would fade out, because it did not exist yet at the time the rail
   * stopped. The end moves when something is kept.
   */
  const [clockMs, setClockMs] = useState(() => Date.now());
  /* THE LENS — a quiet filter over who kept a memory — was excised here while
     half-built. When it is rebuilt it fades and never removes: a filtered
     field that emptied itself would be lying about what is kept. */

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hqRef = useRef<HTMLDivElement>(null);
  const atmosRef = useRef<HTMLDivElement>(null);
  /** The emulsion: one DOM layer over the whole frame, blended, never redrawn. */
  const grainRef = useRef<HTMLDivElement>(null);
  const charSayRef = useRef<HTMLDivElement>(null);
  const hqInnerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /* the prose itself, so a long memory can be opened at its marked span */
  const panelTextRef = useRef<HTMLParagraphElement>(null);
  /** The DOM the loop positions: one sentence per nebula, one line per cluster. */
  const nebElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const clusterElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** The one whisper the orbits carry: whose memory the pointer is on. */
  const satSayRef = useRef<HTMLDivElement>(null);
  /** The mouth's camera-riding layer, and the element a memory is born from. */
  const mouthRef = useRef<HTMLDivElement>(null);
  const mouthSpotRef = useRef<HTMLElement | null>(null);
  const mouthFieldRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * The memories kept in this session, as the seeds they were built from.
   * The sim rebuilds from these, so an effect re-run can never lose one.
   */
  const bornRef = useRef<BornSeed[]>([]);
  /** The dial's outer chrome. Measured, not guessed — see the resize path. */
  /* the way to the door, for the one case the world cannot answer itself */
  const navigate = useNavigate();
  /* what actually went wrong, when it did — shown, not swallowed */
  const [failReason, setFailReason] = useState<string | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const dialTrackRef = useRef<HTMLDivElement>(null);
  const dialHandleRef = useRef<HTMLDivElement>(null);
  const dialDateRef = useRef<HTMLSpanElement>(null);

  /** The dial's current time. Continuous → lives in a ref, never in state. */
  const TRef = useRef(Date.now());
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const scrubbingRef = useRef(false);
  const ballsRef = useRef<{ list: Ball[]; byId: Map<string, Ball> } | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const simApiRef = useRef<SimApi | null>(null);
  /**
   * Every signal's full detail, fetched in the background so that a tap has
   * nothing to wait for. The panel must appear ONCE AND WHOLE, so the only
   * way to make it appear quickly is to have the content already in hand.
   *
   * Served from cache for the whole session and never refreshed behind an
   * open panel: a silent mid-read swap is the exact thing this design forbids.
   * (So an inspiration edited elsewhere in the app during the same session
   * shows its old text here until a reload. Fine for the prototype.)
   */
  /** Read by the loop: a panel is occluding part of the field right now. */
  const panelOpenRef = useRef(false);
  const detailsRef = useRef<Map<string, InspirationDetail>>(new Map());
  const detailPendingRef = useRef<Map<string, Promise<InspirationDetail | null>>>(new Map());

  /* ---- rooms (v8): session caches that survive the sim effect's re-runs ---- */
  const auth = useOptionalAuth();
  const viewerIdRef = useRef<string | null>(null);
  viewerIdRef.current = auth?.profile?.id ?? null;
  /* the hue map the legend reads — written where the orbs are tinted, so the
     two can never disagree about who is which colour */
  const hueByOwnerRef = useRef<Map<string, number>>(new Map());
  const groupsRef = useRef<ApiGroupSummary[]>([]);
  groupsRef.current = groups;

  /**
   * THE WALLS, LEFT TO RIGHT — agents, then you, then rooms.
   *
   * Column numbers are signed and the owner keeps the origin, so camX stays
   * zero at home and every existing piece of travel arithmetic is unchanged.
   * Newest agent nearest you, newest room nearest you: the axis grows outward
   * from where you stand.
   */
  const walls = useMemo<Wall[]>(() => {
    const out: Wall[] = [];
    (agents ?? []).forEach((a, i) => {
      out.push({ kind: "agent", id: a.agent.id, name: a.agent.name, col: -(i + 1) });
    });
    out.reverse(); /* leftmost first, so the array is the axis in order */
    out.push({ kind: "self", id: "", name: "Waka", col: 0 });
    groups.forEach((g, i) => {
      out.push({ kind: "room", id: g.id, name: g.name, col: i + 1 });
    });
    return out;
  }, [agents, groups]);
  const wallsRef = useRef<Wall[]>([]);
  wallsRef.current = walls;
  const agentsRef = useRef<AgentBundle[]>([]);
  agentsRef.current = agents ?? [];
  /**
   * What each wall's claim rests on: wall key → its provenance. The field is
   * one field, so this is not a set of memories per wall — it is which of the
   * SAME memories that wall's ambition was built from, and therefore which
   * ones rise into its peek row.
   */
  const wallProvRef = useRef<Map<string, Provenance>>(new Map());
  /** Per-session room data: fetched once, when travel toward it begins. */
  const roomCacheRef = useRef<
    Map<string, { status: "pending" | "ready" | "failed"; data: RoomData | null }>
  >(new Map());
  const roomChromeRef = useRef<Map<string, WallChrome>>(new Map());
  /* a room's ground, by group id, filled when the room wakes */
  const roomFieldRef = useRef<Map<string, ApiGroupFieldCapture[]>>(new Map());
  /** Namespaced room-orb id → ball, for the panel and relight lookups. */
  const roomBallsRef = useRef<Map<string, Ball>>(new Map());
  /** Rooms whose orbs have already poured this session: no re-pour on return. */
  const roomVisitedRef = useRef<Set<string>>(new Set());

  /**
   * Fetch one room's jar — its readings' evidence plus its direction —
   * starting the moment travel toward it begins, so arrival usually finds it
   * ready. The room wakes only when the character has arrived AND this has
   * resolved: a room never renders half-poured. Cached for the session; a
   * failure clears itself so the next travel toward it tries again.
   */
  const loadRoom = useCallback((groupId: string) => {
    const cache = roomCacheRef.current;
    const got = cache.get(groupId);
    if (got && got.status !== "failed") return;
    cache.set(groupId, { status: "pending", data: null });
    setFailedRooms((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    Promise.all([
      fetchGroupTopOfMind(groupId),
      fetchGroupWall(groupId).catch(() => [] as ApiGroupWallSignal[]),
      fetchGroupProposals(groupId).catch(() => [] as ApiGroupProposal[]),
      /* THE ROOM'S GROUND. Its members' public memories — the reason a room
         had a sky full of statements and nothing underneath them. A room
         never generates a signal: every statement here was formed on some
         member's own wall out of their own inspirations and then shared in,
         so the ground was always real and simply never fetched. */
      fetchGroupField(groupId).catch(() => [] as ApiGroupFieldCapture[]),
    ])
      .then(([top, wall, proposals, field]) => {
        wallSignalsRef.current.set(groupId, wall);
        roomFieldRef.current.set(groupId, field);
        setRoomFieldTick((n) => n + 1);
        const evidence = roomWallOrbs(wall, top);
        const name = groupsRef.current.find((g) => g.id === groupId)?.name ?? "";
        const open = proposals.find((p) => p.status === "open");
        const openMs = open ? Date.parse(open.createdAt) || 0 : null;
        roomChromeRef.current.set(
          groupId,
          deriveRoomChrome(name, top, openMs, evidence, groupCompany(membersRef.current.get(groupId))),
        );
        cache.set(groupId, { status: "ready", data: { evidence, top } });
        simApiRef.current?.wake();
      })
      .catch(() => {
        cache.set(groupId, { status: "failed", data: null });
        setFailedRooms((prev) => new Set(prev).add(groupId));
        simApiRef.current?.wake();
      });
  }, []);
  const loadRoomRef = useRef(loadRoom);
  loadRoomRef.current = loadRoom;

  /**
   * Warm a wall, whatever kind it is. A room fetches; an agent already has
   * everything (and will fetch the same way when the endpoints land); your own
   * wall has nothing to warm. The loop calls this the moment travel toward a
   * wall begins, so arrival usually finds it ready.
   */
  const loadWall = useCallback(
    (w: Wall) => {
      if (w.kind === "room") loadRoom(w.id);
    },
    [loadRoom],
  );
  const loadWallRef = useRef(loadWall);
  loadWallRef.current = loadWall;

  /** The camera came to rest on a wall. Discrete, pushed from the loop. */
  const pushArrived = useCallback((w: Wall) => {
    setAtWall((prev) => (prev.kind === w.kind && prev.id === w.id ? prev : w));
  }, []);
  const pushArrivedRef = useRef(pushArrived);
  pushArrivedRef.current = pushArrived;

  /** A room woke: its words may exist now. Discrete, pushed from the loop. */
  const pushWoken = useCallback((groupId: string) => {
    setWokenRooms((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
  }, []);
  const pushWokenRef = useRef(pushWoken);
  pushWokenRef.current = pushWoken;

  /* ---------------- data: all four fetches in parallel ---------------- */
  useEffect(() => {
    let dead = false;
    /**
     * ONE SOURCE OR THE OTHER, DECIDED BY THE ARCHIVE FETCH ALONE.
     *
     * The archive is the spine — it is what the field, the peek row and the
     * dial are all made of — so its answer decides which world this is. When
     * it fails, the fixture REPLACES every part of the page at once, and the
     * flag goes up before any other fetch can land: a request still in flight
     * finds `offlineRef` already set and drops what it came back with. That is
     * the no-merge rule, enforced at the only four places state is written.
     */
    const goOffline = (world: OfflineWorld) => {
      offlineRef.current = true;
      setOffline(true);
      setNotes(world.notes);
      setPatterns(world.patterns);
      setCitations(world.citations);
      setTopOfMind(null);
      /* THE FIXTURE DESCRIBES THE WHOLE WORLD, NOT JUST YOUR WALL.
         This set no groups and no agents, so the dev fixture rendered exactly
         one column — which meant every wall-specific behaviour in this world
         (a room's ground, the per-member hues, the legend, pixelated agent
         memories, the machine hand, the crossing quantization) could only
         ever be seen by signing in. Every one of those shipped unobserved,
         and several shipped broken.

         So the fixture now builds the same four rooms the product was
         designed around: one with only you, one with you and an agent, one of
         people, one of machines. It stays dev-gated — `offlineWorld()` returns
         null unless `showsDebug()` — so nothing here can reach a real
         visitor. Its purpose is that the world can be LOOKED AT without a
         session. */
      const iso = (t: number) => new Date(t).toISOString();
      const fixtureRooms: ApiGroupSummary[] = [
        { id: "fx-alone", name: "Just me", joinCode: "FIXTURE1", role: "owner", memberCount: 1, createdAt: iso(Date.now()) },
        { id: "fx-pair", name: "Me and my agent", joinCode: "FIXTURE2", role: "owner", memberCount: 2, createdAt: iso(Date.now()) },
        { id: "fx-people", name: "The four of us", joinCode: "FIXTURE3", role: "member", memberCount: 5, createdAt: iso(Date.now()) },
        { id: "fx-agents", name: "Our agents", joinCode: "FIXTURE4", role: "member", memberCount: 6, createdAt: iso(Date.now()) },
      ];
      const mem = (
        profileId: string,
        name: string,
        type: "human" | "agent",
      ): ApiGroupMember => ({
        profileId,
        name,
        initials: name.slice(0, 2).toUpperCase(),
        type,
        role: "member",
        joinedAt: iso(Date.now()),
      });
      const you = mem("fx-you", "You", "human");
      const yours = mem("fx-your-agent", "Your agent", "agent");
      const people = ["Jae Gyu", "Sora", "Minho", "Hana"].map((n, i) =>
        mem(`fx-p${i}`, n, "human"),
      );
      const bots = ["Jae Gyu's agent", "Sora's agent", "Minho's agent", "Hana's agent"].map(
        (n, i) => mem(`fx-a${i}`, n, "agent"),
      );
      setMembersRef.current(
        new Map<string, ApiGroupMember[]>([
          ["fx-alone", [you]],
          ["fx-pair", [you, yours]],
          ["fx-people", [you, ...people]],
          ["fx-agents", [you, yours, ...bots]],
        ]),
      );
      /* each room's ground: the members' public memories, so the hues, the
         legend and the pixelated agent orbs all have something to render */
      for (const room of fixtureRooms) {
        const who =
          room.id === "fx-alone"
            ? [you]
            : room.id === "fx-pair"
              ? [you, yours]
              : room.id === "fx-people"
                ? [you, ...people]
                : [you, yours, ...bots];
        const field = who.flatMap((m, mi) =>
          Array.from({ length: 3 + (mi % 3) }, (_, k) => ({
            id: `${room.id}-${m.profileId}-${k}`,
            text: `${m.name} kept this ${k + 1}: a sentence long enough to read as prose rather than as a label.`,
            kind: "note" as const,
            source: m.type === "agent" ? ("agent" as const) : ("app" as const),
            createdAt: iso(Date.now() - (3 + k * 6 + mi * 2) * 86400000),
            updatedAt: iso(Date.now() - (3 + k * 6 + mi * 2) * 86400000),
            ownerProfileId: m.profileId,
            ownerName: m.name,
            ownerType: m.type,
          })),
        );
        roomFieldRef.current.set(room.id, field);
      }
      setRoomFieldTick((n) => n + 1);
      setGroups(fixtureRooms);
      setProposal(null);
      setAdopted(world.adopted);
      setProvenance(world.provenance);
      setCaptures(world.captures);
      setPhase("ready");
    };
    /* LAYER 1 — the field. The archive is the spine, so its answer alone
       decides whether this is the real world or the fixture. */
    loadInspirations()
      .then((rows) => {
        if (dead || offlineRef.current) return;
        setCaptures(rows);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (dead) return;
        /* NOT SIGNED IN IS NOT A FAILURE.
           A 401 landed in the same branch as a dead network, so a production
           build — where there is no dev fixture to fall back to — met a
           signed-out visitor with "Waka could not be poured — reload to try
           again". Reloading can never fix not being signed in, so the one
           instruction on screen was guaranteed to fail, forever. It is a
           door, not an error: go to the door. */
        const world = offlineWorld();
        /* NOT SIGNED IN IS NOT A FAILURE — but in dev it is an OPPORTUNITY.
           A 401 used to land in the same branch as a dead network, so a
           production build met a signed-out visitor with "reload to try
           again", an instruction that can never work. It goes to the door.

           In dev, where a fixture exists, the fixture wins instead: that is
           the only way the whole world — every wall, every room, the hues,
           the legend — can be LOOKED AT without a session, which is what it
           is for. `offlineWorld()` is null outside dev, so a real visitor
           still gets the door. */
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          if (!world) {
            navigate("/login", { replace: true });
            return;
          }
          goOffline(world);
          return;
        }
        /* outside dev there is no fixture and never was: the page says what
           it has always said when the archive cannot be reached */
        if (!world) {
          /* AND IT SAYS WHY. "Reload to try again" was the entire failure
             report — the one screen a person meets when the product breaks,
             and it named neither what broke nor anything they could act on.
             The reason goes to the console for whoever is debugging, and the
             human-readable half goes on screen. */
          console.error("[waka] the field could not be poured:", err);
          setFailReason(
            err instanceof ApiError
              ? `${err.status} — ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err),
          );
          setPhase("failed");
          return;
        }
        goOffline(world);
      });
    /* LAYER 2 — the sky. Patterns, and then in the background what each of
       them rests on: the citation index the field reads its meaning from and
       the orbit draws its satellites from. One request per pattern, off the
       critical path, so nothing overhead delays the pour below.

       Retired patterns are kept. Nothing that exists pops out of existence —
       a pattern that lost its evidence sinks and cools, it is not deleted. */
    readSkyRef
      .current()
      .catch(() => {
        /* an empty sky is a real state: nothing has been distilled yet */
        if (!dead && !offlineRef.current) setPatterns([]);
      });
    /* LAYER 3 — headquarters. Exactly one artifact per profile, so this is a
       single object and null is a real state rather than an error. */
    loadTopOfMind()
      .then((tom) => {
        if (dead || offlineRef.current) return;
        setTopOfMind(tom);
        /* The board's entries ARE the readings the world reads: one artifact,
           its statements, in the server's order. Setting them here rather than
           from a second endpoint is the canon's "exactly one per profile"
           showing up in the client as exactly one fetch. */
        setNotes(tom?.entries ?? []);
        if (!tom) return;
        /* WHAT THE POSTER RESTS ON — TWO HOPS DOWN, NOT ONE.
           An entry cites PATTERNS, and a pattern cites MEMORIES. The peek row
           beneath the ambition is made of orbs, so it needs the far end of
           that chain: the memories the patterns under this statement were
           drawn from. Keyed by pattern id it matched nothing and the row fell
           back to "the newest few", which is the one thing it must never be —
           the row is what LED HERE, not what happened lately.
           The second hop arrives with the sky's background sweep, so the row
           is filled in there rather than guessed at here. */
        setProvenance(new Map());
        const lead = tom.entries.find((e) => e.pinned) ?? tom.entries[0];
        if (lead) {
          setAdopted({ ambition: lead.body, groupName: null, createdMs: lead.createdMs });
        }
      })
      .catch(() => {
        /* no board — the world still pours, and headquarters says so */
      });
    /* THE WALLS TO THE LEFT. Today this is the fixture; when the endpoints
       land it is the same four calls behind the same shape, and nothing that
       reads it changes. An outright failure means no agents, which is exactly
       what a person with no agents sees. */
    loadAgentWalls()
      .then((rows) => {
        if (!dead) setAgents(rows);
      })
      .catch(() => {
        if (!dead) setAgents([]);
      });
    /* THE ROOMS — the columns to the RIGHT.
       A room is a WALL OF STATEMENTS. Members share signals, never captures,
       so what hangs on a room's wall is other people's patterns with their
       names on them; the raw memories behind them never leave the account
       they were saved in. That is the canon's privacy line and it is why a
       room's orbit can say WHO fed an entry but never WHICH memory did. */
    (async () => {
      const rows = await fetchGroups();
      if (offlineRef.current) return;
      /* The map (v8): rooms line up to the right of your own wall,
         newest room first. This is the horizontal axis. */
      if (!dead) {
        setGroups(
          [...rows].sort(
            (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
          ),
        );
      }
      for (const g of rows) {
        if (offlineRef.current || dead) return;
        try {
          /* A room's board is NOT fetched here. `loadRoom` fetches it on
             arrival and stores it per room in `roomChromeRef`, which is where
             `wallChromeNow` reads a room's poster from. Fetching it at boot
             too was one request per room for a value nothing read. */
          const [wall, proposals] = await Promise.all([
            fetchGroupWall(g.id).catch(() => [] as ApiGroupWallSignal[]),
            fetchGroupProposals(g.id).catch(() => [] as ApiGroupProposal[]),
          ]);
          if (dead || offlineRef.current) return;
          wallSignalsRef.current.set(g.id, wall);
          /* An open proposal is a change to the room's board that has not been
             affirmed yet. It is not drawn here — it is what the forming line
             overhead is reporting the existence of. */
          const open = proposals.find((p) => p.status === "open" && p.body);
          if (open) {
            setProposal((prev) =>
              prev ?? {
                groupId: g.id,
                proposalId: open.id,
                ambition: open.body ?? "",
                changeSummary: open.rationale,
                createdMs: Date.parse(open.createdAt) || 0,
                /* Who stands behind it, not what it was made of: the room can
                   name its contributors and must not name their memories. */
                evidence: open.affirmations.map((a) => ({
                  signalId: `${open.id}:${a.profileId}`,
                  groupId: g.id,
                  authorUserId: a.profileId,
                  authorName: a.name,
                  textPreview: "",
                  quote: null,
                  kind: null,
                  createdMs: Date.parse(a.createdAt) || 0,
                  dated: false,
                  resonance: 0,
                })),
                spanMs: null,
              },
            );
          }
          /* A ROOM'S AMBITION IS NOT YOURS, AND MUST NOT BE WRITTEN WHERE
             YOURS IS READ.
             This block used to take the first room that had a board and call
             `setAdopted` with it. `adopted` is read in exactly one place —
             `wallChromeNow`'s `else` branch, which is YOUR wall (a room reads
             `roomChromeRef`, an agent reads `deriveAgentChrome`). So a room's
             sentence, carrying the room's name as its eyebrow, landed on the
             poster over your own headquarters. It won every time rather than
             only when yours was missing, because this loop awaits
             `fetchGroups()` and therefore always resolves after your own board
             has loaded: the poster painted your ambition on arrival and was
             overwritten seconds later, while you were reading it. That also
             breaks the law that the world never moves unless you moved it.

             The `return` that went with it exited the whole loop, so every
             room after the first with a board was never fetched at all — no
             wall signals, no open proposal. One block, two bugs; both go by
             deleting it and letting the loop finish. */
        } catch {
          /* this room stays silent; try the next */
        }
      }
    })().catch(() => {
      /* no rooms; your own wall is the whole axis */
    });
    return () => {
      dead = true;
    };
  }, []);

  /**
   * THE WORLD RE-READS ITSELF WHEN YOU COME BACK TO IT.
   *
   * Everything above the field was a photograph taken when the page opened.
   * The field, the sky and the agents' walls are each fetched once, inside an
   * effect that closes `}, []`, and there was no interval, no refetch after a
   * write, and no listener anywhere in the client that would go and look
   * again. Since signals are derived and the board is synthesised by
   * BACKGROUND JOBS, the answer to anything you kept was guaranteed to land
   * after the page stopped listening. The only escape was a reload, and
   * nothing on screen ever suggested one.
   *
   * COMING BACK IS THE USER MOVING. The law is that the world never moves
   * unless you moved it, and a poll would break it: statements would arrive
   * over your shoulder while you were reading. Returning to the tab is a
   * gesture, and it is the exact moment a person is ready to be told what
   * changed — so that is the only trigger, and only after long enough away
   * that something plausibly did.
   *
   * Nothing is rebuilt destructively. The balls effect already merges a
   * fetched list against what is standing — `fetched`/`kept` reconciles by
   * both ids so a reload can never double a memory — so new rows JOIN the
   * ground the way a kept memory does, and orbs already on screen keep their
   * homes. That is why this is three setState calls and not a re-pour.
   *
   * The board is deliberately absent: it refreshes on its own already
   * (`rebuildBoard`, `restoreLead`, and the edit path), and a room rehydrates
   * when you travel toward it. Only the three genuinely frozen layers are here.
   */
  const AWAY_LONG_ENOUGH_MS = 30_000;
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away < AWAY_LONG_ENOUGH_MS) return;
      /* the fixture has no server to ask, and a signed-out visitor has no
         business making three requests that will all 401 */
      if (offlineRef.current) return;
      void Promise.allSettled([
        loadInspirations().then((rows) => setCaptures(rows)),
        loadAgentWalls().then((rows) => setAgents(rows)),
        readSkyRef.current(),
      ]);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /**
   * One detail, fetched at most once per session. Returns the cached row
   * immediately when it is already in hand — which, thanks to the background
   * sweep below, is the common case by the time anything is tapped.
   */
  const loadDetail = useCallback((id: string): Promise<InspirationDetail | null> => {
    const have = detailsRef.current.get(id);
    if (have) return Promise.resolve(have);
    const inFlight = detailPendingRef.current.get(id);
    if (inFlight) return inFlight;
    const p = loadInspiration(id)
      .then((row) => {
        detailsRef.current.set(id, row);
        detailPendingRef.current.delete(id);
        return row;
      })
      .catch(() => {
        /* leave it absent: the tap path falls back to the preview */
        detailPendingRef.current.delete(id);
        return null;
      });
    detailPendingRef.current.set(id, p);
    return p;
  }, []);
  const loadDetailRef = useRef(loadDetail);
  loadDetailRef.current = loadDetail;

  /**
   * WHAT ARRIVED WHILE YOU WERE GONE — shown by going there, not by saying so.
   *
   * Held until the pour has settled, so the world is whole before it moves;
   * then the camera glides to the newest thing and lights it, and comes back
   * out. One beat, no summary, and nothing to dismiss. If nothing is new the
   * whole thing is silent, which is most days.
   */
  useEffect(() => {
    if (!captures || phase !== "ready" || offlineRef.current) return undefined;
    const since = lastSeenRef.current;
    const stamp = () => {
      try {
        window.localStorage.setItem("waka.seen", String(Date.now()));
      } catch {
        /* private mode: every visit is a first visit, which is survivable */
      }
    };
    if (since === 0) {
      /* the first visit has no "while you were gone" — everything is new, and
         saying so about a whole archive would be noise */
      stamp();
      return undefined;
    }
    const fresh = captures.filter((c) => c.capturedMs > since);
    if (fresh.length === 0) {
      stamp();
      return undefined;
    }
    const newest = fresh.reduce((a, b) => (b.capturedMs > a.capturedMs ? b : a));
    const t = window.setTimeout(() => {
      simApiRef.current?.select(newest.id);
      /* AND BACK OUT, ALL THE WAY. Not just letting the selection go — the
         camera returns to headquarters, because travelling between walls is
         only possible from there, and a greeting that leaves you unable to
         walk left or right would be an ambush rather than a welcome. */
      window.setTimeout(() => {
        simApiRef.current?.release();
        simApiRef.current?.toTop();
      }, 2600);
      stamp();
    }, 1400);
    return () => window.clearTimeout(t);
  }, [captures, phase]);

  /* ------------- the background sweep: newest first, four at a time -------------
     The peek orbs are the likeliest first tap, so the newest are fetched
     first. Four in flight keeps it off the critical path of the pour. */
  useEffect(() => {
    if (!captures) return undefined;
    /* There is no reading behind a fixture memory and there is no server to
       ask for one. Every word of it is already here — the same fact a memory
       kept at the mouth carries — so the sweep would be twenty-four requests
       that can only fail, and the panel would print a degradation notice over
       content that is not degraded. */
    if (offlineRef.current) return undefined;
    let dead = false;
    const queue = [...captures].sort((a, b) => b.capturedMs - a.capturedMs).map((s) => s.id);
    let next = 0;
    const pump = (): Promise<void> => {
      if (dead || next >= queue.length) return Promise.resolve();
      const id = queue[next++];
      return loadDetail(id).then(() => pump());
    };
    /* let the pour have the first beat to itself */
    const start = window.setTimeout(() => {
      /* SINGLE APPEARANCE. The images live on the details, so they only exist
         once the whole sweep has landed — and they are published in ONE step
         when it does. Publishing per arrival would pop pictures into orbs one
         at a time under a reader's eyes, which is the mid-read swap the world
         forbids everywhere else. */
      void Promise.all(Array.from({ length: 4 }, () => pump())).then(() => {
        if (!dead) setSweepDone(true);
      });
    }, 400);
    return () => {
      dead = true;
      window.clearTimeout(start);
    };
  }, [captures, loadDetail]);

  /* ------------- derived data (changes only when data changes) ------------- */

  /**
   * A memory's image, by memory id.
   *
   * The archive row carries only a summary of what is attached, so the URL
   * arrives with the DETAIL — which the background sweep is already fetching
   * for every memory. That is why this reads the sweep's cache rather than a
   * second endpoint: one request per memory, not two, and an orb gains its
   * image on the same beat its words arrive rather than in a later flash.
   */
  const urlById = useMemo(() => {
    void captures;
    const m = new Map<string, string>();
    for (const d of detailsRef.current.values()) if (d.imageUrl) m.set(d.id, d.imageUrl);
    return m;
  }, [captures, sweepDone]);

  /**
   * The personal capture set, by id. A pattern's evidence is resolved against
   * THIS: an id with nothing behind it is skipped rather than invented, so
   * every satellite up in the sky stands for a memory that genuinely exists
   * down in the field.
   */
  const signalById = useMemo(() => {
    const m = new Map<string, Inspiration>();
    for (const s of captures ?? []) m.set(s.id, s);
    return m;
  }, [captures]);

  const dial = useMemo(() => {
    if (!captures || captures.length === 0) return null;
    let earliest = Infinity;
    for (const s of captures) {
      const ms = s.capturedMs;
      if (Number.isFinite(ms) && ms > 0 && ms < earliest) earliest = ms;
    }
    if (!Number.isFinite(earliest)) return null;
    const start = earliest - 3 * DAY_MS;
    /* now — and `now` moves when something is kept now (see clockMs) */
    const end = clockMs;
    const span = Math.max(end - start, DAY_MS);
    const majors: Array<{ pct: number; label: string }> = [];
    const cursor = new Date(start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    cursor.setMonth(cursor.getMonth() + 1);
    while (cursor.getTime() <= end) {
      majors.push({
        pct: (cursor.getTime() - start) / span,
        label: cursor.toLocaleDateString("en-US", { month: "short" }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return { start, end, span, majors };
  }, [captures, clockMs]);

  /* ------------- palette: resolve vars once, re-raster sprites ------------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const canvasEl = canvasRef.current;
    const ctx2d = canvasEl ? canvasEl.getContext("2d") : null;
    if (!ctx2d) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pal = buildPalette(root, dpr, ctx2d);
    paletteRef.current = pal;
    /* the film is laid on the DOM layer once, here — never per frame */
    const grainEl = grainRef.current;
    if (grainEl && pal.grainUrl) {
      grainEl.style.backgroundImage = `url(${pal.grainUrl})`;
      grainEl.style.backgroundSize = `${GRAIN_PX * GRAIN_TILE}px ${GRAIN_PX * GRAIN_TILE}px`;
    }
    const bag = ballsRef.current;
    if (bag) for (const b of bag.list) colorBall(b, TRef.current);
    simApiRef.current?.wake();
    /* one surface, so this bakes once — and again only on a DPR change */
  }, []);

  /* ------------- image balls (merged by signal id from inspirations) -------------
     Images load WITHOUT crossOrigin on purpose: third-party OG hosts give no
     CORS guarantee, and drawing them taints the canvas — which is fine
     because nothing here ever reads the canvas back (no getImageData, no
     toDataURL). Dominant-color sampling is therefore forbidden; halo hue
     comes from the theme hash instead. */
  const loadSpritesRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    loadSpritesRef.current = () => {
      const bag = ballsRef.current;
      if (!bag || urlById.size === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const b of bag.list) {
        const url = urlById.get(b.id);
        if (!url || b.imgUrl === url) continue;
        b.imgUrl = url;
        const im = new Image();
        im.onload = () => {
          if (ballsRef.current !== bag) return;
          /* Circle-clip ONCE into offscreen sprites at load (2 sizes) — never
             per frame. */
          const mk = (d: number) => {
            const c = document.createElement("canvas");
            const px = Math.ceil(d * dpr);
            c.width = px;
            c.height = px;
            const g = c.getContext("2d");
            if (g) {
              g.beginPath();
              g.arc(px / 2, px / 2, px / 2, 0, TAU);
              g.clip();
              const scale = Math.max(px / im.width, px / im.height);
              const w = im.width * scale;
              const h = im.height * scale;
              g.drawImage(im, (px - w) / 2, (px - h) / 2, w, h);
            }
            return c;
          };
          b.img = { sm: mk(72), lg: mk(144) };
          simApiRef.current?.wake();
        };
        /* Instagram may 403 hotlinks: silent degrade to a plain light ball. */
        im.onerror = () => undefined;
        im.src = url;
      }
    };
    /* Run now (covers image URLs resolving after the balls exist) — and the
       sim effect below re-invokes it right after creating a fresh bag, so
       the two fetches' resolution order no longer matters. */
    loadSpritesRef.current();
  }, [urlById, captures]);

  /** THE SKY, AS THE FORMING LINE COUNTS IT: the patterns still emerging,
      each with the moment it first appeared so the dial can wind past it. */
  const emerging = useMemo(
    () =>
      (patterns ?? [])
        .filter((p) => p.status === "emerging")
        .map((p) => ({ createdMs: p.createdMs })),
    [patterns],
  );

  /* ------------- HQ chrome derived from time T (discrete facts only) ------------- */
  const applyChrome = useCallback(
    (T: number) => {
      const nowMs = dial ? dial.end : Date.now();
      /* THE DIAL WINDS THE WALL YOU ARE STANDING ON. An agent's own life is
         its own dial range, and its poster rewrites through it exactly as
         yours does — the same machinery, pointed at a different history. */
      const next: WallChrome =
        atWall.kind === "agent"
          ? deriveAgentChrome(
              (agents ?? []).find((a) => a.agent.id === atWall.id) ?? {
                agent: { id: atWall.id, name: atWall.name, kind: "agent", createdAt: "" },
                direction: { current: null, history: [] },
                topOfMind: { notes: [] },
                captures: [],
              },
              T,
              nowMs,
            )
          : /* A ROOM'S BOARD IS THE ROOM'S, AND IT LIVES WHERE THE ROOM PUT IT.
               There was no `room` branch here at all: standing in a room fell
               through to `deriveAmbition`, which reads YOUR adopted ambition
               and YOUR notes. A room wall therefore never had a poster of its
               own, and the boot loop's `setAdopted` was covering for that by
               writing the room's sentence into your slot — which is why
               deleting it left the room blank. The cover-up and the hole were
               one bug wearing two faces.
               `roomChromeRef` is the same map `wallChromeNow` reads for every
               room you are NOT standing on, filled by `loadRoom` on arrival,
               so this makes the wall you are on agree with the walls beside
               it instead of borrowing from you. Until it arrives the room is
               honestly blank — it says its own name and nothing else, rather
               than showing someone else's ambition under it. */
            atWall.kind === "room"
            ? roomChromeRef.current.get(atWall.id) ?? {
                text: null,
                eyebrow: atWall.name,
                awayFrom: null,
                formingAlt: null,
                asOf: null,
                forming: null,
                empty: false,
                prevText: null,
              }
            : (() => {
              const current = deriveAmbition(nowMs, adopted, notes);
              const at = deriveAmbition(T, adopted, notes);
              return {
                eyebrow: at.eyebrow,
                text: at.text,
                awayFrom: null,
                formingAlt: null,
                asOf:
                  at.text && at.text !== current.text && nowMs - T > 60_000
                    ? monthTag(T)
                    : null,
                /* WHAT IS OVERHEAD, IN WORDS. The forming line counts the sky
                   — the patterns still emerging — because that is now what is
                   literally above the poster. It is time-aware too: scrub back
                   past a pattern and it reports what existed then, or says
                   nothing at all. */
                forming: formingWords(T, proposal ? proposal.createdMs : null, emerging),
                /* Nothing synthesized and nothing kept: the honest empty, and
                   it is the artifact's absence that says so, not a guess. */
                empty: topOfMind === null && (captures?.length ?? 0) === 0,
                prevText: null,
              };
            })();
      setChrome((prev) =>
        prev.text === next.text &&
        prev.eyebrow === next.eyebrow &&
        prev.awayFrom === next.awayFrom &&
        prev.formingAlt === next.formingAlt &&
        prev.asOf === next.asOf &&
        prev.forming === next.forming &&
        prev.empty === next.empty
          ? prev
          : /* the sentence it is replacing, carried forward so the poster can
               tell what survived the rewrite from what is new */
            { ...next, prevText: prev.text },
      );
    },
    /* `wokenRooms` is here because a room's board arrives asynchronously into
       `roomChromeRef`, which is a ref and so cannot itself trigger anything.
       `loadRoom` adds the room to this set in the same breath as filling that
       map, so depending on it is what makes the poster appear on arrival
       rather than at whatever unrelated render happens next. `wallChromeNow`
       already depends on it for the same reason. */
    [dial, adopted, notes, proposal, atWall, agents, emerging, topOfMind, captures, wokenRooms],
  );
  /* The fallback chain's provenance: when the poster is showing an entry of
     the board rather than a room's, that entry's own citations are what led to
     it — and under the canon an entry cites PATTERNS, so this is what the peek
     row beneath the poster is made of. Only used when no room supplied one. */
  useEffect(() => {
    if (adopted || !notes || notes.length === 0) return;
    const pinned = notes.find((n) => n.pinned);
    let best: JarNote | null = pinned ?? null;
    if (!best) for (const n of notes) if (!best || n.sortOrder < best.sortOrder) best = n;
    if (!best) return;
    const prov: Provenance = new Map();
    /* the same two hops: entry → its patterns → the memories they were drawn
       from, which is what the row beneath the poster is actually made of */
    for (const c of best.citedSignals)
      for (const e of evidenceByPatternRef.current.get(c.id) ?? [])
        if (!prov.has(e.inspirationId)) prov.set(e.inspirationId, e.quote);
    if (prov.size > 0) setProvenance((prev) => (prev.size > 0 ? prev : prov));
  }, [adopted, notes]);

  const applyChromeRef = useRef(applyChrome);
  applyChromeRef.current = applyChrome;
  useEffect(() => {
    applyChrome(TRef.current);
  }, [applyChrome]);

  /**
   * WHAT EVERY OTHER WALL HOLDS, NOW.
   *
   * The dial winds the wall you are standing on and only that one — so every
   * other column reads at present time, which is why this is derived at
   * `nowMs` rather than at T. It exists because a neighbouring wall is
   * genuinely visible (the loop admits the leftmost strip of it) and a wall
   * that went blank the moment you stepped off it would be a thing popping
   * out of existence.
   *
   * Rooms come from the ref the fetch fills; `wokenRooms` is in the deps
   * precisely so that this re-derives on the render where a room wakes, and
   * the read is therefore never stale.
   */
  const wallChromeNow = useMemo(() => {
    const nowMs = dial ? dial.end : Date.now();
    const m = new Map<string, WallChrome>();
    for (const w of walls) {
      if (w.kind === "agent") {
        const a = (agents ?? []).find((x) => x.agent.id === w.id);
        if (a) m.set(wallKey(w), deriveAgentChrome(a, nowMs, nowMs));
      } else if (w.kind === "room") {
        const rc = roomChromeRef.current.get(w.id);
        if (rc) m.set(wallKey(w), rc);
      } else {
        const at = deriveAmbition(nowMs, adopted, notes);
        m.set(wallKey(w), {
          eyebrow: at.eyebrow,
          text: at.text,
          awayFrom: null,
          formingAlt: null,
          asOf: null,
          forming: formingWords(nowMs, proposal ? proposal.createdMs : null, emerging),
          empty: topOfMind === null && (captures?.length ?? 0) === 0,
          prevText: null,
        });
      }
    }
    return m;
  }, [walls, agents, wokenRooms, dial, adopted, notes, proposal, emerging, topOfMind, captures]);

  /**
   * WHAT EACH WALL'S CLAIM RESTS ON.
   *
   * One field, many claims: this is not a set of memories per wall but which
   * of the SAME memories each wall's ambition was built from — so travelling
   * re-elects the peek row out of the one ground, and nothing beneath ever
   * moves. A wall with nothing here gets a genuinely empty band, on purpose.
   */
  useEffect(() => {
    const m = new Map<string, Provenance>();
    m.set("self:", provenance);
    for (const a of agents ?? []) {
      const prov: Provenance = new Map();
      const byId = new Map(a.captures.map((s) => [s.id, s] as const));
      const held = a.direction.current;
      for (const id of held?.groundedIn ?? []) {
        const s = byId.get(id);
        if (s) prov.set(id, s.quote);
      }
      m.set(`agent:${a.agent.id}`, prov);
    }
    /* AND A ROOM LIGHTS THE STATEMENTS ITS BOARD WAS BUILT FROM.
       Rooms were the one wall kind that got an empty band here, so travelling
       into a room left the peek row dark and the board looked like it had
       come from nowhere. A room's ground is its shared statements, so those
       are what light — the same rule as everywhere else (what this wall's
       claim rests on), applied to the material a room actually has. */
    for (const w of walls) {
      if (w.kind !== "room") continue;
      const room = roomCacheRef.current.get(w.id);
      const lead = room?.data?.top?.entries?.[0];
      const prov: Provenance = new Map();
      if (lead)
        for (const ev of room?.data?.evidence ?? [])
          if (ev.citedBy.includes(lead.body)) prov.set(ev.signalId, ev.quote);
      m.set(`room:${w.id}`, prov);
    }
    wallProvRef.current = m;
    simApiRef.current?.setProvenance(m);
  }, [provenance, agents, captures, walls, wokenRooms]);

  /* The field's own invariant, reachable from the console — see SimApi.audit
     for why counting it beats looking at it. Dev-gated with the page itself. */
  useEffect(() => {
    if (!showsDebug()) return undefined;
    const w = window as unknown as { wakaField?: () => FieldAudit | null };
    w.wakaField = () => simApiRef.current?.audit() ?? null;
    return () => {
      delete w.wakaField;
    };
  }, []);

  /* ---------------- the simulation: one rAF loop, refs only ---------------- */
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas || !captures || !agents) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    /* ONE FIELD, BUILT ONCE, WHOLE. What you kept and what your agents kept
       live in the same ground — that is the whole of the direction, and it is
       also the only thing that makes the lens mean anything. Oldest first: the
       pour order IS the stratification, oldest sink deepest and newest rest on
       top, and the load burst explains the strata. */
    /* THE FIELD IS YOURS, ON EVERY WALL. Founder ruling: the bottom section is
       always the full set of the owner's own inspirations, identical wherever
       you stand — "3번째 섹션에서는 양옆 못 움직여야 해, 항상 같으니깐".
       An agent's memories belong to its own wall ABOVE, never mixed into the
       ground beneath. Spreading them in here put invented orbs among real
       saved ones, which is why the count read 48 against 24 saved. */
    /* AND WHAT YOU KEPT A MOMENT AGO, in the same ground and by the same
       rules. This effect re-runs whenever the walls resolve, so a memory said
       into the mouth has to be rebuilt from its seed rather than living only
       inside one run of the loop — otherwise keeping something and then
       having an agent arrive would make your own memory vanish. Anything the
       archive has already fetched back under either id wins, so a reload can
       never double it. */
    const fetched = new Set(captures.map((s) => s.id));
    const kept = bornRef.current.filter(
      (s) => !fetched.has(s.id) && !(s.sigId !== undefined && fetched.has(s.sigId)),
    );
    const patternById = new Map((patterns ?? []).map((p) => [p.id, p] as const));
    /* EVERY WALL'S GROUND, NOT ONLY YOURS.
       The field held your captures and nothing else — `makeAgentBall` was
       exported and never called, so an agent's memories were fetched into
       memory and then dropped, and a room's were never fetched at all. Three
       symptoms came out of that one gap: agent walls read as having signals
       with no inspirations under them, rooms read the same way, and every
       wall but yours glowed identically because the aliveness pass counts
       balls per wall and every wall but yours counted zero.

       They all live in one list, tagged by which wall they belong to. The
       field does not slide sideways when you travel; what changes is which
       of these are standing on the ground in front of you. */
    const agentBalls = (agents ?? []).flatMap((a) =>
      a.captures.map((cap) => makeAgentBall(cap)),
    );
    /* A room's ground is its members' PUBLIC memories, each still owned by
       the person who kept it — `ownerProfileId` is what the per-member hue
       will read, and it is carried from here rather than re-derived. */
    const roomBalls = walls
      .filter((w) => w.kind === "room")
      .flatMap((w) =>
        (roomFieldRef.current.get(w.id) ?? []).map((cap) =>
          makeAgentBall({
            id: cap.id,
            agentId: w.id,
            origin: cap.ownerType === "agent" ? "agent" : "human",
            textPreview: cap.text,
            quote: null,
            kind: cap.kind,
            capturedAt: cap.createdAt,
            updatedAt: cap.updatedAt,
            producedBy: null,
            ownerProfileId: cap.ownerProfileId,
            ownerName: cap.ownerName,
          }),
        ),
      );
    /* WHOSE HUE IS WHOSE, DECIDED ONCE.
       Assigned from each room's own member ordering rather than from a hash
       of the profile id: a hash is stable but arbitrary, and two members
       could collide onto the same hue in the one place the distinction has
       to hold. Ordering by the member list means the nth person in a room
       always gets the nth hue, the legend reads the same map, and your own
       memories are excluded so they stay the warm white they are at home. */
    const hueOf = new Map<string, number>();
    for (const w of walls) {
      if (w.kind !== "room") continue;
      let next = 0;
      for (const cap of roomFieldRef.current.get(w.id) ?? []) {
        if (cap.ownerProfileId === viewerIdRef.current) continue;
        if (hueOf.has(cap.ownerProfileId)) continue;
        hueOf.set(cap.ownerProfileId, next++);
      }
    }
    hueByOwnerRef.current = hueOf;
    for (const b of roomBalls) {
      b.hue = b.ownerProfileId ? hueOf.get(b.ownerProfileId) ?? -1 : -1;
    }
    const list = [
      ...captures.map((c) => makeBall(seedOf(c, citations, patternById))),
      ...agentBalls,
      ...roomBalls,
      ...kept.map(bornBall),
    ].sort((a, b) => a.capturedMs - b.capturedMs);
    const byId = new Map(list.map((b) => [b.id, b] as const));
    ballsRef.current = { list, byId };
    for (const b of list) colorBall(b, TRef.current);
    /* Sprites for any image URLs that resolved before this bag existed
       (inspirations winning the network race must not lose their imagery). */
    loadSpritesRef.current();

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* EITHER SOURCE STILLS IT. The system preference is the standing answer;
       the in-page switch is for the person who has not set one, or who wants
       this page still and the rest of their machine as it was. */
    /* THE SYSTEM PREFERENCE, AND NOTHING ELSE.
       An in-page "hold the world still" switch lived here for a while and it
       was a mistake: in a product whose motion IS the meaning, one persisted
       boolean could freeze everything — the companion stopped walking,
       leaning, bobbing and answering — with no visible state saying why, and
       every attempt to make it recoverable added another failure. The real
       accessibility requirement is served by the platform preference, which
       every branch in this file already honours. */
    let reduced = mq.matches;

    let vw = 1;
    let vh = 1;
    let dpr = 1;
    let world = computeWorld(1, 1, DIAL_H);
    /* the dial's real strip, read off the dial itself every measure */
    let dialH = DIAL_H;
    let camY = 0;
    let camVel = 0;
    /* Where a programmatic move is headed. `camAiming` is the sentinel — the
        sky lives at NEGATIVE camera coordinates, so a magic -1 would be a real
        destination rather than "nowhere". */
    let camTarget = 0;
    let camAiming = false;
    /* the snap's profile: where it left from, how long it takes, when it began */
    let camAimFrom = 0;
    let camAimDur = 0;
    let camAimT0 = 0;
    /* ---- the horizontal axis (v8): columns of jars, one room each ----
       Column zero is the personal jar; column c ≥ 1 is groupsRef[c-1]. The
       camera gains camX = column × vw with the same snap discipline as the
       vertical: velocity-biased, one column per gesture, never resting
       between. The COMPANION leads every transition — it sets off first and
       the world eases after it, which is how the page explains where the
       rooms are. */
    let col = 0;
    let camX = 0;
    let camXTarget = 0;
    let camXBack = false; /* easing home after an uncommitted swipe */
    let travelActive = false;
    let travelDir: 1 | -1 = 1;
    let travelDest = 0;
    let travelAt = 0;
    let travelFromX = 0; /* where the world's slide profile eases from */
    let charOff = 0; /* the traveler's screen lead, px */
    let charLead = 0;
    let charFrom = 0; /* where the lead ramp starts — no pops on re-travel */
    let dragLeadOn = false; /* a held horizontal drag: the companion walks */
    let dragLeadTarget = 0;
    let bobPh = 0; /* the hover-bob's own phase: it quickens into a walk */
    let travelYaw = false; /* holding the quarter-turn toward the edge */
    let awaitingWake = false; /* arrived in a room whose data is late */
    let inspCol = 0; /* whose orbs the companion's glow reads */
    let inFieldShown = false;
    let dialAwayShown = false;
    let wheelXAcc = 0;
    let wheelXUntil = 0;
    let dragAxis: 0 | 1 | 2 = 0; /* undecided · vertical · horizontal */
    let lastX = 0;
    let velX = 0;
    /* Set on wheel; the section snap fires once the wheel goes quiet. */
    let snapAt = 0;
    let pouring = false;
    let poured = false;
    /** How many newborns are fading out because their keep did not land. */
    let doomedPending = 0;
    /** The gap between two arrivals in the current pour. */
    /**
     * HOW FAR A THUMB MAY ROLL AND STILL BE A TAP.
     *
     * Manhattan, so the diagonal is the tightest direction: 6 latched a drag
     * at 4.24px diagonally, well inside Android's documented 8dp slop and
     * iOS's ~10pt. On a surface whose primary action is tapping an orb, an
     * early latch steals the tap AND kills the contact light, so the world
     * starts moving instead of the thing you aimed at lighting up.
     */
    const TAP_SLOP = 11;
    let pourStep = 35;
    let scrubDirty = false;
    let primed = false;

    /** 1 while something is happening, easing to SETTLE_MIN when nothing is. */
    let settle = 1;
    /**
     * ================= CROSSING INTO A MACHINE'S MIND =================
     *
     * 0 on your own wall and on a room's, 1 standing in an agent's, and every
     * value between while you cross. It is derived from the camera's fractional
     * column, so it is not a state that flips at a boundary — it comes on as
     * you travel and lets go as you leave.
     *
     * The difference between your mind and a machine's used to live entirely in
     * the destination: a small pixelated body in one corner, everything else
     * identical. Arriving somewhere that looks like where you left does not
     * feel like arriving. So the difference moves into the CROSSING, where the
     * world itself resolves differently as you go: continuous positions become
     * stepped ones, smooth drift becomes a grid, and the companion's float
     * stops being a sine and starts being a tick.
     *
     * It quantises POSITION and TIME only. Not colour — temperature is spoken
     * for by aliveness — and not layout, because the three sections must read
     * as the same world wherever you stand. And it obeys the law that motion
     * explains: nothing here is decoration, it is the sentence "this is a
     * different kind of mind" said in the only grammar this world has.
     */
    let mech = 0;
    /* the eased body-turn toward whatever it is attending to */
    let attendHold = 0;
    const mechAt = (x: number): number => {
      const here = x / Math.max(vw, 1);
      let best = 0;
      for (const w of wallsRef.current) {
        if (w.kind !== "agent") continue;
        const near = 1 - clamp01(Math.abs(here - w.col));
        if (near > best) best = near;
      }
      return best;
    };
    /** Snap a coordinate to the machine's grid, by however machine it is. */
    const grid = (v: number): number => {
      if (mech < 0.02) return v;
      const q = 1 + mech * 7;
      return Math.round(v / q) * q;
    };
    let stirAt = 0;
    let raf = 0;
    let running = false;
    let prev = 0;
    let lastActive = 0;

    let pointerDown = false;
    /**
     * WHOSE GESTURE THIS IS. The listeners live on `window` and there was no
     * pointer identity anywhere, which failed three ways every time and not
     * as a matter of taste: a second finger rewrote downX/lastX so the first
     * finger's next move teleported the world by the distance between them,
     * either finger's release committed the other's gesture, and dragging off
     * the window delivered no pointerup at all — welding the world to the
     * cursor until the next click. The first pointer owns the world until it
     * lets go; the rest are not answered.
     */
    let ownerId: number | null = null;
    /** Did the press interrupt a snap? Then it owes the world one back. */
    let interruptedSnap = false;
    /** Which memory the finger is on, if any: it answers at touchdown. */
    let pressId: string | null = null;
    /** When the press landed: a tap is decided on release, not on a threshold. */
    let downT = 0;
    let dragging = false;
    /* hover bookkeeping: the cursor is only re-tested every other move, and
       only written when it actually changes */
    let hoverTick = 0;
    let cursor = "";
    let nebDrag: Neb | null = null;
    /** Did the press that grabbed a cloud ever become a drag? If not, it is a
        tap, and a tap on a candidate is what makes it the subject. */
    let nebMoved = false;
    let nebOffX = 0;
    let nebOffY = 0;
    let downX = 0;
    let downY = 0;
    let lastY = 0;
    let lastT = 0;

    /* Dust motes: preallocated, mutated in place, never reallocated. They
       live in SCREEN space (drawn at world y = y + camY) because they are
       the air in front of the camera, not objects in the pile. */
    const moteX = new Float32Array(MOTES);
    const moteY = new Float32Array(MOTES);
    const moteS = new Float32Array(MOTES); /* upward speed, px/s */
    const moteA = new Float32Array(MOTES); /* alpha */
    const moteP = new Float32Array(MOTES); /* sway phase */
    const moteR = new Float32Array(MOTES); /* radius, px */
    for (let i = 0; i < MOTES; i++) {
      moteS[i] = 3 + Math.random() * 4;
      moteA[i] = 0.06 + Math.random() * 0.08;
      moteP[i] = Math.random() * TAU;
      moteR[i] = 0.9 + Math.random() * 1.8;
    }
    /* A static scatter of very dim points in the deep background. Fractions
       of the viewport, so they survive a resize without being re-rolled. */
    const sparkX = new Float32Array(SPARKS);
    const sparkY = new Float32Array(SPARKS);
    const sparkR = new Float32Array(SPARKS);
    const sparkA = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) {
      sparkX[i] = Math.random();
      sparkY[i] = Math.random();
      sparkR[i] = 0.7 + Math.random() * 1.1;
      sparkA[i] = 0.05 + Math.random() * 0.07;
    }
    /* The companion. `insp` is real: the mean aliveness of the eight most
       alive bubbles at the current dial time. It is why the character dims
       as you scrub back into a quiet stretch and brightens over a live one. */
    let insp = 0;
    let inspNow = 0;
    let flare = 0;
    /** Something was captured today: a steady lift, never a pulse. */
    let freshLit = 0;
    let charY = 0;
    let charSize = 110;
    /* The companion is the thing the dial turns. `yawTarget` is a POSITION,
       mapped from the dial's own 0→1; the drawn angle eases toward it, so a
       fast drag and a slow drag of the same distance turn it the same amount.
       Let go and it unwinds to front-facing. */
    let yawTarget = 0;
    let yaw = 0;
    let unwindFrom = 0;
    let unwindAt = 0;
    let eyeX = 0;
    let eyeY = 0;
    let eyeTX = 0;
    let eyeTY = 0;
    /* ATTENTION HAS A DURATION. While this is in the future the eyes belong
       to the thing that was tapped and the pointer cannot take them back —
       otherwise the smallest mouse drift would yank the gaze home and the
       look would read as a twitch rather than as noticing something. */
    let attendUntil = 0;
    let attendLean = 0;
    /**
     * The vertical half of the traveler. `pitch` is where the world is going
     * (−1 rising … +1 descending), eased; `charLift` is how far the companion
     * leads it in screen pixels. Both are written from the camera's own
     * motion, so they answer a drag, a wheel, a key and a programmatic glide
     * identically — the character responds to THE WORLD MOVING, never to a
     * particular input device.
     */
    let pitch = 0;
    let charLift = 0;
    let camYPrev = 0;
    let blinkAt = 0;
    let blink = 0;
    /* motes rising off the aura when the companion is genuinely inspired */
    const upX = new Float32Array(10);
    const upY = new Float32Array(10);
    const upA = new Float32Array(10);
    /* The companion is the messenger: while something is forming above, it
       glances up now and then and lets a mote go toward the sky. */
    /** The occasional clock: a look-around every 30–60s, on any archive. */
    let idleAt = 0;
    /** The last thing it said, so it never says the same thing twice running. */
    let lastSaid = "";
    /** the pairable set as a string, so React only hears about real changes */
    let pairSig = "";
    let glanceAt = 0;
    let glanceUntil = 0;
    let riseAt = 0;
    const riseX = new Float32Array(4);
    const riseY = new Float32Array(4);
    const riseA = new Float32Array(4);
    const inspTop = new Float32Array(8);
    let freshToday = false;
    let motesPlaced = false;

    /* Painter's order for the shadow+body pass: bottom-most orb first, so an
       orb's contact shadow lands ON whatever it is resting against and is
       then covered by the orb itself. Insertion sort over a preallocated
       index array — O(n) on the near-sorted frame-to-frame case, and it
       allocates nothing. */
    const order: number[] = list.map((_, i) => i);
    function sortByDepth(arr: Ball[], ord: number[]) {
      for (let i = 1; i < ord.length; i++) {
        const v = ord[i];
        const y = arr[v].y;
        let j = i - 1;
        while (j >= 0 && arr[ord[j]].y < y) {
          ord[j + 1] = ord[j];
          j--;
        }
        ord[j + 1] = v;
      }
    }

    function wake() {
      lastActive = performance.now();
      /* ANY REAL EVENT WAKES THE WORLD, at once and to full amplitude. wake()
         is what every one of them already calls — a touch, the pour, a scrub,
         a relight, a travel, an adoption, a room arriving — so the world's
         attention and the loop's attention are the same thing. */
      stirAt = lastActive;
      settle = 1;
      if (!running) {
        running = true;
        prev = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }

    /**
     * Assign every present orb a HOME in the field. Called once the ball set
     * is known and again whenever it changes (resize, scrub, pour), so the
     * field always fills the space it has and the peek is exact by
     * construction rather than by a servo chasing a settling pile.
     *
     * homeY carries TIME, as it always has: rank by capturedAt, not raw date,
     * so the archive's June-July gap leaves no void. The newest share the
     * peek row in section A; everything older fills section B from just under
     * the boundary down to the dial.
     */
    /**
     * THE GROUND BELONGS TO THE WALL YOU ARE STANDING ON.
     *
     * Every wall's memories live in one list, and the layout and the draw both
     * walked all of it — so your own wall showed your memories, your agents'
     * and every room's at once, in every hue, and no wall ever showed only its
     * own. The wall filter existed in exactly one place (the aliveness pass)
     * and nowhere that renders.
     *
     * This is the correct reading of "the field does not slide sideways": it
     * does not SLIDE. It does change — what is standing on the ground is whose
     * mind you are in.
     */
    const onThisWall = (b: Ball): boolean => (b.agentId ?? "") === curWall().id;

    function assignHomes() {
      const present: Ball[] = [];
      for (const b of list)
        if (b.capturedMs <= TRef.current && onThisWall(b)) present.push(b);
      present.sort((a, b) => a.capturedMs - b.capturedMs); /* oldest first */
      const n = present.length;
      if (n === 0) return;

      const spanL = world.wallL;
      const spanR = world.wallR;

      /* THE BAND IS THE WHOLE SCREEN, LESS THE ONE PIECE OF CHROME ON IT.
         Standing in the field the camera sees world [vh, 2vh]; the dial owns
         its measured strip at the bottom of that, and nothing else is owed
         anything. Every orb's own radius and drift are then held off both
         edges by its `clear`, so the promise is exact by construction at every
         viewport height rather than at the two that happened to get looked at.
         (The old band started 18px below the boundary and stopped 132px above
         it — a fixed reserve that ate a tenth of a tall screen and a quarter
         of a short one, which is the bug.) */
      const yTopEdge = vh + FIELD_EDGE;
      const yBotEdge = world.fieldBottom;

      /* FIT FIRST. Every orb is sized to the band it has to share before a
         single one of them is placed. */
      const crowd = fitField(present, spanR - spanL, yBotEdge - yTopEdge);
      const gamma = lerp(1, 1.9, crowd);

      /* EVERY MEMORY GETS A PLACE IN THE FIELD — the peek row included. The
         rank maps across the whole band; depth carries time, newest at the
         surface and oldest at the floor. Past the radius floor the oldest draw
         together into sediment rather than anything leaving the screen: the
         curve steepens, so the deep end holds more of them in less room, which
         is what sediment IS. */
      const px: number[] = [];
      const py: number[] = [];
      for (let i = 0; i < n; i++) {
        const b = present[i];
        const u = n > 1 ? i / (n - 1) : 0; /* 0 oldest → 1 newest */
        const clear = b.r + b.ampY;
        const yTop = yTopEdge + clear;
        const yBot = yBotEdge - clear;
        const jitter = (b.frac - 0.5) * 0.04;
        const age = clamp01(1 - u + jitter); /* 1 oldest → 0 newest */
        const y = clamp(lerp(yTop, yBot, Math.pow(age, 1 / gamma)), yTop, yBot);
        b.homeY = y;
        b.homeX = scatterX(b, y, px, py, spanL, spanR);
        px.push(b.homeX);
        py.push(b.homeY);
      }
      electPeek(present);
    }

    /**
     * WHICH MEMORIES THIS WALL'S CLAIM RESTS ON, and where they rise to.
     *
     * These are the orbs that LED TO THE AMBITION — the raw captures its
     * readings were grounded in — so what peeks under the poster is its
     * provenance, not merely what is newest. When the provenance is unknown
     * (nothing adopted yet, or none of its evidence is in this archive) it
     * falls back to the newest few, which is the only honest thing left.
     *
     * The row is re-elected every time the wall changes, and that is the whole
     * image of the direction: the field beneath is ALWAYS yours and never
     * moves, and each wall lifts a different handful of it up under its own
     * claim. Your memories are the ground; the walls are what different
     * contexts make of them.
     */
    function electPeek(present: Ball[]) {
      for (const b of list) b.peek = false;
      const n = present.length;
      if (n === 0) return;
      const rowSet: Ball[] = [];
      if (provenance.size > 0) {
        for (const b of present) if (provenance.has(b.id)) rowSet.push(b);
        /* newest first, so a long provenance shows its freshest end */
        rowSet.sort((a, b) => b.capturedMs - a.capturedMs);
        rowSet.length = Math.min(rowSet.length, PEEK_MAX);
      }
      if (rowSet.length === 0) {
        const rowN0 = Math.min(PEEK_ORBS, n);
        for (let i = 0; i < rowN0; i++) rowSet.push(present[n - 1 - i]);
      }
      const rowN = rowSet.length;
      const spanL = world.wallL;
      const spanR = world.wallR;
      const top = world.fieldTop;
      /* the peek is EXACT: the highest top edge in the row, drift included,
         lands on the line — so the promise is the same 96px at every height */
      let lift = Infinity;
      for (const b of rowSet) lift = Math.min(lift, b.frac * 12);
      const px: number[] = [];
      const py: number[] = [];
      const colW = (spanR - spanL) / rowN;
      for (let k = 0; k < rowN; k++) {
        const b = rowSet[k];
        b.peek = true;
        b.peekY = top + b.r + b.ampY + b.frac * 12 - lift;
        /* stratified columns keep the row from clumping at this density */
        const lo = spanL + colW * k;
        let x = scatterX(b, b.peekY, px, py, lo, lo + colW);
        /* and the row parts around the companion rather than drifting through
           it — they share this strip of headquarters. The companion is
           screen-anchored, and so is the field, so this is the screen middle
           on every wall. */
        /* AND THEY PART AROUND THE COMPANION WITHOUT PILING UP ON ITS EDGE.
           This snapped every orb inside the keep-zone to the SAME x — the
           zone's rim — so with one or two it read as parting, and with a
           roomful they stacked into a vertical column at exactly that
           coordinate: a smear of orbs over the poster, cold at the top and
           warm at the bottom because you were reading the aliveness ramp
           straight down a pile.

           The zone is a place they cannot BE, not a place they must go. So a
           displaced orb re-scatters into whichever side band it was already
           nearer, through the same collision-aware scatter as everything else
           — which is what keeps them off each other. */
        const keep = charSize * 0.72 + b.r;
        if (Math.abs(x - vw / 2) < keep) {
          const leftLo = spanL + b.r;
          const leftHi = vw / 2 - keep;
          const rightLo = vw / 2 + keep;
          const rightHi = spanR - b.r;
          const goLeft = x < vw / 2 ? leftHi > leftLo : rightHi <= rightLo;
          x = goLeft
            ? scatterX(b, b.peekY, px, py, leftLo, Math.max(leftLo, leftHi))
            : scatterX(b, b.peekY, px, py, Math.min(rightLo, rightHi), rightHi);
          x = clamp(x, spanL + b.r, spanR - b.r);
        }
        b.peekX = x;
        px.push(x);
        py.push(b.peekY);
      }
    }

    /**
     * HOW FAR A PEEK ORB HAS RISEN OUT OF THE GROUND. One at headquarters (and
     * in the sky, looking down on it), nothing at the field's rest. It is the
     * camera's own position and never a timer, so the memories rise to meet
     * the claim as you climb and settle back as you descend — the world moves
     * only because you moved it.
     */
    function peekLift(): number {
      return clamp01(1 - camY / Math.max(world.maxCam, 1));
    }

    /**
     * WHERE THE WORDS ARE, RIGHT NOW — read off the mouth itself rather than
     * guessed at from the seam constant, so a newborn leaves from the middle
     * of the sentence that made it however many lines it had wrapped to.
     *
     * One layout read, on a discrete act, never in the frame loop. `y` is a
     * world coordinate (the mouth rides the camera at 1x, so screen + camY);
     * `x` is the field's own, which is the column's screen x — the ground is
     * solved between world.wallL and world.wallR and the mouth stands over
     * the middle of it.
     */
    function mouthSpot(): { x: number; y: number } | null {
      const el = mouthSpotRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const rr = root!.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - rr.left,
        y: r.top + r.height / 2 - rr.top + camY,
      };
    }

    /**
     * Take one ball out of the ground for good. The ONLY caller is the
     * retraction of a newborn whose keep did not land — a promise, not a
     * memory — and the field re-fits over the gap exactly as it does when the
     * dial scrubs one away.
     */
    function dropBall(i: number) {
      const b = list[i];
      if (selectedIdRef.current === b.id) release();
      if (pressId === b.id) pressId = null;
      if (heldBall === b) heldBall = null;
      list.splice(i, 1);
      byId.delete(b.id);
      /* the depth order is an index permutation over `list`: it has to be
         rebuilt, not spliced, or every index past `i` points one ball over */
      order.length = list.length;
      for (let k = 0; k < list.length; k++) order[k] = k;
      assignHomes();
      computeInspiration();
    }

    /* ---------------- walls: what stands on the horizontal axis (v10) ----------------
       A wall is a column. Column zero is you; agents stand to the LEFT and
       rooms to the RIGHT, so direction MEANS kind and that is most of the
       wayfinding for free.

       WHAT A WALL DOES NOT HAVE IS A FIELD. The bottom section is always the
       full set of the owner's own inspirations, identical on every wall, and
       it does not slide sideways when you travel — the upper sections move
       between walls while the memories stay put beneath them. Rooms used to
       build a field out of their cited evidence and that is gone: your
       memories are the ground, and the walls are what different contexts make
       of them. What still varies per wall is what stands ABOVE: its adopted
       ambition, its sky of forming candidates, and which memories its claim
       rests on — the peek row. */
    const SELF_WALL: Wall = { kind: "self", id: "", name: "Waka", col: 0 };
    const wallAt = (c: number): Wall =>
      wallsRef.current.find((w) => w.col === c) ?? SELF_WALL;
    const curWall = () => wallAt(col);
    /**
     * WHOSE FORM THE COMPANION IS WEARING, THIS FRAME.
     *
     * ONE companion, and it CHANGES — the founder's ruling, and the reason is
     * that the thing which is always on screen should be the thing that says
     * where you are. Cross into an agent's column and your companion is that
     * agent: its own proportions, hash-derived from its id so it is stable,
     * and its body SNAPPED TO A GRID. Pixels are not decoration here; they are
     * the one mark that separates a kind of mind from an individual, and the
     * owner's smooth hand-made form is never producible by any hash.
     *
     * It reads off the LIVE camera column, not the arrival state, so the form
     * turns over mid-crossing: the travel is what explains the change, which
     * is the only way this world is allowed to change anything.
     *
     * `bakeBeing` caches by key, so this is a Map lookup after the first
     * frame on a wall — no gradient is ever made inside the loop.
     */
    /**
     * IT TRAVELS FIRST, AND CHANGES ON ARRIVAL.
     *
     * This read the live camera column, so the form turned over halfway
     * across — which is the thing that reads as your companion becoming a
     * stranger while you watch it. Every system that changes a creature's
     * form and survives it does the same three things: the change is
     * WITNESSED as an event rather than found already done, something
     * visibly carries across, and it happens at a moment the person caused.
     * Pokémon holds the nickname and the whole history through a light
     * envelope that never cuts; the change is a beat, not a state you
     * discover.
     *
     * So the being is read from the wall the traveller has ARRIVED at.
     * Crossing, it is still yours. Landing on an agent's wall, it snaps to
     * the grid on the same beat the wall wakes — one event, caused by you.
     * Two things never change either way: the eye spacing and the colour
     * temperature of its light. Those are what say it is still the same one.
     */
    /**
     * A ROOM IS NOT A BEING, SO IT DOES NOT GET A BODY OF ITS OWN.
     *
     * `agentBeing(id)` derives a form by hashing an AGENT PROFILE's id — give
     * it a group id and it happily returns a body belonging to nobody, baked
     * at whatever proportions that hash lands on. That is what produced the
     * enormous blurred shape over the poster: a real function, asked a
     * question it has no answer to.
     *
     * The right answer is also the truer one: in a machine's room it is still
     * YOUR companion standing there — you walked in. It keeps its own form
     * and wears the room's resolution, which is exactly what the pixelated
     * orbs and the machine hand are already saying. Only an agent's own wall
     * has a resident with a body of its own.
     */
    const wornBeing = (): Being =>
      curWall().kind === "agent" ? agentBeing(curWall().id) : OWNER_BEING;
    const worn = (
      pal: Palette,
    ): { be: Being; body: HTMLCanvasElement[]; aura: HTMLCanvasElement[] } => {
      const w = curWall();
      /* REVERTED: a machine's ROOM does not re-body the companion.
         Two attempts at giving a room a pixelated body both shipped a broken
         shape over the poster — first a form hashed from a group id, then the
         owner's form baked through the machine path. The body pipeline bakes
         per-BEING and is keyed to a resident that a room does not have, so
         this needs to be done properly with a room-specific bake rather than
         by borrowing the agent path. Until then the companion is unchanged in
         a room, and the room still says what it is through its typography and
         its quantized motion, which both work. */
      if (w.kind !== "agent") return { be: OWNER_BEING, body: pal.body, aura: pal.auraLayers };
      const be = agentBeing(w.id);
      const s = bakeBeing(pal, `${w.kind}:${w.id}`, be, true, true);
      /* the AURA is never pixelated: its colour temperature is one of the two
         invariants that say this is still the same companion, and a stepped
         halo would break the one thing carrying continuity across the change */
      return { be, body: s.body, aura: pal.auraLayers };
    };
    const colLo = () => wallsRef.current[0]?.col ?? 0;
    const colHi = () => wallsRef.current[wallsRef.current.length - 1]?.col ?? 0;
    const minCamNow = () => (hasSky(curWall().kind) ? world.minCam : 0);
    /**
     * THE PLACES THE CAMERA MAY REST, in order, and the ONE definition of
     * them. The array used to be written out at each of the three sites that
     * needed it, keyed off `col === 0` — which disagreed with `minCamNow`
     * about whether an agent's wall has a sky, so on those walls the band let
     * the camera into a section the snap would not rest in. Derived from the
     * same bound the rubber-band uses, the two can no longer drift apart.
     */
    const restPoints = (): number[] => {
      const lo = minCamNow();
      return lo < 0 ? [lo, 0, world.maxCam] : [0, world.maxCam];
    };

    function findBall(id: string): Ball | undefined {
      return byId.get(id) ?? roomBallsRef.current.get(id);
    }

    /**
     * There is exactly one field now, so this is one array — kept as a helper
     * because the satellites' own balls (another member's save, standing in a
     * room proposal's orbit) still live outside it and must not be swept.
     */
    function allBalls(cb: (arr: Ball[]) => void) {
      cb(list);
    }

    /**
     * A RESIDENT: the being whose wall this is.
     *
     * The owner's companion travels — it is the one that walks ahead of you
     * between walls — and an agent's does not: it is anchored to its column.
     * So on an agent's wall there are exactly two beings, the resident and the
     * visitor who arrived, and on your own wall the resident and the visitor
     * are the same being, so there is exactly one. Home is where there is only
     * one of you.
     */
    interface Resident {
      wall: Wall;
      being: Being;
      sprites: BeingSprites;
      /** its own aliveness: the memories IT kept, and how alive they still are */
      insp: number;
      inspNow: number;
      yaw: number;
      /** where its attention rests: + down into the field, − up at its sky */
      lat: number;
      latWant: number;
      bobPh: number;
      blinkAt: number;
      blink: number;
      /** the second beat of a double blink, when this being has one */
      blinkAgain: number;
      glanceAt: number;
      /** it turns to you once on arrival, holds a beat, then goes back to work */
      greetUntil: number;
    }
    const residents = new Map<number, Resident>();

    /**
     * The resident's own light: the top-eight aliveness of the memories THIS
     * agent kept. An agent idle for a month has a cold end of the field and a
     * dim companion, and that IS the last-active readout — better than a
     * timestamp, and in the one channel this page reserves for meaning.
     */
    function residentInsp(res: Resident) {
      const top = inspTop;
      for (let i = 0; i < 8; i++) top[i] = 0;
      let n = 0;
      for (const b of list) {
        if (b.agentId !== res.wall.id || !b.active || b.leaving) continue;
        n++;
        for (let i = 0; i < 8; i++) {
          if (b.alive > top[i]) {
            for (let j = 7; j > i; j--) top[j] = top[j - 1];
            top[i] = b.alive;
            break;
          }
        }
      }
      /* HOW ALIVE, TIMES HOW MUCH — AND IT USED TO BE ONLY THE FIRST.
         This divided by `min(8, n)`, which makes the number a MEAN of the
         brightest few: a wall holding one fresh memory scored `sum/1` and
         came out exactly as bright as a wall holding two hundred. That is
         why an agent with a handful of notes glowed like a wall worked on
         every day — the light was reporting the best memory on each wall
         rather than how alive the wall is.

         Activeness needs both terms. The top-8 mean stays as the quality
         term; a volume term scales it by how much there is to be alive, and
         it saturates at eight because past that the difference between a busy
         wall and a very busy wall is not something light should try to say.
         The square root keeps a genuinely tended small wall visible rather
         than crushing it: one memory reads at about a third, four at about
         seven tenths, eight and up at full. */
      const k = Math.min(8, Math.max(n, 1));
      let sum = 0;
      for (let i = 0; i < k; i++) sum += top[i];
      const quality = sum / k;
      const volume = Math.sqrt(Math.min(n, 8) / 8);
      res.insp = clamp01(quality * volume);
    }

    /**
     * A wall's being, baked once and held for the session. Nothing renders
     * half-loaded: the sprites exist before the column is ever drawn.
     */
    function ensureResident(w: Wall): Resident | null {
      if (w.kind !== "agent") return null;
      const got = residents.get(w.col);
      if (got && got.wall.id === w.id) return got;
      const pal = paletteRef.current;
      if (!pal) return null;
      const being = agentBeing(w.id);
      const res: Resident = {
        wall: w,
        being,
        sprites: bakeBeing(pal, `${w.kind}:${w.id}`, being, true, true),
        insp: 0,
        inspNow: 0,
        yaw: 0,
        /* it is looking down at its own memories when you find it */
        lat: 0.34,
        latWant: 0.34,
        bobPh: unit(w.id, "bob0") * TAU,
        blinkAt: 0,
        blink: 0,
        blinkAgain: 0,
        glanceAt: 0,
        greetUntil: 0,
      };
      residents.set(w.col, res);
      residentInsp(res);
      res.inspNow = res.insp;
      return res;
    }

    /**
     * THE WAKE. Fired only when the traveler has arrived AND the wall's data
     * is whole — single appearance, never a half-rendered wall; if the data is
     * late the character waits and the column holds still.
     *
     * What wakes is no longer a field (there is one field and it never left):
     * it is the wall's words, its sky, the peek row its claim rests on, and —
     * on an agent's wall — the resident turning to look at you once.
     */
    function tryWakeWall() {
      if (travelActive) return;
      const w = curWall();
      if (w.kind === "room") {
        const entry = roomCacheRef.current.get(w.id);
        if (!entry || entry.status === "pending") {
          awaitingWake = true;
          return;
        }
        awaitingWake = false;
        if (entry.status === "failed" || !entry.data) return; /* React whispers it */
        if (!roomVisitedRef.current.has(w.id)) {
          roomVisitedRef.current.add(w.id);
          pushWokenRef.current(w.id);
        }
      } else {
        awaitingWake = false;
      }
      /* the wall's claim lifts its own handful of the ground */
      provenance = wallProv.get(wallKey(w)) ?? new Map();
      electPeek(presentBalls());
      const res = ensureResident(w);
      if (res) {
        residentInsp(res);
        /* ---- THERE IS NO SECOND BEING, BY RULING ----
           This was built toward two companions in frame — yours, and the wall's
           own resident looking up at you. The founder chose ONE that changes
           instead: the thing always on screen is the thing that says where you
           are, and a machine's wall wears a machine's form (see `worn`).

           What survives here is the per-wall aliveness, which is a real number
           about a real wall. `greetUntil` and the yaw/blink state below are
           vestigial: nothing draws them. They are left rather than deleted
           because the wake path is load-bearing and this is not the pass to
           re-time it — but nothing in this block reaches the screen. */
        res.greetUntil = performance.now() + (reduced ? 0 : 1500);
      }
      flare = Math.max(flare, reduced ? 0 : 0.35);
      wake();
    }

    /** Every memory that exists at the dial's time, oldest first. */
    function presentBalls(): Ball[] {
      const out: Ball[] = [];
      for (const b of list)
        if (b.capturedMs <= TRef.current && onThisWall(b)) out.push(b);
      out.sort((a, b) => a.capturedMs - b.capturedMs);
      return out;
    }

    /** Arrival: the character decelerates, turns back front, the wall wakes. */
    function arriveColumn() {
      /* it looks around whatever it has just walked into */
      simApiRef.current?.acknowledge("arrived");
      travelYaw = false;
      unwindAt = 0; /* the unwind branch turns it back front, the short way */
      wheelXUntil = performance.now() + 120;
      pushArrivedRef.current(curWall());
      /* THE GROUND IS RE-SOLVED FOR WHOEVER'S WALL THIS IS.
         Arriving changes which memories are standing on it, so the layout has
         to run again — without this the previous wall's homes stay assigned
         and the new wall's memories have nowhere to be. */
      assignHomes();
      electPeek(presentBalls());
      tryWakeWall();
    }

    /**
     * THE TRAVELER. The companion leads every transition: it turns toward
     * the edge (the same planet turnaround the dial winds), glides ahead
     * over ~450ms, and the world sets off ~140ms behind it, sliding the next
     * room in under the character. Travel starts the destination's fetch,
     * moves exactly one column, and only begins from a vertical rest point —
     * never mid-sky. Reduced motion: an instant column switch.
     */
    /**
     * TRAVEL IS A THING YOU DO ABOVE THE GROUND.
     *
     * It used to be allowed from headquarters and from the field alike, back
     * when every column carried a jar of its own and there was something
     * different down there to travel to. There is one field now and it is the
     * same field on every wall, so a sideways gesture in it would slide the
     * world and change nothing — the definition of motion that explains no
     * mechanism. So the field section refuses travel outright: no drag, no
     * sideways wheel, no arrow keys, and no edge affordance is drawn there to
     * offer one. Above it — headquarters and the sky — travel is unchanged.
     */
    function canTravelHere(): boolean {
      if (camAiming) return false;
      const atHQ = Math.abs(camY) < 2;
      const atSky = hasSky(curWall().kind) && Math.abs(camY - world.minCam) < 2;
      return atHQ || atSky;
    }

    /**
     * How long THIS glide takes. One wall is the constant; several walls in
     * one movement take longer but not proportionally — the square root is
     * the difference between "a long corridor" and "sitting through five
     * animations". Five walls come out at about 2.2x one wall rather than 5x.
     */
    let travelMs = TRAVEL_MS;
    const travelSpanMs = (walls: number) =>
      TRAVEL_MS * Math.sqrt(Math.max(1, Math.abs(walls)));

    function travel(dir: 1 | -1) {
      if (camAiming) return;
      if (travelActive) {
        /* REVERSAL. The opposite key mid-flight retargets to the other end
           of the segment — the character turns first (the turn IS the
           acknowledgment) and leads back; being able to change your mind is
           what kills the trapped feeling. The same direction stays ignored:
           one column per gesture. */
        if (dir === travelDir) return;
        const back = travelDest === col ? col + dir : col;
        if (back < colLo() || back > colHi()) return;
        loadWallRef.current(wallAt(back));
        travelDest = back;
        travelDir = dir;
        camXTarget = back * vw;
        travelFromX = camX;
        travelAt = performance.now();
        charFrom = charOff;
        charLead = dir * Math.min(vw * TRAVEL_LEAD_X, 190);
        yawTarget = dir * (TAU / 4);
        unwindAt = 0;
        awaitingWake = false;
        wake();
        return;
      }
      if (!canTravelHere()) return;
      const dest = col + dir;
      if (dest < colLo() || dest > colHi()) return;
      if (selectedIdRef.current) release();
      loadWallRef.current(wallAt(dest));
      awaitingWake = false;
      travelDest = dest;
      travelDir = dir;
      camXTarget = dest * vw;
      camXBack = false;
      dragLeadOn = false; /* the travel choreography owns the lead now */
      if (reduced) {
        col = dest;
        camX = camXTarget;
        charOff = 0;
        arriveColumn();
        wake();
        return;
      }
      travelActive = true;
      travelMs = TRAVEL_MS;
      travelAt = performance.now();
      travelFromX = camX;
      charLead = travelDir * Math.min(vw * TRAVEL_LEAD_X, 190);
      charFrom = charOff;
      travelYaw = true;
      yawTarget = travelDir * (TAU / 4);
      unwindAt = 0;
      wake();
    }

    /* ---------------- the sky: where ambitions are still forming ----------------
       Section S is one viewport ABOVE headquarters. Its inhabitants are the
       candidates — the room's pending proposal, the provisional readings, and
       any draft the person assembles here — and each one is a NEBULA: light
       that has not condensed into an ambition yet. The canvas carries the
       light; the DOM carries the sentence, so the words stay crisp and
       selectable. */

    /* what THIS wall's ambition was built from; its peek row is made of these */
    let provenance: Provenance = new Map();
    /* and every wall's, so arriving on one can lift its own handful */
    let wallProv: Map<string, Provenance> = new Map();

    let nebs: Neb[] = [];
    /* the cluster signature last handed to React, so the loop can push a
       discrete fact without pushing it sixty times a second */
    let clusterSig = "";
    let skyShown = false;
    /* who belongs to a cluster right now, and which cloud the pointer is on:
       clustered sentences whisper, the touched one comes back to full */
    let clusterMembers = new Set<string>();
    let hoverNeb: Neb | null = null;
    /**
     * THE SUBJECT: the one candidate carrying its evidence right now, or none.
     * At rest the sky is sentences and bodies only — a skyful of orbiting
     * evidence was unreadable, and it was the satellites that made it so.
     * Exactly one at a time, because the point of the tap is to be able to
     * read one claim's provenance without the others in the way.
     */
    let focusNeb: Neb | null = null;
    /* which satellite the pointer (or a finger) is on: its owner's given name
       is whispered beside it, and it is what a tap would open */
    let hoverSat: Sat | null = null;
    let satSaid = "";
    /* how wide that name came out, measured once when it CHANGES — the loop
       needs it every frame to decide which side of the satellite it fits on,
       and reading offsetWidth per frame would force a layout per frame */
    let satSayW = 0;
    /* the satellite a selection came FROM, so the reading panel sits beside
       the satellite that was tapped rather than beside the memory's own place
       in a field a whole section below */
    let selSat: Sat | null = null;
    /* a satellite's memory can live in a room column that has never been
       built, so it is held directly and released directly */
    let heldBall: Ball | null = null;
    /* tier-one persistence: where the clouds were left, last session */
    const savedSky = readSkyLayout();

    /** Write-through: every placed cloud's spot, pruned to what exists now.
        (Clusters persist by falling out of the restored positions.) */
    function persistSky() {
      const layout: Record<string, { x: number; y: number }> = {};
      for (const n of nebs) {
        if (n.gone > 0 || !n.pinned) continue;
        /* stored relative to the wall it belongs to: a new agent arriving
           shifts every column, and a spot remembered in world coordinates
           would come back on somebody else's wall */
        layout[n.id] = { x: Math.round(n.x - n.col * vw), y: Math.round(n.y) };
      }
      writeSkyLayout(layout);
    }

    /** Which column a room's memories belong to; zero when it is not on the
        map yet, which only ever reads as "this is a room's memory". */
    function colOfGroup(groupId: string): number {
      const i = groupsRef.current.findIndex((g) => g.id === groupId);
      return i < 0 ? 0 : i + 1;
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
    function makeSat(nebId: string, e: EvidenceRef): Sat | null {
      const mine = byId.get(e.signalId);
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
        let rb = roomBallsRef.current.get(id);
        if (!rb) {
          rb = makeRoomBall(
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
            colOfGroup(e.groupId),
            viewerIdRef.current,
          );
          rb.noDate = !e.dated;
          roomBallsRef.current.set(id, rb);
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
    function solveSats(n: Neb, c: Candidate) {
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
        const s = makeSat(n.id, e);
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

    function makeNeb(c: Candidate, i: number): Neb {
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
      solveSats(n, c);
      return n;
    }

    /**
     * The widest orbit this viewport can actually hold: the most a pad may be
     * (SKY_PAD_X of the viewport), less the edge it is kept clear of, less the
     * drift it swings by, and less the growth it takes on when it becomes the
     * subject — because the pad covers the solved radius, and those three are
     * what the solved radius does not include. clampHome's pad is written from
     * the same three, so the cap and the pad can never disagree.
     */
    function orbFitX(n: Neb) {
      return Math.max(24, (vw * SKY_PAD_X - SKY_EDGE - n.ampX) / (1 + FOCUS_POP));
    }
    function orbFitY(n: Neb) {
      return Math.max(24, (vh * SKY_PAD_Y - SKY_EDGE - n.ampY) / (1 + FOCUS_POP));
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
    function measureNeb(n: Neb) {
      const el = nebElsRef.current.get(n.id);
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
      const fitX = orbFitX(n);
      const fitY = orbFitY(n);
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

    /**
     * Homes in section S. The proposal is the largest and sits nearest the
     * centre — it is a whole ambition, not a fragment; the readings orbit it
     * on a wide ellipse. A nebula the person has MOVED keeps where it was put
     * (for this session — there is no endpoint to persist a sky layout to).
     */
    /**
     * A candidate is parked where its whole SYSTEM fits, not merely where its
     * cloud does: tapping it must never send half an orbit past an edge, and
     * the answer to that is where it rests — never a camera move at the moment
     * of the tap. It binds a dragged-and-kept position too: a spot restored
     * from a previous session was chosen against a different viewport.
     */
    function clampHome(n: Neb) {
      /* the system at its WIDEST, not at its average: the subject sits
         FOCUS_POP bigger, and every candidate drifts by its own amplitude, so
         a pad measured from the solved radius alone would still let the far
         side of the ring cross an edge on the swing. measureNeb has already
         cut the orbit to something a pad this size can cover, so the caps
         below are a floor under a pathological viewport, not the normal path. */
      const padX = Math.min(
        Math.max(n.r * 0.5, n.orbRx * (1 + FOCUS_POP) + n.ampX) + SKY_EDGE,
        vw * SKY_PAD_X,
      );
      const padY = Math.min(
        Math.max(n.r * 0.5, n.orbRy * (1 + FOCUS_POP) + n.ampY) + SKY_EDGE,
        vh * SKY_PAD_Y,
      );
      /* every sky is its own column wide, and no candidate ever wanders out
         of the wall it belongs to */
      const off = n.col * vw;
      n.homeX = clamp(n.homeX, off + padX, Math.max(off + padX, off + vw - padX));
      /* the pads are capped at a fraction of the viewport, so this range is
         never empty however tall the words wrapped */
      n.homeY = clamp(n.homeY, world.minCam + padY + 28, -padY);
    }

    function layoutSky() {
      const cy = world.minCam + vh * 0.46;
      const base = Math.min(vw, vh);
      const ring = Math.min(vw * 0.3, vh * 0.27);
      /* each wall's sky is laid out in its own column, around its own centre */
      const rank = new Map<number, number>();
      for (const n of nebs) {
        const cx = n.col * vw + vw / 2;
        n.r = n.kind === "proposal" ? base * 0.21 : base * (n.kind === "draft" ? 0.19 : 0.15);
        /* the words first: the orbit and the keep-out both come off them */
        measureNeb(n);
        if (!n.pinned) {
          if (n.kind === "proposal") {
            n.homeX = cx + (n.frac - 0.5) * 30;
            n.homeY = cy - base * 0.04;
          } else {
            const orbiting = nebs.filter((q) => q.col === n.col && q.kind !== "proposal").length;
            const k = rank.get(n.col) ?? 0;
            rank.set(n.col, k + 1);
            const a = (k / Math.max(orbiting, 1)) * TAU + n.frac * 0.7;
            n.homeX = cx + Math.cos(a) * ring * (0.86 + n.frac * 0.3);
            n.homeY = cy + Math.sin(a) * ring * 0.6 + base * 0.03;
          }
        }
        clampHome(n);
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
        for (let i = 0; i < nebs.length; i++) {
          const a = nebs[i];
          if (a.gone > 0) continue;
          for (let j = i + 1; j < nebs.length; j++) {
            const b = nebs[j];
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
        for (const n of nebs) clampHome(n);
      }

      for (const n of nebs) {
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
      placeSats(nowMs / 1000, nowMs);
    }

    /** Rebuild the sky from the candidate list, keeping what is already up. */
    function syncSky(list: Candidate[]) {
      const prev = new Map(nebs.map((n) => [n.id, n] as const));
      const next: Neb[] = [];
      /* the cap is PER SKY: a skyful is a skyful on each wall, and a room full
         of agents must not crowd your own sky out of its own ceiling */
      const perCol = new Map<number, number>();
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const taken = perCol.get(c.col) ?? 0;
        if (taken >= SKY_MAX) continue;
        perCol.set(c.col, taken + 1);
        const had = prev.get(c.id);
        if (had) {
          /* the sky cannot exist before the captures do, so this is never a
             late arrival — it is a candidate whose evidence genuinely
             changed (a draft re-drafted), re-solved once. Phases are hashed
             per candidate-and-memory, so every surviving satellite keeps the
             exact place on the ellipse it already had. */
          if (had.evSig !== c.evidence.map((e) => e.signalId).join(",")) solveSats(had, c);
          next.push(had);
          continue;
        }
        const n = makeNeb(c, i);
        /* a draft is born between the nebulae it was drawn from */
        if (c.originIds.length > 0) {
          let sx = 0;
          let sy = 0;
          let hits = 0;
          for (const oid of c.originIds) {
            const o = prev.get(oid);
            if (o) {
              sx += o.x;
              sy += o.y;
              hits++;
            }
          }
          if (hits > 0) {
            n.x = sx / hits;
            n.y = sy / hits;
            n.homeX = n.x;
            n.homeY = n.y;
            n.pinned = true;
          }
        }
        /* a place this candidate was left at in an earlier session comes
           back BEFORE the sky is ever seen — no jump — clamped into the
           sky this viewport actually has */
        const saved = savedSky[c.id];
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
          const off = c.col * vw;
          n.x = n.homeX = off + clamp(saved.x, 12, vw - 12);
          n.y = n.homeY = clamp(saved.y, world.minCam + 30, -20);
          n.pinned = true;
        }
        next.push(n);
      }
      nebs = next;
      /* a candidate that has left the sky cannot be the subject of it */
      if (focusNeb && !next.includes(focusNeb)) focusNeb = null;
      /* a selected satellite whose candidate has left the sky has nothing
         left to sit beside */
      const held = selSat;
      if (held && !next.some((n) => n.sats.includes(held))) release();
      layoutSky();
      wake();
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
    function focusOn(n: Neb | null) {
      if (focusNeb === n) return;
      const now = performance.now();
      const leaving = focusNeb;
      if (leaving) {
        leaving.focused = false;
        leaving.focusAt = now;
        leaving.focus0 = leaving.focus;
        for (const s of leaving.sats) s.em0 = s.em;
        /* a memory being read from a system that is closing has nothing left
           to sit beside — the same rule adoption's condense already obeys */
        if (selSat && leaving.sats.includes(selSat)) release();
      }
      focusNeb = n;
      /* A fourth discrete fact leaves the loop: WHICH pattern is the subject.
         Its verdict row hangs off it in the DOM, and it exists only while it
         is the one being read — a sky with a row of buttons under every cloud
         is a settings screen, not a sky. */
      setFocusCandId(n ? n.id : null);
      if (n) {
        /* the words may have re-wrapped since they were last measured (a web
           font arriving late is the usual way), and the orbit is only as
           honest as the box it was solved from */
        measureNeb(n);
        n.focused = true;
        n.focusAt = now;
        n.focus0 = n.focus;
        for (const s of n.sats) s.em0 = s.em;
      }
      wake();
    }

    /** What is under the pointer up in the sky, nearest-first. */
    function nebAt(cx: number, cy: number): Neb | null {
      const wx = cx + camX;
      const wy = cy + camY;
      for (let i = nebs.length - 1; i >= 0; i--) {
        const n = nebs[i];
        if (n.gone > 0.4 || n.condense < 0.99) continue;
        const dx = n.x - wx;
        const dy = n.y - wy;
        /* the cloud is soft; its handle is its bright middle */
        const rr = n.r * NEB_CORE;
        if (dx * dx + dy * dy <= rr * rr) return n;
      }
      return null;
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
    function placeSats(t: number, now: number) {
      for (const n of nebs) {
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
        const dur = reduced ? SAT_FADE_MS : n.focused ? EMERGE_MS : RETRACT_MS;
        for (let i = 0; i < count; i++) {
          const s = n.sats[i];
          /* THE EMERGENCE. One after another, in evidence order, out from the
             sentence's own centre — and back into it in the exact reverse
             order, which is what makes the retraction read as the same
             movement run backwards rather than as a second effect. Reduced
             motion holds the ring at its places and fades it instead. */
          const stagger = reduced
            ? 0
            : n.focused
              ? i * EMERGE_STAGGER
              : (count - 1 - i) * RETRACT_STAGGER;
          const u = clamp01((now - n.focusAt - stagger) / dur);
          s.em = lerp(s.em0, n.focused ? 1 : 0, reduced ? u : easeOut(u));
          /* under reduced motion it never travels: the fade is the whole event */
          const out = reduced ? 1 : s.em;
          if (s.held) {
            /* the memory being read holds still under its panel, exactly as a
               focused orb does — and its phase is re-based while it waits, so
               letting go carries it on from where it stopped rather than
               snapping to wherever it would have travelled to meanwhile */
            s.ph = s.a - (reduced ? 0 : t * w);
          } else {
            s.a = reduced ? s.ph : s.ph + t * w;
          }
          s.x = n.x + Math.cos(s.a) * rx * out;
          s.y = n.y + Math.sin(s.a) * ry * out;
          /* the near half of a shallow ellipse is the lower one */
          s.front = Math.sin(s.a);
          s.dr = s.r * SAT_R * (reduced ? 1 : lerp(EMERGE_SCALE, 1, s.em));
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

    function stepSky(dt: number, now: number, t: number) {
      /**
       * WHAT THIS ONE WOULD JOIN IF YOU LET GO NOW.
       *
       * Nothing on screen said that dragging two patterns together does
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
       * itself. Two patterns near enough to be joined simply lean into each
       * other's light while sitting perfectly still.
       */
      for (const n of nebs) n.pairable = false;
      if (!focusNeb) {
        for (let i = 0; i < nebs.length; i++) {
          const a = nebs[i];
          if (a.gone > 0 || clusterMembers.has(a.id)) continue;
          for (let j = i + 1; j < nebs.length; j++) {
            const b = nebs[j];
            if (b.gone > 0 || clusterMembers.has(b.id)) continue;
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
        const held = nebs.find((n) => n.dragging);
        if (held) {
          let best = Infinity;
          for (const n of nebs) {
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
      for (const n of nebs) {
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
            : clusterMembers.has(n.id) && hoverNeb !== n && !n.dragging
              ? 0.62
              : 1;
        n.dimS = reduced
          ? wantS
          : Math.abs(n.dimS - wantS) < 0.01
            ? wantS
            : lerp(n.dimS, wantS, 1 - Math.pow(0.02, dt));
        /* THE SUBJECT. It eases up in scale on the page's own curve; everything
           else sinks, body and words together, on the field's focus law —
           there is exactly one lit thing on screen and no second tier of
           highlight. */
        const wantN = focusNeb !== null && focusNeb !== n ? 1 : 0;
        n.dimN = reduced
          ? wantN
          : Math.abs(n.dimN - wantN) < 0.01
            ? wantN
            : lerp(n.dimN, wantN, kd(EASE_LIGHT, dt));
        const fu = clamp01((now - n.focusAt) / FOCUS_MS);
        n.focus = reduced
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
        const wantNest = clusterMembers.has(n.id) ? NEST_K : 1;
        if (reduced) {
          n.nest = wantNest;
        } else if (n.nest !== wantNest) {
          const d = dt * (1000 / NEST_MS) * (1 - NEST_K);
          n.nest =
            wantNest < n.nest ? Math.max(wantNest, n.nest - d) : Math.min(wantNest, n.nest + d);
        }
        if (n.condenseAt > 0) {
          const u = clamp01((now - n.condenseAt) / CONDENSE_MS);
          n.condense = reduced ? 0.06 : lerp(1, 0.06, u * u);
        }
        if (n.gone > 0 && n.gone < 1) n.gone = Math.min(1, n.gone + dt * 1.6);
        if (n.dragging) {
          /* EXACTLY 1:1 WITH THE POINTER. This used to lerp at a quarter per
             frame under a comment claiming it was 1:1 — three frames of lag,
             which is forty pixels at a normal drag speed, and onUp then wrote
             that LAGGED position as the cloud's new home. You aimed, and the
             world put it forty pixels short, every time, on the gesture that
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
        const dx = reduced ? 0 : n.ampX * settle * Math.sin(t * n.rateX + n.phX);
        const dy = reduced ? 0 : n.ampY * settle * Math.sin(t * n.rateY + n.phY);
        const k = reduced ? 1 : kd(0.02, dt);
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
        n.haloX = reduced ? n.x : lerp(n.haloX, n.x, kd(1e-3, dt));
        n.haloY = reduced ? n.y : lerp(n.haloY, n.y, kd(1e-3, dt));
      }
      /* They mingle, they never collide — and "collide" now includes the
         WORDS. A candidate's keep-out is whichever of its light and its
         sentence reaches further (measureNeb), so at rest no sentence can sit
         on a neighbour's sentence or on a neighbour's body. A cloud being
         dragged is exempt, as it always was: drawing two together is how a
         draft is gathered. */
      for (let i = 0; i < nebs.length; i++) {
        const a = nebs[i];
        if (a.dragging || a.gone > 0) continue;
        for (let j = i + 1; j < nebs.length; j++) {
          const b = nebs[j];
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
          const minD = clusterMembers.has(a.id) && clusterMembers.has(b.id)
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

      placeSats(t, now);

      /* Focus reaches the orbits too, because a satellite IS a memory: the one
         being read lights, and every other one sinks into the haze with the
         rest of the field. One eased fade each, on the field's own curve. */
      const selId = selectedIdRef.current;
      const selOn = selId !== null;
      for (const n of nebs) {
        for (const s of n.sats) {
          const wantGlow = s.id === selId ? 1 : 0;
          const wantDim = selOn && s.id !== selId ? 1 : 0;
          if (reduced) {
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
    function computeClusters(): string {
      const parent = nebs.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (let i = 0; i < nebs.length; i++)
        for (let j = i + 1; j < nebs.length; j++) {
          const a = nebs[i];
          const b = nebs[j];
          if (a.gone > 0 || b.gone > 0 || a.condenseAt > 0 || b.condenseAt > 0) continue;
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < (a.r + b.r) * (1 - CLUSTER_OVERLAP)) parent[find(i)] = find(j);
        }
      const groups = new Map<number, string[]>();
      for (let i = 0; i < nebs.length; i++) {
        const root = find(i);
        const g = groups.get(root);
        if (g) g.push(nebs[i].id);
        else groups.set(root, [nebs[i].id]);
      }
      const sig: string[] = [];
      for (const ids of groups.values()) if (ids.length > 1) sig.push(ids.join("+"));
      sig.sort();
      return sig.join("|");
    }

    function measure() {
      const rect = root!.getBoundingClientRect();
      vw = Math.max(rect.width, 1);
      vh = Math.max(rect.height, 1);
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(vw * nextDpr);
      canvas!.height = Math.round(vh * nextDpr);
      canvas!.style.width = `${vw}px`;
      canvas!.style.height = `${vh}px`;
      /* DPR changed (zoom / monitor move): halo sprites are rastered in
         device pixels, so they re-raster here. */
      if (nextDpr !== dpr) {
        dpr = nextDpr;
        const pal = paletteRef.current;
        if (pal && pal.dpr !== dpr) paletteRef.current = buildPalette(root!, dpr, ctx!);
      }
      /* THE CHROME STATES ITS OWN SIZE. Reading it beats guessing at it —
         the guess was 92 plus forty of air, which is a fifth of a short
         viewport of field given away for nothing, and on a phone with a home
         indicator the guess was simply wrong. */
      /* The dial is a vertical rail against the right edge now, so it takes
         no height from the field at all — the bottom inset it used to claim
         belongs to the axis of walls. */
      dialH = 0;
      /* WHICH SECTION THE CAMERA IS RESTING ON, read in the world that is
         about to be replaced. The rest points ARE ±vh, so a height change
         MOVES them — and the camera has to arrive on the same section it was
         already on. Without this it keeps its old pixel value and is left
         stranded between two rest points, which breaks the page's own law
         that it never rests between sections; worse, the next arrow press
         then steps from whichever rest point is NEAREST that stranded value,
         which can already be the next section down, so one press moves two.
         (Grow the viewport while standing in the sky and the camera sat at
         the old −vh — a legal position in the new range, so the rubber-band
         had nothing to say about it — and one ArrowDown went to the field.) */
      const prevLo = world.minCam;
      const prevHi = world.maxCam;
      const wasRest = restPoints();
      let sec = 0;
      {
        const ref = camAiming ? camTarget : camY;
        for (let i = 1; i < wasRest.length; i++)
          if (Math.abs(wasRest[i] - ref) < Math.abs(wasRest[sec] - ref)) sec = i;
      }
      world = computeWorld(vw, vh, dialH);
      /* Only when the rest points actually moved: this observer also fires
         for HQ's own content growing, and re-anchoring on that would yank a
         camera the reader is holding. */
      if (primed && (world.minCam !== prevLo || world.maxCam !== prevHi)) {
        const nowRest = restPoints();
        const landing = nowRest[Math.min(sec, nowRest.length - 1)];
        if (camAiming) {
          /* a move in flight keeps its destination's MEANING, not its old
             pixel value: it re-aims at the same section, from where it is */
          camTarget = landing;
          camAimFrom = camY;
          camAimT0 = performance.now();
        } else if (!dragging && !pointerDown) {
          camY = landing;
        }
      }
      /* The companion sits in section A's open middle, between the ambition
         block and the glowing peek below it — the face of the page. Section A
         holds only the ambition now, so this re-centres into the room the
         readings band used to take, and the peek is re-solved below against
         the same measurement. It shrinks before anything else in HQ gives way
         on a short viewport. */
      /* clamp(v, lo, hi) — the arguments were the other way round, which made
         the 150 cap unreachable and let the companion (and its four aura
         layers, which cost radius squared) grow without limit on a tall
         viewport */
      /* Measure the CONTENT block, not .jar-hq: the companion's whisper line
         is an absolutely positioned child of .jar-hq whose top we write from
         charY, and observing that would be a resize feedback loop. */
      const hqH = hqInnerRef.current ? hqInnerRef.current.offsetHeight : 0;
      /* IT SHRINKS BEFORE ANYTHING ELSE IN HQ GIVES WAY — and that promise
         used to be broken by its own floor. charSize was clamped to a hard
         minimum of 84 and the slot was then solved with
         `clamp(v, lo, Math.max(lo, hi))`, which silently prefers `lo` the
         moment the section is too short. Below about 575px of viewport the
         companion stopped tracking the viewport entirely, pinned at 352 while
         the peek row and the dial climbed past it — at vh 400 it sat inside
         the dial scrim. Solve the slot instead of clamping it away: measure
         the room actually available and let the body shrink into it. */
      const gap = 24;
      /* THE MOUTH STANDS ON THE SEAM, so headquarters ends above it rather
         than at it. The strip is a CONSTANT (see MOUTH_H): a reserve measured
         off the mouth's live height would move the companion every time a
         line of typing wrapped, and the world moves only when you move it. */
      const seam = world.fieldTop - MOUTH_H;
      const room = seam - hqH - gap * 2;
      charSize = clamp(vh * 0.14, 84, 150);
      /* The floor yields to the room before the room yields to the floor. The
         shrink must NOT be gated on `room > 0`: a section whose poster already
         fills it has negative room, which is exactly the case that most needs
         the companion small, and skipping the shrink there put the body back
         across the peek line. Below CHAR_MIN the body stops reading as a body,
         so that is where it stops. */
      if (charSize > room) charSize = Math.max(Math.min(room, charSize), CHAR_MIN);
      const lo = hqH + charSize * 0.5 + gap;
      const hi = seam - charSize * 0.5 - gap;
      /* If even 32px cannot fit, `hi` is still below `lo`; split the
         difference rather than always resolving downward into the dial. */
      charY = hi >= lo ? clamp((hqH + seam) / 2, lo, hi) : (lo + hi) / 2;
      const say = charSayRef.current;
      if (say) say.style.top = `${Math.round(charY + charSize * 0.62)}px`;
      /* the columns' DOM measures itself off these — one write per resize */
      root!.style.setProperty("--jar-vw", `${Math.round(vw)}px`);
      root!.style.setProperty("--jar-vh", `${Math.round(vh)}px`);
      /* the seam, so the mouth hangs off exactly the line the field's top
         edge peeks over — one number, measured, never duplicated in CSS */
      root!.style.setProperty("--jar-seam", `${Math.round(world.fieldTop)}px`);

      /* homes are assigned after the companion has its slot, so the peek row
         can be told to keep clear of it */
      assignHomes();
      camXTarget = (travelActive ? travelDest : col) * vw;
      if (!travelActive && !camXBack) camX = col * vw;
      if (!primed) {
        /* first sizing: everything starts on its home, then pours or fades in */
        for (const b of list) {
          b.x = b.homeX;
          b.y = b.homeY;
        }
      }
      primed = true;
      /* homes for the sky's inhabitants, in the viewport they now have */
      layoutSky();
      /* The volume is a real, world-tall gradient: the sky at the top is a
         different place from the deep. It starts one viewport above HQ, so it
         covers all three sections. */
      const atmos = atmosRef.current;
      if (atmos) {
        atmos.style.top = `${Math.round(world.minCam)}px`;
        atmos.style.height = `${Math.round(world.worldH - world.minCam)}px`;
      }
      if (!motesPlaced) {
        motesPlaced = true;
        for (let i = 0; i < MOTES; i++) {
          moteX[i] = Math.random() * vw;
          moteY[i] = Math.random() * vh;
        }
      }
      camY = clamp(camY, minCamNow(), world.maxCam);
      wake();
    }

    /**
     * The page is three sections and rests on one of them, never between. It
     * snaps only between the PAIR the camera is currently inside, so a flick
     * can never jump two sections. A flick past FLICK px/s commits to the far
     * end of that pair; otherwise the nearer end wins. Programmatic moves
     * (the signal line's glide into the sky) set camTarget directly and are
     * never routed through here.
     */
    /**
     * EVERY CAMERA MOVE WITH A DESTINATION GOES THROUGH HERE, whatever asked
     * for it: a released drag, a wheel that went quiet, an arrow key, or the
     * forming line gliding up into the sky. One profile, one arrival — a
     * section change feels the same whichever of the three you used, which is
     * the whole of what "consistent" means here.
     *
     * A cubic-out's speed at u=0 is 3·dist/dur, so solving dur = 3·dist/v0
     * hands the world the hand's own speed on its first frame. Entering with
     * v0 = 0 — which is what a keypress and a programmatic glide do — simply
     * takes the distance-derived duration instead: a deliberate, discrete act
     * deserves a known arrival more than anything else does.
     */
    function aimTo(target: number, vel: number) {
      const dist = Math.abs(target - camY);
      const v0 = Math.min(Math.abs(vel), 3000);
      /* MILLISECONDS, LIKE EVERY OTHER DURATION HERE.
         `3 * dist / v0` is px ÷ px-per-SECOND, so it came out in seconds and
         was then compared against `durD` and clamped against 170..460, which
         are milliseconds. The consequence was total: any release above about
         sixteen pixels a second produced a durV under 170, `Math.min` took
         it, the clamp floored it, and EVERY released drag snapped in exactly
         170ms — a hard flick and a gentle nudge landing byte-identically,
         which is the precise symptom the velocity seeding was added to cure.
         The seeding was written, and then measured in the wrong unit, so it
         has never once been felt. */
      const durV = (3000 * dist) / Math.max(v0, 1);
      const durD = 240 + 220 * (dist / Math.max(vh, 1));
      camTarget = target;
      camAimDur = reduced ? 1 : clamp(Math.min(durV, durD), 170, 460);
      camAimFrom = camY;
      camAimT0 = performance.now();
      camAiming = true;
      wake();
    }

    function snapSection(vel: number) {
      /* rooms have no sky: their columns rest at HQ and jar only */
      const rest = restPoints();
      let i = 0;
      while (i < rest.length - 2 && camY >= rest[i + 1]) i++;
      const a = rest[i];
      const b = rest[i + 1];
      snapAt = 0;
      /* DIRECTION-BIASED COMMIT. A deliberate pull that stops short of the
         midpoint used to spring all the way back with no explanation; every
         native sheet in the world commits at a quarter to a third, because
         refusal has to be EARNED. Pull toward a section and a third of the
         way is enough; drift back the other way and it takes two thirds. */
      const p = clamp01((camY - a) / Math.max(b - a, 1));
      aimTo(
        vel > FLICK ? b : vel < -FLICK ? a : vel > 0 ? (p > 0.33 ? b : a) : p > 0.67 ? b : a,
        vel,
      );
    }

    function primePour() {
      const t0 = performance.now() + 300;
      /* Newest first: the peek band is the invitation, so it must fill on the
         first beat rather than the last. Nothing stacks in a float field, so
         arrival order no longer has to build the strata. */
      const order = list.slice().sort((a, b) => b.capturedMs - a.capturedMs);
      /* A FIXED STAGGER IS A LOCKOUT LONGER THAN THE THING IT PROTECTS. At
         thirty-five milliseconds apiece, two hundred memories are still
         arriving seven seconds after open — every morning, in a tool used
         daily. The pour explains the strata; it does not need seven seconds
         to say it. */
      /* The floor is ONE FRAME, not less. At 11ms a large archive put two and
         three orbs on the same 60Hz frame, so past roughly two hundred
         memories the stagger stopped being a stagger and the pour arrived as
         a clump — in exactly the full-jar case this pacing exists to carry.
         17ms is the first value that guarantees one orb per frame. */
      pourStep = clamp(POUR_MS / Math.max(order.length, 1), 17, 35);
      const step = pourStep;
      order.forEach((b, i) => {
        b.active = false;
        b.spawnAt = t0 + i * step;
      });
      pouring = true;
    }

    /** Reduced motion: no arrival animation — every orb starts at home. */
    function settleInstantly() {
      for (const b of list) {
        b.active = b.capturedMs <= TRef.current && onThisWall(b);
        b.spawnAt = -1;
        b.arrive = 1;
        b.x = b.homeX;
        b.y = b.homeY;
      }
      pouring = false;
      poured = true;
    }

    /** Ease-out with a soft overshoot: the arrival settles, it does not stop. */
    function overshoot(t: number): number {
      const u = t - 1;
      return 1 + u * u * (2.2 * u + 1.2);
    }

    /**
     * The field. There is no gravity, no floor and no stacking: every orb
     * drifts slowly around an assigned home on its own Lissajous path, with a
     * soft mutual repulsion that only engages when two would visibly overlap.
     * The founder's references show orbs FLOATING in generous space, never
     * piled like marbles.
     */
    function step(dt: number, now: number) {
      const t = now / 1000;
      stepSky(dt, now, t);

      /* the arrival the founder likes, kept: oldest first, 60ms apart, each
         orb entering from above its home */
      if (pouring) {
        let waiting = false;
        let arriving = false;
        for (const b of list) {
          if (b.spawnAt > 0) {
            waiting = true;
            if (now >= b.spawnAt) {
              b.spawnAt = -1;
              if (b.capturedMs <= TRef.current && onThisWall(b)) {
                enter(b);
              } else {
                b.active = false;
              }
            }
          } else if (b.active && b.arrive < 1) {
            arriving = true;
          }
        }
        if (!waiting && !arriving) {
          pouring = false;
          poured = true;
          computeInspiration();
        }
      }

      /** The field's physics, between its own walls. */
      const moveField = (arr: Ball[], lo: number, hi: number) => {
        const lift = peekLift();
        for (const b of arr) {
          if (!b.active) continue;
          if (b.leaving) {
            /* "Didn't exist yet" — it fades out in place and is then removed.
               The field eases into the gap it leaves; that closing is the
               explanation. It never flies upward (founder: the moving up just
               feels awkward). */
            b.gone = Math.min(1, b.gone + dt * (1000 / FADE_MS));
            if (b.gone >= 1) {
              b.active = false;
              b.leaving = false;
            }
            continue;
          }
          if (b.gone > 0) b.gone = Math.max(0, b.gone - dt * 2);
          /* the focused orb holds still under the camera and its readout */
          if (b.hold !== 0) continue;

          if (b.arrive < 1) b.arrive = Math.min(1, b.arrive + dt * (1000 / ARRIVE_MS));
          /* drift: independent slow sines per axis, frozen under reduced motion */
          const dx = reduced ? 0 : b.ampX * settle * Math.sin(t * b.rateX + b.phX);
          const dy = reduced ? 0 : b.ampY * settle * Math.sin(t * b.rateY + b.phY);
          const rise = (1 - overshoot(b.arrive)) * b.entryH;
          /* THE LIFT. A memory this wall's claim rests on rises out of the
             ground to sit under the poster, and settles back into its own
             place as you descend into the field. It is done as an effective
             HOME, not as a clamp on position, so the orb keeps its own drift
             the whole way and reads as carried rather than pinned — and it is
             driven by the camera's own position, so it reverses by itself and
             the world moves only because you moved it. Its field home (what
             assignHomes solved) is never touched. */
          const homeX = b.peek ? lerp(b.homeX, b.peekX, lift) : b.homeX;
          const homeY = b.peek ? lerp(b.homeY, b.peekY, lift) : b.homeY;
          const tx = homeX + dx;
          const ty = homeY + dy - rise;
          /* easing toward the target rather than assigning it is what lets a
             re-assigned home (scrub, resize) be absorbed as a glide */
          const k = reduced ? 1 : 1 - Math.pow(0.001, dt);
          b.x = lerp(b.x, tx, k);
          b.y = lerp(b.y, ty, k);
        }

        /* Soft mutual repulsion. It engages only inside contact distance, so
           orbs never visibly overlap — and it is a positional nudge, not an
           impulse, so there is no clack and nothing to damp. */
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i];
          if (!a.active || a.leaving || a.hold !== 0) continue;
          for (let j = i + 1; j < arr.length; j++) {
            const b = arr[j];
            if (!b.active || b.leaving || b.hold !== 0) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minD = (a.r + b.r) * 1.06;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const push = ((minD - d) / 2) * Math.min(1, dt * 6);
            const nx = dx / d;
            const ny = dy / d;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
          }
        }

        /* the field keeps to its own width */
        for (const b of arr) {
          if (!b.active) continue;
          b.x = clamp(b.x, lo + b.r, hi - b.r);
        }
      };

      /* ONE FIELD, AND IT IS SCREEN-ANCHORED SIDEWAYS. Its x is a screen
         coordinate, not a world one, so the memories stay exactly where they
         are while the walls slide past above them — which is the whole image:
         your memories are the ground and the walls are what different contexts
         make of them. (The draw pass adds camX back, the way the companion's
         own screen anchor does.) */
      moveField(list, world.wallL, world.wallR);

      /* A newborn whose keep did not land has finished fading: it leaves the
         ground, and the field closes over the space exactly as it does for a
         scrub. Only ever walked while one is actually pending. */
      if (doomedPending > 0) {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i];
          if (b.doomed !== true || b.active) continue;
          doomedPending--;
          dropBall(i);
        }
      }
    }

    /**
     * Inspiration: the mean aliveness of the eight most alive bubbles right
     * now. Top-eight rather than overall mean so one live streak is not
     * drowned by a large dormant archive — and it recomputes on every scrub
     * tick, which is what makes the companion's glow legible as real data.
     */
    function computeInspiration() {
      /* THE ONE FIELD, EVERYWHERE. It used to read whichever room's orbs the
         camera was standing over; there is one field now and it is yours, so
         your companion carries the same light on every wall it walks to. What
         varies by wall is the RESIDENT's light, and that reads its own
         memories — see residentInsp. */
      let n = 0;
      /* an insertion into a fixed top-8 window: no sort, no allocation */
      const top = inspTop;
      for (let i = 0; i < 8; i++) top[i] = 0;
      for (const b of list) {
        if (!b.active || b.leaving) continue;
        n++;
        for (let i = 0; i < 8; i++) {
          if (b.alive > top[i]) {
            for (let j = 7; j > i; j--) top[j] = top[j - 1];
            top[i] = b.alive;
            break;
          }
        }
      }
      const k = Math.min(8, Math.max(n, 1));
      let sum = 0;
      for (let i = 0; i < k; i++) sum += top[i];
      insp = clamp01(sum / k);
      const dayStart = TRef.current - DAY_MS;
      freshToday = false;
      for (const b of list) {
        if (b.active && !b.leaving && b.capturedMs >= dayStart) {
          freshToday = true;
          break;
        }
      }
      for (const res of residents.values()) residentInsp(res);
    }

    /** In words, never as a score. When it is glowing, the glow IS the answer
        — no sentence restates it (founder ruling). */
    /**
     * WHAT IT SAYS, AND WHY IT IS NOT ONE SENTENCE.
     *
     * Perceived repetition is trigger rate divided by pool size, and a fixed
     * line has a pool of one. Splinter Cell shipped over 130 distinct lines
     * containing the player's name and was still called repetitive, because
     * the trigger fired constantly. Journey's chirp survives thousands of
     * presses on a single asset because it is PARAMETERISED — the same sound
     * means something different depending on how you pressed it.
     *
     * So this answers about what is actually true right now — the frontier,
     * the sky, the dial, the season of the archive — and each answer has more
     * than one wording. Two things it will never do: say the same thing twice
     * in a row, and restate a state the light has already rendered.
     */
    function sayLine(): string {
      if (scrubbingRef.current) return `As it was in ${monthTag(TRef.current)}`;
      const pick = (opts: string[]): string => {
        const fresh = opts.filter((o) => o !== lastSaid);
        const s = (fresh.length ? fresh : opts)[Math.floor(Math.random() * (fresh.length || opts.length))];
        lastSaid = s;
        return s;
      };
      /* An empty archive is the one state every single person passes through,
         and the world's own vocabulary pointed at the dark beats any
         instruction: it asks for one thing, once, and then goes quiet. */
      if (inspCol === 0 && list.every((b) => !b.active || b.leaving))
        return pick([
          "Nothing here yet — give me one worth keeping",
          "Say one thing and I will hold it",
        ]);
      /* THE FRONTIER FIRST, because it is the only thing here that points
         forward. It names where nothing has been built yet, never how much is
         left — a compass, not a progress bar. */
      const open = list.filter((b) => b.active && !b.leaving && b.frontier).length;
      if (open > 2 && Math.random() < 0.55)
        return pick([
          "Some of these still hold nothing up",
          "There are memories here nothing rests on",
        ]);
      /* WHEN IT IS GLOWING, THE GLOW IS THE ANSWER. A bright companion tapped
         for a sentence used to get "Plenty is still alight", which is the
         readout said twice — the founder's standing ruling against restating
         a state that is already rendered, and it went out on their word.
         Silence here is not an oversight: the light already answered. */
      /* A YOUNG ARCHIVE IS BRIGHT AND EMPTY AT THE SAME TIME. Everything just
         kept is fully alive, so the glow says "thriving" while there is
         genuinely nothing above it yet — and the silence that normally means
         "the light already answered" reads as the product having nothing to
         say on the day somebody starts. Under a handful of memories, it says
         what is actually true instead. */
      if (nebs.length === 0 && inspCol > 0 && inspCol < 4)
        return pick([
          "A few so far. Say more and I will start to see it",
          "Not enough yet to see a shape",
        ]);
      if (insp > 0.55) return "";
      if (insp > 0.22)
        return pick([
          "Something is still warm from last week",
          "Last week is still holding on",
        ]);
      return pick(["Quiet lately", "It has been quiet", "Nothing new in a while"]);
    }

    /** An orb enters from above its home and eases down into it. */
    function enter(b: Ball) {
      /* A MEMORY FROM ANOTHER WALL IS NOT ON THIS GROUND.
         The layout and the present-set were taught to filter by wall, but the
         DRAW was not — so every ball belonging to somewhere else never got a
         home, kept x=0,y=0, and was still painted: the entire off-wall
         population stacked at the world origin, which is the top-left of
         headquarters. That pile was the shape over the poster.

         `active` is the flag every consumer already honors — the draw, the
         bloom, the hit-test, the aliveness pass — so the wall test belongs
         here rather than repeated at each of them. */
      if (!onThisWall(b)) {
        b.active = false;
        return;
      }
      b.active = true;
      b.gone = 0;
      b.arrive = reduced ? 1 : 0;
      b.entryH = 90 + b.frac * 110;
      b.x = b.homeX;
      b.y = b.homeY - (reduced ? 0 : b.entryH);
    }

    /**
     * NOTHING MOVES POSITION ON SELECT — an orb's place in the field already
     * encodes its age, and dragging it to a focus point (or hauling its kin
     * into a ring, as v1 did) destroys the only spatial meaning the jar has.
     * The camera frames it instead; light does the rest. This only has to
     * notice a selection whose orb has scrubbed out from under it.
     */
    function springs() {
      /* a satellite holds its own selection: the memory it stands for may
         live in a field that has never been poured (another room's), and that
         is not a reason to close what is being read */
      if (selSat) return;
      const id = selectedIdRef.current;
      const sel = id ? findBall(id) : undefined;
      if (!sel || !sel.active) release();
    }

    function reconcileScrub() {
      const T = TRef.current;
      /* did the SET of present orbs change? only then are homes re-assigned */
      let changed = false;
      const entering: Ball[] = [];
      for (const b of list) {
        if (pouring && b.spawnAt > 0) {
          colorBall(b, T);
          continue;
        }
        const want = b.capturedMs <= T;
        const present = b.active && !b.leaving;
        if (want !== present) {
          changed = true;
          if (!want) {
            if (reduced) {
              b.active = false;
              b.gone = 1;
            } else {
              /* it fades where it stands, and stops repelling immediately so
                 the field can start easing into the space it leaves */
              b.leaving = true;
            }
          } else if (b.leaving) {
            /* caught mid-fade: it simply fades back up where it stands */
            b.leaving = false;
          } else {
            /* the drop-in the founder likes, kept for scrubbing forward */
            entering.push(b);
          }
        }
        colorBall(b, T);
      }
      if (changed) {
        /* Re-solve the whole field. Everyone eases toward their new home, so
           the field visibly closes over what left and opens for what came
           back — and the peek stays exact throughout. */
        assignHomes();
        for (const b of entering) enter(b);
      }
    }

    function draw(now: number) {
      const pal = paletteRef.current;
      ctx!.setTransform(dpr, 0, 0, dpr, -camX * dpr, -camY * dpr);
      ctx!.clearRect(camX, camY, vw, vh);
      if (!pal) return;
      const t = now / 1000;
      const selId = selectedIdRef.current;
      const depthSpan = Math.max(world.fieldBottom - world.fieldTop, 1);
      /* The bloom's whole strength curve, in one place: wide and thin, the way
         a bright point reads through a night lens. A dormant memory keeps a
         trace of one — the continuum never reaches nothing. */
      const bloomAlpha = (pow: number) => BLOOM_PEAK * (0.13 + 0.87 * pow);

      /* pass 0 — the deep background: dim sparkle points, then drifting dust
         motes. Together they are the air in front of the camera, and they are
         what makes the space read as volumetric rather than as a flat fill —
         and they ARE the camera's air, so they ride camX with it. */
      ctx!.globalCompositeOperation = "lighter";
      for (let i = 0; i < SPARKS; i++) {
        const sr = sparkR[i];
        ctx!.globalAlpha = sparkA[i];
        ctx!.drawImage(
          pal.mote,
          sparkX[i] * vw + camX - sr,
          sparkY[i] * vh + camY - sr,
          sr * 2,
          sr * 2,
        );
      }
      const thin = clamp01(-camY / Math.max(vh, 1));
      for (let i = 0; i < MOTES; i++) {
        const mr = moteR[i];
        const mx = moteX[i] + Math.sin(t * 0.5 + moteP[i]) * 9;
        /* every third mote thins away as the camera climbs into the sky */
        ctx!.globalAlpha =
          moteA[i] * (i % 3 === 0 ? 1 - thin * 0.85 : 1) * lerp(0.6, 1.15, inspNow);
        ctx!.drawImage(pal.mote, mx + camX - mr * 3, moteY[i] + camY - mr * 3, mr * 6, mr * 6);
      }

      /* pass 0b — the sky. Nebulae are additive light like everything else
         here, and the memories they are made of ORBIT them: real orbs, drawn
         from the field's own baked sprites, so a candidate's provenance is
         legible rather than implied.

         A satellite on the far side of its orbit draws BEFORE the cloud's
         blooms and dims; on the near side it draws after them. That is
         occlusion, not visibility: nothing that exists ever pops out of
         existence. */
      const satPass = (n: Neb, near: boolean, ground: number) => {
        /* placeSats left this far-to-near; satAt walks the same array
           backwards, so the one whose pixels are on top is the one that
           answers a tap */
        for (let k = 0; k < n.satOrd.length; k++) {
          const s = n.sats[n.satOrd[k]];
          if ((s.front > 0) !== near) continue;
          /* AT REST THERE IS NOTHING HERE. `em` is the emergence: zero until
             the candidate is the subject, and back to zero as it retracts —
             so the sky at rest is sentences and bodies, and this pass costs
             one comparison per satellite. */
          if (s.em <= 0.004) continue;
          const base = ground * s.em * (near ? 1 : 1 - ORBIT_BEHIND) * lerp(1, 0.2, s.dim);
          if (base <= 0.01) continue;
          /* the memory's own light, live where the memory is the viewer's own */
          const pow = s.ball ? s.ball.alivePow : s.alivePow;
          /* the memory's own bloom, with the same floor under it the field
             puts under a focused orb: the disc no longer flatters a dormant
             memory, so the light around it is what has to carry attention */
          const bloom = Math.max(
            bloomAlpha(pow) * base * (1 + s.glow * 0.7),
            0.32 * s.glow * base,
          );
          /* AND THE SAME LIE, DELETED HERE TOO. A satellite IS a memory — the
             very one the field draws a section below — so pinning a selected
             one at the top tier said "fully alive" about something dormant,
             in the one place a person looks hardest: the evidence under a
             claim. The field's own orb pass had this deleted already; the
             orbits kept it, so the same memory read as two different
             alivenesses depending on which of the two you were looking at. */
          const tier = s.ball ? tierOf(s.ball) : s.tier;
          if (bloom > 0.004) {
            ctx!.globalCompositeOperation = "lighter";
            const hr = s.dr * BLOOM_R;
            ctx!.globalAlpha = Math.min(bloom, BLOOM_PEAK);
            ctx!.drawImage(pal.blooms[s.sizeIdx][tier], s.x - hr, s.y - hr, hr * 2, hr * 2);
          }
          ctx!.globalCompositeOperation = "source-over";
          /* the same emergence the position carries: it comes out of the
             sentence small and arrives whole, one movement */
          /* and the selection swell deleted here too, for the same reason the
             tier lie was: a satellite IS a memory, so the disc must answer to
             the same law on both walls. The EMERGE_SCALE term stays — that is
             arrival, the memory coming out of the sentence, not feedback. */
          const ex = (s.r + ORB_PAD) * SAT_R * (reduced ? 1 : lerp(EMERGE_SCALE, 1, s.em));
          ctx!.globalAlpha = base;
          ctx!.drawImage(pal.orbs[s.sizeIdx][tier], s.x - ex, s.y - ex, ex * 2, ex * 2);
        }
      };
      for (const n of nebs) {
        if (n.gone >= 1) continue;
        const sx = n.x - camX;
        if (sx < -n.r * 2.4 || sx > vw + n.r * 2.4) continue;
        const sy = n.y - camY;
        if (sy < -n.r * 2.4 || sy > vh + n.r * 2.4) continue;
        const breath = reduced ? 1 : 1 + Math.sin(t * n.breathRate + n.breathPhase) * 0.055;
        /* dispersing: it thins AND spreads, which is what dispersing means —
           and the subject sits a little nearer, body and words together */
        const rr = n.r * breath * n.condense * (1 + n.gone * 0.5) * (1 + FOCUS_POP * n.focus);
        /* while one candidate is the subject, every other one sinks — the
           field's own focus law, applied to the sky's bodies */
        const a =
          (1 - n.gone) *
          (n.dragging ? 1.25 : 1) *
          /* the one it would join, answering — the drop target is a rise in
             light and nothing else, which is the only channel this world has
             and the only one it needs */
          (n.joining ? 1.4 : 1) *
          /* and, at rest, a pair that COULD be joined leans toward each other
             — the invitation, held perfectly still */
          (n.pairable && !n.dragging ? 1.15 : 1) *
          (n.kind === "draft" ? 1.4 : 1) *
          lerp(1, FOCUS_DIM, n.dimN);
        /* the satellites vanish with their candidate, over the same beat */
        const satGround = (1 - n.gone) * n.condense;
        if (n.sats.length > 0) satPass(n, false, satGround);
        ctx!.globalCompositeOperation = "lighter";
        ctx!.globalAlpha = clamp01(a);
        ctx!.drawImage(pal.nebulae[n.variant], grid(n.haloX) - rr, grid(n.haloY) - rr, rr * 2, rr * 2);
        if (n.sats.length > 0) satPass(n, true, satGround);
      }
      ctx!.globalCompositeOperation = "lighter";

      /* pass 1 — the diffuse blooms. Additive on dusk, so a dense pile glows
         hotter for free; a soft multiply wash on paper. This is what makes
         the orbs feel lit from within rather than filled in. One pass per
         visible column: the personal field, then any room in view. */
      ctx!.globalCompositeOperation = "lighter";
      const bloomPass = (arr: Ball[], still: boolean) => {
        for (const b of arr) {
          if (!b.active) continue;
          /* Cull at the sprite's REAL extent. The widest bloom is
             32 × BLOOM_R × 1.12 ≈ 79px of half-extent, so ±300/±260 was
             additively blending whole screenfuls of orbs below the fold. */
          const sxb = b.x - camX;
          if (sxb < -CULL_BLOOM || sxb > vw + CULL_BLOOM) continue;
          const sy = b.y - camY;
          if (sy < -CULL_BLOOM || sy > vh + CULL_BLOOM) continue;
          const depth = clamp01((b.y - world.fieldTop) / depthSpan);
          /* A MACHINE'S MEMORY DOES NOT BREATHE, IT CYCLES.
             The bloom's breath is a sine — the single most organic thing on
             screen, and it was running identically under an agent's memories
             while everything around them was stepping. Quantizing the sine
             rather than removing it keeps the amplitude, the rate and the
             phase exactly as they were: same rhythm, fewer states in it. */
          const breathRaw = Math.sin(t * b.breathRate + b.breathPhase);
          const breathQ =
            mech < 0.02 ? breathRaw : Math.round(breathRaw * (5 - mech * 3)) / (5 - mech * 3);
          const breath =
            reduced || still ? 1 : 1 + breathQ * (0.04 + 0.05 * b.alive);
          /* the founder's continuum law, unchanged */
          let alpha = bloomAlpha(b.alivePow) * breath * lerp(1, 0.72, depth);
          alpha *= (1 - b.gone) * lerp(1, 0.12, b.dim) * (1 + b.glow * 0.7 + b.relight * 0.9);
          /* The focused orb is the only lit thing on screen, so it gets a floor
             under its bloom: a dormant memory is dim at rest, but attention
             still has to land on it. */
          if (b.id === selId) alpha = Math.max(alpha, 0.32 * b.glow);
          /* THE FINGER IS ON THIS ONE. Juice lives in the bloom: the disc's
             tier never moves, the radius never moves, nothing about what this
             memory IS changes because it is being touched. Only the light
             around it says so. */
          alpha += 0.3 * b.press;
          if (alpha <= 0.004) continue;
          const hr = b.r * BLOOM_R * (1 + b.glow * 0.12);
          ctx!.globalAlpha = Math.min(alpha, BLOOM_PEAK + 0.14 * b.press);
          ctx!.drawImage(pal.blooms[b.sizeIdx][tierOf(b)], b.x - hr, b.y - hr, hr * 2, hr * 2);
          /* The focused orb wears a second, much wider and dimmer ring — but
             not while its panel is open: a ring that wide reaches under the
             card, and light must live BEHIND the panel, never on it. */
          if (b.glow > 0.02 && b.id === selId && !panelOpenRef.current) {
            const ar = b.r * 4.2;
            ctx!.globalAlpha = 0.1 * b.glow;
            ctx!.drawImage(pal.aura, b.x - ar, b.y - ar, ar * 2, ar * 2);
          }
        }
      };
      bloomPass(list, pouring);

      /* pass 2 — the orbs. A pastel gradient disc with a soft edge that melts
         into its own bloom: no rim light, no terminator, no contact shadow,
         because these are lit from within and float. Aliveness picks the
         baked tier — full gradient when alive, desaturating toward slate as it
         fades, a dim slate disc when dormant. It never disappears. */
      ctx!.globalCompositeOperation = "source-over";
      const orbPass = (arr: Ball[], ord: number[]) => {
      sortByDepth(arr, ord);
      for (const oi of ord) {
        const b = arr[oi];
        if (!b.active) continue;
        /* and the disc at its own: 32 + ORB_PAD = 34px */
        const sxb = b.x - camX;
        if (sxb < -CULL_ORB || sxb > vw + CULL_ORB) continue;
        const sy = b.y - camY;
        if (sy < -CULL_ORB || sy > vh + CULL_ORB) continue;
        let a = 1 - b.gone;
        /* focus dims EVERYTHING else, uniformly — there is exactly one lit
           thing on the screen (founder ruling, explicit) */
        a *= lerp(1, 0.2, b.dim);
        if (a <= 0.01) continue;

        const rx = b.r;
        const ry = b.r;
        const cyv = b.y;
        /* a scrubbed-away orb also shrinks slightly as it fades in place */
        const shrink = 1 - b.gone * 0.06;
        /* JUICE LIVES IN THE BLOOM, AND THAT INCLUDES SIZE. Selection used to
           swell the disc eight percent — feedback moving geometry, which the
           law rejects outright, and which contradicted `hold`'s own contract
           ("Never a position target — light only") twenty lines after a
           comment swearing the radius never moves. It was not gated on
           `reduced` either, so a person who asked for less movement got the
           swell anyway. Selection reads entirely through the bloom now: the
           0.32 alpha floor, the ×1.7 glow gain, the widened bloom radius and
           the second wide aura ring. `shrink` stays — it is the gone-fade,
           the memory leaving, not the world answering a touch. */
        const pop = shrink;
        const ex = (rx + ORB_PAD) * pop;
        const ey = (ry + ORB_PAD) * pop;

        ctx!.globalAlpha = a;
        if (b.img) {
          const spr = rx * 2 * dpr > 110 ? b.img.lg : b.img.sm;
          ctx!.drawImage(spr, b.x - rx * pop, cyv - ry * pop, rx * 2 * pop, ry * 2 * pop);
          if (b.alive < 1) {
            /* the photo desaturating toward slate as its light leaves */
            ctx!.globalAlpha = a * (1 - tierOf(b) / (TIERS - 1)) * 0.7;
            ctx!.fillStyle = pal.gray;
            ctx!.beginPath();
            ctx!.ellipse(b.x, cyv, rx * pop, ry * pop, 0, 0, TAU);
            ctx!.fill();
          }
        } else {
          /* THE DISC TELLS THE TRUTH, INCLUDING WHILE YOU ARE READING IT.
             This used to pin a selected orb at the top tier, which meant a
             dormant memory rendered as fully alive the moment you tapped it —
             the product's own thesis running backwards. You could not watch a
             reflection re-light it (the disc was already at maximum), and the
             orb you had just brought back was DIMMER after you closed the
             panel than while you read it. Attention is carried by the bloom,
             which has a floor under it; the disc is what the memory IS. */
          const tier = tierOf(b);
          /* stepped as you cross into a machine's wall: the same disc, landing
             on a grid instead of anywhere */
          /* Two facts, two channels, resolved to one sheet: WHOSE it is picks
             the hue, WHAT KIND OF MIND kept it picks the resolution. Your own
             smooth untinted memories are the common case and skip the cache
             entirely. */
          const machine = b.origin === "agent";
          const hue = b.hue ?? -1;
          const sheet = hue < 0 && !machine ? pal.orbs : orbsForHue(pal, hue, machine);
          ctx!.drawImage(sheet[b.sizeIdx][tier], grid(b.x) - ex, grid(cyv) - ey, ex * 2, ey * 2);
        }
        /* NO RING. The frontier was drawn as an open arc outside the disc and
           it read as decoration nobody could name — "what are these outlines
           for" was the whole verdict. The opacity already carries it: a memory
           nothing rests on has no cited-bonus under its light, so it sits
           dimmer than its neighbours on its own. The fact is still computed
           and the companion still speaks it; it just is not drawn twice. */
      }
      };
      orbPass(list, order);

      /* No connection visuals. The founder was explicit after seeing them:
         "I don't want the connections with the other balls to appear. It's
         confusing. And everything should dim except for that one." The
         connections still exist — they are text rows in the panel. */

      /* pass 3 — the companion. It lives in world space at 1x, so it scrolls
         away with the rest of headquarters and never appears over section B:
         the jar owns that screen. */
      /**
       * THE COMPANION IS ALIVE. YOUR ARCHIVE IS WHAT VARIES.
       *
       * This used to be one number: the archive's aliveness lit the body, the
       * aura, the nubs, everything. A quiet week made the creature look like
       * it was dying, and a face that dims because you have been busy is a
       * face that grades you. The Calm Technology precedent everyone cites
       * for this — a string on a wall twitching with network traffic — showed
       * the NETWORK's state. Nobody feels judged by a network.
       *
       * So the split. `bodyLit` has a floor under it and never reads as
       * fading: breath, blink, look-arounds and the body's own light are the
       * creature's, unconditionally. `lit` stays exactly what it was and now
       * governs only its REACH — how far the aura carries, how much comes off
       * it. A quiet archive is a companion sitting close to itself; a live one
       * throws light across the room. What changed is what it can see, not
       * whether it is alive.
       */
      const lit = clamp01(inspNow + flare * 0.5 + freshLit);
      const bodyLit = clamp01(0.55 + lit * 0.45);
      /* Whose form it is wearing where the camera is right now — the body, the
         silhouette its features clip to, and the halo, all from one place so
         they can never disagree about which being is on screen. */
      const wear = worn(pal);
      if (charY - camY > -charSize * 2 && charY - camY < vh + charSize * 2) {
        /* the bob rides its own integrated phase: while the companion leads
           it quickens toward a walk, and at rest it is the hover it was */
        /* THE FLOAT BECOMES A TICK. A sine is how something alive hovers; a
           machine's body arrives on frames. Same amplitude, same rate — only
           the resolution of the movement changes, which is the whole idea. */
        const bobRaw = reduced ? 0 : Math.sin(bobPh) * 4 * settle;
        /* the step grows with how far into the machine's mind we are: one
           pixel of quantisation at the boundary, four at the far side */
        const bobStep = 1 + mech * 3;
        const bob = mech < 0.02 ? bobRaw : Math.round(bobRaw / bobStep) * bobStep;
        /* it rides ahead of the world vertically as well as horizontally */
        const cyC = charY + bob + charLift;
        /* THE TRAVELER'S PLACE. The companion is screen-anchored — it is the
           one who travels, so the world slides under it — and during a
           transition it rides ahead of centre by charOff, near the leading
           third of the screen, still bobbing. */
        const charSX = camX + vw / 2 + charOff;
        /* Squash-stretch coupled to the bob — and to the climb. Ascending it
           stretches a few percent and descending it compresses, which is the
           character's own response to being moved and not decoration on top
           of it. (Its LIGHT still obeys the rule that juice lives in the
           bloom; this is the body, and a body may act.) */
        const sq = reduced ? 0 : Math.sin(bobPh + 1.5) * 0.022 - pitch * PITCH_STRETCH;
        const bw = charSize * (1 + sq);
        const bh = charSize * (1 - sq);

        /* the aura: layered pastel blooms at different radii, drifting on
           slow independent orbits. Additive, so it reads as emitted light. */
        ctx!.globalCompositeOperation = "lighter";
        const auraR = charSize * lerp(1.25, 2.1, lit) * (1 + flare * 0.25);
        for (let i = 0; i < 4; i++) {
          const ph = t * (0.16 + i * 0.05) + i * 1.9;
          const off = reduced ? 0 : charSize * 0.08;
          const rr = auraR * (0.72 + i * 0.11);
          /* multiply on paper tints rather than emits, so it needs more of the
             halo to carry the same reading of "inspired" */
          ctx!.globalAlpha = lerp(0.1, 0.55, lit) * (0.55 - i * 0.08);
          ctx!.drawImage(
            wear.aura[i],
            charSX + Math.cos(ph) * off - rr,
            cyC + Math.sin(ph) * off - rr,
            rr * 2,
            rr * 2,
          );
        }

        /* one mote on its way to the sky: the message, made of light */
        if (!reduced) {
          for (let i = 0; i < 4; i++) {
            if (riseA[i] <= 0) continue;
            ctx!.globalAlpha = clamp01(riseA[i]) * 0.55;
            ctx!.drawImage(pal.mote, charSX + riseX[i] - 3.5, cyC + riseY[i] - 3.5, 7, 7);
          }
        }

        /* inspiration coming off it, literally */
        if (!reduced && lit > 0.55) {
          for (let i = 0; i < 10; i++) {
            if (upA[i] <= 0) continue;
            ctx!.globalAlpha = upA[i] * 0.5;
            ctx!.drawImage(pal.mote, charSX + upX[i] - 3, cyC + upY[i] - 3, 6, 6);
          }
        }

        ctx!.globalCompositeOperation = "source-over";
        /* THE TURNAROUND. The companion is a round, lathe-symmetric form, so
           it turns like a PLANET: the silhouette never changes shape — it is
           never scaled, never squashed toward a card — and the features
           travel across it instead. Each feature sits at a longitude on the
           equator; its screen offset is sin(longitude), it is drawn only
           while its cos is positive (the hemisphere facing you), and it
           foreshortens as it approaches the edge. The aura stayed outside
           this frame: emitted light is not part of the form. */
        const cosY = Math.cos(yaw);
        ctx!.save();
        ctx!.translate(charSX, cyC);
        /* leading, it leans a couple of degrees into the direction — the
           walking read on a floating form. Still a pebble, not a biped. */
        /* one tilt, composed from both axes: it leans into the direction it
           is going, whatever that direction is */
        /* Three sources, one angle: where it is going, where the world is
           going, and — while it is attending to something you tapped — the
           direction of the thing it is looking at. The attend term eases in
           and out on its own clock so the turn reads as a decision rather
           than as a snap to a target. */
        const lean = reduced
          ? 0
          : clamp(charOff / DRAG_LEAD_PX, -1, 1) * 0.045 +
            clamp(pitch, -1, 1) * 0.02 +
            attendHold;
        if (lean !== 0) ctx!.rotate(lean);

        /* The two soft nubs: not limbs — they swell with the glow, and they
           are the companion's only piece of body language. They sit a quarter
           turn either side of the face and orbit with everything else, but
           they PROTRUDE, so they are never gated on visibility: one is simply
           drawn behind the body and the body occludes it, leaving it peeking
           past the silhouette. Nothing ever pops out of existence. */
        /**
         * THE NUBS ARE PART OF THE CREATURE, NOT A READOUT.
         *
         * They have been through both failure modes now. Gated at a threshold
         * the body's light always cleared, they were permanently on at one or
         * two pixels — two specks stuck to the silhouette, reading as dirt.
         * Gated higher, they VANISHED on a quiet archive, so the companion
         * lost its hands because you had been busy. That is the same mistake
         * as the dimming body: a creature's anatomy is not a status bar, and
         * an animal that loses limbs when the numbers are low reads as broken
         * rather than as calm.
         *
         * So they are always there, at a size that is always legible, and the
         * light only decides how far they SWELL. That is what "the nub radius
         * is the light channel expressed as body language" was supposed to
         * mean — an inflection, not an existence test.
         */
        const nubOn = true;
        const nubR = charSize * lerp(0.062, 0.1, bodyLit);
        /* the colour work is skipped outright when there is no nub to paint —
           it used to allocate five arrays and two strings every frame,
           including on every frame where `nubOn` was false */
        const nubRgb = nubOn ? mix([166, 163, 156], [214, 209, 197], bodyLit) : null;
        const nubFront = nubRgb ? rgbCss(nubRgb, 1) : "";
        /* the far side of a form is darker than the near side */
        const nubBack = nubRgb ? rgbCss(mix(nubRgb, [0, 0, 0], 0.15), 1) : "";
        const drawNub = (lon: number, behind: boolean) => {
          if (!nubOn) return;
          const a = yaw + lon;
          if (Math.cos(a) < 0 !== behind) return;
          const s = Math.sin(a);
          /* pointing at or away from you, a nub reads smaller */
          ctx!.fillStyle = behind ? nubBack : nubFront;
          ctx!.beginPath();
          ctx!.arc(s * bw * 0.42, bh * 0.24, nubR * Math.max(Math.abs(s), 0.35), 0, TAU);
          ctx!.fill();
        };
        ctx!.globalAlpha = 1;
        drawNub(-Math.PI / 2, true);
        drawNub(Math.PI / 2, true);

        const bodyTier = Math.round(bodyLit * (BODY_TIERS - 1));
        ctx!.drawImage(wear.body[bodyTier], -bw / 2, -bh / 2, bw, bh);

        /* everything ON the form is clipped to the form — to THIS form, so a
           machine's features stop at a machine's stepped edge rather than at
           the owner's curve */
        ctx!.save();
        bodyPath(ctx!, bw, bh, wear.be);
        ctx!.clip();

        /* looking at the back of its head: a gentle overall shading, so the
           far side is a different side rather than a blank face */
        const back = clamp01(-cosY);
        if (back > 0.01) {
          ctx!.globalAlpha = 0.08 * back;
          ctx!.fillStyle = "#141a26";
          ctx!.fillRect(-bw / 2, -bh / 2, bw, bh);
        }
        /* and the lit seam drifting across it — the rotation stays legible
           even when no feature is showing. It is nothing at rest, so the
           companion looks exactly as it always has when it faces you. */
        const seamA = 0.1 * clamp01(1 - cosY);
        if (seamA > 0.004) {
          const seamW = bw * 0.35;
          ctx!.globalAlpha = seamA;
          ctx!.drawImage(
            pal.seam,
            Math.sin(yaw + Math.PI) * bw * 0.25 - seamW / 2,
            -bh / 2,
            seamW,
            bh,
          );
        }

        /* The eyes are drawn live, so the blink and the drift are free. Each
           one is a dot on the equator: it slides toward the silhouette,
           foreshortens, and fades out over the last quarter-radian rather
           than popping off the edge. */
        ctx!.fillStyle = "#2b2822";
        const er = charSize * 0.038;
        /* THE LOOK, AS LATITUDE. The eyes sit on the surface of a turning
           form, so looking up or down is a latitude offset in exactly the way
           the yaw is a longitude one: it moves them across the face, and it
           foreshortens as it approaches the pole. Independent of the yaw
           term, so a diagonal composes rather than fights. */
        const lat = clamp(-pitch * PITCH_LOOK + eyeY * 0.06, -0.9, 0.9);
        const cosLat = Math.cos(lat);
        const eyY = -bh * 0.06 + Math.sin(lat) * bh * FACE_R + eyeY;
        for (const lon of [-EYE_LON, EYE_LON]) {
          const a = yaw + lon;
          const ca = Math.cos(a);
          if (ca <= 0) continue;
          /* at the edge a blink is a flicker, so it is suppressed there */
          const eh = ca < 0.3 ? 1 : Math.max(0.12, 1 - blink);
          ctx!.globalAlpha = clamp01(ca / Math.sin(0.25));
          ctx!.beginPath();
          ctx!.ellipse(
            Math.sin(a) * bw * FACE_R * cosLat + eyeX * ca,
            eyY,
            er * Math.max(ca * cosLat, 0.2),
            er * eh * Math.max(cosLat, 0.35),
            0,
            0,
            TAU,
          );
          ctx!.fill();
        }
        ctx!.globalAlpha = 1;
        ctx!.restore();

        /* the near nub last of all: it passes IN FRONT of the face */
        drawNub(-Math.PI / 2, false);
        drawNub(Math.PI / 2, false);
        ctx!.restore();
      }

      /* pass 4 — the vignette. (The film grain used to be painted here too,
         with `overlay` against a transparent canvas — which is not a blend at
         all, just a flat grey sheet at seven percent over every pixel of the
         frame. It also rode the world transform, so the "film" grain slid
         across the image as you scrolled. It now lives on a DOM layer above
         the canvas, where it has an opaque backdrop and belongs to the lens.)

         The corners fall away, as a night lens does: */
      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = VIGNETTE;
      ctx!.drawImage(pal.vignette, camX, camY, vw, vh);
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";
    }

    /** Camera-following DOM: the volume and the HQ both ride at 1x. */
    function syncDom() {
      /* the words ride BOTH camera axes: rooms are columns of the same page */
      const hq = hqRef.current;
      if (hq)
        hq.style.transform = `translate3d(${(-camX).toFixed(1)}px, ${(-camY).toFixed(1)}px, 0)`;
      const atmos = atmosRef.current;
      if (atmos) atmos.style.transform = `translate3d(0, ${(-camY).toFixed(1)}px, 0)`;
      /* The mouth rides BOTH axes, like headquarters — it stands on your own
         wall's seam, so it slides away when you travel and scrolls away when
         you descend. It is a sibling of .jar-hq rather than a child of it
         only because it has to sit ABOVE the canvas: a field you are typing
         into cannot have orbs drawn over the words. */
      const mouth = mouthRef.current;
      if (mouth)
        mouth.style.transform = `translate3d(${(-camX).toFixed(1)}px, ${(-camY).toFixed(1)}px, 0)`;
      /* the companion's whisper is screen-anchored, like the companion */
      const say = charSayRef.current;
      if (say) say.style.transform = `translate3d(${camX.toFixed(1)}px, 0, 0)`;
      /* Each candidate's sentence is DOM, positioned on its cloud every
         frame: the canvas carries the light, the words stay crisp. */
      const els = nebElsRef.current;
      if (els.size > 0) {
        for (const n of nebs) {
          const el = els.get(n.id);
          if (!el) continue;
          /* the subject grows on the same curve and by the same amount its
             body and its orbit do — the candidate is one thing */
          const grow = 1 + FOCUS_POP * n.focus;
          el.style.transform = `translate3d(${(n.x - camX).toFixed(1)}px, ${(n.y - camY).toFixed(1)}px, 0) translate(-50%, -50%) scale(${grow.toFixed(3)})`;
          const op =
            (1 - n.gone) * (n.condense > 0.5 ? 1 : 0) * n.dimS * lerp(1, FOCUS_DIM, n.dimN);
          el.style.opacity = `${op}`;
          /* AND AN INVISIBLE SENTENCE IS STILL A TARGET. `.jar-neb` carries
             `pointer-events: auto` and starts at opacity zero until the loop
             has given it a place; it also passes through zero while a
             candidate condenses or disperses. Its one child is the least
             reversible control in the world, and on touch that child rests
             visible by design — so the container has to stop taking the
             pointer whenever it cannot actually be seen. The same rule the
             action itself now obeys, applied one level up where the
             stylesheet cannot reach it.

             The threshold is well under the faintest state a candidate can
             legitimately be READ in — a clustered member whispering at 0.25
             while another candidate is the subject sits at 0.055, and it must
             stay tappable, because tapping it is how it becomes the subject.
             What this catches is the three states where the sentence is
             genuinely not on screen: not yet placed, condensed by an
             adoption, and dispersed. Those all reach exactly zero. */
          el.style.pointerEvents = op > 0.02 ? "auto" : "none";
          /* the layout width is NOT touched by focus: it is what the orbit was
             measured from, and scale is a transform, so the box stays put */
          el.style.width = `${Math.round(Math.min(n.r * 1.7, 320))}px`;
        }
        for (const [id, el] of clusterElsRef.current) {
          if (!el) continue;
          let sx = 0;
          let sy = 0;
          let hits = 0;
          let low = -Infinity;
          for (const mid of id.split("+")) {
            const n = nebs.find((q) => q.id === mid);
            if (!n) continue;
            sx += n.x;
            sy += n.y;
            low = Math.max(low, n.y + n.r * 0.52);
            hits++;
          }
          if (hits === 0) continue;
          el.style.transform = `translate3d(${(sx / hits - camX).toFixed(1)}px, ${(low - camY).toFixed(1)}px, 0) translate(-50%, 0)`;
        }
      }
      /* whose memory the pointer is on, beside it — it rides the satellite, so
         the name stays where the memory is even while the orbit turns under
         it. Absolutely positioned: it can never shift anything else. */
      const who = satSayRef.current;
      if (who && hoverSat) {
        const sx = hoverSat.x - camX;
        const sy = hoverSat.y - camY;
        /* IT HAS TO STAY IN THE SKY. The name sits to the satellite's right by
           default, but the sky clips and the name never wraps, so a satellite
           on the right of its orbit would have its owner cut in half or lost
           off the edge entirely — on a phone that is most of the ring, and a
           room's ring is exactly where whose it is has to be readable. So it
           flips to the other side when it would not fit, the way the reading
           panel's own right-then-left placement does, and is clamped inside
           the viewport as a floor. Transform only: still nothing can shift. */
        let lx = sx + hoverSat.dr + SAT_SAY_GAP;
        if (lx + satSayW > vw - SAT_SAY_GAP)
          lx = sx - hoverSat.dr - SAT_SAY_GAP - satSayW;
        lx = clamp(lx, SAT_SAY_GAP, Math.max(SAT_SAY_GAP, vw - satSayW - SAT_SAY_GAP));
        who.style.transform = `translate3d(${lx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(0, -50%)`;
      }
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      /* dt is clamped BOTH ways: a wake() racing a queued frame can hand a
         timestamp older than prev (heavily throttled tabs make it seconds),
         and a negative dt turns every 1-pow(k,dt) ease into a backward
         extrapolation. Zero means "hold still for a frame", which is always
         safe here. */
      const dt = Math.min(Math.max((now - prev) / 1000, 0), 0.05);
      prev = now;

      /* the wheel went quiet: settle onto section A or B */
      if (snapAt > 0 && now >= snapAt && !pointerDown) snapSection(0);

      if (camAiming) {
        /* the profile snapSection solved: same duration on every device, and
           it commits at four pixels rather than crawling the last six tenths */
        const u = clamp01(camAimDur > 0 ? (now - camAimT0) / camAimDur : 1);
        camY = camAimFrom + (camTarget - camAimFrom) * easeOut(u);
        if (u >= 1 || Math.abs(camTarget - camY) < 4) {
          camY = camTarget;
          camAiming = false;
          camVel = 0;
        }
        lastActive = now;
      } else if (!dragging) {
        /* rubber-band at the outer ends (a room's top is HQ: no sky there) */
        const cl = clamp(camY, minCamNow(), world.maxCam);
        if (cl !== camY) {
          camY = Math.abs(camY - cl) < 0.4 ? cl : lerp(camY, cl, kd(EASE_BAND, dt));
          lastActive = now;
        }
      }

      /* THE TRAVEL. The companion sets off first — easing in over its lead
         beat — and the world follows ~140ms later on a FIXED cubic-out, so
         the room slides in under the character and the slide is over when it
         reads as over: arrival COMMITS a few pixels out instead of letting
         an exponential tail asymptote while input sits dead. */
      if (travelActive) {
        const u = clamp01((now - travelAt) / TRAVEL_LEAD_MS);
        charOff = lerp(charFrom, charLead, u * u);
        const wt = clamp01((now - travelAt - TRAVEL_LAG_MS) / travelMs);
        if (wt > 0) {
          const e = 1 - Math.pow(1 - wt, 3);
          camX = lerp(travelFromX, camXTarget, e);
          if (Math.abs(camX - camXTarget) < TRAVEL_SNAP || wt >= 1) {
            /* ARRIVAL COMMIT: snap, wake, and give the page back */
            camX = camXTarget;
            col = travelDest;
            travelActive = false;
            arriveColumn();
          }
        }
        lastActive = now;
      } else {
        if (dragLeadOn && !pointerDown) dragLeadOn = false; /* lost release */
        if (dragLeadOn) {
          /* the companion sets off with the first centimetres of a held
             drag: it walks toward where the finger says the page is going */
          charOff = lerp(charOff, dragLeadTarget, 1 - Math.pow(0.003, dt));
          lastActive = now;
        } else if (charOff !== 0) {
          /* arrival (or a released drag): it decelerates back to centre */
          charOff = Math.abs(charOff) < 0.4 ? 0 : lerp(charOff, 0, 1 - Math.pow(0.01, dt));
          lastActive = now;
        }
        if (camXBack) {
          /* an uncommitted swipe eases home — the world and the companion
             spring back TOGETHER; nothing rests between columns */
          camX = reduced ? camXTarget : lerp(camX, camXTarget, kd(EASE_BAND, dt));
        /* AND THE CROSSING ITSELF RESOLVES IN STEPS. Read after the camera
           moves, so every other quantised thing this frame agrees about how
           far into the machine's mind we are. */
        mech = reduced ? mechAt(camX) : lerp(mech, mechAt(camX), kd(2e-3, dt));
        /* ATTENTION EASES IN AND LETS GO. The target is the lean while the
           attention is live and zero once it lapses; both directions run
           through the same spring, so noticing and losing interest are the
           same motion played in opposite directions. rps=0.02 is τ≈256ms:
           quick enough to read as reacting, slow enough to be a turn. */
        const attendWant = performance.now() < attendUntil ? attendLean : 0;
        attendHold = reduced ? attendWant : lerp(attendHold, attendWant, kd(2e-2, dt));
          if (Math.abs(camX - camXTarget) < 0.6) {
            camX = camXTarget;
            camXBack = false;
          }
          lastActive = now;
        }
      }
      /* THE VERTICAL TRAVELER. Read the camera's own speed rather than any
         input: a drag, a flick, the wheel, an arrow key and the forming
         line's glide into the sky all move the world, and the companion
         answers the world. */
      const camVY = dt > 0 ? (camY - camYPrev) / dt : 0;
      camYPrev = camY;
      const wantPitch = reduced ? 0 : clamp(camVY / PITCH_FULL, -1, 1);
      pitch = Math.abs(pitch - wantPitch) < 0.002 ? wantPitch : lerp(pitch, wantPitch, kd(2e-3, dt));
      /* it leads the world the same way it leads a room transition: up first,
         then the world follows it up */
      const wantLift = reduced ? 0 : -pitch * PITCH_LEAD_PX;
      charLift = Math.abs(charLift - wantLift) < 0.2 ? wantLift : lerp(charLift, wantLift, kd(6e-3, dt));
      /* the hover-bob quickens toward a WALK while the companion leads, and
         relaxes back to a hover at rest — one integrated phase, no jumps.
         Rising it LENGTHENS (buoyant), descending it quickens (settling). */
      /* AND IT IS THIS BEING'S OWN RATE. `bobRate` and `blinkMs` were hashed
         per wall, given per-being ladders, and then read nowhere — every
         companion in the world bobbed at exactly 1.4 and blinked on the same
         distribution. For a product whose thesis is a companion with a
         character, the individuality was authored and thrown away. */
      bobPh +=
        dt *
        wornBeing().bobRate *
        (1 + 0.6 * clamp01(Math.abs(charOff) / DRAG_LEAD_PX)) *
        (1 + 0.45 * pitch);
      /* arrived before the data: the wall holds still until it can wake whole */
      if (awaitingWake && !travelActive) tryWakeWall();

      /* the hold: down over about a second when the world has been left
         alone, and never below a fifth — still breathing, never frozen */
      const settleWant = now - stirAt > SETTLE_IDLE ? SETTLE_MIN : 1;
      if (settle !== settleWant) {
        settle =
          Math.abs(settle - settleWant) < 0.005
            ? settleWant
            : lerp(settle, settleWant, kd(EASE_SETTLE, dt));
      }

      if (scrubDirty) {
        scrubDirty = false;
        reconcileScrub();
        computeInspiration();
        lastActive = now;
      }


      const selActive = selectedIdRef.current !== null;
      /* The field never stops drifting, even while an orb is focused — only
         the focused orb itself holds still (step() skips anything held). */
      if (selActive) springs();
      step(dt, now);

      /* presentation lerps: the unrelated sink into the haze, the kin light
         up. Bloom eases in over ~300ms — light blooms, it does not pop. The
         orb's scale rides nothing: selection never touches geometry. */
      /* a vertical move in progress is motion, so the loop stays awake for it */
      let easing = Math.abs(pitch) > 0.01 || Math.abs(charLift) > 0.4;
      allBalls((arr) => {
        for (const b of arr) {
          /* SEARCHING USES THE FOCUS LAW IT ALREADY HAS. A search is the same
             sentence as a selection — "this one, and everything else sinks" —
             so it runs through dim and glow rather than through a results
             list. The memory keeps its place in the field, which is the one
             thing a list can never show you. */
          const hits = foundRef.current;
          const missed = hits !== null && !hits.has(b.sigId ?? b.id);
          const wantDim = missed || (selActive && b.hold === 0) ? 1 : 0;
          const wantGlow = b.hold !== 0 || (hits !== null && !missed) ? 1 : 0;
          /* CONTACT, ON BOTH PATHS. This lived inside the else, so a person
             who asked for less movement got no answer under their finger at
             all — and being told what you are touching is a STATE, not a
             motion. It renders instantly there, exactly as dim and glow do. */
          const wantPress = b.id === pressId ? 1 : 0;
          if (reduced) {
            b.dim = wantDim;
            b.glow = wantGlow;
            if (b.press !== wantPress) {
              b.press = wantPress;
              easing = true;
            }
          } else {
            /* ASYMMETRIC ON PURPOSE. Light arrives fast and leaves slowly:
               a grab answers in a couple of frames, and letting go decays the
               way a real afterglow does. Grabbing and releasing sharing one
               curve is exactly what a CSS transition looks like. */
            const kg = kd(wantGlow > b.glow ? EASE_GLOW_IN : EASE_GLOW_OUT, dt);
            const km = kd(wantDim > b.dim ? EASE_DIM_IN : EASE_DIM_OUT, dt);
            b.dim = Math.abs(b.dim - wantDim) < 0.01 ? wantDim : lerp(b.dim, wantDim, km);
            b.glow = Math.abs(b.glow - wantGlow) < 0.01 ? wantGlow : lerp(b.glow, wantGlow, kg);
            /* contact: on in about thirty milliseconds, off over a couple of
               hundred, so touchdown is answered inside a single frame */
            b.press =
              Math.abs(b.press - wantPress) < 0.004
                ? wantPress
                : lerp(b.press, wantPress, kd(wantPress > b.press ? EASE_PRESS_IN : EASE_PRESS_OUT, dt));
            if (b.press !== wantPress) easing = true;
            if (b.dim !== wantDim || b.glow !== wantGlow) easing = true;
          }
        }
      });

      /* The dial winds the companion around. While a finger owns the dial the
         yaw chases the scrub POSITION — weighted, never rigid. On release it
         unwinds the short way round, so it always comes to rest facing
         forward however many turns it was wound. */
      if (reduced) {
        yaw = 0;
        yawTarget = 0;
        unwindAt = 0;
      } else if (scrubbingRef.current) {
        unwindAt = 0;
        yaw = lerp(yaw, yawTarget, kd(EASE_YAW_SCRUB, dt));
        easing = true;
      } else if (travelYaw) {
        /* the traveler's turnaround: the same planet turn, held at a quarter
           toward the edge for the whole slide — profile view, facing where
           it is going. Arrival clears this and the unwind brings it back. */
        unwindAt = 0;
        yaw = lerp(yaw, yawTarget, kd(EASE_YAW_TRAVEL, dt));
        easing = true;
      } else if (unwindAt > 0 || yaw !== 0 || yawTarget !== 0) {
        if (unwindAt === 0) {
          /* drop whole turns first — turning 360° is turning nowhere */
          let a = yaw % TAU;
          if (a > Math.PI) a -= TAU;
          else if (a < -Math.PI) a += TAU;
          unwindFrom = a;
          yaw = a;
          yawTarget = 0;
          unwindAt = now;
        }
        const u = clamp01((now - unwindAt) / UNWIND_MS);
        yaw = unwindFrom * Math.pow(1 - u, 3);
        easing = true;
        if (u >= 1) {
          yaw = 0;
          unwindFrom = 0;
          unwindAt = 0;
        }
      }

      /* a memory coming back to life after a reflection */
      allBalls((arr) => {
        for (const b of arr) {
          if (b.relightAt === 0) continue;
          const u = clamp01((now - b.relightAt) / RELIGHT_MS);
          const e = 1 - Math.pow(1 - u, 3);
          b.alive = lerp(b.aliveFrom, b.aliveTo, e);
          b.alivePow = Math.pow(b.alive, 1.4);
          /* a swell that comes back to nothing: the light stays where the
             aliveness genuinely put it, and only the announcement fades */
          b.relight = Math.sin(u * Math.PI);
          easing = true;
          if (u >= 1) {
            b.relightAt = 0;
            b.relight = 0;
          }
        }
      });

      /* the companion. Its glow eases toward the real signal; its flare
         decays; it blinks; and when it is genuinely inspired, motes rise. */
      inspNow = reduced ? insp : lerp(inspNow, insp, 1 - Math.pow(0.02, dt));
      if (flare > 0) {
        flare = Math.max(0, flare - dt / 0.7);
        easing = true;
      }
      /* Something was captured today. That is a STATE, and states render —
         so it is a steady offset under the companion's light, not a twitch.
         (It used to flash every six seconds: the world brightening itself
         some six hundred times an hour with no hand involved anywhere, which
         is the same crime as a camera move on panel-open.) */
      freshLit = freshToday ? 0.12 : 0;
      if (!reduced) {
        /* Something is forming above: every nine seconds or so it looks up,
           and every fourteen it sends a mote that way. The companion is how
           the page mentions the sky without a banner. */
        /* IT IS ALIVE WHETHER OR NOT YOU ARE. An idle system needs three
           clocks — a continuous one (the bob), a frequent one (the blink),
           and an OCCASIONAL one, and production idle sets put the third at
           every 30–60s. Without it a single loop starts reading as a loop at
           about ninety seconds, which is well inside a session. This is that
           third clock, and it runs on an empty archive too: the creature's
           aliveness is its own, not a readout of yours. */
        if (idleAt === 0) idleAt = now + 22000 + Math.random() * 14000;
        if (now >= idleAt) {
          idleAt = now + 30000 + Math.random() * 30000;
          glanceUntil = now + 900;
          /* it looks somewhere of its own choosing, not at you */
          eyeTX = (Math.random() - 0.5) * 1.6;
        }
        const forming = nebs.length > 0;
        if (forming) {
          if (glanceAt === 0) glanceAt = now + 4000;
          if (now >= glanceAt) {
            glanceAt = now + 9000;
            glanceUntil = now + 1200;
          }
          if (riseAt === 0) riseAt = now + 7000;
          if (now >= riseAt) {
            riseAt = now + 14000;
            for (let i = 0; i < 4; i++)
              if (riseA[i] <= 0) {
                riseX[i] = (Math.random() - 0.5) * charSize * 0.5;
                riseY[i] = -charSize * 0.45;
                riseA[i] = 0.85;
                break;
              }
          }
        } else {
          glanceUntil = 0;
        }
        for (let i = 0; i < 4; i++) {
          if (riseA[i] <= 0) continue;
          riseY[i] -= dt * 58;
          riseA[i] -= dt * 0.26;
          easing = true;
        }
        /* presence, not cartoon tracking: at most a couple of pixels */
        const glanceY = now < glanceUntil ? -2 : eyeTY;
        eyeX = lerp(eyeX, eyeTX, 1 - Math.pow(0.05, dt));
        eyeY = lerp(eyeY, glanceY, 1 - Math.pow(0.05, dt));
        /* RHYTHM, THE THIRD THING THE CROSSING QUANTIZES.
           Position was quantized, then the float became a tick — but the eyes
           still slid smoothly and the blink still fell at a human's uneven
           interval, so the creature was a machine that moved like an animal.
           Gaze is where that shows most: a continuous glide across a stepped
           world is the one motion that gives the illusion away.

           `mech` is 0 on your own wall and 1 standing in an agent's, so this
           is the same crossing signal everything else reads. Nothing new is
           introduced — a value that was continuous becomes discrete, which is
           the only sentence this world knows how to say about machines. */
        if (mech >= 0.02) {
          const eyeStep = 0.35 + mech * 0.85;
          eyeX = Math.round(eyeX / eyeStep) * eyeStep;
          eyeY = Math.round(eyeY / eyeStep) * eyeStep;
        }
        if (now >= blinkAt) {
          /* its own blink interval, +/- 40%, instead of everyone's 5-9s —
             and on a machine's wall the jitter is quantized out of it, so the
             blink arrives on a beat rather than whenever. A metronome is what
             a clock looks like from the outside. */
          const base = wornBeing().blinkMs;
          const jitter = 0.8 + Math.random() * 0.4;
          blinkAt = now + base * lerp(jitter, 1, clamp01(mech));
          blink = 1;
        }
        if (blink > 0) blink = Math.max(0, blink - dt / 0.12);
        const strong = clamp01(inspNow + flare * 0.5) > 0.55;
        for (let i = 0; i < 10; i++) {
          if (upA[i] > 0) {
            upY[i] -= dt * 26;
            upA[i] -= dt * 0.55;
          } else if (strong && Math.random() < dt * 2.2) {
            upX[i] = (Math.random() - 0.5) * charSize * 1.1;
            upY[i] = charSize * 0.3;
            upA[i] = 0.8;
          }
        }
      }

      /* the air drifts upward and re-wraps; frozen under reduced motion */
      if (!reduced) {
        /* higher air: in the sky the motes are a little quicker and a little
           sparser — the same atmosphere, thinner */
        const up = clamp01(-camY / Math.max(vh, 1));
        /* THE AIR IS THE ARCHIVE'S ALIVENESS, at the scale of a whole screen.
           You cannot paint a screenful of "twelve percent more alive" onto
           objects — but air can carry it: a dead archive has still air, a live
           one has moving air. Same scalar the companion reads, on the one
           layer that is already continuous and asks for no attention. */
        const rate = lerp(1, 1.6, up) * lerp(0.55, 1.35, inspNow);
        for (let i = 0; i < MOTES; i++) {
          moteY[i] -= moteS[i] * rate * settle * dt;
          if (moteY[i] < -8) {
            moteY[i] = vh + 8;
            moteX[i] = Math.random() * vw;
          }
        }
      }

      /* which patterns could be joined — recomputed only when the set itself
         changes, so a still sky costs nothing */
      {
        let sig = "";
        for (const n of nebs) if (n.pairable) sig += n.id + "|";
        if (sig !== pairSig) {
          pairSig = sig;
          setPairableIds(new Set(nebs.filter((n) => n.pairable).map((n) => n.id)));
        }
      }
      /* Two discrete facts leave the loop for React, and only when they
         change: whether the camera is in the sky (the dial has no meaning
         there) and which nebulae have been drawn together. */
      const nowInSky = camY < world.minCam * 0.45;
      if (nowInSky !== skyShown) {
        skyShown = nowInSky;
        setInSky(nowInSky);
      }
      /* and a third: the camera stands over a wall that has no dial, so the
         dial fades away — exactly as it does in the sky. Read off the camera
         rather than off arrival, so it goes as the wall slides in. */
      /* AND TIME ONLY MEANS SOMETHING TO THE FIELD.
         The dial lay across the bottom edge at all times — but in this world
         HORIZONTAL means "whose wall", and the dial means "when". Two
         different horizontal meanings on the same edge, and the bottom edge
         belongs to the axis. There is also nothing up here to wind: the sky
         holds patterns that are still forming and headquarters holds one
         sentence, neither of which has a history to scrub. So it comes up
         with the field and goes away with it. */
      const inField = camY > world.fieldTop * 0.5;
      /* THE LEGEND BELONGS TO THE GROUND IT EXPLAINS.
         It is a key to the orbs, so it exists where the orbs are. Standing at
         headquarters reading one sentence, or up in the sky among patterns,
         a list of whose-colour-is-whose answers a question nobody is asking —
         it was just chrome in the corner. It comes up with the field and goes
         away with it, exactly as the timeline does. */
      if (inField !== inFieldShown) {
        inFieldShown = inField;
        setInField(inField);
      }
      const nowAway =
        !inField || !hasDial(wallAt(Math.round(camX / Math.max(vw, 1))).kind);
      if (nowAway !== dialAwayShown) {
        dialAwayShown = nowAway;
        setDialAway(nowAway);
      }
      if (nebs.length > 1) {
        const sig = computeClusters();
        if (sig !== clusterSig) {
          clusterSig = sig;
          setClusterSig(sig);
          /* who whispers: the members of any cluster, parsed once per change */
          clusterMembers = new Set();
          for (const part of sig.split("|"))
            if (part) for (const id of part.split("+")) clusterMembers.add(id);
        }
      } else if (clusterSig !== "") {
        clusterSig = "";
        setClusterSig("");
        clusterMembers = new Set();
      }

      draw(now);
      syncDom();

      /* The field drifts continuously, so there is no longer an idle state to
         fall into while it is visible: the loop rests only when the document
         is hidden (handled in onVis) or when reduced motion has parked every
         orb at its home and genuinely nothing is moving. */
      let awake =
        !reduced ||
        pouring ||
        !poured ||
        travelActive ||
        camXBack ||
        scrubbingRef.current ||
        selActive ||
        pointerDown ||
        easing ||
        camAiming ||
        snapAt > 0 ||
        camY < minCamNow() ||
        camY > world.maxCam;
      if (!awake) {
        for (const b of list) {
          if (b.leaving) {
            awake = true;
            break;
          }
        }
      }
      if (awake) lastActive = now;
      const grace = reduced ? 200 : 2600; /* breath settles, then true rest */
      if (now - lastActive > grace) {
        running = false;
        cancelAnimationFrame(raf);
      }
    }

    /* ---------------- selection ---------------- */

    function releaseHolds() {
      allBalls((arr) => {
        for (const b of arr) b.hold = 0;
      });
      if (heldBall) {
        heldBall.hold = 0;
        heldBall = null;
      }
      if (selSat) selSat.held = false;
    }

    /* Nothing moved while an orb was focused, so nothing needs to re-settle:
       releasing lifts the haze and leaves the pile exactly as it was. */
    function release() {
      releaseHolds();
      selSat = null;
      selectedIdRef.current = null;
      setSelectedId(null);
      /* Nothing to give back: opening the panel moved nothing, so closing it
         moves nothing either. */
      wake();
    }

    /**
     * Tap is FOCUS. `hold` marks the one lit orb and freezes the physics — it
     * is never a position target. The orb brightens and EVERY other orb dims
     * uniformly. No threads, no filaments, no second tier of highlighting.
     *
     * The camera is NOT moved here. Reading one saved thought is not an event:
     * the panel is placed beside the orb where it already sits, and place()
     * nudges the camera only when the orb would otherwise be out of view.
     */
    function select(id: string) {
      const b = findBall(id);
      if (!b || !b.active) return;
      if (selectedIdRef.current === id) {
        release();
        return;
      }
      releaseHolds();
      selSat = null;
      selectedIdRef.current = id;
      setSelectedId(id);
      /* IT LOOKS AT WHAT YOU TAPPED.
         A companion that only ever looks at the user is a cursor; the whole
         idea of attention as an interface is that it can go somewhere else.
         So the eyes leave you and go to the memory, the body leans after them,
         and it holds there while you read. It does not travel: tap is focus,
         not rearrangement, and the world stays where you left it. */
      attendTo(b.x, b.y);
      b.hold = 1;
      heldBall = b;
      /* the companion brightens in sympathy with an alive bubble */
      if (b.alive > 0.55) flare = Math.max(flare, 0.6);
      /* Its kin are NOT lit and NOT moved. Exactly one thing on screen is
         lit; the connections belong in the panel as text, never in the jar. */
      wake();
    }

    /**
     * Tapping a SATELLITE is tapping the memory it stands for. The same
     * reading panel opens — and where that memory also has a place in a field
     * below, it lights there too, because it is the same memory and not a
     * copy of one. Another member's save is never fetched: its preview and its
     * owner are all of it that is ours to show.
     */
    function selectSat(s: Sat) {
      if (selectedIdRef.current === s.id) {
        release();
        return;
      }
      releaseHolds();
      selSat = s;
      s.held = true;
      selectedIdRef.current = s.id;
      setSelectedId(s.id);
      const b = findBall(s.id);
      if (b) {
        b.hold = 1;
        heldBall = b;
        if (b.alive > 0.55) flare = Math.max(flare, 0.6);
      }
      wake();
    }

    /** Is the pointer over the companion? It sits in front of the field. */
    function overChar(cx: number, wy: number): boolean {
      const dx = cx - (vw / 2 + charOff);
      const dy = wy - charY;
      const r = charSize * 0.55;
      return dx * dx + dy * dy <= r * r;
    }

    /**
     * What is under the pointer — hit-tested in the EXACT reverse of the
     * order the draw pass paints in, so the orb whose pixels are on top is
     * the orb that answers. (Walking `list` by index instead was the bug
     * behind "I click one ball and a different one lights up": the painter's
     * order is by depth, and index order has nothing to do with it.)
     *
     * It re-sorts first because a tap can arrive while the loop is parked;
     * the sort is O(n) on the near-sorted array it shares with the renderer.
     */
    function hitAt(cx: number, cy: number): Ball | null {
      const wx = cx + camX;
      const wy = cy + camY;
      let found: Ball | null = null;
      const scan = (arr: Ball[], ord: number[]) => {
        sortByDepth(arr, ord);
        for (let k = ord.length - 1; k >= 0; k--) {
          const b = arr[ord[k]];
          if (!b.active || b.gone > 0.6) continue;
          const dx = b.x - wx;
          const dy = b.y - wy;
          if (dx * dx + dy * dy <= (b.r + 4) * (b.r + 4)) {
            found = b;
            return;
          }
        }
      };
      scan(list, order);
      return found;
    }

    /**
     * What is under the pointer up in the orbits — in the exact reverse of the
     * paint order, so the satellite whose pixels are on top answers: the NEAR
     * half before the far one, and within a half the nearest first. Both loops
     * are reversed, and the inner one walks satPass's own `satOrd`: one
     * ordering, read forward to draw and backward to pick, so the two can
     * never disagree about which orb is on top.
     */
    function satAt(cx: number, cy: number): Sat | null {
      /* only the subject has satellites, so there is only one system to test
         — and a retracting one is on its way out and answers nothing */
      const n = focusNeb;
      if (!n || n.gone > 0.4 || n.condense < 0.99) return null;
      const wx = cx + camX;
      const wy = cy + camY;
      for (let half = 0; half < 2; half++) {
        const near = half === 0;
        for (let k = n.satOrd.length - 1; k >= 0; k--) {
          const s = n.sats[n.satOrd[k]];
          if ((s.front > 0) !== near) continue;
          /* half-emerged is half under the words: it answers once it is out */
          if (s.em < 0.5) continue;
          const dx = s.x - wx;
          const dy = s.y - wy;
          const rr = s.dr + 4;
          if (dx * dx + dy * dy <= rr * rr) return s;
        }
      }
      return null;
    }

    /**
     * Nearest-first across BOTH populations, by the same depth rule the paint
     * order obeys: whichever sits lower in the world is the nearer, and the
     * nearer answers. (The sky and the fields are a section apart, so this
     * only ever has one candidate — but it is decided by depth rather than by
     * which array happened to be walked first.)
     */
    function pickAt(cx: number, cy: number): { ball: Ball | null; sat: Sat | null } {
      const sat = satAt(cx, cy);
      const ball = hitAt(cx, cy);
      if (sat && ball) return ball.y >= sat.y ? { ball, sat: null } : { ball: null, sat };
      return { ball, sat };
    }

    function tap(cx: number, cy: number) {
      /* mid-travel the page is the traveler's: taps wait for arrival */
      if (travelActive) return;
      /* the companion answers first: it sits in front of the field */
      if (overChar(cx, cy + camY)) {
        flare = 1;
        setCharSay(sayLine());
        wake();
        return;
      }
      const hit = pickAt(cx, cy);
      if (hit.sat) {
        selectSat(hit.sat);
        return;
      }
      if (hit.ball) {
        select(hit.ball.id);
        return;
      }
      /* bare sky: the subject gives its evidence back and everything returns
         to rest — the same tap that releases a focused orb down in the field */
      if (focusNeb) focusOn(null);
      if (selectedIdRef.current) release();
    }

    /** The whisper beside a satellite: whose memory it is, once, in words. */
    function sayWho(s: Sat | null) {
      const el = satSayRef.current;
      if (!el) return;
      const who = s && s.who ? s.who : "";
      if (who === satSaid) return;
      satSaid = who;
      /* the element carries no React children, so writing it here is safe —
         the same way the dial writes its own date. The words STAY through the
         fade-out: swapping them to nothing is what would make it flicker. */
      if (who) {
        el.textContent = who;
        /* measured here and only here: the words just changed, and the loop
           reads this number to keep the name inside the sky */
        satSayW = el.offsetWidth || 0;
      }
      el.classList.toggle("jar-satsay--on", who !== "");
    }

    /* ---------------- input ---------------- */

    const isChrome = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-jar-chrome]") !== null;
    /* Only GENUINELY interactive elements own their presses — buttons,
       links, fields, the dial's track, and the reading panel, where text
       selection matters more than dragging. Everything else, text included,
       must feed the same camera machinery as bare ground: the ambition's
       words, the whispers and the room titles are the page, and the page
       drags. */
    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element &&
      t.closest(
        "button, a, textarea, input, select, .jar-dial-track, .jar-panel, [data-jar-interactive]",
      ) !== null;

    /** Hand the world back: the capture and the identity always go together. */
    const releaseOwner = (id: number) => {
      if (ownerId !== id) return;
      try {
        root!.releasePointerCapture(id);
      } catch {
        /* already gone with the pointer itself */
      }
      ownerId = null;
    };

    const onDown = (e: PointerEvent) => {
      /* capture phase: interactive elements keep their own behaviour */
      if (isInteractive(e.target)) return;
      /* mid-travel the camera belongs to the traveler */
      if (travelActive) return;
      /* ONE GESTURE OWNS THE WORLD, AND THE CLOUD DRAG IS ONE OF THEM.
         Ownership used to be claimed AFTER the nebula branch had already
         returned, so a cloud drag ran with no identity and no capture and
         carried both halves of the bug the world drag had just had fixed: a
         second finger rewrote the grab offsets, so the first finger's next
         move teleported the cloud by the distance between them, and a drag
         that left the window delivered no pointerup at all — welding the
         cloud to the cursor until the next click. It is claimed here, once,
         before anything branches, because every press that gets this far is
         the world's: a cloud, a satellite, an orb, or bare ground. */
      if (ownerId !== null) return;
      ownerId = e.pointerId;
      try {
        root!.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic or already-released pointer: the window listeners still
           carry the gesture, they just do not get the off-window guarantee */
      }
      /* A press on a nebula SENTENCE grabs its cloud — the words visually
         ARE the cloud — and a press on the bare cloud does the same:
         proximity is how candidates are gathered into one ambition. */
      let nb: Neb | null = null;
      const nebEl = e.target instanceof Element ? e.target.closest(".jar-neb") : null;
      if (nebEl) {
        for (const [id, el] of nebElsRef.current) {
          if (el === nebEl) {
            const cand = nebs.find((q) => q.id === id) ?? null;
            if (cand && !(cand.gone > 0.4 || cand.condense < 0.99)) nb = cand;
            break;
          }
        }
      }
      /* A satellite is NEARER than the cloud it orbits, and part of its
         ellipse passes over the cloud's own handle — so it answers first, or
         a press there would start a drag and the tap that opens the memory
         would never happen. The sentence above keeps its precedence: the
         words visually ARE the cloud. */
      const onSat = nb ? null : satAt(e.clientX, e.clientY);
      if (!nb && !onSat) nb = camY < world.minCam * 0.3 ? nebAt(e.clientX, e.clientY) : null;
      if (nb) {
        /* a cloud on the move carries no whisper: the name belongs to the
           memory under the pointer, and the pointer now owns the cloud */
        hoverSat = null;
        sayWho(null);
        nebDrag = nb;
        nebMoved = false;
        nb.dragging = true;
        nebOffX = nb.x - (e.clientX + camX);
        nebOffY = nb.y - (e.clientY + camY);
        nb.dragX = nb.x;
        nb.dragY = nb.y;
        /* a press is not yet a drag: it becomes one at the same six pixels
           the rest of the page uses, and until then it is still a TAP */
        downX = e.clientX;
        downY = e.clientY;
        wake();
        return;
      }
      if (onSat) {
        /* touching one raises its owner's name too, not only hovering */
        hoverSat = onSat;
        sayWho(onSat);
      }
      pointerDown = true;
      dragging = false;
      dragAxis = 0;
      downX = e.clientX;
      downY = e.clientY;
      lastY = e.clientY;
      lastX = e.clientX;
      downT = lastT = performance.now();
      camVel = 0;
      velX = 0;
      /* Interrupting a camera move is always legal — a camera is a position
         and a velocity, and nothing about one is half-rendered. But the world
         still owes you a resting place: this used to strand the camera
         between two sections permanently, against the page's own law that it
         never rests between them. */
      interruptedSnap = camAiming;
      camAiming = false;
      snapAt = 0;
      /* Warm the reading while the finger is still down: it buys the whole
         press-to-release interval, and it is free when the background sweep
         has already been here. Another member's room orb is never fetched —
         its preview is all that is ours to show. */
      const warm = onSat ? findBall(onSat.id) ?? null : hitAt(e.clientX, e.clientY);
      if (warm && (warm.col === undefined || warm.own))
        void loadDetailRef.current(warm.sigId ?? warm.id);
      /* AND THE LIGHT ANSWERS AT TOUCHDOWN. The whole contact term was built
         and then never armed — `pressId` was declared, read once in the loop
         and written nowhere, so `press` sat at zero forever and a press still
         produced literally nothing for the ninety to two hundred and fifty
         milliseconds the finger was down. The hit is already in hand for the
         prefetch above, so this costs one assignment. */
      pressId = warm ? warm.id : null;
      wake();
    };
    /**
     * TURN AND LEAN TOWARD A POINT IN THE WORLD.
     *
     * Gaze reads as intention rather than as a pointer when the movement is
     * LEGIBLE — when it commits early and bends away from the alternatives
     * instead of taking the shortest path. So the look overshoots slightly and
     * settles, and the body follows the eyes rather than arriving with them.
     */
    function attendTo(wx: number, wy: number) {
      const dx = wx - (camX + vw / 2);
      const dy = wy - charY;
      const d = Math.hypot(dx, dy) || 1;
      /* overshoot: it commits to the direction before it has finished moving */
      eyeTX = clamp((dx / d) * 2.6, -2.4, 2.4);
      eyeTY = clamp((dy / d) * 1.6, -1.6, 1.6);
      attendUntil = performance.now() + 2600;
      /* and the body leans after the eyes, not with them */
      attendLean = clamp(dx / Math.max(vw * 0.5, 1), -1, 1) * 0.05;
      wake();
    }

    const onHover = (e: PointerEvent) => {
      /* presence: the eyes drift a couple of pixels toward the last touch */
      const dx = e.clientX - vw / 2;
      const dy = e.clientY + camY - charY;
      const d = Math.hypot(dx, dy) || 1;
      if (performance.now() < attendUntil) return; /* it is looking at something */
      eyeTX = clamp((dx / d) * 2, -2, 2);
      eyeTY = clamp((dy / d) * 2, -2, 2);
      /* which cloud the pointer rests on: a clustered member's whispered
         sentence rises back to full while it is touched */
      hoverNeb = camY < world.minCam * 0.3 ? nebAt(e.clientX, e.clientY) : null;
      /* and which satellite: whose memory it is rises beside it, one fade */
      if (!nebDrag) {
        hoverSat = satAt(e.clientX, e.clientY);
        sayWho(hoverSat);
      }
      /* The cursor says what a tap would do. Every other move is plenty for a
         couple of dozen orbs, and it is the same hit test the tap uses, so
         the pointer never lies about which orb it would take. The cursor
         lives on the ROOT: the canvas is pointer-events:none, so it is never
         the element the cursor resolves from. */
      if ((hoverTick++ & 1) === 0 && !dragging) {
        const over =
          hoverNeb !== null ||
          hoverSat !== null ||
          overChar(e.clientX, e.clientY + camY) ||
          hitAt(e.clientX, e.clientY) !== null;
        const want = over ? "pointer" : "";
        if (cursor !== want) {
          cursor = want;
          root!.style.cursor = want;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      onHover(e);
      if (ownerId !== null && e.pointerId !== ownerId) return;
      if (nebDrag) {
        if (!nebMoved && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > TAP_SLOP)
          nebMoved = true;
        nebDrag.dragX = e.clientX + camX + nebOffX;
        nebDrag.dragY = e.clientY + camY + nebOffY;
        wake();
        return;
      }
      if (!pointerDown) return;
      if (!dragging && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > TAP_SLOP) {
        dragging = true;
        /* the finger is moving the world now, not touching a memory: the
           contact light lets go the moment the gesture changes its mind */
        pressId = null;
        /* The gesture picks its axis ONCE. Sideways on the ground is travel
           (v8) — allowed only from a vertical rest point, never mid-sky, and
           only when a neighbouring column exists to go to. */
        const horiz = Math.abs(e.clientX - downX) > Math.abs(e.clientY - downY);
        dragAxis =
          horiz && canTravelHere() && wallsRef.current.length > 1 && !travelActive
            ? 2
            : 1;
      }
      const dy = e.clientY - lastY;
      lastY = e.clientY;
      const dxm = e.clientX - lastX;
      lastX = e.clientX;
      if (!dragging) return;
      const nowT = performance.now();
      /* Four milliseconds, not one. A coalesced three-pixel jitter over a
         floored 1ms reports three thousand pixels a second — a phantom flick
         six times over the threshold, and the snap now CONSUMES this number. */
      const dts = Math.max(nowT - lastT, 4) / 1000;
      if (dragAxis === 2) {
        /* The room slides only part-way under a finger — commitment is on
           release, and the TRAVELER leads the actual transition. Pulling
           where no neighbour exists meets heavy resistance instead. */
        const off = -(e.clientX - downX);
        const hasNext = col + 1 <= colHi();
        const hasPrev = col - 1 >= colLo();
        const resist = (off > 0 && !hasNext) || (off < 0 && !hasPrev) ? 0.16 : 0.55;
        camX = col * vw + clamp(off * resist, -vw * 0.32, vw * 0.32);
        camXBack = false;
        if (!reduced) velX = lerp(velX, dxm / dts, kd(EASE_VEL, dts));
        /* THE COMPANION SETS OFF WITH THE DRAG: from the first centimetres
           it turns toward the pull and starts walking — leading by the
           fraction of the commit distance dragged. Reduced motion: parked. */
        if (!reduced) {
          dragLeadOn = true;
          const disp = camX - col * vw;
          dragLeadTarget = clamp(disp / (vw * 0.14), -1, 1) * DRAG_LEAD_PX;
          if (Math.abs(dragLeadTarget) > 4) {
            travelYaw = true;
            yawTarget = (dragLeadTarget > 0 ? 1 : -1) * (TAU / 4);
            unwindAt = 0;
          }
        }
        /* travel toward a room begins at swipe start: fetch it now */
        if (off > 20 && hasNext && groupsRef.current[col])
          loadRoomRef.current(groupsRef.current[col].id);
        else if (off < -20 && col - 1 > 0 && groupsRef.current[col - 2])
          loadRoomRef.current(groupsRef.current[col - 2].id);
        lastT = nowT;
        wake();
        return;
      }
      const out = camY < minCamNow() || camY > world.maxCam;
      camY -= dy * (out ? 0.35 : 1);
      /* reduced motion keeps the direct 1:1 drag but drops the inertia */
      if (!reduced) camVel = lerp(camVel, -dy / dts, kd(EASE_VEL, dts));
      lastT = nowT;
      wake();
    };
    const onUp = (e: PointerEvent) => {
      if (ownerId !== null && e.pointerId !== ownerId) return;
      /* the finger is off it: the contact light starts decaying now, and the
         selection's own glow takes over from tap() below */
      pressId = null;
      /* Hand the world back before anything branches. Every path out of here
         is a finished gesture, and the capture and the identity go together —
         the cloud-drag paths used to return without either. */
      releaseOwner(e.pointerId);
      if (nebDrag) {
        const n = nebDrag;
        n.dragging = false;
        nebDrag = null;
        if (!nebMoved) {
          /* A PRESS THAT NEVER MOVED IS A TAP. The candidate becomes the
             subject and its evidence emerges; tapping the subject again gives
             the sky back. Nothing is pinned and nothing is persisted — the
             cloud did not go anywhere. */
          focusOn(focusNeb === n ? null : n);
          return;
        }
        /* dragged off the top of the sky: it thins and disperses. Locally
           only — there is no endpoint to tell that it was let go of. */
        if (n.y < world.minCam + n.r * 0.35) {
          n.gone = 0.01;
          /* A DISPERSING CANDIDATE IS NO LONGER THE SUBJECT OF ANYTHING. The
             same teardown adoption's condense and syncSky already obey: a
             memory being read from a system that is leaving has nothing left
             to sit beside, and a subject that is not there still holds every
             other candidate sunk at FOCUS_DIM for as long as it is the
             subject. focusOn rather than a bare assignment, so focus0/em0 are
             re-based and the retraction eases out with the dispersal instead
             of snapping. */
          if (selSat && n.sats.includes(selSat)) release();
          if (focusNeb === n) focusOn(null);
        } else {
          /* it keeps where it was put — through reloads, too */
          n.pinned = true;
          n.homeX = n.x;
          n.homeY = n.y;
        }
        persistSky();
        wake();
        return;
      }
      if (!pointerDown) return;
      pointerDown = false;
      if (dragAxis === 2) {
        /* completing a swipe: velocity-biased, one column per gesture. The
           finger only pulled the room part-way — the companion now leads the
           actual crossing, or the world eases home uncommitted. */
        const disp = camX - col * vw;
        const dir: 1 | -1 =
          Math.abs(velX) > FLICK ? (velX < 0 ? 1 : -1) : disp > 0 ? 1 : -1;
        const dest = col + dir;
        const commit =
          (Math.abs(velX) > FLICK || Math.abs(disp) > vw * 0.14) &&
          dest >= colLo() &&
          dest <= colHi();
        dragging = false;
        dragAxis = 0;
        dragLeadOn = false;
        if (commit) travel(dir);
        if (!travelActive && camX !== col * vw) {
          /* uncommitted (or travel refused): ease home — never rest between */
          camXTarget = col * vw;
          camXBack = true;
        }
        if (!travelActive) {
          /* it changed its mind with you: turns back and eases home while
             the world springs back under it */
          travelYaw = false;
          unwindAt = 0;
        }
        wake();
        return;
      }
      /* A TAP IS DECIDED ON RELEASE. Six pixels of MANHATTAN distance means a
         four-and-four thumb wobble latches a drag, and the else-branch then
         "snaps" a camera that never moved. What actually distinguishes a tap
         is that it was short and it went nowhere. */
      const held = performance.now() - downT;
      const travel2 = Math.hypot(e.clientX - downX, e.clientY - downY);
      /* (a horizontal gesture has already returned above, so this is only
         ever the vertical axis or a press that never picked one) */
      const wasTap = !dragging || (held < 260 && travel2 < 14);
      /* A FINGER THAT STOPPED IS NOT MOVING. Browsers send no pointermove for
         a stationary finger, so drag fast, stop dead, hold, release — and the
         world used to be thrown at the speed you were moving half a second
         ago. */
      if (performance.now() - lastT > 80) {
        camVel = 0;
        velX = 0;
      }
      if (wasTap && !isChrome(e.target)) {
        tap(e.clientX, e.clientY);
        /* the press interrupted a camera move, so the world is between two
           sections and has to be given a place to rest again */
        if (interruptedSnap) snapSection(0);
      } else {
        /* the page never rests between the two sections */
        snapSection(reduced ? 0 : camVel);
      }
      interruptedSnap = false;
      dragging = false;
      dragAxis = 0;
      /* a finger has no hover to leave with: the name it raised goes on lift */
      if (e.pointerType !== "mouse") {
        hoverSat = null;
        sayWho(null);
      }
      wake();
    };
    const onCancel = (e: PointerEvent) => {
      if (ownerId !== null && e.pointerId !== ownerId) return;
      pressId = null;
      hoverSat = null;
      sayWho(null);
      if (nebDrag) {
        nebDrag.dragging = false;
        /* a cancelled press that never moved never claimed a new place */
        if (nebMoved) {
          nebDrag.pinned = true;
          nebDrag.homeX = nebDrag.x;
          nebDrag.homeY = nebDrag.y;
          persistSky();
        }
        nebDrag = null;
      }
      if (dragAxis === 2) {
        camXTarget = col * vw;
        camXBack = true;
        dragLeadOn = false;
        travelYaw = false;
        unwindAt = 0;
      } else if (dragging || interruptedSnap) {
        /* cancelled mid-drag, or cancelled on a press that had interrupted a
           move: either way the world is owed a resting place */
        snapSection(0);
      }
      interruptedSnap = false;
      camVel = 0;
      velX = 0;
      pointerDown = false;
      dragging = false;
      dragAxis = 0;
      releaseOwner(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      /* the panel scrolls its own content, and so does a long capture in the
         mouth; neither ever drives the camera */
      if (e.target instanceof Element && e.target.closest(".jar-panel, .jar-mouth")) return;
      e.preventDefault();
      if (travelActive) return; /* mid-travel the wheel waits */
      const nowW = performance.now();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
        /* a sideways wheel gesture is travel too: same gates, one column per
           gesture, and the companion still leads the crossing */
        /* A MOMENTUM TAIL MUST NOT BANK THE NEXT CROSSING. A trackpad keeps
           sending deltaX for the better part of a second after the fingers
           have left it, and accumulating that through the lockout meant the
           tail was already over threshold the instant the lockout lifted —
           one gesture, two walls. What arrives during a lockout is the
           previous gesture still ending: it is spent, not saved. */
        if (nowW < wheelXUntil) {
          wheelXAcc = 0;
          return;
        }
        if (!canTravelHere() || wallsRef.current.length < 2) return;
        wheelXAcc += e.deltaX;
        if (Math.abs(wheelXAcc) > 70) {
          const dir: 1 | -1 = wheelXAcc > 0 ? 1 : -1;
          wheelXAcc = 0;
          wheelXUntil = nowW + 450;
          travel(dir);
        }
        return;
      }
      wheelXAcc = 0;
      camY = clamp(camY + e.deltaY, minCamNow() - 60, world.maxCam + 60);
      camAiming = false;
      /* snap once the wheel goes quiet */
      snapAt = nowW + 150;
      wake();
    };
    const onKey = (e: KeyboardEvent) => {
      const step =
        e.key === "ArrowDown" || e.key === "PageDown"
          ? 1
          : e.key === "ArrowUp" || e.key === "PageUp"
            ? -1
            : 0;
      const horiz = e.key === "ArrowLeft" || e.key === "ArrowRight";
      /* "/" IS FIND, EVERYWHERE. The gesture people already have for searching
         a page, and it puts the verb on the world rather than in a menu. */
      if (e.key === "/") {
        e.preventDefault();
        openSeekRef.current();
        return;
      }
      const mine = step !== 0 || horiz || e.key === "Escape";
      if (!mine) return;
      /* the world handles this key, so the browser does not ALSO handle it:
         a native scroll or a focus move underneath the world's own move is a
         second thing happening, and it reads as a fight */
      e.preventDefault();
      /* AUTO-REPEAT IS NOT THIRTY DECISIONS. Held down, a key fires some
         thirty times a second, and each one used to re-solve "the rest point
         nearest camY" — which mid-move is a MOVING value — and retarget from
         it. The move fought itself the whole way down, which is exactly the
         chop that shows up on the keyboard and nowhere else. One press is one
         move; if held-key continuous travel is ever wanted, it belongs on
         ARRIVAL, never on the key event. */
      if (e.repeat) return;
      if (e.key === "Escape") {
        /* one layer at a time: the reading first, then the subject's evidence */
        if (selectedIdRef.current) release();
        else if (focusNeb) focusOn(null);
        return;
      }
      /* Left and right are the traveler's keys — they pass through even
         mid-flight, because travel() itself ignores the same direction and
         treats the opposite one as a REVERSAL back to where it left from. */
      if (horiz) {
        travel(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
      /* The vertical keys are ALLOWED during a horizontal travel: the axes
         are independent — travel writes camX and this writes camY — and
         swallowing the key made pressing down mid-crossing feel dead. (The
         companion answers both at once because it reads the camera's motion,
         not the key.) */
      const rest = restPoints();
      /* WHERE THE PRESS COUNTS FROM. From where the move is HEADED if one is
         in flight, never from where the camera happens to be at this instant
         — a second press should continue the journey, not restart it from
         halfway. */
      const ref = camAiming ? camTarget : camY;
      /* ONE SECTION, FROM WHEREVER IT ACTUALLY IS. Landing on the rest point
         NEAREST `ref` and stepping from there is only correct while `ref` is
         itself a rest point: from a camera stranded between two of them the
         nearest can already be the section the press was meant to reach, and
         the press then skips it. So a stranded camera steps to the first rest
         point strictly PAST it in the direction pressed — which is one
         section of travel from anywhere, and always lands on a rest point. */
      const EPS = 1;
      let at = -1;
      for (let i = 0; i < rest.length; i++) if (Math.abs(rest[i] - ref) <= EPS) at = i;
      let target: number;
      if (at >= 0) {
        target = rest[clamp(at + step, 0, rest.length - 1)];
      } else if (step > 0) {
        target = rest.find((r) => r > ref + EPS) ?? rest[rest.length - 1];
      } else {
        target = [...rest].reverse().find((r) => r < ref - EPS) ?? rest[0];
      }
      aimTo(target, 0);
    };
    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else {
        /* Pour deadlines sit on the absolute clock and the rAF loop was
           cancelled while hidden: re-stagger any that expired so the balls
           still pour in order instead of all landing in one frame. Walk them
           by their existing deadline, which is the pour order whatever the
           list order happens to be. */
        /* ONLY THE DEADLINES THAT ALREADY EXPIRED. Re-staggering the whole
           pending set pushed the ones still in the FUTURE further out every
           time, so a page whose visibility flapped — a backgrounded tab, a
           window being resized, an occluded pane — could starve its own pour
           forever and simply never finish arriving. Balls whose moment has
           not come yet keep it. */
        const nowVis = performance.now();
        let next = nowVis;
        const pending = list.filter((b) => b.spawnAt > 0).sort((a, b) => a.spawnAt - b.spawnAt);
        for (const b of pending) {
          if (b.spawnAt > nowVis) continue;
          b.spawnAt = next;
          next += pourStep;
        }
        wake();
      }
    };
    const onMq = () => {
      reduced = mq.matches;
      if (reduced) camVel = 0;
      wake();
    };

    /* CAPTURE phase, so a press that lands on text still reaches the
       camera machinery; interactive elements are exempted inside onDown */
    root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    root.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    mq.addEventListener("change", onMq);
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    /* HQ's content grows when the ambition and the band arrive, which moves
       the companion's slot — so that block's height is observed too */
    if (hqInnerRef.current) ro.observe(hqInnerRef.current);

    measure();
    if (reduced) settleInstantly();
    else primePour();

    simApiRef.current = {
      scrubTo: (T: number, pos: number) => {
        if (travelActive) return; /* the dial is the personal jar's alone */
        TRef.current = T;
        /* the dial's position IS the companion's yaw: today (the right-hand
           end) is front-facing, and winding back turns it away from you */
        yawTarget = reduced ? 0 : (pos - 1) * TAU * SPIN_TURNS;
        unwindAt = 0;
        if (selectedIdRef.current) release();
        scrubDirty = true;
        wake();
      },
      select,
      release,
      wake,
      /* ~300ms of glow: flare decays over 0.7s, so 0.42 is a beat */
      /**
       * ONE MOMENT, ONE REACTION — AND NEVER THE SAME ONE TWICE.
       *
       * Every act in this world raised the same 0.42 flare: keeping a memory,
       * answering a reading of yourself, walking into a room full of people.
       * A creature that responds identically to everything is not reacting,
       * it is blinking a light, and after ten minutes you stop reading it at
       * all. The point of a companion is that it tells you what KIND of thing
       * just happened before you have parsed the screen.
       *
       * So each moment gets a distinct shape, composed from the three things
       * the body can already do — how hard it flares, where it looks, and how
       * long it holds. Nothing new is drawn; what differs is the gesture.
       */
      acknowledge: (moment: Moment = "touch") => {
        switch (moment) {
          case "kept":
            /* SOMETHING NEW EXISTS. The biggest flare in the world, and the
               eyes go DOWN to the ground where it landed — the creature looks
               at what was just made rather than at you making it. */
            flare = Math.max(flare, 0.95);
            eyeTX = 0;
            eyeTY = 1.5;
            attendUntil = performance.now() + 1500;
            attendLean = 0;
            break;
          case "answered":
            /* YOU TOLD IT SOMETHING TRUE ABOUT YOURSELF. It looks UP at the
               sky it read you from, and holds longer than anything else here:
               this is the slow one, because being understood is not a ping. */
            flare = Math.max(flare, 0.72);
            eyeTX = 0;
            eyeTY = -1.6;
            attendUntil = performance.now() + 2800;
            attendLean = 0;
            break;
          case "arrived":
            /* A NEW WALL. It looks around the room it just walked into — the
               glance system already does this on its own, so this simply asks
               for one now, with a modest flare. Arriving is not an
               achievement and must not be lit like one. */
            flare = Math.max(flare, 0.5);
            glanceAt = performance.now();
            eyeTY = -0.5;
            attendUntil = performance.now() + 1200;
            break;
          case "shared":
            /* IT WENT OUT TO PEOPLE. The eyes go sideways, the way the world
               is laid out — the rooms are over there, and that is where the
               statement just went. */
            flare = Math.max(flare, 0.6);
            eyeTX = 2.2;
            eyeTY = 0;
            attendUntil = performance.now() + 1600;
            attendLean = 0.04;
            break;
          case "let-go":
            /* SOMETHING WAS RELEASED. The one moment with NO flare: light
               rising as a memory leaves would be the creature congratulating
               you for it. It looks down and away instead, and dims a touch.
               Fading never deletes, and letting go is not a win. */
            flare = Math.min(flare, 0.1);
            eyeTX = -1.4;
            eyeTY = 1.2;
            attendUntil = performance.now() + 1900;
            attendLean = -0.03;
            break;
          default:
            /* the plain acknowledgment: a tap was heard */
            flare = Math.max(flare, 0.42);
        }
        wake();
      },
      /**
       * Solve the panel's spot beside the focused orb.
       *
       * THE WORLD DOES NOT MOVE. Opening a panel moves no camera, re-frames
       * nothing and re-solves no homes — a surface appearing must not shove
       * the field around underneath it. The PANEL is the thing that adapts:
       * right flank, then left, then below, then above, and if nothing can
       * clear the orb it takes the room it can and lets the overlap happen.
       *
       * Its size is DECLARED, not measured — width min(420, vw-48), height at
       * most min(62vh, 560px) — so the spot depends only on the viewport and
       * the orb, and never shifts under its own content.
       */
      /**
       * THE PANEL HAS ONE HOME, AND IT IS THE SAME HOME EVERY TIME.
       *
       * This used to solve for a spot beside the orb: right of it, else left,
       * else below, else above, else pinned to the bottom. Every branch was
       * individually reasonable and the result was not — memories are
       * scattered all over the field by design, so consecutive taps threw the
       * card to five different places, and on any viewport under about 900px
       * the first two branches could never fire at all, leaving it flipping
       * between the last three. The founder read that as random because from
       * the reading seat it IS random: nothing you can see predicts it.
       *
       * A reader should not have to find the card. So it is furniture now: a
       * side column on a wide screen, a sheet along the bottom on a narrow
       * one, and nothing about which orb was tapped moves it by a pixel. What
       * connects the card to the memory is the memory's own bloom — the world
       * already spends its whole light channel saying "this one" — rather
       * than proximity, which was never legible anyway once the card had to
       * dodge an edge.
       */
      /**
       * WHERE A MEMORY APPEARS: BESIDE WHOEVER IS READING IT.
       *
       * It used to be pinned to the top-right corner — the standard inspector
       * position, and wrong here for the same reason the founder named it:
       * the character had just turned to look at the memory, and the memory
       * then opened somewhere the character was not. Two things claimed the
       * attention and neither pointed at the other.
       *
       * So the words come out BESIDE THE COMPANION, on the far side from the
       * orb. That ordering matters: the orb, then the companion turned toward
       * it, then what it found — nothing covers the thing being looked at,
       * and the three read as one gesture instead of three panels.
       */
      place: () => {
        const b = selectedIdRef.current ? findBall(selectedIdRef.current) : undefined;
        if (!b && !selSat) return null;
        const M = 20; /* never closer than this to an edge */
        const w = Math.min(Math.max(360, Math.min(vw * 0.3, 500)), vw - 48);
        const cx = vw / 2; /* the companion holds the middle of the frame */
        const cy = charY - camY;
        /* which side is the memory on? the words go to the other one */
        const orbX = b ? b.x - camX : cx;
        const wantRight = orbX <= cx;
        const gap = charSize * 0.72;
        let left = wantRight ? cx + gap : cx - gap - w;
        /* if that side cannot hold it, take the other; if neither can, the
           frame is too narrow for beside-anything and it becomes a sheet */
        if (left < M || left + w > vw - M) {
          left = wantRight ? cx - gap - w : cx + gap;
        }
        if (left < M || left + w > vw - M) {
          return { left: Math.round((vw - w) / 2), top: null, bottom: Math.round(vh - (vh - M)) };
        }
        /* vertically it meets the companion at the shoulder and reads
           downward, clamped so a long memory never leaves the frame */
        const top = clamp(cy - charSize * 0.34, 56, Math.max(56, vh * 0.52));
        return { left: Math.round(left), top: Math.round(top), bottom: null };
      },
      toTop: () => {
        aimTo(0, 0);
      },
      revealMemory: (inspirationId: string) => {
        const b = findBall(inspirationId);
        if (!b) return;
        /* bring it to a comfortable reading height rather than to the exact
           centre: the companion sits mid-frame and the memory should land
           beside it, not behind it */
        const want = clamp(b.y - vh * 0.5, world.minCam, world.maxCam);
        if (Math.abs(want - camY) > 8) {
          snapAt = 0;
          camVel = 0;
          aimTo(want, 0);
        }
        select(inspirationId);
      },
      /* the signal line's glide: programmatic, and exempt from the snap.
         Only the personal column has a sky to glide into. */
      toSky: () => {
        if (col !== 0 || travelActive) return;
        snapAt = 0;
        camVel = 0;
        aimTo(world.minCam, 0);
      },
      travel,
      syncSky,
      /**
       * A reflection was kept. This is not a celebration animation: one more
       * answered reflection and a touch just now are exactly what the real
       * activation engine scores, so the orb's aliveness is recomputed from
       * the same rule and the light rises to where it now belongs. The swell
       * on the way is the state change being announced, and the companion
       * answers with a flare.
       */
      relight: (id: string) => {
        const b = findBall(id);
        if (!b) return;
        const from = b.alive;
        b.reflections += 1;
        b.updatedMs = Date.now();
        colorBall(b, TRef.current);
        b.aliveFrom = from;
        b.aliveTo = b.alive;
        /* it climbs to the new value rather than jumping to it */
        b.alive = from;
        b.alivePow = Math.pow(from, 1.4);
        b.relightAt = reduced ? 0 : performance.now();
        if (reduced) {
          b.alive = b.aliveTo;
          b.alivePow = Math.pow(b.aliveTo, 1.4);
        }
        flare = Math.max(flare, 0.9);
        wake();
      },
      /**
       * BORN AT THE MOUTH.
       *
       * The order here is the whole behaviour: it joins the ground FIRST and
       * the field re-fits around it (so it is homed, sized and counted like
       * every other memory before it has moved a pixel), and only then is it
       * placed at the words and let go. Its entrance is the field's own —
       * the same ease, the same overshoot, the same settle the pour uses —
       * with the height it falls from measured from the mouth rather than
       * dealt from a constant, so it genuinely comes out of the sentence.
       *
       * No camera move. The fall crosses the seam by itself, which is the
       * teaching: what you say goes down there.
       */
      born: (seed: BornSeed) => {
        if (byId.has(seed.id)) return;
        /* a memory now exists that did not a moment ago — the loudest thing
           that happens in this world, and the creature looks down at it.
           After the duplicate guard, so a re-render never re-celebrates. */
        simApiRef.current?.acknowledge("kept");
        const b = bornBall(seed);
        /* KEEPING SOMETHING HAPPENS NOW, so the dial's now is at least this
           moment. Without it the newborn is in the future of the time the
           field is solved at, gets no home at all, and the count would be
           right about a memory that is nowhere. */
        TRef.current = Math.max(TRef.current, b.capturedMs);
        colorBall(b, TRef.current);
        list.push(b);
        byId.set(b.id, b);
        order.push(list.length - 1);
        /* everyone eases to a new home; nobody leaves the screen, which is
           what assignHomes guarantees by construction */
        assignHomes();
        const spot = mouthSpot();
        /* where it is actually headed at THIS camera: a wall whose claim
           rests on it would lift it into the peek row, and the entrance has
           to be measured against the home it is really falling to */
        const lift = peekLift();
        const homeX = b.peek ? lerp(b.homeX, b.peekX, lift) : b.homeX;
        const homeY = b.peek ? lerp(b.homeY, b.peekY, lift) : b.homeY;
        b.active = true;
        b.leaving = false;
        b.gone = 0;
        b.spawnAt = -1;
        if (reduced || spot === null || spot.y >= homeY) {
          /* reduced motion: it is simply already at home, settled */
          b.arrive = 1;
          b.entryH = 0;
          b.x = homeX;
          b.y = homeY;
        } else {
          b.arrive = 0;
          b.entryH = homeY - spot.y;
          b.x = spot.x;
          b.y = spot.y;
        }
        computeInspiration();
        /* the companion answers a keep as it answers a reflection */
        flare = Math.max(flare, reduced ? 0 : 0.9);
        wake();
      },
      identify: (id: string, sigId: string) => {
        const b = byId.get(id);
        if (b) b.sigId = sigId;
      },
      /**
       * IT DID NOT KEEP. The orb fades out where it stands — the scrub-away
       * vocabulary, never a flight — and then leaves the ground, because it
       * was a promise and not a memory. The words go back into the mouth and
       * one quiet line says so: the person never loses what they wrote and is
       * never told nothing.
       */
      unborn: (id: string) => {
        const b = byId.get(id);
        if (!b || b.doomed === true) return;
        b.doomed = true;
        doomedPending++;
        if (reduced) {
          b.active = false;
          b.leaving = false;
          b.gone = 1;
        } else {
          b.leaving = true;
        }
        wake();
      },
      setProvenance: (byWall: Map<string, Provenance>) => {
        wallProv = byWall;
        /* each provenance orb carries the words of its own that carried the
           reading — the panel marks that passage inside the raw text */
        for (const [, prov] of byWall) {
          for (const b of list) {
            const q = prov.get(b.id);
            if (q) b.quote = q;
          }
        }
        provenance = byWall.get(wallKey(curWall())) ?? new Map();
        electPeek(presentBalls());
        wake();
      },
      /* An adopted candidate CONDENSES: its cloud contracts to a bright
         point. The light becoming a single thing is the adoption. */
      /**
       * JOIN, WITHOUT A DRAG.
       *
       * Every function that works by dragging needs a route that does not
       * require dragging — a hard accessibility requirement, and combining
       * two patterns was the one drag-only act in this world. Travel and the
       * descent already have arrow keys; this is the gesture that had nothing.
       *
       * It is also the discoverability fix in disguise. The word only appears
       * on a pattern that HAS a neighbour close enough to join, so seeing it
       * at all teaches that joining exists — which the approach glow never
       * could, because that only fires once a drag is already underway.
       */
      /* WALKING THERE BY NAME. The same travel the drag and the arrow keys
         use, one column at a time, so the choreography is identical however
         you asked for it — the companion still leads, the wall still wakes
         before it renders, and nothing arrives half-poured. */
      /**
       * ONE MOVEMENT, HOWEVER FAR IT IS.
       *
       * This used to chain single-column travels on a timer — `travel(dir)`,
       * wait TRAVEL_MS + 40, again — so crossing from the agent at one end to
       * the last room was five separate glides with a dead stop between each.
       * You watched the companion arrive, settle, turn and set off again four
       * times to make one journey, and the world read as a series of screens
       * rather than as a place with distance in it.
       *
       * It is a single glide now. The camera goes straight to the destination
       * on one eased curve, the companion turns once and leads the whole way,
       * and the duration grows with the square root of the distance — far is
       * longer, but never five times longer. Nothing settles in between,
       * because nothing arrives in between.
       */
      goToWall: (target: number) => {
        const go = () => {
          if (col === target) return;
          const dest = clamp(target, colLo(), colHi());
          if (dest === col) return;
          const dir: 1 | -1 = dest > col ? 1 : -1;
          if (selectedIdRef.current) release();
          /* every wall the glide passes is warmed, not just the destination:
             they are all about to be on screen */
          for (let c = col + dir; dir > 0 ? c <= dest : c >= dest; c += dir) {
            loadWallRef.current(wallAt(c));
          }
          awaitingWake = false;
          travelDest = dest;
          travelDir = dir;
          camXTarget = dest * vw;
          camXBack = false;
          dragLeadOn = false;
          if (reduced) {
            col = dest;
            camX = camXTarget;
            charOff = 0;
            arriveColumn();
            wake();
            return;
          }
          travelActive = true;
          const span = Math.abs(dest - col);
          travelMs = travelSpanMs(span);
          travelAt = performance.now();
          travelFromX = camX;
          /* AND IT HAS TO LOOK FAST, NOT MERELY BE FAST.
             The sqrt duration already makes a five-wall crossing move at
             about 2.2x the speed of a one-wall one, but speed you cannot see
             is not speed: the companion held the same lead and the same lean
             either way, so a long glide read as the same walk over a longer
             corridor.

             The lead is what carries velocity in this world — how far ahead
             of the camera the creature runs, which the body's tilt is already
             derived from, so leaning harder comes free. It grows with the
             same sqrt as the duration and caps at a bit over twice the
             single-wall lead: past that it stops reading as running and
             starts reading as the character having come loose. */
          const urgency = Math.min(2.15, Math.sqrt(Math.max(1, span)));
          charLead = dir * Math.min(vw * TRAVEL_LEAD_X, 190) * urgency;
          charFrom = charOff;
          travelYaw = true;
          yawTarget = dir * (TAU / 4);
          unwindAt = 0;
          wake();
        };
        /* travel needs the camera parked; take it home first */
        if (Math.abs(camY) > 2) {
          aimTo(0, 0);
          window.setTimeout(go, 260);
          return;
        }
        go();
      },
      joinTo: (id: string) => {
        const n = nebs.find((q) => q.id === id);
        if (!n) return;
        let best: Neb | null = null;
        let bestD = Infinity;
        for (const m of nebs) {
          if (m === n || m.gone > 0) continue;
          const d = (m.x - n.x) ** 2 + (m.y - n.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        }
        if (!best) return;
        /* placed just inside the distance the release actually clusters at,
           so the existing pass does the joining — one rule, not two */
        const dx = n.x - best.x;
        const dy = n.y - best.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = (n.r + best.r) * 0.42;
        n.homeX = n.x = best.x + (dx / d) * want;
        n.homeY = n.y = best.y + (dy / d) * want;
        n.haloX = n.x;
        n.haloY = n.y;
        n.pinned = true;
        flare = Math.max(flare, reduced ? 0 : 0.4);
        wake();
      },
      condense: (id: string) => {
        const n = nebs.find((q) => q.id === id);
        if (!n) return;
        n.condenseAt = performance.now();
        /* THE HIERARCHY HAD ITS SIGN FLIPPED. Poking the companion flared it
           to nearly full and changed nothing; adopting an ambition — the
           rarest and least reversible act here — changed everything and
           produced no light at all. */
        flare = 1;
        /* its satellites spiral in with it, so nothing is left to read beside */
        if (selSat && n.sats.includes(selSat)) release();
        wake();
      },
      /**
       * The invariant, counted rather than glanced at.
       *
       * It measures the GUARANTEE, not a sample: an orb's envelope is its home
       * (swept, if it is a peek orb) plus its own drift amplitude and its
       * radius, which is exactly the promise assignHomes makes. A ball that
       * only happens to be on screen at this instant is not on screen.
       */
      audit: (): FieldAudit => {
        const bandTop = 0;
        /* the MEASURED dial, not the guess: the band the layout actually
           solves against is world.fieldBottom, which is worldH − dialH, and
           at rest in the field that is exactly vh − dialH on screen. An audit
           that measured a different band from the one assignHomes fits into
           would be grading a promise nobody made. */
        const bandBottom = vh - dialH;
        let present = 0;
        let onScreen = 0;
        let clippedTop = 0;
        let clippedBottom = 0;
        let highest = Infinity;
        let lowest = -Infinity;
        for (const b of list) {
          if (b.capturedMs > TRef.current) continue;
          present++;
          const home = b.peek ? lerp(b.homeY, b.peekY, peekLift()) : b.homeY;
          const hi = home - b.ampY - b.r - camY;
          const lo = home + b.ampY + b.r - camY;
          if (hi < highest) highest = hi;
          if (lo > lowest) lowest = lo;
          const okTop = hi >= bandTop;
          const okBottom = lo <= bandBottom;
          if (okTop && okBottom) onScreen++;
          else {
            if (!okTop) clippedTop++;
            if (!okBottom) clippedBottom++;
          }
        }
        return {
          vh,
          vw,
          camY: Math.round(camY),
          fieldRest: Math.round(world.maxCam),
          present,
          onScreen,
          clippedTop,
          clippedBottom,
          highest: Math.round(highest),
          lowest: Math.round(lowest),
          bandTop,
          bandBottom,
        };
      },
    };
    wake();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      root.style.cursor = "";
      root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMq);
      simApiRef.current = null;
      ballsRef.current = null;
      /* room orbs belong to this run of the loop; the DATA cache stays */
      roomBallsRef.current.clear();
    };
    /* The field is what you kept AND what your agents kept, so the loop waits
       for both before it builds anything — one pour, never a second one. */
  }, [captures, agents, walls, roomFieldTick]);

  /* ---------------- dial scrubbing (writes refs, not state) ---------------- */

  const scrubClient = useCallback(
    /**
     * TIME IS THE VERTICAL AXIS NOW.
     *
     * The bottom edge belongs to the axis of walls — whose mind you are
     * standing in — and the timeline was laid across the same edge, so the
     * one horizontal band in the world carried two unrelated meanings and a
     * sideways drag could plausibly have meant either. Two meanings, two
     * axes: side to side is WHOSE, up and down is WHEN. Nothing else about
     * the dial changes; it reads clientY against the track's height exactly
     * as it read clientX against its width.
     */
    (clientY: number) => {
      const track = dialTrackRef.current;
      if (!track || !dial) return;
      const rect = track.getBoundingClientRect();
      const p = clamp((clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
      const T = dial.start + p * dial.span;
      const pct = `${(p * 100).toFixed(2)}%`;
      const handle = dialHandleRef.current;
      if (handle) handle.style.top = pct;
      setAtNow(dial.end - T < DAY_MS / 2);
      /* The date rides ALONGSIDE the handle rather than inside it: the handle
         scales up while the dial is live, and a label inheriting that scale
         is how the date came to be printed at poster size. */
      const date = dialDateRef.current;
      if (date) {
        date.style.top = pct;
        /* SPOKEN, like every other date on this surface. This printed "Jun 25"
           — digits, in reading text — and it only appears mid-scrub, which is
           why a walk of the resting page never caught it. It shares the
           panel's formatter now, so there is one place a date can be wrong. */
        date.textContent = dateWords(T, dial.end);
      }
      /* the normalised position travels WITH the time: the companion's spin is
         direct manipulation of the dial, so it reads the same number the
         handle does rather than deriving one in the draw pass */
      simApiRef.current?.scrubTo(T, p);
      applyChromeRef.current(T);
    },
    [dial],
  );

  const onDialDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      scrubbingRef.current = true;
      setScrubbing(true);
      scrubClient(e.clientY);
    },
    [scrubClient],
  );
  const onDialMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (scrubbingRef.current) scrubClient(e.clientY);
    },
    [scrubClient],
  );
  const onDialUp = useCallback(() => {
    scrubbingRef.current = false;
    setScrubbing(false);
    simApiRef.current?.wake();
  }, []);


  /* ---------------- the reading panel ----------------
     A focused orb's information appears BESIDE it: a small panel that cross-
     fades in, one size, anchored to the orb. Nothing slides, nothing is
     dragged, nothing snaps — reading one saved thought is not an event.

     It appears ONCE AND WHOLE. The orb lights the instant it is tapped (that
     is the canvas, and it is immediate), the detail is fetched, and only when
     the whole content tree can be rendered in one pass does the panel fade
     in. Nothing swaps, grows or reflows under the reader afterwards. */

  const hasPanelRef = useRef(false);
  hasPanelRef.current = panel !== null;
  panelOpenRef.current = panelOpen;

  useEffect(() => {
    if (!selectedId) {
      setPanelOpen(false);
      if (!hasPanelRef.current) return undefined;
      const id = window.setTimeout(() => setPanel(null), 200);
      return () => window.clearTimeout(id);
    }
    /* A room orb that belongs to another member: the 180ch preview/quote is
       the WHOLE panel — the full text of someone else's save is not ours to
       fetch, so nothing is missing and nothing loads. One appearance. */
    const roomBall = roomBallsRef.current.get(selectedId);
    if (roomBall && !roomBall.own) {
      setPanel({ id: selectedId, detail: null, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    /* A MEMORY KEPT A MOMENT AGO IS ALREADY WHOLE. You typed every word of
       it, so there is nothing to fetch and nothing missing — `partial` stays
       false, because this panel is not a degradation, it is complete. Once
       the keep has come back carrying a signal id there is a real reading
       behind it, and the branch below loads that instead. */
    const ownBall = ballsRef.current?.byId.get(selectedId) ?? null;
    if (ownBall?.local === true && ownBall.sigId === undefined) {
      setPanel({ id: selectedId, detail: null, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    /* AND A FIXTURE MEMORY IS WHOLE FOR THE SAME REASON. There is no reading
       behind it and no server to fetch one from, so nothing is missing:
       `partial` stays false, or the panel would print "couldn't load the
       rest" under text that is all of it. */
    if (offlineRef.current) {
      setPanel({ id: selectedId, detail: null, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    /* the viewer's OWN save seen in a room fetches by its real signal id —
       and so does one kept here, whose ball keeps the id it was born under */
    const fetchId = roomBall?.sigId ?? ownBall?.sigId ?? selectedId;
    /* Already in hand (the background sweep, or the warm-up fired on
       pointerdown): the panel appears in the same commit as the selection —
       no wait at all, and still one single appearance. */
    const cached = detailsRef.current.get(fetchId);
    if (cached) {
      setPanel({ id: selectedId, detail: cached, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    /* otherwise: whatever was open leaves at once, and nothing takes its
       place until the new content is complete */
    setPanelOpen(false);
    let done = false;
    const show = (detail: InspirationDetail | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      setPanel({ id: selectedId, detail, partial: detail === null });
      setPanelOpen(true);
    };
    /* the network is not allowed to hold a reading hostage */
    const timer = window.setTimeout(() => show(null), 2000);
    loadDetail(fetchId).then(show);
    return () => {
      done = true;
      window.clearTimeout(timer);
    };
  }, [selectedId, loadDetail]);

  /* Placement: solved from the viewport and the orb alone (the panel's size is
     declared, not measured), so it is written before the first paint and never
     moves again while it is open. */
  useLayoutEffect(() => {
    if (!panel || !panelOpen) return undefined;
    const place = () => {
      const el = panelRef.current;
      const spot = simApiRef.current?.place();
      if (!el || !spot) return;
      el.style.left = `${spot.left}px`;
      el.style.top = spot.top === null ? "auto" : `${spot.top}px`;
      el.style.bottom = spot.bottom === null ? "auto" : `${spot.bottom}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [panel, panelOpen]);

  /* the companion's line is a whisper, not a status bar: it goes after 4s */
  useEffect(() => {
    if (!charSay) return undefined;
    const id = window.setTimeout(() => setCharSay(""), 4000);
    return () => window.clearTimeout(id);
  }, [charSay]);


  const [provTick, setProvTick] = useState(0);
  /* whether the poster is showing what it was built from */
  const [posterAsk, setPosterAsk] = useState(false);
  /**
   * THE POSTER'S OWN HISTORY.
   *
   * The artifact has always been VERSIONED — `/top-of-mind/versions` has been
   * live and called from nowhere, so a sentence claiming who you are becoming
   * could not be read against the sentences it replaced. The dial scrubs the
   * field through time; the one thing that most describes a change in you
   * could not be scrubbed at all.
   *
   * Fetched only when the poster is asked, alongside its provenance: the
   * question "where did this come from" and "what did it used to say" are the
   * same question asked of the past and of the ground.
   */
  const [versions, setVersions] = useState<ApiTopOfMindVersion[] | null>(null);
  useEffect(() => {
    if (!posterAsk || versions !== null || offlineRef.current) return;
    fetchTopOfMindVersions()
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [posterAsk, versions]);

  /**
   * WHO IS WHICH COLOUR — and only where that is a question.
   *
   * A legend is apparatus on any wall holding one person's memories, so it
   * exists only in a room whose ground actually has more than one owner in
   * it. Your own row is first and has no swatch: you are the warm white the
   * whole world is drawn in, and giving yourself a colour chip would imply
   * you are one option among five rather than the ground everything else is
   * read against.
   *
   * It reads `hueByOwnerRef`, which is written where the sprites are tinted,
   * so the legend and the orbs are physically incapable of disagreeing.
   */
  const legend = useMemo<Array<{ id: string; name: string; hue: number; agent: boolean }>>(() => {
    if (atWall.kind !== "room") return [];
    const caps = roomFieldRef.current.get(atWall.id) ?? [];
    const seen = new Map<string, { id: string; name: string; hue: number; agent: boolean }>();
    for (const c of caps) {
      if (seen.has(c.ownerProfileId)) continue;
      seen.set(c.ownerProfileId, {
        id: c.ownerProfileId,
        name: c.ownerProfileId === viewerIdRef.current ? "you" : c.ownerName,
        hue: c.ownerProfileId === viewerIdRef.current ? -1 : hueByOwnerRef.current.get(c.ownerProfileId) ?? -1,
        agent: c.ownerType === "agent",
      });
    }
    const rows = [...seen.values()];
    /* one owner is not a legend, it is a label nobody asked for */
    if (rows.length < 2) return [];
    return rows.sort((a, b) => (a.hue < 0 ? -1 : b.hue < 0 ? 1 : a.hue - b.hue));
  }, [atWall, roomFieldTick, wokenRooms]);
  /**
   * WHAT THE POSTER RESTS ON — THE SAME QUESTION, ONE LAYER UP.
   *
   * A top of mind is the loudest claim in the product: one sentence, set
   * largest, presented as who you are becoming. Until now it was the only
   * claim with NO way to ask where it came from — you could interrogate a
   * pattern in the sky but not the sentence the whole wall is built around,
   * which is exactly backwards.
   *
   * The chain runs entry → the patterns it cites → the memories those
   * patterns were read from. Deduplicated by memory, because the interesting
   * fact is "four memories produced this", not "one memory was counted twice
   * through two patterns"; the first quote wins, since that is the span the
   * first citing pattern actually read.
   *
   * An agent's wall answers the same question from its own stack: its board
   * names the memories it was grounded in directly.
   */
  const posterChain = useMemo<Evidence[]>(() => {
    const out: Evidence[] = [];
    const seen = new Set<string>();
    if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      const byId = new Map((a?.captures ?? []).map((cap) => [cap.id, cap] as const));
      for (const id of a?.direction.current?.groundedIn ?? []) {
        const cap = byId.get(id);
        if (!cap || seen.has(id)) continue;
        seen.add(id);
        out.push({
          signalId: "",
          inspirationId: id,
          preview: cap.textPreview,
          quote: cap.quote ?? null,
          reason: null,
          createdMs: Date.parse(cap.capturedAt) || 0,
        });
      }
      return out;
    }
    if (atWall.kind === "room") {
      /* A ROOM'S CHAIN STOPS AT THE STATEMENT, AND THAT IS THE POINT.
         Sharing into a room sends the statement and nothing under it — the
         memories stay on their author's own wall. So a room's board can
         honestly name the shared statements that fed it and WHO said each
         one, and it cannot name anyone's raw inspirations. That is a privacy
         boundary rendered as a shorter chain, not a missing feature: a room
         that could show you the memories behind someone else's statement
         would be breaking the promise the share note makes. */
      const room = roomCacheRef.current.get(atWall.id);
      const lead = room?.data?.top?.entries?.[0];
      if (!lead) return out;
      for (const ev of room?.data?.evidence ?? []) {
        if (!ev.citedBy.includes(lead.body) || seen.has(ev.signalId)) continue;
        seen.add(ev.signalId);
        out.push({
          signalId: "",
          inspirationId: ev.signalId,
          preview: ev.textPreview,
          quote: ev.quote,
          /* whose sentence this is — in a room the author IS the provenance */
          reason: ev.authorName ? `said by ${ev.authorName}` : null,
          createdMs: ev.createdMs,
        });
      }
      return out;
    }
    /* your own wall */
    const board = notes ?? [];
    const lead = board.find((e) => e.pinned) ?? board[0];
    if (!lead) return out;
    for (const cite of lead.citedSignals)
      for (const e of evidenceByPatternRef.current.get(cite.id) ?? []) {
        if (seen.has(e.inspirationId)) continue;
        seen.add(e.inspirationId);
        out.push(e);
      }
    return out;
  }, [atWall, agents, notes, provTick, wokenRooms]);

  /**
   * The evidence under a pattern. Candidates are a union — a server pattern, a
   * room's proposal, a sentence you drafted here — and only the first has a
   * chain to walk. A draft cites nothing because it came from you directly,
   * and saying so with an empty section would be apparatus.
   */
  const evidenceFor = useCallback(
    (c: Candidate): Evidence[] =>
      c.kind === "reading" ? evidenceByPatternRef.current.get(c.id) ?? [] : [],
    /* provTick is the ref's change signal — see the fetch effect above */
    [provTick],
  );

  /**
   * SALIENCE, SET IN LIGHT.
   *
   * The server names the span it read (`quote`) inside the memory's text
   * (`preview`). Rendering the quote alone would lose the sentence it lived
   * in — you would learn WHAT was read but not what surrounded it, which is
   * most of what makes a quote fair. Rendering the whole preview evenly loses
   * the pointer. So: the whole sentence, with the read span in full ink and
   * the rest dimmed to the same value the world dims an untended memory to.
   *
   * If the quote is not a literal substring (the server may normalise
   * whitespace or the preview may be truncated before it), the honest
   * fallback is the quote by itself — never a guessed span.
   */
  const salience = useCallback((e: Evidence): JSX.Element => {
    const full = e.preview ?? "";
    const q = (e.quote ?? "").trim();
    if (!q) return <>{full}</>;
    const at = full.indexOf(q);
    if (at < 0) return <mark className="jar-prov-lit">{q}</mark>;
    return (
      <>
        {full.slice(0, at)}
        <mark className="jar-prov-lit">{full.slice(at, at + q.length)}</mark>
        {full.slice(at + q.length)}
      </>
    );
  }, []);

  /**
   * FETCH THE CHAIN WHEN SOMEONE ASKS FOR IT.
   *
   * The evidence index is built eagerly for your own sky at load, but a
   * pattern on an AGENT's wall or in a room is never in it — those walls load
   * statements only, and pulling every agent's full evidence at startup would
   * be a large fetch for something most visits never open.
   *
   * So the chain is fetched at the moment a statement is read, once, and kept.
   * `bump` exists because the index lives in a ref (the render loop reads it
   * every frame and must not re-subscribe): this is the one place that has to
   * tell React the ref changed.
   */
  useEffect(() => {
    if (!focusCandId) return undefined;
    if (evidenceByPatternRef.current.has(focusCandId)) return undefined;
    /* proposals and local drafts have no server pattern behind them */
    if (focusCandId.startsWith("proposal:") || focusCandId.startsWith("draft:")) return undefined;
    let dead = false;
    loadSignal(focusCandId)
      .then((full) => {
        if (dead) return;
        evidenceByPatternRef.current.set(full.id, full.evidence);
        setProvTick((n) => n + 1);
      })
      .catch(() => {
        /* no chain available: the statement still stands, unsourced, and the
           section simply does not appear — better than an error where a
           quotation should be */
        if (!dead) evidenceByPatternRef.current.set(focusCandId, []);
      });
    return () => {
      dead = true;
    };
  }, [focusCandId]);

  const panelId = panel ? panel.id : null;

  /* ---------------- the sky's inhabitants ----------------
     The candidates are NOT peers of the adopted ambition and are not shown
     beside it: they live a section above it. The proposal leads (it is a
     whole ambition), then the provisional readings — machine claims, honestly
     labelled as not yet adoptable — then anything drafted here. */
  const candidates = useMemo<Candidate[]>(() => {
    const out: Candidate[] = [];
    if (proposal) {
      out.push({
        id: `proposal:${proposal.proposalId}`,
        kind: "proposal",
        col: 0,
        text: proposal.ambition,
        evidence: proposal.evidence,
        spanMs: proposal.spanMs,
        adopt: { groupId: proposal.groupId, proposalId: proposal.proposalId },
        originIds: [],
      });
    }
    /* THE SKY IS LAYER 2 — the patterns still forming.
       A pattern that is `active` is what headquarters already stands on and a
       `retired` one has sunk; what is overhead is what is EMERGING: something
       the archive is saying about this person that has not become what they
       hold yet. Each one's satellites are the memories it cites, resolved
       against the field in hand — an id with nothing behind it is skipped,
       never invented, so every satellite stands for a memory that exists. */
    for (const p of patterns ?? []) {
      if (p.status !== "emerging") continue;
      const evidence = new Map<string, EvidenceRef>();
      for (const e of evidenceByPatternRef.current.get(p.id) ?? []) {
        const s = signalById.get(e.inspirationId);
        if (!s || evidence.has(e.inspirationId)) continue;
        evidence.set(e.inspirationId, {
          signalId: e.inspirationId,
          groupId: null,
          authorUserId: null,
          authorName: null,
          textPreview: e.preview || s.preview,
          quote: e.quote,
          kind: s.kind,
          createdMs: e.createdMs || s.capturedMs || Date.now(),
          dated: true,
          /* NOT SCORED. The canon gives a pattern a confidence and a memory
             nothing at all, so the satellites keep the server's own order
             rather than being ranked by a number that does not exist. */
          resonance: 0,
        });
      }
      out.push({
        id: p.id,
        kind: "reading",
        col: 0,
        text: p.statement,
        evidence: [...evidence.values()],
        spanMs: null,
        adopt: null,
        originIds: [],
      });
    }
    /* AND EVERY ROOM'S SKY: the statements members have said out loud in it.
       Each one carries whose it is — a room may know WHO, never which memory —
       so its satellite is the person, not a capture. This is the only home the
       shared wall has: the field below is always your own by ruling, and the
       room's headquarters holds only what it has already agreed. */
    for (const g of groups) {
      const col = walls.find((w) => w.kind === "room" && w.id === g.id)?.col;
      if (col === undefined) continue;
      for (const s of wallSignalsRef.current.get(g.id) ?? []) {
        out.push({
          id: `wall:${g.id}:${s.signalId}`,
          kind: "reading",
          col,
          text: s.statement,
          evidence: [
            {
              signalId: `${g.id}:${s.signalId}`,
              groupId: g.id,
              authorUserId: s.ownerProfileId,
              authorName: s.ownerName,
              textPreview: s.statement,
              quote: null,
              kind: null,
              createdMs: Date.parse(s.sharedAt) || Date.now(),
              dated: true,
              resonance: 0,
            },
          ],
          spanMs: null,
          adopt: null,
          originIds: [],
        });
      }
    }
    /* AND EVERY AGENT'S OWN SKY. What an agent is still distilling and has not
       adopted stands over its own wall, in exactly the relationship your sky
       has to your ambition — and each candidate's satellites are the memories
       it was drawn from, which is where its "why" is finally readable. */
    for (const a of agents ?? []) {
      const col = walls.find((w) => w.kind === "agent" && w.id === a.agent.id)?.col;
      if (col === undefined) continue;
      const byId = new Map(a.captures.map((s) => [s.id, s] as const));
      for (const n of a.topOfMind.notes) {
        if (!n.isProvisional) continue;
        const evidence: EvidenceRef[] = [];
        for (const id of n.evidenceSignalIds) {
          const s = byId.get(id);
          if (!s) continue;
          evidence.push({
            signalId: id,
            groupId: null,
            authorUserId: null,
            authorName: null,
            /* a real agent memory has no recorded output behind it yet, and the
               orbit prints nothing rather than inventing a reason */
            why: s.producedBy?.why ?? null,
            textPreview: s.textPreview,
            quote: s.quote,
            kind: s.kind,
            createdMs: Date.parse(s.capturedAt) || Date.now(),
            dated: true,
            resonance: 0,
          });
        }
        out.push({
          id: n.id,
          kind: "reading",
          col,
          text: n.title,
          evidence,
          spanMs: null,
          adopt: null,
          originIds: [],
        });
      }
    }
    return [...out, ...drafts];
  /* `patterns` for your own sky, `groups` and `wokenRooms` for a room's — the
     shared statements arrive with the wall's wake, so the memo has to re-run
     on it or a room's sky stays empty until something else moves */
  }, [proposal, notes, drafts, signalById, agents, walls, patterns, groups, wokenRooms]);

  useEffect(() => {
    simApiRef.current?.syncSky(candidates);
  }, [candidates, captures]);

  const byCandidateId = useMemo(() => {
    const m = new Map<string, Candidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  /** The groups the person has drawn together, as the loop last saw them. */
  const clusters = useMemo(
    () => (clusterSig ? clusterSig.split("|").filter(Boolean) : []),
    [clusterSig],
  );

  /**
   * Draft one ambition from a cluster. There is NO endpoint that synthesises
   * an ambition from a set of readings — verified against the API surface —
   * so this composes the draft CLIENT-SIDE and says so on the face of it: the
   * proposal's own words if a proposal is in the group, otherwise the
   * readings' titles joined. It is deliberately not dressed up as machine
   * synthesis. (Real synthesis wants an endpoint: ambition synthesis taking a
   * set of note ids.)
   */
  const draftFrom = useCallback(
    (sig: string) => {
      const ids = sig.split("+");
      const members = ids
        .map((id) => byCandidateId.get(id))
        .filter((c): c is Candidate => Boolean(c));
      if (members.length < 2) return;
      const lead = members.find((m) => m.kind === "proposal");
      const text = lead ? lead.text : members.map((m) => m.text).join(" · ");
      const id = `draft:${ids.join("+")}`;
      setDrafts((prev) =>
        prev.some((d) => d.id === id)
          ? prev
          : [
              ...prev,
              {
                id,
                kind: "draft",
                /* a draft is born in the sky it was gathered in */
                col: members[0].col,
                text,
                /* it inherits the memories its members were made of, once
                   each — and the WIDEST span any of them declared, so a draft
                   drawn from an old claim keeps that claim's slow orbit */
                evidence: dedupeEvidence(members.flatMap((m) => m.evidence)),
                spanMs: members.reduce<number | null>(
                  (w, m) => (m.spanMs !== null && m.spanMs > (w ?? 0) ? m.spanMs : w),
                  null,
                ),
                adopt: null,
                originIds: ids,
              },
            ],
      );
    },
    [byCandidateId],
  );

  /**
   * Adopt. Only the room's real proposal has somewhere to go: on success the
   * nebula condenses to a point, the camera glides down to headquarters, and
   * the poster re-arrives word by word with the new text — the change is
   * visible, which is the whole reason to make someone travel for it.
   *
   * Under the canon a room's board changes by AFFIRMATION rather than by one
   * person accepting: affirming is this reader adding their name, and the
   * board moves when the room's rule for that is met. So the poster only
   * changes here if the server says the proposal is now accepted; otherwise
   * the affirmation is recorded and the nebula stays where it is, which is
   * the truth of what just happened.
   */
  const adopt = useCallback(
    (c: Candidate) => {
      if (!c.adopt || adopting) return;
      setAdopting(true);
      affirmGroupProposal(c.adopt.groupId, c.adopt.proposalId)
        .then((res) => {
          if (!res.accepted) {
            setAdopting(false);
            return;
          }
          simApiRef.current?.condense(c.id);
          setProposal(null);
          window.setTimeout(() => {
            setAdopted({ ambition: c.text, groupName: null, createdMs: Date.now() });
            simApiRef.current?.toTop();
            setAdopting(false);
          }, CONDENSE_MS);
        })
        .catch(() => setAdopting(false));
    },
    [adopting],
  );


  /* ---------------- the mouth ----------------
     The one verb this world was missing. It says one phrase at rest, becomes
     a plain field when you touch it, and commits on Enter — guarded, because
     the first Enter of a Korean sentence belongs to the IME and not to us.
     The world moves for it exactly once: an orb is born where the words are
     and falls to its home in the ground below. */

  const openMouth = useCallback(() => {
    setMouthNote("");
    setMouthOpen(true);
  }, []);

  /** Escape: back to the phrase, and the draft goes with it. */
  const cancelMouth = useCallback(() => {
    setMouthOpen(false);
    setDraft("");
    setMouthNote("");
  }, []);

  /**
   * KEEP IT. Optimism with honesty, in that order: the memory is born in the
   * ground before the network is asked — because that is the payoff, and
   * because a save that only appears once a server has agreed teaches you
   * that the world is somewhere else — and if the keep does not land, the orb
   * fades back out and the words come back with a line saying so.
   *
   * The birth is measured off the words while they are still on screen, so it
   * happens before the mouth is emptied. React's state updates are queued;
   * the DOM read below is of the field the person just typed into.
   */
  const keepIt = useCallback(() => {
    const text = draft.trim();
    if (text === "") return;
    /* LINKS TYPED INTO THE MOUTH BECOME ATTACHMENTS.
       Paste a link and the archive turned it into one, which mattered far more
       than it looked: the server fetches that page at capture time and feeds
       what it reads to pattern extraction. Left as bare text the extraction
       never sees the page, so the archive quietly learns less from exactly the
       captures that carry the most — and nothing on screen says so. */
    const links = Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
    const atMs = Date.now();
    const seed: BornSeed = {
      id: `kept-${atMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      capturedMs: atMs,
      updatedMs: atMs,
      textPreview: text,
      kind: "note",
      quote: null,
      reflectionCount: 0,
      /* Nothing has read it yet, and the world does not pretend otherwise:
         distillation is a background pass on the server, so a memory a second
         old is genuinely uncited and is drawn that way. */
      cited: false,
      inRoom: false,
      terms: [],
    };
    bornRef.current = [...bornRef.current, seed];
    simApiRef.current?.born(seed);
    setClockMs(atMs);
    setDraft("");
    setMouthOpen(false);
    setMouthNote("");
    /**
     * WITH NOTHING BEHIND THE WORLD, THE KEEP IS NOT ASKED FOR.
     *
     * The orb is born, the ground re-fits around it and the gesture is
     * genuinely exercisable — that is the whole reason the mouth stays open
     * offline. What must not happen is the world implying a server agreed:
     * there is no request, so there is no optimism to be honest about, and
     * the marker line has already said that nothing here is kept. Retracting
     * the orb instead would be worse — it would teach that the gesture is
     * broken, when the only thing missing is the database.
     */
    if (offlineRef.current) return;
    createInspiration({
      text,
      source: "app",
      /* omitted when private: the column default decides what unset means */
      ...(keepPublic ? { visibility: "public" as const } : {}),
    })
      .then((made) => {
        /* The canon returns the capture itself, so the id the world needs is
           the row's own — there is no second identity to wait for any more.
           Adopting it here means a reload finds the same memory rather than a
           duplicate, which is what `fetched` upstream is checking. */
        seed.sigId = made.id;
        setKeepPublic(false);
        simApiRef.current?.identify(seed.id, made.id);
        /* AND IT JOINS THE ARCHIVE, NOT ONLY THE GROUND.
           The orb was born on the canvas and the row was written on the
           server, and `captures` — the list every other part of the page
           reads — was told about neither. So headquarters kept computing
           `empty` as `topOfMind === null && captures.length === 0` and kept
           drawing the three-slot first-run scaffold, including the row
           labelled "everything you keep" with an empty circle beside it,
           while the thing just kept glowed underneath it.
           `forgetIt` and `togglePublic` already keep this list honest on
           their own success; keeping does now too. */
        setCaptures((prev) =>
          prev
            ? [
                ...prev,
                toInspiration({
                  id: made.id,
                  textPreview: made.text,
                  kind: made.kind,
                  source: made.source,
                  createdAt: made.createdAt,
                  updatedAt: made.updatedAt,
                  visibility: made.visibility,
                  attachmentSummary: [],
                  reflectionCount: 0,
                }),
              ]
            : prev,
        );
        /* each link becomes an attachment on the memory just kept, so the
           server can read the page and the extraction can use it */
        for (const url of links)
          finalizeAttachment({ type: "link", inspirationId: made.id, url }).catch(
            () => undefined,
          );
      })
      .catch(() => {
        bornRef.current = bornRef.current.filter((s) => s.id !== seed.id);
        simApiRef.current?.unborn(seed.id);
        setDraft(text);
        setMouthOpen(true);
        setMouthNote("That didn’t keep. The words are still here.");
      });
    /* `keepPublic` IS A DEPENDENCY, and leaving it out silently discarded the
       one privacy decision a person makes by hand. This callback reads
       `keepPublic` when it builds the request, but the list said `[draft]`
       only — so pressing "kept to yourself" until it read "going to your
       rooms" changed the state and the label while React went on handing back
       the callback that had closed over `false`. The memory saved PRIVATE.
       It came out right only if the draft happened to change after the toggle,
       which is to say: by luck.
       It fails closed, so nothing was ever published by accident — but a
       person who asked for something to reach their rooms was told it had and
       it had not, which is the same lie in the safer direction. */
  }, [draft, keepPublic]);

  const onMouthKey = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      /* The world's keyboard lives on `window` and claims the arrows, Escape
         and preventDefault with them. A field's keys are the field's: this
         stops the native event before it ever reaches that listener, so the
         caret moves, and Escape closes the mouth rather than a reading. */
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        cancelMouth();
        return;
      }
      if (e.key !== "Enter") return;
      /* THE COMPOSITION GUARD, AND IT IS NOT OPTIONAL.
         Hangul is composed inside the field one jamo at a time, and the Enter
         that COMMITS the syllable in progress is the same Enter that would
         send the sentence. Without this the first Enter of every Korean
         sentence keeps a fragment. `isComposing` is the modern fact; keyCode
         229 is the same fact spelled the way several IMEs still spell it. */
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.keyCode === 229) return;
      if (e.shiftKey) return; /* a new line, not a keep */
      e.preventDefault();
      keepIt();
    },
    [cancelMouth, keepIt],
  );

  /** Empty and left alone, it goes back to being a phrase. With words in it
      it stays open — a stray tap somewhere else must not take them. */
  const onMouthBlur = useCallback(() => {
    if (draft.trim() === "") {
      setMouthOpen(false);
      setMouthNote("");
    }
  }, [draft]);

  /* The field is exactly as tall as what is in it. It hangs off the seam and
     grows UPWARD, so the words stay the same distance above the ground the
     orb will drop into however many lines they wrap to. */
  useLayoutEffect(() => {
    const el = mouthFieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, mouthOpen]);

  useEffect(() => {
    if (!mouthOpen) return;
    const el = mouthFieldRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [mouthOpen]);

  const panelBall = panelId
    ? ballsRef.current?.byId.get(panelId) ?? roomBallsRef.current.get(panelId) ?? null
    : null;
  /** A room orb's panel: whisper attribution, cited-by, and — for another
      member's save — no reflect action at all. */
  const panelIsRoom = panelBall !== null && panelBall.col !== undefined;
  const panelCanReflect = !panelIsRoom || panelBall?.own === true;

  /* ---------------- reflect ----------------
     The panel is the memory and ONE action. Reflecting happens here rather
     than somewhere else because leaving the jar to answer a question about a
     memory is how a second beat never happens: the API takes a question and
     an answer against the saved signal's own id, so the whole loop fits
     inside the card. */
  const [reflect, setReflect] = useState<ReflectState>({ step: "rest", question: "", answer: "" });

  /* a new memory is a new reflection: nothing carries over */
  useEffect(() => {
    setReflect({ step: "rest", question: "", answer: "" });
  }, [panelId]);

  /**
   * SAYING SO — the one thing a person could not do to a machine's claim.
   *
   * A pattern is the server's reading of you, and until now the sky offered no
   * way to answer it. Two registers, and the difference is ownership rather
   * than politeness:
   *
   *   YOUR OWN WALL — it is your pattern, about you, resting on your memories.
   *   You may agree, half-agree, or throw it out. Deleting is real deletion
   *   (`DELETE /signals/:id`); the memories underneath are untouched, because
   *   a pattern is a reading and losing a reading is not losing what it read.
   *
   *   A SHARED WALL — the statement belongs to whoever shared it, and one
   *   member deleting it would be editing someone else's mind. So the only
   *   acts are the three verdicts, and a room's board changes by proposal and
   *   affirmation instead. Founder ruling, and the canon's privacy line agrees.
   *
   * Agreement is recorded too, not only dissent: a pattern that only ever
   * hears from the people it got wrong is a pattern the server learns nothing
   * from.
   */
  const sayVerdict = useCallback(
    (id: string, value: "true" | "partly" | "not_true") => {
      setVerdicts((prev) => new Map(prev).set(id, value));
      if (offlineRef.current) return;
      createFeedback({ targetType: "signal", targetId: id, value }).catch(() => {
        /* it did not land, and the row should not claim it did */
        setVerdicts((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });
    },
    [],
  );

  /** Throw out a pattern of your own. The memories under it stay. */
  const dropPattern = useCallback((id: string) => {
    setVerdicts((prev) => new Map(prev).set(id, "gone"));
    if (offlineRef.current) return;
    deleteSignal(id)
      .then(() => {
        setPatterns((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      })
      .catch(() => {
        setVerdicts((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });
  }, []);

  /** Which memory has been asked about, and how far the asking has got. */
  /** the housekeeping actions, opened on request rather than always present */
  const [more, setMore] = useState(false);
  const [forget, setForget] = useState<{ id: string | null; step: "rest" | "asking" | "going" }>({
    id: null,
    step: "rest",
  });
  useEffect(() => {
    setForget({ id: null, step: "rest" });
    setMore(false);
  }, [panelId]);

  /* ============================ ROOMS ============================
     WHERE YOUR PATTERNS AND OTHER PEOPLE'S MEET.

     The canon draws the line and the whole feature follows from it: what is
     shared is a SIGNAL — a distilled statement — and never an inspiration.
     Your raw memories do not cross an account boundary, are never cited to
     another member, and are never exported by a group flow. So a room is a
     wall of statements, and the only act that fills it is you deciding a
     pattern of yours is worth saying out loud.

     That is why sharing comes first here. Room creation, invites, members and
     the shared board are all stagecraft until something can be put on a wall.
  */

  /** Which pattern is being offered to a room, and to which rooms so far. */
  const [sharing, setSharing] = useState<string | null>(null);

  /**
   * SAY THIS ONE OUT LOUD — or take it back.
   *
   * Per-signal, per-room, and reversible. The statement appears on that
   * room's wall with your name on it; the memories it rests on stay here.
   * Members see the pattern, never the captures.
   */
  const shareTo = useCallback((signalId: string, groupId: string, on: boolean) => {
    /* only on the way out — taking a statement back is not an announcement */
    if (on) simApiRef.current?.acknowledge("shared");
    setPatterns((prev) =>
      prev
        ? prev.map((p) =>
            p.id === signalId
              ? {
                  ...p,
                  sharedGroupIds: on
                    ? [...p.sharedGroupIds, groupId]
                    : p.sharedGroupIds.filter((g) => g !== groupId),
                }
              : p,
          )
        : prev,
    );
    if (offlineRef.current) return;
    const call = on ? shareSignal(signalId, groupId) : unshareSignal(signalId, groupId);
    call.catch(() => {
      /* it did not land, so the pattern must not claim it is out loud */
      setPatterns((prev) =>
        prev
          ? prev.map((p) =>
              p.id === signalId
                ? {
                    ...p,
                    sharedGroupIds: on
                      ? p.sharedGroupIds.filter((g) => g !== groupId)
                      : [...p.sharedGroupIds, groupId],
                  }
                : p,
            )
          : prev,
      );
    });
  }, []);

  /** Making a room, joining one, and the state of asking about either. */
  const [roomForm, setRoomForm] = useState<{
    mode: "make" | "join";
    text: string;
    busy: boolean;
    error: string | null;
  } | null>(null);

  const submitRoom = useCallback(() => {
    if (!roomForm || roomForm.busy) return;
    const text = roomForm.text.trim();
    if (text === "") return;
    setRoomForm({ ...roomForm, busy: true, error: null });
    const landed = (g: ApiGroupSummary) => {
      /* newest room first, which is where the axis puts it: a new column
         appears to the right and the traveller can walk to it immediately */
      setGroups((prev) => [g, ...prev.filter((x) => x.id !== g.id)]);
      setRoomForm(null);
    };
    const failed = (m: string) =>
      setRoomForm((f) => (f ? { ...f, busy: false, error: m } : f));
    if (roomForm.mode === "make") {
      createGroup(text)
        .then(landed)
        .catch(() => failed("That room could not be made. Try another name."));
    } else {
      /* a pasted invite link works as well as a bare code — the link is the
         thing people will actually send each other */
      const code = text.includes("/") ? text.split("/").filter(Boolean).pop() ?? text : text;
      joinGroup(code)
        .then((r) => landed(r.group))
        .catch(() => failed("No room answered to that. Check the link."));
    }
  }, [roomForm]);

  /**
   * WHO IS IN HERE — and it is the same act as inviting.
   *
   * Seeing who is in a room and adding to it are one surface, because they
   * are one question: who is this with. Loaded when you arrive on a room's
   * wall, not before — the axis can hold many rooms and none of them owes a
   * request until you are standing in it.
   */
  const [members, setMembers] = useState<Map<string, ApiGroupMember[]>>(() => new Map());
  /* the fixture fills membership from inside the sim's effect, which is
     declared above this state — a ref is the one honest way across */
  setMembersRef.current = setMembers;
  /** read by the room loader, which is built once */
  const membersRef = useRef<Map<string, ApiGroupMember[]>>(new Map());
  membersRef.current = members;
  /**
   * ROOMS THAT ARE MACHINES' ROOMS.
   *
   * A room wore the human body and moved on the human's continuous clock no
   * matter who was in it — so "Our agents", a room of five agents, was
   * indistinguishable from a room of five people. The whole grammar the world
   * spent this session learning (a machine hand, quantized position, a
   * stepped tick, pixelated memories) stopped at the room's door.
   *
   * YOU DO NOT COUNT TOWARD THE ANSWER. You are in every room you can see, so
   * counting yourself would mean no room could ever read as a machine's. What
   * decides a room's character is who ELSE is standing in it.
   */
  const machineRoomsRef = useRef<Set<string>>(new Set());
  const machineRooms = useMemo(() => {
    const out = new Set<string>();
    for (const [groupId, list] of members) {
      const others = list.filter((m) => m.profileId !== viewerIdRef.current);
      if (others.length > 0 && others.every((m) => m.type === "agent")) out.add(groupId);
    }
    return out;
  }, [members]);
  machineRoomsRef.current = machineRooms;
  const [roomPanel, setRoomPanel] = useState<string | null>(null);

  /**
   * THIS SPACE'S SETTINGS — keyed by the space, opened from its name.
   *
   * Not a modal and not a route: it is a fact about where you are standing, so
   * it opens beside the name that opened it and closes when you travel. The
   * key is `wallKey(space)` rather than a group id because every kind of space
   * has settings — yours sends you to the account screen, an agent's names
   * what it is, a group's is the real one.
   */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  /**
   * The account drop, top right — the mirror of the space settings top left.
   * They are mutually exclusive: opening one closes the other, because two
   * panels hanging off the same bar is a menu bar, which this world does not
   * have.
   */
  const [accountOpen, setAccountOpen] = useState(false);
  /** The rename box, while it is open: null when nobody is renaming. */
  const [renaming, setRenaming] = useState<{ id: string; text: string; busy: boolean } | null>(
    null,
  );
  /** Two-step confirmations, so a destructive word is never beside its own yes. */
  const [closing, setClosing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    if (atWall.kind !== "room" || members.has(atWall.id)) return;
    let dead = false;
    fetchGroupMembers(atWall.id)
      .then((rows) => {
        if (!dead) setMembers((prev) => new Map(prev).set(atWall.id, rows));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [atWall, members]);

  /**
   * CHANGING WHAT A ROOM BELIEVES.
   *
   * A room's board is not edited; it is PROPOSED to and affirmed. That is the
   * canon's rule and it is the only honest one for a shared statement — one
   * member rewriting what a group believes would be editing other people's
   * minds. So the verb here is "put it to them", and the board moves when the
   * room agrees.
   */
  const [propose, setPropose] = useState<{ text: string; busy: boolean } | null>(null);
  const sendProposal = useCallback(
    (groupId: string) => {
      if (!propose || propose.busy) return;
      const body = propose.text.trim();
      if (body === "") return;
      setPropose({ ...propose, busy: true });
      createGroupProposal(groupId, { kind: "add_entry", body })
        .then(() => {
          setPropose(null);
          /* the room's forming line will report that something is on its way;
             nothing is claimed as agreed until the room says so */
          roomCacheRef.current.delete(groupId);
        })
        .catch(() => setPropose((p) => (p ? { ...p, busy: false } : p)));
    },
    [propose],
  );

  /**
   * WHAT THE ROOM IS BEING ASKED, AND YOUR ANSWER TO IT.
   *
   * A room's board moves by affirmation, so an open proposal is the one thing
   * in this world that is waiting on OTHER PEOPLE. It is not a notification
   * and it does not chase you: it sits on that room's wall, and you find it by
   * being there. Affirming is adding your name; the board changes when the
   * room's rule for that is met, not when you press.
   */
  const [openProposals, setOpenProposals] = useState<Map<string, ApiGroupProposal[]>>(
    () => new Map(),
  );
  useEffect(() => {
    if (atWall.kind !== "room") return;
    let dead = false;
    fetchGroupProposals(atWall.id)
      .then((rows) => {
        if (!dead)
          setOpenProposals((prev) =>
            new Map(prev).set(
              atWall.id,
              rows.filter((p) => p.status === "open"),
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [atWall]);

  const answerProposal = useCallback((groupId: string, id: string, yes: boolean) => {
    setOpenProposals((prev) =>
      new Map(prev).set(groupId, (prev.get(groupId) ?? []).filter((p) => p.id !== id)),
    );
    const call = yes ? affirmGroupProposal(groupId, id) : declineGroupProposal(groupId, id);
    call
      .then(() => {
        /* the room's own board may have moved; it is refetched rather than
           guessed, because what a group believes is not ours to assume */
        roomCacheRef.current.delete(groupId);
        simApiRef.current?.wake();
      })
      .catch(() => undefined);
  }, []);

  /** Leaving is destructive and irreversible, so it asks once, in words. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const leaveRoom = useCallback((groupId: string) => {
    leaveGroup(groupId)
      .then(() => {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        setRoomPanel(null);
        setLeaving(null);
        simApiRef.current?.travel(-1);
      })
      .catch(() => setLeaving(null));
  }, []);

  /**
   * MAINTAINING A ROOM — three verbs the server has always answered.
   *
   * `PATCH /groups/:id`, `DELETE /groups/:id` and
   * `DELETE /groups/:id/members/:profileId` are implemented and owner-gated on
   * the server, and the client had a function for none of them: the only group
   * verb it could perform was leaving. So a room could be made and joined and
   * then never renamed, never tidied and never closed.
   *
   * Each one is optimistic in the direction that is safe. A rename shows
   * immediately because the worst case is a word reverting. Closing a room and
   * removing a member are SERVER-FIRST — the inverse — because the light must
   * not go out until the database has agreed, which is the same rule the
   * memory panel's delete already follows.
   */
  const renameRoom = useCallback((groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setRenaming((cur) => (cur ? { ...cur, busy: true } : cur));
    renameGroup(groupId, trimmed)
      .then((updated) => {
        setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...updated } : g)));
        setRenaming(null);
      })
      .catch(() => setRenaming((cur) => (cur ? { ...cur, busy: false } : cur)));
  }, []);

  const closeRoom = useCallback((groupId: string) => {
    deleteGroup(groupId)
      .then(() => {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        setClosing(null);
        setSettingsFor(null);
        /* the column is gone, so stop standing in it */
        simApiRef.current?.travel(-1);
      })
      .catch(() => setClosing(null));
  }, []);

  const removeMember = useCallback((groupId: string, profileId: string) => {
    removeGroupMember(groupId, profileId)
      .then(async () => {
        const fresh = await fetchGroupMembers(groupId).catch(() => null);
        if (fresh) {
          membersRef.current.set(groupId, fresh);
          setMembers(new Map(membersRef.current));
        }
        setRemoving(null);
      })
      .catch(() => setRemoving(null));
  }, []);

  /** read by the loop, which is created once and must not close over stale state */

  /**
   * MAKING AN AGENT — which is making a PROFILE, not a setting.
   *
   * The canon is blunt about this: a profile is the unit that owns memory, and
   * an agent's is a full inspiration → signal → top-of-mind stack of its own,
   * structurally separate from yours rather than a filter over it. So making
   * one is the same act as a room appearing on the axis, in the other
   * direction: a new column to your left, with nothing in it yet, waiting for
   * the agent to start keeping things.
   *
   * It cannot write there until it logs in as itself — that credential is
   * minted by the CLI's consent step, bound to this profile. The wall exists
   * from the moment you name it, and stands honestly empty until then.
   */
  const [agentName, setAgentName] = useState<string | null>(null);
  const makeAgent = useCallback(() => {
    const name = (agentName ?? "").trim();
    if (name === "") return;
    /* main's endpoint mints an AGENT profile by definition — only a
       human-bound session may call it and there is nothing else to create —
       so the kind is no longer passed, and the server caps how many an
       account may hold */
    createProfile(name)
      .then((p) => {
        setAgents((prev) => [
          ...(prev ?? []),
          {
            agent: { id: p.id, name: p.name, kind: "agent" as const, createdAt: "" },
            direction: { current: null, history: [] },
            topOfMind: { notes: [] },
            captures: [],
          },
        ]);
        setAgentName(null);
      })
      .catch(() => setAgentName(null));
  }, [agentName]);

  /**
   * KEEPING A PICTURE, OR A LINK.
   *
   * The mouth took text only, which left the very first thing this redesign
   * was ever shown — a memory with a photograph inside the glass — unbuildable.
   * It also left the strongest input the pipeline has on the floor: the server
   * fetches a linked page and describes an attached image at capture time, and
   * feeds that text to pattern extraction. A link saved with no words still
   * teaches the archive something.
   *
   * Three steps and the middle one goes straight to storage: mint a URL, PUT
   * the bytes, then tell the server the file belongs to this memory. The
   * memory is created first so there is something to belong to.
   */
  const [attaching, setAttaching] = useState(false);
  const attachTo = useCallback(async (inspirationId: string, file: File) => {
    setAttaching(true);
    try {
      const pre = await presignAttachment({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });
      await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
      await finalizeAttachment({
        type: file.type.startsWith("image/") ? "image" : "file",
        inspirationId,
        key: pre.key,
        name: file.name,
        contentType: file.type || undefined,
      });
      /* the picture arrives with the next sweep, all at once — never one orb
         at a time under a reader's eyes */
      setSweepDone(false);
      detailsRef.current.delete(inspirationId);
      void loadDetailRef.current(inspirationId).then(() => setSweepDone(true));
    } catch {
      /* the memory is already kept; only the picture failed to land */
    } finally {
      setAttaching(false);
    }
  }, []);

  /**
   * FINDING ONE MEMORY AMONG ALL OF THEM.
   *
   * The field shows everything at once, which is its whole point and is also
   * why it cannot answer "where is the thing I wrote about the boat". Search
   * has to exist BEFORE an archive gets big — the team's own end-to-end test
   * buries a marked capture under two hundred newer ones precisely because a
   * search that only filters what is already loaded silently stops finding
   * things that are there, and from outside that is indistinguishable from
   * the memory not holding them.
   *
   * It is not a second screen. Matches LIGHT UP IN PLACE and everything else
   * sinks — the same focus law the field already uses when you tap one orb —
   * so you never lose where a memory sits, which is the one thing a list can
   * never tell you and this world can.
   */
  const [seek, setSeek] = useState<string | null>(null);
  /** read by the loop's key handler, which is built once */
  const openSeekRef = useRef<() => void>(() => undefined);
  openSeekRef.current = () => setSeek((s) => (s === null ? "" : s));
  const [found, setFound] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const q = (seek ?? "").trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let dead = false;
    /* the server searches the whole archive, not the window in hand */
    const t = window.setTimeout(() => {
      fetchInspirations({ q, limit: 200 })
        .then((rows) => {
          if (!dead) setFound(new Set(rows.map((r) => r.id)));
        })
        .catch(() => {
          if (!dead) setFound(new Set());
        });
    }, 220);
    return () => {
      dead = true;
      window.clearTimeout(t);
    };
  }, [seek]);
  const foundRef = useRef<ReadonlySet<string> | null>(null);
  foundRef.current = found;
  /** The invite link for a room, and whether it has just been copied. */
  const [copied, setCopied] = useState<string | null>(null);
  const copyInvite = useCallback((g: ApiGroupSummary) => {
    /* THE LINK IS THE INVITE. No email to send, no pending state to track and
       no notification channel we do not have — you copy it and put it wherever
       you already talk to these people. Anyone holding it can walk in, which
       is the one thing to know about it. */
    const url = `${window.location.origin}/?join=${encodeURIComponent(g.joinCode)}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(g.id);
        window.setTimeout(() => setCopied((c) => (c === g.id ? null : c)), 2600);
      })
      .catch(() => undefined);
  }, []);

  /**
   * ARRIVING ON A LINK. Someone sent you one, you opened it, and you should
   * be in the room — not looking at a form asking you to paste what you just
   * clicked. The code leaves the URL immediately so a reload cannot re-run it.
   */
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    joinGroup(code)
      .then((r) => setGroups((prev) => [r.group, ...prev.filter((x) => x.id !== r.group.id)]))
      .catch(() => undefined);
  }, []);

  /**
   * EDITING, AND THE ONE RULE THAT GOVERNS ALL THREE LAYERS.
   *
   * The canon makes every layer human-modifiable and settles the conflict with
   * regeneration the same way everywhere: a human edit LOCKS the thing. The
   * server never rewrites words a person touched; it keeps attaching evidence
   * underneath them. So editing is not a convenience here, it is the act that
   * converts a machine's reading into your own sentence — and it is the last
   * thing the archive could do that this world could not.
   *
   * One editor for all three, because they are the same gesture on different
   * layers: open the words, change them, keep them.
   */
  const [edit, setEdit] = useState<{
    kind: "memory" | "pattern" | "entry";
    id: string;
    text: string;
    saving: boolean;
  } | null>(null);

  const saveEdit = useCallback(() => {
    if (!edit || edit.saving) return;
    const text = edit.text.trim();
    if (text === "") return;
    setEdit({ ...edit, saving: true });
    const done = () => setEdit(null);
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
      setEdit((e) => (e ? { ...e, saving: false } : e));
      if (err instanceof ApiError && err.status === 404) {
        setEdit(null);
        void loadTopOfMind()
          .then((tom) => {
            setTopOfMind(tom);
            setNotes(tom ? tom.entries : []);
            setAdopted(null);
          })
          .catch(() => {
            /* the reload is best-effort: if it also fails the board simply
               stays as it was, which is no worse than before */
          });
      }
    };
    if (offlineRef.current) return done();
    if (edit.kind === "memory") {
      updateInspiration(edit.id, { text })
        .then(() => {
          setCaptures((prev) =>
            prev ? prev.map((c) => (c.id === edit.id ? { ...c, preview: text } : c)) : prev,
          );
          detailsRef.current.delete(edit.id);
          setSelectedId(null);
          done();
        })
        .catch(fail);
    } else if (edit.kind === "pattern") {
      updateSignal(edit.id, { statement: text })
        .then(() => {
          setPatterns((prev) =>
            prev ? prev.map((p) => (p.id === edit.id ? { ...p, statement: text, locked: true } : p)) : prev,
          );
          done();
        })
        .catch(fail);
    } else {
      updateTopOfMindEntry(edit.id, { body: text })
        .then(() => {
          setNotes((prev) =>
            prev ? prev.map((n) => (n.id === edit.id ? { ...n, body: text, locked: true } : n)) : prev,
          );
          setAdopted(null);
          done();
        })
        .catch(fail);
    }
  }, [edit]);

  /**
   * THROW IT AWAY, FOR REAL.
   *
   * The server goes first here, which is the opposite of the mouth's optimism
   * and deliberately so: a keep that fails can be re-typed from the words
   * still on screen, and a delete that fails after the orb is gone leaves the
   * person believing they threw away something that is still there. So the
   * light only goes out once the archive has agreed.
   *
   * The orb does not pop: it leaves the way anything leaves this world, and
   * the panel closes with it.
   */
  /**
   * Open a memory to the rooms this account is in, or close it again.
   *
   * Optimistic on the way out and corrected on failure: the light under a
   * memory should answer a press immediately, and the only cost of being
   * briefly wrong is a word that flips back. The server is the authority on
   * what other people can see either way — nothing here filters anything.
   */
  /* the detail is authoritative once it lands; until then the field's own
     copy carries it, so the word is right from the first frame it is shown */
  const panelIsPublic =
    panel?.detail?.isPublic ??
    (captures ?? []).find((c) => c.id === (panelBall?.sigId ?? panelId))?.isPublic ??
    false;
  const [publishing, setPublishing] = useState(false);
  const togglePublic = useCallback(() => {
    const id = panelBall?.sigId ?? panelId;
    if (!id || publishing) return;
    const next = panelIsPublic ? "private" : "public";
    setPublishing(true);
    updateInspiration(id, { visibility: next })
      .then(() => {
        setCaptures((cur) =>
          (cur ?? []).map((c) => (c.id === id ? { ...c, isPublic: next === "public" } : c)),
        );
        /* it went out to people, or it came home */
        simApiRef.current?.acknowledge(next === "public" ? "shared" : "touch");
      })
      .catch(() => {
        /* left as it was: the word is the state, so an unchanged word is an
           honest report that nothing moved */
      })
      .finally(() => setPublishing(false));
  }, [panelBall, panelId, panelIsPublic, publishing]);

  const forgetIt = useCallback(() => {
    simApiRef.current?.acknowledge("let-go");
    const id = panelId;
    if (!id || forget.step === "going") return;
    if (offlineRef.current) {
      /* nothing behind the world to delete from, and pretending otherwise
         would be the one lie the fixture is built to never tell */
      setForget({ id: null, step: "rest" });
      return;
    }
    setForget({ id, step: "going" });
    const serverId = panelBall?.sigId ?? id;
    deleteInspiration(serverId)
      .then(() => {
        setSelectedId(null);
        simApiRef.current?.unborn(id);
        bornRef.current = bornRef.current.filter((s) => s.id !== id && s.sigId !== serverId);
        setCaptures((prev) =>
          prev ? prev.filter((c) => c.id !== id && c.id !== serverId) : prev,
        );
        setForget({ id: null, step: "rest" });
      })
      .catch(() => {
        /* it is still there, and the world still shows it: back to the ask */
        setForget({ id, step: "asking" });
      });
  }, [panelId, panelBall, forget.step]);

  const askToReflect = useCallback(() => {
    if (!panelId || !panelBall) return;
    /* another member's save is theirs to reflect on, not the viewer's */
    if (panelBall.col !== undefined && !panelBall.own) return;
    /* ONE QUESTION, AND IT IS NOT GENERATED.
       The canon keeps stored reflections — they are layer-1 detail, the
       person's own words, and input to extraction — but parks the question
       GENERATOR. So the world asks the plainest question there is, opens
       immediately, and spends no round trip on it. There is no "asking" beat
       to sit through and nothing to fail. */
    setReflect({ step: "open", question: "What did this stir in you?", answer: "" });
  }, [panelId, panelBall]);

  const keepReflection = useCallback(() => {
    if (!panelId || reflect.step !== "open" || reflect.answer.trim() === "") return;
    const answer = reflect.answer.trim();
    setReflect((r) => ({ ...r, step: "keeping" }));
    /* a room orb reflects against its real signal id; the relight below
       still addresses the namespaced ball on screen */
    createReflection(panelBall?.sigId ?? panelId, { question: reflect.question, answer })
      .then((made) => {
        setReflect((r) => ({ ...r, step: "kept", lastId: made.id }));
        /* THE PAYOFF: the memory comes back to life in front of you. A saved
           reflection is a real state change — one more answered reflection,
           touched just now — so the orb's aliveness genuinely rises and the
           light shows it. Fading → touch → reflect → re-lit, made visible. */
        simApiRef.current?.relight(panelId);
        simApiRef.current?.acknowledge("answered");
      })
      .catch(() => setReflect((r) => ({ ...r, step: "open" })));
  }, [panelId, reflect, panelBall]);

  /* The passages worth marking inside the text: the words a PATTERN carried
     out of this memory, and only those. The second tier used to be the
     judge's "sparks", which the rebuild parked along with its table — so
     rather than fill the gap with something else, the panel marks less. A
     memory no pattern has quoted is shown unmarked, which is honest. */
  const panelMarks = useMemo(() => {
    const out: Array<{ text: string; tier: "source" | "spark" }> = [];
    if (panelBall?.quote) out.push({ text: panelBall.quote, tier: "source" });
    return out;
  }, [panelBall]);

  /**
   * A LONG MEMORY OPENS AT THE PART THAT MATTERED.
   *
   * Something worth keeping can be a whole pasted page, and the span a
   * pattern actually read out of it can be four lines from the bottom. The
   * panel opened at the top regardless, so the answer to "which part of this
   * produced that?" was there but below the fold — present, and functionally
   * hidden, which is the worst of both.
   *
   * So when the text is long enough to scroll AND something in it is marked,
   * the panel opens scrolled to the mark, with a little room above it so the
   * sentence still has the context it lived in. Short memories are untouched:
   * scrolling a memory that fits is motion that explains nothing.
   *
   * It reads geometry after layout, so it must run in a layout effect — a
   * scroll set after paint is a visible jump rather than an opening position.
   */
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const box = panelRef.current;
    const text = panelTextRef.current;
    if (!box || !text) return;
    /* nothing to lead with, or nothing to lead past */
    if (box.scrollHeight <= box.clientHeight + 8) return;
    const mark = text.querySelector("mark");
    if (!(mark instanceof HTMLElement)) return;
    const above = 96; /* the lines it lived among, kept in view */
    const want = mark.offsetTop - above;
    if (want > 8) box.scrollTop = want;
  }, [panelOpen, panelId, panel]);

  /* the marks wear the orb's own colour, never a highlighter yellow */
  const markStyle = useMemo(
    /* The mark wears the light every orb wears — there is one, now, and it is
       the one the whole page is lit by. It used to be the tapped orb's own
       hash-picked tint — a hue that meant nothing, sitting inside the person's
       own sentence. */
    () => ({ "--jar-mark": "var(--jar-live)" }) as CSSProperties,
    [],
  );

  return (
    <div ref={rootRef} className="jar" aria-label="Waka">
      {/* the volume: a world-tall gradient the camera descends through */}
      <div ref={atmosRef} className="jar-atmos" aria-hidden="true" />

      {phase === "ready" ? (
        <div ref={hqRef} className="jar-hq">
          {/* ---- ONE COLUMN PER WALL (v10) ----
              Agents to the left, you at the origin, rooms to the right. A
              column is dark until the traveler has arrived with complete data
              — then it is whole: name, ambition arriving word by word, what it
              turned away from, the forming line. Once woken it stays.

              What is NOT here, on any wall, is a field: there is one field and
              it is yours, it lives below all of these, and it does not slide
              sideways when you travel. */}
          {walls.map((w) => {
            const key = wallKey(w);
            const here = w.kind === atWall.kind && w.id === atWall.id;
            /* the wall you are standing on is the one the dial winds; every
               other wall shows what it holds NOW */
            const c = here ? chrome : wallChromeNow.get(key) ?? null;
            const ready = w.kind !== "room" || wokenRooms.has(w.id);
            return (
              <div
                key={key}
                className="jar-wallcol"
                /* a room of machines is set in the machine hand too — the
                   typography and the body must never disagree about what
                   kind of mind you are standing in */
                data-kind={
                  w.kind === "room" && machineRooms.has(w.id) ? "agent" : w.kind
                }
                style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col})` }}
              >
                {ready && c ? (
                  <div
                    className="jar-hq-inner"
                    ref={w.kind === "self" ? hqInnerRef : undefined}
                  >
                    {/* the wall's name, and nothing else in this slot, ever —
                        no kind label, no model, no chip */}
                    <div className="jar-eyebrow jar-label">{c.eyebrow}</div>
                    {c.text ? (
                      /* A STABLE KEY, AND A CARRIED/NEW SPLIT INSIDE IT.
                         The whole h1 used to be keyed by its words, so every
                         rewrite replayed every word — and the one thing a
                         person most wants to know about a self-description
                         ("has this been the same thing?") was invisible.
                         Words that survived a rewrite now stay lit and still;
                         only new words arrive. Scrub a wall's whole history
                         and you watch which words persist and which churn:
                         the spine is the still text, the drift is the
                         flicker. */
                      <h1
                        key={`poster-${key}`}
                        className="jar-poster"
                        /* ASK THE LOUDEST CLAIM WHERE IT CAME FROM.
                           The sentence itself is the control — there is no
                           button beside it, because a button beside a poster
                           is furniture and this world has none. Only on the
                           wall you are standing on: the other columns are
                           read at a distance, not interrogated. */
                        data-jar-chrome={here ? "1" : undefined}
                        role={here ? "button" : undefined}
                        tabIndex={here ? 0 : undefined}
                        aria-expanded={here ? posterAsk : undefined}
                        onClick={here ? () => setPosterAsk((v) => !v) : undefined}
                        onKeyDown={
                          here
                            ? (ev) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  setPosterAsk((v) => !v);
                                }
                              }
                            : undefined
                        }
                      >
                        {posterWords(c.text, c.prevText)}
                        {c.awayFrom ? (
                          <span className="jar-poster-away"> {c.awayFrom}</span>
                        ) : null}
                      </h1>
                    ) : (
                      /* NO GENERATED PLACEHOLDER, EVER. An invented ambition
                         for a wall that has not worked yet would teach the
                         reader that the poster is generated copy and destroy
                         the credibility of every wall they read afterwards. */
                      <p className="jar-forming">
                        {c.formingAlt ?? "Forming — nothing adopted yet"}
                      </p>
                    )}
                    {c.asOf ? (
                      <div className="jar-asof jar-label">As of {c.asOf}</div>
                    ) : null}
                    {/* WHAT IT RESTS ON. The same chain the sky shows under a
                        pattern, one layer up: the memories this sentence was
                        built from, each with the span that carried it at full
                        ink and the surround dimmed. Pressing one travels to
                        that memory in the field. */}
                    {here && posterAsk ? (
                      posterChain.length > 0 ? (
                        <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                          <p className="jar-prov-lead jar-label">built from</p>
                          {posterChain.map((e) => (
                            <button
                              key={e.inspirationId}
                              type="button"
                              className="jar-prov-row"
                              onClick={() => {
                                setPosterAsk(false);
                                simApiRef.current?.revealMemory(e.inspirationId);
                              }}
                            >
                              <span className="jar-prov-text">{salience(e)}</span>
                              {e.reason ? (
                                <span className="jar-prov-why">{e.reason}</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : (
                        /* the honest empty: a sentence with no chain is a
                           sentence somebody wrote by hand, and saying so is
                           more useful than an empty band */
                        <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                          <p className="jar-prov-lead jar-label">written by hand</p>
                        </div>
                      )
                    ) : null}
                    {/* WHAT IT USED TO SAY. Only where there is a past — one
                        version is not a history, it is the first sentence. */}
                    {here && posterAsk && w.kind === "self" && (versions?.length ?? 0) > 1 ? (
                      <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                        <p className="jar-prov-lead jar-label">before this</p>
                        {(versions ?? []).slice(1, 5).map((v) => (
                          <p key={v.id} className="jar-was">
                            {dateWords(Date.parse(v.createdAt) || 0, TRef.current)}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {/* The one quiet line, and the page's single interactive
                        signal. The candidates that could replace this ambition
                        are separate entities living a section above, and this
                        is the way up — on any wall that has a sky. */}
                    {c.forming ? (
                      <button
                        type="button"
                        className="jar-forming-line jar-label"
                        data-jar-chrome="1"
                        onClick={() => {
                          simApiRef.current?.acknowledge();
                          if (hasSky(w.kind)) simApiRef.current?.toSky();
                        }}
                      >
                        {c.forming}
                      </button>
                    ) : null}
                    {/* THE BOARD'S OWN VERBS — and this is what makes the
                        world an instrument rather than a display.

                        Until now the poster was whatever the server had
                        written, and there was no way to touch it. You could
                        save a memory and answer a pattern, and then nothing
                        moved. Every knowledge surface worth opening is
                        something a person OPERATES; this is the smallest set
                        of verbs that makes this one operable.

                        Only your own wall. A room's board changes by proposal
                        and affirmation, an agent's board is the agent's own
                        account of itself, and neither is edited from here. */}
                    {/* THE POSTER, IN YOUR OWN HAND. Editing an entry locks it,
                        so the board keeps updating what it rests on and never
                        rewrites the sentence again. */}
                    {w.kind === "self" && edit?.kind === "entry" ? (
                      <div className="jar-reflect" data-jar-chrome="1">
                        <textarea
                          className="jar-reflect-box"
                          rows={3}
                          autoFocus
                          value={edit.text}
                          onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                        />
                        <p className="jar-neb-ask">
                          <button type="button" disabled={edit.saving} onClick={saveEdit}>
                            {edit.saving ? "…" : "keep these words"}
                          </button>
                          <span aria-hidden="true"> · </span>
                          <button type="button" onClick={() => setEdit(null)}>
                            leave it
                          </button>
                        </p>
                      </div>
                    ) : null}
                    {w.kind === "self" && undrop ? (
                      <p className="jar-neb-ask jar-neb-ask--after" data-jar-chrome="1">
                        <button type="button" onClick={restoreLead}>
                          put it back
                        </button>
                      </p>
                    ) : null}
                    {w.kind === "self" && !offline && lead && !edit ? (
                      <div className="jar-board-acts" data-jar-chrome="1">
                        {board.step === "asking" ? (
                          <>
                            {/* WHAT WILL CHANGE, BEFORE IT CHANGES. Frostpunk's
                                first game commits and then judges; its second
                                previews the consequence at the moment of the
                                vote, and that is the whole difference in how
                                fair the two feel. Regeneration rewrites the
                                board from the patterns as they now stand, so
                                the sentence names exactly that. */}
                            <span className="jar-board-warn">
                              Reading everything again. What it says may change.
                            </span>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={rebuildBoard}
                            >
                              Read again
                            </button>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => setBoard({ step: "rest" })}
                            >
                              Leave it
                            </button>
                          </>
                        ) : board.step === "working" ? (
                          <span className="jar-board-act jar-label">Reading…</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => setBoard({ step: "asking" })}
                            >
                              Read it again
                            </button>
                            {/* Holding is the person overruling the ordering:
                                the server keeps feeding the entry but never
                                moves it off the poster again. */}
                            {lead.pinned ? (
                              <span className="jar-board-act jar-label jar-board-act--held">
                                Held up
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="jar-board-act jar-label"
                                onClick={() => holdLead(lead)}
                              >
                                Keep this one up
                              </button>
                            )}
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() =>
                                setEdit({
                                  kind: "entry",
                                  id: lead.id,
                                  text: lead.body,
                                  saving: false,
                                })
                              }
                            >
                              Say it in my words
                            </button>
                            <button
                              type="button"
                              className="jar-board-act jar-label jar-board-act--quiet"
                              onClick={() => dropLead(lead)}
                            >
                              Not this
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* A calm empty sky still exists to be climbed into: one
                    whisper, a section above the ambition. */}
                {/* THE GAP BETWEEN KEEPING AND SEEING, SAID HONESTLY.
                    Somebody's first day here is: save a thought, then nothing.
                    Patterns are made of RECURRENCE — the server promotes one
                    once three separate memories stand behind it — so a new
                    archive can sit silent for days while working perfectly.
                    Silence in that window reads as broken, and "keep
                    collecting" reads as a scold. Saying what the machine is
                    actually waiting for is both truer and kinder, and it is
                    the one sentence that makes the first week make sense. */}
                {ready && hasSky(w.kind) && !candidates.some((q) => q.col === w.col) ? (
                  <p className="jar-sky-empty jar-label">
                    {w.kind === "agent"
                      ? "Nothing forming yet"
                      : (captures?.length ?? 0) === 0
                        ? "Nothing is forming yet"
                        : "Patterns come from what repeats — nothing has, yet"}
                  </p>
                ) : null}
                {/* An empty wall is a beginning, not a fault — and the way it
                    fills is stated, because the person is trying to decide
                    whether to delegate and the honest answer is "you cannot
                    decide yet".

                    ONCE, THOUGH. Where the poster is already standing in for
                    an absent ambition — "I haven't formed anything yet" — the
                    wall has said this, and a second sentence saying the same
                    thing in a different voice and a different place is the
                    duplicate the founder caught on the agent wall. So this
                    line exists only when nothing above it spoke. */}
                {ready && c?.empty && !c?.formingAlt ? (
                  w.kind === "self" ? (
                    /**
                     * THE FIRST SCREEN, AND IT IS THE ONE THAT MATTERS MOST.
                     *
                     * Day-one retention is a hard ceiling on every number
                     * after it, and for this product the first session IS the
                     * empty screen. It used to be a single line of text, which
                     * is the worst available form — an empty page describes
                     * absence, and absence is not something anyone wants to
                     * fill in.
                     *
                     * What works instead, in every case studied: show the
                     * SHAPE, unfilled. Obra Dinn hands you a book whose sixty
                     * rows are already named and every fate blank, so you can
                     * see the exact size of your ignorance before you know one
                     * answer. Dirtmouth is an empty town whose closed doors
                     * are visible and countable — not "nothing", but "not yet
                     * open". So this is the three layers, standing, waiting,
                     * each named and each honest about being empty. No
                     * tutorial. No apology. No progress bar, ever.
                     */
                    <div className="jar-first">
                      <p className="jar-first-line">
                        <span className="jar-first-slot" aria-hidden="true" />
                        <span>a pattern, once something recurs</span>
                      </p>
                      <p className="jar-first-line">
                        <span className="jar-first-slot" aria-hidden="true" />
                        <span>what it all comes to</span>
                      </p>
                      <p className="jar-first-line">
                        <span className="jar-first-slot" aria-hidden="true" />
                        <span>everything you keep</span>
                      </p>
                    </div>
                  ) : (
                    <p className="jar-wall-empty">
                      {w.kind === "agent"
                        ? "Give me something to work on and I’ll start"
                        : "This room hasn’t noticed anything yet — share more, read together."}
                    </p>
                  )
                ) : null}
                {w.kind === "room" && failedRooms.has(w.id) && !ready ? (
                  <p className="jar-wall-hold jar-label">Couldn’t reach this room</p>
                ) : null}
                {/* THE EDGE OF THE WORLD, AND WHAT IS BEYOND IT.
                    Making a room and adding an agent both mean "a new column
                    appears", so they belong where the columns run out — you
                    reach them by walking to the end rather than by opening a
                    menu. It only shows on the wall that IS the end, in each
                    direction, so it is never a control sitting around. */}
                {/* A WORLD HELD STILL SAYS SO, AND SAYS IT WHERE YOU CAN UNDO IT.
                    The preference persisted with no visible state and no
                    control in the world, so anybody who pressed it once was
                    left with a companion that no longer walked, leaned, bobbed
                    or answered — and nothing on screen explaining why. A
                    setting that can freeze everything must never be invisible.
                    Only shown when the PAGE is holding it: a system-level
                    reduced-motion preference is not ours to argue with. */}
                {/* It sits AT THE EDGE, hard against the margin it is talking
                    about, in the quiet label register — a signpost where the
                    world runs out, not a sentence in the middle of the room.
                    Centred under the poster it read as a statement about your
                    ambition, which it is not. */}
                {ready ? (
                  <>
                    <button
                      type="button"
                      className="jar-edge jar-edge--r jar-label"
                      data-jar-chrome="1"
                      onClick={() =>
                        setRoomForm({ mode: "make", text: "", busy: false, error: null })
                      }
                    >
                      Make a room
                    </button>
                    <button
                      type="button"
                      className="jar-edge jar-edge--l jar-label"
                      data-jar-chrome="1"
                      onClick={() => setAgentName("")}
                    >
                      Add an agent
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
          {/* what the companion is glowing about — its one line, in words */}
          <div ref={charSayRef} className="jar-char-say">
            {charSay ? (
              <p key={charSay} className="jar-label">
                {charSay.split(/\s+/).map((word, i) => (
                  <Fragment key={`${i}-${word}`}>
                    <span className="jar-word" style={{ animationDelay: `${i * 28}ms` }}>
                      {word}
                    </span>{" "}
                  </Fragment>
                ))}
              </p>
            ) : null}
          </div>

          {/* ---- THE LENS lived here ----
              Excised while half-built: the control existed but nothing read
              it — no styling, and the per-orb haze it was meant to drive
              (`Ball.lens`) was never written from it, so it filtered nothing.
              The field field and the derive side survive for the rebuild. */}

          {/* The edge affordances: a neighbour's name waiting at the side it
              lives past. They live in headquarters' own chrome, so they scroll
              away with it — which is also how the field section ends up with
              none, exactly as it should, since there is nothing different to
              travel to down there. */}
          {walls.map((w, i) => {
            const left = walls[i - 1] ?? null;
            const right = walls[i + 1] ?? null;
            return (
              <Fragment key={`edges-${wallKey(w)}`}>
                {left ? (
                  <button
                    type="button"
                    className="jar-edge jar-label"
                    data-jar-chrome="1"
                    style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col} + 16px)` }}
                    onPointerDown={() => loadWall(left)}
                    onClick={() => simApiRef.current?.travel(-1)}
                  >
                    ‹ {left.name}
                  </button>
                ) : null}
                {right ? (
                  <button
                    type="button"
                    className="jar-edge jar-edge--r jar-label"
                    data-jar-chrome="1"
                    style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col + 1} - 16px)` }}
                    onPointerDown={() => loadWall(right)}
                    onClick={() => simApiRef.current?.travel(1)}
                  >
                    {right.name} ›
                  </button>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      ) : null}

      {/* ---- THE MOUTH ----
          It stands ON THE SEAM between headquarters and the field, so what
          you type sits just above where the orb it becomes will appear: the
          geography teaches itself in one beat and there is no tutorial
          anywhere. At rest it is one phrase and nothing else — it must not
          read as a form.

          It is its own layer rather than a child of headquarters for one
          reason: headquarters is drawn UNDER the canvas, and you cannot type
          into words with orbs passing over them. The loop hands it
          headquarters' own transform every frame, so it belongs to your wall
          and to the seam exactly as if it lived there. */}
      {phase === "ready" ? (
        <div ref={mouthRef} className="jar-mouth" data-jar-chrome="1">
          <div className={`jar-mouth-slot${atNow ? "" : " jar-mouth-slot--away"}`}>
            {mouthOpen ? (
              <textarea
                ref={(el) => {
                  mouthFieldRef.current = el;
                  mouthSpotRef.current = el;
                }}
                className="jar-mouth-field"
                value={draft}
                rows={1}
                spellCheck={false}
                aria-label="something worth keeping"
                placeholder="Something worth keeping"
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (mouthNote !== "") setMouthNote("");
                }}
                onKeyDown={onMouthKey}
                onBlur={onMouthBlur}
              />
            ) : (
              <button
                type="button"
                ref={(el) => {
                  mouthSpotRef.current = el;
                }}
                className="jar-mouth-rest jar-label"
                onClick={openMouth}
              >
                Keep something
              </button>
            )}
            {/* WHERE THIS ONE GOES, DECIDED WHILE WRITING IT.
                Offered only once there are words: an empty mouth showing a
                privacy control is a form, and this world does not have forms.
                It reads as a state, matching the panel — the line says where
                the memory is headed, and pressing it changes that — because a
                public/private pair invites a decision every time, and the
                answer is the same for almost every memory somebody keeps.

                Private is the resting state and the one you get by not
                touching this, which is the whole safety property: the only
                way to publish is to say so. */}
            {mouthOpen && draft.trim() !== "" ? (
              <p className="jar-neb-ask jar-neb-ask--row jar-mouth-where">
                <button type="button" onClick={() => setKeepPublic((v) => !v)}>
                  {keepPublic ? "going to your rooms" : "kept to yourself"}
                </button>
              </p>
            ) : null}
            {/* the one honest line, in prose and never in the label register */}
            {mouthNote !== "" ? <p className="jar-mouth-note">{mouthNote}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Section S — the sky. The canvas draws the nebulae; these are their
          sentences and their one action each, positioned on their clouds by
          the loop every frame. */}
      <div className="jar-sky" data-jar-chrome="1">
        {candidates.map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              if (el) nebElsRef.current.set(c.id, el);
              else nebElsRef.current.delete(c.id);
            }}
            className={`jar-neb jar-neb--${c.kind}`}
          >
            {/* WHAT YOU SAID IS CARRIED BY THE STATEMENT, NOT BY A LABEL BESIDE
                IT. A pattern you agreed with holds its full weight; one you
                half-agreed with lightens; one you called untrue is set in the
                world's dimmest ink and struck through — still there, because
                nothing here is deleted for disagreeing with it. */}
            <p className="jar-neb-text" data-said={verdicts.get(c.id) ?? undefined}>
              {c.text}
            </p>
            {c.kind === "draft" ? (
              <p className="jar-neb-note jar-label">a draft, unsaved</p>
            ) : null}
            {/* WHAT IT WAS READ FROM, AND WHICH WORDS DID THE READING.
                A pattern is a claim the machine made about you. Until now the
                sky stated the claim and stopped there, which is the exact
                shape of an assertion you cannot argue with — you were asked
                to agree or disagree with a sentence whose grounds were not on
                screen.

                So under the statement sit the memories it came from, and
                inside each memory the QUOTED SPAN carries full ink while the
                rest of the sentence stays dim. That is salience rendered in
                the world's only meaning channel: same words, same size, same
                face — light is the difference. No highlighter, no percentage,
                no confidence bar. You can see at a glance that four memories
                said the same thing and exactly which fragment of each one did
                the saying.

                And each is pressable: it travels to that memory in the field
                and opens it, so the chain runs downward as well as upward. */}
            {focusCandId === c.id && evidenceFor(c).length > 0 ? (
              <div className="jar-prov">
                <p className="jar-prov-lead jar-label">read from</p>
                {evidenceFor(c).map((e) => (
                  <button
                    key={`${e.signalId}:${e.inspirationId}`}
                    type="button"
                    className="jar-prov-row"
                    onClick={() => simApiRef.current?.revealMemory(e.inspirationId)}
                  >
                    <span className="jar-prov-text">{salience(e)}</span>
                    {e.reason ? <span className="jar-prov-why">{e.reason}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {/* The one action, and only where there is genuinely one to take.
                A candidate with nowhere to be adopted to renders NOTHING: the
                absence of an affordance already says so, and saying it in
                words as well — under a greyed-out control — was apparatus. */}
            {c.adopt ? (
              <button
                type="button"
                className="jar-neb-act jar-label"
                disabled={adopting}
                onClick={() => adopt(c)}
              >
                Adopt as your ambition
              </button>
            ) : null}
            {/* ANSWERING IT. Only on the one being read, only for a pattern
                the server actually made (a draft is your own sentence and a
                proposal belongs to a room), and never as a score: the answer
                you gave comes back as the words you said. */}
            {/* ANSWERING IT, IN THE SENTENCE'S OWN VOICE.
                This was four uppercase chips in a row under the statement —
                a survey stapled to a sentence. The research this was built
                from says the opposite in every case it examined: confidence
                is discrete and TYPOGRAPHIC, carried by how the claim is set
                rather than by controls beside it. Obra Dinn separates your
                marks from the world's by handwriting versus print; Umineko
                types the assertion by colour. None of them grew a toolbar.

                So there is nothing here at rest. The answers are one quiet
                line in the same face the statement is set in, and they arrive
                only on the pattern being read. Once answered they are gone
                and the STATEMENT itself carries what you said. */}
            {c.kind === "reading" && focusCandId === c.id && !verdicts.has(c.id) ? (
              <p className="jar-neb-ask">
                {/* The non-drag route, and the only thing on screen that ever
                    says joining is possible before you have tried it. */}
                {pairableIds.has(c.id) ? (
                  <>
                    <button type="button" onClick={() => simApiRef.current?.joinTo(c.id)}>
                      join to the nearest
                    </button>
                    <span aria-hidden="true"> · </span>
                  </>
                ) : null}
                {/* SAY IT OUT LOUD. The only act that puts anything on a
                    room's wall, so it lives on the pattern itself rather than
                    in a share menu somewhere else. Your own wall only: an
                    agent's statements are its own to make public. */}
                {atWall.kind === "self" && groups.length > 0 ? (
                  <>
                    <button type="button" onClick={() => setSharing(sharing === c.id ? null : c.id)}>
                      {(patterns ?? []).find((p) => p.id === c.id)?.sharedGroupIds.length
                        ? "out loud in"
                        : "say out loud"}
                    </button>
                    <span aria-hidden="true"> · </span>
                  </>
                ) : null}
                <button type="button" onClick={() => sayVerdict(c.id, "true")}>yes</button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => sayVerdict(c.id, "partly")}>partly</button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => sayVerdict(c.id, "not_true")}>not true</button>
                {/* CHANGE ITS WORDS, AND IT BECOMES YOURS. A human edit locks
                    the statement: the server keeps attaching evidence under it
                    and never rewrites the sentence again. That is the act that
                    turns a machine's reading of you into your own line. */}
                {atWall.kind === "self" ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <button
                      type="button"
                      onClick={() =>
                        setEdit({ kind: "pattern", id: c.id, text: c.text, saving: false })
                      }
                    >
                      say it better
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {edit?.kind === "pattern" && edit.id === c.id ? (
              <div className="jar-reflect">
                <textarea
                  className="jar-reflect-box"
                  rows={3}
                  autoFocus
                  value={edit.text}
                  onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                />
                <p className="jar-neb-ask">
                  <button type="button" disabled={edit.saving} onClick={saveEdit}>
                    {edit.saving ? "…" : "keep these words"}
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setEdit(null)}>
                    leave it
                  </button>
                </p>
              </div>
            ) : null}
            {/* WHICH ROOMS IT IS OUT LOUD IN. One line per room, each a
                toggle — the same statement can be said in several rooms and
                taken back from any one of them independently. */}
            {sharing === c.id ? (
              <div className="jar-share">
                {groups.map((g) => {
                  const on = (patterns ?? []).find((p) => p.id === c.id)?.sharedGroupIds.includes(g.id) ?? false;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={on ? "jar-share-row jar-share-row--on" : "jar-share-row"}
                      onClick={() => shareTo(c.id, g.id, !on)}
                    >
                      {g.name}
                    </button>
                  );
                })}
                <p className="jar-share-note">
                  They read the statement. The memories under it stay here.
                </p>
              </div>
            ) : null}
            {/* AND ONLY THEN MAY IT GO. Throwing out a reading of yourself is
                offered after you have said it is untrue, not alongside the
                question — a sequence rather than a menu, so the destructive
                option is never sitting next to the harmless ones. */}
            {c.kind === "reading" &&
            focusCandId === c.id &&
            atWall.kind === "self" &&
            verdicts.get(c.id) === "not_true" ? (
              <p className="jar-neb-ask jar-neb-ask--after">
                <button type="button" onClick={() => dropPattern(c.id)}>
                  {dropAsk === c.id ? "gone" : "then let it go"}
                </button>
              </p>
            ) : null}
          </div>
        ))}
        {clusters.map((sig) => (
          <div
            key={sig}
            ref={(el) => {
              if (el) clusterElsRef.current.set(sig, el);
              else clusterElsRef.current.delete(sig);
            }}
            className="jar-cluster"
          >
            <button type="button" className="jar-cluster-act jar-label" onClick={() => draftFrom(sig)}>
              Draft one ambition from these {numWords(sig.split("+").length)}
            </button>
          </div>
        ))}
        {/* Whose memory the pointer is on. In a room's candidate the orbiting
            memories belong to different people, and this is how you see whose:
            a given name, beside the satellite, one fade. The loop writes both
            its words and its place — it has no React children, so it can
            never shift anything on the page. */}
        <div ref={satSayRef} className="jar-satsay jar-label" aria-hidden="true" />
      </div>

      <canvas ref={canvasRef} className="jar-canvas" aria-hidden="true" />

      {/* THE EMULSION. Above the world and the type, below the chrome that
          has to stay legible (the panel, the dial, the back link). It blends
          rather than covers, so it lifts the midtones and leaves the blacks
          black — which is the whole reason it cannot live inside the canvas,
          where its backdrop is transparent and `overlay` silently becomes a
          flat grey sheet. It is fixed to the FRAME, not to the world: film
          grain belongs to the lens, and does not slide when you scroll. */}
      <div ref={grainRef} className="jar-grain" aria-hidden="true" />

      {/* The reading panel: a focused orb's information, beside the orb. It
          fades in and out; it never slides, and it never owns the screen. */}
      {panel && panelBall ? (
        <div
          key={panel.id}
          ref={panelRef}
          className={`jar-panel${panelOpen ? " jar-panel--in" : " jar-panel--out"}`}
          data-jar-chrome="1"
          role="dialog"
          aria-label="a saved inspiration"
        >
          {panelIsRoom ? (
            /* whisper attribution: whose save this is, and when — where the
               evidence named no date of its own, who alone. Leaving a fact
               out is honest; guessing at it is not. */
            <span className="jar-panel-when jar-label">
              {panelBall.noDate
                ? panelBall.authorName ?? ""
                : `${panelBall.authorName ?? ""} · ${dateWords(panelBall.capturedMs, Date.now())}`}
            </span>
          ) : (
            <span className="jar-panel-when jar-label">
              {agoWords(panelBall.capturedMs, TRef.current)} ·{" "}
              {dateWords(panelBall.capturedMs, TRef.current)}
            </span>
          )}

          <p ref={panelTextRef} className="jar-panel-text" style={markStyle}>
            {markPassages(
              panel.detail ? panel.detail.text : panelBall.textPreview,
              panelMarks,
            )}
          </p>
          {panel.partial ? (
            <p className="jar-panel-note">Couldn’t load the rest.</p>
          ) : null}
          {panelIsRoom && panelBall.citedBy && panelBall.citedBy.length > 0 ? (
            /* the collapsed links sentence, adapted: what read this save */
            <p className="jar-panel-cited jar-label">{citedWords(panelBall.citedBy)}</p>
          ) : null}

          {/* A ROOM ORB IS SOMEBODY'S STATEMENT, AND YOU MAY ANSWER IT.
              It used to carry no action at all, on the reasoning that another
              member's save is theirs to reflect on — which is right about
              REFLECTING and was wrong about everything else. What hangs on a
              room's wall is a shared pattern, put there to be read by the
              room, and a room where you can read a claim about the group and
              not say whether you recognise it is a noticeboard.
              Three answers, no deletion: removing it would be editing
              someone else's mind, and the room's own board moves by proposal
              and affirmation instead (founder ruling). */}
          {panelIsRoom && !panelBall.own && panelBall.sigId ? (
            /* keyed by the SIGNAL's id, which is what the feedback was filed
               against — the ball's own id is namespaced per room and would
               read back empty every time */
            verdicts.has(panelBall.sigId) ? null : (
              /* the same one quiet line the sky uses — not a row of controls */
              <p className="jar-neb-ask">
                <button type="button" onClick={() => sayVerdict(panelBall.sigId as string, "true")}>
                  yes
                </button>
                <span aria-hidden="true"> · </span>
                <button
                  type="button"
                  onClick={() => sayVerdict(panelBall.sigId as string, "partly")}
                >
                  partly
                </button>
                <span aria-hidden="true"> · </span>
                <button
                  type="button"
                  onClick={() => sayVerdict(panelBall.sigId as string, "not_true")}
                >
                  not true
                </button>
              </p>
            )
          ) : null}

          {/* The one action. Everything else that used to be here — the
              sparks block, what this feeds, nearby in your jar — was
              apparatus: it made a person ask what each list was instead of
              reading what they saved. */}

          {reflect.step === "asking" ? (
            <span className="jar-panel-act jar-label jar-panel-act--waiting">Finding a question…</span>
          ) : null}
          {reflect.step === "open" || reflect.step === "keeping" ? (
            /* one appearance: the question and the box arrive together, whole */
            <div className="jar-reflect">
              <p className="jar-reflect-q">{reflect.question}</p>
              <textarea
                className="jar-reflect-box"
                value={reflect.answer}
                rows={4}
                autoFocus
                placeholder="In your own words"
                onChange={(e) => setReflect((r) => ({ ...r, answer: e.target.value }))}
              />
              <button
                type="button"
                className="jar-panel-act jar-label"
                disabled={reflect.step === "keeping" || reflect.answer.trim() === ""}
                onClick={keepReflection}
              >
                Keep
              </button>
            </div>
          ) : null}
          {/* KEPT — AND TAKEABLE BACK. Writing was possible and unwriting was
              not, which made every reflection a one-way door on words you had
              just typed. A reflection is layer-1 detail and feeds extraction,
              so removing one re-derives what stood on it. */}
          {reflect.step === "kept" ? (
            <p className="jar-neb-ask jar-neb-ask--after">
              <span>kept</span>
              {reflect.lastId ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <button
                    type="button"
                    onClick={() => {
                      const rid = reflect.lastId as string;
                      const owner = panelBall?.sigId ?? panelId;
                      setReflect({ step: "rest", question: "", answer: "" });
                      if (owner && !offlineRef.current)
                        deleteReflection(owner, rid).catch(() => undefined);
                    }}
                  >
                    take it back
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {/* FORGET IT — and the law it does not break.
              "Fading never deletes" is a rule about the MACHINE: nothing goes
              dark because a server decided it had stopped mattering. A person
              throwing away their own memory is the opposite act, and the
              canon makes layer 1 editable and deletable on purpose. Only your
              own: another member's is theirs, and a room orb is a statement
              that was shared rather than a memory that can be reached.
              It asks once, in place, because there is no undo behind it. */}
          {/* EDITING THE MEMORY ITSELF — the last thing the archive could do
              that this world could not. Editing a capture re-derives the
              patterns resting on it, which is why it belongs here beside the
              words rather than on a settings screen somewhere. */}
          {panelCanReflect && !panelIsRoom && edit?.id === panelId ? (
            <div className="jar-reflect">
              <textarea
                className="jar-reflect-box"
                value={edit.text}
                rows={5}
                autoFocus
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
              <p className="jar-neb-ask">
                <button type="button" onClick={saveEdit} disabled={edit.saving}>
                  {edit.saving ? "keeping…" : "keep the change"}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => setEdit(null)}>
                  leave it
                </button>
              </p>
            </div>
          ) : null}
          {/* ONE ACTION IN THE OPEN, THE REST BEHIND A WORD.
              This became four lines under every memory — reflect, change the
              words, add a picture, forget this — which is a menu attached to
              a sentence. Reflecting is the act this panel exists for and the
              only one anybody does often; the other three are housekeeping
              you go looking for. They live behind one quiet word now. */}
          {/* ONE ROW, ONE VOICE.
              This was three separate things: an uppercase `REFLECT ON THIS`
              set as a label-button, then `more`, then `forget this`, each its
              own block — a memory ending in a small ransom note of three
              registers. The act this panel exists for and the way to the rest
              of the acts are now one lowercase line in the same face as the
              memory above them, which is the grammar the sky has used all
              along. `forget this` is not on it: throwing a memory away is
              housekeeping, and it lives behind `more` with the other two. */}
          {panelCanReflect && reflect.step === "rest" && !edit && !more ? (
            <p className="jar-neb-ask jar-neb-ask--after jar-neb-ask--row">
              <button type="button" onClick={askToReflect}>
                reflect on this
              </button>
              {!panelIsRoom ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setMore(true)}>
                    more
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {panelCanReflect && !panelIsRoom && reflect.step === "rest" && !edit && more ? (
            <p className="jar-neb-ask jar-neb-ask--after">
              <button
                type="button"
                onClick={() =>
                  setEdit({
                    kind: "memory",
                    id: panelId as string,
                    text: panel.detail ? panel.detail.text : panelBall.textPreview,
                    saving: false,
                  })
                }
              >
                change the words
              </button>
              <span aria-hidden="true"> · </span>
              {/* THE PICTURE GOES INSIDE THE GLASS. A memory that carries an
                  image is drawn with it, which is the thing this world was
                  first sketched around — and the server reads the picture at
                  capture time, so it feeds the patterns too. */}
              <label className="jar-attach">
                {attaching ? "keeping the picture…" : "add a picture"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={attaching}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    const id = panelBall?.sigId ?? panelId;
                    if (f && id) void attachTo(id, f);
                    e.target.value = "";
                  }}
                />
              </label>
              <span aria-hidden="true"> · </span>
              {/* WHO ELSE MAY SEE THIS.
                  The one verb the data model gained and the world could not
                  perform: rooms were rendering a ground nobody could put
                  anything on. It reads as a state rather than as a switch —
                  the word says where the memory currently is, and pressing it
                  moves it — because "public/private" as a pair of options
                  invites a choice, and this is a fact about one memory.

                  Closing it again takes it out of every room at once. There
                  is no copy anywhere else, so this is genuinely reversible,
                  which is why it needs no confirmation while forgetting
                  does. */}
              <button type="button" onClick={togglePublic} disabled={publishing}>
                {publishing
                  ? "…"
                  : panelIsPublic
                    ? "in your rooms · take it back"
                    : "kept to yourself · put it in your rooms"}
              </button>
              <span aria-hidden="true"> · </span>
              {/* AND ONLY THEN MAY IT GO. Forgetting sits at the end of the
                  same line as the other two housekeeping acts rather than in
                  a block of its own: it is the last thing you would reach
                  for, not a different category of thing. Asking still happens
                  in sequence — the confirmation replaces this word, so the
                  destructive option is never sitting next to its own
                  confirmation. */}
              {forget.step === "going" ? (
                "letting go…"
              ) : forget.id === panelId ? (
                <>
                  <button type="button" onClick={forgetIt}>forget it</button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setForget({ id: null, step: "rest" })}>
                    keep it
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setForget({ id: panelId, step: "asking" })}>
                  forget this
                </button>
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="jar-topbar" data-jar-chrome="1">
        {/* THE WAY OUT, AND THERE HAS TO BE ONE.
            Making the world home orphaned every other screen: profile,
            settings and the list surfaces became unreachable because nothing
            linked to them. That is not a design choice, it is a door that was
            bricked up by accident.

            Two exits, and they are different kinds of thing, so they do not
            share a shape. The archive is the SAME memories in another
            register — words, editable, searchable — and it goes away once the
            world can do everything it can. Settings is the account: it leaves
            the world entirely and always will. */}
        {/* THE WAY OUT IS NOT A PLACE TO PUT THINGS.
            This grew to four pills in a row — archive, settings, rooms, who is
            here — which is a toolbar, and a toolbar is the thing this world
            was built to not have. They were collapsed to one. But the one was
            a TERNARY: on a room wall the exit was replaced by the room's
            members, and this is the only link to /profile in the entire world.
            So on four of six walls there was no way to your account at all —
            no settings, no language, no sessions, no sign out — from a slot
            named `jar-exits`, under a comment calling it "the way out".

            The way out never changes, so it never moves. Where you are
            standing is a different fact and gets the line below, which the
            fixed chrome already keeps for exactly this and which holds in all
            three sections — a room's identity was otherwise readable only
            down in the field, where the legend draws it. */}
        <div className="jar-exits">
          {
            /* ONE WORD, AND IT GOES ONE PLACE.
               This opened a drawer of six unrelated things — find, rooms, add
               an agent, settings, hold still, archive — which is a toolbar
               folded up, not a toolbar removed. Each of those belongs
               somewhere the world already has:

                 rooms / agents  →  the ENDS OF THE AXIS. They make columns;
                                    the axis is what columns live on. You find
                                    them by walking to the edge of the world.
                 find            →  the FIELD. It is a verb about memories, so
                                    it sits with them and answers with "/".
                 hold still      →  SETTINGS. A persisted preference about how
                                    this renders is an account thing.
                 archive         →  SETTINGS, and temporary either way.

               What is left at the top of the screen is the way out. */
            /* A DOOR IS NAMED FOR WHAT IS BEHIND IT. This said "Waka" — the
               product's name, printed on the product, next to nothing it
               explained. A label in this position has one job: say where
               pressing it goes. */
            /* WHERE YOU ARE, TOP LEFT — and it is the way into this space's
               settings. It replaces a caption that read
               "OUR AGENTS · YUN, DEMO AND FOUR MORE": apparatus, unclickable
               (it inherited `pointer-events: none` from the bar), and it spent
               the widest line on screen listing people you can already see by
               their hues in the field.

               A name in this position answers "where am I" and "what can I do
               about it" with one word. Every space has one, so it never
               disappears the way the account link used to — and settings are
               PER SPACE, because renaming a room, taking someone out of it or
               closing it are all facts about the space you are standing in. */
            <button
              type="button"
              className="jar-here jar-back jar-label"
              aria-expanded={settingsFor === wallKey(atWall)}
              onClick={() =>
                setSettingsFor(settingsFor === wallKey(atWall) ? null : wallKey(atWall))
              }
            >
              {atWall.kind === "room"
                ? groups.find((g) => g.id === atWall.id)?.name ?? atWall.name
                : atWall.name}
            </button>
          }
        </div>

        {/* AND THE WAY OUT MOVES RIGHT. Two permanent things at the top of the
            screen, on opposite sides, each answering a different question:
            left is WHERE YOU ARE, right is HOW YOU LEAVE. They stopped being
            the same slot the moment the room's name needed somewhere to live,
            and putting them at opposite ends means neither can ever hide the
            other — which is exactly the bug the ternary here used to cause. */}
        <button
          type="button"
          className="jar-account jar-back jar-label"
          aria-expanded={accountOpen}
          onClick={() => {
            setAccountOpen((v) => !v);
            setSettingsFor(null);
          }}
        >
          Your account
        </button>

        {/* WHAT YOU ARE LOOKING AT, WHEN IT IS NOT YOURS. It lives in the
            fixed chrome rather than on a wall because it is a fact about the
            whole session — so it is there in the sky, at headquarters and down
            in the field, and it cannot be travelled away from. */}
        {offline ? (
          <p className="jar-offline jar-label">
            Offline — showing sample memories, nothing is kept
          </p>
        ) : null}
      </div>

      {legend.length > 0 && inField && phase === "ready" ? (
        <div className="jar-legend" data-jar-chrome="1">
          {legend.map((m) => (
            <span key={m.id} className="jar-legend-row">
              <i
                className={m.agent ? "jar-legend-dot jar-legend-dot--agent" : "jar-legend-dot"}
                style={m.hue >= 0 ? { background: hueCss(m.hue) } : undefined}
                aria-hidden="true"
              />
              {m.name}
            </span>
          ))}
        </div>
      ) : null}

      {dial && phase === "ready" ? (
        <div
          ref={dialRef}
          className={`jar-dial${scrubbing || !atNow ? " jar-dial--live" : ""}${
            inSky || dialAway ? " jar-dial--away" : ""
          }`}
          data-jar-chrome="1"
        >
          <div
            ref={dialTrackRef}
            className="jar-dial-track"
            onPointerDown={onDialDown}
            onPointerMove={onDialMove}
            onPointerUp={onDialUp}
            onPointerCancel={onDialUp}
          >
            {dial.majors.map((m) => (
              <span
                key={m.pct}
                className="jar-month jar-label"
                style={{ top: `${(m.pct * 100).toFixed(2)}%` }}
              >
                {m.label}
              </span>
            ))}
            {/* the date exists only while a finger is on the dial: it answers
                the scrub and then goes, and there is no second affordance for
                returning to now — that is the right-hand end of the rail */}
            <span
              ref={dialDateRef}
              className={`jar-dial-date jar-label${scrubbing ? " jar-dial-date--on" : ""}`}
            />
            <div ref={dialHandleRef} className="jar-dial-handle" />
          </div>
        </div>
      ) : null}

      {/* The skeleton speaks PROSE, so it never enters the label register:
          all-caps is for eyebrows and meta, and "POURING WAKA…" is what
          happens when a sentence is put through it. */}
      {/* NAMING AN AGENT. One field, because that is all a profile needs to
          exist — what it becomes is written by the agent itself, working. */}
      {agentName !== null ? (
        <div className="jar-seek" data-jar-chrome="1">
          <input
            className="jar-roomform-box"
            autoFocus
            value={agentName}
            placeholder="What do you call it?"
            onChange={(e) => setAgentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") makeAgent();
              if (e.key === "Escape") setAgentName(null);
            }}
          />
          <p className="jar-neb-ask">
            <button type="button" onClick={makeAgent}>
              give it a wall
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setAgentName(null)}>
              not now
            </button>
          </p>
          <p className="jar-share-note">
            It writes here once it signs in as itself. Until then the wall is empty,
            and says so.
          </p>
        </div>
      ) : null}

      {/* ================= THE AXIS, ALONG THE BOTTOM EDGE =================
          You could travel sideways forever and never know how far the world
          went or what was in it — you found out by walking. Losing your sense
          of direction is the first named failure of a moving camera, and it
          is the one this world had.

          The bottom edge maps the HORIZONTAL axis, which is the only thing it
          should ever have mapped: one mark per wall, in axis order — agents
          out to the left, you at the origin, rooms to the right. Where you are
          is lit. Everything you could reach is visible without moving.

          It never re-lays-out. A new room appears at the right-hand end and
          every existing mark keeps its place, so the map you learned yesterday
          is still true today — the single most load-bearing property of the
          one knowledge surface this was modelled on.

          It is also the keyboard-and-pointer route to travel, which dragging
          alone never offered. */}
      <nav className="jar-axis" data-jar-chrome="1" aria-label="walls">
        {walls.map((w) => {
          const here = atWall.kind === w.kind && atWall.id === w.id;
          return (
            <button
              key={wallKey(w)}
              type="button"
              className={`jar-axis-mark${here ? " is-here" : ""} jar-axis-mark--${w.kind}`}
              aria-current={here ? "true" : undefined}
              onClick={() => simApiRef.current?.goToWall(w.col)}
            >
              <span className="jar-axis-name">{w.name}</span>
            </button>
          );
        })}
      </nav>

      {/* SEARCHING, AND IT IS ONE LINE. No results panel, no counts, no list —
          the answer is in the field, lit. Escape puts the field back. */}
      {seek !== null ? (
        <div className="jar-seek" data-jar-chrome="1">
          <input
            className="jar-roomform-box"
            autoFocus
            value={seek}
            placeholder="Which words do you remember?"
            onChange={(e) => setSeek(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSeek(null);
            }}
          />
          <p className="jar-neb-ask">
            {found && found.size === 0 && seek.trim().length > 1 ? (
              <span>nothing here says that</span>
            ) : (
              <button type="button" onClick={() => setSeek(null)}>
                done
              </button>
            )}
          </p>
        </div>
      ) : null}

      {/* MAKING OR JOINING A ROOM. A form, and it is honest about being one:
          typed text, a submit and an error line all need to reflow and be
          reachable by keyboard, and none of that survives being painted into
          the world. So it is DOM, it sits over the world rather than inside
          it, and the world holds perfectly still behind it. */}
      {roomForm ? (
        <div className="jar-roomform" data-jar-chrome="1">
          <div className="jar-roomform-tabs jar-label">
            <button
              type="button"
              className={roomForm.mode === "make" ? "is-on" : undefined}
              onClick={() => setRoomForm({ ...roomForm, mode: "make", error: null })}
            >
              Make a room
            </button>
            <button
              type="button"
              className={roomForm.mode === "join" ? "is-on" : undefined}
              onClick={() => setRoomForm({ ...roomForm, mode: "join", error: null })}
            >
              Join with a link
            </button>
          </div>
          <input
            className="jar-roomform-box"
            autoFocus
            value={roomForm.text}
            placeholder={roomForm.mode === "make" ? "What is it about?" : "Paste the link"}
            onChange={(e) => setRoomForm({ ...roomForm, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRoom();
              if (e.key === "Escape") setRoomForm(null);
            }}
          />
          {roomForm.error ? <p className="jar-roomform-err">{roomForm.error}</p> : null}
          <p className="jar-neb-ask">
            <button type="button" onClick={submitRoom} disabled={roomForm.busy}>
              {roomForm.busy ? "…" : roomForm.mode === "make" ? "make it" : "go in"}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setRoomForm(null)}>
              not now
            </button>
          </p>
          {groups.length > 0 ? (
            <div className="jar-share">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="jar-share-row"
                  onClick={() => copyInvite(g)}
                >
                  {g.name}
                  <span className="jar-share-hint">
                    {copied === g.id ? "link copied" : "copy invite"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* THE ROOM, OPENED. Who is in it, how to bring somebody, what you can
          put to them, and the way out — one surface, because they are all the
          same question: who is this with and what do we say together. */}
      {roomPanel && atWall.kind === "room" && atWall.id === roomPanel ? (
        <div className="jar-roomform" data-jar-chrome="1">
          <div className="jar-label" style={{ marginBottom: 14 }}>
            {atWall.name}
          </div>
          <div className="jar-share">
            {(members.get(roomPanel) ?? []).map((m) => (
              <span key={m.profileId} className="jar-share-row">
                {m.name}
                {m.role === "owner" ? <span className="jar-share-hint">made it</span> : null}
              </span>
            ))}
          </div>
          <p className="jar-neb-ask" style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => {
                const g = groups.find((x) => x.id === roomPanel);
                if (g) copyInvite(g);
              }}
            >
              {copied === roomPanel ? "link copied" : "copy the invite link"}
            </button>
          </p>

          {/* WHAT IS BEING ASKED OF THIS ROOM. Each one is somebody's sentence
              waiting on the rest of you — read it, say yes or say no, and the
              board moves when the room agrees rather than when you press. */}
          {(openProposals.get(roomPanel) ?? []).map((p) => (
            <div key={p.id} className="jar-proposal">
              <p className="jar-proposal-body">{p.body}</p>
              {/* THE WHOLE ROOM, NOT THE PART THAT AGREED.
                  This listed only the people who had affirmed, which reads as
                  a growing list with no end — you could not tell whether one
                  more was needed or three. A proposal carries on a MAJORITY,
                  so the useful thing is the room itself: everyone in it, those
                  who agreed at full strength and those who have not yet dimmed
                  beside them.

                  Still no tally. The count is legible because the PEOPLE are,
                  which is the only way this world is allowed to say a number —
                  and you can see at a glance whether the missing one is you. */}
              <p className="jar-proposal-who jar-label">
                {(members.get(roomPanel) ?? []).map((m, i) => {
                  const said = p.affirmations.some((a) => a.profileId === m.profileId);
                  return (
                    <span
                      key={m.profileId}
                      className={said ? "jar-said" : "jar-not-said"}
                      title={said ? "agreed" : "has not answered yet"}
                    >
                      {i > 0 ? " · " : ""}
                      {givenName(m.name)}
                    </span>
                  );
                })}
              </p>
              {p.viewerAffirmed ? (
                <p className="jar-neb-ask">
                  <span>you agreed</span>
                </p>
              ) : (
                <p className="jar-neb-ask">
                  <button type="button" onClick={() => answerProposal(roomPanel, p.id, true)}>
                    yes, that is us
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => answerProposal(roomPanel, p.id, false)}>
                    not us
                  </button>
                </p>
              )}
            </div>
          ))}

          {/* PUT SOMETHING TO THEM. A room's board is proposed to and
              affirmed, never edited — one member rewriting what a group
              believes would be editing other people's minds. */}
          {propose ? (
            <div className="jar-reflect" style={{ marginTop: 14 }}>
              <textarea
                className="jar-reflect-box"
                rows={3}
                autoFocus
                placeholder="What do you think this room believes?"
                value={propose.text}
                onChange={(e) => setPropose({ ...propose, text: e.target.value })}
              />
              <p className="jar-neb-ask">
                <button type="button" disabled={propose.busy} onClick={() => sendProposal(roomPanel)}>
                  {propose.busy ? "…" : "put it to them"}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => setPropose(null)}>
                  not now
                </button>
              </p>
            </div>
          ) : (
            <p className="jar-neb-ask">
              <button type="button" onClick={() => setPropose({ text: "", busy: false })}>
                put something to this room
              </button>
            </p>
          )}

          <p className="jar-neb-ask jar-neb-ask--after">
            {leaving === roomPanel ? (
              <>
                <button type="button" onClick={() => leaveRoom(roomPanel)}>
                  leave — your statements come down
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={() => setLeaving(null)}>
                  stay
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setLeaving(roomPanel)}>
                leave this room
              </button>
            )}
          </p>
          <p className="jar-neb-ask" style={{ marginTop: 10 }}>
            <button type="button" onClick={() => setRoomPanel(null)}>
              close
            </button>
          </p>
        </div>
      ) : null}

      {/* THIS SPACE'S SETTINGS.
          Opened by the space's own name, top left, and scoped to the space you
          are standing in — because everything in here is a fact about THIS
          space and nothing in here is a fact about the product. A room is the
          rich case; the other two kinds say what they are and point at the one
          screen that can actually change them.

          It is deliberately flat inside: labels, words and two-step
          confirmations. The world's register is for material — memories,
          statements, the poster — and administering a room is not material,
          it is paperwork. Paperwork gets to look like paperwork. */}
      {/* THE ACCOUNT, DROPPED. The mirror of the space settings on the left,
          and deliberately the same object: same panel, same flat register,
          anchored to the pill that opened it.

          What is IN it is only what belongs to the account rather than to a
          space — who you are signed in as, the way to the screen that can
          change it, and the way out. It does not reimplement the account
          screen: renaming a profile, language, sessions and deletion need
          focus traps and text that reflows at 200%, and that is what
          `/profile` is for. This is the door and the label on it. */}
      {accountOpen && phase === "ready" ? (
        <div
          className="jar-settings jar-settings--right"
          data-jar-chrome="1"
          role="dialog"
          aria-label="Your account"
        >
          <div className="jar-settings-head">
            <span className="jar-label">Signed in</span>
            <button type="button" className="jar-settings-x" onClick={() => setAccountOpen(false)}>
              close
            </button>
          </div>

          <p className="jar-settings-name">{auth?.profile?.name ?? "You"}</p>
          {auth?.account?.email ? (
            <p className="jar-settings-note">{auth.account.email}</p>
          ) : null}

          <p className="jar-neb-ask">
            <Link className="jar-settings-verb" to="/profile" onClick={() => setAccountOpen(false)}>
              open your account
            </Link>
          </p>

          {/* SIGNING OUT IS NOT DESTRUCTIVE, so it does not ask twice — nothing
              is lost and signing back in restores everything. It is last
              because it is the one thing here that ends the session. */}
          <p className="jar-neb-ask jar-neb-ask--after">
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                void auth?.logout();
              }}
            >
              sign out
            </button>
          </p>
        </div>
      ) : null}

      {settingsFor === wallKey(atWall) && phase === "ready" ? (
        <div className="jar-settings" data-jar-chrome="1" role="dialog" aria-label="Space settings">
          <div className="jar-settings-head">
            <span className="jar-label">
              {atWall.kind === "room" ? "This room" : atWall.kind === "agent" ? "This agent" : "You"}
            </span>
            <button type="button" className="jar-settings-x" onClick={() => setSettingsFor(null)}>
              close
            </button>
          </div>

          {atWall.kind === "room" ? (
            (() => {
              const gid = atWall.id;
              const roll = members.get(gid) ?? [];
              const mine = roll.find((m) => m.profileId === auth?.profile?.id);
              const iOwnIt = mine?.role === "owner";
              return (
                <>
                  {/* THE NAME. Owners can change it; everyone else reads it. */}
                  {renaming?.id === gid ? (
                    <form
                      className="jar-settings-rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameRoom(gid, renaming.text);
                      }}
                    >
                      <input
                        className="jar-roomform-box"
                        autoFocus
                        value={renaming.text}
                        onChange={(e) => setRenaming({ ...renaming, text: e.target.value })}
                      />
                      <p className="jar-neb-ask">
                        <button type="submit" disabled={renaming.busy}>
                          {renaming.busy ? "…" : "rename it"}
                        </button>
                        <span aria-hidden="true"> · </span>
                        <button type="button" onClick={() => setRenaming(null)}>
                          keep the old name
                        </button>
                      </p>
                    </form>
                  ) : (
                    <p className="jar-settings-name">
                      {groups.find((g) => g.id === gid)?.name ?? atWall.name}
                      {iOwnIt ? (
                        <button
                          type="button"
                          className="jar-settings-verb"
                          onClick={() =>
                            setRenaming({
                              id: gid,
                              text: groups.find((g) => g.id === gid)?.name ?? "",
                              busy: false,
                            })
                          }
                        >
                          rename
                        </button>
                      ) : null}
                    </p>
                  )}

                  {/* WHO IS HERE — the same people the field's hues stand for,
                      named, with the one verb an owner has over them. */}
                  <ul className="jar-settings-roll">
                    {roll.map((m) => (
                      <li key={m.profileId} className="jar-settings-member">
                        <span>{m.name}</span>
                        {m.role === "owner" ? (
                          <span className="jar-share-hint">made it</span>
                        ) : null}
                        {iOwnIt && m.profileId !== auth?.profile?.id ? (
                          removing === m.profileId ? (
                            <span className="jar-neb-ask">
                              <button type="button" onClick={() => removeMember(gid, m.profileId)}>
                                take them out
                              </button>
                              <span aria-hidden="true"> · </span>
                              <button type="button" onClick={() => setRemoving(null)}>
                                keep them
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="jar-settings-verb"
                              onClick={() => setRemoving(m.profileId)}
                            >
                              remove
                            </button>
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>

                  <p className="jar-neb-ask">
                    <button
                      type="button"
                      onClick={() => {
                        const g = groups.find((x) => x.id === gid);
                        if (g) copyInvite(g);
                      }}
                    >
                      {copied === gid ? "link copied" : "copy the invite link"}
                    </button>
                  </p>

                  {/* THE TWO WAYS OUT, and they are not the same act. Leaving
                      takes your statements down and leaves the room standing.
                      Closing it ends the room for everyone, and takes the top
                      of mind the room built together — which nobody else can
                      get back, so it says so. */}
                  <p className="jar-neb-ask jar-neb-ask--after">
                    {leaving === gid ? (
                      <>
                        <button type="button" onClick={() => leaveRoom(gid)}>
                          leave — your statements come down
                        </button>
                        <span aria-hidden="true"> · </span>
                        <button type="button" onClick={() => setLeaving(null)}>
                          stay
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setLeaving(gid)}>
                        leave this room
                      </button>
                    )}
                  </p>

                  {iOwnIt ? (
                    <p className="jar-neb-ask">
                      {closing === gid ? (
                        <>
                          <button
                            type="button"
                            className="jar-settings-danger"
                            onClick={() => closeRoom(gid)}
                          >
                            close it for everyone — what the room decided goes too
                          </button>
                          <span aria-hidden="true"> · </span>
                          <button type="button" onClick={() => setClosing(null)}>
                            keep it
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="jar-settings-verb"
                          onClick={() => setClosing(gid)}
                        >
                          close this room
                        </button>
                      )}
                    </p>
                  ) : null}
                </>
              );
            })()
          ) : (
            /* YOUR OWN SPACE AND AN AGENT'S both belong to the account, and
               everything you can change about them — your name, your language,
               your sessions, the agent's name, deleting either — is flat work
               with focus traps and plain confirmations that in-world UI cannot
               give. So this does not reimplement the account screen badly; it
               says what this space is and opens the door to it. */
            <>
              <p className="jar-settings-name">{atWall.name}</p>
              <p className="jar-settings-note">
                {atWall.kind === "agent"
                  ? "Its memory is its own — what it keeps here is not mixed into yours."
                  : "Everything you keep, and what WAKA has read out of it."}
              </p>
              <p className="jar-neb-ask">
                <Link className="jar-settings-verb" to="/profile">
                  open your account
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}

      {phase === "loading" ? <div className="jar-skel jar-skel-line">Pouring Waka…</div> : null}
      {phase === "failed" ? (
        <div className="jar-skel jar-skel-line">
          Waka could not be poured — reload to try again
          {failReason ? <span className="jar-skel-why">{failReason}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
