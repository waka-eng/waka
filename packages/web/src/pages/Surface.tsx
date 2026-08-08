/**
 * The surface.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS AND `Home.tsx` STILL DOES TOO
 *
 * Home is 6,300 lines in which data-fetching and rendering are interleaved,
 * and its shape is five stacked overlays: a 460px history panel, a draggable
 * memory-window layer, the capture modal, the room panel and the drop
 * overlay -- 26 `position: fixed` rules reaching z-index 1000. Each was
 * reasonable alone. Together they are why the product feels like parts.
 *
 * Restyling that shape can never produce the redesign, which is the lesson of
 * several failed attempts: the type, colour and motion system landed cleanly
 * and the app still looked identical, because composition is not a style.
 *
 * So this is the composition, written from scratch:
 *
 *   ONE SURFACE. Nothing navigates. Opening a reading does not take you
 *   anywhere -- the wall recedes in place and the claim comes forward in the
 *   same box. Capture, looking, rooms and time are STATES of this space, not
 *   places you visit. The room's name never moves, because it is where you
 *   are.
 *
 * State is a single machine rather than five independent open/closed flags,
 * which is what makes "the wall recedes and the thing comes forward" one
 * attribute on one element instead of a fight between z-indexes.
 *
 * Home stays routed at /classic until this replaces it outright, so nothing
 * that works today is lost while the shape is being judged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useLocation, useNavigate } from "react-router-dom";
/*
  Four icons, imported one at a time so the bundler takes four and not the set.

  `Users` rather than `Globe` for public, deliberately. A globe means the
  internet, and this flag does not reach the internet — it reaches the rooms
  you are in. The copy is careful about that distinction, and an icon that
  contradicted it would be believed over the words.
*/
import { Check, Info, Lock, Paperclip, Users } from "lucide-react";

import { contributorColor, contributorInitials } from "../components/faces";
import { OrbitBoard } from "../components/OrbitBoard";
import { useAuth } from "../lib/auth-context";
import {
  readStoredLocale,
  supportedLocales,
  writeStoredLocale,
  type SupportedLocale,
} from "../lib/i18n";
import {
  createInspiration,
  createFeedback,
  addGroupDirectionContribution,
  dismissTopOfMindNote,
  createGroup,
  deleteGroup,
  createReflection,
  fetchGroupTopOfMind,
  fetchGroupDirection,
  fetchGroupReadingStatus,
  fetchGroups,
  fetchReflections,
  fetchRoomTimeline,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchSignalReadings,
  deleteInspiration,
  finalizeAttachment,
  setInspirationSharing,
  presignAttachment,
  uploadToPresignedUrl,
  deleteReflection,
  recordInspirationRevisit,
  requestGroupReadingRefresh,
  respondToGroupDirectionProposal,
  refreshTopOfMind,
  restoreTopOfMindNote,
  setTopOfMindNotePinned,
  updateInspiration,
  joinGroup,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  fetchTopOfMindNotes,
  fetchTopOfMindStatus,
  generateGuidedReflectionQuestion,
  updateTopOfMindNote,
  type ApiGroupMemberSummary,
  type ApiGroupSummary,
  type ApiGroupTopOfMindNote,
  type ApiGroupDirection,
  type ApiGroupReadingGenerationStatus,
  type ApiReflection,
  type ApiRoomTimeline,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiSignalReading,
  type InspirationRevisitEventType,
  type ApiTopOfMindNoteSurface,
  type ApiTopOfMindGenerationStatus,
} from "../lib/api";
import {
  buildSurfacePath,
  parseSurfacePath,
  resolveSurfaceRoom,
  type SurfaceRoomId,
  type SurfaceView,
} from "../lib/surface-route";

/**
 * The states of the one surface.
 *
 * `wall` is home. Everything else is something happening in front of it, and
 * the wall is still there behind -- receded, never replaced.
 */
interface SurfaceNavigationOptions {
  roomId?: SurfaceRoomId;
  entityId?: string | null;
  replace?: boolean;
}

/**
 * A reading, flattened out of the two shapes the API returns for it.
 *
 * The solo and group endpoints disagree about the shape of a note -- group
 * notes carry an author and group-scoped evidence previews, solo notes do
 * not -- and every surface downstream should not have to care which it got.
 */
interface Reading {
  id: string;
  title: string | null;
  text: string;
  scope: "solo" | "group";
  isPinned: boolean;
  hands: string[];
  evidence: {
    id: string;
    text: string;
    quote: string | null;
    author: string | null;
    ownerUserId: string | null;
  }[];
  createdAt: string | null;
}

/**
 * Full signal detail belongs to the owner. A room member receives the shared
 * excerpt that grounded the room reading, but must never probe another
 * member's owner-only signal endpoint just because the two signals were cited
 * together.
 */
export function canLoadFullSignal(
  scope: "solo" | "group",
  ownerUserId: string | null,
  viewerUserId: string | undefined,
): boolean {
  return scope === "solo" || Boolean(viewerUserId && ownerUserId === viewerUserId);
}

function readingFromGroupNote(note: ApiGroupTopOfMindNote): Reading {
  const evidence = (note.evidencePreviews ?? []).map((preview) => ({
    id: preview.signalId,
    text: preview.textPreview ?? "",
    quote: preview.quote ?? null,
    author: preview.authorName ?? null,
    ownerUserId: preview.authorUserId ?? null,
  }));
  return {
    id: note.id,
    title: note.title?.trim() || null,
    scope: "group",
    isPinned: false,
    // `body` is the sentence the judge wrote; `title` is its short label. The
    // sentence is what belongs on a post-it -- the label reads as a heading
    // for something that is not there.
    text: note.body?.trim() || note.title || "",
    hands: Array.from(
      new Set(evidence.map((e) => e.author).filter((a): a is string => Boolean(a?.trim()))),
    ),
    evidence,
    createdAt: note.createdAt ?? null,
  };
}

function readingFromSoloNote(note: ApiTopOfMindNoteSurface): Reading {
  const evidence = (note.evidencePreviews ?? []).map((preview) => ({
    id: preview.signalId,
    text: preview.textPreview ?? "",
    quote: preview.quote ?? null,
    author: null,
    ownerUserId: null,
  }));
  return {
    id: note.id,
    title: note.title?.trim() || null,
    scope: "solo",
    isPinned: note.isPinned,
    text: note.body?.trim() || note.title || "",
    // Your own wall has no other hands on it, and stamping "you" on every
    // reading is noise.
    hands: [],
    evidence,
    createdAt: note.createdAt ?? null,
  };
}

/**
 * Light up the words a reading rested on, inside the save they came from.
 *
 * Whitespace-tolerant because the stored quote came back through a model and
 * a database round-trip, and a single collapsed newline should not lose the
 * mark. If the quote no longer appears -- the save was edited, enrichment was
 * appended -- the text renders unmarked rather than marking the wrong words.
 * A missing highlight is honest; a wrong one attributes words to a person who
 * did not write them.
 */
/* The judge is asked for a span, not a paragraph, and the server caps what it
   stores — but this builds a RegExp out of whatever arrives, so it enforces its
   own ceiling rather than trusting the field it was handed. */
const MAX_QUOTE_CHARS = 400;

