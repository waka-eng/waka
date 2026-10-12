/**
 * THE SIMULATION — one rAF loop, refs only, and the whole of the canvas side
 * of `SimApi`.
 *
 * This is the field, the sky, headquarters, the camera, the companion and the
 * axis of walls, as one loop over one 2D canvas. React calls in through
 * `SimApi`; the loop never reaches back into React except through the four
 * setters and the refs it is handed. `startSimulation` is what `pages/Home`
 * runs inside one `useEffect`, and the teardown it returns is that effect's
 * cleanup.
 *
 * ==========================================================================
 * WHY THIS IS A FILE AND NOT STILL AN EFFECT
 * ==========================================================================
 *
 * It was 5,637 lines inside `HomeExperience`, which is the single largest
 * thing in the product. `docs/reviews/code-quality-2026-10-11.md` finding 7
 * argued for taking exactly this one cut and leaving the rest of that file
 * alone, and the argument is not about size. It is about what the absence of a
 * module boundary DOES:
 *
 *   > There is no module boundary, so there is nowhere to put a value, so
 *   > values travel as mutable refs with no barrier. […] Two [speech races]
 *   > were "fixed" and a third was found by a reviewer afterwards because
 *   > nothing in the file can tell you how many writers a piece of state has.
 *   > […] In a module with an export list that question is answered by reading
 *   > the export list.
 *
 * As an effect, this code captured 49 bindings from the component's scope
 * against a four-entry dependency array. Two of those 49 have their staleness
 * argued, at length and well, at the bottom of the effect (`citations` and
 * `signals`, reached through `skyRef`). The other 47 were silent, and a reader
 * could not tell a reasoned exclusion from an oversight. Every one of them is
 * now a named member of `SimulationOptions` carrying a claim about whether it
 * may be stale — which is the entire point of the move. Nothing else changed.
 *
 * WHAT MADE THIS SEAM AND NOT ANOTHER. Three things were already true before
 * the file existed:
 *
 *   1. The interface was already written and published. `SimApi` below is
 *      unchanged; it moved here because it is this module's export list.
 *   2. Nothing outside reached past it. Of 38 `simApiRef` references, 34 were
 *      outside the effect and 4 inside. The boundary was observed; it was just
 *      not enforced by anything.
 *   3. `canvas/measured.ts` had already drawn the other half of the same
 *      boundary for the DOM, and says so in its own header: "`docs/
 *      architecture.md` names `SimApi` as the boundary between React and the
 *      canvas". `Measured` exists to be one prop for this loop. It is now one
 *      field of one options object, which is what it was built to be.
 *
 * WHY `canvas/`, AND WHY NOT THE TWO NAMES THAT WERE CONSIDERED FIRST.
 *
 *   - `world/simulation.ts` was the review's first suggestion and cannot be
 *     used: `scripts/check-vocabulary.mjs` forbids `world` in an identifier
 *     outright — "the owner rejected the noun outright: what a person lands on
 *     is Home".
 *   - `field/simulation.ts` was the second, and `field` is a sanctioned world
 *     word — but in this tree "field" already means LAYER 1 specifically
 *     (`space/inspiration/field.ts`, `fitField`, `paintField`, `FIELD_EDGE`).
 *     A top-level `field/` holding the camera, the sky and the companion would
 *     put two meanings under one word, which is the debt the vocabulary gate
 *     exists to stop.
 *   - `space/` is split by LAYER and `space-kinds/` by KIND — `space/README.md`
 *     states that rule. This loop is neither a layer nor a kind; it draws all
 *     three layers on all three kinds of wall.
 *
 * `canvas/` already holds exactly the things this loop consumes and nothing
 * else: `sprites.ts` and `palette.ts` bake for it, `scale.ts` sizes for it,
 * `measured.ts` is the DOM channel it writes through. So `canvas/` now means
 * one thing — everything on the canvas side of `SimApi` — and this is the side
 * itself.
 *
 * The export is `startSimulation`, not the review's `startField`, for the same
 * reason the directory is not `field/`: `SimApi` and `window.wakaSim` are the
 * names this thing already answers to, and it starts considerably more than
 * layer 1. `FieldAudit` keeps its name because it is a published console shape
 * (`window.wakaField`) and renaming it would break a habit for no gain.
 *
 * WHAT IS NOT HERE, DELIBERATELY. The speech machinery stayed in
 * `pages/Home.tsx` — `charSay`, `speechEpoch`, the write seal, `tell()`. It is
 * tangled with the wall effect and with three races that were being repaired
 * while this cut was made, and the review's own instruction was to leave it:
 * "pulling it out while three races are being fixed in it is how a fourth one
 * arrives." The loop reaches the speech it needs through two refs —
 * `creatureSpeaksRef` to ask for a sentence and `sayLineRef` to publish its own
 * fallback line — and those two are now declared members here, which is more
 * than could be said for them before.
 */

import type { MutableRefObject, RefObject } from "react";

import { bakeBeing, buildPalette, MACHINE_CELLS, type BeingSprites, type Palette } from "./palette";
import { renderScale } from "./scale";
import { VIGNETTE, mix, rgbCss } from "./sprites";
import type { Measured } from "./measured";
import { BODY_TIERS, EYE_INK, EYE_LON, EYE_R, FACE_R, NUB_DIM, NUB_LIT, NUB_LON, NUB_R_DIM, NUB_R_LIT, NUB_X, NUB_Y, bodyPath } from "../character/raster";
import { agentBeing, OWNER_BEING, unit, type Being } from "../character/body";
import { hasDial, hasSky, spaceKey, type Space } from "../space-kinds";
import type { GroupData } from "../space-kinds/group";
import { groupCompanyPlaces, noticeLight, NOTICE_MS, type CompanyPlace } from "../space/group-company";
import { paintField } from "../space/inspiration/field-paint";
import {
  colorBall,
  fitField,
  scatterX,
  sortByDepth,
  EASE_DIM_IN,
  EASE_DIM_OUT,
  EASE_GLOW_IN,
  EASE_GLOW_OUT,
} from "../space/inspiration/field";
import {
  bornBall,
  makeAgentBall,
  makeBall,
  makeGroupInspirationBall,
  seedOf,
  type Ball,
  type BornSeed,
} from "../space/inspiration/orb";
import type { Provenance } from "../space/top-of-mind/board";
import { homeActivityLayout } from "../lib/home-activity-layout";
import { clamp, clamp01, DAY_MS, easeOut, hashStr, kd, lerp, mix32, TAU } from "../lib/num";
import { isEditableTarget, isNativeSurface } from "../lib/surface-input";
import { formatMessage, t, type MessageKey, type SupportedLocale } from "../lib/locales";
import { monthTag } from "../lib/words";
import type { AgentBundle } from "../lib/agent-contract";
import type { Evidence, Inspiration, Signal } from "../lib/data";
import type {
  ApiGroupFieldInspiration,
  ApiGroupMember,
  ApiGroupSummary,
} from "../lib/api";
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
/* The room the composer keeps at the bottom of the screen. A CONSTANT on
   purpose — see the note where it is used: the companion must not move when
   the composer grows a drawer or a question, so this is the reserve, not a
   measurement. Raised from 52 when the composer gained a footer and a primary
   action: 52 was the height of a single-line box that no longer exists, and a
   reserve smaller than the thing it reserves for is the companion sitting on
   its own input. */
const MOUTH_H = 128;

/** How far below the fold the field begins. See `fieldTop`. */
const FIELD_CLEARANCE = 24;
/** The least the topmost orb is ever left clear of the top edge. */
const FIELD_EDGE = 6;
/**
 * The smallest the companion is ever drawn. It shrinks before anything else in
 * headquarters gives way, but below this its two eyes stop resolving and it
 * reads as one more orb rather than as the thing that is looking at you — so
 * this is where the shrinking stops and a genuinely too-short section is
 * allowed to be too short.
 */
/**
 * WHAT YOUR OWN WALL IS CALLED.
 *
 * "Waka" was the product's name standing where a person's own name belongs, so
 * a new account's first column read as the brand rather than as themselves —
 * every other column on the axis is a name (an agent's, a room's), and this one
 * was the odd one out. "Me" is the only label on the axis that is true no
 * matter whose account it is, and it reads correctly next to rooms that are
 * already named from the person's side ("Just me", "Me and my agent").
 *
 * One constant, because it was three copies before this and the axis, the
 * camera's resting wall and the eyebrow each had their own.
 */
export const SELF_WALL_NAME = "Me";

/**
 * THE CHARACTER'S SIZE, EVERYWHERE AND ALWAYS.
 *
 * Ruled by the founder on 2026-08-28: "character shouldnt be responsive to
 * screensize. it should always be consistent size."
 *
 * 120 is what the old `view.h * 0.14` gave on a 857px-tall screen, which is
 * both the middle of the range it used to move through (84..150) and very
 * close to what a phone was already showing — so this is the size the
 * character mostly WAS, made into the size it always is.
 *
 * `CHAR_MIN` stood here: the floor the body shrank to when headquarters ran
 * out of room. Nothing shrinks now, so there is no floor to name.
 */
const CHAR_SIZE = 120;
/**
 * THE TWO CONSTANTS THAT REPLACED TWO MEASUREMENTS.
 *
 * `companion.y` used to read the live heights of the poster and the claim,
 * which is why the creature drifted with content and why two blank reserves
 * had to be installed to stop it. These are the fixed bands those blocks live
 * in instead. A constant can be wrong by a few pixels; a measurement is wrong
 * by whatever the person happened to write.
 *
 * `POSTER_SLOT` is the band's WHOLE height, top padding included — the
 * padding is what clears the switcher, so counting the bar again on top of it
 * would push the creature down by 56px of nothing. Inside it: three lines of
 * `--t-reading` at its desktop ceiling (30px x 1.25 x 3 = 113), the
 * provenance band, and the row of verbs.
 *
 * The statement is anchored to the FOOT of that band in `home.css`, so a
 * longer one grows upward into its own air rather than downward into the
 * creature, and a shorter one leaves the gap above itself, where air against
 * the top edge reads as margin rather than as a hole.
 */
const POSTER_SLOT = 300;
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
/**
 * A flick faster than this always commits to the next section. Lowered from
 * 500 once the snap started INHERITING the flick's speed: at 500 a genuine
 * throw was being read as a nudge and then re-timed from scratch.
 */
const FLICK = 380;
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
 * EVERY CONTINUOUS EASE THE LOOP STILL OWNS, AS A RATE. Each is the fraction of
 * the distance still remaining one second later, fed to kd() with the frame's
 * own dt — so all of these mean the same thing on a 60Hz Android and a 120Hz
 * iPhone. They were per-frame constants (0.14, 0.16, 0.2) and therefore meant
 * two different things on the two devices sitting side by side.
 *
 * This was twelve. The five that govern LIGHT — the glow, the haze and the
 * focus fade — moved to `space/inspiration/field.ts` when the sky engine left
 * this file: a satellite in the sky IS an orb from the field, shown as
 * evidence, so the two have to ease on ONE curve rather than on two modules'
 * copies of the same five numbers. What is left is a camera and a character,
 * and nothing outside this loop reads them.
 */
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
/** The companion's turn, with a travel. */
const EASE_YAW_TRAVEL = 2.6e-5;
/** A scrubbed-away bubble fades out in place over this long. It never flies. */
const FADE_MS = 260;
/** A reflected-on memory climbs back to its new aliveness over this long. */
const RELIGHT_MS = 900;
/* THE COMPANION NO LONGER TURNS WITH TIME. It turned twice about its own
   axis across the whole rail, following the position of a finger — a motion
   that can only exist while a hand is dragging something. The dial is a list
   of dates now: a press lands on ONE moment instead of sweeping through a
   thousand, so there is no position to follow and nothing left for the spin
   to explain. The travel turn stays, because that one answers a journey the
   person is watching happen. */
/** A travel's turn eases back to front-facing, the short way round. */
export const UNWIND_MS = 650;
/**
 * THE GATHER BEFORE A REACTION.
 *
 * Every moment in this world was a reaction with no wind-up: the thing
 * happened and the creature was already at full flare on the next frame. That
 * is the one shape a living thing never makes. Anticipation is the first of
 * the three terms carrying Luxo Jr. — a lamp with no eyes and no hue — and it
 * is the cheapest of them here, because it spends time rather than light.
 *
 * It is the creature's own wind-up, not a prediction of yours. The memory is
 * already born and falling; what these numbers stage is the beat between
 * seeing it and answering, which is why nothing about the keep is delayed to
 * pay for them.
 */
const ANTICIPATE_MS = 130;
/** How far it compresses at the bottom of the gather. Squash, so positive. */
const ANTICIPATE_SQ = 0.03;
/** And how long the body takes to come back up out of it, once released. */
const ANTICIPATE_EASE = 4.6e-4;
/**
 * MOOD — A DISPOSITION, WHERE `flare` IS AN EVENT.
 *
 * `flare` decays in 0.7s and carries nothing to the next thing that happens,
 * so the creature that greets your next act has not been changed by your last
 * one. Loyall lists CHANGE as a requirement for a believable agent in its own
 * right, and Anki's emotion engine is the production version: a state
 * underneath, moving continuously, so the same stimulus twice does not produce
 * the same response twice. This is that requirement at the smallest scale it
 * can be had.
 *
 * THE LAW THIS ARGUES WITH, SAID PLAINLY. Mood spending LIGHT is not on the
 * table: it would break invariant 4 outright — two beings at the same aliveness
 * would stop being the same colour, and temperature would mean two things at
 * once. So it spends RHYTHM, and that brushes against "light is the only
 * meaning channel".
 *
 * The case for it: that law's real work is preventing a LEGEND — a key you
 * have to learn before the screen means anything, which is what hue-per-
 * category always becomes. A creature that blinks slower and moves smaller
 * after you let something go needs no legend; it is read the way a tired
 * person is read, without decoding. And rhythm is not a virgin channel —
 * `bobRate` and `blinkMs` are already identity — so the honest cost is that it
 * now carries TWO things, not that it starts carrying one.
 *
 * The one thing rhythm cannot do is survive reduced motion, where it is silent
 * by design. There mood simply does not exist rather than falling back to
 * light, because falling back to light is the version that breaks invariant 4.
 */
const MOOD_HALF_LIFE_MS = 90000;
/** What each moment does to the disposition. `touch` is deliberately absent:
    being tapped is not an experience. */
const MOOD_OF: Partial<Record<Moment, number>> = {
  kept: 0.5,
  answered: 0.4,
  shared: 0.3,
  arrived: 0.1,
  "let-go": -0.35,
};
/** How far mood may bend each rhythm. Small on purpose: this is a disposition
    read at a glance, not a readout, and a legible one would be a legend. */
const MOOD_BOB = 1;
/**
 * AND THE BREATH NEVER STOPS.
 *
 * At full gain a mood of -1 multiplies the bob's amplitude by zero, and
 * measuring it is the only reason that was caught: 0.0px of travel, a
 * companion holding perfectly still. The settle already refuses this a few
 * lines down — "never below a fifth — still breathing, never frozen" —
 * because a creature that stops moving does not read as low, it reads as
 * crashed. Low mood is quieter, never absent.
 */
const MOOD_BOB_FLOOR = 0.4;
/**
 * AND THE RATE, WHICH IS THE ONE READ AT A GLANCE.
 *
 * Amplitude alone was not enough and the arithmetic says why: the bob is a
 * squash of 0.022, so on a 140px body it is ±3px, and a quarter of three
 * pixels is nothing. Restraint that lands below perception is not restraint,
 * it is an effect that does not exist.
 *
 * SPEED is the channel a person reads instantly — sluggish against lively is
 * legible in a second, long before an amplitude difference is. It is also the
 * honest one for a disposition: what changes when someone is flat is not how
 * far they move, it is how readily.
 */
const MOOD_RATE = 0.45;
const MOOD_BLINK = 0.4;
const MOOD_GLANCE = 0.45;
/**
 * HOW LONG THE COMPANION TAKES TO BECOME THE ONE WHOSE WALL THIS IS.
 *
 * Shorter than UNWIND_MS on purpose: the change starts on the arrival beat
 * and is finished before the creature has turned back to face you, so what
 * you witness is a companion that turned away as one and came back as the
 * other. A dissolve longer than the turn would still be resolving after it
 * is looking at you, which is the double-exposure this exists to avoid.
 */
const FORM_FADE_MS = 320;
/**
 * The turn is a PLANET, not a card: the silhouette never changes, and it is
 * the features that travel across it. An eye sits on the equator at this
 * longitude; the pair are ~1 radian apart, which is what puts them where they
 * have always sat when the companion is facing you.
 */
