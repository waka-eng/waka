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
 *   the sky            LAYER 2 — signals: evidence-backed signals. What is
 *                      `emerging` hangs overhead with the memories it cites
 *                      orbiting it, which is where a pattern's "why" is
 *                      finally readable.
 *   headquarters       LAYER 3 — the one top-of-mind artifact. Exactly one
 *                      per profile, so the poster is never one of several;
 *                      beneath it, the signals it stands on.
 *   the field          LAYER 1 — inspirations: every capture this profile
 *                      owns, one orb each, always the whole set.
 *
 * The horizontal axis is WHOSE wall you are standing on — agents to the left,
 * you at the origin, rooms to the right. The field never changes with it: the
 * ground is always your own archive ("3번째 섹션에서는 양옆 못 움직여야 해").
 *
 * A room is a wall of STATEMENTS. Members share signals, never inspirations, so
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

import { hueCss } from "../lib/appearance";
import { clamp, clamp01, DAY_MS, easeOut, kd, lerp, TAU } from "../lib/num";
import {
  GRAIN_PX,
  GRAIN_TILE,
  VIGNETTE,
  mix,
  rgbCss,
} from "../canvas/sprites";
import {
  dedupeEvidence,
  readSkyLayout,
  type Candidate,
  type Neb,
  type Sat,
} from "../space/signal/sky";
import {
  computeClusters,
  focusOn,
  layoutSky,
  makeNeb,
  persistSky,
  releaseHolds,
  sayWho,
  solveSats,
  springs,
  stepSky,
  CONDENSE_MS,
  FOCUS_DIM,
  FOCUS_POP,
  NEB_CORE,
  type SkyDeps,
} from "../space/signal/sky-engine";
import { paintSky } from "../space/signal/sky-paint";
import { useEditing } from "../space/editing";
import { deriveAgentChrome } from "../space-kinds/agent";
import {
  deriveGroupChrome,
  groupWallOrbs,
  type GroupData,
} from "../space-kinds/group";
import {
  bakeBeing,
  buildPalette,
  type BeingSprites,
  type Palette,
} from "../canvas/palette";
import { useMeasured } from "../canvas/measured";
import { BODY_TIERS, bodyPath } from "../character/raster";
import { GroupPanel } from "../space-kinds/GroupPanel";
import { SpaceSettings } from "../space/settings/SpaceSettings";
import { hasDial, hasSky, spaceKey, type Space } from "../space-kinds";
import { agentBeing, OWNER_BEING, unit, type Being } from "../character/body";
import { posterWords } from "../space/top-of-mind/poster";
import {
  deriveAmbition,
  formingWords,
  type Adopted,
  type JarNote,
  type Proposal,
  type WallChrome,
  type Provenance,
  type ReflectState,
} from "../space/top-of-mind/board";
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
import { paintField } from "../space/inspiration/field-paint";
import {
  bornBall,
  makeAgentBall,
  makeBall,
  seedOf,
  skyOf,
  type Ball,
  type BornSeed,
} from "../space/inspiration/orb";
import { showsDebug } from "../lib/dev-build";
import type { AgentBundle } from "../lib/agent-contract";
/* THE ONLY TWO IMPORTS IN THE PRODUCT THAT REACH INVENTED DATA, and they are
   deliberately on their own lines so that a grep for `lib/fixture` over `src/`
   returns this page and nothing else. Both are read in exactly one place —
   `loadAgentWalls` and the archive fetch's catch — and both are dev-gated
   there. If a third of these ever appears, the question to ask is not whether
   it compiles but which screen is now capable of showing a person a memory
   they never had. */
import { MOCK_AGENTS, MOCK_AGENT_BUNDLES } from "../lib/fixture/agent-walls";
import { offlineHome, type OfflineHome } from "../lib/fixture/offline-home";
import {
  agoWords,
  citedWords,
  dateWords,
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
  fetchProfiles,
  type ApiGroupProposal,
  type ApiGroupMember,
  type ApiGroupSummary,
  type ApiGroupFieldInspiration,
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
  type EvidenceRef,
  type Signal,
  type TopOfMind,
} from "../lib/data";
import { useOptionalAuth } from "../lib/auth-context";

import "../styles/home.css";


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
const SELF_WALL_NAME = "Me";

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
/** At most this many candidates get a body in the sky. */
const SKY_MAX = 9;
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
 * WHAT IS LEFT OF THE SKY'S NUMBERS.
 *
 * The tuning the ENGINE reads — the orbital period and width, the emergence,
 * the nesting, the clustering threshold — moved with it to
 * `space/signal/sky-engine.ts`. The tuning the PAINTER reads went a step
 * further and moved into `space/signal/sky-paint.ts`, which now owns the one
 * number only it ever used (how much a satellite dims behind its candidate).
 * `FOCUS_POP`, `NEB_CORE` and `CONDENSE_MS` are imported back from the engine
 * rather than written down twice, and so is `FOCUS_DIM` — which the painter
 * and this page's DOM sync both read, and which would be a candidate whose
 * words and whose light disagreed about being the subject if they ever drifted
 * apart. What remains below is the page's own: read by what the page still
 * lays out itself and by nothing else.
 */
/**
 * Air between a satellite and the name of whoever saved it — and the least the
 * name is ever left from the edge of the sky, which clips.
 */
const SAT_SAY_GAP = 12;
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