export function markQuote(text: string, quote: string | null): JSX.Element {
  if (!quote) return <>{text}</>;
  const trimmed = quote.trim();
  if (trimmed.length < 12 || trimmed.length > MAX_QUOTE_CHARS) return <>{text}</>;
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = new RegExp(pattern, "i").exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      {text.slice(0, match.index)}
      <mark className="sf-mark">{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

/**
 * Show the part that mattered, not the whole article.
 *
 * A linked save carries the entire fetched page — one of these is over three
 * thousand words — and printing all of it under a one-sentence claim buries
 * the thing you came to check. So the text is cut to a window AROUND the
 * marked quote, which is the only part the reading actually rested on.
 *
 * Without a quote there is nothing to centre on, so it falls back to the
 * opening, which is at least where the person started writing.
 */
/**
 * Pasted material arrives with its own line breaks, and `white-space: pre-wrap`
 * honours every one of them -- so a post copied from Instagram renders as
 * fifteen one-line paragraphs at 1.68 leading and reads as broken.
 *
 * Single newlines inside a run of prose are the source's wrapping, not the
 * writer's intent; blank lines are. So: split on blank lines, join the rest.
 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/*
 * A CITATION HAS TWO STATES AND NOTHING IN BETWEEN.
 *
 *   collapsed  the words the reading rested on, and only those
 *   expanded   the whole save, with those words marked inside it
 *
 * Everything else has been tried and each attempt had the same fault: the
 * collapsed body was derived from text that arrives ASYNCHRONOUSLY, so the
 * block rendered at one size, the detail fetch landed, and it grew — the
 * citation expanded itself while you were reading it.
 *
 * The quote ships with the note, so it is there on the first paint and never
 * changes. That is what makes this stable: collapsed depends on nothing that
 * has to load.
 *
 * Collapsed is deliberately NOT marked. The mark exists to find these words
 * inside a wall of text; when they are the only words on screen it says
 * nothing, and a solid accent across every line is where a highlight stops
 * being a highlight. It appears on expand, where it does its job.
 */

/** Today, yesterday, or a date./*
 * Restored verbatim from the shipped wall, because it was right and I replaced
 * it with something that collapsed.
 *
 * Each note gets its own TILT AND ITS OWN WIDTH. Combined with the grid's
 * `max-content` columns that is what makes a wall look like paper stuck up by
 * a person rather than a table of cards: the sheets are different sizes and
 * none of them are square to the wall.
 */
const NOTE_LAYOUTS: Array<{ tilt: number; w: string }> = [
  // Scaled down from the shipped 420/292/300/292/312. At the original size
  // four sheets filled the screen, and a wall you cannot see all of is not
  // doing the one thing a wall is for. The ratios between them are kept, so
  // the sheets still read as different pieces of paper.
  { tilt: -1.4, w: "340px" },
  { tilt: -2.2, w: "246px" },
  { tilt: 1.8, w: "252px" },
  { tilt: 1.2, w: "246px" },
  { tilt: -0.8, w: "262px" },
];

/*
 * Paper and ink, in pairs. The ink is coloured too -- warm brown, maroon,
 * moss, slate -- which is most of why these read as paper and not as tinted
 * rectangles, and which I missed twice.
 *
 * Keyed by POSITION, deliberately, having tried the alternative. Keying paper
 * to whose hands are on a reading sounds better and collapses in the most
 * common case there is: on your own wall nobody else's hands are on anything,
 * so every note takes the same paper and the wall goes uniformly olive. Whose
 * hands these are is answered by the faces in the footer, which is a place
 * that can say two names.
 */
const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
  { hue: "#f1d7a8", ink: "#4f3921" },
];

/** Today, yesterday, or a date. A wall you return to daily needs the first
 *  two to be words — "today" reads instantly, "3 Aug" has to be decoded. */
function whenShort(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Same rule classic used for the Debug pill. */
function showsDebug(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true || env.VITE_SHOW_INTERNAL === "1";
}

/* The same key classic used, deliberately: anyone with an unsaved draft when
   the old wall is deleted keeps it, instead of losing the one thing a product
   about keeping things must never lose. */
const DRAFT_KEY = "waka.captureDraft.v1";

/** Whether the wall renders as the orbit board (goal/two-modes prototype). */
const ORBIT_WALL_KEY = "waka.orbitWall.v1";

export function roomShapingProgressCopy(
  contributorCount: number,
  memberCount: number,
): string {
  const count = Math.max(0, contributorCount);
  const members = Math.max(0, memberCount);
  return `${count} of ${members} ${members === 1 ? "member" : "members"} added a take`;
}

/**
 * A contribution earns a reread; it does not guarantee new wording. Keep that
 * distinction visible at the point where someone is deciding whether to add
 * a take, rather than teaching it in explanatory copy elsewhere on the page.
 */
export function roomShapingNextStepCopy(input: {
  contributorCount: number;
  requiredContributors: number;
  state: "forming" | "revealed";
  phase: ApiGroupReadingGenerationStatus["phase"] | null;
  hasProposal: boolean;
}): string {
  if (input.hasProposal) {
    return "A possible next version is ready for the room to decide.";
  }

  const remaining = Math.max(
    0,
    Math.max(0, input.requiredContributors) - Math.max(0, input.contributorCount),
  );
  const target = input.state === "forming" ? "a grounded first draft" : "a possible next version";
  if (remaining > 0) {
    return `${remaining} more ${remaining === 1 ? "member" : "members"} before WAKA looks for ${target}.`;
  }
  if (input.phase === "processing") {
    return `WAKA is rereading the room for ${target}.`;
  }
  if (input.phase === "failed") {
    return "The reread did not finish. Everyone’s takes are still saved.";
  }
  if (input.phase === null) {
    return `Enough members have shaped this. A reread for ${target} is next.`;
  }
  return input.state === "forming"
    ? "The room was reread; a grounded first draft has not formed yet."
    : "The room was reread; this version still holds.";
}

export function roomProposalReviewCopy(
  responseCount: number,
  memberCount: number,
  requiredResponses: number,
): string {
  const responses = Math.max(0, responseCount);
  const members = Math.max(0, memberCount);
  const required = Math.max(0, requiredResponses);
  return `${responses} of ${members} ${members === 1 ? "member" : "members"} responded · ${required} matching choices decide`;
}

export interface RoomFirstReadPresentation {
  label: string;
  title: string;
  detail: string | null;
}

/**
 * The first read used to collapse opening, waiting, processing and an honest
 * "no thread yet" result into one TAKING SHAPE card. Keep those states plain
 * and stable so an automatic draft arriving never looks accidental.
 */
export function roomFirstReadPresentation(input: {
  memberCount: number;
  sharedInspirationCount: number;
  phase: ApiGroupReadingGenerationStatus["phase"] | null;
  loading: boolean;
  hasFormingRead: boolean;
}): RoomFirstReadPresentation {
  if (input.loading) {
    return {
      label: "CHECKING THE ROOM",
      title: "Opening the shared read…",
      detail: null,
    };
  }
  if (input.memberCount < 2) {
    return {
      label: "WAITING FOR SOMEONE",
      title: "Invite another person to begin.",
      detail: "A shared read needs at least two people.",
    };
  }
  if (input.phase === "failed") {
    return {
      label: "FIRST READ · PAUSED",
      title: "The first read didn’t finish.",
      detail: "The room’s shared inspirations are still here.",
    };
  }
  if (input.sharedInspirationCount === 0) {
    return {
      label: "WAITING FOR SHARED MATERIAL",
      title: "There are no shared inspirations to read yet.",
      detail: null,
    };
  }
  if (input.phase === "processing" || input.phase === null) {
    return {
      label: "FIRST READ · IN PROGRESS",
      title: "Finding the room’s first shared thread…",
      detail: "If a shared thread holds, a living draft appears here automatically.",
    };
  }
  if (input.hasFormingRead) {
    return {
      label: "FIRST READ · OPEN TO THE ROOM",
      title: "No shared thread holds yet.",
      detail: "Member takes can help the first draft form.",
    };
  }
  return {
    label: "FIRST READ · TAKING SHAPE",
    title: "No shared thread holds yet.",
    detail: "The room can try the read again as its shared material changes.",
  };
}

/**
 * The word on the button that opens a room's shared top of mind.
 *
 * It said "open shared read", and "read" as a noun appears nowhere the button
 * goes: the page it opens is labelled SHARED TOP OF MIND under the heading
 * "What we're finding together". A button whose word does not exist at its
 * destination makes people click to find out what it meant, which is the
 * definition of an unclear one.
 *
 * The rule applied here and below: **name the destination in the destination's
 * own words.** Three names for this surface were live at once — "shared read"
 * on the button, "shared top of mind" on the page and in every aria-label,
 * "direction" in the URL and the API. Only one of them was ever shown to a
 * person, so that is the one that wins.
 */
export function roomDirectionCtaCopy(input: {
  memberCount: number;
  hasProposal: boolean;
  hasCurrent: boolean;
  inviteCopied: boolean;
}): string {
  // A room of one cannot read anything together yet, so the button does the
  // only useful thing instead of opening an empty page.
  if (input.memberCount < 2) {
    return input.inviteCopied ? "invite link copied" : "invite someone";
  }
  if (input.hasProposal) return "review the proposed version";
  if (input.hasCurrent) return "open the shared top of mind";
  return "see the first read";
}

/**
 * The one quiet line under a room strip's claim.
 *
 * It used to be a four-clause sentence — "64 shared inspirations in the room ·
 * this version traces to 2 of 6 members · version from yesterday · 3 new
 * inspirations since this reading" — most of which narrated things already on
 * screen or better said elsewhere. The faces beside this line ARE who the
 * version traces to; the pool size lives on the detail page with the rest of
 * the evidence story. What earns the glance: how old this version is, and
 * whether saves have arrived since it was read.
 *
 * Before a first version exists there are no faces to point at, so the line
 * carries the one progress fact instead: who has brought material.
 */
export function roomIntentMetaCopy(input: {
  hasCurrent: boolean;
  /** `whenShort` output for the current version, e.g. "yesterday". */
  when: string;
  newInspirationCount: number;
  sharedContributorCount: number;
  memberCount: number;
}): string {
  if (!input.hasCurrent) {
    return `${input.sharedContributorCount} of ${input.memberCount} members brought material`;
  }
  const fresh =
    input.newInspirationCount > 0
      ? ` · ${input.newInspirationCount} new save${input.newInspirationCount === 1 ? "" : "s"} since`
      : "";
  return `from ${input.when}${fresh}`;
}

export function roomDirectionEvidenceCopy(
  evidence: Array<{ signalId: string; userId: string }>,
  memberCount: number,
): string {
  const inspirationCount = new Set(evidence.map((item) => item.signalId)).size;
  const representedCount = new Set(evidence.map((item) => item.userId)).size;
  return `${inspirationCount} inspiration${inspirationCount === 1 ? "" : "s"} behind this draft · ${representedCount} of ${memberCount} member${memberCount === 1 ? "" : "s"} represented`;
}

/**
 * What the two words mean, written once.
 *
 * The label used to be the sentence -- "your rooms can read this" / "private to
 * you" -- which made the control long, made the two states hard to compare at a
 * glance, and could not be reused in a list. The state is one word; the
 * consequence is a hint.
 *
 * "Public" is scoped on purpose. It means the rooms you are in, NOT the
 * internet: a public profile is a separate setting you turn on yourself. Saying
 * "anyone" here would promise something the flag does not do, and saying
 * nothing would let people assume it.
 */
export const SHARING_MEANING = {
  public: "Any room you join can read this. It stays yours.",
  private: "No room can read this. It still shapes your own Top of Mind.",
} as const;

/**
 * The same setting, said properly, where there is room to say it.
 *
 * `SHARING_MEANING` is the one-liner beside the control. This is for the
 * archive, where someone is deciding rather than typing — and where the honest
 * questions are "who actually sees it" and "what do they see of it".
 *
 * Every claim here is checked against what the room code does, because a
 * privacy explanation that is approximately right is worse than none:
 *   - members see `truncatePreview` output, PREVIEW_LENGTH = 180 chars
 *     (`group-top-of-mind.ts`), never the full text — `canLoadFullSignal`
 *     returns false for another member's evidence;
 *   - the excerpt is served with `ownerName` attached, so it is attributed;
 *   - private saves are excluded at the query layer in every group path, so
 *     they never enter the pool a reading is made from;
 *   - neither setting touches the solo pipeline, which has no sharing gate.
 */
export const SHARING_NOTE = {
  heading: "Who can read what you keep",
  public:
    "Public — every room you are in can read it. A room may quote a short excerpt, with your name, as evidence for what it reads in you together.",
  private:
    "Private — no room can read it. It never joins the pool a room's reading is made from, and it cannot be quoted.",
  both:
    "Either way the save stays yours, and either way it still shapes your own Top of Mind.",
  /**
   * The one thing turning it back cannot do.
   *
   * Making a save private stops it being pooled, quoted or read again, and it
   * disappears from the evidence of readings that already cited it. What it
   * cannot do is unmake the reading itself: a room's conclusion is a record of
   * what that room understood at a time, and it stays on the wall and in the
   * timeline. Retiring it would rewrite the room's history to match one
   * member's later preference.
   *
   * Which is why this belongs on the way IN. Going private is recoverable in
   * every respect except the one nobody expects; going public is the step that
   * cannot be fully taken back, so that is where it is said.
   */
  goingPrivate:
    "Making it private later stops it being read, quoted, or shown as evidence — but a reading a room already made from it stays on that room's wall.",
} as const;

/**
 * The sharing setting, explained wherever it can be changed.
 *
 * It used to live in one place — collapsed, above the archive list — which is
 * the same as not existing for anyone who was in the composer deciding. The
 * question "what does public actually mean here" is asked at the moment of
 * choosing, so the answer follows the control to all three places it appears.
 *
 * `summary` is the always-visible line. Given a save's state it says what THAT
 * save does; on the archive, which governs a whole column, it asks the question
 * instead. Opening it gives the full consequence either way.
 */
function SharingExplainer({
  shared,
  open,
}: {
  shared?: boolean;
  open?: boolean;
}): JSX.Element {
  const summary =
    shared === undefined
      ? SHARING_NOTE.heading
      : SHARING_MEANING[shared ? "public" : "private"];

  return (
    <details className="sf-sharing-note" open={open}>
      <summary>
        <Info className="sf-sharing-note-icon" aria-hidden="true" />
        <span>{summary}</span>
      </summary>
      <p>{SHARING_NOTE.public}</p>
      <p>{SHARING_NOTE.private}</p>
      <p>{SHARING_NOTE.goingPrivate}</p>
      <p className="sf-sharing-note-both">{SHARING_NOTE.both}</p>
    </details>
  );
}

/**
 * The one confirmation in this flow, on the one step that cannot be undone.
 *
 * Going private is recoverable: the save leaves the pool, stops being quoted,
 * and disappears from the evidence of readings that cited it. Going public is
 * not fully recoverable — once a room has read something, turning the save
 * private afterwards does not unmake the reading. So the question is asked
 * here, once, in the direction that carries the risk.
 *
 * Not asked for a composer draft. Nothing has been shared with anything until
 * the save exists, and a confirmation for a decision with no consequence yet
 * is the kind people learn to dismiss without reading — which is how the one
 * that matters gets dismissed too.
 */
export function confirmGoingPublicMessage(): string {
  return [
    "Make this public?",
    "",
    SHARING_NOTE.public.replace(/^Public — /, "").replace(/^every/, "Every"),
    "",
    SHARING_NOTE.goingPrivate.replace(/^Making it private later/, "Making it private again later"),
  ].join("\n");
}

/**
 * How often an open room wall checks whether the room moved without you.
 *
 * 30s, not the 2s the generation poll uses. That one is a progress bar for
 * work you just started and knows to stop; this one runs for as long as a room
 * wall is open, so its cost is paid by every idle tab. A proposal that lands
 * half a minute late is still a proposal that landed; one that never lands
 * until you reload is a room that looks finished when it is not.
 */
const ARRIVAL_POLL_MS = 30_000;

/**
 * What "the room has moved" looks like from the status endpoint.
 *
 * The cheap read that says whether the expensive reads are worth doing: a
 * reread produces a new job row and a changed note count, and both are in the
 * status payload. Comparing this string is what keeps an idle tab from
 * refetching a board and a direction every thirty seconds forever.
 */
export function roomArrivalSignature(status: ApiGroupReadingGenerationStatus): string {
  return [
    status.phase,
    status.noteCount,
    status.job?.id ?? "",
    status.job?.status ?? "",
    status.job?.updatedAt ?? "",
  ].join("|");
}

function sameReadingIds(a: Reading[], b: Reading[]): boolean {
  return a.length === b.length && a.every((reading, i) => reading.id === b[i]?.id);
}

/** Every URL in what you typed. These become link attachments, which is what
 *  makes the page behind them readable to the judge at all. */
function urlsIn(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? []));
}

