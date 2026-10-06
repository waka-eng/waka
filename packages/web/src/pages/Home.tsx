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
 * A room reads its current members' public inspirations and owns its derived
 * signals and shared reading. Reflection answers remain personal; publishing
 * their parent inspiration does not publish those answers.
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
  type MouseEvent as ReactMouseEvent,
} from "react";
import { PrincipleRead } from "../components/PrincipleRead";
import { ReflectionFlow, type ReflectionTurn } from "../components/ReflectionFlow";
import { InspirationProcessingNotice } from '../components/InspirationProcessingNotice';
import { DialogSurface } from "../components/DialogSurface";
import { PrincipleEvidence } from "../components/PrincipleEvidence";
import { Link, useNavigate } from "react-router-dom";
import { useViewNavigation } from '../lib/use-view-navigation';
import { EMPTY_VIEW, resolveViewWall, viewHref, type ViewLocation } from '../lib/view-location';
import { InspirationSearch } from '../components/InspirationSearch';

import { hueCss } from "../lib/appearance";
import { useDismissAway } from "../lib/dismiss";
import { isEditableTarget, isNativeSurface } from "../lib/surface-input";
import {homeActivityLayout} from "../lib/home-activity-layout";
import { profileStorageKey, readProfileText, writeProfileText, type ProfileStorageScope } from "../lib/profile-storage";
import { useTopOfMindRefresh } from "../lib/use-top-of-mind-refresh";
import { useInspirationProcessing } from '../lib/use-inspiration-processing';
import { useAuthoredSave } from '../lib/use-authored-save';
import { useInspirationDraft } from '../lib/use-inspiration-draft';
import { useAudioRecording } from '../lib/use-audio-recording';
import { InspirationComposer } from '../components/InspirationComposer';
import { ReviewPanel } from '../components/ReviewPanel';
import { useReviewEntry } from '../lib/use-review-entry';
import { HomeActivities } from '../components/HomeActivities';
import {PrinciplesShortcutLabel} from '../components/PrinciplesShortcutLabel';
import { HomeActionIcon } from '../components/HomeActionIcon';
import { ReadingChanges } from '../components/ReadingChanges';
import { PrincipleShare } from '../components/PrincipleShare';
import { ReviewEvidence } from '../components/ReviewEvidence';
import type { ApiSignalReviewEvidence } from '../lib/api/signals';
import { InspirationAttachments } from '../components/InspirationAttachments';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import type { CreateInspirationRequest } from '../lib/api';
import { inspirationInputMedia, inspirationLinks, removeInspirationLink } from '../lib/inspiration-input';
import { inspectInspirationPhoto } from '../lib/inspiration-photo';
import { uploadInspirationMedia } from '../lib/inspiration-media-upload';
import { restoreInspirationDraft, settleInspirationDraft } from '../lib/authored-save-drafts';
import { AuthoredSaveNotice } from '../components/AuthoredSaveNotice';
import { acceptsReadingSnapshot } from "../lib/reading-snapshot";
import { clamp, clamp01, DAY_MS, easeOut, hashStr, kd, lerp, mix32, TAU } from "../lib/num";
import {
  GRAIN_PX,
  GRAIN_TILE,
  VIGNETTE,
  mix,
  rgbCss,
} from "../canvas/sprites";
import { useEditing } from "../space/editing";
import { deriveAgentChrome } from "../space-kinds/agent";
import {
  deriveGroupChrome,
  groupWallOrbs,
  GROUP_READ_TTL_MS,
  groupReadingRestricts,
  groupReadingChanged,
  type GroupData,
} from "../space-kinds/group";
import {
  bakeBeing,
  buildPalette,
  MACHINE_CELLS,
  type BeingSprites,
  type Palette,
} from "../canvas/palette";
import { useMeasured } from "../canvas/measured";
import { renderScale } from "../canvas/scale";
import { BODY_TIERS, bodyPath } from "../character/raster";
import { GroupPanel } from "../space-kinds/GroupPanel";
import { eventsAtStop, groupHistoryCaption, groupHistoryEvents, type HistoryGrain } from "../space-kinds/group-history";
import { SpaceSettings, type GroupTrouble } from "../space/settings/SpaceSettings";
import { whyFailed as sayWhyFailed, whyOf } from "../lib/why-failed";
import { hasDial, hasSky, spaceKey, type Space } from "../space-kinds";
import { agentBeing, OWNER_BEING, unit, type Being } from "../character/body";
import {
  groupCompanyPlaces,
  noticeLight,
  NOTICE_MS,
  type CompanyPlace,
} from "../space/group-company";
import { groundCount } from "../space/ground-count";
import { pourSignature } from "../space/pour-signature";
import { posterWords } from "../space/top-of-mind/poster";
import {
  deriveAmbition,
  formingWords,
  type Adopted,
  type JarNote,
  type Proposal,
  type WallChrome,
  type Provenance,
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
  makeGroupInspirationBall,
  groupInspirationViewId,
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
  dateStamp,
  citedWords,
  dateWords,
  dialMonth,
  dialYear,
  monthTag,
} from "../lib/words";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";
import type { MessageKey } from "../lib/locales";

import {
  fetchSignalDuplicates,
  resolveSignalDuplicate,
  affirmGroupProposal,
  declineGroupProposal,
  createGroup,
  fetchPrinciples,
  createProfile,
  fetchGroupProposals,
  createGroupProposal,
  fetchGroupMembers,
  fetchGroupTimeline,
  type ApiGroupTimeline,
  type ApiGroupTopOfMind,
  type ApiReflection,
  type ApiInspiration,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  deleteGroup,
  fetchGroupTopOfMind,
  refreshGroupTopOfMind,
  fetchGroups,
  fetchGroupField,
  fetchGroupInspiration,
  fetchGroupWall,
  finalizeAttachment,
  presignAttachment,
  uploadToPresignedUrl,
  joinGroup,
  deleteInspiration,
  createFeedback,
  releaseSignal,
  restoreSignal,
  dismissTopOfMindEntry,
  restoreTopOfMindEntry,
  releaseTopOfMindEntry,
  holdTopOfMindEntry,
  updateInspiration,
  fetchProfiles,
  type ApiGroupProposal,
  type ApiGroupMember,
  type ApiGroupSummary,
  createAgentKey,
  fetchAgentKeys,
  revokeAgentKey,
  type ApiAgentKey,
  type ApiMintedKey,
  deletePrinciple,
  disputePrinciple,
  undoPrincipleDispute,
  reorderPrinciples,
  updatePrinciple,
  type ApiPrinciple,
  type ApiGroupFieldInspiration,
  type ApiGroupWallSignal,
  type ApiReading,
  fetchTheReading,
  type ApiAntechamberRow,
  type ApiSignalDuplicate,
  fetchTheWeather,
  ApiError,
} from "../lib/api";
import { AntechamberPanel } from "../components/AntechamberPanel";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import { LoadingHome } from "../components/LoadingHome";
import { ReadingPanel } from "../components/ReadingPanel";
import {
  loadInspiration,
  loadInspirations,
  beyondOf,
  EMPTY_FIELD,
  loadTopOfMind,
  loadTopOfMindVersion,
  loadSignal,
  loadSignals,
  toInspirationDetail,
  type Inspiration,
  type InspirationDetail,
  type Entry,
  type Evidence,
  type Signal,
  type TopOfMind,
} from "../lib/data";
import { RECEIPTS } from "../lib/receipts";
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
/**
 * HOW MUCH OF THE GROUND IS ALREADY ON SCREEN AT HEADQUARTERS.
 *
 * 96 became 140 on 2026-08-28. The founder: "overall balancing feels kinda
 * off.. some places are more crowded than others. which is exacerbated on
 * mobile." Measured, the imbalance was one gap, and it was always the same
 * gap — between the mouth and this line:
 *
 *   the mouth -> the peek line   336px on 2000x1150
 *                                211px on 1440x900
 *                                183px on 390x844
 *
 * while the three things along the top of a phone sat 8px and 3px apart. And
 * it grows with the screen because the character is anchored to the middle of
 * the viewport while the field is anchored to the bottom, so every pixel of
 * extra height lands in that one band and nowhere else.
 *
 * THE ANSWER IS NOT MORE SPACING SOMEWHERE ELSE. That band is empty because
 * the ground was held down, and the thing that belongs in it is the ground.
 * Raising the peek fills it with the world's own content — more of what you
 * keep, already on screen when you arrive — rather than distributing the void
 * more evenly. The world is what the space is for.
 */
const PEEK = 140;
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
const UNWIND_MS = 650;
/**
 * How many dates the dial will list before it rolls up a grain — days to
 * months, months to years. Ten is what fits under the word without the list
 * becoming a thing you scroll, which would be the hunt all over again.
 */
const DIAL_STOPS = 10;
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
 * ARRIVING IN A ROOM, WHOSE GROUNDS ARE HERE IS LIT THIS LONG.
 *
 * A room pours ONE member's memories — yours, until you move to somebody
 * else's (see `standingOk`, and the note above it for why a heap of five
 * grounds is not evidence for anything). That decision is right and it has a
 * cost nobody had paid for: standing in a room with four other people looks
 * exactly like standing on your own wall. Every other ground was already on
 * screen, in the corner, at the dim end of the one channel this world has —
 * which is the correct RESTING state for a control and the wrong arrival.
 *
 * So travelling into a room lights all of them, and they settle back to the
 * quiet register on their own. The world moved because you moved to it, and
 * what the motion explains is that this ground is one of several.
 */
const GROUNDS_LIT_MS = 1600;
/**
 * The turn is a PLANET, not a card: the silhouette never changes, and it is
 * the features that travel across it. An eye sits on the equator at this
 * longitude; the pair are ~1 radian apart, which is what puts them where they
 * have always sat when the companion is facing you.
 */
const EYE_LON = 0.5;
/** The equator's radius as seen head-on, as a fraction of the body's width. */
const FACE_R = 0.34;
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
// AGENT WALLS — each rebuilt from its agent's OWN layers
// ---------------------------------------------------------------------------

/**
 * THE WALLS TO THE LEFT — real profiles, each carrying its own stack.
 *
 * Every layer endpoint takes `?profile=` and a human session is admin over
 * every profile in its account, so an agent's wall is built from the agent's
 * OWN inspirations, signals and top of mind. (A long-dead comment here said
 * the contents were "not reachable yet" — it outlived the fetch below by
 * weeks and sent one investigation hunting for a missing endpoint that has
 * existed all along. A wall whose fetch fails stands empty rather than
 * borrowing anything; a wall that is APPROACHED refetches, see `loadWall`.)
 *
 * The mocks are the founder's own two from the meeting, and they appear ONLY
 * in dev AND ONLY when the account has no real agent profiles. Standing an
 * invented wall beside a real one is the same class of mistake as mixing
 * invented memories into a real archive, and it is not made twice.
 */