// ---------------------------------------------------------------------------
// THE SPECIES: one companion, many beings
// ---------------------------------------------------------------------------


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
// Walls: the horizontal axis, and what stands on it (v10)
// ---------------------------------------------------------------------------


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
       from the agent's OWN inspirations, its OWN signals and its OWN top of mind.
       The database has kept them separate all along; nothing is merged with
       the owner's, and a wall whose fetch fails stands empty rather than
       borrowing anything to fill itself. */
    return Promise.all(
      real.map(async (p) => {
        const [inspirations, signals, tom] = await Promise.all([
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
          /* what the claim rests on: the signals it cites, which is what an
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
            createdAt: inspirations.length
              ? iso(Math.min(...inspirations.map((c) => c.capturedMs)))
              : "",
          },
          /* THE DIAL NEEDS REAL DATES OR IT SCRUBS NOTHING. Each entry of the
             board is a moment this agent said something about itself, so the
             board's entries ARE its history. */
          direction: { current: lead ? reading(lead) : null, history: entries.map(reading) },
          /* its sky: what it is still forming and has not adopted */
          topOfMind: {
            notes: signals
              .filter((s) => s.status === "emerging")
              .map((s) => ({
                id: s.id,
                title: s.statement,
                isProvisional: true,
                createdAt: iso(s.createdMs),
                evidenceSignalIds: [],
              })),
          },
          inspirations: inspirations.map((c) => ({
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
    minCam: -vh,
    /* The peek line sits clear of the time dial, which is fixed to the
       bottom of the viewport in both sections — otherwise the topmost orbs
       and the dial occupy the same strip. */
    fieldTop: vh - dialH - PEEK,
    /* AND THE FIELD ENDS EXACTLY WHERE THE DIAL BEGINS — not forty pixels of
       air above it. The reserve is a real, measured piece of chrome, so it is
       the only thing the field owes the bottom of the screen. */
    fieldBottom: layoutH - dialH,
  };
}

// ---------------------------------------------------------------------------
// Palette + sprites (rastered once at load and on DPR change, never per frame)
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// Ambition fallback chain
// ---------------------------------------------------------------------------

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
 *      until the archive fetch has actually rejected: `offlineHome()` is
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
 * The shapes are the API's own, to the field — see `lib/api/` — so the swap
 * is invisible to everything downstream: the ball constructor, the sky, the
 * peek election and the panel all read exactly what they read from the wire.
 *
 * ==========================================================================
 */


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
  /**
   * Whose ground to stand in on a group's wall — a member's profile id, or
   * null for your own. Yours is the default everywhere and the only ground on
   * a wall that has one owner.
   */
  standIn: (ownerProfileId: string | null) => void;
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
  };
}

export default function HomePage(): JSX.Element {
  /* No gate. This is home now — it is what a signed-in person lands on, in
     every build. The dev gate that used to stand here existed while this was
     a prototype living beside the real surface; the only things still behind
     `showsDebug()` are the offline fixture and the mock walls, which is where
     that gate belongs. */
  return <HomeExperience />;
}

function HomeExperience(): JSX.Element {
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  /**
   * NOTHING BEHIND THIS WORLD BUT THE FIXTURE — see offlineHome().
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
   * The answer is not a digest. Announcing "3 new signals" before the world
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
  const [inspirations, setInspirations] = useState<Inspiration[] | null>(null);
  const [notes, setNotes] = useState<JarNote[] | null>(null);
  /**
   * THE SKY, IN THE CANON'S SENSE — layer 2. Each is an evidence-backed
   * pattern: `emerging` is still forming overhead, `active` is what
   * headquarters stands on, `retired` has sunk. Null until the answer is in.
   */
  const [signals, setSignals] = useState<Signal[] | null>(null);
  /**
   * WHICH PATTERNS REST ON WHICH MEMORY — built from the sky, consumed by the
   * field. A capture under the canon knows nothing about its own meaning, so
   * everything a ball shows beyond its words and its clock is read from here,
   * and a memory nothing cites shows none of it rather than a default.
   */
  const [citations, setCitations] = useState<Map<string, Evidence[]>>(new Map());
  /**
   * THE SKY AS THE FIELD READS IT — one value, and a ref beside it.
   *
   * The two halves are always read together (`skyOf` needs both), so they are
   * one object: paired here, they cannot be read one render apart. The map is
   * built once per change rather than once per pour, and it is deliberately
   * NOT called `signalById` — that name is taken a few hundred lines below by
   * the viewer's CAPTURES by id, and the pour used to declare a second one
   * shadowing it, which is a collision worth not renewing.
   *
   * The ref is the seam the pour reads through. The pour's dependency list is
   * `[inspirations, agents, walls, groupFieldTick]` and must stay that way —
   * one pour, never a second one — so it may not close over a value that
   * changes underneath it, in the same way `skyDeps` hands the sky engine
   * accessors onto refs rather than values that were true when the loop
   * started. What makes a late sky visible is the re-light effect below the
   * pour, not this ref: the ref only keeps the pour honest about reading the
   * sky AT THE MOMENT IT POURS.
   */
  const sky = useMemo(
    () => ({
      citations,
      signals: new Map((signals ?? []).map((p) => [p.id, p] as const)),
    }),
    [citations, signals],
  );
  const skyRef = useRef(sky);
  skyRef.current = sky;
  /** LAYER 3 — the one artifact this profile stands on. Null before the first
      synthesis, which the layout says in words rather than leaving blank. */
  const [topOfMind, setTopOfMind] = useState<TopOfMind | null>(null);
  /** The background sweep has finished. The only thing that waits for it is
      imagery, which must appear all at once or not at all. */
  const [sweepDone, setSweepDone] = useState(false);
  /** pattern id → what it rests on. Filled by the sky's background sweep;
      read by the orbit, which never fetches on tap. */
  const evidenceBySignalRef = useRef<Map<string, Evidence[]>>(new Map());

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
    setSignals(rows);
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
        evidenceBySignalRef.current.set(p.id, full.evidence);
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
        for (const e of evidenceBySignalRef.current.get(c.id) ?? [])
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
   * the artifact from the signals as they now stand, so every "yes" and
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
   * Null until the answer is in — the field is built from the owner's inspirations
   * AND the agents' kept memories together, and it is built once, whole.
   */
  const [agents, setAgents] = useState<AgentBundle[] | null>(null);
  /** Rooms that have woken this session: their words exist, whole. */
  const [wokenGroups, setWokenGroups] = useState<ReadonlySet<string>>(() => new Set());
  /* the ref's change signal: the ball list is rebuilt when a room's ground lands */
  const [groupFieldTick, setGroupFieldTick] = useState(0);
  const setMembersRef = useRef<(m: Map<string, ApiGroupMember[]>) => void>(() => {});
  /** Rooms whose data could not be fetched: the column says so, quietly. */
  const [failedGroups, setFailedGroups] = useState<ReadonlySet<string>>(() => new Set());
  /** Which wall the camera is standing on. Discrete, pushed from the loop. */
  const [atWall, setAtWall] = useState<Space>({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 });
  /**
   * WHERE YOU ARE STANDING, KEPT OUTSIDE THE LOOP.
   *
   * The simulation is rebuilt whenever its inputs change — and one of those,
   * `groupFieldTick`, fires exactly when a group's memories arrive. So the
   * data you travelled to fetch was itself what cancelled the journey: the
   * effect tore down mid-glide and the new one started at `col = 0`, walking
   * you home. First visits to a group were the only ones affected, because a
   * second visit is served from cache and ticks nothing, which is why this
   * read as "some rooms never load" rather than as a travel bug.
   *
   * A ref survives the rebuild, so the new loop starts where the old one was.
   */
  const atWallRef = useRef<Space>(atWall);
  atWallRef.current = atWall;
  /**
   * WHERE YOU WERE HEADING, IF THE REBUILD CAUGHT YOU MID-STRIDE.
   *
   * `atWallRef` only updates on ARRIVAL, so preserving it alone does not help
   * a glide that was cancelled before it landed — which is precisely the case,
   * since the fetch that causes the rebuild is the one travel itself started.
   * This is set the moment travel is committed and cleared when it lands, so a
   * loop rebuilt in between resumes at the destination.
   *
   * The glide is lost when that happens; arriving is not. Losing the animation
   * to an interruption is a cost worth paying, being walked back to your own
   * wall by the data you asked for is not.
   */
  const headingRef = useRef<number | null>(null);
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

  /**
   * THE TWELVE ELEMENTS THE CANVAS SIDE READS AND WRITES — see
   * `canvas/measured.ts` for the membership rule and why they are ref objects
   * rather than the elements themselves.
   *
   * They were twelve separate refs declared here. Nothing about the traffic
   * changed; what changed is that a block of this file's JSX can now be handed
   * ONE named seam instead of three anonymous handles, which is the thing that
   * was holding the ready field, the sky and the reading panel in the page.
   */
  const measured = useMeasured();
  const panelRef = useRef<HTMLDivElement>(null);
  /* the prose itself, so a long memory can be opened at its marked span */
  const panelTextRef = useRef<HTMLParagraphElement>(null);
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
  /* why the last goToWall did or did not move — dev diagnosis only */
  const lastGoRef = useRef<string>("never called");
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
  const walls = useMemo<Space[]>(() => {
    const out: Space[] = [];
    (agents ?? []).forEach((a, i) => {
      out.push({ kind: "agent", id: a.agent.id, name: a.agent.name, col: -(i + 1) });
    });
    out.reverse(); /* leftmost first, so the array is the axis in order */
    out.push({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 });
    groups.forEach((g, i) => {
      out.push({ kind: "group", id: g.id, name: g.name, col: i + 1 });
    });
    return out;
  }, [agents, groups]);
  const wallsRef = useRef<Space[]>([]);
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
  const groupCacheRef = useRef<
    Map<string, { status: "pending" | "ready" | "failed"; data: GroupData | null }>
  >(new Map());
  const groupChromeRef = useRef<Map<string, WallChrome>>(new Map());
  /* a room's ground, by group id, filled when the room wakes */
  const groupFieldRef = useRef<Map<string, ApiGroupFieldInspiration[]>>(new Map());
  /** Namespaced room-orb id → ball, for the panel and relight lookups. */
  const groupBallsRef = useRef<Map<string, Ball>>(new Map());
  /** Rooms whose orbs have already poured this session: no re-pour on return. */
  const groupVisitedRef = useRef<Set<string>>(new Set());

  /**
   * Fetch one room's jar — its readings' evidence plus its direction —
   * starting the moment travel toward it begins, so arrival usually finds it
   * ready. The room wakes only when the character has arrived AND this has
   * resolved: a room never renders half-poured. Cached for the session; a
   * failure clears itself so the next travel toward it tries again.
   */
  const loadGroup = useCallback((groupId: string) => {
    const cache = groupCacheRef.current;
    const got = cache.get(groupId);
    if (got && got.status !== "failed") return;
    cache.set(groupId, { status: "pending", data: null });
    setFailedGroups((prev) => {
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
      fetchGroupField(groupId).catch(() => [] as ApiGroupFieldInspiration[]),
    ])
      .then(([top, wall, proposals, field]) => {
        wallSignalsRef.current.set(groupId, wall);
        groupFieldRef.current.set(groupId, field);
        setGroupFieldTick((n) => n + 1);
        const evidence = groupWallOrbs(wall, top);
        const name = groupsRef.current.find((g) => g.id === groupId)?.name ?? "";
        const open = proposals.find((p) => p.status === "open");
        const openMs = open ? Date.parse(open.createdAt) || 0 : null;
        groupChromeRef.current.set(
          groupId,
          deriveGroupChrome(name, top, openMs, evidence, groupCompany(membersRef.current.get(groupId))),
        );
        cache.set(groupId, { status: "ready", data: { evidence, top } });
        simApiRef.current?.wake();
      })
      .catch(() => {
        cache.set(groupId, { status: "failed", data: null });
        setFailedGroups((prev) => new Set(prev).add(groupId));
        simApiRef.current?.wake();
      });
  }, []);
  const loadGroupRef = useRef(loadGroup);
  loadGroupRef.current = loadGroup;

  /**
   * Warm a wall, whatever kind it is. A room fetches; an agent already has
   * everything (and will fetch the same way when the endpoints land); your own
   * wall has nothing to warm. The loop calls this the moment travel toward a
   * wall begins, so arrival usually finds it ready.
   */
  const loadWall = useCallback(
    (w: Space) => {
      if (w.kind === "group") loadGroup(w.id);
    },
    [loadGroup],
  );
  const loadWallRef = useRef(loadWall);
  loadWallRef.current = loadWall;

  /** The camera came to rest on a wall. Discrete, pushed from the loop. */
  const pushArrived = useCallback((w: Space) => {
    setAtWall((prev) => (prev.kind === w.kind && prev.id === w.id ? prev : w));
  }, []);
  const pushArrivedRef = useRef(pushArrived);
  pushArrivedRef.current = pushArrived;

  /** A room woke: its words may exist now. Discrete, pushed from the loop. */
  const pushWoken = useCallback((groupId: string) => {
    setWokenGroups((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
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
    const goOffline = (layout: OfflineHome) => {
      offlineRef.current = true;
      setOffline(true);
      setNotes(layout.notes);
      setSignals(layout.signals);
      setCitations(layout.citations);
      setTopOfMind(null);
      /* THE FIXTURE DESCRIBES THE WHOLE WORLD, NOT JUST YOUR WALL.
         This set no groups and no agents, so the dev fixture rendered exactly
         one column — which meant every wall-specific behaviour in this layout
         (a room's ground, the per-member hues, the legend, pixelated agent
         memories, the machine hand, the crossing quantization) could only
         ever be seen by signing in. Every one of those shipped unobserved,
         and several shipped broken.

         So the fixture now builds the same four rooms the product was
         designed around: one with only you, one with you and an agent, one of
         people, one of machines. It stays dev-gated — `offlineHome()` returns
         null unless `showsDebug()` — so nothing here can reach a real
         visitor. Its purpose is that the layout can be LOOKED AT without a
         session. */
      const iso = (t: number) => new Date(t).toISOString();
      const fixtureGroups: ApiGroupSummary[] = [
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
      for (const group of fixtureGroups) {
        const who =
          group.id === "fx-alone"
            ? [you]
            : group.id === "fx-pair"
              ? [you, yours]
              : group.id === "fx-people"
                ? [you, ...people]
                : [you, yours, ...bots];
        const field = who.flatMap((m, mi) =>
          Array.from({ length: 3 + (mi % 3) }, (_, k) => ({
            id: `${group.id}-${m.profileId}-${k}`,
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
        groupFieldRef.current.set(group.id, field);
      }
      setGroupFieldTick((n) => n + 1);
      setGroups(fixtureGroups);
      setProposal(null);
      setAdopted(layout.adopted);
      setProvenance(layout.provenance);
      setInspirations(layout.inspirations);
      setPhase("ready");
    };
    /* LAYER 1 — the field. The archive is the spine, so its answer alone
       decides whether this is the real layout or the fixture. */
    loadInspirations()
      .then((rows) => {
        if (dead || offlineRef.current) return;
        setInspirations(rows);
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
        const layout = offlineHome();
        /* NOT SIGNED IN IS NOT A FAILURE — but in dev it is an OPPORTUNITY.
           A 401 used to land in the same branch as a dead network, so a
           production build met a signed-out visitor with "reload to try
           again", an instruction that can never work. It goes to the door.

           In dev, where a fixture exists, the fixture wins instead: that is
           the only way the whole layout — every wall, every room, the hues,
           the legend — can be LOOKED AT without a session, which is what it
           is for. `offlineHome()` is null outside a dev build, so a real
           visitor still gets the door.

           That sentence was FALSE for a while and this is the line it was
           false at: the fixture asked `showsDebug()`, which also honours
           VITE_SHOW_INTERNAL, so a production build made with that flag
           answered a real visitor's 401 with two dozen invented memories
           painted as their own world. It now asks `inventedDataAllowed()`,
           which is DEV alone. */
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          if (!layout) {
            navigate("/login", { replace: true });
            return;
          }
          goOffline(layout);
          return;
        }
        /* outside dev there is no fixture and never was: the page says what
           it has always said when the archive cannot be reached */
        if (!layout) {
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
        goOffline(layout);
      });
    /* LAYER 2 — the sky. Patterns, and then in the background what each of
       them rests on: the citation index the field reads its meaning from and
       the orbit draws its satellites from. One request per pattern, off the
       critical path, so nothing overhead delays the pour below.

       Retired signals are kept. Nothing that exists pops out of existence —
       a pattern that lost its evidence sinks and cools, it is not deleted. */
    readSkyRef
      .current()
      .catch(() => {
        /* an empty sky is a real state: nothing has been distilled yet */
        if (!dead && !offlineRef.current) setSignals([]);
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
           that chain: the memories the signals under this statement were
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
       A room is a WALL OF STATEMENTS. Members share signals, never inspirations,
       so what hangs on a room's wall is other people's signals with their
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
          /* A room's board is NOT fetched here. `loadGroup` fetches it on
             arrival and stores it per room in `groupChromeRef`, which is where
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
             `groupChromeRef`, an agent reads `deriveAgentChrome`). So a room's
             sentence, carrying the room's name as its eyebrow, landed on the
             poster over your own headquarters. It won every time rather than
             only when yours was missing, because this loop awaits
             `fetchGroups()` and therefore always resolves after your own board
             has loaded: the poster painted your ambition on arrival and was
             overwritten seconds later, while you were reading it. That also
             breaks the law that the layout never moves unless you moved it.

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
        loadInspirations().then((rows) => setInspirations(rows)),
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
    if (!inspirations || phase !== "ready" || offlineRef.current) return undefined;
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
    const fresh = inspirations.filter((c) => c.capturedMs > since);
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
  }, [inspirations, phase]);

  /* ------------- the background sweep: newest first, four at a time -------------
     The peek orbs are the likeliest first tap, so the newest are fetched
     first. Four in flight keeps it off the critical path of the pour. */
  useEffect(() => {
    if (!inspirations) return undefined;
    /* There is no reading behind a fixture memory and there is no server to
       ask for one. Every word of it is already here — the same fact a memory
       kept at the mouth carries — so the sweep would be twenty-four requests
       that can only fail, and the panel would print a degradation notice over
       content that is not degraded. */
    if (offlineRef.current) return undefined;
    let dead = false;
    const queue = [...inspirations].sort((a, b) => b.capturedMs - a.capturedMs).map((s) => s.id);
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
         at a time under a reader's eyes, which is the mid-read swap the layout
         forbids everywhere else. */
      void Promise.all(Array.from({ length: 4 }, () => pump())).then(() => {
        if (!dead) setSweepDone(true);
      });
    }, 400);
    return () => {
      dead = true;
      window.clearTimeout(start);
    };
  }, [inspirations, loadDetail]);

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
    void inspirations;
    const m = new Map<string, string>();
    for (const d of detailsRef.current.values()) if (d.imageUrl) m.set(d.id, d.imageUrl);
    return m;
  }, [inspirations, sweepDone]);

  /**
   * The personal capture set, by id. A pattern's evidence is resolved against
   * THIS: an id with nothing behind it is skipped rather than invented, so
   * every satellite up in the sky stands for a memory that genuinely exists
   * down in the field.
   */
  const signalById = useMemo(() => {
    const m = new Map<string, Inspiration>();
    for (const s of inspirations ?? []) m.set(s.id, s);
    return m;
  }, [inspirations]);

  const dial = useMemo(() => {
    if (!inspirations || inspirations.length === 0) return null;
    let earliest = Infinity;
    for (const s of inspirations) {
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
  }, [inspirations, clockMs]);

  /* ------------- palette: resolve vars once, re-raster sprites ------------- */
  useEffect(() => {
    const root = measured.root.current;
    if (!root) return;
    const canvasEl = measured.canvas.current;
    const ctx2d = canvasEl ? canvasEl.getContext("2d") : null;
    if (!ctx2d) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pal = buildPalette(root, dpr, ctx2d);
    paletteRef.current = pal;
    /* the film is laid on the DOM layer once, here — never per frame */
    const grainEl = measured.grain.current;
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
  }, [urlById, inspirations]);

  /** THE SKY, AS THE FORMING LINE COUNTS IT: the signals still emerging,
      each with the moment it first appeared so the dial can wind past it. */
  const emerging = useMemo(
    () =>
      (signals ?? [])
        .filter((p) => p.status === "emerging")
        .map((p) => ({ createdMs: p.createdMs })),
    [signals],
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
                inspirations: [],
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
               `groupChromeRef` is the same map `wallChromeNow` reads for every
               room you are NOT standing on, filled by `loadGroup` on arrival,
               so this makes the wall you are on agree with the walls beside
               it instead of borrowing from you. Until it arrives the room is
               honestly blank — it says its own name and nothing else, rather
               than showing someone else's ambition under it. */
            atWall.kind === "group"
            ? groupChromeRef.current.get(atWall.id) ?? {
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
                   — the signals still emerging — because that is now what is
                   literally above the poster. It is time-aware too: scrub back
                   past a pattern and it reports what existed then, or says
                   nothing at all. */
                forming: formingWords(T, proposal ? proposal.createdMs : null, emerging),
                /* Nothing synthesized and nothing kept: the honest empty, and
                   it is the artifact's absence that says so, not a guess. */
                empty: topOfMind === null && (inspirations?.length ?? 0) === 0,
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
    /* `wokenGroups` is here because a room's board arrives asynchronously into
       `groupChromeRef`, which is a ref and so cannot itself trigger anything.
       `loadGroup` adds the room to this set in the same breath as filling that
       map, so depending on it is what makes the poster appear on arrival
       rather than at whatever unrelated render happens next. `wallChromeNow`
       already depends on it for the same reason. */
    [dial, adopted, notes, proposal, atWall, agents, emerging, topOfMind, inspirations, wokenGroups],
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
    /* the same two hops: entry → its signals → the memories they were drawn
       from, which is what the row beneath the poster is actually made of */
    for (const c of best.citedSignals)
      for (const e of evidenceBySignalRef.current.get(c.id) ?? [])
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
   * Rooms come from the ref the fetch fills; `wokenGroups` is in the deps
   * precisely so that this re-derives on the render where a room wakes, and
   * the read is therefore never stale.
   */
  const wallChromeNow = useMemo(() => {
    const nowMs = dial ? dial.end : Date.now();
    const m = new Map<string, WallChrome>();
    for (const w of walls) {
      if (w.kind === "agent") {
        const a = (agents ?? []).find((x) => x.agent.id === w.id);
        if (a) m.set(spaceKey(w), deriveAgentChrome(a, nowMs, nowMs));
      } else if (w.kind === "group") {
        const rc = groupChromeRef.current.get(w.id);
        if (rc) m.set(spaceKey(w), rc);
      } else {
        const at = deriveAmbition(nowMs, adopted, notes);
        m.set(spaceKey(w), {
          eyebrow: at.eyebrow,
          text: at.text,
          awayFrom: null,
          formingAlt: null,
          asOf: null,
          forming: formingWords(nowMs, proposal ? proposal.createdMs : null, emerging),
          empty: topOfMind === null && (inspirations?.length ?? 0) === 0,
          prevText: null,
        });
      }
    }
    return m;
  }, [walls, agents, wokenGroups, dial, adopted, notes, proposal, emerging, topOfMind, inspirations]);

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
      const byId = new Map(a.inspirations.map((s) => [s.id, s] as const));
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
      if (w.kind !== "group") continue;
      const cached = groupCacheRef.current.get(w.id);
      const lead = cached?.data?.top?.entries?.[0];
      const prov: Provenance = new Map();
      if (lead)
        for (const ev of cached?.data?.evidence ?? [])
          if (ev.citedBy.includes(lead.body)) prov.set(ev.signalId, ev.quote);
      /* KEYED BY THE FUNCTION THAT READS IT, not by a hand-built string.
         This said `room:${w.id}`, then a mechanical rename made it
         `cached:${w.id}` — two different spellings, both wrong, because the
         only reader is `wallProv.get(spaceKey(w))` and spaceKey is
         `${kind}:${id}`, which for these walls is always `group:`. A group's
         provenance was never found, so the peek row under its poster was
         empty every time. Calling spaceKey here makes the two ends the same
         expression rather than two strings that have to agree. */
      m.set(spaceKey(w), prov);
    }
    wallProvRef.current = m;
    simApiRef.current?.setProvenance(m);
  }, [provenance, agents, inspirations, walls, wokenGroups]);

  /* The field's own invariant, reachable from the console — see SimApi.audit
     for why counting it beats looking at it. Dev-gated with the page itself. */
  useEffect(() => {
    if (!showsDebug()) return undefined;
    const w = window as unknown as {
      wakaField?: () => FieldAudit | null;
      wakaSim?: () => SimApi | null;
    };
    w.wakaField = () => simApiRef.current?.audit() ?? null;
    /* The whole control surface, for a console or a test that needs to drive
       the layout without a pointer in the way. Bisecting "the button did not
       work" from "the command did not work" is otherwise guesswork. */
    w.wakaSim = () => simApiRef.current;
    return () => {
      delete w.wakaField;
      delete w.wakaSim;
    };
  }, []);

  /* ---------------- the simulation: one rAF loop, refs only ---------------- */
  useEffect(() => {
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
    const fetched = new Set(inspirations.map((s) => s.id));
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
      ...inspirations.map((c) => makeBall(seedOf(c, pouredSky.citations, pouredSky.signals))),
      ...agentBalls,
      ...groupBalls,
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

    /** Which one-time hints have already been said, so they are said once. */
    const hinted = {
      inField: false,
      dialAway: false,
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
    const grid = (v: number): number => {
      if (mech < 0.02) return v;
      const q = 1 + mech * 7;
      return Math.round(v / q) * q;
    };
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
      nebDrag: null as Neb | null,
      /** Did the press that grabbed a cloud ever become a drag? If not, it is a
          tap, and a tap on a candidate is what makes it the subject. */
      nebMoved: false,
      nebOffX: 0,
      nebOffY: 0,
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
      /** The last thing it said, so it never says the same thing twice running. */
      lastSaid: "",
      /** the pairable set as a string, so React only hears about real changes */
      pairSig: "",
      /* The companion is the messenger: while something is forming above, it
         glances up now and then and lets a mote go toward the sky. */
      glanceAt: 0,
      glanceUntil: 0,
      riseAt: 0,
    };

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
    const onThisWall = (b: Ball): boolean => {
      if ((b.agentId ?? "") !== curWall().id) return false;
      if (curWall().kind !== "group") return true;
      /* on a group's wall the ground belongs to exactly one member */
      return (b.ownerProfileId ?? "") === (ground ?? viewerIdRef.current ?? "");
    };

    function assignHomes() {
      const present: Ball[] = [];
      for (const b of list)
        if (b.capturedMs <= TRef.current && onThisWall(b)) present.push(b);
      present.sort((a, b) => a.capturedMs - b.capturedMs); /* oldest first */
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
      return clamp01(1 - cam.y / Math.max(view.layout.maxCam, 1));
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
      if (sky.heldBall === b) sky.heldBall = null;
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
    const sky = {
      nebs: [] as Neb[],
      /* the cluster signature last handed to React, so the loop can push a
         discrete fact without pushing it sixty times a second */
      clusterSig: "",
      shown: false,
      /* who belongs to a cluster right now, and which cloud the pointer is on:
         clustered sentences whisper, the touched one comes back to full */
      clusterMembers: new Set<string>(),
      hoverNeb: null as Neb | null,
      /**
       * THE SUBJECT: the one candidate carrying its evidence right now, or none.
       * At rest the sky is sentences and bodies only — a skyful of orbiting
       * evidence was unreadable, and it was the satellites that made it so.
       * Exactly one at a time, because the point of the tap is to be able to
       * read one claim's provenance without the others in the way.
       */
      focusNeb: null as Neb | null,
      /* which satellite the pointer (or a finger) is on: its owner's given name
         is whispered beside it, and it is what a tap would open */
      hoverSat: null as Sat | null,
      satSaid: "",
      /* how wide that name came out, measured once when it CHANGES — the loop
         needs it every frame to decide which side of the satellite it fits on,
         and reading offsetWidth per frame would force a layout per frame */
      satSayW: 0,
      /* the satellite a selection came FROM, so the reading panel sits beside
         the satellite that was tapped rather than beside the memory's own place
         in a field a whole section below */
      selSat: null as Sat | null,
      /* a satellite's memory can live in a room column that has never been
         built, so it is held directly and released directly */
      heldBall: null as Ball | null,
    };
    /* tier-one persistence: where the clouds were left, last session */
    const savedSky = readSkyLayout();

    /**
     * WHAT THE SKY ENGINE STILL NEEDS FROM THIS PAGE — the whole list, once.
     *
     * The thirteen functions that move the sky live in
     * `space/signal/sky-engine.ts` now; this is the seam they reach back
     * through. It is built once per effect run and every entry is either a
     * function declaration hoisted above (so the order of this block and the
     * order those are written in are independent) or an ACCESSOR onto a ref —
     * never a ref's current value, because `viewerId` is rewritten on every
     * render and `selectedId` on every selection, and a value read here would
     * pin the engine to whatever was true when the loop started.
     */
    const skyDeps: SkyDeps = {
      byId,
      findBall,
      allBalls,
      clampHome,
      orbFitX,
      orbFitY,
      colOfGroup,
      release,
      wake,
      groupBalls: () => groupBallsRef.current,
      viewerId: () => viewerIdRef.current,
      nebEl: (id) => measured.nebEls.current.get(id) ?? null,
      satSayEl: () => measured.satSay.current,
      selectedId: () => selectedIdRef.current,
      setFocusCandId,
    };

    /** Which column a room's memories belong to; zero when it is not on the
        map yet, which only ever reads as "this is a room's memory". */
    function colOfGroup(groupId: string): number {
      const i = groupsRef.current.findIndex((g) => g.id === groupId);
      return i < 0 ? 0 : i + 1;
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
      return Math.max(24, (view.w * SKY_PAD_X - SKY_EDGE - n.ampX) / (1 + FOCUS_POP));
    }
    function orbFitY(n: Neb) {
      return Math.max(24, (view.h * SKY_PAD_Y - SKY_EDGE - n.ampY) / (1 + FOCUS_POP));
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
        view.w * SKY_PAD_X,
      );
      const padY = Math.min(
        Math.max(n.r * 0.5, n.orbRy * (1 + FOCUS_POP) + n.ampY) + SKY_EDGE,
        view.h * SKY_PAD_Y,
      );
      /* every sky is its own column wide, and no candidate ever wanders out
         of the wall it belongs to */
      const off = n.col * view.w;
      n.homeX = clamp(n.homeX, off + padX, Math.max(off + padX, off + view.w - padX));
      /* the pads are capped at a fraction of the viewport, so this range is
         never empty however tall the words wrapped */
      n.homeY = clamp(n.homeY, view.layout.minCam + padY + 28, -padY);
    }

    /** Rebuild the sky from the candidate list, keeping what is already up. */
    function syncSky(list: Candidate[]) {
      const prev = new Map(sky.nebs.map((n) => [n.id, n] as const));
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
          /* the sky cannot exist before the inspirations do, so this is never a
             late arrival — it is a candidate whose evidence genuinely
             changed (a draft re-drafted), re-solved once. Phases are hashed
             per candidate-and-memory, so every surviving satellite keeps the
             exact place on the ellipse it already had. */
          if (had.evSig !== c.evidence.map((e) => e.signalId).join(","))
            solveSats(had, c, skyDeps);
          next.push(had);
          continue;
        }
        const n = makeNeb(c, i, skyDeps);
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
          const off = c.col * view.w;
          n.x = n.homeX = off + clamp(saved.x, 12, view.w - 12);
          n.y = n.homeY = clamp(saved.y, view.layout.minCam + 30, -20);
          n.pinned = true;
        }
        next.push(n);
      }
      sky.nebs = next;
      /* a candidate that has left the sky cannot be the subject of it */
      if (sky.focusNeb && !next.includes(sky.focusNeb)) sky.focusNeb = null;
      /* a selected satellite whose candidate has left the sky has nothing
         left to sit beside */
      const held = sky.selSat;
      if (held && !next.some((n) => n.sats.includes(held))) release();
      layoutSky(sky, view, skyDeps);
      wake();
    }

    /** What is under the pointer up in the sky, nearest-first. */
    function nebAt(cx: number, cy: number): Neb | null {
      const wx = cx + cam.x;
      const wy = cy + cam.y;
      for (let i = sky.nebs.length - 1; i >= 0; i--) {
        const n = sky.nebs[i];
        if (n.gone > 0.4 || n.condense < 0.99) continue;
        const dx = n.x - wx;
        const dy = n.y - wy;
        /* the cloud is soft; its handle is its bright middle */
        const rr = n.r * NEB_CORE;
        if (dx * dx + dy * dy <= rr * rr) return n;
      }
      return null;
    }

    function measure() {
      const rect = root!.getBoundingClientRect();
      view.w = Math.max(rect.width, 1);
      view.h = Math.max(rect.height, 1);
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(view.w * nextDpr);
      canvas!.height = Math.round(view.h * nextDpr);
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
      /* The dial is a vertical rail against the right edge now, so it takes
         no height from the field at all — the bottom inset it used to claim
         belongs to the axis of walls. */
      view.dialH = 0;
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
         line of typing wrapped, and the layout moves only when you move it. */
      const seam = view.layout.fieldTop - MOUTH_H;
      const avail = seam - hqH - gap * 2;
      companion.size = clamp(view.h * 0.14, 84, 150);
      /* The floor yields to the room before the room yields to the floor. The
         shrink must NOT be gated on `room > 0`: a section whose poster already
         fills it has negative room, which is exactly the case that most needs
         the companion small, and skipping the shrink there put the body back
         across the peek line. Below CHAR_MIN the body stops reading as a body,
         so that is where it stops. */
      if (companion.size > avail) companion.size = Math.max(Math.min(avail, companion.size), CHAR_MIN);
      const lo = hqH + companion.size * 0.5 + gap;
      const hi = seam - companion.size * 0.5 - gap;
      /*
       * THE COMPANION SITS IN THE MIDDLE OF THE SCREEN, not in the middle of
       * what is left over.
       *
       * It used to centre on `(hqH + seam) / 2` — the midpoint of the slot
       * between headquarters and the mouth. That reads as centred only when
       * the poster happens to be short. A tall one pushes the body down, so
       * the character drifts with content it has nothing to do with, and on a
       * wall with an empty headquarters it sat noticeably low.
       *
       * `view.h / 2` is the viewport's middle in layout coordinates at
       * headquarters rest, which is where the companion is looked at. The
       * clamp is unchanged and still decides: `lo` keeps the body off the
       * poster, `hi` keeps it out of the mouth and the dial, so centring is a
       * PREFERENCE the slot can still overrule rather than a position that can
       * overlap. When the slot is roomy — which is most of the time — the
       * preference wins and the body is where the eye expects it.
       */
      companion.y = hi >= lo ? clamp(view.h / 2, lo, hi) : (lo + hi) / 2;
      const say = measured.charSay.current;
      if (say) say.style.top = `${Math.round(companion.y + companion.size * 0.62)}px`;
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
      /* homes for the sky's inhabitants, in the viewport they now have */
      layoutSky(sky, view, skyDeps);
      /* The volume is a real, world-tall gradient: the sky at the top is a
         different place from the deep. It starts one viewport above HQ, so it
         covers all three sections. */
      const atmos = measured.atmos.current;
      if (atmos) {
        atmos.style.top = `${Math.round(view.layout.minCam)}px`;
        atmos.style.height = `${Math.round(view.layout.layoutH - view.layout.minCam)}px`;
      }
      if (!view.motesPlaced) {
        view.motesPlaced = true;
        for (let i = 0; i < MOTES; i++) {
          moteX[i] = Math.random() * view.w;
          moteY[i] = Math.random() * view.h;
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
     * it is the whole archive, which is what the first open wants.
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
         arrival order no longer has to build the strata. */
      const order = (only ?? list).slice().sort((a, b) => b.capturedMs - a.capturedMs);
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
      for (const b of list) {
        b.active = b.capturedMs <= TRef.current && onThisWall(b);
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
      stepSky(sky, view, stir, skyDeps, dt, now, t);

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
          b.x = clamp(b.x, lo + b.r, hi - b.r);
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
    function sayLine(): string {
      if (scrubbingRef.current) return `As it was in ${monthTag(TRef.current)}`;
      const pick = (opts: string[]): string => {
        const fresh = opts.filter((o) => o !== companion.lastSaid);
        const s = (fresh.length ? fresh : opts)[Math.floor(Math.random() * (fresh.length || opts.length))];
        companion.lastSaid = s;
        return s;
      };
      /* An empty archive is the one state every single person passes through,
         and the layout's own vocabulary pointed at the dark beats any
         instruction: it asks for one thing, once, and then goes quiet. */
      if (trip.inspCol === 0 && list.every((b) => !b.active || b.leaving))
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
      if (sky.nebs.length === 0 && trip.inspCol > 0 && trip.inspCol < 4)
        return pick([
          "A few so far. Say more and I will start to see it",
          "Not enough yet to see a shape",
        ]);
      if (companion.insp > 0.55) return "";
      if (companion.insp > 0.22)
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
         population stacked at the layout origin, which is the top-left of
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
      b.arrive = view.reduced ? 1 : 0;
      b.entryH = 90 + b.frac * 110;
      b.x = b.homeX;
      b.y = b.homeY - (view.reduced ? 0 : b.entryH);
    }

    function reconcileScrub() {
      const T = TRef.current;
      /* did the SET of present orbs change? only then are homes re-assigned */
      let changed = false;
      const entering: Ball[] = [];
      for (const b of list) {
        if (pour.active && b.spawnAt > 0) {
          colorBall(b, T);
          continue;
        }
        const want = b.capturedMs <= T;
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
    const panelOpen = () => panelOpenRef.current;

    function draw(now: number) {
      const pal = paletteRef.current;
      ctx!.setTransform(view.dpr, 0, 0, view.dpr, -cam.x * view.dpr, -cam.y * view.dpr);
      ctx!.clearRect(cam.x, cam.y, view.w, view.h);
      if (!pal) return;
      const t = now / 1000;
      const selId = selectedIdRef.current;
      const depthSpan = Math.max(view.layout.fieldBottom - view.layout.fieldTop, 1);

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

      /* pass 0b — THE SKY. Each candidate a cloud of light with its own
         evidence in orbit around it. `space/signal/sky-paint.ts`, which reads
         three of the loop's state groups and so was allowed to leave; the
         satellite pass's occlusion rules and the two aliveness fixes recorded
         in its comments went with it unchanged. */
      paintSky({ ctx: ctx!, pal, sky, cam, view, t, grid });

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
        depthSpan,
        selId,
        still: pour.active,
        mech,
        grid,
        panelOpen,
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
      if (companion.y - cam.y > -companion.size * 2 && companion.y - cam.y < view.h + companion.size * 2) {
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
        /* Squash-stretch coupled to the bob — and to the climb. Ascending it
           stretches a few percent and descending it compresses, which is the
           character's own response to being moved and not decoration on top
           of it. (Its LIGHT still obeys the rule that juice lives in the
           bloom; this is the body, and a body may act.) */
        const sq = view.reduced ? 0 : Math.sin(companion.bobPh + 1.5) * 0.022 - companion.pitch * PITCH_STRETCH;
        const bw = companion.size * (1 + sq);
        const bh = companion.size * (1 - sq);

        /* the aura: layered pastel blooms at different radii, drifting on
           slow independent orbits. Additive, so it reads as emitted light. */
        ctx!.globalCompositeOperation = "lighter";
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
        const nubOn = true;
        const nubR = companion.size * lerp(0.062, 0.1, bodyLit);
        /* the colour work is skipped outright when there is no nub to paint —
           it used to allocate five arrays and two strings every frame,
           including on every frame where `nubOn` was false */
        const nubRgb = nubOn ? mix([166, 163, 156], [214, 209, 197], bodyLit) : null;
        const nubFront = nubRgb ? rgbCss(nubRgb, 1) : "";
        /* the far side of a form is darker than the near side */
        const nubBack = nubRgb ? rgbCss(mix(nubRgb, [0, 0, 0], 0.15), 1) : "";
        const drawNub = (lon: number, behind: boolean) => {
          if (!nubOn) return;
          const a = companion.yaw + lon;
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
        ctx!.fillStyle = "#2b2822";
        const er = companion.size * 0.038;
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
          ctx!.beginPath();
          ctx!.ellipse(
            Math.sin(a) * bw * FACE_R * cosLat + companion.eyeX * ca,
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
      /* The mouth rides BOTH axes, like headquarters — it stands on your own
         wall's seam, so it slides away when you travel and scrolls away when
         you descend. It is a sibling of .jar-hq rather than a child of it
         only because it has to sit ABOVE the canvas: a field you are typing
         into cannot have orbs drawn over the words. */
      const mouth = measured.mouth.current;
      if (mouth)
        mouth.style.transform = `translate3d(${(-cam.x).toFixed(1)}px, ${(-cam.y).toFixed(1)}px, 0)`;
      /* the companion's whisper is screen-anchored, like the companion */
      const say = measured.charSay.current;
      if (say) say.style.transform = `translate3d(${cam.x.toFixed(1)}px, 0, 0)`;
      /* Each candidate's sentence is DOM, positioned on its cloud every
         frame: the canvas carries the light, the words stay crisp. */
      const els = measured.nebEls.current;
      if (els.size > 0) {
        for (const n of sky.nebs) {
          const el = els.get(n.id);
          if (!el) continue;
          /* the subject grows on the same curve and by the same amount its
             body and its orbit do — the candidate is one thing */
          const grow = 1 + FOCUS_POP * n.focus;
          el.style.transform = `translate3d(${(n.x - cam.x).toFixed(1)}px, ${(n.y - cam.y).toFixed(1)}px, 0) translate(-50%, -50%) scale(${grow.toFixed(3)})`;
          const op =
            (1 - n.gone) * (n.condense > 0.5 ? 1 : 0) * n.dimS * lerp(1, FOCUS_DIM, n.dimN);
          el.style.opacity = `${op}`;
          /* AND AN INVISIBLE SENTENCE IS STILL A TARGET. `.jar-neb` carries
             `pointer-events: auto` and starts at opacity zero until the loop
             has given it a place; it also passes through zero while a
             candidate condenses or disperses. Its one child is the least
             reversible control in the layout, and on touch that child rests
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
        for (const [id, el] of measured.clusterEls.current) {
          if (!el) continue;
          let sx = 0;
          let sy = 0;
          let hits = 0;
          let low = -Infinity;
          for (const mid of id.split("+")) {
            const n = sky.nebs.find((q) => q.id === mid);
            if (!n) continue;
            sx += n.x;
            sy += n.y;
            low = Math.max(low, n.y + n.r * 0.52);
            hits++;
          }
          if (hits === 0) continue;
          el.style.transform = `translate3d(${(sx / hits - cam.x).toFixed(1)}px, ${(low - cam.y).toFixed(1)}px, 0) translate(-50%, 0)`;
        }
      }
      /* whose memory the pointer is on, beside it — it rides the satellite, so
         the name stays where the memory is even while the orbit turns under
         it. Absolutely positioned: it can never shift anything else. */
      const who = measured.satSay.current;
      if (who && sky.hoverSat) {
        const sx = sky.hoverSat.x - cam.x;
        const sy = sky.hoverSat.y - cam.y;
        /* IT HAS TO STAY IN THE SKY. The name sits to the satellite's right by
           default, but the sky clips and the name never wraps, so a satellite
           on the right of its orbit would have its owner cut in half or lost
           off the edge entirely — on a phone that is most of the ring, and a
           room's ring is exactly where whose it is has to be readable. So it
           flips to the other side when it would not fit, the way the reading
           panel's own right-then-left placement does, and is clamped inside
           the viewport as a floor. Transform only: still nothing can shift. */
        let lx = sx + sky.hoverSat.dr + SAT_SAY_GAP;
        if (lx + sky.satSayW > view.w - SAT_SAY_GAP)
          lx = sx - sky.hoverSat.dr - SAT_SAY_GAP - sky.satSayW;
        lx = clamp(lx, SAT_SAY_GAP, Math.max(SAT_SAY_GAP, view.w - sky.satSayW - SAT_SAY_GAP));
        who.style.transform = `translate3d(${lx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(0, -50%)`;
      }
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
        /* AND THE CROSSING ITSELF RESOLVES IN STEPS. Read after the camera
           moves, so every other quantised thing this frame agrees about how
           far into the machine's mind we are. */
        mech = view.reduced ? mechAt(cam.x) : lerp(mech, mechAt(cam.x), kd(2e-3, dt));
        /* ATTENTION EASES IN AND LETS GO. The target is the lean while the
           attention is live and zero once it lapses; both directions run
           through the same spring, so noticing and losing interest are the
           same motion played in opposite directions. rps=0.02 is τ≈256ms:
           quick enough to read as reacting, slow enough to be a turn. */
        const attendWant = performance.now() < companion.attendUntil ? companion.attendLean : 0;
        companion.attendHold = view.reduced ? attendWant : lerp(companion.attendHold, attendWant, kd(2e-2, dt));
          if (Math.abs(cam.x - cam.xTarget) < 0.6) {
            cam.x = cam.xTarget;
            cam.xBack = false;
          }
          clock.lastActive = now;
        }
      }
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
        (1 + 0.45 * companion.pitch);
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
      if (selActive) springs(sky, skyDeps);
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
          const hits = foundRef.current;
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

      /* The dial winds the companion around. While a finger owns the dial the
         yaw chases the scrub POSITION — weighted, never rigid. On release it
         unwinds the short way round, so it always comes to rest facing
         forward however many turns it was wound. */
      if (view.reduced) {
        companion.yaw = 0;
        companion.yawTarget = 0;
        companion.unwindAt = 0;
      } else if (scrubbingRef.current) {
        companion.unwindAt = 0;
        companion.yaw = lerp(companion.yaw, companion.yawTarget, kd(EASE_YAW_SCRUB, dt));
        easing = true;
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
      if (companion.flare > 0) {
        companion.flare = Math.max(0, companion.flare - dt / 0.7);
        easing = true;
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
          companion.idleAt = now + 30000 + Math.random() * 30000;
          companion.glanceUntil = now + 900;
          /* it looks somewhere of its own choosing, not at you */
          companion.eyeTX = (Math.random() - 0.5) * 1.6;
        }
        const forming = sky.nebs.length > 0;
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
          const base = wornBeing().blinkMs;
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

      /* which signals could be joined — recomputed only when the set itself
         changes, so a still sky costs nothing */
      {
        let sig = "";
        for (const n of sky.nebs) if (n.pairable) sig += n.id + "|";
        if (sig !== companion.pairSig) {
          companion.pairSig = sig;
          setPairableIds(new Set(sky.nebs.filter((n) => n.pairable).map((n) => n.id)));
        }
      }
      /* Two discrete facts leave the loop for React, and only when they
         change: whether the camera is in the sky (the dial has no meaning
         there) and which nebulae have been drawn together. */
      const nowInSky = cam.y < view.layout.minCam * 0.45;
      if (nowInSky !== sky.shown) {
        sky.shown = nowInSky;
        setInSky(nowInSky);
      }
      /* and a third: the camera stands over a wall that has no dial, so the
         dial fades away — exactly as it does in the sky. Read off the camera
         rather than off arrival, so it goes as the wall slides in. */
      /* AND TIME ONLY MEANS SOMETHING TO THE FIELD.
         The dial lay across the bottom edge at all times — but in this layout
         HORIZONTAL means "whose wall", and the dial means "when". Two
         different horizontal meanings on the same edge, and the bottom edge
         belongs to the axis. There is also nothing up here to wind: the sky
         holds signals that are still forming and headquarters holds one
         sentence, neither of which has a history to scrub. So it comes up
         with the field and goes away with it. */
      const inField = cam.y > view.layout.fieldTop * 0.5;
      /* THE LEGEND BELONGS TO THE GROUND IT EXPLAINS.
         It is a key to the orbs, so it exists where the orbs are. Standing at
         headquarters reading one sentence, or up in the sky among signals,
         a list of whose-colour-is-whose answers a question nobody is asking —
         it was just chrome in the corner. It comes up with the field and goes
         away with it, exactly as the timeline does. */
      if (inField !== hinted.inField) {
        hinted.inField = inField;
        setInField(inField);
      }
      const nowAway =
        !inField || !hasDial(wallAt(Math.round(cam.x / Math.max(view.w, 1))).kind);
      if (nowAway !== hinted.dialAway) {
        hinted.dialAway = nowAway;
        setDialAway(nowAway);
      }
      if (sky.nebs.length > 1) {
        const sig = computeClusters(sky);
        if (sig !== sky.clusterSig) {
          sky.clusterSig = sig;
          setClusterSig(sig);
          /* who whispers: the members of any cluster, parsed once per change */
          sky.clusterMembers = new Set();
          for (const part of sig.split("|"))
            if (part) for (const id of part.split("+")) sky.clusterMembers.add(id);
        }
      } else if (sky.clusterSig !== "") {
        sky.clusterSig = "";
        setClusterSig("");
        sky.clusterMembers = new Set();
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
        scrubbingRef.current ||
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
      releaseHolds(sky, skyDeps);
      sky.selSat = null;
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
      releaseHolds(sky, skyDeps);
      sky.selSat = null;
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
      sky.heldBall = b;
      /* the companion brightens in sympathy with an alive bubble */
      if (b.alive > 0.55) companion.flare = Math.max(companion.flare, 0.6);
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
      releaseHolds(sky, skyDeps);
      sky.selSat = s;
      s.held = true;
      selectedIdRef.current = s.id;
      setSelectedId(s.id);
      const b = findBall(s.id);
      if (b) {
        b.hold = 1;
        sky.heldBall = b;
        if (b.alive > 0.55) companion.flare = Math.max(companion.flare, 0.6);
      }
      wake();
    }

    /** Is the pointer over the companion? It sits in front of the field. */
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
      const n = sky.focusNeb;
      if (!n || n.gone > 0.4 || n.condense < 0.99) return null;
      const wx = cx + cam.x;
      const wy = cy + cam.y;
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
      if (trip.active) return;
      /* the companion answers first: it sits in front of the field */
      if (overChar(cx, cy + cam.y)) {
        companion.flare = 1;
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
      if (sky.focusNeb) focusOn(sky, skyDeps, null);
      if (selectedIdRef.current) release();
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
      /* A press on a nebula SENTENCE grabs its cloud — the words visually
         ARE the cloud — and a press on the bare cloud does the same:
         proximity is how candidates are gathered into one ambition. */
      let nb: Neb | null = null;
      const nebEl = e.target instanceof Element ? e.target.closest(".jar-neb") : null;
      if (nebEl) {
        for (const [id, el] of measured.nebEls.current) {
          if (el === nebEl) {
            const cand = sky.nebs.find((q) => q.id === id) ?? null;
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
      if (!nb && !onSat) nb = cam.y < view.layout.minCam * 0.3 ? nebAt(e.clientX, e.clientY) : null;
      if (nb) {
        /* a cloud on the move carries no whisper: the name belongs to the
           memory under the pointer, and the pointer now owns the cloud */
        sky.hoverSat = null;
        sayWho(sky, skyDeps, null);
        gesture.nebDrag = nb;
        gesture.nebMoved = false;
        nb.dragging = true;
        gesture.nebOffX = nb.x - (e.clientX + cam.x);
        gesture.nebOffY = nb.y - (e.clientY + cam.y);
        nb.dragX = nb.x;
        nb.dragY = nb.y;
        /* a press is not yet a drag: it becomes one at the same six pixels
           the rest of the page uses, and until then it is still a TAP */
        gesture.downX = e.clientX;
        gesture.downY = e.clientY;
        wake();
        return;
      }
      if (onSat) {
        /* touching one raises its owner's name too, not only hovering */
        sky.hoverSat = onSat;
        sayWho(sky, skyDeps, onSat);
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
      const warm = onSat ? findBall(onSat.id) ?? null : hitAt(e.clientX, e.clientY);
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
      /* which cloud the pointer rests on: a clustered member's whispered
         sentence rises back to full while it is touched */
      sky.hoverNeb = cam.y < view.layout.minCam * 0.3 ? nebAt(e.clientX, e.clientY) : null;
      /* and which satellite: whose memory it is rises beside it, one fade */
      if (!gesture.nebDrag) {
        sky.hoverSat = satAt(e.clientX, e.clientY);
        sayWho(sky, skyDeps, sky.hoverSat);
      }
      /* The cursor says what a tap would do. Every other move is plenty for a
         couple of dozen orbs, and it is the same hit test the tap uses, so
         the pointer never lies about which orb it would take. The cursor
         lives on the ROOT: the canvas is pointer-events:none, so it is never
         the element the cursor resolves from. */
      if ((gesture.hoverTick++ & 1) === 0 && !gesture.dragging) {
        const over =
          sky.hoverNeb !== null ||
          sky.hoverSat !== null ||
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
      if (gesture.nebDrag) {
        if (!gesture.nebMoved && Math.abs(e.clientX - gesture.downX) + Math.abs(e.clientY - gesture.downY) > TAP_SLOP)
          gesture.nebMoved = true;
        gesture.nebDrag.dragX = e.clientX + cam.x + gesture.nebOffX;
        gesture.nebDrag.dragY = e.clientY + cam.y + gesture.nebOffY;
        wake();
        return;
      }
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
      const dy = e.clientY - gesture.lastY;
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
      const out = cam.y < minCamNow() || cam.y > view.layout.maxCam;
      cam.y -= dy * (out ? 0.35 : 1);
      /* reduced motion keeps the direct 1:1 drag but drops the inertia */
      if (!view.reduced) cam.vel = lerp(cam.vel, -dy / dts, kd(EASE_VEL, dts));
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
      if (gesture.nebDrag) {
        const n = gesture.nebDrag;
        n.dragging = false;
        gesture.nebDrag = null;
        if (!gesture.nebMoved) {
          /* A PRESS THAT NEVER MOVED IS A TAP. The candidate becomes the
             subject and its evidence emerges; tapping the subject again gives
             the sky back. Nothing is pinned and nothing is persisted — the
             cloud did not go anywhere. */
          focusOn(sky, skyDeps, sky.focusNeb === n ? null : n);
          return;
        }
        /* dragged off the top of the sky: it thins and disperses. Locally
           only — there is no endpoint to tell that it was let go of. */
        if (n.y < view.layout.minCam + n.r * 0.35) {
          n.gone = 0.01;
          /* A DISPERSING CANDIDATE IS NO LONGER THE SUBJECT OF ANYTHING. The
             same teardown adoption's condense and syncSky already obey: a
             memory being read from a system that is leaving has nothing left
             to sit beside, and a subject that is not there still holds every
             other candidate sunk at FOCUS_DIM for as long as it is the
             subject. focusOn rather than a bare assignment, so focus0/em0 are
             re-based and the retraction eases out with the dispersal instead
             of snapping. */
          if (sky.selSat && n.sats.includes(sky.selSat)) release();
          if (sky.focusNeb === n) focusOn(sky, skyDeps, null);
        } else {
          /* it keeps where it was put — through reloads, too */
          n.pinned = true;
          n.homeX = n.x;
          n.homeY = n.y;
        }
        persistSky(sky, view);
        wake();
        return;
      }
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
      /* a finger has no hover to leave with: the name it raised goes on lift */
      if (e.pointerType !== "mouse") {
        sky.hoverSat = null;
        sayWho(sky, skyDeps, null);
      }
      wake();
    };
    const onCancel = (e: PointerEvent) => {
      if (gesture.ownerId !== null && e.pointerId !== gesture.ownerId) return;
      gesture.pressId = null;
      sky.hoverSat = null;
      sayWho(sky, skyDeps, null);
      if (gesture.nebDrag) {
        gesture.nebDrag.dragging = false;
        /* a cancelled press that never moved never claimed a new place */
        if (gesture.nebMoved) {
          gesture.nebDrag.pinned = true;
          gesture.nebDrag.homeX = gesture.nebDrag.x;
          gesture.nebDrag.homeY = gesture.nebDrag.y;
          persistSky(sky, view);
        }
        gesture.nebDrag = null;
      }
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
      /* the panel scrolls its own content, and so does a long capture in the
         mouth; neither ever drives the camera */
      if (e.target instanceof Element && e.target.closest(".jar-panel, .jar-mouth")) return;
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
      gesture.wheelXAcc = 0;
      cam.y = clamp(cam.y + e.deltaY, minCamNow() - 60, view.layout.maxCam + 60);
      cam.aiming = false;
      /* snap once the wheel goes quiet */
      gesture.snapAt = nowW + 150;
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
        else if (sky.focusNeb) focusOn(sky, skyDeps, null);
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

    measure();
    /* `measure` is the first moment `vw` is real, so the horizontal camera can
       only be placed here — before it, `col * vw` is a column times one pixel. */
    cam.x = trip.col * view.w;
    cam.xTarget = cam.x;
    /* Resumed mid-journey: nobody ran the arrival, so run it now — the wall
       needs its ground solved, poured and woken exactly as a glide would. */
    if (resumedAt !== null) arriveColumn();
    measure();
    if (view.reduced) settleInstantly();
    else primePour();

    simApiRef.current = {
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
        for (const b of list) if (!onThisWall(b)) b.active = false;
        assignHomes();
        const here = presentBalls();
        if (view.reduced) settleInstantly();
        else primePour(here);
        electPeek(here);
        wake();
      },
      scrubTo: (T: number, pos: number) => {
        if (trip.active) return; /* the dial is the personal jar's alone */
        TRef.current = T;
        /* the dial's position IS the companion's yaw: today (the right-hand
           end) is front-facing, and winding back turns it away from you */
        companion.yawTarget = view.reduced ? 0 : (pos - 1) * TAU * SPIN_TURNS;
        companion.unwindAt = 0;
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
        switch (moment) {
          case "kept":
            /* SOMETHING NEW EXISTS. The biggest flare in the world, and the
               eyes go DOWN to the ground where it landed — the creature looks
               at what was just made rather than at you making it. */
            companion.flare = Math.max(companion.flare, 0.95);
            companion.eyeTX = 0;
            companion.eyeTY = 1.5;
            companion.attendUntil = performance.now() + 1500;
            companion.attendLean = 0;
            break;
          case "answered":
            /* YOU TOLD IT SOMETHING TRUE ABOUT YOURSELF. It looks UP at the
               sky it read you from, and holds longer than anything else here:
               this is the slow one, because being understood is not a ping. */
            companion.flare = Math.max(companion.flare, 0.72);
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
        if (!b && !sky.selSat) return null;
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
        /* vertically it meets the companion at the shoulder and reads
           downward, clamped so a long memory never leaves the frame */
        const top = clamp(cy - companion.size * 0.34, 56, Math.max(56, view.h * 0.52));
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
        const want = clamp(b.y - view.h * 0.5, view.layout.minCam, view.layout.maxCam);
        if (Math.abs(want - cam.y) > 8) {
          gesture.snapAt = 0;
          cam.vel = 0;
          aimTo(want, 0);
        }
        select(inspirationId);
      },
      /* the signal line's glide: programmatic, and exempt from the snap.
         Only the personal column has a sky to glide into. */
      toSky: () => {
        if (trip.col !== 0 || trip.active) return;
        gesture.snapAt = 0;
        cam.vel = 0;
        aimTo(view.layout.minCam, 0);
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
        b.relightAt = view.reduced ? 0 : performance.now();
        if (view.reduced) {
          b.alive = b.aliveTo;
          b.alivePow = Math.pow(b.aliveTo, 1.4);
        }
        companion.flare = Math.max(companion.flare, 0.9);
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
      goToWall: (target: number) => {
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
          if (view.reduced) {
            trip.col = dest;
            cam.x = cam.xTarget;
            companion.off = 0;
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
      joinTo: (id: string) => {
        const n = sky.nebs.find((q) => q.id === id);
        if (!n) return;
        let best: Neb | null = null;
        let bestD = Infinity;
        for (const m of sky.nebs) {
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
        companion.flare = Math.max(companion.flare, view.reduced ? 0 : 0.4);
        wake();
      },
      condense: (id: string) => {
        const n = sky.nebs.find((q) => q.id === id);
        if (!n) return;
        n.condenseAt = performance.now();
        /* THE HIERARCHY HAD ITS SIGN FLIPPED. Poking the companion flared it
           to nearly full and changed nothing; adopting an ambition — the
           rarest and least reversible act here — changed everything and
           produced no light at all. */
        companion.flare = 1;
        /* its satellites spiral in with it, so nothing is left to read beside */
        if (sky.selSat && n.sats.includes(sky.selSat)) release();
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
          if (!onThisWall(b)) continue;
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
            for (const b of list) {
              if (!onThisWall(b)) continue;
              if (b.active) active++;
              rMin = Math.min(rMin, b.r);
              rMax = Math.max(rMax, b.r);
              aliveMax = Math.max(aliveMax, b.alive);
              arriveMin = Math.min(arriveMin, b.arrive);
            }
            return {
              active,
              rMin: Math.round(rMin),
              rMax: Math.round(rMax),
              aliveMax: Number(aliveMax.toFixed(3)),
              arriveMin: Number(arriveMin.toFixed(2)),
            };
          })(),
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
  }, [inspirations, agents, walls, groupFieldTick]);

  /**
   * AND WHEN THE SKY LANDS, THE GROUND IS LIT AGAIN — IN PLACE.
   *
   * The pour above bakes `hasNotes` / `hasGroup` / `quote` / `terms` into every
   * ball at construction, and `colorBall` reads them to decide the cited floor,
   * the cited lift, the in-a-room floor and the frontier. But the sky is two
   * requests deep — `loadSignals`, then a `loadSignal` per signal, in sequence
   * — so on any real page load `citations` arrives AFTER the archive, the
   * agents and the walls have all settled, which is after the last pour. Every
   * memory a pattern rests on was therefore lit as if nothing rested on it, and
   * decayed to dark like an untended one; `frontier` flipped true for every
   * memory older than three days, so the companion announced an archive with
   * nothing built on it while patterns rested on all of it. It came right by
   * accident on any later change to the agents or the walls — travelling to a
   * room, or coming back to the tab after a long absence — which is why it read
   * as "the field is dim until I wander around" rather than as a bug.
   *
   * WHY NOT `citations` AND `signals` IN THE POUR'S DEPENDENCY LIST. Because
   * that re-pours the whole field: a new list, new balls, new drift phases,
   * new homes, and a re-entry animation for memories that never moved. The
   * comment above it means what it says, and the last time this loop was
   * rebuilt out from under itself the camera restarted at column zero
   * mid-travel. Nothing here needs a new field — the balls are correct in every
   * respect except four facts they could not have known yet.
   *
   * WHY NOT A REF READ AT USE TIME EITHER. That is the right shape for the
   * POUR, and `skyRef` is exactly that, but a ref cannot be the whole answer:
   * a ref makes a read fresh whenever it happens, and the problem here is that
   * the read never happens again at all. Something has to run when the sky
   * lands, and this is the smallest thing that can — no rebuild, no relayout,
   * no motion, just the four facts re-derived through the same `skyOf` the
   * pour uses and the light recomputed. The palette effect re-colours the same
   * list the same way for the same reason.
   *
   * The light changes instantly rather than swelling. `simApi.relight` eases
   * one orb up when YOU answer a memory, because that is an event you caused
   * and are watching; this is the page finishing loading, and forty orbs
   * blooming at once would announce a network round-trip as if it were news.
   */
  useEffect(() => {
    const bag = ballsRef.current;
    if (!bag) return;
    for (const b of bag.list) {
      /* Only the viewer's own ground is built from the sky. An agent's and a
         room's memories come through `makeAgentBall`, which never consults
         citations, and re-deriving would silently blank the little they do
         carry. Empty string IS the self wall's id — see makeBall. */
      if ((b.agentId ?? "") !== "") continue;
      /* A memory kept in this session is known to the server under `sigId`,
         and the citation index is keyed by the server's id — so a pattern
         that lands on something said into the mouth minutes ago finds it. */
      const above = skyOf(b.sigId ?? b.id, sky.citations, sky.signals);
      b.hasNotes = above.cited;
      b.hasGroup = above.inGroup;
      b.quote = above.quote;
      b.terms = above.terms;
      colorBall(b, TRef.current);
    }
    /**
     * AND THE POSTER'S OWN WORDS GO BACK ON TOP.
     *
     * `quote` has two writers. `simApi.setProvenance` puts the words a WALL'S
     * CLAIM was read from onto the memories under it, and its effect is
     * declared above this one — so when the sky lands, both fire and the
     * provenance quote is written first and overwritten here. A memory cited
     * by two patterns would then show the wrong one of the two under the
     * poster: not a crash, not a blank, just a sentence quietly swapped for
     * another true sentence, which is the kind of change nobody traces back.
     *
     * Re-applying restores the precedence that held before there was anything
     * to re-light: the poster's reading wins where it has one, the sky's fills
     * in everywhere else. Guarded because an empty map is not "no provenance
     * anywhere", it is "that effect has not run yet", and handing the sim an
     * empty one would clear the peek row the pour just elected. `setProvenance`
     * wakes the loop itself, which is why the plain wake is the other branch.
     */
    const wallProv = wallProvRef.current;
    if (wallProv.size > 0) simApiRef.current?.setProvenance(wallProv);
    /* the loop may have gone quiet with nothing to draw; this is a change */
    else simApiRef.current?.wake();
  }, [sky]);

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
    const groupBall = groupBallsRef.current.get(selectedId);
    if (groupBall && !groupBall.own) {
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
    const fetchId = groupBall?.sigId ?? ownBall?.sigId ?? selectedId;
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
   * WHOSE GROUND YOU COULD STAND IN — not a key to a mixture.
   *
   * This was a legend: five hues poured into one field and a colour key beside
   * it. The mixture asked the reader to separate five people's memories before
   * they could read any of them, and it could not repay that work — a group's
   * ground is structurally incapable of explaining its sky, because the wall
   * query stops at shares (`loadGroupField`, routes/groups.ts) and a member
   * sees the pattern someone arrived at, never the captures behind it.
   *
   * So the ground is ONE person's, yours by default, and this is the way to
   * change whose. You are first and have no swatch: you are the warm white the
   * whole world is drawn in, and giving yourself a colour chip would imply you
   * are one option among five rather than the ground everything else is read
   * against.
   *
   * Hues come from `hueByOwnerRef`, written where the sprites are tinted, so
   * a name and the orbs it switches to are physically incapable of disagreeing.
   */
  const grounds = useMemo<
    Array<{ id: string; name: string; hue: number; agent: boolean; mine: boolean }>
  >(() => {
    if (atWall.kind !== "group") return [];
    const caps = groupFieldRef.current.get(atWall.id) ?? [];
    const seen = new Map<
      string,
      { id: string; name: string; hue: number; agent: boolean; mine: boolean }
    >();
    for (const c of caps) {
      if (seen.has(c.ownerProfileId)) continue;
      /* WHO YOU ARE IS A COMPARISON OF IDS, never an inference from the hue.
         `hueByOwnerRef` is empty until the tint pass has run, and when it is,
         `?? -1` hands every member the same value your own row uses — so a
         hue-based test called all five of them "you" and lit every row at
         once. The id is known from the first render and cannot drift. */
      const mine = c.ownerProfileId === viewerIdRef.current;
      seen.set(c.ownerProfileId, {
        id: c.ownerProfileId,
        name: mine ? "you" : c.ownerName,
        hue: mine ? -1 : hueByOwnerRef.current.get(c.ownerProfileId) ?? -1,
        agent: c.ownerType === "agent",
        mine,
      });
    }
    const rows = [...seen.values()];
    /* one ground is not a choice, it is a label nobody asked for */
    if (rows.length < 2) return [];
    /* you first, always: it is the ground everything else is read against */
    return rows.sort((a, b) =>
      a.mine ? -1 : b.mine ? 1 : a.hue - b.hue || a.name.localeCompare(b.name),
    );
  }, [atWall, groupFieldTick, wokenGroups]);

  /**
   * Whose ground is under you right now — null is yours, and travelling to
   * another wall puts you back in your own, because standing in someone
   * else's ground is a thing you did here and does not follow you.
   */
  const [standing, setStanding] = useState<string | null>(null);
  const wallKey = spaceKey(atWall);
  useEffect(() => {
    /* the label only. The LOOP resets its own ground in arriveColumn, because
       this effect fires while the column is still sliding and a settle at that
       moment leaves the whole field inactive. */
    setStanding(null);
  }, [wallKey]);
  const standIn = useCallback((ownerProfileId: string | null) => {
    setStanding(ownerProfileId);
    simApiRef.current?.standIn(ownerProfileId);
  }, []);
  /**
   * WHAT THE POSTER RESTS ON — THE SAME QUESTION, ONE LAYER UP.
   *
   * A top of mind is the loudest claim in the product: one sentence, set
   * largest, presented as who you are becoming. Until now it was the only
   * claim with NO way to ask where it came from — you could interrogate a
   * pattern in the sky but not the sentence the whole wall is built around,
   * which is exactly backwards.
   *
   * The chain runs entry → the signals it cites → the memories those
   * signals were read from. Deduplicated by memory, because the interesting
   * fact is "four memories produced this", not "one memory was counted twice
   * through two signals"; the first quote wins, since that is the span the
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
      const byId = new Map((a?.inspirations ?? []).map((cap) => [cap.id, cap] as const));
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
    if (atWall.kind === "group") {
      /* A ROOM'S CHAIN STOPS AT THE STATEMENT, AND THAT IS THE POINT.
         Sharing into a room sends the statement and nothing under it — the
         memories stay on their author's own wall. So a room's board can
         honestly name the shared statements that fed it and WHO said each
         one, and it cannot name anyone's raw inspirations. That is a privacy
         boundary rendered as a shorter chain, not a missing feature: a room
         that could show you the memories behind someone else's statement
         would be breaking the promise the share note makes. */
      const group = groupCacheRef.current.get(atWall.id);
      const lead = group?.data?.top?.entries?.[0];
      if (!lead) return out;
      for (const ev of group?.data?.evidence ?? []) {
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
      for (const e of evidenceBySignalRef.current.get(cite.id) ?? []) {
        if (seen.has(e.inspirationId)) continue;
        seen.add(e.inspirationId);
        out.push(e);
      }
    return out;
  }, [atWall, agents, notes, provTick, wokenGroups]);

  /**
   * The evidence under a pattern. Candidates are a union — a server pattern, a
   * room's proposal, a sentence you drafted here — and only the first has a
   * chain to walk. A draft cites nothing because it came from you directly,
   * and saying so with an empty section would be apparatus.
   */
  const evidenceFor = useCallback(
    (c: Candidate): Evidence[] =>
      c.kind === "reading" ? evidenceBySignalRef.current.get(c.id) ?? [] : [],
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
    if (evidenceBySignalRef.current.has(focusCandId)) return undefined;
    /* proposals and local drafts have no server pattern behind them */
    if (focusCandId.startsWith("proposal:") || focusCandId.startsWith("draft:")) return undefined;
    let dead = false;
    loadSignal(focusCandId)
      .then((full) => {
        if (dead) return;
        evidenceBySignalRef.current.set(full.id, full.evidence);
        setProvTick((n) => n + 1);
      })
      .catch(() => {
        /* no chain available: the statement still stands, unsourced, and the
           section simply does not appear — better than an error where a
           quotation should be */
        if (!dead) evidenceBySignalRef.current.set(focusCandId, []);
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
    /* THE SKY IS LAYER 2 — the signals still forming.
       A pattern that is `active` is what headquarters already stands on and a
       `retired` one has sunk; what is overhead is what is EMERGING: something
       the archive is saying about this person that has not become what they
       hold yet. Each one's satellites are the memories it cites, resolved
       against the field in hand — an id with nothing behind it is skipped,
       never invented, so every satellite stands for a memory that exists. */
    for (const p of signals ?? []) {
      if (p.status !== "emerging") continue;
      const evidence = new Map<string, EvidenceRef>();
      for (const e of evidenceBySignalRef.current.get(p.id) ?? []) {
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
      const col = walls.find((w) => w.kind === "group" && w.id === g.id)?.col;
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
      const byId = new Map(a.inspirations.map((s) => [s.id, s] as const));
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
  /* `signals` for your own sky, `groups` and `wokenGroups` for a room's — the
     shared statements arrive with the wall's wake, so the memo has to re-run
     on it or a room's sky stays empty until something else moves */
  }, [proposal, notes, drafts, signalById, agents, walls, signals, groups, wokenGroups]);

  useEffect(() => {
    simApiRef.current?.syncSky(candidates);
  }, [candidates, inspirations]);

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
          /* THE THING BEING ANIMATED HAS TO OUTLIVE THE ANIMATION.
             `condense` starts a 700ms contraction on the cloud, and this used
             to drop the proposal from state in the very same commit. React
             batches the two, so the candidate left `candidates`, `syncSky`
             dropped its Neb, and React unmounted its sentence — all before the
             loop had drawn one frame of the contraction. Nothing contracted.
             The cloud vanished, and the timer below then sat out an animation
             nobody had been shown.
             Under this layout's law that MOTION EXPLAINS, the contraction is
             the sentence "this became yours"; without it the least reversible
             act here happens in silence and the person is left inferring from
             an empty sky that it worked.
             So the proposal is released where it was always meant to be — with
             the rest of the handover, once the contraction it is the subject of
             has finished. Holding it here also keeps it the sky's subject for
             those 700ms, which is what keeps the other candidates sunk behind
             it until it has actually gone. */
          simApiRef.current?.condense(c.id);
          window.setTimeout(() => {
            setProposal(null);
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
     The one verb this layout was missing. It says one phrase at rest, becomes
     a plain field when you touch it, and commits on Enter — guarded, because
     the first Enter of a Korean sentence belongs to the IME and not to us.
     The layout moves for it exactly once: an orb is born where the words are
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
       inspirations that carry the most — and nothing on screen says so. */
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
      inGroup: false,
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
           server, and `inspirations` — the list every other part of the page
           reads — was told about neither. So headquarters kept computing
           `empty` as `topOfMind === null && inspirations.length === 0` and kept
           drawing the three-slot first-run scaffold, including the row
           labelled "everything you keep" with an empty circle beside it,
           while the thing just kept glowed underneath it.
           `forgetIt` and `togglePublic` already keep this list honest on
           their own success; keeping does now too. */
        setInspirations((prev) =>
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
    ? ballsRef.current?.byId.get(panelId) ?? groupBallsRef.current.get(panelId) ?? null
    : null;
  /** A room orb's panel: whisper attribution, cited-by, and — for another
      member's save — no reflect action at all. */
  const panelIsGroup = panelBall !== null && panelBall.col !== undefined;
  const panelCanReflect = !panelIsGroup || panelBall?.own === true;

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
  const dropSignal = useCallback((id: string) => {
    setVerdicts((prev) => new Map(prev).set(id, "gone"));
    if (offlineRef.current) return;
    deleteSignal(id)
      .then(() => {
        setSignals((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
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
   * Members see the pattern, never the inspirations.
   */
  const shareTo = useCallback((signalId: string, groupId: string, on: boolean) => {
    /* only on the way out — taking a statement back is not an announcement */
    if (on) simApiRef.current?.acknowledge("shared");
    setSignals((prev) =>
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
      setSignals((prev) =>
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
  const [groupForm, setGroupForm] = useState<{
    mode: "make" | "join";
    text: string;
    busy: boolean;
    error: string | null;
  } | null>(null);

  const submitGroup = useCallback(() => {
    if (!groupForm || groupForm.busy) return;
    const text = groupForm.text.trim();
    if (text === "") return;
    setGroupForm({ ...groupForm, busy: true, error: null });
    const landed = (g: ApiGroupSummary) => {
      /* newest room first, which is where the axis puts it: a new column
         appears to the right and the traveller can walk to it immediately */
      setGroups((prev) => [g, ...prev.filter((x) => x.id !== g.id)]);
      setGroupForm(null);
    };
    const failed = (m: string) =>
      setGroupForm((f) => (f ? { ...f, busy: false, error: m } : f));
    if (groupForm.mode === "make") {
      createGroup(text)
        .then(landed)
        .catch(() => failed("That group could not be made. Try another name."));
    } else {
      /* a pasted invite link works as well as a bare code — the link is the
         thing people will actually send each other */
      const code = text.includes("/") ? text.split("/").filter(Boolean).pop() ?? text : text;
      joinGroup(code)
        .then((r) => landed(r.group))
        .catch(() => failed("No group answered to that. Check the link."));
    }
  }, [groupForm]);

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
  const machineGroupsRef = useRef<Set<string>>(new Set());
  const machineGroups = useMemo(() => {
    const out = new Set<string>();
    for (const [groupId, list] of members) {
      const others = list.filter((m) => m.profileId !== viewerIdRef.current);
      if (others.length > 0 && others.every((m) => m.type === "agent")) out.add(groupId);
    }
    return out;
  }, [members]);
  machineGroupsRef.current = machineGroups;
  const [groupPanel, setGroupPanel] = useState<string | null>(null);

  /**
   * THIS SPACE'S SETTINGS — keyed by the space, opened from its name.
   *
   * Not a modal and not a route: it is a fact about where you are standing, so
   * it opens beside the name that opened it and closes when you travel. The
   * key is `spaceKey(space)` rather than a group id because every kind of space
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
  /* TEMPORARY. See `.jar-flatmenu` in the JSX below — this is scaffolding for
     the screens the world has no home for yet, and it goes when they do. */
  const [flatMenuOpen, setFlatMenuOpen] = useState(false);
  /** The rename box, while it is open: null when nobody is renaming. */
  const [renaming, setRenaming] = useState<{ id: string; text: string; busy: boolean } | null>(
    null,
  );
  /** Two-step confirmations, so a destructive word is never beside its own yes. */
  useEffect(() => {
    if (atWall.kind !== "group" || members.has(atWall.id)) return;
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
          groupCacheRef.current.delete(groupId);
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
    if (atWall.kind !== "group") return;
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
        groupCacheRef.current.delete(groupId);
        simApiRef.current?.wake();
      })
      .catch(() => undefined);
  }, []);

  /** Leaving is destructive and irreversible, so it asks once, in words. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const leaveThisGroup = useCallback((groupId: string) => {
    leaveGroup(groupId)
      .then(() => {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        setGroupPanel(null);
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
  const renameThisGroup = useCallback((groupId: string, name: string) => {
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

  const closeThisGroup = useCallback((groupId: string) => {
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
            inspirations: [],
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
   * ARRIVING ON A LINK — AND BEING ASKED, WHICH IS NEW.
   *
   * This used to join outright. The reasoning was sound as far as it went:
   * someone sent you a link, you opened it, and you should be in the room
   * rather than looking at a form asking you to paste what you just clicked.
   *
   * What it missed is what joining DOES. A group's ground is its members'
   * public inspirations and its wall is their shared signals, so being in one
   * is a disclosure — your public memories become visible to everyone in it,
   * and your name joins its roll. Clicking a link is not consent to that. Any
   * page, any redirect, any message containing that URL could enrol you, and
   * the first you would know is finding yourself in a room.
   *
   * So the link still does the work — you never type a code — but you are
   * asked before anything is disclosed. One tap, and it is yours rather than
   * the sender's.
   *
   * The code leaves the URL immediately either way, so a reload cannot re-ask
   * and the code does not sit in history or in a referrer header.
   */
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("join");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    setPendingJoin(code);
  }, []);
  const acceptJoin = useCallback(() => {
    if (!pendingJoin) return;
    const code = pendingJoin;
    setPendingJoin(null);
    joinGroup(code)
      .then((r) => setGroups((prev) => [r.group, ...prev.filter((x) => x.id !== r.group.id)]))
      .catch(() => undefined);
  }, [pendingJoin]);

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
   * layers: open the words, change them, keep them — and one BINDING for all
   * three, which is the part this line is about. As three loose names it was
   * free in the ready field, the sky and the reading panel at once, and step
   * 4d of `docs/goals/close-the-two-gaps.md` measured it as the last shared
   * mutable channel running between them. `space/editing.ts` holds the act
   * itself; its header carries the canon rule above and the silent freeze the
   * shape is chosen to avoid.
   */
  const editing = useEditing({
    offline: offlineRef,
    details: detailsRef,
    setInspirations,
    setSignals,
    setNotes,
    setTopOfMind,
    setAdopted,
    setSelectedId,
  });

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
    (inspirations ?? []).find((c) => c.id === (panelBall?.sigId ?? panelId))?.isPublic ??
    false;
  const [publishing, setPublishing] = useState(false);
  const togglePublic = useCallback(() => {
    const id = panelBall?.sigId ?? panelId;
    if (!id || publishing) return;
    const next = panelIsPublic ? "private" : "public";
    setPublishing(true);
    updateInspiration(id, { visibility: next })
      .then(() => {
        setInspirations((cur) =>
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
        setInspirations((prev) =>
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
       GENERATOR. So the layout asks the plainest question there is, opens
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
    <div ref={measured.root} className="jar" aria-label="Waka">
      {/* the volume: a layout-tall gradient the camera descends through */}
      <div ref={measured.atmos} className="jar-atmos" aria-hidden="true" />

      {phase === "ready" ? (
        <div ref={measured.hq} className="jar-hq">
          {/* ---- ONE COLUMN PER WALL (v10) ----
              Agents to the left, you at the origin, rooms to the right. A
              column is dark until the traveler has arrived with complete data
              — then it is whole: name, ambition arriving word by word, what it
              turned away from, the forming line. Once woken it stays.

              What is NOT here, on any wall, is a field: there is one field and
              it is yours, it lives below all of these, and it does not slide
              sideways when you travel. */}
          {walls.map((w) => {
            const key = spaceKey(w);
            const here = w.kind === atWall.kind && w.id === atWall.id;
            /* the wall you are standing on is the one the dial winds; every
               other wall shows what it holds NOW */
            const c = here ? chrome : wallChromeNow.get(key) ?? null;
            const ready = w.kind !== "group" || wokenGroups.has(w.id);
            return (
              <div
                key={key}
                className="jar-wallcol"
                /* a room of machines is set in the machine hand too — the
                   typography and the body must never disagree about what
                   kind of mind you are standing in */
                data-kind={
                  w.kind === "group" && machineGroups.has(w.id) ? "agent" : w.kind
                }
                style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col})` }}
              >
                {ready && c ? (
                  <div
                    className="jar-hq-inner"
                    ref={w.kind === "self" ? measured.hqInner : undefined}
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
                           is furniture and this layout has none. Only on the
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
                        layout an instrument rather than a display.

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
                    {w.kind === "self" && editing.open?.kind === "entry" ? (
                      <div className="jar-reflect" data-jar-chrome="1">
                        <textarea
                          className="jar-reflect-box"
                          rows={3}
                          autoFocus
                          value={editing.open.text}
                          onChange={(e) => editing.retype(e.target.value)}
                        />
                        <p className="jar-neb-ask">
                          <button type="button" disabled={editing.open.saving} onClick={editing.keep}>
                            {editing.open.saving ? "…" : "keep these words"}
                          </button>
                          <span aria-hidden="true"> · </span>
                          <button type="button" onClick={editing.leave}>
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
                    {w.kind === "self" && !offline && lead && !editing.open ? (
                      <div className="jar-board-acts" data-jar-chrome="1">
                        {board.step === "asking" ? (
                          <>
                            {/* WHAT WILL CHANGE, BEFORE IT CHANGES. Frostpunk's
                                first game commits and then judges; its second
                                previews the consequence at the moment of the
                                vote, and that is the whole difference in how
                                fair the two feel. Regeneration rewrites the
                                board from the signals as they now stand, so
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
                              onClick={() => editing.begin("entry", lead.id, lead.body)}
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
                      : (inspirations?.length ?? 0) === 0
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
                {w.kind === "group" && failedGroups.has(w.id) && !ready ? (
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
                    control in the layout, so anybody who pressed it once was
                    left with a companion that no longer walked, leaned, bobbed
                    or answered — and nothing on screen explaining why. A
                    setting that can freeze everything must never be invisible.
                    Only shown when the PAGE is holding it: a system-level
                    reduced-motion preference is not ours to argue with. */}
                {/* It sits AT THE EDGE, hard against the margin it is talking
                    about, in the quiet label register — a signpost where the
                    layout runs out, not a sentence in the middle of the room.
                    Centred under the poster it read as a statement about your
                    ambition, which it is not. */}
                {ready ? (
                  <>
                    <button
                      type="button"
                      className="jar-edge jar-edge--r jar-label"
                      data-jar-chrome="1"
                      onClick={() =>
                        setGroupForm({ mode: "make", text: "", busy: false, error: null })
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
          <div ref={measured.charSay} className="jar-char-say">
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
              <Fragment key={`edges-${spaceKey(w)}`}>
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
        <div ref={measured.mouth} className="jar-mouth" data-jar-chrome="1">
          <div className={`jar-mouth-slot${atNow ? "" : " jar-mouth-slot--away"}`}>
            {mouthOpen ? (
              <textarea
                ref={(el) => {
                  mouthFieldRef.current = el;
                  measured.mouthSpot.current = el;
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
                  measured.mouthSpot.current = el;
                }}
                className="jar-mouth-rest jar-label"
                onClick={openMouth}
              >
                Keep something
              </button>
            )}
            {/* WHERE THIS ONE GOES, DECIDED WHILE WRITING IT.
                Offered only once there are words: an empty mouth showing a
                privacy control is a form, and this layout does not have forms.
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
              if (el) measured.nebEls.current.set(c.id, el);
              else measured.nebEls.current.delete(c.id);
            }}
            className={`jar-neb jar-neb--${c.kind}`}
          >
            {/* WHAT YOU SAID IS CARRIED BY THE STATEMENT, NOT BY A LABEL BESIDE
                IT. A pattern you agreed with holds its full weight; one you
                half-agreed with lightens; one you called untrue is set in the
                layout's dimmest ink and struck through — still there, because
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
                the layout's only meaning channel: same words, same size, same
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
                marks from the layout's by handwriting versus print; Umineko
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
                      {(signals ?? []).find((p) => p.id === c.id)?.sharedGroupIds.length
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
                      onClick={() => editing.begin("signal", c.id, c.text)}
                    >
                      say it better
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {editing.open?.kind === "signal" && editing.open.id === c.id ? (
              <div className="jar-reflect">
                <textarea
                  className="jar-reflect-box"
                  rows={3}
                  autoFocus
                  value={editing.open.text}
                  onChange={(e) => editing.retype(e.target.value)}
                />
                <p className="jar-neb-ask">
                  <button type="button" disabled={editing.open.saving} onClick={editing.keep}>
                    {editing.open.saving ? "…" : "keep these words"}
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={editing.leave}>
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
                  const on = (signals ?? []).find((p) => p.id === c.id)?.sharedGroupIds.includes(g.id) ?? false;
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
                <button type="button" onClick={() => dropSignal(c.id)}>
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
              if (el) measured.clusterEls.current.set(sig, el);
              else measured.clusterEls.current.delete(sig);
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
        <div ref={measured.satSay} className="jar-satsay jar-label" aria-hidden="true" />
      </div>

      <canvas ref={measured.canvas} className="jar-canvas" aria-hidden="true" />

      {/* THE EMULSION. Above the layout and the type, below the chrome that
          has to stay legible (the panel, the dial, the back link). It blends
          rather than covers, so it lifts the midtones and leaves the blacks
          black — which is the whole reason it cannot live inside the canvas,
          where its backdrop is transparent and `overlay` silently becomes a
          flat grey sheet. It is fixed to the FRAME, not to the layout: film
          grain belongs to the lens, and does not slide when you scroll. */}
      <div ref={measured.grain} className="jar-grain" aria-hidden="true" />

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
          {panelIsGroup ? (
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
          {panelIsGroup && panelBall.citedBy && panelBall.citedBy.length > 0 ? (
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
          {panelIsGroup && !panelBall.own && panelBall.sigId ? (
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
              that this layout could not. Editing a capture re-derives the
              signals resting on it, which is why it belongs here beside the
              words rather than on a settings screen somewhere. */}
          {panelCanReflect && !panelIsGroup && editing.open?.id === panelId ? (
            <div className="jar-reflect">
              <textarea
                className="jar-reflect-box"
                value={editing.open.text}
                rows={5}
                autoFocus
                onChange={(e) => editing.retype(e.target.value)}
              />
              <p className="jar-neb-ask">
                <button type="button" onClick={editing.keep} disabled={editing.open.saving}>
                  {editing.open.saving ? "keeping…" : "keep the change"}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" onClick={editing.leave}>
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
          {panelCanReflect && reflect.step === "rest" && !editing.open && !more ? (
            <p className="jar-neb-ask jar-neb-ask--after jar-neb-ask--row">
              <button type="button" onClick={askToReflect}>
                reflect on this
              </button>
              {!panelIsGroup ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <button type="button" onClick={() => setMore(true)}>
                    more
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {panelCanReflect && !panelIsGroup && reflect.step === "rest" && !editing.open && more ? (
            <p className="jar-neb-ask jar-neb-ask--after">
              <button
                type="button"
                onClick={() =>
                  editing.begin(
                    "memory",
                    panelId as string,
                    panel.detail ? panel.detail.text : panelBall.textPreview,
                  )
                }
              >
                change the words
              </button>
              <span aria-hidden="true"> · </span>
              {/* THE PICTURE GOES INSIDE THE GLASS. A memory that carries an
                  image is drawn with it, which is the thing this layout was
                  first sketched around — and the server reads the picture at
                  capture time, so it feeds the signals too. */}
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
                  The one verb the data model gained and the layout could not
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
            Making the layout home orphaned every other screen: profile,
            settings and the list surfaces became unreachable because nothing
            linked to them. That is not a design choice, it is a door that was
            bricked up by accident.

            Two exits, and they are different kinds of thing, so they do not
            share a shape. The archive is the SAME memories in another
            register — words, editable, searchable — and it goes away once the
            layout can do everything it can. Settings is the account: it leaves
            the layout entirely and always will. */}
        {/* THE WAY OUT IS NOT A PLACE TO PUT THINGS.
            This grew to four pills in a row — archive, settings, rooms, who is
            here — which is a toolbar, and a toolbar is the thing this layout
            was built to not have. They were collapsed to one. But the one was
            a TERNARY: on a room wall the exit was replaced by the room's
            members, and this is the only link to /profile in the entire layout.
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
               somewhere the layout already has:

                 rooms / agents  →  the ENDS OF THE AXIS. They make columns;
                                    the axis is what columns live on. You find
                                    them by walking to the edge of the layout.
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
              aria-expanded={settingsFor === spaceKey(atWall)}
              onClick={() =>
                setSettingsFor(settingsFor === spaceKey(atWall) ? null : spaceKey(atWall))
              }
            >
              {atWall.kind === "group"
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
        {/* SCAFFOLDING, AND NAMED AS SUCH.
            Everything else in this bar earned its place by being a fact about
            where you are standing. This did not: it is a drawer, and the
            comments above are right that a toolbar is what this layout was
            built to not have.

            It exists because `dev` grew screens the world has no geometry for.
            /principles is layer 4 — declared statements resting on signals —
            and the world draws three layers, not four, so there is nowhere to
            put it. The list views are the same memories in another register,
            which the archive comment above already calls a thing that "goes
            away once the layout can do everything it can".

            So they are reachable rather than orphaned, from one control that
            admits what it is. Top centre because the two ends of this bar are
            taken and neither may be crowded — the way out is on the left and
            the account is on the right, and the bug that produced this comment
            once was exactly one of them hiding the other.

            DELETE THIS when /principles has a home in the world. That is the
            real fix; this is the placeholder that keeps it usable meanwhile. */}
        <div className="jar-flatmenu" data-jar-chrome="1">
          <button
            type="button"
            className="jar-flatmenu-toggle jar-label"
            aria-expanded={flatMenuOpen}
            aria-haspopup="menu"
            aria-label="Other screens"
            onClick={() => {
              setFlatMenuOpen((v) => !v);
              setAccountOpen(false);
              setSettingsFor(null);
            }}
          >
            <span aria-hidden="true">≡</span>
          </button>
          {flatMenuOpen ? (
            <div className="jar-flatmenu-sheet" role="menu">
              {[
                /* The flat screen's own bottom bar, in its order and its
                   words, so the two do not drift into naming the same screen
                   two ways. `top of mind` is Surface's `wall` view, which
                   `surface-route.ts` resolves to "/" — and "/" is the world,
                   whose headquarters IS top of mind. So it lands on the same
                   layer either way; it simply arrives in the world's rendering
                   of it rather than the list's. */
                ["/capture", "capture"],
                ["/inspirations", "inspirations"],
                ["/signals", "signals"],
                ["/top-of-mind", "top of mind"],
                ["/rooms", "rooms"],
                ["/principles", "principles"],
              ].map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  role="menuitem"
                  className="jar-flatmenu-item jar-label"
                  onClick={() => setFlatMenuOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

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

      {grounds.length > 0 && inField && phase === "ready" ? (
        <div
          className="jar-ground"
          data-jar-chrome="1"
          role="radiogroup"
          aria-label="Whose inspirations are on the ground"
        >
          {grounds.map((m) => {
            const here = m.mine ? standing === null : standing === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={here}
                className={here ? "jar-ground-row jar-ground-row--here" : "jar-ground-row"}
                onClick={() => standIn(m.mine ? null : m.id)}
              >
                <i
                  className={m.agent ? "jar-ground-dot jar-ground-dot--agent" : "jar-ground-dot"}
                  style={m.hue >= 0 ? { background: hueCss(m.hue) } : undefined}
                  aria-hidden="true"
                />
                {m.name}
              </button>
            );
          })}
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
          You could travel sideways forever and never know how far the layout
          went or what was in it — you found out by walking. Losing your sense
          of direction is the first named failure of a moving camera, and it
          is the one this layout had.

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
              key={spaceKey(w)}
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
          the layout. So it is DOM, it sits over the layout rather than inside
          it, and the layout holds perfectly still behind it. */}
      {groupForm ? (
        <div className="jar-roomform" data-jar-chrome="1">
          <div className="jar-roomform-tabs jar-label">
            <button
              type="button"
              className={groupForm.mode === "make" ? "is-on" : undefined}
              onClick={() => setGroupForm({ ...groupForm, mode: "make", error: null })}
            >
              Make a group
            </button>
            <button
              type="button"
              className={groupForm.mode === "join" ? "is-on" : undefined}
              onClick={() => setGroupForm({ ...groupForm, mode: "join", error: null })}
            >
              Join with a link
            </button>
          </div>
          <input
            className="jar-roomform-box"
            autoFocus
            value={groupForm.text}
            placeholder={groupForm.mode === "make" ? "What is it about?" : "Paste the link"}
            onChange={(e) => setGroupForm({ ...groupForm, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGroup();
              if (e.key === "Escape") setGroupForm(null);
            }}
          />
          {groupForm.error ? <p className="jar-roomform-err">{groupForm.error}</p> : null}
          <p className="jar-neb-ask">
            <button type="button" onClick={submitGroup} disabled={groupForm.busy}>
              {groupForm.busy ? "…" : groupForm.mode === "make" ? "make it" : "go in"}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setGroupForm(null)}>
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
      {groupPanel && atWall.kind === "group" && atWall.id === groupPanel ? (
        <GroupPanel
          groupId={groupPanel}
          groups={groups}
          members={members}
          space={atWall}
          openProposals={openProposals}
          propose={propose}
          setPropose={setPropose}
          sendProposal={sendProposal}
          answerProposal={answerProposal}
          copied={copied}
          copyInvite={copyInvite}
          leaving={leaving}
          setLeaving={setLeaving}
          leaveThisGroup={leaveThisGroup}
          onClose={() => setGroupPanel(null)}
        />
      ) : null}

      {/* THIS SPACE'S SETTINGS.
          Opened by the space's own name, top left, and scoped to the space you
          are standing in — because everything in here is a fact about THIS
          space and nothing in here is a fact about the product. A room is the
          rich case; the other two kinds say what they are and point at the one
          screen that can actually change them.

          It is deliberately flat inside: labels, words and two-step
          confirmations. The layout's register is for material — memories,
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

      {pendingJoin && phase === "ready" ? (
        <div className="jar-settings" data-jar-chrome="1" role="dialog" aria-label="Join this group">
          <div className="jar-settings-head">
            <span className="jar-label">Someone invited you</span>
          </div>
          <p className="jar-settings-note">
            {"Joining puts your name on this room’s roll, and the memories you " +
              "have marked public become part of its ground. You can leave " +
              "whenever you like."}
          </p>
          <p className="jar-neb-ask">
            <button type="button" className="jar-settings-verb" onClick={acceptJoin}>
              {"join this room"}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setPendingJoin(null)}>
              not now
            </button>
          </p>
        </div>
      ) : null}

      {settingsFor === spaceKey(atWall) && phase === "ready" ? (
        <SpaceSettings
          space={atWall}
          members={members}
          groups={groups}
          leaving={leaving}
          setLeaving={setLeaving}
          closing={closing}
          setClosing={setClosing}
          removing={removing}
          setRemoving={setRemoving}
          renaming={renaming}
          setRenaming={setRenaming}
          viewerProfileId={auth?.profile?.id ?? null}
          copied={copied}
          copyInvite={copyInvite}
          onClose={() => setSettingsFor(null)}
          leaveThisGroup={leaveThisGroup}
          renameThisGroup={renameThisGroup}
          closeThisGroup={closeThisGroup}
          removeMember={removeMember}
        />
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