export default function SurfacePage(): JSX.Element {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const surfaceRoute = useMemo(
    () => parseSurfacePath(location.pathname),
    [location.pathname],
  );
  const state = surfaceRoute.view;
  /*
    Which room you are standing in.

    `/capture` carries no room in its path, because a save has no room -- see
    `buildSurfacePath`. But the composer opens in front of a wall that is still
    there, and that wall keeps its name, its cast and its status poll while you
    type. So for capture, and only for capture, the room arrives in history
    state: enough to know where you are and where closing puts you back, with
    nothing in the URL claiming the save lands there.

    Legacy `/rooms/:id/capture` still resolves through `surfaceRoute.roomId`,
    so an open tab from before this change keeps its room too.
  */
  const room = resolveSurfaceRoom(surfaceRoute, location.state);
  const routeEntityId = surfaceRoute.entityId;
  const navigateSurface = useCallback(
    (view: SurfaceView, options: SurfaceNavigationOptions = {}) => {
      const roomId = options.roomId === undefined ? room : options.roomId;
      navigate(
        buildSurfacePath({ view, roomId, entityId: options.entityId ?? null }),
        {
          replace: options.replace ?? false,
          // Only capture needs this: every other view keeps its room in the path.
          ...(view === "capture" && roomId ? { state: { room: roomId } } : {}),
        },
      );
    },
    [navigate, room],
  );

  const [rooms, setRooms] = useState<ApiGroupSummary[]>([]);
  const [members, setMembers] = useState<ApiGroupMemberSummary[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [surfaceNotice, setSurfaceNotice] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] =
    useState<ApiTopOfMindGenerationStatus | null>(null);
  const [direction, setDirection] = useState<ApiGroupDirection | null>(null);
  const [roomGenerationStatus, setRoomGenerationStatus] =
    useState<ApiGroupReadingGenerationStatus | null>(null);
  const [directionDraft, setDirectionDraft] = useState("");
  const [directionSaving, setDirectionSaving] = useState(false);
  const [directionReviewing, setDirectionReviewing] = useState(false);
  const [selectedDirectionVersion, setSelectedDirectionVersion] =
    useState<string | null>(null);
  const directionInputRef = useRef<HTMLTextAreaElement>(null);
  const previousRoom = useRef(room);
  /* The last room state this client has already reflected. See ARRIVAL_POLL_MS. */
  const arrivalSignature = useRef<string | null>(null);

  const [openReading, setOpenReading] = useState<Reading | null>(null);
  /*
    EVERY save the reading rested on, not the first one that happened to carry
    a quote.

    The first cut showed one, and on a reading built from three saves across
    two people it showed one save by one person -- which quietly told you the
    room agreed with you, when the whole claim of the product is that it did
    not have to. A reading that joins hands has to show the hands.
  */
  const [openEvidence, setOpenEvidence] = useState<Reading["evidence"]>([]);
  const [fullText, setFullText] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openSave, setOpenSave] = useState<ApiSavedSignalSearchResult | null>(null);
  /* What a save became. Reached by LOOKING, this is the question you have. */
  const [became, setBecame] = useState<ApiSignalReading[]>([]);
  /*
    Reflecting on a save.

    This is the one place in the product where the machine asks and YOU
    answer, and it was dropped in the rewrite. It belongs on the save reached
    by looking — arriving through a reading you came to check a claim, and a
    question would be an interruption.
  */
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const [openSaveShared, setOpenSaveShared] = useState(true);
  const [openSaveAttachments, setOpenSaveAttachments] = useState<Array<"link" | "image" | "file">>(
    [],
  );
  const [reflections, setReflections] = useState<ApiReflection[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [answering, setAnswering] = useState(false);

  /*
    Time.

    A room's life is a list of events, and the board as it stood at any of
    them. Travelling is a state of this surface like any other -- the wall
    re-forms where it stands rather than opening a separate history view,
    because what changed is the point and you cannot see a change you had to
    navigate away to look at.
  */
  const [timeline, setTimeline] = useState<ApiRoomTimeline | null>(null);
  const [travelledTo, setTravelledTo] = useState<string | null>(null);

  /*
    Every board the room has ever shown, fetched once.

    Live re-forming while you drag is only possible if nothing has to load
    mid-gesture. Each moment's board is small and the number of moments is the
    number of times the room has changed, so this is a handful of requests at
    room-open, in exchange for a rail that never stutters.
  */
  const [boards, setBoards] = useState<Record<string, Reading[]>>({});

  /* Re-ask for the solo wall, which is the only way back to "now" once it has
     been filtered down to a past state. */
  /* The unfiltered solo wall, so travelling can always come back. */
  const soloAll = useRef<Reading[]>([]);

  const travel = useCallback(
    (at: string | null) => {
      if (!room) {
        /*
          Solo: the wall as it had accumulated by then, filtered from the FULL
          set rather than from what is currently displayed.

          The first cut filtered `readings` in place, which is destructive:
          travelling to Jul 6 cut the wall to one note, and then travelling
          forward to Jul 31 filtered that same single note again, so moving
          back down the rail could never restore anything. It also fed
          `moments`, so the rail's own stops disappeared as you used it.
        */
        setTravelledTo(at);
        const all = soloAll.current;
        setReadings(at ? all.filter((r) => !r.createdAt || r.createdAt <= at) : all);
        return;
      }
      setTravelledTo(at);
      const cached = boards[at ?? "now"];
      if (cached) {
        setReadings(cached);
        return;
      }
      void fetchRoomTimeline(room, at ?? undefined)
        .then((response) => {
          const board = response.board?.notes;
          if (!board) return;
          /*
            A past board is a record, not a re-reading. Its notes carry the
            evidence and the faces they had at the time, so travelling shows
            what the room actually said then rather than what it would say
            about that material now.
          */
            const mapped = board.map((note) => ({
              id: note.id,
              title: note.title?.trim() || null,
              text: note.why?.trim() || note.title,
              scope: "group" as const,
              isPinned: false,
              hands: Array.from(new Set(note.evidence.map((e) => e.ownerName).filter(Boolean))),
              evidence: note.evidence.map((e) => ({
                id: e.signalId,
                text: e.textPreview,
                quote: null,
                author: e.ownerName,
                ownerUserId: e.ownerUserId,
              })),
            createdAt: note.createdAt,
          }));
          setBoards((current) => ({ ...current, [at ?? "now"]: mapped }));
          setReadings(mapped);
        })
        .catch((error) => {
          setSurfaceNotice(
            error instanceof Error ? error.message : "That moment could not be loaded.",
          );
        });
    },
    [boards, room],
  );

  /*
    Moving the notes around.

    A post-it you cannot move is a card. Position is the one thing on this
    wall that is yours to decide -- the machine puts them up in no order, and
    where they end up is what you made of them.
  */
  /*
    The orbit board (goal/two-modes, slice 1) — the same wall data rendered as
    a ring around the room's adopted ambition. Internal-only while it is being
    judged: the switch shows under the same rule as the Debug pill, and the
    choice sticks so the founder can live in one rendering for days. Flipping
    it changes nothing about the data; both renderings read `wall`.
  */
  const [orbitWall, setOrbitWall] = useState(() => {
    try {
      return window.localStorage.getItem(ORBIT_WALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleOrbitWall = useCallback(() => {
    setOrbitWall((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(ORBIT_WALL_KEY, next ? "1" : "0");
      } catch {
        /* the preference just won't stick */
      }
      return next;
    });
  }, []);

  const [drags, setDrags] = useState<Record<number, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const dragFrom = useRef<{ i: number; x: number; y: number; baseX: number; baseY: number } | null>(
    null,
  );
  const dragMoved = useRef(false);

  useEffect(() => {
    if (dragging === null) return undefined;
    const onMove = (event: PointerEvent) => {
      const from = dragFrom.current;
      if (!from) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
      setDrags((current) => ({
        ...current,
        [from.i]: { x: from.baseX + dx, y: from.baseY + dy },
      }));
    };
    const onUp = () => {
      dragFrom.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  /*
    Capture, properly.

    The surface could only save plain text, which quietly cost more than it
    looked: a bare URL with no enrichment is nearly invisible to the judge, so
    "save a link" was not a missing convenience, it was material the algorithm
    never got to read.

    Attachments are created AFTER the inspiration — the API needs an
    inspirationId — so a save with a link or a file is two steps, and the
    second failing must never lose the first. The text is kept either way.
  */
  const [draft, setDraft] = useState(() => {
    // Whatever you left in the box, still there. Losing a half-written save
    // to a refresh is the cheapest possible way to teach someone not to trust
    // a product that exists to keep things.
    try {
      return window.localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<File[]>([]);
  /*
    Shared with your rooms, or private.

    Default is shared — that is the server's default and the product's whole
    point. But a save you do not want read beside anyone else's has to be
    possible, and this was the one privacy control in the old capture cell.
    Without it every inspiration you keep is readable by every room you are in,
    with no way to say otherwise.
  */
  const [shareToGroups, setShareToGroups] = useState(true);
  /*
    How long the composer was open before you kept it.

    The pulse-speed proxy: a fast save is a reaction, a slow one a
    composition, and the scoring reads the difference. Classic sent it on
    every capture; the surface sent nothing, which is the same class of silent
    loss as the missing revisit tracking.
  */
  const composerOpenedAt = useRef<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const askInputRef = useRef<HTMLInputElement>(null);

  /* --- the room's wall ---------------------------------------------- */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setSurfaceNotice(null);
    (async () => {
      try {
        let next: Reading[];
        if (room) {
          // All three calls are stored/queue reads. The wall and ambition are
          // independent saved surfaces, so load them together; generation
          // progress must never hold either one behind a spinner.
          void fetchGroupReadingStatus(room)
            .then((status) => {
              if (!cancelled) setRoomGenerationStatus(status);
            })
            .catch((error) => {
              if (!cancelled) {
                setSurfaceNotice(
                  error instanceof Error
                    ? error.message
                    : "This room's reading status is unavailable.",
                );
              }
            });
          const [board, roomDirection] = await Promise.all([
            fetchGroupTopOfMind(room),
            fetchGroupDirection(room).catch((error) => {
              if (!cancelled) {
                setSurfaceNotice(
                  error instanceof Error
                    ? error.message
                    : "This room's shared top of mind could not be loaded.",
                );
              }
              return null;
            }),
          ]);
          next = board.notes.map(readingFromGroupNote);
          if (!cancelled) {
            setMembers(board.members ?? []);
            setDirection(roomDirection);
            setGenerationStatus(null);
          }
        } else {
          const [notes, status] = await Promise.all([
            fetchTopOfMindNotes({ limit: 12 }),
            fetchTopOfMindStatus(),
          ]);
          next = notes.map(readingFromSoloNote);
          if (!cancelled) {
            setMembers([]);
            setDirection(null);
            setRoomGenerationStatus(null);
            setGenerationStatus(status);
            if (status.phase === "failed") setSurfaceNotice(status.message);
            soloAll.current = next;
          }
        }
        if (cancelled) return;
        // Precision over recall: however many held is however many show. There
        // is no fill target here, so a wall of two is a finished wall.
        setReadings(next.filter((r) => r.text.trim().length > 0));
      } catch (error) {
        if (!cancelled) {
          setReadings([]);
          setSurfaceNotice(
            error instanceof Error ? error.message : "This wall could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, user?.id]);

  useEffect(() => {
    if (room || generationStatus?.phase !== "processing") return undefined;
    let cancelled = false;
    const poll = window.setInterval(() => {
      void fetchTopOfMindStatus()
        .then(async (status) => {
          if (cancelled) return;
          if (status.phase === "processing") {
            setGenerationStatus(status);
            return;
          }

          // Load the completed reading before changing the phase. Changing the
          // phase first tears down this effect and marks the request cancelled,
          // which used to leave a successfully generated wall visibly empty.
          const notes = await fetchTopOfMindNotes({ limit: 12 });
          if (cancelled) return;
          const mapped = notes.map(readingFromSoloNote);
          soloAll.current = mapped;
          setReadings(mapped);
          setGenerationStatus(status);
          if (status.phase === "failed") setSurfaceNotice(status.message);
          window.clearInterval(poll);
        })
        .catch((error) => {
          if (!cancelled) {
            setSurfaceNotice(
              error instanceof Error ? error.message : "Reading status is unavailable.",
            );
          }
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [generationStatus?.phase, room]);

  useEffect(() => {
    if (!room || roomGenerationStatus?.phase !== "processing") return undefined;
    let cancelled = false;
    const poll = window.setInterval(() => {
      void fetchGroupReadingStatus(room, { ensure: false })
        .then(async (status) => {
          if (cancelled) return;
          if (status.phase === "processing") {
            setRoomGenerationStatus(status);
            return;
          }

          // The worker has committed both stages. Swap in the saved result as
          // one visible update; the old wall stayed usable for the whole pass.
          const [board, roomDirection] = await Promise.all([
            fetchGroupTopOfMind(room),
            fetchGroupDirection(room),
          ]);
          if (cancelled) return;
          setMembers(board.members ?? []);
          setReadings(board.notes.map(readingFromGroupNote));
          setDirection(roomDirection);
          setRoomGenerationStatus(status);
          setLastRead(
            status.phase === "failed"
              ? "the latest reread did not finish"
              : "read just now",
          );
          if (status.phase === "failed") setSurfaceNotice(status.message);
          window.clearInterval(poll);
        })
        .catch((error) => {
          if (!cancelled) {
            setSurfaceNotice(
              error instanceof Error ? error.message : "Reading status is unavailable.",
            );
          }
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [room, roomGenerationStatus?.phase]);

  /*
    A room moves whether or not you are the one moving it.

    The poll above only runs for the person who STARTED a reread — it is gated
    on `phase === "processing"`, and nobody else's client ever set that. So a
    member sitting on the room's wall when someone else's take crossed the
    threshold kept looking at a stale strip until they reloaded: the badge
    never appeared, the verb never changed to "review the proposed version",
    and the decision waiting on them was invisible. A shared surface that only
    updates for whoever touched it last is not shared.

    Cheap read first. The status endpoint says whether a new job exists and how
    many notes there are; only when that signature moves do we pay for the
    board and the direction. An idle tab costs one small request every 30s and
    nothing else.

    Hidden tabs do not poll, and a tab coming back to the foreground checks
    immediately rather than waiting out the interval — coming back to a room is
    exactly when you most expect it to be current.
  */
  useEffect(() => {
    // The 2s poll owns the processing window; this is for everything after it.
    if (!room || roomGenerationStatus?.phase === "processing") return undefined;

    let cancelled = false;
    // Re-baseline on every room change so arriving somewhere new is never
    // mistaken for that room having just moved.
    arrivalSignature.current = null;

    const check = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const status = await fetchGroupReadingStatus(room, { ensure: false });
        if (cancelled) return;
        const next = roomArrivalSignature(status);
        if (arrivalSignature.current === null) {
          arrivalSignature.current = next;
          return;
        }
        if (next === arrivalSignature.current) return;
        arrivalSignature.current = next;

        const [board, nextDirection] = await Promise.all([
          fetchGroupTopOfMind(room),
          fetchGroupDirection(room),
        ]);
        if (cancelled) return;
        setMembers(board.members ?? []);
        setDirection(nextDirection);
        setRoomGenerationStatus(status);
        /*
          Only disturb the wall when the notes themselves changed. Layout,
          colour and any post-it you dragged are keyed to position, so
          replacing an identical list would reshuffle someone's arrangement to
          show them nothing new.
        */
        const mapped = board.notes.map(readingFromGroupNote);
        setReadings((current) => (sameReadingIds(current, mapped) ? current : mapped));
      } catch {
        /* Ambient. A failed background check is not worth a notice. */
      }
    };

    const timer = window.setInterval(() => void check(), ARRIVAL_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [room, roomGenerationStatus?.phase]);

  useEffect(() => {
    // Only a room has a life. Your own wall is one person's, and there is no
    // arrival to mark on it.
    if (!user || !room) {
      setTimeline(null);
      setTravelledTo(null);
      return undefined;
    }
    let cancelled = false;
    void fetchRoomTimeline(room)
      .then((response) => {
        if (!cancelled) setTimeline(response.timeline);
      })
      .catch((error) => {
        if (!cancelled) {
          setTimeline(null);
          setSurfaceNotice(
            error instanceof Error ? error.message : "This room's timeline is unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [room, user?.id]);

  /*
    How many you have kept, for the verb in the bar.

    `limit` is capped at 200 server-side (MAX_SIGNAL_ARCHIVE_LIMIT), and asking
    for more does not clamp — it fails zod validation and 400s. The first cut
    asked for 2000, the request was rejected, and the `.catch` swallowed it, so
    the count silently rendered as nothing at all. A caught error that leaves a
    number blank is indistinguishable from a slow network, which is why this
    took a screenshot to find.

    At 200 the number becomes "200" rather than the truth, so it says "200+"
    at the ceiling instead of quietly lying.
  */
  const SAVED_CEILING = 200;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchSavedSignals({ limit: SAVED_CEILING })
      .then((all) => {
        if (!cancelled) setSavedCount(all.length);
      })
      .catch((error) => {
        if (!cancelled) {
          setSurfaceNotice(
            error instanceof Error ? error.message : "Your inspiration count is unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, kept]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetchGroups()
      .then((next) => {
        if (!cancelled) setRooms(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setSurfaceNotice(
            error instanceof Error ? error.message : "Your rooms could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /* --- looking for something ---------------------------------------- */
  useEffect(() => {
    if (state !== "ask") return undefined;
    askInputRef.current?.focus();
    const q = query.trim();
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void fetchSavedSignals(q ? { q, limit: 20 } : { limit: 20 })
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch((error) => {
          if (!cancelled) {
            setResults([]);
            setSurfaceNotice(
              error instanceof Error ? error.message : "Your inspirations could not be searched.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, state]);

  /* --- opening things ------------------------------------------------ */

  /*
    Arriving THROUGH a reading, there is exactly one question -- is that
    true? -- so the surface shows the claim and the words that carried it,
    and nothing else. The readings list, the reflections, the metadata and
    delete all answer questions you did not ask.
  */
  /*
    Revisit tracking.

    Not a feature — a signal. Every time a save is actually looked at, the
    scoring wants to know, and classic recorded it from eleven places. The
    surface recorded it from none, which degrades the algorithm while nothing
    visibly breaks. That is exactly why it goes in first.

    Fire-and-forget: a failed revisit must never interrupt reading.
  */
  const sawSave = useCallback((id: string, how: InspirationRevisitEventType) => {
    if (!id) return;
    void recordInspirationRevisit(id, how).catch(() => undefined);
  }, []);

  const enterReading = useCallback((
    reading: Reading,
    options: { navigate?: boolean } = {},
  ) => {
    setOpenReading(reading);
    setOpenEvidence(reading.evidence);
    setExpanded(new Set());
    if (options.navigate !== false) {
      navigateSurface("reading", { entityId: reading.id });
    }
    // Every cited save, in parallel. The previews the board ships are 180
    // characters of whatever sat at the start of the save, which is rarely the
    // part that mattered.
    reading.evidence.forEach((piece) => {
      if (!piece.id) return;
      /**
       * `/api/signals/:id` is intentionally owner-only. A room note can cite
       * another member's shared inspiration, but membership grants the excerpt
       * the room used — not access to that person's private signal archive.
       * Asking the owner-only endpoint for those citations produced the very
       * misleading "Signal not found" error when a room reading opened.
       */
      if (!canLoadFullSignal(reading.scope, piece.ownerUserId, user?.id)) return;
      sawSave(piece.id, "detail_opened");
      void fetchSavedSignalDetail(piece.id)
        .then((detail) =>
          setFullText((current) => ({
            ...current,
            [piece.id]: detail.rawText ?? detail.textPreview ?? "",
          })),
        )
        .catch((error) => {
          setSurfaceNotice(
            error instanceof Error ? error.message : "That inspiration could not be opened.",
          );
        });
    });
  }, [navigateSurface, sawSave, user?.id]);

  const enterSave = useCallback((
    signal: ApiSavedSignalSearchResult,
    options: { navigate?: boolean; detail?: ApiSavedSignalDetail } = {},
  ) => {
    setOpenSave(signal);
    setSaveDraft(null);
    setSaveRating(null);
    /*
      Start from what the row already knows.

      This used to be a flat `true`, on the reasoning that the list did not
      carry the flag and the detail would correct it. The detail never did:
      it was read as `detail.sharedToGroups`, a field this response has never
      contained, so the correction never fired and every save — private ones
      included — displayed as public for as long as it was open. Someone
      checking what they had left public was told "public" either way.

      The list carries `shared` now, so the first paint is already right and
      there is no window in which the toggle misreports a privacy setting.
    */
    setOpenSaveShared(signal.shared);
    setBecame([]);
    setReflections([]);
    setQuestion(null);
    setAnswer("");
    if (options.navigate !== false) {
      navigateSurface("save", { entityId: signal.id });
    }
    sawSave(signal.id, "detail_opened");
    void fetchSignalReadings(signal.id)
      .then(setBecame)
      .catch((error) =>
        setSurfaceNotice(
          error instanceof Error ? error.message : "Its readings could not be loaded.",
        ),
      );
    void fetchReflections(signal.id)
      .then(setReflections)
      .catch((error) =>
        setSurfaceNotice(
          error instanceof Error ? error.message : "Its reflections could not be loaded.",
        ),
      );
    const applyDetail = (detail: ApiSavedSignalDetail) => {
      setFullText((current) => ({
        ...current,
        [signal.id]: detail.rawText ?? detail.textPreview ?? "",
      }));
      if (typeof detail.shared === "boolean") setOpenSaveShared(detail.shared);
      setOpenSaveAttachments(
        (detail.attachments ?? [])
          .map((a) => a.type)
          .filter((t): t is "link" | "image" | "file" =>
            t === "link" || t === "image" || t === "file",
          ),
      );
    };
    if (options.detail) {
      applyDetail(options.detail);
    } else {
      void fetchSavedSignalDetail(signal.id)
        .then(applyDetail)
        .catch((error) => {
          setSurfaceNotice(
            error instanceof Error ? error.message : "That inspiration could not be loaded.",
          );
        });
    }
  }, [navigateSurface, sawSave]);

  // Deep links and a hard refresh restore the same in-surface entity instead
  // of falling back to an empty overlay. Back/Forward usually reuses the
  // already-open object, while these effects cover a fresh mount.
  useEffect(() => {
    if (
      state !== "reading" ||
      !routeEntityId ||
      openReading?.id === routeEntityId
    ) {
      return;
    }
    const reading = readings.find((item) => item.id === routeEntityId);
    if (reading) {
      enterReading(reading, { navigate: false });
      return;
    }
    if (!loading) {
      setSurfaceNotice("That room reading is no longer available.");
      navigateSurface("wall", { replace: true });
    }
  }, [enterReading, loading, navigateSurface, openReading?.id, readings, routeEntityId, state]);

  useEffect(() => {
    if (state !== "save" || !routeEntityId || openSave?.id === routeEntityId) {
      return undefined;
    }
    let cancelled = false;
    void fetchSavedSignalDetail(routeEntityId)
      .then((detail) => {
        if (!cancelled) {
          enterSave(detail, { navigate: false, detail });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setSurfaceNotice(
          error instanceof Error ? error.message : "That inspiration could not be loaded.",
        );
        navigateSurface("ask", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [enterSave, navigateSurface, openSave?.id, routeEntityId, state]);

  /*
    Keeping something.

    No modal, no bordered box. Capture is a state of this surface like every
    other, and it answers immediately -- the gap between saving and being read
    is hours, and a product that says nothing in that gap is where trust is
    lost cheapest.
  */
  const keep = useCallback(async () => {
    const text = draft.trim();
    if ((!text && files.length === 0) || keeping) return;
    setKeeping(true);
    try {
      const made = await createInspiration({
        text,
        ...(composerOpenedAt.current
          ? { captureElapsedMs: Date.now() - composerOpenedAt.current }
          : {}),
        // Shared is the server default; only send the flag when this one is
        // being kept back.
        ...(shareToGroups ? {} : { shareToGroups: false }),
      });

      // Links first: cheap, and the enrichment they trigger is the whole
      // reason a URL is worth saving.
      const links = urlsIn(text);
      for (const url of links) {
        await finalizeAttachment({ type: "link", inspirationId: made.id, url }).catch(
          () => undefined,
        );
      }

      // Then files: presign, PUT to S3, record. Each one independently, so a
      // single failure does not take the others or the save with it.
      for (const file of files) {
        try {
          const signed = await presignAttachment({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          });
          await uploadToPresignedUrl(signed.uploadUrl, file, signed.headers);
          await finalizeAttachment({
            type: file.type.startsWith("image/") ? "image" : "file",
            inspirationId: made.id,
            key: signed.key,
            name: file.name,
            contentType: file.type,
            size: file.size,
          });
        } catch {
          /* the words are saved; one attachment failing is not worth losing them */
        }
      }

      setDraft("");
      setFiles([]);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* private mode */
      }
      /*
        "Kept and shared with this room" was not true. Sharing is one flag on
        the signal -- `shared_to_groups` -- and every room you are in reads it.
        Saying "this room" while standing in one described a per-room choice
        the product does not offer, and contradicted the toggle three lines
        above it, which correctly says "your rooms".
      */
      setKept(
        !shareToGroups
          ? "Kept, private. No room will read this one."
          : links.length > 0
            ? "Kept and shared. The page behind that link is being read."
            : room
              ? "Kept. It joins the next read in every room you are in."
              : "Kept. It sits with what you have been circling.",
      );
      if (room) {
        void Promise.all([
          fetchGroupReadingStatus(room),
          fetchGroupDirection(room),
        ])
          .then(([status, nextDirection]) => {
            setRoomGenerationStatus(status);
            setDirection(nextDirection);
          })
          .catch(() => undefined);
      } else {
        void fetchTopOfMindStatus()
          .then((status) => setGenerationStatus(status))
          .catch(() => undefined);
      }
    } catch {
      setKept("Could not keep that. It is still in the box; try again.");
    } finally {
      setKeeping(false);
    }
  }, [draft, files, keeping, room, shareToGroups]);

  /* The draft survives a refresh. */
  useEffect(() => {
    try {
      if (draft.trim()) window.localStorage.setItem(DRAFT_KEY, draft);
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode */
    }
  }, [draft]);

  /*
    The whole surface is the drop target — no overlay panel, no dashed
    rectangle you have to hit. Drop anywhere and the composer opens with the
    file already on it.
  */
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropping(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setDropping(false);
    };
    const drop = (event: DragEvent) => {
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length === 0) return;
      event.preventDefault();
      setDropping(false);
      setFiles((current) => [...current, ...dropped]);
      navigateSurface("capture");
      composerOpenedAt.current = Date.now();
      window.setTimeout(() => draftRef.current?.focus(), 60);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [navigateSurface]);

  /*
    Ask the next question.

    The prompt is generated from the save AND every answer already given, so a
    thread deepens rather than circling — which is the whole difference between
    reflecting and being interviewed.
  */
  const askNext = useCallback(async () => {
    if (!openSave || asking) return;
    setAsking(true);
    try {
      const generated = await generateGuidedReflectionQuestion({
        // The locale decides what language the question is asked in — without
        // it the machine writes to you in English on a Korean wall.
        locale,
        inspiration: {
          text: fullText[openSave.id] ?? openSave.textPreview,
          kind: (openSave.kind ?? "note") as never,
          // What is attached changes what is worth asking about.
          attachmentKinds: openSaveAttachments,
        },
        priorAnswers: reflections
          .filter((r) => r.answer)
          .map((r) => ({ question: r.question, answer: r.answer as string })),
      });
      setQuestion(generated.question);
    } catch {
      setQuestion(null);
    } finally {
      setAsking(false);
    }
  }, [asking, fullText, locale, openSave, openSaveAttachments, reflections]);

  const saveAnswer = useCallback(async () => {
    if (!openSave || !question || !answer.trim() || answering) return;
    setAnswering(true);
    try {
      const created = await createReflection(openSave.id, {
        question,
        answer: answer.trim(),
      });
      setReflections((current) => [...current, created.reflection]);
      setAnswer("");
      setQuestion(null);
    } catch {
      /* leave the draft in the box rather than losing what was typed */
    } finally {
      setAnswering(false);
    }
  }, [answer, answering, openSave, question]);

  const toWall = useCallback(() => {
    navigateSurface("wall", { replace: true });
    setOpenReading(null);
    setOpenEvidence([]);
    setOpenSave(null);
    setKept(null);
  }, [navigateSurface]);

  // Escape always means "back to the wall". One surface, one way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "wall") toWall();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, toWall]);

  /*
    When each person arrived, off the room's own life.

    "6 hearts" was a number standing in for people -- it said how many without
    saying who, on a surface whose entire subject is whose hearts these are.
    The names are the answer, and when they arrived is what makes a room a
    thing that happened rather than a roster.
  */
  const joinedAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of timeline?.events ?? []) {
      if (event.kind === "member" && event.event === "joined") map.set(event.userId, event.at);
    }
    return map;
  }, [timeline]);

  /*
    Every moment in the room's life, laid out in real time rather than evenly
    spaced -- three readings in one afternoon and then a month of quiet should
    LOOK like that, or the rail lies about the shape of the room.
  */
  const moments = useMemo(() => {
    /*
      Your own wall has a life too — it just has no timeline endpoint.

      `fetchRoomTimeline` is a group route: it replays a room's events and
      rebuilds the board as it stood. Solo has none of that, so the honest
      reconstruction is the one thing the data already carries — when each
      reading was written. Travelling back then means showing the wall as it
      had ACCUMULATED, which is true as far as it goes.

      What it cannot show is a reading that was retired: nothing in this
      response remembers what used to be there. So a solo wall travels
      forward-only through its own arrivals, and that limit is the data's, not
      a shortcut.
    */
    if (!room) {
      /* Built from the FULL set: a rail whose stops vanish as you travel is a
         rail you can walk off. */
      const days = new Map<string, string>();
      for (const reading of (travelledTo ? soloAll.current : readings)) {
        if (!reading.createdAt) continue;
        const day = reading.createdAt.slice(0, 10);
        const seen = days.get(day);
        if (!seen || reading.createdAt < seen) days.set(day, reading.createdAt);
      }
      const raw = [...days.values()].sort();
      if (raw.length < 2) return [];
      const first = Date.parse(raw[0]!);
      const span = Math.max(1, Date.now() - first);
      return raw.map((at, i) => ({
        at,
        key: `solo-${i}`,
        label: "the wall as it stood",
        pct: Math.min(100, Math.max(0, ((Date.parse(at) - first) / span) * 100)),
        when: new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      }));
    }
    if (!timeline) return [];
    const raw = [
      { at: timeline.formedAt, key: "formed", label: "the room formed" },
      ...timeline.events
        .filter((e) => e.kind === "member" || e.kind === "note_written")
        .map((e, i) => ({
          at: e.at,
          key: `${e.kind}-${i}`,
          label:
            e.kind === "member"
              ? `${e.name} ${e.event}`
              : `the room said \u201c${e.title}\u201d`,
        })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = Date.parse(raw[0]?.at ?? "");
    const last = Date.now();
    const span = Math.max(1, last - first);
    return raw.map((m) => ({
      ...m,
      pct: Math.min(100, Math.max(0, ((Date.parse(m.at) - first) / span) * 100)),
      when: new Date(m.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    }));
  }, [timeline]);

  /*
    Warm every stop as soon as the room's life is known, so the first drag is
    as smooth as the tenth.
  */
  useEffect(() => {
    if (!room || moments.length === 0) return;
    for (const moment of moments) {
      if (boards[moment.at]) continue;
      void fetchRoomTimeline(room, moment.at)
        .then((response) => {
          const board = response.board?.notes;
          if (!board) return;
          setBoards((current) => ({
            ...current,
            [moment.at]: board.map((note) => ({
              id: note.id,
              title: note.title?.trim() || null,
              text: note.why?.trim() || note.title,
              scope: "group" as const,
              isPinned: false,
              hands: Array.from(new Set(note.evidence.map((e) => e.ownerName).filter(Boolean))),
              evidence: note.evidence.map((e) => ({
                id: e.signalId,
                text: e.textPreview,
                quote: null,
                author: e.ownerName,
                ownerUserId: e.ownerUserId,
              })),
              createdAt: note.createdAt,
            })),
          }));
        })
        .catch(() => undefined);
    }
    // `boards` is read to skip what is already warm; including it would refire
    // this on every arrival and re-request the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments, room]);

  /* `now` is a stop like any other, at the far end. */
  const allStops = useMemo(
    () => [...moments, { at: null as string | null, key: "now", label: "what it says today", pct: 100, when: "now" }],
    [moments],
  );

  const here = useMemo(
    () => allStops.find((stop) => stop.at === travelledTo) ?? allStops[allStops.length - 1]!,
    [allStops, travelledTo],
  );

  /*
    Which stops get a printed date.

    Every stop cannot: a room that wrote four readings in one afternoon would
    stack four labels on top of each other and none would be readable. So a
    date is printed only when it clears the last printed one by enough of the
    track to stand alone -- and `now` always wins its place, because it is the
    end of the line and the thing you come back to.

    Every stop still keeps its dot and its hover, so nothing is lost by not
    being labelled; the labels are a ruler, not the content.
  */
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  /*
    Snap to the nearest stop rather than to the nearest pixel. Dragging is
    continuous, but where you LAND is always somewhere the room actually did
    something.
  */
  const scrubTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || allStops.length === 0) return;
      const box = track.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
      let nearest = allStops[0]!;
      for (const stop of allStops) {
        if (Math.abs(stop.pct - pct) < Math.abs(nearest.pct - pct)) nearest = stop;
      }
      if (nearest.at !== travelledTo) travel(nearest.at);
    },
    [allStops, travel, travelledTo],
  );

  /*
    LAY THE WALL OUT BY WHAT THE READINGS SHARE.

    Until now the notes flowed in whatever order the API returned them, which
    is to say: none. On a real wall the things near each other are about each
    other, and that adjacency is readable before you read a word — it is the
    oldest trick in sensemaking and the product was throwing it away.

    Two readings are related when they rest on the same saves. So: start from
    the reading with the most evidence, then repeatedly place whichever
    remaining reading shares the most with the one just placed. A greedy chain
    rather than a real clustering, deliberately — it is O(n²) on a set of six,
    it is stable, and it puts related sheets side by side, which is the entire
    point. Nothing here needs a dendrogram.

    The payoff is that the wall says something at a glance: a run of sheets
    built on the same material sits together, and a reading that shares nothing
    with anything ends up alone at the end — which is itself worth seeing.
  */
  const wall = useMemo(() => {
    if (readings.length < 3) return readings;
    const idsOf = (r: Reading) => new Set(r.evidence.map((e) => e.id).filter(Boolean));
    const sets = new Map(readings.map((r) => [r.id, idsOf(r)]));
    const shared = (a: Reading, b: Reading) => {
      const sa = sets.get(a.id)!;
      const sb = sets.get(b.id)!;
      let n = 0;
      for (const id of sa) if (sb.has(id)) n += 1;
      return n;
    };
    const rest = [...readings];
    rest.sort((a, b) => b.evidence.length - a.evidence.length);
    const out: Reading[] = [rest.shift()!];
    while (rest.length) {
      const last = out[out.length - 1]!;
      let best = 0;
      for (let i = 1; i < rest.length; i += 1) {
        if (shared(last, rest[i]!) > shared(last, rest[best]!)) best = i;
      }
      out.push(rest.splice(best, 1)[0]!);
    }
    return out;
  }, [readings]);

  /*
    The three things you can do about a provisional claim, and all of them
    live ON THE SHEET.

    An earlier cut put "rewrite / hold / take it down" as three text buttons
    inside the opened reading. That is one level too far in: judging a reading
    is something you do while looking at the wall, not something you navigate
    to, and three words of UI under the claim competed with the claim.

    Rewriting is not a button at all now — the sentence on the sheet IS the
    editable thing, the way it was in the shipped wall. Pin and take-down are
    two small marks in the corner of the paper.
  */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<Reading | null>(null);
  const undoTimer = useRef<number | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  /* Autosave, debounced. A correction you have to confirm is a correction you
     will abandon halfway. */
  const rewrite = useCallback((reading: Reading, next: string) => {
    if (reading.scope !== "solo") return;
    setDrafts((current) => ({ ...current, [reading.id]: next }));
    if (saveTimers.current[reading.id]) window.clearTimeout(saveTimers.current[reading.id]);
    saveTimers.current[reading.id] = window.setTimeout(() => {
      const text = next.trim();
      if (!text || text === reading.text) return;
      void updateTopOfMindNote(reading.id, { title: text })
        .then((updated) => {
          const canonical = readingFromSoloNote(updated);
          setReadings((current) =>
            current.map((r) => (r.id === reading.id ? canonical : r)),
          );
          setSurfaceNotice(null);
        })
        .catch((error) => {
          setDrafts((current) => ({ ...current, [reading.id]: reading.text }));
          setSurfaceNotice(
            error instanceof Error ? error.message : "That correction was not saved.",
          );
        });
    }, 900);
  }, []);

  const hold = useCallback((reading: Reading) => {
    if (reading.scope !== "solo") return;
    const pinned = !reading.isPinned;
    void setTopOfMindNotePinned(reading.id, pinned)
      .then((updated) => {
        const canonical = readingFromSoloNote(updated);
        setReadings((current) =>
          current.map((item) => (item.id === reading.id ? canonical : item)),
        );
        setSurfaceNotice(null);
      })
      .catch((error) => {
        setSurfaceNotice(error instanceof Error ? error.message : "That note did not move.");
      });
  }, []);

  const takeDown = useCallback((reading: Reading) => {
    if (reading.scope !== "solo") return;
    void dismissTopOfMindNote(reading.id)
      .then(() => {
        setReadings((current) => current.filter((r) => r.id !== reading.id));
        soloAll.current = soloAll.current.filter((r) => r.id !== reading.id);
        if (undoTimer.current) window.clearTimeout(undoTimer.current);
        setUndo(reading);
        undoTimer.current = window.setTimeout(() => setUndo(null), 4200);
        setSurfaceNotice(null);
      })
      .catch((error) => {
        setSurfaceNotice(
          error instanceof Error ? error.message : "That note could not be taken down.",
        );
      });
  }, []);

  /*
    A save's own text is editable, exactly as a reading's is. Same autosave,
    same absence of an edit mode — you correct the thing by typing into it.
  */
  const [saveDraft, setSaveDraft] = useState<string | null>(null);
  const [saveRating, setSaveRating] = useState<"true" | "partly" | "not_true" | null>(null);
  const saveTimer = useRef<number | null>(null);

  const rewriteSave = useCallback(
    (id: string, next: string) => {
      setSaveDraft(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const text = next.trim();
        if (!text) return;
        setFullText((current) => ({ ...current, [id]: text }));
        void updateInspiration(id, { text })
          .then(() => {
            sawSave(id, "inspiration_updated");
            setSurfaceNotice(null);
          })
          .catch((error) => {
            setSurfaceNotice(
              error instanceof Error ? error.message : "That change was not saved.",
            );
          });
      }, 900);
    },
    [sawSave],
  );

  /*
    Deleting a save asks first, and offers no undo.

    Taking a READING down is feedback — the note is retired and can be put
    back. Deleting an inspiration removes the material itself, server-side,
    permanently. Offering "put it back" for something that cannot come back
    would be the product lying about what it just did, so this is the one act
    on the surface that stops and asks.
  */
  const dropSave = useCallback(async (signal: ApiSavedSignalSearchResult) => {
    if (
      !window.confirm(
        "Delete this inspiration? Readings already made from it stay, but it cannot be brought back.",
      )
    ) {
      return;
    }
    try {
      await deleteInspiration(signal.id);
      setResults((current) => current.filter((r) => r.id !== signal.id));
      setOpenSave(null);
      navigateSurface("ask", { replace: true });
      setSurfaceNotice(null);
    } catch (error) {
      setSurfaceNotice(
        error instanceof Error ? error.message : "That inspiration was not deleted.",
      );
    }
  }, [navigateSurface]);

  /*
    Public or private, from the list.

    Changing this used to mean opening saves one at a time, which made a
    privacy setting something you could not audit -- to answer "what have I
    left public?" you had to open everything. It belongs where the archive is.

    Optimistic, and it reverts on failure: the toggle is the only feedback,
    so a flip that silently did not persist would be a lie about a privacy
    setting, which is the worst kind to tell.
  */
  const toggleShared = useCallback(
    async (signal: ApiSavedSignalSearchResult) => {
      const next = !signal.shared;
      // Exposing is the direction that cannot be fully taken back.
      if (next && !window.confirm(confirmGoingPublicMessage())) return;
      const apply = (shared: boolean) => {
        setResults((current) =>
          current.map((r) => (r.id === signal.id ? { ...r, shared } : r)),
        );
        // The detail view may be open on this same save.
        setOpenSave((current) =>
          current && current.id === signal.id ? { ...current, shared } : current,
        );
        setOpenSaveShared((current) => (openSave?.id === signal.id ? shared : current));
      };

      apply(next);
      try {
        await setInspirationSharing(signal.id, next);
        setSurfaceNotice(null);
      } catch (error) {
        apply(signal.shared);
        setSurfaceNotice(
          error instanceof Error ? error.message : "That sharing preference was not saved.",
        );
      }
    },
    [openSave?.id],
  );

  const dropReflection = useCallback(async (reflection: ApiReflection) => {
    try {
      await deleteReflection(reflection.inspirationId, reflection.id);
      setReflections((current) => current.filter((r) => r.id !== reflection.id));
      setSurfaceNotice(null);
    } catch (error) {
      setSurfaceNotice(
        error instanceof Error ? error.message : "That reflection was not deleted.",
      );
    }
  }, []);

  /*
    Reading the room again.

    A room-level act, so it belongs to the room's name rather than to a
    toolbar. The server owns the cooldown and says whether it actually looked,
    so the surface reports what happened rather than assuming.
  */
  const [rereading, setRereading] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(null);

  // URL navigation can change rooms through Back/Forward without running a
  // room-menu click handler. Clear the prior room's visible data immediately
  // so it cannot flash under the next room while its saved wall loads.
  useEffect(() => {
    if (previousRoom.current === room) return;
    previousRoom.current = room;
    setLoading(true);
    setReadings([]);
    setMembers([]);
    setDirection(null);
    setRoomGenerationStatus(null);
    setSelectedDirectionVersion(null);
    setOpenReading(null);
    setOpenEvidence([]);
    setOpenSave(null);
    setLastRead(null);
    setBoards({});
  }, [room]);

  /* When the room last wrote anything — the newest reading on the wall is the
     honest proxy, since that is the last time a pass produced something. */
  const lastReadLabel = useMemo(() => {
    const newest = readings
      .map((r) => (r.createdAt ? Date.parse(r.createdAt) : 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a)[0];
    if (!newest) return "not read yet";
    const mins = Math.round((Date.now() - newest) / 60000);
    if (mins < 2) return "last read just now";
    if (mins < 60) return `last read ${mins} minutes ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `last read ${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `last read ${days} day${days === 1 ? "" : "s"} ago`;
  }, [readings]);

  const reread = useCallback(async () => {
    if (rereading) return;
    setRereading(true);
    try {
      if (!room) {
        await refreshTopOfMind();
        const status = await fetchTopOfMindStatus();
        setGenerationStatus(status);
        setLastRead("reading your context now…");
        return;
      }
      const status = await requestGroupReadingRefresh(room);
      setRoomGenerationStatus(status);
      setLastRead(
        status.phase === "processing"
          ? "reading new shared material…"
          : status.message,
      );
    } catch (error) {
      setLastRead("could not read this just now");
      setSurfaceNotice(error instanceof Error ? error.message : "The reading did not start.");
    } finally {
      setRereading(false);
    }
  }, [rereading, room]);

  /* Once the wall changes, drop the one-off message and go back to the
     relative time — a status line that never resets becomes a lie. */
  useEffect(() => {
    if (!lastRead) return undefined;
    const timer = window.setTimeout(() => setLastRead(null), 6000);
    return () => window.clearTimeout(timer);
  }, [lastRead]);

  const shapeDirection = useCallback(() => {
    if (!room) return;
    setSelectedDirectionVersion(null);
    if (state !== "direction") navigateSurface("direction");
    window.setTimeout(() => {
      directionInputRef.current?.scrollIntoView({ block: "center" });
      directionInputRef.current?.focus({ preventScroll: true });
    }, 60);
  }, [navigateSurface, room, state]);

  const saveDirectionContribution = useCallback(async () => {
    if (!room || !directionDraft.trim() || directionSaving) return;
    setDirectionSaving(true);
    try {
      const result = await addGroupDirectionContribution(room, {
        kind: "take",
        body: directionDraft.trim(),
      });
      const contribution = result.contribution;
      setDirection((current) =>
        current
          ? {
              ...current,
              contributorCount: result.contributorCount,
              requiredContributors: result.requiredContributors,
              contributions: [
                contribution,
                ...current.contributions.filter((item) => item.id !== contribution.id),
              ],
            }
          : current,
      );
      setDirectionDraft("");
      setSurfaceNotice(null);

      // The note is already durable. These reads only surface whether the room
      // has enough collective movement to prepare a proposal yet.
      const [nextDirection, status] = await Promise.all([
        fetchGroupDirection(room),
        fetchGroupReadingStatus(room, { ensure: false }),
      ]);
      setDirection(nextDirection);
      setRoomGenerationStatus(status);
    } catch (error) {
      setSurfaceNotice(
        error instanceof Error ? error.message : "That thought was not added to the room.",
      );
    } finally {
      setDirectionSaving(false);
    }
  }, [directionDraft, directionSaving, room]);

  const reviewDirection = useCallback(
    async (value: "accept" | "keep_current") => {
      if (!room || !direction?.proposal || directionReviewing) return;
      setDirectionReviewing(true);
      try {
        const result = await respondToGroupDirectionProposal(
          room,
          direction.proposal.id,
          value,
        );
        setDirection(result.direction);
        setSelectedDirectionVersion(null);
        setSurfaceNotice(null);
        if (result.decision === "adopted") setLastRead("the room adopted a new top of mind");
        if (result.decision === "kept_current") setLastRead("the room kept its current top of mind");
      } catch (error) {
        setSurfaceNotice(
          error instanceof Error ? error.message : "That response was not saved.",
        );
      } finally {
        setDirectionReviewing(false);
      }
    },
    [direction?.proposal, directionReviewing, room],
  );

  const openDirectionVersion = useMemo(
    () =>
      selectedDirectionVersion
        ? direction?.history.find((version) => version.id === selectedDirectionVersion) ?? null
        : null,
    [direction?.history, selectedDirectionVersion],
  );

  const putBack = useCallback(() => {
    if (!undo) return;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    void restoreTopOfMindNote(undo.id)
      .then((restored) => {
        const canonical = readingFromSoloNote(restored);
        setUndo(null);
        setReadings((current) => [...current, canonical]);
        soloAll.current = [...soloAll.current, canonical];
        setSurfaceNotice(null);
      })
      .catch((error) => {
        setSurfaceNotice(
          error instanceof Error ? error.message : "That note could not be put back.",
        );
      });
  }, [undo]);

  /*
    Making a room, and getting into one.

    One field accepts either kind of value, but the two explicit verbs keep a
    one-word room name from being mistaken for an invite code.
  */
  /*
    An invite link OFFERS the join; it never performs it.

    `?join=CODE` puts your saved inspirations into a pool other people read.
    A link alone must not be enough to do that, so arriving with one stops the
    surface and asks — the one place on here where ceremony is correct.
  */
  const [offeredCode, setOfferedCode] = useState<string | null>(() => {
    const code = new URLSearchParams(location.search).get("join");
    return code && code.trim() ? code.trim() : null;
  });

  const acceptInvite = useCallback(async () => {
    if (!offeredCode) return;
    try {
      const joined = await joinGroup(offeredCode);
      setRooms((current) =>
        current.some((r) => r.id === joined.group.id) ? current : [...current, joined.group],
      );
      setLoading(true);
      setMembers([]);
      setDirection(null);
      setRoomGenerationStatus(null);
      setLastRead(null);
      navigateSurface("wall", { roomId: joined.group.id, replace: true });
    } catch (error) {
      setSurfaceNotice(
        error instanceof Error ? error.message : "That invitation could not be accepted.",
      );
      navigate(location.pathname, { replace: true });
    } finally {
      setOfferedCode(null);
    }
  }, [location.pathname, navigate, navigateSurface, offeredCode]);

  const declineInvite = useCallback(() => {
    setOfferedCode(null);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, navigate]);


  const [roomInput, setRoomInput] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [copied, setCopied] = useState(false);

  const makeOrJoinRoom = useCallback(async (intent: "make" | "join") => {
    const value = roomInput.trim();
    if (!value || roomBusy) return;
    setRoomBusy(true);
    setRoomError(null);
    try {
      const made =
        intent === "join"
          ? await joinGroup(value).then((r) => r.group)
          : await createGroup(value);
      setRooms((current) =>
        current.some((r) => r.id === made.id) ? current : [...current, made],
      );
      setRoomInput("");
      setLoading(true);
      setMembers([]);
      setDirection(null);
      setRoomGenerationStatus(null);
      setLastRead(null);
      navigateSurface("wall", { roomId: made.id });
    } catch (error) {
      setRoomError(
        error instanceof Error
          ? error.message
          : intent === "join"
            ? "That room code could not be found."
            : "That room could not be made.",
      );
    } finally {
      setRoomBusy(false);
    }
  }, [navigateSurface, roomBusy, roomInput]);

  /* A <details> menu has no controlled state, so closing one after a choice
     means reaching for the element. */
  const closeMenus = useCallback(() => {
    document.querySelectorAll<HTMLDetailsElement>(".sf-foot details[open]").forEach((el) => {
      el.open = false;
    });
  }, []);

  /*
    Going to a wall — yours, or a room's.

    Written out twice before, once for your own wall and once per room, with
    five pieces of state to clear in the same order both times. Extracted
    because your own wall is about to stop being an item in the rooms menu,
    and two copies of a reset is how one of them ends up showing the previous
    room's cast under the next room's name.

    Same wall, different state (capture -> wall) is not a switch: clearing the
    room's members and direction there would blank the header and re-fetch
    everything to arrive back where you already were.
  */
  const goToWall = useCallback(
    (roomId: SurfaceRoomId) => {
      if (roomId !== room) {
        setLoading(true);
        setMembers([]);
        setDirection(null);
        setRoomGenerationStatus(null);
        setLastRead(null);
      }
      navigateSurface("wall", { roomId });
      closeMenus();
    },
    [closeMenus, navigateSurface, room],
  );

  const roomName = room ? (rooms.find((r) => r.id === room)?.name ?? "room") : "your top of mind";
  const activeRoom = room ? (rooms.find((r) => r.id === room) ?? null) : null;
  const hasRevealedDirection =
    direction?.current?.state === "revealed" && Boolean(direction.current.ambition);
  const roomIsReading = roomGenerationStatus?.phase === "processing";
  const directionContributorCount = direction?.contributorCount ?? 0;
  const sharedInspirationCount =
    direction?.sharedInspirationCount ?? roomGenerationStatus?.sharedSignalCount ?? 0;
  const sharedContributorCount = direction?.sharedContributorCount ?? 0;
  const firstReadPresentation = roomFirstReadPresentation({
    memberCount: members.length,
    sharedInspirationCount,
    phase: roomGenerationStatus?.phase ?? null,
    loading,
    hasFormingRead: direction?.current?.state === "forming",
  });
  const copyRoomInvite = useCallback(async () => {
    if (!activeRoom?.joinCode) return;
    const inviteUrl = new URL("/", window.location.origin);
    inviteUrl.searchParams.set("join", activeRoom.joinCode);
    if (!navigator.clipboard) {
      setSurfaceNotice("Copy is unavailable here. Open the people menu to select the room code.");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl.toString());
      setCopied(true);
      setSurfaceNotice(null);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setSurfaceNotice("The invite link could not be copied.");
    }
  }, [activeRoom?.joinCode]);

  // The name steps back when the surface is busy: still present, so you always
  // know which wall you are at, but no longer competing with what you came to
  // read.
  const busy = state !== "wall";

  /*
    Who is in this room, and how someone else gets in.

    Opened from the face pile in the bar rather than from a cog: the faces are
    already the roster, so the actions belong to them. Not a settings form —
    the name is editable where it sits, the code is one line you click to
    copy, and removing someone appears only on the row you are pointing at,
    because it is rare and it is not what this panel is for.
  */
  const roomPanel = room ? (
    <>
      <input
        className="sf-roomname-edit"
        defaultValue={roomName}
        aria-label="room name"
        onChange={(event) => setRenameTo(event.target.value)}
        onBlur={() => {
          const next = renameTo.trim();
          if (!next || next === roomName) return;
          void renameGroup(room, next)
            .then(() => {
              setRooms((current) =>
                current.map((r) => (r.id === room ? { ...r, name: next } : r)),
              );
              setSurfaceNotice(null);
            })
            .catch((error) => {
              setSurfaceNotice(
                error instanceof Error ? error.message : "That room was not renamed.",
              );
            });
        }}
      />

      {activeRoom?.joinCode ? (
        <button
          type="button"
          className="sf-invite"
          onClick={() => void copyRoomInvite()}
        >
          <span className="sf-invite-code">{activeRoom.joinCode}</span>
          <small>{copied ? "copied" : "invite someone"}</small>
        </button>
      ) : null}

      <ul className="sf-members">
        {members.map((member) => (
          <li key={member.userId}>
            <span className="sf-face" style={{ background: contributorColor(member.name) }}>
              {contributorInitials(member.name)}
            </span>
            <span className="sf-member-name">{member.name}</span>
            <span className="sf-member-when">
              {joinedAt.get(member.userId)
                ? `since ${new Date(joinedAt.get(member.userId)!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`
                : "from the start"}
            </span>
            {member.userId !== user?.id ? (
              <button
                type="button"
                className="sf-remove"
                onClick={() => {
                  void removeGroupMember(room, member.userId)
                    .then(() => {
                      setMembers((current) =>
                        current.filter((m) => m.userId !== member.userId),
                      );
                      setSurfaceNotice(null);
                    })
                    .catch((error) => {
                      setSurfaceNotice(
                        error instanceof Error ? error.message : "That person was not removed.",
                      );
                    });
                }}
              >
                remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {/*
        Deleting the room is the owner's version of leaving, and it ends it for
        everyone — so it is the only control here that names the consequence in
        the confirmation rather than in a label.
      */}
      {activeRoom?.role === "owner" ? (
        <button
          type="button"
          className="sf-leave"
          onClick={async () => {
            if (
              !window.confirm(
                `Delete “${roomName}” for everyone? The readings it made are lost with it.`,
              )
            ) {
              return;
            }
            try {
              await deleteGroup(room);
              setRooms((current) => current.filter((r) => r.id !== room));
              navigateSurface("wall", { roomId: null, replace: true });
            } catch (error) {
              setSurfaceNotice(
                error instanceof Error ? error.message : "That room was not deleted.",
              );
            }
          }}
        >
          delete this room
        </button>
      ) : null}

      <button
        type="button"
        className="sf-leave"
        onClick={async () => {
          if (!window.confirm("Leave this room? Your saves stop being read here.")) return;
          try {
            await leaveGroup(room);
            setRooms((current) => current.filter((r) => r.id !== room));
            navigateSurface("wall", { roomId: null, replace: true });
          } catch (error) {
            setSurfaceNotice(
              error instanceof Error ? error.message : "You did not leave the room.",
            );
          }
        }}
      >
        leave this room
      </button>
    </>
  ) : null;

  return (
    <div
      className="sf"
      data-state={state}
      data-busy={busy ? "true" : "false"}
      data-dropping={dropping ? "true" : "false"}
    >
      {offeredCode ? (
        <div className="sf-invite-offer" role="dialog" aria-label="an invitation">
          <p className="sf-claim">You have been invited into a room.</p>
          <p className="sf-invite-what">
            Joining puts what you have saved into a pool the people in that room read, and
            puts theirs in front of you. You can leave at any time.
          </p>
          <div className="sf-invite-acts">
            <button type="button" className="sf-accept" onClick={() => void acceptInvite()}>
              join this room
            </button>
            <button type="button" className="sf-quiet" onClick={declineInvite}>
              not now
            </button>
          </div>
        </div>
      ) : null}

      <header className="sf-head">
        {/*
          The name, and nothing else.

          It used to carry a headline above it ("6 readings held") and a line
          beneath ("alone"). Both were telling you what you can already see:
          the readings are on the wall, and if nobody else's face is anywhere
          on the screen then you are on your own. A header that narrates the
          page is a header doing the page's job badly.

          Who is in a room now lives where every other person on this surface
          does — the face pile at the end of the bar, beside yours.
        */}
        <h1 className="sf-roomname">{roomName}</h1>
        {/*
          Reading the room again is a room-level act, so it belongs to the
          room's name rather than to a toolbar. The server owns the cooldown
          and reports whether it actually looked, so this says what happened
          instead of assuming it worked.
        */}
        {/*
          When it was last read, and a way to read it again.

          The time is a FACT, not a control — making the whole sentence
          clickable meant the only way to learn what "reading" does here was
          to do it, which is a poor trade for something that spends model
          budget. So the sentence just says when, quietly, and the rotate beside
          it is the button. Icon and text, each doing one job.
        */}
        <p className="sf-lastread">
          <span>
            {lastRead ??
              (room && loading
                ? "opening the saved room…"
                : room && roomGenerationStatus?.phase === "processing"
                ? "reading new shared material…"
                : lastReadLabel)}
          </span>
          <button
            type="button"
            className={`sf-reread${rereading || loading || (!room && generationStatus?.phase === "processing") || (room && roomGenerationStatus?.phase === "processing") ? " spinning" : ""}`}
            onClick={() => void reread()}
            disabled={
              rereading ||
              loading ||
              (!room && generationStatus?.phase === "processing") ||
              Boolean(room && roomGenerationStatus?.phase === "processing")
            }
            title="read this room again"
            aria-label="read this room again"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
              <path d="M20.6 4.4v4.4h-4.4" />
            </svg>
          </button>
        </p>
        {/*
          The room's shared top of mind belongs to the room's wall.

          This rendered in every state except `direction`, so the living draft
          followed you into capture, into your inspirations, into a save you had
          opened — surfaces that are yours alone and have nothing to do with
          what a room is finding. A persistent strip about other people sitting
          above a private archive is not context, it is noise, and it made the
          room feel inescapable rather than present.

          The wall is where the room's reading lives; everywhere else the head
          still names the room, which is enough to know where you are.
        */}
        {room && state === "wall" ? (
          <section
            className="sf-room-intent"
            data-state={direction?.current?.state ?? "forming"}
            aria-label="shared top of mind"
          >
            <div className="sf-room-intent-head">
              <small>
                shared top of mind · {hasRevealedDirection
                  ? "living draft"
                  : roomIsReading || !direction?.current
                    ? "first read in progress"
                    : "open to the room"}
              </small>
              {direction?.proposal ? (
                <span className="sf-direction-new">next version ready</span>
              ) : null}
            </div>
            <p className="sf-room-intent-claim">
              {direction?.current?.ambition ??
                (loading
                  ? "Opening the room’s saved read…"
                  : firstReadPresentation.title)}
            </p>
            <div className="sf-room-intent-foot">
              {/*
                Faces first — WHO this version traces to, shown rather than
                counted. The line that follows only says what the faces
                cannot: how old the version is, and what has arrived since.
              */}
              {direction?.current?.evidence.length ? (
                <span
                  className="sf-direction-faces"
                  aria-label={`${direction.current.contributorCount} members represented in this draft`}
                >
                  {Array.from(
                    new Map(
                      direction.current.evidence.map((item) => [item.userId, item.memberName]),
                    ).entries(),
                  ).map(([userId, name]) => (
                    <span
                      key={userId}
                      className="sf-face"
                      title={name}
                      style={{ background: contributorColor(name) }}
                    >
                      {contributorInitials(name)}
                    </span>
                  ))}
                </span>
              ) : null}
              {direction ? (
                <span className="sf-room-intent-meta">
                  {roomIntentMetaCopy({
                    hasCurrent: Boolean(direction.current),
                    when: direction.current ? whenShort(direction.current.createdAt) : "",
                    newInspirationCount: direction.newInspirationCount,
                    sharedContributorCount: direction.sharedContributorCount,
                    memberCount: direction.memberCount,
                  })}
                </span>
              ) : null}
              <button
                type="button"
                className="sf-control sf-control--primary sf-direction-open"
                onClick={() => {
                  if (members.length < 2) {
                    void copyRoomInvite();
                    return;
                  }
                  setSelectedDirectionVersion(null);
                  navigateSurface("direction");
                  window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
                }}
              >
                {roomDirectionCtaCopy({
                  memberCount: members.length,
                  hasProposal: Boolean(direction?.proposal),
                  hasCurrent: Boolean(direction?.current),
                  inviteCopied: copied,
                })}
              </button>
            </div>
          </section>
        ) : null}
      </header>

      <div className="sf-body">
        {surfaceNotice ? (
          <p className="sf-surface-notice" role="alert">{surfaceNotice}</p>
        ) : null}
        {/* ---------------------------------------------------------- WALL */}
        <section className={`sf-layer sf-layer--wall${state === "wall" ? " on" : ""}`}>
          {showsDebug() ? (
            <button
              type="button"
              className="sf-orbit-toggle"
              onClick={toggleOrbitWall}
              aria-pressed={orbitWall}
            >
              {orbitWall ? "flat wall" : "orbit"}
            </button>
          ) : null}
          {loading ? null : readings.length === 0 ? (
            <p className="sf-empty">
              {!room && generationStatus
                ? generationStatus.message
                : roomGenerationStatus
                  ? roomGenerationStatus.message
                  : room && members.length < 2
                  ? "This room needs another person before it can make a shared reading. Use the + by your face to invite someone."
                  : "Nothing here holds yet. That is about the material, not about anyone in the room."}
            </p>
          ) : orbitWall ? (
            <OrbitBoard
              notes={wall.map((reading) => ({
                id: reading.id,
                text: reading.text,
                hands: reading.hands,
                evidenceCount: reading.evidence.length,
                isPinned: reading.isPinned,
              }))}
              center={
                room
                  ? {
                      label: roomName,
                      ambition: direction?.current?.ambition ?? null,
                      meta: direction?.current
                        ? `current · v${direction.current.versionNumber}`
                        : null,
                    }
                  : {
                      /* Your wall is a room of one; its adopted ambition
                         arrives with the goal's Phase 0. Forming is honest,
                         not a placeholder for a bug. */
                      label: roomName,
                      ambition: null,
                      meta: null,
                    }
              }
            />
          ) : (
            <div className="sf-wall">
              {wall.map((reading, i) => {
                const layout = NOTE_LAYOUTS[i % NOTE_LAYOUTS.length]!;
                const paper = NOTE_COLORS[i % NOTE_COLORS.length]!;
                const drag = drags[i] ?? { x: 0, y: 0 };
                return (
                  <article
                    key={reading.id}
                    className={`sf-postit${dragging === i ? " sf-postit--dragging" : ""}${reading.isPinned ? " sf-postit--held" : ""}`}
                    style={{
                      ["--bg" as string]: paper.hue,
                      ["--ink" as string]: paper.ink,
                      ["--tilt" as string]: `${layout.tilt}deg`,
                      ["--w" as string]: layout.w,
                      ["--dx" as string]: `${drag.x}px`,
                      ["--dy" as string]: `${drag.y}px`,
                    }}
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest("button")) return;
                      const base = drags[i] ?? { x: 0, y: 0 };
                      dragFrom.current = {
                        i,
                        x: event.clientX,
                        y: event.clientY,
                        baseX: base.x,
                        baseY: base.y,
                      };
                      dragMoved.current = false;
                      setDragging(i);
                    }}

                  >
                    {/*
                      The sentence IS the editable thing, exactly as it was on
                      the shipped wall — no button, no mode, no pencil icon.
                      You click into a reading about yourself and change it,
                      which is the least ceremonious possible way to disagree.
                      Autosaved, because a correction you have to confirm is a
                      correction you abandon halfway.
                    */}
                    <textarea
                      className="sf-postit-text"
                      value={drafts[reading.id] ?? reading.text}
                      rows={1}
                      spellCheck
                      readOnly={reading.scope === "group"}
                      aria-label={
                        reading.scope === "solo"
                          ? "this reading — edit to correct it"
                          : "shared room reading"
                      }
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => rewrite(reading, event.target.value)}
                    />
                    <footer>
                      <button
                        type="button"
                        className="sf-provenance"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          enterReading(reading);
                        }}
                      >
                        {reading.hands.length > 0 ? (
                          <span className="sf-faces">
                            {reading.hands.map((name) => (
                              <span
                                key={name}
                                className="sf-face"
                                style={{ background: contributorColor(name) }}
                              >
                                {contributorInitials(name)}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        <span>
                          {reading.hands.length > 0 ? `${reading.hands.join(", ")} · ` : ""}
                          {reading.evidence.length}
                        </span>
                      </button>
                      {reading.createdAt ? (
                        <span className="sf-when">{whenShort(reading.createdAt)}</span>
                      ) : null}
                      {/*
                        Hold it, or take it down — in the footer row, in fixed
                        slots, present at rest.

                        They were floated in the sheet's top-right and revealed
                        on hover, so the note reserved an empty square it only
                        filled when pointed at: dead space at rest, and a
                        layout that shifted under the cursor. Here the row is
                        the same shape always and only their contrast changes.
                      */}
                      {reading.scope === "solo" ? (
                      <span className="sf-postit-acts">
                        <button
                          type="button"
                          className={`sf-act${reading.isPinned ? " on" : ""}`}
                          title={reading.isPinned ? "held — click to release" : "hold this"}
                          aria-label={reading.isPinned ? "release" : "hold"}
                          aria-pressed={reading.isPinned}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            hold(reading);
                          }}
                        >
                          {/* The classic pushpin, verbatim. */}
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M14.8 3.4 20.6 9.2" />
                            <path d="M15.7 4.3 11.4 8.6 8 8.2 6.4 9.8 14.2 17.6 15.8 16 15.4 12.6 19.7 8.3" />
                            <path d="M10.4 14.4 4 20.8" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sf-act"
                          title="take it down"
                          aria-label="take it down"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            takeDown(reading);
                          }}
                        >
                          {/* And the classic bin. */}
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4 7h16" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M6.5 7 7.4 20h9.2l.9-13" />
                            <path d="M9 7V4.8h6V7" />
                          </svg>
                        </button>
                      </span>
                      ) : null}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------- SHARED TOP OF MIND */}
        <section
          className={`sf-layer sf-layer--direction${state === "direction" ? " on" : ""}`}
          aria-label="shape this room's shared top of mind"
        >
          {room ? (
            <div className="sf-direction-workspace">
              <main className="sf-direction-main">
                <div className="sf-direction-titleline">
                  <div>
                    <span className="sf-label">SHARED TOP OF MIND</span>
                    <h2>What we’re finding together</h2>
                    <p className="sf-direction-titleline-note">
                      Shared inspirations are the evidence. Member takes guide the next read; the room decides each new version.
                    </p>
                  </div>
                  {direction?.current && direction.newInspirationCount ? (
                    <span>
                      {direction.newInspirationCount} new inspiration{direction.newInspirationCount === 1 ? "" : "s"} from {direction.newContributorCount} member{direction.newContributorCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                {openDirectionVersion ? (
                  <article className="sf-direction-version-focus">
                    <button
                      type="button"
                      className="sf-quiet"
                      onClick={() => setSelectedDirectionVersion(null)}
                    >
                      ← back to the current version
                    </button>
                    <span className="sf-label">
                      VERSION {openDirectionVersion.versionNumber} · {" "}
                      {new Date(openDirectionVersion.createdAt).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <p className="sf-direction-statement">{openDirectionVersion.ambition}</p>
                    {openDirectionVersion.changeSummary ? (
                      <p className="sf-direction-change">{openDirectionVersion.changeSummary}</p>
                    ) : (
                      <p className="sf-direction-change">The room’s first shared top of mind.</p>
                    )}
                    {openDirectionVersion.evidence.length ? (
                      <div className="sf-direction-evidence">
                        <span className="sf-label">SHARED INSPIRATIONS BEHIND IT</span>
                        {openDirectionVersion.evidence.map((piece) => (
                          <blockquote key={`${piece.signalId}:${piece.quote}`}>
                            <p>“{piece.quote}”</p>
                            <footer>shared by {piece.memberName}</footer>
                          </blockquote>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ) : (
                  <>
                    {hasRevealedDirection && direction?.current ? (
                      <article className="sf-direction-current">
                        <span className="sf-label">
                          CURRENT · VERSION {direction.current.versionNumber} · LIVING DRAFT
                        </span>
                        <p className="sf-direction-statement">{direction.current.ambition}</p>
                        <p className="sf-direction-current-meta">
                          {roomDirectionEvidenceCopy(
                            direction.current.evidence,
                            direction.memberCount,
                          )} · {whenShort(direction.current.createdAt)}
                        </p>
                      </article>
                    ) : (
                      <article className="sf-direction-forming">
                        <span className="sf-label">{firstReadPresentation.label}</span>
                        <h3>{firstReadPresentation.title}</h3>
                        {firstReadPresentation.detail ? (
                          <p className="sf-direction-forming-note">
                            {firstReadPresentation.detail}
                          </p>
                        ) : null}
                        {!loading ? (
                          <div className="sf-direction-material-count">
                            <b>{sharedInspirationCount}</b>
                            <span>shared inspiration{sharedInspirationCount === 1 ? "" : "s"}</span>
                            <b>{sharedContributorCount}/{members.length}</b>
                            <span>
                              members brought inspiration
                              {direction && sharedContributorCount < direction.requiredContributors
                                ? ` · ${direction.requiredContributors - sharedContributorCount} more needed`
                                : ""}
                            </span>
                          </div>
                        ) : null}
                        {!loading && members.length < 2 ? (
                          <button
                            type="button"
                            className="sf-direction-primary"
                            onClick={() => void copyRoomInvite()}
                          >
                            {copied ? "invite link copied" : "invite someone"}
                          </button>
                        ) : roomGenerationStatus?.phase === "failed" ? (
                          <button
                            type="button"
                            className="sf-direction-primary"
                            disabled={rereading}
                            onClick={() => void reread()}
                          >
                            {rereading ? "trying again…" : "read the room again"}
                          </button>
                        ) : null}
                      </article>
                    )}

                    {direction?.proposal?.ambition ? (
                      <article className="sf-direction-proposal">
                        <div className="sf-direction-proposal-head">
                          <span className="sf-label">POSSIBLE NEXT VERSION</span>
                          <span>
                            {roomProposalReviewCopy(
                              direction.responses.length,
                              direction.memberCount,
                              direction.requiredResponses,
                            )}
                          </span>
                        </div>
                        <p className="sf-direction-proposal-statement">
                          {direction.proposal.ambition}
                        </p>
                        {direction.proposal.changeSummary ? (
                          <details className="sf-direction-proposal-change">
                            <summary>What changed</summary>
                            <p>{direction.proposal.changeSummary}</p>
                          </details>
                        ) : null}
                        <div className="sf-direction-review-actions">
                          <button
                            type="button"
                            className={direction.viewerResponse === "accept" ? "on" : ""}
                            aria-pressed={direction.viewerResponse === "accept"}
                            disabled={directionReviewing}
                            onClick={() => void reviewDirection("accept")}
                          >
                            adopt this version
                          </button>
                          <button
                            type="button"
                            className={direction.viewerResponse === "keep_current" ? "on" : ""}
                            aria-pressed={direction.viewerResponse === "keep_current"}
                            disabled={directionReviewing}
                            onClick={() => void reviewDirection("keep_current")}
                          >
                            keep the current one
                          </button>
                          <button type="button" className="sf-quiet" onClick={() => shapeDirection()}>
                            add another take
                          </button>
                        </div>
                      </article>
                    ) : null}

                    {hasRevealedDirection && direction?.current ? (
                      <details className="sf-direction-context" open>
                        <summary>
                          <span>Why this read</span>
                          <small>{direction.current.facets.length} detail{direction.current.facets.length === 1 ? "" : "s"} · {direction.current.evidence.length} source quote{direction.current.evidence.length === 1 ? "" : "s"}</small>
                        </summary>
                        <div className="sf-direction-context-body">
                          {direction.current.facets.length ? (
                            <div className="sf-direction-growth">
                              <small>what this read notices</small>
                              {direction.current.facets.map((facet) => (
                                <p key={`${facet.dimension}:${facet.text}`}>
                                  <b>{facet.dimension}</b>
                                  {facet.text}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          <div className="sf-direction-details">
                            {direction.current.awayFrom ? (
                              <div>
                                <small>moving away from</small>
                                <p>{direction.current.awayFrom}</p>
                              </div>
                            ) : null}
                            {direction.current.tension ? (
                              <div>
                                <small>a tension worth keeping</small>
                                <p>{direction.current.tension}</p>
                              </div>
                            ) : null}
                            {direction.current.nextQuestion ? (
                              <div>
                                <small>open question</small>
                                <p>{direction.current.nextQuestion}</p>
                              </div>
                            ) : null}
                          </div>
                          {direction.current.evidence.length ? (
                            <div className="sf-direction-evidence">
                              <span className="sf-label">SHARED INSPIRATIONS BEHIND IT</span>
                              {direction.current.evidence.map((piece) => (
                                <blockquote key={`${piece.signalId}:${piece.quote}`}>
                                  <p>“{piece.quote}”</p>
                                  <footer>shared by {piece.memberName}</footer>
                                </blockquote>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}

                    {direction?.current ? (
                    <section className="sf-direction-shape">
                      <div className="sf-direction-shape-head">
                        <h3>Shape this together</h3>
                        {direction?.current && members.length >= 2 ? (
                          <span>
                            {roomShapingProgressCopy(
                              directionContributorCount,
                              direction.memberCount,
                            )}
                          </span>
                        ) : null}
                      </div>
                      {direction?.current && members.length >= 2 ? (
                        <div className="sf-direction-compose">
                          <p className="sf-direction-shape-next">
                            {roomShapingNextStepCopy({
                              contributorCount: directionContributorCount,
                              requiredContributors: direction.requiredContributors,
                              state: direction.current.state,
                              phase: roomGenerationStatus?.phase ?? null,
                              hasProposal: Boolean(direction.proposal),
                            })}
                          </p>
                          <label className="sr-only" htmlFor="sf-direction-thought">
                            Your take on this shared read
                          </label>
                          <textarea
                            id="sf-direction-thought"
                            ref={directionInputRef}
                            value={directionDraft}
                            maxLength={600}
                            placeholder="What should this read say?"
                            onChange={(event) => setDirectionDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                void saveDirectionContribution();
                              }
                            }}
                          />
                          <div>
                            <button
                              type="button"
                              disabled={!directionDraft.trim() || directionSaving}
                              onClick={() => void saveDirectionContribution()}
                            >
                              {directionSaving ? "adding…" : "add my take"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="sf-direction-compose-locked">
                          {members.length < 2 ? (
                            <button
                              type="button"
                              className="sf-direction-primary"
                              onClick={() => void copyRoomInvite()}
                            >
                              {copied ? "invite link copied" : "invite someone"}
                            </button>
                          ) : (
                            <p>Preparing the first shared read…</p>
                          )}
                        </div>
                      )}
                      {direction?.contributions.length ? (
                        <div className="sf-direction-notes">
                          {direction.contributions.map((note, index) => {
                            const paper = NOTE_COLORS[index % NOTE_COLORS.length]!;
                            return (
                              <article
                                key={note.id}
                                style={{
                                  ["--bg" as string]: paper.hue,
                                  ["--ink" as string]: paper.ink,
                                  ["--note-tilt" as string]: `${index % 2 === 0 ? -0.8 : 0.7}deg`,
                                }}
                              >
                                <p>{note.body}</p>
                                <footer>
                                  <span
                                    className="sf-face"
                                    style={{ background: contributorColor(note.memberName) }}
                                  >
                                    {contributorInitials(note.memberName)}
                                  </span>
                                  {note.memberName}
                                </footer>
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>
                    ) : null}
                  </>
                )}
                {direction && direction.history.length > 1 ? (
                  <details className="sf-direction-history-disclosure">
                    <summary>Earlier versions ({direction.history.length - 1})</summary>
                    <div>
                      {direction.history
                        .filter((version) => version.id !== direction.current?.id)
                        .map((version) => (
                          <button
                            type="button"
                            key={version.id}
                            className={selectedDirectionVersion === version.id ? "on" : ""}
                            onClick={() => setSelectedDirectionVersion(version.id)}
                          >
                            <span>version {version.versionNumber} · {whenShort(version.createdAt)}</span>
                            <p>{version.changeSummary ?? (version.versionNumber === 1 ? "First shared top of mind" : version.ambition)}</p>
                          </button>
                        ))}
                    </div>
                  </details>
                ) : null}
              </main>
            </div>
          ) : null}
        </section>

        {/* ------------------------------------------------------- READING */}
        <section className={`sf-layer sf-layer--reading${state === "reading" ? " on" : ""}`}>
          {openReading ? (
            <div className="sf-column">
              <p className="sf-claim">{openReading.text}</p>
              <div className="sf-label">
                made from {openEvidence.length} inspiration
                {openEvidence.length === 1 ? "" : "s"}
                {openReading.scope === "group" ? " shared in this room" : " you saved"}
              </div>
              {/*
                One block per save, each with the hand that wrote it. A reading
                built from three saves across two people used to render as one
                save by one person, which said the opposite of what the room
                had actually done.
              */}
              {openEvidence.map((piece) => {
                const whole = fullText[piece.id];
                const isOpen = expanded.has(piece.id);
                const canOpenWhole = canLoadFullSignal(
                  openReading.scope,
                  piece.ownerUserId,
                  user?.id,
                );
                return (
                  <article key={piece.id} className="sf-evidence">
                    <header className="sf-evidence-head">
                      {piece.author ? (
                        <span
                          className="sf-face"
                          style={{ background: contributorColor(piece.author) }}
                        >
                          {contributorInitials(piece.author)}
                        </span>
                      ) : null}
                      <span className="sf-evidence-who">{piece.author ?? "you"}</span>
                    </header>
                    {isOpen ? (
                      <div className="sf-prose">
                        {paragraphs(whole ?? piece.text).map((block, i) => (
                          <p key={i}>{markQuote(block, piece.quote)}</p>
                        ))}
                      </div>
                    ) : piece.quote ? (
                      <p className="sf-said">{piece.quote}</p>
                    ) : (
                      /* 87% of citations name no words. Saying so beats showing
                         a truncation that looks identical to one that does. */
                      <p className="sf-said sf-said--none">
                        no exact words named — {paragraphs(piece.text)[0]?.slice(0, 120)}…
                      </p>
                    )}
                    {canOpenWhole ? (
                      <button
                        type="button"
                        className="sf-more"
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(piece.id)) next.delete(piece.id);
                            else next.add(piece.id);
                            return next;
                          })
                        }
                      >
                        {isOpen ? "less" : "the whole save"}
                      </button>
                    ) : (
                      <span className="sf-shared-excerpt">shared excerpt</span>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* ---------------------------------------------------------- SAVE */}
        <section className={`sf-layer sf-layer--save${state === "save" ? " on" : ""}`}>
          {openSave ? (
            <div className="sf-column">
              <button
                type="button"
                className="sf-back"
                onClick={() => navigateSurface("ask", { replace: true })}
              >
                ← what you have kept
              </button>
              <div className="sf-savemeta">
                kept {new Date(openSave.capturedAt).toLocaleDateString()}
              </div>
              {/* Your own words, and you can change them. Same rule as a
                  reading: the text is the field, autosaved, no edit mode. */}
              <textarea
                className="sf-savetext"
                value={saveDraft ?? fullText[openSave.id] ?? openSave.textPreview}
                aria-label="what you saved — edit to correct it"
                onChange={(event) => rewriteSave(openSave.id, event.target.value)}
              />
              {/*
                What it became. Reached by LOOKING, this is the question you
                actually have -- so it is open, not folded behind a toggle.
                Absent entirely when nothing has cited it, rather than showing
                a zero.
              */}
              {/*
                Reflecting. The machine asks, you answer — the one exchange in
                the product that runs that direction.

                Your answers are set at the same size as the question, never
                smaller: a surface where the machine's prose outranks the
                person's has decided who the record belongs to.
              */}
              <div className="sf-reflect">
                {reflections.map((r) => (
                  <div key={r.id} className="sf-reflect-past">
                    <p className="sf-reflect-q">{r.question}</p>
                    {r.answer ? <p className="sf-reflect-a">{r.answer}</p> : null}
                    {/* On hover only. Dropping one exchange is rare and should
                        not sit beside every answer you have ever given. */}
                    <button
                      type="button"
                      className="sf-remove sf-reflect-drop"
                      onClick={() => dropReflection(r)}
                    >
                      remove
                    </button>
                  </div>
                ))}
                {question ? (
                  <div className="sf-reflect-live">
                    <p className="sf-reflect-q">{question}</p>
                    <textarea
                      className="sf-reflect-field"
                      value={answer}
                      placeholder="…"
                      autoFocus
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          void saveAnswer();
                        }
                      }}
                      aria-label={question}
                    />
                    <div className="sf-reflect-foot">
                      <button
                        type="button"
                        onClick={() => void saveAnswer()}
                        disabled={!answer.trim() || answering}
                      >
                        {answering ? "keeping…" : "keep this answer"}
                      </button>
                      <button type="button" className="sf-quiet" onClick={() => setQuestion(null)}>
                        not now
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="sf-more"
                    onClick={() => void askNext()}
                    disabled={asking}
                  >
                    {asking
                      ? "thinking…"
                      : reflections.length > 0
                        ? "ask me another"
                        : "ask me something about this"}
                  </button>
                )}
              </div>

              {became.length > 0 ? (
                <div className="sf-became">
                  <div className="sf-label">BECAME</div>
                  {became.map((reading) => (
                    <div key={reading.note.id} className="sf-became-row">
                      <span className="sf-became-where">
                        {reading.context.scope === "alone" ? "alone" : reading.context.groupName}
                      </span>
                      <span className="sf-became-title">{reading.note.title}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {/* Content first, destructive last. */}
              {/*
                Whether the save itself still rings true.

                Distinct from correcting a READING: this is about the material,
                not about what the room made of it, and the scoring reads it.
                Three plain words rather than stars — the product's own
                vocabulary for a claim is true / partly / not true.
              */}
              <div className="sf-rate">
                {(["true", "partly", "not_true"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={saveRating === value ? "on" : ""}
                    onClick={() => {
                      void createFeedback({
                        targetType: "signal",
                        targetId: openSave.id,
                        value,
                      })
                        .then(() => {
                          setSaveRating(value);
                          setSurfaceNotice(null);
                        })
                        .catch((error) => {
                          setSurfaceNotice(
                            error instanceof Error ? error.message : "That response was not saved.",
                          );
                        });
                    }}
                  >
                    {value === "not_true" ? "not any more" : value === "partly" ? "partly" : "still true"}
                  </button>
                ))}
              </div>
              <div className="sf-save-foot">
                <span>kept {new Date(openSave.capturedAt).toLocaleDateString()}</span>
                <button
                  type="button"
                  className={`sf-control sf-control--toggle${
                    openSaveShared ? "" : " private"
                  }`}
                  aria-pressed={!openSaveShared}
                  aria-label={`${openSaveShared ? "Public" : "Private"}. ${
                    SHARING_MEANING[openSaveShared ? "public" : "private"]
                  } Click to make it ${openSaveShared ? "private" : "public"}.`}
                  onClick={() => {
                    const next = !openSaveShared;
                    if (next && !window.confirm(confirmGoingPublicMessage())) return;
                    void setInspirationSharing(openSave.id, next)
                      .then(() => {
                        setOpenSaveShared(next);
                        setSurfaceNotice(null);
                      })
                      .catch((error) => {
                        setSurfaceNotice(
                          error instanceof Error
                            ? error.message
                            : "That sharing preference was not saved.",
                        );
                      });
                  }}
                >
                  {openSaveShared ? (
                    <Users className="sf-control-icon" aria-hidden="true" />
                  ) : (
                    <Lock className="sf-control-icon" aria-hidden="true" />
                  )}
                  {openSaveShared ? "public" : "private"}
                </button>
                <button type="button" className="sf-remove" onClick={() => dropSave(openSave)}>
                  delete this inspiration
                </button>
              </div>
              {/* The consequence, at the point of change, same as the composer. */}
              <SharingExplainer shared={openSaveShared} />
            </div>
          ) : null}
        </section>

        {/* ----------------------------------------------------------- ASK */}
        <section className={`sf-layer sf-layer--ask${state === "ask" ? " on" : ""}`}>
          <div className="sf-column">
            <p className="sf-question">What were you circling?</p>
            <input
              ref={askInputRef}
              className="sf-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="What were you circling?"
            />
            {/*
              An empty field shows what you have kept most recently, rather
              than an empty page waiting to be typed into. Asking is the fast
              path once you know what you want; before that, seeing is.
            */}
            <div className="sf-label">
              {query.trim() ? `${results.length} of what you have kept` : "most recent"}
            </div>
            {/*
              Said once, above the column it governs.

              The archive is where someone answers "what have I left public?",
              so it is the one place the full consequence belongs — including
              the part people actually want to know, which is not the toggle's
              state but what another person in the room would see.
            */}
            <SharingExplainer open />
            <div className="sf-results">
              {searching ? <p className="sf-empty">looking…</p> : null}
              {!searching && query.trim() && results.length === 0 ? (
                <p className="sf-empty">Nothing you have kept matches that.</p>
              ) : null}
              {results.map((signal) => (
                /*
                  A row, not a button: the sharing control is a button of its
                  own and cannot be nested inside one. The text is the target
                  for opening the save; the word on the right is the target for
                  changing who can read it.
                */
                <div key={signal.id} className="sf-result">
                  <button
                    type="button"
                    className="sf-result-open"
                    onClick={() => enterSave(signal)}
                  >
                    <p>{signal.textPreview}</p>
                    <span>{new Date(signal.capturedAt).toLocaleDateString()}</span>
                  </button>
                  <button
                    type="button"
                    className={`sf-control sf-control--toggle sf-result-share${
                      signal.shared ? "" : " private"
                    }`}
                    aria-pressed={!signal.shared}
                    aria-label={`${signal.shared ? "Public" : "Private"}. ${
                      SHARING_MEANING[signal.shared ? "public" : "private"]
                    } Click to make it ${signal.shared ? "private" : "public"}.`}
                    onClick={() => void toggleShared(signal)}
                  >
                    {signal.shared ? (
                      <Users className="sf-control-icon" aria-hidden="true" />
                    ) : (
                      <Lock className="sf-control-icon" aria-hidden="true" />
                    )}
                    {signal.shared ? "public" : "private"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- CAPTURE */}
      <section className={`sf-layer sf-layer--capture${state === "capture" ? " on" : ""}`}>
        <div className="sf-column">
          <textarea
            ref={draftRef}
            className="sf-draft"
            value={draft}
            placeholder="What caught you?"
            onChange={(event) => {
              setDraft(event.target.value);
              setKept(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void keep();
            }}
            aria-label="What caught you?"
          />
          {/* What is coming with it. Filenames as text under the draft, not
              preview cards — the words are the save; these are its luggage. */}
          {files.length > 0 ? (
            <ul className="sf-attached">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`}>
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="sf-remove"
                    onClick={() => setFiles((current) => current.filter((_, n) => n !== i))}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="sf-draft-foot">
            <button
              type="button"
              className="sf-control sf-control--primary"
              onClick={() => void keep()}
              disabled={(!draft.trim() && files.length === 0) || keeping}
            >
              <Check className="sf-control-icon" aria-hidden="true" />
              {keeping ? "keeping…" : "keep"}
            </button>
            <button
              type="button"
              className="sf-control"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="sf-control-icon" aria-hidden="true" />
              attach
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                setFiles((current) => [...current, ...Array.from(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            {/* Public by default. One word, and it says which state it is in
                rather than which state it would switch to. */}
            <button
              type="button"
              className={`sf-control sf-control--toggle${shareToGroups ? "" : " private"}`}
              onClick={() => setShareToGroups((on) => !on)}
              aria-pressed={!shareToGroups}
            >
              {shareToGroups ? (
                <Users className="sf-control-icon" aria-hidden="true" />
              ) : (
                <Lock className="sf-control-icon" aria-hidden="true" />
              )}
              {shareToGroups ? "public" : "private"}
            </button>
            <span className="sf-shortcut">⌘↵</span>
          </div>
          {/*
            The consequence, in the open, at the moment of choosing.

            This was a `title` — a tooltip, invisible on every touch device and
            invisible on desktop until you already suspect there is something to
            find. A sharing setting is exactly the thing nobody hovers to
            investigate.
          */}
          <SharingExplainer shared={shareToGroups} />
          {kept ? <p className="sf-kept">{kept}</p> : null}
        </div>
        </section>
      </div>

      {/*
        The rail lives on the frame, not in a state of its own.

        Time was a place you had to go, which meant leaving the wall to look at
        how the wall had changed -- the one thing you cannot see if you had to
        navigate away from it. It is a line above the verbs now: every moment
        in the room's life, and clicking one re-forms the readings in place.

        Only a room has a life. Your own wall is one person's, and there is no
        arrival to mark on it.
      */}
      {/*
        ONE row.

        The bottom was two stacked utility rows — a timeline and a verbs line —
        holding a fifth of the screen. Two control bars under a wall is what a
        dashboard looks like, and it was the least considered part of the
        product by a distance.

        Now the verbs sit left and time sits right, on the same line. Time is
        collapsed to the word you are at — "now", or the date you travelled to
        — and the track only unrolls when you reach for it. It is a control
        you use rarely; it should not be furniture you look at constantly.
      */}
      <nav className="sf-foot">
        <div className="sf-verbs">
          {undo ? (
            <button type="button" className="sf-undo" onClick={putBack}>
              took it down · put it back
            </button>
          ) : null}
          <button
            type="button"
            className={`sf-primary-verb${state === "capture" ? " on" : ""}`}
            aria-pressed={state === "capture"}
            onClick={() => {
              const opening = state !== "capture";
              navigateSurface(opening ? "capture" : "wall", {
                replace: !opening,
              });
              if (opening) composerOpenedAt.current = Date.now();
              window.setTimeout(() => draftRef.current?.focus(), 60);
            }}
          >
            ＋ capture
            {draft.trim() && state !== "capture" ? (
              /* Something is still in the box. */
              <span className="sf-dot" aria-label="you have an unfinished save" />
            ) : null}
          </button>
          <button
            type="button"
            className={`sf-primary-verb${state === "ask" ? " on" : ""}`}
            aria-pressed={state === "ask"}
            onClick={() =>
              navigateSurface(state === "ask" ? "wall" : "ask", {
                replace: state === "ask",
              })
            }
          >
            {/* The count is the point: it says how much you have kept before
                you have asked for anything, which is the only number on this
                surface a person actually wants at a glance. */}
            {/* Until it lands, no number at all rather than a placeholder
                that looks like a count of nothing. */}
            {savedCount === null
              ? "inspirations"
              : `${savedCount}${savedCount >= SAVED_CEILING ? "+" : ""} inspirations`}
          </button>
          {/*
            Your own top of mind is not a room, and is no longer filed as one.

            It used to be the first row inside the `rooms` menu, which cost two
            clicks to reach the surface that is most yours, and said — by where
            it sat — that your own wall is one of your rooms. It is the thing
            the other walls are made from. One word, one click, always in the
            bar.
          */}
          <button
            type="button"
            className={`sf-primary-verb${room === null && state === "wall" ? " on" : ""}`}
            aria-pressed={room === null && state === "wall"}
            /* The header names it in full when you arrive. Spelling it out here
               too pushes this four-word row past a 375px screen, and the bar
               already has a mobile problem without adding one. */
            aria-label="your top of mind"
            onClick={() => goToWall(null)}
          >
            yours
          </button>
          {/*
            Rooms live in the bar, not on the wall.

            Switching rooms was a full-screen state you travelled to, which
            made choosing a wall feel like leaving one. It is a menu on the
            same line as everything else you can do, so the wall never goes
            away while you pick.
          */}
          <details className="sf-rooms-menu">
            <summary className="sf-primary-verb">rooms</summary>
            <div className="sf-rooms-panel">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`sf-room-row${room === r.id ? " on" : ""}`}
                  onClick={() => goToWall(r.id)}
                >
                  <span>{r.name}</span>
                  <small>
                    {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                  </small>
                </button>
              ))}
              {/*
                One field, two explicit acts. A short one-word room name and an
                invite code can look identical, so guessing here loses data.
              */}
              <form
                className="sf-room-new"
                onSubmit={(event) => {
                  event.preventDefault();
                  void makeOrJoinRoom("make");
                }}
              >
                <input
                  value={roomInput}
                  placeholder="room name or invite code"
                  onChange={(event) => {
                    setRoomInput(event.target.value);
                    setRoomError(null);
                  }}
                  aria-label="room name or invite code"
                />
                {roomInput.trim() ? (
                  <span className="sf-room-new-acts">
                    {/*
                      One field, two readings of it — the comment above says a
                      room name and an invite code can look identical, which is
                      exactly why "make" and "join" were not enough. Each button
                      now says which reading it takes, so the choice is legible
                      before the click rather than discovered after it.
                    */}
                    <button type="submit" disabled={roomBusy}>
                      {roomBusy ? "…" : "make a room"}
                    </button>
                    <button
                      type="button"
                      disabled={roomBusy}
                      onClick={() => void makeOrJoinRoom("join")}
                    >
                      join with code
                    </button>
                  </span>
                ) : null}
              </form>
              {roomError ? <p className="sf-room-err">{roomError}</p> : null}
            </div>
          </details>
        </div>

        {/*
          Everything on the right edge sits in one group, so your face is at
          the edge of the page whether or not there is a timeline or a cast
          beside it. Before, each of the three claimed `margin-left: auto`
          independently, so the row redistributed itself depending on which
          happened to be present — your face landed mid-line on your own wall
          and at the edge in a room.
        */}
        <div className="sf-foot-end">
        {moments.length > 1 ? (
          <div className="sf-time" role="group" aria-label="over time">
            <div
              className="sf-time-track"
              ref={trackRef}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setScrubbing(true);
                scrubTo(event.clientX);
              }}
              onPointerMove={(event) => {
                if (scrubbing) scrubTo(event.clientX);
              }}
              onPointerUp={() => setScrubbing(false)}
              onPointerCancel={() => setScrubbing(false)}
            >
              <span className="sf-time-line" />
              {allStops.map((stop) => (
                <button
                  key={stop.key}
                  type="button"
                  className={`sf-time-stop${travelledTo === stop.at ? " on" : ""}`}
                  style={{ left: `${stop.pct}%` }}
                  data-what={`${stop.when} — ${stop.label}`}
                  aria-label={`${stop.when} — ${stop.label}`}
                  onClick={() => travel(stop.at)}
                />
              ))}
              <span
                className={`sf-time-handle${scrubbing ? " dragging" : ""}`}
                style={{ left: `${here.pct}%` }}
                aria-hidden="true"
              />
            </div>
            {/* The one word you need when you are not using it. */}
            {/* At rest it names the control, not the position: "now" was
                answering a question nobody had asked yet. Once you travel it
                becomes the date, because then the position is the point. */}
            <span className={`sf-time-now${travelledTo ? " travelled" : ""}`}>
              {travelledTo ? here.when : "timeline"}
            </span>
          </div>
        ) : null}

        {/*
          The room's people, then you.

          Yours is always the face at the far end, and everyone else's sits to
          its left — so the pile reads as "them, and me", which is the order a
          person thinks in. On your own wall there is nobody to the left, which
          is how the surface says "alone" without printing the word.

          The pile is also the way into the room: who is here and how someone
          else gets in belong to the faces, not to a settings screen.
        */}
        {room ? (
          <details className="sf-cast-menu">
            <summary aria-label="about this room and invite someone">
              <span className="sf-cast">
                {members
                  .filter((m) => m.userId !== user?.id)
                  .map((member) => (
                    <span
                      key={member.userId}
                      className="sf-face"
                      style={{ background: contributorColor(member.name) }}
                      title={member.name}
                    >
                      {contributorInitials(member.name)}
                    </span>
                  ))}
                <span className="sf-cast-add" aria-hidden="true">＋</span>
              </span>
            </summary>
            <div className="sf-roomsettings">{roomPanel}</div>
          </details>
        ) : null}

        {/*
          You, and everything that is about you rather than about the room:
          your profile, the language, and the admin surfaces if you have them.
          Classic scattered these as three separate pills in three corners.
        */}
        <details className="sf-you">
          <summary aria-label="you">
            <span
              className="sf-face"
              style={{ background: contributorColor(user?.name ?? "you") }}
            >
              {contributorInitials(user?.name ?? "you")}
            </span>
          </summary>
          <div className="sf-you-menu">
            <a href="/profile">your profile</a>
            {/* The Debug pill from classic. It was a floating chip in the
                corner of the wall; it belongs with the other things that are
                about you and your access, not the room. */}
            {showsDebug() ? <a href="/admin">debug</a> : null}
            {/* The language is about you, not the room, so it lives with the
                other things that are. */}
            <div className="sf-you-langs">
              {supportedLocales.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={option.code === locale ? "on" : ""}
                  onClick={() => {
                    setLocale(option.code);
                    writeStoredLocale(option.code);
                  }}
                >
                  {option.nativeLabel}
                </button>
              ))}
            </div>
          </div>
        </details>
        </div>
      </nav>
    </div>
  );
}
