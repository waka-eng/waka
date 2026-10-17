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
import { publicWebOrigin } from '../lib/public-origins';
import { InspirationProcessingNotice } from '../components/InspirationProcessingNotice';
import { createConversation } from "../lib/api/conversations";
import { DialogSurface, leaveAsModal } from "../components/DialogSurface";
import { PrincipleEvidence } from "../components/PrincipleEvidence";
import { useNavigate } from "react-router-dom";
import { useViewNavigation } from '../lib/use-view-navigation';
import { EMPTY_VIEW, resolveViewWall, viewHref, type ViewLocation, type ViewOpen } from '../lib/view-location';
import { InspirationSearch } from '../components/InspirationSearch';

import { useDismissAway } from "../lib/dismiss";
import { isEditableTarget } from "../lib/surface-input";
import { profileStorageKey, readProfileText, writeProfileText, type ProfileStorageScope } from "../lib/profile-storage";
import { useTopOfMindRefresh } from "../lib/use-top-of-mind-refresh";
import { useInspirationProcessing } from '../lib/use-inspiration-processing';
import { useAuthoredSave } from '../lib/use-authored-save';
import { useInspirationDraft } from '../lib/use-inspiration-draft';
import { supportedRecordingType, useAudioRecording } from '../lib/use-audio-recording';
import { InspirationComposer } from '../components/InspirationComposer';
import { attachmentLabel } from '../lib/attachment-label';
import { Menu } from '../components/Menu';
import { usePageMenu, wallAgnosticView } from '../lib/page-menu';
import { HomeActionIcon } from '../components/HomeActionIcon';
import { ReadingChanges } from '../components/ReadingChanges';
import { PrincipleShare } from '../components/PrincipleShare';
import { ShareSheet, inspirationShareTarget, type ShareTarget } from '../components/ShareSheet';
import { type CreatureSpot } from '../components/CrossingCompanion';
import { prefersStillness } from '../lib/motion';
import { toolName } from '../lib/tool-name';
import { ReviewEvidence } from '../components/ReviewEvidence';
import type { ApiSignalReviewEvidence } from '../lib/api/signals';
import { InspirationAttachments } from '../components/InspirationAttachments';
import type { InspirationDraftMedia } from '../lib/inspiration-draft-store';
import type { CreateInspirationRequest } from '../lib/api';
import { createInspiration, declineHarvest, keepHarvest, listClaims, listHarvest, updateInspiration, type ApiClaim, type ApiHarvestCandidate, type HarvestReason } from '../lib/api';
import { candidateSaveRequestId } from '../lib/harvest';
import { inspirationInputMedia, inspirationLinks, inspirationWithPendingLink, removeInspirationLink } from '../lib/inspiration-input';
import { inspectInspirationPhoto, PHOTO_ACCEPT } from '../lib/inspiration-photo';
import { uploadInspirationMedia } from '../lib/inspiration-media-upload';
import { restoreInspirationDraft, settleInspirationDraft } from '../lib/authored-save-drafts';
import { AuthoredSaveNotice } from '../components/AuthoredSaveNotice';
import { acceptsReadingSnapshot } from "../lib/reading-snapshot";
import { DAY_MS } from "../lib/num";
import { GRAIN_PX, GRAIN_TILE } from "../canvas/sprites";
import { renderScale } from "../canvas/scale";
import { useEditing } from "../space/editing";
import { deriveAgentChrome } from "../space-kinds/agent";
import { buildPalette, type Palette } from "../canvas/palette";
import { SavesOverlay } from "../components/SavesOverlay";
import { DOCK_SLOT } from "../components/NoteTools";
import { AddMenu } from "../components/AddMenu";
import { inspectAttachmentFile, FileRefused } from "../lib/api/file-accept";
import { deleteAccount } from "../lib/api/auth";
import { canKeep, whyNotKept, type KeepReadiness } from "../lib/keep-ready";
import { dictationAvailable, useDictation } from "../lib/use-dictation";
import { PrinciplesOverlay } from "../components/PrinciplesOverlay";
import { ClaimsOverlay } from "../components/ClaimsOverlay";
import { ClaimSlip } from "../components/ClaimSlip";
import { HarvestReasons } from "../components/HarvestReasons";
import { AgentPick } from "../components/AgentPick";
import { ConversationsOverlay } from "../components/ConversationsOverlay";
import { ConversationPanel, CHAT_TOOLS_SLOT } from "../components/ConversationPanel";
import type { ApiConversation } from "../lib/api/conversations";
import { useMeasured } from "../canvas/measured";
/* THE CANVAS SIDE OF `SimApi`, which used to be 5,637 lines of this file.
   `startSimulation` is the loop; `SimApi` and `FieldAudit` are its published
   surfaces and moved with it because they ARE its export list. `Carry` is a
   shape that used to be written twice — once as an inline type on a `useRef`
   here and once in the loop's own teardown. (`GroupCacheEntry` was the
   second such shape and is gone with rooms: the loop declared it, this file
   imported it back to type a map that nothing ever filled, and the whole
   round trip existed to keep one `w.kind === "group"` branch compiling.) See
   the header of `canvas/simulation.ts` for why the cut is here and nowhere
   else in this file. */
import {
  startSimulation,
  SELF_WALL_NAME,
  UNWIND_MS,
  type Carry,
  type FieldAudit,
  type SimApi,
} from "../canvas/simulation";
import { setStanding as publishStanding } from "../lib/standing";
import { whyFailed as sayWhyFailed, whyOf } from "../lib/why-failed";
import { spaceKey, type Space } from "../space-kinds";
import { pourSignature } from "../space/pour-signature";
import { posterWords } from "../space/top-of-mind/poster";
import {
  deriveAmbition,
  formingWords,
  type Adopted,
  type JarNote,
  type WallChrome,
  type Provenance,
} from "../space/top-of-mind/board";
import { colorBall } from "../space/inspiration/field";
import {
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
  asSentence,
  dateStamp,
  dateWords,
  dialMonth,
  dialYear,
  monthTag,
} from "../lib/words";
import { formatMessage, normalizeSupportedLocale, t } from "../lib/locales";
import type { MessageKey, SupportedLocale } from "../lib/locales";

import {
  fetchPrinciples,
  finalizeAttachment,
  presignAttachment,
  uploadToPresignedUrl,
  deleteInspiration,
  createFeedback,
  releaseSignal,
  dismissTopOfMindEntry,
  restoreTopOfMindEntry,
  releaseTopOfMindEntry,
  /* `updateInspiration` HAD TWO CALLERS and lost both: the memory's own
     editor (which sent `text`) and `togglePublic` (which sent `visibility`).
     Its one caller here now is the harvest keep, which corrects the words of
     a save it already made rather than making a second (`keepCandidate`). */
  fetchProfiles,
  /* `ApiGroupMember` and `ApiGroupSummary` STOOD HERE and were the last two
     room shapes this file named; `ApiGroupFieldInspiration` was the third,
     below. All three were imported solely to TYPE EMPTY REFS the simulation
     declared as required options. With the loop's group branches out, the
     refs are gone, the types are gone, and `lib/api/groups.ts` — which had no
     other reader and no route behind it — goes with them. */
  deletePrinciple,
  disputePrinciple,
  undoPrincipleDispute,
  reorderPrinciples,
  updatePrinciple,
  type ApiPrinciple,
  fetchTheWeather,
  ApiError,
} from "../lib/api";
import { LoadingHome } from "../components/LoadingHome";
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
/* THE CONVERSATION'S OWN SHEET, loaded here because the conversation is part
   of the world now. It used to be imported by `pages/Chat`, and deleting that
   page took the entire stylesheet out of the bundle with it — the transcript
   rendered with no styling at all for one commit. A surface that moves has to
   bring its sheet. */
import "../styles/chat.css";

/**
 * How many dates the dial will list before it rolls up a grain — days to
 * months, months to years. Ten is what fits under the word without the list
 * becoming a thing you scroll, which would be the hunt all over again.
 */
const DIAL_STOPS = 10;
/**
 * HOW LONG THE CREATURE HOLDS ITS OFFER UP BEFORE GOING BACK TO THE READING.
 *
 * Founder: "the time to go back to the top of mind should be so much shorter,
 * like half what it is right now."
 *
 * Six seconds was argued from reading speed — four to read the sentence, a
 * beat to reach for it — and that reasoning is about the wrong thing. The
 * sentence is five words and the person pressed the creature a moment ago,
 * so they are not reading it cold; they are deciding, and a decision not
 * made in three seconds is a no. What the extra three seconds actually did
 * was hold the ONE THING THIS SCREEN IS FOR off the screen — the top of mind
 * is the product's output and the offer is an interruption of it, however
 * welcome. An interruption should be the shorter of the two.
 */
/* WHAT A PRESS ON THE CREATURE RACES AGAINST. `sayTheWeather` fetches, so
   the sentence for press N arrives after press N+1 has already asked for a
   different one — and on a fast double-press the two resolutions land out of
   order and the bubble swaps under the hand. Founder, with a recording:
   "there are like glitches sometimes in the speech bubble when I click on it
   too fast."

   Every press takes a number; a resolution that is not the current number is
   dropped. This is the same guard `ConversationPanel` spells `mine(owner)` —
   a late answer to a question nobody is asking any more is not an answer. */
let speechEpoch = 0;

/* How long the creature will wait for the weather before saying its own
   line. Short enough that a press never feels unanswered, long enough that
   a healthy request answers first and nothing flickers. */
const SPEAK_GRACE_MS = 220;
/* HOW LONG THE CREATURE STAYS BRIGHT AFTER A PRESS. Long enough to cover the
   fetch on a normal connection, so the light and the sentence read as one
   event rather than two. */
const LIT_MS = 1400;
/** How far the creature is pulled right, in CSS px, before the pull is the walk to Principles. */
const CREATURE_PULL = 56;

/* HOW LONG A PAUSE IN TYPING COUNTS AS FINISHING A NAME. Long enough that
   a normal hesitation mid-word does not write, short enough that closing
   the card straight after typing cannot beat it. */
const NAME_SETTLE_MS = 700;
/**
 * HOW LONG THE BUBBLE STAYS DOWN WHILE THE CREATURE CHANGES FORM.
 *
 * Founder: "when the character is spinning from me to my agent, the speech
 * bubble should be gone and it should reappear."
 *
 * Right, and the canvas already agreed with them: the form change hides
 * inside a half turn, and the comment on it forbids any frame where two
 * creatures are both in focus. The bubble was the one part of the companion
 * that did not turn — it hung in the air, unchanged, over a body dissolving
 * into somebody else's, and announced that the words and the creature were
 * two unrelated objects.
 *
 * It covers the turn (`UNWIND_MS`) rather than the dissolve (`FORM_FADE_MS`),
 * because what the eye follows is the turn: the dissolve finishes while the
 * creature is still facing away, and bringing the bubble back then would put
 * words over the back of its head.
 */