interface AgentRosterEntry {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * IDENTITY IS EAGER; MEMORY IS ON APPROACH. The roster — which agent walls
 * exist, their names, their columns — is one cheap profiles call at mount.
 * Each wall's actual memory (its own inspirations, signals, top of mind)
 * loads the moment travel toward it begins, the way a room's field always
 * has. The old shape fetched EVERY agent's full stack before first paint —
 * potentially thousands of rows for walls nobody visits that day (founder,
 * 2026-08-30: "separate pages to make this more efficient").
 */
async function loadAgentRoster(): Promise<{
  roster: AgentRosterEntry[];
  /** dev fixture only: mock walls arrive with their bundles pre-loaded */
  mockBundles: AgentBundle[] | null;
}> {
  const real = await fetchProfiles()
    .then((rows) => rows.filter((p) => p.type === "agent"))
    .catch(() => []);
  if (real.length > 0) {
    return {
      roster: real.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
      mockBundles: null,
    };
  }
  if (!MOCK_AGENTS) return { roster: [], mockBundles: null };
  return {
    roster: MOCK_AGENT_BUNDLES.map((b) => ({
      id: b.agent.id,
      name: b.agent.name,
      createdAt: b.agent.createdAt,
    })),
    mockBundles: MOCK_AGENT_BUNDLES,
  };
}

/**
 * One agent's wall, rebuilt from its own layers — used for every wall at
 * load, and again for one wall each time travel toward it begins, so the
 * ground an arrival finds is as current as the archive underneath it.
 */
async function loadAgentBundle(
  p: {
    id: string;
    name: string;
    createdAt: string;
  },
  opts: { strict?: boolean } = {},
): Promise<AgentBundle> {
        /* TWO POSTURES, BY WHAT THE CALLER HOLDS. At first load there is
           nothing yet, so a failed fetch degrades to an honest empty wall.
           A REFRESH holds the last good ground, and replacing it with a
           failure's emptiness is how the founder's wall kept vanishing —
           one aborted request during a server restart and "6 inspirations"
           became no foot at all until a minute and another travel lined up.
           Strict mode lets the failure THROW, so the refresher keeps what
           it has and retries on the next approach instead. */
        const [field, signals, tom] = opts.strict
          ? await Promise.all([loadInspirations(p.id), loadSignals(p.id), loadTopOfMind(p.id)])
          : await Promise.all([
              loadInspirations(p.id).catch(() => EMPTY_FIELD),
              loadSignals(p.id).catch(() => [] as Signal[]),
              loadTopOfMind(p.id).catch(() => null),
            ]);
        const inspirations = field.inspirations;
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
          /* the same ceiling as every other ground: an agent that has kept
             more than the walk follows says so rather than reporting the
             length of what arrived */
          inspirationTotal: field.total,
        };
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
  goToWall: (col: number) => void;
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

/**
 * THE DRAWER LEAVES THE WORLD'S COORDINATE SYSTEM.
 *
 * The quick line belongs to the seam: its layer takes the camera's offset
 * every frame, so the line hangs off the field's top edge and scrolls away as
 * you descend. A DRAWER wants none of that. It is stuck to the bottom of the
 * SCREEN, and every ancestor between it and the screen is something that
 * moves — the camera translates the mouth layer, and opening the drawer moves
 * the world besides.
 *
 * Two narrower fixes were tried and both were wrong. `position: fixed` does
 * nothing while an ancestor carries a transform, because a transform makes
 * itself the containing block for fixed descendants. And cancelling the
 * camera on the mouth layer fixed the case I could reproduce and not the
 * founder's — it assumed the transform was the only thing moving, which is a
 * guess about which ancestor is at fault when the honest answer is that it
 * should not matter which.
 *
 * So the drawer renders into `.jar` — the world's own root — which is above
 * every moving layer inside it and is itself `position: fixed; inset: 0` with
 * no transform of its own. Nothing between the drawer and the viewport can
 * move it, whatever the world does next.
 *
 * `.jar` rather than `document.body`, which was the first attempt and looked
 * right until you saw it: every `--jar-*` token is defined ON `.jar`, so a
 * drawer parented to the body lost the whole palette and rendered as
 * transparent text over the world — the sheet, its lit lip and its sunken
 * well all resolved to nothing. The host has to be inside the scope that
 * defines the design, and outside everything that moves.
 *
 * The resting line stays exactly where it was, in the layer built for it:
 * this branch is only ever taken while the drawer is out. A null host is the
 * first render, before the ref is attached, and renders inline — which is
 * where the quick line lives anyway, so nothing flashes.
 */
/* What is NOT "outside" for each sheet: the sheet, and the control that
   opens it — pressing that again is the control's own toggle, not a
   dismissal, and treating it as one closes and reopens in the same press. */
const KEEP_ACCOUNT = [".jar-settings", ".jar-account"] as const;
const KEEP_SHEET = [".jar-settings", ".jar-seek"] as const;
const KEEP_PROV = [".jar-prov-room", ".jar-panel"] as const;
const KEEP_ANTE = [".jar-antechamber", ".jar-settings"] as const;

export default function HomePage(): JSX.Element {
  /* No gate. This is home now — it is what a signed-in person lands on, in
     every build. The dev gate that used to stand here existed while this was
     a prototype living beside the real surface; the only things still behind
     `showsDebug()` are the offline fixture and the mock walls, which is where
     that gate belongs. */
  const auth = useOptionalAuth();
  const storageScope = useMemo<ProfileStorageScope | null>(() =>
    auth?.account?.id && auth.profile?.id
      ? { accountId: auth.account.id, profileId: auth.profile.id } : null,
  [auth?.account?.id, auth?.profile?.id]);
  // Unmount the old world's caches, readers and writers at an identity change.
  return <HomeExperience key={profileStorageKey(storageScope, "world") ?? "anonymous"} storageScope={storageScope} />;
}

function HomeExperience({ storageScope }: { storageScope: ProfileStorageScope | null }): JSX.Element {
  const composerDraft = useInspirationDraft(storageScope);
  const [preparingInspiration, setPreparingInspiration] = useState(false);
  const [uploadingMediaId, setUploadingMediaId] = useState<string | null>(null);
  const [checkingFiles, setCheckingFiles] = useState(false);
  const checkingFilesCount = useRef(0), fileOwnerEpoch = useRef(0);
  const preparingInspirationRef = useRef(false), composerEpoch = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const onRecorded = useRef<(file: File) => Promise<void>>(() => Promise.resolve());
  const recording = useAudioRecording(file => onRecorded.current(file));
  useEffect(() => () => { composerEpoch.current += 1; fileOwnerEpoch.current += 1; uploadController.current?.abort(); }, []);
  const viewNavigation = useViewNavigation(storageScope ? `${storageScope.accountId}:${storageScope.profileId}` : 'fixture');
  const viewNavigationRef = useRef(viewNavigation); viewNavigationRef.current = viewNavigation;
  const restoringViewRef = useRef(true), requestedViewRef = useRef(viewNavigation.view);
  requestedViewRef.current = viewNavigation.view;
  const navigationInteraction = useRef(0);
  useEffect(() => {
    const interacted = () => { navigationInteraction.current += 1; };
    window.addEventListener('pointerdown', interacted, true);
    window.addEventListener('keydown', interacted, true);
    window.addEventListener('popstate', interacted);
    return () => {
      window.removeEventListener('pointerdown', interacted, true);
      window.removeEventListener('keydown', interacted, true);
      window.removeEventListener('popstate', interacted);
    };
  }, []);
  const [navigationProblem, setNavigationProblem] = useState(false);
  const [detachedInspiration, setDetachedInspiration] = useState<{ wall: string; ball: Ball; detail: InspirationDetail | null } | null>(null);
  const detachedRef = useRef(detachedInspiration); detachedRef.current = detachedInspiration;
  const linkedReflectionRef = useRef<{ panelId: string; open: boolean } | null>(null);
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
  /**
   * HOW MANY MEMORIES THE WALK NEVER REACHED — the remainder, not the total.
   *
   * A total held here would go stale the moment anything is kept or let go,
   * because the field is edited in place by three handlers below and none of
   * them refetch. The remainder does not: it is a fact about the far end of
   * the archive, and keeping one more memory changes the near end. So the
   * count under the door is `inspirations.length + fieldBeyond`, and it stays
   * true through a capture, an edit and a removal without any of them
   * knowing this exists.
   */
  const [fieldBeyond, setFieldBeyond] = useState<number>(0);
  const [fieldLoading,setFieldLoading]=useState(false);
  const [fieldFailed,setFieldFailed]=useState(false);
  const retryFieldRef=useRef<(()=>void)|null>(null);
  const fieldLoadingRef=useRef(false);fieldLoadingRef.current=fieldLoading;
  /**
   * THE POUR READS THIS; THE POUR DOES NOT DEPEND ON IT.
   *
   * `inspirations` is a dependency of the frame loop's setup effect, so every
   * keep tore the whole world down and built it again: new Float32Arrays for
   * the starfield and the dust, every orb reconstructed, the canvas backing
   * store reallocated, the light re-eased from zero. That is the brightening
   * and the reshuffled stars the founder reported four times — and an earlier
   * session diagnosed the rebuild exactly, then guarded the canvas resize
   * instead of stopping the rebuild, writing in the comment there that it was
   * "not a fix for that symptom".
   *
   * It is a fix now, and at the cause: `simApi.born()` ALREADY puts the new
   * orb in the world the instant you keep, so the rebuild that follows is
   * pure waste — it reproduces a world that is already correct. The loop's
   * dependency becomes a signature that ignores memories this session has
   * already born, so keeping something no longer rebuilds anything, and a
   * real change to the archive (a reload, an agent's capture, a deletion)
   * still does.
   */
  const inspirationsRef = useRef<Inspiration[] | null>(null);
  inspirationsRef.current = inspirations;
  /** server ids of memories born in THIS session; the world already has them */
  const bornIdsRef = useRef<Set<string>>(new Set());
  /* `pour-signature.ts` holds the rule and the reason it exists: an archive
     that has not answered must not sign the same as one that answered empty,
     or a fresh account whose profiles land first gets a world it cannot
     touch. */
  const pourSig = useMemo(
    () => pourSignature(inspirations, bornIdsRef.current),
    [inspirations],
  );
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
  /**
   * LAYER 4, WHERE YOU STAND — NOT A FOURTH REGION.
   *
   * The world draws three sections because the canon's first three are
   * places: memories below, statements above, and the sentence you are
   * standing in. Layer 4 is not a fourth place. A principle is what is left
   * of the top of mind once the weather has passed — the same material,
   * further along — so it belongs where the top of mind already is: one quiet
   * line under it, opened the way the sky is opened.
   *
   * This is what emptied the last entry out of the `≡` holding pen. Before
   * it, `/principles` was the only layer with no address in the world at all,
   * and the menu existed largely to carry it.
   */
  const [principles, setPrinciples] = useState<ApiPrinciple[]>([]);
  const [principlesRead,setPrinciplesRead]=useState(false);
  const acceptPrinciples=useCallback((rows:ApiPrinciple[])=>{setPrinciples(rows);setPrinciplesRead(true);},[]);
  const [groupPrincipleCounts, setGroupPrincipleCounts] = useState<Record<string, number>>({});
  /**
   * LAYER FOUR BECOMES SOMETHING YOU CAN ANSWER, not only read.
   *
   * The world has shown principles since they existed — sorted by rank, with
   * `aspirational` marked — and offered NO verb on them. Declaring, correcting,
   * disputing, ordering and removing were all on the flat `/principles` screen,
   * which is five of the twelve verbs `one-product-one-system.md` counted as
   * missing here.
   *
   * They follow the grammar the layer below already uses: press the sentence
   * and its verbs open under it, exactly as pressing a pattern opens
   * `yes · partly · not true`. A person who has learned that a claim answers
   * back when you press it has already learned this.
   *
   * `pick` is which principle is open, `pDraft` is the words being typed —
   * always a CORRECTION to a sentence that already exists, since 2026-09-08
   * when the declare path went (a value is generated, never typed) — and
   * `pGoing` is the two-step on removal — a destructive word is never beside
   * its own yes, the same rule the settings sheet keeps four times over.
   */
  const [pick, setPick] = useState<string | null>(null);
  const pickedPrincipleExists=principles.some(row=>row.id===pick);
  useEffect(()=>{
    if(!pick||!pickedPrincipleExists||viewNavigation.view?.sharePrinciple)return;
    const row=Array.from(measured.root.current?.querySelectorAll<HTMLElement>('[data-principle-id]')??[]).find(element=>element.dataset.principleId===pick);
    const list=row?.parentElement;if(!row||!list)return;
    const top=row.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop;
    if(top<list.scrollTop||top+row.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=Math.max(0,top);
  },[pick,pickedPrincipleExists,viewNavigation.view?.sharePrinciple]);
  const [pDraft, setPDraft] = useState<{ id: string; text: string } | null>(null);
  const [pGoing, setPGoing] = useState<string | null>(null);
  /**
   * WHAT A PRINCIPLE GREW FROM — the one edge the world could not draw.
   *
   * `/graph` drew three columns: principles over the signals they grew from,
   * signals over the experiences that evidence them. The world already draws
   * the lower half — pressing a pattern opens its roots down to the memories
   * behind it — and it has never been able to draw the upper one. So the
   * whole reason a flat graph existed was ONE MISSING LINK, not a missing
   * picture.
   *
   * It is drawn the way this world draws everything else: one hop, asked for,
   * under the thing it is about. Not a second diagram — the world IS the
   * diagram, and a node-and-edge canvas inside it would be a picture of a
   * place you are standing in.
   *
   * `citedSignals` already arrives on every principle, so this needs no
   * request at all; the edge was in the payload the whole time.
   */
  const [pRoots, setPRoots] = useState<string | null>(null);
  const [pBusy, setPBusy] = useState(false);

  const sky = useMemo(
    () => ({
      citations,
      signals: new Map((signals ?? []).map((p) => [p.id, p] as const)),
      /**
       * THE LAYERS ABOVE THE SKY, as the patterns they stand on.
       *
       * The field's light says how much of this person a memory holds up, and
       * "how much" runs upward: a pattern (layer 2), what currently matters
       * (layer 3), what has been settled (layer 4). Both sets are derived
       * here, beside the sky they index into, so `skyOf` stays a pure lookup
       * and there is exactly one place either can go stale.
       *
       * Layer 3 is the board's entries and NOT the poster's lead alone: the
       * whole artifact is what currently matters, and a memory under its
       * second entry is holding up the same thing as one under its first.
       */
      posterSignalIds: new Set(
        (notes ?? []).flatMap((e) => e.citedSignals.map((c) => c.id)),
      ) as ReadonlySet<string>,
      principleSignalIds: new Set(
        principles.flatMap((p) => p.citedSignals.map((c) => c.id)),
      ) as ReadonlySet<string>,
    }),
    [citations, signals, notes, principles],
  );
  const skyRef = useRef(sky);
  skyRef.current = sky;
  /** LAYER 3 — the one artifact this profile stands on. Null before the first
      synthesis, which the layout says in words rather than leaving blank. */
  const [topOfMind, setTopOfMind] = useState<TopOfMind | null>(null);
  // Null is a confirmed empty reading only after an owned read completes.
  // Home/Capture can be ready before this independent request has finished.
  const [readingLoadPhase, setReadingLoadPhase] = useState<"loading" | "ready" | "failed">("loading");
  const retryReadingLoadRef = useRef<() => void>(() => {});
  const sourceProcessing = useInspirationProcessing(storageScope);
  const inspirationSaveHandlers = useRef<Pick<Parameters<typeof useAuthoredSave>[0], 'onResolved' | 'onRemoved' | 'onEditRejected'> | null>(null);
  const inspirationSave = useAuthoredSave({ scope: storageScope, operation: 'inspiration', enabled: phase === 'ready' && !offline && composerDraft.ready,
    onResolved: (...args) => { if (!inspirationSaveHandlers.current) throw new Error('Save view is not ready'); return inspirationSaveHandlers.current.onResolved(...args); },
    onRemoved: (...args) => { if (!inspirationSaveHandlers.current) throw new Error('Save view is not ready'); inspirationSaveHandlers.current.onRemoved(...args); },
    onEditRejected: (...args) => { if (!inspirationSaveHandlers.current) throw new Error('Save view is not ready'); inspirationSaveHandlers.current.onEditRejected?.(...args); },
  });
  const sourceProcessingActiveRef = useRef(sourceProcessing.active);
  sourceProcessingActiveRef.current = sourceProcessing.active;
  // The comparison belongs to this verified snapshot, not every future read
  // of the same artifact. Revalidation or a local edit withdraws the copy.
  const [sourcePrevious, setSourcePrevious] = useState<{ body: string; reading: TopOfMind } | null>(null);
  const latestReadingRef = useRef<TopOfMind | null>(null);
  const readingMutationRef = useRef(0);
  const readingActionsPendingRef = useRef(0);
  const readingMountedRef = useRef(true);
  const readingNeedsLatestRef = useRef(false);
  const [readingCheckFailed, setReadingCheckFailed] = useState(false);
  const [readingChecking, setReadingChecking] = useState(false);
  const verifyReadingRef = useRef<(manual?: boolean) => void>(() => {});
  useEffect(() => {
    readingMountedRef.current = true;
    return () => { readingMountedRef.current = false; readingMutationRef.current += 1; };
  }, []);
  const loadPersonalReading = useCallback(async (signal?: AbortSignal) => {
    const mutation = readingMutationRef.current;
    if (readingActionsPendingRef.current) throw new Error("Reading is being updated");
    const tom = await loadTopOfMind(storageScope?.profileId, signal);
    if (!readingMountedRef.current || mutation !== readingMutationRef.current || readingActionsPendingRef.current) throw new Error("Reading request superseded");
    return tom;
  }, [storageScope?.profileId]);
  const beginReadingMutation = useCallback(() => {
    setSourcePrevious(null);
    readingMutationRef.current += 1;
    readingActionsPendingRef.current += 1;
    readingNeedsLatestRef.current = true;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      readingActionsPendingRef.current -= 1;
      readingMutationRef.current += 1;
    };
  }, []);
  /** pattern id → what it rests on. Filled by the sky's background sweep;
      read by the orbit, which never fetches on tap. */
  const evidenceBySignalRef = useRef<Map<string, Evidence[]>>(new Map());
  const [reviewEvidenceBySignal,setReviewEvidenceBySignal]=useState<Map<string,ApiSignalReviewEvidence[]>>(new Map());
  const skyReadSequence = useRef(0);
  useEffect(() => () => { skyReadSequence.current += 1; }, []);

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
   * A sequence owns each sweep. New reads, source retractions and unmounts
   * invalidate old responses so an earlier quote cannot return after deletion.
   */
  const readSkyRef = useRef<() => Promise<void>>(async () => {});
  const signalIndex = (rows:Signal[]) => {
    const index=new Map<string,Evidence[]>();
    for(const row of rows)for(const id of row.inspirationIds??[]){
      const list=index.get(id)??[];
      // Identity-only membership preserves field meaning without fabricating
      // a quote/reason or copying evidence into a lightweight read.
      list.push({signalId:row.id,inspirationId:id,preview:'',quote:null,quoteSource:null,reason:null,createdMs:0});
      index.set(id,list);
    }
    return index;
  };
  readSkyRef.current = async () => {
    const sequence=++skyReadSequence.current;
    const rows=await loadSignals(undefined,true);
    if(sequence!==skyReadSequence.current||offlineRef.current)return;
    evidenceBySignalRef.current=new Map();
    setReviewEvidenceBySignal(new Map());setProvenance(new Map());
    setSignals(rows);setCitations(signalIndex(rows));
  };
  const evidenceLead=(notes??[]).find(row=>row.pinned)??notes?.[0];
  const evidenceIds=[...new Set(evidenceLead?.citedSignals.map(row=>row.id)??[])];
  const evidenceKey=JSON.stringify([evidenceLead?.id??null,evidenceIds]);
  useEffect(()=>{
    evidenceBySignalRef.current=new Map();setReviewEvidenceBySignal(new Map());setProvenance(new Map());
    if(signals)setCitations(signalIndex(signals));
    if(!evidenceIds.length||!signals||offlineRef.current)return;
    const sequence=skyReadSequence.current,controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),15000);
    const current=()=>!controller.signal.aborted&&sequence===skyReadSequence.current&&!offlineRef.current;
    void Promise.all(evidenceIds.map(id=>loadSignal(id,controller.signal).catch(()=>null))).then(details=>{
      if(!current())return;
      const index=signalIndex(signals??[]),bySignal=new Map<string,Evidence[]>(),reviews=new Map<string,ApiSignalReviewEvidence[]>();
      for(const detail of details){
        if(!detail)continue;
        bySignal.set(detail.id,detail.evidence);reviews.set(detail.id,detail.reviewEvidence??[]);
        for(const [id,rows] of index)index.set(id,rows.filter(row=>row.signalId!==detail.id));
        for(const evidence of detail.evidence){const rows=index.get(evidence.inspirationId)??[];rows.push(evidence);index.set(evidence.inspirationId,rows);}
      }
      evidenceBySignalRef.current=bySignal;setReviewEvidenceBySignal(reviews);setCitations(index);
      const provenance:Provenance=new Map();
      for(const rows of bySignal.values())for(const evidence of rows)if(!provenance.has(evidence.inspirationId))provenance.set(evidence.inspirationId,evidence.quote);
      setProvenance(provenance);
    }).finally(()=>window.clearTimeout(timer));
    return()=>{controller.abort();window.clearTimeout(timer);};
  },[evidenceKey,signals,topOfMind?.id,topOfMind?.generationRevision]);

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
  /* parked at now? then the date label and the return button say nothing */
  const [atNow, setAtNow] = useState(true);
  /**
   * WHEN YOU ARE PARKED, AS A FACT THE PAGE CAN PRINT.
   *
   * `atNow` is a boolean and could only ever say THAT you had wound back, so
   * the only way to say WHEN was to leave the whole rail lit — which is why
   * the founder kept seeing a line across the screen they had asked four
   * times to remove. One drag set `!atNow`, `--live` followed it, and the
   * hairline stayed drawn for the rest of the session: the only way back to
   * the rest state was to land a scrub within half a day of the present, on
   * a rail that is invisible unless you are touching it.
   *
   * A word can carry that fact. `null` is now; anything else is the millisecond
   * the wall is wound to, written once — when a date in the list is pressed.
   * It was written on scrub-end, because a number in state per pointer-move
   * is a re-render per pointer-move; a list has no such problem, and the
   * mid-scrub readout that existed to cover the gap is gone with the drag.
   */
  const [parkedAt, setParkedAt] = useState<number | null>(null);
  const parkedRef = useRef<number | null>(null);
  const [chrome, setChrome] = useState<WallChrome>({
    text: null,
    awayFrom: null,
    formingAlt: null,
    asOf: null,
    forming: null,
    empty: false,
    prevText: null,
  });
  /**
   * WHAT EACH WALL LAST SAID, so returning to one is not a re-reading of it.
   *
   * The poster lights words that are NEW and leaves the ones that carried over
   * already lit — that is the drift readout, and it is the right idea. It was
   * being asked the wrong question. `prevText` was whatever sentence had been
   * on screen a moment ago, which on a travel is A DIFFERENT WALL'S: walk from
   * your own wall to a room and none of the room's words match, so every one
   * of them arrives; walk back and every word of your own wall arrives again.
   * The founder, 2026-08-28: "dont make the text keep reloding evertime i go
   * to the wall."
   *
   * Compared against a different wall's sentence the reading was not merely
   * noisy, it was meaningless in both directions — a word two unrelated
   * ambitions happened to share would have read as "carried", which is a claim
   * about drift that nothing supports.
   *
   * Keyed by wall, the question is the one the readout was built to answer:
   * what is new since THIS wall last spoke. A wall you return to unchanged
   * carries every word and simply is what it was.
   */
  const posterSaidRef = useRef(new Map<string, string>());
  /** What the companion is saying: its own line when tapped, and the told
      weather when an arrival has something on the record to tell. */
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
  /** Whether the axis is offering the two ways to make another place. */
  /**
   * MAKING A NEW PLACE — asked in one sheet, from either door.
   *
   * The offer used to live only on the `+` at the end of the axis, and it
   * opened two more marks INTO the strip — so the one row that answers "where
   * am I and where else is there" grew two answers to a different question
   * while you were reading it. And the list under the wall name, which is the
   * other place a person goes looking for their walls, offered no way to make
   * one at all (founder, 2026-08-25: "give option to add new, and inside the
   * modal, decide if they want to add new room or add new agent").
   *
   * One sheet, two doors into it, and the choice is made inside it where
   * there is room to say what each thing IS.
   */
  const [newPlace, setNewPlace] = useState(false);
  /** Whether the top-left split button is listing the other walls. */
  const [wallPick, setWallPick] = useState(false);
  /** Which pattern in the sky is being read. Its verdict row belongs to it. */
  /**
   * WHOSE GROUNDS ARE OPEN — and why the grounds are not simply always shown.
   *
   * A pattern being read used to print, all at once and all at rest: the
   * memories it was read from, the honest-empty line when it had none, who in
   * the room had answered it, the verbs to answer it yourself, and then the
   * receipt for the answer you just gave. Five things under one sentence.
   * "So confusing" was the founder's whole review of it, and they were right:
   * a claim about you buried under its own apparatus is not legible, it is
   * just dense.
   *
   * So the rule is ONE LINE AT A TIME (founder ruling, 2026-08-24): the ask
   * before you answer, the receipt after — and the grounds one tap away on
   * the same line, never stacked beneath it. This is the sky obeying the rule
   * the poster already obeys, where pressing the sentence is what asks it
   * where it came from.
   */
  /**
   * THE PROVENANCE OF ONE STATEMENT, IN A ROOM OF ITS OWN.
   *
   * Both entrances — "where from" under a signal in the sky, and "built from"
   * under the ambition at headquarters — used to render a list of pressable
   * rows in place, and pressing one flew the camera down into the field to
   * the memory. Two faults in one gesture. The travel was ruled out outright
   * (founder, 2026-08-25: "never move from sky to ground"): finding out where
   * a claim came from must not cost you the place you were reading it. And a
   * memory is longer than a row, so every ground arrived clipped with no way
   * to see the rest of it except by leaving.
   *
   * So: one object, two panes. Left is every ground this statement stands on,
   * each clamped to a few lines with the read span still lit. Right is the
   * one you pressed, whole. Nothing moves behind it.
   */
  const [prov, setProv] = useState<{ lead: string; rows: Evidence[]; reviewSignalIds?:string[] } | null>(null);
  const [provPick, setProvPick] = useState<string | null>(null);
  /** the chosen ground, fetched whole — `null` while it is on its way */
  const [provFull, setProvFull] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!prov) { setProvPick(null); setProvFull(null); }
  }, [prov]);
  /**
   * WHAT YOU HAVE SAID ABOUT A PATTERN, THIS SESSION.
   *
   * The server keeps the feedback; this is only so the row can answer in the
   * same beat rather than sitting inert until a refetch. `gone` is a pattern
   * you let go — nothing is deleted: the star sinks to the retired layer, its
   * spot carries the receipt and the way back.
   */
  const [verdicts, setVerdicts] = useState<Map<string, "true" | "partly" | "not_true" | "gone">>(
    () => new Map(),
  );
  /** The board's own state: at rest, asked about, or being rewritten. */
  const [board, setBoard] = useState<{ step: "rest" | "asking" }>({ step: "rest" });
  const [boardToast, setBoardToast] = useState<string | null>(null);
  const readingRefresh = useTopOfMindRefresh({
    storageKey: profileStorageKey(storageScope, "readingRefresh"),
    onComplete: async (result, current) => {
      const fetched = await loadPersonalReading();
      if (!current()) return;
      const tom = acceptsReadingSnapshot(latestReadingRef.current, fetched, storageScope?.profileId) ? fetched : latestReadingRef.current;
      if (result.topOfMindId && (!tom || tom.version < result.version ||
        (tom.version === result.version && tom.id !== result.topOfMindId))) {
        throw new Error("The completed reading is not available yet");
      }
      absorbBoard(tom);
      setBoard({ step: "rest" });
      return tom && tom.version > result.version
        ? tom.entries.length === 0 ? "empty" : tom.reason === "no_change" ? "unchanged" : "changed"
        : result.outcome;
    },
  });
  // A scheduled automatic read must not hide recovery for withdrawn support.
  // Only an explicit press buys a manual read; active derivation stays separate.
  const scheduledReadingRecovery = topOfMind?.supportChanged === true && sourceProcessing.phase === 'waiting' &&
    sourceProcessing.status?.stage === 'reading' && !sourceProcessing.busy;
  const readingMessage: MessageKey | null = ((sourceProcessing.active && !scheduledReadingRecovery) || inspirationSave.phase !== 'idle') && !readingRefresh.busy ? null
    : !readingRefresh.busy && readingChecking ? "worldReadingChecking"
    : !readingRefresh.busy && readingCheckFailed ? "worldReadingCheckFailed"
    : topOfMind?.supportChanged &&
    ["idle", "changed", "unchanged", "empty"].includes(readingRefresh.phase)
    ? "worldReadingSupportChanged" : ({
    idle: null, starting: "worldReadRequesting", pending: "worldReadQueued", running: "worldReadingNow",
    waiting: "worldReadWaiting", delayed: "worldReadDelayed", error: "worldReadCheckFailed",
    failed: "worldReadFailed", unknown: "worldReadUnknown", changed: "worldReadUpdated",
    unchanged: "worldReadUnchanged", empty: "worldReadEmpty",
  } as const)[readingRefresh.phase];

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
    setBoard({ step: "rest" });
    setBoardToast(null);
    void readingRefresh.start();
  }, [readingRefresh.start]);

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
    /* the receipt for the pin — the board's own quiet channel */
    setBoardToast(say(RECEIPTS.pinned.messageKey));
    window.setTimeout(() => setBoardToast(null), 6000);
    if (offlineRef.current) return;
    const finish = beginReadingMutation();
    holdTopOfMindEntry(entry.id).catch(() => {
      setNotes((prev) =>
        prev ? prev.map((n) => (n.id === entry.id ? { ...n, pinned: false } : n)) : prev,
      );
    }).finally(finish);
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
    const finish = beginReadingMutation();
    dismissTopOfMindEntry(entry.id).catch(() => {
      finish();
      loadPersonalReading()
        .then((tom) => absorbBoard(tom))
        .catch(() => undefined);
    }).finally(finish);
  }, []);

  /** The statement just taken down, for as long as taking it back still makes
      sense as one gesture rather than as an archaeology. */
  const [undrop, setUndrop] = useState<{ id: string; body: string } | null>(null);
  const restoreLead = useCallback(() => {
    if (!undrop) return;
    const id = undrop.id;
    setUndrop(null);
    if (offlineRef.current) return;
    const finish = beginReadingMutation();
    restoreTopOfMindEntry(id)
      .then(() => { finish(); return loadPersonalReading(); })
      .then((tom) => absorbBoard(tom))
      .catch(() => undefined).finally(finish);
  }, [undrop]);
  /* ---- walls (v10): the columns either side of the owner's own ---- */
  /** The rooms, newest first: the columns to the RIGHT. */
  const [groups, setGroups] = useState<ApiGroupSummary[]>([]);
  const [groupRosterReady, setGroupRosterReady] = useState(false);
  /* Layer 4's state is declared UP with the sky, because the field's light
     reads it: see `principles` there, and `carryOf` for why. Its surface —
     the quiet line under the top of mind — is far below. */
  /**
   * The agents: the columns to the LEFT. Mock until the endpoints land.
   * Null until the answer is in — the field is built from the owner's inspirations
   * AND the agents' kept memories together, and it is built once, whole.
   */
  const [agents, setAgents] = useState<AgentBundle[] | null>(null);
  /** The axis of agent walls — identities only; memories load on approach. */
  const [agentRoster, setAgentRoster] = useState<AgentRosterEntry[] | null>(null);
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
  /**
   * WHAT A REBUILD OF THE LOOP MUST NOT FORGET.
   *
   * `headingRef` above is this idea applied to one field, and the comment on
   * it explains why it had to exist: the loop is rebuilt when a destination's
   * data arrives mid-crossing, and it used to resume at column zero. That
   * fixed WHERE the loop resumed. It did not fix the fact that everything
   * else about the crossing — the camera, whether a crossing was even running,
   * and the creature's whole pose — is declared inside the effect and so is
   * replaced by a fresh object on every rebuild.
   *
   * The visible cost, measured off a screen recording: travelling into a room
   * for the first time after a hard refresh, the companion rides out to its
   * full 190px lead, holds there while the fetch lands, and then teleports
   * 288px back to centre in a single frame as the rebuilt state takes over.
   * The ease that is supposed to bring it home moves 7.4% per frame and
   * cannot produce that jump; the creature was not eased, it was replaced.
   *
   * So the crossing and the creature are snapshotted on teardown and restored
   * on setup. Three things are deliberately NOT carried:
   *
   *   `gesture` — a pointer that was down before a rebuild is not down after
   *     one. Restoring it would strand the world mid-drag with no pointer.
   *   `pour` and `view.primed` — these are exactly what the dependency list
   *     exists to reset. A rebuild happens because there is new data, and new
   *     memories have to be allowed to arrive. Carrying them would trade this
   *     bug for a field that never shows what just loaded.
   *   `view.w/h/layout` — re-measured on setup, and must be: a rebuild can
   *     straddle a resize.
   */
  const carryRef = useRef<{
    cam: unknown;
    trip: unknown;
    companion: unknown;
    /** the world has been sized, so a rebuild must not re-stage it */
    primed: boolean;
    /** where every memory had drifted to, by id */
    balls: Map<string, { x: number; y: number }>;
  } | null>(null);
  /** The camera is over a wall that has no dial: the dial fades, as in the sky. */
  const [dialAway, setDialAway] = useState(false);
  /**
   * WHETHER THE CAMERA IS STANDING IN THE GROUND.
   *
   * One discrete fact, pushed from the loop when it changes and never per
   * frame. It exists so the count of what you have kept can point DOWN from
   * headquarters and then get out of the way: a signpost to the room you are
   * already standing in is furniture, and this world has none.
   */
  const [inField, setInField] = useState(false);
  /** And whether it stands in the sky — where philosophies and values form. */
  const [inSky, setInSky] = useState(false);
  /** Drafts assembled here, in this session. They live nowhere else. */
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
  /**
   * THE LONG NOTE IS THE WHOLE PAGE, AND THE WAY OUT IS A DRAFT (founder,
   * 2026-08-27, reversing the 2026-08-25 step-aside drawer). The drawer
   * could minimize to a lip so you could glance at the world mid-thought —
   * but a lip is a third state to learn, and the founder chose two honest
   * ones instead: writing, where the page IS the note, and away, where
   * "save as draft" has put the words somewhere safe and the resting mouth
   * says so. Glancing at the world is now save-as-draft + one press back,
   * and nothing is ever half-hidden behind a strip of itself.
   */
  const draft = composerDraft.draft.text, setDraft = composerDraft.setText;
  const inputMedia = useMemo(() => inspirationInputMedia(draft, composerDraft.draft.media), [draft, composerDraft.draft.media]);
  /* the words where a callback can reach them without re-binding per keystroke */
  const draftRef = useRef("");
  draftRef.current = draft;
  /* where the pen last was, written on every keystroke — see the boundary
     effect beside the focus effect for why the field needs to be told */
  const mouthCaretRef = useRef(0);
  /* an unfinished sentence found on arrival opens the mouth holding it, rather
     than sitting invisible behind a phrase that says nothing about it */
  /**
   * WHERE THE MEMORY BEING WRITTEN IS HEADED — and it is where the LAST one
   * went, not where the first one did.
   *
   * Founder, 2026-09-08: "let's say if I captured inspiration and decided
   * that I wanted to make it public once, then keep the past, keep the last
   * selection. Don't default to private."
   *
   * WHAT THIS REPLACES, AND WHY IT WAS WRONG. The rule was "private unless
   * said otherwise, and reset after every keep so a one-off never becomes a
   * standing setting". It reads as caution and behaves as amnesia: a person
   * who works in the open re-answers the same question on every capture, and
   * a question re-answered identically forty times is one the product should
   * have learned. The reset was defending against a public choice LEAKING
   * into a later private one — but nothing here is silent. The row renders
   * which of the two stands, on every open, before anything is written; the
   * state is on screen, so remembering it is not a secret being kept.
   *
   * FIRST EVER CAPTURE IS STILL PRIVATE. `false` is what a browser with
   * nothing stored reads as, so the default only stops applying once the
   * person has actually said `public` — which is what "keep the last
   * selection" means. Private mode, or storage that throws, falls back to the
   * same private default rather than to whatever the tab happened to hold.
   */
  const [keepPublic, setKeepPublic] = useState(() => readProfileText(storageScope, "keepPublic") === "1");
  useEffect(() => {
    writeProfileText(storageScope, "keepPublic", keepPublic ? "1" : "");
  }, [keepPublic, storageScope]);
  const [mouthOpen, setMouthOpen] = useState(() => readProfileText(storageScope, "draft") !== "");
  const composerOpenRef = useRef(mouthOpen); composerOpenRef.current = mouthOpen;
  useEffect(() => { if (!mouthOpen && recording.phase !== 'idle') void recording.stop(); }, [mouthOpen, recording.phase, recording.stop]);
  const [newInspirationRequested, setNewInspirationRequested] = useState(false);
  /** The one honest line: it did not keep. Never a modal, never a silence. */
  const [mouthNote, setMouthNote] = useState("");
  /**
   * WHEN THE MOUTH HAS OUTGROWN THE QUICK LINE.
   *
   * Measured off the text itself rather than off the element's height,
   * because the two disagree at exactly the wrong moment: the height only
   * changes AFTER the face has already reflowed, so a threshold read from it
   * flickers on the character that crosses it. A count and a newline are
   * both known before paint.
   *
   * Deliberately generous. A tweet-length thought, a pasted link, a line of
   * quotation — all of those are things you say on the way past, and none of
   * them should summon a notepad. This is the length at which a single
   * tracked line stops being readable, not the length at which writing gets
   * serious.
   */
  const mouthLong = draft.length > 140 || draft.includes("\n");
  /* THE PAGE FACE NEEDS BOTH: long words AND the mouth open. The length
     alone decided it once, and the first saved draft proved that wrong — the
     draft SURVIVES the mouth closing (that is the whole point of the door),
     so a closed mouth holding a long draft wore the full-page sheet with
     nothing in it but the resting phrase, and the world was gone. Away is
     the world plus a phrase; the page exists only while you are writing. */
  const mouthPage = mouthOpen && mouthLong;

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

  /** The dial's current time. Continuous → lives in a ref, never in state. */
  const TRef = useRef(Date.now());
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
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
  /* THE WORLD SPEAKS THE PROFILE'S LANGUAGE. One normalized value for this
     render, one ref for the closures the sim and the handlers hold across
     renders, and one stable `say` that always reads the ref — so a callback
     minted before a language change still speaks the language of the moment
     it fires. */
  const locale = normalizeSupportedLocale(auth?.profile?.preferredLocale);
  const reviewEntry = useReviewEntry(storageScope, viewNavigation.view?.reviewId, locale);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const say = useCallback((key: MessageKey) => t(localeRef.current, key), []);
  /* The self wall's NAME is canon ("Me" — it also mints the /w/me address);
     what a person reads is the catalog's word for it. User-given names —
     agents, rooms — render as given. */
  const wallName = useCallback(
    (w: { kind: string; name: string }): string =>
      w.kind === "self" ? t(localeRef.current, "worldMe") : w.name,
    [],
  );
  /**
   * WHO IS ASKING — and offline, which invented person is.
   *
   * Signed out there is no profile, and every derivation that asks "is this
   * one mine?" then answered no about all of them: scene membership matches a
   * room's ground against this id, so all four fixture rooms stood empty. The
   * fixture names the member it calls "You" (`viewerProfileId`), and it is
   * only ever written on the offline path — a real session always wins here,
   * and outside dev there is no fixture to hand one over.
   */
  const offlineViewerRef = useRef<string | null>(null);
  const viewerIdRef = useRef<string | null>(null);
  viewerIdRef.current = auth?.profile?.id ?? offlineViewerRef.current;
  /**
   * A room's member lists, where the SIM can read them. The state itself
   * lives far below (it is fetched with the rest of a room's chrome); this
   * ref is declared here, above the sim's effect, because the frame loop
   * draws the room's company from it — one small being per member, behind
   * yours. Same pattern as `setMembersRef`: the ref is the one honest way
   * across a declaration-order boundary.
   */
  const membersRef = useRef<Map<string, ApiGroupMember[]>>(new Map());
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
    (agentRoster ?? []).forEach((a, i) => {
      out.push({ kind: "agent", id: a.id, name: a.name, col: -(i + 1) });
    });
    out.reverse(); /* leftmost first, so the array is the axis in order */
    out.push({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 });
    groups.forEach((g, i) => {
      out.push({ kind: "group", id: g.id, name: g.name, col: i + 1 });
    });
    return out;
  }, [agentRoster, groups]);
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
  /** Short-lived permission-checked room snapshots, shared with the simulation. */
  const groupCacheRef = useRef<
    Map<string, { status: "pending" | "ready" | "failed"; data: GroupData | null; checkedAt?: number; fieldFingerprint?: string; leaseToken?: symbol }>
  >(new Map());
  const groupRequestsRef = useRef(new Map<string, { token: symbol; promise: Promise<boolean>; controller: AbortController; timer: number }>());
  const groupLeaseTimersRef = useRef(new Map<string, number>());
  const groupReadsAliveRef = useRef(true);
  const [groupReadTick, setGroupReadTick] = useState(0);
  const groupChromeRef = useRef<Map<string, WallChrome>>(new Map());
  /* a room's ground, by group id, filled when the room wakes */
  const groupFieldRef = useRef<Map<string, ApiGroupFieldInspiration[]>>(new Map());
  /* and how much of that ground the ceiling did not let through, by group id —
     zero for every room under it, which is nearly every room */
  const groupBeyondRef = useRef<Map<string, number>>(new Map());
  /** Namespaced room-orb id → ball, for the panel and relight lookups. */
  const groupBallsRef = useRef<Map<string, Ball>>(new Map());
  /** Rooms whose orbs have already poured this session: no re-pour on return. */
  const groupVisitedRef = useRef<Set<string>>(new Set());
  /**
   * THE ROOM'S OWN BECOMING, so the dial has something to wind.
   *
   * The chain of boards with their reasons, and the door's ledger of arrivals
   * and departures. `groupTimelines` (below, where the room's other arrival
   * fetches live) is the state that owns this; this ref is its mirror, and it
   * exists because the dial and the poster are derived far above that
   * declaration and cannot reach forward to it.
   */
  const groupTimelineRef = useRef<Map<string, ApiGroupTimeline>>(new Map());
  /**
   * Historical row identity is immutable; permission to display it is not.
   * Keyed `groupId:version`, invalidated whenever this room is revalidated.
   */
  const groupBoardAtRef = useRef<Map<string, ApiGroupTopOfMind>>(new Map());
  /** Token ownership also prevents invalidated historical reads landing late. */
  const groupBoardPendingRef = useRef(new Map<string, { token: symbol; controller: AbortController }>());
  /** Both refs' change signal — they are filled from promises. */
  const [groupPastTick, setGroupPastTick] = useState(0);
  /**
   * IS THE RAIL SHOWING? (founder, 2026-08-25: "i don't want the line to
   * always be there. can we have a button called timeline and when user
   * hovers on it, the line and the draggable circle only show then?")
   *
   * Time is the one axis that applies to every wall at once, so it earns a
   * permanent place at the bottom edge — but a rail and a handle drawn across
   * the full width, at rest, on every screen, is a control shouting while
   * nothing is being wound. The word is what rests there now; the instrument
   * arrives when you reach for it.
   *
   * A BUTTON AND NOT ONLY A HOVER. Hover is what was asked for and it is
   * right on a pointer, but it does not exist on a phone — and this codebase
   * has shipped three controls that were dead on touch for exactly that
   * reason. Pressing the word opens the rail; hovering opens it too.
   */
  /**
   * AN AGENT'S CREDENTIALS, NOW THAT THEY HAVE AN ADDRESS HERE.
   *
   * `createAgentKey` / `fetchAgentKeys` / `revokeAgentKey` lived only on the
   * flat `/agents` screen. They are three of the twelve verbs
   * `one-product-one-system.md` counted as missing from the world, and the
   * first three to come home.
   *
   * Keys are fetched WHEN THE SHEET OPENS rather than on boot: this is the
   * only surface that reads them, most sessions never open it, and a list of
   * credentials is not something to hold in memory on the chance somebody
   * asks. `minted` holds the one response that carries a secret, and nothing
   * writes it to storage — see the sheet for why that sentence matters.
   */
  const [agentKeys, setAgentKeys] = useState<ApiAgentKey[]>([]);
  const [minted, setMinted] = useState<ApiMintedKey | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [keysBusy, setKeysBusy] = useState(false);
  /**
   * THE DATES OPEN UNDER A PRESS, AND UNDER A HOVER.
   *
   * Founder, 2026-08-30: "when clicking on now, just show the major dates" —
   * and a `timeNear` that had opened the rail on hover came out with the
   * slider, because it also CLOSED on leaving the word. That is right for a
   * hairline you reach toward and wrong for a menu you have to travel to: the
   * pointer must leave the word to reach the list, and the list went with it.
   *
   * Founder, 2026-09-08: "when I hover on now, the text list should appear."
   * Both are satisfied by keeping the half that was wrong out of it. Hovering
   * OPENS; nothing closes on leaving. The ways out are unchanged and there
   * are three — press the word again, press anywhere that is not the rail, or
   * pick a date — so the list can never be stranded out of reach, which was
   * the whole objection in 2026-08-30.
   *
   * ONE STATE STILL, and the hover is gated on a mouse. A tap fires
   * `pointerenter` too, so an ungated hover would open the list on
   * `pointerdown` and the click that follows would toggle it straight shut —
   * the word would stop working on a phone entirely.
   *
   * AND THE PRESS AFTER THE HOVER KEEPS IT OPEN, which the first cut of this
   * got wrong. A mouse arriving opens the list, and then the most natural
   * thing anybody does — click the word you are already looking at — toggled
   * it straight back shut. Found by pressing it the way Playwright does:
   * `click()` moves the pointer first, so `.jar-when` opened on the move and
   * closed on the press, and four walks that reach the dates through that
   * word (`the-timeline`, `first-sixty`, `nothing-invisible`) were left
   * photographing a surface that was not there. A person hovering and then
   * pressing means "yes, this one", never "take it away".
   *
   * So the press toggles from the state the word was in BEFORE the pointer
   * arrived: `timeHovered` remembers that the hover is what opened it, the
   * first press spends that memory and leaves the list up, and the next press
   * closes it. Every way out survives — press the word again, press anywhere
   * that is not the rail, or pick a date.
   */
  const [timeOpen, setTimeOpen] = useState(false);
  /** whether the hover, rather than a press, is what put the list up */
  const timeHovered = useRef(false);

  /**
   * THE RAIL GOES AWAY WHEN YOU LOOK AWAY (founder, 2026-08-27: "timeline line
   * should disappear if clicked outside of it").
   *
   * Pressing the word opened the rail and only pressing the word again closed
   * it, so an instrument summoned for one glance stayed up over the world
   * until you remembered to dismiss it — and the thing it hangs beside is the
   * wall you are trying to read.
   *
   * A press anywhere that is not the rail or its own word is that dismissal.
   * `pointerdown` and not `click`, so the rail is gone before whatever the
   * press was actually for happens; capture phase, so a handler that stops
   * propagation cannot leave it stranded. A scrub in flight is never
   * interrupted: the pointer is on the rail then, and it says so.
   */
  useEffect(() => {
    if (!timeOpen) return undefined;
    const away = (e: PointerEvent) => {
      const at = e.target as Element | null;
      if (!at) return;
      if (at.closest?.(".jar-dial") || at.closest?.(".jar-when")) return;
      setTimeOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [timeOpen]);

  /**
   * Fetch one room's jar — its readings' evidence plus its direction —
   * starting the moment travel toward it begins, so arrival usually finds it
   * ready. The room wakes only when the character has arrived AND this has
   * resolved: a room never renders half-poured. Shared snapshots expire and
   * are checked again on return/focus; failed verification clears stale data.
   */
  const clearGroupHistory = useCallback((groupId: string) => {
    for (const key of groupBoardAtRef.current.keys()) if (key.startsWith(`${groupId}:`)) groupBoardAtRef.current.delete(key);
    for (const [key, request] of groupBoardPendingRef.current) if (key.startsWith(`${groupId}:`)) {
      request.controller.abort(); groupBoardPendingRef.current.delete(key);
    }
    setGroupPastTick((value) => value + 1);
    setGroupReadTick((value) => value + 1);
  }, []);

  const clearGroupDisplay = useCallback((groupId: string) => {
    window.clearTimeout(groupLeaseTimersRef.current.get(groupId));
    groupLeaseTimersRef.current.delete(groupId);
    groupCacheRef.current.delete(groupId);
    groupChromeRef.current.delete(groupId);
    groupFieldRef.current.delete(groupId);
    groupBeyondRef.current.delete(groupId);
    wallSignalsRef.current.delete(groupId);
    posterSaidRef.current.delete(groupId);
    clearGroupHistory(groupId);
    if (atWallRef.current.kind === "group" && atWallRef.current.id === groupId) {
      setChrome({ text: null, awayFrom: null, formingAlt: null, asOf: null, forming: null, empty: false, prevText: null });
      setSelectedId(null); setPanel(null); setPanelOpen(false);
      setDetachedInspiration(null); setReflectOpen(false);
      setProv(null); setProvFull(null); setProvPick(null);
    }
    setGroupFieldTick((value) => value + 1);
  }, [clearGroupHistory]);

  useEffect(() => {
    groupReadsAliveRef.current = true;
    return () => {
      groupReadsAliveRef.current = false;
      for (const request of groupRequestsRef.current.values()) { request.controller.abort(); window.clearTimeout(request.timer); }
      groupRequestsRef.current.clear();
      for (const request of groupBoardPendingRef.current.values()) request.controller.abort();
      groupBoardPendingRef.current.clear();
      for (const timer of groupLeaseTimersRef.current.values()) window.clearTimeout(timer);
      groupLeaseTimersRef.current.clear();
    };
  }, []);

  const loadGroup = useCallback((groupId: string, force = false): Promise<boolean> => {
    const cache = groupCacheRef.current;
    const inFlight = groupRequestsRef.current.get(groupId);
    if (inFlight && !force) return inFlight.promise;
    if (inFlight) inFlight.controller.abort();
    const got = cache.get(groupId);
    if (!force && got?.status === "ready" && Date.now() - (got.checkedAt ?? 0) < GROUP_READ_TTL_MS) return Promise.resolve(true);
    const token = Symbol(groupId);
    const controller = new AbortController();
    const requestedAt = Date.now();
    const current = () => groupReadsAliveRef.current && groupRequestsRef.current.get(groupId)?.token === token;
    cache.set(groupId, { ...got, status: "pending", data: got?.data ?? null });
    setFailedGroups((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    let timer = 0;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => {
        controller.abort(); reject(new Error("Room verification timed out"));
      }, GROUP_READ_TTL_MS);
    });
    const promise = Promise.race([Promise.all([
      fetchGroupTopOfMind(groupId, undefined, controller.signal).then((top) => {
        if (current() && groupReadingRestricts(got?.data?.top ?? null, top)) clearGroupDisplay(groupId);
        return top;
      }),
      fetchGroupWall(groupId, controller.signal),
      fetchGroupProposals(groupId, controller.signal),
      /* THE ROOM'S GROUND. Its members' public memories — the reason a room
         had a sky full of statements and nothing underneath them. A room
         never generates a signal: every statement here was formed on some
         member's own wall out of their own inspirations and then shared in,
         so the ground was always real and simply never fetched. */
      fetchGroupField(groupId, controller.signal),
    ]), deadline])
      .then(([top, wall, proposals, ground]) => {
        if (!current()) return false;
        const fieldFingerprint = JSON.stringify(ground);
        const fieldChanged = got?.fieldFingerprint !== fieldFingerprint;
        const fieldIds = new Set(ground.field.map((row) => row.id));
        const signalIds = new Set(wall.map((row) => row.signalId));
        if ((groupFieldRef.current.get(groupId) ?? []).some((row) => !fieldIds.has(row.id)) ||
          (wallSignalsRef.current.get(groupId) ?? []).some((row) => !signalIds.has(row.signalId))) clearGroupDisplay(groupId);
        wallSignalsRef.current.set(groupId, wall);
        groupFieldRef.current.set(groupId, ground.field);
        /* the same remainder the personal field keeps, per room: what its
           ground holds beyond what the ceiling let through */
        groupBeyondRef.current.set(groupId, Math.max(0, ground.total - ground.field.length));
        const evidence = groupWallOrbs(wall, top);
        const open = proposals.find((p) => p.status === "open");
        const openMs = open ? Date.parse(open.createdAt) || 0 : null;
        groupChromeRef.current.set(
          groupId,
          deriveGroupChrome(top, openMs, evidence, localeRef.current),
        );
        const entry = { status: "ready" as const, data: { evidence, top }, checkedAt: requestedAt, fieldFingerprint, leaseToken: token };
        cache.set(groupId, entry);
        setFailedGroups((prev) => {
          if (!prev.has(groupId)) return prev;
          const next = new Set(prev); next.delete(groupId); return next;
        });
        window.clearTimeout(groupLeaseTimersRef.current.get(groupId));
        groupLeaseTimersRef.current.set(groupId, window.setTimeout(() => {
          if (!groupReadsAliveRef.current || cache.get(groupId)?.leaseToken !== token) return;
          clearGroupDisplay(groupId);
          cache.set(groupId, { status: "failed", data: null });
          setFailedGroups((prev) => new Set(prev).add(groupId));
        }, Math.max(0, GROUP_READ_TTL_MS - (Date.now() - requestedAt))));
        clearGroupHistory(groupId);
        if (fieldChanged) setGroupFieldTick((n) => n + 1);
        simApiRef.current?.wake();
        return true;
      })
      .catch(() => {
        if (!current()) return false;
        clearGroupDisplay(groupId);
        cache.set(groupId, { status: "failed", data: null });
        setFailedGroups((prev) => new Set(prev).add(groupId));
        simApiRef.current?.wake();
        return false;
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (current()) groupRequestsRef.current.delete(groupId);
      });
    groupRequestsRef.current.set(groupId, { token, promise, controller, timer });
    return promise;
  }, [clearGroupDisplay, clearGroupHistory]);
  const loadGroupRef = useRef(loadGroup);
  loadGroupRef.current = loadGroup;

  // Revalidate on return/focus, and renew only the visible room's lease.
  // Unchanged snapshots do not rebuild the field or replay its animation.
  useEffect(() => {
    if (atWall.kind !== "group" || offlineRef.current) return;
    const groupId = atWall.id;
    const refresh = () => {
      if (!document.hidden) void loadGroup(groupId, true);
    };
    refresh();
    const timer = window.setInterval(refresh, GROUP_READ_TTL_MS - 5_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [atWall.kind, atWall.id, loadGroup]);

  /**
   * THE GROUND AN ARRIVAL FINDS IS CURRENT. An agent's memories change while
   * nobody is looking — its machine keeps through a key, on its own clock —
   * and a wall poured once at mount goes quietly stale (founder, 2026-08-29:
   * six keeps in the archive, an empty wall on screen). One in-flight guard
   * per agent; a failed refresh keeps the last good ground rather than
   * blanking a wall that was honest a second ago.
   */
  const agentRefreshBusyRef = useRef<Set<string>>(new Set());
  /** When each agent's ground last refreshed. The refetch answers a TRAVEL,
      but the loop re-announces an in-flight travel after every rebuild — and
      the refetch's own setAgents IS a rebuild, so an unthrottled refresh
      became a storm that restarted the trip forever: stuck mid-flight,
      refetching both agents five times a second, no arrival, dark ground.
      One refresh per approach is the meaning; the window is how it's said. */
  const agentRefreshedAtRef = useRef<Map<string, number>>(new Map());
  /** Fetched bundles wait here until the world is AT REST. Applying one
      mid-travel rebuilds the whole simulation in flight, and everything
      edge-triggered — the trip, the arrival, the pour — shears across that
      boundary (observed as a wall that says six and lights none). Travel is
      when the refresh is ASKED for; arrival is when it may land. */
  const pendingAgentBundlesRef = useRef<Map<string, AgentBundle>>(new Map());
  /** Whether an agent wall's FIRST load is underway or has failed. Success
      needs no entry here — the bundle's presence in `agents` is readiness. */
  const agentFirstLoadRef = useRef<Map<string, "pending" | "failed">>(new Map());
  const loadAgentWall = useCallback(
    (agentId: string) => {
      const entry = (agentRoster ?? []).find((r) => r.id === agentId);
      if (!entry || agentRefreshBusyRef.current.has(agentId)) return;
      if (pendingAgentBundlesRef.current.has(agentId)) return;
      const loaded = (agents ?? []).some((a) => a.agent.id === agentId);
      if (loaded) {
        /* REFRESH posture: strict, throttled, keep-last-good on failure. */
        const last = agentRefreshedAtRef.current.get(agentId) ?? 0;
        if (Date.now() - last < 60_000) return;
        agentRefreshedAtRef.current.set(agentId, Date.now());
        agentRefreshBusyRef.current.add(agentId);
        void loadAgentBundle(entry, { strict: true })
          .then((fresh) => {
            pendingAgentBundlesRef.current.set(agentId, fresh);
          })
          .catch(() => {
            /* keep the last good ground, and let the very next approach
               retry rather than waiting out the throttle window */
            agentRefreshedAtRef.current.delete(agentId);
          })
          .finally(() => {
            agentRefreshBusyRef.current.delete(agentId);
          });
        return;
      }
      /* FIRST-LOAD posture: nothing is held yet, so failure degrades to an
         honestly blank wall (wake-gated, like a room's) and the next
         approach tries again. */
      if (agentFirstLoadRef.current.get(agentId) === "pending") return;
      agentFirstLoadRef.current.set(agentId, "pending");
      agentRefreshBusyRef.current.add(agentId);
      void loadAgentBundle(entry)
        .then((fresh) => {
          agentFirstLoadRef.current.delete(agentId);
          agentRefreshedAtRef.current.set(agentId, Date.now());
          pendingAgentBundlesRef.current.set(agentId, fresh);
        })
        .catch(() => {
          agentFirstLoadRef.current.set(agentId, "failed");
        })
        .finally(() => {
          agentRefreshBusyRef.current.delete(agentId);
        });
    },
    [agentRoster, agents],
  );

  /**
   * Warm a wall, whatever kind it is. A room fetches its pooled field; an
   * agent refetches its own layers; your own wall has nothing to warm. The
   * loop calls this the moment travel toward a wall begins, so arrival
   * usually finds it ready — and current.
   */
  const loadWall = useCallback(
    (w: Space) => {
      if (w.kind === "group") loadGroup(w.id);
      if (w.kind === "agent") loadAgentWall(w.id);
    },
    [loadGroup, loadAgentWall],
  );
  const loadWallRef = useRef(loadWall);
  loadWallRef.current = loadWall;

  /** The camera came to rest on a wall. Discrete, pushed from the loop. */
  /* THE PENDING BUNDLE LANDS AT ARRIVAL — the one moment the world is
     provably at rest and freshly laid out. The rebuild this causes runs its
     rest-convergence with the right wall under it, so the refreshed ground
     settles in place instead of shearing a travel apart. */
  useEffect(() => {
    const pending = pendingAgentBundlesRef.current;
    if (pending.size === 0) return;
    const fresh = new Map(pending);
    pending.clear();
    setAgents((prev) => {
      const replaced = (prev ?? []).map((a) => {
        const f = fresh.get(a.agent.id);
        fresh.delete(a.agent.id);
        return f ?? a;
      });
      /* anything left is a FIRST load — the wall's memory arriving at all */
      return [...replaced, ...fresh.values()];
    });
  }, [atWall]);

  const pushArrived = useCallback((w: Space) => {
    setAtWall((prev) => (prev.kind === w.kind && prev.id === w.id ? prev : w));
  }, []);
  const pushArrivedRef = useRef(pushArrived);
  pushArrivedRef.current = pushArrived;

  // The route-restoration bridge below handles initial links and every POP,
  // not a one-shot latch tied to the first wall name.

  /** A room woke: its words may exist now. Discrete, pushed from the loop. */
  const pushWoken = useCallback((groupId: string) => {
    setWokenGroups((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
  }, []);
  const pushWokenRef = useRef(pushWoken);
  pushWokenRef.current = pushWoken;

  /* ---------------- data: all four fetches in parallel ---------------- */
  useEffect(() => {
    let dead = false;
    let readingRequest: { controller: AbortController; timeout: number } | null = null;
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
      /* before anything reads it: the rooms below are built against this id */
      offlineViewerRef.current = layout.viewerProfileId;
      setOffline(true);
      setNotes(layout.notes);
      setSignals(layout.signals);
      setCitations(layout.citations);
      setTopOfMind(null);
      latestReadingRef.current = null;
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
      setGroupRosterReady(true);
      setProposal(null);
      setAdopted(layout.adopted);
      setProvenance(layout.provenance);
      setInspirations(layout.inspirations);
      setPhase("ready");
    };
    /* LAYER 1 — the field. The archive is the spine, so its answer alone
       decides whether this is the real layout or the fixture. */
    const controller=new AbortController();let firstShown=false;
    const readInitialField=async()=>{
      for(let attempt=0;attempt<3;attempt++){
        const sourceRead=sourceListMutationRef.current;
        const field=await loadInspirations(undefined,{scope:storageScope??undefined,signal:controller.signal,onFirstPage:first=>{
          if(firstShown||dead||controller.signal.aborted)return;firstShown=true;
          // Rank/crowding depend on the complete field. Ready chrome and the
          // companion first, but never paint 200 orbs then reshuffle them.
          if(first.short){setInspirations([]);setFieldBeyond(first.total);setFieldLoading(true);}
          else{setInspirations(first.inspirations);setFieldBeyond(beyondOf(first));}
          setPhase('ready');
        }});
        if(sourceRead===sourceListMutationRef.current)return field;
      }
      throw new Error('The archive changed while opening. Try again.');
    };
    let fieldPending=false;
    const readField=()=>{
      if(dead||fieldPending||controller.signal.aborted)return;
      fieldPending=true;setFieldFailed(false);
      if(firstShown)setFieldLoading(true);
      void readInitialField()
      .then((field) => {
        if (dead || offlineRef.current || controller.signal.aborted) return;
        setInspirations(field.inspirations);
        setFieldBeyond(beyondOf(field));
        setFieldLoading(false);
        setFieldFailed(false);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (dead||controller.signal.aborted) return;
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
          if (firstShown||!layout) {
            navigate("/login", { replace: true });
            return;
          }
          goOffline(layout);
          return;
        }
        // Home is already usable. A later archive page failing must not
        // replace it (or an open Capture draft) with a failure/fixture world.
        if(firstShown){setFieldLoading(false);setFieldFailed(true);return;}
        /* outside dev there is no fixture and never was: the page says what
           it has always said when the archive cannot be reached */
        if (!layout) {
          /* AND IT SAYS WHY. "Reload to try again" was the entire failure
             report — the one screen a person meets when the product breaks,
             and it named neither what broke nor anything they could act on.
             The reason goes to the console for whoever is debugging, and the
             human-readable half goes on screen. */
          console.error("[waka] the field could not be poured:", err);
          /* THE SAME WORDS THE WORLD USES. This built its own sentence from
             `${err.status} — ${err.message}`, which printed "0 — …" at a
             person when the connection was dead — a status code as prose, on
             the one screen somebody meets when nothing works at all. */
          setFailReason(whyOf(err, localeRef.current) || String(err));
          setPhase("failed");
          return;
        }
        goOffline(layout);
      }).finally(()=>{fieldPending=false;});
    };
    retryFieldRef.current=readField;
    readField();
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
    const readInitialReading = () => {
      if (dead || offlineRef.current || readingRequest) return;
      setReadingLoadPhase("loading");
      const request = { controller: new AbortController(), timeout: 0 };
      readingRequest = request;
      request.timeout = window.setTimeout(() => {
        request.controller.abort();
        if (readingRequest !== request) return;
        readingRequest = null;
        if (!dead && !offlineRef.current) setReadingLoadPhase(current => current === "ready" ? current : "failed");
      }, 15_000);
      void loadPersonalReading(request.controller.signal)
        .then((tom) => {
          if (dead || offlineRef.current || request.controller.signal.aborted) return;
          if (absorbBoard(tom)) setProvenance(new Map());
        })
        .catch(() => {
          if (!dead && !offlineRef.current && !request.controller.signal.aborted)
            setReadingLoadPhase(current => current === "ready" ? current : "failed");
        })
        .finally(() => {
          window.clearTimeout(request.timeout);
          if (readingRequest === request) readingRequest = null;
        });
    };
    retryReadingLoadRef.current = readInitialReading;
    readInitialReading();
    /* THE WALLS TO THE LEFT — identities now, memories on approach. An
       outright failure means no agents, which is exactly what a person with
       no agents sees. */
    loadAgentRoster()
      .then(({ roster, mockBundles }) => {
        if (dead) return;
        setAgentRoster(roster);
        setAgents(mockBundles ?? []);
      })
      .catch(() => {
        if (!dead) {
          setAgentRoster([]);
          setAgents([]);
        }
      });
    /* THE ROOMS — the columns to the RIGHT.
       A room is a WALL OF STATEMENTS. Members share signals, never inspirations,
       so what hangs on a room's wall is other people's signals with their
       names on them; the raw memories behind them never leave the account
       they were saved in. That is the canon's privacy line and it is why a
       room's orbit can say WHO fed an entry but never WHICH memory did. */
    (async () => {
      // PrincipleRead owns loading and errors separately for the selected wall.

      const rows = await fetchGroups();
      if (offlineRef.current) return;
      /* The map (v8): rooms line up to the right of your own wall,
         newest room first. This is the horizontal axis. */
      if (!dead) {
        setGroupRosterReady(true);
        setGroups(
          [...rows].sort(
            (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
          ),
        );
      }
    })().catch(() => {
      /* no rooms; your own wall is the whole axis */
    });
    return () => {
      dead = true;
      controller.abort();
      retryFieldRef.current=null;
      readingRequest?.controller.abort();
      if (readingRequest) window.clearTimeout(readingRequest.timeout);
      readingRequest = null;
      retryReadingLoadRef.current = () => {};
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
  /**
   * TAKE IN A BOARD THAT ARRIVED AFTER MOUNT — all three pieces, not two.
   *
   * The boot path sets THREE things from one `loadTopOfMind`: the artifact,
   * its entries, and `adopted` — which is the one the poster actually reads.
   * The first version of the refetch below set the first two and the poster
   * went on saying `Forming — nothing adopted yet` with a built board sitting
   * in state behind it. The request fired at +6.1s, the fix looked done, and
   * the screen was unchanged; only watching the screen rather than the network
   * caught it.
   *
   * The artifact, actionable entries and displayed lead must agree. Keeping
   * a boot-time override after replacing the entries made the page act on a
   * different sentence than the one it showed. Absorption updates all three;
   * it never moves the camera or replaces an open inspiration/reflection.
   */
  const absorbBoard = useCallback((tom: TopOfMind | null) => {
    if (!acceptsReadingSnapshot(latestReadingRef.current, tom, storageScope?.profileId)) return false;
    if (tom?.supportChanged && atWallRef.current.kind === "self") {
      setProv((current) => current && !tom.entries.some((entry) => entry.body === current.lead && !entry.supportChanged) ? null : current);
    }
    latestReadingRef.current = tom;
    readingNeedsLatestRef.current = false;
    setReadingCheckFailed(false);
    setReadingLoadPhase("ready");
    setTopOfMind(tom);
    setNotes(tom?.entries ?? []);
    /* AND THE CLOCK HAS TO KNOW THE ENTRY EXISTS.
       This is the whole reason the first two versions of this did nothing
       visible. `deriveAmbition` gates on `adopted.createdMs <= T`, and `T`
       starts at `Date.now()` when the page loads and afterwards only ever
       advances to a MEMORY's `capturedMs`. A board entry is derived about
       three seconds after the memory it comes from, so it is permanently in
       the future of a clock that has never heard of it — the poster was
       right to hide it, and `setAdopted` fired into a world that then
       correctly ignored it.

       The operation is line-for-line the one the pour loop already does for
       layer 1, and that comment states the rule this obeys: "this only ever
       moves `TRef` forward, and only to something that exists." An entry the
       server has built exists. Winding BACK is untouched, because `Math.max`
       cannot move a clock backwards — deliberately no dial guard here, for
       the same reason the pour loop has none: the interaction between a wound
       dial and something newly arrived is one behaviour, and it should not
       have two answers depending on which layer arrived.

       Three versions of this fix looked correct and changed nothing on
       screen. The first set two of the three states the boot path sets; the
       second added the third; only watching the POSTER rather than the
       network or the state found the clock. */
    for (const e of tom?.entries ?? []) TRef.current = Math.max(TRef.current, e.createdMs);
    const lead = tom?.entries.find((e: Entry) => e.pinned) ?? tom?.entries[0];
    setAdopted(lead ? { ambition: lead.body, groupName: null, createdMs: lead.createdMs } : null);
    return true;
  }, [storageScope?.profileId]);

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
        loadInspirations(undefined,{scope:storageScope??undefined}).then((field) => {
          setInspirations(field.inspirations);
          setFieldBeyond(beyondOf(field));
        }),
        loadAgentRoster().then(({ roster }) => setAgentRoster(roster)),
        /* only walls whose memory is already held refresh; the rest load on
           approach as ever. Strict + at rest, so a failure changes nothing. */
        ...agentsRef.current.map((a) =>
          loadAgentBundle(a.agent, { strict: true })
            .then((fresh) => {
              setAgents((prev) =>
                (prev ?? []).map((x) => (x.agent.id === fresh.agent.id ? fresh : x)),
              );
            })
            .catch(() => undefined),
        ),
        readSkyRef.current(),
      ]);
      // Recheck the displayed artifact, not a newer headline behind an open
      // composer. A pending save offers its completed reading explicitly.
      if (latestReadingRef.current) verifyReadingRef.current(false);
      else if (!sourceProcessingActiveRef.current && !isEditableTarget(document.activeElement)) {
        void loadPersonalReading().then((tom) => {
          if (!sourceProcessingActiveRef.current && !isEditableTarget(document.activeElement)) absorbBoard(tom);
        }).catch(() => undefined);
      }
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
    // A remembered original is not a current read: reflections, permissions
    // or the source itself may have changed since the previous opening.
    const inFlight = detailPendingRef.current.get(id);
    if (inFlight) return inFlight;
    const active = atWallRef.current;
    const profile = active.kind === 'agent' ? active.id : storageScope?.profileId;
    const p = loadInspiration(id, profile)
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
   * THE CREATURE, ASKED. A tap on the companion is a question — "what has
   * been happening?" — and the answer is the weather's most recent day,
   * fetched at the moment of asking so the telling is the record's current
   * truth (founder ask, 2026-08-24: "your memory was consulted…" should
   * appear whenever the character is tapped). The telling-only serve: no
   * antechamber, and therefore no consultation written — the creature must
   * not inflate the very count it is about to report. When the fortnight is
   * quiet, or the fetch dies, or the page is offline, it falls back to its
   * own field-state lines: the creature always answers something, and never
   * with a made-up weather.
   */
  /** Which of the day's clauses the next tap speaks, keyed to the list. */
  const weatherTurnRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const sayTheWeather = useCallback((fallback: () => string) => {
    if (offlineRef.current) {
      setCharSay(fallback());
      return;
    }
    fetchTheWeather({ antechamber: false })
      .then((weather) => {
        const day = weather.days[0];
        /* counts only, and no day label — the founder liked the sentence
           and struck the preamble ("just drop today and the sky held").
           The full record keeps both; this is the spoken register. */
        /* ONE CLAUSE. THE MOST NEWSWORTHY ONE (founder, 2026-08-25: "always
           show the most relevant statement of the time when clicking on it to
           show text. never show more than 1 thing"). This joined every clause
           the day had, so a busy day came out as five statements in one
           breath — a ticker, not a whisper, and the founder read it back to
           us at that length twice.

           Newsworthy is what changed ABOUT you before what you did: the poster
           moving outranks a signal moving outranks being read outranks your
           own keeping, which is last because you were there for it. Ties go to
           the order the day already tells them in.

           The same order is written down in `the-weather.ts`, which ranks its
           own spoken line the same way. It is stated twice because these are
           two packages with no shared module between them, and a single line
           of ranking is a smaller thing to keep in step than a new seam. If a
           third caller ever wants it, that is the moment it becomes one. */
        const NEWS: Record<string, number> = {
          top_of_minds: 0,
          signals: 1,
          signal_evidence: 2,
          suppressions: 3,
          consultations: 4,
          inspirations: 5,
        };
        /* AND NOT A WORD ABOUT SIGNALS (founder, 2026-08-25: "we removed
           signal concept"). Signals are the machine's working material — they
           are derived, stored and used to write your top of mind, and there is
           nowhere in this world a person meets one. A creature reporting that
           "a signal found another memory behind it" is describing plumbing to
           somebody who has never seen the pipes. The record keeps every
           clause; the spoken line is only what a person has a word for. */
        const spoken = (day?.sentences ?? [])
          .filter((sentence) => sentence.text !== "the sky held")
          .filter(
            (sentence) =>
              sentence.backing !== "signals" && sentence.backing !== "signal_evidence",
          )
          .map((sentence, i) => ({ sentence, i }))
          .sort(
            (a, b) =>
              (NEWS[a.sentence.backing] ?? 9) - (NEWS[b.sentence.backing] ?? 9) || a.i - b.i,
          );
        /* AND EACH TAP TURNS THE PAGE (founder, 2026-08-25: "when clicking on
           the character, change the text that is being shown … it can
           rotate"). Still one clause at a time — the whisper rule holds — but
           a creature that answered every tap with the same sentence read as a
           recording. The ranked list is kept, a cursor walks it, and it wraps:
           the most newsworthy thing leads, the rest arrive on curiosity. The
           cursor resets whenever the list itself changes, so a fresh fetch
           starts from the top again. */
        /* THE DAY LANDS AT THE END (founder: "this should just say x and end
           with today. today - is weird"). "Today — you kept nine memories" is
           a headline with a dateline; "you kept nine memories today" is a
           sentence somebody says. The label was already a phrase that reads
           as an ending — "today", "two days ago" — so it only ever wanted to
           be there. */
        const lines = spoken.map(
          (x) => `${x.sentence.text} ${day?.label ?? "today"}.`,
        );
        if (lines.length > 0) {
          const key = lines.join("|");
          if (weatherTurnRef.current.key !== key) {
            weatherTurnRef.current = { key, at: 0 };
          }
          setCharSay(lines[weatherTurnRef.current.at % lines.length]!);
          weatherTurnRef.current.at =
            (weatherTurnRef.current.at + 1) % lines.length;
        } else {
          setCharSay(fallback());
        }
      })
      .catch(() => setCharSay(fallback()));
  }, []);
  const sayTheWeatherRef = useRef(sayTheWeather);
  sayTheWeatherRef.current = sayTheWeather;

  /**
   * WHAT ARRIVED WHILE YOU WERE GONE — shown by going there, not by saying so.
   *
   * Held until the pour has settled, so the world is whole before it moves;
   * then the camera glides to the newest thing and lights it, and comes back
   * out. One beat, no summary, and nothing to dismiss. If nothing is new the
   * whole thing is silent, which is most days.
   *
   * AND THEN, ONLY THEN, THE WEATHER IS TOLD. One sentence for the
   * away-window, assembled server-side purely from stored records
   * (`the-weather.db.test.ts` — a deleted record loses its sentence),
   * whispered through the companion's own line after the world has drawn
   * and the camera has come home. Seeing first, telling second — the told
   * line rides the return, it never precedes it, and it is never a
   * notification: nothing to dismiss, gone on its own. A window in which
   * the loop did nothing is told with silence
   * (goals/the-legible-loop.md Phase 5).
   */
  /**
   * ONE GREETING PER VISIT — this is an ARRIVAL, and it must know that.
   *
   * The effect depends on `inspirations` because the glide cannot run before
   * the archive is in hand — but the archive also changes every time you KEEP
   * something, and `lastSeenRef` was read once at mount and never advanced
   * when `stamp()` wrote the new time. So each save re-ran the greeting
   * against the mount-time clock, found "something new since you were away"
   * — the memory you had typed four seconds ago — glid the camera to it and
   * opened its card over the mouth (founder, 2026-08-24: "dont show the
   * thing i save in card format after saving"). Greeted once, and stamp
   * advances the ref with the storage so nothing later re-reads a stale
   * "away".
   */
  const greetedRef = useRef(false);
  useEffect(() => {
    if (!inspirations || phase !== "ready" || offlineRef.current) return undefined;
    if (greetedRef.current) return undefined;
    greetedRef.current = true;
    const since = lastSeenRef.current;
    const stamp = () => {
      lastSeenRef.current = Date.now();
      try {
        window.localStorage.setItem("waka.seen", String(lastSeenRef.current));
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
    const requested = requestedViewRef.current;
    // An explicit route or an already-started interaction belongs to the
    // person. A returning-visitor greeting is never navigation authority.
    if (navigationInteraction.current || requested?.inspirationId || requested?.compose || requested?.find || requested?.wallId || requested?.reviewId || requested?.principleId || requested?.conversationId) {
      stamp(); return undefined;
    }
    const interactionAtGreeting = navigationInteraction.current;
    const greetingHref = viewNavigationRef.current.href;
    /* fetched while the glide waits its beat; whichever timeout speaks reads
       the settled value from the ref. A failed fetch is a silent arrival —
       the weather is a courtesy, never a blocker. */
    const toldRef = { current: null as string | null };
    void fetchTheWeather({ since: new Date(since), antechamber: false })
      .then((weather) => {
        toldRef.current = weather.told;
      })
      .catch(() => undefined);
    const timers: number[] = [];
    const tell = () => {
      if (toldRef.current) setCharSay(toldRef.current);
    };
    const fresh = inspirations.filter((c) => c.capturedMs > since);
    if (fresh.length === 0) {
      /* nothing to glide to — but the loop may still have worked (a refusal,
         a held poster). The world is drawn; the whisper may come. */
      timers.push(window.setTimeout(tell, 1400));
      stamp();
      return () => timers.forEach((id) => window.clearTimeout(id));
    }
    const newest = fresh.reduce((a, b) => (b.capturedMs > a.capturedMs ? b : a));
    timers.push(
      window.setTimeout(() => {
        if (navigationInteraction.current !== interactionAtGreeting || viewNavigationRef.current.href !== greetingHref) { stamp(); return; }
        simApiRef.current?.select(newest.id);
        /* AND BACK OUT, ALL THE WAY. Not just letting the selection go — the
           camera returns to headquarters, because travelling between walls is
           only possible from there, and a greeting that leaves you unable to
           walk left or right would be an ambush rather than a welcome. */
        timers.push(
          window.setTimeout(() => {
            /* UNLESS YOU HAVE TAKEN OVER, and this is the whole of the bug it
               fixes. The greeting selects a memory, waits its beat and then
               undoes itself — and it undid whatever was selected AT THAT
               MOMENT, not what it had selected itself. Anyone who pressed a
               caret, walked the reach or tapped another orb inside those 2.6
               seconds watched their own card close and the camera leave, with
               nothing on screen to explain it (it looked exactly like paging
               being broken; found live 2026-08-27). A greeting may take back
               its own gesture and nothing else. */
            if (selectedIdRef.current !== newest.id || navigationInteraction.current !== interactionAtGreeting) {
              tell();
              return;
            }
            simApiRef.current?.release();
            simApiRef.current?.toTop();
            /* home again: the telling rides the end of the return */
            tell();
          }, 2600),
        );
        stamp();
      }, 1400),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [inspirations, phase]);


  /* ------------- derived data (changes only when data changes) ------------- */


  /**
   * THE DATES YOU CAN ACTUALLY GO TO (founder, 2026-08-30: "instead of this
   * draggable line, when clicking on now, just show the major dates to make
   * them clickable").
   *
   * The rail asked a person to HUNT. Find a hairline, hold it, drag, read a
   * date that appears under your own finger, let go, and find out whether
   * that was the moment you meant. Every step of that was approximate, and
   * the instrument was hard to hold besides — "hard to drag", "moves around",
   * "not right under the word" are three separate reports about one gesture.
   *
   * A wall does not change continuously. It changes on the days something was
   * kept, a door moved, or a version was written, and every position between
   * two of those shows the identical wall. So the stops ARE those moments:
   * what the rail spent its whole length offering was mostly the same answer
   * at a thousand different heights.
   *
   * ROLLED UP UNTIL THE LIST IS STILL A LIST. A year of keeping is hundreds
   * of days, and hundreds of rows is the hunt again in a menu's clothes. So:
   * the days, if the days fit; else the months that HOLD something; else the
   * years. The finest grain readable at a glance — and never an empty month,
   * which is the other thing the rail's tick marks got wrong, since they
   * marked the calendar rather than the archive.
   *
   * Each stop lands at the END of its day, month or year, because winding to
   * a moment shows what the wall held UP TO it: "Aug 12" must include the
   * twelfth. Newest first, so the list reads down into the past — the
   * direction the rail hung, and the direction an archive is drawn in.
   */
  const dialStops = useCallback((moments: readonly number[], end: number) => {
    const roll = (
      grain: HistoryGrain,
      key: (d: Date) => string,
      last: (d: Date) => number,
      label: (ms: number) => string,
    ) => {
      const seen = new Map<string, number>();
      for (const ms of moments) {
        const d = new Date(ms);
        const k = key(d);
        if (!seen.has(k)) seen.set(k, Math.min(last(d), end));
      }
      return Array.from(seen.values())
        .sort((a, b) => b - a)
        /* `now` is the first row and already means the end of today, so a
           stop within half a day of it is the same destination said twice */
        .filter((at) => end - at >= DAY_MS / 2)
        .map((at) => ({ at, label: label(at), grain }));
    };
    const lastMs = (y: number, m: number, day: number) =>
      new Date(y, m, day, 23, 59, 59, 999).getTime();
    const days = roll(
      "day",
      (d) => `${d.getFullYear()}.${d.getMonth()}.${d.getDate()}`,
      (d) => lastMs(d.getFullYear(), d.getMonth(), d.getDate()),
      (ms) => dateWords(ms, end, localeRef.current),
    );
    if (days.length <= DIAL_STOPS) return days;
    const months = roll(
      "month",
      (d) => `${d.getFullYear()}.${d.getMonth()}`,
      /* day 0 of the next month is the last day of this one */
      (d) => lastMs(d.getFullYear(), d.getMonth() + 1, 0),
      /* THE WORDS ARE `words.ts`'S, NOT THIS FILE'S. It carried a
         `toLocaleDateString("en-US")` and its own year rule, which was
         correct while the product spoke one language and silently wrong the
         moment it spoke two — a Korean wall labelling its rows in English.
         `dialMonth` keeps the rule and knows both hands. */
      (ms) => dialMonth(ms, end, localeRef.current),
    );
    if (months.length <= DIAL_STOPS) return months;
    return roll(
      "year",
      (d) => `${d.getFullYear()}`,
      (d) => lastMs(d.getFullYear(), 11, 31),
      (ms) => dialYear(ms, localeRef.current),
    );
  }, []);

  const groupHistory = useMemo(() => {
    if (atWall.kind !== "group") return [];
    const timeline = groupTimelineRef.current.get(atWall.id);
    return timeline ? groupHistoryEvents(timeline, locale) : [];
  }, [atWall, groupPastTick, locale]);

  const dial = useMemo(() => {
    /* EVERY WALL'S DATES ARE THAT WALL'S OWN LIFE, NOT YOURS.
       The dial winds the wall you are standing on, so the moments it offers
       are that wall's. A ROOM's are the days its door moved and its readings
       were written. AN AGENT's are the days it kept something — the ruling
       from #283, kept here verbatim because it is right and this rewrite
       would have silently dropped it: "standing on Scout's wall the rail
       spanned YOUR years — and the scrub (scene-scoped since
       one-wall-one-scene) wound Scout's ground against a stranger's
       timeline. The wall's rail is the wall's memories, exactly as a room's
       is the room's." Their fix was about WHOSE moments; this change is about
       how they are offered, and the two are the same wall seen from two
       sides. Null until the bundle lands, like everything else behind the
       wake. */
    /* now — and `now` moves when something is kept now (see clockMs) */
    const end = clockMs;
    const moments: number[] = [];
    if (atWall.kind === "group") {
      const timeline = groupTimelineRef.current.get(atWall.id);
      if (!timeline) return null;
      for (const event of groupHistory) moments.push(event.at);
    } else if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      const caps = a?.inspirations ?? [];
      if (caps.length === 0) return null;
      /* the agent's captures arrive as ISO strings rather than the millis the
         viewer's own carry, so they are parsed rather than read */
      for (const cap of caps) {
        const ms = Date.parse(cap.capturedAt);
        if (Number.isFinite(ms) && ms > 0) moments.push(ms);
      }
    } else {
      if (!inspirations || inspirations.length === 0) return null;
      for (const s of inspirations) {
        if (Number.isFinite(s.capturedMs) && s.capturedMs > 0) moments.push(s.capturedMs);
      }
    }
    const stops = dialStops(moments, end);
    /* NOTHING TO WIND BACK TO IS NOT AN EMPTY LIST, IT IS NO INSTRUMENT.
       A wall whose whole life is today would drop a menu holding one row
       reading `now` — a control offering you the place you are already
       standing. The word goes with it, which is right: it was only ever the
       handle on a thing there is none of here. */
    if (stops.length === 0) return null;
    return { end, stops };
    /* `groupPastTick` is the timeline ref's change signal: the room's history
       lands a request after arrival, and the dates must re-read when it does.
       `agents` is here for the same reason on an agent's wall: its bundle
       lands after arrival too. */
  }, [inspirations, agents, clockMs, atWall, groupHistory, dialStops]);

  const selectedGroupStop = atWall.kind === "group" && parkedAt !== null
    ? dial?.stops.find((row) => row.at === parkedAt) ?? null : null;
  const selectedGroupHistory = selectedGroupStop
    ? groupHistoryCaption(eventsAtStop(groupHistory, selectedGroupStop.at, selectedGroupStop.grain), locale) : null;
  const currentGroupHistory = atWall.kind === "group" && dial
    ? groupHistoryCaption(eventsAtStop(groupHistory, dial.end, "day"), locale, 1) : null;

  /* ------------- palette: resolve vars once, re-raster sprites ------------- */
  useEffect(() => {
    const root = measured.root.current;
    if (!root) return;
    const canvasEl = measured.canvas.current;
    const ctx2d = canvasEl ? canvasEl.getContext("2d") : null;
    if (!ctx2d) return;
    const dpr = renderScale(window.innerWidth, window.innerHeight);
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

  /* NO IMAGE EVER RIDES AN ORB (founder, 2026-09-08, over a screenshot of a
     ball wearing the LinkedIn mark: "What is this LinkedIn logo? It's weird.
     Remove it. The balls should never have those logos or anything.").

     What stood here fetched each memory's og:image, circle-clipped it into
     two offscreen sprites at load, and the field drew the photo INSTEAD of
     the disc. On a link to a company page that image is the company's logo,
     so the world quietly filled with other people's brands — and the disc is
     the one thing in this product that carries meaning: light is aliveness,
     hue is whose it is, resolution is what kind of mind kept it. A logo
     overwrites all three with an advertisement.

     Gone with it: `urlById`, the sprite bake, `Ball.img` and `Ball.imgUrl`,
     and the image branch in `field-paint`. The attachment's image is still
     fetched and still shown where a picture belongs — inside the memory when
     you open it. It simply never becomes the memory's body. */


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
  /**
   * THE ROOM AS IT STOOD AT T.
   *
   * The one thing a history must never do is print today's sentence over a
   * month that had a different one — or over a month that had none at all. So
   * this never falls back to the live board: if the version that was up at T
   * is not in hand yet, the wall says the room's name and waits, and if the
   * room had no board at T it says so honestly with the month beside it.
   *
   * Winding within a verified snapshot reuses the version. Revalidating the
   * room clears that cache: the version can survive while access changes.
   */
  const groupChromeAt = useCallback(
    (groupId: string, T: number, nowMs: number): WallChrome => {
      const live = groupChromeRef.current.get(groupId) ?? null;
      const blank = (asOf: string | null): WallChrome => ({
        text: null,
        awayFrom: null,
        formingAlt: asOf === null ? null : say("worldNothingReadTogether"),
        asOf,
        forming: null,
        empty: false,
        prevText: null,
      });
      const timeline = groupTimelineRef.current.get(groupId);
      /* At now, or before the room's history is in hand, the room is simply
         itself: the live chrome, forming line and all. */
      if (!timeline || nowMs - T < DAY_MS / 2) return live ?? blank(null);

      /* Newest first, as the endpoint serves them. */
      const then = timeline.versions.find((v) => (Date.parse(v.createdAt) || 0) <= T);
      if (!then) return blank(monthTag(T, localeRef.current));

      const latest = timeline.versions[0];
      const stillStanding = latest !== undefined && then.version === latest.version;
      if (stillStanding && live) {
        /* The board has not moved since T, so what is up now is what was up
           then — and there is nothing to date-stamp, because nothing changed. */
        return { ...live, forming: null, asOf: null };
      }

      const key = `${groupId}:${then.version}`;
      const held = groupBoardAtRef.current.get(key);
      if (!held) {
        if (!groupBoardPendingRef.current.has(key)) {
          const token = Symbol(key);
          const controller = new AbortController();
          groupBoardPendingRef.current.set(key, { token, controller });
          fetchGroupTopOfMind(groupId, then.version, controller.signal)
            .then((board) => {
              if (!groupReadsAliveRef.current || groupBoardPendingRef.current.get(key)?.token !== token) return;
              groupBoardAtRef.current.set(key, board);
              setGroupPastTick((n) => n + 1);
            })
            .catch(() => undefined)
            .finally(() => {
              if (groupBoardPendingRef.current.get(key)?.token === token) groupBoardPendingRef.current.delete(key);
            });
        }
        return blank(monthTag(T, localeRef.current));
      }

      const lead = held.entries.find((e) => e.pinnedAt) ?? held.entries[0] ?? null;
      const text = lead?.body ?? null;
      return {
        text,
        awayFrom: null,
        formingAlt: text ? null : say(held.restricted ? "worldRoomReadRestricted" : "worldNothingReadTogether"),
        /* WHEN THIS WAS THE ROOM. Stamped only when the sentence differs from
           the one up now, exactly as your own wall stamps its own past: a date
           on an unchanged sentence would report a change that did not happen. */
        asOf: text && text !== (live?.text ?? null) ? monthTag(T, localeRef.current) : null,
        /* NOTHING IS FORMING IN THE PAST. An open proposal is a thing on its
           way to becoming what the room believes, and in March it either
           became it or it did not — either way it is not still on its way. */
        forming: null,
        empty: false,
        prevText: null,
      };
    },
    [],
  );

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
              localeRef.current,
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
            ? groupChromeAt(atWall.id, T, nowMs)
            : (() => {
              const current = deriveAmbition(nowMs, adopted, notes);
              const at = deriveAmbition(T, adopted, notes);
              return {
                text: at.text,
                awayFrom: null,
                formingAlt: topOfMind?.supportChanged ? say("worldReadingSupportChanged") : null,
                asOf:
                  at.text && at.text !== current.text && nowMs - T > 60_000
                    ? monthTag(T)
                    : null,
                /* WHAT IS OVERHEAD, IN WORDS. The forming line counts the sky
                   — the signals still emerging — because that is now what is
                   literally above the poster. It is time-aware too: scrub back
                   past a pattern and it reports what existed then, or says
                   nothing at all. */
                forming: formingWords(T, proposal ? proposal.createdMs : null, emerging, localeRef.current),
                /* Nothing synthesized and nothing kept: the honest empty, and
                   it is the artifact's absence that says so, not a guess. */
                empty: topOfMind === null && (inspirations?.length ?? 0) === 0,
                prevText: null,
              };
            })();
      setChrome((prev) =>
        prev.text === next.text &&
        prev.awayFrom === next.awayFrom &&
        prev.formingAlt === next.formingAlt &&
        prev.asOf === next.asOf &&
        prev.forming === next.forming &&
        prev.empty === next.empty
          ? prev
          : /* what THIS WALL said last, so the poster lights the words that
               are new to it rather than the words it does not share with
               whatever wall was on screen a moment ago */
            { ...next, prevText: posterSaidRef.current.get(atWall.id) ?? null },
      );
    },
    /* `wokenGroups` is here because a room's board arrives asynchronously into
       `groupChromeRef`, which is a ref and so cannot itself trigger anything.
       `loadGroup` adds the room to this set in the same breath as filling that
       map, so depending on it is what makes the poster appear on arrival
       rather than at whatever unrelated render happens next. `wallChromeNow`
       already depends on it for the same reason. */
    [dial, adopted, notes, proposal, atWall, agents, emerging, topOfMind, inspirations, wokenGroups, groupFieldTick, groupReadTick],
  );
  /* AND THE WALL REMEMBERS WHAT IT SAID, once it is on screen saying it.
     After the commit, not inside the updater: the sentence has to be recorded
     as SHOWN, and a state updater can run more than once for one render. Empty
     is not a thing a wall said — a wall that has nothing yet must still get
     its first sentence delivered rather than held. */
  useEffect(() => {
    if (chrome.text) posterSaidRef.current.set(atWall.id, chrome.text);
  }, [chrome.text, atWall.id]);
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
   * Rooms come from the ref the fetch fills. `groupFieldTick` is in the deps
   * because that is the state the FETCH bumps, and `wokenGroups` because that
   * is the state ARRIVAL bumps — both, so the read is never stale from either
   * direction.
   *
   * `groupFieldTick` was missing, and that was half of a defect the founder
   * reported twice: "dont make the text be there and reload when character
   * goes to the room. keep it rendered and dont rerender when character
   * arrives." The fetch filled `groupChromeRef` and bumped its tick, but this
   * map did not listen to that tick, so a room's words could not be read out
   * of the ref until arrival happened to re-derive it. The sentence therefore
   * could not exist before the character got there, however early the fetch
   * had landed.
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
          text: at.text,
          awayFrom: null,
          formingAlt: topOfMind?.supportChanged ? say("worldReadingSupportChanged") : null,
          asOf: null,
          forming: formingWords(nowMs, proposal ? proposal.createdMs : null, emerging, localeRef.current),
          empty: topOfMind === null && (inspirations?.length ?? 0) === 0,
          prevText: null,
        });
      }
    }
    return m;
  }, [walls, agents, wokenGroups, groupFieldTick, groupReadTick, dial, adopted, notes, proposal, emerging, topOfMind, inspirations]);

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
  }, [provenance, agents, inspirations, walls, wokenGroups, groupFieldTick, groupReadTick]);

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
      companion.y = compactHome ? -view.h * 3 : hi >= lo ? clamp(view.h / 2, lo, hi) : (lo + hi) / 2;
      /* WHAT SITS UNDER THE COMPANION, AND IN WHAT ORDER (founder, 2026-08-25:
         "keep something should be shown right below the character").
         The mouth first, directly beneath the body, because keeping something
         is what this page is FOR and it should be under the hand before
         anything else is. The companion's own line goes below the mouth: it
         reports what the loop did, and it says so in the mouth's own slot
         rather than in a row of its own — one place, one line. */
      const chin = Math.round(companion.y + companion.size * 0.62);
      root!.style.setProperty("--jar-mouth-top", `${compactHome ? activityLayout.composerTop : chin + 18}px`);
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
            ctx!.fillStyle = "#2b2822";
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
        const nubR = companion.size * lerp(0.062, 0.1, bodyLit);
        const nubRgb = mix([166, 163, 156], [214, 209, 197], bodyLit);
        const nubFront = rgbCss(nubRgb, 1);
        /* the far side of a form is darker than the near side */
        const nubBack = rgbCss(mix(nubRgb, [0, 0, 0], 0.15), 1);
        const drawNub = (lon: number, behind: boolean) => {
          const a = companion.yaw + lon;
          if (Math.cos(a) < 0 !== behind) return;
          const s = Math.sin(a);
          /* pointing at or away from you, a nub reads smaller */
          ctx!.fillStyle = behind ? nubBack : nubFront;
          const nx = s * bw * 0.42;
          const ny = bh * 0.24;
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
        drawNub(-Math.PI / 2, true);
        drawNub(Math.PI / 2, true);

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
      for (const seat of companySeats) {
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
        sayTheWeatherRef.current(sayLine);
        wake();
        return;
      }
      /* a member of the room answers with who it is — and nothing more.
         Whose memories these are is a fact about the room; what they think
         is on their own wall, which is a journey and not a tap. */
      const member = memberAt(cx, cy + cam.y);
      if (member) {
        noticeMember(member);
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
      (isNativeSurface(t) || t.closest("button, a, textarea, input, select") !== null);

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
      gesture.wheelXAcc = 0;
      cam.y = clamp(cam.y + e.deltaY, minCamNow() - 60, view.layout.maxCam + 60);
      cam.aiming = false;
      /* snap once the wheel goes quiet */
      gesture.snapAt = nowW + 150;
      wake();
    };
    const onKey = (e: KeyboardEvent) => {
      // This guard precedes ALL shortcuts, including slash. Editors and IME
      // composition keep their characters; browser shortcuts keep modifiers.
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      // A reading card owns its paging arrows; other panels keep their keys.
      if (isNativeSurface(e.target) && !(e.target instanceof Element && e.target.closest(".jar-panel"))) return;
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
  }, [pourSig, agents, walls, groupFieldTick]);

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
      const above = skyOf(
        b.sigId ?? b.id,
        sky.citations,
        sky.signals,
        sky.posterSignalIds,
        sky.principleSignalIds,
      );
      b.hasNotes = above.cited;
      /* the three facts the light grades by — see carryOf */
      b.roots = above.roots;
      b.promotion = above.promotion;
      b.onPoster = above.onPoster;
      b.underPrinciple = above.underPrinciple;
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

  /* ---------------- winding this wall to a date ---------------- */

  /**
   * ONE PRESS, ONE MOMENT (founder, 2026-08-30: "instead of this draggable
   * line, when clicking on now, just show the major dates to make them
   * clickable").
   *
   * This is everything `scrubClient` did on every pointer-move, minus the
   * geometry — and the geometry was the whole of the trouble. A rail had to
   * read a clientY against a track's measured box to guess which millisecond
   * a finger meant; a date already says which one it means, so there is
   * nothing to read, nothing to freeze against a moving anchor, and no
   * mid-gesture readout to keep in sync with a handle.
   *
   * `parkedAt` is written HERE rather than on a release, because a press is
   * both the start and the end of this gesture. The list closes with it: the
   * question it was opened to answer has been answered.
   */
  const windTo = useCallback(
    (T: number) => {
      if (!dial) return;
      /* landing on today IS being at now — half a day of slack, so the last
         stop before the present cannot leave the word reading a date while
         the wall shows everything */
      const isNow = dial.end - T < DAY_MS / 2;
      setAtNow(isNow);
      parkedRef.current = isNow ? null : T;
      setParkedAt(isNow ? null : T);
      setTimeOpen(false);
      simApiRef.current?.windTo(T);
      applyChromeRef.current(T);
    },
    [dial],
  );
  /* AND THE LOOP IS WOKEN AGAIN ONCE THE NEW WORD IS ON SCREEN.
     `windTo` wakes the loop through the sim, but it wakes it BEFORE this
     render commits, so that frame measures the word the press replaced. The
     dates hang from the word and the word has just changed width, so the
     measurement has to happen on the far side of the commit — which is
     exactly what an effect on the reading is. Without it the anchor is
     correct only if the loop happens to still be running when React gets
     round to the DOM, and the world is deliberately built to stop running the
     moment nothing is happening. */
  /* BEFORE PAINT, NOT AFTER IT. The dates mount when they open, and a plain
     effect would show them one frame at the stylesheet's guess and then jump
     them under the word — the world moving without anybody moving it. A
     layout effect measures and writes inside the same commit, so the list has
     never been anywhere but where it belongs. */
  useLayoutEffect(() => {
    simApiRef.current?.hangRail();
  }, [parkedAt, timeOpen]);


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

  /* The one thing the card's remount key was doing that mattered: a long
     memory read to its foot must not hand its scroll position to the next
     one. The element persists now (that is what ended the blink), so the
     reset is said out loud instead of inherited from a fresh node. */
  useEffect(() => {
    panelRef.current?.scrollTo?.({ top: 0 });
  }, [panel?.id]);

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
    const selectedBall = ballsRef.current?.byId.get(selectedId);
    const groupBall = selectedBall?.col !== undefined ? selectedBall : groupBallsRef.current.get(selectedId);
    if (groupBall && !groupBall.own) {
      setPanel({ id: selectedId, detail: null, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    const detached = detachedRef.current;
    if (detached?.ball.id === selectedId && detached.wall === spaceKey(atWallRef.current)) {
      setPanel({ id: selectedId, detail: detached.detail, partial: false }); setPanelOpen(true);
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
      steppingRef.current = false;
      setPanel({ id: selectedId, detail: cached, partial: false });
      setPanelOpen(true);
      return undefined;
    }
    /* otherwise: whatever was open leaves at once, and nothing takes its
       place until the new content is complete.

       EXCEPT WHILE STEPPING, WHICH IS THE SAME CARD (founder's recording,
       2026-08-25: "don't make card blink when switching"). Closing and
       reopening is right when a DIFFERENT memory is opened out of the field —
       that is a new appearance, and the animation says so. Paging with the
       carets is not: the card is a frame you are turning pages inside, the
       carets live in its own foot, and taking the whole object away and
       bringing it back between pages reads as a blink. The old words stay up
       until the new ones land, and only the contents change. */
    /* AND NEITHER IS MOVING TO ANOTHER MEMORY BY ANY OTHER ROUTE. The
       carets stopped blinking on 2026-08-25; tapping another orb and walking
       with the reach's arrows still closed and reopened the card on every
       move — the same page-turn, still blinking (founder, 2026-08-27: "dont
       make card blink every time i move to another inspiration"). The rule
       is the state, not the gesture: a card already up stays up, whatever
       moved the selection. The appearance animation belongs to appearing —
       from nothing, and back to nothing. */
    if (!steppingRef.current && !panelOpenRef.current) setPanelOpen(false);
    let done = false;
    const show = (detail: InspirationDetail | null) => {
      if (done) return;
      done = true;
      steppingRef.current = false;
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

  /* Placement is the stylesheet's now: the panel opens in the middle of the
     frame, always (founder, 2026-08-24). It used to be solved from the orb
     and placed beside it, which put the same thing in a different place on
     every tap — see the note on `.jar-panel`. `simApi.place()` survives for
     the sim's own use; nothing in the page asks it where to put a panel. */

  /* the companion's line is a whisper, not a status bar: it goes after 4s */
  useEffect(() => {
    if (!charSay) return undefined;
    const id = window.setTimeout(() => setCharSay(""), 4000);
    return () => window.clearTimeout(id);
  }, [charSay]);


  /* THE EVIDENCE INDEX HAS NO CHANGE SIGNAL ANY MORE, because it no longer
     changes after load. `provTick` was how React was told the ref had been
     topped up, and the only writer was the lazy fetch the sky's `focusOn`
     triggered; the eager build at load is what fills it now, before any memo
     below first runs. It was briefly kept as a constant so the dependency
     lists still named it — but a constant in a dependency array is a
     dependency that can never fire, which reads as a signal and is not one. */
  /* whether the poster is showing what it was built from */
  const [posterAsk, setPosterAsk] = useState(false);
  /** Which ground in the poster's standing-on band is being asked about —
      its verdict row belongs to it, exactly as `focusCandId` gives the sky's
      pattern its own. Closing the band lets it go. */
  const [groundAsk, setGroundAsk] = useState<string | null>(null);
  useEffect(() => {
    if (!posterAsk) setGroundAsk(null);
  }, [posterAsk]);

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
   * Whether the grounds have just been arrived at. True for GROUNDS_LIT_MS
   * after travelling onto a shared wall, and the class it drives is removed
   * rather than animated out: the rows carry an opacity transition already, so
   * dropping the class IS the settle, on the same curve everything else here
   * uses.
   */
  const [groundsLit, setGroundsLit] = useState(false);
  useEffect(() => {
    if (grounds.length === 0) {
      setGroundsLit(false);
      return;
    }
    setGroundsLit(true);
    const id = window.setTimeout(() => setGroundsLit(false), GROUNDS_LIT_MS);
    return () => window.clearTimeout(id);
    /* `wallKey` and not `grounds`: the identity of that array changes whenever
       a room's field is refetched, and re-lighting the corner because a
       background request landed is the world moving on its own. */
  }, [wallKey, grounds.length]);
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
  const posterReviewSignalIds=useMemo(()=>{
    if(atWall.kind!=='self')return [];
    const lead=notes?.find(row=>row.pinned)??notes?.[0];
    return lead?.citedSignals.map(row=>row.id).filter(id=>(reviewEvidenceBySignal.get(id)?.length??0)>0)??[];
  },[atWall,notes,reviewEvidenceBySignal]);
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
          /* the agent cache does not carry the server's span verdict yet, so
             the quote renders unlit — a worse card and never a false one */
          quoteSource: null,
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
          quoteSource: null,
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
  }, [atWall, agents, notes, wokenGroups, citations]);

  /**
   * THE GROUNDS THEMSELVES, AND WHOSE LIGHT EACH HOLDS.
   *
   * The chain above flattens to memories; this is the layer it walks
   * through — the patterns the poster's sentence stands on. Each carries its
   * ratified standing: full ink where the person has answered (a verdict, a
   * star), dim where only the machine believes it. One glance separates
   * "what we have agreed about me" from "what it currently thinks", and the
   * dim ones are the recalibration queue — answering them is the existing
   * gesture, up in the sky. goals/the-legible-loop.md Phase 4.
   *
   * The served flag is the record's truth at load; the union with this
   * session's own verdicts is what lets the light move in the same beat as
   * the answer, before any refetch. Your own wall only: a room's board
   * stands on shared statements (its chain says who said each), and an
   * agent's board grounds itself in its own memories.
   */
  const posterGrounds = useMemo<
    Array<{ id: string; statement: string; statementRevision?: string; answered: boolean; locked: boolean; contested: boolean }>
  >(() => {
    if (atWall.kind !== "self") return [];
    const board = notes ?? [];
    const lead = board.find((e) => e.pinned) ?? board[0];
    if (!lead) return [];
    return lead.citedSignals.map((cited) => ({
      id: cited.id,
      statement: cited.statement,
      contested: cited.contested,
      answered: cited.answered || verdicts.has(cited.id),
      /* CARRIED SO THE DOOR SWINGS BOTH WAYS. `answered` is true for a
         reworded signal AND for one that was given a verdict, which is right
         for deciding what the poster still asks about and useless for deciding
         what can be handed back. Only a locked one has words to return. */
      locked: cited.locked,
    }));
  }, [atWall, notes, verdicts]);

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
   * Only a VERIFIED span may light. The server now vouches for a quote by
   * naming whose words it is (`quoteSource`): the person's own, or the page
   * behind their link — different claims, never lit alike, so the page's
   * words carry a quieter mark and say so on hover. A quote with no source
   * predates verification, and lighting it would put words in the person's
   * mouth at the exact moment this panel claims to show receipts
   * (docs/known-issues.md H2 was exactly that bug) — so it renders as the
   * plain preview, a worse card and never a false one.
   */
  const salience = useCallback((e: Evidence): JSX.Element => {
    const full = e.preview ?? "";
    const q = (e.quote ?? "").trim();
    if (!q || e.quoteSource === null) return <>{full}</>;
    if (e.quoteReflectionId) return <>
      <span className="jar-label">{say("worldFromReflection")} · </span>
      <mark className="jar-prov-lit">{q}</mark>
    </>;
    const lit =
      e.quoteSource === "enrichment" ? "jar-prov-lit jar-prov-lit--page" : "jar-prov-lit";
    const said =
      e.quoteSource === "enrichment"
        ? "a sentence from the page you saved — not your own words"
        : "a sentence that is really in your record";
    const at = full.indexOf(q);
    if (at < 0)
      return (
        <mark className={lit} title={said}>
          {q}
        </mark>
      );
    return (
      <>
        {full.slice(0, at)}
        <mark className={lit} title={said}>
          {full.slice(at, at + q.length)}
        </mark>
        {full.slice(at + q.length)}
      </>
    );
  }, []);

  /* THE CHOSEN GROUND, WHOLE. The evidence row carries a preview — enough to
     show which words did the reading, never enough to be the memory. The
     right pane asks for the memory itself, once per selection, and says so
     while it is on its way rather than rendering a shorter version of the
     truth. */
  useEffect(() => {
    if (!prov || provPick === null) {
      setProvFull(null);
      return undefined;
    }
    let dead = false;
    const reflectionId = prov?.rows.find((row) => row.inspirationId === provPick)?.quoteReflectionId;
    setProvFull(null);
    loadInspiration(provPick)
      .then((full) => {
        if (!dead) setProvFull({ id: provPick, text: reflectionId
          ? full.reflections.find((row) => row.id === reflectionId)?.answer ?? say("worldReflectionUnavailable")
          : full.text });
      })
      .catch(() => {
        /* the left pane still holds the span that was read, which is the
           claim this room exists to back; the right pane says it could not
           fetch the rest rather than pretending the preview is the whole */
        if (!dead) setProvFull({ id: provPick, text: "" });
      });
    return () => {
      dead = true;
    };
  }, [provPick, prov?.rows, say]);

  const panelId = panel ? panel.id : null;

  /**
   * HOW MANY MEMORIES ARE IN THE GROUND YOU ARE STANDING OVER.
   *
   * It read `inspirations.length` — the VIEWER's own archive — on every wall,
   * so standing in a room or on an agent's wall the count said how many
   * things you had kept, printed under somebody else's ground, next to a
   * caret that takes you down into that ground (founder, 2026-08-25: "30
   * inspirations shouldn't be hardcoded and reflect the number of balls in
   * the ground per wall"). Not hardcoded, but wrong in the way that matters:
   * a number beside a door has to describe what is behind the door.
   *
   * Each wall's ground has its own source, and they are the three the loop
   * itself pours from — your archive, the agent's own captures, and the
   * room's field of its members' public memories. `groupFieldTick` is in the
   * deps because that last one lives in a ref the fetch fills.
   */
  const wallCount = useMemo<number>(() => {
    if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      return a?.inspirations.length ?? 0;
    }
    if (atWall.kind === "group") {
      /* THE GROUND BENEATH THIS DOOR IS ONE MEMBER'S, so the door counts one
         member's. It counted the room's whole pooled field until 2026-08-28,
         when the founder stood in a room holding three memories, none of them
         theirs, and read "3 INSPIRATIONS" over an empty ground.
         `ground-count.ts` carries the whole argument. */
      return groundCount(groupFieldRef.current.get(atWall.id), standing, viewerIdRef.current);
    }
    return inspirations?.length ?? 0;
    /* `groupFieldTick` is the ref's change signal — a room's memories arrive
       into `groupFieldRef` from a fetch, and this is how React is told. The
       ref itself is stable and is deliberately not a dependency.
       (This carried an `eslint-disable-next-line` until 2026-08-25. There is
       no eslint in this repo, so it silenced nothing and told a reader a rule
       was being held off when no rule exists — a line that looks like a guard
       and guards nothing, which `measure-groups.mjs` argues against by name.) */
  }, [atWall, agents, inspirations, groupFieldTick, standing, auth?.profile?.id]);

  /**
   * HOW MANY ARE BEHIND THE DOOR, WHICH CAN BE MORE THAN ARE DRAWN.
   *
   * Every ground in this product is loaded up to a ceiling — ten pages of two
   * hundred for a personal or agent archive, four hundred for a room's field.
   * The ceilings are deliberate: following a cursor forever lets one very old
   * account stall the world's first paint. What was not deliberate is that
   * nothing said so. At two and a half thousand memories the door read
   * `2000 inspirations`, the ground drew two thousand orbs, and five hundred
   * memories were absent from both with nothing said — in a product whose
   * whole promise is that it keeps what you give it, and whose posture is no
   * quiet corners.
   *
   * The failure ran in the worst direction: it UNDERSTATED. Somebody who
   * reached it had every reason to read it as memories lost.
   *
   * So the door prints both numbers when they differ. The first is still the
   * balls in the ground the caret takes you into (founder, 2026-08-25) — the
   * second is what the archive holds.
   */
  const wallTotal = useMemo<number>(() => {
    if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      return a?.inspirationTotal ?? a?.inspirations.length ?? 0;
    }
    if (atWall.kind === "group") {
      /* and the remainder is NOT added: `groupBeyondRef` is what the room's
         ceiling held back, for the ROOM, and nothing says whose those are.
         Attributing them to the member you happen to be standing in would be
         the same lie this door was just fixed for, pointing the other way.
         D5's promise is kept where it can be honoured — your own archive and
         an agent's, where the count and the remainder describe one set. */
      return groundCount(groupFieldRef.current.get(atWall.id), standing, viewerIdRef.current);
    }
    return (inspirations?.length ?? 0) + fieldBeyond;
  }, [atWall, agents, inspirations, groupFieldTick, fieldBeyond, standing, auth?.profile?.id]);

  /**
   * THE REACH — the ground, addressable without a pointer.
   *
   * An orb is painted pixels. It has no `tabindex`, no element and no DOM
   * proxy, so Tab has nothing to land on and a reader is not told a field
   * exists — measured in `docs/audits/by-keyboard-2026-08-26.md`, which found
   * the chrome excellent (eight stops, all named, all visibly focused, the
   * mouth fully usable with keys) and then found this:
   *
   *     a person who cannot use a pointer can put memories IN
   *     and cannot get a single one back OUT.
   *
   * For a product whose promise is that it keeps what you give it, that is the
   * central act missing, not a rough edge on the way to it.
   *
   * The audit named two credible fixes and declined to choose between them: a
   * DOM list behind the door — the archive as text, the canvas demoted to one
   * view among two — or roving focus on the canvas, which keeps the world
   * whole. This is the second. A list of saves is the shape this product spent
   * its whole evolution retiring, and light is its only meaning channel, so
   * the keyboard belongs IN the world with the light following it rather than
   * beside the world in a column of text.
   *
   * So: one tab stop for the entire ground, arrows to move along it, and the
   * ordinary `select` on the way — which lights the orb, leans the companion
   * toward it and opens the panel beside it, exactly as a tap does. The
   * keyboard is not given a second, quieter version of the act.
   *
   * NEWEST FIRST, which is not the field's own order. The field lays memories
   * down oldest-first so its layout never moves; a person reading their
   * archive starts at what they last kept. Nothing is being sorted twice —
   * this is a reading order over the same ground.
   */
  const reachable = useMemo<Array<{ id: string; label: string }>>(() => {
    const clean = (text: string) => text.replace(/\s+/g, " ").trim();
    if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      return (a?.inspirations ?? [])
        .slice()
        .sort((x, y) => Date.parse(y.capturedAt) - Date.parse(x.capturedAt))
        .map((m) => ({ id: m.id, label: clean(m.textPreview) }));
    }
    if (atWall.kind === "group") {
      return (groupFieldRef.current.get(atWall.id) ?? [])
        .filter((row) => row.ownerProfileId === (standing ?? viewerIdRef.current))
        .slice()
        .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))
        /* whose memory it is, said out loud — on a room's ground that is the
           fact the per-member hue carries, and a hue is not readable aloud */
        .map((m) => ({ id: groupInspirationViewId(atWall.id, m.id), label: `${m.ownerName}: ${clean(m.text)}` }));
    }
    return (inspirations ?? [])
      .slice()
      .sort((x, y) => y.capturedMs - x.capturedMs)
      .map((m) => ({ id: m.id, label: `${clean(m.preview)}${m.reflectionCount > 0 ? `, ${say("worldReflected")}` : ""}` }));
  }, [atWall, agents, inspirations, groupFieldTick, standing, locale, say]);

  /**
   * Where the reach is standing. Null until a key is pressed or an orb is
   * tapped — a cursor that appeared before anybody asked for one would be the
   * world moving without the user, which it never does.
   */
  const [reachId, setReachId] = useState<string | null>(null);

  /**
   * THE CURSOR IS THE KEYBOARD'S, AND ONLY THE KEYBOARD'S.
   *
   * This began as an effect — `if (selectedId) setReachId(selectedId)` — so
   * that tapping an orb and then tabbing in would carry on from the memory
   * already open. It made the world's selection authoritative over the
   * cursor, and the world has its own reasons to release and re-select: a
   * travel, a wind of the dial, an orb leaving the ground under you. The
   * cursor jumped back under the arrows, intermittently, which is the worst
   * version of an input bug — it works while you are watching it.
   *
   * So the handoff happens ONCE, when focus arrives, and nothing after that
   * moves the cursor except the person moving it.
   */
  const onReachFocus = useCallback(() => {
    setReachId((cur) => cur ?? selectedIdRef.current);
  }, []);

  /**
   * ARRIVING SOMEWHERE KEEPS YOUR PLACE.
   *
   * The world's ways are real buttons — `philosophies & values` takes you up
   * into the sky, the count under the door takes you down into the ground —
   * and each of them only exists in the place you left. Press one and it
   * unmounts on arrival, so the browser has nothing to hold focus on and
   * drops it to the document.
   *
   * Nothing on screen shows this. A person using a pointer never notices. A
   * person using the keyboard presses Enter on `philosophies & values`,
   * arrives in the sky, presses Tab — and starts again from the very top of
   * the page, having lost every stop they walked through to get there. Every
   * travel in the world costs them their place, in a product whose whole
   * shape is travel. Measured by `e2e:by-keyboard`: focus landed on `(the
   * document)`.
   *
   * So a place that has just been arrived in takes the focus that its own way
   * in dropped. Only when focus was actually LOST — `document.activeElement`
   * back on the body — because a person who is typing in the mouth or reading
   * a card has not lost anything and must not have it taken.
   *
   * WHAT EACH PLACE HANDS IT TO is the thing that place is for: the sky's one
   * way back down, and — in the ground — the ground itself, whose label says
   * where you are and which keys read it. Not the way back up: you came down
   * to be among your memories, and the first thing Tab offers should not be
   * the exit.
   */
  /**
   * WAS THE LAST THING THEY DID A KEYPRESS?
   *
   * The arrival focus below exists for people travelling by keyboard, and for
   * them only. Handing a chrome button focus after a POINTER click is worse
   * than useless: the button then holds focus silently, and the next Space —
   * which is what a person presses to scroll — activates it. A dialog opens
   * that nobody asked for, from a control they are not looking at, and it
   * reads as the world doing things on its own.
   *
   * (Founder, 2026-08-27, on a modal appearing unbidden. Exactly one code path
   * opens that dialog and it is a click handler, so something was clicking it.
   * A focused button and a scroll are enough.)
   */
  const lastInputWasKeyRef = useRef(false);
  useEffect(() => {
    const key = () => {
      lastInputWasKeyRef.current = true;
    };
    const point = () => {
      lastInputWasKeyRef.current = false;
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", point, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", point, true);
    };
  }, []);

  const arrivedFromRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "ready") return undefined;
    const place = `${inSky ? "sky" : inField ? "ground" : "wall"}:${atWall.kind}:${atWall.id}`;
    const came = arrivedFromRef.current;
    arrivedFromRef.current = place;
    /**
     * THE FIRST PLACE IS NOT A PLACE YOU ARRIVED IN.
     *
     * Without this, opening WAKA is itself an "arrival": the world becomes
     * ready standing at the wall with focus on the body, and the rule below
     * would hand it to the door — so the first Tab of a fresh visit would
     * start two thirds of the way down the chrome, skipping the poster and
     * the mouth, and the world would have moved something before the person
     * touched anything. Nothing is dropped on first paint because nothing was
     * held; there is nothing to give back.
     */
    if (came === null || came === place) return undefined;
    /* after the arrival paints: the chrome of the new place mounts in the
       same commit that flips these flags, but the browser has not yet settled
       focus from whatever unmounted */
    /* the whole point is a keyboard journey that keeps its place; a pointer
       journey never lost one, and giving it focus arms a button nobody is
       looking at */
    if (!lastInputWasKeyRef.current) return undefined;
    const id = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const want = inSky ? ".jar-up--down" : inField ? ".jar-reach" : ".jar-saved";
      const el = document.querySelector<HTMLElement>(want);
      /* `preventScroll`, because the ground's reach is a clipped one-pixel box
         and scrolling the page to it would move the world under somebody who
         only pressed a key */
      el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
    /* `atWall` too: walking sideways to a neighbour closes the menu you walked
       through, which unmounts the button you were standing on. Same dropped
       focus, same fix — the wall you arrive at takes it. */
  }, [inSky, inField, phase, atWall]);

  const onReachKey = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const list = reachable;
      if (list.length === 0) return;
      /* THE REACH OWNS THE KEYS IT TAKES. The world's own listener sits on
         `window` and now also steps the open card on left/right (founder,
         2026-08-27), so a key answered here would otherwise be answered
         twice and land two memories away. The keys it deliberately does NOT
         take — up, down, space — still pass through untouched, which is the
         whole one-axis-per-meaning rule. */
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "Enter"
      ) {
        e.stopPropagation();
      }
      const at = list.findIndex((m) => m.id === reachId);
      const go = (i: number) => {
        const next = list[Math.min(list.length - 1, Math.max(0, i))];
        if (!next) return;
        setReachId(next.id);
        /* `select` is the whole act, and it is the same one a tap runs: the
           orb lights, the companion leans, the panel opens beside it. It
           refuses an orb that is not on this ground right now — a memory the
           dial has wound past has not happened yet, and cannot be read. */
        simApiRef.current?.select(next.id);
      };
      /**
       * LEFT AND RIGHT, NEVER UP AND DOWN — and this is a lesson, not a
       * preference. The first version read the ground with every arrow, and
       * ↑/↓ are how the WORLD moves between its sections. The reach holds
       * focus once you arrive in the ground (that is what makes it reachable
       * at all), so a person travelling up and down had every second press
       * swallowed by the reading — a card opening over and over, apparently
       * on its own (founder, 2026-08-27: "why does this modal keep appearing
       * when i go up and down").
       *
       * One axis per meaning. Vertical belongs to the world and passes
       * through untouched; horizontal reads the ground — the same directions
       * the card's own carets already speak, ‹ into the past and › toward
       * now. Space goes with ↑/↓ for the same reason: it is a scroll key
       * before it is anything else.
       */
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          /* from nowhere, the first press lands on the newest — where
             somebody arriving at their own archive starts — and each press
             after walks into the past, the way the ‹ caret does */
          go(at < 0 ? 0 : at + 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          go(at < 0 ? 0 : at - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(list.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          /* Enter on the memory already open closes it — `select` toggles, and
             the keyboard gets the same verb the pointer has rather than a
             one-way version of it. */
          go(at < 0 ? 0 : at);
          break;
        case "Escape":
          /* not preventDefault: Escape belongs to whatever else is open too */
          simApiRef.current?.release();
          break;
        default:
          break;
      }
    },
    [reachable, reachId],
  );

  /* ---------------- the mouth ----------------
     The one verb this layout was missing. It says one phrase at rest, becomes
     a plain field when you touch it, and commits on Enter — guarded, because
     the first Enter of a Korean sentence belongs to the IME and not to us.
     The layout moves for it exactly once: an orb is born where the words are
     and falls to its home in the ground below. */

  /**
   * SAVE AS DRAFT IS A DOOR, NOT A STORE (founder, 2026-08-27: "remove
   * minimize and instead say save as draft"). The store already existed —
   * the mouth live-writes every keystroke to this profile's device draft and
   * restores it on arrival, and has since before the drawer. What did not
   * exist was a way OUT that admits the words are kept: minimize held the
   * page half-open, and Escape threw the words away. So the door closes the
   * page and simply does not clear the draft — the words stay in state and
   * in storage, the resting line says a draft waits, and opening the mouth
   * is continuing.
   */
  const openMouth = useCallback(() => {
    setMouthNote("");
    setMouthOpen(true);
    // Capture is an explicit navigation intent. Record it before boot/roster
    // restoration or the world's debounced observer can close the new editor.
    const nav=viewNavigationRef.current;
    nav.write({...EMPTY_VIEW,...nav.view,section:'top',at:null,compose:true,find:false,
      inspirationId:null,reflectionId:null,reviewId:null,reviewAnswerId:null,principleId:null,sharePrinciple:false,conversationId:null});
  }, []);

  /** The shortcut returns to the present wall before putting the pen in hand. */
  const startNewInspiration = useCallback(() => {
    if (!atNow && dial) windTo(dial.end);
    simApiRef.current?.toTop();
    setNewInspirationRequested(true);
  }, [atNow, dial, windTo]);
  useEffect(() => {
    if (!newInspirationRequested || !atNow || inField || inSky) return;
    setNewInspirationRequested(false);
    if (mouthOpen) {
      setMouthNote("");
      mouthFieldRef.current?.focus();
    } else openMouth();
  }, [newInspirationRequested, atNow, inField, inSky, mouthOpen, openMouth]);

  /** The way out that keeps the words: the page folds, the draft stays. */
  const saveAsDraft = useCallback(() => {
    if (preparingInspirationRef.current) {
      composerEpoch.current += 1; uploadController.current?.abort(); preparingInspirationRef.current = false;
      setPreparingInspiration(false); setUploadingMediaId(null);
    }
    void recording.stop().then(() => { setMouthOpen(false); setMouthNote(''); viewNavigationRef.current.closeComposer(); });
  }, [recording.stop]);

  /**
   * KEEP IT. The owned draft and immutable pending intent survive until a
   * saved row is confirmed. Only then does its orb arrive; a late completion
   * never clears newer words or appends an already-known memory twice.
   */
  /**
   * The product's one translation of an error into words, kept in `lib` so the
   * boot's failure screen uses the SAME one — see `why-failed.ts` for the
   * divergence that put it there.
   */
  const whyFailed = useCallback(
    (err: unknown, fallback: string): string => sayWhyFailed(err, fallback, localeRef.current),
    [],
  );

  const sourceListMutationRef = useRef(0);
  const attachmentRequestsRef = useRef(new Set<string>());
  const birthInspiration = (id: string, text: string, atMs: number, serverId?: string) => {
    const seed: BornSeed = { id, ...(serverId ? { sigId: serverId } : {}), capturedMs: atMs, updatedMs: atMs,
      textPreview: text, kind: "note", quote: null, reflectionCount: 0,
      cited: false, roots: 0, promotion: 0, onPoster: false, underPrinciple: false, inGroup: false, terms: [] };
    bornRef.current = [...bornRef.current, seed]; simApiRef.current?.born(seed);
    if (serverId) bornIdsRef.current.add(serverId);
    setClockMs(atMs);
  };
  inspirationSaveHandlers.current = {
    onResolved: async (intent, result, initiated) => {
      if (intent.operation !== 'inspiration') return;
      const currentDraft = composerDraft.current.current;
      const preserveNewer = intent.draft ? currentDraft.id !== intent.draft.id || currentDraft.revision !== intent.draft.revision : currentDraft.media.length > 0;
      await composerDraft.settle(intent.draft, result.inspiration.id);
      const remaining = preserveNewer ? composerDraft.current.current.text : settleInspirationDraft(profileStorageKey(storageScope, 'draft'), intent.input.text, draftRef.current);
      draftRef.current = remaining; setDraft(remaining); setMouthNote('');
      const made = result.inspiration, detail = toInspirationDetail(made);
      const known = inspirationsRef.current?.some((item) => item.id === made.id) || bornIdsRef.current.has(made.id);
      const revision = ++sourceListMutationRef.current;
      detailsRef.current.set(made.id, detail);
      const displayText = detail.preview;
      if (!known && !result.recovered) birthInspiration(made.id, displayText, Date.parse(made.createdAt), made.id);
      setInspirations((previous) => {
        if (previous?.some((item) => item.id === made.id)) return previous.map((item) => item.id === made.id ? detail : item);
        return !result.recovered ? [...(previous ?? []), detail] : previous;
      });
      // A resumed older save may be outside the initially loaded field. Read
      // its actual total rather than incrementing an already-counted memory.
      if (!known && result.recovered) void loadInspirations(intent.profileId).then((field) => {
        if (!readingMountedRef.current || sourceListMutationRef.current !== revision) return;
        setInspirations(field.inspirations); setFieldBeyond(beyondOf(field));
      }).catch(() => undefined);
      if (result.processing) sourceProcessing.track(made.id, result.processing);
      // Legacy text-only intents may still be in the journal. New bundle
      // intents have already committed all requested attachment rows.
      const links = Array.from(new Set(made.text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
      for (const url of intent.input.attachments ? [] : links) {
        const linkKey = `${made.id}:${url}`;
        if (made.attachments.some((item) => item.url === url) || attachmentRequestsRef.current.has(linkKey)) continue;
        attachmentRequestsRef.current.add(linkKey);
        void finalizeAttachment({ type: 'link', inspirationId: made.id, url }).catch(() => { attachmentRequestsRef.current.delete(linkKey); });
      }
      return () => { if (!remaining && !preserveNewer && !composerDraft.current.current.media.length) {
        const shouldReflect = initiated && intent.reflect && composerOpenRef.current;
        setMouthOpen(false);
        if (initiated) simApiRef.current?.acknowledge('kept');
        setCharSay(atWallRef.current.kind === 'self' ? say('worldSavedWord') : 'saved to your own wall');
        if (shouldReflect) setReflectOn({ id: made.id, text: displayText, attachments: detail.attachments });
        else viewNavigationRef.current.closeComposer();
      } };
    },
    onRemoved: async (intent) => {
      if (intent.operation !== 'inspiration') return;
      await composerDraft.settle(intent.draft, intent.acknowledged?.inspirationId ?? 'removed');
      const remaining = settleInspirationDraft(profileStorageKey(storageScope, 'draft'), intent.input.text, draftRef.current);
      draftRef.current = remaining; setDraft(remaining);
    },
    onEditRejected: (intent) => {
      if (intent.operation !== 'inspiration') return;
      const draft = restoreInspirationDraft(profileStorageKey(storageScope, 'draft'), intent.input.text, draftRef.current);
      draftRef.current = draft; setDraft(draft); setMouthOpen(true); setCharSay('');
    },
  };

  // The immutable, owned intent is durable before anything is sent. A newer
  // draft can be written meanwhile, but cannot replace an unresolved save.
  const uploadDraftFiles = async (media: InspirationDraftMedia[], controller: AbortController, current: () => void) => {
    if (!storageScope) throw new Error('Sign in before uploading a file.');
    await uploadInspirationMedia({ media, profileId: storageScope.profileId, signal: controller.signal,
      assertCurrent: current, uploading: setUploadingMediaId,
      persist: async (id, update) => {
        current();
        composerDraft.setMedia(composerDraft.current.current.media.map(row => row.id === id ? { ...row, ...update } : row));
        await composerDraft.flush(); current();
      },
    });
  };
  const retryDraftFile = async (id: string) => {
    if (preparingInspirationRef.current || inspirationSave.pending || inspirationSave.busy || checkingFilesCount.current || recording.phase !== 'idle') return;
    const item = composerDraft.current.current.media.find(row => row.id === id);
    if (!item?.blob || item.uploaded) return;
    preparingInspirationRef.current = true; setPreparingInspiration(true); setMouthNote('');
    const epoch = ++composerEpoch.current, controller = new AbortController(); uploadController.current = controller;
    const current = () => { if (controller.signal.aborted || composerEpoch.current !== epoch) throw new Error('Save owner changed'); };
    try { await composerDraft.flush(); current(); await uploadDraftFiles([item], controller, current); }
    catch { if (composerEpoch.current === epoch) setMouthNote('Couldn’t upload this file yet. Your draft is still here.'); }
    finally { if (composerEpoch.current === epoch) { preparingInspirationRef.current = false; setPreparingInspiration(false); setUploadingMediaId(null); } }
  };
  const keepIt = useCallback(async (andReflect = false) => {
    const text = draftRef.current.trim();
    const initialMedia = composerDraft.current.current.media;
    if (composerDraft.current.current.linkText?.trim()) { setMouthNote('Add or cancel the link before saving.'); return; }
    if (composerDraft.current.current.recordingCandidate) { setMouthNote('Choose which recording to keep before saving.'); return; }
    if (initialMedia.some(item => item.validationError)) { setMouthNote('Remove the files marked below before saving. Your other selections are kept.'); return; }
    if ((!text && !initialMedia.length) || inspirationSave.pending || inspirationSave.busy || preparingInspirationRef.current || checkingFilesCount.current || !composerDraft.ready || recording.phase !== 'idle') return;
    if (inspirationInputMedia(text, initialMedia).length > 5) { setMouthNote('Keep up to five attachments in one inspiration.'); return; }
    if (offlineRef.current) {
      birthInspiration(`kept-${Date.now().toString(36)}`, text, Date.now());
      draftRef.current = ''; writeProfileText(storageScope, 'draft', ''); setDraft(''); setMouthOpen(false); return;
    }
    preparingInspirationRef.current = true; setPreparingInspiration(true); setMouthNote('');
    const epoch = ++composerEpoch.current, controller = new AbortController(); uploadController.current = controller;
    const current = () => { if (controller.signal.aborted || composerEpoch.current !== epoch) throw new Error('Save owner changed'); };
    try {
      await composerDraft.flush(); current();
      if (initialMedia.some(item => item.blob && !item.uploaded)) await uploadDraftFiles(initialMedia, controller, current);
      const attachments: NonNullable<CreateInspirationRequest['attachments']> = composerDraft.current.current.media.map(item => {
        if (item.type === 'link' && item.url) return { type: 'link', url: item.url, name: item.name };
        if (!item.uploaded || item.type === 'link') throw new Error('This attachment has not uploaded yet.');
        return { type: item.type, ...item.uploaded, name: item.name };
      });
      for (const { url } of inspirationLinks(text)) {
        if (!url) continue;
        if (!attachments.some(item => item.type === 'link' && item.url === url)) attachments.push({ type: 'link', url });
      }
      if (attachments.length > 5) throw new Error('Keep up to five attachments in one inspiration.');
      const reference = await composerDraft.flush(); current();
      const kind = attachments.length === 1 && !text ? attachments[0]!.type : attachments.length ? 'mixed' : 'note';
      inspirationSave.start({ operation: 'inspiration', input: { text, kind, source: 'app',
        ...(attachments.length ? { attachments } : {}), ...(keepPublic ? { visibility: 'public' as const } : {}) },
        reflect: andReflect, ...(reference ? { draft: reference } : {}) });
      setCharSay('');
    } catch (reason) { if (composerEpoch.current === epoch) setMouthNote(reason instanceof ApiError ? say('worldComposerUploadFailed') : reason instanceof Error ? reason.message : 'Could not save this inspiration. Your draft is here.'); }
    finally { if (composerEpoch.current === epoch) { preparingInspirationRef.current = false; setPreparingInspiration(false); setUploadingMediaId(null); } }
  }, [keepPublic, inspirationSave.pending, inspirationSave.busy, inspirationSave.start, composerDraft, recording.phase]);

  const addInspirationFiles = async (files: File[], audio = false) => {
    const epoch = fileOwnerEpoch.current;
    checkingFilesCount.current += 1; setCheckingFiles(true);
    const accepted: InspirationDraftMedia[] = [], problems: string[] = [];
    try {
      for (const file of files) {
        try {
          if (audio && (!file.size || file.size > 25 * 1024 * 1024 || !file.type.startsWith('audio/'))) throw new Error('Choose a recording under 25 MB.');
          const checked = audio ? file : await inspectInspirationPhoto(file);
          if (epoch !== fileOwnerEpoch.current) return;
          accepted.push({ id: crypto.randomUUID(), type: audio ? 'audio' : 'image', name: checked.name.slice(0, 255) || 'Photo', blob: checked });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : 'Couldn’t read this file.';
          if (!audio) accepted.push({ id: crypto.randomUUID(), type: 'image', name: file.name.slice(0, 255) || 'Photo', blob: file, validationError: message });
          else problems.push(`${file.name}: ${message}`);
        }
      }
      if (epoch !== fileOwnerEpoch.current) return;
      const media = composerDraft.current.current.media;
      if (audio && media.some(item => item.type === 'audio')) { setMouthNote('Keep one recording in each inspiration.'); return; }
      if (accepted.length && composerDraft.setMedia([...media, ...accepted])) await composerDraft.flush();
      setMouthNote(problems.join(' '));
    } catch (reason) {
      if (epoch === fileOwnerEpoch.current) setMouthNote(reason instanceof Error ? reason.message : 'Could not keep this draft on your device.');
    } finally {
      if (epoch === fileOwnerEpoch.current) { checkingFilesCount.current -= 1; setCheckingFiles(checkingFilesCount.current > 0); }
    }
  };
  onRecorded.current = async file => {
    const hasRecording = composerDraft.current.current.media.some(item => item.type === 'audio');
    if (!file.size || file.size > 25 * 1024 * 1024 || !file.type.startsWith('audio/')) {
      setMouthNote(hasRecording ? 'Could not keep this recording. Your previous clip is unchanged.' : 'Could not keep this recording. Please try again.'); return;
    }
    if (!hasRecording) return addInspirationFiles([file], true);
    composerDraft.setRecordingCandidate({ id: crypto.randomUUID(), type: 'audio', name: file.name, blob: file });
    try { await composerDraft.flush(); setMouthNote(''); }
    catch (reason) { setMouthNote(reason instanceof Error ? reason.message : 'Could not keep this draft on your device.'); }
  };

  const onMouthKey = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      /* The world's keyboard lives on `window` and claims the arrows, Escape
         and preventDefault with them. A field's keys are the field's: this
         stops the native event before it ever reaches that listener, so the
         caret moves, and Escape closes the mouth rather than a reading. */
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        // Closing the composer keeps the owned draft, including a newer
        // short thought written while an earlier save is being reconciled.
        saveAsDraft();
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
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      void keepIt();
    },
    [saveAsDraft, keepIt],
  );

  /* The field is exactly as tall as what is in it. It hangs off the seam and
     grows UPWARD, so the words stay the same distance above the ground the
     orb will drop into however many lines they wrap to.

     EXCEPT ON THE PAGE, WHERE THE PAGE OWNS THE HEIGHT — and this is not a
     preference, it is the reason the old sheet kept coming out the size of the
     text inside it. An inline `style.height` outranks every stylesheet in the
     document, cascade layers included, so the stated depth was being
     overwritten on each keystroke by whatever the words happened to measure.
     Releasing the inline value hands the height back to the CSS: the well
     stretches to the viewport the moment the note goes long, rather than
     growing line by line until it hits a ceiling. */
  useLayoutEffect(() => {
    const el = mouthFieldRef.current;
    if (!el) return;
    if (mouthLong) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, mouthOpen, mouthLong]);

  useEffect(() => {
    if (!mouthOpen) return;
    const el = mouthFieldRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [mouthOpen]);

  /* CROSSING THE BOUNDARY MUST NOT DROP THE PEN. The page face is a portal
     (`withMouthLayer`) and the quick line is not, so the keystroke that
     carries the words across the long-note line REMOUNTS the field — and a
     remount blurs it, which sent the very next key to the world instead of
     the sentence (found live: Escape after shrinking a draft closed
     nothing). The mouth-open effect above cannot catch it because the mouth
     never closed. This one runs on the flip itself, and only when the field
     actually lost focus, so it never fights the effect above: reopening
     focuses to the end there, crossing the line refocuses to the caret the
     last keystroke recorded here. */
  useEffect(() => {
    if (!mouthOpen) return;
    const el = mouthFieldRef.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    const at = Math.min(mouthCaretRef.current, el.value.length);
    el.setSelectionRange(at, at);
  }, [mouthPage, mouthOpen]);

  const panelBall = panelId
    ? ballsRef.current?.byId.get(panelId) ?? groupBallsRef.current.get(panelId)
      ?? (detachedInspiration?.ball.id === panelId ? detachedInspiration.ball : null)
    : null;
  /** A room orb's panel: whisper attribution, cited-by, and — for another
      member's save — no reflect action at all. */
  const panelIsGroup = panelBall !== null && panelBall.col !== undefined;
  const panelCanReflect = !panelIsGroup || panelBall?.own === true;
  const panelHasReflection = panelCanReflect && (panel?.detail
    ? panel.detail.reflections.some((item) => !item.skipped && item.answer)
    : (panelBall?.reflections ?? 0) > 0);
  /* WHETHER ANYTHING WAS READ OUT OF THIS MEMORY. `roots` is the count of
     signals standing on it — the same number the field grades its light by —
     so the question "does deleting this cost anything a person cannot see"
     is already answered on the orb, with no extra request. Zero means the
     delete is silent; anything else opens the ask. */
  const panelPowersSignal = (panelBall?.roots ?? 0) > 0;

  /**
   * THE MEMORY BEFORE THIS ONE, AND THE ONE AFTER — from the card itself.
   *
   * Reading a second memory meant closing the first, finding another orb in a
   * field that had just re-lit, and tapping it: three gestures and a search to
   * do the most ordinary thing there is, which is read on (founder,
   * 2026-08-25: "add option to move between inspirations from the card
   * itself").
   *
   * IN THE GROUND'S OWN ORDER, which is when you kept them — oldest to newest,
   * the same order the field lays them out in and the same order the dial
   * winds through. Any other order would be a second, invisible arrangement of
   * the same things.
   *
   * ONLY WITHIN THE WALL YOU ARE STANDING ON, and only over memories that
   * exist at the moment the dial is wound to: stepping out of the ground you
   * are looking at, or into a memory that has not happened yet, is not a step,
   * it is a teleport. Null at either end — the ends of an archive are real and
   * the row simply loses that half rather than wrapping, which would make
   * "the oldest" and "the newest" impossible to feel.
   */
  /** Whether an open card answered a left/right key — written every render,
      read by the world's key listener. See the assignment below. */
  const panelArrowRef = useRef<(dir: -1 | 1) => boolean>(() => false);
  /**
   * WHICH CARET THE KEY JUST PRESSED (founder, 2026-08-27: "using keyboard to
   * move left and right should brighten the respective button as well
   * temporarily").
   *
   * The arrows do what the carets do, and until now they did it invisibly:
   * the card's contents changed and the control that means that change sat
   * there unlit, so the keyboard and the pointer were two different
   * instruments for one act. Light is the only meaning channel this world
   * has — so the key lights the caret it pressed, briefly, the same way
   * noticing a member lights the member.
   */
  const [caretLit, setCaretLit] = useState<-1 | 1 | null>(null);
  useEffect(() => {
    if (caretLit === null) return undefined;
    const id = window.setTimeout(() => setCaretLit(null), 420);
    return () => window.clearTimeout(id);
  }, [caretLit]);

  const panelNeighbours = useMemo<{ prev: string | null; next: string | null }>(() => {
    if (!panelId || panelIsGroup) return { prev: null, next: null };
    const here = (inspirations ?? []).filter((c) => c.capturedMs <= TRef.current);
    if (here.length < 2) return { prev: null, next: null };
    const order = [...here].sort(
      (a, b) => a.capturedMs - b.capturedMs || a.id.localeCompare(b.id),
    );
    const at = order.findIndex((c) => c.id === panelId);
    if (at < 0) return { prev: null, next: null };
    return {
      prev: at > 0 ? (order[at - 1] as { id: string }).id : null,
      next: at < order.length - 1 ? (order[at + 1] as { id: string }).id : null,
    };
    /* `panelId` and the archive are the whole of it: the neighbours change
       when the archive does or when you step, and nothing else. */
  }, [panelId, panelIsGroup, inspirations]);

  /**
   * WHICHEVER ROUTE MOVED THE CARD, THE CARET THAT MEANS IT LIGHTS.
   *
   * There are three ways to page — the world's arrows, the reach's arrows,
   * and the carets themselves — and they do NOT share a function: the reach
   * calls the simulation's `select` directly, which is why the first version
   * of this (written beside the arrow keys, then inside `stepToMemory`) lit
   * nothing whenever the ground held focus. So this watches the one thing
   * all three change: which memory the card is showing. If the new one is
   * the neighbour the old one had, the caret pointing that way lights.
   *
   * Opening a memory out of the field lights nothing, correctly — a tap on
   * an orb is not a step, and nothing about the carets explains it.
   */
  const steppedFromRef = useRef<{ id: string | null; prev: string | null; next: string | null }>({
    id: null,
    prev: null,
    next: null,
  });
  useEffect(() => {
    const was = steppedFromRef.current;
    if (panelId && was.id && panelId !== was.id) {
      if (panelId === was.prev) setCaretLit(-1);
      else if (panelId === was.next) setCaretLit(1);
    }
    steppedFromRef.current = {
      id: panelId,
      prev: panelNeighbours.prev,
      next: panelNeighbours.next,
    };
  }, [panelId, panelNeighbours.prev, panelNeighbours.next]);

  /**
   * The two carets, built once and shown at the foot of BOTH faces of the card
   * — reading and editing. An end of the archive simply has no caret rather
   * than an inert one: a control that looks live and does nothing teaches that
   * the surface is broken, and the ends of what you have kept are real.
   */
  /**
   * THE ARROWS READ THE CARD WHILE A CARD IS OPEN (founder, 2026-08-27: "let
   * user be able to use keyboard to move left and right for the inspiration
   * cards"). The carets at the foot were the only way to page and they need a
   * pointer; the reach's arrows only work while the reach holds focus, which
   * a card opened by tapping an orb never has.
   *
   * Left is older and right is newer — the directions the carets point and
   * the ones the reach walks, so one meaning per axis survives. Answered
   * through a ref because the world's key listener is bound once, far above
   * where the neighbours are known.
   *
   * Returns whether the card took the key. At the ends of the archive it
   * still takes it: pressing past the oldest memory must not quietly become
   * travel to somebody else's wall.
   */
  panelArrowRef.current = (dir) => {
    if (!panelId || panelIsGroup) return false;
    const id = dir === -1 ? panelNeighbours.prev : panelNeighbours.next;
    /* lit even at the ends, where there is no neighbour to step to and
       `stepToMemory` never runs: the press happened, and a control that
       stays dark when you press it reads as one that did not hear you */
    if (!id) setCaretLit(dir);
    /* called from a key event, long after `stepToMemory` is defined below */
    if (id) stepToMemory(id);
    return true;
  };
  const panelStepCarets = panelIsGroup ? null : (
    <>
      {panelNeighbours.prev ? (
        <button
          type="button"
          aria-label="the inspiration before this one"
          title="the inspiration before this one"
          className={caretLit === -1 ? "jar-caret-lit" : undefined}
          onClick={() => stepToMemory(panelNeighbours.prev)}
        >
          <span className="jar-caret jar-caret--left" aria-hidden="true" />
        </button>
      ) : null}
      {panelNeighbours.next ? (
        <button
          type="button"
          aria-label="the inspiration after this one"
          title="the inspiration after this one"
          className={caretLit === 1 ? "jar-caret-lit" : undefined}
          onClick={() => stepToMemory(panelNeighbours.next)}
        >
          <span className="jar-caret jar-caret--right" aria-hidden="true" />
        </button>
      ) : null}
    </>
  );

  /**
   * Step to a neighbour without closing what is open — one gesture, in place.
   *
   * `editing` is declared further down and cannot be closed over here, so the
   * words are left through a ref. That is not a workaround: leaving an open
   * caret behind is a CORRECTNESS rule — an edit still open over the memory
   * you have just stepped away from would be typed into the wrong one — and a
   * rule that has to hold cannot depend on where in this file a hook happens
   * to sit.
   */
  const leaveWordsRef = useRef<() => void>(() => {});
  /** Set while a step is in flight, so the panel effect can tell paging
      through the card from opening a different memory out of the field. */
  const steppingRef = useRef(false);

  /**
   * AN OPEN EDIT IS ABANDONED BY EVERY ROUTE OUT OF ITS CARD, NOT JUST ONE.
   *
   * `stepToMemory` has always left the words behind, and while the carets were
   * the only way to swap the card mid-edit that was the whole rule. The carets
   * became `save` on 2026-08-25 (founder), which leaves the FIELD as the
   * remaining way — and tapping another orb runs none of `stepToMemory`.
   *
   * WHAT THAT COSTS IS NOT THE CARET. Both the edit field and the editing
   * footer are gated on `editing.open.id === panelId`, so the words never
   * appear over the wrong memory; that much was already safe. It is the
   * READING footer that breaks, because it is gated on `!editing.open` — so a
   * card opened while an edit is still held for some other memory renders
   * NEITHER footer: no reflect, no ways on, no delete. An edit left behind on
   * a card you can no longer see silently strips the next card of everything
   * it offers.
   *
   * A change of selection always abandons an edit, because an edit is always
   * about the memory on screen. One rule for every route, rather than a line
   * remembered per way in.
   */
  useEffect(() => {
    leaveWordsRef.current();
  }, [selectedId]);

  const stepToMemory = useCallback((id: string | null) => {
    if (!id) return;
    leaveWordsRef.current();
    setForget({ id: null, step: "rest" });
    steppingRef.current = true;
    /* AND THE GROUND FOLLOWS THE CARD (founder's recording, 2026-08-25: "the
       balls in the back should reflect which ball we're moving to").

       This set React's `selectedId` and nothing else. The loop mirrors that
       ref, so the FIELD dimmed correctly — every other orb sank — but the one
       you had stepped to was never held: `select()` is what lights an orb,
       leans the companion toward it and takes the hold, and it was never
       called. So paging through the card moved the words and left the light
       on whichever orb you had originally tapped.

       `select` sets `selectedId` itself, so this replaces the setter rather
       than joining it. It cannot toggle the selection off by accident: React
       state has not committed yet, so the ref it compares against is still
       the memory being stepped AWAY from. The bare setter stays as the
       fallback for the fixture, which has no simulation behind it. */
    const sim = simApiRef.current;
    if (sim) sim.select(id);
    else setSelectedId(id);
  }, []);

  /* ---------------- reflect ----------------
     The panel is the memory and ONE action. Reflecting happens here rather
     than somewhere else because leaving the jar to answer a question about a
     memory is how a second beat never happens: the API takes a question and
     an answer against the saved signal's own id, so the whole loop fits
     inside the card. */
  const [reflectOpen, setReflectOpen] = useState(false);
  /**
   * THE MEMORY A STANDALONE REFLECTION IS ABOUT.
   *
   * A card reflection is bound to whatever card is open, which is right for the
   * card's own verb. Reflecting from the MOUTH has no card: you kept
   * something and were asked about it, and dragging the whole reading panel
   * open to hold one question puts a memory's words, its verbs, its date and
   * its visibility on screen around a textarea (founder, 2026-08-25: "have
   * reflect workflow in modal"). Null unless the mouth asked.
   */
  const [reflectOn, setReflectOn] = useState<{ id: string; text: string; attachments: InspirationDetail['attachments'] } | null>(null);

  useEffect(() => {
    setReflectOpen(false);
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
    (
      id: string,
      value: "true" | "partly" | "not_true",
      targetId?: string,
      contested?: boolean,
      targetRevision?: string,
    ) => {
      setVerdicts((prev) => new Map(prev).set(id, value));
      /* the receipt: what this answer taught the loop, said where the act
         happened, worded only as strongly as its enforcing test allows —
         goals/the-legible-loop.md Phase 2 */
      const receipt = targetId
        ? say(RECEIPTS.verdictGroup.messageKey)
        : value === "not_true"
          ? say(RECEIPTS.verdictNo.messageKey)
          : say(RECEIPTS.verdictKept.messageKey);
      if (offlineRef.current) return;
      createFeedback({ targetType: "signal", targetId: targetId ?? id, value, ...(targetRevision ? { targetRevision } : {}) })
        .then(() => {
          if (!readingMountedRef.current) return;
          setVerdictReceipt({ id, text: receipt });
          window.setTimeout(() => setVerdictReceipt((r) => (r?.id === id ? null : r)), 7000);
          /* AN ARBITRATION JUST HAPPENED. A verdict on a contested ground
             resolves its pair on the server (lib/contested-pairs.ts), and
             the pair has TWO sides — only the server knows the other one,
             so the settled light is fetched, not guessed. `partly` resolves
             nothing and the refetch honestly brings the waver back. */
          if (!contested) return;
          loadPersonalReading()
            .then((tom) => absorbBoard(tom))
            .catch(() => undefined);
        })
        .catch((error) => {
        /* it did not land, and the row should not claim it did */
        setVerdicts((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        if ((error as { code?: string })?.code === 'feedback_target_changed') verifyReadingRef.current(false);
      });
    },
    [],
  );

  /** The verdict's receipt, shown briefly under the answered statement. */
  const [verdictReceipt, setVerdictReceipt] = useState<{ id: string; text: string } | null>(
    null,
  );

  /** Let a pattern of your own go. Nothing is deleted: the row, the memories
      under it and its vector all stay on the server — the vector as the
      anchor the ground refuses by. Like the poster's own set-aside, the
      sentence HOLDS ITS PLACE here, carrying the receipt and the way back;
      it sinks to the retired layer on the next arrival, not out from under
      the person mid-thought. */
  /** The letting-go undone: the refusals stop, the pattern stands back up
      wherever its evidence puts it. */
  /** Which memory has been asked about, and how far the asking has got. */
  /**
   * DELETING, AND THE FOUR THINGS THAT CAN BE TRUE OF IT.
   *
   * `failed` is separate from `asking` and the separation is the whole point.
   * They were one state for a while: the request's catch put the flow back to
   * `asking`, which was harmless while asking meant "are you sure" — and
   * became a lie the moment asking meant "a signal stands on this memory".
   * A dropped request would then explain, in confident detail, a consequence
   * that had nothing to do with what went wrong. A surface may not borrow a
   * sentence about one thing to report another.
   */
  const [forget, setForget] = useState<{
    id: string | null;
    step: "rest" | "asking" | "going" | "failed";
  }>({
    id: null,
    step: "rest",
  });
  /** THE SAME ASK BEFORE UN-PUBLISHING (founder, 2026-08-27: "similar
      warning should occur when changing what was public to private as
      well"). Armed only when the memory is public AND a signal stands on
      it — the mirror of delete's rule: a warning with nothing to warn
      about is friction wearing a safety costume. */
  const [unpublishAsk, setUnpublishAsk] = useState(false);
  const [publishAsk, setPublishAsk] = useState(false);
  useEffect(() => {
    setForget({ id: null, step: "rest" });
    setUnpublishAsk(false);
    setPublishAsk(false);
  }, [panelId]);

  /* ============================ ROOMS ============================
     WHERE YOUR PATTERNS AND OTHER PEOPLE'S MEET.

     The canon draws the line and the whole feature follows from it: what is
     on a wall is a STATEMENT — since 2026-08-24 one the room GREW from its
     members' pooled public memories (two voices or more under each), no
     longer one a member shared in. What crosses the boundary is still never
     a raw memory: the wall serves sentences and contributor names, and the
     evidence text stays home. The act that reaches a room is the mouth's
     "going to your rooms" switch, at the memory.
  */


  /**
   * THE STAR'S OTHER HALF — handing a sentence back.
   *
   * A starred line is one the person wrote; pressing its star offers the one
   * verb the lock was missing: hand it back to WAKA. Nothing is rewritten at
   * that moment — the words stand until the next reading, which may then
   * treat them like any of its own. The server answers with the row as it
   * now is, and the sky/poster re-light from state rather than from hope.
   */
  const [entrusting, setEntrusting] = useState<string | null>(null);
  const entrustLead = useCallback((entryId: string) => {
    const finish = beginReadingMutation();
    releaseTopOfMindEntry(entryId)
      .then((updated) => {
        setNotes((prev) =>
          prev
            ? prev.map((n) => (n.id === entryId ? { ...n, locked: Boolean(updated.locked) } : n))
            : prev,
        );
        setEntrusting(null);
      })
      .catch(() => setEntrusting(null)).finally(finish);
  }, []);

  /**
   * THE SAME ACT, ON THE OTHER NOUN.
   *
   * Rewriting a signal LOCKS its words against regeneration — that is what
   * `PATCH /signals/:id` does and what its own doc comment says. The world
   * gained `say it in my words` on a ground this session and did not gain the
   * way back, so a person could freeze a sentence and never unfreeze it. The
   * board entry one surface away has had both halves all along (`Hand it
   * back`), which is exactly why this was worth finding: the pattern was
   * already right next door and the new verb was written without it.
   *
   * Found by censusing every verb in the world against the noun it sits on,
   * after the founder asked whether some of the flat wall was better deleted
   * than migrated. The answer that census keeps giving is that the question is
   * never migrate-or-delete — it is whether the verb has the shape the noun
   * needs, and half a pair is the wrong shape.
   */
  const [releasingGround, setReleasingGround] = useState<string | null>(null);
  const releaseGround = useCallback((signalId: string) => {
    releaseSignal(signalId)
      .then(() => {
        setNotes((prev) =>
          prev
            ? prev.map((n) => ({
                ...n,
                citedSignals: n.citedSignals.map((c) =>
                  c.id === signalId ? { ...c, locked: false } : c,
                ),
              }))
            : prev,
        );
        setReleasingGround(null);
      })
      .catch(() => setReleasingGround(null));
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
        /* THROUGH `whyFailed`, AND THE 401 IS WHY.
           This said "That room could not be made. Try another name." to every
           failure alike, so `e2e:when-it-fails --kind 401` showed a signed-out
           person being sent to think up a different name — advice that cannot
           work, about a problem they do not have. The name IS the likely
           cause of a 409, and the fallback still says so; what was missing is
           that the server gets to disagree. */
        .catch((err: unknown) =>
          failed(whyFailed(err, say("worldRoomNotMade"))),
        );
    } else {
      /* a pasted invite link works as well as a bare code — the link is the
         thing people will actually send each other */
      const code = text.includes("/") ? text.split("/").filter(Boolean).pop() ?? text : text;
      joinGroup(code)
        .then((r) => landed(r.group))
        .catch((err: unknown) => failed(whyFailed(err, say("worldNoRoomAnswered"))));
    }
  }, [groupForm, whyFailed]);

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
  /* `membersRef` is declared up beside `viewerIdRef`, above the sim's
     effect, because the frame loop now reads it too — the room's company is
     drawn from it. The mirror is written here, where the state lives. */
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
   * A ROOM'S BOARD, ASKED TO READ ITSELF AGAIN.
   *
   * `refreshGroupTopOfMind` was the last verb on the flat surface with no way
   * in from the world. Your own wall has had `Read it again` since the board
   * existed; a room's board could only go stale and stay stale.
   *
   * It is a SEPARATE block rather than the self wall's toolbar opened up to
   * rooms. Those other verbs — hold this one up, say it in my words, not this
   * — act on a self entry's id and its `pinned`/`locked` facts; a room's
   * entries are a different row with a different shape, and letting the whole
   * strip render for a group would have offered three verbs that would fail
   * on press. One verb that works beats four that look right.
   */
  const [groupReading, setGroupReading] = useState<"rest" | "asking" | "working">("rest");
  const rereadGroupBoard = useCallback(
    (groupId: string) => {
      setGroupReading("working");
      refreshGroupTopOfMind(groupId)
        .then(() => {
          /* The reading is started, not finished — the server writes a new
             version in the background and the wall picks it up on its own
             sweep. Saying "reading" rather than "read" is the difference
             between a receipt and a lie. */
          setCharSay(say("worldRoomRereading"));
          setGroupReading("rest");
        })
        .catch((err) => {
          setCharSay(whyFailed(err, say("worldReadingNotStarted")));
          setGroupReading("rest");
        });
    },
    [whyFailed],
  );


  /* ── THE FIVE ACTS ON A PRINCIPLE ──────────────────────────────────────
     Each reloads from the server rather than patching state by hand: rank is
     decided there (declaring re-ranks, disputing can change a state), and a
     list this short is not worth a reconciliation that can disagree with it. */
  const reloadPrinciples = useCallback(async () => {
    const rows = await fetchPrinciples();
    setPrinciples(rows);
  }, []);

  /**
   * CORRECTING ONE — the only writing act left on this band.
   *
   * WHAT STOOD BESIDE IT, AND WHY IT IS GONE. Founder, 2026-09-08: "You
   * cannot declare your own values. This can only be generated. So remove
   * this option." A second path here took a draft with no id, posted it to
   * `POST /principles`, and reported which way the server routed it — what
   * qualified came back a principle, what read as a goal was kept as an
   * inspiration instead. That path was added on 2026-09-01 so that a person
   * with no values could give their word first, and it is the same hand that
   * has now withdrawn it: layer four is EARNED from what you keep, so a
   * sentence a person can type straight into it is a sentence no evidence
   * ever had to support. The route still answers on the server; nothing in
   * the product calls it, and retiring the endpoint is its own decision.
   */
  const savePrinciple = useCallback(() => {
    const draft = pDraft;
    if (!draft || pBusy) return;
    const text = draft.text.trim();
    if (text === "") return;
    setPBusy(true);
    void updatePrinciple(draft.id, text)
      .then(() => reloadPrinciples())
      .then(() => {
        setPDraft(null);
      })
      .catch((err) => setCharSay(whyFailed(err, say("worldNotSaved"))))
      .finally(() => setPBusy(false));
  }, [pDraft, pBusy, reloadPrinciples, whyFailed]);

  const disputeThisPrinciple = useCallback(
    (id: string, disputeId?: string, targetRevision?: string) => {
      if (pBusy) return;
      setPBusy(true);
      (disputeId ? undoPrincipleDispute(id, disputeId) : disputePrinciple(id, targetRevision))
        .then(() => reloadPrinciples())
        .catch((err) => {
          if ((err as { code?: string })?.code === 'feedback_target_changed') void reloadPrinciples();
          setCharSay(whyFailed(err, say("worldDisputeNotRecorded")));
        })
        .finally(() => setPBusy(false));
    },
    [pBusy, reloadPrinciples, whyFailed],
  );

  const removePrinciple = useCallback(
    (id: string) => {
      if (pBusy) return;
      setPBusy(true);
      deletePrinciple(id)
        .then(() => reloadPrinciples())
        .then(() => {
          setPGoing(null);
          setPick(null);
        })
        .catch((err) => setCharSay(whyFailed(err, say("worldPrincipleStillHere"))))
        .finally(() => setPBusy(false));
    },
    [pBusy, reloadPrinciples, whyFailed],
  );

  /* MOVED BY ONE PLACE, NOT DRAGGED. Rank IS the ordering — "states render,
     numerals never" — so the act is `above the one before it`, and the whole
     order is sent because that is what the route takes and what makes it
     stick against the next generation. */
  const movePrinciple = useCallback(
    (id: string, by: -1 | 1) => {
      if (pBusy) return;
      const order = [...principles].sort((a, b) => a.rank - b.rank).map((x) => x.id);
      const at = order.indexOf(id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= order.length) return;
      order.splice(to, 0, ...order.splice(at, 1));
      setPBusy(true);
      reorderPrinciples(order)
        .then((rows) => setPrinciples(rows))
        .catch((err) => setCharSay(whyFailed(err, say("worldOrderNotSaved"))))
        .finally(() => setPBusy(false));
    },
    [pBusy, principles, whyFailed],
  );

  /* Fetched when the sheet opens, on the wall it is about. A failure is
     quiet: no keys is a real state, and a banner over a settings sheet for a
     list nobody asked to see is noise. */
  useEffect(() => {
    if (!settingsFor || atWall.kind !== "agent" || offlineRef.current) return;
    let dead = false;
    fetchAgentKeys()
      .then((rows) => {
        if (!dead) setAgentKeys(rows);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [settingsFor, atWall]);

  /* CLOSING THE SHEET FORGETS THE SECRET. It is shown once by the server's
     design; holding it in state after the surface that shows it has gone is
     keeping a credential around for no one to read. */
  useEffect(() => {
    if (settingsFor) return;
    setMinted(null);
    setRevoking(null);
  }, [settingsFor]);

  const issueKey = useCallback(
    (profileId: string) => {
      if (keysBusy) return;
      setKeysBusy(true);
      createAgentKey(profileId)
        .then((key) => {
          setMinted(key);
          return fetchAgentKeys().then((rows) => setAgentKeys(rows));
        })
        .catch((err) => setCharSay(whyFailed(err, say("worldKeyNotIssued"))))
        .finally(() => setKeysBusy(false));
    },
    [keysBusy, whyFailed],
  );

  const revokeKey = useCallback(
    (keyId: string) => {
      if (keysBusy) return;
      setKeysBusy(true);
      revokeAgentKey(keyId)
        .then(() => {
          setRevoking(null);
          return fetchAgentKeys().then((rows) => setAgentKeys(rows));
        })
        .catch((err) => setCharSay(whyFailed(err, say("worldKeyStillLive"))))
        .finally(() => setKeysBusy(false));
    },
    [keysBusy, whyFailed],
  );

  /**
   * The account drop, top right — the mirror of the space settings top left.
   * They are mutually exclusive: opening one closes the other, because two
   * panels hanging off the same bar is a menu bar, which this world does not
   * have.
   */
  const [accountOpen, setAccountOpen] = useState(false);
  /* the reading: fetched once on first open, held for the session — the
     rules do not change under a person mid-visit */
  const [readingOpen, setReadingOpen] = useState(false);
  const [theReading, setTheReading] = useState<ApiReading | null>(null);
  /* the antechamber: fetched on every open — refusals accrue while the
     world stands, and a stale dim place would claim the ground refused
     less than it has */
  const [antechamberOpen, setAntechamberOpen] = useState(false);
  const [antechamber, setAntechamber] = useState<ApiAntechamberRow[] | null>(null);
  /* the gardener's asks: fetched on every open — proposals accrue while the
     panel is closed, and an ask answered stays answered */
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<ApiSignalDuplicate[] | null>(null);
  const [resolvedDuplicates, setResolvedDuplicates] = useState<ReadonlySet<string>>(new Set());
  const resolveDuplicate = useCallback(
    (id: string, act: "merge" | "keep_apart") => {
      if (offlineRef.current) return;
      /* answer at once; the row only comes back if the server refused */
      setResolvedDuplicates((prev) => new Set(prev).add(id));
      resolveSignalDuplicate(id, act).catch(() => {
        setResolvedDuplicates((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    },
    [],
  );
  /** Anchors put back from the antechamber this session, so its rows answer
      in the same beat rather than waiting for a refetch. */
  const [restoredAnchors, setRestoredAnchors] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const restoreFromAntechamber = useCallback((anchorSignalId: string) => {
    if (offlineRef.current) return;
    restoreSignal(anchorSignalId)
      .then(() => {
        setRestoredAnchors((prev) => new Set(prev).add(anchorSignalId));
      })
      .catch(() => {
        /* it did not come back; the row keeps offering */
      });
  }, []);
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
   * THE ROOM SO FAR. Fetched with the same trigger as the member list —
   * standing on the wall — because they answer the same question at two
   * depths: who is here, and how the room came to hold them. Kept per group
   * and refetched on re-arrival, since a timeline that never moves is a
   * timeline nobody trusts.
   */
  const [groupTimelines, setGroupTimelines] = useState<Map<string, ApiGroupTimeline>>(
    () => new Map(),
  );
  useEffect(() => {
    if (atWall.kind !== "group") return;
    let dead = false;
    const wallGroupId = atWall.id;
    fetchGroupTimeline(wallGroupId)
      .then((timeline) => {
        if (dead) return;
        /* the mirror the dial reads: it is derived hundreds of lines above
           this declaration and cannot reach forward to the state */
        groupTimelineRef.current.set(wallGroupId, timeline);
        setGroupPastTick((n) => n + 1);
        setGroupTimelines((prev) => new Map(prev).set(wallGroupId, timeline));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [atWall]);

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
  const [proposalRead, setProposalRead] = useState<{ groupId: string; phase: "loading" | "ready" | "failed" } | null>(null);
  const [proposalReceipt, setProposalReceipt] = useState<{ groupId: string; text: string } | null>(null);
  const [proposalTrouble, setProposalTrouble] = useState<{ groupId: string; text: string } | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [acceptedVersion, setAcceptedVersion] = useState<{
    groupId: string; previousVersion: number | null; acceptedAt: number;
  } | null>(null);
  const proposalReadSequence = useRef(0);
  const loadOpenProposals = useCallback((groupId: string, silent = false) => {
    const sequence = ++proposalReadSequence.current;
    if (!silent) setProposalRead({ groupId, phase: "loading" });
    fetchGroupProposals(groupId)
      .then((rows) => {
        if (sequence !== proposalReadSequence.current) return;
        setOpenProposals((prev) => new Map(prev).set(groupId, rows.filter((row) => row.status === "open")));
        setProposalRead({ groupId, phase: "ready" });
      })
      .catch(() => {
        if (!silent && sequence === proposalReadSequence.current) setProposalRead({ groupId, phase: "failed" });
      });
  }, []);
  const placeProposal = useCallback((groupId: string, proposal: ApiGroupProposal) => {
    setOpenProposals((prev) => {
      const next = (prev.get(groupId) ?? []).filter((row) => row.id !== proposal.id);
      if (proposal.status === "open") next.unshift(proposal);
      return new Map(prev).set(groupId, next);
    });
  }, []);
  const watchAcceptedVersion = useCallback((groupId: string) => {
    const cachedVersion = groupCacheRef.current.get(groupId)?.data?.top?.topOfMind?.version;
    const timelineVersion = groupTimelines.get(groupId)?.versions[0]?.version;
    groupCacheRef.current.delete(groupId);
    setAcceptedVersion({ groupId, previousVersion: cachedVersion ?? timelineVersion ?? null, acceptedAt: Date.now() });
    setProposalReceipt({ groupId, text: say("worldRoomProposalAccepted") });
  }, [groupTimelines, locale]);
  useEffect(() => {
    if (atWall.kind !== "group") return;
    loadOpenProposals(atWall.id);
  }, [atWall, groupPanel, loadOpenProposals]);

  const sendProposal = useCallback((groupId: string) => {
    if (!propose || propose.busy) return;
    const body = propose.text.trim();
    if (body === "") return;
    setProposalTrouble(null);
    setPropose({ ...propose, busy: true });
    createGroupProposal(groupId, { kind: "add_entry", body })
      .then((proposal) => {
        placeProposal(groupId, proposal);
        setProposalRead({ groupId, phase: "ready" });
        if (proposal.status === "accepted") watchAcceptedVersion(groupId);
        else setProposalReceipt({ groupId, text: say("worldRoomProposalWaiting") });
        setPropose(null);
      })
      .catch((err: unknown) => {
        setProposalTrouble({ groupId, text: whyFailed(err, say("worldRoomProposalActionFailed")) });
        setPropose((current) => current ? { ...current, busy: false } : current);
      });
  }, [propose, placeProposal, watchAcceptedVersion, whyFailed, locale]);

  const answerProposal = useCallback(async (groupId: string, id: string, yes: boolean) => {
    if (pendingProposalId === id) return;
    setPendingProposalId(id);
    setProposalTrouble(null);
    try {
      let proposal: ApiGroupProposal;
      let accepted = false;
      if (yes) {
        const result = await affirmGroupProposal(groupId, id);
        proposal = result.proposal;
        accepted = result.accepted;
      } else proposal = await declineGroupProposal(groupId, id);
      placeProposal(groupId, proposal);
      if (accepted) watchAcceptedVersion(groupId);
      else setProposalReceipt({ groupId, text: say("worldRoomAnswerSaved") });
    } catch (err) {
      setProposalTrouble({ groupId, text: whyFailed(err, say("worldRoomProposalActionFailed")) });
    } finally {
      setPendingProposalId(null);
    }
  }, [pendingProposalId, placeProposal, watchAcceptedVersion, whyFailed, locale]);

  useEffect(() => {
    if (!acceptedVersion) return;
    let disposed = false;
    let timer: number | undefined;
    let checks = 0;
    const check = async () => {
      checks += 1;
      try {
        const top = await fetchGroupTopOfMind(acceptedVersion.groupId);
        if (disposed) return;
        const version = top.topOfMind;
        const arrived = version && (acceptedVersion.previousVersion !== null
          ? version.version > acceptedVersion.previousVersion
          : Date.parse(version.createdAt) >= acceptedVersion.acceptedAt);
        if (arrived) {
          groupCacheRef.current.delete(acceptedVersion.groupId);
          const loaded = await loadGroupRef.current(acceptedVersion.groupId, true);
          if (disposed) return;
          if (loaded) {
            applyChromeRef.current(TRef.current);
            fetchGroupTimeline(acceptedVersion.groupId).then((timeline) => {
              groupTimelineRef.current.set(acceptedVersion.groupId, timeline);
              setGroupPastTick((value) => value + 1);
              setGroupTimelines((prev) => new Map(prev).set(acceptedVersion.groupId, timeline));
            }).catch(() => undefined);
            setProposalReceipt({ groupId: acceptedVersion.groupId, text: say("worldRoomVersionArrived") });
            setAcceptedVersion(null);
            return;
          }
        }
      } catch { /* the accepted proposal remains; another read can recover */ }
      if (disposed) return;
      if (checks < 24) timer = window.setTimeout(() => void check(), 5_000);
      else {
        setProposalReceipt({ groupId: acceptedVersion.groupId, text: say("worldRoomVersionDelayed") });
        setAcceptedVersion(null);
      }
    };
    timer = window.setTimeout(() => void check(), 2_000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [acceptedVersion, locale]);

  /* While the room's question is open on screen, other members' answers can
     arrive without this viewer moving. Refresh the answers quietly and bring
     a newly written version into the same wall; the panel does not flash back
     through loading on every check. */
  useEffect(() => {
    if (!groupPanel || atWall.kind !== "group" || atWall.id !== groupPanel || selectedGroupStop) return;
    let disposed = false;
    let timer: number | undefined;
    const refresh = async () => {
      loadOpenProposals(groupPanel, true);
      try {
        const top = await fetchGroupTopOfMind(groupPanel);
        if (disposed) return;
        const cachedTop = groupCacheRef.current.get(groupPanel)?.data?.top ?? null;
        const knownVersion = cachedTop?.topOfMind?.version
          ?? groupTimelineRef.current.get(groupPanel)?.versions[0]?.version ?? null;
        if (groupReadingChanged(cachedTop, top)) {
          groupCacheRef.current.delete(groupPanel);
          if (groupReadingRestricts(cachedTop, top)) clearGroupDisplay(groupPanel);
          const loaded = await loadGroupRef.current(groupPanel, true);
          if (disposed) return;
          if (loaded) {
            applyChromeRef.current(TRef.current);
            fetchGroupTimeline(groupPanel).then((timeline) => {
              groupTimelineRef.current.set(groupPanel, timeline);
              setGroupPastTick((value) => value + 1);
              setGroupTimelines((prev) => new Map(prev).set(groupPanel, timeline));
            }).catch(() => undefined);
            if (knownVersion !== null && top.topOfMind && top.topOfMind.version > knownVersion) {
              setProposalReceipt({ groupId: groupPanel, text: say("worldRoomVersionArrived") });
            }
          }
        }
      } catch { /* last known reading stays in place */ }
      if (!disposed) timer = window.setTimeout(() => void refresh(), 10_000);
    };
    timer = window.setTimeout(() => void refresh(), 10_000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [groupPanel, atWall, selectedGroupStop?.at, loadOpenProposals, locale, clearGroupDisplay]);

  /** Leaving is destructive and irreversible, so it asks once, in words. */
  const [leaving, setLeaving] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  /**
   * WHAT THE ROOM'S PANEL SAYS WHEN THE SERVER REFUSES.
   *
   * Found by `e2e:when-it-fails`, which presses each act against a 500 on the
   * one route it rests on and asks whether anything on screen said so. Three
   * of this panel's four verbs said nothing at all:
   *
   *   rename   SILENT   — the screen was byte-identical before and after.
   *   leave    MURMURS  — the confirm collapsed back to `leave this room`,
   *                       which is exactly what pressing `stay` does.
   *   close    MURMURS  — the same, back to `close this room`.
   *
   * A collapsing confirm is worse than silence: it is the shape of a
   * successful cancel. The person pressed the yes, watched the panel agree,
   * and the room is still there — with nothing anywhere to say which of those
   * two things happened.
   *
   * The cure is the one the memory panel already proved: prose beside the
   * verb, saying what is still true. Keyed by verb so it lands where the
   * press did — an error at the top of a panel with four destructive words in
   * it does not tell you which one refused.
   */
  const [groupTrouble, setGroupTrouble] = useState<GroupTrouble | null>(null);
  const leaveThisGroup = useCallback(
    (groupId: string) => {
      setGroupTrouble(null);
      leaveGroup(groupId)
        .then(() => {
          setGroups((prev) => prev.filter((g) => g.id !== groupId));
          setGroupPanel(null);
          setLeaving(null);
          simApiRef.current?.travel(-1);
        })
        .catch((err: unknown) => {
          /* DISARM AND SAY WHY, IN THAT ORDER. Leaving the confirm armed would
             be the friendlier-looking choice and the wrong one: the armed word
             is `leave — your statements come down`, and a person who reads the
             failure and presses it again should be re-arming deliberately
             rather than finding their finger already on the yes. */
          setLeaving(null);
          setGroupTrouble({ verb: "leave", text: whyFailed(err, say("worldStillInRoomYou")) });
        });
    },
    [whyFailed],
  );

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
  const renameThisGroup = useCallback(
    (groupId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setGroupTrouble(null);
      setRenaming((cur) => (cur ? { ...cur, busy: true } : cur));
      renameGroup(groupId, trimmed)
        .then((updated) => {
          setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...updated } : g)));
          setRenaming(null);
        })
        .catch((err: unknown) => {
          /* THE FORM STAYS OPEN AND KEEPS THE TYPED WORDS. This one measured
             as SILENT — not "quiet", byte-identical — because clearing `busy`
             is the whole of what used to happen and `busy` is invisible on a
             request that fails in under a second. The words are still in the
             box, so the recovery is one press; what was missing was any way to
             know a press was needed. */
          setRenaming((cur) => (cur ? { ...cur, busy: false } : cur));
          setGroupTrouble({ verb: "rename", text: whyFailed(err, say("worldNameDidNotStick")) });
        });
    },
    [whyFailed],
  );

  const closeThisGroup = useCallback(
    (groupId: string) => {
      setGroupTrouble(null);
      deleteGroup(groupId)
        .then(() => {
          setGroups((prev) => prev.filter((g) => g.id !== groupId));
          setClosing(null);
          setSettingsFor(null);
          /* the column is gone, so stop standing in it */
          simApiRef.current?.travel(-1);
        })
        .catch((err: unknown) => {
          setClosing(null);
          setGroupTrouble({ verb: "close", text: whyFailed(err, say("worldRoomStillOpen")) });
        });
    },
    [whyFailed],
  );

  const removeMember = useCallback(
    (groupId: string, profileId: string) => {
      setGroupTrouble(null);
      removeGroupMember(groupId, profileId)
        .then(async () => {
          const fresh = await fetchGroupMembers(groupId).catch(() => null);
          if (fresh) {
            membersRef.current.set(groupId, fresh);
            setMembers(new Map(membersRef.current));
          }
          setRemoving(null);
        })
        .catch((err: unknown) => {
          /* NOT WALKED by `e2e:when-it-fails` — a second member is a second
             account and an invite round trip, which the walk does not do. It
             is fixed here anyway because it is the same handler shape as the
             three that WERE measured, written by the same hand on the same
             day, and leaving it silent on the strength of not having been
             looked at is how the other three got this way. */
          setRemoving(null);
          setGroupTrouble({ verb: "remove", text: whyFailed(err, say("worldStillInRoomThey")) });
        });
    },
    [whyFailed],
  );

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
  /**
   * WHY GIVING AN AGENT A WALL DID NOT HAPPEN.
   *
   * `e2e:when-it-fails --only make-agent` read SILENT: the catch cleared
   * `agentName`, which is what CLOSES the form, so a refusal and pressing
   * `not now` were the same gesture — the dialog folded, no wall appeared,
   * and nothing anywhere said which of those two things had happened. The
   * same shape as the room's confirms, in the other half of the same dialog.
   *
   * Its sibling one row up — `submitGroup`, reached by choosing `a room`
   * instead of `an agent` — has carried an `error` on its form state all
   * along. This is that, kept as its own value rather than folded into
   * `agentName`, because `agentName` is also the form's OPEN/CLOSED flag and
   * an error must outlive neither more nor less than the form does.
   */
  const [agentTrouble, setAgentTrouble] = useState<string | null>(null);
  const makeAgent = useCallback(() => {
    const name = (agentName ?? "").trim();
    if (name === "") return;
    /* main's endpoint mints an AGENT profile by definition — only a
       human-bound session may call it and there is nothing else to create —
       so the kind is no longer passed, and the server caps how many an
       account may hold */
    setAgentTrouble(null);
    createProfile(name)
      .then((p) => {
        /* the roster gains the wall; the empty bundle IS a newborn's memory,
           so it counts as loaded rather than waiting on a fetch */
        setAgentRoster((prev) => [
          ...(prev ?? []),
          { id: p.id, name: p.name, createdAt: p.createdAt ?? "" },
        ]);
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
      .catch((err: unknown) => {
        /* THE FORM STAYS OPEN AND KEEPS THE NAME. Clearing `agentName` was
           the whole of the old handler, and clearing it is what shuts the
           dialog — so the one recovery available (press it again) required
           first re-opening a form that had closed for no stated reason. */
        setAgentTrouble(whyFailed(err, say("worldAgentNoWall")));
      });
  }, [agentName, whyFailed]);

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
      }, undefined, { profile: atWallRef.current.kind === 'agent' ? atWallRef.current.id : storageScope?.profileId });
      await uploadToPresignedUrl(pre.uploadUrl, file, pre.headers);
      await finalizeAttachment({
        type: file.type.startsWith("image/") ? "image" : "file",
        inspirationId,
        key: pre.key,
        name: file.name,
        contentType: file.type || undefined,
      });
      /* the detail is re-read so the OPEN memory shows its new attachment;
         nothing on the field waits for it any more — an orb is a disc */
      detailsRef.current.delete(inspirationId);
      void loadDetailRef.current(inspirationId);
    } catch {
      /* the memory is already kept; only the picture failed to land */
    } finally {
      setAttaching(false);
    }
  }, []);

  /** Search reads the whole archive; opening a result does not depend on the
      bounded field already containing its orb. Queries stay out of the URL. */
  const [seek, setSeek] = useState<string | null>(null);
  /** read by the loop's key handler, which is built once */
  const openSeekRef = useRef<() => void>(() => undefined);
  openSeekRef.current = () => setSeek((s) => (s === null ? "" : s));
  const foundRef = useRef<ReadonlySet<string> | null>(null);
  /**
   * THE MEMORIES UNDER THE PATTERN YOU ARE READING — lit where they live.
   *
   * Reading one of your own patterns used to set its memories orbiting the
   * sentence, which gave every one of them a second place to be while the
   * field below held the first. The founder disliked it on sight and the
   * reason is the world's own argument: a memory has a location and keeps
   * it. So the grounds are published here instead, into the very channel a
   * search uses — "this one, and everything else sinks" — and the field
   * answers by lighting exactly those and dimming the rest.
   *
   * A search still outranks it: a query is a thing you asked for in words,
   * and reading a pattern is not. Only your OWN wall lights, because only
   * your own memories are in the ground to light (a room's evidence names
   * people, and those keep their ring — see `solveSats`).
   */
  /* AND WHAT IT FOLLOWS IS THE ROOM THAT IS OPEN. It used to follow
     `focusCandId`, which only the sky's `focusOn` ever set — so when the
     candidate layer went dormant this light went out with it, silently, and
     stayed out. The provenance room is the same act by the same person
     ("what is this built from"), it carries the very rows this needs, and it
     is the one a person can actually reach. */
  const readingLit = useMemo<ReadonlySet<string> | null>(() => {
    if (!prov || atWall.kind !== "self") return null;
    if (prov.rows.length === 0) return null;
    return new Set(prov.rows.map((e) => e.inspirationId));
  }, [prov, atWall]);
  const readingLitRef = useRef<ReadonlySet<string> | null>(null);
  readingLitRef.current = readingLit;
  /* the loop is parked when nothing moves; a new set is a change to draw */
  useEffect(() => {
    simApiRef.current?.wake();
  }, [readingLit]);
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

  /* ═══ EVERY SHEET CLOSES THE SAME TWO WAYS ═══
     The founder ruled it about the make-another-place sheet ("if click
     outside modal, close it") and about the dial's rail the same day; it is
     not a fact about those two. The five sheets below closed only by finding
     their own small word, and the way out of the last sheet is never where
     the way out of this one is. See `lib/dismiss.ts` for why pointerdown and
     why Escape stops propagating. */
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const closeSettings = useCallback(() => setSettingsFor(null), []);
  const closeJoin = useCallback(() => setPendingJoin(null), []);
  const closeProv = useCallback(() => setProv(null), []);
  const closeAnte = useCallback(() => setAntechamberOpen(false), []);
  useDismissAway(accountOpen, closeAccount, KEEP_ACCOUNT);
  useDismissAway(settingsFor !== null, closeSettings, KEEP_SHEET);
  useDismissAway(pendingJoin !== null, closeJoin, KEEP_SHEET);
  useDismissAway(prov !== null, closeProv, KEEP_PROV);
  useDismissAway(antechamberOpen, closeAnte, KEEP_ANTE);
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
    reloadReading: async () => { absorbBoard(await loadPersonalReading()); },
    beginReadingMutation,
    onInspirationSaved: (made) => { sourceListMutationRef.current += 1; if (made.processing) sourceProcessing.track(made.id, made.processing); },
    onEntrySaved: () => {
      readingMutationRef.current += 1;
      readingNeedsLatestRef.current = true;
      void loadPersonalReading().then((tom) => absorbBoard(tom)).catch(() => setReadingCheckFailed(true));
    },
  });
  // Revalidate the version already on screen. This can withdraw stale support
  // without replacing it with a newly generated sentence while someone reads.
  useEffect(() => {
    if (offlineRef.current || atWall.kind !== "self" || !topOfMind?.id || editing.open || readingRefresh.busy) return;
    let active = true;
    let controller: AbortController | null = null;
    let timeout: number | null = null;
    let inFlight = false;
    const verify = async (manual = false) => {
      const shown = latestReadingRef.current;
      if (!active || !shown || inFlight || readingActionsPendingRef.current || document.hidden || isEditableTarget(document.activeElement)) return;
      const mutation = readingMutationRef.current;
      const needsLatest = readingNeedsLatestRef.current;
      inFlight = true;
      if (manual) setReadingChecking(true);
      controller = new AbortController();
      const signal = controller.signal;
      let timedOut = false;
      const deadline = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          timedOut = true; controller?.abort(); reject(new Error("Reading check timed out"));
        }, 30_000);
      });
      try {
        const checked = await Promise.race([needsLatest ? loadPersonalReading(signal)
          : loadTopOfMindVersion(shown.id, storageScope?.profileId, signal), deadline]);
        if (!active || mutation !== readingMutationRef.current || (!needsLatest && latestReadingRef.current?.id !== shown.id)) return;
        if (!needsLatest && checked?.id !== shown.id) throw new Error("Reading check returned a different version");
        absorbBoard(checked);
      } catch {
        if (active && (timedOut || !signal.aborted)) setReadingCheckFailed(true);
      } finally {
        if (timeout !== null) window.clearTimeout(timeout);
        inFlight = false;
        if (active) setReadingChecking(false);
      }
    };
    verifyReadingRef.current = (manual = true) => { void verify(manual); };
    const onFocus = () => { void verify(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const interval = window.setInterval(onFocus, 30_000);
    return () => {
      active = false; controller?.abort();
      if (timeout !== null) window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      verifyReadingRef.current = () => {};
      setReadingChecking(false);
    };
  }, [topOfMind?.id, atWall.kind, Boolean(editing.open), readingRefresh.busy, storageScope?.profileId, absorbBoard, loadPersonalReading]);
  /* the one thing `stepToMemory` needs and cannot close over: see its note */
  leaveWordsRef.current = () => {
    if (editing.open) editing.leave();
  };

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
  /**
   * THE MEMORY'S OWN WORDS ARE THE EDITOR.
   *
   * There used to be an `edit` verb in the row at the bottom, and pressing it
   * opened a second box UNDER the memory holding a copy of the same text. So
   * the panel showed the words twice — read them up here, change them down
   * there — and the founder said what that is: "its weird that you read on
   * top and edit at the bottom. just make it editable no matter what. dont
   * have separate edit button."
   *
   * Now the paragraph IS the control. Press it anywhere and it becomes a
   * field in the same place, at the same measure, in the same face, with the
   * caret where you pressed — nothing moves, nothing is duplicated, and there
   * is no verb to find first.
   *
   * WHY NOT SIMPLY ALWAYS A FIELD. The resting paragraph lights the spans a
   * signal actually read out of this memory (`markPassages`), which is the
   * receipt behind every claim the sky makes about you. A textarea cannot
   * carry marks. So the words are lit while you are reading them and plain
   * while you are changing them, which is also the honest thing to show: what
   * you are typing into is the text, not the reading of it.
   */
  const panelEditRef = useRef<HTMLTextAreaElement | null>(null);
  /** Where the press landed, so the caret opens there rather than at the end. */
  const panelCaretRef = useRef<number | null>(null);
  /* The field is exactly as tall as its words. A fixed `rows` would either
     letterbox a long memory or leave a short one sitting in a pit, and both
     are a change of shape at the moment the press asks for none. */
  const growPanelEdit = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const beginPanelEdit = useCallback(
    (ev: ReactMouseEvent<HTMLParagraphElement>) => {
      if (!panelId || panelIsGroup || !panelCanReflect || editing.open) return;
      /* THE CARET GOES WHERE THE FINGER WENT. Without this the press lands
         you at the end of a page of text and you scroll back to the sentence
         you meant — which is the same "find your place again" cost the
         separate box had, moved rather than removed. Both spellings, because
         the standard changed names and neither browser family has both. */
      let at: number | null = null;
      const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      try {
        const pos = doc.caretPositionFromPoint?.(ev.clientX, ev.clientY);
        if (pos) at = pos.offset;
        else {
          const range = doc.caretRangeFromPoint?.(ev.clientX, ev.clientY);
          if (range) at = range.startOffset;
        }
      } catch {
        /* no caret API here: the field opens at the end, which is the old
           behaviour and never wrong, only less kind */
      }
      panelCaretRef.current = at;
      editing.begin(
        "memory",
        panelId,
        panel?.detail ? panel.detail.text : panelBall?.textPreview ?? "",
      );
    },
    [panelId, panelIsGroup, panelCanReflect, editing, panel, panelBall],
  );

  const [publishing, setPublishing] = useState(false);
  const togglePublic = useCallback(() => {
    const id = panelBall?.sigId ?? panelId;
    if (!id || publishing) return;
    const next = panelIsPublic ? "private" : "public";
    setPublishing(true);
    updateInspiration(id, { visibility: next })
      .then(() => {
        sourceListMutationRef.current += 1;
        const isPublic = next === "public";
        setInspirations((cur) =>
          (cur ?? []).map((c) => (c.id === id ? { ...c, isPublic } : c)),
        );
        /* AND THE DETAIL, WHICH IS WHAT THE WORD ACTUALLY READS.
           `panelIsPublic` takes `panel.detail.isPublic` FIRST and falls back
           to the archive — "the detail is authoritative once it lands", which
           it is, and nothing here updated it. So the request went out, the
           server changed the row, the archive was corrected, and the word did
           not move, because the stale detail kept winning (founder,
           2026-08-25: "private doesn't switch to public"). The detail lands
           the instant the card opens, so this was every press after the first
           frame — which is every press.

           Both copies, because both are read: the ref is what a re-open
           serves from, and the state is what this render is showing. */
        const cached = detailsRef.current.get(id);
        if (cached) detailsRef.current.set(id, { ...cached, isPublic });
        setPanel((cur) =>
          cur && cur.id === panelId && cur.detail
            ? { ...cur, detail: { ...cur.detail, isPublic } }
            : cur,
        );
        /* it went out to people, or it came home */
        simApiRef.current?.acknowledge(isPublic ? "shared" : "touch");
      })
      .catch((err: unknown) => {
        /* left as it was: the word is the state, so an unchanged word is an
           honest report that nothing moved — but silence about WHY is not,
           and this one is a privacy control */
        setMouthNote(whyFailed(err, say("worldVisibilityUnchanged")));
        if (showsDebug()) console.error("[waka] visibility change failed:", err);
      })
      .finally(() => setPublishing(false));
  }, [panelBall, panelId, panelIsPublic, publishing]);

  const inspirationRemovedFromView = useCallback((serverId: string, visualId = serverId) => {
    sourceListMutationRef.current += 1;
    setSelectedId(null);
    simApiRef.current?.unborn(visualId);
    bornRef.current = bornRef.current.filter(row => row.id !== visualId && row.sigId !== serverId);
    inspirationsRef.current = inspirationsRef.current?.filter(row => row.id !== visualId && row.id !== serverId) ?? null;
    setInspirations(rows => rows?.filter(row => row.id !== visualId && row.id !== serverId) ?? rows);
    detailsRef.current.delete(serverId);
    for (const [signalId, rows] of evidenceBySignalRef.current) evidenceBySignalRef.current.set(signalId, rows.filter(row => row.inspirationId !== serverId));
    setCitations(rows => new Map([...rows].map(([key, evidence]) => [key, evidence.filter(row => row.inspirationId !== serverId)])));
    setProv(current => current ? {...current, rows: current.rows.filter(row => row.inspirationId !== serverId)} : null);
    setProvFull(current => current?.id === serverId ? null : current);
    setProvenance(current => {const next = new Map(current); next.delete(serverId); return next;});
    skyReadSequence.current += 1;
    void readSkyRef.current().catch(() => undefined);
  }, []);

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
        inspirationRemovedFromView(serverId, id);
        setForget({ id: null, step: "rest" });
      })
      .catch(() => {
        /* IT IS STILL THERE, AND THE WORLD STILL SHOWS IT. Not back to the
           ask: the ask is a sentence about what a signal loses, and nothing
           about this failure is that. Its own state, its own line. */
        setForget({ id, step: "failed" });
      });
  }, [panelId, panelBall, forget.step, inspirationRemovedFromView]);

  const askToReflect = useCallback(() => {
    if (!panelId || !panelBall) return;
    /* another member's save is theirs to reflect on, not the viewer's */
    if (panelBall.col !== undefined && !panelBall.own) return;
    setReflectOpen(true);
    viewNavigationRef.current.write({ ...observedRef.current, inspirationId: panelBall.sigId ?? panelId, reflectionId: 'open' }, { observed: true });
  }, [panelId, panelBall]);

  const synchronizeReflections = useCallback((owner: string, row: ApiInspiration | null) => {
    const revision = ++sourceListMutationRef.current;
    const apply = (detail: InspirationDetail) => {
      const before = inspirationsRef.current?.find((item) => item.id === owner)?.reflectionCount ?? detailsRef.current.get(owner)?.reflectionCount ?? 0;
      detailsRef.current.set(owner, detail);
      inspirationsRef.current = inspirationsRef.current?.map((item) => item.id === owner ? { ...item, reflectionCount: detail.reflectionCount } : item) ?? null;
      setPanel((cur) => cur?.detail?.id === owner || cur?.id === owner ? { ...cur!, detail } : cur);
      setInspirations((cur) => cur?.map((item) => item.id === owner ? { ...item, reflectionCount: detail.reflectionCount } : item) ?? null);
      simApiRef.current?.reflectionChanged(owner, detail.reflectionCount - before);
    };
    if (row) apply(toInspirationDetail(row));
    else {
      detailsRef.current.delete(owner);
      setPanel((cur) => cur?.detail?.id === owner ? { ...cur, detail: null } : cur);
      void loadInspiration(owner, storageScope?.profileId).then((detail) => {
        if (readingMountedRef.current && sourceListMutationRef.current === revision) apply(detail);
      }).catch(() => undefined);
    }
  }, []);
  const reflectionSaved = useCallback((made: ApiReflection) => {
    if (made.processing) sourceProcessing.track(made.inspirationId, made.processing);
    simApiRef.current?.acknowledge("answered");
  }, []);

  const reflectionRemoved = useCallback((id: string, owner: string) => {
    sourceListMutationRef.current += 1;
    if (!offlineRef.current) sourceProcessing.track(owner);
    skyReadSequence.current += 1;
    const withoutDeletedCopy = (row: Evidence): Evidence => row.inspirationId !== owner ? row : {
      ...row, reason: null,
      ...(row.quoteReflectionId === id || !row.quoteReflectionId
        ? { quote: null, quoteSource: null, quoteReflectionId: null } : {}),
    };
    for (const [signalId, rows] of evidenceBySignalRef.current) evidenceBySignalRef.current.set(signalId, rows.map(withoutDeletedCopy));
    setCitations((rows) => new Map([...rows].map(([key, evidence]) => [key, evidence.map(withoutDeletedCopy)])));
    setProv((current) => current ? { ...current, rows: current.rows.map(withoutDeletedCopy) } : null);
    setProvFull((current) => current?.id === owner ? null : current);
    setProvenance((current) => {
      if (!current.has(owner)) return current;
      const next = new Map(current); next.set(owner, null); return next;
    });
    for (const item of ballsRef.current?.list ?? []) {
      if ((item.sigId ?? item.id) === owner) item.quote = null;
    }
    const cached = detailsRef.current.get(owner);
    if (cached) detailsRef.current.set(owner, {
      ...cached,
      reflectionCount: Math.max(0, cached.reflectionCount - 1),
      reflections: cached.reflections.filter((item) => item.id !== id),
    });
    setPanel((cur) => cur?.detail?.id === owner ? { ...cur, detail: detailsRef.current.get(owner) ?? cur.detail } : cur);
    setInspirations((cur) => cur?.map((item) => item.id === owner
      ? { ...item, reflectionCount: Math.max(0, item.reflectionCount - 1) } : item) ?? null);
    simApiRef.current?.reflectionChanged(owner, -1);
    void readSkyRef.current().catch(() => undefined);
  }, []);

  /* The passages worth marking inside the text: the words a PATTERN carried
     out of this memory, and only those. The second tier used to be the
     judge's "sparks", which the rebuild parked along with its table — so
     rather than fill the gap with something else, the panel marks less. A
     memory no pattern has quoted is shown unmarked, which is honest. */
  const panelMarks = useMemo(() => {
    const out: Array<{ text: string; tier: "source" | "spark" }> = [];
    if (panelBall?.quote) out.push({ text: panelBall.quote, tier: "source" });
    return out;
  }, [panelBall, citations]);

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

  const viewSourceReading = () => void sourceProcessing.open(async (result, current) => {
    const previous = latestReadingRef.current;
    const [fetched, verifiedPrevious] = await Promise.all([
      loadPersonalReading(),
      previous?.id ? loadTopOfMindVersion(previous.id, storageScope?.profileId).catch(() => null) : Promise.resolve(null),
    ]);
    if (!current()) return;
    const next = acceptsReadingSnapshot(latestReadingRef.current, fetched, storageScope?.profileId) ? fetched : latestReadingRef.current;
    if (result.topOfMindId && (!next || next.version < result.version || (next.version === result.version && next.id !== result.topOfMindId))) {
      throw new Error('The completed reading is not available yet');
    }
    const before = verifiedPrevious?.entries.find((entry) => entry.pinned) ?? verifiedPrevious?.entries[0];
    const after = next?.entries.find((entry) => entry.pinned) ?? next?.entries[0];
    if (!absorbBoard(next)) throw new Error('Reading changed while opening');
    setSourcePrevious(before && after && before.body !== after.body ? { body: before.body, reading: next! } : null);
    setReflectOn(null); setReflectOpen(false); setSelectedId(null);
    simApiRef.current?.goToWall(0); simApiRef.current?.toTop(); setPosterAsk(true);
  });
  const sourceNotice = !offline && !readingRefresh.busy && inspirationSave.phase === 'idle' ? <InspirationProcessingNotice
    processing={sourceProcessing} locale={locale} onView={viewSourceReading} displayedVersion={topOfMind?.version ?? 0} /> : null;

  const appliedViewKey = useRef<string | null>(null), viewRequest = useRef(0);
  const canonicalizeViewRef = useRef(false);
  const [viewSettled, setViewSettled] = useState(0);
  const latestViewKey = useRef(viewNavigation.key); latestViewKey.current = viewNavigation.key;
  if (appliedViewKey.current !== viewNavigation.key) restoringViewRef.current = true;
  useEffect(() => {
    if (phase !== 'ready' || appliedViewKey.current === viewNavigation.key) return;
    const desired = viewNavigation.view;
    if (viewNavigation.own.current === viewNavigation.href) {
      viewNavigation.own.current = null; appliedViewKey.current = viewNavigation.key; restoringViewRef.current = false; return;
    }
    const target = desired && (desired.wallId === storageScope?.profileId ? walls.find((wall) => wall.kind === 'self') : resolveViewWall(desired, walls));
    if (!target && desired?.wallId && (agentRoster === null || !groupRosterReady)) return;
    if (!target || !desired) { setNavigationProblem(true); appliedViewKey.current = viewNavigation.key; restoringViewRef.current = false; return; }
    const serial = ++viewRequest.current, key = viewNavigation.key, controller = new AbortController();
    let timer = 0, stage = 'wall', loading = false, canceled = false;
    const current = () => !canceled && !controller.signal.aborted && viewRequest.current === serial && latestViewKey.current === key;
    setNavigationProblem(false);
    linkedReflectionRef.current = null;
    setReflectOn(null); setReflectOpen(false); setSelectedId(null); setDetachedInspiration(null); setGroupPanel(null);
    setSeek(desired.find ? viewNavigation.query : null);
    setPick(desired.principleId);
    setMouthOpen(desired.compose);
    const finish = () => { if (current()) { appliedViewKey.current = key; restoringViewRef.current = false; canonicalizeViewRef.current = true; setViewSettled((value) => value + 1); } };
    const run = async () => {
      if (!current()) return;
      const sim = simApiRef.current;
      if (!sim || sim.navigationState().moving) { timer = window.setTimeout(() => void run(), 80); return; }
      const actual = sim.navigationState();
      if (actual.wall.kind !== target.kind || actual.wall.id !== target.id) { sim.goToWall(target.col); timer = window.setTimeout(() => void run(), 80); return; }
      if (stage === 'wall') {
        stage = 'section';
        sim.windTo(desired.at ?? Date.now()); parkedRef.current = desired.at; setParkedAt(desired.at); setAtNow(desired.at === null);
        applyChromeRef.current(desired.at ?? Date.now());
        if (target.kind === 'group') { setStanding(desired.memberId); sim.standIn(desired.memberId); }
      }
      if (actual.section !== desired.section) {
        if (desired.section === 'field') sim.toGround(); else if (desired.section === 'sky') sim.toSky(); else sim.toTop();
        timer = window.setTimeout(() => void run(), 80); return;
      }
      if (loading) return;
      if (!desired.inspirationId) { finish(); return; }
      loading = true;
      try {
        let detail: InspirationDetail | null = null, ball: Ball;
        if (target.kind === 'group') {
          if (!await loadGroupRef.current(target.id, true)) throw new Error('Room unavailable');
          if (!current()) return;
          const lease = groupCacheRef.current.get(target.id)?.leaseToken;
          const row = await fetchGroupInspiration(target.id, desired.inspirationId, controller.signal);
          if (!current()) return;
          if (groupCacheRef.current.get(target.id)?.leaseToken !== lease) throw new Error('Room changed');
          ball = makeGroupInspirationBall(row, target, viewerIdRef.current);
          setStanding(row.ownerProfileId === viewerIdRef.current ? null : row.ownerProfileId);
          sim.standIn(row.ownerProfileId === viewerIdRef.current ? null : row.ownerProfileId);
          if (ball.own) detail = await loadInspiration(row.id, storageScope?.profileId, controller.signal);
          else if (desired.reflectionId) throw new Error('Private reflection');
        } else {
          detail = await loadInspiration(desired.inspirationId, target.kind === 'agent' ? target.id : storageScope?.profileId, controller.signal);
          if (!current()) return;
          ball = makeBall(seedOf(detail, skyRef.current.citations, skyRef.current.signals, skyRef.current.posterSignalIds, skyRef.current.principleSignalIds));
          ball.sigId = detail.id;
        }
        if (!current()) return;
        if (desired.reflectionId && desired.reflectionId !== 'open' && !detail?.reflections.some((row) => row.id === desired.reflectionId && !row.skipped)) throw new Error('Reflection unavailable');
        if (detail) detailsRef.current.set(detail.id, detail);
        linkedReflectionRef.current = { panelId: ball.id, open: Boolean(desired.reflectionId) };
        setDetachedInspiration({ wall: spaceKey(target), ball, detail });
        if (ballsRef.current?.byId.has(ball.id)) { sim.release(); sim.select(ball.id); }
        setSelectedId(ball.id); setPanel({ id: ball.id, detail, partial: false }); setPanelOpen(true);
        timer = window.setTimeout(finish, 0);
      } catch { if (current()) { setNavigationProblem(true); finish(); } }
    };
    void run();
    return () => { canceled = true; controller.abort(); window.clearTimeout(timer); };
  }, [viewNavigation.key, phase, walls, agentRoster, groupRosterReady]);
  useEffect(() => {
    const linked = linkedReflectionRef.current;
    if (!linked || linked.panelId !== panelId) return;
    linkedReflectionRef.current = null; setReflectOpen(linked.open);
  }, [panelId, viewSettled]);

  const selectedViewBall = selectedId ? ballsRef.current?.byId.get(selectedId) ?? (detachedInspiration?.ball.id === selectedId ? detachedInspiration.ball : null) : null;
  const observedView: ViewLocation = { ...EMPTY_VIEW, wallId: atWall.kind === 'self' ? null : atWall.id,
    label: atWall.kind === 'self' ? undefined : (walls.find((wall) => wall.id === atWall.id)?.name ?? atWall.name),
    section: inSky ? 'sky' : inField ? 'field' : 'top', at: parkedAt, memberId: atWall.kind === 'group' ? standing : null,
    inspirationId: reflectOn?.id ?? (selectedViewBall?.sigId ?? selectedId),
    reflectionId: reflectOn || reflectOpen ? (requestedViewRef.current?.inspirationId === (reflectOn?.id ?? selectedViewBall?.sigId ?? selectedId) ? requestedViewRef.current?.reflectionId ?? 'open' : 'open') : null,
    find: seek !== null, compose: mouthOpen,reviewId:viewNavigation.view?.reviewId??null,reviewAnswerId:viewNavigation.view?.reviewAnswerId??null,
    principleId:atWall.kind==='self'&&inSky?pick:null,
    sharePrinciple:atWall.kind==='self'&&inSky&&(viewNavigation.view?.sharePrinciple??false),conversationId:viewNavigation.view?.conversationId??null };
  const observedHref = viewHref(observedView), observedRef = useRef(observedView); observedRef.current = observedView;
  useEffect(() => {
    if (phase !== 'ready' || restoringViewRef.current || navigationProblem) return;
    let timer = 0;
    const record = () => {
      if (restoringViewRef.current) return;
      if (simApiRef.current?.navigationState().moving) { timer = window.setTimeout(record, 80); return; }
      const nav = viewNavigationRef.current, previous = nav.view, next = observedRef.current;
      const samePlace = previous?.wallId === next.wallId && previous.section === next.section && previous.at === next.at && previous.memberId === next.memberId;
      const closing = samePlace && Boolean(previous?.inspirationId && !next.inspirationId || previous?.reflectionId && !next.reflectionId || previous?.find && !next.find || previous?.compose && !next.compose);
      const sameView = samePlace && previous.inspirationId === next.inspirationId && previous.reflectionId === next.reflectionId && previous.find === next.find && previous.compose === next.compose;
      nav.write(next, { observed: true, replace: canonicalizeViewRef.current || closing || sameView || observedHref === nav.href, query: seek ?? '' });
      canonicalizeViewRef.current = false;
    };
    timer = window.setTimeout(record, 80);
    return () => window.clearTimeout(timer);
  }, [observedHref, seek, phase, navigationProblem, viewSettled]);

  const openSearchResult = (row: { id: string }) => {
    viewNavigation.write({ ...EMPTY_VIEW, wallId: atWall.kind === 'agent' ? atWall.id : null,
      label: atWall.kind === 'agent' ? atWall.name : undefined, section: 'field', inspirationId: row.id }, { query: seek ?? '' });
  };
  const copyInspirationLink = async (reflectionId: string | null = observedView.reflectionId) => {
    try { await navigator.clipboard.writeText(window.location.origin + viewHref({ ...observedView, reflectionId, find: false })); setCharSay(say('worldLinkCopied')); }
    catch { setCharSay(say('worldLinkCopyFailed')); }
  };

  return (
    <div ref={measured.root} className="jar" aria-label="Waka">
      {/* the world's early face, until the first real frame: the same ground,
          the companion already home, one honest word. Shared with the auth
          splash so the whole way in is one unbroken place (founder,
          2026-08-27). z above every layer — chrome must not poke through a
          frame that claims nothing is ready yet. */}
      {phase !== "ready" ? (
        <div style={{ position: "absolute", inset: 0, zIndex: 60 }}>
          <LoadingHome />
        </div>
      ) : null}
      {navigationProblem ? <div className="jar-navigation-notice" role="alert" data-jar-chrome="1">
        <p>{say('worldLinkUnavailable')}</p>
        <button type="button" onClick={() => viewNavigation.write(viewNavigation.view ?? { ...EMPTY_VIEW }, { replace: true, query: viewNavigation.query })}>{say('worldRoomHistoryRetry')}</button>
        <button type="button" onClick={() => viewNavigation.write({ ...EMPTY_VIEW }, { replace: true })}>{say('worldMe')}</button>
      </div> : null}
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
            /*
             * A ROOM'S WORDS APPEAR WHEN THEY ARE KNOWN, NOT WHEN YOU ARRIVE.
             *
             * The room's half read `wokenGroups.has(w.id)`, and the only thing
             * that ever adds to that set runs on ARRIVAL. So a room's whole
             * headquarters — eyebrow, claim, forming line — could not exist
             * until the character got there, and then appeared. Founder,
             * twice: "if new content, then have it ready before i get there"
             * (2026-08-27) and "dont make the text be there and reload when
             * character goes to the room. keep it rendered and dont rerender
             * when character arrives" (2026-08-30) — the second time prefaced
             * with "i think i already asked u to fix this", and they had. The
             * first fix answered which words ANIMATE on a return; this is
             * whether the block is there at all while you walk.
             *
             * It is the same ruling already made for the two things beside it.
             * The sky's sentence stands in the wall's own column so travelling
             * up only brings it into frame; a room's company pre-exists arrival
             * for the same reason. The world never materialises because you
             * looked at it. The room's claim was the last thing still doing so.
             *
             * `c` is that wall's chrome — `wallChromeNow` for any wall you are
             * not standing on, filled from the ref the room's fetch writes, and
             * that fetch starts the moment travel toward the room begins. So
             * the words are usually there well before the character is, which
             * is exactly what was asked for. Until they are, there is nothing
             * to draw, which is honest: the room has not said anything yet.
             *
             * AND AN AGENT WAITS FOR ITS BUNDLE — #281's ruling, kept whole.
             * Memory is fetched per wall now, so an agent's wall genuinely has
             * nothing to draw until its bundle lands, and that is a different
             * question from the room's. This line carries both: self is always
             * ready, a room is ready when its words are KNOWN, an agent when
             * its memory has arrived. An earlier draft of this merge said
             * `w.kind !== "group"` and would have called every agent ready
             * before it had anything — my rewrite silently undoing theirs.
             *
             * THE GROUND IS NOT THIS. It still pours on arrival, and should:
             * a ground filling as you get there is the world answering a move
             * you made. A sentence appearing because you looked is not.
             */
            const ready =
              w.kind === "self" ||
              (w.kind === "group" ? c !== null && !failedGroups.has(w.id) : (agents ?? []).some((a) => a.agent.id === w.id));
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
                {/* THE SKY'S SENTENCE LIVES IN THE SKY (founder, 2026-08-27,
                    video: "feels like your philosophies that text appears
                    rather than it was in the sky already and we went to the
                    sky"). It was chrome — screen-positioned, mounted on
                    arrival — so the words appeared BECAUSE you looked, which
                    is the one thing this world never does: the world never
                    moves unless the user moved it, and it never materialises
                    either. It stands in the wall's own column now, at the
                    sky's own height (`--jar-sky-top`, written by the layout
                    pass beside the volume's), and travelling up simply
                    brings it into frame. One per wall — every wall has its
                    own sky. */}
                {ready ? (
                  <div
                    className={
                      w.kind === "self" || w.kind === "group"
                        ? "jar-values-room jar-values-room--live"
                        : "jar-values-room"
                    }
                    data-jar-chrome="1"
                  >
                    {/* THE SKY KEEPS ITS PROMISE. The forming copy says "keep
                        capturing, and this sky will start to fill" — so once
                        something HAS been adopted, showing the promise again
                        would be the sky lying about itself (founder,
                        2026-08-31: "shouldn't this show up in the
                        philosophies & values page?"). Held values speak in
                        the sky's own voice, rank as order, no numerals, no
                        heading — and the sky is the layer's ONE home now:
                        the verbs live here too (founder, 2026-09-01: retire
                        "how you choose"; the wall line predated a sky that
                        could hold anything). Your own wall's sky only:
                        another wall's keeps the forming words until sharing
                        values is designed on purpose. */}
                    {w.kind !== "agent" ? <PrincipleRead
                      key={`${auth?.profile?.id}:${spaceKey(w)}`}
                      groupId={w.kind === "group" ? w.id : undefined}
                      active={here && !offlineRef.current}
                      locale={locale}
                      refreshKey={w.kind === "group" ? groupReadTick : undefined}
                      onRead={w.kind === "self" ? acceptPrinciples : (rows) => setGroupPrincipleCounts((counts) =>
                        counts[w.id] === rows.length ? counts : { ...counts, [w.id]: rows.length })}
                    /> : null}
                    {w.kind==='self'&&pick&&principlesRead&&!principles.some(row=>row.id===pick)?<p role="status" className="jar-values-sub">
                      {say('worldPrincipleUnavailable')} <button type="button" onClick={()=>{setPick(null);viewNavigation.write({...EMPTY_VIEW,section:'sky'},{replace:true});}}>{say('worldPrinciplesBack')}</button>
                    </p>:null}
                    {w.kind === "self" && principles.length > 0 ? (
                      <>
                        {/* THE LAYER, NOT THE NAME — the same ruling the board
                            follows ("this should always say TOP OF MIND at the
                            top no matter what room"): standing in the sky,
                            nothing else says what kind of sentences these are,
                            because the signpost that names the place hides
                            while you are in it. */}
                        <p className="jar-values-eyebrow jar-label">
                          {say("worldPhilosophiesValues")}
                        </p>
                    {/* Ranked, and the rank is the order — never a number
                        beside a statement. */}
                    <ul className="jar-principles-list jar-principles-list--personal" role="list" aria-label={say("worldPhilosophiesValues")} data-jar-interactive="1">
                    {[...principles]
                      .sort((a, b) => a.rank - b.rank)
                      .map((pr, i, ranked) => (
                        <li
                          key={pr.id}
                          data-principle-id={pr.id}
                          data-expanded={pick === pr.id || pDraft?.id === pr.id || pRoots === pr.id}
                          className={
                            /* RANK AS PRESENCE, NEVER AS A NUMBER. The top
                               value is the one that wins when two conflict,
                               and it stands a step larger — the same channel
                               (size, light) the world uses everywhere it
                               means "this leads". */
                            i === 0
                              ? "jar-values-held jar-values-held--first"
                              : "jar-values-held"
                          }
                        >
                          {/* CORRECTING IT IN PLACE, the same shape the
                              card and the pattern already use: the
                              sentence becomes a field where it stands, so
                              the words do not move when the caret
                              arrives. */}
                          {pDraft && pDraft.id === pr.id ? (
                            <>
                              <textarea
                                className="jar-ground-edit"
                                aria-label={say("worldPrincipleInYourWords")}
                                value={pDraft.text}
                                rows={2}
                                autoFocus
                                onChange={(e) =>
                                  setPDraft({ id: pr.id, text: e.target.value })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setPDraft(null);
                                  }
                                }}
                              />
                              <span className="jar-ask">
                                <button type="button" disabled={pBusy} onClick={savePrinciple}>
                                  {pBusy ? say("worldSaving") : say("worldSave")}
                                </button>
                                <span aria-hidden="true"> · </span>
                                <button type="button" onClick={() => setPDraft(null)}>
                                  {say("worldLeaveIt")}
                                </button>
                              </span>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={
                                pr.state === "contested"
                                  ? "jar-values-value jar-values-value--contested"
                                  : "jar-values-value"
                              }
                              aria-expanded={pick === pr.id}
                              onClick={() => {
                                const selected=pick===pr.id?null:pr.id;setPick(selected);
                                viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:selected});
                              }}
                            >
                              {pr.statement}
                            </button>
                          )}
                          {pDraft?.id !== pr.id ? <div className="jar-principle-tools">
                          <button
                            type="button"
                            className="jar-principle-edit"
                            aria-label={say("worldPrincipleEdit")}
                            title={say("worldPrincipleEdit")}
                            onClick={() => setPDraft({ id: pr.id, text: pr.statement })}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                              <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" />
                            </svg>
                          </button>
                          <button type="button" className="jar-principle-move"
                            aria-label={say("worldMattersMore")} title={say("worldMattersMore")}
                            disabled={pBusy || i === 0} onClick={() => movePrinciple(pr.id, -1)}>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                              <path d="M12 19V5m-6 6 6-6 6 6" />
                            </svg>
                          </button>
                          <button type="button" className="jar-principle-move"
                            aria-label={say("worldMattersLess")} title={say("worldMattersLess")}
                            disabled={pBusy || i === ranked.length - 1} onClick={() => movePrinciple(pr.id, 1)}>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                              <path d="M12 5v14m-6-6 6 6 6-6" />
                            </svg>
                          </button>
                          </div> : null}
                          {pr.state === "contested" ? (
                            /* An unarbitrated conflict, one layer up — the
                               same truth #307 gave signals: the record holds
                               a dispute, so the page must not read settled.
                               Rank decides meanwhile; your verbs settle it. */
                            <span className="jar-principle-verdict">
                              <span className="jar-label">{say(pr.disputeId ? "worldPrincipleDisputed" : "worldValueContested")}</span>
                              {pr.disputeId ? <button type="button" className="jar-principle-restore" disabled={pBusy}
                                onClick={() => disputeThisPrinciple(pr.id, pr.disputeId!)}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                  <path d="M8 6 4 10l4 4M4 10h10a5 5 0 0 1 0 10" />
                                </svg>
                                {say("worldPrincipleKeep")}
                              </button> : null}
                            </span>
                          ) : pr.state === "aspirational" && !pr.unsupported ? (
                            /* The one distinction worth carrying up here:
                               declared-but-not-yet-demonstrated is a
                               different claim from earned, and the canon
                               already has the word for it. */
                            <span className="jar-poster-away jar-label"> {say("worldAspirational")}</span>
                          ) : pr.locked ? (
                            /* Your words, not the machine's — the same quiet
                               mark the board gives a sentence the person took
                               into their own hand. */
                            <span className="jar-poster-away jar-label"> {say("worldWrittenByHand")}</span>
                          ) : null}
                          {pr.unsupported ? <p className="jar-values-sub">{say("worldPrincipleSupportChanged")}</p> : null}
                          {!pr.unsupported && pr.supportChanged ? <p className="jar-values-sub">{say("worldPrincipleSupportUnconfirmed")}</p> : null}
                          {/* THE VERBS, under the sentence they are about.
                              Order is by consequence: correcting is
                              harmless, moving is reversible, disputing is
                              a stance the machine will read, and removing
                              is last and asks. */}
                          {/* THE ROOTS, one layer down. From here the
                              world's existing path continues: each of
                              these is a pattern, and pressing a pattern
                              in the grounds band opens the memories under
                              IT. Four layers, reachable in hops, with no
                              second picture of the place. */}
                          {pick === pr.id && pRoots === pr.id && !pDraft ? (
                            <PrincipleEvidence signals={pr.citedSignals} locale={locale} />
                          ) : null}
                          {pick === pr.id && !pDraft ? (
                            <div className="jar-ask jar-principle-actions">
                              {storageScope&&!offline?<button type="button" onClick={()=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:pr.id,sharePrinciple:true})}>{say('worldSharePrinciple')}</button>:null}
                              {storageScope&&!offline?<button type="button" onClick={()=>viewNavigation.write({...EMPTY_VIEW,conversationId:'new',principleId:pr.id})}>{say('worldConversationFromPrinciple')}</button>:null}
                              {pr.citedSignals.length > 0 ? (
                                <>
                                  <button
                                    type="button"
                                    aria-expanded={pRoots === pr.id}
                                    onClick={() =>
                                      setPRoots((cur) => (cur === pr.id ? null : pr.id))
                                    }
                                  >
                                    {say("worldPrincipleEvidence")}
                                  </button>
                                </>
                              ) : null}
                              <div className="jar-principle-secondary">
                              {/* WHOSE SENTENCE IT IS DECIDES WHICH WAY OUT
                                  IT HAS, and until 2026-08-26 both were
                                  offered on every principle regardless.

                                  `schema-principles.ts` already draws the
                                  line: `origin` is `minted` — written by
                                  the nightly generation — or `declared`,
                                  the owner's own words. Offering both
                                  verbs on both kinds got each one exactly
                                  backwards. A sentence you wrote yourself
                                  was offered `not mine`, which is not a
                                  thing a person can coherently say about
                                  their own words. And a sentence the
                                  MACHINE concluded was offered a hard
                                  `remove` — which is the flat screens'
                                  administrative affordance, and precisely
                                  the one this project refused to migrate
                                  for signals, on the grounds that the
                                  world answers a wrong claim with a
                                  counted stance and that fading never
                                  deletes.

                                  The same ruling, applied to the other
                                  noun: you ANSWER what the machine claims,
                                  and you WITHDRAW what you said yourself.
                                  Found because the founder asked whether
                                  some of the flat wall was better deleted
                                  than migrated — the answer being that the
                                  question is not migrate-or-delete per
                                  screen, it is whether a verb belongs on
                                  that noun in that state. */}
                              {pr.origin === "minted" ? !pr.disputeId ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={pBusy}
                                    onClick={() => disputeThisPrinciple(pr.id, undefined, pr.statementRevision)}
                                    className="jar-principle-disagree"
                                  >
                                    {say("worldNotMine")}
                                  </button>
                                </>
                              ) : null : (
                                <>
                                  {pGoing === pr.id ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={pBusy}
                                        onClick={() => removePrinciple(pr.id)}
                                      >
                                        {pBusy ? say("worldWithdrawing") : say("worldYesWithdrawIt")}
                                      </button>
                                      <button type="button" onClick={() => setPGoing(null)}>
                                        {say("worldKeepIt")}
                                      </button>
                                    </>
                                  ) : (
                                    <button type="button" onClick={() => setPGoing(pr.id)}>
                                      {say("worldWithdraw")}
                                    </button>
                                  )}
                                </>
                              )}
                              </div>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                      </>
                    ) : w.kind === "agent" ? (
                      <>
                        <p className="jar-values-lead">
                          {formatMessage(locale, "worldValuesLeadOther", { name: w.name })}
                        </p>
                        <p className="jar-values-sub">
                          {say("worldValuesSubOther")}
                        </p>
                      </>
                    ) : null}
                    {/* NOTHING IS DECLARED HERE. What stood in this slot was
                        `declare one`, and under it a two-line draft with
                        `declare it · not now` — the one act on this band that
                        was not about a sentence already on screen. Founder,
                        2026-09-08: "You cannot declare your own values. This
                        can only be generated. So remove this option." It
                        reverses their own ruling of 2026-09-01, which put the
                        verb here so a person with no values could give their
                        word first, and the reversal is the stronger reading of
                        the layer: a value is what the evidence turned out to
                        say about you, so a value you can type is a claim
                        nothing under it has to earn. The empty state above
                        now says the whole truth about this band — it fills
                        when there is enough kept to fill it, and not before. */}
                  </div>
                ) : null}
                {ready && c ? (
                  <div
                    className={`jar-hq-inner${here&&w.kind==='self'&&storageScope&&!offline&&atNow?' jar-hq-inner--activities':''}`}
                    ref={w.kind === "self" ? measured.hqInner : undefined}
                  >
                    {/* R01 makes the personal reading explicit while keeping
                        the existing field, headline and companion layout. */}
                    {here&&w.kind==='self'?<div className="jar-reading-heading" data-jar-chrome="1">
                      <span>{say(atNow?'worldReadingTitle':'worldReadingEarlier')}</span>
                      {atNow&&topOfMind&&topOfMind.createdMs>0?<time dateTime={new Date(topOfMind.createdMs).toISOString()}>{new Date(topOfMind.createdMs).toLocaleDateString(locale,{month:'short',day:'numeric'})}</time>:null}
                      {atNow&&topOfMind?.id&&storageScope&&!offline?<ReadingChanges key={`${storageScope.profileId}:${topOfMind.id}`} profileId={storageScope.profileId} readingId={topOfMind.id} locale={locale} compact/>:null}
                    </div>:null}
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
                      <p className={`jar-forming${w.kind === "self" && topOfMind?.supportChanged ? " jar-forming--attention" : ""}${w.kind==='self'&&!offline?' jar-forming--personal':''}${here&&w.kind==='self'&&atNow&&!offline&&readingLoadPhase==='failed'?' jar-reading-status':''}`}
                        role={here&&w.kind==='self'&&atNow&&!offline&&readingLoadPhase!=='ready'?(readingLoadPhase==='failed'?'alert':'status'):undefined}>
                        {here&&w.kind==='self'&&atNow&&!offline&&!topOfMind?.supportChanged
                          ?readingLoadPhase==='loading'?say('worldPersonalReadingLoading')
                            :readingLoadPhase==='failed'?<>{say('worldPersonalReadingLoadFailed')} <button type="button" className="jar-board-act" onClick={()=>retryReadingLoadRef.current()}>{say('worldRoomHistoryRetry')}</button></>
                            :say(inspirations?.length?'worldPersonalReadingNotReady':'worldPersonalReadingEmpty')
                          :c.formingAlt ?? say("worldFormingNothingAdopted")}
                      </p>
                    )}
                    {/* The dial's historical date stays attached to its read. */}
                    {c.asOf ? (
                      <div className="jar-asof jar-label">
                        {formatMessage(locale, "worldAsOf", { month: c.asOf })}
                      </div>
                    ) : null}
                    {here&&w.kind==='self'&&storageScope&&!offline?<div className="jar-reading-actions" data-jar-chrome="1">
                      {!atNow?<button type="button" onClick={()=>windTo(dial?.end??Date.now())}>{say('worldReadingToday')}</button>:<>
                        {c.text?<button type="button" aria-expanded={posterAsk} onClick={()=>setPosterAsk(value=>!value)}>{say('worldReadingWhy')}</button>:null}
                      </>}
                    </div>:null}
                    {here&&w.kind==='self'&&storageScope&&!offline&&atNow?<HomeActivities locale={locale} reviewLabel={reviewEntry.label} resuming={reviewEntry.resuming} hasInspirations={Boolean(inspirations?.length||fieldBeyond)}
                      onReview={()=>viewNavigation.write({...EMPTY_VIEW,reviewId:'new'})} onChat={()=>viewNavigation.write({...EMPTY_VIEW,conversationId:'new'})}/>:null}
                    {here && w.kind === "group" && atNow ? <button
                      type="button"
                      className="jar-room-shape"
                      data-jar-chrome="1"
                      onClick={() => setGroupPanel(w.id)}
                    >
                      {((openProposals.get(w.id) ?? []).some((item) => item.viewerStance === null))
                        ? say("worldRoomNeedsAnswer") : say("worldShapeTogether")}
                    </button> : null}
                    {/* WHAT IT RESTS ON. The same chain the sky shows under a
                        pattern, one layer up: the memories this sentence was
                        built from, each with the span that carried it at full
                        ink and the surround dimmed. Pressing one travels to
                        that memory in the field. */}
                    {/* THE PATTERNS IT STANDS ON, LIT BY WHO HOLDS THEM.
                        Full ink: you have answered this ground — a verdict, a
                        star. Dim: only the machine believes it. Light is the
                        only difference — no badge, no label, no count — and
                        pressing a ground opens the same ask row the sky
                        gives a pattern being read, because explanation and
                        correction belong one gesture apart: the dim ones are
                        the recalibration queue, and answering is the
                        existing verb, not a new control. */}
                    {here && posterAsk && posterGrounds.length > 0 ? (
                      <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                        <p className="jar-prov-lead jar-label">{say("worldStandingOn")}</p>
                        {posterGrounds.map((ground) => (
                          <div key={ground.id}>
                            {/* SAYING IT IN YOUR OWN WORDS, on the layer below
                                the board. `editing.ts` has implemented the
                                `signal` kind since it was written — the
                                request, the optimistic update, the 404
                                reload — and NOTHING CALLED IT. A whole branch
                                of a hook, complete and unreachable, because
                                the only way in was on the flat `/signals`
                                screen (2026-08-25).

                                It is the same act the board already offers on
                                its own entries, so it is the same shape: the
                                sentence becomes a field in place, and the row
                                under it says keep or leave. A pattern is a
                                claim about you; being able to correct its
                                words without leaving the world is the whole
                                point of it being here. */}
                            {editing.open?.kind === "signal" &&
                            editing.open.id === ground.id ? (
                              <>
                                <textarea
                                  className="jar-ground-edit"
                                  aria-label={say("worldPatternInYourWords")}
                                  value={editing.open.text}
                                  rows={2}
                                  autoFocus
                                  onChange={(e) => editing.retype(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      editing.leave();
                                    }
                                  }}
                                />
                                <p className="jar-ask">
                                  <button
                                    type="button"
                                    disabled={editing.open.saving}
                                    onClick={editing.keep}
                                  >
                                    {editing.open.saving ? say("worldSaving") : say("worldSave")}
                                  </button>
                                  <span aria-hidden="true"> · </span>
                                  <button type="button" onClick={editing.leave}>
                                    {say("worldLeaveIt")}
                                  </button>
                                </p>
                              </>
                            ) : (
                              <button
                                type="button"
                                className={
                                  /* CONTESTED WAVERS BETWEEN THE TWO INKS.
                                     Light is the only meaning channel, so an
                                     unarbitrated dispute is a light that
                                     cannot settle — pulling between the
                                     answered ink and the dim, the way the
                                     two statements pull. The verdict row one
                                     press away is the arbitration itself
                                     (lib/contested-pairs.ts): yes and not-
                                     true both settle the pair, so the state
                                     and its exit are one gesture apart. */
                                  ground.contested
                                    ? "jar-ground jar-ground--contested"
                                    : ground.answered
                                      ? "jar-ground jar-ground--answered"
                                      : "jar-ground"
                                }
                                aria-label={
                                  ground.contested
                                    ? `${ground.statement} — ${say("worldContested")}`
                                    : undefined
                                }
                                onClick={() =>
                                  setGroundAsk((cur) => (cur === ground.id ? null : ground.id))
                                }
                              >
                                {ground.statement}
                              </button>
                            )}
                            {groundAsk === ground.id ? (
                              <p className="jar-ask">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGroundAsk(null);
                                    sayVerdict(ground.id, "true", undefined, ground.contested, ground.statementRevision);
                                  }}
                                >
                                  {say("worldYes")}
                                </button>
                                <span aria-hidden="true"> · </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGroundAsk(null);
                                    sayVerdict(ground.id, "partly", undefined, ground.contested, ground.statementRevision);
                                  }}
                                >
                                  {say("worldPartly")}
                                </button>
                                <span aria-hidden="true"> · </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGroundAsk(null);
                                    sayVerdict(ground.id, "not_true", undefined, ground.contested, ground.statementRevision);
                                  }}
                                >
                                  {say("worldNotTrue")}
                                </button>
                                <span aria-hidden="true"> · </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGroundAsk(null);
                                    editing.begin("signal", ground.id, ground.statement);
                                  }}
                                >
                                  {say("worldSayItInMyWords")}
                                </button>
                                {/* and the way back out of that, in the same
                                    row and only once there is something to
                                    hand back. Asked twice, like the board's,
                                    because releasing words lets the generator
                                    reword or retire them from the next pass. */}
                                {ground.locked ? (
                                  releasingGround === ground.id ? (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <span className="jar-board-warn">
                                        {say(RECEIPTS.releaseOffer.messageKey)}
                                      </span>
                                      <span aria-hidden="true"> · </span>
                                      <button
                                        type="button"
                                        onClick={() => releaseGround(ground.id)}
                                      >
                                        {say("worldHandItBack")}
                                      </button>
                                      <span aria-hidden="true"> · </span>
                                      <button
                                        type="button"
                                        onClick={() => setReleasingGround(null)}
                                      >
                                        {say("worldLeaveItAsItIs")}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <button
                                        type="button"
                                        onClick={() => setReleasingGround(ground.id)}
                                      >
                                        {say("worldHandItBack")}
                                      </button>
                                    </>
                                  )
                                ) : null}
                              </p>
                            ) : null}
                            {verdictReceipt?.id === ground.id ? (
                              <p className="jar-ask">
                                <span className="jar-receipt">{verdictReceipt.text}</span>
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {here && w.kind === 'self' && posterAsk && !readingChecking && !readingCheckFailed && sourcePrevious && sourcePrevious.reading === topOfMind ? (
                      <p className="jar-source-previous"><span>{say('worldSourcePrevious')}</span>{sourcePrevious.body}</p>
                    ) : null}
                    {here && posterAsk ? (
                      posterChain.length > 0 || posterReviewSignalIds.length > 0 ? (
                        /* THE SAME ROOM THE SKY OPENS. These rows travelled
                           too — press one and the camera left headquarters
                           for the field — and they were clipped the same way.
                           One object, two entrances. */
                        <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                          <button
                            type="button"
                            className="jar-prov-lead jar-prov-open jar-label"
                            onClick={() => {
                              setProvPick(null);
                              setProv({ lead: c.text ?? "", rows: posterChain,reviewSignalIds:posterReviewSignalIds });
                            }}
                          >
                            {say("worldBuiltFrom")}
                          </button>
                        </div>
                      ) : (
                        /* the honest empty: a sentence with no chain is a
                           sentence somebody wrote by hand, and saying so is
                           more useful than an empty band */
                        <div className="jar-prov jar-prov--poster" data-jar-chrome="1">
                          <p className="jar-prov-lead jar-label">{say(w.kind === "self" && lead?.supportChanged ? "worldReadingSupportChanged" : "worldWrittenByHand")}</p>
                        </div>
                      )
                    ) : null}
                    {/* A ROOM'S BOARD ASKS TO BE READ AGAIN, in its own words
                        and its own block — see `rereadGroupBoard` for why this is
                        not the self wall's strip opened up to groups. */}
                    {here && w.kind === "group" && lead && !editing.open && posterAsk ? (
                      <div className="jar-board-acts" data-jar-chrome="1">
                        {groupReading === "asking" ? (
                          <>
                            <span className="jar-board-warn">
                              {say("worldRoomRereadWarn")}
                            </span>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => rereadGroupBoard(w.id)}
                            >
                              {say("worldReadAgain")}
                            </button>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => setGroupReading("rest")}
                            >
                              {say("worldLeaveItCap")}
                            </button>
                          </>
                        ) : groupReading === "working" ? (
                          <span className="jar-board-act jar-label">{say("worldReadingNow")}</span>
                        ) : (
                          <button
                            type="button"
                            className="jar-board-act jar-label"
                            onClick={() => setGroupReading("asking")}
                          >
                            {say("worldReadItAgain")}
                          </button>
                        )}
                      </div>
                    ) : null}
                    {/* THE WAY UP IS NOT UNDER THE THING YOU ARE READING.
                        This line used to sit here, beneath the ambition —
                        which put the page's only "there is more above you"
                        BELOW the sentence you had already got to, pointing
                        down to say up. It is fixed chrome at the top edge
                        now; see `.jar-overhead`. */}
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
                        <p className="jar-ask">
                          <button type="button" disabled={editing.open.saving} onClick={editing.keep}>
                            {editing.open.saving ? "…" : say("worldKeepTheseWords")}
                          </button>
                          <span aria-hidden="true"> · </span>
                          <button type="button" onClick={editing.leave}>
                            {say("worldLeaveIt")}
                          </button>
                        </p>
                      </div>
                    ) : null}
                    {w.kind === "self" && undrop ? (
                      <p className="jar-ask jar-ask--after" data-jar-chrome="1">
                        {/* the dismissal's receipt rides beside its undo —
                            reversible is part of the law being stated */}
                        <span className="jar-receipt">{say(RECEIPTS.dismissed.messageKey)}</span>
                        <span aria-hidden="true"> · </span>
                        <button type="button" onClick={restoreLead}>
                          {say("worldPutItBack")}
                        </button>
                      </p>
                    ) : null}
                    {/* WHAT YOU MAY DO ABOUT IT, ONLY ONCE YOU HAVE ASKED.
                        Four verbs sat permanently under the ambition, so the
                        resting page was a sentence with a toolbar under it —
                        furniture, which this layout does not have. They fold
                        into the poster's own press, beside the grounds and
                        the history, because "where did this come from" and
                        "change it" are the same conversation. A read in
                        progress keeps them mounted regardless: a control that
                        vanished mid-work would take its own progress report
                        with it. */}
                    {here && w.kind === 'self' && !reflectOn && !reflectOpen && !editing.open ? sourceNotice : null}
                    {here && w.kind === "self" && !offline && !lead && readingMessage ? (
                      <p className="jar-board-acts jar-reading-status" role="status" data-jar-chrome="1">
                        {readingMessage === "worldReadingSupportChanged" ? null : say(readingMessage)}
                        {!readingRefresh.busy && (readingCheckFailed || readingChecking || topOfMind?.supportChanged || readingRefresh.canResume || ["error", "failed", "unknown"].includes(readingRefresh.phase)) ? (
                          <button className="jar-board-act jar-label" type="button" disabled={readingChecking}
                            onClick={() => readingCheckFailed ? verifyReadingRef.current(true) : void readingRefresh.start()}>
                            {say(readingCheckFailed || readingChecking ? "worldReadingCheckAgain" : readingRefresh.canResume ? "worldReadCheck" : "worldReadAgain")}
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {here &&
                    w.kind === "self" &&
                    !offline &&
                    lead &&
                    !editing.open &&
                    (posterAsk || board.step !== "rest" || readingMessage !== null) ? (
                      <div className={`jar-board-acts${readingMessage !== null ? " jar-reading-status" : ""}`} data-jar-chrome="1">
                        {readingRefresh.busy ? (
                          <span className="jar-board-act jar-label" role="status">{say(readingMessage ?? "worldReadingNow")}</span>
                        ) : board.step === "asking" ? (
                          <>
                            {/* WHAT WILL CHANGE, BEFORE IT CHANGES. Frostpunk's
                                first game commits and then judges; its second
                                previews the consequence at the moment of the
                                vote, and that is the whole difference in how
                                fair the two feel. Regeneration rewrites the
                                board from the signals as they now stand, so
                                the sentence names exactly that. */}
                            <span className="jar-board-warn">
                              {say("worldBoardRereadWarn")}
                            </span>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={rebuildBoard}
                            >
                              {say("worldReadAgain")}
                            </button>
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => setBoard({ step: "rest" })}
                            >
                              {say("worldLeaveItCap")}
                            </button>
                          </>
                        ) : (
                          <>
                            {readingMessage || boardToast ? (
                              <span className="jar-board-warn" role="status">
                                {readingMessage ? say(readingMessage) : boardToast}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              disabled={readingChecking}
                              onClick={() => readingCheckFailed ? verifyReadingRef.current(true)
                                : readingRefresh.canResume ? void readingRefresh.start() : setBoard({ step: "asking" })}
                            >
                              {say(readingCheckFailed || readingChecking ? "worldReadingCheckAgain" : readingRefresh.canResume ? "worldReadCheck" : "worldReadItAgain")}
                            </button>
                            {/* Holding is the person overruling the ordering:
                                the server keeps feeding the entry but never
                                moves it off the poster again. */}
                            {lead.pinned ? (
                              <span className="jar-board-act jar-label jar-board-act--held">
                                {say("worldHeldUp")}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="jar-board-act jar-label"
                                onClick={() => holdLead(lead)}
                              >
                                {say("worldKeepThisOneUp")}
                              </button>
                            )}
                            <button
                              type="button"
                              className="jar-board-act jar-label"
                              onClick={() => editing.begin("entry", lead.id, lead.body)}
                            >
                              {say("worldSayItInMyWordsCap")}
                            </button>
                            {lead.locked ? (
                              entrusting === lead.id ? (
                                <>
                                  <span className="jar-board-warn">
                                    {say(RECEIPTS.releaseOffer.messageKey)}
                                  </span>
                                  <button
                                    type="button"
                                    className="jar-board-act jar-label"
                                    onClick={() => entrustLead(lead.id)}
                                  >
                                    {say("worldHandItBackCap")}
                                  </button>
                                  <button
                                    type="button"
                                    className="jar-board-act jar-label"
                                    onClick={() => setEntrusting(null)}
                                  >
                                    {say("worldLeaveItAsItIsCap")}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="jar-board-act jar-label jar-star-act"
                                  title={say(RECEIPTS.starHeld.messageKey)}
                                  onClick={() => setEntrusting(lead.id)}
                                >
                                  {say("worldHandItBackToWaka")}
                                </button>
                              )
                            ) : null}
                            <button
                              type="button"
                              className="jar-board-act jar-label jar-board-act--quiet"
                              onClick={() => dropLead(lead)}
                            >
                              {say("worldNotThis")}
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
                {/* THE "NOTHING IS FORMING YET" LINE WENT WITH THE SKY. It
                    explained an empty place above the wall; there is no place
                    above the wall now, and a sentence about the absence of
                    something a person can no longer see is worse than
                    silence. The poster already says what an empty wall means,
                    which is the one line that has to survive. */}
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
                {/* AN EMPTY WALL OF YOUR OWN SAYS NOTHING NOW.
                    This used to draw a three-slot scaffold — an empty circle
                    beside "everything you keep", "a pattern, once something
                    recurs", "what it all comes to" — arguing that an empty
                    page describes absence while an unfilled SHAPE invites
                    filling, after Obra Dinn's named-but-blank fates and
                    Dirtmouth's visible closed doors.

                    The argument is good and this was the wrong shape for it.
                    Those references work because the book and the town ARE the
                    interface; here the interface is a world with a sky, a
                    headquarters and a field, and the scaffold was a centred
                    list floating over it. It taught a shape the product does
                    not have, and the first capture then contradicted it.

                    It also assumed a first run it never checked for. The class
                    was `jar-first`, but the condition was only "no top of mind
                    and no inspirations" — so it fired for anyone who emptied a
                    wall they had been keeping for months, and read as being
                    put back into onboarding.

                    Removed on the owner's call, having looked at it against a
                    real emptied wall. An empty wall now renders as the world
                    with nothing in it, which is the honest picture. Agent
                    walls and rooms keep their own sentence below: those say
                    what the machine or the room is waiting FOR, which is
                    information, not scaffolding. */}
                {/* AND THE ROOM'S SENTENCE GOES TOO (founder, 2026-08-25:
                    "dont show this"). The reasoning above held while the room
                    could not say anything for itself; it says what it is
                    waiting for through its own poster now, and a second voice
                    saying the same thing in a different register on the same
                    empty wall is the duplicate this note was already written
                    against. An agent keeps its line: an agent that has been
                    given nothing genuinely is waiting on YOU, and that is a
                    fact about what to do next rather than a description of
                    the emptiness. */}
                {ready && c?.empty && !c?.formingAlt && w.kind === "agent" ? (
                  <p className="jar-wall-empty">
                    {say("worldAgentEmptyGive")}
                  </p>
                ) : null}
                {w.kind === "group" && failedGroups.has(w.id) && !ready ? (
                  <p className="jar-wall-hold jar-label">{say("worldRoomUnreachable")}{" "}
                    <button type="button" onClick={() => void loadGroup(w.id, true)}>{say("worldRoomHistoryRetry")}</button>
                  </p>
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
                {/* The two create rails that hung in these margins are gone
                    (founder, 2026-08-24). Making a room and adding an agent
                    both mean "a new place appears on the axis", and the axis
                    is along the bottom — so they are a `+` at the end of it,
                    beside the places they would join, instead of two words
                    printed sideways down the sides of the world. */}
              </div>
            );
          })}
          {/* THE COMPANION'S OWN ROW IS GONE. It was a second line of words
              under the mouth, which made tapping the creature a way to ADD a
              layer to a page that already had too many. What it said now
              arrives in the mouth's own slot, in the resting phrase's place —
              same words, same face, one row fewer. */}

          {/* ---- THE LENS lived here ----
              Excised while half-built: the control existed but nothing read
              it — no styling, and the per-orb haze it was meant to drive
              (`Ball.lens`) was never written from it, so it filtered nothing.
              The field field and the derive side survive for the rebuild. */}

          {/* THE WAYS OUT: a neighbour's name waiting at the side it lives
              past. They live in headquarters' own chrome, so they scroll away
              with it — which is also how the field section ends up with none,
              exactly as it should, since there is nothing different to travel
              to down there.

              `.jar-way` is now the ONLY thing in these margins: the create
              rails that shared them moved to the axis at the bottom, beside
              the places they would join. The two once shared a class name
              through two whole conflicting stylesheets and neither got the
              layout it was written for; there is nothing left to collide
              with. */}
          {walls.map((w, i) => {
            const left = walls[i - 1] ?? null;
            const right = walls[i + 1] ?? null;
            return (
              <Fragment key={`edges-${spaceKey(w)}`}>
                {left ? (
                  <button
                    type="button"
                    className="jar-way jar-label"
                    data-jar-chrome="1"
                    style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col} + 10px)` }}
                    onPointerDown={() => loadWall(left)}
                    onClick={() => simApiRef.current?.travel(-1)}
                  >
                    <span className="jar-caret jar-caret--left" aria-hidden="true" />
                    <span>{wallName(left)}</span>
                  </button>
                ) : null}
                {right ? (
                  <button
                    type="button"
                    className="jar-way jar-way--r jar-label"
                    data-jar-chrome="1"
                    style={{ left: `calc(var(--jar-vw, 100vw) * ${w.col + 1} - 10px)` }}
                    onPointerDown={() => loadWall(right)}
                    onClick={() => simApiRef.current?.travel(1)}
                  >
                    <span>{wallName(right)}</span>
                    <span className="jar-caret jar-caret--right" aria-hidden="true" />
                  </button>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      ) : null}

      {/* The capture entry stays in the world; the native composer owns input,
          focus and scrolling above it. Files and words share one save intent. */}
      {phase === 'ready' ? <>
        <div ref={measured.mouth} className="jar-mouth" data-jar-chrome="1">
          <div className={'jar-mouth-slot' + (atNow ? '' : ' jar-mouth-slot--away')} {...(!atNow || inField || inSky ? { inert: '' } : {})}>
          <button type="button" ref={element => { measured.mouthSpot.current = element; }}
            className={'jar-mouth-rest jar-label' + (charSay ? ' jar-mouth-rest--said' : '')}
            style={mouthOpen ? { visibility: 'hidden' } : undefined}
            onClick={() => { setCharSay(''); openMouth(); }}>
            {!charSay?<HomeActionIcon kind="capture"/>:null}
            {charSay || (draft.trim() || composerDraft.draft.media.length ? say('worldContinueDraft') : say('worldCaptureInspiration'))}
          </button>
          {!mouthOpen ? <AuthoredSaveNotice save={inspirationSave} locale={locale} /> : null}
          </div>
        </div>
        {mouthOpen ? <InspirationComposer text={draft} media={inputMedia}
          linkText={composerDraft.draft.linkText ?? ''} onLinkText={composerDraft.setLinkText}
          recordingCandidate={composerDraft.draft.recordingCandidate}
          onChooseRecording={useNew => { composerDraft.chooseRecording(useNew); setMouthNote(''); void composerDraft.flush().catch(reason => setMouthNote(String(reason))); }}
          locale={locale} public={keepPublic} ready={composerDraft.ready} fileDraftsAvailable={composerDraft.available} busy={preparingInspiration || checkingFiles}
          uploadingId={uploadingMediaId} error={mouthNote || composerDraft.error}
          save={inspirationSave} recording={recording} inputRef={mouthFieldRef}
          onText={(text, caret) => { mouthCaretRef.current = caret; draftRef.current = text; setDraft(text); setMouthNote(''); }}
          onFiles={files => { void addInspirationFiles(files); }}
          onRetryFile={id => { void retryDraftFile(id); }}
          onRemove={id => { if (id.startsWith('text-link:')) setDraft(removeInspirationLink(composerDraft.current.current.text, id.slice('text-link:'.length)));
            else composerDraft.setMedia(composerDraft.current.current.media.filter(item => item.id !== id)); }}
          onVisibility={setKeepPublic} onClose={saveAsDraft} onSubmit={reflect => { void keepIt(reflect); }}
          onKeyDown={onMouthKey} onForkDraft={() => { void composerDraft.fork().catch(reason => setMouthNote(String(reason))); }} /> : null}
      </> : null}

      {/* SECTION S IS GONE. The sky — a whole viewport above headquarters
          holding every signal still forming, its sentences, its satellites and
          its verbs — is no longer shown to anyone (founder, 2026-08-25: "we
          decided to remove showing the signals to the end users, so remove the
          sky"). Signals are still derived, still stored, and still what the top
          of mind is written from; they are simply not a place you can stand in
          any more. The world is headquarters and the ground. */}

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
        /* NO KEY, DELIBERATELY (founder, 2026-08-27: "card still blinks when
           moving from one to another"). Keyed by the memory's id, every move
           unmounted the card and mounted a fresh one — and `--in` is an
           ANIMATION, so a fresh mount replays the appearance however the
           open/close state is managed. That key WAS the blink: the state fix
           before this one was correct and could not have been sufficient.
           One element, contents turning like pages; what a new memory must
           reset — the scroll — is reset explicitly where `panel.id` changes. */
        <DialogSurface
          ref={panelRef}
          active={panelOpen}
          onClose={() => { simApiRef.current?.release(); setSelectedId(null); }}
          className={`jar-panel${panelOpen ? " jar-panel--in" : " jar-panel--out"}`}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldASavedInspiration")}
        >
          {/* THE HEAD IS ONE ROW (founder's sketch, 2026-08-25: "must be
              aligned centered"). The date and the visibility pair were two
              independently placed things that only LOOKED like a row — the
              date a block padded 56px left and 120px right to dodge controls
              that have since moved, the pair absolutely positioned at
              `top: 14px`. Two different boxes, two different vertical
              origins, so nothing lined up with anything and the gap changed
              with the length of the date. They are one grid now, centred
              against each other, and neither knows where the other ends. */}
          <div className="jar-panel-head">
          {panelIsGroup ? (
            /* whisper attribution: whose save this is, and when — where the
               evidence named no date of its own, who alone. Leaving a fact
               out is honest; guessing at it is not. */
            <span className="jar-panel-when jar-label">
              {panelBall.noDate
                ? panelBall.authorName ?? ""
                : `${panelBall.authorName ?? ""} · ${dateWords(panelBall.capturedMs, Date.now(), locale)}`}
            </span>
          ) : (
            <span className="jar-panel-when jar-label">
              {/* the date alone, with its year — "Two days ago · Aug 24" said
                  one fact twice, and the relative half goes stale while the
                  card stays open (founder, 2026-08-27) */}
              {dateStamp(panelBall.capturedMs, locale)}
              {panelHasReflection ? <span className="jar-panel-reflected"> · {say("worldReflected")}</span> : null}
            </span>
          )}
          {!panelIsGroup ? (
            /* WHO MAY SEE THIS, AT THE TOP RIGHT (founder, 2026-08-25:
               "top right should have option to switch between Private •
               Public. also call it private and public everywhere"). The
               same lit/dim pair the mouth wears while writing: both words
               always present, the standing one lit, pressing the other one
               moves it. Private remains the state you get by touching
               nothing. */
            <p
              className={`jar-ask jar-ask--row jar-panel-vis${
                publishing ? " jar-panel-vis--busy" : ""
              }`}
            >
              <button
                type="button"
                className={panelIsPublic ? "jar-where-off" : "jar-where-on"}
                aria-pressed={!panelIsPublic}
                onClick={() => {
                  if (!panelIsPublic) return;
                  /* un-publishing a memory a signal stands on gets the same
                     one ask deleting it does, in the same place — the card's
                     own foot (founder, 2026-08-27) */
                  if (panelPowersSignal) setUnpublishAsk(true);
                  else togglePublic();
                }}
              >
                {say("worldPrivate")}
              </button>
              <span aria-hidden="true">/</span>
              <button
                type="button"
                className={panelIsPublic ? "jar-where-on" : "jar-where-off"}
                aria-pressed={panelIsPublic}
                onClick={() => { if (!panelIsPublic) setPublishAsk(true); }}
              >
                {say("worldPublic")}
              </button>
            </p>
          ) : null}
          <button type="button" className="jar-copy-link" title={say('worldCopyInspirationLink')}
            aria-label={say('worldCopyInspirationLink')} onClick={() => void copyInspirationLink()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 14 4-4m-7 3-2 2a4 4 0 0 0 6 6l4-4m-4-10 2-2a4 4 0 0 1 6 6l-4 4" /></svg>
          </button>
          </div>
          {publishAsk&&!panelIsPublic?<div className="jar-panel-askrow" role="group" aria-label={say('worldAudience')}>
            <p className="jar-panel-warn">{say('worldPublishConfirm')}</p>
            <div className="jar-ask jar-ask--row">
              <button type="button" autoFocus onClick={()=>setPublishAsk(false)}>{say('worldKeepPrivate')}</button>
              <button type="button" disabled={publishing} onClick={()=>{setPublishAsk(false);togglePublic();}}>{say('worldMakePublic')}</button>
            </div>
          </div>:null}
          {editing.open?.kind === "memory" && editing.open.id === panelId ? (
            /* THE SAME SLOT, THE SAME MEASURE, THE SAME FACE. It is the words
               you were just reading, with a caret in them — see
               `beginPanelEdit`. Nothing has moved and nothing is duplicated. */
            <textarea
              ref={(el) => {
                panelEditRef.current = el;
                if (!el) return;
                growPanelEdit(el);
                if (document.activeElement !== el) {
                  el.focus();
                  const at = panelCaretRef.current;
                  const to = at === null ? el.value.length : Math.min(at, el.value.length);
                  el.setSelectionRange(to, to);
                  panelCaretRef.current = null;
                }
              }}
              className="jar-panel-text jar-panel-edit"
              aria-label={say("worldWordsOfThisInspiration")}
              /* ONE, BECAUSE THE DEFAULT IS TWO. A textarea without `rows`
                 is rows="2", so `height: auto` in `growPanelEdit` never
                 measures below two lines — and a one-line memory grew a
                 phantom line the reading face doesn't have, which is the
                 height jump the founder recorded (view 164, edit 188, on
                 the word "save"). The law is "dont make height different
                 when viewing vs editing"; the honest way to equal heights
                 is measuring the same words the same way, not teaching the
                 reading face to hold invented air. */
              rows={1}
              value={editing.open.text}
              onChange={(e) => {
                editing.retype(e.target.value);
                growPanelEdit(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  editing.leave();
                }
              }}
            />
          ) : (
            <p
              ref={panelTextRef}
              className={
                panelCanReflect && !panelIsGroup
                  ? "jar-panel-text jar-panel-text--yours"
                  : "jar-panel-text"
              }
              style={markStyle}
              onClick={panelCanReflect && !panelIsGroup ? beginPanelEdit : undefined}
            >
              {markPassages(
                panel.detail ? panel.detail.text || panel.detail.preview : panelBall.textPreview,
                panelMarks,
              )}
            </p>
          )}
          {panel.partial ? (
            <p className="jar-panel-note">{say("worldCouldntLoadRest")}</p>
          ) : null}
          {panel.detail?.attachments.length ? <InspirationAttachments items={panel.detail.attachments} locale={locale} /> : null}
          {panelIsGroup && panelBall.citedBy && panelBall.citedBy.length > 0 ? (
            /* the collapsed links sentence, adapted: what read this save */
            <p className="jar-panel-cited jar-label">{citedWords(panelBall.citedBy, locale)}</p>
          ) : null}

          {/* Public capture cards are not signal statements. Room pattern
              reactions live in Shape together and never post a capture ID. */}

          {/* The one action. Everything else that used to be here — the
              sparks block, what this feeds, nearby in your jar — was
              apparatus: it made a person ask what each list was instead of
              reading what they saved. */}

          {panelCanReflect&&!panelIsGroup&&panel.detail?.conversationOrigin?<p className="jar-review-context">{say(panel.detail.conversationOrigin.authorship==='adopted'?'worldChatAdoptedOrigin':'worldChatUserOrigin')}</p>:null}
          {reflectOpen && panelCanReflect && !panel.detail ? <p role="status">{say('worldOpeningAttachment')}</p> : null}
          {reflectOpen && panelCanReflect && panel.detail && (panelBall?.sigId ?? panelId) ? (
            <ReflectionFlow
              key={panelBall?.sigId ?? panelId}
              inspirationId={(panelBall?.sigId ?? panelId) as string}
              scope={storageScope}
              processing={!reflectOn && sourceProcessing.active?.inspirationId === (panelBall?.sigId ?? panelId) ? sourceNotice : null}
              initialTurns={(panel.detail?.reflections ?? [])
                .filter((item) => !item.skipped && item.answer)
                .map((item): ReflectionTurn => ({ id: item.id, question: item.question, answer: item.answer as string }))}
              locale={locale}
              focusReflectionId={viewNavigation.view?.reflectionId}
              onCopyLink={(id) => void copyInspirationLink(id)}
              onSaved={reflectionSaved}
              onSynchronized={(row) => synchronizeReflections((panelBall?.sigId ?? panelId) as string, row)}
              onRemoved={(id) => reflectionRemoved(id, (panelBall?.sigId ?? panelId) as string)}
              onDone={() => { setReflectOpen(false); viewNavigation.write({ ...observedRef.current, reflectionId: null }, { observed: true, replace: true }); }}
            />
          ) : null}

          {/* FORGET IT — and the law it does not break.
              "Fading never deletes" is a rule about the MACHINE: nothing goes
              dark because a server decided it had stopped mattering. A person
              throwing away their own memory is the opposite act, and the
              canon makes layer 1 editable and deletable on purpose. Only your
              own: another member's is theirs, and a room orb is a statement
              that was shared rather than a memory that can be reached.
              It asks once, in place, because there is no undo behind it. */}
          {/* ONE ROW, THREE VERBS, IN THE MEMORY'S OWN VOICE (founder,
              2026-08-25: "the bottom should be Reflect • Edit • Delete").
              The nest — one act in the open, the rest behind "more" — put
              the housekeeping a press further away than anybody expected it
              to be. Three lowercase words in the panel's own grammar now,
              reflecting first because it is the act this panel exists for.
              Visibility is not on this row any more: where the memory may be
              seen is a state, and it reads at the top right beside the date,
              not among the verbs.

              A room orb keeps its own law: another member's save offers no
              verb here at all (the verdict row above is the answer), and
              your own save in a room reflects but is never edited or
              deleted from the room's wall. */}
          {/* WHILE THE WORDS ARE OPEN, THE ROW IS ABOUT THE WORDS. Same place,
              same face as the resting verbs — the row does not move and does
              not grow; what it offers changes, because what you are doing has.
              The picture lives here rather than beside `delete`: changing what
              a memory IS — its words and what it carries — is one job, and the
              server reads a picture at capture time, so it feeds the signals
              exactly as the text does. */}
          {editing.open?.kind === "memory" && editing.open.id === panelId ? (
            <p className="jar-ask jar-ask--after jar-panel-foot">
              <span className="jar-panel-foot-l">
              <label className="jar-attach">
                {attaching ? say("worldAddingAttachment") : say("worldAddAttachment")}
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
              </span>
              {/* THE MIDDLE BECOMES `save` WHILE YOU TYPE (founder,
                  2026-08-25: "when user edits sth, replace the center left
                  right arrow icon with save button").

                  This argued the other way until today: that the carets should
                  stay, because taking the way out of a screen away from
                  somebody mid-use is a mistake this codebase has fixed three
                  times in other corners. The founder's ruling is better and
                  the old argument does not survive it. Stepping to another
                  memory with an edit open was never a way OUT — it was the way
                  to leave unsaved words behind on a card you are no longer
                  looking at. Leaving is `leave it`, one cell to the right, and
                  closing the card is the other. Neither has moved.

                  So the centre says what this footer is for while it is open.
                  It is the same word the mouth uses for the same act, in the
                  same slot the carets had, so nothing shifts under the
                  pointer when the edit begins. */}
              <span className="jar-panel-foot-c">
                <button
                  type="button"
                  className="jar-panel-save"
                  onClick={editing.keep}
                  disabled={
                    editing.open.saving ||
                    editing.open.saved ||
                    editing.open.text.trim() === ""
                  }
                >
                  {/* three states in one word, in the slot the carets will
                      have back in a moment: what you may do, what is
                      happening, and what happened. */}
                  {editing.open.saved
                    ? say("worldSavedWord")
                    : editing.open.saving
                      ? say("worldSaving")
                      : say("worldSave")}
                </button>
              </span>
              <span className="jar-panel-foot-r">
                <button type="button" onClick={editing.leave}>
                  {say("worldCancelEdit")}
                </button>
              </span>
            </p>
          ) : null}
          {/* THE FOOT OF THE CARD, IN THREE PARTS (founder's sketch,
              2026-08-25): what you can DO at the ends, and the way to read on
              in the middle. The two carets were at the top left, in the
              corner the date wants and beside the pair that says who may see
              this — three unrelated things in one corner. Stepping is
              movement, and movement belongs at the foot, centred, where it
              reads as "and then" rather than as another verb. */}
          {/* THE ASK STANDS WHERE THE VERB STOOD (founder, 2026-08-27: "dont
              do hover card on a hover card"). The warning used to be a small
              sheet floating over the card — a second surface answering a
              press that happened on this one. It is the card's own state
              now: while the question is open the foot's verbs step aside and
              the sentence takes their row, so nothing covers the words you
              are deciding about. */}
          {forget.step === "asking" && forget.id === panelId ? (
            <div className="jar-panel-askrow">
              <p className="jar-panel-warn">{say("worldDeleteWarn")}</p>
              <p className="jar-ask jar-ask--row">
                <button
                  type="button"
                  className="jar-where-on"
                  onClick={() => setForget({ id: null, step: "rest" })}
                >
                  {say("worldKeepIt")}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" className="jar-where-off" onClick={forgetIt}>
                  {say("worldDeleteItAnyway")}
                </button>
              </p>
            </div>
          ) : unpublishAsk ? (
            <div className="jar-panel-askrow">
              <p className="jar-panel-warn">{say("worldUnpublishWarn")}</p>
              <p className="jar-ask jar-ask--row">
                <button
                  type="button"
                  className="jar-where-on"
                  onClick={() => setUnpublishAsk(false)}
                >
                  {say("worldKeepItPublic")}
                </button>
                <span aria-hidden="true"> · </span>
                <button
                  type="button"
                  className="jar-where-off"
                  onClick={() => {
                    setUnpublishAsk(false);
                    togglePublic();
                  }}
                >
                  {say("worldMakePrivateAnyway")}
                </button>
              </p>
            </div>
          ) : null}
          {panelCanReflect &&
          !reflectOpen &&
          !editing.open &&
          !(forget.step === "asking" && forget.id === panelId) &&
          !unpublishAsk ? (
            <p className={`jar-ask jar-ask--after jar-panel-foot${panelHasReflection ? " jar-panel-foot--reflected" : ""}`}>
              <span className="jar-panel-foot-l">
              <button type="button" className={panelHasReflection ? "jar-panel-reflection-link" : undefined} onClick={askToReflect}>
                {panelHasReflection ? say("worldReadReflection") : say("worldReflect")}
              </button>
              </span>
              <span className="jar-panel-foot-c">{panelStepCarets}</span>
              <span className="jar-panel-foot-r">
              {!panelIsGroup ? (
                <>
                  {/* DELETING ASKS ONLY WHEN THERE IS SOMETHING TO SAY
                      (founder, 2026-08-25: "delete it without warning if
                      inspiration is not powering a signal. if it does, then
                      show a new modal to explain the situation"). A memory
                      nothing was read from goes the moment you say so —
                      a warning with nothing to warn about is friction wearing
                      a safety costume. A memory a signal stands on opens the
                      ask below instead. */}
                  {forget.step === "going" ? (
                    say("worldDeleting")
                  ) : forget.step === "failed" ? (
                    /* PROSE, AND IT SAYS WHAT IS TRUE: the memory is still
                       here. Beside the verb rather than in a sheet, because
                       nothing happened and nothing needs deciding — pressing
                       delete again is the whole recovery. */
                    <span className="jar-panel-warn">
                      {say("worldDeleteFailed")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        panelPowersSignal
                          ? setForget({ id: panelId, step: "asking" })
                          : forgetIt()
                      }
                    >
                      {say("worldDelete")}
                    </button>
                  )}
                </>
              ) : null}
              </span>
            </p>
          ) : null}
        </DialogSurface>
      ) : null}

      {/* ================= WHERE A STATEMENT CAME FROM =================
          It leads with the statement itself, because the question the room
          answers is "how did THIS get said" and the claim has to be present
          for the grounds under it to mean anything.

          Then two panes. LEFT: every memory this statement stands on, in the
          order it was read, each clamped to a few lines with the span that
          did the reading still at full ink and its surround dim — the same
          salience the rows always carried, now with an honest edge instead of
          a silent truncation. RIGHT: the one you pressed, whole, fetched as
          the memory itself rather than as the preview the evidence carries.

          NOTHING MOVES BEHIND IT. The old rows flew the camera down into the
          field, which cost you the place you were reading from to find out
          where it came from — ruled out by the founder outright. */}
      {prov !== null ? (
        <DialogSurface
          className="jar-prov-room"
          onClose={closeProv}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldWhereThisCameFrom")}
        >
          <p className="jar-prov-room-lead">{prov.lead}</p>
          <div className="jar-prov-room-panes">
            <div className="jar-prov-room-list">
              <p className="jar-prov-lead jar-label">{say("worldReadFrom")}</p>
              {prov.rows.map((e) => (
                <button
                  key={`${e.signalId}:${e.inspirationId}`}
                  type="button"
                  className={`jar-prov-row${
                    provPick === e.inspirationId ? " jar-prov-row--picked" : ""
                  }`}
                  aria-pressed={provPick === e.inspirationId}
                  onClick={() => setProvPick(e.inspirationId)}
                >
                  <span className="jar-prov-text">{salience(e)}</span>
                  {e.reason ? <span className="jar-prov-why">{e.reason}</span> : null}
                </button>
              ))}
              <ReviewEvidence rows={(prov.reviewSignalIds??[]).flatMap(id=>reviewEvidenceBySignal.get(id)??[])} locale={locale}/>
            </div>
            {prov.rows.length>0?<div className="jar-prov-room-full">
              {provPick === null ? (
                /* THE PANE SAYS WHAT IT IS FOR RATHER THAN SITTING BLANK, and
                   it never guesses by pre-selecting the first ground: which
                   memory you are reading is a thing you chose, and a pane
                   that chose for you would put words on screen you did not
                   ask for and could not tell apart from your own choice. */
                <p className="jar-prov-room-idle">{say("worldProvIdle")}</p>
              ) : provFull === null || provFull.id !== provPick ? (
                <p className="jar-prov-room-idle">{say("worldFetchingIt")}</p>
              ) : provFull.text === "" ? (
                <p className="jar-prov-room-idle">{say("worldProvFetchFailed")}</p>
              ) : (
                <p className="jar-prov-room-text">{provFull.text}</p>
              )}
            </div>:null}
          </div>
          <p className="jar-ask jar-ask--row jar-prov-room-close">
            <button type="button" onClick={() => setProv(null)}>
              {say("worldEnough")}
            </button>
          </p>
        </DialogSurface>
      ) : null}

      {/* the one ask before a delete used to float here as its own sheet —
          a card over the card (founder, 2026-08-27). It lives on the card's
          own foot now, beside the ask before un-publishing. */}

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
            /* A SPLIT BUTTON: the name opens where you are, the caret opens
               where else you could be (founder, 2026-08-24). This is the one
               way into a wall's own panel now — the name over the poster
               stopped being a second door — and the right half answers the
               question that used to need a walk to the edge of the world:
               which other walls exist, and take me there. */
            <span className="jar-here-split">
              <button
                type="button"
                className="jar-here jar-back jar-label"
                aria-expanded={settingsFor === spaceKey(atWall)}
                onClick={() => {
                  setWallPick(false);
                  setSettingsFor(
                    settingsFor === spaceKey(atWall) ? null : spaceKey(atWall),
                  );
                }}
              >
                {atWall.kind === "group"
                  ? groups.find((g) => g.id === atWall.id)?.name ?? atWall.name
                  : wallName(atWall)}
              </button>
              <button
                type="button"
                className="jar-here-more jar-back jar-label"
                aria-expanded={wallPick}
                aria-label={say("worldGoToAnotherWall")}
                onClick={() => {
                  setSettingsFor(null);
                  setWallPick((v) => !v);
                }}
              >
                <span aria-hidden="true">▾</span>
              </button>
              {wallPick ? (
                <span className="jar-here-list" role="menu">
                  {walls.map((w) => {
                    const mine = w.kind === atWall.kind && w.id === atWall.id;
                    return (
                      <button
                        key={spaceKey(w)}
                        type="button"
                        role="menuitem"
                        className={`jar-here-row jar-label${mine ? " is-here" : ""}`}
                        onClick={() => {
                          setWallPick(false);
                          simApiRef.current?.goToWall(w.col);
                        }}
                      >
                        {wallName(w)}
                      </button>
                    );
                  })}
                  {/* THE LIST OF YOUR WALLS IS ALSO WHERE YOU MAKE ONE. It
                      listed every place you could go and offered no way to
                      make another, so a person looking for their rooms in the
                      obvious place had to know about a `+` at the far end of
                      the screen. */}
                  <button
                    type="button"
                    role="menuitem"
                    className="jar-here-row jar-here-row--make jar-label"
                    onClick={() => {
                      setWallPick(false);
                      setNewPlace(true);
                    }}
                  >
                    {say("worldAddNew")}
                  </button>
                </span>
              ) : null}
            </span>
          }

          {/* WHEN YOU ARE, BESIDE WHERE YOU ARE.
              Founder, 2026-08-25: "let's find a new home for timeline. doesn't
              need to stay at bottom."

              It was a word at the bottom edge with the count under it, which
              made time a FIFTH signpost on a screen whose whole grammar is
              four: up is what you believe, down is what you kept, left and
              right are whose mind. Time is not a direction you can walk — it
              is a lens on whichever wall you are already standing on. So it
              belongs with the sentence that says which wall that is, and the
              bottom edge goes back to holding one thing.

              AND IT IS THE READING, NOT A LABEL. It said `timeline`, a name
              for an instrument, and the instrument then had to stay lit to
              say you had wound back. This says `now`, or the day you are
              parked at — so the fact lives in a word that is always there and
              the rail can be genuinely absent until you reach for it. */}
          {dial && phase === "ready" && !dialAway ? (
            <span className="jar-when-place">
            <button
              type="button"
              className={`jar-when jar-label${parkedAt === null ? "" : " jar-when--away"}`}
              aria-expanded={timeOpen}
              aria-label={say("worldWindBack")}
              onClick={() => {
                /* the press that follows the hover confirms it; the one after
                   that is the way out */
                if (timeHovered.current) {
                  timeHovered.current = false;
                  setTimeOpen(true);
                  return;
                }
                setTimeOpen((v) => !v);
              }}
              /* a mouse arriving on the word is a reach for the list; a
                 finger arriving is the start of the press, and the press
                 already has an answer */
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") return;
                timeHovered.current = !timeOpen;
                setTimeOpen(true);
              }}
              onPointerLeave={() => {
                /* the list stays up, but the memory of HOW it went up does
                   not: a pointer that has left and come back is a new reach,
                   and the press after it is a fresh answer */
                timeHovered.current = false;
              }}
            >
              {parkedAt === null ? say("worldNow") : dateWords(parkedAt, dial.end, locale)}
            </button>
            {selectedGroupHistory && atWall.kind === "group" ? <span className="jar-when-story" role="status">
              {selectedGroupHistory}
              <button type="button" onClick={() => setGroupPanel(atWall.id)}>
                {say("worldRoomHistoryDetails")}
              </button>
            </span> : null}
            </span>
          ) : null}
        </div>

        {/* AND THE WAY OUT MOVES RIGHT. Two permanent things at the top of the
            screen, on opposite sides, each answering a different question:
            left is WHERE YOU ARE, right is HOW YOU LEAVE. They stopped being
            the same slot the moment the room's name needed somewhere to live,
            and putting them at opposite ends means neither can ever hide the
            other — which is exactly the bug the ternary here used to cause. */}
        {/* The ≡ drawer that stood here is gone (founder ask, 2026-08-24).
            It was scaffolding and said so; its rows did not vanish — the
            flat screens and the loop's two doors now live in the account
            drop, the one sheet this bar already had. */}
        {readingOpen ? (
          <ReadingPanel reading={theReading} onClose={() => setReadingOpen(false)} />
        ) : null}

        {antechamberOpen ? (
          <AntechamberPanel
            rows={antechamber}
            onClose={() => setAntechamberOpen(false)}
            onRestoreAnchor={restoreFromAntechamber}
            restoredAnchorIds={restoredAnchors}
          />
        ) : null}

        {duplicatesOpen ? (
          <DuplicatesPanel
            rows={duplicates}
            onClose={() => setDuplicatesOpen(false)}
            onResolve={resolveDuplicate}
            resolvedIds={resolvedDuplicates}
          />
        ) : null}

        <button
          type="button"
          className="jar-account jar-back jar-label"
          aria-expanded={accountOpen}
          onClick={() => {
            setAccountOpen((v) => !v);
            setSettingsFor(null);
          }}
        >
          {say("worldYourAccount")}
        </button>

        {/* WHAT YOU ARE LOOKING AT, WHEN IT IS NOT YOURS. It lives in the
            fixed chrome rather than on a wall because it is a fact about the
            whole session — so it is there in the sky, at headquarters and down
            in the field, and it cannot be travelled away from. */}
        {offline ? (
          <p className="jar-offline jar-label">
            {say("worldOffline")}
          </p>
        ) : null}
      </div>

      {/* THE WAY UP IS GONE WITH THE PLACE IT LED TO. It sat on the top edge
          and said what was forming overhead; there is no overhead any more,
          and a door onto a room that has been removed is worse than no door.
          The signals it counted are still derived and still write the poster —
          they are simply not somewhere a person goes. */}


      {/* AT EVERY HEIGHT, NOT JUST DOWN IN THE FIELD.
          It was gated on `inField`, so it was not even mounted at the height
          you ARRIVE at — the one moment a person needs telling that this
          ground is one of several. It is a fact about the wall you are
          standing on, so like the offline line it holds still while you
          descend. Only the sky is exempt: up there you are reading patterns,
          and whose ground is under you is not the question. */}
      {grounds.length > 0 && phase === "ready" ? (
        <div
          className={groundsLit ? "jar-grounds jar-grounds--lit" : "jar-grounds"}
          data-jar-chrome="1"
          role="radiogroup"
          aria-label={say("worldWhoseGround")}
        >
          {grounds.map((m) => {
            const here = m.mine ? standing === null : standing === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={here}
                className={here ? "jar-grounds-row jar-grounds-row--here" : "jar-grounds-row"}
                onClick={() => standIn(m.mine ? null : m.id)}
              >
                <i
                  className={m.agent ? "jar-grounds-dot jar-grounds-dot--agent" : "jar-grounds-dot"}
                  style={m.hue >= 0 ? { background: hueCss(m.hue) } : undefined}
                  aria-hidden="true"
                />
                {m.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {dial && phase === "ready" && timeOpen ? (
        <div
          ref={dialRef}
          className={`jar-dial${dialAway ? " jar-dial--away" : ""}`}
          data-jar-chrome="1"
        >
          {/* THE DATES, AND NOTHING TO DRAG (founder, 2026-08-30: "instead
              of this draggable line, when clicking on now, just show the
              major dates to make them clickable").

              What stood here was `.jar-dial-track`: a 44px-wide invisible
              strip running nearly half the height of the screen, mounted and
              live to every press whether or not the instrument was showing.
              It swallowed presses meant for the walls list behind it —
              measured at x 110..140, y 50..420, and it took two attempts to
              reach ADD NEW through it. That is the jar's mouth bug again,
              the same shape: a control with no ink and a full-height box.

              MOUNTED ONLY WHILE IT IS OPEN, which is the fix and not merely
              tidiness. A list that does not exist cannot be in front of
              anything, so there is no rest state left in which this can take
              a press that was meant for the world. */}
          <div className="jar-dial-list" role="group" aria-label="wind this wall back to a date">
            {/* THE WAY BACK IS THE FIRST ROW. The rail had none: returning to
                the present meant landing a drag within half a day of the top
                of a line you could not see. */}
            <button
              type="button"
              className={`jar-dial-stop jar-label${parkedAt === null ? " jar-dial-stop--here" : ""}`}
              aria-current={parkedAt === null}
              onClick={() => windTo(dial.end)}
            >
              <span className="jar-dial-stop-date">{say("worldNow")}</span>
              {currentGroupHistory ? <span className="jar-dial-stop-story">{currentGroupHistory}</span> : null}
            </button>
            {dial.stops.map((stop) => {
              const caption = atWall.kind === "group"
                ? groupHistoryCaption(eventsAtStop(groupHistory, stop.at, stop.grain), locale, 1)
                : null;
              return <button
                key={stop.at}
                type="button"
                className={`jar-dial-stop jar-label${
                  parkedAt === stop.at ? " jar-dial-stop--here" : ""
                }`}
                aria-current={parkedAt === stop.at}
                onClick={() => windTo(stop.at)}
              >
                <span className="jar-dial-stop-date">{stop.label}</span>
                {caption ? <span className="jar-dial-stop-story">{caption}</span> : null}
              </button>;
            })}
          </div>
        </div>
      ) : null}

      {/* The skeleton speaks PROSE, so it never enters the label register:
          all-caps is for eyebrows and meta, and "POURING WAKA…" is what
          happens when a sentence is put through it. */}
      {/* NAMING AN AGENT. One field, because that is all a profile needs to
          exist — what it becomes is written by the agent itself, working. */}
      {agentName !== null ? (
        <DialogSurface className="jar-seek" data-jar-chrome="1"
          aria-label={say("worldAgentNamePlaceholder")} onClose={() => setAgentName(null)}>
          <input
            className="jar-roomform-box"
            autoFocus
            value={agentName}
            placeholder={say("worldAgentNamePlaceholder")}
            onChange={(e) => setAgentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") makeAgent();
              if (e.key === "Escape") setAgentName(null);
            }}
          />
          <p className="jar-ask">
            <button type="button" onClick={makeAgent}>
              {say("worldGiveItAWall")}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setAgentName(null)}>
              {say("worldNotNow")}
            </button>
          </p>
          {agentTrouble ? (
            <p className="jar-settings-warn" role="status">
              {agentTrouble}
            </p>
          ) : null}
          <p className="jar-share-note">{say("worldAgentWritesOnce")}</p>
        </DialogSurface>
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
      {/* HOW MUCH IS DOWN THERE, AND THE WAY TO IT (founder, 2026-08-25:
          "x inspirations saved should be at the bottom with a carrot").
          The ground is a whole section below and nothing on the resting page
          said it existed, let alone how much was in it. A count and a caret:
          the number is what you have, the caret is which way.

          THE NUMERAL IS DELIBERATE AND IT IS AN EXCEPTION. "States render,
          numerals never" holds everywhere it means something — an aliveness,
          a confidence, how many people agreed — because a number there invites
          a person to optimise a score. This is not that: it is the SIZE OF
          YOUR OWN ARCHIVE, the one quantity that is simply a fact about you
          and cannot be gamed by anybody but yourself. Asked for by name.

          It is not shown while you are already standing in the ground: a
          signpost pointing at the room you are in is furniture. */}
      {/* WHAT IS FORMING OVERHEAD — the way up, at the top edge, while you
          stand at headquarters (founder, 2026-08-25: "have a carrot and text
          to say philosophies and value to indicate sth will start forming up
          there"). Top of mind is current; philosophies and values are
          timeless, and the timeless half takes long enough to form that for
          now the place mostly says so. The door exists anyway, because a
          person can go and see that it is empty and why — a place is honest
          where a promise in a tooltip is not.

          ON EVERY WALL, NOT ONLY YOUR OWN (founder, 2026-08-27: "philosophies
          & value should be available on every page since every room will
          eventually have its own philosophies and values"). It was gated to
          your own column because yours was the only sky that could hold
          anything. That was a fact about how much had been built, and it had
          hardened into a rule about whose thinking has a timeless half — which
          is the opposite of what a room is for. The way up is a door to a
          place that says honestly what it holds, and that is as true standing
          in somebody else's room as in your own. */}
      {phase === "ready" && !inField && !inSky ? (
        <button
          type="button"
          /* THE SIGNPOST CARRIES THE SKY'S STATE. Dim, it is a door to a
             place still forming; lit, the sky above this wall holds your
             values now — light is the only meaning channel, so the word
             itself is the announcement (founder, 2026-09-01: "make it more
             clear that philosophies and values page exists above"). Only
             your own wall's sky can hold anything yet, so it lights only
             there. */
          className={
            (atWall.kind === "self" ? principles.length > 0 : (groupPrincipleCounts[atWall.id] ?? 0) > 0)
              ? "jar-values jar-values--held"
              : "jar-values"
          }
          data-jar-chrome="1"
          onClick={() => simApiRef.current?.toSky()}
        >
          <PrinciplesShortcutLabel locale={locale} count={atWall.kind==='self'?principlesRead?principles.length:null:groupPrincipleCounts[atWall.id]??null}/>
        </button>
      ) : null}

      {/* AND WHAT THE SKY SAYS, STANDING IN IT. One sentence, in prose. The
          numeral law needs nothing here: what is forming is not countable
          yet, which is the whole point of the sentence. */}
      {/* AND THE WAY BACK DOWN IS A CARET AND NOTHING ELSE (founder,
          2026-08-25: "from the sky, just have a carrot icon to go back
          down"). Up here there is one other place and you came from it — a
          name beside the mark would be telling somebody where they live. */}
      {phase === "ready" && inSky ? (
        <button
          type="button"
          className="jar-up jar-up--down"
          data-jar-chrome="1"
          aria-label={say("worldBackDown")}
          onClick={() => simApiRef.current?.toTop()}
        >
          <span className="jar-caret" aria-hidden="true" />
        </button>
      ) : null}

      {/* THE REACH. See its note above `reachable` — this is the ground made
          addressable without a pointer, and it is deliberately drawn nowhere.

          A listbox rather than a row of buttons, because that is what it is:
          one thing selected out of many, one tab stop for the whole ground,
          and the cursor named by `aria-activedescendant` rather than by moving
          real focus between two thousand elements.

          It sits beside the door in the DOM so the tab order reads the way the
          world does — the chrome, then the way in, then what is behind it. The
          two are never on screen together: the door is the way INTO the ground
          and this is the ground itself.

          WHAT A SIGHTED PERSON SEES when focus lands here is the orb lighting
          up, out in the field, because that is where the content is. There is
          nothing to outline: the element has no size and never did. */}
      {phase === "ready" && inField && reachable.length > 0 ? (
        <div
          className="sr-only jar-reach"
          role="listbox"
          tabIndex={0}
          aria-label={say("worldReachLabel")}
          aria-activedescendant={reachId ? `jar-reach-${reachId}` : undefined}
          onFocus={onReachFocus}
          onKeyDown={onReachKey}
        >
          {reachable.map((m) => (
            <div
              key={m.id}
              id={`jar-reach-${m.id}`}
              role="option"
              aria-selected={m.id === reachId}
            >
              {m.label}
            </div>
          ))}
        </div>
      ) : null}
      {phase === "ready" && inField && atWall.kind === "self" &&
        inspirations?.some((item) => item.reflectionCount > 0) ? (
          <div className="jar-reflection-key jar-label" data-jar-chrome="1">
            <span className="jar-reflection-key-dot" aria-hidden="true" />
            {say("worldReflected")}
          </div>
        ) : null}
      {/* the sky's sentence used to mount here, on arrival; it stands in each
          wall's own column now — see the block inside `.jar-wallcol` */}

      {/* AND THE WAY BACK UP, at the top edge, while you are in the ground
          (founder, 2026-08-25: "add carrot to go up at top of the screen when
          at ground"). The count and its caret point DOWN from headquarters and
          then get out of the way; this is the same promise aimed the other
          way, and it is the only thing on screen down here that says the world
          continues above you. Its opposite number never shows at the same
          time — one of the two is always the wrong direction. */}
      {phase === "ready" && inField ? (
        <button
          type="button"
          className="jar-up"
          data-jar-chrome="1"
          aria-label={say("worldBackUp")}
          onClick={() => simApiRef.current?.toTop()}
        >
          <span className="jar-caret jar-caret--up" aria-hidden="true" />
        </button>
      ) : null}

      {/* NOT IN THE SKY (founder, 2026-08-25: "30 inspirations should be gone
          from here"). It is the door into the ground, printed with how much
          is behind it — and from up here the ground is two sections away, so
          it was a door to somewhere you cannot get to in one step, sitting
          under a sentence about the timeless half of a mind. */}
      {phase === "ready" && ((!inField&&!inSky&&wallCount>0)||(atWall.kind==='self'&&(fieldLoading||fieldFailed))) ? (
        <button
          type="button"
          className={atWall.kind==='self'&&fieldFailed?'jar-saved jar-saved--retry':'jar-saved'}
          data-jar-chrome="1"
          disabled={atWall.kind==='self'&&fieldLoading}
          onClick={() => atWall.kind==='self'&&fieldFailed?retryFieldRef.current?.():simApiRef.current?.toGround()}
        >
          <span className="jar-saved-count">
            {/* TWO NUMBERS ONLY WHEN THEY DISAGREE. Under the ceiling — which
                is where every account lives for a long time — this is exactly
                what it always was: one number and the word. Past it, the door
                stops printing the size of what arrived as though it were the
                size of the archive. */}
            {atWall.kind==='self'&&fieldFailed?say('worldRetryInspirations'):atWall.kind==='self'&&fieldLoading?say('worldOpeningInspirations'):wallTotal > wallCount
              ? formatMessage(locale, "worldInspirationCountCapped", {
                  shown: wallCount,
                  total: wallTotal,
                })
              : formatMessage(locale, "worldInspirationCount", { count: wallCount })}
          </span>
          {!(atWall.kind==='self'&&fieldFailed)?<span className="jar-caret" aria-hidden="true" />:null}
        </button>
      ) : null}

      {/* The mouth belongs below the companion, but a person can also be in
          the ground, the sky, or the room's past. From there the same act is
          one quiet shortcut back to now and into the existing composer. */}

      {/* THE STRIP OF WALL NAMES IS GONE (founder, 2026-08-25: "remove").
          It listed every wall along the bottom edge and lit the one you were
          on. I argued to keep it — on a first account its two marks were the
          only visible ways out — and the founder ruled twice, so it goes.

          WHAT KEEPS ITS PROMISE NOW, because a promise is not kept by a menu:
          up and down are on screen at all times, as `philosophies & values`
          at the top edge and the count of what you have kept at the bottom.
          Sideways is `.jar-way`, the neighbour's own name printed in the
          margin it lives past — which only exists when there IS a neighbour,
          and a first account has none to point at. So the case the strip was
          protecting is the case where sideways means nothing yet. The wall
          list under the name at the top left carries the rest, including the
          way to make another place. */}

      {/* WHICH KIND OF PLACE — asked once, with room to say what each is.
          A room and an agent are both a new column on the axis and they are
          nothing like each other: one is people, one is a machine that writes
          on its own wall. Two words in a strip could not carry that, so the
          choice is made here, where a sentence fits. */}
      {newPlace ? (
        <>
          {/* THE WAY OUT IS THE WORLD (founder, 2026-08-27: "remove not now
              button. if click outside modal, close it"). A dialog offering
              two places to go does not need a third control saying you would
              rather stay — pressing anywhere that is not the dialog says that
              already, and says it in the gesture a person already has. The
              sheet is transparent and covers everything, so the world behind
              it is what you press. Escape works too, and always did. */}
          <div
            className="jar-newplace-away"
            data-jar-chrome="1"
            aria-hidden="true"
            onPointerDown={() => setNewPlace(false)}
          />
        <DialogSurface
          className="jar-seek jar-newplace"
          onClose={() => setNewPlace(false)}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldMakeAnotherPlace")}
        >
          <p className="jar-prov-lead jar-label">{say("worldMakeAnotherPlace")}</p>
          <button
            type="button"
            className="jar-newplace-row"
            onClick={() => {
              setNewPlace(false);
              setGroupForm({ mode: "make", text: "", busy: false, error: null });
            }}
          >
            <span className="jar-newplace-name">{say("worldARoom")}</span>
            <span className="jar-newplace-what">{say("worldRoomWhat")}</span>
          </button>
          <button
            type="button"
            className="jar-newplace-row"
            onClick={() => {
              setNewPlace(false);
              setAgentName("");
            }}
          >
            <span className="jar-newplace-name">{say("worldAnAgent")}</span>
            <span className="jar-newplace-what">{say("worldAgentWhat")}</span>
          </button>
        </DialogSurface>
        </>
      ) : null}

      {/* ---------------- THE REFLECTION, ON ITS OWN ----------------
          Founder, 2026-08-25: "have reflect workflow in modal."

          Reflecting from the CARD stays inside the card, because the memory
          is already open and the question belongs under its words. Reflecting
          from the MOUTH had no card, so it borrowed one — it selected the orb
          it had just made, which dragged the whole reading panel open to hold
          one question, with the memory's words, its verbs, its date and its
          visibility arranged around a textarea. You had just typed those
          words. You do not need them read back to you to answer a question
          about them.

          So it is its own sheet, in the shape this world already uses for a
          moment that owns the screen — the same one the seek line and the
          delete ask wear. It says what was kept, asks, takes the answer, and
          goes. */}
      {reflectOn ? (
        <DialogSurface
          className="jar-seek jar-reflect-room"
          onClose={() => setReflectOn(null)}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldReflectOnKept")}
        >
          <p className="jar-prov-lead jar-label">{say("worldSavedLead")}</p>
          {/* what it was, in one line: enough to know which memory this is
              about, never the whole thing back */}
          <p className="jar-reflect-on">{reflectOn.text}</p>
          <ReflectionFlow
            key={reflectOn.id}
            inspirationId={reflectOn.id}
            scope={storageScope}
            source={reflectOn.attachments.length ? <InspirationAttachments items={reflectOn.attachments} locale={locale} /> : undefined}
            processing={sourceProcessing.active?.inspirationId === reflectOn.id ? sourceNotice : null}
            initialTurns={[]}
            locale={locale}
            onSaved={reflectionSaved}
            onSynchronized={(row) => synchronizeReflections(reflectOn.id, row)}
            onRemoved={(id) => reflectionRemoved(id, reflectOn.id)}
            onDone={() => setReflectOn(null)}
          />
        </DialogSurface>
      ) : null}

      {storageScope&&viewNavigation.view?.reviewId?<ReviewPanel key={`${storageScope.accountId}:${storageScope.profileId}:review`} scope={storageScope} id={viewNavigation.view.reviewId} thoughtId={viewNavigation.view.reviewAnswerId} locale={locale}
        onSaved={reflectionSaved} onSynchronized={synchronizeReflections} onReflectionRemoved={reflectionRemoved} onInspirationRemoved={inspirationRemovedFromView}
        onId={id=>viewNavigation.write({...EMPTY_VIEW,reviewId:id},{replace:true})} onClose={viewNavigation.closeReview}
        onNewInspiration={()=>viewNavigation.write({...EMPTY_VIEW,compose:true},{replace:true})}
        onOpenPrinciple={id=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:id})}
        onOpen={id=>viewNavigation.write({...EMPTY_VIEW,section:'field',inspirationId:id})}/>:null}
      <div className={`jar-personal-shortcuts${!inField&&!inSky&&wallCount>0&&(!atNow||(charSay!==''&&!mouthOpen))?' jar-personal-shortcuts--above-count':''}`}
        hidden={Boolean(panelOpen||mouthOpen||reflectOn||seek!==null||viewNavigation.view?.reviewId||viewNavigation.view?.conversationId||viewNavigation.view?.sharePrinciple)}>
      {phase==='ready'&&!offline&&storageScope&&atWall.kind==='self'&&(inField||inSky)&&!viewNavigation.view?.reviewId?<button type="button" className="jar-review-shortcut" data-jar-chrome="1"
        onClick={()=>viewNavigation.write({...EMPTY_VIEW,reviewId:'new'})}>{reviewEntry.label}</button>:null}
      {phase==='ready'&&(inField||inSky||!atNow||(charSay!==''&&!mouthOpen))?<button type="button" className="jar-capture-shortcut jar-label" data-jar-chrome="1" onClick={startNewInspiration}>
        <HomeActionIcon kind="capture"/> {say('worldCaptureInspiration')}</button>:null}
      {phase === 'ready' ? <button type="button" className="jar-find-shortcut" data-jar-chrome="1"
        onClick={() => setSeek('')} aria-label={say(atWall.kind === 'group' ? 'worldFindYourInspirations' : 'worldFindInspiration')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
        <span>{say(atWall.kind === 'group' ? 'worldFindYourInspirations' : 'worldFindInspiration')}</span>
      </button> : null}
      </div>
      {seek !== null ? (
        <InspirationSearch profileId={atWall.kind === 'agent' ? atWall.id : storageScope?.profileId ?? viewerIdRef.current ?? 'fixture'}
          query={seek} locale={locale} label={atWall.kind === 'group' ? say('worldFindYourInspirations') : undefined}
          onQuery={setSeek} onClose={() => setSeek(null)} onPick={openSearchResult} />
      ) : null}
      {storageScope&&viewNavigation.view?.principleId&&viewNavigation.view.sharePrinciple?<PrincipleShare
        key={`${storageScope.accountId}:${storageScope.profileId}:${viewNavigation.view.principleId}`} scope={storageScope}
        id={viewNavigation.view.principleId} name={auth?.profile?.name??''} locale={locale} onClose={viewNavigation.closeShare}
        onChoose={id=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:id,sharePrinciple:true},{replace:true})}/>:null}

      {/* MAKING OR JOINING A ROOM. A form, and it is honest about being one:
          typed text, a submit and an error line all need to reflow and be
          reachable by keyboard, and none of that survives being painted into
          the layout. So it is DOM, it sits over the layout rather than inside
          it, and the layout holds perfectly still behind it. */}
      {groupForm ? (
        <DialogSurface className="jar-roomform" data-jar-chrome="1"
          aria-label={say("worldARoom")} onClose={() => setGroupForm(null)}>
          <div className="jar-roomform-tabs jar-label">
            <button
              type="button"
              className={groupForm.mode === "make" ? "is-on" : undefined}
              onClick={() => setGroupForm({ ...groupForm, mode: "make", error: null })}
            >
              {/* "ROOM", NOT "GROUP". This repo's rule is that identifiers
                  speak canon and copy speaks human — `group` in the code,
                  `room` on the screen — and this button was the one place the
                  canon word reached a person. The comment eight lines above it
                  says "MAKING OR JOINING A ROOM", the dialog that opens it
                  offers "a room", and then the tab said Make a group.

                  Found while fixing an e2e walk that could not reach this
                  form, which is the second copy defect in two days turned up
                  by reading a surface closely for an unrelated reason. */}
              {say("worldMakeARoom")}
            </button>
            <button
              type="button"
              className={groupForm.mode === "join" ? "is-on" : undefined}
              onClick={() => setGroupForm({ ...groupForm, mode: "join", error: null })}
            >
              {say("worldJoinWithLink")}
            </button>
          </div>
          <input
            className="jar-roomform-box"
            autoFocus
            value={groupForm.text}
            placeholder={groupForm.mode === "make" ? say("worldWhatIsItAbout") : say("worldPasteTheLink")}
            onChange={(e) => setGroupForm({ ...groupForm, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGroup();
              if (e.key === "Escape") setGroupForm(null);
            }}
          />
          {groupForm.error ? <p className="jar-roomform-err">{groupForm.error}</p> : null}
          <p className="jar-ask">
            <button type="button" onClick={submitGroup} disabled={groupForm.busy}>
              {groupForm.busy ? "…" : groupForm.mode === "make" ? say("worldMakeIt") : say("worldGoIn")}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setGroupForm(null)}>
              {say("worldNotNow")}
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
                    {copied === g.id ? say("worldLinkCopied") : say("worldCopyInvite")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </DialogSurface>
      ) : null}

      {/* THE ROOM, OPENED. Who is in it, how to bring somebody, what you can
          put to them, and the way out — one surface, because they are all the
          same question: who is this with and what do we say together. */}
      {groupPanel && atWall.kind === "group" && atWall.id === groupPanel ? (
        <GroupPanel
          groupId={groupPanel}
          readingRestricted={failedGroups.has(groupPanel) || groupCacheRef.current.get(groupPanel)?.data?.top?.restricted}
          signals={wallSignalsRef.current.get(groupPanel) ?? []}
          onSignalResponse={async (signalId, value, targetRevision) => {
            await createFeedback({ targetType: 'signal', targetId: signalId, value, targetRevision });
          }}
          onRefreshSignals={async () => {
            const ready = await loadGroupRef.current(groupPanel, true);
            if (ready) setGroupReadTick((value) => value + 1);
            return ready;
          }}
          readRevision={groupReadTick}
          members={members}
          space={atWall}
          openProposals={openProposals}
          timeline={groupTimelines.get(groupPanel) ?? null}
          selectedStop={atWall.kind === "group" && atWall.id === groupPanel ? selectedGroupStop : null}
          proposalState={proposalRead?.groupId === groupPanel ? proposalRead.phase : "loading"}
          onRetryProposals={() => loadOpenProposals(groupPanel)}
          pendingProposalId={pendingProposalId}
          receipt={proposalReceipt?.groupId === groupPanel ? proposalReceipt.text : null}
          trouble={proposalTrouble?.groupId === groupPanel ? proposalTrouble.text : null}
          propose={propose}
          setPropose={setPropose}
          sendProposal={sendProposal}
          answerProposal={answerProposal}
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
        <DialogSurface
          className="jar-settings jar-settings--at-right"
          onClose={closeAccount}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldYourAccount")}
        >
          <div className="jar-settings-head">
            <span className="jar-label">{say("worldSignedIn")}</span>
            <button type="button" className="jar-settings-x" onClick={() => setAccountOpen(false)}>
              {say("worldClose")}
            </button>
          </div>

          <p className="jar-settings-name">{auth?.profile?.name ?? say("worldYou")}</p>
          {auth?.account?.email ? (
            <p className="jar-settings-note">{auth.account.email}</p>
          ) : null}

          <p className="jar-ask">
            <Link className="jar-settings-verb" to="/profile" onClick={() => setAccountOpen(false)}>
              {say("worldAllSettings")}
            </Link>
          </p>

          {/* THE LOOP'S TWO DOORS. Not flat screens, so not Links: each opens
              a panel over the world — the rules it reads you by, and the dim
              place where its refusals stand. They lived in the ≡ drawer until
              the founder removed it (2026-08-24); this sheet was already
              here, so they moved in rather than growing a new toggle. */}
          <p className="jar-ask">
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setReadingOpen(true);
                if (!theReading) {
                  fetchTheReading()
                    .then(setTheReading)
                    .catch(() => undefined);
                }
              }}
            >
              {say("worldHowItReadsYou")}
            </button>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setAntechamberOpen(true);
                setAntechamber(null);
                fetchTheWeather()
                  .then((weather) => setAntechamber(weather.antechamber))
                  .catch(() => setAntechamber([]));
              }}
            >
              {say("worldTheAntechamber")}
            </button>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                setDuplicatesOpen(true);
                setDuplicates(null);
                fetchSignalDuplicates()
                  .then(setDuplicates)
                  .catch(() => setDuplicates([]));
              }}
            >
              {say("worldGardenerAsks")}
            </button>
          </p>

          {/* THE SIX LINKS TO THE FLAT SCREENS USED TO BE HERE, and the comment
              that held them set their own condition: "they go when the world
              can do everything they do". The world can, as of 2026-08-26 — the
              screens and their eleven routes were deleted — and these were
              left behind pointing at nothing.

              Pressing one closed this sheet and dropped you back in the world
              with no message, which is the same thing the product does for an
              address that never existed. Six controls that look like doors and
              are not is the worst kind of navigation a settings sheet can
              offer, and it survived the deletion because the deletion swept
              routes and stylesheets and never swept the things POINTING at
              them. Found by walking the surfaces for the heuristic pass rather
              than by any gate. */}

          {/* SIGNING OUT IS NOT DESTRUCTIVE, so it does not ask twice — nothing
              is lost and signing back in restores everything. It is last
              because it is the one thing here that ends the session. */}
          <p className="jar-ask jar-ask--after">
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                void auth?.logout();
              }}
            >
              {say("worldSignOutLower")}
            </button>
          </p>
        </DialogSurface>
      ) : null}

      {pendingJoin && phase === "ready" ? (
        <DialogSurface
          className="jar-settings"
          onClose={closeJoin}
          data-jar-chrome="1"
          role="dialog"
          aria-label={say("worldJoinThisRoom")}
        >
          <div className="jar-settings-head">
            <span className="jar-label">{say("worldSomeoneInvited")}</span>
          </div>
          <p className="jar-settings-note">{say("worldJoinExplain")}</p>
          <p className="jar-ask">
            <button type="button" className="jar-settings-verb" onClick={acceptJoin}>
              {say("worldJoinThisRoom")}
            </button>
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={() => setPendingJoin(null)}>
              {say("worldNotNow")}
            </button>
          </p>
        </DialogSurface>
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
          trouble={groupTrouble}
          clearTrouble={() => setGroupTrouble(null)}
          viewerProfileId={auth?.profile?.id ?? null}
          copied={copied}
          copyInvite={copyInvite}
          onClose={() => setSettingsFor(null)}
          leaveThisGroup={leaveThisGroup}
          renameThisGroup={renameThisGroup}
          closeThisGroup={closeThisGroup}
          removeMember={removeMember}
          agentKeys={agentKeys}
          minted={minted}
          setMinted={setMinted}
          issueKey={issueKey}
          revoking={revoking}
          setRevoking={setRevoking}
          revokeKey={revokeKey}
          keysBusy={keysBusy}
        />
      ) : null}

      {phase === "loading" ? (
        <div className="jar-skel jar-skel-line">{say("worldPouring")}</div>
      ) : null}
      {phase === "failed" ? (
        <div className="jar-skel jar-skel-line">
          {say("worldPourFailed")}
          {failReason ? <span className="jar-skel-why">{failReason}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