/* `EYE_LON` AND `FACE_R` MOVED TO `character/raster.ts`, with the rest of
   the creature's anatomy, when a page started drawing the creature too. The
   loop still owns its BEHAVIOUR — yaw, pitch, blink, gaze, the cell grid —
   and imports the numbers those behaviours are applied to. See the block at
   the top of that file; `rest-pose.test.ts` fails if a copy grows back. */
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
interface Layout {
  wallL: number;
  wallR: number;
  layoutH: number;
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
function computeLayout(vw: number, vh: number, dialH: number): Layout {
  const interior = Math.min(vw - 24, 560);
  const wallL = (vw - interior) / 2;
  const wallR = vw - wallL;
  const layoutH = vh * 2;
  return {
    wallL,
    wallR,
    layoutH,
    maxCam: vh,
    /* THE PLACE ABOVE HEADQUARTERS COMES BACK, FOR SOMETHING ELSE.
       It held the signals still forming, as clouds of light, and that was
       removed — signals are the machine's working material, not a place a
       person stands in. What goes there now is the OTHER half of a mind
       (founder, 2026-08-25): "top of mind = current. philosophies and values
       = timeless." The wall says what you are holding today; above it is what
       you keep coming back to whatever the day is. It takes a long time to
       form, so for now the room exists and says so — which is the honest
       shape, and the reason it is a PLACE rather than a promise in a tooltip:
       a person can go up and see that it is empty, and why. */
    minCam: -vh,
    /* The peek line sits clear of the time dial, which is fixed to the
       bottom of the viewport in both sections — otherwise the topmost orbs
       and the dial occupy the same strip. */
    /* NO PEEK (founder ruling: no scrolling down, and no dots along the
       bottom). The field used to start `PEEK` pixels above the fold so a strip
       of memories showed under the home screen — an invitation to scroll down,
       back when scrolling down was how you reached them. The archive is a page
       now, so the ground begins exactly at the bottom edge: nothing of it is in
       frame at rest, and all of it is there the moment the camera goes down.
       Done here rather than by skipping the paint, because a field that stops
       drawing while the camera is easing cannot tell "not here" from "not yet"
       — which is flaky in exactly the way its own suite then reports.

       `vh` exactly, not `vh - dialH`: the dial's strip is chrome drawn OVER
       the bottom of the viewport, so reserving it still left the topmost orbs
       inside the frame. The ground begins where the screen ends. */
    /**
     * THE FIELD STARTS BELOW THE FOLD, AND CLEARS IT.
     *
     * `vh` put the field's top edge exactly ON the bottom of the viewport,
     * which is only clear if nothing ever moves — and every orb carries a
     * slow sine drift on both axes, so the top row bobbed in and out of the
     * bottom of the screen. Founder: "the bottom of the page still has the
     * old floating circles, I can see it float up and down once in a while."
     *
     * The peek row places itself at `top + r + ampY`, so the arithmetic
     * already intends the topmost pixel at full upward drift to land on
     * `top`. Landing ON the line is the bug: a boundary that is exactly
     * touched is a boundary that sub-pixel rounding crosses. The clearance
     * is the margin that makes "below the fold" true rather than marginal.
     */
    fieldTop: vh + FIELD_CLEARANCE,
    /* AND THE FIELD ENDS EXACTLY WHERE THE DIAL BEGINS — not forty pixels of
       air above it. The reserve is a real, measured piece of chrome, so it is
       the only thing the field owes the bottom of the screen. */
    fieldBottom: layoutH - dialH,
  };
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
 * The kinds of moment the companion can tell apart. Named rather than
 * numbered so a call site reads as what happened, not as an intensity.
 */
type Moment = "touch" | "kept" | "answered" | "arrived" | "shared" | "let-go";

export interface SimApi {
  navigationState: () => { wall: Space; section: 'top' | 'field' | 'sky'; moving: boolean };
  /**
   * Whose ground to stand in on a group's wall — a member's profile id, or
   * null for your own. Yours is the default everywhere and the only ground on
   * a wall that has one owner.
   */
  standIn: (ownerProfileId: string | null) => void;
  /** Wind this wall to a moment. The dial's dates are the only callers. */
  windTo: (T: number) => void;
  select: (id: string) => void;
  release: () => void;
  wake: () => void;
  /**
   * Re-hang the timeline under the word it belongs to. Called when the READING
   * changes — the dates hang from the word's left edge, and the word is
   * rewritten by pressing a date, which no resize follows.
   */
  hangRail: () => void;
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
  toGround: () => void;
  /** The traveler: one column left or right, the companion leading. */
  travel: (dir: 1 | -1) => void;
  /** Walk to a wall by column, from the axis map along the bottom. */
  /**
   * TRAVEL TO A WALL — or, with `instant`, BE THERE WITHOUT TRAVELLING.
   *
   * Founder: "I kind of want to give the feeling of like rather than my agent
   * like moving rooms it kind of like switching itself up to its agent form.
   * Do you get what I mean?" And, three separate times: "the agent the
   * character shouldn't move left It should move right."
   *
   * Those are one request, and `instant` is the answer to both. The second
   * sentence was read literally for a long time — put the agent on the other
   * side of the axis — and the axis is the wrong place to fix it: agents sit
   * at negative columns, rooms at positive, and swapping them moves rooms
   * for a reason that has nothing to do with rooms. Measured, it costs
   * twenty-four room-suite failures and a harness that silently assumed
   * which side rooms live on.
   *
   * But the direction only matters BECAUSE there is a glide to have a
   * direction. The founder's own words say the creature should change rather
   * than travel — and the canvas already believed that: the change of form is
   * a dissolve, and the aura is deliberately never pixelated because "its
   * colour temperature is one of the two invariants that say this is still
   * the same companion." The navigation was the only thing still insisting
   * these were two PLACES.
   *
   * So the form switch arrives without a crossing. Nothing slides left,
   * nothing slides right, and one account with two profiles reads as one
   * companion with two faces — which is what it is.
   */
  goToWall: (col: number, instant?: boolean) => void;
  /* `revealMemory` LIVED HERE and is gone. It flew the camera from a statement
     down to the memory it was read from — the only navigation in the world
     caused by reading rather than by moving, and the founder ruled it out
     outright (2026-08-25: "never move from sky to ground"). Provenance is
     answered without moving now: `.jar-prov-room` puts the grounds and the
     whole memory on screen over the world you are standing in. */
  /** A saved answer was added or taken back; every view of its orb agrees. */
  reflectionChanged: (inspirationId: string, delta: number) => void;
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
  /** The inspirations the ambition was built from — the peek row is made of these. */
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

export interface FieldAudit {
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
  /** which wall the LOOP thinks it is standing on — not what React thinks */
  wallKind: string;
  wallId: string;
  /** whose ground, null being the viewer's own */
  ground: string | null;
  /**
   * How many memories this wall's claim is standing on.
   *
   * Here because its absence let a real bug ship: the provenance map was
   * written under a hand-built key that no reader ever asked for, so every
   * group's peek row was empty and 64 tests stayed green. A count is the
   * smallest thing that would have gone to zero.
   */
  provenanceCount: number;
  /** Painted group-avatar hit areas in screen coordinates, for interaction QA. */
  company: Array<{ id: string; x: number; y: number; r: number }>;
  /** which column the loop is standing on, and whether it is mid-glide */
  col: number;
  travelling: boolean;
  /** the columns travel is allowed to reach, and the axis the loop can see */
  lastGo: string;
  colLo: number;
  colHi: number;
  wallCount: number;
  /** how many balls each owner contributes to this wall, before the ground filter */
  owners: Record<string, number>;
  /** and whether the ones that survived the filter can actually be seen */
  drawn: {
    active: number;
    rMin: number;
    rMax: number;
    aliveMax: number;
    arriveMin: number;
    /**
     * HOW MANY ORBS ARE SUNK, AND HOW MANY ARE LIT.
     *
     * The audit could see everything about a memory except the one channel
     * that carries meaning. Two things drive that channel — a search, and
     * (since 2026-08-24) reading a pattern, which lights the memories it was
     * read from where they live instead of setting them orbiting. Both say
     * the same sentence to the field, "this one and everything else sinks",
     * and neither was observable from outside: a light that never moved and
     * a light that moved correctly looked identical to every test here.
     */
    dimmed: number;
    glowing: number;
  };
  /**
   * WHETHER THE SKY IS LEANING DOWN, AND HOW FAR EACH STATEMENT CAME.
   *
   * Here for the same reason `provenanceCount` is: this is a promise nothing
   * else can see fail. The elected statements ease toward the top edge from
   * off-screen homes, so a peek that is elected but never applied, or applied
   * to a part of the cloud sprite that has no light left in it, looks
   * IDENTICAL to a peek that was never built — an empty top edge either way.
   * That is exactly how the first attempt at it spent a day looking broken
   * while working: `peekY` was correct and the clouds were reaching it, and
   * the band it put them in was invisible.
   *
   * `lean` is the camera's own scalar, 1 at headquarters and 0 up in the sky.
   * A statement with `peekY === homeY` was not elected and never moves.
   */
  sky: {
    lean: number;
    minCam: number;
  };
}

/* ==========================================================================
   THE SEAM: THREE SHAPES THAT USED TO BE WRITTEN TWICE OR NOT AT ALL
   ========================================================================== */

/**
 * WHAT A REBUILD OF THE LOOP HANDS TO THE NEXT ONE.
 *
 * `pages/Home` owns the ref; this is the shape that travels in it, named here
 * because both ends now have to agree about it in writing. It used to be an
 * inline type literal on one `useRef` and a hand-built object literal in the
 * teardown — two spellings of one contract, which is the thing this codebase
 * stops wherever it finds it.
 *
 * `cam`, `trip` and `companion` are `unknown` on purpose, exactly as they were:
 * they are the loop's private per-frame objects, and the carry copies them
 * field-for-field with `Object.assign` rather than claiming to know their
 * shape. Widening them to real types would publish three structures that
 * nothing outside this file should be able to name.
 */
export interface Carry {
  cam: unknown;
  trip: unknown;
  companion: unknown;
  /** the world has been sized, so a rebuild must not re-stage it */
  primed: boolean;
  /** where every memory had drifted to, by id */
  balls: Map<string, { x: number; y: number }>;
}

/** One room's fetched board, as `pages/Home`'s cache holds it. */
export interface GroupCacheEntry {
  status: "pending" | "ready" | "failed";
  data: GroupData | null;
  checkedAt?: number;
  fieldFingerprint?: string;
  leaseToken?: symbol;
}

/**
 * THE SKY, AS THE POUR READS IT — and the one capture in here whose staleness
 * was already argued before this file existed. See the note at the foot of
 * `startSimulation`: `citations` and `signals` are deliberately NOT rebuild
 * triggers, and this ref is how the pour sees what is true at the moment it
 * pours instead of closing over a value that moves underneath it.
 */
export interface PouredSky {
  citations: Map<string, Evidence[]>;
  signals: Map<string, Signal>;
  posterSignalIds: ReadonlySet<string>;
  principleSignalIds: ReadonlySet<string>;
}

/**
 * ==========================================================================
 * EVERY INPUT THE LOOP READS, AND WHETHER IT MAY BE STALE
 * ==========================================================================
 *
 * These 49 members were implicit captures of `HomeExperience`'s scope. The
 * rule that decided the form each one takes here is the one the review asked
 * for and it has no exceptions:
 *
 *   A VALUE is a snapshot. It is frozen for the life of one run of the loop,
 *   and the only thing that can refresh it is a rebuild — which means it MUST
 *   appear in the effect's dependency array in `pages/Home`, or it is a stale
 *   capture by construction. There are three, and all three are in that array.
 *
 *   A REF is live. `.current` is read in the frame that uses it, so the loop
 *   sees what is true now rather than what was true when it was built. 41 of
 *   the 49 are refs, which is why this effect could stand a four-entry
 *   dependency array at all.
 *
 *   A SETTER is stable. React guarantees the identity, so there is nothing to
 *   go stale. Four of them, and they are the loop's only way to say a discrete
 *   fact back to React.
 *
 * The counts below ("read 6x", "written 2x") are of the loop's own uses and
 * are there so that the next person asking the question the review could not
 * answer — how many writers does this piece of state have — can answer it from
 * this list instead of grepping. Where I could not establish a fact by reading
 * the code, the comment says so rather than guessing.
 */
export interface SimulationOptions {
  /* ---- the DOM, and the three snapshots the rebuild exists for ---------- */

  /**
   * Every element the canvas side dereferences, as one object of refs. Stable
   * for the component's life — `useMeasured()` builds it once — and every
   * member is itself a ref, which is the whole point of that file: see its
   * header for why collecting the ELEMENTS instead would be silently wrong.
   */
  measured: Measured;
  /**
   * THE GUARD, NOT THE GROUND. A snapshot, and `pourSig` in the dependency
   * array is what rebuilds for it.
   *
   * The loop reads this exactly once, to refuse to build a world with nothing
   * in it (`if (… || !inspirations || !agents) return undefined`). The memories
   * it actually pours come from `inspirationsRef` a few lines later, which is
   * NOT the same list: the ref is live, and the pour needs the live one so that
   * a memory kept a moment ago is in the ground it builds. That difference was
   * invisible while both were captures of the same scope; it is the reason both
   * are in this list.
   */
  inspirations: Inspiration[] | null;
  /**
   * The agent walls, whole. A snapshot, in the dependency array by name, and
   * the loop's second build guard. Its live twin is `agentsRef`.
   */
  agents: AgentBundle[] | null;
  /**
   * The axis: which walls exist and at which columns. A snapshot, in the
   * dependency array by name. Its live twin is `wallsRef`, which is what the
   * loop reads 9 times while running — this value is read at setup only.
   */
  walls: Space[];

  /* ---- the four discrete facts the loop pushes back into React ---------- */

  /** The camera came to rest over a wall with no dial. Called from the frame. */
  setDialAway: (away: boolean) => void;
  /** The camera is standing in the ground. Called from the frame. */
  setInField: (inField: boolean) => void;
  /** …and in the sky. Called from the frame. */
  setInSky: (inSky: boolean) => void;
  /**
   * An orb was pressed, or released. NOTE, because it is a hazard and not a
   * tidy fact: the loop ALSO writes `selectedIdRef.current` directly at both
   * of those moments, so the selection has two writers inside this module and
   * a third in `pages/Home`. That is how it worked before the move and it is
   * left exactly so; it is written down here because the review's whole
   * complaint was that this question had no answer anywhere.
   */
  setSelectedId: (id: string | null) => void;

  /* ---- live, read-only: what the loop asks about the world each frame --- */

  /** The agent walls, live. Read 2x. `agents` is the snapshot twin. */
  agentsRef: MutableRefObject<AgentBundle[]>;
  /** A page or sheet is mounted over the world, so the companion stands aside. Read 1x. */
  asideRef: MutableRefObject<boolean>;
  /** Which wall React thinks we are on. Read 2x. The loop has its own opinion and pushes it with `pushArrivedRef`. */
  atWallRef: MutableRefObject<Space>;
  /** Memories born at the mouth this session, so a rebuild can re-pour them. Read 1x, at setup. */
  bornRef: MutableRefObject<BornSeed[]>;
  /** The dial element, measured for its real height — a phone's safe-area inset makes `DIAL_H` wrong. Read 1x. */
  dialRef: RefObject<HTMLDivElement>;
  /** The archive walk is still arriving, so the ground is not yet the whole ground. Read 1x. */
  fieldLoadingRef: MutableRefObject<boolean>;
  /** The memories a search matched; everything else sinks. Read 1x per frame. */
  foundRef: MutableRefObject<ReadonlySet<string> | null>;
  /** One room's fetched ground, by group id. Read 2x. */
  groupFieldRef: MutableRefObject<Map<string, ApiGroupFieldInspiration[]>>;
  /** One room's fetched board and its lease. Read 1x. The loop never writes it; `loadGroupRef` is how it asks for one. */
  groupCacheRef: MutableRefObject<Map<string, GroupCacheEntry>>;
  /** The rooms this account is in, in axis order. Read 4x. */
  groupsRef: MutableRefObject<ApiGroupSummary[]>;
  /** A room's current members, for the company avatars and the ground filter. Read 2x. */
  membersRef: MutableRefObject<Map<string, ApiGroupMember[]>>;
  /** The whole archive, live — this is what the pour is actually built from. Read 1x, at setup. See `inspirations`. */
  inspirationsRef: MutableRefObject<Inspiration[] | null>;
  /** Which language the loop's own sentences are in. Read 3x. */
  localeRef: MutableRefObject<SupportedLocale>;
  /** A reading panel is occluding part of the field right now. Read 1x. */
  panelOpenRef: MutableRefObject<boolean>;
  /** Where in time the wall is parked, or null for now. Read 1x. */
  parkedRef: MutableRefObject<number | null>;
  /** The memories under the pattern being read, lit where they live. Read 1x per frame. */
  readingLitRef: MutableRefObject<ReadonlySet<string> | null>;
  /**
   * The sky, as of the frame that asks. Read 1x, at setup, into `pouredSky`.
   * This is the one capture whose staleness the file already argued — see the
   * note at the foot of `startSimulation`.
   */
  skyRef: MutableRefObject<PouredSky>;
  /** Whose eyes: the viewer's own profile id, or null when offline. Read 6x. */
  viewerIdRef: MutableRefObject<string | null>;
  /** The axis, live. Read 9x. `walls` is the snapshot twin. */
  wallsRef: MutableRefObject<Space[]>;

  /* ---- live, read-only: nine things the loop ASKS SOMEBODY ELSE to do --- */
  /* Each is a `useCallback` mirrored into a ref because the loop is built once
     and must call the CURRENT one. The signature here is what the loop
     actually calls, not necessarily everything the callback can do — which is
     the narrowing the review asked for: a declared surface somebody can argue
     with. */

  /** Say the next thing out loud. Called when the companion is pressed. */
  creatureSpeaksRef: MutableRefObject<() => void>;
  /** Warm one memory's full reading so a tap has nothing to wait for. */
  loadDetailRef: MutableRefObject<(id: string) => Promise<unknown>>;
  /** Fetch a room's board and ground. Called as travel toward it begins. */
  loadGroupRef: MutableRefObject<(groupId: string) => unknown>;
  /** Warm whatever kind of wall this is. Called as travel toward it begins. */
  loadWallRef: MutableRefObject<(wall: Space) => void>;
  /** Open one member's ground on a room's wall, from a pressed avatar. */
  openGroupMemberRef: MutableRefObject<(profileId: string | null) => void>;
  /** Open the search. Called from the loop's own keyboard handler. */
  openSeekRef: MutableRefObject<() => void>;
  /** Offer an arrow key to the open reading panel first; true if it took it. */
  panelArrowRef: MutableRefObject<(dir: -1 | 1) => boolean>;
  /** The camera came to rest on a wall — the loop's opinion, pushed to React. */
  pushArrivedRef: MutableRefObject<(wall: Space) => void>;
  /** A room's words exist now. Pushed once, the first time its orbs pour. */
  pushWokenRef: MutableRefObject<(groupId: string) => void>;

  /* ---- live, WRITTEN BY THE LOOP: its outputs, and its memory ----------- */
  /* These are the answer to "how many writers does this have". Inside this
     module the count is exact and stated; what `pages/Home` does with the same
     ref is one grep away now, which it was not before. */

  /** Every orb, and the index into it. Written 2x (the pour, and the teardown's null). */
  ballsRef: MutableRefObject<{ list: Ball[]; byId: Map<string, Ball> } | null>;
  /**
   * Where the world was when this run ended, for the run that replaces it.
   * Read 9x at setup, written 1x in the teardown — and written as COPIES, not
   * as the live objects, because the next run mutates what it is given from
   * its first frame.
   */
  carryRef: MutableRefObject<Carry | null>;
  /** A room's orbs for this run of the loop. Cleared in the teardown; the DATA cache survives. */
  groupBallsRef: MutableRefObject<Map<string, Ball>>;
  /** Rooms whose orbs have already poured this session: no re-pour on return. Added to as each pours. */
  groupVisitedRef: MutableRefObject<Set<string>>;
  /** Which column travel is bound for, so a rebuild mid-stride still arrives. Written 2x. */
  headingRef: MutableRefObject<number | null>;
  /** Who is which colour on a room's wall. Written 1x, where the orbs are tinted, so the legend cannot disagree. */
  hueByOwnerRef: MutableRefObject<Map<string, number>>;
  /** Why the last `goToWall` did or did not move. Written 4x. Dev diagnosis only. */
  lastGoRef: MutableRefObject<string>;
  /** The baked sprites for this skin and DPR. Written 1x, read 3x. */
  paletteRef: MutableRefObject<Palette | null>;
  /** The loop's own fallback sentence, published for a press to read. Written 1x, at setup. */
  sayLineRef: MutableRefObject<(() => string) | null>;
  /** Which orb is focused. Written 2x here — and see `setSelectedId` above, which is the same two moments. */
  selectedIdRef: MutableRefObject<string | null>;
  /** The control surface itself. Written 2x: installed at setup, nulled in the teardown. */
  simApiRef: MutableRefObject<SimApi | null>;
  /** The mouth's measured height, kept across frames. Written 1x, read 2x. `MOUTH_H` is the first-paint fallback. */
  slotH: MutableRefObject<number>;
  /** The dial's time. Continuous, so never in state. Written 3x, read 13x. */
  TRef: MutableRefObject<number>;
}

/**
 * BUILD THE WORLD AND START IT TURNING.
 *
 * Returns the teardown — so `pages/Home`'s effect is literally
 * `useEffect(() => startSimulation({ … }), [pourSig, agents, walls,
 * groupFieldTick])`, and `undefined` still means "there was nothing to build
 * yet", which is what the three guards below decide.
 *
 * The three guards are the original ones, in the original order, and they are
 * the reason this returns `(() => void) | undefined` rather than `SimApi`:
 * most of the time this is called there is no root, no canvas, or no ground
 * yet, and React needs the absent cleanup, not an object.
 *
 * ONE POUR, NEVER A SECOND ONE. Everything below runs once per run of the
 * loop. What the dependency array in `pages/Home` is for is deciding when a
 * run ends and the next begins, and the note at the foot of this function is
 * the argument for why that array is as short as it is.
 */
export function startSimulation(o: SimulationOptions): (() => void) | undefined {
  /* THE 49 CAPTURES, UNPACKED. This is the only line that is new rather than
     moved: everything below it is the effect body it was, name for name, so
     that the move can be read as a move. The claim attached to each of these
     names is in `SimulationOptions` above. */
  const {
    measured,
    inspirations,
    agents,
    walls,
    setDialAway,
    setInField,
    setInSky,
    setSelectedId,
    agentsRef,
    asideRef,
    atWallRef,
    ballsRef,
    bornRef,
    carryRef,
    creatureSpeaksRef,
    dialRef,
    fieldLoadingRef,
    foundRef,
    groupBallsRef,
    groupCacheRef,
    groupFieldRef,
    groupsRef,
    groupVisitedRef,
    headingRef,
    hueByOwnerRef,
    inspirationsRef,
    lastGoRef,
    loadDetailRef,
    loadGroupRef,
    loadWallRef,
    localeRef,
    membersRef,
    openGroupMemberRef,
    openSeekRef,
    paletteRef,
    panelArrowRef,
    panelOpenRef,
    parkedRef,
    pushArrivedRef,
    pushWokenRef,
    readingLitRef,
    sayLineRef,
    selectedIdRef,
    simApiRef,
    skyRef,
    slotH,
    TRef,
    viewerIdRef,
    wallsRef,
  } = o;

    const root = measured.root.current;
    const canvas = measured.canvas.current;
    if (!root || !canvas || !inspirations || !agents) return undefined;
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
    const poured = inspirationsRef.current ?? [];
    const fetched = new Set(poured.map((s) => s.id));
    const kept = bornRef.current.filter(
      (s) => !fetched.has(s.id) && !(s.sigId !== undefined && fetched.has(s.sigId)),
    );
    /* AT THE MOMENT OF THE POUR, not at the moment this effect was written.
       See `skyRef` — the sky is two requests deep and lands after everything
       in this effect's dependency list has settled, so reading it through the
       ref is what stops those dependencies from having to grow. */
    const pouredSky = skyRef.current;
    /* EVERY WALL'S GROUND, NOT ONLY YOURS.
       The field held your inspirations and nothing else — `makeAgentBall` was
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
      a.inspirations.map((cap) => makeAgentBall(cap)),
    );
    /* A room's ground is its members' PUBLIC memories, each still owned by
       the person who kept it — `ownerProfileId` is what the per-member hue
       will read, and it is carried from here rather than re-derived. */
    const groupBalls = walls
      .filter((w) => w.kind === "group")
      .flatMap((w) =>
        (groupFieldRef.current.get(w.id) ?? []).map((cap) =>
          makeGroupInspirationBall(cap, w, viewerIdRef.current),
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
      if (w.kind !== "group") continue;
      let next = 0;
      for (const cap of groupFieldRef.current.get(w.id) ?? []) {
        if (cap.ownerProfileId === viewerIdRef.current) continue;
        if (hueOf.has(cap.ownerProfileId)) continue;
        hueOf.set(cap.ownerProfileId, next++);
      }
    }
    hueByOwnerRef.current = hueOf;
    for (const b of groupBalls) {
      b.hue = b.ownerProfileId ? hueOf.get(b.ownerProfileId) ?? -1 : -1;
    }
    const list = [
      ...poured.map((c) =>
        makeBall(
          seedOf(
            c,
            pouredSky.citations,
            pouredSky.signals,
            pouredSky.posterSignalIds,
            pouredSky.principleSignalIds,
          ),
        ),
      ),
      ...agentBalls,
      ...groupBalls,
      ...kept.map(bornBall),
    ].sort((a, b) => a.capturedMs - b.capturedMs);
    const byId = new Map(list.map((b) => [b.id, b] as const));
    ballsRef.current = { list, byId };
    /* ONE WALL, ONE SCENE (founder, 2026-08-30: "separate pages… more
       efficient and consistent"). The flat `list` stays for the passes that
       are honestly whole-world — paint, hit-test, the eased sweeps — but
       everything that decides WHOSE ground is on it now reads a scene, so a
       cross-wall state has no container to exist in. The key is the wall id;
       the self wall's is the empty string, as everywhere. */
    const scenes = new Map<string, Ball[]>();
    const sceneKeyOf = (b: Ball): string => b.agentId ?? "";
    for (const b of list) {
      const key = sceneKeyOf(b);
      const bag = scenes.get(key);
      if (bag) bag.push(b);
      else scenes.set(key, [b]);
    }
    const sceneBalls = (wallId: string): Ball[] => scenes.get(wallId) ?? [];
    /**
     * THE SCENE IS AN INDEX OVER `list`, SO IT MOVES WHEN `list` MOVES.
     *
     * It is built once from the whole list, and `list` is then mutated in
     * exactly two places at runtime: `born` pushes a newborn, `dropBall`
     * splices a retracted one. Both have to say so here, or the index and
     * the world disagree about what is standing on this wall.
     *
     * Measured when they did not: a brand-new account kept its first
     * memory, the door said "1 inspiration" — and the ground stayed dark
     * until the page was reloaded. `assignHomes` places `presentBalls()`,
     * which reads the scene, so a newborn missing from it was given no
     * home at all and fell to one that had never been solved. Reloading
     * rebuilt the list, which rebuilt the scene, which is why the memory
     * was always really there and only ever invisible.
     */
    const sceneAdd = (b: Ball): void => {
      const key = sceneKeyOf(b);
      const bag = scenes.get(key);
      if (!bag) scenes.set(key, [b]);
      else if (!bag.includes(b)) bag.push(b);
    };
    const sceneRemove = (b: Ball): void => {
      const bag = scenes.get(sceneKeyOf(b));
      if (!bag) return;
      const i = bag.indexOf(b);
      if (i >= 0) bag.splice(i, 1);
    };

    /**
     * THE DIAL'S NOW IS NEVER BEHIND THE NEWEST MEMORY. THIS IS NOT A GUARD;
     * IT IS THE BUG.
     *
     * `assignHomes` places only what already exists at the dial's time —
     * `b.capturedMs <= TRef.current` — which is right, and is what lets the
     * dial wind history back. `TRef` starts at `Date.now()` when the page
     * mounts and is advanced in exactly two places: the dial, and `born`.
     *
     * `born` advances it with the CLIENT's optimistic stamp. The row that
     * comes back carries the SERVER's `createdAt`. Measured on one machine on
     * 2026-08-23, the server was **+6ms ahead**; across a network it is
     * routinely far more. And `inspirations` is a dependency of this effect,
     * so the keep's own `setInspirations` tears this loop down and rebuilds
     * it — rebuilding that ball from the server's timestamp, now sitting in
     * the future of a dial that was only ever told about the client's.
     *
     * `assignHomes` then filtered it out and it was never drawn. The audit
     * said so exactly: `owners {"(none)":1}` — the ball is here — with
     * `present: 0` and `drawn.active: 0`. A reload re-seeded `TRef` from a
     * later `Date.now()` and the memory appeared, which is why this read as
     * "it only shows up if you refresh".
     *
     * WHO IT ACTUALLY HIT. Everyone, on every keep. It was only VISIBLE to
     * somebody keeping their first memory, because with fifty already in the
     * ground `present` is 49-of-50 and the field still lights; with none it is
     * 0-of-1 and the world answers a person's first capture with nothing at
     * all. `journeys:first-keep` is written against exactly that moment.
     *
     * Clamping here rather than in `born` because here is where the list and
     * the clock meet: whatever the loop was just handed, the dial's now is at
     * least as late as the newest thing in it. Winding BACK is untouched —
     * this only ever moves `TRef` forward, and only to something that exists.
     */
    for (const b of list) TRef.current = Math.max(TRef.current, b.capturedMs);

    for (const b of list) colorBall(b, TRef.current);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* EITHER SOURCE STILLS IT. The system preference is the standing answer;
       the in-page switch is for the person who has not set one, or who wants
       this page still and the rest of their machine as it was. */
    /* THE SYSTEM PREFERENCE, AND NOTHING ELSE.
       An in-page "hold the layout still" switch lived here for a while and it
       was a mistake: in a product whose motion IS the meaning, one persisted
       boolean could freeze everything — the companion stopped walking,
       leaning, bobbing and answering — with no visible state saying why, and
       every attempt to make it recoverable added another failure. The real
       accessibility requirement is served by the platform preference, which
       every branch in this file already honours. */
    /**
     * WHAT THE WORLD IS BEING DRAWN INTO, and what the display asked for.
     *
     * Eight facts that are only ever true together — `w` and `h` without the
     * `layout` computed from them is a size nothing has been placed against —
     * and the most widely read state in the loop. Grouping them is what lets a
     * function say `(view)` in its signature and mean it; loose, every one of
     * the eighty-three functions here could reach any of them and none of them
     * declared which.
     *
     * `primed` and `motesPlaced` are here rather than with the pour: both are
     * once-only flags set inside `measure()`, and what they remember is that
     * the world has been SIZED once, not that anything has been staged.
     */
    const view = {
      reduced: mq.matches,
      w: 1,
      h: 1,
      dpr: 1,
      layout: computeLayout(1, 1, DIAL_H),
      /* the dial's real strip, read off the dial itself every measure */
      dialH: DIAL_H,
      /* first sizing has happened: before this, orbs start on their homes
         rather than pouring, and a resize must not re-anchor a held camera */
      primed: false,
      /* the dust has been scattered once; it is ambient and never re-placed */
      motesPlaced: false,
    };
    /* A REBUILD HAS ALREADY BEEN SIZED. `measure()` snaps every memory back to
       its home while `primed` is false, which is the arrival animation
       replaying for orbs that never moved. `motesPlaced` is deliberately NOT
       carried: the mote arrays are rebuilt with the loop, so skipping the
       scatter would leave the dust stacked at the origin. See `carryRef`. */
    if (carryRef.current) view.primed = carryRef.current.primed;
    /* ---- the horizontal axis (v8): columns of jars, one room each ----
       Column zero is the personal jar; column c ≥ 1 is groupsRef[c-1]. The
       camera gains cam.x = column × view.w with the same snap discipline as
       the vertical: velocity-biased, one column per gesture, never resting
       between. The COMPANION leads every transition — it sets off first and
       the layout eases after it, which is how the page explains where the
       rooms are. */

    /**
     * WHERE THE WORLD IS BEING LOOKED AT FROM.
     *
     * Both axes in one object, because they are one camera: a gesture that
     * commits horizontally must stop the vertical snap, and the two were only
     * ever kept in step by every writer remembering to touch both.
     */
    const cam = {
      y: 0,
      vel: 0,
      x: 0,
      xTarget: 0,
      /** easing home after an uncommitted swipe */
      xBack: false,
      /* Where a programmatic move is headed. `aiming` is the sentinel — the
         sky lives at NEGATIVE camera coordinates, so a magic -1 would be a
         real destination rather than "nowhere". */
      target: 0,
      aiming: false,
      /* the snap's profile: where it left from, how long it takes, when it began */
      aimFrom: 0,
      aimDur: 0,
      aimT0: 0,
    };

    /* not zero: the loop resumes where the last one was, or was going */
    const resumedAt = headingRef.current;

    /**
     * A CROSSING FROM ONE WALL TO THE NEXT.
     *
     * `travel(dir)` is the verb that starts one; this is what is true while it
     * runs. Named `trip` for exactly that reason — the function already owns
     * the word "travel", and a state object sharing it would have shadowed a
     * function called from six places.
     *
     * `col` is the anchor: the column the loop believes it is at or heading
     * for. It survives an effect rebuild through `headingRef`, which is what
     * fixed travel silently restarting at column zero when a destination's
     * data arrived mid-crossing.
     */
    const trip = {
      col: resumedAt ?? atWallRef.current.col,
      active: false,
      dir: 1 as 1 | -1,
      dest: 0,
      at: 0,
      /** where the layout's slide profile eases from */
      fromX: 0,
      /** holding the quarter-turn toward the edge */
      yaw: false,
      /** arrived in a room whose data is late */
      awaitingWake: false,
      /** whose orbs the companion's glow reads */
      inspCol: 0,
      /** how long this crossing takes; a held drag can stretch it */
      ms: TRAVEL_MS,
    };
    /* THE CROSSING SURVIVES A REBUILD. Restored here rather than after the
       whole preamble because `measure()` reads both: it resets `cam.x` to
       `trip.col * view.w` unless a crossing is running, so a `trip` that has
       forgotten it was mid-flight is what walks the camera back to the column
       it started from. See `carryRef`. */
    if (carryRef.current) {
      Object.assign(cam, carryRef.current.cam as Partial<typeof cam>);
      Object.assign(trip, carryRef.current.trip as Partial<typeof trip>);
      /* A REBUILD CAN COME FROM THE WALLS THEMSELVES CHANGING — `walls` is on
         the dependency list. A crossing whose start or destination no longer
         exists is not resumable, and resuming it would aim the camera at a
         column that is not there, which is worse than the jump this is here to
         remove. Fall back to where React says you are and stand still; the
         camera is deliberately left to `measure()`, which sets it from
         `trip.col` once the viewport has a real width. */
      const cols = wallsRef.current;
      const lo = cols[0]?.col ?? 0;
      const hi = cols[cols.length - 1]?.col ?? 0;
      const stranded = (c: number) => c < lo || c > hi;
      if (cols.length === 0 || stranded(trip.col) || (trip.active && stranded(trip.dest))) {
        trip.col = atWallRef.current.col;
        trip.active = false;
        trip.awaitingWake = false;
        cam.xBack = false;
        cam.aiming = false;
      }
    }

    /** Which one-time hints have already been said, so they are said once. */
    const hinted = {
      dialAway: false,
      inField: false,
      inSky: false,
    };
    /**
     * STAGING ORBS INTO THE FIELD — the pour, and everything that schedules it.
     *
     * One object rather than five loose flags because they are only ever
     * correct together: `active` without `step` is a pour with no cadence, and
     * `done` set while `active` is still true is a state the field cannot be
     * in. Grouped, a reader sees the whole of what a pour is in five lines;
     * loose, they were spread over sixty and read as five unrelated booleans.
     *
     * The object is `const` and only its fields move. Nothing about lifetime
     * or identity changes from the `let`s this replaces — every closure below
     * captures the object, exactly as it used to capture each variable.
     */
    const pour = {
      /** a pour is running: orbs are still arriving on their stagger */
      active: false,
      /** a pour has finished here, so returning to this wall must not re-pour */
      done: false,
      /** The gap between two arrivals in the current pour. */
      step: 35,
      /** How many newborns are fading out because their keep did not land. */
      doomed: 0,
      /** the dial moved: the field's contents need re-solving before the next frame */
      scrubDirty: false,
    };
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

    /**
     * HOW ALIVE THE WORLD IS RIGHT NOW.
     *
     * Not the pour's, though the pour stirs it. `amp` scales every ambient
     * drift in the world at once — the nebulae's wander, the orbs' float, the
     * companion's bob, the dust — so that a world left alone eases toward
     * stillness instead of jittering at a reader who has stopped reading.
     *
     * That is why these two are their own object and not fields on `pour`:
     * four subsystems read `amp` and none of them is the pour. `wake()` is the
     * only writer, which is what keeps "something happened" a single fact.
     */
    const stir = {
      /** 1 while something is happening, easing to SETTLE_MIN when nothing is. */
      amp: 1,
      /** when the world was last stirred; `SETTLE_IDLE` after this, it settles */
      at: 0,
    };
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
    /**
     * THE ROOM'S COMPANY, AS PRESENCE. 0 on any wall that is not a room's,
     * easing to 1 while you stand in one — the same spring `mech` rides, so
     * the members fade in on the same clock the machine-ness would. It is a
     * presence channel, not a count: what it scales is alpha.
     */
    let company = 0;
    /** Where each drawn member sits on screen this frame, so the pointer can
        find them: canvas pixels answer to nothing else. */
    const companySeats: Array<{ id: string; x: number; y: number; r: number }> = [];
    /** Each room's company, in painting order, held on the member list's own
        identity — see `seatedFor` in the draw. */
    const companyPlacesCache = new Map<
      string,
      { from: ApiGroupMember[] | undefined; viewer: string | null; seated: CompanyPlace[] }
    >();
    /** The member being noticed, and until when — a beat, not a state: light
        that stayed would be a selection nobody made. */
    const companyNear = { id: "", until: 0 };
    /** each member's form, derived once from their id and then held */
    const memberBeings = new Map<string, Being>();
    const beingOf = (id: string): Being => {
      let b = memberBeings.get(id);
      if (!b) {
        b = agentBeing(id);
        memberBeings.set(id, b);
      }
      return b;
    };
    /* the eased body-turn toward whatever it is attending to */
    const mechAt = (x: number): number => {
      const here = x / Math.max(view.w, 1);
      let best = 0;
      for (const w of wallsRef.current) {
        if (w.kind !== "agent") continue;
        const near = 1 - clamp01(Math.abs(here - w.col));
        if (near > best) best = near;
      }
      return best;
    };
    /** Snap a coordinate to the machine's grid, by however machine it is. */
    /**
     * THE FRAME LOOP'S OWN STATE — whether it is turning, and since when.
     *
     * Separate from `view` because this is the only group nothing else may
     * write: `wake()` starts it, the loop stops itself when the world has been
     * still long enough, and a second writer would mean two rAFs running.
     */
    const clock = {
      raf: 0,
      running: false,
      /** the previous frame's timestamp, so `dt` is a real elapsed time */
      prev: 0,
      /** when something last happened; the loop parks itself after a while */
      lastActive: 0,
    };

    /**
     * ONE HAND ON THE WORLD — everything about the gesture in progress.
     *
     * Twenty-four variables that are meaningless apart and dangerous apart.
     * `downX` without `ownerId` is where SOME finger landed, and that is
     * precisely the bug the pointer-identity comment below describes: state
     * that reads as one gesture's while any number of pointers write it.
     * Grouping them does not fix that on its own, but it makes the thing
     * `ownerId` guards a single object instead of two dozen names nobody
     * could enumerate.
     */
    const gesture = {
      down: false,
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
      ownerId: null as number | null,
      /** Did the press interrupt a snap? Then it owes the world one back. */
      interruptedSnap: false,
      /** Which memory the finger is on, if any: it answers at touchdown. */
      pressId: null as string | null,
      /** When the press landed: a tap is decided on release, not on a threshold. */
      downT: 0,
      dragging: false,
      /* hover bookkeeping: the cursor is only re-tested every other move, and
         only written when it actually changes */
      hoverTick: 0,
      cursor: "",
      downX: 0,
      downY: 0,
      lastX: 0,
      lastY: 0,
      lastT: 0,
      velX: 0,
      /** undecided · vertical · horizontal */
      axis: 0 as 0 | 1 | 2,
      wheelXAcc: 0,
      wheelXUntil: 0,
      /** Set on wheel; the section snap fires once the wheel goes quiet. */
      snapAt: 0,
      /** a held horizontal drag: the companion walks */
      leadOn: false,
      leadTarget: 0,
    };

    /* Dust motes: preallocated, mutated in place, never reallocated. They
       live in SCREEN space (drawn at layout y = y + camY) because they are
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
    /* THE NIGHT SKY HOLDS STILL. These were Math.random, and the whole sim
       effect re-runs whenever the archive list changes — so every KEEP
       rerolled the starfield behind the world, and the founder watched the
       background rearrange itself each time they saved (2026-08-24). The
       world never moves unless the person moved it, and saving a memory is
       not moving the stars. Seeded off each spark's own index — the same
       stable-identity law every orb's scatter already obeys — so a rebuild
       reproduces the identical sky. */
    const sparkX = new Float32Array(SPARKS);
    const sparkY = new Float32Array(SPARKS);
    const sparkR = new Float32Array(SPARKS);
    const sparkA = new Float32Array(SPARKS);
    const sparkSeed = (i: number, salt: string) =>
      (mix32(hashStr(`spark:${salt}:${i}`)) >>> 8) / 0x1000000;
    for (let i = 0; i < SPARKS; i++) {
      sparkX[i] = sparkSeed(i, "x");
      sparkY[i] = sparkSeed(i, "y");
      sparkR[i] = 0.7 + sparkSeed(i, "r") * 1.1;
      sparkA[i] = 0.05 + sparkSeed(i, "a") * 0.07;
    }
    /**
     * THE COMPANION — everything the character is doing right now.
     *
     * Thirty-three variables, and they were spread over three separate blocks
     * two hundred lines apart: the walk lived up in the travel declarations
     * because that is where travel needed it, the lean lived beside the
     * pointer state, and the rest were here. Nothing said they were one thing,
     * so reading "what is the character doing" meant finding all three.
     *
     * They are one thing. Every field is some part of one body's posture at
     * one instant — where it is, which way it faces, what it is looking at,
     * how lit it is — and they are only ever coherent together: `yaw` without
     * `yawTarget` is a heading with nothing to ease toward, and `eyeX` without
     * `eyeTX` is a gaze with no subject.
     */
    const companion = {
      /* `insp` is real: the mean aliveness of the eight most alive bubbles at
         the current dial time. It is why the character dims as you scrub back
         into a quiet stretch and brightens over a live one. */
      insp: 0,
      inspNow: 0,
      flare: 0,
      /** Something was captured today: a steady lift, never a pulse. */
      freshLit: 0,
      freshToday: false,
      y: 0,
      size: 110,

      /* WHERE IT IS ON ITS WALK. `off` is the traveler's screen lead in px,
         `lead` the eased ramp toward it, `from` where that ramp starts so a
         re-travel does not pop, and `bobPh` the hover-bob's own phase, which
         quickens into a walk. */
      off: 0,
      lead: 0,
      from: 0,
      bobPh: 0,

      /* The companion is the thing the dial turns. `yawTarget` is a POSITION,
         mapped from the dial's own 0→1; the drawn angle eases toward it, so a
         fast drag and a slow drag of the same distance turn it the same amount.
         Let go and it unwinds to front-facing. */
      yawTarget: 0,
      yaw: 0,
      unwindFrom: 0,
      unwindAt: 0,

      eyeX: 0,
      eyeY: 0,
      eyeTX: 0,
      eyeTY: 0,
      /* ATTENTION HAS A DURATION. While `attendUntil` is in the future the
         eyes belong to the thing that was tapped and the pointer cannot take
         them back — otherwise the smallest mouse drift would yank the gaze
         home and the look would read as a twitch rather than as noticing
         something. */
      attendUntil: 0,
      attendLean: 0,
      attendHold: 0,

      /**
       * The vertical half of the traveler. `pitch` is where the world is going
       * (−1 rising … +1 descending), eased; `lift` is how far the companion
       * leads it in screen pixels. Both are written from the camera's own
       * motion, so they answer a drag, a wheel, a key and a programmatic glide
       * identically — the character responds to THE WORLD MOVING, never to a
       * particular input device.
       */
      pitch: 0,
      lift: 0,
      camYPrev: 0,

      blinkAt: 0,
      blink: 0,
      /** The occasional clock: a look-around every 30–60s, on any archive. */
      idleAt: 0,
      /** The memory it looked at last, so the idle glance never repeats it. */
      lastGaze: "",
      /** The last thing it said, so it never says the same thing twice running. */
      lastSaid: "",
      /** the pairable set as a string, so React only hears about real changes */
      pairSig: "",
      /* The companion is the messenger: while something is forming above, it
         glances up now and then and lets a mote go toward the sky. */
      glanceAt: 0,
      glanceUntil: 0,
      riseAt: 0,
      /* the wind-up: when it began, what it is winding up TO, and how far
         into the compression the body currently is */
      antAt: 0,
      antFlare: 0,
      ant: 0,
      /** the slow one: -1 … 1, half-life MOOD_HALF_LIFE_MS, rhythm only */
      mood: 0,
    };
    /* AND SO DOES THE CREATURE. Every field above is a number, a boolean or a
       string — no canvas, no node, nothing bound to the palette this run baked
       — so the pose carries across whole. See `carryRef`. */
    if (carryRef.current) {
      Object.assign(companion, carryRef.current.companion as Partial<typeof companion>);
    }

    /* motes rising off the aura when the companion is genuinely inspired */
    const upX = new Float32Array(10);
    const upY = new Float32Array(10);
    const upA = new Float32Array(10);
    const riseX = new Float32Array(4);
    const riseY = new Float32Array(4);
    const riseA = new Float32Array(4);
    const inspTop = new Float32Array(8);

    /* Painter's order for the shadow+body pass: bottom-most orb first, so an
       orb's contact shadow lands ON whatever it is resting against and is then
       covered by the orb itself. A preallocated index array, kept for the life
       of the loop and re-sorted in place, so neither the painter nor the hit
       test allocates per frame. `sortByDepth` itself moved to
       `space/inspiration/field.ts` when the painter left the page — the two
       must never end up with two orderings, which is the bug where you click
       one memory and a different one lights up. */
    const order: number[] = list.map((_, i) => i);

    function wake() {
      clock.lastActive = performance.now();
      /* ANY REAL EVENT WAKES THE WORLD, at once and to full amplitude. wake()
         is what every one of them already calls — a touch, the pour, a scrub,
         a relight, a travel, an adoption, a room arriving — so the layout's
         attention and the loop's attention are the same thing. */
      stir.at = clock.lastActive;
      stir.amp = 1;
      if (!clock.running) {
        clock.running = true;
        clock.prev = performance.now();
        clock.raf = requestAnimationFrame(tick);
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
    /**
     * WHOSE GROUND YOU ARE STANDING ON — null means your own.
     *
     * A group's ground used to be every member's public inspirations poured
     * into one field, with a legend beside it decoding five hues. That asked
     * the reader to do the work of separation before they could read anything,
     * and it bought nothing: a group's ground CANNOT explain its sky. The wall
     * query stops at shares by design (`loadGroupField` in routes/groups.ts) —
     * a member sees the pattern someone arrived at, never the captures it was
     * distilled from. So a mixture of five people's memories under five shared
     * statements is not evidence for them; it is five grounds in a heap.
     *
     * One person at a time, yours first. Whose ground this is becomes
     * something you MOVED to, which is the only way this world says anything.
     */
    let ground: string | null = null;
    /* on a group's wall the ground belongs to exactly one member; every
       other wall's scene is wholly its own */
    const standingOk = (b: Ball, w: Space): boolean =>
      w.kind !== "group" ||
      (b.ownerProfileId ?? "") === (ground ?? viewerIdRef.current ?? "");
    /**
     * THE ONE OWNER OF PRESENCE. At rest, what is lit IS what the rules say:
     * the current wall's scene, time-gated, standing-gated — and nothing
     * else. Every defense this file grew across three disappearances (the
     * lights-out sweep at arrival, the rest-convergence, the orphan burial,
     * the pour's all-off preamble, the carry's recompute) was this function,
     * written five times from five directions. A ball mid-stage
     * (spawnAt > 0) is left to the pour's own `enter`, which is the
     * animation's half of the same rule.
     */
    function applyPresence() {
      const w = curWall();
      for (const [wallId, bag] of scenes) {
        const here = wallId === w.id;
        for (const b of bag) {
          const present =
            here && b.capturedMs <= TRef.current && standingOk(b, w);
          if (!present) {
            b.active = false;
            b.spawnAt = -1;
            continue;
          }
          if (b.spawnAt > 0) continue;
          if (!b.active) {
            b.active = true;
            b.arrive = 1;
            b.x = b.homeX;
            b.y = b.homeY;
          }
        }
      }
    }

    /* dev-only: the loop's own truth, askable from a console */
    if (import.meta.env.VITE_SHOW_INTERNAL) {
      (window as unknown as Record<string, unknown>).__waka = () => ({
        wall: curWall().id || "me",
        kind: curWall().kind,
        tripActive: trip.active,
        lastGo: lastGoRef.current,
        cam: { x: Math.round(cam.x), y: Math.round(cam.y) },
        viewH: view.h,
        viewW: view.w,
        balls: list.map((b) => ({
          id: b.id.slice(0, 8),
          agent: (b.agentId ?? "").slice(0, 8) || "me",
          active: b.active,
          alive: Number(b.alive.toFixed(2)),
          x: Math.round(b.x),
          y: Math.round(b.y),
          homeY: Math.round(b.homeY),
          spawnAt: b.spawnAt,
        })),
      });
    }

    function assignHomes() {
      const present = presentBalls(); /* oldest first, the scene's own */
      const n = present.length;
      if (n === 0) return;

      const spanL = view.layout.wallL;
      const spanR = view.layout.wallR;

      /* THE BAND IS THE WHOLE SCREEN, LESS THE ONE PIECE OF CHROME ON IT.
         Standing in the field the camera sees layout [vh, 2vh]; the dial owns
         its measured strip at the bottom of that, and nothing else is owed
         anything. Every orb's own radius and drift are then held off both
         edges by its `clear`, so the promise is exact by construction at every
         viewport height rather than at the two that happened to get looked at.
         (The old band started 18px below the boundary and stopped 132px above
         it — a fixed reserve that ate a tenth of a tall screen and a quarter
         of a short one, which is the bug.) */
      const yTopEdge = view.h + FIELD_EDGE;
      const yBotEdge = view.layout.fieldBottom;

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
      /* THE WALL'S OWN COLUMN. Homes are solved in column-local coordinates
         and stood at the column's x-origin; they were laid bare, which put
         every ground but your own exactly one screen to the right of the
         camera that travelled to see it (founder, 2026-08-30 — six counted,
         none visible; measured at screen-x 1842 on a 1280 viewport). */
      const colX = curWall().col * view.w;
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
        b.colX = colX;
        const lx = scatterX(b, y, px, py, spanL, spanR);
        px.push(lx);
        py.push(b.homeY);
        b.homeX = colX + lx;
      }
      electPeek(present);
    }

    /**
     * WHICH MEMORIES THIS WALL'S CLAIM RESTS ON, and where they rise to.
     *
     * These are the orbs that LED TO THE AMBITION — the raw inspirations its
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
      if (poster.provenance.size > 0) {
        for (const b of present) if (poster.provenance.has(b.id)) rowSet.push(b);
        /* newest first, so a long provenance shows its freshest end */
        rowSet.sort((a, b) => b.capturedMs - a.capturedMs);
        rowSet.length = Math.min(rowSet.length, PEEK_MAX);
      }
      if (rowSet.length === 0) {
        const rowN0 = Math.min(PEEK_ORBS, n);
        for (let i = 0; i < rowN0; i++) rowSet.push(present[n - 1 - i]);
      }
      const rowN = rowSet.length;
      const spanL = view.layout.wallL;
      const spanR = view.layout.wallR;
      const top = view.layout.fieldTop;
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
        const keep = companion.size * 0.72 + b.r;
        if (Math.abs(x - view.w / 2) < keep) {
          const leftLo = spanL + b.r;
          const leftHi = view.w / 2 - keep;
          const rightLo = view.w / 2 + keep;
          const rightHi = spanR - b.r;
          const goLeft = x < view.w / 2 ? leftHi > leftLo : rightHi <= rightLo;
          x = goLeft
            ? scatterX(b, b.peekY, px, py, leftLo, Math.max(leftLo, leftHi))
            : scatterX(b, b.peekY, px, py, Math.min(rightLo, rightHi), rightHi);
          x = clamp(x, spanL + b.r, spanR - b.r);
        }
        /* the peek stands in its wall's own column, like the ground below */
        b.colX = curWall().col * view.w;
        b.peekX = b.colX + x;
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
      return clamp01(1 - cam.y / Math.max(view.layout.maxCam, 1));
    }

    /**
     * THE SAME RULE, ACROSS THE SEAM: how far the SKY has leaned down into
     * headquarters. One where you stand, nothing once you are up in it.
     *
     * `peekLift` is 1 at headquarters and 0 down in the field; this is 1 at
     * headquarters and 0 up in the sky. Together they are one sentence — the
     * section you are NOT in leans toward you — so both edges of the screen
     * say there is somewhere to go. It exists because a person told us they
     * had no idea the world could be moved through: the ground had always
     * said so and the sky never had.
     *
     * Camera, never a timer. Standing in the field it stays 1 and costs
     * nothing, because the sky is a whole viewport away and culled.
     */
    function skyPeek(): number {
      return clamp01(1 - cam.y / Math.min(view.layout.minCam, -1));
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
      const el = measured.mouthSpot.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const rr = root!.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - rr.left,
        y: r.top + r.height / 2 - rr.top + cam.y,
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
      if (gesture.pressId === b.id) gesture.pressId = null;
      if (held.ball === b) held.ball = null;
      list.splice(i, 1);
      byId.delete(b.id);
      sceneRemove(b);
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
    const SELF_WALL: Space = { kind: "self", id: "", name: SELF_WALL_NAME, col: 0 };
    const wallAt = (c: number): Space =>
      wallsRef.current.find((w) => w.col === c) ?? SELF_WALL;
    const curWall = () => wallAt(trip.col);
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
     * It USED TO read off the live camera column, so the form turned over
     * mid-crossing on the theory that the travel is what explains the change.
     * The block below supersedes that and says why; this paragraph is kept
     * only so the reasoning it replaced is still legible.
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
    /**
     * THE FEATURES SWAP ON THE SAME SIGNAL AS THE FORM.
     *
     * `machine` is returned rather than re-derived at the draw site, and that
     * is the whole point: the body sprite is pixelated iff this is an agent's
     * wall, so anything drawn ON the body has to read the identical boolean or
     * the two can disagree for a frame. It is deliberately NOT `mech`, which
     * eases continuously across a travel — a stepped body wearing eyes that
     * are 40% quantized is not a thing that can be drawn.
     */
    const worn = (
      pal: Palette,
    ): {
      be: Being;
      body: HTMLCanvasElement[];
      aura: HTMLCanvasElement[];
      machine: boolean;
    } => {
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
      if (w.kind !== "agent")
        return { be: OWNER_BEING, body: pal.body, aura: pal.auraLayers, machine: false };
      const be = agentBeing(w.id);
      const s = bakeBeing(pal, `${w.kind}:${w.id}`, be, true, true);
      /* the AURA is never pixelated: its colour temperature is one of the two
         invariants that say this is still the same companion, and a stepped
         halo would break the one thing carrying continuity across the change */
      return { be, body: s.body, aura: pal.auraLayers, machine: true };
    };
    /**
     * THE CHANGE OF FORM IS A DISSOLVE, NOT A CUT.
     *
     * `worn()` above reads the wall the traveller has ARRIVED at, which was
     * the right call and did not go far enough. `trip.col = trip.dest` lands
     * on the same frame `arriveColumn()` starts the unwind — so the body was
     * swapping while the creature was still turned a quarter turn and still
     * riding up to 190px of travel lead, and only THEN spending UNWIND_MS
     * turning back to face you. One frame changed the silhouette from stepped
     * to smooth AND the body from cold to warm, in the middle of a gesture
     * that was still in flight. Everything else about a travel eases; this
     * one thing cut, and a cut inside a continuous motion is read as a fault
     * in the world rather than as an event in it.
     *
     * The doc above already names the fix without implementing it: Pokémon
     * carries an evolution through a light envelope that never cuts. Here the
     * envelope is the turn itself. The dissolve starts on the arrival beat and
     * finishes inside the unwind, so the companion turns away as yours and
     * comes back as theirs, and there is no frame at which two different
     * creatures are both in focus.
     *
     * The aura is deliberately NOT part of this: it is identical either way
     * (see `bakeBeing`), which is what makes it the thing that visibly carries
     * across while the body is mid-change.
     */
    /* last frame's form, so the dissolve has something to come FROM */
    let wornPrevBody: HTMLCanvasElement[] | null = null;
    let wornPrevBe: Being = OWNER_BEING;
    let wornPrevMachine = false;
    const form = {
      /** the wall whose form is being worn; "" until the first frame */
      key: "",
      /** the outgoing sprite sheet, held only while a dissolve is running */
      prevBody: null as HTMLCanvasElement[] | null,
      prevBe: OWNER_BEING as Being,
      prevMachine: false,
      /** when the dissolve began, in performance.now() ms */
      at: 0,
    };
    const colLo = () => wallsRef.current[0]?.col ?? 0;
    const colHi = () => wallsRef.current[wallsRef.current.length - 1]?.col ?? 0;
    const minCamNow = () => (hasSky(curWall().kind) ? view.layout.minCam : 0);
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
      return lo < 0 ? [lo, 0, view.layout.maxCam] : [0, view.layout.maxCam];
    };

    function findBall(id: string): Ball | undefined {
      return byId.get(id) ?? groupBallsRef.current.get(id);
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
      wall: Space;
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
    function ensureResident(w: Space): Resident | null {
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
      if (trip.active) return;
      const w = curWall();
      if (w.kind === "group") {
        const entry = groupCacheRef.current.get(w.id);
        if (!entry || entry.status === "pending") {
          trip.awaitingWake = true;
          return;
        }
        trip.awaitingWake = false;
        if (entry.status === "failed" || !entry.data) return; /* React whispers it */
        if (!groupVisitedRef.current.has(w.id)) {
          groupVisitedRef.current.add(w.id);
          pushWokenRef.current(w.id);
        }
      } else if (w.kind === "agent") {
        /* an agent's memory now loads on approach, so its wall wakes the way
           a room's does: blank until its own bundle has landed */
        const has = agentsRef.current.some((a) => a.agent.id === w.id);
        trip.awaitingWake = !has;
        if (!has) return;
      } else {
        trip.awaitingWake = false;
      }
      /* the wall's claim lifts its own handful of the ground */
      poster.provenance = poster.byWall.get(spaceKey(w)) ?? new Map();
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
        res.greetUntil = performance.now() + (view.reduced ? 0 : 1500);
      }
      companion.flare = Math.max(companion.flare, view.reduced ? 0 : 0.35);
      wake();
    }

    /** Every memory that exists at the dial's time, oldest first. */
    function presentBalls(): Ball[] {
      const w = curWall();
      const out: Ball[] = [];
      for (const b of sceneBalls(w.id))
        if (b.capturedMs <= TRef.current && standingOk(b, w)) out.push(b);
      out.sort((a, b) => a.capturedMs - b.capturedMs);
      return out;
    }

    /** Arrival: the character decelerates, turns back front, the wall wakes. */
    function arriveColumn() {
      /* it looks around whatever it has just walked into */
      simApiRef.current?.acknowledge("arrived");
      trip.yaw = false;
      companion.unwindAt = 0; /* the unwind branch turns it back front, the short way */
      gesture.wheelXUntil = performance.now() + 120;
      pushArrivedRef.current(curWall());
      headingRef.current = null; /* landed; there is nowhere still to get to */
      /* YOU ARRIVE IN YOUR OWN GROUND, ALWAYS.
         Standing in someone else's ground is a thing you did on THAT wall and
         it does not follow you to the next one. This is reset here, at the
         loop's own arrival, rather than from a React effect watching the wall
         change: that effect fires while the column is still in flight, and the
         settle it triggered mid-travel left every ball inactive because the
         re-activation below had already run against the old column. */
      ground = null;
      /* THE GROUND IS RE-SOLVED FOR WHOEVER'S WALL THIS IS.
         Arriving changes which memories are standing on it, so the layout has
         to run again — without this the previous wall's homes stay assigned
         and the new wall's memories have nowhere to be. */
      assignHomes();
      /* AND THEY ARE SWITCHED ON. The layout above gives them somewhere to be;
         this is what makes them exist. Without it a travelled-to wall drew an
         empty ground however much was standing on it. */
      applyPresence();
      const here = presentBalls();
      if (view.reduced) settleInstantly();
      else primePour(here);
      electPeek(here);
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
      /**
       * SIDEWAYS IS FOR ROOMS, AND ROOMS ARE NOT OFFERED YET.
       *
       * Founder: "the moving left and right should only be used for changing
       * rooms, which we're not offering at the moment so keep that code to
       * move, but disable it."
       *
       * The axis was built for three kinds of neighbour — agents one way,
       * rooms the other — and two of those three are gone from the product:
       * rooms are set aside by ruling, and changing to your agent became a
       * turn in place rather than a journey, because the creature is one
       * companion with two faces rather than two creatures in two places.
       * That left a whole degree of freedom whose only remaining destination
       * was a wall you can already reach by pressing a face.
       *
       * So every USER-DRIVEN lateral gesture stops here: the drag, the
       * sideways wheel, the arrow keys, and the edge affordance that offers
       * them. `goToWall` is untouched and still carries the form change and
       * any deep link — this gates the gestures, not the mechanism, which is
       * the difference between disabling a thing and deleting it.
       *
       * ONE FLAG RATHER THAN FOUR DELETIONS, deliberately. The travel code is
       * some of the most carefully tuned in the file — the sqrt duration, the
       * companion's lead and yaw, the rubber-band, the crossing quantisation
       * — and rooms will want every bit of it. Deleting it to re-derive it
       * later is how the room form became unreachable code that nobody could
       * safely remove. Flip this to `true` on the day rooms come back.
       */
      const ROOMS_ARE_OFFERED = false;
      if (!ROOMS_ARE_OFFERED) return false;
      if (cam.aiming) return false;
      const atHQ = Math.abs(cam.y) < 2;
      const atSky = hasSky(curWall().kind) && Math.abs(cam.y - view.layout.minCam) < 2;
      return atHQ || atSky;
    }

    /*
     * `trip.ms` is how long THIS glide takes, and it is declared with the rest
     * of the crossing above. One wall is the constant; several walls in one
     * movement take longer but not proportionally — the square root is the
     * difference between "a long corridor" and "sitting through five
     * animations". Five walls come out at about 2.2x one wall rather than 5x.
     */
    const travelSpanMs = (walls: number) =>
      TRAVEL_MS * Math.sqrt(Math.max(1, Math.abs(walls)));

    function travel(dir: 1 | -1) {
      if (cam.aiming) return;
      if (trip.active) {
        /* REVERSAL. The opposite key mid-flight retargets to the other end
           of the segment — the character turns first (the turn IS the
           acknowledgment) and leads back; being able to change your mind is
           what kills the trapped feeling. The same direction stays ignored:
           one column per gesture. */
        if (dir === trip.dir) return;
        const back = trip.dest === trip.col ? trip.col + dir : trip.col;
        if (back < colLo() || back > colHi()) return;
        loadWallRef.current(wallAt(back));
        trip.dest = back;
        trip.dir = dir;
        cam.xTarget = back * view.w;
        trip.fromX = cam.x;
        trip.at = performance.now();
        companion.from = companion.off;
        companion.lead = dir * Math.min(view.w * TRAVEL_LEAD_X, 190);
        companion.yawTarget = dir * (TAU / 4);
        companion.unwindAt = 0;
        trip.awaitingWake = false;
        wake();
        return;
      }
      if (!canTravelHere()) return;
      const dest = trip.col + dir;
      if (dest < colLo() || dest > colHi()) return;
      if (selectedIdRef.current) release();
      loadWallRef.current(wallAt(dest));
      trip.awaitingWake = false;
      trip.dest = dest;
      trip.dir = dir;
      cam.xTarget = dest * view.w;
      cam.xBack = false;
      gesture.leadOn = false; /* the travel choreography owns the lead now */
      if (view.reduced) {
        trip.col = dest;
        cam.x = cam.xTarget;
        companion.off = 0;
        arriveColumn();
        wake();
        return;
      }
      trip.active = true;
      trip.ms = TRAVEL_MS;
      trip.at = performance.now();
      trip.fromX = cam.x;
      companion.lead = trip.dir * Math.min(view.w * TRAVEL_LEAD_X, 190);
      companion.from = companion.off;
      trip.yaw = true;
      companion.yawTarget = trip.dir * (TAU / 4);
      companion.unwindAt = 0;
      wake();
    }

    /* ---------------- the sky: where ambitions are still forming ----------------
       Section S is one viewport ABOVE headquarters. Its inhabitants are the
       candidates — the room's pending proposal, the provisional readings, and
       any draft the person assembles here — and each one is a NEBULA: light
       that has not condensed into an ambition yet. The canvas carries the
       light; the DOM carries the sentence, so the words stay crisp and
       selectable. */

    /**
     * WHAT THE PEEK ROW RESTS ON — layer 3's evidence, not layer 2's.
     *
     * These sat in the sky's declaration block for a long time and do not
     * belong there. `electPeek` is the only reader, and the peek row is drawn
     * under the POSTER at headquarters. `sky.provenance` would have named the
     * top-of-mind layer's evidence after the layer above it.
     */
    const poster = {
      /* what THIS wall's ambition was built from; its peek row is made of these */
      provenance: new Map() as Provenance,
      /* and every wall's, so arriving on one can lift its own handful */
      byWall: new Map<string, Provenance>(),
    };

    /**
     * THE SKY — layer 2, and everything the pointer is doing to it.
     *
     * Eleven variables that are only ever true together: a `focusNeb` with no
     * `nebs` is a subject with no sky, and `satSaid` without `satSayW` is a
     * name nobody measured. One object so the whole of what the sky knows
     * reads in one place — and so the extraction it was grouped for could be
     * `stepSky(sky, view, stir, deps, …)`, a signature a person can check,
     * instead of a closure over everything in the loop.
     *
     * That extraction has happened: the thirteen functions that MOVE this now
     * live in `space/signal/sky-engine.ts` and take it as a parameter. What is
     * left in the page reads it — the draw pass, the two hit tests, the
     * pointer — and the engine no longer has to be trusted to stay inside it,
     * because it can no longer see anything else.
     */
    /**
     * THE ONE ORB BEING HELD, which is all that is left of the sky.
     *
     * There was a `SkyState` here — clouds, their satellites, a focused
     * subject, a hovered one, a cluster signature — and thirteen engine
     * functions that moved it. Every one of them went dormant on 2026-08-24
     * when the candidate layer came out of headquarters, and none of it was
     * deleted until the founder said so on 2026-08-25.
     *
     * This survived because it was never about the sky: it is the GROUND's
     * bookkeeping. A memory being read is held, and a held memory has to be
     * findable to let go of — it can live in a room column that has never
     * been built, so it is kept by reference rather than looked up.
     */
    const held = { ball: null as Ball | null };

    /**
     * Let go of every orb. Two steps, and the second is not redundant: the
     * sweep clears whatever is in the ground right now, and the held one may
     * live in a room column that has never been built — so it is cleared by
     * the reference we kept rather than by being found.
     */
    function releaseHolds() {
      allBalls((arr) => {
        for (const b of arr) b.hold = 0;
      });
      if (held.ball) {
        held.ball.hold = 0;
        held.ball = null;
      }
    }

    let carryC: HTMLCanvasElement | null = null;
    function carry(w: number, h: number): HTMLCanvasElement | null {
      if (!carryC) carryC = document.createElement("canvas");
      if (carryC.width !== w || carryC.height !== h) {
        carryC.width = w;
        carryC.height = h;
      }
      const c2 = carryC.getContext("2d");
      if (!c2) return null;
      /* it is a copy, not a layer: whatever it held from the last resize has
         to be gone, or a shrink leaves the old edges showing round the new */
      c2.clearRect(0, 0, w, h);
      c2.drawImage(canvas!, 0, 0);
      return carryC;
    }

    /**
     * THE DATES HANG FROM THEIR WORD, MEASURED (founder, 2026-08-27: "should
     * align with the text NOW"). The left inset was a guess in CSS, and the
     * word this hangs under sits after the wall chip, whose width is the
     * wall's NAME — so no constant can be under it on every wall. It takes
     * the word's own box, the way the reserve takes the count's: chrome
     * states its place, nothing guesses at it.
     *
     * IT IS ITS OWN FUNCTION BECAUSE IT HAS TWO CALLERS, AND THE SECOND ONE
     * IS THE WHOLE FIX. It lived inline in `measure()`, and `measure()` runs
     * on a resize — so the anchor was recomputed when the WINDOW changed and
     * never when the WORD did. The word changes without the window: press a
     * date and "now" becomes "Aug 27". Nothing was ever going to put the
     * anchor back, because nothing resized.
     *
     * ITS LEFT EDGE NOW, NOT ITS CENTRE — and that retires a rule and a bug
     * with it. A hairline is centred under a word; a LIST is a column of
     * left-aligned words, and a column centred on a word's centre reads as
     * something that slipped. Centring also had to read the instrument's OWN
     * width, so the anchor moved whenever the widest date changed and had no
     * answer at all while the box was empty — and it needed a frozen-anchor
     * rule to stop the line wandering under a dragging hand (founder video,
     * 2026-08-27: "line is not only hard to drag, but moves around"), which
     * then froze against a word that had already changed ("why is timeline
     * not right under the word 'now'", 2026-08-28). An edge has none of that:
     * it is one number, read from the word, true whatever is hanging off it.
     */
    function hangRail() {
      const whenEl = document.querySelector(".jar-when");
      const railEl = dialRef.current;
      if (whenEl && railEl) {
        const wb = whenEl.getBoundingClientRect();
        if (wb.width > 0) {
          /* AGAINST THE ELEMENT, NOT A REMEMBERED NUMBER. The dates are
             mounted only while they are open, so every opening is a NEW box
             carrying no inline left at all — and a cache of the last value
             would look at an unchanged number and decline to write it,
             leaving the fresh list at whatever the stylesheet guessed. */
          const menuWidth = railEl.getBoundingClientRect().width || railEl.offsetWidth;
          const left = menuWidth > 0
            ? Math.max(8, Math.min(wb.left, window.innerWidth - menuWidth - 8)) : wb.left;
          const px = `${Math.round(left)}px`;
          if (railEl.style.left !== px) railEl.style.left = px;
        }
      }
    }

    function measure() {
      const rect = root!.getBoundingClientRect();
      /*
       * A DEGENERATE RECT IS A LIE, NOT A SIZE.
       *
       * `.jar` is `position: fixed; inset: 0`. It is the viewport by
       * construction and there is no state of the page in which it is one
       * pixel wide — so a rect that small is a measurement taken while the
       * subtree is mid-rebuild, and the old `Math.max(rect.width, 1)` wrote it
       * straight through as a real size. That is the wobble the mutation log
       * caught: three canvas resizes in two milliseconds on every keep, one of
       * them to a viewport of nothing.
       *
       * The window's own dimensions are the honest answer here and cost no
       * layout to read, so a rect that cannot be true defers to them rather
       * than being clamped into a shape the loop will act on.
       */
      const trueW = rect.width >= 2 ? rect.width : window.innerWidth;
      const trueH = rect.height >= 2 ? rect.height : window.innerHeight;
      view.w = Math.max(trueW, 1);
      view.h = Math.max(trueH, 1);
      const nextDpr = renderScale(view.w, view.h);
      /*
       * ONLY WHEN THE SIZE ACTUALLY CHANGED.
       *
       * Assigning `canvas.width` or `canvas.height` CLEARS the canvas to
       * transparent. The spec says so even when the value assigned is the one
       * already there, which is the part that bit: `measure()` runs on every
       * setup of the frame loop, and the loop is rebuilt whenever
       * `inspirations` changes — which is what saving a memory does. So every
       * keep threw away a full backing store, allocated an identical one, and
       * left a window in which the world is blank until the next frame draws.
       *
       * WHETHER THAT WINDOW IS THE BLINK REPORTED AFTER A SAVE IS NOT
       * ESTABLISHED. Recording the composited output either side of a forced
       * rebuild showed the same brightness dip with this guard and without it,
       * so it is committed as what it provably is — work that should not
       * happen, and a blank frame that should not be possible — and not as a
       * fix for that symptom.
       *
       * `draw` sets its own transform every frame (`ctx.setTransform` at the
       * top of the pass), so nothing here relies on the state reset that
       * resizing also performs. A real resize still clears, which is correct
       * and unavoidable: the backing store genuinely changed.
       */
      const cw = Math.round(view.w * nextDpr);
      const ch = Math.round(view.h * nextDpr);
      /*
       * AND WHEN IT DID CHANGE, CARRY THE PICTURE ACROSS.
       *
       * A recorded mutation log of a real keep settled what the paragraph
       * above could not. The canvas is resized THREE times inside two
       * milliseconds, six hundred milliseconds after the field closes —
       * exactly when the server's row arrives and rebuilds the loop. The
       * guard is working: three writes mean three genuinely different sizes,
       * a measurement wobbling while the subtree is mid-rebuild. So the
       * window is real, it is entered on every keep, and it is what the blink
       * is.
       *
       * Chasing the wobble is the wrong repair. A resize is allowed to change
       * the backing store — that is what it is for — and the world should
       * survive one either way, including the honest ones nobody has
       * complained about: dragging the window edge blanks the field today for
       * the same reason. So the old surface is blitted into the new one before
       * anything else can composite, and the frame on screen stays on screen
       * until a real frame replaces it. Whatever makes the size move, there is
       * no longer a blank to see.
       *
       * Stretched rather than re-laid out, on purpose: for the one frame this
       * lives, a picture at slightly the wrong scale is invisible and a black
       * screen is not. `draw` writes its own transform at the top of every
       * pass, so the identity transform this blit needs cannot leak into it.
       */
      if (canvas!.width !== cw || canvas!.height !== ch) {
        const pw = canvas!.width;
        const ph = canvas!.height;
        const keep = pw > 0 && ph > 0 ? carry(pw, ph) : null;
        canvas!.width = cw;
        canvas!.height = ch;
        if (keep) {
          ctx!.setTransform(1, 0, 0, 1, 0, 0);
          ctx!.drawImage(keep, 0, 0, pw, ph, 0, 0, cw, ch);
        }
      }
      canvas!.style.width = `${view.w}px`;
      canvas!.style.height = `${view.h}px`;
      /* DPR changed (zoom / monitor move): halo sprites are rastered in
         device pixels, so they re-raster here. */
      if (nextDpr !== view.dpr) {
        view.dpr = nextDpr;
        const pal = paletteRef.current;
        if (pal && pal.dpr !== view.dpr) paletteRef.current = buildPalette(root!, view.dpr, ctx!);
      }
      /* THE CHROME STATES ITS OWN SIZE. Reading it beats guessing at it —
         the guess was 92 plus forty of air, which is a fifth of a short
         viewport of field given away for nothing, and on a phone with a home
         indicator the guess was simply wrong. */
      /* WHAT THE BOTTOM CHROME ACTUALLY TAKES, measured rather than guessed.
         It was a rail in the right margin for a while and took nothing; it is
         two stacked bands along the bottom edge again — the timeline
         underneath and the names of the walls above it — and the field has to
         stop clear of both. The axis is the upper of the two, so the distance
         from the viewport's bottom to its top edge IS the reserve, at every
         viewport height and on every phone with a home indicator. Zero until
         it has mounted, which is one frame of a field a few pixels too tall
         and never a wrong layout that persists. */
      {
        /* WHATEVER IS ACTUALLY DOWN THERE, WHICHEVER THING IT IS.
           This measured the dial, because the dial was the bottom chrome. On
           2026-08-27 the founder moved the timeline up beside the word that
           summons it and turned it vertical — so the dial's box is now near
           the TOP of the screen, and `view.h - box.top` became almost the
           whole viewport. The clamp below would have caught it and handed the
           field a permanent forty-percent bite out of the screen: not a
           crash, just a world with far less ground in it, for a reason
           nothing on screen explains.

           So the reserve stops naming one piece of chrome and asks the
           question it always meant: of the things that sit along the bottom
           edge, which one reaches highest? Nothing there reserves nothing. */
        let highest = 0;
        {
          /* THE COUNT IS THE BOTTOM CHROME — the whole of it. The first
             rewrite of this block listed `.jar-mouth-rest` too, on the words
             "bottom chrome", and the mouth does not rest at the bottom: it
             rests mid-page, above the field, exactly where its own doc says
             it holds still so the companion cannot be moved by it. Measuring
             it handed the reserve nearly half the viewport and pushed the
             companion out of its place — found by the founder's eyes, not by
             a gate, because the jsdom stub had been taught the same wrong
             assumption (founder, 2026-08-27: "character is no longer in
             center"). One selector, one meaning. */
          const el = document.querySelector(".jar-saved");
          if (el) {
            const b = el.getBoundingClientRect();
            if (b.height > 0) highest = Math.round(view.h - b.top);
          }
        }
        /**
         * TWO RULES THE FIRST VERSION OF THIS BROKE, both the reserve's own,
         * both written a few hundred lines up before it was mine to break:
         *
         * `.jar-mouth` is deliberately NOT in the list. "A reserve measured
         * off the mouth's live height would make the world lurch" — the open
         * drawer is tall, and a reserve that grows when it opens re-lays the
         * whole field under a person who only started typing. The resting
         * chrome is the reserve; the drawer borrows the air above it.
         *
         * And nothing-on-screen KEEPS the reserve rather than zeroing it. The
         * count and the mouth exist at headquarters; down in the field they
         * are gone, and a reserve that collapsed on descent would slide the
         * ground underfoot mid-travel — the world moving when nobody moved
         * it. The reserve is a fact about the resting page, so between
         * measurable moments it simply holds. Zero only before the chrome
         * has ever mounted, which is one frame of a field a few pixels too
         * tall and never a wrong layout that persists.
         */
        const claimed = highest > 0 ? highest : view.dialH;
        /* A CEILING, AND IT IS A CATASTROPHE GUARD RATHER THAN A TIDY-UP.
           Two rows of small labels cannot honestly want two fifths of the
           screen; a number that large means the measurement is wrong, and the
           cost of believing it is a world with no field in it at all. It is
           set high on purpose — low enough to survive a nonsense reading,
           high enough that ordinary drift in the chrome's real height still
           reaches the layout and is still visible as itself. */
        view.dialH = clamp(claimed, 0, Math.round(view.h * 0.4));
      }
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
      const prevLo = view.layout.minCam;
      const prevHi = view.layout.maxCam;
      const wasRest = restPoints();
      let sec = 0;
      {
        const ref = cam.aiming ? cam.target : cam.y;
        for (let i = 1; i < wasRest.length; i++)
          if (Math.abs(wasRest[i] - ref) < Math.abs(wasRest[sec] - ref)) sec = i;
      }
      view.layout = computeLayout(view.w, view.h, view.dialH);
      /* Only when the rest points actually moved: this observer also fires
         for HQ's own content growing, and re-anchoring on that would yank a
         camera the reader is holding. */
      if (view.primed && (view.layout.minCam !== prevLo || view.layout.maxCam !== prevHi)) {
        const nowRest = restPoints();
        const landing = nowRest[Math.min(sec, nowRest.length - 1)];
        if (cam.aiming) {
          /* a move in flight keeps its destination's MEANING, not its old
             pixel value: it re-aims at the same section, from where it is */
          cam.target = landing;
          cam.aimFrom = cam.y;
          cam.aimT0 = performance.now();
        } else if (!gesture.dragging && !gesture.down) {
          cam.y = landing;
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
      /* …AND MEASURE TO THE INK, NOT TO THE AFFORDANCE. `.jar-board-acts`,
         the board's verbs, reserves its strip inside this block even though it
         sits at opacity 0 until the poster is hovered. Counting it put the
         companion 22px below centre on a 720px viewport — the body moved by a
         row nobody can see, which is the same complaint as centring on the
         slot instead of on the screen.

         Keyed off the DEVICE's hover capability, never the live :hover state.
         `@media (hover: none)` keeps those verbs permanently visible, and
         there they are ink and must still hold the floor up; where hover
         exists, reading their opacity per frame would make the body jump the
         moment the pointer crossed the poster. */
      const hqEl = measured.hqInner.current;
      let hqH = hqEl ? hqEl.offsetHeight : 0;
      if (hqEl && !matchMedia("(hover: none)").matches) {
        const ink = [...hqEl.children].filter(
          (c) => !c.classList.contains("jar-board-acts"),
        );
        const last = ink[ink.length - 1];
        if (last) hqH = last.getBoundingClientRect().bottom - hqEl.getBoundingClientRect().top;
      }
      const activityHome = hqEl?.classList.contains('jar-hq-inner--activities');
      // scrollHeight includes overflow; unlike the visible last child's bottom
      // it cannot make the mode flip as a person scrolls through the reading.
      const alreadyCompact=hqEl?.classList.contains('jar-hq-inner--compact');
      const activityInset=hqEl?parseFloat(getComputedStyle(hqEl)[alreadyCompact?'marginTop':'paddingTop'])||0:0;
      const naturalActivityHeight=hqEl?(hqEl.scrollHeight+(alreadyCompact?activityInset:0)):hqH;
      const activityLayout = homeActivityLayout(view.h, naturalActivityHeight, view.dialH, CHAR_SIZE);
      const compactHome = Boolean(activityHome && activityLayout.compact);
      if(compactHome) view.layout.fieldTop = view.h + 8;
      if(hqEl){
        hqEl.classList.toggle('jar-hq-inner--compact',compactHome);
        if(compactHome){
          hqEl.style.maxHeight=`${Math.max(0,activityLayout.contentLimit-activityInset)}px`;
          hqEl.setAttribute('data-jar-surface','home-reading');
          hqEl.setAttribute('tabindex','0');
        }else{
          hqEl.style.removeProperty('max-height');
          hqEl.removeAttribute('data-jar-surface');
          hqEl.removeAttribute('tabindex');
        }
      }
      /* THE CHARACTER IS ONE SIZE, EVERYWHERE (founder, 2026-08-28: "character
         shouldnt be responsive to screensize. it should always be consistent
         size").

         It used to be `clamp(view.h * 0.14, 84, 150)` and then shrunk again
         into whatever room headquarters had left — 126px on a tall desktop,
         84 on a laptop, down to CHAR_MIN on a short window. Two rules, both
         reasonable on their own, and together they meant the one character in
         the product had no fixed identity: it was a different creature on
         every screen, and on a short one it read as one more orb.

         It is not a layout element. It is the being you are talking to, and a
         being does not change size because the window did. Everything else in
         headquarters is text and chrome and can reflow; this cannot, because
         its size IS part of what it is.

         So the slot no longer decides the body. The body is a constant and the
         SLOT gives way — `companion.y` still clamps into whatever room there
         is, which keeps it out of the poster and off the mouth wherever that
         is possible, and where it genuinely is not possible the section is
         honestly too short rather than quietly repopulated with a smaller
         character. */
      const gap = 24;
      /* THE MOUTH STANDS ON THE SEAM, so headquarters ends above it rather
         than at it. The strip is a CONSTANT (see MOUTH_H): a reserve measured
         off the mouth's live height would move the companion every time a
         line of typing wrapped, and the layout moves only when you move it. */
      const seam = view.layout.fieldTop - MOUTH_H;
      companion.size = CHAR_SIZE;
      /*
       * NO GRID SNAP HERE, AND THE REASON IS WORTH KEEPING.
       *
       * A previous pass floored this to a whole number of MACHINE_CELLS, to
       * buy an integer cell for an agent's stepped body. It bought nothing and
       * cost something. Nothing, because the body is drawn at `bw = size *
       * (1 + sq)` with the bob's squash breathing ±2.2% every frame, so the
       * visible cell was fractional and moving whatever `size` was. Something,
       * because `Math.max(2, …)` put a 40px floor UNDER the `avail` clamp
       * directly above — the clamp that keeps the body off the peek line on a
       * short viewport, and the exact regression the comment above it says had
       * already been fixed twice.
       *
       * The features quantise against the body's own live cell instead (see
       * the eye and nub passes), which is what actually makes them agree.
       */
      /**
       * WHAT HANGS OFF THE CHIN COUNTS AS PART OF THE COMPANION.
       *
       * Founder, on a phone: "things feel so skewed to the bottom."
       *
       * The band below centred the BODY between the reading and the box, and
       * that was right when the only thing under the chin was a one-line
       * receipt. It is not right now: the claim lives there — a sentence and
       * three answers — so the thing a person actually sees as "the creature"
       * is a block two hundred pixels taller than the body, and centring the
       * body left all of that growing downward into the gap above the box
       * while the air above the body stayed untouched. The result reads as a
       * screen with a hole in the lower third.
       *
       * Measured, not assumed, and for the same reason the box's own height
       * is measured: the voice block is a claim or a receipt or nothing at
       * all, and a constant would be wrong two of those three times.
       */
      /**
       * ═══ THE COMPANION'S HEIGHT IS A FUNCTION OF THE WINDOW, AND OF
       *     NOTHING ELSE ════════════════════════════════════════════════
       *
       * Founder ruling, twice: "make sure character is always at same
       * position so changing between me and my agent doesn't change position
       * of the agent", and "Even if the agent hasn't formed anything, the
       * height where the top of mind goes should always be the same so that
       * the character doesn't move vertically."
       *
       * THAT RULING WAS BEING VIOLATED BY THIS LINE. `companion.y` was
       * `(lo + hi) / 2`, where `lo` was measured from the live poster and
       * `hi` from the live claim. Replicating the layout pass numerically
       * against the real constants, the creature drifted:
       *
       *   top of mind grows to 5 lines           +38px down
       *   top of mind grows to 7 lines           +75px down
       *   claim wraps to 3 lines                 -12px up
       *   the person presses "Not true"          -19px up
       *
       * 75px is 62% of the creature's own body, and the last row is the
       * worst of them: a normal press in the main loop moved the character.
       *
       * AND THE TWO BLANK RESERVES WERE A PATCH OVER THIS, not a design.
       * `.jar-char-say`'s `min-height` existed only because `voiceH` was in
       * this equation; `.jar-hq-inner`'s only because `hqH` was. Both have
       * been deleted, because nothing reads the heights any more — which is
       * what removes the "hole in the lower third" the comment below this
       * block used to describe, on exactly the screens where it was worst.
       *
       * AND THE VOID WAS UNBOUNDED BY CONSTRUCTION. "The middle of what is
       * left" splits every extra pixel of window height evenly into two
       * gaps, with no cap:
       *
       *   iPhone 15 Pro   (760)   128px above, 78px below — 27% of the screen
       *   MacBook Pro 14" (890)   173 / 123              — 33%
       *   iPad Pro 11"   (1100)   298 / 248              — 50%
       *   27" 1440p      (1330)   392 / 342              — 55%
       *
       * `home.css` caps the column at `max-width: 680px`. There was no
       * vertical equivalent anywhere, and that is the whole of it: the
       * horizontal axis stops growing and the vertical one never did.
       *
       * WHY 0.34 AND NOT 0.5. NN/g's scrolling-and-attention work puts more
       * than 65% of above-fold viewing time in the TOP HALF of the viewport,
       * so the vertical middle of a tall window is not the attention centre
       * — parking the creature at 50% is a demotion, not neutrality. Google's
       * own homepage declines to vertically centre for the same reason, and
       * solves the surplus the way this now does: clamp the band, and let the
       * extra height fall into ONE declared place rather than two accidental
       * ones.
       *
       * THE OCT 8 INSTRUCTION SURVIVES, ITS IMPLEMENTATION DOES NOT. "place
       * this text input box at the bottom of the space. so i want equal space
       * between the top of mind, character, and input box" is right on a
       * phone, where there is no surplus to distribute. As a RATIO it turns
       * every pixel of desktop height into void — and equal spacing is
       * anti-hierarchy by definition: Gestalt proximity says elements
       * separated by whitespace read as less related, so two equal 400px gaps
       * dissolve the statement, the creature and the box into three unrelated
       * things. That is the founder's "information hierarchy" complaint,
       * arrived at by arithmetic.
       */
      const Y_MIN = POSTER_SLOT + gap + CHAR_SIZE * 0.5;
      /* ═══ THE CENTRE, BECAUSE THAT IS WHERE A COMPANION STANDS ════════
         Founder: "I wanted the character to be at the very very center,
         center vertically and center horizontally, but it looks a little
         more skewed towards the top, which I don't like."

         WHAT WAS HERE AND WHY IT IS NOT A LOSS. 0.42 with a 620 ceiling was
         argued from NN/g's "false floor" — a page with little at the top
         leaves people unsure anything else exists — and from attention data
         that wants content high. Both were reasoning about a PAGE. This
         screen stopped being a page: the statement moved into the bubble,
         the claim moved down onto the dock, and the composer left the
         middle entirely. What is left in the centre band is one creature,
         and the thing those rules protect against — a reader thinking the
         screen ends — cannot happen on a screen whose bottom edge is a
         navigation bar that is always visible.

         So the creature is centred, and the composition is symmetrical
         about it: the bubble above, the dock and the claim below, the same
         air each side. `Y_MIN` still binds on a window too short to hold
         the poster and the body at once, which is the one case where
         centring would overlap them. The ceiling is gone — it existed only
         to keep the cluster above centre, which is the thing being
         undone. */
      /* THE ONE CONTENT-DEPENDENT CLAMP LEFT, and it only ever engages on a
         window too short to hold the composition at all. Without it the body
         would sit ON the box rather than above it, and an overlap is a worse
         failure than a short window moving the creature once. On every window
         tall enough for `Y_MAX` to be reachable it never binds. */
      const floor = seam - CHAR_SIZE * 0.62 - gap;
      companion.y = compactHome
        ? -view.h * 3
        : Math.min(Math.max(Math.max(Y_MIN, view.h * 0.5), 0), Math.max(floor, CHAR_SIZE));
      /* WHAT SITS UNDER THE COMPANION, AND IN WHAT ORDER (founder, 2026-08-25:
         "keep something should be shown right below the character").
         The mouth first, directly beneath the body, because keeping something
         is what this page is FOR and it should be under the hand before
         anything else is. The companion's own line goes below the mouth: it
         reports what the loop did, and it says so in the mouth's own slot
         rather than in a row of its own — one place, one line. */
      const chin = Math.round(companion.y + companion.size * 0.62);
      /* The box no longer hangs off the chin — it is pinned to the bottom in
         `home.css`. The variable stays for the compact case, which stacks
         rather than centres. */
      root!.style.setProperty("--jar-mouth-top", `${compactHome ? activityLayout.composerTop : chin + 18}px`);
      /**
       * ═══ AND THE BOX COMES UP TO MEET THE CREATURE ══════════════════════
       *
       * Founder, after a night of work on this screen: "not much seemed to
       * have changed." Signed in and looked at it, which I should have done
       * far earlier: on a 1512x900 window the creature floats with roughly
       * 380px of dead black beneath it — 42% of the screen — because the box
       * is pinned to the viewport floor and the creature is not. The 1040px
       * composition ceiling added earlier never engages at laptop heights, so
       * for the window most people actually use, nothing had changed at all.
       *
       * THE BOX IS NOT A VIEWPORT OBJECT. It is the last element of the
       * creature's cluster — the statement, the creature, its question, and
       * the place you answer back — and a cluster whose last element is
       * nailed to the bottom of whatever monitor you own is not a cluster.
       * Gestalt proximity is the whole of it: elements separated by
       * whitespace read as less related, so 380px of gap dissolves the box's
       * relationship to the thing it belongs to. That is the "information
       * hierarchy" complaint, measured.
       *
       * So it hangs below the voice block, which hangs below the chin. The
       * surplus falls BELOW the box, in one pool, where it is the margin of a
       * page rather than a hole inside a picture.
       *
       * READING `voiceH` HERE IS SAFE, and it is worth saying why given the
       * commit that removed it from the creature's own position. The rule is
       * that the CREATURE must not move with content. The box moving as a
       * question appears beneath it is not a violation — it is the cluster
       * breathing, and the person caused it by having something to answer.
       *
       * THE FLOOR IS THE LAST CLAMP. On a window too short to hold the
       * cluster, the box stops descending and sits on its own inset rather
       * than travelling off the bottom edge — the same `max()` the CSS used
       * to do alone.
       */
      /* ═══ AND THE STATEMENT TRAVELS WITH THE CLUSTER ═══════════════════
         The band is the first element of the group, not a banner nailed to
         the top of the window. Left at `top: 0` it stayed put while the
         creature descended, so on a tall window the statement sat alone up
         top with ~290px of black between it and the thing it belongs to —
         two groups again, which is the defect this whole pass is about.

         `Y_MIN` is exactly the band's height plus the gap plus half a body,
         so `Y - Y_MIN` is the distance the band has to come down to keep its
         FOOT the same 24px above the creature at every window height. At the
         shortest windows it resolves to zero and the band sits where it
         always did. */
      const voiceH = measured.charSay.current?.offsetHeight ?? 0;
      const boxH = slotH.current || MOUTH_H;
      const inset = 8;
      const wanted = chin + 18 + voiceH + gap;
      const floorTop = view.h - boxH - inset;
      root!.style.setProperty(
        "--jar-band-top",
        `${compactHome ? 0 : Math.round(Math.max(0, companion.y - Y_MIN))}px`,
      );
      root!.style.setProperty(
        "--jar-box-top",
        `${compactHome ? activityLayout.composerTop : Math.round(Math.min(wanted, floorTop))}px`,
      );
      /* AND HOW TALL THE BOX IS, so the companion's voice can never reach it.
         The voice block hangs from the chin and grows DOWNWARD; the box is
         pinned to the bottom and grows UPWARD. Nothing stopped them meeting,
         and on a short window they met — the claim's card sat on the box's
         top edge and the keep receipt was printed through it (founder: "so
         crowded!"). Measured rather than assumed: MOUTH_H was a constant for
         this once and went stale the moment the composer grew a footer, and
         a reserve that drifts from the thing it reserves for is a collision
         waiting for a narrower window. */
      const slot = root!.querySelector<HTMLElement>(".jar-mouth-slot");
      if (slot) {
        slotH.current = Math.round(slot.offsetHeight);
        root!.style.setProperty("--jar-mouth-h", `${slotH.current}px`);
      }
      /* AND THE CHARACTER STATES ITS SIZE, rather than being guessed at.
         The same rule as the seam and the mouth's top: chrome states its
         place, nothing guesses at it. It is a constant now (CHAR_SIZE), and
         writing it here is what lets that be CHECKED — the body is painted on
         a canvas, so without a stated number the only way to ask how big the
         character is would be to measure its glow, and its glow is clipped by
         a narrow viewport and merges with whatever is lit beside it. */
      root!.style.setProperty("--jar-char", `${Math.round(companion.size)}px`);
      /* AND WHERE ITS MIDDLE IS, so chrome that stands BESIDE the character
         can stand beside the character rather than beside a guess at it.
         `.jar-way` — the neighbouring wall's name at each edge — was placed at
         47% of the viewport height, a proportion that happens to land near the
         creature on a tall window and does not on a short one. At 360x640 with
         a claim open, the column reaches y=304 and 47% is y=301: the rail
         printed straight through `written by hand`. The companion's own clamp
         already keeps it below the column, so a rail that hangs off the
         companion inherits that clearance instead of re-deriving it. */
      root!.style.setProperty("--jar-char-mid", `${Math.round(companion.y)}px`);
      /* the columns' DOM measures itself off these — one write per resize */
      root!.style.setProperty("--jar-vw", `${Math.round(view.w)}px`);
      root!.style.setProperty("--jar-vh", `${Math.round(view.h)}px`);
      /* the seam, so the mouth hangs off exactly the line the field's top
         edge peeks over — one number, measured, never duplicated in CSS */
      root!.style.setProperty("--jar-seam", `${Math.round(view.layout.fieldTop)}px`);

      /* homes are assigned after the companion has its slot, so the peek row
         can be told to keep clear of it */
      assignHomes();
      cam.xTarget = (trip.active ? trip.dest : trip.col) * view.w;
      if (!trip.active && !cam.xBack) cam.x = trip.col * view.w;
      if (!view.primed) {
        /* first sizing: everything starts on its home, then pours or fades in */
        for (const b of list) {
          b.x = b.homeX;
          b.y = b.homeY;
        }
      }
      view.primed = true;
      /* The volume is a real, world-tall gradient: the sky at the top is a
         different place from the deep. It starts one viewport above HQ, so it
         covers all three sections. */
      const atmos = measured.atmos.current;
      if (atmos) {
        atmos.style.top = `${Math.round(view.layout.minCam)}px`;
        atmos.style.height = `${Math.round(view.layout.layoutH - view.layout.minCam)}px`;
      }
      /* the sky's sentence stands at the sky's own height, in world space —
         42% down the topmost frame, the place the arrival chrome used to
         claim on screen. Written here beside the volume's box because both
         are facts about where the sky IS, not about who is looking. */
      {
        const hqEl = measured.hq.current;
        if (hqEl) {
          hqEl.style.setProperty(
            "--jar-sky-top",
            `${Math.round(view.layout.minCam + view.h * 0.42)}px`,
          );
        }
      }
      hangRail();
      if (!view.motesPlaced) {
        view.motesPlaced = true;
        /* the same stillness for the dust: a save must not re-scatter it */
        for (let i = 0; i < MOTES; i++) {
          moteX[i] = ((mix32(hashStr(`mote:x:${i}`)) >>> 8) / 0x1000000) * view.w;
          moteY[i] = ((mix32(hashStr(`mote:y:${i}`)) >>> 8) / 0x1000000) * view.h;
        }
      }
      cam.y = clamp(cam.y, minCamNow(), view.layout.maxCam);
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
      const dist = Math.abs(target - cam.y);
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
      const durD = 240 + 220 * (dist / Math.max(view.h, 1));
      cam.target = target;
      cam.aimDur = view.reduced ? 1 : clamp(Math.min(durV, durD), 170, 460);
      cam.aimFrom = cam.y;
      cam.aimT0 = performance.now();
      cam.aiming = true;
      wake();
    }

    function snapSection(vel: number) {
      /* rooms have no sky: their columns rest at HQ and jar only */
      const rest = restPoints();
      let i = 0;
      while (i < rest.length - 2 && cam.y >= rest[i + 1]) i++;
      const a = rest[i];
      const b = rest[i + 1];
      gesture.snapAt = 0;
      /* DIRECTION-BIASED COMMIT. A deliberate pull that stops short of the
         midpoint used to spring all the way back with no explanation; every
         native sheet in the layout commits at a quarter to a third, because
         refusal has to be EARNED. Pull toward a section and a third of the
         way is enough; drift back the other way and it takes two thirds. */
      const p = clamp01((cam.y - a) / Math.max(b - a, 1));
      aimTo(
        vel > FLICK ? b : vel < -FLICK ? a : vel > 0 ? (p > 0.33 ? b : a) : p > 0.67 ? b : a,
        vel,
      );
    }

    /**
     * `only` is the set to pour — the wall you have just walked into. Left out,
     * it is the CURRENT WALL'S ground, filtered the same way homes are
     * assigned. It used to be the whole `list`, "which is what the first open
     * wants" — true when the list held only your own archive, and a leak the
     * moment the list grew every wall's balls (founder, 2026-08-30: thirteen
     * orbs on a ground that honestly holds one — your keep placed, and two
     * agents' twelve drifting unplaced but poured active). Every wall reached
     * by TRAVELLING always used the narrow form, which is why the leak only
     * ever showed on the wall you open into.
     *
     * Arriving needs the narrow form for two reasons. The stagger is
     * POUR_MS/length, so pouring all 128 balls to show the 9 that belong here
     * spreads those 9 across two seconds of mostly-empty slots. And more
     * importantly nothing else activates them: arriveColumn re-ran the LAYOUT
     * and gave every newly-present ball a home, but `active` is only ever set
     * by `enter` (through a pour) or by `settleInstantly`, so a wall reached by
     * travelling had homes assigned to orbs that were never switched on. That
     * is the empty ground under a group's sky.
     */
    function primePour(only?: Ball[]) {
      const t0 = performance.now() + 300;
      /* Newest first: the peek band is the invitation, so it must fill on the
         first beat rather than the last. Nothing stacks in a float field, so
         arrival order no longer has to build the strata. `applyPresence` owns
         who is lit; this only stages the arrival's animation over its set. */
      const order = (only ?? presentBalls()).slice().sort((a, b) => b.capturedMs - a.capturedMs);
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
      pour.step = clamp(POUR_MS / Math.max(order.length, 1), 17, 35);
      const step = pour.step;
      order.forEach((b, i) => {
        b.active = false;
        b.spawnAt = t0 + i * step;
      });
      pour.active = true;
    }

    /** Reduced motion: no arrival animation — every orb starts at home. */
    function settleInstantly() {
      applyPresence();
      for (const b of presentBalls()) {
        b.spawnAt = -1;
        b.arrive = 1;
        b.x = b.homeX;
        b.y = b.homeY;
      }
      pour.active = false;
      pour.done = true;
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

      /* the arrival the founder likes, kept: oldest first, 60ms apart, each
         orb entering from above its home */
      if (pour.active) {
        let waiting = false;
        let arriving = false;
        for (const b of list) {
          if (b.spawnAt > 0) {
            waiting = true;
            if (now >= b.spawnAt) {
              b.spawnAt = -1;
              if (b.capturedMs <= TRef.current) enter(b);
              else b.active = false;
            }
          } else if (b.active && b.arrive < 1) {
            arriving = true;
          }
        }
        if (!waiting && !arriving) {
          pour.active = false;
          pour.done = true;
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
          const dx = view.reduced ? 0 : b.ampX * stir.amp * Math.sin(t * b.rateX + b.phX);
          const dy = view.reduced ? 0 : b.ampY * stir.amp * Math.sin(t * b.rateY + b.phY);
          const rise = (1 - overshoot(b.arrive)) * b.entryH;
          /* THE LIFT. A memory this wall's claim rests on rises out of the
             ground to sit under the poster, and settles back into its own
             place as you descend into the field. It is done as an effective
             HOME, not as a clamp on position, so the orb keeps its own drift
             the whole way and reads as carried rather than pinned — and it is
             driven by the camera's own position, so it reverses by itself and
             the layout moves only because you moved it. Its field home (what
             assignHomes solved) is never touched. */
          const homeX = b.peek ? lerp(b.homeX, b.peekX, lift) : b.homeX;
          const homeY = b.peek ? lerp(b.homeY, b.peekY, lift) : b.homeY;
          const tx = homeX + dx;
          const ty = homeY + dy - rise;
          /* easing toward the target rather than assigning it is what lets a
             re-assigned home (scrub, resize) be absorbed as a glide */
          const k = view.reduced ? 1 : 1 - Math.pow(0.001, dt);
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
          b.x = clamp(b.x, b.colX + lo + b.r, b.colX + hi - b.r);
        }
      };

      /* ONE FIELD, AND IT IS SCREEN-ANCHORED SIDEWAYS. Its x is a screen
         coordinate, not a layout one, so the memories stay exactly where they
         are while the walls slide past above them — which is the whole image:
         your memories are the ground and the walls are what different contexts
         make of them. (The draw pass adds camX back, the way the companion's
         own screen anchor does.) */
      moveField(list, view.layout.wallL, view.layout.wallR);

      /* A newborn whose keep did not land has finished fading: it leaves the
         ground, and the field closes over the space exactly as it does for a
         scrub. Only ever walked while one is actually pending. */
      if (pour.doomed > 0) {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i];
          if (b.doomed !== true || b.active) continue;
          pour.doomed--;
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
      companion.insp = clamp01(sum / k);
      const dayStart = TRef.current - DAY_MS;
      companion.freshToday = false;
      for (const b of list) {
        if (b.active && !b.leaving && b.capturedMs >= dayStart) {
          companion.freshToday = true;
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
    /* EXPOSED TO THE COMPONENT, because the creature is pressed from the
       DOM and spoken from the loop. See `creatureSpeaks`. */
    sayLineRef.current = sayLine;
    function sayLine(): string {
      /* PARKED, NOT SCRUBBING. This read `scrubbingRef` — true only while a
         finger was on the rail — so the line existed for the duration of a
         gesture and never once after it. The rail is gone; being wound back
         is a STATE you sit in, and it is the state in which this sentence is
         the only true thing the companion has to say. The sentence itself is
         the message catalogue's, in whichever hand the wall is written in. */
      if (parkedRef.current !== null)
        return formatMessage(localeRef.current, "worldAsItWasIn", {
          month: monthTag(TRef.current, localeRef.current),
        });
      const pick = (keys: MessageKey[]): string => {
        const opts = keys.map((k) => t(localeRef.current, k));
        const fresh = opts.filter((o) => o !== companion.lastSaid);
        const s = (fresh.length ? fresh : opts)[Math.floor(Math.random() * (fresh.length || opts.length))];
        companion.lastSaid = s;
        return s;
      };
      /* An empty archive is the one state every single person passes through,
         and the layout's own vocabulary pointed at the dark beats any
         instruction: it asks for one thing, once, and then goes quiet. */
      if (trip.inspCol === 0 && list.every((b) => !b.active || b.leaving))
        return pick(["worldSayEmpty1", "worldSayEmpty2"]);
      /* THE FRONTIER FIRST, because it is the only thing here that points
         forward. It names where nothing has been built yet, never how much is
         left — a compass, not a progress bar. */
      const open = list.filter((b) => b.active && !b.leaving && b.frontier).length;
      if (open > 2 && Math.random() < 0.55)
        return pick(["worldSayFrontier1", "worldSayFrontier2"]);
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
      if (trip.inspCol > 0 && trip.inspCol < 4)
        return pick(["worldSayYoung1", "worldSayYoung2"]);
      if (companion.insp > 0.55) return "";
      if (companion.insp > 0.22)
        return pick(["worldSayWarm1", "worldSayWarm2"]);
      return pick(["worldSayQuiet1", "worldSayQuiet2", "worldSayQuiet3"]);
    }

    /** An orb enters from above its home and eases down into it. */
    function enter(b: Ball) {
      /* Only the scene's own balls are ever staged (`primePour` reads
         `presentBalls()`), so entering needs no wall test any more — the
         scene container made the foreign-ball case unrepresentable. */
      b.active = true;
      b.gone = 0;
      b.arrive = view.reduced ? 1 : 0;
      /*
       * IT ENTERS FROM JUST ABOVE WHERE IT IS ACTUALLY GOING.
       *
       * `entryH` is spent by the draw as `rise` against the EFFECTIVE home —
       * the peek-lifted one, `lerp(homeY, peekY, lift)` — while this measured
       * it from the field home that the lift is carrying the orb away from.
       * For an orb in the peek row those are far apart: the row sits up under
       * the poster and the field home is near the bottom of the world. So the
       * entrance began a couple of hundred pixels above HEADQUARTERS instead
       * of above the row, and a memory arrived out of the sky rather than out
       * of the ground.
       *
       * `born` has always measured against the lifted home — that is how a
       * newborn comes out of the sentence instead of off the top of the
       * screen — and this is the same sum, for the orbs that arrive by pour.
       *
       * It was invisible while a rebuild re-poured the WHOLE field: every orb
       * did it at once and it read as the world re-staging, which was the
       * louder bug. With only genuinely new memories pouring, one orb does it
       * alone, and then it is the only thing moving on the screen.
       */
      const enterLift = peekLift();
      const fromY = b.peek ? lerp(b.homeY, b.peekY, enterLift) : b.homeY;
      /* AND A PEEK ORB ENTERS FROM BELOW (founder's recording, 2026-08-25:
         "the balls fly wierdly"). "From just above where it is going" is
         right for an orb landing in the field — the fall is short and happens
         down in the ground. A PEEK orb lands under the poster, so from-above
         started it mid-headquarters and the pour's stagger turned arrival
         into a two-second rain of spheres past the companion and the mouth.
         The lift's own sentence is that these memories RISE out of the ground
         to sit under the claim that stands on them — so the entrance rises
         too: negative height, spent by the same `rise` term in the draw.
         Motion explains, and this motion now explains the right thing. */
      b.entryH = b.peek ? -(60 + b.frac * 70) : 90 + b.frac * 110;
      b.x = b.peek ? lerp(b.homeX, b.peekX, enterLift) : b.homeX;
      b.y = fromY - (view.reduced ? 0 : b.entryH);
    }

    function reconcileScrub() {
      const T = TRef.current;
      /* did the SET of present orbs change? only then are homes re-assigned.
         The scrub winds one wall's ground — the scene's — never the world's:
         with `enter` no longer carrying a wall refusal, sourcing the scene
         here is what keeps a foreign ball unlightable by the dial. */
      const w = curWall();
      let changed = false;
      const entering: Ball[] = [];
      for (const b of sceneBalls(w.id)) {
        if (pour.active && b.spawnAt > 0) {
          colorBall(b, T);
          continue;
        }
        const want = b.capturedMs <= T && standingOk(b, w);
        const present = b.active && !b.leaving;
        if (want !== present) {
          changed = true;
          if (!want) {
            if (view.reduced) {
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

    /**
     * Is the detail panel open right now? An ACCESSOR, and deliberately not a
     * value.
     *
     * The field's painter needs this to know whether to lay the focused
     * memory's wide outer ring down — a ring that reaches under an open card,
     * and light must live behind a panel, never on it. The ref it reads is
     * re-pointed by React while this loop is still running, so a boolean
     * captured when the painter was wired up would be frozen at whatever was
     * true then. Nothing would report that: the ring would simply stop
     * answering the panel, and the picture would keep drawing. Declared once
     * out here rather than inside `draw` so the frame does not allocate a
     * closure sixty times a second to ask one question.
     */

    const grid = (v: number): number => {
      if (mech < 0.02) return v;
      const q = 1 + mech * 7;
      return Math.round(v / q) * q;
    };

    function draw(now: number) {
      const pal = paletteRef.current;
      ctx!.setTransform(view.dpr, 0, 0, view.dpr, -cam.x * view.dpr, -cam.y * view.dpr);
      /* ═══ ASK FOR THE GOOD DOWNSCALE, BECAUSE WE ALWAYS DOWNSCALE ═══════
         Founder, on an iPhone: "케릭터 화질 왜이래 휴대폰으로 볼때?" — the
         creature soft and smeared, while the same build on a desktop is
         clean.

         IT IS NOT THE PIXEL RATIO. Measured on a 393x852 viewport at
         devicePixelRatio 3: the backing store is 1179x2556, a ratio of
         exactly 3.0 — one drawn pixel per physical pixel. The 2026-09-08
         fix in `canvas/scale.ts` holds.

         IT IS THAT EVERY BODY IS DRAWN AT HALF ITS BAKED SIZE. `BODY_PX` is
         240 and `CHAR_SIZE` is 120, so the sprite is a deliberate 2x
         supersample and the loop resamples it down 0.5x on every frame, on
         every device — the geometry is IDENTICAL on desktop and phone, which
         is why the ratio could not be the answer.

         SO THE ONLY VARIABLE LEFT IS THE FILTER, and we never chose one.
         `imageSmoothingQuality` defaults to "low". Chrome's "low" survives a
         halving; WebKit's does not, and a halved pixel grid is the worst
         case for it — which is exactly why the agent, whose body is
         quantised into hard cells by `pixelate`, looks the most destroyed.

         SET EVERY FRAME, NOT ONCE AT SETUP. Assigning `canvas.width` resets
         the whole 2D context state, and `measure()` reassigns it on every
         resize and on every rebuild of this loop — a flag set at setup would
         be silently dropped the first time the window changed. It is a
         property write on a context that is about to issue hundreds of draw
         calls; the cost is not measurable against them. */
      ctx!.imageSmoothingQuality = "high";
      ctx!.clearRect(cam.x, cam.y, view.w, view.h);
      if (!pal) return;
      const t = now / 1000;

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
          sparkX[i] * view.w + cam.x - sr,
          sparkY[i] * view.h + cam.y - sr,
          sr * 2,
          sr * 2,
        );
      }
      const thin = clamp01(-cam.y / Math.max(view.h, 1));
      for (let i = 0; i < MOTES; i++) {
        const mr = moteR[i];
        const mx = moteX[i] + Math.sin(t * 0.5 + moteP[i]) * 9;
        /* every third mote thins away as the camera climbs into the sky */
        ctx!.globalAlpha =
          moteA[i] * (i % 3 === 0 ? 1 - thin * 0.85 : 1) * lerp(0.6, 1.15, companion.inspNow);
        ctx!.drawImage(pal.mote, mx + cam.x - mr * 3, moteY[i] + cam.y - mr * 3, mr * 6, mr * 6);
      }

      /* passes 1 and 2 — THE GROUND. Every memory's diffuse bloom laid down in
         additive light, then every memory's disc drawn over it. One appearance
         in two loops: the disc reads as lit from within precisely because its
         own bloom is already underneath it, so the two are not separable and
         they left together. `space/inspiration/field-paint.ts`. */
      paintField({
        ctx: ctx!,
        pal,
        list,
        order,
        cam,
        view,
        t,
        depthSpan: Math.max(view.layout.fieldBottom - view.layout.fieldTop, 1),
        selId: selectedIdRef.current,
        still: pour.active,
        mech,
        grid,
        panelOpen: () => panelOpenRef.current,
      });

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
      const lit = clamp01(companion.inspNow + companion.flare * 0.5 + companion.freshLit);
      const bodyLit = clamp01(0.55 + lit * 0.45);
      /* Whose form it is wearing where the camera is right now — the body, the
         silhouette its features clip to, and the halo, all from one place so
         they can never disagree about which being is on screen. */
      const wear = worn(pal);
      /* THE DISSOLVE, ARMED AND MEASURED. The key change is detected here
         rather than at the arrival commit, so it cannot be missed by a code
         path that lands on a wall without going through `arriveColumn` — a
         resume, a deep link, a reduced-motion travel. The very first frame
         arms nothing: there is no previous form to come from. */
      {
        const key = spaceKey(curWall());
        if (form.key !== key) {
          /* ONLY A REAL CHANGE OF FORM IS WORTH DISSOLVING. `worn()` hands
             back `pal.body` itself for every wall that is not an agent's, so
             self→group and group→group travels would otherwise dissolve a
             sprite into the identical sprite — work, and a state flip, for a
             frame that cannot look different. Reference equality is the exact
             test: the bake is cached per being, so the same form is the same
             array. */
          if (form.key !== "" && !view.reduced && wornPrevBody !== wear.body) {
            form.prevBody = wornPrevBody;
            form.prevBe = wornPrevBe;
            form.prevMachine = wornPrevMachine;
            form.at = now;
          } else {
            form.prevBody = null;
          }
          form.key = key;
        }
        wornPrevBody = wear.body;
        wornPrevBe = wear.be;
        wornPrevMachine = wear.machine;
      }
      /* 0 → 1 across FORM_FADE_MS; 1 whenever nothing is dissolving */
      const formMix = form.prevBody ? clamp01((now - form.at) / FORM_FADE_MS) : 1;
      if (formMix >= 1) form.prevBody = null;
      /* WHICH FORM THE FEATURES BELONG TO. The eyes and the nubs are drawn
         live and clipped to a silhouette, so they cannot dissolve — they
         follow whichever body is the louder one this frame, and swap at the
         midpoint where both are at half and the swap is least visible. */
      const showPrev = formMix < 0.5 && form.prevBody !== null;
      const formBe = showPrev ? form.prevBe : wear.be;
      const formMachine = showPrev ? form.prevMachine : wear.machine;
      /* AND IT IS NOT DRAWN AT ALL WHILE A DESTINATION IS UP. Not moved —
         moved would mean it travels back when you leave, which is the world
         moving without anybody moving it. It simply is not painted, the way
         `.jar--aside` simply does not paint the bubble. Its ground, its
         vignette and its dust keep drawing, which is the whole point: they
         are what the page is standing on now. */
      if (!asideRef.current && companion.y - cam.y > -companion.size * 2 && companion.y - cam.y < view.h + companion.size * 2) {
        /* the bob rides its own integrated phase: while the companion leads
           it quickens toward a walk, and at rest it is the hover it was */
        /* THE FLOAT BECOMES A TICK. A sine is how something alive hovers; a
           machine's body arrives on frames. Same amplitude, same rate — only
           the resolution of the movement changes, which is the whole idea. */
        const bobRaw = view.reduced ? 0 : Math.sin(companion.bobPh) * 4 * stir.amp;
        /* the step grows with how far into the machine's mind we are: one
           pixel of quantisation at the boundary, four at the far side */
        const bobStep = 1 + mech * 3;
        const bob = mech < 0.02 ? bobRaw : Math.round(bobRaw / bobStep) * bobStep;
        /* it rides ahead of the world vertically as well as horizontally */
        const cyC = companion.y + bob + companion.lift;
        /* THE TRAVELER'S PLACE. The companion is screen-anchored — it is the
           one who travels, so the layout slides under it — and during a
           transition it rides ahead of centre by charOff, near the leading
           third of the screen, still bobbing. */
        const charSX = cam.x + view.w / 2 + companion.off;

        /* ---------------- THE ROOM'S COMPANY ----------------
           founder, 2026-08-27: "if room is group, show the character as many
           times as number of members are there. but the character should feel
           like its behind mine, and more small and subtle."

           One being per member, standing behind yours. Drawn BEFORE your
           aura and body, so yours occludes them and its emitted light washes
           over them — that wash is the depth cue, not a painted shadow.

           Each wears the form its own id derives (`agentBeing` is "a being,
           from an id and nothing else" — the owner's median proportions are
           punched out of its ladders, so none of them can wear yours), at
           half your size, in COOL light: raster.ts's invariant that your
           companion is the warmest body on any wall holds in a crowd too.
           Humans first, in the room's own member order — the same order the
           legend and the hues are numbered from — so the company reads in
           the same sequence everywhere the room is named.

           Size is ONE constant for all of them. A being's identity is shape,
           never size (body.ts: mass is constant), and a row of members at
           assorted sizes would read as a ranking nobody made. */
        /* EVERY ROOM IN FRAME, NOT ONLY THE ONE YOU STAND IN. During a
           crossing both columns are on screen at once — the room you are
           leaving and the room you are arriving at — and drawing only the
           current wall's company is what made a room look like it populated
           itself on arrival. */
        const companyCols: number[] = [];
        if (wallAt(trip.col)?.kind === "group") companyCols.push(trip.col);
        if (trip.active && trip.dest !== trip.col && wallAt(trip.dest)?.kind === "group") {
          companyCols.push(trip.dest);
        }
        /* the seats under the pointer, rebuilt each frame the company is
           drawn — hovering a member names it (see `companyHitRef`) */
        companySeats.length = 0;
        for (const col of company > 0.015 ? companyCols : []) {
          const colWall = wallAt(col)!;
          /* WHO STANDS WHERE IS A FACT, NOT A FRAME — and this loop was
             recomputing it sixty times a second. `groupCompanyPlaces` maps a
             room's members into fresh objects and the depth pass sorts a
             fresh copy on top, so a seven-person room was allocating an array
             and seven objects, twice, every frame it was on screen. Nothing
             in it can change without the member list changing, and that list
             arrives once per room.

             Found reviewing my own work rather than by a slow frame, but the
             precedent is why it matters: the last thing built into this exact
             loop put a 133ms frame in the middle of a travel glide. Cached on
             the member list's own identity, so a room that gains a member
             recomputes on the frame the new list lands and never again. */
          const seatedFor = (): CompanyPlace[] => {
            const from = membersRef.current.get(colWall.id);
            const held = companyPlacesCache.get(colWall.id);
            if (held && held.from === from && held.viewer === viewerIdRef.current) {
              return held.seated;
            }
            /* FAR ONES FIRST, so the near ones overlap them. A row painted in
               member order overlaps by accident; painted by depth it overlaps
               the way standing people do, and the overlap is most of what
               says "a group" rather than "a line". */
            const seated = groupCompanyPlaces(from, viewerIdRef.current).sort(
              (x, y) => y.depth - x.depth,
            );
            companyPlacesCache.set(colWall.id, {
              from,
              viewer: viewerIdRef.current,
              seated,
            });
            return seated;
          };
          /* the same light tier your own body wears: the first version baked
             them a tier dimmer AND cool AND at half alpha, and three
             subtlety channels stacked read as flat grey stone. Cool and
             alpha carry the "behind"; the bake keeps its gradient.
             AND THEN THE TIER LEARNED DEPTH (founder, 2026-08-27: "higher
             quality craft"; the research is written up in
             `group-company.ts`): one tier for everybody is what made three
             members read as three copies of one card. A member's own depth
             spends itself here, so the near ones stand in your light and the
             far ones fall a tier back — which is how a photograph separates
             planes, and the reason the group now has a front and a back. */
          const nearTier = Math.round(bodyLit * (BODY_TIERS - 1));
          const seated = seatedFor();
          /**
           * ONE BAKE PER FRAME. A bake is four 240px rasters, and a room of
           * seven arriving all at once put a 133ms frame in the middle of the
           * travel glide (measured live, this machine, dpr 1 — a retina
           * screen bakes four times the pixels). The company's alpha eases in
           * from zero over the same arrival, so members joining the frame one
           * at a time is not even visible: the ease IS the stagger's cover.
           * A member whose bake has not had its turn yet simply waits a
           * frame; nothing is skipped, only deferred.
           */
          let bakedThisFrame = false;
          for (const seat of seated) {
            const be = beingOf(seat.profileId);
            /* an agent member shares the bake its own wall uses — same key,
               same params — so the same creature is the same pixels */
            const key = seat.agent ? `agent:${seat.profileId}` : `member:${seat.profileId}`;
            if (!pal.beings.has(key)) {
              if (bakedThisFrame) continue;
              bakedThisFrame = true;
            }
            const sprites = bakeBeing(pal, key, be, true, seat.agent);
            /* further back is smaller: the arc's own perspective, and the
               half-size the founder asked for is the NEAREST member's size */
            const ms = companion.size * (0.5 - seat.depth * 0.07);
            const companyTier = Math.max(0, nearTier - (seat.depth > 0.55 ? 1 : 0));
            /**
             * FOUR WAYS OF STANDING (research, `group-company.ts`: a crowd
             * sharing one idle "breaks immersion immediately"; 3–5 variants
             * with staggered starts is the working number).
             *
             * Every member used to breathe on the same sine at its own rate,
             * which is one behaviour wearing different clocks — and at a
             * glance that reads as copies. These are four different things a
             * body does while waiting, each phased by the member's own id:
             *   0 breathes — the old hover, slowest and smallest
             *   1 sways — the weight drifts side to side as well as up
             *   2 shifts — mostly still, then settles onto the other foot
             *   3 waits — barely moves at all; its life is in the head turn
             * Reduced motion keeps every one of them at rest.
             */
            const ph = seat.phase * 6.283;
            let mbob = 0;
            let mswy = 0;
            if (!view.reduced) {
              const slow = t * 0.9 * be.bobRate + ph;
              if (seat.idle === 0) {
                mbob = Math.sin(slow) * 2.4 * stir.amp;
              } else if (seat.idle === 1) {
                mbob = Math.sin(slow) * 1.8 * stir.amp;
                mswy = Math.sin(slow * 0.6 + 1.1) * 2.6 * stir.amp;
              } else if (seat.idle === 2) {
                /* a long dwell, then a settle: `sin^7` is flat for most of
                   its period and moves quickly through the middle, which is
                   what shifting your weight looks like from across a room */
                const s = Math.sin(t * 0.32 * be.bobRate + ph);
                mswy = Math.sign(s) * Math.abs(s) ** 7 * 3.4 * stir.amp;
                mbob = Math.sin(slow) * 1.1 * stir.amp;
              } else {
                mbob = Math.sin(slow * 0.8) * 0.9 * stir.amp;
              }
            }
            const seatX =
              col * view.w + view.w / 2 + seat.dx * companion.size + mswy;
            const seatY = companion.y + seat.dy * companion.size + mbob;
            /* WHO THIS IS, WHEN YOU REACH FOR THEM (founder, 2026-08-27:
               "hovering/clicking on characters in the background should show
               the name of the person above the character temporarily and
               character should also brighten up temporarily"). The seats are
               canvas pixels, so the pointer needs the geometry the draw pass
               already knows; the hit list is rebuilt here rather than
               guessed at anywhere else. */
            const named = membersRef.current
              .get(colWall.id)
              ?.find((m) => m.profileId === seat.profileId);
            companySeats.push({
              id: seat.profileId,
              /* screen x (the draw is in world space, the pointer is not) and
                 world y, which is the space `onHover` already works in */
              x: seatX - cam.x,
              y: seatY,
              r: companion.size * 0.32,
            });
            /* NOTICED — the body answers in its own time, the NAME answers
               at once. The body's delay is the member's own (`notice`), so a
               room of seven turns to you raggedly instead of snapping round
               in unison, which is the difference between people and a chorus
               line; the name is the answer to the question the gesture asked
               and waits for nobody (founder, 2026-09-08). Both halves are
               computed in `noticeLight`, where the arithmetic can be tested
               without frames to run. */
            const since =
              companyNear.id === seat.profileId
                ? (performance.now() - (companyNear.until - NOTICE_MS)) / 1000
                : -1;
            const answer = noticeLight(
              since,
              seat.notice,
              companyNear.until - performance.now(),
            );
            const lit = answer.body;
            ctx!.save();
            /* ANCHORED TO THE ROOM, NOT TO YOU. `charSX` is the companion's
               screen-anchored x — the world slides under it, which is what
               makes it the traveller — and the first version hung the whole
               company off it, so leaving a room dragged the members along
               like luggage. They stand at the ROOM's own column: travelling
               away, the world slides them away with the wall they belong to
               while your companion alone moves. Their y is the resting
               anchor, not `cyC` — your bob and your lift are yours, and a
               chorus that breathes in sync with you reads as puppetry. */
            ctx!.translate(seatX, seatY);
            /* noticed, it comes up toward your own strength and settles back —
               light is the only meaning channel, so being seen IS more light.
               Depth is the other half: the far ones sit lower in the frame's
               range, which is what "falls into softer light" means when you
               have no depth of field to spend. */
            ctx!.globalAlpha = company * ((0.84 - seat.depth * 0.26) + lit * 0.16);
            /* A PRESENCE OF ITS OWN, and it is the difference between a being
               standing in a dark room and a sticker on it. The bake has
               always made each creature its own aura layers — the company
               simply never spent them, so members had no light around them
               at all and read as cut-outs on black. One layer, small and
               faint, and dimmer the further back it stands: enough to say
               something alive is there, never enough to compete with the
               warm bloom that is yours. */
            const halo = sprites.aura[0];
            if (halo) {
              ctx!.globalAlpha = company * (0.2 - seat.depth * 0.08 + lit * 0.16);
              const hs = ms * 2.6;
              ctx!.drawImage(halo, -hs / 2, -hs / 2, hs, hs);
              ctx!.globalAlpha = company * ((0.84 - seat.depth * 0.26) + lit * 0.16);
            }
            /* NO NUBS ON THE SMALL ONES (founder, 2026-08-27: "remove hands").
               They were added as anatomy in the quality pass and at half size
               they read as detached dots floating beside each silhouette —
               static circles cannot do what the companion's live nubs do,
               which is protrude from a turning form. A clean silhouette with
               a face is a creature; a silhouette with two loose beads is a
               diagram of one. */
            ctx!.drawImage(sprites.body[companyTier], -ms / 2, -ms / 2, ms, ms);
            /* THE FACE, AND IT IS NOT AT REST ANY MORE.
               It used to be two eyes, front-facing, no blink and no glance —
               written up as "a creature present rather than performing", and
               that reading was wrong in the way the founder photographed:
               present without any behaviour at all is a mask. Two cheap
               channels put life in it without giving it a performance.

               ONE: WHERE IT IS LOOKING. Games call this the reaction set,
               and the research calls it the most neglected and most missed
               part of an ambient character. A member looks at YOUR
               companion, and when your companion is attending to something
               (a memory you tapped) it looks that way instead, after its own
               delay — noticing what somebody near you is looking at is the
               most human thing a bystander does. It is a look, never a turn:
               the body stays put, which is what keeps this a room of people
               standing together rather than a crowd staring.

               TWO: BLINKING. Rare, slow, and out of step by id — a blink in
               unison would be the chorus line again. */
            bodyPath(ctx!, ms, ms, be);
            ctx!.clip();
            /* The same ink the companion's own eyes use — a member is the
               same species, and the literal was written out twice. */
            ctx!.fillStyle = EYE_INK;
            const er = ms * be.eyeR * 1.35;
            const eyY = ms * be.eyeLat;
            /* toward you, or toward what you are looking at — in the member's
               own local pixels, and never far enough to leave the face */
            const gazeAt = charSX + companion.eyeX * 8;
            const gaze = clamp((gazeAt - seatX) / (companion.size * 2), -1, 1);
            const gx = gaze * er * 0.5;
            /* the lid: `notice` doubles as the blink's offset, so the room
               blinks raggedly; ~5.5s apart, ~140ms closed */
            const bt = (t + seat.notice * 9 + seat.phase * 5.5) % 5.5;
            const lid = view.reduced ? 1 : bt < 0.14 ? Math.abs(bt / 0.07 - 1) : 1;
            for (const lon of [-be.eyeLon, be.eyeLon]) {
              const ca = Math.cos(lon);
              ctx!.beginPath();
              ctx!.ellipse(
                Math.sin(lon) * ms * FACE_R + gx,
                eyY,
                er * Math.max(ca, 0.2),
                er * Math.max(lid, 0.08),
                0,
                0,
                TAU,
              );
              ctx!.fill();
            }
            ctx!.restore();
            /* and the name, above them, for as long as the light lasts. It is
               the only place a member's name is written in the world, so it
               is written in the label register the rest of the chrome uses. */
            if (answer.name > 0.01 && named?.name) {
              ctx!.save();
              ctx!.globalAlpha = answer.name;
              ctx!.fillStyle = "#d6deea";
              ctx!.font = '500 11px Pretendard, -apple-system, "Segoe UI", sans-serif';
              ctx!.textAlign = "center";
              ctx!.letterSpacing = "0.14em";
              ctx!.fillText(
                named.name.toUpperCase(),
                seatX,
                seatY - companion.size * 0.34,
              );
              ctx!.restore();
            }
            ctx!.globalAlpha = 1;
          }
        }

        /* Squash-stretch coupled to the bob — and to the climb. Ascending it
           stretches a few percent and descending it compresses, which is the
           character's own response to being moved and not decoration on top
           of it. (Its LIGHT still obeys the rule that juice lives in the
           bloom; this is the body, and a body may act.) */
        const sq = view.reduced
          ? 0
          : Math.sin(companion.bobPh + 1.5) *
              0.022 *
              Math.max(MOOD_BOB_FLOOR, 1 + companion.mood * MOOD_BOB) -
            companion.pitch * PITCH_STRETCH +
            companion.ant;
        const bw = companion.size * (1 + sq);
        const bh = companion.size * (1 - sq);

        /* the aura: layered pastel blooms at different radii, drifting on
           slow independent orbits. Additive, so it reads as emitted light. */
        ctx!.globalCompositeOperation = "lighter";
        /* ═══ THE REACH IS THE READING, WHICH IS WHY IT STAYS SMALL ═══
           This was widened to 3.4 on 2026-10-11, chasing auwa.life — whose
           creature sits in a bloom five body-widths across with no edge
           anywhere — and the founder stopped it before it shipped:

             "no I like the small warm glow. Maybe auwa's bloom isn't best
              here because the glowness is supposed to be showing how
              inspired I am. So it's like the character is like a light
              bulb. So glow is better in this case, no?"

           It is, and the argument is already in this line: `lerp` between
           1.25 and 2.1 ON `lit`. The reach IS the reading. A lamp that is
           always huge cannot report anything, so the change would have
           spent the product's clearest signal — how alive your field is,
           read before a word — on looking like a reference.

           THE REFERENCE IS A STILL AND THIS IS AN INSTRUMENT. auwa's
           creature has one state and can afford a bloom tuned for that
           frame; this one has a range, and the range is the point. Noted
           here rather than in a document because the next person to put
           the two screenshots side by side will reach for exactly this
           number. */
        const auraR = companion.size * lerp(1.25, 2.1, lit) * (1 + companion.flare * 0.25);
        for (let i = 0; i < 4; i++) {
          const ph = t * (0.16 + i * 0.05) + i * 1.9;
          const off = view.reduced ? 0 : companion.size * 0.08;
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
        if (!view.reduced) {
          for (let i = 0; i < 4; i++) {
            if (riseA[i] <= 0) continue;
            ctx!.globalAlpha = clamp01(riseA[i]) * 0.55;
            ctx!.drawImage(pal.mote, charSX + riseX[i] - 3.5, cyC + riseY[i] - 3.5, 7, 7);
          }
        }

        /* inspiration coming off it, literally */
        if (!view.reduced && lit > 0.55) {
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
        const cosY = Math.cos(companion.yaw);
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
        const lean = view.reduced
          ? 0
          : clamp(companion.off / DRAG_LEAD_PX, -1, 1) * 0.045 +
            clamp(companion.pitch, -1, 1) * 0.02 +
            companion.attendHold;
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
        /* `nubOn` used to gate all of this and was last left as a literal
           `true`, so the guard inside drawNub and both null branches below
           were unreachable. The paragraph above is the decision that made it
           dead — the nubs are anatomy, so there is no state in which they are
           not painted — and the constant was the only thing still implying
           otherwise. */
        const nubR = companion.size * lerp(NUB_R_DIM, NUB_R_LIT, bodyLit);
        const nubRgb = mix(NUB_DIM, NUB_LIT, bodyLit);
        const nubFront = rgbCss(nubRgb, 1);
        /* the far side of a form is darker than the near side */
        const nubBack = rgbCss(mix(nubRgb, [0, 0, 0], 0.15), 1);
        const drawNub = (lon: number, behind: boolean) => {
          const a = companion.yaw + lon;
          if (Math.cos(a) < 0 !== behind) return;
          const s = Math.sin(a);
          /* pointing at or away from you, a nub reads smaller */
          ctx!.fillStyle = behind ? nubBack : nubFront;
          const nx = s * bw * NUB_X;
          const ny = bh * NUB_Y;
          const nr = nubR * Math.max(Math.abs(s), 0.35);
          if (formMachine) {
            /* A NUB IS MADE OF THE SAME CELLS THE BODY IS. It used to be a
               smooth arc laid over a stepped form, which is the machine idea
               contradicted at the two places furthest from the centre.
               THE CELL IS NOT SQUARE: the sprite is baked on a MACHINE_CELLS
               grid and then drawn at bw × bh, and the bob squashes those in
               opposite directions, so a cell on screen is bw/N wide and bh/N
               tall. Snapping y to the x-cell put the nubs off the body's own
               grid by up to half a cell at the extremes of the breath. */
            const cx = bw / MACHINE_CELLS;
            const cy = bh / MACHINE_CELLS;
            /* FLOOR, NOT ROUND, AND PULLED IN BY A CELL. A square of side d
               carries 27% more area than a circle of diameter d, so matching
               the arc's diameter made the nubs HEAVIER than the ones they
               replaced — two blocks sitting beside the creature rather than
               two soft nubs belonging to it. Flooring gives back the cell that
               rounding up was adding, and the inset moves each one a cell
               toward the middle so the body overlaps it instead of meeting it
               edge to edge. Both are size, not light: a nub still swells with
               the glow exactly as it did. */
            const wCells = Math.max(1, Math.floor((nr * 2) / cx));
            const hCells = Math.max(1, Math.floor((nr * 2) / cy));
            const inset = nx === 0 ? 0 : Math.sign(nx) * cx;
            ctx!.fillRect(
              Math.round((nx - inset - (wCells * cx) / 2) / cx) * cx,
              Math.round((ny - (hCells * cy) / 2) / cy) * cy,
              wCells * cx,
              hCells * cy,
            );
            return;
          }
          ctx!.beginPath();
          ctx!.arc(nx, ny, nr, 0, TAU);
          ctx!.fill();
        };
        ctx!.globalAlpha = 1;
        drawNub(-NUB_LON, true);
        drawNub(NUB_LON, true);

        const bodyTier = Math.round(bodyLit * (BODY_TIERS - 1));
        if (form.prevBody) {
          /*
           * THE OUTGOING FORM IS THE GROUND, NOT HALF OF A PAIR.
           *
           * Drawing prev at `1 - m` and cur at `m` is the obvious crossfade
           * and it is wrong here: two draws at those alphas composite to a
           * coverage of `1 - m + m²`, which bottoms out at 0.75 halfway
           * through. That is a body going 25% transparent for 160ms — the
           * ground shows through the torso, and the far nubs laid down above
           * (opaque, on the understanding that the body would hide them) bleed
           * straight through it.
           *
           * Prev opaque with cur faded in over it is a coverage of exactly 1
           * at every value of m, so the body is never see-through and the
           * occlusion contract above still holds. The residue is that a region
           * belonging to prev's silhouette and not cur's stays solid until m
           * reaches 1 — a few pixels at the edge of a bounded envelope, at the
           * end of a dissolve that is happening mid-turn.
           */
          ctx!.drawImage(form.prevBody[bodyTier], -bw / 2, -bh / 2, bw, bh);
          ctx!.globalAlpha = formMix;
          ctx!.drawImage(wear.body[bodyTier], -bw / 2, -bh / 2, bw, bh);
          ctx!.globalAlpha = 1;
        } else {
          ctx!.drawImage(wear.body[bodyTier], -bw / 2, -bh / 2, bw, bh);
        }

        /* everything ON the form is clipped to the form — to THIS form, so a
           machine's features stop at a machine's stepped edge rather than at
           the owner's curve */
        ctx!.save();
        bodyPath(ctx!, bw, bh, formBe);
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
            Math.sin(companion.yaw + Math.PI) * bw * 0.25 - seamW / 2,
            -bh / 2,
            seamW,
            bh,
          );
        }

        /* The eyes are drawn live, so the blink and the drift are free. Each
           one is a dot on the equator: it slides toward the silhouette,
           foreshortens, and fades out over the last quarter-radian rather
           than popping off the edge. */
        ctx!.fillStyle = EYE_INK;
        const er = companion.size * EYE_R;
        /* THE LOOK, AS LATITUDE. The eyes sit on the surface of a turning
           form, so looking up or down is a latitude offset in exactly the way
           the yaw is a longitude one: it moves them across the face, and it
           foreshortens as it approaches the pole. Independent of the yaw
           term, so a diagonal composes rather than fights. */
        const lat = clamp(-companion.pitch * PITCH_LOOK + companion.eyeY * 0.06, -0.9, 0.9);
        const cosLat = Math.cos(lat);
        const eyY = -bh * 0.06 + Math.sin(lat) * bh * FACE_R + companion.eyeY;
        for (const lon of [-EYE_LON, EYE_LON]) {
          const a = companion.yaw + lon;
          const ca = Math.cos(a);
          if (ca <= 0) continue;
          /* at the edge a blink is a flicker, so it is suppressed there */
          const eh = ca < 0.3 ? 1 : Math.max(0.12, 1 - companion.blink);
          ctx!.globalAlpha = clamp01(ca / Math.sin(0.25));
          const ex = Math.sin(a) * bw * FACE_R * cosLat + companion.eyeX * ca;
          if (formMachine) {
            /*
             * A MACHINE'S EYE IS MADE OF CELLS, AND SO IS ITS BLINK.
             *
             * This was the one place the whole machine grammar was not said:
             * a body quantized to MACHINE_CELLS wore two flawless antialiased
             * ellipses, and `mech` already stepped where they SAT without ever
             * stepping what they WERE — a face that moved like a machine and
             * was drawn like an animal. It is also the first thing anyone
             * looks at, so it is the worst place to leave the contradiction.
             *
             * The blink cannot be the smooth squash the owner's is. At this
             * resolution an eye is about a cell and a half across, so a
             * continuous squash to 0.12 is a single cell winking out of
             * existence — a glitch, not a blink. So the eye is TWO cells at
             * rest and ONE while it is shut: the blink becomes a change of
             * resolution, which is the same sentence the stepped tick and the
             * quantized gaze already say, in the last place that had not
             * heard it. Two cells is also slightly larger than the owner's
             * eye, and that is the cost of the grid rather than a choice —
             * one cell cannot both foreshorten and close.
             */
            /* the body's own cell, which the bob makes non-square — see the
               nub pass for why snapping y to the x-cell is wrong */
            const cx = bw / MACHINE_CELLS;
            const cy = bh / MACHINE_CELLS;
            const wC = Math.max(1, Math.round(2 * Math.max(ca * cosLat, 0.5)));
            const shut = ca >= 0.3 && companion.blink > 0.5;
            const hC = shut ? 1 : Math.max(1, Math.round(2 * Math.max(cosLat, 0.5)));
            ctx!.fillRect(
              Math.round((ex - (wC * cx) / 2) / cx) * cx,
              Math.round((eyY - (hC * cy) / 2) / cy) * cy,
              wC * cx,
              hC * cy,
            );
            continue;
          }
          ctx!.beginPath();
          ctx!.ellipse(
            ex,
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
        drawNub(-NUB_LON, false);
        drawNub(NUB_LON, false);
        ctx!.restore();
      }

      /* pass 4 — the vignette. (The film grain used to be painted here too,
         with `overlay` against a transparent canvas — which is not a blend at
         all, just a flat grey sheet at seven percent over every pixel of the
         frame. It also rode the layout transform, so the "film" grain slid
         across the image as you scrolled. It now lives on a DOM layer above
         the canvas, where it has an opaque backdrop and belongs to the lens.)

         The corners fall away, as a night lens does: */
      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = VIGNETTE;
      ctx!.drawImage(pal.vignette, cam.x, cam.y, view.w, view.h);
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";
    }

    /** Camera-following DOM: the volume and the HQ both ride at 1x. */
    function syncDom() {
      /* the words ride BOTH camera axes: rooms are columns of the same page */
      const hq = measured.hq.current;
      if (hq)
        hq.style.transform = `translate3d(${(-cam.x).toFixed(1)}px, ${(-cam.y).toFixed(1)}px, 0)`;
      const atmos = measured.atmos.current;
      if (atmos) atmos.style.transform = `translate3d(0, ${(-cam.y).toFixed(1)}px, 0)`;
      /* THE MOUTH RIDES THE VERTICAL ONLY. It used to ride both axes like
         headquarters, standing on your own wall's seam — so travelling to a
         room slid it off the screen and there was no way to keep anything
         while you were there (founder, 2026-08-24: "keep something should be
         available in every room"). Keeping is a fact about YOU, not about
         the wall you happen to be looking at: what you save is always yours,
         and where it goes is the one line under the field. So it stays put
         horizontally and still scrolls away as you descend, which is the
         axis that genuinely changes what it means.
         It is a sibling of .jar-hq rather than a child of it only because it
         has to sit ABOVE the canvas: a field you are typing into cannot have
         orbs drawn over the words. */
      const mouth = measured.mouth.current;
      if (mouth) mouth.style.transform = `translate3d(0, ${(-cam.y).toFixed(1)}px, 0)`;
    }

    function tick(now: number) {
      clock.raf = requestAnimationFrame(tick);
      /* dt is clamped BOTH ways: a wake() racing a queued frame can hand a
         timestamp older than prev (heavily throttled tabs make it seconds),
         and a negative dt turns every 1-pow(k,dt) ease into a backward
         extrapolation. Zero means "hold still for a frame", which is always
         safe here. */
      const dt = Math.min(Math.max((now - clock.prev) / 1000, 0), 0.05);
      clock.prev = now;

      /* the wheel went quiet: settle onto section A or B */
      if (gesture.snapAt > 0 && now >= gesture.snapAt && !gesture.down) snapSection(0);

      if (cam.aiming) {
        /* the profile snapSection solved: same duration on every device, and
           it commits at four pixels rather than crawling the last six tenths */
        const u = clamp01(cam.aimDur > 0 ? (now - cam.aimT0) / cam.aimDur : 1);
        cam.y = cam.aimFrom + (cam.target - cam.aimFrom) * easeOut(u);
        if (u >= 1 || Math.abs(cam.target - cam.y) < 4) {
          cam.y = cam.target;
          cam.aiming = false;
          cam.vel = 0;
        }
        clock.lastActive = now;
      } else if (!gesture.dragging) {
        /* rubber-band at the outer ends (a room's top is HQ: no sky there) */
        const cl = clamp(cam.y, minCamNow(), view.layout.maxCam);
        if (cl !== cam.y) {
          cam.y = Math.abs(cam.y - cl) < 0.4 ? cl : lerp(cam.y, cl, kd(EASE_BAND, dt));
          clock.lastActive = now;
        }
      }

      /* THE TRAVEL. The companion sets off first — easing in over its lead
         beat — and the layout follows ~140ms later on a FIXED cubic-out, so
         the room slides in under the character and the slide is over when it
         reads as over: arrival COMMITS a few pixels out instead of letting
         an exponential tail asymptote while input sits dead. */
      if (trip.active) {
        const u = clamp01((now - trip.at) / TRAVEL_LEAD_MS);
        companion.off = lerp(companion.from, companion.lead, u * u);
        const wt = clamp01((now - trip.at - TRAVEL_LAG_MS) / trip.ms);
        if (wt > 0) {
          const e = 1 - Math.pow(1 - wt, 3);
          cam.x = lerp(trip.fromX, cam.xTarget, e);
          if (Math.abs(cam.x - cam.xTarget) < TRAVEL_SNAP || wt >= 1) {
            /* ARRIVAL COMMIT: snap, wake, and give the page back */
            cam.x = cam.xTarget;
            trip.col = trip.dest;
            trip.active = false;
            arriveColumn();
          }
        }
        clock.lastActive = now;
      } else {
        if (gesture.leadOn && !gesture.down) gesture.leadOn = false; /* lost release */
        if (gesture.leadOn) {
          /* the companion sets off with the first centimetres of a held
             drag: it walks toward where the finger says the page is going */
          companion.off = lerp(companion.off, gesture.leadTarget, 1 - Math.pow(0.003, dt));
          clock.lastActive = now;
        } else if (companion.off !== 0) {
          /* arrival (or a released drag): it decelerates back to centre */
          companion.off = Math.abs(companion.off) < 0.4 ? 0 : lerp(companion.off, 0, 1 - Math.pow(0.01, dt));
          clock.lastActive = now;
        }
        if (cam.xBack) {
          /* an uncommitted swipe eases home — the world and the companion
             spring back TOGETHER; nothing rests between columns */
          cam.x = view.reduced ? cam.xTarget : lerp(cam.x, cam.xTarget, kd(EASE_BAND, dt));
          if (Math.abs(cam.x - cam.xTarget) < 0.6) {
            cam.x = cam.xTarget;
            cam.xBack = false;
          }
          clock.lastActive = now;
        }
      }
      /* AND THE CROSSING ITSELF RESOLVES IN STEPS. Read after the camera
         moves, so every other quantised thing this frame agrees about how
         far into the machine's mind we are.

         OUTSIDE THE TWO BRANCHES ABOVE, BECAUSE THE CAMERA MOVES IN BOTH.
         These two lines sat one brace deeper, inside `if (cam.xBack)` — a
         branch that means only "an uncommitted swipe is springing back". A
         committed travel therefore never reached them, so `mech` stayed at
         its initial 0 for the life of the session and every quantised thing
         downstream read "not a machine": an agent's wall wore the same
         smooth body as your own, and the stepped tick, the eye resolution
         and the form dissolve were all unreachable. The camera is settled
         for this frame either way by the time we get here, which is what
         the paragraph above was always asking for. */
      mech = view.reduced ? mechAt(cam.x) : lerp(mech, mechAt(cam.x), kd(2e-3, dt));
      /* THEY ARE ALREADY THERE (founder, 2026-08-27, video: "text and
         characters should already be there, not reload when my character
         arrives"). The company used to fade out for the whole crossing and
         greet you on arrival, which read as a room loading itself the moment
         you looked at it. A room's members stand at their room whether or
         not anyone is visiting: the alpha now holds for the wall you are on
         AND the wall you are travelling to, so arriving is arriving at
         people already standing there. Leaving still slides them away with
         their own column, which was the earlier ruling and still holds. */
      const companyAt =
        curWall().kind === "group" || (trip.active && wallAt(trip.dest)?.kind === "group")
          ? 1
          : 0;
      company = view.reduced ? companyAt : lerp(company, companyAt, kd(2e-3, dt));
      /* ATTENTION EASES IN AND LETS GO. The target is the lean while the
         attention is live and zero once it lapses; both directions run
         through the same spring, so noticing and losing interest are the
         same motion played in opposite directions. rps=0.02 is τ≈256ms:
         quick enough to read as reacting, slow enough to be a turn. */
      const attendWant = performance.now() < companion.attendUntil ? companion.attendLean : 0;
      companion.attendHold = view.reduced ? attendWant : lerp(companion.attendHold, attendWant, kd(2e-2, dt));
      /* THE VERTICAL TRAVELER. Read the camera's own speed rather than any
         input: a drag, a flick, the wheel, an arrow key and the forming
         line's glide into the sky all move the layout, and the companion
         answers the layout. */
      const camVY = dt > 0 ? (cam.y - companion.camYPrev) / dt : 0;
      companion.camYPrev = cam.y;
      const wantPitch = view.reduced ? 0 : clamp(camVY / PITCH_FULL, -1, 1);
      companion.pitch = Math.abs(companion.pitch - wantPitch) < 0.002 ? wantPitch : lerp(companion.pitch, wantPitch, kd(2e-3, dt));
      /* it leads the world the same way it leads a room transition: up first,
         then the layout follows it up */
      const wantLift = view.reduced ? 0 : -companion.pitch * PITCH_LEAD_PX;
      companion.lift = Math.abs(companion.lift - wantLift) < 0.2 ? wantLift : lerp(companion.lift, wantLift, kd(6e-3, dt));
      /* the hover-bob quickens toward a WALK while the companion leads, and
         relaxes back to a hover at rest — one integrated phase, no jumps.
         Rising it LENGTHENS (buoyant), descending it quickens (settling). */
      /* AND IT IS THIS BEING'S OWN RATE. `bobRate` and `blinkMs` were hashed
         per wall, given per-being ladders, and then read nowhere — every
         companion in the layout bobbed at exactly 1.4 and blinked on the same
         distribution. For a product whose thesis is a companion with a
         character, the individuality was authored and thrown away. */
      companion.bobPh +=
        dt *
        wornBeing().bobRate *
        (1 + 0.6 * clamp01(Math.abs(companion.off) / DRAG_LEAD_PX)) *
        (1 + 0.45 * companion.pitch) *
        /* the disposition, on the term it is most legible on. Multiplied with
           the being's own rate rather than replacing it, so a slow creature in
           a good mood is still slower than a quick one in a bad one — identity
           underneath, disposition on top, the same order as the blink. */
        (1 + companion.mood * MOOD_RATE);
      /* arrived before the data: the wall holds still until it can wake whole */
      if (trip.awaitingWake && !trip.active) tryWakeWall();

      /* the hold: down over about a second when the world has been left
         alone, and never below a fifth — still breathing, never frozen */
      const settleWant = now - stir.at > SETTLE_IDLE ? SETTLE_MIN : 1;
      if (stir.amp !== settleWant) {
        stir.amp =
          Math.abs(stir.amp - settleWant) < 0.005
            ? settleWant
            : lerp(stir.amp, settleWant, kd(EASE_SETTLE, dt));
      }

      if (pour.scrubDirty) {
        pour.scrubDirty = false;
        reconcileScrub();
        computeInspiration();
        clock.lastActive = now;
      }

      const selActive = selectedIdRef.current !== null;
      /* The field never stops drifting, even while an orb is focused — only
         the focused orb itself holds still (step() skips anything held). */
      step(dt, now);

      /* presentation lerps: the unrelated sink into the haze, the kin light
         up. Bloom eases in over ~300ms — light blooms, it does not pop. The
         orb's scale rides nothing: selection never touches geometry. */
      /* a vertical move in progress is motion, so the loop stays awake for it */
      let easing = Math.abs(companion.pitch) > 0.01 || Math.abs(companion.lift) > 0.4;
      allBalls((arr) => {
        for (const b of arr) {
          /* SEARCHING USES THE FOCUS LAW IT ALREADY HAS. A search is the same
             sentence as a selection — "this one, and everything else sinks" —
             so it runs through dim and glow rather than through a results
             list. The memory keeps its place in the field, which is the one
             thing a list can never show you. */
          /* A SEARCH OUTRANKS A READING. Both speak the same sentence to the
             field — "this one, and everything else sinks" — but a query is
             something you asked for in words and reading a pattern is not,
             so while a search is open it owns the light. */
          const hits = foundRef.current ?? readingLitRef.current;
          const missed = hits !== null && !hits.has(b.sigId ?? b.id);
          const wantDim = missed || (selActive && b.hold === 0) ? 1 : 0;
          const wantGlow = b.hold !== 0 || (hits !== null && !missed) ? 1 : 0;
          /* CONTACT, ON BOTH PATHS. This lived inside the else, so a person
             who asked for less movement got no answer under their finger at
             all — and being told what you are touching is a STATE, not a
             motion. It renders instantly there, exactly as dim and glow do. */
          const wantPress = b.id === gesture.pressId ? 1 : 0;
          if (view.reduced) {
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

      /* A JOURNEY turns the companion, and nothing else does now. Winding
         time turned it too — the yaw chased a finger's position down the
         rail. There is no rail and no finger on it: a pressed date is one
         moment, not a motion to follow. It unwinds the short way round, so it
         always comes to rest facing forward however far it was turned. */
      if (view.reduced) {
        companion.yaw = 0;
        companion.yawTarget = 0;
        companion.unwindAt = 0;
      } else if (trip.yaw) {
        /* the traveler's turnaround: the same planet turn, held at a quarter
           toward the edge for the whole slide — profile view, facing where
           it is going. Arrival clears this and the unwind brings it back. */
        companion.unwindAt = 0;
        companion.yaw = lerp(companion.yaw, companion.yawTarget, kd(EASE_YAW_TRAVEL, dt));
        easing = true;
      } else if (companion.unwindAt > 0 || companion.yaw !== 0 || companion.yawTarget !== 0) {
        if (companion.unwindAt === 0) {
          /* drop whole turns first — turning 360° is turning nowhere */
          let a = companion.yaw % TAU;
          if (a > Math.PI) a -= TAU;
          else if (a < -Math.PI) a += TAU;
          companion.unwindFrom = a;
          companion.yaw = a;
          companion.yawTarget = 0;
          companion.unwindAt = now;
        }
        const u = clamp01((now - companion.unwindAt) / UNWIND_MS);
        companion.yaw = companion.unwindFrom * Math.pow(1 - u, 3);
        easing = true;
        if (u >= 1) {
          companion.yaw = 0;
          companion.unwindFrom = 0;
          companion.unwindAt = 0;
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
      companion.inspNow = view.reduced ? companion.insp : lerp(companion.inspNow, companion.insp, 1 - Math.pow(0.02, dt));
      /* THE GATHER, AND THE RELEASE AT THE END OF IT. The compression eases IN
         (u·u) so the body sinks rather than snapping down, and the flare it is
         holding fires at the bottom — the fast half of a slow-in, fast-out.
         The body then comes back up on its own clock, under the light, which
         is what makes the release read as a push rather than a cut. */
      if (companion.antAt > 0) {
        const u = clamp01((now - companion.antAt) / ANTICIPATE_MS);
        companion.ant = u * u * ANTICIPATE_SQ;
        if (u >= 1) {
          companion.flare = Math.max(companion.flare, companion.antFlare);
          companion.antAt = 0;
          companion.antFlare = 0;
        }
        easing = true;
      } else if (companion.ant > 0.0005) {
        companion.ant = lerp(companion.ant, 0, kd(ANTICIPATE_EASE, dt));
        easing = true;
      } else if (companion.ant !== 0) {
        companion.ant = 0;
      }
      if (companion.flare > 0) {
        companion.flare = Math.max(0, companion.flare - dt / 0.7);
        easing = true;
      }
      /* THE DISPOSITION FALLS BACK TOWARD LEVEL. A half-life, not a linear
         decay: what a mood does is fade, and the last of it should take longer
         than the first. It is never a reason to keep the world awake — a
         creature settling is exactly what an idle world looks like — so this
         does not set `easing`. */
      if (companion.mood !== 0) {
        companion.mood *= Math.pow(0.5, (dt * 1000) / MOOD_HALF_LIFE_MS);
        if (Math.abs(companion.mood) < 0.002) companion.mood = 0;
      }
      /* Something was captured today. That is a STATE, and states render —
         so it is a steady offset under the companion's light, not a twitch.
         (It used to flash every six seconds: the layout brightening itself
         some six hundred times an hour with no hand involved anywhere, which
         is the same crime as a camera move on panel-open.) */
      companion.freshLit = companion.freshToday ? 0.12 : 0;
      if (!view.reduced) {
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
        if (companion.idleAt === 0) companion.idleAt = now + 22000 + Math.random() * 14000;
        if (now >= companion.idleAt) {
          /* and it looks around more readily when it is up, less when it is
             down — the willingness to be interested, which is the thing a
             mood most visibly changes */
          companion.idleAt =
            now + (30000 + Math.random() * 30000) * (1 - companion.mood * MOOD_GLANCE);
          const subject = idleSubject();
          if (subject) {
            /* it looks at a MEMORY of yours, chosen for being alive and near.
               `attendTo` is the same turn-and-lean the world already uses when
               you send it somewhere — reused rather than reinvented, so a
               glance it chose and a glance you caused move identically. The
               lean matters as much as the eyes here: Elizabeth's other lesson
               is that a behaviour nobody notices did not happen, and two
               pixels of eye drift on an 84-pixel body is not noticeable. */
            attendTo(subject.x, subject.y);
            companion.lastGaze = subject.id;
          } else {
            /* nothing awake to look at: it looks away, as it always did.
               No `glanceUntil` here — the forming branch below zeroes it in
               this same frame whenever the sky is empty, which is the normal
               case, so setting it was a statement that read as live and did
               nothing. The horizontal drift is the whole of this gesture. */
            companion.eyeTX = (Math.random() - 0.5) * 1.6;
          }
        }
        const forming = false; /* nothing forms overhead since the sky went */
        if (forming) {
          if (companion.glanceAt === 0) companion.glanceAt = now + 4000;
          if (now >= companion.glanceAt) {
            companion.glanceAt = now + 9000;
            companion.glanceUntil = now + 1200;
          }
          if (companion.riseAt === 0) companion.riseAt = now + 7000;
          if (now >= companion.riseAt) {
            companion.riseAt = now + 14000;
            for (let i = 0; i < 4; i++)
              if (riseA[i] <= 0) {
                riseX[i] = (Math.random() - 0.5) * companion.size * 0.5;
                riseY[i] = -companion.size * 0.45;
                riseA[i] = 0.85;
                break;
              }
          }
        } else {
          companion.glanceUntil = 0;
        }
        for (let i = 0; i < 4; i++) {
          if (riseA[i] <= 0) continue;
          riseY[i] -= dt * 58;
          riseA[i] -= dt * 0.26;
          easing = true;
        }
        /* presence, not cartoon tracking: at most a couple of pixels */
        const glanceY = now < companion.glanceUntil ? -2 : companion.eyeTY;
        companion.eyeX = lerp(companion.eyeX, companion.eyeTX, 1 - Math.pow(0.05, dt));
        companion.eyeY = lerp(companion.eyeY, glanceY, 1 - Math.pow(0.05, dt));
        /* RHYTHM, THE THIRD THING THE CROSSING QUANTIZES.
           Position was quantized, then the float became a tick — but the eyes
           still slid smoothly and the blink still fell at a human's uneven
           interval, so the creature was a machine that moved like an animal.
           Gaze is where that shows most: a continuous glide across a stepped
           layout is the one motion that gives the illusion away.

           `mech` is 0 on your own wall and 1 standing in an agent's, so this
           is the same crossing signal everything else reads. Nothing new is
           introduced — a value that was continuous becomes discrete, which is
           the only sentence this layout knows how to say about machines. */
        if (mech >= 0.02) {
          const eyeStep = 0.35 + mech * 0.85;
          companion.eyeX = Math.round(companion.eyeX / eyeStep) * eyeStep;
          companion.eyeY = Math.round(companion.eyeY / eyeStep) * eyeStep;
        }
        if (now >= companion.blinkAt) {
          /* its own blink interval, +/- 40%, instead of everyone's 5-9s —
             and on a machine's wall the jitter is quantized out of it, so the
             blink arrives on a beat rather than whenever. A metronome is what
             a clock looks like from the outside. */
          /* LOW MOOD BLINKS SLOWER. The being's own interval is still the
             thing being bent — identity first, disposition on top of it — so
             two creatures in the same mood still blink at their own rates. */
          const base = wornBeing().blinkMs * (1 - companion.mood * MOOD_BLINK);
          const jitter = 0.8 + Math.random() * 0.4;
          companion.blinkAt = now + base * lerp(jitter, 1, clamp01(mech));
          companion.blink = 1;
        }
        if (companion.blink > 0) companion.blink = Math.max(0, companion.blink - dt / 0.12);
        const strong = clamp01(companion.inspNow + companion.flare * 0.5) > 0.55;
        for (let i = 0; i < 10; i++) {
          if (upA[i] > 0) {
            upY[i] -= dt * 26;
            upA[i] -= dt * 0.55;
          } else if (strong && Math.random() < dt * 2.2) {
            upX[i] = (Math.random() - 0.5) * companion.size * 1.1;
            upY[i] = companion.size * 0.3;
            upA[i] = 0.8;
          }
        }
      }

      /* the air drifts upward and re-wraps; frozen under reduced motion */
      if (!view.reduced) {
        /* higher air: in the sky the motes are a little quicker and a little
           sparser — the same atmosphere, thinner */
        const up = clamp01(-cam.y / Math.max(view.h, 1));
        /* THE AIR IS THE ARCHIVE'S ALIVENESS, at the scale of a whole screen.
           You cannot paint a screenful of "twelve percent more alive" onto
           objects — but air can carry it: a dead archive has still air, a live
           one has moving air. Same scalar the companion reads, on the one
           layer that is already continuous and asks for no attention. */
        const rate = lerp(1, 1.6, up) * lerp(0.55, 1.35, companion.inspNow);
        for (let i = 0; i < MOTES; i++) {
          moteY[i] -= moteS[i] * rate * stir.amp * dt;
          if (moteY[i] < -8) {
            moteY[i] = view.h + 8;
            moteX[i] = Math.random() * view.w;
          }
        }
      }

      /* One discrete fact leaves the loop for React, and only when it
         changes: the camera stands over a wall that has no dial, so the dial
         fades away. Read off the camera rather than off arrival, so it goes
         as the wall slides in. (There used to be a second — whether the
         camera was in the sky — and there is no sky.) */
      /* THE LEGEND BELONGED TO THE GROUND IT EXPLAINED — AND IT IS NOT A
         LEGEND ANY MORE.
         It was pushed to React from here so the corner rows could come up with
         the field and go away with it, on the reasoning that a key to the orbs
         answers nobody at headquarters. That was true of a key. It is a CHOICE
         now — the rows moved you between the grounds in a room the moment they
         stopped decoding hues — and a choice about the wall you are standing
         on is not a fact about the ground you are hovering over. It is mounted
         at every height below the sky instead, so nothing needs pushing here. */
      /* AT EVERY HEIGHT. This was `!inField || …`, so a wall's history existed
         only once you had descended into its ground — the timeline was a
         thing you had to go and find rather than a permanent fact about where
         you are. The only reason left to hide it is that this wall HAS no
         history to wind, which is data, not altitude. */
      const nowAway = !hasDial(wallAt(Math.round(cam.x / Math.max(view.w, 1))).kind);
      /* and whether the ground is what the camera is standing in — read off
         the camera, so it changes as the descent happens rather than on
         arrival */
      const nowInField = cam.y > view.layout.maxCam * 0.5;
      if (nowInField !== hinted.inField) {
        hinted.inField = nowInField;
        setInField(nowInField);
      }
      const nowInSky = cam.y < view.layout.minCam * 0.5;
      if (nowInSky !== hinted.inSky) {
        hinted.inSky = nowInSky;
        setInSky(nowInSky);
      }
      if (nowAway !== hinted.dialAway) {
        hinted.dialAway = nowAway;
        setDialAway(nowAway);
      }

      draw(now);
      syncDom();

      /* The field drifts continuously, so there is no longer an idle state to
         fall into while it is visible: the loop rests only when the document
         is hidden (handled in onVis) or when reduced motion has parked every
         orb at its home and genuinely nothing is moving. */
      let awake =
        !view.reduced ||
        pour.active ||
        !pour.done ||
        trip.active ||
        cam.xBack ||
        selActive ||
        gesture.down ||
        easing ||
        cam.aiming ||
        gesture.snapAt > 0 ||
        cam.y < minCamNow() ||
        cam.y > view.layout.maxCam;
      if (!awake) {
        for (const b of list) {
          if (b.leaving) {
            awake = true;
            break;
          }
        }
      }
      if (awake) clock.lastActive = now;
      const grace = view.reduced ? 200 : 2600; /* breath settles, then true rest */
      if (now - clock.lastActive > grace) {
        clock.running = false;
        cancelAnimationFrame(clock.raf);
      }
    }

    /* ---------------- selection ---------------- */

    /* Nothing moved while an orb was focused, so nothing needs to re-settle:
       releasing lifts the haze and leaves the pile exactly as it was. */
    function release() {
      releaseHolds();
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
      selectedIdRef.current = id;
      setSelectedId(id);
      /* IT LOOKS AT WHAT YOU TAPPED.
         A companion that only ever looks at the user is a cursor; the whole
         idea of attention as an interface is that it can go somewhere else.
         So the eyes leave you and go to the memory, the body leans after them,
         and it holds there while you read. It does not travel: tap is focus,
         not rearrangement, and the layout stays where you left it. */
      attendTo(b.x, b.y);
      b.hold = 1;
      held.ball = b;
      /* the companion brightens in sympathy with an alive bubble */
      if (b.alive > 0.55) companion.flare = Math.max(companion.flare, 0.6);
      /* Its kin are NOT lit and NOT moved. Exactly one thing on screen is
         lit; the connections belong in the panel as text, never in the jar. */
      wake();
    }

    /** Is the pointer over the companion? It sits in front of the field. */
    /**
     * WHICH MEMBER THE POINTER IS ON, IF ANY (founder, 2026-08-27).
     *
     * The seats are rebuilt by the draw pass every frame it paints company,
     * so this asks the geometry that was actually painted rather than
     * re-deriving it — the same rule the orb hit test follows, and the reason
     * the pointer never lies about which being it would take.
     */
    function memberAt(cx: number, wy: number): string | null {
      // Match the painter: nearer avatars receive overlapping taps first.
      for (let index = companySeats.length - 1; index >= 0; index--) {
        const seat = companySeats[index];
        const dx = cx - seat.x;
        const dy = wy - seat.y;
        if (dx * dx + dy * dy <= seat.r * seat.r) return seat.id;
      }
      return null;
    }

    /** Notice a member: it comes up in light and says its name, then lets go. */
    function noticeMember(id: string) {
      if (companyNear.id === id && companyNear.until > performance.now() + 500) return;
      companyNear.id = id;
      companyNear.until = performance.now() + NOTICE_MS;
      wake();
    }

    function overChar(cx: number, wy: number): boolean {
      const dx = cx - (view.w / 2 + companion.off);
      const dy = wy - companion.y;
      const r = companion.size * 0.55;
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
      const wx = cx + cam.x;
      const wy = cy + cam.y;
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

    function tap(cx: number, cy: number) {
      /* mid-travel the page is the traveler's: taps wait for arrival */
      if (trip.active) return;
      /* the companion answers first: it sits in front of the field — and
         what it answers with is the weather, its own lines only when the
         record has nothing to tell */
      if (overChar(cx, cy + cam.y)) {
        companion.flare = 1;
        /* THE SAME ROTATION THE BUTTON DRIVES. This branch is reachable
           only while `.jar-char-press` is unmounted — it is not rendered
           while the creature is already speaking — so two different answers
           to one press is exactly the drift that put the offer in front of
           the weather in the first place. */
        creatureSpeaksRef.current();
        wake();
        return;
      }
      /* Open only this member's public inspirations within the current room. Record the
         destination immediately so Back returns to the room, even mid-glide. */
      const member = memberAt(cx, cy + cam.y);
      if (member) {
        noticeMember(member);
        openGroupMemberRef.current(member);
        return;
      }
      const ball = hitAt(cx, cy);
      if (ball) {
        select(ball.id);
        return;
      }
      /* bare ground: a focused orb gives the light back and everything
         returns to rest */
      if (selectedIdRef.current) release();
    }

    /* ---------------- input ---------------- */

    const isChrome = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-jar-chrome]") !== null;
    /* Only GENUINELY interactive elements own their presses — buttons,
       links, fields, and the reading panel, where text selection matters more
       than dragging. Everything else, text included, must feed the same camera
       machinery as bare ground: the ambition's words, the whispers and the
       room titles are the page, and the page drags.

       `.jar-dial-track` was named here and is gone with the drag. It had to be
       listed because it was the one interactive thing on this page that was
       not a button — which is also why it could quietly take a press meant
       for something behind it. The dates are buttons, and buttons were
       already covered by the first word in this list. */
    const isInteractive = (t: EventTarget | null) =>
      t instanceof Element &&
      /* `[role="button"]` IS IN THIS LIST NOW. The poster is an `<h1>` that
         declares itself a button — "the sentence itself is the control, there
         is no button beside it" (founder, 2026-08-24) — and a selector that
         only names real `<button>` elements read it as page, captured the
         pointer for a drag, and swallowed the press. So the one control that
         was deliberately not shaped like a button was the one control that
         could not be pressed, and what the reading rests on has been
         unreachable by pointer ever since. Anything that tells assistive
         technology it is a button owns its own press. */
      (isNativeSurface(t) ||
        t.closest('button, a, textarea, input, select, [role="button"]') !== null);

    /** Hand the world back: the capture and the identity always go together. */
    const releaseOwner = (id: number) => {
      if (gesture.ownerId !== id) return;
      try {
        root!.releasePointerCapture(id);
      } catch {
        /* already gone with the pointer itself */
      }
      gesture.ownerId = null;
    };

    const onDown = (e: PointerEvent) => {
      /* capture phase: interactive elements keep their own behaviour */
      if (isInteractive(e.target)) return;
      /* mid-travel the camera belongs to the traveler */
      if (trip.active) return;
      /* ONE GESTURE OWNS THE WORLD, AND THE CLOUD DRAG IS ONE OF THEM.
         Ownership used to be claimed AFTER the nebula branch had already
         returned, so a cloud drag ran with no identity and no capture and
         carried both halves of the bug the layout drag had just had fixed: a
         second finger rewrote the grab offsets, so the first finger's next
         move teleported the cloud by the distance between them, and a drag
         that left the window delivered no pointerup at all — welding the
         cloud to the cursor until the next click. It is claimed here, once,
         before anything branches, because every press that gets this far is
         the layout's: a cloud, a satellite, an orb, or bare ground. */
      if (gesture.ownerId !== null) return;
      gesture.ownerId = e.pointerId;
      try {
        root!.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic or already-released pointer: the window listeners still
           carry the gesture, they just do not get the off-window guarantee */
      }
      gesture.down = true;
      gesture.dragging = false;
      gesture.axis = 0;
      gesture.downX = e.clientX;
      gesture.downY = e.clientY;
      gesture.lastY = e.clientY;
      gesture.lastX = e.clientX;
      gesture.downT = gesture.lastT = performance.now();
      cam.vel = 0;
      gesture.velX = 0;
      /* Interrupting a camera move is always legal — a camera is a position
         and a velocity, and nothing about one is half-rendered. But the layout
         still owes you a resting place: this used to strand the camera
         between two sections permanently, against the page's own law that it
         never rests between them. */
      gesture.interruptedSnap = cam.aiming;
      cam.aiming = false;
      gesture.snapAt = 0;
      /* Warm the reading while the finger is still down: it buys the whole
         press-to-release interval, and it is free when the background sweep
         has already been here. Another member's room orb is never fetched —
         its preview is all that is ours to show. */
      const warm = hitAt(e.clientX, e.clientY);
      if (warm && (warm.col === undefined || warm.own))
        void loadDetailRef.current(warm.sigId ?? warm.id);
      /* AND THE LIGHT ANSWERS AT TOUCHDOWN. The whole contact term was built
         and then never armed — `pressId` was declared, read once in the loop
         and written nowhere, so `press` sat at zero forever and a press still
         produced literally nothing for the ninety to two hundred and fifty
         milliseconds the finger was down. The hit is already in hand for the
         prefetch above, so this costs one assignment. */
      gesture.pressId = warm ? warm.id : null;
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
    /**
     * WHAT IT LOOKS AT WHEN NOTHING IS HAPPENING.
     *
     * The occasional clock used to fire `eyeTX = (Math.random() - 0.5) * 1.6`
     * — the comment beside it called it "a gaze with no subject", which is
     * exactly what it was. A creature looking at a randomly chosen angle is
     * not looking at anything, and after the second or third time you can see
     * that it isn't.
     *
     * Irrational's postmortem on Elizabeth reports that scattering INTEREST
     * POINTS through the world — markers whose only job is to give a companion
     * something to do in the downtime — did more for how alive she read than
     * any of the larger systems around it. This world does not have to author
     * any: the field is already a ground full of objects each broadcasting a
     * scalar, which is precisely the input The Sims' advertisement model takes.
     * A memory advertises its aliveness; the companion weights that by how far
     * away it is and looks at whatever wins. Will Wright called it a proximity
     * pheromone, and it needs no new data, no new state on an orb, and no
     * authored list.
     *
     * The jitter is a real `Math.random`, unlike everything positional in this
     * file: `b.frac` is a STABLE per-ball draw, so scoring with it would pick
     * the same memory every time forever, which is staring rather than
     * looking. Where the ground rests must be deterministic; where a creature
     * happens to glance must not be.
     */
    function idleSubject(): Ball | null {
      const bag = ballsRef.current;
      if (!bag) return null;
      const cx = cam.x + view.w / 2;
      const cy = companion.y;
      /* how far the light of a memory carries; also what keeps a neighbouring
         column's field from pulling its gaze through a wall */
      const reach = Math.max(view.w * 0.35, 1);
      /*
       * TWO PLACES, NOT ONE. "Don't look at the same memory twice running" was
       * written as an unconditional `continue`, which on a ground with a
       * single eligible orb means it is looked at once and then skipped for
       * the rest of the session — the companion goes back to a gaze with no
       * subject forever, which is the bug this function exists to remove.
       * Keeping the runner-up makes the rule what it was meant to be: prefer
       * something else IF there is something else.
       */
      let best: Ball | null = null;
      let bestScore = 0;
      let next: Ball | null = null;
      let nextScore = 0;
      for (const b of bag.list) {
        if (!b.active || b.leaving || b.gone > 0 || b.spawnAt >= 0) continue;
        if (Math.abs(b.x - cx) > view.w * 0.6) continue;
        const d = Math.hypot(b.x - cx, b.y - cy);
        const score = b.alive * Math.exp(-d / reach) * (0.7 + Math.random() * 0.6);
        if (score > bestScore) {
          next = best;
          nextScore = bestScore;
          best = b;
          bestScore = score;
        } else if (score > nextScore) {
          next = b;
          nextScore = score;
        }
      }
      if (best && best.id === companion.lastGaze && next && nextScore > 0.02) {
        return next;
      }
      /* a ground with nothing awake on it advertises nothing, and the honest
         answer to that is to keep looking away rather than to invent a subject */
      return bestScore > 0.02 ? best : null;
    }

    function attendTo(wx: number, wy: number) {
      const dx = wx - (cam.x + view.w / 2);
      const dy = wy - companion.y;
      const d = Math.hypot(dx, dy) || 1;
      /* overshoot: it commits to the direction before it has finished moving */
      companion.eyeTX = clamp((dx / d) * 2.6, -2.4, 2.4);
      companion.eyeTY = clamp((dy / d) * 1.6, -1.6, 1.6);
      companion.attendUntil = performance.now() + 2600;
      /* and the body leans after the eyes, not with them */
      companion.attendLean = clamp(dx / Math.max(view.w * 0.5, 1), -1, 1) * 0.05;
      wake();
    }

    const onHover = (e: PointerEvent) => {
      /* presence: the eyes drift a couple of pixels toward the last touch */
      const dx = e.clientX - view.w / 2;
      const dy = e.clientY + cam.y - companion.y;
      const d = Math.hypot(dx, dy) || 1;
      if (performance.now() < companion.attendUntil) return; /* it is looking at something */
      companion.eyeTX = clamp((dx / d) * 2, -2, 2);
      companion.eyeTY = clamp((dy / d) * 2, -2, 2);
      /* The cursor says what a tap would do. Every other move is plenty for a
         couple of dozen orbs, and it is the same hit test the tap uses, so
         the pointer never lies about which orb it would take. The cursor
         lives on the ROOT: the canvas is pointer-events:none, so it is never
         the element the cursor resolves from. */
      if ((gesture.hoverTick++ & 1) === 0 && !gesture.dragging) {
        /* a member under the pointer says who it is, for a beat */
        const member = memberAt(e.clientX, e.clientY + cam.y);
        if (member) noticeMember(member);
        const over =
          member !== null ||
          overChar(e.clientX, e.clientY + cam.y) ||
          hitAt(e.clientX, e.clientY) !== null;
        const want = over ? "pointer" : "";
        if (gesture.cursor !== want) {
          gesture.cursor = want;
          root!.style.cursor = want;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      onHover(e);
      if (gesture.ownerId !== null && e.pointerId !== gesture.ownerId) return;
      if (!gesture.down) return;
      if (!gesture.dragging && Math.abs(e.clientX - gesture.downX) + Math.abs(e.clientY - gesture.downY) > TAP_SLOP) {
        gesture.dragging = true;
        /* the finger is moving the world now, not touching a memory: the
           contact light lets go the moment the gesture changes its mind */
        gesture.pressId = null;
        /* The gesture picks its axis ONCE. Sideways on the ground is travel
           (v8) — allowed only from a vertical rest point, never mid-sky, and
           only when a neighbouring column exists to go to. */
        const horiz = Math.abs(e.clientX - gesture.downX) > Math.abs(e.clientY - gesture.downY);
        gesture.axis =
          horiz && canTravelHere() && wallsRef.current.length > 1 && !trip.active
            ? 2
            : 1;
      }
      /* The pointer's vertical travel is still TRACKED — the gesture router
         below compares it against the horizontal to decide whether this drag
         is a wall crossing — it just no longer moves the camera. */
      gesture.lastY = e.clientY;
      const dxm = e.clientX - gesture.lastX;
      gesture.lastX = e.clientX;
      if (!gesture.dragging) return;
      const nowT = performance.now();
      /* Four milliseconds, not one. A coalesced three-pixel jitter over a
         floored 1ms reports three thousand pixels a second — a phantom flick
         six times over the threshold, and the snap now CONSUMES this number. */
      const dts = Math.max(nowT - gesture.lastT, 4) / 1000;
      if (gesture.axis === 2) {
        /* The room slides only part-way under a finger — commitment is on
           release, and the TRAVELER leads the actual transition. Pulling
           where no neighbour exists meets heavy resistance instead. */
        const off = -(e.clientX - gesture.downX);
        const hasNext = trip.col + 1 <= colHi();
        const hasPrev = trip.col - 1 >= colLo();
        const resist = (off > 0 && !hasNext) || (off < 0 && !hasPrev) ? 0.16 : 0.55;
        cam.x = trip.col * view.w + clamp(off * resist, -view.w * 0.32, view.w * 0.32);
        cam.xBack = false;
        if (!view.reduced) gesture.velX = lerp(gesture.velX, dxm / dts, kd(EASE_VEL, dts));
        /* THE COMPANION SETS OFF WITH THE DRAG: from the first centimetres
           it turns toward the pull and starts walking — leading by the
           fraction of the commit distance dragged. Reduced motion: parked. */
        if (!view.reduced) {
          gesture.leadOn = true;
          const disp = cam.x - trip.col * view.w;
          gesture.leadTarget = clamp(disp / (view.w * 0.14), -1, 1) * DRAG_LEAD_PX;
          if (Math.abs(gesture.leadTarget) > 4) {
            trip.yaw = true;
            companion.yawTarget = (gesture.leadTarget > 0 ? 1 : -1) * (TAU / 4);
            companion.unwindAt = 0;
          }
        }
        /* travel toward a room begins at swipe start: fetch it now */
        if (off > 20 && hasNext && groupsRef.current[trip.col])
          loadGroupRef.current(groupsRef.current[trip.col].id);
        else if (off < -20 && trip.col - 1 > 0 && groupsRef.current[trip.col - 2])
          loadGroupRef.current(groupsRef.current[trip.col - 2].id);
        gesture.lastT = nowT;
        wake();
        return;
      }
      /* AND NOT BY DRAG EITHER. Same ruling as the wheel: there is nowhere
         above or below to go, so dragging the world vertically only carried
         the reading off the screen. The inertia goes with it — velocity that
         can never be spent is a spring with nothing on the end of it. */
      gesture.lastT = nowT;
      wake();
    };
    const onUp = (e: PointerEvent) => {
      if (gesture.ownerId !== null && e.pointerId !== gesture.ownerId) return;
      /* the finger is off it: the contact light starts decaying now, and the
         selection's own glow takes over from tap() below */
      gesture.pressId = null;
      /* Hand the world back before anything branches. Every path out of here
         is a finished gesture, and the capture and the identity go together —
         the cloud-drag paths used to return without either. */
      releaseOwner(e.pointerId);
      if (!gesture.down) return;
      gesture.down = false;
      if (gesture.axis === 2) {
        /* completing a swipe: velocity-biased, one column per gesture. The
           finger only pulled the room part-way — the companion now leads the
           actual crossing, or the layout eases home uncommitted. */
        const disp = cam.x - trip.col * view.w;
        const dir: 1 | -1 =
          Math.abs(gesture.velX) > FLICK ? (gesture.velX < 0 ? 1 : -1) : disp > 0 ? 1 : -1;
        const dest = trip.col + dir;
        const commit =
          (Math.abs(gesture.velX) > FLICK || Math.abs(disp) > view.w * 0.14) &&
          dest >= colLo() &&
          dest <= colHi();
        gesture.dragging = false;
        gesture.axis = 0;
        gesture.leadOn = false;
        if (commit) travel(dir);
        if (!trip.active && cam.x !== trip.col * view.w) {
          /* uncommitted (or travel refused): ease home — never rest between */
          cam.xTarget = trip.col * view.w;
          cam.xBack = true;
        }
        if (!trip.active) {
          /* it changed its mind with you: turns back and eases home while
             the layout springs back under it */
          trip.yaw = false;
          companion.unwindAt = 0;
        }
        wake();
        return;
      }
      /* A TAP IS DECIDED ON RELEASE. Six pixels of MANHATTAN distance means a
         four-and-four thumb wobble latches a drag, and the else-branch then
         "snaps" a camera that never moved. What actually distinguishes a tap
         is that it was short and it went nowhere. */
      const held = performance.now() - gesture.downT;
      const travel2 = Math.hypot(e.clientX - gesture.downX, e.clientY - gesture.downY);
      /* (a horizontal gesture has already returned above, so this is only
         ever the vertical axis or a press that never picked one) */
      const wasTap = !gesture.dragging || (held < 260 && travel2 < 14);
      /* A FINGER THAT STOPPED IS NOT MOVING. Browsers send no pointermove for
         a stationary finger, so drag fast, stop dead, hold, release — and the
         layout used to be thrown at the speed you were moving half a second
         ago. */
      if (performance.now() - gesture.lastT > 80) {
        cam.vel = 0;
        gesture.velX = 0;
      }
      if (wasTap && !isChrome(e.target)) {
        tap(e.clientX, e.clientY);
        /* the press interrupted a camera move, so the world is between two
           sections and has to be given a place to rest again */
        if (gesture.interruptedSnap) snapSection(0);
      } else {
        /* the page never rests between the two sections */
        snapSection(view.reduced ? 0 : cam.vel);
      }
      gesture.interruptedSnap = false;
      gesture.dragging = false;
      gesture.axis = 0;
      wake();
    };
    const onCancel = (e: PointerEvent) => {
      if (gesture.ownerId !== null && e.pointerId !== gesture.ownerId) return;
      gesture.pressId = null;
      if (gesture.axis === 2) {
        cam.xTarget = trip.col * view.w;
        cam.xBack = true;
        gesture.leadOn = false;
        trip.yaw = false;
        companion.unwindAt = 0;
      } else if (gesture.dragging || gesture.interruptedSnap) {
        /* cancelled mid-drag, or cancelled on a press that had interrupted a
           move: either way the layout is owed a resting place */
        snapSection(0);
      }
      gesture.interruptedSnap = false;
      cam.vel = 0;
      gesture.velX = 0;
      gesture.down = false;
      gesture.dragging = false;
      gesture.axis = 0;
      releaseOwner(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      // Every reading/writing surface keeps browser scrolling, including at
      // its edge. Moving the camera here also cancels the panel's own scroll.
      if (e.defaultPrevented || isNativeSurface(e.target)) return;
      e.preventDefault();
      if (trip.active) return; /* mid-travel the wheel waits */
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
        if (nowW < gesture.wheelXUntil) {
          gesture.wheelXAcc = 0;
          return;
        }
        if (!canTravelHere() || wallsRef.current.length < 2) return;
        gesture.wheelXAcc += e.deltaX;
        if (Math.abs(gesture.wheelXAcc) > 70) {
          const dir: 1 | -1 = gesture.wheelXAcc > 0 ? 1 : -1;
          gesture.wheelXAcc = 0;
          gesture.wheelXUntil = nowW + 450;
          travel(dir);
        }
        return;
      }
      /* NO VERTICAL TRAVEL BY GESTURE (founder ruling, asked for repeatedly).
         The wheel used to drive `cam.y` between the sky and the ground, which
         is how a person reached their principles and their archive. Both are
         PAGES now, so the gesture has nowhere left to go and scrolling the
         world only moved the reading off the screen.

         The camera's range is untouched on purpose: `toSky`, `toGround` and
         the deep links that open one memory still move it programmatically,
         and the panels that live in those bands — a principle being edited,
         a memory's own card — are reached that way. What is removed is the
         gesture, not the geometry. */
      gesture.wheelXAcc = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      // This guard precedes ALL shortcuts, including slash. Editors and IME
      // composition keep their characters; browser shortcuts keep modifiers.
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      // A reading card owns its paging arrows; other panels keep their keys.
      if (isNativeSurface(e.target) && !(e.target instanceof Element && e.target.closest(".jar-panel"))) return;
      /* THE VERTICAL KEYS DO NOT TRAVEL EITHER (founder ruling). The wheel and
         the drag were stopped first and this was missed, so Arrow Up, Arrow
         Down, PageUp and PageDown still walked the camera between the sky and
         the ground — the same journey by a third instrument. Every way of
         making that journey has to go, or the one that is left IS the
         journey. */
      const step = 0;
      const horiz = e.key === "ArrowLeft" || e.key === "ArrowRight";
      /* "/" IS FIND, EVERYWHERE. The gesture people already have for searching
         a page, and it puts the verb on the layout rather than in a menu. */
      if (e.key === "/") {
        e.preventDefault();
        openSeekRef.current();
        return;
      }
      const mine = step !== 0 || horiz || e.key === "Escape";
      if (!mine) return;
      /* the world handles this key, so the browser does not ALSO handle it:
         a native scroll or a focus move underneath the layout's own move is a
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
        return;
      }
      /* Left and right are the traveler's keys — they pass through even
         mid-flight, because travel() itself ignores the same direction and
         treats the opposite one as a REVERSAL back to where it left from.
         UNLESS A CARD IS OPEN: then they page the reading (founder,
         2026-08-27), because the memory in your hand is the nearer subject
         and stepping through what you kept must not become travelling to
         somebody else's wall. */
      if (horiz) {
        if (panelArrowRef.current(e.key === "ArrowRight" ? 1 : -1)) return;
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
      const ref = cam.aiming ? cam.target : cam.y;
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
        clock.running = false;
        cancelAnimationFrame(clock.raf);
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
          next += pour.step;
        }
        wake();
      }
    };
    const onMq = () => {
      view.reduced = mq.matches;
      if (view.reduced) cam.vel = 0;
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
    if (measured.hqInner.current) ro.observe(measured.hqInner.current);
    /* AND SO IS WHAT THE COMPANION SAYS, for exactly the same reason.
       The voice block arrives late — the claim is fetched — so the pass that
       placed the companion measured an empty block and never looked again.
       The companion stayed where it had been put before it had anything to
       say, and the claim grew downward into the gap above the box. That is
       the whole of "the page just feels unbalanced to my eyes": the lift was
       computed correctly and then never recomputed. */
    if (measured.charSay.current) ro.observe(measured.charSay.current);

    measure();
    /* `measure` is the first moment `vw` is real, so the horizontal camera can
       only be placed here — before it, `col * vw` is a column times one pixel. */
    /* NOT UNDER A CROSSING THAT IS STILL RUNNING. This is unconditional on a
       first open, and has to be — before `measure()` there is no real viewport
       and `col * vw` is a column times one pixel. But a rebuild that resumed a
       crossing already has a camera partway across, and re-placing it here
       restarts the slide from the column it set off from. `measure()` sets
       `xTarget` from `trip.dest` on its own while a crossing is live. */
    if (!trip.active) {
      cam.x = trip.col * view.w;
      cam.xTarget = cam.x;
    }
    /* Resumed mid-journey: nobody ran the arrival, so run it now — the wall
       needs its ground solved, poured and woken exactly as a glide would. */
    if (resumedAt !== null) arriveColumn();
    /*
     * A ROOM THAT HAS NOT WOKEN YET HAS TO KEEP TRYING.
     *
     * `ready` gates the ENTIRE headquarters block — eyebrow, poster, forming
     * line — on `wokenGroups.has(id)`, and the only thing that ever adds to
     * that set is `tryWakeWall`. It is reached from exactly two places:
     * `arriveColumn`, and the tick while `trip.awaitingWake` is true.
     *
     * Both are lost in the same instant. Arriving in a room whose field is
     * still in flight sets `awaitingWake` and returns; the fetch then resolves
     * and calls `setGroupFieldTick`, which rebuilds this effect — so `trip` is
     * replaced by a fresh one with `awaitingWake` false, and `headingRef` was
     * already cleared by the arrival, so the `resumedAt` branch above does not
     * run either. Nothing asks again. The room stays unwoken and its
     * headquarters renders NOTHING: no name, no sentence, not even the
     * "Forming — nothing read together yet" that `deriveGroupChrome` prepared
     * for exactly this case. It stays blank until you travel away and back.
     *
     * The rebuild that loses the flag is the same event that makes the answer
     * available, so setting it on setup is not a retry loop — it is one
     * question asked at the only moment it can now be answered. `tryWakeWall`
     * clears the flag itself, and `groupVisitedRef` keeps the wake to once.
     */
    else if (curWall().kind === "group") trip.awaitingWake = true;
    else if (
      curWall().kind === "agent" &&
      !agentsRef.current.some((a) => a.agent.id === curWall().id)
    )
      trip.awaitingWake = true;
    measure();
    if (view.reduced) settleInstantly();
    else if (carryRef.current) {
      /*
       * A REBUILD IS NOT AN ARRIVAL.
       *
       * `primePour()` with no argument stages the WHOLE archive, and on a
       * rebuild that means every memory you were already looking at falls in
       * from above again — the pour is how the field explains that something
       * has arrived, and nothing has. But the rebuild happened BECAUSE there
       * is new data, and those memories genuinely are arriving, so the answer
       * is not to skip the pour: it is to pour only what this run did not
       * already have.
       *
       * Identity is the ball's id. The objects are rebuilt from scratch every
       * run, so the id is the only thing that survives, and it is what says
       * whether a memory is new to the FIELD rather than new to this array.
       */
      const carried = carryRef.current.balls;
      const currentSceneId = curWall().id;
      const fresh: Ball[] = [];
      for (const b of list) {
        const was = carried.get(b.id);
        if (!was) {
          /* New to the field — but the pour is an ARRIVAL, and an arrival
             happens on the wall it belongs to. A ball for another wall is
             registered quiet; travelling there is what switches it on. */
          if (
            b.capturedMs <= TRef.current &&
            (b.agentId ?? "") === currentSceneId
          ) {
            fresh.push(b);
          } else {
            b.spawnAt = -1;
            b.arrive = 1;
            b.x = b.homeX;
            b.y = b.homeY;
          }
          continue;
        }
        b.x = was.x;
        b.y = was.y;
        b.arrive = 1;
        b.spawnAt = -1;
      }
      /* PRESENCE IS DERIVED, NOT CARRIED — one owner, whatever the rebuild
         interrupted: an arrival's lost pour, a mid-flight shear, a pour that
         died with balls still staged. The staged `fresh` are excluded by
         their own spawn times, so the arrival animation still lands. */
      if (fresh.length > 0) primePour(fresh);
      else {
        pour.active = false;
        pour.done = true;
      }
      if (!trip.active) {
        assignHomes();
        applyPresence();
      }
      computeInspiration();
    } else {
      applyPresence();
      primePour();
    }

    simApiRef.current = {
      navigationState: () => ({ wall: curWall(), section: cam.y < view.layout.minCam * 0.5 ? 'sky' : cam.y > view.layout.maxCam * 0.5 ? 'field' : 'top', moving: trip.active || cam.aiming }),
      /* the timeline re-hangs under the word, whose width the reading sets */
      hangRail,
      /**
       * STAND IN SOMEONE ELSE'S GROUND — or back in your own, with null.
       *
       * The field re-solves and the orbs arrive where the new fit puts them.
       * The CAMERA does not move: you asked to see a different ground, not to
       * be taken somewhere, and the world only moves when you moved it.
       */
      standIn: (ownerProfileId: string | null) => {
        if (ground === ownerProfileId) return;
        ground = ownerProfileId;
        /* the ground that left goes dark, the one that arrived pours in — the
           same arrival the layout uses everywhere, so a swap reads as a ground
           filling rather than as a screen being replaced */
        assignHomes();
        applyPresence();
        const here = presentBalls();
        if (view.reduced) settleInstantly();
        else primePour(here);
        electPeek(here);
        wake();
      },
      windTo: (T: number) => {
        if (trip.active) return; /* the dial is the personal jar's alone */
        TRef.current = T;
        if (selectedIdRef.current) release();
        pour.scrubDirty = true;
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
        /*
         * WHAT THIS DID TO THE CREATURE, BEFORE WHAT IT MADE IT DO.
         *
         * Set here rather than inside the arms below, so a moment added later
         * cannot forget to say what it means — the same reason `attachEvidence`
         * holds the lock check at the write. Clamped to ±1 so a run of keeps
         * cannot wind the disposition somewhere it will not come back from,
         * and skipped entirely under reduced motion, where every rhythm it
         * bends is silent and the honest value is none.
         */
        if (!view.reduced) {
          const felt = MOOD_OF[moment];
          if (felt !== undefined) {
            companion.mood = clamp(companion.mood + felt, -1, 1);
          }
        }
        switch (moment) {
          case "kept":
            /* SOMETHING NEW EXISTS. The biggest flare in the world, and the
               eyes go DOWN to the ground where it landed — the creature looks
               at what was just made rather than at you making it.
               IT GATHERS FIRST. The eyes travel during the wind-up, so the
               look is already committed when the light arrives — the body
               sinks toward the thing, then answers it. Under reduced motion
               the gather is silent (it is rhythm) and the flare is immediate,
               which is the same rule the bob and the lean already follow. */
            if (!view.reduced) {
              companion.antAt = performance.now();
              companion.antFlare = 0.95;
            } else companion.flare = Math.max(companion.flare, 0.95);
            companion.eyeTX = 0;
            companion.eyeTY = 1.5;
            companion.attendUntil = performance.now() + 1500;
            companion.attendLean = 0;
            break;
          case "answered":
            /* YOU TOLD IT SOMETHING TRUE ABOUT YOURSELF. It looks UP at the
               sky it read you from, and holds longer than anything else here:
               this is the slow one, because being understood is not a ping.
               It gathers too — the only other moment loud enough to deserve a
               wind-up. The rest stay immediate on purpose: a creature that
               winds up for a tap is a creature that is never simply present. */
            if (!view.reduced) {
              companion.antAt = performance.now();
              companion.antFlare = 0.72;
            } else companion.flare = Math.max(companion.flare, 0.72);
            companion.eyeTX = 0;
            companion.eyeTY = -1.6;
            companion.attendUntil = performance.now() + 2800;
            companion.attendLean = 0;
            break;
          case "arrived":
            /* A NEW WALL. It looks around the room it just walked into — the
               glance system already does this on its own, so this simply asks
               for one now, with a modest flare. Arriving is not an
               achievement and must not be lit like one. */
            companion.flare = Math.max(companion.flare, 0.5);
            companion.glanceAt = performance.now();
            companion.eyeTY = -0.5;
            companion.attendUntil = performance.now() + 1200;
            break;
          case "shared":
            /* IT WENT OUT TO PEOPLE. The eyes go sideways, the way the world
               is laid out — the rooms are over there, and that is where the
               statement just went. */
            companion.flare = Math.max(companion.flare, 0.6);
            companion.eyeTX = 2.2;
            companion.eyeTY = 0;
            companion.attendUntil = performance.now() + 1600;
            companion.attendLean = 0.04;
            break;
          case "let-go":
            /* SOMETHING WAS RELEASED. The one moment with NO flare: light
               rising as a memory leaves would be the creature congratulating
               you for it. It looks down and away instead, and dims a touch.
               Fading never deletes, and letting go is not a win. */
            companion.flare = Math.min(companion.flare, 0.1);
            companion.eyeTX = -1.4;
            companion.eyeTY = 1.2;
            companion.attendUntil = performance.now() + 1900;
            companion.attendLean = -0.03;
            break;
          default:
            /* the plain acknowledgment: a tap was heard */
            companion.flare = Math.max(companion.flare, 0.42);
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
        if (!b) return null;
        const M = 20; /* never closer than this to an edge */
        const w = Math.min(Math.max(360, Math.min(view.w * 0.3, 500)), view.w - 48);
        const cx = view.w / 2; /* the companion holds the middle of the frame */
        const cy = companion.y - cam.y;
        /* which side is the memory on? the words go to the other one */
        const orbX = b ? b.x - cam.x : cx;
        const wantRight = orbX <= cx;
        const gap = companion.size * 0.72;
        let left = wantRight ? cx + gap : cx - gap - w;
        /* if that side cannot hold it, take the other; if neither can, the
           frame is too narrow for beside-anything and it becomes a sheet */
        if (left < M || left + w > view.w - M) {
          left = wantRight ? cx - gap - w : cx + gap;
        }
        if (left < M || left + w > view.w - M) {
          return { left: Math.round((view.w - w) / 2), top: null, bottom: Math.round(view.h - (view.h - M)) };
        }
        /*
         * AND WHEN THE COMPANION IS NOT IN THE FRAME, IT MEETS THE MEMORY.
         *
         * "Beside the companion" is the right rule only while the companion
         * can be seen. Down in the field it cannot: `cy` is far above the
         * viewport, the clamp pins the card to 56px, and it opens hard against
         * the top edge — nowhere near the orb, and nowhere near the creature
         * either, which is the one thing this placement exists to avoid.
         *
         * So the anchor falls back to the orb itself. The gesture the block
         * above describes — the orb, the companion turned toward it, then what
         * it found — is still what happens whenever all three are on screen;
         * this only decides where to read from when the middle term is gone.
         *
         * The ceiling is solved from the card's own declared height rather
         * than a flat 52% of the viewport, or a memory beside a low orb gets
         * pulled back up to the middle for no reason a reader can see.
         */
        const inFrame = cy > 80 && cy < view.h - 80;
        const anchorY = inFrame ? cy : b ? b.y - cam.y : view.h * 0.5;
        const h = Math.min(view.h * 0.62, 560);
        const maxTop = Math.max(56, view.h - h - M);
        const top = clamp(anchorY - companion.size * 0.34, 56, maxTop);
        return { left: Math.round(left), top: Math.round(top), bottom: null };
      },
      toTop: () => {
        aimTo(0, 0);
      },
      /* UP TO WHAT IS TIMELESS — programmatic, exempt from the snap, from
         EVERY column. This refused any column but your own, with the comment
         "a room's values are not a thing this world claims to hold" — and the
         founder reversed that claim (2026-08-27: "philosophies & value should
         be available on every page since every room will eventually have its
         own"). The sky over a room is empty today and says so honestly, in
         the room's own name — a place is honest where a locked door is not,
         which is the same reasoning the way up has always carried. */
      toSky: () => {
        if (trip.active) return;
        gesture.snapAt = 0;
        cam.vel = 0;
        aimTo(view.layout.minCam, 0);
      },
      /* DOWN TO THE GROUND, the same glide aimed the other way. It is what the
         count of what you have kept opens: a line that says how much is down
         there is a promise that you can go and look. */
      toGround: () => {
        if (trip.active) return;
        gesture.snapAt = 0;
        cam.vel = 0;
        aimTo(view.layout.maxCam, 0);
      },
      travel,
      /**
       * A reflection was kept. This is not a celebration animation: one more
       * answered reflection and a touch just now are exactly what the real
       * activation engine scores, so the orb's aliveness is recomputed from
       * the same rule and the light rises to where it now belongs. The swell
       * on the way is the state change being announced, and the companion
       * answers with a flare.
       */
      reflectionChanged: (inspirationId: string, delta: number) => {
        const matches = new Set<Ball>();
        for (const b of list) {
          if (b.id === inspirationId || b.sigId === inspirationId) matches.add(b);
        }
        for (const b of groupBallsRef.current.values()) {
          if (b.id === inspirationId || b.sigId === inspirationId) matches.add(b);
        }
        for (const b of matches) {
          const from = b.alive;
          b.reflections = Math.max(0, b.reflections + delta);
          if (delta > 0) b.updatedMs = Date.now();
          colorBall(b, TRef.current);
          b.aliveFrom = from;
          b.aliveTo = b.alive;
          if (delta > 0) {
            /* a saved answer brings the orb back to life in this beat */
            b.alive = from;
            b.alivePow = Math.pow(from, 1.4);
            b.relightAt = view.reduced ? 0 : performance.now();
            if (view.reduced) {
              b.alive = b.aliveTo;
              b.alivePow = Math.pow(b.aliveTo, 1.4);
            }
          } else b.relightAt = 0;
        }
        if (delta > 0 && matches.size > 0) companion.flare = Math.max(companion.flare, 0.9);
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
           that happens in this layout, and the creature looks down at it.
           After the duplicate guard, so a re-render never re-celebrates. */
        simApiRef.current?.acknowledge("kept");
        // The spark belongs to the capture now; its field orb waits for the
        // complete initial geometry rather than being resized/repositioned.
        if(fieldLoadingRef.current)return;
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
        /* AND INTO ITS SCENE, or it is nowhere — #289 and this branch found
           the same bug the same night. `sceneAdd` is that fix with its mirror
           attached: `dropBall` had the omission facing the other way, and a
           retracted keep went on holding a place on the ground. See the
           helper for the measurement. */
        sceneAdd(b);
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
        if (view.reduced || spot === null || spot.y >= homeY) {
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
        companion.flare = Math.max(companion.flare, view.reduced ? 0 : 0.9);
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
        pour.doomed++;
        if (view.reduced) {
          b.active = false;
          b.leaving = false;
          b.gone = 1;
        } else {
          b.leaving = true;
        }
        wake();
      },
      setProvenance: (byWall: Map<string, Provenance>) => {
        poster.byWall = byWall;
        /* each provenance orb carries the words of its own that carried the
           reading — the panel marks that passage inside the raw text */
        for (const [, prov] of byWall) {
          for (const b of list) {
            const q = prov.get(b.id);
            if (q) b.quote = q;
          }
        }
        poster.provenance = byWall.get(spaceKey(curWall())) ?? new Map();
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
       * two signals was the one drag-only act in this world. Travel and the
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
      goToWall: (target: number, instant?: boolean) => {
        const go = () => {
          lastGoRef.current = `enter col=${trip.col} target=${target}`;
          if (trip.col === target) {
            lastGoRef.current = `refused: already at col ${trip.col}`;
            return;
          }
          const dest = clamp(target, colLo(), colHi());
          if (dest === trip.col) {
            lastGoRef.current = `refused: clamp(${target},${colLo()},${colHi()}) = ${dest} = col`;
            return;
          }
          lastGoRef.current = `travelling ${trip.col} -> ${dest}`;
          /* committed: a rebuild from here on resumes at the destination */
          headingRef.current = dest;
          const dir: 1 | -1 = dest > trip.col ? 1 : -1;
          if (selectedIdRef.current) release();
          /* every wall the glide passes is warmed, not just the destination:
             they are all about to be on screen */
          for (let c = trip.col + dir; dir > 0 ? c <= dest : c >= dest; c += dir) {
            loadWallRef.current(wallAt(c));
          }
          trip.awaitingWake = false;
          trip.dest = dest;
          trip.dir = dir;
          cam.xTarget = dest * view.w;
          cam.xBack = false;
          gesture.leadOn = false;
          /**
           * CHANGING FORM IS A TURN IN PLACE, NOT A CUT AND NOT A JOURNEY.
           *
           * Founder: "make transformation between me and my agent more
           * natural", and before that: "rather than my agent like moving
           * rooms it kind of like switching itself up to its agent form".
           *
           * `instant` began as the reduced-motion path, which was right about
           * the camera and wrong about the creature. The dissolve was already
           * built — `FORM_FADE_MS` across `form.at` — but its whole design is
           * that it HIDES INSIDE THE TURN: the comment on it says "the
           * companion turns away as yours and comes back as theirs, and there
           * is no frame at which two different creatures are both in focus."
           * Take the journey away and the turn goes with it, so the dissolve
           * ran face-on: 320ms of two creatures double-exposed, which is
           * exactly the thing that comment exists to forbid. It read as a
           * glitch because it was one.
           *
           * So the camera still does not move — nothing slides left or right,
           * which was the other half of the ask — and the creature turns
           * where it stands. `yaw` is set a half turn away and `unwindAt`
           * released on the same frame, so the existing unwind carries it
           * back over `UNWIND_MS` on the cubic it already uses, with the
           * dissolve finishing while the creature is still turned away. One
           * motion, no new easing, and the aura never changes — which is what
           * says it is the same companion the whole way through.
           */
          if (view.reduced || instant) {
            trip.col = dest;
            cam.x = cam.xTarget;
            companion.off = 0;
            /* ONE LINE, because the unwind arms itself. `arriveColumn()`
               below clears `unwindAt`, and the unwind branch then reads
               whatever `yaw` is, normalises it the short way round and eases
               it to zero over `UNWIND_MS`. Setting the turn is the whole
               instruction; setting the easing too would be a second copy of
               it, and the two would drift. */
            if (instant && !view.reduced) {
              /**
               * A TURN, AND ONLY A TURN.
               *
               * Founder, on a recording of the form change: "its not spinning
               * in the same place."
               *
               * The yaw is a planet turn — the features traverse a sphere
               * while the body holds still — so the spin itself cannot move
               * anything. What moves it is `lean`, which the draw composes
               * from three terms: the travel offset, the camera's pitch, and
               * `attendHold`, the lean toward something you just tapped. The
               * form switch IS a tap, on a control right beside the creature,
               * so it was leaning at the button it had just been pressed on
               * for the whole length of the turn — a tilt plus a rotation
               * reads as a wobble, not as a creature turning where it stands.
               *
               * All three are cleared here rather than suppressed in the draw
               * because they are each correct in their own context: leaning
               * into a drag, into camera motion, and toward a thing you
               * pointed at are all behaviours worth keeping. They simply have
               * no business in a change of form, which is not a direction.
               */
              companion.yaw = TAU / 2;
              companion.off = 0;
              companion.pitch = 0;
              companion.attendHold = 0;
              companion.attendUntil = 0;
            }
            arriveColumn();
            wake();
            return;
          }
          trip.active = true;
          const span = Math.abs(dest - trip.col);
          trip.ms = travelSpanMs(span);
          trip.at = performance.now();
          trip.fromX = cam.x;
          /* AND IT HAS TO LOOK FAST, NOT MERELY BE FAST.
             The sqrt duration already makes a five-wall crossing move at
             about 2.2x the speed of a one-wall one, but speed you cannot see
             is not speed: the companion held the same lead and the same lean
             either way, so a long glide read as the same walk over a longer
             corridor.

             The lead is what carries velocity in this layout — how far ahead
             of the camera the creature runs, which the body's tilt is already
             derived from, so leaning harder comes free. It grows with the
             same sqrt as the duration and caps at a bit over twice the
             single-wall lead: past that it stops reading as running and
             starts reading as the character having come loose. */
          const urgency = Math.min(2.15, Math.sqrt(Math.max(1, span)));
          companion.lead = dir * Math.min(view.w * TRAVEL_LEAD_X, 190) * urgency;
          companion.from = companion.off;
          trip.yaw = true;
          companion.yawTarget = dir * (TAU / 4);
          companion.unwindAt = 0;
          wake();
        };
        /* travel needs the camera parked; take it home first */
        if (Math.abs(cam.y) > 2) {
          aimTo(0, 0);
          window.setTimeout(go, 260);
          return;
        }
        go();
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
           solves against is layout.fieldBottom, which is layoutH − dialH, and
           at rest in the field that is exactly vh − dialH on screen. An audit
           that measured a different band from the one assignHomes fits into
           would be grading a promise nobody made. */
        const bandBottom = view.h - view.dialH;
        let present = 0;
        let onScreen = 0;
        let clippedTop = 0;
        let clippedBottom = 0;
        let highest = Infinity;
        let lowest = -Infinity;
        for (const b of list) {
          /* THE WALL YOU ARE STANDING ON, NOT EVERY WALL AT ONCE. This counted
             the whole list, so `present` read the same on every wall (the sum
             of all of them) and `clippedTop` counted balls belonging to walls
             you were not on — still at the homeY of zero they were built with,
             a full viewport above the band. An audit that grades a population
             the layout never placed reports a break that is not there, which
             is worse than no audit: it was the instrument, not the field. */
          if ((b.agentId ?? "") !== curWall().id || !standingOk(b, curWall()))
            continue;
          if (b.capturedMs > TRef.current) continue;
          present++;
          const home = b.peek ? lerp(b.homeY, b.peekY, peekLift()) : b.homeY;
          const hi = home - b.ampY - b.r - cam.y;
          const lo = home + b.ampY + b.r - cam.y;
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
          /* the audit's field names are a contract the tests read: they stay
             `vh`/`vw` however the state behind them is spelled */
          vh: view.h,
          vw: view.w,
          camY: Math.round(cam.y),
          fieldRest: Math.round(view.layout.maxCam),
          present,
          onScreen,
          clippedTop,
          clippedBottom,
          highest: Math.round(highest),
          lowest: Math.round(lowest),
          bandTop,
          bandBottom,
          wallKind: curWall().kind,
          wallId: curWall().id,
          ground,
          provenanceCount: poster.provenance.size,
          col: trip.col,
          travelling: trip.active,
          lastGo: lastGoRef.current,
          colLo: colLo(),
          colHi: colHi(),
          wallCount: wallsRef.current.length,
          owners: (() => {
            const by: Record<string, number> = {};
            for (const b of list) {
              if ((b.agentId ?? "") !== curWall().id) continue;
              const k = b.ownerProfileId ?? "(none)";
              by[k] = (by[k] ?? 0) + 1;
            }
            return by;
          })(),
          /* drawn-ness, not just placed-ness: an orb can have a home in the
             band and still never reach the screen if it is inactive, has no
             radius, or has no light. */
          drawn: (() => {
            let active = 0;
            let rMin = Infinity;
            let rMax = 0;
            let aliveMax = 0;
            let arriveMin = Infinity;
            let dimmed = 0;
            let glowing = 0;
            for (const b of list) {
              if ((b.agentId ?? "") !== curWall().id || !standingOk(b, curWall()))
                continue;
              if (b.active) active++;
              rMin = Math.min(rMin, b.r);
              rMax = Math.max(rMax, b.r);
              aliveMax = Math.max(aliveMax, b.alive);
              arriveMin = Math.min(arriveMin, b.arrive);
              /* mid-ease values are neither yet; half is the crossing */
              if (b.dim > 0.5) dimmed++;
              if (b.glow > 0.5) glowing++;
            }
            return {
              active,
              rMin: Math.round(rMin),
              rMax: Math.round(rMax),
              aliveMax: Number(aliveMax.toFixed(3)),
              arriveMin: Number(arriveMin.toFixed(2)),
              dimmed,
              glowing,
            };
          })(),
          company: companySeats.map(seat => ({ ...seat, y: seat.y - cam.y })),
          /* the same question asked upward: how far the sky has leaned into
             headquarters. There is nothing IN it to elect any more, so the
             scalar is the whole answer — and it still tells a rip-out from a
             quiet day, which is what this was always for. */
          sky: {
            lean: Number(skyPeek().toFixed(3)),
            minCam: Math.round(view.layout.minCam),
          },
        };
      },
    };
    wake();

    return () => {
      clock.running = false;
      cancelAnimationFrame(clock.raf);
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
      /* HAND THE WORLD TO WHOEVER REBUILDS THIS LOOP. Copies, not the live
         objects: the next run mutates what it is given from its first frame,
         and a teardown must not be able to reach into it. See `carryRef`. */
      carryRef.current = {
        cam: { ...cam },
        trip: { ...trip },
        companion: { ...companion },
        primed: view.primed,
        /*
         * A MEMORY IS CARRIED UNDER BOTH OF ITS NAMES.
         *
         * A keep exists twice before it settles: the local seed born at the
         * mouth, `kept-…`, and the row the server hands back with an id of its
         * own. The pour builder drops the seed the moment `inspirations`
         * contains either name (see `kept` above), so on the rebuild that
         * arrival causes, the local ball LEAVES the list and the server ball
         * ENTERS it — and keyed only by the local id, the carry has nothing to
         * say about the newcomer. It reads as a memory that has never been
         * seen, so it pours: falling in from above a second after you watched
         * the same words fall out of the sentence.
         *
         * Filing each position under `sigId` as well is what lets the second
         * name find the first one's place. It is the same memory; it should
         * arrive once.
         */
        balls: new Map(
          list.flatMap((b) => {
            const at = { x: b.x, y: b.y };
            const under: [string, { x: number; y: number }][] = [[b.id, at]];
            if (b.sigId && b.sigId !== b.id) under.push([b.sigId, at]);
            return under;
          }),
        ),
      };
      simApiRef.current = null;
      ballsRef.current = null;
      /* room orbs belong to this run of the loop; the DATA cache stays */
      groupBallsRef.current.clear();
    };
    /* The field is what you kept AND what your agents kept, so the loop waits
       for both before it builds anything — one pour, never a second one. */
    /*
     * `citations` AND `signals` ARE DELIBERATELY NOT DEPENDENCIES, and an
     * earlier attempt at this bug added them.
     *
     * The reasoning was sound and the fix was not. Every orb is built from
     * `seedOf(c, citations, signalById)`, so both decide whether a memory looks
     * like something rests on it, and neither was listed — a memory a signal
     * was later found to rest on kept the appearance of one nothing rested on.
     * Adding them to this list does make the light correct.
     *
     * It also re-pours the field every time either changes. `view.primed` is
     * declared INSIDE this effect, so a rebuild resets it, every ball is
     * snapped back to its home, and the arrival animation replays for memories
     * that never moved. That is the thing this file forbids in the line
     * directly above — one pour, never a second one — and it is what restarted
     * the camera at column zero mid-travel the last time this effect was
     * rebuilt for a good reason.
     *
     * The light is corrected by the re-light effect below instead: it
     * re-derives the four facts in place and re-runs `colorBall`, with no
     * rebuild, no relayout and no motion. `skyRef` is what keeps THIS list
     * honest — the pour reads the sky through a ref, so it sees what is true at
     * the moment it pours rather than closing over a value that moves.
     */
}