const FORM_HUSH_MS = UNWIND_MS;
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
  opts: { strict?: boolean; onReadingFailed?: () => void } = {},
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
              /* forgiving, but not silent: the caller must be able to
                 tell "formed nothing" from "could not ask" */
              loadTopOfMind(p.id).catch(() => { opts.onReadingFailed?.(); return null; }),
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
   dismissal, and treating it as one closes and reopens in the same press.

   `KEEP_SHEET` IS GONE WITH ITS TWO SHEETS. It read `[".jar-settings",
   ".jar-seek"]` and guarded the space-settings panel and the join sheet,
   both of which went with rooms on 2026-10-12. CORRECTION (2026-10-15): this
   said `.jar-settings` "is still WORN — the search sheet and the composer's
   asks use the class". IT IS NOT. Both of those wear `.jar-seek`; no markup
   in `src` carries the bare class. (`.jar-settings-warn` was named here as
   the surviving suffixed one; it has since been deleted with the dialog that
   wore it — `SettingsPanel`'s own trouble line wears `waka-account-failed`.)
   Nothing
   registers a dismissal against it either, so a list naming it here would
   have been a guard for no hook on a class with no wearer. */
const KEEP_PROV = [".jar-prov-room", ".jar-panel"] as const;

/** The world's lines about there being little or nothing kept yet. */
const NOTHING_LINES: ReadonlySet<MessageKey> = new Set<MessageKey>(['worldSayEmpty1', 'worldSayEmpty2', 'worldSayQuiet1', 'worldSayQuiet2', 'worldSayQuiet3', 'worldSayYoung1', 'worldSayYoung2']);

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
  const [navigationProblem, setNavigationProblem] = useState<'retryable' | 'unavailable' | null>(null);
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
  /* Written by the field loader, read by nothing on this screen any more:
     the archive is a page now and reports its own failure there. */
  const [,setFieldFailed]=useState(false);
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

  /* `wallSignalsRef` — room id → the statements hanging on its wall, with
     whose they were — is gone with rooms. */
  const [adopted, setAdopted] = useState<Adopted | null>(null);
  /** What the adopted ambition was built from: signal id → its quote. */
  const [provenance, setProvenance] = useState<Provenance>(new Map());
  /* `proposal` IS GONE, AND IT HAD ALREADY STOPPED BEING SET. It was the
     room's pending proposal — a whole ambition trying to replace the adopted
     one, and the only candidate that could actually BE adopted, which is why
     it carried the ids the adopt call needed. Its one writer was the dev
     fixture, writing `null`. Everything that read it fed
     `formingWords(…, proposalMs, …)`, which now receives `null` at both call
     sites; see `space/top-of-mind/board.ts` for why that parameter stays. */
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
  const [charSay, setCharSayNow] = useState("");
  /**
   * ═══ NOTHING SPEAKS WHILE THE CREATURE IS CHANGING FORM ════════════════
   *
   * Founder, reporting this as a REGRESSION against a ruling they had
   * already given: "did I not tell you that when I'm switching between me
   * and my agent the speech bubble should be gone? Sometimes it's not gone.
   * So most times it works properly, but sometimes the speech bubble stays
   * on so maybe it's a bug."
   *
   * The ruling WAS implemented — see `turning` and `FORM_HUSH_MS`, which put
   * the top-of-mind bubble down for the length of the turn. What it could not
   * cover is the OTHER bubble: `charSay` is written from about twenty places,
   * most of them the tail of a promise, and a promise that was started on the
   * wall you just left lands on the wall you just arrived at. The turn is
   * 650ms; a fetch is longer than that about as often as it is shorter, which
   * is exactly "most times it works properly".
   *
   * SO THE SEAL IS ON THE WRITE, NOT ON THE RENDER. The obvious shape —
   * hiding the aside bubble while `turning` — is wrong in a way worth
   * recording: the stale sentence would still be in state, so it would pop
   * UP the moment the hush expired, which is the reported bug with an extra
   * 650ms of delay. A write that arrives during a turn is answering a
   * question asked on another wall, and the honest thing to do with it is
   * drop it.
   *
   * CLEARING IS ALWAYS ALLOWED. The seal exists to stop words appearing over
   * the back of a turning creature; silence is never the thing it is
   * protecting against, and `setCharSay('')` runs from the notepad, from
   * drafts and from the 4s whisper timer, none of which may be deferred.
   *
   * Every call site keeps writing through `setCharSay` and is unchanged —
   * the guard is the setter itself, because a rule that has to be repeated
   * at twenty call sites is a rule that will be missed at the twenty-first.
   */
  const speechSealed = useRef(false);
  const setCharSay = useCallback((next: string) => {
    if (next !== "" && speechSealed.current) return;
    setCharSayNow(next);
  }, []);
  /**
   * ═══ THE CREATURE WAS JUST PRESSED, AND IS OFFERING ════════════════════
   *
   * Founder: "clicking on the character should just make it shine and bright,
   * and maybe we can change the speech bubble from the top of mind content to
   * 'feeling inspired? save inspiration', and then a few seconds later it can
   * come back to top of mind."
   *
   * This replaces a press that went straight into the notepad. The press is
   * an ANSWER now rather than a door: you poke it, it lights up and offers,
   * and the offer is the thing you press to write. One extra press buys the
   * gesture its whole character — a creature that reacts is a creature, and
   * one that teleports you to a form is a button with a face on it.
   *
   * THE RETURN IS NOT THE WORLD MOVING ON ITS OWN. The law is that nothing
   * changes unless the person moved it, and they did: this whole sequence is
   * one press and its settling. What would break the law is a bubble that
   * cycled unprompted, which is why the rotation the founder asked about
   * earlier — "once in a while show the pencil icon?" — was answered with
   * state rather than a timer.
   */
  /* THE OFFER IS GONE. Founder, for the fourth time, with a screenshot of
     the creature holding "Feeling inspired? Save it.": "an agent should
     never prompt user to save something."
     It was half of this press's rotation, which is why removing it also
     ends the two-state swap the bubble was glitching between. See
     `creatureSpeaks`.

     THE SHINE IS NOT GONE WITH IT, and the distinction is the founder's own:
     "clicking on the character should just make it shine and bright" was
     liked; the sentence it used to raise was not. So what `offering` drove
     visually survives as exactly that and nothing else — a creature that
     brightens while it is answering you. It is purely a light, so it carries
     no words and opens no page; `charSay` is what arrives. */
  const [lit, setLit] = useState(false);
  const litTimer = useRef<number | null>(null);
  /* BOTH OF THE PRESS'S TIMERS, not just the glow's. A press starts two:
     `litTimer` for the glow, and the grace timer in `sayTheWeather` that
     speaks the local line if the weather is slow. Only the first was
     cleared here, so a press followed by an unmount inside 220ms left one
     pending — measured: exactly one survivor, writing `setCharSay` into a
     page that has gone. React says nothing about it and the write is
     invisible, so this is housekeeping rather than a bug; but this file
     holds itself to clearing its press timers, and that has to mean all of
     them or the rule is decoration. */
  const graceTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (litTimer.current !== null) window.clearTimeout(litTimer.current);
    if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
  }, []);
  /** The loop's own fallback line, reachable from a press. Assigned inside
      the frame effect, where it is written. */
  const sayLineRef = useRef<(() => string) | null>(null);
  const sayLineKeyRef = useRef<{ line: string; key: MessageKey } | null>(null);
  /** Which thing the next press says. */
  const creatureTurn = useRef(0);
  /**
   * ═══ PRESSING IT KEEPS CHANGING WHAT IT SAYS ═══════════════════════════
   *
   * Founder: "clicking on the character should keep changing what it says.
   * Like, I see, like, feeling inspired, save it, and that's like your
   * memory was consulted the X times, blah blah blah."
   *
   * THE ROTATION ALREADY EXISTED AND WAS UNREACHABLE, which is the part
   * worth recording. `sayTheWeather` walks the day's clauses one per press
   * (`weatherTurnRef`), and `sayLine` below picks a fresh field line and
   * never repeats the last one. Both were wired to the CANVAS hit-test —
   * and `.jar-char-press`, an invisible disc, sits on top of the canvas and
   * took every press for itself, showing the save offer and nothing else.
   * So the product had two things to say, a mechanism for alternating them,
   * and a button over the top that said one of them forever.
   *
   * One target, one rotation. The offer first, because that is the order
   * the founder listed and because saving is what the screen is for; then
   * what has been happening, which is the record talking rather than the
   * product asking.
   */
  const creatureSpeaks = useCallback(() => {
    creatureTurn.current++;
    /* ONE THING, NOT TWO ALTERNATING. The rotation used to be offer, then
       weather, then offer — and the offer was "Feeling inspired? Save it.",
       which the founder has now struck four times. With it gone there is one
       kind of answer and the press simply turns the page of the record.

       THAT IS ALSO THE GLITCH FIX, and it is worth saying why rather than
       taking the luck. Two states meant two writers: `offering` was
       synchronous and `charSay` arrived from a fetch, so a fast press could
       raise the offer and then have the previous press's sentence land on top
       of it — the bubble's first branch requires `!charSay`, so the whole
       bubble was torn down and rebuilt mid-press. One writer cannot do that
       to itself; the epoch below handles two presses of the same kind. */
    speechEpoch += 1;
    /* A PRESS IS A QUESTION ASKED ON THE WALL YOU ARE ON NOW, so it lifts
       the switch's seal (see the effect on `wallAddress`). Without this, the
       650ms of quiet a wall change buys would also swallow the answer to a
       press made inside it — which is reachable, because the press target
       stays on screen while you walk between rooms even though it is pulled
       during a form turn. The seal is for sentences from BEFORE the switch;
       this one is from after it. */
    speechSealed.current = false;
    setLit(true);
    if (litTimer.current !== null) window.clearTimeout(litTimer.current);
    litTimer.current = window.setTimeout(() => setLit(false), LIT_MS);
    const fallback = sayLineRef.current;
    if (fallback) sayTheWeatherRef.current(fallback);
  }, []);

  /* WHETHER THE DOCK'S PLUS IS OPEN. A press on a place is navigation and
     lives in the address; a press on the plus is not going anywhere yet, so
     it stays here — putting it in the URL would make "I was about to make
     something" a page you could link to and come back to. */
  /** The picker the dock's making-slot opens while a note is being written. */
  /** Which saves the archive is showing, when it was opened by asking a
      claim where it came from. Cleared by its own control and by leaving. */
  const [savesFocus, setSavesFocus] = useState<{ label: string; ids: readonly string[] } | null>(null);
  /* The box's own measured height, kept across frames so the layout pass can
     place the box before it has re-measured it this frame. `MOUTH_H` is the
     first-paint fallback and nothing more. */
  const slotH = useRef(0);
  /* The panel and the selection are ONE state: opening is selecting, and
     closing — by Esc, by a tap on the dimmed field, by tapping the same orb
     again — releases. It lags `selectedId` at BOTH ends: it does not appear
     until its content is whole, and it stays mounted through its fade-out. */
  const [panel, setPanel] = useState<PanelData | null>(null);
  /**
   * A SAVE OR THE TOP OF MIND, BEING MADE INTO A CARD.
   *
   * Founder, 2026-10-15: "share an inspiration, share their current top of
   * mind or share their principle ... a preview, save it to share as an
   * image." Principles keep their own address (`/principles/:id/share`)
   * because a principle card has drafts and a set; these two are one card
   * made in one sitting, so they open over whatever was in front of you
   * and close back to it.
   */
  const [thingShare, setThingShare] = useState<ShareTarget | null>(null);
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
  /** Whether the top-left split button is listing the other walls. */
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

  /* HOLDING WAS A PRESS AND IS NOT ONE NOW. `holdLead` lived here and set
     `pinned`, behind a verb the founder twice said they could not read — "i
     dont get what these 4 options mean (held up isnt even clickable)" — and
     then named the three that should be here without it: "let user either
     edit it or remove it and ask it to reread". The client
     (`holdTopOfMindEntry`), its endpoint and the board's reading of `pinned`
     are all untouched; what went is the control, because a callback with no
     caller is the unreachable shape this file keeps deleting elsewhere. */

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
  /* `groups` and `groupRosterReady` are gone with the axis's right-hand
     side. The axis is agents, then you, and it stops there. */
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
  /* `wokenGroups`, `groupFieldTick` and `failedGroups` are gone: the three
     pieces of state a room's asynchronous arrival needed — its words exist
     now, its ground just landed, its data could not be fetched. `setMembersRef`
     went with them in the same pass as the loop's group branches: it was a
     setter declared above the state it set, crossing a declaration-order
     boundary that only existed because a room's members were fetched far
     below and drawn by a frame loop installed far above. */
  /** Which wall the camera is standing on. Discrete, pushed from the loop. */
  const [atWall, setAtWall] = useState<Space>({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 });
  /**
   * WHERE YOU ARE STANDING, KEPT OUTSIDE THE LOOP.
   *
   * The simulation is rebuilt whenever its inputs change, and the case that
   * made this necessary is worth keeping even though its cause is gone:
   * `groupFieldTick` fired exactly when a room's memories arrived, so the
   * data you travelled to fetch was itself what cancelled the journey — the
   * effect tore down mid-glide and the new one started at `col = 0`, walking
   * you home. First visits were the only ones affected, because a second
   * visit was served from cache and ticked nothing, which is why it read as
   * "some rooms never load" rather than as a travel bug. The agents' bundles
   * arrive the same way.
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
  /* THE SHAPE IS `Carry`, IN `canvas/simulation.ts`, AND NOT A SECOND COPY OF
     IT HERE. It was spelled out inline on this line and built by hand in the
     loop's teardown — two spellings of one contract, and the loop is the end
     that knows what belongs in it. The ref stays here because it is what
     SURVIVES the loop: a rebuild reads it before the next run has anything. */
  const carryRef = useRef<Carry | null>(null);
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
  /* ═══ WHAT THE BAR NEEDS TO KNOW ABOUT A NOTE BEING WRITTEN ════════════
     Three facts, derived HERE rather than in the dock's own markup, because
     they are facts about the draft and the draft lives here. The dock is a
     thousand lines down the file and two of these are the same conditions
     the composer's submit already guards on — computing them twice, in two
     places, is how a Save that is enabled and a `keepIt` that returns on its
     first line end up disagreeing. */
  /** Whether there is anything to keep at all. The composer's own `empty`,
      which also counted a pending link; a link typed into the words is
      already in `draft`, and `linkText` is only ever set while the restored
      link field is open. */
  const composerHasWords = Boolean(draft.trim() || inputMedia.length || (composerDraft.draft.linkText ?? '').trim());
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
  /* ═══ A KEPT THING IS NOT PUBLISHED FROM THE COMPOSER ══════════════
     Founder: "everything regarding public and private should also not be a
     thing in this new experience."

     AND IT HAD ALREADY STOPPED WORKING, which is why this is a deletion
     rather than a decision. `keepPublic` was handed to the composer as
     `public` and `setKeepPublic` as `onVisibility`, and
     `InspirationComposer` declares both props and READS NEITHER. So the
     setter had no caller anywhere in the product and the value was frozen
     at whatever a legacy storage key held — the same shape as the `onPast`
     prop that file's own header records. A control nobody can reach,
     deciding something on every save. */
  const [mouthOpen, setMouthOpen] = useState(() => readProfileText(storageScope, "draft") !== "");
  /* The attachment drawer's disclosure. Open on arrival of a file — you just
     dropped it and the one thing you want is to see that it landed — and
     collapsible from there, which is the only state the pattern's count
     badge is for. */
  const [drawerOpen, setDrawerOpen] = useState(true);
  /**
   * WHY THIS MOMENT, ASKED WHILE THE MOMENT IS STILL IN YOUR HANDS.
   *
   * Founder: people share photos of their most inspiring moments, and "as
   * they upload each photo" they say why it felt special. At upload, not
   * later in a queue — a photo you chose ten seconds ago is a thing you can
   * still answer about, and the same photo next Tuesday is a thing you have
   * to reconstruct.
   *
   * It rides the save as a REFLECTION, which already exists as "the short
   * human-authored Q&A hanging off a capture… the person's own words, and
   * input to extraction". So the answer is not a caption sitting beside the
   * picture — it is material the reading is drawn from, which is the only
   * reason it is worth asking for.
   */
  const [momentWhy, setMomentWhy] = useState("");


  /**
   * THE CLAIM THE COMPANION IS HOLDING.
   *
   * Founder: claims belong on the top of mind, shown as the agent asking you
   * to confirm — "I want the top of mind to be where the user always starts
   * their journey." So there is no claims page to visit: the one thing WAKA
   * needs from a person and cannot do alone is asked where the person already
   * is, by the thing that did the reading.
   *
   * ONE AT A TIME. The queue is fetched a page deep so answering can advance
   * without a round trip, but only the head of it is ever on screen — the
   * founder's own rule for this surface is one line at a time, and a list of
   * claims under the character would be the dense version of exactly the
   * thing that ruling removed.
   */
  /* Whose wall a verdict is being given on, read at the moment of the press
     rather than closed over — `sayVerdict` is built once and the wall moves
     under it. */
  const answeringAsRef = useRef<string | undefined>(undefined);
  const [claimQueue, setClaimQueue] = useState<ApiClaim[]>([]);
  /**
   * WHAT A COLLECTOR PICKED FROM YOUR DAY, WAITING TO BE KEPT OR LET GO.
   *
   * Founder, 2026-10-15: claims "change depending on where it came from".
   * A reading WAKA made of you asks "still true?"; a sentence of your own
   * that a collector picked asks "keep this?", and a no asks why. Both stand
   * in the one slot, one at a time, and these go first: a candidate's words
   * are deleted after a week unchosen, and a reading has no clock.
   */
  const [harvestQueue, setHarvestQueue] = useState<ApiHarvestCandidate[]>([]);
  /* ═══ REVIEW IS SOMETHING YOU STEP INTO ═══════════════════════════════════
     Founder, 2026-10-15: "the entry point into the card swipe left and right
     should be the agent should say 'there are x things to review!' and the
     CTA becomes 'Dive into review' or sth like this, which makes the card
     swipe be the main action of the page." So the cards are not lying on the
     home screen waiting to be noticed: the creature says how many there are,
     and the press is the way in. While `reviewing`, the cards are the page —
     the top-of-mind bubble steps aside — and the mode ends when the queue
     runs out or on Esc. */
  const [reviewing, setReviewing] = useState(false);
  /** A candidate that was swiped away and is being asked "why not". */
  const [harvestWhy, setHarvestWhy] = useState<{ candidate: ApiHarvestCandidate; busy: boolean; failed: boolean } | null>(null);
  /** What the invitation counts: your agent's picks and WAKA's readings, both swiped the same way. */
  const toReview = harvestQueue.length + claimQueue.length;
  const startReview = useCallback(() => { setReviewing(true); }, []);
  /* THE SITTING ENDS WHEN THERE IS NOTHING LEFT TO ASK — after the last
     card's own goodbye (`worldSittingDone`), not on top of a "why not" the
     person is still answering. */
  useEffect(() => { if (reviewing && toReview === 0 && !harvestWhy) setReviewing(false); }, [reviewing, toReview, harvestWhy]);
  /* THE FIRST CARD HAS FOCUS ON THE WAY IN, so ← and → answer it at once —
     the card owns its arrows only while it is focused (see `ClaimSlip`). */
  useEffect(() => {
    if (!reviewing) return;
    /* `.jar-pick-slip`, not `.jar-pick`: the wrapper takes no focus; the slip
       is what holds `tabIndex` and the keys. */
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.jar-pick-slip')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [reviewing]);
  /* THE CREATURE STEPS ASIDE WHILE THE AGENT ASKS. Founder, 2026-10-15,
     approved: on a phone the why-not list covered the lower half of the
     creature, and two characters stacked on each other muddy who is
     speaking. So while the agent asks, the creature rises a little and its
     bubble fades (`.jar--agent-asking`); answering or skipping brings it
     back, which also reads as "done". */
  useEffect(() => {
    simApiRef.current?.stepAside(Boolean(harvestWhy) && !mouthOpen);
  }, [harvestWhy, mouthOpen]);
  /* GLASSES ON FOR THE SITTING. The creature reads with you while you review
     — see `think` — and takes them off when the cards run out or you step
     out of it. */
  useEffect(() => {
    simApiRef.current?.think(reviewing && !mouthOpen);
  }, [reviewing, mouthOpen]);
  /* A candidate whose card is mid-trip, and those whose keep failed while it
     was: a failure that lands before the card has gone is held until it
     has, so the queue is never rewritten from under a card in flight. */
  const harvestLeavingRef = useRef(new Set<string>());
  const harvestReturnRef = useRef(new Set<string>());
  /**
   * CORRECTING A CLAIM — THE ONLY PLACE IN THE PRODUCT THAT TAKES TYPING
   * BESIDES THE ONE BOX.
   *
   * This state is what is left of five components (2026-10-10). Founder's
   * workflow design, on the writing-based reflection flow that used to live
   * here: *"Review isn't a smaller version of confirm — it's a different
   * mental model. Its placeholder is 'What comes to mind?'. It generates open
   * questions, collects written answers, and carries draft storage, draft
   * copying, draft discarding, and 'this device couldn't keep your draft'
   * recovery. Confirming a claim needs none of that. Typing happens in one
   * place only: when you correct."*
   *
   * So: one field, one claim, no draft lifecycle. `text` lives in memory for
   * as long as the field is open and goes to the server with the verdict it
   * belongs to. There is deliberately NO localStorage behind it — a draft
   * store is the thing that was just deleted, and re-growing one here for a
   * sentence that is two taps from being saved would be the fold undoing
   * itself. What protects the words instead is that the field does not close
   * on failure: `failed` keeps them on screen with the reason beside them.
   *
   * WHY IT HANGS OFF "NOT TRUE" AND NOT "PARTLY". Also the founder's
   * instruction — *"one text field, reached only after 'not quite'"*. Partly
   * used to open a rewrite of the claim's own wording here, and that act is
   * not lost: it still lives on the reading's ground rows, where the sentence
   * sits in its own context and rewording it is the point. In the queue,
   * partly is now exactly as cheap as yes — one press, no round trip — and
   * the generator already reads it ("a verdict of partly is an invitation to
   * sharpen, not an arbitration"; `docs/six-laws.md`, Law 10).
   */
  /* `correcting` WENT WITH THE FIELD IT HELD. It tracked which claim had its
     two-row correction textarea open, and the textarea is gone: founder,
     "when the user clicks on partly and not true, can we open a chat
     experience rather than asking user to answer in that small space?" The
     paragraphs above describe a decision about `partly` that still stands —
     it files at once, with no round trip — and the state that made "not
     true" the expensive answer has no job left; "Not anymore" files at once
     and the receipt line offers the conversation. */
  /**
   * AND THE QUEUE BELONGS TO THE WALL YOU ARE STANDING ON.
   *
   * Founder: "the claims should also be different per my agent and me no?"
   * They should, and for a sharper reason than consistency: a claim is a
   * reading of what someone has KEPT, and an agent keeps its own things on
   * its own wall. Asking you to rule on a sentence drawn from your archive
   * while you are standing in your agent's is asking the wrong person about
   * the wrong material — and the verdict would be recorded against whichever
   * profile the request happened to default to.
   */
  /**
   * AN AGENT CONFIRMS ITSELF, SO IT NEVER ASKS YOU.
   *
   * Founder: "my agent should never have claims user should confirm since
   * agent should self confirm right?"
   *
   * Right, and the reason is what a claim IS. The question on a claim is "is
   * this true of you?" — it is asking the subject to recognise themselves in
   * a sentence drawn from their own material. You are the only one who can
   * answer that about you. Handing an agent's claims to you asks you to
   * certify someone else's self-description, which is not a judgement you are
   * in a position to make and not one the loop wants: the confidence it would
   * feed back into belongs to the agent's reading, not yours.
   *
   * So standing on an agent's wall there is no queue at all. The agent's own
   * material still forms claims on the server — nothing about generation
   * changes — they are simply never put to you. The creature on that wall has
   * nothing to ask, which is also why its speech is the only thing it offers
   * there.
   *
   * NOT the same as hiding them. `undefined` would have asked for YOUR claims
   * while standing in the agent's ground — the bug this block was written to
   * stop, and the reason the queue is keyed to the wall at all.
   */
  const standingAsAgent = atWall.kind === 'agent';
  /**
   * THE BUBBLE GOES DOWN WHILE THE CREATURE TURNS, AND COMES BACK AFTER.
   *
   * Founder: "when the character is spinning from me to my agent, the speech
   * bubble should be gone and it should reappear."
   *
   * WHICH WALL YOU ARE ON is the only honest trigger available here. The
   * dissolve itself lives in the canvas loop — `form.prevBody`, `form.at` —
   * which is a ref the render never reads and must not start reading, because
   * the loop writes it at sixty hertz and a state mirror of it would re-render
   * the whole world every frame. The wall changes on the same beat the turn
   * is armed (see `arriveColumn`), so watching the wall watches the turn.
   *
   * CLEARED ON UNMOUNT AND ON THE NEXT CHANGE, so a fast switch back and
   * forth leaves the bubble hushed until the LAST turn finishes rather than
   * popping it back up mid-spin on the first timer.
   */
  const [turning, setTurning] = useState(false);
  const turnedFrom = useRef<string | null>(null);
  const wallSeat = `${atWall.kind}:${atWall.kind === 'agent' ? atWall.id : ''}`;
  useEffect(() => {
    if (turnedFrom.current === null) { turnedFrom.current = wallSeat; return; }
    if (turnedFrom.current === wallSeat) return;
    turnedFrom.current = wallSeat;
    setTurning(true);
    const timer = window.setTimeout(() => setTurning(false), FORM_HUSH_MS);
    return () => window.clearTimeout(timer);
  }, [wallSeat]);
  /**
   * ═══ CHANGING WALL INVALIDATES SPEECH, THE SAME WAY A PRESS DOES ═══════
   *
   * THIS IS THE SECOND RACE FOUND IN THIS MACHINERY, and the difference from
   * the first one is the whole point of having two guards.
   *
   *   The first (`speechEpoch`, added for "there are like glitches sometimes
   *   in the speech bubble when I click on it too fast") is a race between
   *   TWO PRESSES on the same wall: press N's sentence lands after press
   *   N+1 asked for a different one, and the bubble swaps under the hand.
   *   Every press takes a number and a late answer to a superseded question
   *   is dropped. `creatureSpeaks` was the only thing that bumped it.
   *
   *   This one is a race between A PRESS AND A WALL. Nothing about the fetch
   *   is superseded — nobody pressed again — so the epoch still matched and
   *   `mine()` said yes. What changed is WHOSE DAY the answer is about:
   *   `sayTheWeather` reads `atWallRef.current` to decide which profile to
   *   ask for, so the sentence in flight is about the wall you were standing
   *   on, and it arrived on the one you had switched to. Proven with the
   *   weather route held open for 2.5s: press the creature on Me, switch to
   *   My agent, and the agent's own line ("I haven't formed anything yet")
   *   is overwritten by a sentence about your day — on the wall where the
   *   companion is not even allowed to offer a save.
   *
   * SO THE WALL BUMPS THE EPOCH TOO. A switch is a change of subject, which
   * is a stronger invalidation than a second press, and the guard that
   * already exists for one should answer both rather than growing a second
   * mechanism beside it.
   *
   * AND WHAT IS ALREADY UP GOES WITH IT. Founder: "the speech bubble should
   * be gone." The epoch only stops the NEXT write; a sentence that had
   * already landed before the switch would otherwise hang there for the rest
   * of its 4s whisper, over a creature that is now somebody else. That path
   * needs no race at all to reproduce, and it is the half of the bug that is
   * not intermittent.
   *
   * KEYED ON THE WHOLE ADDRESS (`spaceKey`), not on `wallSeat` above.
   * `wallSeat` deliberately collapses every room to one value because the
   * FORM only has two faces, and walking between two rooms turns nothing.
   * Speech is not about form, it is about subject: room A's news is as wrong
   * in room B as yours is on your agent's wall.
   *
   * WHAT DOES NOT CLEAR HERE, decided deliberately:
   *   - the top-of-mind bubble (`lead`) — `notes` is derived per wall and
   *     already returns [] off the self wall, so it is RE-DERIVED rather
   *     than stale. Clearing it would mean re-fetching what the new wall
   *     already knows.
   *   - the resting line (`restingWord`) — likewise computed from
   *     `standingAsAgent` and the new wall's chrome, in the same render the
   *     wall changed in. It cannot be stale.
   *   - the offer bubble — already gone ("an agent should never prompt user
   *     to save something"); nothing left to clear.
   *   Both surviving ones go down for the turn anyway through `turning`,
   *   which is the ruling's original implementation and still correct.
   *
   * `charSay` is the only one of the three that is a property of a MOMENT
   * rather than of a wall, which is why it is the only one that has to be
   * thrown away when the wall changes.
   */
  const spokenFor = useRef<string | null>(null);
  const wallAddress = spaceKey(atWall);
  useEffect(() => {
    /* first render is an arrival, not a switch: the away-window weather is
       told right after it and must not be sealed out of existence */
    if (spokenFor.current === null) { spokenFor.current = wallAddress; return; }
    if (spokenFor.current === wallAddress) return;
    spokenFor.current = wallAddress;
    speechEpoch += 1;
    speechSealed.current = true;
    setCharSay("");
    /* The seal lifts with the turn, for the same reason the turn is how long
       it is: until the creature is facing you again, any sentence would be
       words over the back of its head. See `FORM_HUSH_MS`. */
    const unseal = window.setTimeout(() => { speechSealed.current = false; }, FORM_HUSH_MS);
    return () => { window.clearTimeout(unseal); speechSealed.current = false; };
  }, [wallAddress, setCharSay]);
  const claimsFor = standingAsAgent ? atWall.id : undefined;
  /**
   * WHETHER THE CREATURE'S BUBBLE IS UP AND SPEAKING FOR THE WALL.
   *
   * The poster's empty line consults this so the same sentence is not printed
   * twice on one screen — see the branch in the wall's heading.
   *
   * "NOTHING YET" AND "NOT LOADED YET" ARE DIFFERENT FACTS, and this is where
   * confusing them would do the most damage: a companion that says "I haven't
   * formed anything yet" while the read is still in flight is not slow, it is
   * WRONG, and it says so in the first person. So on your own wall the bubble
   * waits for the read to settle; the poster keeps the loading and failed
   * lines, which are facts about a fetch and not about the companion. An
   * agent's line comes from its own chrome and has nothing to wait for.
   */
  const bubbleHoldsTheLine =
    /* ONLY FOR WALLS THE COMPANION SPEAKS FOR. A room's poster says what the
       ROOM is waiting for, in the room's own voice, and the companion is a
       visitor there — so silencing it in favour of a bubble would replace a
       sentence about the room with a sentence about you. Caught by
       `group-dial`, which lost "Some earlier wording is hidden" off a
       historical version the moment this suppression stopped asking whose
       wall it was on. */
    (atWall.kind === "self" || atWall.kind === "agent") &&
    !mouthOpen && !charSay && !turning &&
    /* AND THE WAIT IS ABOUT THE WALL, NOT ABOUT WHO YOU ARE BEING.
       The paragraph above already says it — "an agent's line comes from its
       own chrome and has nothing to wait for" — and the code then asked
       `standingAsAgent`, which is whether you have SWITCHED FORM, not whose
       wall you are looking at. Travel to your agent's column without
       switching, and this went false while your own reading was still in
       flight, so the suppression below lifted and "I haven't formed anything
       yet" printed across the middle of the screen with the bubble floating
       through the word "formed" — the exact collision the founder reported
       on the self wall, reappearing one column over.

       Founder, with the screenshot: "why are you saying I haven't formed
       anything behind? It should only be a text that it says." */
    (atWall.kind === "agent" || standingAsAgent || readingLoadPhase === "ready");

  answeringAsRef.current = claimsFor;
  /* Which wall a late answer would land on. The basket is the person's own,
     so a response that arrives after they have stepped onto the agent's wall
     is dropped rather than shown there as the agent's (found in review). */
  const standingAsAgentRef = useRef(standingAsAgent);
  standingAsAgentRef.current = standingAsAgent;
  useEffect(() => { if (standingAsAgent) setHarvestWhy(null); }, [standingAsAgent]);
  const loadClaims = useCallback(() => {
    if (standingAsAgent) { setClaimQueue([]); setHarvestQueue([]); return; }
    /* The basket loads beside the claims. A failure is an empty basket:
       nothing here is broken for the person, nothing is being asked. */
    void listHarvest()
      .then((rows) => { if (!standingAsAgentRef.current) setHarvestQueue(rows.slice(0, 3)); })
      .catch(() => setHarvestQueue([]));
    void listClaims({ limit: 8 })
      /* ═══ THREE IS A SITTING ═══════════════════════════════════════════
         Not eight, which is what this used to hold. A claim is expensive to
         answer — it asks a person to consult themselves — and the research
         on products that ask for repeated judgements is unanimous that the
         quality of the answers degrades fast. Anki's entire philosophy is
         capping intake, and its manual says why: "More than one Anki user has
         excitedly studied hundreds of new cards over their first few days of
         using the program, and then has become overwhelmed by the reviews
         required."

         That matters more here than it does for a flashcard, because bad
         answers do not just waste a review — they are what the top of mind
         and the principles get written FROM. The outputs are only ever as
         good as the attention paid to the three questions above them.

         And being stopped by the product reads as the product respecting the
         cost; running dry reads as a chore completed. The rest of the queue
         is still visible in its own room, which is now a doorway back to
         here. */
      .then(({ claims }) => { if (!standingAsAgentRef.current) setClaimQueue(claims.slice(0, 3)); })
      /* A queue that cannot be fetched is silence, not an error on the home
         screen: nothing here is broken for the person, there is simply
         nothing being asked. */
      .catch(() => setClaimQueue([]));
  }, [standingAsAgent]);
  useEffect(() => {
    if (phase !== 'ready' || offline) return;
    /* The wall changed under the queue, so the old wall's question must not
       stay on screen while the new one is in flight. The half-typed
       correction this also used to clear no longer exists — see the note on
       `correcting` above. */
    setClaimQueue([]);
    loadClaims();
  }, [phase, offline, loadClaims]);
  const composerOpenRef = useRef(mouthOpen); composerOpenRef.current = mouthOpen;
  /* ═══ THE WORLD STEPS ASIDE FOR A DESTINATION, CANVAS INCLUDED ═════════
     Founder: "I like the now page's navy blue and the other navy blue
     backgrounds are too light. Can I use the exact same background as
     what's under now, with the floating dots and stuff? Why does it have to
     be different?"

     It did not have to be. A destination painted an opaque ground over the
     world — the same token, so the colour matched, but flat: no vignette,
     no dust, no stars. Those come from the canvas, so a page that covers
     the canvas cannot have them, and "too light" is what a ground with its
     vignette removed looks like.

     So the page stops painting and the real world shows through it. The
     DOM chrome already knew how to do this — `.jar--aside` fades the
     bubble, the mouth and the companion's line — and the one thing left
     drawing over the list was the COMPANION itself, on the canvas, where a
     stylesheet cannot reach it. This ref is how the loop hears the same
     fact the class is stating. */
  const simApiRef = useRef<SimApi | null>(null);
  const asideRef = useRef(false);
  /* ═══ THE WALK BETWEEN NOW AND PRINCIPLES ══════════════════════════════
     Founder, 2026-10-15: "clicking principle from now should make agent
     turn right and move right ... and when user is going from principles to
     now, do sth similar." Decided in render, from what the address was a
     moment ago, so the page's first frame already knows it is being walked
     into — a crossing that arrived one render late would flash the page
     whole first. Only between Now and Principles: from Inspirations or a
     chat, the page simply appears, because the creature was not standing on
     screen to walk. */
  const principlesOpen = viewNavigation.view?.open === 'principles';
  const atNowView = !viewNavigation.view?.open && !viewNavigation.view?.conversationId &&
    !viewNavigation.view?.compose && !viewNavigation.view?.sharePrinciple && !viewNavigation.view?.principleId;
  /** What is being made right now, if anything — the bar becomes that page's own (see the dock). */
  const making: 'inspiration' | 'talk' | null = viewNavigation.view?.compose ? 'inspiration'
    : viewNavigation.view?.conversationId ? 'talk' : null;
  /** On one of the two lists (reached from a new note or chat): the bar is ↩ │ Close. */
  const listing = !making && (viewNavigation.view?.open === 'saves' || viewNavigation.view?.open === 'conversations');
  /** Which bar row the page's own groups (rules, tools, Close) hang off. */
  const barOwner: 'inspiration' | 'talk' | 'return' | null = making ?? (listing ? 'return' : null);
  /** Where a list was opened from by the bar's "All …", so ↩ can go back there (see the dock). */
  const listOrigin = useRef<{ kind: 'note' } | { kind: 'chat'; id: string } | null>(null);
  const [crossSeen, setCrossSeen] = useState({ open: principlesOpen, now: atNowView });
  const [principlesCrossing, setPrinciplesCrossing] = useState<{ going: 'in' | 'out'; home: CreatureSpot | null } | null>(null);
  if (crossSeen.open !== principlesOpen || crossSeen.now !== atNowView) {
    const home = simApiRef.current?.creatureAt() ?? null;
    if (principlesOpen && !crossSeen.open && crossSeen.now && home && !prefersStillness()) setPrinciplesCrossing({ going: 'in', home });
    else if (!principlesOpen && crossSeen.open && atNowView && home && !prefersStillness()) setPrinciplesCrossing({ going: 'out', home });
    else setPrinciplesCrossing(null);
    setCrossSeen({ open: principlesOpen, now: atNowView });
  }
  const walkingHome = principlesCrossing?.going === 'out';
  /* EVERY SURFACE THAT MOUNTS A PAGE, not just the ones that set `open`.
     The first version of this asked `view.open` alone and the chat broke
     immediately: a conversation sets `conversationId`, so the world went on
     drawing its companion and its bubble straight through the page's own
     creature and its opening line — two companions and two sentences on one
     screen. `.waka-page` is the thing that matters here, and these three
     parameters are what mount one. */
  asideRef.current = Boolean(
    viewNavigation.view?.open || viewNavigation.view?.conversationId ||
    viewNavigation.view?.sharePrinciple || viewNavigation.view?.compose ||
    /* the walk home is still the page's creature until it arrives */
    walkingHome,
  );
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

  /**
   * THE WORLD IS WHERE "WHOSE" IS DECIDED, AND IT SAYS SO OUT LOUD.
   *
   * The three views are routes and a route cannot see which wall a camera is
   * parked on, so without this you could stand on your agent's wall, open
   * Principles, and read your own. One writer and many readers, deliberately:
   * the wall is the truth here — it moves with the camera, with the back
   * button, with a link someone sent you — and the pages follow it rather
   * than keeping a second idea of the same fact. See `lib/standing`.
   */
  useEffect(() => {
    if (phase !== 'ready') return;
    publishStanding(
      auth?.account?.id,
      atWall.kind === 'agent' ? { id: atWall.id, name: atWall.name } : null,
    );
  }, [phase, atWall.kind, atWall.id, atWall.name, auth?.account?.id]);
  /* THE WORLD SPEAKS THE PROFILE'S LANGUAGE. One normalized value for this
     render, one ref for the closures the sim and the handlers hold across
     renders, and one stable `say` that always reads the ref — so a callback
     minted before a language change still speaks the language of the moment
     it fires. */
  const locale = normalizeSupportedLocale(auth?.profile?.preferredLocale);
  /* The creature's lines that are about there being little or nothing kept —
     see the bubble's "CHAT WHEN THERE IS SOMETHING" note. Decided by the
     catalogue key the world picked (`sayLineKeyRef`), and only while that
     line is the one showing; translated words are never compared. */
  const sayIsAboutNothing = useCallback((line: string) => {
    const said = sayLineKeyRef.current;
    return Boolean(said && said.line === line && NOTHING_LINES.has(said.key));
  }, []);

  /* ═══ THE TWO SETTINGS THE CORNER CARD HOLDS ═════════════════════════════
     Founder: "how do I kind of make it more of a drop down when I click on
     this settings icon rather than a new page."

     NO SAVE BUTTON, FOR THE REASON THE ARCHIVE'S NOTE ALREADY WORKED OUT:
     "the write is idempotent and already scoped to one row, the words are on
     screen the whole time, and leaving is the only exit — so the moment to
     commit is unambiguous and there is nothing for a button to disambiguate."
     All three hold for a display name in a card that closes on a press
     outside it.

     ON A TIMER HERE, THOUGH, AND NOT ON THE WAY OUT. The archive's note
     argues against keystroke-debounced writes, and it is right about a page
     you can leave by four different doors — but this card has no owned exit
     to hang a write on: it closes by a press on the scrim, by Escape, and by
     the gear. Three exits is how a save gets missed. A short pause in typing
     is a moment somebody can name ("I stopped typing"), which is the test
     that note actually sets.

     THE LANGUAGE WRITES IMMEDIATELY, because a `<select>` has no pause in it
     — the choice IS the commit. */
  /* ═══ WHETHER THE ARCHIVE HAS A NOTE OPEN IN IT ═══════════════════════
     Founder, of an opened saved inspiration: "the bottom bar should also
     change." The bar transforms while a NEW note is being written, and an
     opened saved note is the same page, so it transforms there too.

     ONE BOOLEAN, AND THE WORLD HOLDS NOTHING ELSE ABOUT IT. Which note is
     open is `SavesOverlay`'s business and stays there; what the dock needs
     is only whether to swap its middle slot for one the overlay can fill.
     See `NoteTools`, which fills it through a portal — ownership does not
     move, only the DOM does. */
  const [savedNoteOpen, setSavedNoteOpen] = useState(false);
  /* HOW TO LEAVE IT, HELD WHERE THE DOCK CAN REACH IT. Since the chevron
     went — founder: "I can just go to all the inspirations using the bottom
     panel" — pressing Inspirations IS the way out of an open note, and
     leaving commits what was typed. A ref rather than state: it is replaced
     on every keystroke (the closer captures the draft), and re-rendering
     the world for that would be a frame of work per character. */
  const closeSavedNote = useRef<(() => void) | null>(null);
  const savedNoteChanged = useCallback((close: (() => void) | null) => {
    closeSavedNote.current = close;
    setSavedNoteOpen(Boolean(close));
  }, []);
  /* ═══ EVERY WAY OUT OF A NOTE COMMITS IT ═══════════════════════════════
     Not only Inspirations. With no chevron on the page, all five of the
     bar's presses are exits from an open note, and four of them used to
     unmount the archive underneath it — which fires no autosave, because
     the autosave lives in the component being unmounted.

     THAT BUG PREDATES THE CHEVRON'S REMOVAL. Pressing Now from an edited
     note has always discarded it; the chevron merely gave people a path
     that did not. Removing the chevron is what made it the only path, so
     it is fixed here rather than noted.

     IT DOES NOT AWAIT. `leaveNote` fires the write and the navigation
     happens; the request completes whether or not this component is still
     mounted, and `leaveNote`'s own `mounted.current` guards keep it from
     writing state into a page that has gone. Awaiting would hold the bar
     unresponsive for the length of a round trip, which is the thing a
     bottom bar must never do. */
  /* ═══ AND IT IS FIXED ONCE, BECAUSE FIVE CALL SITES IS NOT A RULE ═════
     Everything above counted the BAR'S presses and stopped there, and the
     sentence at the top of this block — "every way out of a note commits it"
     — was false the day it was written. It was true of the five it had
     counted and false of the sixth, which nobody had to add a line of code
     for: `onClose` on `SavesOverlay` was `viewNavigation.closeOpen` with
     nothing in front of it, and `DialogSurface` answers Escape by calling
     exactly that. Probed: open a saved row, retype the words, press Escape —
     `updateInspiration` called zero times, and the edit gone.

     That is the one failure this product cannot have. The archive's own
     header already argues the point against a smaller version of it: it
     hands up `leaveNote` rather than a boolean because handing up a boolean
     "would have been the version of this that silently discards edits". The
     discard happened anyway, one layer further out, through the exit nobody
     wrote.

     SO THE COMMIT MOVES INTO THE EXIT RATHER THAN IN FRONT OF IT. `leaveOpen`
     is what every overlay and every key handler closes through now. A rule
     enforced by remembering to call something at five sites is a rule that
     will be broken at the sixth — it already was — and the seventh overlay
     added to this file gets the commit without anybody noticing there was
     something to get.

     IT IS A NO-OP EVERYWHERE BUT ONE, which is why routing ALL of them
     through it costs nothing. `closeSavedNote` is only ever registered by
     `SavesOverlay`; the claims room, the principles room and the chats list
     have no note to commit, so for them `leaveOpen` is `closeOpen` with a
     dead call in front of it. Asking each caller whether it is the archive
     would be the five-site rule again in a condition's clothing.

     AT MOST ONCE PER CLOSER, and this is what makes the history listener
     below safe rather than a second write. `leaveNote` is rebuilt on every
     keystroke — the archive's own effect re-registers it for exactly that
     reason — so a closer identity names one note at one set of words, and
     committing the same one twice can only be a duplicate. A failed write
     re-renders and hands up a fresh closer, so a retry is still possible;
     that is the case this guard must not break and the reason it compares
     identity rather than setting a flag.

     AND IT IS NOT PROVEN BY A TEST, which is worth saying plainly rather
     than leaving for someone to discover by deleting it. Escape commits and
     then closes, and the close is `navigate(-1)`, so in a browser the pop
     can land while the `updateInspiration` this function started is still
     in flight — closer unchanged, `saving` still false in that closure, and
     a second POST of the same words. `leaving-a-note.test.tsx` cannot
     produce that ordering: `MemoryRouter` raises no pop at all, so the
     event has to be dispatched by hand, and by then the awaited write has
     resolved and the archive has re-registered `null`. Removing this guard
     leaves that suite green. It stays because a duplicate write is exactly
     the thing a surface whose whole claim is "we kept what you wrote"
     cannot afford to do quietly, and because it costs one comparison. */
  const committedNote = useRef<(() => void) | null>(null);
  const commitOpenNote = useCallback(() => {
    const close = closeSavedNote.current;
    if (!close || close === committedNote.current) return;
    committedNote.current = close;
    close();
  }, []);
  /** Leaving whatever is held up over the world, committing it on the way. */
  const leaveOpen = useCallback(() => {
    commitOpenNote();
    viewNavigationRef.current.closeOpen();
  }, [commitOpenNote]);
  /* ═══ AND THE BROWSER'S OWN BACK, WHICH NO HANDLER CAN SEE ════════════
     `closeOpen` IS a history step — that is the property it was chosen for,
     "the browser's own Back keeps agreeing with Escape and with the close" —
     so Back out of an open note lands in the same place by the same route
     and, before this, with the same loss. There is nothing to put `leaveOpen`
     in front of: the pop arrives from outside React entirely, the address
     changes, the archive unmounts, and the autosave that lives inside the
     unmounting component never runs.

     THE PRESS IS HEARD RATHER THAN INTERCEPTED. A `beforeunload`-style
     confirm was rejected outright: it asks a person to approve keeping their
     own words, on a product whose claim is that it keeps them. `popstate`
     fires with the note still mounted and its closer still registered, so
     the commit simply happens and the navigation proceeds — nothing to
     dismiss, nothing to decide.

     `closeOpen`'s own `navigate(-1)` raises this event too, which is the
     duplicate the identity guard above exists for. */
  useEffect(() => {
    const popped = () => commitOpenNote();
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [commitOpenNote]);
  const [settingsName, setSettingsName] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const nameTimer = useRef<number | null>(null);
  useEffect(() => () => { if (nameTimer.current !== null) window.clearTimeout(nameTimer.current); }, []);
  /* The field shows what you typed while you are typing and the account's
     own name the rest of the time, so another tab renaming you is not
     overwritten by a stale field — and nothing is held here that the
     session does not already own. */
  const accountName = auth?.profile?.name ?? '';
  /* `preferredLocale` RIDES ALONG BECAUSE THE WRITE IS A REPLACE, not a
     patch: `UpdateProfileInput` requires both, and sending the name alone
     would reset the language to whatever the server defaults to. The
     language control below writes through `updatePreferredLocale`, which is
     the narrow endpoint for exactly that field. */
  const settingsCard = auth ? {
    name: settingsName ?? accountName,
    busy: settingsBusy,
    failed: settingsFailed,
    onName: (value: string) => {
      setSettingsName(value); setSettingsFailed(false);
      if (nameTimer.current !== null) window.clearTimeout(nameTimer.current);
      const trimmed = value.trim();
      /* AN EMPTY NAME IS NOT A RENAME. The field may be empty while somebody
         clears it to type a new one; writing that would blank the account
         between two keystrokes. */
      if (!trimmed || trimmed === accountName) return;
      nameTimer.current = window.setTimeout(() => {
        setSettingsBusy(true);
        void auth.updateProfile({ name: trimmed, preferredLocale: locale })
          .then(() => setSettingsName(null))
          .catch(() => setSettingsFailed(true))
          .finally(() => setSettingsBusy(false));
      }, NAME_SETTLE_MS);
    },
    onLocale: (next: SupportedLocale) => {
      setSettingsBusy(true); setSettingsFailed(false);
      void auth.updatePreferredLocale(next)
        .catch(() => setSettingsFailed(true))
        .finally(() => setSettingsBusy(false));
    },
    /* ═══ THE PUBLIC PAGE IS NO LONGER OFFERED ════════════════════════
       Founder: "everything regarding public and private should also not be
       a thing in this new experience."

       WHAT WAS HERE: the handle and the two switches the settings panel's
       public group read and wrote, lifted from the session so the panel did
       not fetch a second copy of something `auth.profile` already carried.
       That group is gone, and this object had exactly one consumer.

       THE DATA IS NOT GONE AND THAT IS DELIBERATE. `profiles.public_handle`
       and the two flags are untouched, as is the merge in
       `PATCH /auth/me/profile` that stops a rename clearing them — a
       security review tested that merge specifically and those tests stand.
       A handle is a name somebody chose and may have shared; it exists in
       one column and nowhere else. Closing the door is reversible in one
       file, dropping the column is not, and with no writer left nothing new
       can accumulate. Deleting the columns is a separate, explicit
       instruction nobody has given. */
    onDeleteAccount: async () => {
      /* THE ONE IRREVERSIBLE ACT. The panel asks twice before it reaches
         here; this does not ask again, and it does not catch — a failed
         delete must surface rather than look like a quiet success. */
      await deleteAccount();
      await auth.logout().catch(() => undefined);
      navigate('/login', { replace: true });
    },
  } : null;


  const localeRef = useRef(locale);
  localeRef.current = locale;
  const say = useCallback((key: MessageKey) => t(localeRef.current, key), []);
  /* ═══ IT STATES THE FACT; THE ACTION CARRIES THE VERB ═════════════════
     Founder, with "No top of mind formed yet. Add more inspirations." sitting
     above a button reading "Add an inspiration": "it's duplicative."

     It was, and the duplication arrived honestly: the second sentence is
     the founder's own earlier wording — "this should say no top of mind
     formed yet, add more inspirations" — written when the bubble had no
     action and the sentence had to carry the instruction itself. Giving
     every bubble a named act made the instruction the button's job and
     left the sentence saying it twice.

     SO THE DIVISION IS NOW EXPLICIT, and it is the one to keep: what the
     creature SAYS is a fact about where you are, and what it OFFERS is the
     verb. The empty line went the same way for the same reason — "Keep
     something you want to come back to" is an instruction, and "Add an
     inspiration" was sitting underneath it.

     AND IT IS THE WALL'S OWN SENTENCE, not one sentence for both. Your wall
     says what it is waiting for — something kept, or a pattern to recur in
     what you have kept — and an agent says it has formed nothing. The poster
     chose between exactly these; the bubble is the poster's new seat, so it
     makes the same choice from the same facts rather than a simpler one. */
  /* `restingWord` itself is declared below `wallChromeNow`, which its agent
     half reads (code review round 3, 2026-10-16). */

  /* The self wall's NAME is canon ("Me" — it also mints the /w/me address);
     what a person reads is the catalog's word for it. User-given names —
     agents, rooms — render as given. */
  /* `wallName` went with the list it labelled: the corner is a two-state
     switch now and names its two sides itself, in words chosen for a person
     ("me", "my agent") rather than from the wall's stored name. */
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
  /* ═══ THE NINE SPLINTS ARE OUT (2026-10-15) ═══════════════════════════
     `members` / `setMembers` / `membersRef` (a room's member lists, where the
     sim could read them, for the company it drew behind your companion),
     `openGroupMemberRef`, `hueByOwnerRef` (the map a room's legend decoded,
     written by the loop at the one place the orbs were tinted so a name and
     its orbs could not disagree), `groupsRef`, `loadGroupRef`, `pushWokenRef`,
     `groupCacheRef`, `groupFieldRef`, `groupBallsRef` and `groupVisitedRef`.

     EVERY ONE OF THEM CARRIED THE SAME SENTENCE, which is the thing to read
     before writing another: "this survives because `canvas/simulation.ts`
     declares it required and that file may not be edited from here." They
     were not state, and they were not even unused state — they were an empty
     container, a no-op function or a write-only map, wired into a frame loop
     so a type would check across a boundary nobody could cross that day.
     Stopping at a green build was the right call then and this is the other
     half of it. When a removal has to stop mid-way, the splints are the
     deliverable: each one named what it was, who held it up, and what event
     would release it, and that is what made this pass a deletion rather than
     an investigation. */

  /**
   * THE WALLS, LEFT TO RIGHT — agents, then you.
   *
   * Column numbers are signed and the owner keeps the origin, so camX stays
   * zero at home and every existing piece of travel arithmetic is unchanged.
   * Newest agent nearest you: the axis grows outward from where you stand.
   *
   * ROOMS WERE THE POSITIVE COLUMNS and this is where they entered the world
   * — `groups.forEach` pushing one wall per room, newest nearest you. With
   * them gone the axis has no positive side, so a person with no agent has
   * `walls.length === 1` and `canvas/simulation.ts` refuses lateral travel
   * outright, which is the honest answer for a world with one place in it.
   */
  const walls = useMemo<Space[]>(() => {
    const out: Space[] = [];
    (agentRoster ?? []).forEach((a, i) => {
      out.push({ kind: "agent", id: a.id, name: a.name, col: -(i + 1) });
    });
    out.reverse(); /* leftmost first, so the array is the axis in order */
    out.push({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 });
    return out;
  }, [agentRoster]);
  /* The one agent this account has, if it has one. Only its existence and
     its column are needed here — the creature's form switch is a toggle
     between your own wall and that one. */
  const agentWall = walls.find(w => w.kind === 'agent') ?? null;
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
  /* ═══ THE ROOM CACHES ARE GONE, AND FOUR OF THEM ARE SPLINTS ═══════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     What stood here: the permission-checked snapshot cache and its in-flight
     map, its lease timers and its alive flag, the per-room chrome, the
     per-room ground and the remainder the server's ceiling held back, the
     room's own becoming (the chain of boards with their reasons, and the
     door's ledger of arrivals and departures), the historical boards keyed
     `groupId:version` with their own tokens so an invalidated read could not
     land late, and the two ticks that told React any of it had changed.

     FOUR REFS SURVIVED THIS CUT, EMPTY AND ONLY FOR THE COMPILER —
     `groupCacheRef`, `groupFieldRef`, `groupBallsRef`, `groupVisitedRef` —
     and they came out on 2026-10-15 with the loop's group branches. See the
     splint tombstone above the walls for what all nine of them were. */
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
  /* `agentKeys`, `minted`, `revoking` and `keysBusy` are gone with the panel
     that was their only reader — see the tombstone at the mount site. */
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

  /* ═══ `loadGroup` AND THE WHOLE SHARED-READ MACHINERY ARE GONE ═════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     This was the largest single thing rooms owned in this file, and it was
     not a fetch — it was a LEASE. Four requests in parallel (the board, the
     wall of shared statements, the open proposals, the pooled ground), raced
     against a thirty-second deadline, written into a cache under a token,
     and then swept: `GROUP_READ_TTL_MS` expired the snapshot even when its
     version had not changed, because a shared read is permission-sensitive
     and a version number cannot tell you that access was revoked. On
     expiry, on a failed verification, or on a restriction appearing in a
     re-read, `clearGroupDisplay` tore down everything derived from it —
     chrome, ground, wall signals, the poster's memory of what it last said,
     the open panel, the selection — and `clearGroupHistory` aborted every
     in-flight historical board read for that room and dropped the versions
     it had already resolved.

     THE RULE IN IT THAT SHOULD SURVIVE ROOMS: a read somebody else's
     permission governs may not be cached by version alone. Nothing left in
     this product reads across an account boundary, so nothing left needs
     this — and if something ever does, the shape is here in the history
     rather than having to be rediscovered.

     `loadGroupRef` remained as a no-op while `canvas/simulation.ts` still
     declared it required, calling it as travel toward a room began. There
     were no rooms to travel to; it came out with the loop's group branches
     on 2026-10-15. */

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
  /** Which agents' last landed bundle could not read their top of mind. The
      first load is forgiving — a failed read becomes an empty board rather
      than no wall — so an empty bundle alone cannot tell "has formed nothing"
      from "we could not ask". This is the difference, set as a bundle lands
      and cleared when one lands with its reading (final review, 2026-10-16). */
  const [agentReadingFailed, setAgentReadingFailed] = useState<ReadonlySet<string>>(() => new Set());
  /** Per pending bundle: whether its top-of-mind read failed. Lands with it. */
  const pendingReadingFailedRef = useRef<Map<string, boolean>>(new Map());
  /** Put fetched bundles on their walls, and their reading's standing with them. */
  const applyAgentBundles = useCallback((fresh: Map<string, AgentBundle>) => {
    const failed = new Map<string, boolean>();
    for (const id of fresh.keys()) {
      failed.set(id, pendingReadingFailedRef.current.get(id) === true);
      pendingReadingFailedRef.current.delete(id);
    }
    const left = new Map(fresh);
    setAgents((prev) => {
      const replaced = (prev ?? []).map((a) => {
        const f = left.get(a.agent.id);
        left.delete(a.agent.id);
        return f ?? a;
      });
      /* anything left is a FIRST load — the wall's memory arriving at all */
      return [...replaced, ...left.values()];
    });
    setAgentReadingFailed((prev) => {
      const next = new Set(prev);
      for (const [id, f] of failed) if (f) next.add(id); else next.delete(id);
      return next.size === prev.size && [...next].every((id) => prev.has(id)) ? prev : next;
    });
  }, []);
  /* A FIRST LOAD THAT FINISHES AFTER ARRIVAL LANDS NOW. Arrival is the only
     moment a pending bundle was applied, so the first visit to an agent whose
     fetch finished after the camera settled drew its empty wall and said "I
     haven't formed anything yet" over a reading the server had already
     returned (screenshot check, 2026-10-16).
     ONLY A FIRST LOAD, ONLY ON ITS OWN WALL, AND ONLY AT REST. Any
     `setAgents` rebuilds the whole simulation (the pour depends on
     `agents`), so landing is safe only while nothing moves — and
     `atWallRef` cannot say that: it updates on ARRIVAL, so it still names
     this agent once you are crossing away or aiming up. The loop's own
     `navigationState()` can; while it is moving, or before there is a loop,
     the bundle stays pending and lands at the next arrival, exactly as on
     dev. Only that agent's bundle lands. A REFRESH — an agent already in
     `agents` — still lands only at arrival, as it always has. A polled
     at-rest version of this was tried and caused more than it fixed (final
     review, 2026-10-16). */
  const landFirstLoadIfStandingOn = useCallback((agentId: string) => {
    const sim = simApiRef.current;
    if (!sim || sim.navigationState().moving) return;
    const w = atWallRef.current;
    if (w.kind !== "agent" || w.id !== agentId) return;
    const fresh = pendingAgentBundlesRef.current.get(agentId);
    if (!fresh) return;
    pendingAgentBundlesRef.current.delete(agentId);
    applyAgentBundles(new Map([[agentId, fresh]]));
  }, [applyAgentBundles]);
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
            pendingReadingFailedRef.current.set(agentId, false);
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
      let readingFailed = false;
      void loadAgentBundle(entry, { onReadingFailed: () => { readingFailed = true; } })
        .then((fresh) => {
          agentFirstLoadRef.current.delete(agentId);
          agentRefreshedAtRef.current.set(agentId, Date.now());
          pendingAgentBundlesRef.current.set(agentId, fresh);
          pendingReadingFailedRef.current.set(agentId, readingFailed);
          landFirstLoadIfStandingOn(agentId);
        })
        .catch(() => {
          agentFirstLoadRef.current.set(agentId, "failed");
        })
        .finally(() => {
          agentRefreshBusyRef.current.delete(agentId);
        });
    },
    [agentRoster, agents, landFirstLoadIfStandingOn],
  );

  /**
   * Warm a wall, whatever kind it is. An agent refetches its own layers; your
   * own wall has nothing to warm. The loop calls this the moment travel
   * toward a wall begins, so arrival usually finds it ready — and current.
   *
   * A ROOM WAS THE THIRD ARM and it fetched its pooled field here. Gone with
   * rooms (founder, 2026-10-12: "방 없애").
   */
  const loadWall = useCallback(
    (w: Space) => {
      if (w.kind === "agent") loadAgentWall(w.id);
    },
    [loadAgentWall],
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
    applyAgentBundles(fresh);
  }, [atWall, applyAgentBundles]);

  const pushArrived = useCallback((w: Space) => {
    setAtWall((prev) => (prev.kind === w.kind && prev.id === w.id ? prev : w));
  }, []);
  const pushArrivedRef = useRef(pushArrived);
  pushArrivedRef.current = pushArrived;

  // The route-restoration bridge below handles initial links and every POP,
  // not a one-shot latch tied to the first wall name.

  /* `pushWoken` AND `wokenGroups` ARE GONE. The loop pushed a room id the
     first time that room's orbs poured — "its words exist now, whole" — and
     four memos depended on the set so that a room's poster appeared the
     moment its board was KNOWN rather than at whatever render happened next.
     `pushWokenRef` survived as a no-op while `canvas/simulation.ts` still
     declared it required; it came out with that file's group branches on
     2026-10-15. */

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
      /* THE FIXTURE'S FOUR ROOMS ARE GONE (founder, 2026-10-12: "방 없애").
         It built one room with only you, one with you and an agent, one of
         people and one of machines, each with a pooled ground, so that the
         per-member hues, the legend, the pixelated agent memories, the
         machine hand and the crossing quantization could all be LOOKED AT
         without a session. That argument was sound and is the reason the
         fixture exists at all — "every one of those shipped unobserved, and
         several shipped broken" — but the four rooms described a capability
         this product no longer has, and a fixture that invents a feature is
         worse than one that is small. What it still describes: your own
         wall, whole. */
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
    /* THE ROOMS WERE THE COLUMNS TO THE RIGHT, and `GET /groups` filled
       them, newest first. Gone, with the route (founder, 2026-10-12: "방
       없애"). The canon's privacy line is the thing to carry forward out of
       this block: a room was a WALL OF STATEMENTS — members shared signals,
       never inspirations — so what hung there was other people's signals
       with their names on them, and the raw memories behind them never left
       the account they were saved in. That is why a room's orbit could say
       WHO fed an entry and never WHICH memory did. */
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
    /* WHOSE PRESS THIS IS. Captured before the fetch and checked after it:
       a sentence that was asked for two presses ago is not the sentence
       anybody is waiting for, and writing it is the swap the founder
       recorded. See `speechEpoch`. */
    const asked = speechEpoch;
    const mine = () => asked === speechEpoch;
    if (offlineRef.current) {
      setCharSay(fallback());
      return;
    }
    /* ═══ A PRESS ALWAYS SAYS SOMETHING, AND IT SAYS IT NOW ════════════
       Founder: "sometimes clicking on the character doesn't do anything for
       a while. It feels stuck."

       IT WAS STUCK, AND PRESSING AGAIN MADE IT WORSE. The sentence came
       only from `/weather`, so between the press and the response the
       creature said nothing — just the glow. And the obvious human reaction
       to that, pressing again, is the one thing that guaranteed silence:
       the second press bumps `speechEpoch`, the first answer arrives, fails
       `mine()`, and is DROPPED. Every impatient tap cancelled the reply it
       was impatient for. On a slow link, or with the generation queue
       failing, the creature could be mute indefinitely while looking alive.

       THE SENTENCE WAS ALREADY THERE. `fallback()` is the loop's own line
       about what is true right now — the frontier, the sky, the dial, the
       season of the archive — and the offline branch above has always said
       it immediately. Only the online path waited on the network for
       permission to speak.

       A GRACE PERIOD, NOT AN IMMEDIATE SWAP, because saying the local line
       and then replacing it a moment later would be two sentences for one
       press, against the whisper rule of one clause at a time. If the
       weather answers within `SPEAK_GRACE_MS` nothing flickers and this
       timer never fires; if it does not, the creature speaks for itself and
       the weather refines it when it lands. The epoch check inside keeps a
       stale press from speaking over a newer one. */
    const graced = window.setTimeout(() => { if (mine()) setCharSay(fallback()); }, SPEAK_GRACE_MS);
    graceTimer.current = graced;
    const settle = () => { window.clearTimeout(graced); if (graceTimer.current === graced) graceTimer.current = null; };
    /* The wall says whose day this is. `atWallRef` rather than `atWall`
       because this callback is built once and must read the CURRENT wall,
       not the one that existed when it was made — the same reason every
       other seam in this file reaches through a ref. */
    fetchTheWeather({ antechamber: false,
      ...(atWallRef.current.kind === 'agent' ? { profile: atWallRef.current.id } : {}) })
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
        /* SPOKEN ALONE, SO IT TAKES A CAPITAL. The API writes these as
           CLAUSES, lower case, because the full record joins them; the
           creature says one on its own, which makes it a sentence. See
           `asSentence` — and note that `capitalized.test.ts` cannot see
           these at all, because they are assembled on the server rather
           than drawn from the catalogue it reads. */
        const lines = spoken.map(
          (x) => asSentence(`${x.sentence.text} ${day?.label ?? "today"}.`, localeRef.current),
        );
        settle();
        if (!mine()) return;
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
      .catch(() => { settle(); if (mine()) setCharSay(fallback()); });
  }, []);
  const sayTheWeatherRef = useRef(sayTheWeather);
  sayTheWeatherRef.current = sayTheWeather;
  /* The loop is built once and must call the CURRENT rotation, the same
     reason every other seam in this file reaches through a ref. */
  const creatureSpeaksRef = useRef(creatureSpeaks);
  creatureSpeaksRef.current = creatureSpeaks;

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
    if (navigationInteraction.current || requested?.inspirationId || requested?.compose || requested?.find || requested?.wallId || requested?.principleId || requested?.conversationId) {
      stamp(); return undefined;
    }
    /* ═══ AND WHOSE ARRIVAL THIS IS, WHICH IS THE THIRD RACE ═══════════
       Founder, reporting the same thing for the second time after both of
       the other two were fixed and shipped: "sometimes the speech bubble
       stays on." Still true, and this is the writer that was missed.

       `charSay` has THREE late writers, not two. `sayTheWeather` takes a
       `speechEpoch` number on the press and drops a superseded answer; the
       wall effect clears a sentence that had already landed. This greeting
       is the third: it fetches the away-window line at mount, holds it in
       `toldRef` and speaks it from a timer — 1400ms after the world is
       drawn, 4000ms when there is something new to glide to first. It took
       no number at all, so the guard built for exactly this shape of bug
       could not see it, and a sentence about YOUR day landed on your
       agent's wall whenever somebody switched form on the way in.

       THE SEAL CANNOT COVER IT, and that is why this needs the epoch rather
       than a longer hush. `speechSealed` lifts with the turn (650ms,
       `FORM_HUSH_MS`) because words over the back of a turning creature is
       the only thing it is for. The greeting speaks at 1400ms at the
       earliest, so it lands after every seal has lifted, EVERY time —
       "sometimes" only because switching form inside the first few seconds
       of a visit is itself occasional. Widening the hush to four seconds was
       the obvious alternative and is wrong twice over: it would hold a
       sentence somebody ASKED for off the screen for four seconds, and it
       would still be a race rather than an answer to one.

       WHY IT WAS NEVER SEEN BY HAND. StrictMode double-mounts `Home` in
       development, the first mount's cleanup clears these timers, and
       `greetedRef` is already spent — so the greeting never speaks at all
       under `pnpm dev`. It is only reachable in a real build, which is why
       the founder is the only person who had seen it. Pinned by
       `speech-on-switch.test.tsx` instead. */
    const askedOnArrival = speechEpoch;
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
      /* THE THIRD PLACE A SERVER CLAUSE IS SPOKEN ALONE, and it was missed
         when the other two were fixed — caught by a probe that printed what
         the creature was actually saying: "you kept a memory." The
         away-window sentence comes off the same API as the day's clauses,
         lower case for the same reason, and lands straight in the bubble.
         `capitalized.test.ts` lists all three by name now. */
      /* A GREETING IS ADDRESSED TO WHOEVER ARRIVED, and a press or a wall
         change means that is no longer who is standing here. Same test the
         press path makes (`mine()`), same reason: a late answer to a
         question nobody is asking any more is not an answer. */
      if (askedOnArrival !== speechEpoch) return;
      if (toldRef.current) setCharSay(asSentence(toldRef.current, localeRef.current));
    };
    /* THE GREETING NO LONGER OPENS A CARD. It used to glide to the newest
       thing kept while you were away, open its card, hold it 2.6s and close
       it again. Founder, 2026-10-16: "once in a while the inspiration card
       keeps coming up in the main page but dont have that." So coming back
       is the whisper alone — the creature tells you what happened — and a
       card opens only when you open one. */
    timers.push(window.setTimeout(tell, 1400));
    stamp();
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
    /* `HistoryGrain` came from `space-kinds/group-history`, which is gone
       with rooms — the door ledger was the only thing that needed to know
       which grain a stop stood at, so the three words live here now, beside
       the only code left that rolls between them. */
    const roll = (
      grain: "day" | "month" | "year",
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

  const dial = useMemo(() => {
    /* EVERY WALL'S DATES ARE THAT WALL'S OWN LIFE, NOT YOURS.
       The dial winds the wall you are standing on, so the moments it offers
       are that wall's. AN AGENT's are the days it kept something — the
       ruling from #283, kept here verbatim because it is right and the
       rewrite that moved this code would have silently dropped it:
       "standing on Scout's wall the rail spanned YOUR years — and the scrub
       (scene-scoped since one-wall-one-scene) wound Scout's ground against a
       stranger's timeline. The wall's rail is the wall's memories, exactly as
       a room's is the room's." Their fix was about WHOSE moments; the move
       was about how they are offered, and the two are the same wall seen
       from two sides. Null until the bundle lands, like everything else
       behind the wake.

       A ROOM'S OWN DATES WERE THE THIRD BRANCH — the days its door moved and
       its readings were written, read out of the timeline the room's fetch
       filled. They went with rooms (founder, 2026-10-12: "방 없애"). */
    /* now — and `now` moves when something is kept now (see clockMs) */
    const end = clockMs;
    const moments: number[] = [];
    if (atWall.kind === "agent") {
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
    /* `agents` is a dependency because an agent's bundle lands after
       arrival, so its dates must re-read when it does. `groupPastTick` was
       here for the same reason on a room's wall and went with rooms. */
  }, [inspirations, agents, clockMs, atWall, dialStops]);

  /* `selectedGroupStop`, `selectedGroupHistory` and `currentGroupHistory`
     are gone: the three captions a room's dial wore — what happened at the
     stop you parked on, and what happened today — read out of the door
     ledger `groupHistoryEvents` built. A date on your own wall is a date. */
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
      /* AND THE SAME FILM IS AVAILABLE TO THE DOM.
         The world's grain is one layer painted over the canvas, so anything
         drawn ABOVE that layer — the creature's speech, for one — came out
         clean while everything under it carried the emulsion. Founder: "the
         speech bubble doesn't match the grainy texture of the character and
         the product."
         The tile is published as a variable rather than copied, so there is
         one film and it is baked once: a second tile would be a second
         texture that looks like the first until a DPR change moves one of
         them. */
      root!.style.setProperty("--jar-grain", `url(${pal.grainUrl})`);
      root!.style.setProperty("--jar-grain-size", `${GRAIN_PX * GRAIN_TILE}px`);
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
  /* ═══ `groupChromeAt` IS GONE — THE ROOM AS IT STOOD AT T ══════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     THE RULE IT EXISTED TO HOLD IS WORTH KEEPING IN WRITING, because your
     own wall obeys the same one and nothing else states it this plainly: a
     history must never print today's sentence over a month that had a
     different one, or over a month that had none at all. So this never fell
     back to the live board — if the version standing at T was not in hand it
     said the room's name and waited, and if the room had no board at T it
     said so with the month beside it. It stamped `asOf` only when the past
     sentence DIFFERED from the one up now, because a date on an unchanged
     sentence reports a change that did not happen. And nothing was ever
     "forming" in the past: an open proposal is a thing on its way to
     becoming what a room believes, and in March it either became it or it
     did not.

     It also carried the one caching subtlety of the whole room surface:
     winding inside a verified snapshot reused the version, and revalidating
     the room cleared that cache, because a version can survive while access
     to it changes. */

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
          : /* A ROOM'S BOARD USED TO BE THE THIRD BRANCH, and the bug it
               fixed is the reason this comment survives the branch. There was
               no room branch at all once: standing in a room fell through to
               `deriveAmbition`, which reads YOUR adopted ambition and YOUR
               notes — so a room wall never had a poster of its own, and the
               boot loop's `setAdopted` was covering for that by writing the
               room's sentence into your slot. Deleting the cover-up left the
               room blank, which is how one bug wearing two faces gets found.
               Rooms are gone (founder, 2026-10-12: "방 없애"); the lesson is
               that a wall must derive its own claim from its own material,
               and the two walls left both do. */
            (() => {
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
                forming: formingWords(T, emerging, localeRef.current),
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
    /* `wokenGroups`, `groupFieldTick` and `groupReadTick` were here because a
       room's board arrived asynchronously into refs, which cannot trigger
       anything themselves, and depending on the ticks is what made a room's
       poster appear on arrival rather than at some unrelated later render.
       All three went with rooms. */
    [dial, adopted, notes, atWall, agents, emerging, topOfMind, inspirations],
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
   * A ROOM CAME FROM A REF THE FETCH FILLED, and the deps were the argument:
   * `groupFieldTick` for the state the FETCH bumped and `wokenGroups` for the
   * state ARRIVAL bumped, both, so the read could not be stale from either
   * direction. The first was MISSING once, and that was half of a defect the
   * founder reported twice: "dont make the text be there and reload when
   * character goes to the room. keep it rendered and dont rerender when
   * character arrives." Rooms are gone; the rule they taught — a wall's words
   * must be derivable before you arrive, not because you arrived — is what
   * this memo is still for.
   */
  const wallChromeNow = useMemo(() => {
    const nowMs = dial ? dial.end : Date.now();
    const m = new Map<string, WallChrome>();
    for (const w of walls) {
      if (w.kind === "agent") {
        const a = (agents ?? []).find((x) => x.agent.id === w.id);
        /* in the reader's language: `formingAlt` is a sentence */
        if (a) m.set(spaceKey(w), deriveAgentChrome(a, nowMs, nowMs, locale));
      } else {
        const at = deriveAmbition(nowMs, adopted, notes);
        m.set(spaceKey(w), {
          text: at.text,
          awayFrom: null,
          formingAlt: topOfMind?.supportChanged ? say("worldReadingSupportChanged") : null,
          asOf: null,
          forming: formingWords(nowMs, emerging, localeRef.current),
          empty: topOfMind === null && (inspirations?.length ?? 0) === 0,
          prevText: null,
        });
      }
    }
    return m;
  }, [walls, agents, dial, adopted, notes, emerging, topOfMind, inspirations, locale]);
  /** What an agent's wall holds up: its own reading, never yours.
      FROM ITS OWN BUNDLE AT NOW, NOT FROM `chrome`. `chrome` is written by
      `applyChrome` in an effect AFTER `atWall` changes, so the first render on
      the agent's wall still held YOUR sentence — under "This is what's on my
      mind right now." And `chrome.text` is the reading at the dial's T, which
      is not "right now" once the dial is wound back (code review,
      2026-10-16). It is read in render from the agent's own bundle.
      AND IT IS THE LEAD, NOT THE NEWEST. `loadAgentBundle` sets
      `direction.current` by the same rule as your bubble's `lead` — pinned,
      else first in the board's order — while the history's newest entry by
      date can be an unpinned later one (code review round 2, 2026-10-16). */
  const standingBundle = standingAsAgent
    ? (agents ?? []).find((a) => a.agent.id === atWall.id) ?? null
    : null;
  const agentSays = standingBundle?.direction.current?.ambition ?? null;
  /* NO BUBBLE UNTIL THE AGENT'S BUNDLE IS HERE. While its first load is
     pending — or failed — the app does not know whether the agent has formed
     anything, and "nothing adopted yet" would be a claim about it. Founder:
     "no bubble at all while there is nothing true to put in it." A loaded
     bundle with no reading still says the resting line, because then it is
     true (code review round 3, 2026-10-16). */
  /* AND NONE WHILE ITS READING COULD NOT BE READ. A failed top-of-mind read
     lands as an empty board, which would say "I haven't formed anything yet"
     over a reading that exists (final review, 2026-10-16). */
  const agentBundleMissing = standingAsAgent &&
    (standingBundle === null || agentReadingFailed.has(atWall.id));
  /* AND THE RESTING LINE IS THE AGENT'S AT NOW, from `wallChromeNow`, for the
     same reason `agentSays` is not `chrome`: `chrome.formingAlt` is written
     an effect late and at the dial's T. */
  const restingWord = standingAsAgent
    ? wallChromeNow.get(spaceKey(atWall))?.formingAlt ?? say("worldFormingNothingAdopted")
    : say(inspirations?.length || fieldBeyond ? "worldPersonalReadingNotReady" : "worldPersonalReadingEmpty");

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
    /* `spaceKey` AT THE WRITING END TOO -- see the rule below. These were
       hand-spelled (`"self:"` and `` `agent:${id}` ``), which agreed with the
       reader only because the self wall's id happens to be "". Give it one and
       the peek row silently empties. */
    m.set(spaceKey({ kind: "self", id: "", name: SELF_WALL_NAME, col: 0 }), provenance);
    for (const a of agents ?? []) {
      const prov: Provenance = new Map();
      const byId = new Map(a.inspirations.map((s) => [s.id, s] as const));
      const held = a.direction.current;
      for (const id of held?.groundedIn ?? []) {
        const s = byId.get(id);
        if (s) prov.set(id, s.quote);
      }
      m.set(spaceKey({ kind: "agent", id: a.agent.id, name: a.agent.name, col: 0 }), prov);
    }
    /* A ROOM LIT THE STATEMENTS ITS BOARD WAS BUILT FROM, and one rule from
       that branch is worth keeping where the next person will read it: the
       map is KEYED BY THE FUNCTION THAT READS IT. The room's entry was
       hand-spelled `room:${w.id}`, then a mechanical rename made it
       `cached:${w.id}` — two spellings, both wrong, because the only reader
       is `wallProv.get(spaceKey(w))`. A room's provenance was therefore never
       found and its peek row was empty every time. Call `spaceKey` at both
       ends and the two cannot disagree -- which, as of 2026-10-15, this
       finally does. The two surviving entries were still hand-spelled and
       agreed with the reader only by luck: `"self:"` matches
       `spaceKey({kind:"self", id:""})` for exactly as long as the self wall's
       id stays empty. */
    wallProvRef.current = m;
    simApiRef.current?.setProvenance(m);
  }, [provenance, agents, inspirations, walls]);

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

  /* ---------------- the simulation: one rAF loop, refs only ----------------
     IT LIVES IN `canvas/simulation.ts` NOW, and this is the whole of what is
     left here: the four facts that end one run of the loop and start the next.

     `docs/reviews/code-quality-2026-10-11.md` finding 7 asked for exactly this
     cut and for no other one in this file. What was 5,637 lines of effect body
     captured 49 bindings from this scope against this same four-entry array,
     and argued the staleness of two of them. All 49 are now named members of
     `SimulationOptions`, each carrying a claim about whether it may be stale.
     The behaviour is unchanged; what changed is that the question "can this go
     stale" now has an answer written next to every input.

     THE ARRAY IS STILL THE SHORT ONE, FOR THE REASONS IT ALWAYS WAS. The three
     VALUES below — `inspirations`, `agents`, `walls` — are snapshots, so each
     one must be here or it is a stale capture by construction; `pourSig` is
     what stands in for `inspirations` (see its own note). `groupFieldTick`
     triggers a rebuild and is not read by the loop at all. Everything else the
     loop needs is a ref, which is why 41 of 49 inputs can change under a
     running loop without a rebuild — and why `citations` and `signals` can
     stay off this list. That argument has not moved: it is at the foot of
     `startSimulation`, where it has always been. */
  useEffect(
    () =>
      startSimulation({
        measured,
        inspirations,
        agents,
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
        headingRef,
        inspirationsRef,
        lastGoRef,
        loadWallRef,
        localeRef,
        openSeekRef,
        paletteRef,
        panelArrowRef,
        parkedRef,
        pushArrivedRef,
        sayLineRef,
        sayLineKeyRef,
        selectedIdRef,
        simApiRef,
        skyRef,
        slotH,
        TRef,
        wallsRef,
      }),
    [pourSig, agents, walls],
  );

  /**
   * AND WHEN THE SKY LANDS, THE GROUND IS LIT AGAIN — IN PLACE.
   *
   * The pour above bakes `hasNotes` / `quote` / `terms` into every ball at
   * construction, and `colorBall` reads them to decide the cited floor, the
   * cited lift and the frontier. (There was a fourth, `hasGroup`, and a floor
   * under it: a memory glowed a little more when a pattern resting on it had
   * been shared into a room. It went with rooms — founder, 2026-10-12: "방
   * 없애" — along with `FIELD_FLOOR_IN_GROUP` and `Signal.sharedGroupIds`,
   * which was the only thing that could ever set it true.) But the sky is two
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
    /* A ROOM ORB BELONGING TO ANOTHER MEMBER TOOK THE FIRST BRANCH HERE, and
       the rule was that the 180-character preview WAS the whole panel: the
       full text of somebody else's save is not ours to fetch, so nothing was
       missing and nothing loaded. Gone with rooms (founder, 2026-10-12: "방
       없애"). Every orb this can select is now this account's own, so every
       path below fetches for real. */
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
    /* a save kept in this session fetches by its real signal id — the ball
       keeps the id it was born under. (A room orb of your own resolved
       through the same `sigId` and was the other half of this line.) */
    const fetchId = ownBall?.sigId ?? selectedId;
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

  /* the companion's line is a whisper, not a status bar: it goes after 4s —
     6s for "I'm inspired!", which carries a button worth reaching for */
  useEffect(() => {
    if (!charSay) return undefined;
    const id = window.setTimeout(() => setCharSay(""), charSay === say('worldImInspired') ? 6000 : 4000);
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

  /* A DOC COMMENT FOR `grounds` STOOD HERE AND IS DELETED, which is a note
     about tombstones rather than about rooms. The deletion on 2026-10-12
     replaced the CODE with the tombstone just below and left the original
     doc block above it untouched, so the file carried the same argument
     twice: once in the present tense, saying the row of names is how you
     change whose ground you are on, and once immediately underneath saying
     it is gone. A reader scanning for whether a feature exists reads the
     first one. When code goes, its doc comment goes with it or it becomes
     the most convincing possible lie about the file. Everything the block
     said is in the tombstone below, in the past tense, where it belongs. */
  /* ═══ WHOSE GROUND YOU ARE STANDING IN — GONE WITH THE ROOM ════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     `grounds` built the row of names under a room's wall, and its own header
     recorded the decision it replaced: this was a LEGEND once — five hues
     poured into one field and a colour key beside it — and the mixture asked
     a reader to separate five people's memories before they could read any
     of them. It could not repay that work, because a room's ground is
     structurally incapable of explaining its sky: the wall query stopped at
     shares, so a member saw the pattern somebody arrived at and never the
     captures behind it. So the ground became ONE person's, yours by default,
     and this was how you changed whose. You were always first and had no
     swatch — you are the warm white the whole world is drawn in, and a
     colour chip for yourself would have implied you were one option among
     five rather than the ground the others are read against.

     Hues came from `hueByOwnerRef`, written where the sprites are tinted so
     that a name and the orbs it switched to could not disagree. That ref
     survived empty while `canvas/simulation.ts` still wrote it; both the
     write and the ref went on 2026-10-15. */

  /* `standing` IS GONE: whose ground was under you, null meaning yours.
     Travelling to another wall put you back in your own, because standing in
     someone else's ground was a thing you did in a room and did not follow
     you out of it. The effect that reset it ran on `wallKey` and reset THE
     LABEL only — the loop resets its own ground in `arriveColumn`, because
     this fired while the column was still sliding and a settle at that
     moment left the whole field inactive. All of it goes with rooms
     (founder, 2026-10-12: "방 없애"); there is one ground on every wall left
     and it is that wall's own. */
  /* `standIn` IS GONE. It was the press on one of those names: release the
     focus, remember whose ground this is, tell the loop to stand in it, drop
     to the ground, and write the member into the address so the view was
     bookmarkable. `openGroupMemberRef` stayed as a no-op while the loop
     declared it and called it from a pressed avatar — a press on company
     that no longer existed — and went on 2026-10-15, along with the loop's
     own `SimApi.standIn`, which by then was a verb with no caller on either
     side of the boundary. */
  /* `groundsLit` AND `GROUNDS_LIT_MS` ARE GONE WITH THE BAND THEY LIT. The
     class was removed rather than animated out — the rows carried an opacity
     transition already, so dropping the class WAS the settle, on the curve
     everything else here uses. Its effect keyed on `wallKey` and not on the
     array, deliberately: the array's identity changed whenever a room's
     field was refetched, and re-lighting a corner because a background
     request landed is the world moving on its own. */
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
    /* A ROOM'S CHAIN STOPPED AT THE STATEMENT, AND THAT WAS THE POINT.
       Sharing into a room sent the statement and nothing under it — the
       memories stayed on their author's own wall. So a room's board could
       honestly name the shared statements that fed it and WHO said each one,
       and it could not name anyone's raw inspirations. That was a privacy
       boundary rendered as a shorter chain, not a missing feature: a room
       that could show you the memories behind someone else's statement would
       have broken the promise the share note made. Gone with rooms (founder,
       2026-10-12: "방 없애"). */
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
  }, [atWall, agents, notes, citations]);

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
   * Each wall's ground has its own source, and they are the two the loop
   * itself pours from — your archive and the agent's own captures. There was
   * a third, a room's pooled field, and the number over its door was the
   * subject of one of this file's better corrections: see the tombstone in
   * the branch below.
   */
  const wallCount = useMemo<number>(() => {
    if (atWall.kind === "agent") {
      const a = (agents ?? []).find((x) => x.agent.id === atWall.id);
      return a?.inspirations.length ?? 0;
    }
    /* A ROOM'S DOOR COUNTED ONE MEMBER'S GROUND, not the room's. It counted
       the whole pooled field until 2026-08-28, when the founder stood in a
       room holding three memories, none of them theirs, and read "3
       INSPIRATIONS" over an empty ground. `space/ground-count.ts` carried
       that argument and is deleted with rooms. */
    return inspirations?.length ?? 0;
  }, [atWall, agents, inspirations, auth?.profile?.id]);

  /* `wallTotal` went with the door that printed it. It existed so that
     "N inspirations" could say both the number in the ground and the number
     in the archive when they disagreed — a careful fix to a control that
     should not have been printing a number at all. */

  /**
   * HOLDING SOMETHING UP IN FRONT OF THE WORLD.
   *
   * Founder: "for your inspirations, after I click on it, I feel like I'm
   * lost how to go back to the previous screen... maybe for your
   * inspirations, this should just be a modal that you can escape to go back
   * to your top of mind."
   *
   * It goes through the world's own history writer rather than a bare
   * navigate, which is the difference between an overlay and a page. The
   * pathname does not change — only a parameter on it — so this component
   * never unmounts, the camera stays exactly where it was, and dismissing is
   * a return rather than a trip somewhere else. See `ViewOpen` in
   * `lib/view-location` and `closeOpen` in `lib/use-view-navigation`.
   */
  /* ONE IMMEDIATELY COMMITTED RESPONSE, not persistent or cross-owner memory.
     It moved here with the conversation: `createConversation` returns the row
     holding the first question, and re-reading it over the network would show
     an empty transcript for a beat after a person has just watched their own
     words land. Cleared the moment the owner or the conversation changes, so
     one account can never see another's committed question. */
  const committedTalk = useRef<{owner:string;row:ApiConversation}|null>(null);

  /**
   * ═══ THE FOUR PLACES ARE PLACES, SO YOU MOVE — YOU DO NOT STACK ═════════
   *
   * Founder: "If I click on inspiration, then chat, then inspiration, then
   * chat, then I have to close it four times before seeing the now. Like,
   * are you not moving the pages and opening modals instead? You should move
   * the pages."
   *
   * Exactly what was happening, and the arithmetic is simple. Every press
   * here PUSHED a history entry, and `closeOpen` walks back ONE — so four
   * presses built four entries and the close undid them one at a time.
   * `openFrom` had carried the world's address forward correctly all along;
   * the depth was the problem, not the memory.
   *
   * A DESTINATION REPLACES A DESTINATION. The four are peers in a bar at the
   * bottom of the screen, which is the one arrangement every person already
   * has a model for: moving between tabs does not deepen anything, and
   * leaving gets you out from wherever you happen to be standing. So the
   * depth from the world is always exactly one, `navigate(-1)` is both a
   * true return AND a single press, and the browser's own Back keeps
   * agreeing with Escape and with the close — which is the property the
   * history-based dismissal was chosen for in the first place.
   *
   * AND A CONVERSATION IS ONE OF THE THINGS IT REPLACES. The dock stands on
   * an open chat now, which it did not before, so these rows became
   * reachable from a state they had never been pressed in: `open` would have
   * been set with `conversationId` still beside it — two surfaces on screen
   * at once — and the `null` row returned on its first line, so "Now" was a
   * lit, labelled, dead control. That is the sixth time a handler here has
   * not matched a state it could be pressed in; this one was born in the
   * same change that made it reachable.
   */
  /**
   * Whether you are standing somewhere other than the world, which is the
   * whole of the question "does this press move me, or deepen me".
   *
   * `compose` BELONGS IN HERE AND WAS LEFT OUT, and the founder found it
   * twice: "bottom bar seems to be opening on top of things rather than
   * switching the pages", and then exactly — "if I click on inspirations,
   * then chat, then new inspiration, then new chat, and then click now, I
   * have to click now like four times to actually get there."
   *
   * Four surfaces, four presses, because the notepad was the one place this
   * predicate did not recognise as being away from the world. Everything
   * that opens from a destination REPLACES it, so the depth from the world
   * stays one and a close is one press — except the notepad, which pushed,
   * and then every surface opened after it pushed on top of that. Each
   * press of Now then walked back exactly one entry, through the whole
   * chain, which is what being made to press it four times IS.
   */
  const standingAway = (view: ViewLocation | null | undefined) =>
    Boolean(view?.open || view?.conversationId || view?.compose);

  const openOverHome = useCallback((what: ViewOpen | null) => {
    const nav = viewNavigationRef.current;
    /* `null` IS YOUR TOP OF MIND, which is the world itself — so that row
       puts down whatever is held up rather than navigating anywhere. It is
       why pressing it cannot strand you, which is the whole of the founder's
       "I didn't realise clicking on top of mind would leave me there".
       WHATEVER is held up: a destination, or a conversation, which have
       separate closes because they have separate addresses. */
    if (what === null) {
      if (nav.view?.conversationId) nav.closeConversation();
      /* THROUGH `leaveOpen`, not through `closeOpen`: this is the same exit
         the bar's Now row takes, and it is reachable with a saved note open
         (the page menu's own top-of-mind row arrives here). */
      else if (nav.view?.open) leaveOpen();
      return;
    }
    /* AND THE NOTEPAD IS PUT DOWN. Same rule in the other direction: a place
       and the note you were writing cannot both be the place you are. The
       draft is untouched — `closeComposer` keeps the words, and the archive's
       own new-note button opens straight back onto them. */
    nav.write(
      { ...(nav.view ?? EMPTY_VIEW), open: what, compose: false, conversationId: null },
      standingAway(nav.view) ? { replace: true } : {},
    );
  }, [leaveOpen]);

  /**
   * AND A CONVERSATION IS A PLACE, ON THE SAME TERMS.
   *
   * It wants its own function only because it writes a different parameter;
   * the rule is `openOverHome`'s and must not be restated. Reached from the
   * chats list, it REPLACES that list rather than sitting on top of it —
   * which is what makes "Now" one press from inside a chat instead of two,
   * and the chat's own close one press instead of landing you back on the
   * list you were trying to leave.
   *
   * WHAT PAYS FOR IT: the browser's Back from a conversation reaches the
   * world rather than the chats. The step back to the list is a visible
   * chevron on the surface itself, which is what Law 2 asks for and what
   * browser Back explicitly is not — "a list is not an exit. Browser Back is
   * not an exit."
   */
  const openTalk = useCallback((id: string | null) => {
    const nav = viewNavigationRef.current;
    nav.write(
      { ...EMPTY_VIEW, conversationId: id ?? 'new' },
      standingAway(nav.view) ? { replace: true } : {},
    );
  }, []);
  const menu = usePageMenu(locale, auth?.account?.id, agentWall ? { id: agentWall.id, name: agentWall.name } : null, openOverHome);

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
    /* A ROOM'S GROUND WAS REACHABLE TOO, and the rule it followed is worth
       keeping: each row said WHOSE memory it was out loud, because on a
       room's ground that fact was carried by a per-member hue and a hue is
       not readable aloud. Gone with rooms. */
    return (inspirations ?? [])
      .slice()
      .sort((x, y) => y.capturedMs - x.capturedMs)
      .map((m) => ({ id: m.id, label: `${clean(m.preview)}${m.reflectionCount > 0 ? `, ${say("worldReflected")}` : ""}` }));
  }, [atWall, agents, inspirations, locale, say]);

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
    setRecentInspiration(null);
    setMouthOpen(true);
    // Capture is an explicit navigation intent. Record it before boot/roster
    // restoration or the world's debounced observer can close the new editor.
    const nav=viewNavigationRef.current;
    /* AND NO ROOM OVER IT. `open` was the one field this list did not clear,
       so pressing a dock row while a room was up left the archive standing on
       the notepad — the two surfaces the founder caught in one screenshot,
       with the dock greyed out between them. The notepad is a place, and
       arriving at a place means leaving the last one. */
    /* REPLACING WHATEVER YOU WERE STANDING ON, for the reason in
       `standingAway`: the notepad is a place you MOVE to, not a depth you
       add, and pushing one made every close after it a step through a
       chain rather than a return to the world. */
    nav.write({...EMPTY_VIEW,...nav.view,section:'top',at:null,compose:true,find:false,open:null,
      inspirationId:null,reflectionId:null,principleId:null,sharePrinciple:false,conversationId:null},
      standingAway(nav.view) ? { replace: true } : {});
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
      cited: false, roots: 0, promotion: 0, onPoster: false, underPrinciple: false, terms: [] };
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
      /* `shouldReflect` IS GONE (2026-10-10), and it had never once been
         true. It read `intent.reflect`, which came from `keepIt(andReflect)`,
         which came from `InspirationComposer`'s `onSubmit` — and the composer
         has only ever called `onSubmit(false)`. So the branch it guarded
         (opening a question sheet on the thing just saved) was unreachable
         code behind a flag nothing could set. It went with the fold rather
         than because of it; see the tombstone on the sheet itself. */
      return () => { if (!remaining && !preserveNewer && !composerDraft.current.current.media.length) {
        setMouthOpen(false);
        if (initiated) simApiRef.current?.acknowledge('kept');
        /* "I'M INSPIRED!", SAID BY THE ONE WHO JUST JUMPED. Founder,
           2026-10-16: "saved and lets chat about it should come from the
           agent's speech bubble. as soon as user saves inspiration, i love
           how the character jumps up and down, but for a few sec, make that
           say 'I'm inspired!' and the CTA should be let's chat about it." The
           bubble's act is the chat about THIS save (see the bubble below). */
        setCharSay(atWallRef.current.kind === 'self' ? say('worldImInspired') : say('worldSavedToYourWall'));
        if(initiated&&storageScope)setRecentInspiration({owner:`${storageScope.accountId}:${storageScope.profileId}`,id:made.id,text:displayText,attachments:detail.attachments});
        viewNavigationRef.current.closeComposer();
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
  /* ═══ WHETHER SAVE CAN BE PRESSED, AND WHAT THE BAR IS SAYING ═════════
     Both read by the dock. They sit here, directly above `keepIt`, because
     the first is that function's own guard said once instead of twice —
     `whyNoSend` in `ConversationPanel` is the same shape for the same
     reason, and it was written after a Send that looked pressable and did
     nothing on press. The failure a disabled state prevents is a control
     that absorbs a press silently; the failure TWO copies of the condition
     cause is the same thing wearing a different hat. */
  /* ═══ SPEAKING INTO THE NOTE ══════════════════════════════════════════
     Founder: "is it not possible to do speech to text easily, or is audio
     the only easy way to record?"

     It is, and `lib/use-dictation.ts` carries the full argument for why it
     is the better default here rather than an extra: signals are derived
     from the WORDS of an inspiration, so a spoken thought that lands as
     text feeds the top of mind and is searchable, while the same thought as
     a `.webm` is opaque to every layer above storage.

     THE ANCHOR IS A REF, NOT THE RENDERED VALUE. The hook asks for the
     note's current words at the moment the microphone opens; reading
     `draft` from this closure would hand it whatever was on screen when
     this callback was last built. `draftRef` is the same seam every other
     handler in this file reaches through. */
  const dictation = useDictation(
    () => draftRef.current,
    (text) => { draftRef.current = text; setDraft(text); setMouthNote(''); },
    locale,
  );

  /* ═══ AND EVERY WAY OUT OF THE NOTEPAD RELEASES THE MICROPHONE ════════
     `dictation.stop()` had exactly ONE call site — the Stop control in the
     bar — so every other exit left the engine running. The page folds, the
     Stop control folds with it, and the only remaining release was `Home`
     unmounting: a tab left open on the world is a tab still transcribing
     into a draft nobody is looking at, on the one feature in this product
     whose own disclosure says the audio leaves the device.

     `saveAsDraft` STOPS THE RECORDER AND NOT THIS, which is how the hole
     stayed invisible. The two are the same kind of thing and only one of
     them was wired, so the notepad looked like it cleaned up after itself.

     SO IT IS THE SAME SHAPE THE RECORDER ALREADY HAS — see `if (!mouthOpen
     && recording.phase !== 'idle') void recording.stop()` further up, which
     was written for the same bug and is the precedent rather than a
     coincidence. A release at each exit was the alternative and is the
     five-call-sites rule again: `saveAsDraft`, the dock's Now row, a press
     on another place, a conversation, the browser's Back, and whatever
     opens the notepad's successor. The notepad being closed is the FACT; an
     effect on that fact cannot be forgotten by the next exit added.

     `stop` AND NOT `abort`: a person leaving mid-sentence still owns the
     words they had said, and `stop` asks the engine for its last final
     result, which lands in the draft they are leaving behind. `abort` is
     for unmount, where there is nothing left to write into. */
  useEffect(() => {
    if (!mouthOpen && dictation.listening) dictation.stop();
  }, [mouthOpen, dictation.listening, dictation.stop]);

  /* ═══ THE SAVE RULE, SAID ONCE, AND NOW ACTUALLY ONCE ═════════════════
     `lib/keep-ready.ts` was written so this condition exists in one place,
     and its header spends thirty lines on the two copies that preceded it.
     It then had THREE copies again, and the two new ones were both LOOSER
     than this one:

       `keepIt`'s own guard omitted `dictation.listening` and
       `uploadingMediaId`. So the rule said one thing on the button and a
       weaker thing at the moment of the press — which is the precise
       failure `whyNoSend` was written for, inverted: not a control that
       looks pressable and does nothing, but a control that looks BLOCKED
       and saves anyway when reached by another route.

       `Cmd+Enter` in the notepad and `Enter` in the link field reached
       `keepIt` without consulting the rule at all. The second carried a
       third hand-written copy of its own (`blocked` in
       `InspirationComposer`), which is a DISABLING condition rather than
       the save rule and is documented there as such now.

     Consequence, measured: speak into the note, press `Cmd+Enter`, and a
     save begins carrying only what the engine had already marked final.
     Whatever was mid-utterance is gone. That is the loss the comment under
     `recording` below says this rule exists to prevent, written while the
     keyboard was walking straight past it.

     ONE OBJECT, BUILT HERE, READ TWICE. The press cannot simply reuse the
     rendered answer — it reads the draft store's CURRENT contents, which a
     background flush or another tab may have moved underneath the last
     render, and that is the whole reason `keepIt` asks again rather than
     trusting a disabled attribute. What it must not do is ask a DIFFERENT
     QUESTION. So the fields are enumerated once, in this literal, and the
     press overrides only the ones it has a fresher reading of — a typed
     `KeepReadiness` spread, so a condition added to that interface tomorrow
     is asked at both sites or neither, and the compiler says which. */
  const keepReadiness: KeepReadiness = {
    hasWords: composerHasWords,
    ready: composerDraft.ready,
    saving: Boolean(inspirationSave.pending) || inspirationSave.busy || preparingInspiration,
    uploading: checkingFiles || Boolean(uploadingMediaId),
    /* DICTATING COUNTS AS RECORDING for the purpose of keeping: a sentence
       half-spoken is the same unfinished state as a clip half-recorded, and
       saving mid-utterance would drop whatever the engine had not yet
       marked final. */
    recording: recording.phase !== 'idle' || dictation.listening,
    undecidedRecording: Boolean(composerDraft.draft.recordingCandidate),
    invalidFiles: inputMedia.filter(item => item.validationError).length,
    files: inputMedia.length,
  };
  const keepReadinessRef = useRef(keepReadiness); keepReadinessRef.current = keepReadiness;
  const whyNotKeeping = whyNotKept(keepReadiness);
  /* THE BAR'S OWN PREDICATE, FROM THE FILE THAT OWNS THE RULE. This was
     `composerHasWords && whyNotKeeping === null` written out here — which is
     `canKeep`'s body, re-typed, in the one file that had just finished
     arguing that the rule is written once. `canKeep` was exported for this
     and reached by nothing but its own test, so the rule had a fourth copy
     and a dead function stating it correctly. */
  const composerCanKeep = canKeep(keepReadiness);
  /** The one transient line the bar shows while a note is open, in the order
      a person needs it: what went wrong first, then what is happening. The
      recorder's clock is not here — it is a control you press to stop, and
      it already stands in the bar as one. */
  const composerState = mouthNote
    /* ═══ AND THE CLOUD LINE CANNOT BE OUTRANKED OUT OF EXISTENCE ══════
       SAID ONCE, THE FIRST TIME. Chrome sends speech to its own servers to
       transcribe it, and a product whose claim is that your material is
       yours owes that sentence to anybody who presses the microphone. Once
       per PAGE — not once per utterance and not once per press of the
       microphone — in the bar, where every other passing line goes, and not
       in a dialog, because it is a fact rather than a decision and the
       person is already speaking by the time they can read it. It stands for
       as long as that first microphone is open and then never again until
       the page is loaded afresh; `dictation.firstTime` is the half of that
       sentence this file does not own.

       IT USED TO SIT BELOW `composerDraft.error` AND `recording.error`, in a
       first-non-empty chain, which made the one line this product is
       obliged to show the most easily suppressed line on the bar. Drop a
       file the page cannot read, press the microphone, say nothing: audio
       streams to a third party and the sentence that says so never appears.
       There is no browser prompt to fall back on either — the permission
       was granted on the first visit and is never asked for again — so the
       disclosure was the ONLY signal, and it was outrankable by a passing
       error about something else entirely.

       SO IT MOVES ABOVE THE TWO LINES THIS FILE CANNOT CLEAR. Both belong
       to other hooks: `composerDraft.error` is the draft store's and
       `recording.error` is the recorder's, and neither has a reset this
       file may call. A line Home cannot take down is a line that can hide
       this one for a whole session, which is exactly what happened.

       IT STAYS BELOW `mouthNote`, AND THAT IS NOT AN OVERSIGHT. The press
       on the microphone clears `mouthNote` itself (see the control in the
       dock), so nothing that was standing BEFORE the start can outrank the
       disclosure. What can is a line written AFTER it — "Stop the recording
       first." when somebody presses `Cmd+Enter` mid-utterance — and that
       must win: it is the answer to an act taken a moment ago by a person
       who has already had this sentence on their screen since they opened
       the microphone.

       AND IT IS GENUINELY ONCE NOW, which this comment used to say was
       impossible. `firstTime` latched: it went true on the first dictation
       and was never written false, so `firstTime && listening` was true for
       EVERY dictation and this line — the one sentence this product is
       obliged to show — was also the one it showed most often. The note that
       stood here designed around that instead of fixing it, and said so.
       `use-dictation.ts` now clears the flag on the second `start()`; its
       doc comment carries what was weighed, including the real argument that
       a disclosure about audio leaving the device SHOULD repeat. It loses to
       Law 4: a notice on its fortieth showing is furniture.

       WHAT WAS REJECTED: putting it first outright, above `mouthNote` as
       well. The old reason for refusing it is gone — a line that is true for
       one dictation can no longer swallow a whole session's answers — but
       the better reason stands and always did: what can outrank the
       disclosure is a line written AFTER it, "Stop the recording first."
       when somebody presses `Cmd+Enter` mid-utterance, and that must win. It
       is the answer to an act taken a moment ago by a person who has had
       this sentence on their screen since they opened the microphone.
       Nothing that was standing BEFORE the press can outrank it, because the
       press on the microphone clears `mouthNote` itself. */
    || (dictation.firstTime && dictation.listening ? say('worldComposerDictateCloud') : '')
    || composerDraft.error || recording.error
    || (dictation.error === 'dictation-denied' ? say('worldComposerDictateDenied') : '')
    || (dictation.error === 'dictation-failed' ? say('worldComposerDictateFailed') : '')
    || (!composerDraft.ready ? say('worldComposerOpening') : '')
    || (uploadingMediaId ? say('worldComposerUploading') : '')
    || (recording.phase === 'idle' ? recording.notice : '');

  const keepIt = useCallback(async () => {
    let text = draftRef.current.trim();
    const initialMedia = composerDraft.current.current.media;
    const pendingLink=composerDraft.current.current.linkText??'';
    try{text=inspirationWithPendingLink(text,pendingLink);}catch{setMouthNote(say('worldComposerInvalidLink'));return;}
    /* ═══ ONE COPY OF THE RULE, ASKED AGAIN AT THE MOMENT OF THE PRESS ══
       These were five hand-written guards — three of them with their own
       English sentences typed inline, none of them the same text as the
       disabled state on the button above them. `whyNotKept` is now the only
       statement of what blocks a save, so the bar's Save and this function
       cannot disagree about whether a press should do anything.

       IT IS STILL ASKED HERE, and that is not belt-and-braces. The button's
       answer was computed on the last render; this reads the draft store's
       CURRENT contents, which a background flush or another tab may have
       moved underneath it. A disabled button is a courtesy — this is the
       actual gate.

       SILENT WHEN THERE IS NOTHING TO KEEP, as before: a blank note's Save
       does not exist, so a press cannot arrive from one, and a complaint
       about having written nothing is not worth saying. */
    const media = inspirationInputMedia(text, initialMedia);
    const rendered = keepReadinessRef.current;
    const blocked = whyNotKept({
      ...rendered,
      /* THE FRESHER READINGS, AND ONLY THOSE. Each line below is the SAME
         condition as the one it overrides, read from the ref the draft store
         writes rather than from the last render's state — never a different
         condition, and never one the rendered answer did not also ask.
         `recording` and `ready` are deliberately absent: `dictation.listening`
         and `composerDraft.ready` are state, so any change to either has
         already produced the render this object was built in. */
      hasWords: Boolean(text || initialMedia.length),
      saving: rendered.saving || preparingInspirationRef.current,
      uploading: rendered.uploading || Boolean(checkingFilesCount.current),
      undecidedRecording: Boolean(composerDraft.current.current.recordingCandidate),
      invalidFiles: initialMedia.filter(item => item.validationError).length,
      files: media.length,
    });
    if (blocked) { setMouthNote(say(blocked)); return; }
    if (!text && !initialMedia.length) return;
    if(pendingLink.trim()){
      composerDraft.setText(text);composerDraft.setLinkText('');draftRef.current=text;setDraft(text);
    }
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
        // An unnamed upload is sent unnamed; its label is the reader's to say.
        const name = item.name ? { name: item.name } : {};
        if (item.type === 'link' && item.url) return { type: 'link', url: item.url, ...name };
        if (!item.uploaded || item.type === 'link') throw new Error('This attachment has not uploaded yet.');
        return { type: item.type, ...item.uploaded, ...name };
      });
      for (const { url } of inspirationLinks(text)) {
        if (!url) continue;
        if (!attachments.some(item => item.type === 'link' && item.url === url)) attachments.push({ type: 'link', url });
      }
      if (attachments.length > 5) throw new Error('Keep up to five attachments in one inspiration.');
      const reference = await composerDraft.flush(); current();
      /* A FILE DOES NOT NAME A KIND. There is no 'file' kind on the server, and
         a PDF kept with words is still a note — so files are left out of the
         count, and a note of files alone is 'note'. A file beside a photo is
         'mixed', the nearest true thing the list has. */
      const kinded = attachments.filter(item => item.type !== 'file');
      const only = attachments.length === 1 && !text ? attachments[0]!.type : null;
      const kind = only && only !== 'file' ? only : kinded.length ? 'mixed' : 'note';
      /* Said at upload, kept with the thing it is about. Unanswered is not
         recorded at all: an empty reflection row is a question the person was
         asked and did not answer, which is a different fact from one they
         were never asked, and only one of those is true here. */
      const why = momentWhy.trim();
      const reflections = why
        ? [{ question: say('worldMomentAsk'), answer: why }]
        : undefined;
      inspirationSave.start({ operation: 'inspiration', input: { text, kind, source: 'app',
        ...(attachments.length ? { attachments } : {}), ...(reflections ? { reflections } : {}),
      },
        ...(reference ? { draft: reference } : {}) });
      setMomentWhy('');
      setCharSay('');
    } catch (reason) { if (composerEpoch.current === epoch) setMouthNote(reason instanceof ApiError ? say('worldComposerUploadFailed') : reason instanceof Error ? reason.message : 'Could not save this inspiration. Your draft is here.'); }
    finally { if (composerEpoch.current === epoch) { preparingInspirationRef.current = false; setPreparingInspiration(false); setUploadingMediaId(null); } }
  }, [inspirationSave.pending, inspirationSave.busy, inspirationSave.start, composerDraft, recording.phase, momentWhy, say]);

  /* ═══ THREE DOORS INTO ONE DRAFT ═══════════════════════════════════════
     'photo' is the chooser, the drop and the paste: every file is sniffed.
     'audio' is the recorder's own clip. 'file' is the ＋'s "Add file"
     (2026-10-16): `inspectAttachmentFile` reads the name and the declared
     type against the server's list and the 25 MB cap, BEFORE anything is
     uploaded. A photo chosen through "Add file" is still a photo, so it is
     handed to the sniffer and kept as one — a picture shown as a filename
     would be the tile describing the thing instead of showing it.

     A FILE IS STORED UNDER THE TYPE IT WAS CHECKED AS. Browsers report no
     type for a `.md` and a vendor alias for a `.csv`; the upload presigns
     with `blob.type`, so the blob is re-wrapped with the verdict's type and
     every later step — presign, PUT, the save — says the same thing. */
  const addInspirationFiles = async (files: File[], door: 'photo' | 'audio' | 'file' = 'photo') => {
    const audio = door === 'audio';
    const epoch = fileOwnerEpoch.current;
    checkingFilesCount.current += 1; setCheckingFiles(true);
    const accepted: InspirationDraftMedia[] = [], problems: string[] = [];
    try {
      for (const file of files) {
        try {
          if (audio && (!file.size || file.size > 25 * 1024 * 1024 || !file.type.startsWith('audio/'))) throw new Error('Choose a recording under 25 MB.');
          const verdict = door === 'file' ? inspectAttachmentFile(file) : null;
          if (verdict?.kind === 'file') {
            if (epoch !== fileOwnerEpoch.current) return;
            /* NO NAME IS KEPT AS NO NAME: "File" is said on the tile
               (`attachmentLabel`), never saved as this file's name. */
            accepted.push({ id: crypto.randomUUID(), type: 'file', ...(file.name ? { name: file.name.slice(0, 255) } : {}),
              blob: file.type === verdict.contentType ? file : new File([file], file.name, { type: verdict.contentType, lastModified: file.lastModified }) });
            continue;
          }
          const checked = audio ? file : await inspectInspirationPhoto(file);
          if (epoch !== fileOwnerEpoch.current) return;
          accepted.push({ id: crypto.randomUUID(), type: audio ? 'audio' : 'image', ...(checked.name ? { name: checked.name.slice(0, 255) } : {}), blob: checked });
        } catch (reason) {
          /* A REFUSED FILE STAYS ON THE SHELF, MARKED, as a refused photo
             does — so the person sees which one and can take it off. The
             reason is said in their language: `FileRefused` carries a code. */
          if (reason instanceof FileRefused) {
            accepted.push({ id: crypto.randomUUID(), type: 'file', ...(file.name ? { name: file.name.slice(0, 255) } : {}), blob: file,
              validationError: say(reason.reason === 'too_large' ? 'worldAttachTooLarge' : reason.reason === 'empty' ? 'worldPhotoEmpty' : 'worldAttachUnsupported') });
            continue;
          }
          const message = reason instanceof Error ? reason.message : 'Couldn’t read this file.';
          if (!audio) accepted.push({ id: crypto.randomUUID(), type: 'image', ...(file.name ? { name: file.name.slice(0, 255) } : {}), blob: file, validationError: message });
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
    if (!hasRecording) return addInspirationFiles([file], 'audio');
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

  /* `?? groupBallsRef.current.get(panelId)` stood between these two: a room's
     orbs lived in their own index, built per run of the loop and cleared in
     its teardown, so the pour's `byId` genuinely did not hold them. One index
     and one detached fallback now. */
  const panelBall = panelId
    ? ballsRef.current?.byId.get(panelId)
      ?? (detachedInspiration?.ball.id === panelId ? detachedInspiration.ball : null)
    : null;
  /* `panelIsGroup` AND `panelCanReflect` ARE GONE, AND THEY WERE THE SAME
     QUESTION. A room orb opened a different card: whisper attribution
     instead of a date, a cited-by sentence, and — for another member's save
     — no reflect, no edit, no delete, no step-to-the-next-memory, because
     none of those are yours to do to somebody else's memory. The test was
     `panelBall.col !== undefined`, and `col` is only ever set by
     `makeGroupInspirationBall`. Nothing calls that from this file now
     (founder, 2026-10-12: "방 없애"), so every orb this panel can open is
     one of your own and every branch resolved the same way. Fourteen sites
     collapsed; the eight the room branch owned are deleted outright. */
  const panelHasReflection = (panel?.detail
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
    if (!panelId) return { prev: null, next: null };
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
  }, [panelId, inspirations]);

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
    if (!panelId) return false;
    const id = dir === -1 ? panelNeighbours.prev : panelNeighbours.next;
    /* lit even at the ends, where there is no neighbour to step to and
       `stepToMemory` never runs: the press happened, and a control that
       stays dark when you press it reads as one that did not hear you */
    if (!id) setCaretLit(dir);
    /* called from a key event, long after `stepToMemory` is defined below */
    if (id) stepToMemory(id);
    return true;
  };
  const panelStepCarets = (
    <>
      {panelNeighbours.prev ? (
        <button
          type="button"
          aria-label={say('worldStepBack')}
          title={say('worldStepBack')}
          className={caretLit === -1 ? "jar-caret-lit" : undefined}
          onClick={() => stepToMemory(panelNeighbours.prev)}
        >
          <span className="jar-caret jar-caret--left" aria-hidden="true" />
        </button>
      ) : null}
      {panelNeighbours.next ? (
        <button
          type="button"
          aria-label={say('worldStepForward')}
          title={say('worldStepForward')}
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
  const [recentInspiration,setRecentInspiration]=useState<{owner:string;id:string;text:string;attachments:InspirationDetail['attachments']}|null>(null);
  /**
   * FROM KEEPING A THING TO TALKING ABOUT IT.
   *
   * Founder: "from saving inspirations to going into a chat experience should
   * actually feel quite natural... having a separate entry point into saving
   * an inspiration versus talking about it with WAKA shouldn't be separate."
   *
   * It is not a second entry point and it is not a mode on the box. The box
   * has one job and never asks you to classify what you are about to type —
   * that hesitation would land on the save, which is the one act that must
   * have none. Saving is a deposit; talking is a withdrawal; a box that might
   * do either makes you decide which before you have written anything.
   *
   * So talking is a CONSEQUENCE of keeping. You keep something, the creature
   * says what it did, and that moment carries one way forward. Pressing it
   * opens a conversation that already has a subject — your own words, sent as
   * the first thing said, with a reply asked for. Which is also why there is
   * no blank "talk to WAKA" room worth having: a conversation with no subject
   * is the one kind this product cannot be better at than anything else.
   *
   * IGNORING IT COSTS NOTHING. The receipt is as skippable as it was before;
   * this adds a door beside it, not a question in front of it.
   */
  /** Whether this input can drag at all, which decides what the box offers. */
  const [touchOnly, setTouchOnly] = useState(
    () => window.matchMedia?.('(pointer: coarse)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    if (!mq) return;
    const change = () => setTouchOnly(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  const [talking, setTalking] = useState(false);
  const talkAbout = useCallback(async (kept: { id: string; text: string }) => {
    const profileId = storageScope?.profileId;
    if (!profileId || talking) return;
    setTalking(true);
    try {
      const conversationId = crypto.randomUUID();
      await createConversation(profileId, conversationId, undefined, undefined, {
        id: crypto.randomUUID(),
        content: kept.text,
        requestReply: true,
      });
      setRecentInspiration(null);
      navigate(`/chat/${conversationId}`);
    } catch {
      /* The keep itself already landed — this failed to open a room to talk
         about it in, which is a different and much smaller thing to say. */
      setCharSay(say('worldTalkFailed'));
    } finally {
      setTalking(false);
    }
  }, [navigate, say, storageScope?.profileId, talking]);
  const inspirationOwner=storageScope?`${storageScope.accountId}:${storageScope.profileId}`:null;
  const visibleInspiration=recentInspiration?.owner===inspirationOwner?recentInspiration:null;

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
   *
   * AND SINCE 2026-10-10 IT CARRIES THE ONE PLACE A PERSON TYPES.
   * Founder's workflow design: *"Typing happens in one place only: when you
   * correct."* So `correctionText` rides the same POST as the verdict it
   * belongs to rather than becoming a second act with a second store —
   * `feedback.correction_text` has been on the row since the route was
   * written, and `top-of-mind-synthesis.ts` already reads it back into the
   * generation payload beside the statement it corrects. Nothing new was
   * invented to hold these words; what was missing was a way to say them.
   *
   * IT RETURNS WHAT HAPPENED, which the three cheap answers never needed.
   * A verdict that does not land rolls its own light back and that is enough
   * — the row is still there to press again. A CORRECTION cannot be handled
   * that way: the words are the person's, they are not on screen anywhere
   * else, and losing them silently is the one failure this product refuses.
   * `null` means nothing was sent (offline); the promise resolves false when
   * the server refused it, and the caller keeps the words and says so.
   */
  const sayVerdict = useCallback(
    (
      id: string,
      value: "true" | "partly" | "not_true",
      targetId?: string,
      contested?: boolean,
      targetRevision?: string,
      correctionText?: string,
    ): Promise<boolean> | null => {
      setVerdicts((prev) => new Map(prev).set(id, value));
      /* the receipt: what this answer taught the loop, said where the act
         happened, worded only as strongly as its enforcing test allows —
         goals/the-legible-loop.md Phase 2 */
      /* `RECEIPTS.verdictGroup` — "the room reads who stands where" — was
         what a `targetId` meant: an answer on a room's SHARED statement
         rather than on one of your own patterns. Rooms are gone (founder,
         2026-10-12: "방 없애") and so is that receipt; a `targetId` now only
         ever names a statement of your own reached through the provenance
         room, which is the same act as answering it in place. */
      const receipt = value === "not_true"
          ? say(RECEIPTS.verdictNo.messageKey)
          : say(RECEIPTS.verdictKept.messageKey);
      if (offlineRef.current) return null;
      /* Filed by whoever is standing here. A claim read from an agent's wall
         is about the agent, and a verdict on it under your own profile is a
         verdict about a signal you do not own — which the server refuses, as
         it should. */
      return createFeedback({ targetType: "signal", targetId: targetId ?? id, value,
        ...(correctionText ? { correctionText } : {}),
        ...(targetRevision ? { targetRevision } : {}),
        ...(answeringAsRef.current ? { profile: answeringAsRef.current } : {}) })
        .then(() => {
          if (!readingMountedRef.current) return true;
          setVerdictReceipt({ id, text: receipt });
          window.setTimeout(() => setVerdictReceipt((r) => (r?.id === id ? null : r)), 7000);
          /* AN ARBITRATION JUST HAPPENED. A verdict on a contested ground
             resolves its pair on the server (lib/contested-pairs.ts), and
             the pair has TWO sides — only the server knows the other one,
             so the settled light is fetched, not guessed. `partly` resolves
             nothing and the refetch honestly brings the waver back. */
          if (!contested) return true;
          loadPersonalReading()
            .then((tom) => absorbBoard(tom))
            .catch(() => undefined);
          return true;
        })
        .catch((error) => {
        /* it did not land, and the row should not claim it did */
        setVerdicts((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        if ((error as { code?: string })?.code === 'feedback_target_changed') verifyReadingRef.current(false);
        return false;
      });
    },
    [],
  );

  /**
   * KEEPING A CANDIDATE IS AN ORDINARY SAVE, THEN A LINK.
   *
   * The words go through `createInspiration` like anything typed into the
   * box — with the candidate's id as the save request id, so a retried keep
   * finds the first save instead of making a second — and only then is the
   * basket told which save it became. It arrives in the world the way a
   * fresh save does. If either step fails, the candidate comes back to the
   * front of the queue and the creature says so; nothing is lost.
   */
  /* A save made for a candidate whose link to the basket has not landed yet. */
  const keptSavesRef = useRef(new Map<string, { made: Awaited<ReturnType<typeof createInspiration>>; savedAs: string }>());
  const keepCandidate = useCallback(async (candidate: ApiHarvestCandidate, words: string, requeue = true): Promise<boolean> => {
    const profile = storageScope?.profileId;
    if (!profile || offlineRef.current) {
      /* Nothing was sent, so the card comes back rather than vanishing. */
      if (requeue) {
        if (harvestLeavingRef.current.has(candidate.id)) harvestReturnRef.current.add(candidate.id);
        else setHarvestQueue((queue) => [candidate, ...queue.filter((row) => row.id !== candidate.id)]);
        setCharSay(say('worldHarvestKeepFailed'));
      }
      return false;
    }
    try {
      /* ONE SAVE PER CANDIDATE, WHATEVER FAILS. The request id is known
         before anything is sent — the candidate's own for its own words, one
         derived from the candidate and the words for corrected ones
         (`candidateSaveRequestId`) — so a lost response retried is the same
         save. And once a save exists it is remembered: if the link failed
         and the words are then corrected, that same save takes the new
         words rather than a second save being made beside it. */
      const known = keptSavesRef.current.get(candidate.id);
      const made = !known
        ? await createInspiration({ text: words }, { requestId: await candidateSaveRequestId(candidate, words), profile })
        : known.made.text === words ? known.made : await updateInspiration(known.made.id, { text: words });
      /* `savedAs` is the words the save was MADE with, which its request id
         was derived from; the keep sends them when the save says something
         else now, so the server can still tell whose save it is. */
      const savedAs = known?.savedAs ?? words;
      keptSavesRef.current.set(candidate.id, { made, savedAs });
      /* The archive changed: a page still arriving must not overwrite it. */
      sourceListMutationRef.current += 1;
      if (readingMountedRef.current) {
        const detail = toInspirationDetail(made);
        detailsRef.current.set(made.id, detail);
        if (!inspirationsRef.current?.some((item) => item.id === made.id)) {
          birthInspiration(made.id, detail.preview, Date.parse(made.createdAt), made.id);
        }
        setInspirations((previous) => previous?.some((item) => item.id === made.id) ? previous : [...(previous ?? []), detail]);
        if (made.processing) sourceProcessing.track(made.id, made.processing);
      }
      try {
        if (savedAs !== made.text) await keepHarvest(candidate.id, made.id, savedAs);
        else await keepHarvest(candidate.id, made.id);
      } catch (err) {
        /* Decided elsewhere (another tab, or it lapsed): the save stands and
           is already in the world, so this keep is finished — retrying would
           only meet the same refusal. */
        if (!(err instanceof ApiError && err.status === 409 && err.code === 'harvest_decided')) throw err;
      }
      keptSavesRef.current.delete(candidate.id);
      return true;
    } catch {
      if (!readingMountedRef.current) return false;
      if (requeue) {
        if (harvestLeavingRef.current.has(candidate.id)) harvestReturnRef.current.add(candidate.id);
        else setHarvestQueue((queue) => [candidate, ...queue.filter((row) => row.id !== candidate.id)]);
        setCharSay(say('worldHarvestKeepFailed'));
      }
      return false;
    }
  }, [storageScope?.profileId, say]);

  /** Letting a candidate go, with or without a reason. The words are deleted
      on the server in the same write. On failure the question stays open
      with the reason it did not land beside it. */
  const letCandidateGo = useCallback(async (candidate: ApiHarvestCandidate, reason?: HarvestReason, note?: string) => {
    setHarvestWhy({ candidate, busy: true, failed: false });
    try {
      await declineHarvest(candidate.id, reason, note);
      setHarvestWhy(null);
    } catch {
      setHarvestWhy({ candidate, busy: false, failed: true });
    }
  }, []);

  /**
   * DIVE INTO A CLAIM. Founder, 2026-10-15: "user should be able to click on
   * the card to dive deeper." The deeper view already exists — the room the
   * top of mind's "built from" opens: the statement, then every save it
   * stands on, each with the words that carried it. A claim is a signal, so
   * its evidence is one `loadSignal` away. If that read fails, the saves the
   * claim arrived with still open in the archive, which is the shallower
   * door it always had.
   */
  const openClaimRoots = useCallback(async (claim: ApiClaim) => {
    try {
      const detail = await loadSignal(claim.id);
      if (!readingMountedRef.current) return;
      setProvPick(null);
      setProv({ lead: claim.statement, rows: detail.evidence, reviewSignalIds: detail.reviewEvidence?.length ? [claim.id] : [] });
    } catch {
      if (!readingMountedRef.current || !claim.from?.length) return;
      setSavesFocus({ label: formatMessage(locale, "worldClaimFromCount", { count: claim.from.length }), ids: claim.from.map((row) => row.id) });
      openOverHome('saves');
    }
  }, [locale]);

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
  /* `unpublishAsk` AND `publishAsk` ARE GONE with the Private/Public pair —
     see the tombstone at the pair's own site. Both were per-card state and
     both were reset on every change of card, which is the one line that
     survives: opening a different memory must not inherit the last one's
     half-answered question. */
  useEffect(() => {
    setForget({ id: null, step: "rest" });
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

  /* ═══ WHO IS IN HERE, WHETHER IT IS A ROOM OF MACHINES, AND THE PANEL ══
     Founder, 2026-10-12: "방 없애" — remove rooms.

     `groupForm` and `submitGroup` were already a tombstone here: the
     make-or-join sheet they drove was never opened by anything, so that
     state could only be set from inside itself, and `createGroup` went with
     it. `machineGroups` and `machineGroupsRef` go now, and they are worth a
     sentence because of what they fixed: a room wore the HUMAN body and
     moved on the human's continuous clock no matter who was in it, so "Our
     agents", a room of five agents, was indistinguishable from a room of
     five people — the whole grammar this world had learned (a machine hand,
     quantized position, a stepped tick, pixelated memories) stopped at the
     room's door. The rule was that YOU do not count toward the answer, since
     you are in every room you can see; what decided a room's character was
     who ELSE was standing in it. `groupPanel` goes with the panel it opened.

     `setMembersRef` stayed as a setter nothing called, for the same
     simulation-owns-it reason as `membersRef`; both went on 2026-10-15 when
     the loop stopped declaring them. */


  /* `rereadGroupBoard` AND `groupReading` ARE GONE. `POST
     /groups/:id/top-of-mind/refresh` was the last verb on the flat surface
     with no way in from the world, and this was the way in: one block of its
     own, deliberately NOT the self wall's toolbar opened up to rooms,
     because those other verbs — hold this one up, say it in my words, not
     this — act on a self entry's id and its pinned/locked facts, and a
     room's entries were a different row with a different shape. One verb
     that works beat four that look right. The route is gone with rooms
     (founder, 2026-10-12: "방 없애"); `Read it again` on your own wall is
     untouched, which is where it started. */

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

  /* ═══ THE AGENT-KEY EFFECTS AND VERBS ARE GONE — THEY COULD NOT FIRE ══
     Two effects and two callbacks stood here and every one of them was
     gated on `settingsFor`, which was permanently `null` (see the tombstone
     where `SpaceSettings` used to mount for the proof). The fetch that
     filled the key list never ran; the effect that forgot the minted secret
     on close never ran; `issueKey` and `revokeKey` had one call site each
     and it was inside the panel that could not mount.

     MINTING HAD ALREADY STOPPED two commits before this one, on the same
     proof — "stop minting a key nobody can hold, see or revoke" — so what
     these administered was a credential nothing creates. The routes stand:
     `POST`, `GET` and `DELETE /agent-keys`, and `lib/middleware.ts` still
     accepts the keys that exist. The day an agent is reachable from outside
     again, the listing comes back WITH the minting and WITH a revoke, in
     one change, which is the whole lesson. */

  /* ═══ THE ROLL, THE RENAME BOX AND THE ROOM SO FAR ════════════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     Three things stood here, all three keyed on standing in a room. The
     MEMBER FETCH, which loaded the roll on arrival and not before, because
     the axis could hold many rooms and none of them owed a request until you
     were in it. The RENAME BOX's state, whose only surface was the panel
     that could not mount. And THE ROOM SO FAR — a per-room timeline fetched
     by the same trigger as the roll, because they answered one question at
     two depths: who is here, and how the room came to hold them. It was
     refetched on every re-arrival, since a timeline that never moves is a
     timeline nobody trusts.

     `members` and `setMembers` SURVIVED as empty, and only because
     `canvas/simulation.ts` declared `membersRef` as a required option and
     drew a room's company from it. Nothing filled it, and it went on
     2026-10-15 when that file's group branches did. */
  /* ═══ PROPOSING TO A ROOM, AND WAITING FOR IT TO AGREE ════════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     A room's board was never edited; it was PROPOSED to and affirmed. That
     was the canon's rule and it was the only honest one for a shared
     sentence — one member rewriting what a group believes would be editing
     other people's minds. So the verb was "put it to them", and the board
     moved when the room agreed. `propose`, `openProposals`, `proposalRead`,
     `proposalReceipt`, `proposalTrouble`, `pendingProposalId`,
     `acceptedVersion`, `loadOpenProposals`, `placeProposal`,
     `watchAcceptedVersion`, `sendProposal`, `answerProposal`, and the two
     pollers — one waiting for an accepted proposal to become a version, one
     refreshing other members' answers while the question was on screen —
     are all gone, with the five routes that answered them.

     IT WAS THE ONLY PLACE IN THIS PRODUCT THAT WAITED ON OTHER PEOPLE, and
     that is worth recording rather than losing: an open proposal was not a
     notification and did not chase you, it sat on the room's wall and you
     found it by being there. If the pulse ever needs that shape again, this
     is what it looked like — affirming was adding your name, and the board
     changed when the room's rule for that was met, not when you pressed. */


  /* ═══ THE FOUR VERBS ON A ROOM, AND THE PANEL THAT HELD THEM ══════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     `leaving` / `closing` / `removing` / `renaming`, `groupTrouble`,
     `leaveThisGroup`, `renameThisGroup`, `closeThisGroup` and `removeMember`
     all stood here, every one of them correct and every one of them
     unreachable. They were reached only through `SpaceSettings`, and that
     panel could never mount — `setSettingsFor` had three writers and all
     three wrote `null`, because its opener went with `.jar-here-list` on
     2026-10-09.

     WHAT IS WORTH KEEPING FROM THE ARGUMENT, since it is the one part of
     this that generalises. `e2e:when-it-fails` had pressed each of these
     verbs against a 500 on the route it rests on and asked whether anything
     on screen said so. Three of the four said nothing: rename was
     byte-identical before and after, and leave and close MURMURED — their
     armed confirm collapsed back to its resting word, which is exactly what
     pressing `stay` does. A collapsing confirm is worse than silence: it is
     the shape of a successful cancel. The cure was prose beside the verb,
     keyed BY VERB so it lands where the press did, since an error at the top
     of a panel with four destructive words in it does not say which one
     refused. That rule outlives rooms — it is why the memory panel's delete
     says what is still true — and `whyFailed` is still how every surface
     here does it.

     The routes are gone too: `PATCH /groups/:id`, `DELETE /groups/:id` and
     `DELETE /groups/:id/members/:profileId` were implemented, owner-gated,
     and are no longer served. */

  /** read by the loop, which is created once and must not close over stale state */

  /* ═══ NAMING AN AGENT LIVES IN SETTINGS, AND ONLY THERE ════════════════
     `agentName`, `agentTrouble` and `makeAgent` came out on 2026-10-15,
     with the one-field dialog they drove.

     THE DIALOG HAD BEEN UNREACHABLE FOR MONTHS. `agentName` doubled as the
     form's OPEN/CLOSED flag, and the only thing that ever opened it was a
     `.jar-newplace-row` button in the new-place sheet, deleted in
     `f918b62f` when the top-left became a switch between me and my agent.
     After that every `setAgentName` call passed `null` except the field's
     own `onChange`, which cannot run until the field is already on screen.
     Nothing could open it, so nothing did.

     IT IS DELETED RATHER THAN REOPENED because the product already has
     this verb and has it in one place: `SettingsPanel`'s Memories group,
     reached from the cog, with its own field and its own `addAgent`. A
     second door to the same act would be fixing an absence nobody has felt
     by adding a duplicate.

     WHAT GOES WITH IT, worth not losing twice: the reason `agentTrouble`
     existed. `e2e:when-it-fails --only make-agent` read SILENT because the
     catch cleared `agentName`, which CLOSED the form — so a refusal and
     pressing `not now` were the same gesture, and nothing said which had
     happened. `SettingsPanel` keeps its own `agentTrouble` for exactly that
     reason; the lesson is held there. */

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
   *
   * ── AND THE FIRST STEP IS THE ONE THIS PATH DID NOT HAVE ────────────────
   *
   * FOUR STEPS NOW, BECAUSE THE BYTES ARE READ BEFORE ANYTHING IS SENT.
   * `lib/inspiration-photo.ts` opens with the whole rule in one sentence —
   * "Inspect a small header, not the filename or the browser's MIME guess" —
   * and until today this function did precisely the thing that sentence
   * forbids. It classified what it was storing from `file.type`:
   *
   *     type: file.type.startsWith("image/") ? "image" : "file"
   *
   * `file.type` is NOT a fact about the bytes. It is the operating system's
   * guess from the file's extension, which means the person choosing the file
   * decides it — rename `payload.bin` to `photo.png` and every browser on
   * every platform reports `image/png` for it. On the drag and the paste paths
   * the value does not even come from a chooser the product drew. So the
   * memory card accepted whatever it was handed, at whatever size, and wrote
   * down the name the file gave for itself as if the product had checked.
   *
   * THE ACCEPT ATTRIBUTE WAS NOT THE MISSING CHECK EITHER, and it is worth
   * saying plainly because this picker's `accept` was also wrong (it said
   * `image/*`) and fixing only that would have looked like a fix. `accept`
   * greys out rows in the operating system's file chooser. It is defeated by
   * renaming, by a drag and by a paste; it is a courtesy to somebody picking
   * honestly, and it is never a gate. The door is not the lock.
   *
   * SO IT IS THE SHAPE `addInspirationFiles` ALREADY HAD, twenty lines of code
   * away: `const checked = await inspectInspirationPhoto(file)`, and then
   * every later step reads `checked` rather than `file`. That call sniffs the
   * first 64 bytes for the seven formats this product accepts, enforces
   * `MAX_PHOTO_BYTES` (25 MB) and refuses an empty file — and it returns a
   * `File` re-stamped with the type the BYTES say, so `contentType`,
   * `filename`, `size` and the `"image"` classification below are now
   * statements about what was actually read. The duplicated code was never the
   * problem; one of the two copies silently not being the rule was.
   *
   * WHAT WAS REJECTED: sniffing inside `presignAttachment`, so that no caller
   * could forget. It is the right instinct and the wrong layer — the same
   * endpoint carries the recorder's `audio/webm`, which the photo sniffer
   * refuses by design, so the check would have had to learn which kind of
   * upload it was looking at and would have become a second copy of that
   * decision. The caller knows; `SavesOverlay`'s `attach` is the one that
   * genuinely needs the discrimination, and it is still unfixed (its `onFile`
   * takes both a photo and a clip — see `NoteTools.tsx`'s note on that prop).
   *
   * AND A REFUSAL IS NOW SAID OUT LOUD. The old `catch` was empty under the
   * comment "the memory is already kept; only the picture failed to land",
   * which was true of a network failure and is not true of a refusal: a
   * sniffer rejection is a sentence the person needs — "Use a JPEG, PNG,
   * WebP, GIF, AVIF or HEIC photo." — and swallowing it would mean pressing
   * the control, watching the word change to "adding…" and back, and being
   * told nothing. `whyFailed` is the product's one translation of a failure
   * into words, and it already prefers a thrown `Error`'s own message over
   * the fallback, so the sniffer's sentences arrive intact while a server
   * fault still reads as `worldComposerUploadFailed`.
   */
  const [attaching, setAttaching] = useState(false);
  /** Which memory the refusal belongs to, carried with the words — the same
      shape `proposalTrouble` uses above, for the same reason: a message about
      one card must not appear under another one. */
  const [attachTrouble, setAttachTrouble] = useState<{ id: string; text: string } | null>(null);
  const attachTo = useCallback(async (inspirationId: string, file: File) => {
    setAttaching(true);
    setAttachTrouble(null);
    try {
      /* THE LOCK, BEFORE THE DOOR IS EVEN DISCUSSED. Throws on an empty file,
         on anything over `MAX_PHOTO_BYTES`, and on bytes that are not one of
         the seven formats — whatever the name or the browser's guess claimed.
         Everything below reads `checked`, which carries the type the header
         actually says. */
      const checked = await inspectInspirationPhoto(file);
      const pre = await presignAttachment({
        filename: checked.name,
        contentType: checked.type,
        size: checked.size,
      }, undefined, { profile: atWallRef.current.kind === 'agent' ? atWallRef.current.id : storageScope?.profileId });
      await uploadToPresignedUrl(pre.uploadUrl, checked, pre.headers);
      await finalizeAttachment({
        /* NOT A GUESS ANY MORE. The sniffer only ever returns one of the seven
           image types, so there is no second branch left to take: the old
           ternary's `"file"` arm existed solely to carry whatever `file.type`
           failed to look like an image. */
        type: "image",
        inspirationId,
        key: pre.key,
        name: checked.name,
        contentType: checked.type,
      });
      /* the detail is re-read so the OPEN memory shows its new attachment;
         nothing on the field waits for it any more — an orb is a disc */
      detailsRef.current.delete(inspirationId);
      void loadDetailRef.current(inspirationId);
    } catch (reason) {
      /* the memory is already kept; only the picture failed to land — and
         WHY it failed to land is now on the card, because the commonest
         reason is a file this product will not take and that is something a
         person can act on. */
      setAttachTrouble({ id: inspirationId, text: whyFailed(reason, say("worldComposerUploadFailed")) });
    } finally {
      setAttaching(false);
    }
  }, [say, whyFailed]);

  /** Search reads the whole archive; opening a result does not depend on the
      bounded field already containing its orb. Queries stay out of the URL. */
  const [seek, setSeek] = useState<string | null>(null);

  /* ═══ PRINCIPLES IS REACHED BY GOING, NOT BY A TAB ══════════════════════
     Founder, 2026-10-15: the bar keeps only Inspiration and Chat, and
     "principle is sth user can only get by dragging" — the creature pulled
     right, or → — while the claim cards keep their own left and right.
     `openOverHome('principles')` from Now is what starts the walk (see
     `principlesCrossing`), so the gesture needs nothing of its own to move
     the creature. ← (or Esc) on Principles walks it home the same way.

     WHO ELSE OWNS AN ARROW, and is left alone: a focused claim card (keep /
     not), the reach over the ground, the group radios, an open memory card,
     menus, and anything you can type into. Capture phase, so the world's
     own arrow handler — which only ever travels between walls, switched off
     — never sees a key this took. */
  const creatureDrag = useRef<{ id: number; x: number; y: number } | null>(null);
  const creatureDragged = useRef(false);
  const toPrinciples = useCallback(() => { commitOpenNote(); openOverHome('principles'); }, [commitOpenNote, openOverHome]);
  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Escape') return;
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      /* `prov` too: the claim's roots open as a sheet OVER review, and its own
         Escape must close it rather than end the sitting under it. */
      const nothingOpen = !panelOpen && !mouthOpen && !savedNoteOpen && seek === null && !thingShare && !prov;
      /* Esc steps out of review — the cards go, the invitation comes back. */
      if (event.key === 'Escape') {
        if (reviewing && atNowView && nothingOpen && !harvestWhy) { event.preventDefault(); event.stopPropagation(); setReviewing(false); }
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.jar-pick, .jar-reach, .jar-grounds, .jar-panel, .jar-dial, [role="menu"], [role="radiogroup"], [role="slider"]')) return;
      if (event.key === 'ArrowRight' && atNowView && nothingOpen && !reviewing) {
        event.preventDefault(); event.stopPropagation(); toPrinciples();
      } else if (event.key === 'ArrowLeft' && principlesOpen && !principlesCrossing) {
        event.preventDefault(); event.stopPropagation(); openOverHome(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, atNowView, principlesOpen, principlesCrossing, panelOpen, mouthOpen, savedNoteOpen, seek, thingShare, prov, toPrinciples, openOverHome, reviewing, harvestWhy]);
  /** read by the loop's key handler, which is built once */
  const openSeekRef = useRef<() => void>(() => undefined);
  openSeekRef.current = () => setSeek((s) => (s === null ? "" : s));
  /* `foundRef` AND `readingLit` WENT WITH THE ORBS THEY LIT. A search's
     matches and the saves under the reading you had open were published to
     the field — "this one, and everything else sinks" — and the field
     answered by lighting those orbs and dimming the rest. The orbs are not
     drawn any more, so there was nothing left to light; `foundRef` had no
     writer at all by then. */
  /* `copied` AND `copyInvite` ARE GONE. The invite WAS the link — no email
     to send, no pending state to track, no notification channel this product
     has — you copied it and put it wherever you already talk to these
     people, and anyone holding it could walk in, which was the one thing to
     know about it. Its only control was on `SpaceSettings`, which could not
     mount, so by the end the one reader of `ApiGroupSummary.joinCode` in the
     whole product was the dev fixture. Gone with rooms (founder,
     2026-10-12: "방 없애"). */

  /* ═══ `?join=<code>` NO LONGER OPENS ANYTHING ═════════════════════════
     Founder, 2026-10-12: "방 없애" — remove rooms.

     This read the code out of the query, wiped it from the URL immediately
     so a reload could not re-ask and so it could not sit in history or in a
     referrer header, and put up a consent sheet.

     THE REASONING FOR THAT SHEET IS THE BEST THING ROOMS PRODUCED and it is
     kept here deliberately, because the rule generalises to anything this
     product ever does with a link. Joining used to happen OUTRIGHT: someone
     sent you a link, you opened it, and you were in the room rather than
     looking at a form asking you to paste what you had just clicked. What
     that missed is what joining DOES — a room's ground was its members'
     public inspirations and its wall their shared signals, so being in one
     was a DISCLOSURE: your public memories became visible to everyone in it
     and your name joined its roll. Clicking a link is not consent to that.
     Any page, any redirect, any message containing that URL could enrol
     you, and the first you would know of it was finding yourself in a room.
     So the link still did the work and you were still asked before anything
     was disclosed.

     WHY THE DOOR CLOSES ANYWAY. There was nothing on the other side of it to
     leave. Rooms kept their way in and lost every way out when
     `.jar-here-list` went on 2026-10-09 — see the tombstone at the sheet's
     old render site for the proof — and a consent sheet for a one-way door
     is a politeness, not a choice. */

  /* ═══ EVERY SHEET CLOSES THE SAME TWO WAYS ═══
     The founder ruled it about the make-another-place sheet ("if click
     outside modal, close it") and about the dial's rail the same day; it is
     not a fact about those two. The sheets below closed only by finding
     their own small word, and the way out of the last sheet is never where
     the way out of this one is. See `lib/dismiss.ts` for why pointerdown and
     why Escape stops propagating.

     IT WAS FIVE, THEN THREE, AND IT IS ONE — and the count keeps falling for
     the reason that argues FOR the hook rather than against it: each surface
     takes its own way out with it and nothing has to be remembered here. The
     account sheet became a card under the settings cog that closes from
     inside the top bar; the antechamber moved to `pages/Profile` as a
     `DialogSurface` that owns its dismissal; both left without this comment
     noticing. A ROOM'S SETTINGS AND THE JOIN SHEET went on 2026-10-12 with
     rooms themselves (founder: "방 없애") — the first could never mount, and
     the second was the way into a place with no way out. What remains is a
     statement's provenance, which is reached from the poster and dismissed
     by pressing away from it. */
  const closeProv = useCallback(() => setProv(null), []);
  useDismissAway(prov !== null, closeProv, KEEP_PROV);

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
  /* A REFUSED PICTURE IS NEWS FOR AS LONG AS THE EDIT IS OPEN, AND NOT ONE
     MOMENT AFTER. `attachTrouble` is written by `attachTo` and shown under the
     editing foot; closing the edit and opening it again is somebody starting
     over, so the sentence about the file they chose a minute ago would arrive
     as an accusation with no act in front of it. Cleared on the transition
     rather than inside `editing.leave`, which belongs to `space/editing.ts`
     and knows nothing about attachments — the same reason the recorder's
     notice is cleared by the notepad and not by the recorder. The id is read
     off `editing.open` rather than the object itself: the hook builds a fresh
     object every render, and a dependency that changes every render is an
     effect that runs every render. */
  const editingOpenKey = editing.open ? `${editing.open.kind}:${editing.open.id}` : null;
  useEffect(() => { setAttachTrouble(null); }, [editingOpenKey]);
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
  /* `panelIsPublic` IS GONE TOO. It resolved whether this memory was open to
     the rooms this account was in, preferring the detail once it landed and
     falling back to the archive's own copy so the word was right from the
     first frame — and it was the last reader in the product of
     `Inspiration.isPublic`, which is the last reader of
     `inspirations.visibility`. The control it fed was removed on 2026-10-12
     with rooms; the column and everything stored in it are deliberately
     untouched. See the tombstone at the control's site in the card's head. */
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
      if (!panelId || editing.open) return;
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
    [panelId, editing, panel, panelBall],
  );

  /* ═══ `togglePublic` AND `publishing` ARE GONE ══════════════════════════
     Founder, 2026-10-12: remove the memory's private/public toggle with
     rooms.

     It PATCHed `visibility` and then corrected three copies of the flag, and
     the reason it had to correct three is worth keeping where the next
     optimistic write will be written: `panelIsPublic` read
     `panel.detail.isPublic` FIRST and fell back to the archive. So an earlier
     version sent the request, the server changed the row, the archive was
     corrected — and the word on screen did not move, because the stale DETAIL
     kept winning (founder, 2026-08-25: "private doesn't switch to public").
     The detail lands the instant a card opens, so that was every press after
     the first frame, which is every press. The fix was to write the archive,
     the cached detail (`detailsRef`, which is what a re-open serves from) and
     the live panel state together. A failure said WHY, in the mouth, because
     a privacy control going quiet is not an honest report.

     CORRECTION (2026-10-15): this said "`panelIsPublic` ITSELF STAYS … it is
     the one remaining reader of `Inspiration.isPublic`". IT DOES NOT STAY.
     `panelIsPublic` does not exist anywhere in `src` — the only occurrences
     of the name are these comments, and the tombstone 90 lines above this one
     already says it "IS GONE TOO". Two tombstones in one file, flatly
     contradicting each other, and the WRONG one was load-bearing: it was the
     stated reason `Inspiration.isPublic` is kept alive.

     SO `Inspiration.isPublic` NOW HAS NO READER AT ALL. It is written in
     `lib/data` (twice) and in the fixtures, and read nowhere — write-only,
     not "read by the panel". It is left in place for now rather than removed
     in this pass: it is a derived boolean threaded through ten test fixtures,
     so taking it out is a mechanical change that deserves its own commit
     rather than a quiet rider on this one. The COLUMN stays regardless;
     `inspirations.visibility` is the server's and no migration touches it. */

  const inspirationRemovedFromView = useCallback((serverId: string, visualId = serverId) => {
    sourceListMutationRef.current += 1;
    /* ONLY IF IT IS STILL THE ONE OPEN. A delete is a round trip, and a
       person who pressed delete on A and stepped to B before it landed was
       having B's panel closed under them by A's answer. */
    setSelectedId(current => (current === visualId || current === serverId ? null : current));
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
        /* `forget` is per memory: if the reader has moved to another one
           while this was in flight, that one's state is not ours to reset. */
        setForget(current => (current.id === id ? { id: null, step: "rest" } : current));
      })
      .catch(() => {
        /* IT IS STILL THERE, AND THE WORLD STILL SHOWS IT. Not back to the
           ask: the ask is a sentence about what a signal loses, and nothing
           about this failure is that. Its own state, its own line. And only
           on the memory that failed — written unconditionally, A's failure
           printed "didn't go through" on whatever B was open by then. */
        setForget(current => (current.id === id ? { id, step: "failed" } : current));
      });
  }, [panelId, panelBall, forget.step, inspirationRemovedFromView]);

  /** Open the answers already on this save. A read, with nothing to write. */
  const openReflections = useCallback(() => {
    if (!panelId || !panelBall) return;
    /* `if (panelBall.col !== undefined && !panelBall.own) return;` STOOD HERE
       — another member's save is theirs, and so are its answers. `col` and
       `own` are set by nothing now (the room orb went on 2026-10-12; see the
       tombstone in `space/inspiration/orb.ts`), so the first half read
       `undefined !== undefined` on every orb and the guard could never fire.
       Every save this panel can open is yours or your agent's. */
    setReflectOpen(true);
    viewNavigationRef.current.write({ ...observedRef.current, inspirationId: panelBall.sigId ?? panelId, reflectionId: 'open' }, { observed: true });
  }, [panelId, panelBall]);

  /* `reflectionRemoved`, `reflectionSaved` and `synchronizeReflections` are
     GONE (2026-10-10), and so is the writing flow whose four call sites were
     their only callers: `ReflectionFlow` inside the save's panel, the
     standalone reflect sheet, and `ReviewPanel`'s two. They kept the field,
     the archive counts, the evidence quotes and the simulation in step with
     an answer being written or deleted; nothing writes or deletes an answer
     from this client any more, so keeping them would have been three handlers
     waiting for an event the product cannot raise. Look for them under those
     names in git history alongside `components/ReflectionFlow.tsx`.
     The answers THEMSELVES are untouched: they arrive on the save
     (`detail.reflections`) and are rendered read-only in the panel. */

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
    setReflectOpen(false); setSelectedId(null);
    simApiRef.current?.goToWall(0); simApiRef.current?.toTop(); setPosterAsk(true);
  });
  const sourceNotice = !offline && !readingRefresh.busy && inspirationSave.phase === 'idle' ? <InspirationProcessingNotice
    processing={sourceProcessing} locale={locale} onView={viewSourceReading} displayedVersion={topOfMind?.version ?? 0} /> : null;
  const showHomeProcessing = Boolean(sourceProcessing.active && sourceProcessing.phase !== 'idle' && !offline && !readingRefresh.busy &&
    inspirationSave.phase === 'idle' && atNow && !inField && !inSky && !reflectOpen && !editing.open);

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
    if (!target && desired?.wallId && agentRoster === null) return;
    if (!target || !desired) { setNavigationProblem('unavailable'); appliedViewKey.current = viewNavigation.key; restoringViewRef.current = false; return; }
    const serial = ++viewRequest.current, key = viewNavigation.key, controller = new AbortController();
    let timer = 0, stage = 'wall', loading = false, canceled = false;
    const current = () => !canceled && !controller.signal.aborted && viewRequest.current === serial && latestViewKey.current === key;
    setNavigationProblem(null);
    linkedReflectionRef.current = null;
    setReflectOpen(false); setSelectedId(null); setDetachedInspiration(null);
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
        /* A ROOM WAS THE OTHER BRANCH, and it was the careful one: it forced
           a fresh verified read, remembered that read's LEASE TOKEN, fetched
           the one memory, and threw `Room changed` if the token had moved
           underneath it — because resolving a link into somebody else's
           ground must not succeed against a snapshot whose permission has
           since been revoked. It also refused a `?reflection=` on a memory
           that was not yours, since a reflection is private even where the
           memory it hangs on is shared. Both are gone with rooms (founder,
           2026-10-12: "방 없애"), and with them the only path in this file
           that ever resolved a link to a memory this account does not own. */
        detail = await loadInspiration(desired.inspirationId, target.kind === 'agent' ? target.id : storageScope?.profileId, controller.signal);
        if (!current()) return;
        ball = makeBall(seedOf(detail, skyRef.current.citations, skyRef.current.signals, skyRef.current.posterSignalIds, skyRef.current.principleSignalIds));
        ball.sigId = detail.id;
        if (!current()) return;
        if (desired.reflectionId && desired.reflectionId !== 'open' && !detail?.reflections.some((row) => row.id === desired.reflectionId && !row.skipped)) throw new Error('Reflection unavailable');
        if (detail) detailsRef.current.set(detail.id, detail);
        linkedReflectionRef.current = { panelId: ball.id, open: Boolean(desired.reflectionId) };
        setDetachedInspiration({ wall: spaceKey(target), ball, detail });
        if (ballsRef.current?.byId.has(ball.id)) { sim.release(); sim.select(ball.id); }
        setSelectedId(ball.id); setPanel({ id: ball.id, detail, partial: false }); setPanelOpen(true);
        timer = window.setTimeout(finish, 0);
      } catch (error) { if (current()) { setNavigationProblem(error instanceof ApiError && error.status === 404 ? 'unavailable' : 'retryable'); finish(); } }
    };
    void run();
    return () => { canceled = true; controller.abort(); window.clearTimeout(timer); };
  }, [viewNavigation.key, phase, walls, agentRoster]);
  useEffect(() => {
    const linked = linkedReflectionRef.current;
    if (!linked || linked.panelId !== panelId) return;
    linkedReflectionRef.current = null; setReflectOpen(linked.open);
  }, [panelId, viewSettled]);

  const selectedViewBall = selectedId ? ballsRef.current?.byId.get(selectedId) ?? (detachedInspiration?.ball.id === selectedId ? detachedInspiration.ball : null) : null;
  const observedView: ViewLocation = { ...EMPTY_VIEW, wallId: atWall.kind === 'self' ? null : atWall.id,
    label: atWall.kind === 'self' ? undefined : (walls.find((wall) => wall.id === atWall.id)?.name ?? atWall.name),
    /* `memberId` was whose ground you were standing in on a room's wall, so
       the address was bookmarkable down to the member. There are no rooms
       and no members; `lib/view-location.ts` still parses the field, which
       is deliberate — see its own note on reading old links. */
    section: inSky ? 'sky' : inField ? 'field' : 'top', at: parkedAt, memberId: null,
    inspirationId: selectedViewBall?.sigId ?? selectedId,
    reflectionId: reflectOpen ? (requestedViewRef.current?.inspirationId === (selectedViewBall?.sigId ?? selectedId) ? requestedViewRef.current?.reflectionId ?? 'open' : 'open') : null,
    find: seek !== null, compose: mouthOpen,
    principleId:atWall.kind==='self'&&inSky?pick:null,
    sharePrinciple:atWall.kind==='self'&&inSky&&(viewNavigation.view?.sharePrinciple??false),conversationId:viewNavigation.view?.conversationId??null,
    /* WHAT IS HELD UP IS NOT SOMETHING THE WORLD OBSERVES, so it is carried
       rather than derived — the same as the review, the conversation and the
       share above it.

       This line is load-bearing and its absence was a real bug, not a test
       artefact. The effect below rewrites the address from `observedView`
       eighty milliseconds after anything the camera can see changes, which is
       how "the world never moves unless the user moved it" is enforced. But
       anything NOT in this object is not preserved by that rewrite — it is
       ERASED by it. So opening your inspirations worked, and then a tick
       later the canonicaliser replaced the URL without `open` and the overlay
       vanished on its own.

       Every field here that reads `viewNavigation.view?.x ?? null` is a field
       that belongs to a surface over the world rather than to the world, and
       the pattern is the reminder: a new one has to join this list on the day
       it is added, or it will appear to work and then undo itself. */
    open:viewNavigation.view?.open??null };
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
    try { await navigator.clipboard.writeText(publicWebOrigin() + viewHref({ ...observedView, reflectionId, find: false })); setCharSay(say('worldLinkCopied')); }
    catch { setCharSay(say('worldLinkCopyFailed')); }
  };

  return (
    <div
      ref={measured.root}
      /* ═══ THE WORLD STANDS DOWN WHILE AN ARCHIVE IS OPEN ═══════════════
         The scrim over these surfaces is deliberately translucent so the
         grain and the creature stay faintly behind them — that is what makes
         an archive read as THIS PLACE holding up what you kept, rather than
         as a page that replaced it. But translucency does not discriminate:
         the save box, the creature's voice and the processing line came
         through it too, and a composer drawn across a sentence somebody
         wrote is not depth, it is a collision.
         So the world's CHROME steps back and the world itself does not. */
      /* THE SAME THREE, so the DOM chrome and the canvas step aside
         together. They were two different conditions and the chat sat in
         the gap between them. */
      className={`jar${viewNavigation.view?.open || viewNavigation.view?.conversationId || viewNavigation.view?.sharePrinciple || viewNavigation.view?.compose || walkingHome ? " jar--aside" : ""}${harvestWhy && !mouthOpen ? " jar--agent-asking" : ""}`}
      aria-label="Waka"
    >
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
        <p>{say(navigationProblem === 'unavailable' ? 'worldPrivateLinkUnavailable' : 'worldLinkUnavailable')}</p>
        {navigationProblem === 'retryable' ? <button type="button" onClick={() => viewNavigation.write(viewNavigation.view ?? { ...EMPTY_VIEW }, { replace: true, query: viewNavigation.query })}>{say('worldRoomHistoryRetry')}</button> : auth?.isAuthenticated ?
          <button type="button" onClick={() => {
            const from = viewNavigation.href;
            void auth.logout().then(() => navigate('/login', { replace: true, state: { from } })).catch(() => setCharSay(say('profileSignOutError')));
          }}>{say('worldSwitchAccount')}</button> : null}
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
             * AN AGENT WAITS FOR ITS BUNDLE — #281's ruling, kept whole.
             * Memory is fetched per wall, so an agent's wall genuinely has
             * nothing to draw until its bundle lands. Your own is always
             * ready: its material is the archive this page is built from.
             *
             * A ROOM USED TO BE THE THIRD ANSWER, and it was the hard one.
             * Its half read `c !== null && !failedGroups.has(w.id)` — the
             * room is ready when its WORDS ARE KNOWN — and that wording was
             * fought for twice. The founder: "if new content, then have it
             * ready before i get there" (2026-08-27), then "dont make the
             * text be there and reload when character goes to the room"
             * (2026-08-30), prefaced with "i think i already asked u to fix
             * this", and they had. An earlier draft of that merge said
             * `w.kind !== "group"` and would have called every agent ready
             * before it had anything. The ruling survives for the two kinds
             * that remain; the room it was written about does not (founder,
             * 2026-10-12: "방 없애").
             *
             * THE GROUND IS NOT THIS. It still pours on arrival, and should:
             * a ground filling as you get there is the world answering a move
             * you made. A sentence appearing because you looked is not.
             */
            const ready =
              w.kind === "self" || (agents ?? []).some((a) => a.agent.id === w.id);
            return (
              <div
                key={key}
                className="jar-wallcol"
                /* `data-kind` was once a question — a room of nothing but
                   machines was set in the machine hand, so the typography and
                   the body could never disagree about what kind of mind you
                   were standing in. With rooms gone the kind IS the answer. */
                data-kind={w.kind}
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
                      w.kind === "self"
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
                    {w.kind === "self" ? <PrincipleRead
                      key={`${auth?.profile?.id}:${spaceKey(w)}`}
                      active={here && !offlineRef.current}
                      locale={locale}
                      onRead={acceptPrinciples}
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
                          {pDraft?.id !== pr.id && pick === pr.id ? <div className="jar-principle-tools">
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
                              {storageScope&&!offline?<button type="button" onClick={()=>viewNavigation.write({...EMPTY_VIEW,conversationId:'new',principleId:pr.id})}>{say('worldTalkAboutThis')}</button>:null}
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
                    /* ═══ ONE STATEMENT ON THE SCREEN, AND THE CREATURE HAS
                           FIRST CLAIM ON IT ════════════════════════════════
                       Founder: "I feel like this page is trying to do too much
                       at once. It's trying to show the user the top of mind,
                       ask them to save the inspiration, and also asking them
                       to review the claim."

                       Six products were torn down end to end — Oura, Readwise,
                       Day One, Spotify Wrapped, Finch, Whoop — and every one
                       of them puts EXACTLY ONE derived object on its home
                       screen. Not one stacks even two. This screen stacked
                       four.

                       So the statement band yields while the creature is
                       asking. Your top of mind and WAKA's question are both
                       sentences about you, in the same register, and showing
                       them together is what made the screen read as two
                       products arguing. The band comes back the moment the
                       sitting is answered — which is the whole point, because
                       what comes back has been rewritten by the answers.

                       THIS IS ONLY POSSIBLE NOW. Yielding used to be
                       unthinkable: `companion.y` was measured from this
                       block's live height, so hiding it would have thrown the
                       creature up the screen. The position is a function of
                       the window alone now, so the band can collapse to
                       nothing and the creature does not move a pixel. */
                    className={`jar-hq-inner${here&&w.kind==='self'&&storageScope&&!offline&&atNow?' jar-hq-inner--activities':''}${here&&(w.kind==='self'||(w.kind==='agent'&&atNow))&&!mouthOpen?' jar-hq-inner--yielded':''}`}
                    /* AN AGENT'S WALL YIELDS TOO, now that its bubble holds its
                       own reading: the poster printed the same sentence huge
                       behind the bubble (screenshot check, 2026-10-16).
                       BUT ONLY AT THE PRESENT. The bubble says what is on the
                       agent's mind NOW; wound back, the poster is the only
                       place the agent's history (and its `asOf`) is said, so
                       it stays and the agent's bubble steps out instead (code
                       review round 2, 2026-10-16). */
                    ref={w.kind === "self" ? measured.hqInner : undefined}
                  >
                    {/* R01 makes the personal reading explicit while keeping
                        the existing field, headline and companion layout. */}
                    {here&&w.kind==='self'&&(inspirations?.length||fieldBeyond||readingLoadPhase!=='ready')?<div className="jar-reading-heading" data-jar-chrome="1">
                      {/* THE NAME AND ITS EXPLANATION MOVED TO THE SWITCHER.
                          Both stood here: "Top of mind", and a hover card
                          saying how it is made. The switcher at the top of
                          the screen now names the view, so printing the same
                          two words again sixty pixels below it was the exact
                          duplication that change removed everywhere else.
                          The explanation went with the name — it belongs on
                          the thing that names the view, not on a second label
                          beside it.
                          What is left here is the one thing that is about
                          THIS reading rather than about the view: whether you
                          are looking at a current one. */}
                      {atNow ? null : <span>{say('worldReadingEarlier')}</span>}
                      {/* "Changes" left the home screen with the other two
                          explainers. What moved in the reading since last time
                          is worth having, but it is a thing to go and look at,
                          not a control sitting beside the sentence — the top of
                          the page is for the sentence. */}
                      {atNow&&topOfMind?.id&&storageScope&&!offline&&(inField||inSky)?<ReadingChanges key={`${storageScope.profileId}:${topOfMind.id}`} profileId={storageScope.profileId} readingId={topOfMind.id} locale={locale} compact/>:null}
                    </div>:null}
                    {/* THE BAND THIS SITS IN IS ALREADY HEIGHT-ZERO ON THE
                        WALL YOU ARE STANDING ON — see `jar-hq-inner--yielded`
                        on the line that builds this block's class. So the
                        companion's bubble carrying the reading (founder: "the
                        speech bubble should show its top of mind at the
                        moment") does NOT duplicate this heading: there is
                        nothing on screen to duplicate. A suppression was
                        written here for a duplication that does not exist,
                        and seventeen tests said so — the drift readout, the
                        board acts and the grounds all live under this
                        heading, reached by the dial rather than by the home
                        screen, and all of them went dark at once.

                        Noted rather than left silent, because the next person
                        to see the reading in two places will reach for the
                        same fix. The thing to change is which SURFACE the
                        expansion belongs to, not whether this renders. */
                    }
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
                    ) : here && w.kind === 'self' && showHomeProcessing && readingLoadPhase === 'ready' && !topOfMind?.supportChanged ? null
                    /* THE EMPTY LINE IS SAID ONCE, BY THE CREATURE.
                       Founder, on this paragraph printed across the middle of
                       the screen with the speech bubble floating through the
                       word "formed": "I haven't formed anything yet should be
                       shown instead of the top of mind if it's not existing
                       yet."
                       The bubble carries it now (see `jar-char-bubble`), so on
                       the wall you are standing on this paragraph would be the
                       same sentence twice, in two registers, overlapping. It
                       still renders while the reading is LOADING or has FAILED
                       — those are facts about the fetch, not about the
                       companion, and the bubble says neither — and on every
                       wall the bubble is not over. */
                    /* ═══ AN AGENT'S WALL NEVER PRINTS THIS LINE ═════════
                       Founder, for at least the third time: "I told you so
                       many times that the agent should never say 'feeling
                       inspired save it', nor why is 'I haven't formed
                       anything yet' shown as a big text behind it."

                       It kept coming back because it was SUPPRESSED rather
                       than absent: the condition was "hide this while the
                       bubble is holding it", and `bubbleHoldsTheLine` is
                       false whenever the bubble is holding anything ELSE —
                       the creature speaking (`charSay`), the offer, a form
                       change. So every one of those states lifted the
                       suppression and the sentence came back up behind the
                       bubble, which is the screenshot, twice.

                       A condition with five ways to be false is not a rule.
                       An agent's wall has one place for its own words and it
                       is the bubble, unconditionally, so the paragraph is
                       not rendered there at all — there is no state left for
                       it to reappear in. */
                    : w.kind === 'agent' ? null
                    : here && bubbleHoldsTheLine && !topOfMind?.supportChanged ? null : (
                      /* NO GENERATED PLACEHOLDER, EVER. An invented ambition
                         for a wall that has not worked yet would teach the
                         reader that the poster is generated copy and destroy
                         the credibility of every wall they read afterwards. */
                      <p className={`jar-forming${w.kind === "self" && topOfMind?.supportChanged ? " jar-forming--attention" : ""}${w.kind==='self'&&!offline?' jar-forming--personal':''}${here&&w.kind==='self'&&atNow&&!offline&&readingLoadPhase==='failed'?' jar-reading-status':''}`}
                        role={here&&w.kind==='self'&&atNow&&!offline&&readingLoadPhase!=='ready'?(readingLoadPhase==='failed'?'alert':'status'):undefined}>
                        {here&&w.kind==='self'&&atNow&&!offline&&!topOfMind?.supportChanged
                          ?readingLoadPhase==='loading'?say('worldPersonalReadingLoading')
                            :readingLoadPhase==='failed'?<>{say('worldPersonalReadingLoadFailed')} <button type="button" className="jar-board-act" onClick={()=>retryReadingLoadRef.current()}>{say('worldRoomHistoryRetry')}</button></>
                            /* "NOT READY" AND "NOTHING KEPT" ARE DIFFERENT
                               FACTS, and this line told the second one to
                               people for whom the first was true. It asked
                               `inspirations?.length` alone — but the archive
                               arrives in pages, and on the first short page
                               that array is `[]` while `fieldBeyond` holds
                               the hundreds still coming. So an account with
                               two and a half thousand kept things was told
                               "keep something you want to come back to" for
                               as long as the walk took.

                               `fieldBeyond` is the remainder and the hint
                               below already consults it for exactly this
                               reason; this branch was the one place that
                               forgot to, which is why the bug only showed on
                               a cold load of a large archive — the hardest
                               state to catch by looking, and the one where
                               being told you have nothing is worst. */
                            :say(inspirations?.length||fieldBeyond?'worldPersonalReadingNotReady':'worldPersonalReadingEmpty')
                          :c.formingAlt ?? say("worldFormingNothingAdopted")}
                      </p>
                    )}
                    {here && w.kind === 'self' && showHomeProcessing ? <InspirationProcessingNotice quiet introducePrinciples={!c.text && principles.length === 0}
                      processing={sourceProcessing} locale={locale} onView={viewSourceReading} displayedVersion={topOfMind?.version ?? 0} /> : null}
                    {here&&w.kind==='self'&&atNow&&readingLoadPhase==='ready'&&!inspirations?.length&&!fieldBeyond?<p className="jar-first-capture-hint">{say('worldFirstCaptureExample')}</p>:null}
                    {/* The dial's historical date stays attached to its read. */}
                    {c.asOf ? (
                      <div className="jar-asof jar-label">
                        {formatMessage(locale, "worldAsOf", { month: c.asOf })}
                      </div>
                    ) : null}
                    {here&&w.kind==='self'&&storageScope&&!offline?<div className="jar-reading-actions" data-jar-chrome="1">
                      {/* "Why this reading" left with "How this forms": the home
                          screen stopped carrying explanations of itself. Back
                          to today stays — it is not an explanation, it is the
                          way out of a date you scrubbed to. */}
                      {!atNow?<button type="button" onClick={()=>windTo(dial?.end??Date.now())}>{say('worldReadingToday')}</button>:null}
                    </div>:null}
                    {/* THE ACTIVITY CARDS ARE GONE FROM THE PAGE (founder
                        ruling). Review and Talk with WAKA are destinations,
                        and destinations live behind the hamburger now — the
                        home page holds the reading, the character and the box
                        and nothing else. Neither feature was removed; both are
                        rows in `menuItems` below. */}
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
                          {/* THE LABEL NAMES WHAT THIS IS; IT DOES NOT REPEAT
                              WHAT IT SAYS. Founder, on a screenshot of this
                              band: "has duplicatives + i dont get what it
                              means."

                              Both halves were true. When a reading's support
                              had changed, this printed
                              `worldReadingSupportChanged` — "This reading
                              needs another look." — in the uppercase label
                              register, with the SAME sentence set directly
                              beneath it as the statement. One string, twice,
                              in two voices, which reads as a stutter rather
                              than as emphasis. Somebody had already noticed
                              half of it: the branch further down suppresses
                              the same repeat in the other place it could
                              happen, and stopped there.

                              And a status is not a provenance. This band's
                              job is to say where the sentence came from —
                              by hand, or from the chain above it. "Needs
                              another look" is a state of the reading, and
                              the sentence below is already carrying it. */}
                          <p className="jar-prov-lead jar-label">{say("worldWrittenByHand")}</p>
                        </div>
                      )
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
                    {here && w.kind === 'self' && !showHomeProcessing && !reflectOpen && !editing.open ? sourceNotice : null}
                    {here && w.kind === "self" && !offline && !lead && readingMessage ? (
                      <p className="jar-board-acts jar-reading-status" role="status" data-jar-chrome="1">
                        {readingMessage === "worldReadingSupportChanged" ? null : say(readingMessage)}
                        {!readingRefresh.busy && (readingCheckFailed || readingChecking || topOfMind?.supportChanged || readingRefresh.canResume || ["error", "failed", "unknown"].includes(readingRefresh.phase)) ? (
                          <button className="jar-board-act" type="button" disabled={readingChecking}
                            onClick={() => readingCheckFailed ? verifyReadingRef.current(true) : void readingRefresh.start()}>
                            {say(readingCheckFailed || readingChecking ? "worldReadingCheckAgain" : readingRefresh.canResume ? "worldReadCheck" : "worldReadAgain")}
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {/* ────────────────────────────────────────────────────
                        WHAT A PERSON WANTS TO DO WITH A SENTENCE ABOUT
                        THEMSELVES IS ANSWER IT.

                        Founder, on a screenshot of this block: "Just changing
                        the text and removing duplicate is not enough. Just
                        rethink the full interaction here. When the user looks
                        at this top of mind, what would they want to do? How
                        would they want to do that interaction? This is
                        definitely not the right way."

                        WHAT WAS HERE: `Write a new one` · `Keep on top` ·
                        `Edit wording` · `Not this` — and every one of them is
                        a way to MAINTAIN THE ARTIFACT. Regenerate it, pin it,
                        retype it, discard it. Not one of them is a way to
                        RESPOND TO THE OBSERVATION, which is the only thing
                        that actually happens in a person's head when they
                        read a sentence claiming to describe them. The
                        reaction is involuntary and immediate — "...is that
                        me?" — and the surface handed it a filing cabinet.

                        THE RIGHT INTERACTION WAS ALREADY IN THE PRODUCT, two
                        hundred pixels below this one. The creature's claim
                        asks a statement and offers three peer answers, one of
                        which opens a field to say what is closer
                        (then `jar-char-claim-answers`, and `setCorrecting`
                        under "not true"; both have since gone, the answers
                        to a sideways slip). Two sentences about you were on one
                        screen asking for the same thing in two different
                        languages, and the one nobody complained about is the
                        one that asks a question.

                        So this is that model transposed, not a new invention:

                          Yes       it holds — `holdLead`, settles at once
                          Not quite opens the field — `editing.begin`, the
                                    same shape as the claim's "not true"
                          Not me    `dropLead`, settles at once and stays
                                    undoable through `undrop` below

                        AND THE MAINTENANCE VERBS DO NOT DISAPPEAR, THEY STOP
                        PRETENDING TO BE ANSWERS. "Write a new one" is now
                        beside the line that reports the reading has fallen
                        behind — a remedy belongs next to the complaint it
                        answers, not in a row of replies to a question it is
                        not an answer to. "Hand it back to WAKA" only exists
                        once you have written the sentence yourself, which
                        makes it a fact about this sentence rather than a
                        response to it, so it goes to the same quiet line.

                        AT REST THE BLOCK IS ONE LINE: the question. Four
                        permanent verbs made "a sentence with a toolbar under
                        it — furniture, which this layout does not have", and
                        that objection still stands; a question is not
                        furniture, it is the shortest possible statement of
                        what the surface is for. Pressing the sentence has
                        been how you open it since 2026-08-24; now the thing
                        it opens is an answer rather than an inventory.
                        ──────────────────────────────────────────────────── */}
                    {here &&
                    w.kind === "self" &&
                    !offline &&
                    lead &&
                    !editing.open &&
                    /* `board.step !== "rest"` stays: a confirmation already in
                       flight must not be hidden out from under the person who
                       started it. */
                    (posterAsk || board.step !== "rest") ? (
                      <div className="jar-board-acts" data-jar-chrome="1">
                        {readingRefresh.busy ? (
                          <span className="jar-board-act" role="status">{say(readingMessage ?? "worldReadingNow")}</span>
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
                              className="jar-board-act"
                              onClick={rebuildBoard}
                            >
                              {say("worldReadAgain")}
                            </button>
                            <button
                              type="button"
                              className="jar-board-act"
                              onClick={() => setBoard({ step: "rest" })}
                            >
                              {say("worldLeaveItCap")}
                            </button>
                          </>
                        ) : (
                          <>
                            {/* ── THREE VERBS, AND THEY ARE MAINTENANCE ON PURPOSE ──
                                Founder, on the "Is this you? / Yes / Not
                                quite / Not me" this replaces: "weird... for
                                now maybe just let user either edit it or
                                remove it and ask it to reread."

                                WHY IT WAS WEIRD, which is worth recording
                                because the general rule it bends is a good
                                one. Law 11 says the controls under a sentence
                                about a person must let them ANSWER it. That
                                is right when WAKA wrote the sentence. This
                                sentence says WRITTEN BY HAND directly above
                                these buttons — the person wrote it
                                themselves — and asking somebody to confirm
                                their own words is not a question, it is a
                                tic. The law holds; the surface it was applied
                                to turned out to be two surfaces wearing one
                                set of verbs.

                                AND THE PAGE GETS ITS ONE ASK BACK. The
                                creature's claim is four inches below this and
                                asks a real question. Two answer rows on one
                                screen is what "this page is trying to do too
                                much at once" looked like, and suppressing
                                only the RESTING invitation left both of them
                                up the moment anybody pressed the statement.
                                Maintenance verbs do not compete with a
                                question, so now only one thing on the page
                                asks anything.

                                THE RICHER ANSWER, NOT BUILT because "for
                                now" was the instruction: ask "Is this you?"
                                only when the reading is WAKA's own, and offer
                                these three when it is yours. The data is
                                already here — `lead.locked` and the hand/
                                chain provenance band above both know which it
                                is. */}
                            <button
                              type="button"
                              className="jar-board-act"
                              onClick={() => editing.begin("entry", lead.id, lead.body)}
                            >
                              {say("worldEditWording")}
                            </button>
                            <button
                              type="button"
                              className="jar-board-act"
                              onClick={() => dropLead(lead)}
                            >
                              {say("worldRemoveLower")}
                            </button>
                            {/* SHARE IS NOT AN ANSWER, AND IT SITS WITH THE
                                MAINTENANCE ON PURPOSE. Law 11's worry is two
                                rows asking the person something on one page;
                                this row asks nothing, and making a card of a
                                sentence is upkeep in the same register as
                                editing it. The words are the person's as they
                                stand now — the card is drawn from `lead.body`,
                                never from a draft. */}
                            {storageScope && !offline ? (
                              <button
                                type="button"
                                className="jar-board-act"
                                onClick={() => setThingShare({
                                  kind: "topOfMind",
                                  text: lead.body,
                                  proof: formatMessage(locale, "worldShareOnMyMind", { date: dateStamp(Date.now(), locale) }),
                                })}
                              >
                                {say("worldShare")}
                              </button>
                            ) : null}
                            {/* THE QUIET LINE: facts about this sentence, and
                                the remedies for them. Never answers. */}
                            {/* ALWAYS MOUNTED, not only when the reading has
                                fallen behind. A first pass gated this whole
                                line on `readingMessage || boardToast ||
                                lead.locked`, which reads fine and means that
                                asking for a new sentence is only possible
                                once WAKA has decided one is needed — the
                                person loses the verb precisely when they are
                                content enough with the reading to want to
                                push on it. The STALENESS LINE is conditional,
                                because it reports something; the remedy is
                                not, because it is a thing you may want. */}
                            <>
                                {readingMessage || boardToast ? (
                                  <span className="jar-board-warn" role="status">
                                    {readingMessage ? say(readingMessage) : boardToast}
                                  </span>
                                ) : null}
                                {/* "REFRESH READING" -> "WRITE A NEW ONE", because
                                    the name was the defect and not the verb.
                                    Founder: "i dont get what these 4 options
                                    mean." "Refresh" is what you do to a web
                                    page — it describes a mechanism rather than
                                    the thing that happens, which is that WAKA
                                    writes you a new sentence from what you have
                                    saved since.

                                    It stays mounted whether or not the reading
                                    has fallen behind: an earlier attempt at
                                    tidying this REMOVED the verb and orphaned
                                    the confirm step above, leaving a branch
                                    nothing could open. */}
                                <button
                                  type="button"
                                  className="jar-board-act"
                                  disabled={readingChecking}
                                  onClick={() => readingCheckFailed ? verifyReadingRef.current(true)
                                    : readingRefresh.canResume ? void readingRefresh.start() : setBoard({ step: "asking" })}
                                >
                                  {say(readingCheckFailed || readingChecking ? "worldReadingCheckAgain" : readingRefresh.canResume ? "worldReadCheck" : "worldWriteANewOne")}
                                </button>
                                {/* Only exists once the sentence is yours, so
                                    it is a fact about the sentence and not a
                                    reply to the question above. */}
                                {lead.locked ? (
                                  entrusting === lead.id ? (
                                    <>
                                      <span className="jar-board-warn">
                                        {say(RECEIPTS.releaseOffer.messageKey)}
                                      </span>
                                      <button
                                        type="button"
                                        className="jar-board-act"
                                        onClick={() => entrustLead(lead.id)}
                                      >
                                        {say("worldHandItBackCap")}
                                      </button>
                                      <button
                                        type="button"
                                        className="jar-board-act"
                                        onClick={() => setEntrusting(null)}
                                      >
                                        {say("worldLeaveItAsItIsCap")}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="jar-board-act jar-star-act"
                                      title={say(RECEIPTS.starHeld.messageKey)}
                                      onClick={() => setEntrusting(lead.id)}
                                    >
                                      {say("worldHandItBackToWaka")}
                                    </button>
                                  )
                                ) : null}
                            </>
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

          {/* THE WAYS OUT ARE NOT ADVERTISED HERE ANY MORE.
              A neighbouring wall's name used to wait at each margin — "‹ DEMO
              AGENT" down the left edge of the home screen, a caret and a name
              offering a walk sideways into an agent's wall or a room's.
              Founder: "we're going to get rid of the rooms and agent related
              stuff for now."

              The walls themselves are untouched: the columns still exist, the
              camera still travels them, and /w/:wall still answers. This is
              the same ruling page-menu.ts already applied to the menu — they
              are not destinations the product OFFERS, so nothing on the
              screen the product opens on points at one. */}
        </div>
      ) : null}

      {/* The capture entry stays in the world; the native composer owns input,
          focus and scrolling above it. Files and words share one save intent. */}
      {phase === 'ready' ? <>
        <div ref={measured.mouth} className="jar-mouth" data-jar-chrome="1">
          {/* THE RESTING BAR IS GONE. Founder: "rather than clicking on save
              a thought, can we just make clicking on the character..." — so
              the box only exists once somebody has asked for it, and the
              asking is the creature's bubble. The slot still renders while
              the composer is open, because that is where the composer lives;
              it simply has nothing to show at rest. The ruling that saving is
              never more than one gesture away is intact: pressing the
              creature IS the gesture. */}
          {/* INERT WHEN IT IS NOT OFFERED, AND "CLOSED" IS NOT OFFERED.
              `--closed` and `--away` both draw the slot at `opacity: 0` with
              `pointer-events: none`, which stops the mouse and does nothing
              at all to the keyboard. So the three controls inside it — the
              field, the microphone and the send — stayed in the tab order on
              every screen in the product: on the home screen they were tab
              stops 2, 3 and 4, and pressing Enter on a box nobody can see is
              the invisible half of Law 8. `pointer-events: none` is a mouse
              statement; `inert` is the one that means "not offered". */}
          <div className={'jar-mouth-slot' + (atNow ? '' : ' jar-mouth-slot--away') + (mouthOpen ? '' : ' jar-mouth-slot--closed')} {...(!atNow || inField || inSky || !mouthOpen ? { inert: '' } : {})}>
          {/* A BOX, NOT A BUTTON (founder ruling). The resting state used to be
              a labelled button that opened a drawer, so keeping a thought cost
              a press before it cost a word, and a file had nowhere to land
              until the drawer was already open. This is the same entry as an
              actual field: type into it, paste into it, or drop a file on it,
              and the composer takes over mid-gesture with whatever you gave
              it already in hand. Nothing about the save path changed — the
              draft store, the upload queue and the save intent below are the
              ones that were already here. */}
          {/* THE COMPOSER, IN THE ANATOMY ITS PATTERN NAMES.
              Founder: use ChatComposerDrawer. Its documented shape is a frame
              holding a DRAWER above the body, a body carrying the input and a
              footer, a required primary action, and a status message outside
              the body — and the drawer's own job is "supplementary content
              such as attachments, context chips, or previews", collapsible
              behind a count when there is something to collapse.

              What was here was an input with chips loose underneath it and no
              send control at all: Enter was the only way to keep, which is a
              shortcut standing in for a button. The structure below is the
              pattern's, wearing this product's tokens. */}
          <div className="waka-composer">
            {!mouthOpen && inputMedia.length ? (
              <div className="waka-composer-drawer">
                <button
                  type="button"
                  className="waka-drawer-toggle"
                  aria-expanded={drawerOpen}
                  aria-label={say(drawerOpen ? 'worldKeepHideItems' : 'worldKeepShowItems')}
                  onClick={() => setDrawerOpen(value => !value)}
                >
                  <span className="waka-drawer-count">{inputMedia.length}</span>
                  <span>{formatMessage(locale, 'worldKeepItems', { count: inputMedia.length })}</span>
                </button>
                {/* Collapsed descendants are out of the keyboard's reach as
                    well as out of sight — the pattern is explicit that a
                    collapsed drawer hides its content from assistive
                    technology too, so this unmounts rather than hides. */}
                {drawerOpen ? (
                  <ul className="waka-drawer-items">
                    {inputMedia.map(item => (
                      <li key={item.id}>
                        <span>{attachmentLabel(locale, item.type, item.name)}</span>
                        <button
                          type="button"
                          aria-label={`${say('worldRemoveLower')} ${attachmentLabel(locale, item.type, item.name)}`}
                          onClick={() => composerDraft.setMedia(composerDraft.current.current.media.filter(row => row.id !== item.id))}
                        >
                          ×
                        </button>
                        {item.uploadError ? <small role="alert">{item.uploadError}</small> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {/* A PICTURE GETS ASKED ABOUT; A LINK DOES NOT. The question is
                "what made this moment feel like something", and a moment is
                what a photograph is of. Asking it of a pasted URL would be
                asking a question that does not fit the thing, which is how a
                prompt becomes a toll. */}
            {!mouthOpen && inputMedia.some(item => item.type === 'image') ? (
              <div className="waka-moment">
                <label className="waka-moment-ask" htmlFor="waka-moment-why">
                  {say('worldMomentAsk')}
                </label>
                <textarea
                  id="waka-moment-why"
                  className="waka-moment-why"
                  rows={2}
                  value={momentWhy}
                  placeholder={say('worldMomentPlaceholder')}
                  onChange={event => setMomentWhy(event.target.value)}
                />
                {/* Leaving is free and says so. The founder's rule is that
                    saving is never gatekept, so a question that must be
                    answered before a photo can be kept would be a gate with a
                    friendly face on it. */}
                <p className="waka-moment-skip">{say('worldMomentSkip')}</p>
              </div>
            ) : null}

            <div className="waka-composer-body">
              <textarea
                ref={element => { measured.mouthSpot.current = element; }}
                className="jar-mouth-rest jar-keep-box"
                rows={1}
                style={mouthOpen ? { visibility: 'hidden' } : undefined}
                value={draft}
                /* THERE IS NO DROP ON A PHONE. "Type, paste, or drop a file"
                   is desktop copy, and it was shipping to a device where a
                   third of it describes a gesture that does not exist. The
                   pointer query is the honest test — it asks whether this
                   input can drag, not how wide the window happens to be. */
                /**
                 * THE BOX SAYS WHAT IT IS FOR, AND THAT DEPENDS ON WHO YOU
                 * ARE BEING.
                 *
                 * Founder, on the agent's wall: "When I have my agent
                 * selected, I shouldn't be able to save inspiration. Instead,
                 * the text should say 'Ask my agent anything'." And on their
                 * own: "make this text say 'save an inspiration' or 'ask
                 * anything about my past inspirations' or something like
                 * that. Help me better write the sentence."
                 *
                 * "Type, paste, or drop — save it, or ask about it" named the
                 * input methods first and the point second. The two things a
                 * person can actually do lead now, and the methods are
                 * discovered by doing them, which is how they were always
                 * going to be discovered.
                 *
                 * On an agent's wall there is only one of the two. Saving
                 * into someone else's archive is not a thing this product
                 * does — your material is yours and its material is its own —
                 * so the box asks the only question available there, and the
                 * save beside it goes rather than sitting disabled. A control
                 * that can never work is not a control.
                 */
                placeholder={say(standingAsAgent ? 'worldKeepPlaceholderAgent'
                  : touchOnly ? 'worldKeepPlaceholderTouch' : 'worldKeepPlaceholderMine')}
                aria-label={say('worldCaptureInspiration')}
                aria-describedby="jar-keep-hint"
                onChange={event => { draftRef.current = event.target.value; setDraft(event.target.value); setCharSay(''); setMouthNote(''); }}
                onKeyDown={event => {
                  /* Enter keeps, Shift+Enter makes a line. The button below is
                     the primary action; this is the shortcut for it, not the
                     only way in. */
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void keepIt();
                  }
                }}
                onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
                onDrop={event => {
                  if (!event.dataTransfer.files.length) return;
                  event.preventDefault();
                  setCharSay('');
                  setDrawerOpen(true);
                  void addInspirationFiles([...event.dataTransfer.files]);
                }}
                onPaste={event => {
                  if (!event.clipboardData.files.length) return;
                  event.preventDefault();
                  setCharSay('');
                  setDrawerOpen(true);
                  void addInspirationFiles([...event.clipboardData.files]);
                }}
              />

              {!mouthOpen ? (
                <div className="waka-composer-foot" id="jar-keep-hint">
                  {/* SPEAKING INTO IT (founder: "I want to have a button to
                      let someone speak into it"). It is the recorder that
                      already exists — the one the opened composer uses — and
                      it keeps the audio as an audio inspiration rather than
                      transcribing it into the field. A recording is the
                      material; a transcript is a reading of it, and this
                      product's whole shape is that readings are made later
                      from material kept as it arrived.
                      Absent, not disabled, where the browser cannot record:
                      a control that can never work is not a control. */}
                  {supportedRecordingType() ? (
                    <button
                      type="button"
                      className={`waka-composer-mic${recording.phase === 'recording' ? ' waka-composer-mic--on' : ''}`}
                      aria-label={say(recording.phase === 'recording' ? 'worldComposerStopRecording' : 'worldComposerRecord')}
                      aria-pressed={recording.phase === 'recording'}
                      disabled={recording.phase === 'requesting' || recording.phase === 'finishing' || !composerDraft.available}
                      onClick={() => { if (recording.phase === 'recording') void recording.stop(); else void recording.start(); }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <rect x="5.6" y="1.6" width="4.8" height="8.2" rx="2.4"
                          stroke="currentColor" strokeWidth="1.3" fill="none" />
                        <path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4V14.4"
                          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                      </svg>
                    </button>
                  ) : null}
                  {/* WHAT THE MICROPHONE IS DOING, AND WHAT WENT WRONG.
                      Founder: "speech to text not working."

                      It was working, in the sense that the code ran. What it
                      could not do was SAY anything: `error`, `notice` and
                      `seconds` were all computed by the hook and rendered by
                      nobody. So a refused permission, a browser that cannot
                      record, a disconnected microphone and a clip over the
                      size limit were four different failures that each
                      produced exactly one outcome on screen — nothing. The
                      button looked pressed and the product looked broken,
                      which is the same thing from the outside.

                      This repo states the rule it was breaking: never turn a
                      visible failure into a silent one. And the elapsed count
                      is here for the same reason — a recorder with no
                      running number is a control you have to trust rather
                      than one you can watch. */}
                  {recording.phase === 'recording' ? (
                    <span className="waka-composer-recording" role="status">
                      {formatMessage(locale, 'worldComposerRecordingFor', { seconds: recording.seconds })}
                    </span>
                  ) : null}
                  {recording.error || recording.notice ? (
                    <span className="waka-composer-recording-why" role={recording.error ? 'alert' : 'status'}>
                      {recording.error || recording.notice}
                    </span>
                  ) : null}
                  {/* WHAT IS NOT IN THIS FOOTER ANY MORE.
                      "Enter to keep" — founder pointed at exactly this as the
                      example of a thing that is not 100% necessary. It was
                      also FALSE on a touch keyboard, where Enter makes a line,
                      and it described a shortcut for the button standing
                      beside it.
                      "Save inspirations with MCP" — a setup instruction,
                      printed under the box you type in every day. Setting up
                      an agent is a once-ever act and it belongs with the keys
                      that agent needs; it is on the settings page now, beside
                      them.
                      What is left is the action. */}
                  {/* TWO DESTINATIONS FOR ONE PIECE OF TEXT, AND THAT IS NOT
                      TWO FEATURES.

                      Founder, first: "how do we make that natural without
                      making the same component feel like it has like two
                      random features?" Then, looking at the built version:
                      "the fact that a single component is trying to achieve
                      two things of saving inspiration and chatting about
                      paths like inspiration, top of mind and principles
                      doesn't feel confusing — really think about how to best
                      design this."

                      THE ANSWER IS NOT A MODE. Asking you to declare
                      save-or-chat before typing classifies an intention you
                      have not formed, and the cost of that hesitation lands
                      on saving — the one act that must be free. Deciding
                      before you type is a mode; deciding after you type is an
                      action.

                      WHAT MAKES IT READ AS ONE CHOICE RATHER THAN TWO
                      FEATURES IS THE SHAPE. Three things do the work:

                      1. BOTH ARE ALWAYS HERE. The second one used to appear
                         the moment you typed a character, and a control that
                         materialises mid-sentence is the single clearest way
                         to tell someone a component has a hidden second job.
                         They are both present and both inert until there is
                         something to send; the footer never changes shape.
                      2. THEY SHARE A SHAPE AND SIT TOGETHER. A text link
                         beside a filled button reads as a feature parked next
                         to a feature. Two buttons of the same size in the
                         same group, one filled and one outlined, read as one
                         question — where is this going — with two answers.
                      3. THE MIC IS NOT ONE OF THEM. It is how you put words
                         IN, not where they go, so it sits at the far end,
                         away from the pair.

                      Keep is the filled one because keeping is what the
                      product is for and what the placeholder describes.

                      NOT AUTO-DETECTED from a trailing "?" — an archive here
                      already holds "how do we ensure Korean is part of it?"
                      as a kept inspiration, so detection would misfire on
                      this product's own material. */}
                  <span className="waka-composer-where">
                    {/* ONE ACT ON AN AGENT'S WALL, AND IT IS A SEND.
                        Founder: "the one call to action should be... let's
                        just make it a send icon." Two worded buttons are a
                        choice between destinations; there is only one
                        destination here, so the control stops arguing for
                        itself and becomes the arrow every message box in the
                        world already uses. It keeps its name for anyone
                        listening rather than looking. */}
                    <button
                      type="button"
                      className={standingAsAgent ? 'waka-composer-send waka-composer-send--icon' : 'waka-composer-ask'}
                      disabled={talking || !draft.trim()}
                      aria-label={standingAsAgent ? say('worldComposerSendAria') : undefined}
                      onClick={() => { void talkAbout({ id: '', text: draft.trim() }); }}
                    >
                      {standingAsAgent ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                          <path d="M2.2 8h11M8.6 3.2 13.4 8l-4.8 4.8" fill="none" stroke="currentColor"
                            strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : say(talking ? 'worldTalkOpening' : 'worldComposerAsk')}
                    </button>
                    {standingAsAgent ? null : (
                      <button
                        type="button"
                        className="waka-composer-send"
                        disabled={!draft.trim() && inputMedia.length === 0}
                        onClick={() => { void keepIt(); }}
                      >
                        {say('worldKeepSend')}
                      </button>
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Status sits OUTSIDE the body, as the pattern places it. */}
            {!mouthOpen && mouthNote ? (
              <p className="waka-composer-status" role="alert">{mouthNote}</p>
            ) : null}
          </div>
          </div>
          {/* WHAT THE COMPANION SAYS, UNDER THE COMPANION.
              These three — the save notice, the narration line and the keep
              receipt — used to live in the mouth's own slot, which was right
              under the chin at the time. The box moved to the bottom of the
              screen and they went with it, so the creature's own voice ended
              up printed under the text field, the length of the page away
              from the creature. They are its speech, so they sit where its
              mouth is: `--jar-mouth-top` is still written from the chin every
              layout pass, and it means the chin again. */}
          {/* THE CREATURE SPEAKS UPWARD.
              Founder: "I did like how clicking on the agent would make it
              speak something. So above the agent, let's have a speech bubble
              that makes the agent tell you something. And maybe have the
              agent start a conversation so you can dive deeper."
              Tapping it has always made it talk; what changed was that its
              line sat under the chin, in the same column as the claim, so
              one had to silence the other. A bubble over its head gives
              speech its own place and lets both be true at once.
              AND IT IS A WAY IN. What the creature just said is a subject —
              it is the only thing on screen that came from the product rather
              than from you — so it carries the door into a conversation
              about itself. */}
          {/* ═══ PRESSING THE CREATURE OPENS THE NOTEPAD ════════════════
              Founder: "clicking on character should open save inspirations
              note pad", with a mockup of the creature holding a PENCIL in its
              speech bubble.

              So the bubble is not a step — it is the label for the gesture.
              It is always up when the creature has nothing else to say, the
              way the reference's character always holds up a pebble or a
              pencil, and it says what pressing the body will do. One press,
              straight into the note; no toggle in between.

              A PENCIL RATHER THAN THE WORDS. The reference puts an object in
              the bubble, not a sentence, and an object is why the bubble can
              share the screen with the claim below without competing: a glyph
              is not a second thing to read. This is the creature's own
              illustration register — the same place the body and its aura
              live — not a UI icon set, which this product still does not have
              and is not getting. */}
          {/* THE INVITATION INTO REVIEW, in the top-of-mind slot and its full
              weight, because it is the page's main act while anything waits
              (see `reviewing`). */}
          {!mouthOpen && !charSay && !turning && !reviewing && toReview > 0 ? (
            <div className="jar-char-bubble jar-char-bubble--review" data-jar-chrome="1" data-jar-interactive="1">
              <span className="jar-char-bubble-body">
                <span className="jar-char-bubble-reading" role="status">
                  {formatMessage(locale, 'worldReviewWaiting', { count: toReview })}
                </span>
                <span className="jar-char-bubble-acts">
                  <button type="button" className="jar-char-bubble-act" onClick={startReview}>
                    {say('worldReviewDive')}
                  </button>
                </span>
              </span>
            </div>
          ) : null}
          {/* ═══ THE CREATURE IS ALWAYS THERE TO PRESS — AND TO PULL ═══════
              It stood inside the top-of-mind bubble's block, so whenever the
              bubble stepped aside (a line being said, the review invitation,
              review itself) the press went with it — and with it the only
              touch way to Principles (code review, 2026-10-16). It stands on
              its own now. NOT ON AN AGENT'S WALL, for the reason the note in
              the bubble block below gives: a press that offers to save into
              someone else's archive is a control that can never work.

              DRAG IT RIGHT AND IT WALKS TO PRINCIPLES. Founder, 2026-10-15:
              "principle is sth user can only get by dragging." A press is
              still a press (the creature speaks); a pull of `CREATURE_PULL`
              px rightward that is more across than down is the walk, and the
              click that follows the release is swallowed so it does not also
              speak. The swallow is reset on every new press: some touch
              browsers send no click after a moved touch, and a stale flag
              would eat the next real tap. */}
          {!mouthOpen && atWall.kind !== 'agent' ? (
            <button
              type="button"
              className={`jar-char-press${lit ? ' jar-char-press--lit' : ''}`}
              aria-label={say('worldCreatureSpeak')}
              aria-keyshortcuts="ArrowRight"
              data-jar-chrome="1"
              data-jar-interactive="1"
              onPointerDown={event => {
                creatureDragged.current = false;
                if (!atNowView) return;
                creatureDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerUp={event => {
                const start = creatureDrag.current;
                creatureDrag.current = null;
                if (!start || start.id !== event.pointerId) return;
                const dx = event.clientX - start.x, dy = event.clientY - start.y;
                if (dx >= CREATURE_PULL && Math.abs(dy) < dx) { creatureDragged.current = true; toPrinciples(); }
              }}
              onPointerCancel={() => { creatureDrag.current = null; }}
              onClick={() => {
                if (creatureDragged.current) { creatureDragged.current = false; return; }
                creatureSpeaks();
              }}
            />
          ) : null}
          {!mouthOpen && !charSay && !turning && !reviewing && toReview === 0 ? (
            <>
              {/* NOT ON AN AGENT'S WALL. Founder, pressing the creature over
                  there and being offered "Feeling inspired? Save one.":
                  "when clicking on an agent you shouldn't prompt me to save
                  an inspiration — I shouldn't be saving it for my agent."

                  Right, and the product already knew: the keep box on an
                  agent's wall drops its save and asks the only question
                  available there, under the ruling "saving into someone
                  else's archive is not a thing this product does — your
                  material is yours and its material is its own", and the
                  note beside it, "a control that can never work is not a
                  control". That ruling was applied to the box and not to the
                  creature, which is the same wall offering two different
                  answers about whose archive you are standing in.

                  So the press is ABSENT there rather than inert — see the
                  press itself, which now stands outside this block. */}
              {/* ═══ WHAT THE CREATURE IS HOLDING UP ═══════════════════════
                  Three things, in this order, and the order is the whole
                  design:

                    you just pressed it  → the offer to write. Founder:
                                           "clicking on the character should
                                           just make it shine and bright, and
                                           change the speech bubble to
                                           'feeling inspired? save
                                           inspiration', and then a few
                                           seconds later come back to top of
                                           mind."
                    a reading exists     → the reading. It is the product's
                                           output; it should be the thing the
                                           creature is holding up.
                    nothing read yet     → "I haven't formed anything yet",
                                           said by the creature rather than
                                           printed across the middle of the
                                           screen. Founder, on the big centred
                                           version of that line with the
                                           bubble floating through it: "I
                                           haven't formed anything yet should
                                           be shown instead of the top of mind
                                           if it's not existing yet." It is a
                                           sentence about what the companion
                                           knows, so it belongs in the
                                           companion's mouth — and putting it
                                           there removes the collision at the
                                           same time.

                  THE PENCIL IS GONE. It was standing in for the empty state
                  ("I have nothing yet") and for the offer at once, which is
                  two jobs for a glyph that can only say one thing. Both now
                  have words. */}
              {/* NO BUBBLE AT ALL WHILE THERE IS NOTHING TRUE TO PUT IN IT.
                  An empty bubble over the creature's head would be a shape
                  saying "something belongs here", which is worse than air;
                  the press target above stays, so the offer is always one
                  press away whether or not anything is being held up.
                  AND NONE ON AN AGENT'S WALL WOUND BACK: the poster holds
                  that moment's reading there, and neither "on my mind right
                  now" nor "nothing formed yet" is true of a wall showing its
                  history (code review round 2, 2026-10-16). */}
              {(lead || agentSays || bubbleHoldsTheLine) && !(standingAsAgent && (!atNow || agentBundleMissing)) ? (
                /* ═══ TWO WEIGHTS OF BUBBLE, AND ONLY TWO ═══════════════
                   Founder, with the reading beside an observation: "the
                   speech bubble that shows the top of mind versus everything
                   else should have slightly different visual. Let's keep the
                   current white one for the top of mind, but everything else
                   let's lower the opacity of this speech bubble a little bit
                   so it's differentiated."

                   The rule underneath it is the product's own: the top of
                   mind is the OUTPUT — the thing the whole machine exists to
                   write — and everything else the creature says is it
                   talking. One is a conclusion, the rest is weather. Full
                   white for the conclusion; the weather sits back.

                   `--aside` rather than `--dim`: it is not a disabled or
                   lesser control, it is a different register of speech, and
                   naming it for the state would invite the next person to
                   reach for it whenever a bubble felt loud.

                   THE SLOT TAKES THE WHITE, NOT THE READING. The first cut
                   of this keyed on whether a reading EXISTS — `lead ? '' :
                   aside` — which is a different rule and a worse one, and
                   the founder caught it on an account with no top of mind
                   yet: both bubbles came out quiet, so nothing stood out
                   from anything. "Keep the current white one for the top of
                   mind" is about the slot. This branch is the top-of-mind
                   slot whatever is in it — the reading, or the line saying
                   there is not one yet — and its prominence should not
                   flicker depending on whether the machine has written
                   anything. Everything else the creature says arrives
                   through `charSay`, which is always the lighter weight. */
                <div
                  className="jar-char-bubble"
                  data-jar-chrome="1"
                  /* Both states of this bubble are pressable — a reading and
                     the empty line — so the flag is unconditional. */
                  data-jar-interactive="1"
                >
                  <span className="jar-char-bubble-body">
                    {(
                      /* THE READING IS A DOOR; THE EMPTY LINE IS NOT.
                         Founder: "the speech bubble should show its top of
                         mind at the moment. And the user can click on it to
                         go to a new page where the user can engage with it."
                         "I haven't formed anything yet" leads nowhere,
                         because there is nothing on the other side of it —
                         a control that opens an empty page is worse than no
                         control. */
                      /* ═══ WHAT IT SAYS IS THE DOOR, AND THE DOOR IS A CHAT
                         Founder, twice: "no matter what the character is
                         saying, clicking on what it says should open up a
                         chat. So even when user clicks on a top of mind, it
                         should open up a chat" — and then, pinning the one
                         exception: "except when it says 'feeling inspired,
                         save it', then that should open a new inspiration."

                         ONE RULE INSTEAD OF THREE. This bubble had a
                         different destination per sentence: the offer opened
                         the notepad, a reading opened `?open=reading`, and
                         the empty line opened nothing at all — so what
                         pressing the bubble did depended on which of three
                         states it happened to be in, and two of them were
                         unguessable. Now the sentence always leads into a
                         conversation ABOUT itself, and the one exception is
                         the one whose own words name a different act.

                         WHY A CHAT RATHER THAN THE READING PAGE. The reading
                         surface was built on "the user can click on it to go
                         to a new page where the user can engage with it",
                         and a chat is that sentence answered better: it is
                         where engaging actually happens, and the statement
                         arrives in it as the thing being talked about rather
                         than as a heading with controls underneath.

                         THE EMPTY LINE IS STILL NOT A DOOR. "I haven't
                         formed anything yet" has nothing on the other side
                         of it — a conversation seeded with a sentence about
                         having nothing to say is a worse first chat than no
                         chat, and a control that opens one is the "opens an
                         empty page" failure this branch already refused. */
                      /* ═══ AND EVERY BUBBLE ENDS IN A NAMED ACT ═══════
                         Founder: "all speech bubbles should have an action
                         at the end — such as 'add more inspiration', when
                         you click on it then it opens add new inspiration.
                         If there's a top of mind formed then say 'this is
                         my current top of mind' and then write the top of
                         mind, and then the agent should say 'should we
                         chat about it more?' or something like that."

                         THIS REVERSES "THE SENTENCE IS THE DOOR", and the
                         old note is kept below because its warning is
                         still the thing to design against: "a pill inside
                         a speech bubble is a dialog box with an OK in it."
                         What was wrong was not the reasoning but what it
                         was reasoning about. The whole bubble being
                         pressable is invisible — nothing says a sentence
                         can be pressed, and a reading and the empty line
                         went to DIFFERENT places with no way to tell. The
                         founder has been pressing a surface whose two
                         states look identical and behave differently.

                         SO THE ACT IS NAMED AND THE WARNING IS OBEYED: the
                         line underneath is set as speech, underlined, in
                         the creature's own voice — "Let's talk about it" —
                         rather than as a pill. It is the companion
                         offering, which is what it was always supposed to
                         read as, said out loud instead of implied.

                         AND THE READING SAYS WHAT IT IS. "This is what's on
                         your mind right now" above the words, because a
                         sentence appearing in a speech bubble with no frame
                         is something the creature SAID; with the frame it
                         is something it is showing you about yourself. The
                         founder asked for exactly this preamble. */
                      /* ═══ AND IT IS ONLY YOURS ON YOUR OWN WALL ══════
                         Founder, standing on their agent's wall and reading
                         their own reading back: "this is my top of mind, why
                         is my agent also showing it."

                         `lead` IS THE ACCOUNT'S READING, NOT THE WALL'S. It
                         comes from `loadPersonalReading`, keyed on
                         `storageScope.profileId`, so it is the same object
                         whichever wall you are standing on — and the bubble
                         printed it under "This is what's on your mind right
                         now" while the creature was wearing somebody else's
                         form. An agent that has formed nothing was showing
                         its owner's sentence as though it were its own.

                         THE EMPTY CASE WAS ALREADY RIGHT, which is what makes
                         this a miss rather than a decision: `restingWord`
                         branches on `standingAsAgent` and says the agent has
                         adopted nothing. Only the case where a reading EXISTS
                         was left unscoped, so the bug appears exactly when
                         the owner has a top of mind and the agent does not —
                         the common case, and the one nobody tests with.

                         THE REFRESH WAS ALREADY SCOPED TOO: the loop that
                         re-reads the reading returns early on
                         `atWall.kind !== "self"`. So the data layer and the
                         empty state both knew; only the sentence did not. */
                      lead && !standingAsAgent ? (
                        <>
                          <span className="jar-char-bubble-of">{say('worldBubbleActMine')}</span>
                          <span className="jar-char-bubble-reading">{lead.body}</span>
                          {/* TWO OFFERS, BOTH IN ITS VOICE. Founder,
                              2026-10-15: people should be able to "share
                              their current top of mind". This bubble is
                              where the top of mind is on the home screen,
                              so the offer is made here, as one more thing
                              the creature says rather than a button beside
                              it — the same foot row as talking. */}
                          <span className="jar-char-bubble-acts">
                            <button type="button" className="jar-char-bubble-act"
                              disabled={talking}
                              onClick={() => { void talkAbout({ id: '', text: lead.body }); }}>
                              {say('worldTalkAboutThis')}
                            </button>
                            {storageScope && !offline ? (
                              <button type="button" className="jar-char-bubble-act jar-char-bubble-act--quiet"
                                onClick={() => setThingShare({
                                  kind: "topOfMind",
                                  text: lead.body,
                                  proof: formatMessage(locale, "worldShareOnMyMind", { date: dateStamp(Date.now(), locale) }),
                                })}>
                                {say('worldBubbleActShare')}
                              </button>
                            ) : null}
                          </span>
                        </>
                      ) : agentSays ? (
                        /* ═══ AND ON ITS WALL, THE AGENT'S OWN ══════════
                           The scoping above kept your sentence off your
                           agent's wall, and nothing took its place: an agent
                           with a reading fell through to `restingWord`, so it
                           said "nothing adopted yet" over a top of mind the
                           server had returned (screenshot check, 2026-10-16).
                           Its line is the agent's LEAD — `direction.current`
                           on its own bundle, chosen by the same pinned-else-
                           first rule as your `lead` (see `agentSays`) — and
                           not the wall's `chrome`, which lands an effect late
                           (one render of YOUR sentence here) and holds the
                           dial's T rather than now. Framed in its own first
                           person, because the creature is wearing its form.

                           NO "LET'S CHAT ABOUT IT" HERE, on purpose.
                           `talkAbout` opens YOUR chat with the text as YOUR
                           opening message (`createConversation(profileId, …,
                           { content: kept.text })`), so the agent's "I keep
                           the version that…" would arrive as words you said.
                           Until a chat can quote a subject rather than speak
                           it, the honest bubble here has no act (code
                           review, 2026-10-16). */
                        <>
                          <span className="jar-char-bubble-of">{say('worldBubbleActAgentMine')}</span>
                          <span className="jar-char-bubble-reading">{agentSays}</span>
                        </>
                      ) : (
                        /* ═══ AND THE EMPTY LINE IS A DOOR AFTER ALL ═════
                           Founder: "this should say no top of mind formed
                           yet, add more inspirations. And then clicking on
                           that speech bubble should lead to new
                           inspiration. Don't say no reading."

                           It was the one state of this bubble that led
                           nowhere, on the argument that "a control that
                           opens an empty page is worse than no control" —
                           which was right about the page it used to open
                           (the reading, which did not exist yet) and wrong
                           about what the sentence is for. The line names a
                           thing the person can DO something about, and the
                           thing is saving another inspiration. A sentence
                           that asks for something and cannot be acted on is
                           the worse control.

                           SO THE BUBBLE'S RULE HAS EXACTLY ONE SHAPE NOW:
                           what the companion says is a door, and the door
                           is a chat about what it said — EXCEPT when what
                           it said names the act of saving, in which case it
                           is the notepad. The offer ("Feeling inspired?
                           Save it.") and this line are the two that name
                           it, and they go to the same place. */
                        <>
                          <span className="jar-char-bubble-reading">{restingWord}</span>
                          {/* NEVER ON THE AGENT. Founder, 2026-10-15: "you
                              cannot add inspiration for the agent mode. only
                              your agent can add inspiration. remove that as
                              an option for agent character at all times."
                              What an agent keeps arrives from the agent's own
                              work; the person standing on its wall cannot
                              write into it, so the offer would be a door to
                              a notepad that saves to somebody else. */}
                          {standingAsAgent ? null : (
                            <span className="jar-char-bubble-acts">
                              <button type="button" className="jar-char-bubble-act"
                                onClick={startNewInspiration}>
                                {say('worldBubbleActAdd')}
                              </button>
                            </span>
                          )}
                        </>
                      )
                    )}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
          {!mouthOpen && charSay ? (
            /* THE SAME WHITE AS THE TOP OF MIND. This bubble wore a lighter
               fill (`--aside`) to step back from the reading; founder,
               2026-10-15: "make all ... the speech bubbles be the same color
               ... as the top of mind ... don't do that." */
            <div className="jar-char-bubble" data-jar-chrome="1" data-jar-interactive="1">
              <div className="jar-char-bubble-body">
                {/* THE SENTENCE IS THE DOOR — there is no longer a second
                    line under it offering to open one.

                    Founder: "no matter what the character is saying, clicking
                    on what it says should open up a chat." A "Talk about
                    this" beneath the words was already most of the way there
                    — it was deliberately not a pill, for the reason below —
                    but it still made a person read two lines to act on one,
                    and it put the verb somewhere other than the thing the
                    verb is about.

                    KEPT FROM THE OLD NOTE, because the reasoning survives
                    the control: "a pill inside a speech bubble is a dialog
                    box with an OK in it — the bubble stops reading as
                    something said and starts reading as something that wants
                    an answer." That is still why this is a line of speech
                    wearing a press, and not a button. */}
                {/* THE WEATHER GETS THE SAME NAMED ACT. Founder: "all
                    speech bubbles should have an action at the end." This
                    is the bubble that reports what has been happening, and
                    it led into a chat on a press nothing advertised. */}
                <span className="jar-char-bubble-reading" role="status">{charSay}</span>
                {/* ═══ CHAT WHEN THERE IS SOMETHING, SAVE WHEN THERE IS NOT ══
                    Founder, of "Quiet lately — Let's talk about it":
                    "determine when it's appropriate to say 'lets chat about
                    it' vs 'save an inspiration' ... the latter is more
                    appropriate."

                    THE RULE: a line ABOUT something you kept — last week
                    still warm, memories nothing rests on yet, what the
                    weather noticed — is worth a conversation. A line about
                    there being little or NOTHING — empty, quiet, too young
                    to see a shape — has nothing on the other side of a chat;
                    what it is asking for is the next thing kept, so it
                    opens the notepad. On the agent's wall that second kind
                    offers nothing, because only the agent writes there. */}
                {/* AFTER A SAVE, THE CHAT IS ABOUT WHAT WAS SAVED — not about
                    the words "I'm inspired!". A keep with no words (a file and
                    nothing else) has nothing to talk about yet, so no act. */}
                {charSay === say('worldImInspired') ? (
                  visibleInspiration?.text.trim() ? (
                    <span className="jar-char-bubble-acts">
                      <button type="button" className="jar-char-bubble-act"
                        disabled={talking}
                        onClick={() => { void talkAbout(visibleInspiration); }}>
                        {say(talking ? 'worldTalkOpening' : 'worldTalkAboutThis')}
                      </button>
                    </span>
                  ) : null
                ) : sayIsAboutNothing(charSay) ? (
                  standingAsAgent ? null : (
                    <span className="jar-char-bubble-acts">
                      <button type="button" className="jar-char-bubble-act"
                        onClick={startNewInspiration}>
                        {say('worldBubbleActAdd')}
                      </button>
                    </span>
                  )
                ) : (
                  <span className="jar-char-bubble-acts">
                    <button type="button" className="jar-char-bubble-act"
                      disabled={talking}
                      onClick={() => { void talkAbout({ id: '', text: charSay }); }}>
                      {say('worldTalkAboutThis')}
                    </button>
                  </span>
                )}
              </div>
            </div>
          ) : null}
          <div ref={measured.charSay} className="jar-char-say" data-jar-chrome="1" data-jar-interactive="1">
            {/* WHAT IT THINKS ABOUT YOU, ASKED WHERE YOU ALREADY ARE. The
                claims page is gone: this is the one thing the product needs
                from a person and cannot do alone, so it is asked by the thing
                that did the reading, on the screen everyone starts on. One at
                a time — a list of claims under the face would be the dense
                version of the thing "one line at a time" removed. */}
            {/* WHICH FORM IT IS WEARING, AND HOW TO CHANGE IT.
                The switch belongs here and not in a corner: the creature IS
                the identity, and the canvas already renders the agent as the
                same companion in a machine form, dissolving between the two
                with the aura held constant to say so. A corner toggle framed
                that as travel between two places. This frames it as what it
                is — one companion, two faces.
                A WORD, NOT A MYSTERY. Pressing a creature is not a
                discoverable gesture, so the form is named underneath it and
                the name is the control. It says where you are and changes it
                in one press. */}
            {/* WHICH FORM IT IS WEARING, AND HOW TO CHANGE IT.
                Founder: "instead of my agent being on the left, it should
                show up when I click on the right button, and it should be
                easily changeable between me and my agent at this part of the
                experience."
                Both sides, in the order the words go: you on the left, your
                agent on the right. A single label that toggled said where you
                were and hid where else you could be — which is the same
                mistake the wall dropdown made, with one option instead of a
                list. Two words, one inked, and switching is a press on the
                other.
                It belongs here rather than in a corner because the creature
                IS the identity: the canvas already dissolves between the two
                forms and holds the aura constant to say it is the same
                companion throughout. */}
            {/* THE FORM SWITCH MOVED TO THE TOP-LEFT CORNER. Founder:
                "switch between me and my agent should go in top left now that
                we have new entry point for chat." The corner was the chat
                door until the dock took that job, and whose material you are
                looking at is a better use of a fixed corner than a second
                entrance to a room the dock already names. */}
            {/* ═══ THE CLAIM IS A CARD YOU MOVE ════════════════════════════
                Founder, 2026-10-15: "I want this to be feeling like a swipe
                experience ... drag on laptop, swipe on mobile, to give this
                sense of a very easy yes or no." It was swiped up and down
                first; it is a `ClaimSlip` now, thrown sideways like the
                agent's pick ("better than the drag upward, drag down").

                WHAT STOOD HERE. Three words under the sentence — yes, partly,
                not true — and the two soft ones opened a conversation. The
                history of that row is in git (`ClaimCard.tsx`, then `ClaimSlip.tsx`); what
                carries over is everything that was load-bearing: the verdict
                still files the instant an answer commits, one card at a time,
                the queue advances without a round trip, and the sitting still
                ends on the top of mind coming back.

                PARTLY LEFT WITH THE ROW. Its job — an invitation to say what
                is true instead — is "Chat about it", the slip's third way out
                (pulled down, or the middle label), and the one link on the
                receipt after a "Not anymore", below. A no never opens the
                chat on its own: no has to cost what yes costs, or the gesture
                is a trap on one side.

                NO "IS THIS TRUE OF YOU?" ABOVE IT, still. Founder: "'is this
                true of you' kind of is too much like information." The labels
                under the slip say it instead, and they are the controls for
                anyone who does not drag. */}
            {/* ═══ WHY NOT — after a candidate was swiped away ═══════════ */}
            {!mouthOpen && harvestWhy ? (
              <HarvestReasons
                key={harvestWhy.candidate.id}
                text={harvestWhy.candidate.text}
                locale={locale}
                busy={harvestWhy.busy}
                failed={harvestWhy.failed}
                onReason={(reason, note) => { void letCandidateGo(harvestWhy.candidate, reason, note); }}
                onKeepFixed={(words) => {
                  const candidate = harvestWhy.candidate;
                  setHarvestWhy({ candidate, busy: true, failed: false });
                  void keepCandidate(candidate, words, false).then((kept) => {
                    /* Kept: the question is finished. Not kept: it stays
                       open with the corrected words and says so — the swipe
                       already declined it, so putting the original back in
                       the queue would only lose the edit. */
                    if (kept) { setHarvestWhy(null); setCharSay(say('worldHarvestKept')); }
                    else setHarvestWhy({ candidate, busy: false, failed: true });
                  });
                }}
              />
            ) : null}
            {/* ═══ A SENTENCE OF YOURS, PICKED FROM YOUR DAY ══════════════
                The same slip and the same gesture as a reading — right keeps
                it, left lets it go — because the act is the same act: is
                this mine to hold. What differs is what
                happens next. A kept candidate becomes an ordinary save; a
                let-go one asks why, because a collector that only hears
                "no" cannot pick better tomorrow. */}
            {reviewing && !mouthOpen && !harvestWhy && harvestQueue[0] ? (
              /* NOT THE READING'S TONE, ON PURPOSE. Founder, 2026-10-15: type
                 two needs "a very clear distinction" — these are what the
                 agent thought mattered, not what WAKA reads in you. So a line
                 saying your agent noticed it, your own words in italic, and
                 the agent's colder light with pixel-stepped corners. See
                 `AgentPick`. */
              <AgentPick
                key={`harvest:${harvestQueue[0].id}`}
                id={harvestQueue[0].id}
                text={harvestQueue[0].text}
                /* WHERE IT CAME FROM, BY NAME. Founder, 2026-10-15: "lets say
                   sth like 'Inferred from your [claude/gpt/etc] MCP [date]'." */
                source={[
                  toolName(harvestQueue[0].tool)
                    ? formatMessage(locale, 'worldHarvestInferred', { tool: toolName(harvestQueue[0].tool)! })
                    : say('worldHarvestInferredPlain'),
                  agoWords(Date.parse(harvestQueue[0].createdAt), Date.now(), locale),
                ].join(' · ')}
                next={harvestQueue.length > 1}
                locale={locale}
                onAnswer={(answer) => {
                  const candidate = harvestQueue[0]!;
                  harvestLeavingRef.current.add(candidate.id);
                  if (answer === 'keep') {
                    void keepCandidate(candidate, candidate.text).then((kept) => { if (kept) setCharSay(say('worldHarvestKept')); });
                  } else {
                    /* LET GO NOW; THE REASON IS A SECOND, OPTIONAL THOUGHT.
                       The decline lands on the swipe, so a closed tab or an
                       unanswered "why not" cannot leave the sentence waiting
                       to be asked again. The reason, if one comes, follows
                       it — the server takes one reason after a bare decline. */
                    void declineHarvest(candidate.id).catch(() => undefined);
                  }
                }}
                onLeft={(answer) => {
                  const candidate = harvestQueue[0]!;
                  harvestLeavingRef.current.delete(candidate.id);
                  const comesBack = harvestReturnRef.current.delete(candidate.id);
                  /* From the queue as it is NOW, not as this render saw it:
                     a failed keep may have changed it during the trip. */
                  setHarvestQueue((queue) => {
                    const rest = queue.filter((row) => row.id !== candidate.id);
                    return comesBack ? [candidate, ...rest] : rest;
                  });
                  if (answer === 'not') setHarvestWhy({ candidate, busy: false, failed: false });
                }}
              />
            ) : null}
            {reviewing && !mouthOpen && !harvestWhy && !harvestQueue[0] && claimQueue[0] ? (
              /* THE SAME SLIP AS YOUR AGENT'S PICK, IN THE OTHER MATERIAL.
                 Founder, 2026-10-15: "let's have this design for 'keep it or
                 not it' for the first type of claim too ... better than the
                 drag upward, drag down." Sideways, with both answers named
                 under it. What still tells the two apart is who presents it
                 (here, the creature above; there, your agent) and what the
                 slip is (WAKA's plain sentence in warm light; there, your own
                 words quoted in cool). */
              <ClaimSlip
                key={claimQueue[0].id}
                id={claimQueue[0].id}
                tone="reading"
                label={claimQueue[0].statement}
                labelKeep={say('worldStillTrue')}
                labelNot={say('worldNotAnymore')}
                /* NO CHAT DOOR ON THE CARD. Founder, 2026-10-15: "remove chat
                   about it under the claim." The card asks one thing — still
                   true or not anymore — so `labelChat`/`onChat` are left off,
                   which also drops the pull-down and ArrowDown into a chat.
                   (The "Say what's true" receipt after a no went too.) */
                more={claimQueue.length > 1}
                /* A TAP GOES DEEPER: the reading and the saves it stands on,
                   in the same room the top of mind's "built from" opens. */
                onOpen={() => { void openClaimRoots(claimQueue[0]!); }}
                onAnswer={(answer) => {
                  const claim = claimQueue[0]!;
                  /* Keep is `true`, not is `not_true`, filed now — a judgement
                     about yourself should not wait on a slip finishing its
                     trip. `partly` is not reachable from here; see the note
                     above. */
                  sayVerdict(claim.id, answer === 'keep' ? 'true' : 'not_true', undefined, claim.contested, claim.statementRevision);
                  /* NO RECEIPT AFTER A NO. There was one — "Noted. Say what's
                     true", a door into a chat under the slot — and the
                     founder took it out, 2026-10-15: "note * say whats true
                     instead -> remove this flow." The answer is filed; the
                     next card comes up. */
                }}
                onLeft={() => {
                  /* ═══ THE SITTING ENDS ON SOMETHING ════════════════════
                     Every product that asks for a run of small judgements
                     terminates the run on a GIFT rather than a receipt:
                     Readwise's last card is a bonus highlight, Finch's pet
                     comes back with a story. WAKA's terminal beat is the
                     person's own top of mind coming back — the statement
                     band un-yields when this queue empties — and the line
                     says what is happening rather than claiming the
                     sentence on screen has already changed. */
                  /* By id and functionally: a refetch during the card's trip
                     must not be overwritten by the queue as it was before. */
                  const answered = claimQueue[0]?.id;
                  setClaimQueue((queue) => {
                    const left = queue.filter((claim) => claim.id !== answered);
                    if (!left.length) setCharSay(say('worldSittingDone'));
                    return left;
                  });
                }}
              >
                <p className="jar-pick-statement">{claimQueue[0].statement}</p>
                {/* ASKED AGAIN, AND SAYS SO. Founder, 2026-10-15: "is this
                    still true? ... obviously things go outdated." A reading
                    you said yes to a season ago comes back; without this
                    line it would look like WAKA forgot you had answered. The
                    month is spoken, never printed as a number. */}
                {claimQueue[0].askedAgain ? (
                  <p className="jar-pick-source">
                    {formatMessage(locale, "worldClaimAskedAgain", { month: monthTag(Date.parse(claimQueue[0].askedAgain.lastAnsweredAt), locale) })}
                  </p>
                ) : null}
                {/* WHERE IT CAME FROM, IN ONE LINE — unchanged. Founder:
                    "how do we help the user deep dive into what inspirations
                    led to this ... without overwhelming the space we have?"
                    The three-line list was tried and rejected ("makes the
                    page messy"); one line in the proof register the
                    principles wear, and pressing it opens the archive on
                    exactly those saves. Absent when the claim arrived with
                    no sources, because a line claiming nothing is worse than
                    no line. It is a control inside the card, so the card's
                    gesture lets it be. */}
                {claimQueue[0].from?.length ? (
                  <button type="button" className="jar-pick-from"
                    onClick={() => {
                      const claim = claimQueue[0]!;
                      setSavesFocus({
                        label: formatMessage(locale, "worldClaimFromCount", { count: claim.from!.length }),
                        ids: claim.from!.map((row) => row.id),
                      });
                      openOverHome('saves');
                    }}>
                    {formatMessage(locale, "worldClaimFromCount", { count: claimQueue[0].from.length })}
                  </button>
                ) : null}
              </ClaimSlip>
            ) : null}
            {/* ═══ AND THE SEAT DOES NOT SIT THERE EMPTY ═══════════════════
                Founder, on a bordered box with nothing inside it: "there
                isn't anything the user needs to engage with, so why is this
                box here?"

                THE SEAT HAD TWO CONTENTS AND ONE WAS JUST REMOVED. Its own
                note called it "one seat, two contents" — a claim that needs
                answering, or the reading's verbs — "never both, never
                neither". Taking the verbs out made "neither" reachable for
                the first time, and the branch went on rendering its frame
                around nothing. A box with no contents is the clearest
                possible case of chrome saying "something belongs here" when
                nothing does.

                SO THE READING BRANCH IS GONE, NOT EMPTIED. The claim branch
                above is untouched and is still the whole of it: when WAKA
                has something for you to answer, the seat appears with the
                question in it, and when it does not, there is no seat. That
                is what the founder checked — "just because I deleted the
                other thing doesn't mean this entire bottom experience is
                gone, right?" It is not: answering claims is a different
                branch of this same ternary and nothing in this change
                touches it. */}
            {!mouthOpen ? <AuthoredSaveNotice save={inspirationSave} locale={locale} /> : null}
            {/* ONE THING FROM ONE MOUTH. The narration ("you kept two memories
                today") stacked under the claim, so the creature was reporting
                the weather and asking you a question in the same breath — a
                third block of words in a column that already had two. The
                codebase's own whisper rule is one clause at a time; this is
                that rule holding across the two things that can speak, not
                just within each. The line comes back the moment the claim is
                answered. */}
            {/* WHAT IT SAYS NOW LIVES ABOVE ITS HEAD — see `.jar-char-bubble`.
                It was a line under the chin, which put it in the same column
                as the claim and meant one had to silence the other. Speech
                and a question are different acts and now have different
                places: the creature talks upward, and what it is asking you
                stays beneath it. */}
            {/* WHAT THE RECEIPT OFFERS IS THE CONVERSATION, not a second door to
                a note. "Reflect" opened a private note on the thing just kept
                — and the thing just kept already carries that door, on its own
                card, where a note about a thing belongs. This is the move the
                moment is actually for.
                It is offered only when there are words to talk about: a keep
                that is a file and nothing else has not said anything yet. */}
            {/* THE RECEIPT UNDER THE BOX IS GONE. Founder, 2026-10-16: "remove
                the saved and lets chat about it at the bottom" — the creature
                says it now ("I'm inspired!", with the chat as its act). */}
          </div>
        </div>
        {mouthOpen ? <InspirationComposer text={draft} media={inputMedia}
          linkText={composerDraft.draft.linkText ?? ''} onLinkText={composerDraft.setLinkText}
          recordingCandidate={composerDraft.draft.recordingCandidate}
          onChooseRecording={useNew => { composerDraft.chooseRecording(useNew); setMouthNote(''); void composerDraft.flush().catch(reason => setMouthNote(String(reason))); }}
          locale={locale} ready={composerDraft.ready} fileDraftsAvailable={composerDraft.available} busy={preparingInspiration || checkingFiles}
          uploadingId={uploadingMediaId} error={mouthNote || composerDraft.error}
          save={inspirationSave} recording={recording} inputRef={mouthFieldRef}
          onText={(text, caret) => { mouthCaretRef.current = caret; draftRef.current = text; setDraft(text); setMouthNote(''); }}
          onFiles={files => { void addInspirationFiles(files); }}
          onRetryFile={id => { void retryDraftFile(id); }}
          onRemove={id => { if (id.startsWith('text-link:')) setDraft(removeInspirationLink(composerDraft.current.current.text, id.slice('text-link:'.length)));
            else composerDraft.setMedia(composerDraft.current.current.media.filter(item => item.id !== id)); }}
          draftUpdatedMs={composerDraft.draft.updatedAt}
          /* `onPast` IS GONE WITH THE CHEVRON IT FED. It carried a real
             lesson — leaving through history and writing an address in
             sequence raced, and the pop landed last — but the control it
             was wired to was removed by the founder ("I can just go to all
             the inspirations using the bottom panel") and nothing has
             called this since. The lesson lives where it still applies:
             `openOverHome` writes ONE destination, which is why pressing a
             place from inside the notepad does not need a close first. */
          onClose={saveAsDraft} onSubmit={() => { void keepIt(); }}
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
          {/* THE WHISPER ATTRIBUTION IS GONE WITH ROOMS. A room orb's card
              headed with whose save it was — the author's name, and the date
              only where the evidence carried one, because leaving a fact out
              is honest and guessing at it is not. Every orb is yours now, so
              the date alone is the whole head. */}
          {(
            <span className="jar-panel-when jar-label">
              {/* the date alone, with its year — "Two days ago · Aug 24" said
                  one fact twice, and the relative half goes stale while the
                  card stays open (founder, 2026-08-27) */}
              {dateStamp(panelBall.capturedMs, locale)}
              {panelHasReflection ? <span className="jar-panel-reflected"> · {say("worldReflected")}</span> : null}
            </span>
          )}
          {/* ═══ `PRIVATE / PUBLIC` IS GONE FROM THIS CARD ═══════════════════
              Founder, 2026-10-12, asked directly: remove it, with rooms.

              WHAT STOOD HERE AND WORKED. A lit/dim pair at the top right —
              the same shape the mouth wears while writing, both words always
              present, the standing one lit, pressing the other one moving it
              — with `aria-pressed` on each and Private as the state you got
              by touching nothing. It was the founder's own design (2026-08-25:
              "top right should have option to switch between Private ·
              Public. also call it private and public everywhere"), and
              un-publishing a memory a pattern stood on asked first, in the
              card's own foot, exactly as deleting does (2026-08-27: "similar
              warning should occur when changing what was public to private as
              well").

              WHY IT GOES WITH ROOMS RATHER THAN SEPARATELY. `public` on this
              column never meant the internet. `inspirations.visibility`'s own
              schema comment says it means THE ROOMS THIS PROFILE'S ACCOUNT
              BELONGS TO, and a room's ground was exactly that query: every
              current member's public captures. With rooms gone the control
              offered a choice between two states that are now identical, and
              its confirmation promised an audience that cannot exist — the
              sheet read "People in your rooms can read it and its
              attachments", about rooms there are none of. Shipping the room
              removal while leaving a control that says that would be the
              worst of both.

              IT WAS ALSO THE THIRD OF THREE. The settings panel's public
              group and the composer's frozen `onVisibility` switch went on
              2026-10-12 under "everything regarding public and private should
              also not be a thing in this new experience"; this one was left
              behind on the argument that its column means rooms rather than
              the internet, and filed as a question for the founder. They have
              now answered it.

              THE COLUMN IS NOT TOUCHED, AND THAT IS DELIBERATE — the same
              ruling made for `profiles.public_handle` on the same day, for
              the same reason. `inspirations.visibility` still stores what
              anybody already chose, `PATCH /inspirations/:id` still accepts
              it, and `lib/data`'s `Inspiration.isPublic` still carries it to
              this page. Closing the door is reversible; rewriting stored
              audience data is not, and nobody has asked for it. What IS now
              true and belongs in a report rather than in a comment: with the
              room routes gone, nothing in the product reads `visibility` to
              decide who may see a memory — the only remaining readers are the
              column itself and the flag this page no longer renders. */}
          <button type="button" className="jar-copy-link" title={say('worldCopyInspirationLink')}
            aria-label={say('worldCopyInspirationLink')} onClick={() => void copyInspirationLink()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 14 4-4m-7 3-2 2a4 4 0 0 0 6 6l4-4m-4-10 2-2a4 4 0 0 1 6 6l-4 4" /></svg>
          </button>
          </div>
          {/* THE "MAKE THIS PUBLIC?" SHEET WENT WITH THE PAIR ABOVE. It was
              a warning and two words — keep private, make public — and the
              warning named rooms as the audience. */}
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
                true
                  ? "jar-panel-text jar-panel-text--yours"
                  : "jar-panel-text"
              }
              style={markStyle}
              onClick={beginPanelEdit}
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
          {/* THE CITED-BY SENTENCE WENT WITH THE ROOM THAT NEEDED IT. On a
              room's ground it said which of the room's readings had cited
              this save — attribution by reading, the finest grain a room was
              allowed to know about somebody else's memory. `citedWords` in
              `lib/words.ts` is gone with it; your own wall says what rests on
              a memory through the field's light and the provenance room. */}

          {/* Public capture cards are not signal statements. Room pattern
              reactions live in Shape together and never post a capture ID. */}

          {/* The one action. Everything else that used to be here — the
              sparks block, what this feeds, nearby in your jar — was
              apparatus: it made a person ask what each list was instead of
              reading what they saved. */}

          {panel.detail?.conversationOrigin?<p className="jar-review-context">{say(panel.detail.conversationOrigin.authorship==='adopted'?'worldChatAdoptedOrigin':'worldChatUserOrigin')}</p>:null}
          {reflectOpen && !panel.detail ? <p role="status">{say('worldOpeningAttachment')}</p> : null}
          {/* WHAT YOU ALREADY WROTE ABOUT THIS SAVE, READ BACK.
              `ReflectionFlow` stood here — 297 lines that generated a
              follow-up question, took an answer, kept a draft on the device,
              recovered that draft when the device could not keep it, and
              offered go deeper, retry, delete and copy-link around it. The
              founder folded the whole flow: *"Typing happens in one place
              only: when you correct."*
              What could NOT be folded is the words. Answers written through
              that flow are evidence the readings are drawn from; a save that
              says "· Reflected" and then cannot show you what you reflected
              would be the product hiding the person's own writing. So this is
              the same material, read-only: the question it was asked under,
              the answer underneath. No textarea, no draft, no verbs.
              It wears `.jar-reflection-turn` and `.jar-reflect-q`, which are
              `ReflectionFlow`'s own classes for exactly these two lines —
              borrowed rather than invented so the type ladder stays one
              ladder. Skipped questions never counted as reflected and still
              do not appear. */}
          {reflectOpen && panel.detail ? (
            <div className="jar-reflection-flow">
              {(panel.detail.reflections ?? [])
                .filter((item) => !item.skipped && item.answer)
                .map((item) => (
                  <div key={item.id} className="jar-reflection-turn" data-reflection-id={item.id}>
                    <p className="jar-reflect-q">{item.question}</p>
                    <p>{item.answer}</p>
                  </div>
                ))}
              {/* ONE PRESS BACK TO THE MEMORY (Law 2). The old flow carried
                  its own finish; a read with no finish is a surface you enter
                  and cannot leave, which is the founder's most-repeated
                  complaint. */}
              <p className="jar-ask jar-ask--row">
                <button type="button" onClick={() => { setReflectOpen(false); viewNavigation.write({ ...observedRef.current, reflectionId: null }, { observed: true, replace: true }); }}>
                  {say('worldClose')}
                </button>
              </p>
            </div>
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
                {/* THE COPY THAT DISAGREED. This offered `image/*` while the
                    other three pickers in the product offered seven named
                    types — so a TIFF, a BMP or an SVG was selectable HERE and
                    refused with a sentence THERE, on the same product, for the
                    same act. `image/*` is also the browser's own guess at a
                    type, which is the one input the photo rule's first
                    sentence says not to trust, offered as a filter.

                    It now quotes `PHOTO_ACCEPT` like the rest, and `attachTo`
                    below sniffs the bytes — the chooser and the check finally
                    agree about what this path takes. */}
                <input
                  type="file"
                  accept={PHOTO_ACCEPT}
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
          {/* WHY THE PICTURE DID NOT GO ON, UNDER THE ROW THAT OFFERED IT.
              The commonest reason is now a refusal rather than a fault:
              `attachTo` sniffs the bytes, so choosing a file this product does
              not take ends here with the sniffer's own sentence instead of
              with nothing at all. A press that visibly does something —
              "add a picture" becomes "adding…" and then changes back — and
              then says nothing is the failure this product has fixed in five
              other corners under its own law.

              A SIBLING AND NOT A CELL IN THE FOOT, because the foot is a `<p>`
              with three spans in it and a paragraph cannot hold a paragraph;
              and `jar-panel-warn` because that is already the card's voice for
              a quiet fact about this memory (it dresses the delete and
              unpublish warnings two blocks down). No new class, no new colour.

              IT IS CARRIED WITH AN ID so that stepping to the next memory with
              a refusal on screen does not re-point the sentence at a card it
              was never about. */}
          {editing.open?.kind === "memory" && editing.open.id === panelId
            && attachTrouble?.id === (panelBall?.sigId ?? panelId) ? (
            <p className="jar-panel-warn" role="status">{attachTrouble.text}</p>
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
          ) : null}
          {/* AND THE ASK BEFORE UN-PUBLISHING. It was armed only when the
              memory was public AND a pattern stood on it — the mirror of
              delete's rule, because a warning with nothing to warn about is
              friction wearing a safety costume. That rule is still live for
              DELETING, which is the branch above this one. */}
          {!reflectOpen &&
          !editing.open &&
          !(forget.step === "asking" && forget.id === panelId) ? (
            <p className={`jar-ask jar-ask--after jar-panel-foot${panelHasReflection ? " jar-panel-foot--reflected" : ""}`}>
              {/* THE VERB IS `READ`, AND ONLY WHEN THERE IS SOMETHING TO
                  READ (2026-10-10). This cell used to offer `Reflect` on a
                  save with no answers yet, which opened a generated question
                  and a textarea — the writing flow the founder folded: *"Typing
                  happens in one place only: when you correct."* So the
                  write half is gone and the read half stays, because words a
                  person already wrote do not stop being theirs when the door
                  they wrote them through closes. On a save with no answers
                  the cell is now empty, which is the honest state: there is
                  nothing here to open. */}
              <span className="jar-panel-foot-l">
              {panelHasReflection ? (
                <button type="button" className="jar-panel-reflection-link" onClick={openReflections}>
                  {say("worldReadReflection")}
                </button>
              ) : null}
              </span>
              <span className="jar-panel-foot-c">{panelStepCarets}</span>
              <span className="jar-panel-foot-r">
              {(
                <>
                  {/* DELETING ASKS ONLY WHEN THERE IS SOMETHING TO SAY
                      (founder, 2026-08-25: "delete it without warning if
                      inspiration is not powering a signal. if it does, then
                      show a new modal to explain the situation"). A memory
                      nothing was read from goes the moment you say so —
                      a warning with nothing to warn about is friction wearing
                      a safety costume. A memory a signal stands on opens the
                      ask below instead. */}
                  {forget.step === "going" && forget.id === panelId ? (
                    say("worldDeleting")
                  ) : forget.step === "failed" && forget.id === panelId ? (
                    /* PROSE, AND IT SAYS WHAT IS TRUE: the memory is still
                       here. Beside the verb rather than in a sheet, because
                       nothing happened and nothing needs deciding — pressing
                       delete again is the whole recovery. */
                    <span className="jar-panel-warn">
                      {say("worldDeleteFailed")}
                    </span>
                  ) : (
                    <>
                      {/* ONE PRESS FROM A THING YOU KEPT TO A CARD OF IT.
                          Only your own, and only when it has words: the card
                          is the words, and a picture alone has nothing for
                          it to say (the renderer refuses an empty card). */}
                      {storageScope && !offline && !standingAsAgent && panel.detail && panel.detail.text.trim() ? (
                        <button
                          type="button"
                          onClick={() => {
                            const detail = panel.detail!;
                            setThingShare(inspirationShareTarget(locale, { text: detail.text, capturedMs: panelBall.capturedMs, attachments: detail.attachments }));
                          }}
                        >
                          {say("worldShare")}
                        </button>
                      ) : null}
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
                    </>
                  )}
                </>
              )}
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
            /* NOT WHEN IT WOULD ONLY SAY "ME" (founder ruling). At home on
               your own wall this pill reads your own name back to you beside
               the menu button, which is noise — you have not gone anywhere.
               It still appears the moment where-you-are is a real question:
               standing in a room, on an agent's wall, or down in the field.
               Switching walls lives in the menu now, and the pill comes back
               with `wallPick` because the list of walls is its own child —
               choosing that row opens the pill already showing the list. */
            /* THE WALL PICKER MOVED TO THE TOP-LEFT CORNER.
               Founder: "the top left should be a drop-down modal that lets
               you switch between your things. So like Agent 1, me." That is
               exactly what this was — the name of the ground you are on and
               the list of the others — and it was living in a bar that holds
               nothing else now. It renders into `Menu`'s left corner now, so
               it sits in the same row as the view switcher and the cog:
               the whole navigation of the product in one row rather than two
               bars stacked on each other. See `groundPicker`. */
            null
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
          {/* NO "NOW" IN YOUR OWN CORNER (founder ruling). It is the dial's
              handle — where you are standing in your own history — and on the
              home screen it sat in the top left underneath the menu button,
              two controls in one corner. It is also the least useful one
              there: pressing a word to learn that today is today, on the one
              screen that is always today, while "Your days" is a page with
              every day on it.

              IT STAYS IN A ROOM, and it stays once you have wound away from
              now. A room's board is one chain and winding it is how its
              history is read at all — removing the handle there would strand
              the whole dial, which is what trying it proved: 24 of its own
              tests went red in one run. */}
          {/* ONLY ONCE YOU HAVE WOUND AWAY FROM NOW. Founder: "why does the
              agent one have now? I want to make it exactly the same as my
              other pages." The handle used to appear on every wall that was
              not your own, which bundled two unlike cases under one
              condition — and the case that justified it was A ROOM: a room's
              board was one chain, winding it was the only way its history
              could be read, and removing the handle there once turned 24 of
              the dial's own tests red. Rooms are gone (founder, 2026-10-12:
              "방 없애"), so that half of the condition goes with them and the
              honest one is left: the word appears when it is the way back. */}
          {dial && phase === "ready" && !dialAway && parkedAt !== null ? (
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
        {/* THE GEAR IN THE TOP RIGHT IS THIS BUTTON NOW (founder ruling:
            "top right should be everything regarding settings"). The labelled
            pill that used to live here opened exactly the same panel, so
            keeping both would have been one door drawn twice — and the pair
            overlapped, because the gear is placed in the same corner. The
            panel itself, its agent settings and every verb inside are
            untouched; only the handle moved. */}

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

      {/* ═══ THE BAND OF NAMES UNDER A ROOM'S WALL IS GONE ════════════════
          Founder, 2026-10-12: "방 없애" — remove rooms.

          A radiogroup of the room's members: press a name and the ground
          below became that person's memories. Two rulings are worth keeping
          out of it, because both outlived the control and neither is written
          down anywhere else. It was mounted AT EVERY HEIGHT rather than
          gated on `inField` — it had been gated, which meant it was not
          mounted at the height you ARRIVE at, the one moment a person needs
          telling that this ground is one of several. And the SKY was exempt:
          up there you are reading patterns, and whose ground is under you is
          not the question. It also carried full arrow/Home/End roving focus,
          which is the standard this product holds radio groups to. */}


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
          <div className="jar-dial-list" role="group" aria-label={say('worldDialLabel')}>
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
            </button>
            {/* NO CAPTION UNDER A DATE ANY MORE. A room's stop carried one —
                "Jina joined · the board changed" — read out of its door
                ledger by `groupHistoryCaption`. Your own wall and your
                agent's never had one: a date is the whole of what they are
                offering. The ledger went with rooms. */}
            {dial.stops.map((stop) => {
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
      {/* THE PRINCIPLES PILL THAT STOOD HERE IS GONE.
          It was a top-centre shortcut shown only on walls that were not your
          own, from when the self wall had its own chrome and the others had
          none. The view switcher covers every wall now and its middle row IS
          Principles, so this drew a second control in the same place saying
          the same word — founder, looking at an agent's wall: "why this
          screen so different? it should get the full changes."
          It was: the new chrome arrived on top of the old chrome, which had
          never been swept because it only ever appeared where the new chrome
          had not. */}
      {/* AND `origin/dev` 8b11c2f5 EXTENDED THIS PILL TO YOUR OWN WALL rather
          than removing it: it dropped the `atWall.kind!=="self"` gate and
          made the lit state read `principles?.length` on the self wall. That
          commit and this one are the same complaint answered from opposite
          ends — it made every wall match by giving the self wall the old
          chrome, and this branch made every wall match by giving every wall
          the dock. The dock wins here because the pill's destination is
          covered on EVERY wall by `PrinciplesOverlay` (dock row
          `worldDockPrinciples` -> `openOverHome('principles')`, rendered
          with `profileId={atWall.kind==='agent'?atWall.id:...}`), which also
          carries the count, the share and the open — and because two
          controls saying "Principles" in the same place is the exact defect
          the quote above is about. The sky itself is NOT orphaned: opening a
          principle from that overlay writes `section:'sky'`, and dev's
          other change in this region — the caret back down, now unlocked on
          the self wall too — is kept verbatim a few lines below, which is
          what gives that state its one-press way out. */}

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
          className={`jar-up jar-up--down${atWall.kind === "self" ? " jar-up--personal" : ""}`}
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

      {/* THE "N INSPIRATIONS" DOOR IS GONE FROM HERE TOO.
         Same stale pattern as the Principles pill and Find: a control that
         only ever rendered on walls that were not your own, from when the
         self wall had chrome and the others had none. Founder, on an agent's
         wall: "I want to make it exactly the same as my other pages, but this
         one still has the 10 inspiration bottom page and all of that."
         It is also a numeral printed on a screen, which the product's own law
         forbids — it survived the law for exactly as long as it was invisible
         to whoever wrote it. The archive is a destination in the switcher on
         every wall now. */}
      {/* `origin/dev` 8b11c2f5 EXTENDED THIS ONE TO THE SELF WALL TOO, on the
          same reasoning as the pill, and it loses to the same answer: the
          archive is `SavesOverlay`, reached from the dock on every wall, and
          the door's own text is a printed numeral — "states render, numerals
          never". The exception that justified the numeral was that it is the
          size of your own archive; the overlay says that in the place the
          archive actually is. dev's `.jar-saved--personal` CSS is therefore
          dropped from `home.css` rather than merged: there is no `.jar-saved`
          left for it to modify. */}

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
      {/* MAKING A PLACE WENT WITH THE LIST THAT OFFERED IT.
         The only door into this sheet was the last row of the wall dropdown,
         and that dropdown is a two-state switch now — me, my agent — because
         those are the two places the product currently holds. A sheet nothing
         can open is not a feature in reserve, it is a branch the next reader
         has to work out is unreachable. Rooms come back with their own door;
         git holds this until they do. */}

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
      {/* THE STANDALONE REFLECT SHEET IS GONE, AND IT WAS ALREADY
          UNREACHABLE BEFORE IT WAS DELETED (2026-10-10).
          It opened when a save was made with `reflect: true`, and the only
          thing that could ask for that was `InspirationComposer`, which calls
          `props.onSubmit(false)` and has done for as long as the control has
          existed — so `shouldReflect` was never true, `setReflectOn` was never
          called, and a `DialogSurface` with a generated question, a textarea
          and a "not now" way out sat in the tree being rendered by nothing.
          That is the exact shape of Law 8 in `docs/six-laws.md`: it
          type-checked, it read like live code, and it did nothing. It would
          have gone with the fold either way — the fold removes writing flows
          — but it is worth recording that the fold is not what killed it.
          `worldReflectOnKept` and `jar-reflect-room` went with it. */}
      {/* `ReviewPanel` STOOD HERE, AND SO DID THE WHOLE FOURTH PRODUCT
          (2026-10-10). Founder's workflow design counted the surface: 84 of
          the app's 847 user-facing strings belonged to Review — the largest
          single concept in the product, against three strings for the
          interaction meant to be at its centre — and ruled *"Collapse all
          five into 'correct a claim' — one text field, reached only after
          'not quite'."* That field has since gone too: correcting a claim
          is a conversation now, opened from the claim itself.
          What went with this one call: `ReviewPanel`, `ReviewDialogue`,
          `ReviewResult`, `ReflectionFlow`, `useReviewSession`,
          `useReviewDialogue`, `useReviewEntry`, the review draft and
          selection stores, the `/review/:id` route and its `?thought=`
          deep link, and the three `lib/api` resources behind them. Answers
          already written are still read: `ReviewEvidence` quotes them under
          the principles they are evidence for, which is where the collecting
          was pointed all along. */}
      <div className={`jar-personal-shortcuts${atWall.kind==='self'?' jar-personal-shortcuts--self':''}${atWall.kind==='self'&&inSky?' jar-personal-shortcuts--sky':''}${!inField&&!inSky&&wallCount>0&&(!atNow||(charSay!==''&&!mouthOpen))?' jar-personal-shortcuts--above-count':''}`}
        hidden={Boolean(panelOpen||mouthOpen||seek!==null||viewNavigation.view?.conversationId||viewNavigation.view?.sharePrinciple||thingShare||viewNavigation.view?.open)}>
      {/* THE REVIEW SHORTCUT IS GONE FROM THIS CORNER. It was the one door
          into the folded flow, and `useReviewEntry` existed only to decide
          whether it should read "Review" or "Resume review" — a fetch on
          every arrival to label a button. Capture keeps the corner. */}
      {/* THE `--sky` MODIFIER IS `origin/dev` 8b11c2f5's, AND IT IS STILL
          NEEDED. That commit unlocked the caret back down on the self wall
          (`.jar-up--down.jar-up--personal`, which `home.css` parks at
          bottom:76px), so on your own wall in the sky there is now a control
          exactly where this row sits. 128px lifts the row clear of it. The
          rest of dev's version of this hunk — the review shortcut and its
          `reviewEntry.label` — is gone with the fold, and `useReviewEntry`
          with it, so dev's relabelling of that button had nothing left to
          relabel. */}
      {phase==='ready'&&(inField||inSky||!atNow)?<button type="button" className="jar-capture-shortcut jar-label" data-jar-chrome="1" onClick={startNewInspiration}>
        <HomeActionIcon kind="capture"/> {say('worldCaptureInspiration')}</button>:null}
      {/* AND SO IS FIND. Founder ruling, long since applied everywhere
          else: "find is just it should be a search bar on the your
          inspirations page instead." It survived here for the same reason the
          pill did — this corner of the product was only ever drawn on walls
          the ruling's author was not looking at. */}
      </div>
      {/* ONE DOOR ON THE LEFT, ONE ON THE RIGHT. `PersonalNavigation` used to
          sit along the bottom with Home, Inspirations, Principles and Find —
          four permanent controls on a page whose whole argument is that it
          holds three things. Every one of those verbs survives, as a row in
          the menu, so nothing was dropped to clear the screen. */}
      {/* THE CHROME IS NOT ONLY FOR YOUR OWN WALL ANY MORE.
          This was gated on standing at home because the left corner used to
          be a hamburger full of rows about your own material. The corner is
          the wall picker now — the control whose entire job is to say which
          ground you are on and take you to another — so gating it on being
          on your own ground made it unreachable from every wall it exists to
          get you out of. The switcher and the cog belong everywhere for the
          same reason they belong on the other pages. */}
      {/* ═══ THE DOCK ════════════════════════════════════════════════════
          Founder: "Do it like the mobile app where there are bottom buttons
          so that we can move across sections. Like, have a bottom navbar."

          THE FOUR RUNGS ACROSS THE TOP ARE GONE WITH IT. They named
          inspirations and claims, and both of those now live ON the home
          screen — so two of the four were doors to rooms you were already
          standing in. What is left is genuinely separate places, and places
          belong at the bottom where a thumb is.

          CAPTURE IS A DESTINATION HERE, NOT A SECOND DEMAND. Founder, on the
          screen with the note and the box on it at once: "there is a claim,
          there is save a thought, there's too many things that are happening
          at once here." The reference has no input on its home at all —
          capture there is a door you press. This is that door, and saving is
          still one gesture, which is the ruling that mattered.

          WORDS, NOT ICONS. The reference uses a five-icon bar; this product
          has one typeface and no icon set, and inventing one for the dock
          would be a second meaning channel arriving through the back. Four
          short words in the register this product already labels things in. */}
      {/* THE DOCK STANDS ON AN OPEN CHAT TOO. It was hidden there and shown
          on every other destination — including an open inspiration, which is
          the same depth of the same gesture — so reading one conversation was
          the single state in the product with no bottom bar. Founder, on the
          surface that made this rule: "this should be its own page, so bottom
          navigation always visible." A conversation is a page like the rest
          of them now, so it keeps the bar like the rest of them. */}
      {phase==='ready'&&!viewNavigation.view?.sharePrinciple ? (
        <nav className="waka-dock" aria-label={say('worldMenuLabel')} data-jar-chrome="1" data-jar-interactive="1">
          {([
            /* "HOME" IS NOT A PLACE IN THIS PRODUCT. Founder: "I don't like
               the word 'home', so maybe just the home should be a light bulb
               icon? I don't know."

               Not a lightbulb: a bulb means IDEA, and it would be sitting one
               press away from a row called Inspirations — a glyph saying the
               name of its neighbour. It would also be the only picture in a
               row of words, which is a second meaning channel arriving for
               one entry.

               "Now" instead, which is what that screen actually is. The world
               already calls it that everywhere underneath — `atNow`, the
               present wall, the dial's end — and the row then reads as four
               nouns rather than three nouns and a piece of app furniture. It
               is where your companion is standing at this moment, holding up
               what you are thinking about at this moment.

               HOME PUTS DOWN WHATEVER IS HELD UP — a room OR the notepad.
               It was wired to `closeOpen` alone, which returns on its first
               line when there is no `open`, so from a half-written note the
               row rendered, lit correctly, and did nothing. That is the fifth
               time a control's handler has not matched the state it was for
               (see `closeConversation`); `saveAsDraft` is the notepad's own
               way out and it keeps the words. */
            /* "HERE" HAS TO KNOW ABOUT A CONVERSATION TOO, now that the bar
               stands on one. Without it the bar said you were at Now while
               you were reading a chat, and its own row for the chats was
               dark — the two rows that could tell you where you are, both
               wrong, on the one surface that already had the worst record
               for leaving people lost. */
            /* ═══ TWO WORDS, BOTH OF THEM "A NEW ONE" ═════════════════════
               Founder, 2026-10-15: "at the bottom bar just keep inspiration
               and chat and clicking on it leads to new inspiration and new
               chat, and user can go to inspiration list and chat list only
               from that new page." And Principles leaves the bar: "principle
               is sth user can only get by dragging" — the creature dragged
               right, or →, from Now (see `toPrinciples`).

               PRESSING THE LIT ONE AGAIN IS THE WAY HOME. With Now gone from
               the bar, the row that says where you are is also the way back:
               on a new note or the archive, Inspiration again goes home (the
               note folds into a draft, an open saved note commits first);
               on a chat or the chats list, Chat again goes home. Esc still
               closes every page, and Principles walks home on ← or a drag
               left. */
            /* ═══ WHILE MAKING SOMETHING, THE BAR IS THAT PAGE'S OWN ═══════
               Founder, 2026-10-15: "never put something on any corners. So at
               the bottom, write X inspirations so the bottom bar should be X
               inspirations the microphone the image instead of download have
               a save icon and then have Close button and then clicking close
               brings the user back to the main screen" — and of a chat: "say
               all chats and then close."

               So on a new note the row is: how many you have kept (the way to
               the list), the note's own tools, and Close. On a chat it is All
               chats, then Close. The other place's word steps out of the row
               while you are making something: the bar is the page's, and a
               door to the other room would be a second way out that is not
               Close. On Now and on the two lists the row is Inspiration and
               Chat as before, and the lit one pressed again goes home. */
            /* WHILE REVIEWING, THE BAR IS THE WAY OUT OF IT. Founder,
               2026-10-15: "in the review mode, bottom bar should say exit
               review mode." The cards are the page then, so the two doors
               to other rooms step out and the one word left ends the sitting
               (Esc does the same) and brings the invitation back. */
            ...(reviewing && !making ? [{ id: 'review', label: 'worldReviewExit' as const, here: false,
              go: () => { setReviewing(false); } }] : []),
            /* ON A LIST, ↩ │ CLOSE. Founder, 2026-10-15: "from all
               inspirations, the bottom bar should just be a return icon |
               close." ↩ goes back where the list was opened from — the new
               note (its draft comes back with it) or the chat — or, from a
               saved note open in the archive, back to the list; Close goes
               home. The same for All chats: one ruling for the class.

               BY A REMEMBERED ORIGIN, NOT BY HISTORY. Opening a list from a
               page you are standing on REPLACES that page's entry (see
               `openOverHome`), so there is nothing behind the list to step
               back to; `listOrigin` is set by the bar's own "All …" press. */
            ...(listing ? [{ id: 'return', label: 'worldBack' as const, here: false,
              go: () => {
                const close = closeSavedNote.current;
                if (close) { close(); return; }
                const origin = listOrigin.current;
                listOrigin.current = null;
                if (origin?.kind === 'chat') openTalk(origin.id === 'new' ? null : origin.id);
                else { openOverHome(null); if (origin?.kind === 'note') startNewInspiration(); }
              } }] : []),
            ...(making === 'talk' || listing || (reviewing && !making) ? [] : [{ id: 'inspiration', label: 'worldDockSaves' as const,
              here: false,
              go: () => {
                commitOpenNote();
                /* On a new note this is "All inspirations": the archive comes
                   up and the note folds into a draft on the way. */
                if (making === 'inspiration') { listOrigin.current = { kind: 'note' }; openOverHome('saves'); }
                else startNewInspiration();
              } }]),
            /* SAVE IS NOT A TAB. Founder: "home, inspirations -> let see list
               of past inspirations with main CTA to save new, chat -> see
               list of past chats with main CTA to start new chat,
               principles." Saving is what you DO in the inspirations room,
               not a room of its own — and it has two other doors already:
               pressing the creature, and `?compose=1`. A fifth row leading
               to a thing two other gestures already reach is vocabulary
               without a place behind it. */
            /* THE TWO ROOMS LEAD TO THE PAST; THE PLUS MAKES THE NEW ONE.
               Founder, after a morning of trying it the other way round:
               "from inspirations and conversations, it's not clear that I can
               click the back button to see all inspirations... maybe
               inspirations and conversations should lead to the past ones and
               in the bottom navigation there should be a plus button that
               opens up either save inspiration or start chat — would that be
               better?"

               Yes, and the reason the first arrangement failed is worth
               keeping: a page reached by a NOUN has to be the noun. Pressing
               "Inspirations" and landing on a blank note made the archive a
               thing you had to know was behind a chevron, and a chevron is
               not a label — nothing about it says what is on the other side.

               One verb for making things, in the one place every phone puts
               it, and the nouns mean what they say. */
            /* AND IT IS THE WAY OUT OF AN OPEN NOTE, which is what the
               chevron used to be. Founder: "I still don't get why you have
               this carrot button when I do new inspiration, because I can
               just go to all the inspirations using the bottom panel."
               Closing commits what was typed — see `onNoteOpen` in
               `SavesOverlay`, which hands up `leaveNote` rather than a
               flag, precisely so this press cannot discard an edit. */
            /* THE PLUS. Not a place, so it does not light and does not take
               `aria-current`: it is the only verb in a row of nouns, and the
               sheet it raises is where the verb is chosen. */
            /* CONVERSATIONS BEFORE PRINCIPLES, by the founder's own order:
               "home, inspirations, conversations, and principles". It is also
               the ladder's order — what you kept, what you said about it,
               what has endured — so the row reads left to right the way the
               material actually moves. */
            ...(making === 'inspiration' || listing || (reviewing && !making) ? [] : [{ id: 'talk', label: 'worldDockTalk' as const,
              here: false,
              go: () => {
                commitOpenNote();
                /* On a chat this is "All chats". */
                if (making === 'talk') { listOrigin.current = { kind: 'chat', id: viewNavigation.view?.conversationId ?? 'new' }; openOverHome('conversations'); }
                else openTalk(null);
              } }]),
          ]).map(item => (
            /* THE SHEET HANGS OFF THE PLUS, not off the middle of the screen.
               Founder, with a screenshot: "this not being aligned with the +
               button — these little details are all missing rn."

               Measured: the plus sits at 642 and the sheet at 640, because
               the sheet was `position: fixed; left: 50%` — centred on the
               VIEWPORT while the plus is centred in a row of four words of
               unequal length. Two pixels at this window width, and the gap is
               whatever the labels happen to weigh: a longer word on either
               side moves the plus and the sheet does not follow. The founder
               saw two pixels; what is wrong is that the two were never
               related.

               NOT A MEASUREMENT — A PARENT. The fix that suggests itself is
               to observe the plus and write its centre to a custom property,
               and this product has a law about exactly that road ("every
               measurement feeding layout is observed, not sampled"). The
               cheaper answer obeys it by not measuring at all: the sheet
               becomes a child of the plus's own slot and is centred on it by
               the box model, which cannot drift and has nothing to resample.

               IT ALSO PUTS THE SHEET WHERE THE KEYBOARD EXPECTS IT. Rendered
               after the whole nav, its two rows were the LAST things in the
               tab order — so opening the menu and pressing Tab went to
               "Chats", then "Principles", then a full-screen invisible
               dismiss target, and only then to "New inspiration". Beside the
               plus in source order, Tab goes straight into it. */
            <span key={item.id} className="waka-dock-slot">
            {/* EVERY ROW'S SLOT IS THE SAME BOX. Only Inspiration's and ↩'s were
                flex; Chat's was a bare inline span, so its two rules (1px wide,
                a fixed height) collapsed to nothing — founder, 2026-10-16:
                "for chats, you're missing the | | — the bottom bar should be
                identical for inspiration and chat." */}
            {/* THE WORD STAYS WHILE THE TOOLS ARRIVE. The tools used to take
                the plus's place; with the plus gone they ride beside the
                word — which on a new note says how many you have kept and
                opens them — and Close comes last. */}
            <button
              type="button"
              className={`waka-dock-item${item.here ? ' waka-dock-item--here' : ''}`}
              aria-current={item.here ? 'page' : undefined}
              aria-label={item.id === 'return' ? say('worldBack') : undefined}
              onClick={item.go}
            >
              {item.id === 'return'
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>
                  </svg>
                : making === 'inspiration' && item.id === 'inspiration'
                  ? say('worldBackToAll')
                  : making === 'talk' && item.id === 'talk'
                    ? say('worldAllChats')
                    : say(item.label)}
            </button>
            {/* ═══ THREE GROUPS, AND A RULE BETWEEN EACH ═══════════════════
                Founder, 2026-10-15: "the first item is always either ... all
                inspiration or all chat And then after that, let's have | And
                then for inspirations it would be the dictate button, the photo
                button, the save button and after that have another | and say
                close." So on a page you are making something on, the row reads
                where-you-came-from │ the making │ Close. The rules are drawn,
                not typed: a `|` character would be read aloud. */}
            {barOwner && item.id === barOwner ? <span className="waka-dock-sep" aria-hidden="true" /> : null}
            {/* ═══ THE BAR TRANSFORMS, IN THE ONE SLOT THAT SHOULD ═══════
                Founder: "when the user is in inspirations, maybe this
                bottom bar should transform so that the icons turn into the
                speech or the image or a file — but then still a quick way
                to access the navigation."

                BOTH HALVES, WHICH IS THE WHOLE DIFFICULTY. A bar that
                replaces itself wholesale costs a press to get the
                navigation back, and the loudest complaint of the same day
                was "I have to click now like four times to actually get
                there". So the four PLACES never move. What changes is the
                one slot that is not a place: the plus means "make
                something", and while you are already making something that
                slot is where the making happens.

                It also empties the bottom-left corner, which is where the
                tools used to float as a second object above the bar — the
                "double layer" in its last remaining form, and the corner
                the founder asked about twice.

                A CHAT DOES NOT GET THIS, and the reason is arithmetic
                rather than taste: a message field cannot fold into a 56px
                slot beside four labels, and giving the bar over to it
                entirely would put the navigation a press further away on
                the surface people have most often reported being stuck in.
                Its field already sits on the ground as a rule rather than
                a second pill, so there is no layer to remove there. */}
            {/* ═══ AND THE ARCHIVE'S OPEN NOTE BORROWS THE SAME SLOT ═══
                Founder: "the bottom bar should also change."

                EMPTY HERE, FILLED FROM THERE. The dock lends an element and
                `NoteTools` portals the recorder, the photo button and their
                one state line into it. The alternative — lifting the
                overlay's upload queue and open row into the world so this
                file could render them — would put a second copy of "which
                note is open" in the world, which is the duplicate-state
                problem this whole pass is removing.

                IT CANNOT COLLIDE WITH THE NOTEPAD'S. The composer is a
                full-page surface and the archive is another; `view.compose`
                and `view.open === 'saves'` are different addresses, so the
                two are never on screen together. The order of the branches
                says which wins if that ever stops being true. */}
            {item.id === 'return' && viewNavigation.view?.open === 'saves' && savedNoteOpen ? (
              <span className="waka-dock-making" role="group" id={DOCK_SLOT}
                aria-label={say('worldCaptureInspiration')} />
            ) : item.id === 'inspiration' && viewNavigation.view?.compose ? (
              <span className="waka-dock-making" role="group" aria-label={say('worldCaptureInspiration')}>
                {/* ═══ THE MICROPHONE SPEAKS INTO THE NOTE WHERE IT CAN ════
                    Founder: "is it not possible to do speech to text
                    easily, or is audio the only easy way to record?"

                    Easily, and it is the better default — `use-dictation.ts`
                    carries the reasoning, which comes down to this: a
                    spoken thought that lands as TEXT feeds the top of mind,
                    shows as a lead line in the archive and can be searched;
                    the same thought as a file does none of those things.

                    RECORDING IS NOT GONE AND IS NOT HIDDEN. Where the
                    browser cannot transcribe — Firefox — this slot is the
                    recorder, with no mention anywhere of a feature that
                    does not exist here. Where it can, the recorder is still
                    the right tool when the SOUND is the point (a melody,
                    somebody else talking) and it is one press away behind
                    the camera's own menu rather than a second glyph in a
                    slot that holds three things already. That is a trade
                    and it is the founder's to revisit; what is not a trade
                    is which one the bare microphone should do. */}
                {dictationAvailable() ? (
                  dictation.listening ? (
                    /* THE SAME SHAPE THE RECORDER'S STOP HAS: a word, not a
                       second glyph. "Speaking" with a press on it says both
                       what is happening and how to end it. */
                    <button type="button" className="waka-dock-tool waka-dock-tool--wide"
                      onClick={() => dictation.stop()}>{say('worldComposerDictateStop')}</button>
                  ) : (
                    <button type="button" className="waka-dock-tool"
                      aria-label={say('worldComposerDictate')}
                      disabled={!composerDraft.available}
                      /* THE PRESS CLEARS THE ANSWER TO THE LAST ACT, which
                         is what every other act on this page does —
                         typing, opening the notepad and saving all call
                         `setMouthNote('')`. It matters more here than
                         anywhere else: the line it clears would otherwise
                         outrank the cloud disclosure (see `composerState`),
                         so a stale complaint about a file was enough to
                         open the microphone with nothing said about where
                         the audio goes. Nothing true is lost — the marked
                         file is still marked on screen, and the next press
                         of Save says so again. */
                      onClick={() => { setMouthNote(''); dictation.start(); }}><HomeActionIcon kind="record"/></button>
                  )
                ) : supportedRecordingType() ? (
                  recording.phase === 'idle' ? (
                    <button type="button" className="waka-dock-tool"
                      aria-label={say(inputMedia.some(m => m.type === 'audio') ? 'worldComposerRecordAgain' : 'worldComposerRecord')}
                      disabled={!composerDraft.available}
                      onClick={() => void recording.start()}><HomeActionIcon kind="record"/></button>
                  ) : (
                    <>
                      {/* STOP KEEPS IT, CANCEL THROWS IT AWAY — both, because a
                          recording you can start and stop but not discard is
                          worse than one you cannot start. The clock is words
                          rather than a glyph for the reason the composer gave:
                          a red dot cannot say how long you have been talking. */}
                      <button type="button" className="waka-dock-tool waka-dock-tool--wide"
                        aria-label={say('worldComposerStop')}
                        disabled={recording.phase === 'finishing'}
                        onClick={() => void recording.stop()}>
                        {Math.floor(recording.seconds / 60)}:{String(recording.seconds % 60).padStart(2, '0')}
                      </button>
                      <button type="button" className="waka-dock-tool waka-dock-tool--wide"
                        disabled={recording.phase === 'finishing'}
                        onClick={() => void recording.cancel()}>
                        {say('worldComposerCancelRecording')}
                      </button>
                    </>
                  )
                ) : null}
                {/* ═══ THE PHOTO BECAME ＋ (2026-10-16) ═════════════════════
                    Founder: "the bar's PHOTO icon becomes ＋. Pressing ＋
                    opens a small pop-up menu with two rows: 'Add photo' and
                    'Add file'." So the row reads All inspirations │ dictate ·
                    ＋ · save │ Close, and a note can carry a PDF as readily
                    as a picture.

                    THE PHOTO ROW IS THE OLD BUTTON, UNCHANGED BEHIND IT:
                    `PHOTO_ACCEPT` at the chooser and `addInspirationFiles`
                    sniffing every file — as do the drop and the paste
                    handlers on the note, which never pass a chooser and so
                    never see an `accept` at all. The file row goes through
                    the same function by the 'file' door, where
                    `inspectAttachmentFile` is the lock instead. Both pickers
                    and their `accept` live in `AddMenu`, quoted from the
                    rules (`one-photo-accept-list.test.ts`). */}
                <AddMenu buttonClassName="waka-dock-tool" multiple
                  label={say('worldAddMenu')} photoLabel={say('worldAddPhoto')} fileLabel={say('worldAddFile')}
                  disabled={!composerDraft.available || recording.phase !== 'idle'}
                  onPhotos={files => { void addInspirationFiles(files); }}
                  onFiles={files => { void addInspirationFiles(files, 'file'); }} />

                {/* ═══ KEEPING IT IS A BAR ACTION NOW ═══════════════════════
                    Founder, with the pale pill in the bottom-right corner of
                    the note: "the save button is very hard to see. Maybe the
                    save button should be in the bottom bar as well. And then
                    it should have save or save as draft."

                    IT WAS HARD TO SEE BECAUSE IT WAS NOWHERE. A lone control
                    floating in the corner of an otherwise empty page has no
                    neighbour to be read against and no object to belong to —
                    and this product now has exactly one object at the bottom
                    of every screen. Putting it in the bar is not a relocation
                    for tidiness; it is the control finally having a place.

                    AND THE TWO ENDINGS SIT TOGETHER, which is the half the
                    founder asked for and the half that was genuinely missing.
                    Leaving a half-written note already kept it — `saveAsDraft`
                    is what Now and the chevron both call — but nothing on
                    screen ever said so, so the only visible way out of a note
                    you were not finished with was a button that finished it.
                    Named side by side, the choice is a choice.

                    ONLY ONCE THERE IS SOMETHING TO KEEP, which is the note
                    the floating button already carried: "an always-present
                    Save on a blank page is a button for a thing that does not
                    exist." A blank note still leaves by the chevron or by
                    Now. */}
                {/* ═══ OVERRULED: IT IS ALWAYS THERE, AND DIM UNTIL IT IS NOT ═
                    Founder: "when the user didn't make any change, then make
                    it lower opacity, like basically disable it. And then once
                    the user starts having changes, then make it clickable and
                    then clicking it would save it."

                    THE ARGUMENT ABOVE WAS GOOD AND IS STILL WRONG. "An
                    always-present Save on a blank page is a button for a
                    thing that does not exist" is true about the OBJECT and
                    false about the PERSON, and the person is who has to find
                    it. A control that appears is a control you have to
                    discover twice: once to learn it exists, and again to
                    learn what summons it — and the thing that summons this
                    one is typing, which is the act you are already doing and
                    therefore not looking at the bar during. A control that
                    DIMS is learned once. It is in the same place before and
                    after, so the only thing left to notice is that it got
                    brighter, and brightness is the one channel this product
                    uses for meaning anyway.

                    It also makes the blank page honest about what it is FOR.
                    The notepad with nothing on it now shows mic, photo and a
                    dim Save: three things you could do and one of them not
                    yet. Before, it showed two, and the page gave no sign that
                    keeping was even among the endings.

                    NOTHING ELSE MOVES. `composerCanKeep` already folds
                    `composerHasWords` in, so the empty note lands on exactly
                    the disabled state every other blocked reason produces
                    rather than a fourth appearance of its own — and
                    `whyNotKept` deliberately returns `null` for an empty
                    note, so the tooltip stays silent instead of complaining
                    that you have not written anything yet. Dim is the whole
                    message. See `.waka-dock-tool--keep:disabled` for why that
                    dim is an opacity and never an outline. */}
                {/* ═══ ONE MARK, NOT TWO WORDS ═══════════════════════════
                    Founder, with "Save as draft" and "Save" standing beside
                    each other in the bar: "this is so confusing. Save as
                    draft and save are... let's just have a save icon.
                    There's no save as draft. There's just a save icon."

                    THE PAIR WAS WRONG EVEN THOUGH BOTH WERE TRUE. Naming
                    the draft exit was meant as honesty — leaving already
                    keeps your words, and nothing said so — but putting it
                    beside Save turned an invisible safety net into a
                    DECISION, and a decision between two things that both
                    sound like saving. The founder read them as two kinds of
                    save, which is exactly what they look like.

                    SO THE NET GOES BACK TO BEING A NET. `saveAsDraft` is
                    still what Now and every other way out call, and the
                    words are still kept; it simply is not a button any
                    more. That is the reference's behaviour — Apple Notes
                    has no "save as draft" either — and it is what the
                    founder has asked for twice now under "only the most
                    absolutely necessary things should be shown".

                    A GLYPH, BESIDE TWO GLYPHS. The bar's middle slot is
                    the mic and the photo; a word between them was the odd
                    one out, and "Save" at 12px in a filled pill was wider
                    than both of them together. The name stays on the
                    `aria-label`, where it is read in full. */}
                <button type="button" className="waka-dock-tool waka-dock-tool--keep"
                  aria-label={say('worldSaveInspiration')}
                  /* AND IT SAYS WHY IT CANNOT BE PRESSED, the same way the
                     chat's Send does and for the reason written there: the
                     reason belongs to the control, and is wanted only by
                     somebody who has just tried. */
                  title={whyNotKeeping ? say(whyNotKeeping) : undefined}
                  disabled={!composerCanKeep}
                  onClick={() => { void keepIt(); }}><HomeActionIcon kind="keep"/></button>

                {/* ═══ AND THE TRANSIENT STATE, IN THE BAR AND NOWHERE ELSE ══
                    Founder, with "Recording canceled." printed across the
                    middle of an empty note: "states should show and disappear
                    in the bottom bar only."

                    The rule is sharper than the instance. A sentence that
                    arrives and leaves on its own is the one kind of text that
                    must not be in the page's flow: it pushes whatever is
                    under it, it appears in the part of the screen somebody is
                    reading or writing in, and when it goes it leaves a hole
                    the eye has to re-find its place in. The bar is where
                    transient things belong because the bar is already the
                    thing that changes — it has a slot that transforms, it is
                    out of the way of the words, and it is the same place on
                    every screen.

                    `role="status"` so it is still announced; it is the
                    position that changed, not whether it is said. */}
                {composerState ? (
                  <span className="waka-dock-state" role="status">{composerState}</span>
                ) : null}
              </span>
            ) : item.id === 'talk' && making === 'talk' ? (
              /* ═══ AND A CHAT'S TOOLS COME INTO THE BAR TOO (2026-10-16) ═══
                 Founder: "bar becomes All chats │ dictate · ＋ │ Close. The
                 dictate button and ＋ move OUT of the chat box INTO the bar's
                 middle group (the box keeps the text field and Send)."

                 THE SAME LOAN THE ARCHIVE'S NOTE TAKES. The draft, the
                 microphone and the uploads all belong to `ConversationPanel`
                 — lifting them here would put a second copy of the unsent
                 message in the world — so the bar lends an empty group and
                 the panel portals its two tools into it, as `NoteTools` does
                 for an open saved note. What the earlier note about "a chat
                 does not get this" was refusing still holds: the FIELD does
                 not come into the bar, and that was the arithmetic. Two
                 glyphs fit where two glyphs already sit on a note. */
              <span className="waka-dock-making" role="group" id={CHAT_TOOLS_SLOT}
                aria-label={say('worldConversationMessage')} />
            ) : null}
            {/* CLOSE, LAST IN THE ROW, on the page you are making something
                on: back to the main screen, the note kept as a draft. A chat
                has its middle group again since 2026-10-16 — the mic and the
                ＋, lent to the panel (above) — so it reads All chats │ tools
                │ Close like a note does. */}
            {barOwner && item.id === barOwner && (making !== null || (viewNavigation.view?.open === 'saves' && savedNoteOpen)) ? <span className="waka-dock-sep" aria-hidden="true" /> : null}
            {barOwner && item.id === barOwner ? (
              <button type="button" className="waka-dock-item waka-dock-item--close"
                onClick={() => leaveAsModal(making === 'inspiration' ? saveAsDraft : () => { commitOpenNote(); openOverHome(null); })}>
                {say('worldClose')}
              </button>
            ) : null}
            </span>
          ))}
        </nav>
      ) : null}
      {phase==='ready'?<Menu locale={locale} items={[]} current={menu.current}
        /* THE CORNER IS CHAT, AND THE FORM SWITCH IS ON THE CREATURE.
           Founder: "I kind of want to give the feeling of, rather than my
           agent moving rooms, it kind of switches itself up to its agent
           form."
           That is the better model and the canvas already believed it: the
           change of form is a DISSOLVE, not a cut, and the aura is
           deliberately never pixelated because "its colour temperature is one
           of the two invariants that say this is still the same companion."
           The decision was already made in the drawing and contradicted by
           the navigation — a corner toggle says these are two PLACES, while
           the creature changing form says this is one companion with two
           faces, which is what one account with two profiles actually is.
           So the switch moved onto the creature, where the identity already
           lives, and the corner went to chat — which genuinely is a
           destination, because it has a list of past conversations behind
           it and nowhere else to be reached from. */
        /* CHAT HISTORY, BACK IN THE CORNER. Founder: "top left button should
           be chat history since moving between inspirations, top of mind,
           principles is done with the middle center dropdown." Conversations
           are a history rather than a depth of your own material, which is
           why they never sat among the three and why this corner is where
           they belong. */
        /* ═══ AND ON A SURFACE WITH NO OWNER, NEITHER FACE IS LIT ═══════
           Founder: "When user clicks on chat, don't select any of me nor my
           agent because here it doesn't matter — what's selected. For
           inspirations it does, for now it does, but for chats it doesn't,
           so don't select anything."

           `wallAgnosticView` holds which surfaces those are and the whole
           argument for it, including the check that chats really are
           unscoped in practice rather than only in feel. What is worth
           saying HERE is the part that is about this markup: WHERE YOU ARE
           STANDING AND WHICH FACE IS LIT STOP BEING ONE FACT.

           They were the same boolean, used for two jobs — the appearance and
           the decision not to travel — and separating them is the whole
           change. `here` still answers "is the creature already wearing this
           form", so pressing the face you are already on still does nothing;
           a single boolean would have made a press on "Me" while on Me fire
           `goToWall(0)` and move a camera nobody asked to move. `lit` is
           allowed to say nothing on a page where whose-material is not a
           question being asked. */
        left={agentWall ? (
              <span className="jar-char-form" role="group" aria-label={say('worldWallMyAgent')}>
                {([null, agentWall] as const).map(wall => {
                  const here = wall ? atWall.kind === 'agent' : atWall.kind !== 'agent';
                  const lit = here && !wallAgnosticView(viewNavigation.view);
                  return (
                    <button
                      key={wall ? wall.id : 'me'}
                      type="button"
                      className={`jar-char-face jar-label${lit ? ' jar-char-face--standing' : ''}`}
                      aria-pressed={lit}
                      /* NO CROSSING. The creature changes form where it is
                         standing; it does not walk to another column to do
                         it. Founder: "rather than my agent like moving rooms
                         it kind of like switching itself up to its agent
                         form" — and, three times, "the character shouldn't
                         move left It should move right", which stops being a
                         question the moment nothing slides either way. */
                      onClick={() => { if (!here) simApiRef.current?.goToWall(wall ? wall.col : 0, true); }}
                    >
                      {say(wall ? 'worldWallMyAgent' : 'worldWallMe')}
                    </button>
                  );
                })}
              </span>
            ) : null}
        account={auth?.account ? { name: auth.profile?.name, email: auth.account.email } : null}
        settings={settingsCard}
        onSignOut={auth ? () => { void auth.logout(); } : undefined}
        /* AND HIDDEN WHILE A SAVED NOTE IS OPEN, which `mouthOpen` already
           does for a new one. Founder: "it should go to the same exact UI
           as when I'm creating a new inspiration." A note is a page you are
           writing on; the two corners are the world's furniture and the
           notepad has never shown them. It also returns the 60px the
           archive reserves for them — see `.waka-page--note`. */
        hidden={Boolean(panelOpen||mouthOpen||savedNoteOpen||seek!==null||viewNavigation.view?.conversationId||viewNavigation.view?.sharePrinciple||thingShare)}/>:null}
      {seek !== null ? (
        <InspirationSearch profileId={atWall.kind === 'agent' ? atWall.id : storageScope?.profileId ?? viewerIdRef.current ?? 'fixture'}
          /* the label said "find YOUR inspirations" on a room's wall, where
             the search still only ever reached your own archive and the
             surrounding ground was other people's. One wall kind, one
             meaning, no label. */
          query={seek} locale={locale}
          onQuery={setSeek} onClose={() => setSeek(null)} onPick={openSearchResult} />
      ) : null}
      {storageScope&&viewNavigation.view?.principleId&&viewNavigation.view.sharePrinciple?<PrincipleShare
        key={`${storageScope.accountId}:${storageScope.profileId}:${viewNavigation.view.principleId}`} scope={storageScope}
        id={viewNavigation.view.principleId} name={auth?.profile?.name??''} locale={locale} onClose={viewNavigation.closeShare}
        onChoose={id=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:id,sharePrinciple:true},{replace:true})}/>:null}
      {thingShare ? (
        <ShareSheet target={thingShare} name={auth?.profile?.name ?? ''} locale={locale} onClose={() => setThingShare(null)} />
      ) : null}

      {/* THE THREE THINGS YOU HOLD UP IN FRONT OF THE WORLD.
          Founder: "for your inspirations, after I click on it, I feel like
          I'm lost how to go back to the previous screen, and I didn't realise
          clicking on top of mind would leave me there. So maybe for your
          inspirations, this should just be a modal that you can escape to go
          back to your top of mind."

          ALL THREE, NOT JUST THE ONE THAT WAS COMPLAINED ABOUT. The archive
          was the surface the founder got lost on, but the principles and the
          conversations were the same machine with the same bug — reaching any
          of them unmounted the world, and once the world is gone there is
          nothing to return TO, only somewhere else to navigate. Fixing the
          one that was noticed would have left two that had not been noticed
          yet, which is how this product accumulated the problem in the first
          place.

          THEY NAME THEMSELVES, and they name WHOSE. The world behind is
          showing somebody's top of mind, and an unlabelled grid floating over
          an unrelated statement would be a second anonymous surface. The
          title follows the wall rather than the stored stance, so it cannot
          disagree with the world it is covering. */}
      {/* ═══ THE READING PAGE IS GONE, AND THE BUBBLE IS WHY ═══════════
          It was reached from exactly one place: pressing the top of mind in
          the creature's bubble, under "the user can click on it to go to a
          new page where the user can engage with it". That press opens a
          CONVERSATION now — founder: "even when user clicks on a top of
          mind, it should open up a chat" — which is that sentence answered
          better, because a chat is where engaging actually happens.

          So the page had no door left. A surface nobody can reach is not a
          feature in reserve, it is a thing that still compiles, still gets
          read by whoever opens this file, and still has to be kept working
          by everyone who changes the data under it. `?open=reading` goes
          out of `ViewOpen` with it, so an old link fails honestly rather
          than resolving to a blank world.

          WHAT WENT WITH IT: `ReadingPage`, its provenance list, and the
          copy that only it printed. `ReadingPanel` outlived it by a few
          weeks and is gone too, along with `AntechamberPanel` and
          `DuplicatesPanel` and their API clients — see
          `HowItWorksPanel.tsx`, which names all three. Nothing in this file
          reaches any of them; this paragraph is the pointer for anyone
          following an old reference here. */}
      {storageScope&&viewNavigation.view?.open==='saves'?<SavesOverlay
        onNoteOpen={savedNoteChanged}
        key={`${storageScope.accountId}:${atWall.kind==='agent'?atWall.id:storageScope.profileId}:saves`}
        locale={locale} profileId={atWall.kind==='agent'?atWall.id:storageScope.profileId}
        ownArchive={atWall.kind!=='agent'} shareName={auth?.profile?.name ?? ''}
        title={say(atWall.kind==='agent'?'worldAgentField':'worldMenuField')}
        focus={savesFocus} onClearFocus={() => setSavesFocus(null)}
        /* THE SWITCH IS IN THE CORNER, AND IT ALWAYS WAS. Founder: "if the
           user changes it in the modal, then the page behind it should also
           change." Still exactly what happens — `ME / MY AGENT` in the
           top-left writes the address and every surface re-reads the owner
           from it. What this overlay no longer carries is a SECOND pair of
           buttons saying the same two words, which stood here while the
           corner's pair stood behind this sheet's own left edge, clipped to
           "MY AGE". The act survives; the duplicate does not. */
        onClose={leaveOpen}/>:null}
      {/* THE QUEUE, where answering eight in a row is a different activity
          from being asked one. The creature keeps asking its single claim on
          the home screen — that is the product's character and it stays — and
          this is where a person goes to sit down and work through them. See
          `ClaimsOverlay` for why this rung needed a door.

          `sayVerdict` is passed down rather than reimplemented: a verdict is
          filed by whoever is standing here, and a second writer could
          disagree with the world about who that is. */}
      {storageScope&&viewNavigation.view?.open==='claims'?<ClaimsOverlay
        key={`${storageScope.accountId}:${storageScope.profileId}:claims`}
        locale={locale}
        onClose={leaveOpen}
        answered={verdicts}
        /* THE ROOM HANDS A CLAIM TO THE CREATURE; IT NEVER ANSWERS ONE.
           Founder: "your claims are duplicated so that's like even bad." The
           rule every shipping product follows is that a queue has exactly one
           surface where an item is answerable, and other surfaces may only
           advertise that it exists — GitHub's badge carries no item content,
           Anki never renders a card on the deck screen. So pressing a row
           here moves that claim to the front of the creature's queue and
           closes the room, which makes the duplication impossible rather than
           merely discouraged. */
        onAsk={id=>{
          setClaimQueue(queue=>{
            const picked=queue.find(claim=>claim.id===id);
            return picked?[picked,...queue.filter(claim=>claim.id!==id)]:queue;
          });
          leaveOpen();
        }}/>:null}
      {storageScope&&(principlesOpen||walkingHome)?<PrinciplesOverlay
        key={`${storageScope.accountId}:${atWall.kind==='agent'?atWall.id:storageScope.profileId}:principles`}
        locale={locale} profileId={atWall.kind==='agent'?atWall.id:storageScope.profileId}
        name={atWall.kind==='agent'?atWall.name:auth?.profile?.name??''}
        title={say(atWall.kind==='agent'?'worldAgentPrinciples':'worldPrinciplesShortcut')}
        whose={atWall.kind==='agent'?'agent':'own'}
        onClose={leaveOpen}
        /* Opening one REPLACES the overlay rather than stacking on it: the
           principle's own surface is the next thing to read, not a sheet on
           top of a sheet, and `closeOpen` would otherwise have to know which
           of two things it was closing. */
        onOpen={id=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:id})}
        /* STRAIGHT TO THE ARTIFACT, skipping the principle's own surface.
           The card already shows what would be shared; the share surface is
           the larger version of that same card. Routing through the
           principle page first made a person confirm a choice they had
           already made by pressing share. */
        onShare={id=>viewNavigation.write({...EMPTY_VIEW,section:'sky',principleId:id,sharePrinciple:true})}
        /* What the creature said on the waiting page, talked about. */
        /* NOT ON AN AGENT'S WALL (review, 2026-10-16): talkAbout posts the
           creature's line as YOUR first message, and on an agent's ground that
           line is about the agent — the defect the agent wall fixed by
           removing its own act. */
        onChat={atWall.kind==='agent'?undefined:said => { void talkAbout({ id: '', text: said }); }}
        crossing={principlesCrossing}
        onCrossed={() => setPrinciplesCrossing(null)}/>:null}
      {/* ═══ CHATS DO NOT HAVE AN OWNER THE WAY AN ARCHIVE DOES ══════════
          Founder: "I don't think there should be a difference between me and
          my agent's chat. Inspiration, sure. But I don't see a reason why
          that should change."

          Right, and the split was not only unmotivated, it was incoherent:
          this LIST was scoped to whichever wall you were standing on while
          `ConversationPanel` below has always taken `storageScope` — the
          account's own profile. So standing on an agent's wall showed you a
          list of its conversations and then opened them under yours. Two
          answers to "whose talk is this" on one path.

          An archive genuinely has two owners — your material is yours and
          its material is its own, which is why saving on an agent's wall is
          refused outright. A conversation is with WAKA, and changing which
          face it is wearing is not a change of who is talking. One list, one
          scope, matching the panel that was already right. */}
      {storageScope&&viewNavigation.view?.open==='conversations'?<ConversationsOverlay
        key={`${storageScope.accountId}:${storageScope.profileId}:talks`}
        locale={locale} profileId={storageScope.profileId}
        title={say('worldOpenConversations')}
        onClose={leaveOpen}
        onOpen={id=>openTalk(id)}/>:null}

      {/* THE CONVERSATION ITSELF, ALSO OVER THE WORLD.
          Founder: "also dont move talk to waka in a new page. find better
          transition." And, of the page it used to be: "the most confusing
          chat experience ever with so many different buttons that I have no
          idea what its supposed to do."

          Both sentences were about the same screen and only one of them was
          about buttons. The controls were cut back to a transcript and a box;
          this is the other half. A conversation was the last surface in the
          product that still replaced the world, and it replaced it hardest —
          its own page, its own chrome, its own corners, its own idea of where
          you were standing. Every complaint about not being able to get back
          was loudest there for that reason.

          AND IT IS WHY THE ONE-PRESS RETURN CAN STOP BEING A CONTROL. That
          control existed to undo a navigation, it was built three times, and
          this morning it was a button that rendered, read "Your top of mind",
          and did nothing — because it found its destination by matching a
          string that had been renamed under it. An overlay cannot have that
          bug: leaving is dismissal, the world is still behind, and there is
          no destination to look up. The visible close below is the whole
          mechanism. */}
      {storageScope&&viewNavigation.view?.conversationId?(()=>{
        const talkId=viewNavigation.view.conversationId==='new'?null:viewNavigation.view.conversationId;
        const owner=`${storageScope.accountId}:${storageScope.profileId}`;
        if(committedTalk.current&&(committedTalk.current.owner!==owner||committedTalk.current.row.id!==talkId))committedTalk.current=null;
        return <div className="waka-page">
          {/* THE BAR IS THIS SURFACE'S WAY OUT, SAID IN THE MARKUP.
              `way-out.test.ts` reads this attribute: a conversation has no
              control of its own that leaves, and it does not need one —
              the dock's "Chats" row goes to the list this came from, in a
              word rather than a glyph. The attribute is on the surface and
              not in a list keyed by file, because `Home.tsx` renders five
              surfaces and four of them must stay answerable to the law. */}
          {/* AND SO IT IS NOT A DIALOG EITHER — `modal={false}`.
              `data-way-out="talk"` above is a CLAIM that the bar is this
              surface's exit, and a Tab trap made the claim false for anybody
              working from the keyboard: Tab wrapped back into the transcript
              instead of reaching the "Chats" row the attribute points at, and
              `aria-modal` told a reader that row was not on the screen. The
              attribute and the prop are the same statement said twice, once
              for the gate and once for the browser; they have to agree.

              It is the fifth of the five and the one the founder reported
              being trapped in — "I find it so annoying that from talk with
              Waka, there's no one click to go back to top of mind" — so it is
              the last surface that should have been holding focus.

              IT IS ALSO WHY THE PAGE IS A `<section>` AND NOT A `<main>`:
              `ConversationPanel` renders its own `<main className="chat-page">`
              inside this, and a `<main>` in a `<main>` is two primary
              landmarks. See `DialogSurface`'s header. */}
          <DialogSurface className="waka-over waka-over--talk" motion="modal" aria-label={say('worldMenuTalk')}
            data-way-out="talk"
            modal={false}
            onClose={viewNavigation.closeConversation}>
            {/* ═══ THE WAY BACK TO THE LIST, which this surface was the one
                place in the product not to have ═══════════════════════════
                Founder: "chat and inspirations should have same look and
                feel and workflow and experience."

                Measured, an open inspiration had THREE ways out — a chevron
                reading "All inspirations", a ✕, and a "Close" in its own
                foot — and an open chat had ONE, which went to the world
                rather than to the chats it came from. So the only surface in
                the product you could not step back out of was the one the
                founder has reported being lost in most. The two are now the
                same pair: a chevron to the list, and a ✕ to the world.

                AND THE TITLE SAID A FOURTH NAME. The bar says "Chats", the
                list says "Your chats", and this said "Talk with WAKA" —
                three names for one place, which is the thing Law 1 is about
                before it is about verbs. The chevron names the place it
                returns to, the way the archive's does, and nothing else on
                the surface claims to name it. */}
              {/* ═══ AND THE CHAT'S CHEVRON GOES THE SAME WAY ═══════════
                  Founder, of the notepad's: "I still don't get why you have
                  this carrot button when I do new inspiration, because I
                  can just go to all the inspirations using the bottom
                  panel. So don't do that."

                  LAW 7: a ruling applies to the class. That sentence is
                  about a glyph pointing at a room the dock already names in
                  a word, and this is the same glyph pointing at a different
                  one — the bar's "Chats" row goes exactly where this went.
                  Fixing it only on the reported screen is what made
                  `six-laws.md` necessary; this is the second screen.

                  THE HEADER GOES WITH IT, because the chevron was all it
                  held. An empty header above a conversation would be a
                  reserved row for nothing. */}
            <ConversationPanel key={`${owner}:${talkId??'new'}:${viewNavigation.view.principleId??''}`}
              scope={storageScope} id={talkId}
              initialPrincipleId={!talkId&&viewNavigation.view.principleId?viewNavigation.view.principleId:undefined}
              initialConversation={committedTalk.current?.row} locale={locale}
              agent={agentWall ? { id: agentWall.id, name: agentWall.name } : null}
              /* The bar's middle group, lent for the mic and the ＋. */
              toolsSlot={CHAT_TOOLS_SLOT}
              onCreated={row=>{if(row.profileId===storageScope.profileId)committedTalk.current={owner,row};}}
              /* `replace` on the new-to-id hop so dismissing does not land
                 back on the blank conversation you just started. */
              onChoose={next=>{if(next!==talkId)viewNavigation.write({...EMPTY_VIEW,conversationId:next??'new'},{replace:!talkId&&Boolean(next)});}}/>
          </DialogSurface>
        </div>;
      })():null}

      {/* ═══ THE ROOM, AND EVERY WAY INTO ONE, IS GONE ═══════════════════
          Founder, 2026-10-12: "방 없애" — remove rooms.

          THREE SURFACES STOOD HERE and they went together because they were
          one capability wearing three faces. `GroupPanel` — who is in the
          room, the whole-room stance row, propose / affirm / decline /
          counter, and the room-so-far history. The make-or-join sheet, which
          was already a tombstone here: nothing ever opened it, so the only
          way to reach it was to be in it. And the JOIN SHEET, which was the
          last live door — `?join=<code>` set `pendingJoin`, this rendered
          "Someone invited you", and one press put your name on a roll.

          WHY JOINING WENT TOO, which is the part that needs the argument.
          Joining worked. It was measured working on 2026-10-12 at 16:09 PDT
          against a signed-in account, and it survived the signed-out case as
          well — `RequireAuth` kept the query in `state.from`, so a stranger
          with a link signed up, onboarded, and landed on the sheet with the
          code intact. That was the whole problem. The audit established that
          `.jar-here-list`, deleted on 2026-10-09, had been at once the only
          list of your rooms AND the only opener of `SpaceSettings` — leave,
          rename, remove a member, close, copy the invite. Creating a room had
          gone before that. So the one door left was INWARD: a room you could
          be let into by a link somebody made before the cut, and then never
          leave, never invite into, never close. There is no point joining a
          room you cannot leave, so the door closed rather than the exits
          being rebuilt. The founder was shown both options and chose this.

          WHAT A REVIVAL WOULD COST, said plainly so nobody assumes it is a
          revert: the client for `/api/groups` is three types with no verbs,
          the nine route files behind them are gone, and the five tables they
          wrote are still in the database holding what people actually said in
          rooms. Rooms come back as a feature with exits, or not at all. */}

      {/* THE ACCOUNT, DROPPED. The mirror of the space settings on the left,
          and deliberately the same object: same panel, same flat register,
          anchored to the pill that opened it.

          What is IN it is only what belongs to the account rather than to a
          space — who you are signed in as, the way to the screen that can
          change it, and the way out. It does not reimplement the account
          screen: renaming a profile, language, sessions and deletion need
          focus traps and text that reflows at 200%, and that is what
          `/profile` is for. This is the door and the label on it. */}
      {/* THE ACCOUNT SHEET THAT STOOD HERE IS GONE.
          The gear opened it on this screen and navigated to /profile on every
          other one — the same corner meaning two different things depending
          on where you were standing, which is the exact objection the founder
          raised about the hamburger ("why is the hamburger menu changing
          depending on what screen I'm in?"). A corner cannot be the answer to
          "where is settings" while also being a different answer here.

          So the gear navigates, everywhere, and this sheet's contents were
          already at the place it navigates to: the name, the address, and
          signing out. The three panels it also opened — how it reads you, the
          antechamber, the gardener's question — went with it. They are
          diagnostics, not settings, and they were living behind a gear
          because a gear was the nearest unlocked door. */}
      {/* ═══ `SpaceSettings` IS GONE, AND IT COULD NEVER MOUNT ═══════════
          481 lines: a room's roll, its invite link, rename, leave, close,
          remove-a-member, and an agent's credentials. Its one JSX site stood
          here, gated on `settingsFor === spaceKey(atWall)` — and this is not
          a grep, it is a closed set: `settingsFor` initialised to `null` and
          had exactly three writers, all three writing `null`. `spaceKey()`
          returns `${kind}:${id}` and never the empty string, so that equality
          was false for the lifetime of the page. The opener was a per-row cog
          on the `.jar-here-list` wall picker, deleted on 2026-10-09 in the
          same commit that removed the only list of your rooms.

          SO DELETING IT TAKES NOTHING AWAY — it stops the code pretending six
          capabilities are there. What went with it from this file: the
          `settingsFor` state and its dismiss wiring, the agent-keys fetch
          effect and the forget-the-secret effect (neither could ever fire),
          `issueKey`, `revokeKey`, `agentKeys` / `minted` / `revoking` /
          `keysBusy`, `renaming`, `leaving` / `closing` / `removing`,
          `groupTrouble`, `leaveThisGroup`, `renameThisGroup`,
          `closeThisGroup`, `removeMember`, `copied` / `copyInvite`, and the
          `GroupVerb` / `GroupTrouble` types the panel declared. The agent-key
          half was already defanged two commits earlier — minting stopped on
          sight of the same proof — so what is lost there is a listing of
          credentials nothing creates any more.

          THE SERVER IS NOT TOUCHED HERE. `POST`, `GET` and `DELETE
          /agent-keys` all stand, and `lib/middleware.ts` still accepts those
          keys. If an agent becomes reachable from outside again, the listing
          comes back WITH the minting, on the same day, which is the lesson
          the audit actually taught. */}


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
