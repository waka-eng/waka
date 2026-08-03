/**
 * `/` — authenticated home page.
 *
 * Owns the inspirations list state for the authenticated user. The board
 * renders the list; the wired `<CaptureForm>` (inside the board) drives
 * the API round-trip. Home receives lifecycle callbacks from the form so
 * it can:
 *
 *   - Add an *optimistic* row to the history sidebar the instant Save is
 *     clicked (no waiting for the inspirations POST to round-trip).
 *   - Swap the optimistic row for the canonical server payload once the
 *     persistence completes.
 *   - Surface a banner / leave the optimistic row in place on hard
 *     failures so the user never loses their typed note.
 *
 * On mount the page calls `GET /inspirations` so the user sees their own
 * historical saves (and *only* their own — the API enforces tenant scope
 * by `user_id`). The result is merged with any in-flight optimistic rows so
 * a save that happens to land while the initial fetch is still resolving
 * is not clobbered by the response.
 */

import { type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";

import {
  InspirationCard,
  type InspirationCardData,
} from "../components/InspirationCard";
import { CaptureForm, type CaptureView } from "../components/capture";
import type {
  PendingInspiration,
  PersistedResult,
} from "../components/capture";
import {
  InspirationDetail,
  type InspirationDetailData,
} from "../components/history";
import { BackgroundField, DropOverlay, HistoryPanel } from "../components/layout";
import {
  type ApiAttachment,
  type ApiAmbitionDimension,
  type ApiFeedbackValue,
  type ApiError,
  type ApiInspiration,
  type ApiInspirationKind,
  type ApiReflection,
  type ApiSignalReading,
  type ApiInspirationScorePatch,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiGroupConversationRoom,
  type ApiGroupMemberSummary,
  type ApiGroupSummary,
  type ApiGroupTopOfMindNote,
  type ApiRoomTimeline,
  type ApiTimelineNote,
  type ApiTopOfMind,
  type ApiTopOfMindNoteSurface,
  type ClusterKind,
  createFeedback,
  createDiscussionTopic,
  createGroup as apiCreateGroup,
  createGroupRoom,
  createGroupRoomFeedback,
  createReflection,
  deleteReflection,
  deleteInspiration,
  fetchReflections,
  fetchSavedSignalDetail,
  fetchSignalReadings,
  fetchSavedSignals,
  fetchInspirations,
  fetchGroupRooms,
  fetchGroups,
  fetchGroupTopOfMind,
  fetchRoomTimeline,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  generateGuidedReflectionQuestion,
  deleteGroup as apiDeleteGroup,
  leaveGroup as apiLeaveGroup,
  renameGroup as apiRenameGroup,
  removeGroupMember as apiRemoveGroupMember,
  joinGroup as apiJoinGroup,
  refreshGroupTopOfMind as apiRefreshGroupTopOfMind,
  recordInspirationRevisit,
  updateInspiration,
  updateTopOfMindNote,
} from "../lib/api";
import { RoomTitle } from "../components/RoomTitle";
import { GroupWall } from "../components/GroupWall";
import { contributorColor, contributorInitials } from "../components/faces";
import { TimeRail } from "../components/TimeRail";
import { RoomRail } from "../components/RoomRail";
import { MINE_BOARD_ID, extractJoinCode } from "../components/rooms";
import { useAuth } from "../lib/auth-context";
import {
  formatSavedCount,
  normalizeSupportedLocale,
  readStoredLocale,
  t,
  type SupportedLocale,
  writeStoredLocale,
} from "../lib/locales";

const ATTACHMENT_ONLY_SENTINEL = "(attachment-only inspiration)";
const SAVED_SIGNAL_REFLECTION_MAX_STEPS = 3;
const SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS = [
  "What does this make you notice about yourself right now?",
  "What desire, fear, or standard does it point toward?",
  "What would change if you took that seriously?",
];

interface InternalEntryEnv {
  DEV?: boolean;
  VITE_SHOW_INTERNAL_STATUS?: string;
}

function shouldShowAdminEntry(env: InternalEntryEnv): boolean {
  const hostname =
    typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return env.VITE_SHOW_INTERNAL_STATUS === "true" || (env.DEV === true && isLocalhost);
}

/**
 * Internal state shape for the inspirations list. We track three bits the
 * canonical `ApiInspiration` doesn't carry: whether the row is still in
 * flight (`status`), the synthetic id we used before the server gave us a
 * real one (`tempId`), and the link/attachment metadata the user attached
 * locally (so the history card can render it before the GET endpoint is
 * online).
 */
type InspirationStatus = "saving" | "saved" | "error";
type HomeMode = "topOfMind" | "memoryDrawer";

// The legacy US-051 group conversation-rooms surface is superseded by the Group
// Top of Mind boards (US-052/US-053). Keep the code but never render it on the
// personal wall so group content no longer "sticks" under the Mine board.
/** "try again in 12 minutes" / "try again shortly" — never a raw timestamp. */
function untilNextRefresh(nextEligibleAt: string | null): string {
  if (!nextEligibleAt) return "try again shortly";
  const ms = new Date(nextEligibleAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "try again shortly";
  const minutes = Math.ceil(ms / 60_000);
  return `try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const SHOW_LEGACY_GROUP_ROOM_SURFACE = false;
type MemoryBrowseOrder = "newest" | "relevance";
type TopOfMindFeedbackValue = Extract<
  ApiFeedbackValue,
  "important" | "partly" | "not_true"
>;
type SavedSignalFeedbackValue = Extract<ApiFeedbackValue, "true" | "partly" | "not_true">;
type FeedbackStatus = "idle" | "saving" | "saved" | "error";
type DrawerActionStatus = { tone: "status" | "error"; message: string } | null;
type MemoryConstellationVisual = "note" | "link" | "image" | "mixed";
type SupportingThoughtSignal = HomeThoughtCard["supportingSignals"][number];

const TOP_OF_MIND_NOTE_LIMIT = 5;
const MEMORY_DRAWER_CLOSE_MS = 360;
const TOP_OF_MIND_AUTOSAVE_MS = 650;

const PRODUCT_SPACES = {
  capture: "Capture",
  memoryDrawer: "Inspiration Drawer",
  internalDebug: "Internal Debug",
} as const;

interface InspirationListEntry {
  /** Server-assigned id once persisted; equals `tempId` while saving. */
  id: string;
  tempId: string;
  status: InspirationStatus;
  text: string;
  kind: string | null;
  links: string[];
  /** Per-attachment label (image / file) retained so saved multi-input rows
   *  can show which uploaded files/images belong to the persisted inspiration. */
  attachments: ApiAttachment[];
  cluster: ClusterKind | null;
  /** Backend-calculated WOW score; absent while optimistic saves are in flight. */
  wowScore: number | null;
  reflectionsAnswered: number;
  reflectionsTotal: number;
  createdAt: string;
  /** Best-effort timestamp string for the meta row. */
  timestamp: string;
  /** Durable warning/error message for failed saves or partial attachment saves. */
  errorMessage?: string;
}

function fallbackTextForEntryKind(kind: string | null): string {
  if (kind === "image") return "Image inspiration";
  if (kind === "link") return "Link inspiration";
  if (kind === "mixed") return "Mixed inspiration";
  return "Untitled inspiration";
}

function displayTextForEntry(entry: Pick<InspirationListEntry, "text" | "kind">): string {
  const trimmed = entry.text.trim();
  if (trimmed === ATTACHMENT_ONLY_SENTINEL) return fallbackTextForEntryKind(entry.kind);
  return entry.text;
}

function attachmentContextLabel(attachment: ApiAttachment, locale: SupportedLocale): string {
  const enrichment = attachment.enrichment;
  if (attachment.type === "link") {
    const host = enrichment?.link?.hostname;
    const title = enrichment?.link?.title?.trim();
    let urlHost: string | null = null;
    if (attachment.url) {
      try {
        urlHost = new URL(attachment.url).hostname;
      } catch {
        urlHost = null;
      }
    }
    const fallbackLabel = host || urlHost || attachment.name || attachment.url || t(locale, "attachmentPreviewUnavailable");
    if (enrichment?.status === "ready") return title || fallbackLabel;
    if (enrichment?.status === "pending") return t(locale, "attachmentPreviewPending");
    return fallbackLabel;
  }

  const filename = enrichment?.image?.filename ?? attachment.name ?? attachment.type;
  const size = enrichment?.image?.size ?? attachment.size;
  const sizeLabel = typeof size === "number" && size > 0 ? ` · ${Math.ceil(size / 1024)} KB` : "";
  return `${filename}${sizeLabel}`;
}

function entryToCardData(entry: InspirationListEntry): InspirationCardData {
  // Keep transient save status as the only label in the meta row. Saved
  // link/image/mixed context is rendered from attachments below, not from the
  // backend capture kind, so history/detail never exposes implementation terms.
  let statusLabel: string | null = null;
  if (entry.status === "saving") statusLabel = "saving";
  else if (entry.status === "error") statusLabel = "save failed";
  return {
    id: entry.id,
    text: displayTextForEntry(entry) || null,
    links: entry.links.length > 0 ? entry.links : null,
    attachments: entry.attachments.length > 0 ? entry.attachments : null,
    timestamp: entry.timestamp,
    kind: statusLabel ?? entry.kind,
    warningMessage:
      entry.status === "saved" && entry.errorMessage ? entry.errorMessage : undefined,
    reflectionsAnswered: entry.reflectionsAnswered,
    reflectionsTotal: entry.reflectionsTotal,
  };
}

/** Build a human-readable timestamp matching the prototype's format. */
function formatNow(): string {
  const now = new Date();
  return `${now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} · ${now.toLocaleDateString()}`;
}

/**
 * Format a server-side ISO `created_at` into the same human-readable shape
 * the prototype renders for fresh saves. Falls back gracefully on a parse
 * failure so a malformed timestamp surfaces as the raw string rather than
 * crashing the row.
 */
function formatTimestamp(iso: string): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return iso;
  return `${ts.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })} · ${ts.toLocaleDateString()}`;
}

/**
 * Map a canonical `ApiInspiration` (as returned by GET /inspirations) into
 * the local list-entry shape. Server-fetched rows are immediately in
 * `"saved"` state — they were already durable when we read them. The
 * `tempId` mirrors the server id so the merge in `setEntries` below has a
 * stable key to reconcile against if a save round-trip eventually resolves
 * for the same row (e.g. after a refresh between optimistic add and POST
 * settlement).
 */
function apiInspirationToEntry(row: ApiInspiration): InspirationListEntry {
  return {
    id: row.id,
    tempId: row.id,
    status: "saved",
    text: row.text,
    kind: row.kind,
    links: (row.attachments ?? [])
      .filter((attachment) => attachment.type === "link")
      .map((attachment) => attachment.enrichment?.link?.finalUrl ?? attachment.url)
      .filter((url): url is string => typeof url === "string" && url.length > 0),
    attachments: row.attachments ?? [],
    cluster: row.cluster,
    wowScore: row.wowScore,
    reflectionsAnswered: 0,
    reflectionsTotal: 0,
    createdAt: row.createdAt,
    timestamp: formatTimestamp(row.createdAt),
  };
}

function signalToListEntry(signal: ApiSavedSignalSearchResult): InspirationListEntry {
  return {
    id: signal.id,
    tempId: signal.id,
    status: "saved",
    text: signal.textPreview,
    kind: signal.kind,
    links: [],
    attachments: signal.attachmentSummary.map((attachment) => ({
      id: attachment.id,
      inspirationId: signal.id,
      type: attachment.type,
      url: undefined,
      name: attachment.label,
      contentType: null,
      size: null,
      createdAt: signal.capturedAt,
    })),
    cluster: null,
    wowScore: signal.resonanceScore,
    reflectionsAnswered: 0,
    reflectionsTotal: 0,
    createdAt: signal.capturedAt,
    timestamp: formatTimestamp(signal.capturedAt),
  };
}

function buildOptimisticEntry(
  pending: PendingInspiration,
): InspirationListEntry {
  const pendingAttachmentRows: ApiAttachment[] = pending.attachments.map((attachment) => ({
    id: attachment.localId,
    inspirationId: pending.tempId,
    type: attachment.kind,
    url: attachment.url,
    name: attachment.name ?? attachment.file?.name ?? null,
    contentType: attachment.file?.type ?? null,
    size: attachment.file?.size ?? null,
    createdAt: pending.createdAt,
    enrichment:
      attachment.kind === "image"
        ? {
            status: "unavailable",
            source: "user_upload",
            sourceUrl: null,
            errorReason: null,
            checkedAt: null,
            link: null,
            image: {
              filename: attachment.name ?? attachment.file?.name ?? null,
              contentType: attachment.file?.type ?? null,
              size: attachment.file?.size ?? null,
              width: null,
              height: null,
            },
          }
        : undefined,
  }));
  return {
    id: pending.tempId,
    tempId: pending.tempId,
    status: "saving",
    text: pending.text,
    kind: pending.kind,
    links: pending.links,
    attachments: pendingAttachmentRows,
    cluster: null,
    wowScore: null,
    reflectionsAnswered: 0,
    reflectionsTotal: 0,
    createdAt: pending.createdAt,
    timestamp: formatNow(),
  };
}

function applyPersisted(
  entry: InspirationListEntry,
  inspiration: ApiInspiration,
  attachments: ApiAttachment[],
  failedCount: number,
  reflectionCount = 0,
): InspirationListEntry {
  const persistedIds = new Set(attachments.map((attachment) => attachment.id));
  const failedContext = failedCount > 0 ? entry.attachments.filter((attachment) => !persistedIds.has(attachment.id)) : [];
  return {
    ...entry,
    id: inspiration.id,
    // The inspiration row is durable once POST /inspirations succeeds. Treat
    // attachment finalize/upload failures as a graceful partial save instead
    // of rendering the whole saved inspiration as a broken ERROR entry.
    status: "saved",
    text: inspiration.text,
    kind: inspiration.kind,
    cluster: inspiration.cluster,
    wowScore: inspiration.wowScore,
    reflectionsAnswered: entry.reflectionsAnswered + reflectionCount,
    reflectionsTotal: entry.reflectionsTotal + reflectionCount,
    attachments: [...attachments, ...failedContext],
    errorMessage:
      failedCount > 0
        ? `${failedCount} attachment${failedCount === 1 ? "" : "s"} failed to upload.`
        : undefined,
  };
}

function applyInspirationScorePatch(
  entry: InspirationListEntry,
  scores: ApiInspirationScorePatch,
): InspirationListEntry {
  if (entry.id !== scores.id && entry.tempId !== scores.id) return entry;
  return {
    ...entry,
    wowScore:
      typeof scores.wowScore === "number" ? scores.wowScore : entry.wowScore,
  };
}

function applyUpdatedInspiration(
  entry: InspirationListEntry,
  inspiration: ApiInspiration,
): InspirationListEntry {
  if (entry.id !== inspiration.id && entry.tempId !== inspiration.id) return entry;
  return {
    ...entry,
    id: inspiration.id,
    text: inspiration.text,
    kind: inspiration.kind,
    cluster: inspiration.cluster,
    wowScore: inspiration.wowScore,
    status: "saved",
    createdAt: inspiration.createdAt,
    timestamp: formatTimestamp(inspiration.createdAt),
  };
}

const DEFAULT_INSPIRATION_FILTERS: InspirationDiscoveryFilters = {
  search: "",
};

interface InspirationDiscoveryFilters {
  search: string;
}

function createdAtMs(entry: InspirationListEntry): number {
  const parsed = new Date(entry.createdAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function filterAndSortInspirationEntries(
  entries: InspirationListEntry[],
  filters: InspirationDiscoveryFilters,
): InspirationListEntry[] {
  const query = filters.search.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    const haystack = displayTextForEntry(entry).toLowerCase();
    return !query || haystack.includes(query);
  });

  return [...filtered].sort((a, b) => createdAtMs(b) - createdAtMs(a));
}

function shortText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

const MEANING_NOTE_LABEL_TRANSLATIONS: Record<string, string> = {
  "what kind of life would make this work worth it": "이 일을 가치 있게 만드는 삶",
  "rooms where people can be honest before they are impressive": "인상적이기 전에 솔직할 수 있는 방",
  "to build around people who make ambition feel less lonely": "야망이 덜 외롭게 느껴지는 사람들 곁에서 만들기",
  "what is worth building when building itself gets cheap": "만드는 일이 쉬워질 때에도 만들 가치가 있는 것",
  "human judgment over pure speed": "순수한 속도보다 인간의 판단",
  "taste over speed": "속도보다 취향",
  "people who keep asking why": "계속 왜인지 묻는 사람들",
};

function normalizeMeaningLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function memoryPathIdFromLabel(label: string): string {
  const slug = normalizeMeaningLabel(label)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return slug || "inspirations";
}

function isPublicMemoryPathLabel(label: string): boolean {
  return !/(^|[\s_-])(meaning|context|node|nodes|edge|ctx)([\s_-]|$)|node id/i.test(label);
}

interface HomeThoughtCard {
  createdAt?: string;
  id: string;
  feedbackTargetId?: string;
  label: string;
  ambitionDimension?: ApiAmbitionDimension;
  ambientSignal?: string;
  matchedEnvironment?: string;
  antiEnvironment?: string;
  evidenceRationale?: string;
  rejectedAlternativeInterpretation?: string | null;
  status?: ApiTopOfMindNoteSurface["status"];
  confidence?: number;
  type: string;
  reason: string;
  supportingSignals: Array<{
    id: string;
    preview: string;
    reason: string;
    createdAt: string;
    kind?: string | null;
    resonanceScore?: number;
    /** On group boards, the member who saved this inspiration. */
    authorName?: string;
    /** The words that carried the reading, when they could be proven present. */
    quote?: string | null;
    /** Whose words they were: the person's own, or the page they linked. */
    quoteSource?: "own" | "enrichment" | null;
  }>;
  contextNodes: Array<{
    id: string;
    label: string;
    type: string;
  }>;
}

interface MemoryConstellationNode {
  signal: ApiSavedSignalSearchResult;
  visual: MemoryConstellationVisual;
  x: number;
  y: number;
}

interface MemoryConstellationRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  reason: string;
  sourceTerms: string[];
  targetTerms: string[];
  sourceSignal: ApiSavedSignalSearchResult;
  targetSignal: ApiSavedSignalSearchResult;
}

interface MemoryGrouping {
  id: string;
  name: string;
  explanation: string;
  source: "all" | "proposed" | "user";
  icon: "folder" | "pin" | "image" | "link" | "note";
  signals: ApiSavedSignalSearchResult[];
  terms: string[];
  x: number;
  y: number;
  tilt: number;
}

interface MemoryPathFilter {
  id: string;
  path: string;
  label: string;
  description: string;
  signals: ApiSavedSignalSearchResult[];
}

interface UserMemoryGrouping {
  id: string;
  name: string;
  signalIds: string[];
}

interface MemoryWindowState {
  signalId: string;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}

interface MemoryPreviewPlacement {
  top: string;
  left: string;
  translateX: string;
  restTranslateY: string;
  originX: string;
  originY: string;
  side: "above" | "below";
}

interface MemoryPreviewRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface MemoryPreviewViewport {
  width: number;
  height: number;
}

const MEMORY_PREVIEW_MARGIN = 12;
const MEMORY_PREVIEW_GAP = 12;
const MEMORY_PREVIEW_FALLBACK_SIZE = { width: 320, height: 190 };

const clampMemoryPreviewValue = (value: number, min: number, max: number): number => {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
};

export function getMemoryPreviewPlacement(
  anchorRect: MemoryPreviewRect,
  viewport: MemoryPreviewViewport,
  previewSize: Partial<Pick<MemoryPreviewRect, "width" | "height">> = MEMORY_PREVIEW_FALLBACK_SIZE,
  margin = MEMORY_PREVIEW_MARGIN,
): MemoryPreviewPlacement {
  const previewWidth = Math.max(1, Math.min(previewSize.width ?? MEMORY_PREVIEW_FALLBACK_SIZE.width, viewport.width - margin * 2));
  const previewHeight = Math.max(1, previewSize.height ?? MEMORY_PREVIEW_FALLBACK_SIZE.height);
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const clampedViewportLeft = clampMemoryPreviewValue(
    anchorCenterX - previewWidth / 2,
    margin,
    viewport.width - previewWidth - margin,
  );
  const enoughRoomBelow = anchorRect.bottom + MEMORY_PREVIEW_GAP + previewHeight <= viewport.height - margin;
  const enoughRoomAbove = anchorRect.top - MEMORY_PREVIEW_GAP - previewHeight >= margin;
  const side = !enoughRoomBelow && enoughRoomAbove ? "above" : "below";
  const preferredViewportTop =
    side === "above"
      ? anchorRect.top - MEMORY_PREVIEW_GAP - previewHeight
      : anchorRect.bottom + MEMORY_PREVIEW_GAP;
  const clampedViewportTop = clampMemoryPreviewValue(
    preferredViewportTop,
    margin,
    viewport.height - previewHeight - margin,
  );
  const originOffset = clampMemoryPreviewValue(
    anchorCenterX - clampedViewportLeft,
    margin,
    previewWidth - margin,
  );

  return {
    top: `${Math.round(clampedViewportTop - anchorRect.top)}px`,
    left: `${Math.round(clampedViewportLeft - anchorRect.left + previewWidth / 2)}px`,
    translateX: "-50%",
    restTranslateY: side === "above" ? "-6px" : "6px",
    originX: `${Math.round(originOffset)}px`,
    originY: side === "above" ? "bottom" : "top",
    side,
  };
}

/**
 * When a reading arrived, said the way a person would say it.
 *
 * Relative while it is recent, because "2 days ago" is what you actually want
 * to know about something on today's wall; absolute once it is old enough that
 * counting days stops meaning anything.
 */
function noteWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  return at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}


/**
 * The save's own text, with the words that carried a reading lit up.
 *
 * The quote was verified against the save with whitespace normalized, so
 * finding it again has to be whitespace-tolerant — the stored span may have
 * been re-wrapped by the model, and an exact search would miss the very
 * quote we already proved was there.
 *
 * Returns the text unmarked when the span cannot be located, which happens
 * when the save has been edited since. Showing it plain is honest; guessing
 * at a nearby range would highlight words nobody pointed at.
 */
export function highlightQuote(text: string, quote: string | null): ReactNode {
  if (!quote) return text;
  const escaped = quote
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = new RegExp(escaped, "i").exec(text);
  if (!match) return text;
  return [
    text.slice(0, match.index),
    <mark key="q" className="memory-contents-quote-mark">
      {match[0]}
    </mark>,
    text.slice(match.index + match[0].length),
  ];
}

function noteToThoughtCard(
  note: ApiTopOfMindNoteSurface | ApiGroupTopOfMindNote,
): HomeThoughtCard {
  const evidenceSignals = note.evidencePreviews.map((evidence) => ({
    id: evidence.signalId,
    preview: evidence.textPreview,
    reason: evidence.reason,
    createdAt: evidence.createdAt,
    kind: evidence.kind,
    resonanceScore: evidence.resonanceScore,
    authorName: (evidence as { authorName?: string }).authorName,
    /**
     * The words that carried this reading, and whose they were.
     *
     * Null far more often than not — the judge has to name a span AND that
     * span has to actually be in the save. Where it is present the preview is
     * already the quote rather than the opening of the save, so this only says
     * whether to mark it as quoted, and by whom.
     */
    quote: evidence.quote ?? null,
    quoteSource: evidence.quoteSource ?? null,
  }));
  const relatedSignals = note.relatedSignals
    .filter((signal) => !evidenceSignals.some((evidence) => evidence.id === signal.id))
    .map((signal) => ({
      id: signal.id,
      preview: signal.preview,
      reason: "Related inspiration",
      createdAt: signal.createdAt,
      kind: signal.kind,
      resonanceScore: signal.resonanceScore,
      authorName: (signal as { authorName?: string }).authorName,
    }));

  return {
    id: note.id,
    feedbackTargetId: note.id,
    /** When the room first read this. A wall that changes needs its notes dated. */
    createdAt: note.createdAt,
    label: note.title || note.ambientSignal,
    ambitionDimension: note.ambitionDimension,
    ambientSignal: note.ambientSignal,
    matchedEnvironment: note.matchedEnvironment,
    antiEnvironment: note.antiEnvironment,
    evidenceRationale: note.evidenceRationale,
    rejectedAlternativeInterpretation: note.rejectedAlternativeInterpretation,
    status: note.status,
    confidence: note.confidence,
    type: note.type,
    reason: note.body,
    supportingSignals: [...evidenceSignals, ...relatedSignals],
    contextNodes: note.relatedContextNodeIds.map((nodeId) => ({
      id: nodeId,
      label: note.title,
      type: note.type,
    })),
  };
}

function isMeaningfulThoughtCard(card: HomeThoughtCard): boolean {
  const label = normalizeMeaningLabel(card.label);
  if (!label) return false;
  if (/waiting for a stronger signal|stronger signal to earn this spot/.test(label)) return false;
  if (card.status && card.status !== "active") return false;
  return true;
}

function uniqueThoughtCards(cards: HomeThoughtCard[]): HomeThoughtCard[] {
  const seen = new Set<string>();
  const out: HomeThoughtCard[] = [];
  for (const card of cards) {
    const key = normalizeMeaningLabel(card.label)
      .replace(/\b(i|me|my|the|a|an|to|of|and|or|for|with|where)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const dimensionKey = `${card.ambitionDimension ?? card.type}:${key}`;
    if (seen.has(key) || seen.has(dimensionKey)) continue;
    seen.add(key);
    seen.add(dimensionKey);
    out.push(card);
  }
  return out;
}

function thoughtCardDisplayLabel(card: HomeThoughtCard, locale: string): string {
  return locale === "en-US"
    ? card.label
    : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(card.label)] ?? card.label;
}

function thoughtCardTextDensityClass(text: string): string {
  const length = text.trim().length;
  if (length > 1200) return " nc-note--text-ultra";
  if (length > 800) return " nc-note--text-nano";
  if (length > 420) return " nc-note--text-micro";
  if (length > 260) return " nc-note--text-tiny";
  if (length > 150) return " nc-note--text-compact";
  if (length > 92) return " nc-note--text-long";
  return "";
}

function thoughtCardTextareaRows(text: string): number {
  const trimmed = text.trim();
  const explicitLines = trimmed ? trimmed.split(/\n/).length : 1;
  const charsPerRow =
    trimmed.length > 1200
      ? 36
      : trimmed.length > 800
        ? 32
      : trimmed.length > 420
        ? 28
      : trimmed.length > 260
        ? 24
      : trimmed.length > 150
        ? 20
      : 14;
  const rows = Math.ceil(trimmed.length / charsPerRow) + explicitLines - 1;
  return Math.max(3, Math.min(64, rows));
}

const NOTE_LAYOUTS: Array<{ tilt: number; w: string }> = [
  { tilt: -1.4, w: "420px" },
  { tilt: -2.2, w: "292px" },
  { tilt: 1.8, w: "300px" },
  { tilt: 1.2, w: "292px" },
  { tilt: -0.8, w: "312px" },
];

const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
  { hue: "#f1d7a8", ink: "#4f3921" },
];

function capturedAtMs(signal: ApiSavedSignalSearchResult): number {
  const parsed = new Date(signal.capturedAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function signalAgeDays(signal: ApiSavedSignalSearchResult): number {
  const age = Date.now() - capturedAtMs(signal);
  if (!Number.isFinite(age) || age < 0) return 0;
  return Math.floor(age / (1000 * 60 * 60 * 24));
}

function signalTextHaystack(signal: ApiSavedSignalSearchResult): string {
  return [
    signal.textPreview,
    ...signal.matchingSnippets,
    ...signal.relatedContextTerms,
    ...signal.relatedTopOfMindNoteTitles,
    ...signal.relevanceReasons,
  ].join(" ").toLowerCase();
}

function signalVisualTreatment(signal: ApiSavedSignalSearchResult): MemoryConstellationVisual {
  const attachmentTypes = new Set(signal.attachmentSummary.map((attachment) => attachment.type));
  if (signal.kind === "image" || attachmentTypes.has("image")) return "image";
  if (
    signal.kind === "mixed" ||
    attachmentTypes.size > 1 ||
    signal.attachmentSummary.length > 1 ||
    attachmentTypes.has("file")
  ) {
    return "mixed";
  }
  if (signal.kind === "link" || attachmentTypes.has("link")) return "link";
  return "note";
}

function signalSourceLabel(signal: ApiSavedSignalSearchResult): string | null {
  const linkAttachment = signal.attachmentSummary.find((attachment) => attachment.type === "link");
  if (!linkAttachment) return null;
  const label = linkAttachment.label.trim();
  if (!label) return null;
  try {
    return new URL(label).hostname.replace(/^www\./, "");
  } catch {
    return label.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  }
}

function relationshipTerms(signal: ApiSavedSignalSearchResult): string[] {
  return [
    ...signal.relatedTopOfMindNoteTitles,
    ...signal.relatedContextTerms,
    ...signal.relevanceReasons,
    ...signal.matchingSnippets,
  ]
    .map((term) => normalizeMeaningLabel(term))
    .filter(Boolean);
}

function relationshipLabelForSignals(
  source: ApiSavedSignalSearchResult,
  target: ApiSavedSignalSearchResult,
  sharedTerms: string[],
): string {
  const combined = `${source.textPreview} ${target.textPreview} ${sharedTerms.join(" ")}`.toLowerCase();
  if (combined.includes("envy")) return "the envy points here";
  if (combined.includes("tension") || combined.includes("not anymore") || combined.includes("bothers")) {
    return "old self arguing with new self";
  }
  if (combined.includes("people") || combined.includes("collaborator") || combined.includes("peer")) {
    return "both want the same people";
  }
  if (Math.abs(signalAgeDays(source) - signalAgeDays(target)) >= 21) return "this came back later";
  return sharedTerms.length > 0 ? "same room, different mask" : "two saves touching";
}

function buildMemoryConstellationRelationships(
  signals: ApiSavedSignalSearchResult[],
  notes: ApiTopOfMindNoteSurface[],
): MemoryConstellationRelationship[] {
  const relationships: MemoryConstellationRelationship[] = [];
  const topSignals = signals.slice(0, 8);
  const termsBySignal = new Map(topSignals.map((signal) => [signal.id, relationshipTerms(signal)] as const));

  for (let i = 0; i < topSignals.length; i += 1) {
    for (let j = i + 1; j < topSignals.length; j += 1) {
      const source = topSignals[i];
      const target = topSignals[j];
      const sourceTerms = termsBySignal.get(source.id) ?? [];
      const targetTerms = termsBySignal.get(target.id) ?? [];
      const sharedTerms = sourceTerms.filter((term) => targetTerms.includes(term));
      const sharedNote = notes.find(
        (note) => note.relatedSignalIds.includes(source.id) && note.relatedSignalIds.includes(target.id),
      );
      if (sharedTerms.length === 0 && !sharedNote) continue;
      const label = sharedNote?.ambientSignal
        ? "both point at the same post-it"
        : relationshipLabelForSignals(source, target, sharedTerms);
      relationships.push({
        id: `${source.id}-${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        label,
        reason: sharedNote
          ? `Both saved moments are supporting "${sharedNote.ambientSignal || sharedNote.title}".`
          : `These saves share ${sharedTerms.slice(0, 2).join(" and ")}.`,
        sourceTerms,
        targetTerms,
        sourceSignal: source,
        targetSignal: target,
      });
    }
  }

  if (relationships.length > 0) return relationships.slice(0, 5);

  return topSignals.slice(0, 4).flatMap((source, index) => {
    const target = topSignals[index + 1];
    if (!target) return [];
    return [
      {
        id: `${source.id}-${target.id}`,
        sourceId: source.id,
        targetId: target.id,
        label: relationshipLabelForSignals(source, target, []),
        reason: "These saves sit close together while a sharper connection forms.",
        sourceTerms: termsBySignal.get(source.id) ?? [],
        targetTerms: termsBySignal.get(target.id) ?? [],
        sourceSignal: source,
        targetSignal: target,
      },
    ];
  });
}

function signalRelevanceScore(signal: ApiSavedSignalSearchResult, terms: string[] = []): number {
  const scores = signal.signalScores;
  const haystack = signalTextHaystack(signal);
  const termBoost = terms.reduce((total, term) => total + (haystack.includes(term.toLowerCase()) ? 2 : 0), 0);
  return (
    signal.resonanceScore * 1.6 +
    scores.recurrence * 1.2 +
    scores.agency +
    scores.identitySignal +
    scores.decisionRelevance * 0.8 +
    signal.relatedTopOfMindNoteTitles.length * 1.4 +
    termBoost
  );
}

function groupNameFromLanguage(value: string): string {
  const label = normalizeMeaningLabel(value);
  if (/room|studio|city|place|where|environment|walk|bridge/.test(label)) return "rooms i keep wanting";
  if (/people|peer|collaborator|friend|near|with/.test(label)) return "people i want near me";
  if (/work|build|make|project|craft|public|product/.test(label)) return "work i keep circling";
  if (/done|reject|anti|bother|tension|fear|argu/.test(label)) return "things i am done with";
  if (/image|aesthetic|taste|beautiful|visual|style/.test(label)) return "taste with a pulse";
  if (/question|wonder|unknown|test/.test(label)) return "questions still open";
  const words = label.split(/\s+/).filter((word) => word.length > 2).slice(0, 4);
  return words.length > 0 ? words.join(" ") : "inspirations touching";
}

function memoryMapLabel(value: string): string {
  const label = normalizeMeaningLabel(value);
  const knownLabels: Record<string, string> = {
    "all saved, newest first": "all saved",
    "recently saved": "recently saved",
    "rooms i keep wanting": "wanted rooms",
    "people i want near me": "wanted people",
    "work i keep circling": "work orbit",
    "things i am done with": "done with",
    "taste with a pulse": "taste pulse",
    "questions still open": "open questions",
    "inspirations touching": "loose inspirations",
  };
  const shortLabel = knownLabels[label] ?? label;
  const words = shortLabel
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ""))
    .filter((word) => word.length > 0)
    .slice(0, 4);
  const slug = words.join("-");
  return `/${slug || "inspirations"}`;
}

// Tight 1-2 sentence blurb for the hover-reveal card (Shopify-style).
function memoryGroupBlurb(group: MemoryGrouping): string {
  const raw = (group.explanation || "").trim();
  if (!raw) return "Saved inspirations that keep touching the same thread.";
  const sentences = raw.split(/(?<=[.?!])\s+/).filter((part) => part.trim().length > 0);
  const blurb = sentences.slice(0, 2).join(" ").trim();
  return blurb.length > 160 ? `${blurb.slice(0, 157).trimEnd()}…` : blurb;
}

// Constellation slot positions (percent of viewport). Shared by the rendered
// nodes AND the connecting lines so the lines actually join the labels.
// Whether an unsaved capture draft is sitting in local storage, so the home
// capture button can hint that there's something still in progress.
function captureDraftHasContent(): boolean {
  try {
    const raw = window.localStorage.getItem("waka.captureDraft.v1");
    if (!raw) return false;
    const draft = JSON.parse(raw) as {
      note?: string;
      links?: unknown[];
    };
    return (
      (draft.note?.trim().length ?? 0) > 0 ||
      (draft.links?.length ?? 0) > 0
    );
  } catch {
    return false;
  }
}

const MEMORY_MAP_SLOTS: Array<{ x: number; y: number }> = [
  { x: 50, y: 39 },
  { x: 23, y: 50 },
  { x: 77, y: 50 },
  { x: 33, y: 67 },
  { x: 67, y: 67 },
  { x: 50, y: 25 },
  { x: 15, y: 67 },
  { x: 85, y: 67 },
];

function groupingIconForSignals(signals: ApiSavedSignalSearchResult[]): MemoryGrouping["icon"] {
  if (signals.some((signal) => signalVisualTreatment(signal) === "image")) return "image";
  if (signals.some((signal) => signalVisualTreatment(signal) === "link")) return "link";
  return "folder";
}

function uniqueSignals(signals: ApiSavedSignalSearchResult[]): ApiSavedSignalSearchResult[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.id)) return false;
    seen.add(signal.id);
    return true;
  });
}

function sortSignalsForGrouping(
  signals: ApiSavedSignalSearchResult[],
  terms: string[],
  order: MemoryBrowseOrder,
): ApiSavedSignalSearchResult[] {
  if (order === "newest") return [...signals].sort((a, b) => capturedAtMs(b) - capturedAtMs(a));
  return [...signals].sort((a, b) => signalRelevanceScore(b, terms) - signalRelevanceScore(a, terms));
}

function sortedSignalsNewest(signals: ApiSavedSignalSearchResult[]): ApiSavedSignalSearchResult[] {
  return [...signals].sort((a, b) => capturedAtMs(b) - capturedAtMs(a));
}

function buildMemoryPathFilters(signals: ApiSavedSignalSearchResult[]): MemoryPathFilter[] {
  const sortedSignals = sortedSignalsNewest(signals);
  const recentlySavedSignals = sortedSignals.filter((signal) => signalAgeDays(signal) <= 2);
  const themeBuckets = new Map<string, ApiSavedSignalSearchResult[]>();

  sortedSignals.forEach((signal) => {
    const labels = [...signal.relatedContextTerms, ...signal.relatedTopOfMindNoteTitles]
      .map(normalizeMeaningLabel)
      .filter((label) => label && isPublicMemoryPathLabel(label));
    const seenLabels = new Set<string>();
    labels.forEach((label) => {
      if (seenLabels.has(label)) return;
      seenLabels.add(label);
      const current = themeBuckets.get(label) ?? [];
      current.push(signal);
      themeBuckets.set(label, current);
    });
  });

  const filters: MemoryPathFilter[] = [
    {
      id: "all-saved",
      path: "/all-saved",
      label: "all saved",
      description: "all saved inspirations, newest first",
      signals: sortedSignals,
    },
  ];

  filters.push({
    id: "recently-saved",
    path: "/recently-saved",
    label: "recently saved",
    description: "saved in the last 2 days",
    signals: recentlySavedSignals,
  });

  const themeFilters = Array.from(themeBuckets.entries())
    .filter(([, bucketSignals]) => bucketSignals.length > 0)
    .sort(([, aSignals], [, bSignals]) => {
      if (bSignals.length !== aSignals.length) return bSignals.length - aSignals.length;
      return capturedAtMs(bSignals[0]) - capturedAtMs(aSignals[0]);
    })
    .map(([label, bucketSignals]) => ({
      id: `theme-${memoryPathIdFromLabel(label)}`,
      path: memoryMapLabel(label),
      label,
      description: `saved inspirations related to ${label}`,
      signals: sortSignalsForGrouping(bucketSignals, [label], "relevance"),
    }));

  return [...filters, ...themeFilters];
}

function applySearchToSignals(signals: ApiSavedSignalSearchResult[], query: string): ApiSavedSignalSearchResult[] {
  if (!query) return sortedSignalsNewest(signals);
  return sortedSignalsNewest(signals).filter((signal) => signalTextHaystack(signal).includes(query));
}

function buildProposedMemoryGroupings(
  signals: ApiSavedSignalSearchResult[],
  notes: ApiTopOfMindNoteSurface[],
  userGroups: UserMemoryGrouping[],
  renamedGroups: Record<string, string>,
  dismissedGroupIds: Set<string>,
): MemoryGrouping[] {
  const positions = [
    { x: 49, y: 49, tilt: -0.5 },
    { x: 30, y: 42, tilt: 0.7 },
    { x: 69, y: 40, tilt: -0.7 },
    { x: 38, y: 64, tilt: -0.2 },
    { x: 61, y: 66, tilt: 0.5 },
    { x: 23, y: 66, tilt: 0.4 },
    { x: 78, y: 61, tilt: -0.4 },
    { x: 53, y: 30, tilt: 0.3 },
  ];
  const groups: MemoryGrouping[] = [];
  const addGroup = (group: Omit<MemoryGrouping, "x" | "y" | "tilt">) => {
    if (group.signals.length === 0 || dismissedGroupIds.has(group.id) || groups.some((existing) => existing.id === group.id)) {
      return;
    }
    const renamedName = renamedGroups[group.id] ?? group.name;
    const label = memoryMapLabel(renamedName);
    const existingSameLabel = groups.find((existing) => memoryMapLabel(existing.name) === label);
    if (existingSameLabel) {
      existingSameLabel.signals = uniqueSignals([...existingSameLabel.signals, ...group.signals]);
      existingSameLabel.terms = Array.from(new Set([...existingSameLabel.terms, ...group.terms]));
      if (existingSameLabel.explanation.length < group.explanation.length) {
        existingSameLabel.explanation = group.explanation;
      }
      return;
    }
    const position = positions[groups.length % positions.length];
    groups.push({
      ...group,
      name: renamedName,
      signals: uniqueSignals(group.signals),
      x: position.x,
      y: position.y,
      tilt: position.tilt,
    });
  };

  addGroup({
    id: "all",
    name: "all saved, newest first",
    explanation: "A clean chronological path when you need the exact thing you saved.",
    source: "all",
    icon: "folder",
    signals,
    terms: [],
  });

  for (const userGroup of userGroups) {
    addGroup({
      id: userGroup.id,
      name: userGroup.name,
      explanation: "A grouping you made, kept beside the suggested piles.",
      source: "user",
      icon: "pin",
      signals: signals.filter((signal) => userGroup.signalIds.includes(signal.id)),
      terms: [userGroup.name],
    });
  }

  addGroup({
    id: "recently-saved",
    name: "recently saved",
    explanation: "The newest pieces stay close to the front of the drawer.",
    source: "proposed",
    icon: "note",
    signals: signals.slice(0, Math.min(6, signals.length)),
    terms: ["recent"],
  });

  for (const note of notes.slice(0, 4)) {
    const related = signals.filter((signal) => note.relatedSignalIds.includes(signal.id));
    if (related.length === 0) continue;
    const language = note.ambientSignal || note.matchedEnvironment || note.title;
    addGroup({
      id: `tom-${note.id}`,
      name: groupNameFromLanguage(language),
      explanation: `These sit near the post-it "${shortText(note.title, 58)}".`,
      source: "proposed",
      icon: groupingIconForSignals(related),
      signals: related,
      terms: [language, note.title].map(normalizeMeaningLabel),
    });
  }

  const byTerm = new Map<string, ApiSavedSignalSearchResult[]>();
  for (const signal of signals) {
    for (const rawTerm of [...signal.relatedContextTerms, ...signal.relatedTopOfMindNoteTitles]) {
      const term = normalizeMeaningLabel(rawTerm);
      if (!term) continue;
      byTerm.set(term, [...(byTerm.get(term) ?? []), signal]);
    }
  }
  [...byTerm.entries()]
    .filter(([, termSignals]) => termSignals.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .forEach(([term, termSignals]) => {
      addGroup({
        id: `term-${term.replace(/[^a-z0-9]+/g, "-")}`,
        name: groupNameFromLanguage(term),
        explanation: "These saves keep sharing language or Top of Mind evidence.",
        source: "proposed",
        icon: groupingIconForSignals(termSignals),
        signals: termSignals,
        terms: [term],
      });
    });

  const recurring = signals.filter((signal) => signal.signalScores.recurrence >= 5);
  addGroup({
    id: "keeps-returning",
    name: "things that keep returning",
    explanation: "This keeps returning, so the pile stays visible.",
    source: "proposed",
    icon: groupingIconForSignals(recurring),
    signals: recurring,
    terms: ["recurrence"],
  });

  return groups.slice(0, 8);
}

const HOME_COPY = {
  "ko-KR": {
    thoughtTab: "탑오브마인드",
    topOfMindRegionLabel: "탑오브마인드 포스트잇 5개",
    savesTab: "영감 서랍",
    room: "내 방",
    titleLineOne: (name: string) => (
      <>
        <span className="nc-title-name">{name}</span>의 탑오브마인드
      </>
    ),
    titleLineTwo: "",
    titleSuffix: "",
    tagline: <></>,
    lifecycleHint: "",
    noteShifted: ["반복됨", "형성 중", "다시 돌아옴", "긴장", "확인 필요"],
    evidenceLabel: "시작된 곳",
    reactionGroup: "포스트잇 조정",
    notePreviewAria: "포스트잇 미리보기",
    correctionLabel: "포스트잇 수정",
    correctionPlaceholder: "벽에 남길 문장으로 다듬기",
    pinCta: "고정",
    unpinCta: "고정 해제",
    pinTitle: "고정",
    unpinTitle: "고정 해제",
    deleteTitle: "삭제",
    rewriteCta: "저장",
    removeCta: "삭제",
    feedbackPinned: "고정됨",
    feedbackSaved: "저장됨",
    feedbackSaving: "저장 중...",
    feedbackError: "포스트잇을 바꾸지 못했습니다",
    savedSignalCorrectionLabel: "무엇이 달라졌나요?",
    savedSignalCorrectionPlaceholder: "선택 사항 — 지금은 어떻게 달라졌나요?",
    savedSignalCorrectionSave: "저장",
    savedSignalCorrectionSkip: "건너뛰기",
    savedSignalFeedbackSaved: "저장됨",
    savedSignalFeedbackSaving: "저장 중...",
    savedSignalFeedbackError: "영감 피드백을 저장하지 못했습니다",
    savedSignalActionsLabel: "영감 작업",
    savedSignalReflect: "조금 더 생각하기",
    savedSignalReflecting: "생각하는 중…",
    savedSignalDelete: "삭제",
    savedSignalCollapseLabel: "영감 접기",
    savedSignalEditLabel: "저장된 영감 수정",
    savedSignalFeedbackLabel: "영감 피드백",
    savedSignalReflectionConversationLabel: "영감 돌아보기 대화",
    savedSignalOpening: "영감을 여는 중...",
    savedSignalReflectionCount: (count: number) => `이 영감에서 나온 돌아보기 ${count}개`,
    savedSignalReflectionToggleShow: "보기",
    savedSignalReflectionToggleHide: "숨기기",
    savedSignalReflectionDelete: "삭제",
    savedSignalReflectionLoading: "돌아보기를 불러오는 중...",
    savedSignalReflectionEmpty: "돌아보기가 여기에 나타납니다.",
    readingsSectionLabel: "이 영감이 읽힌 방식",
    readingsSummary: (count: number, places: string[]) =>
      `${places.join(", ")}에서 탑오브마인드 ${count}개를 만들었습니다`,
    readingsNoQuote: "이 읽기에서는 어느 부분인지 표시되지 않았습니다",
    ledToSummary: (count: number, places: string[]) =>
      `${places.join(", ")}에서 탑오브마인드 ${count}개로 이어졌습니다`,
    timeRailRegionLabel: "이 방이 지나온 시간",
    timeRailNow: "지금",
    timeRailFormed: "방이 만들어짐",
    timeRailArrived: (name: string) => `${name} 합류`,
    timeRailDeparted: (name: string) => `${name} 떠남`,
    timeRailBackToNow: "지금으로",
    timeRailPastEmpty: "이 순간에는 이 방이 아직 아무것도 읽지 않았습니다.",
    readingsAloneLabel: "혼자일 때",
    readingsInRoomLabel: (name: string) => `${name}에서`,
    readingsLedToLabel: (title: string) => `“${title}”로 이어졌습니다`,
    readingsDivergenceLabel: "여기서는 다르게 읽힙니다",
    readingsNeighborsLabel: "옆에 있던 영감",
    ledToLabel: "이 영감이 만든 탑오브마인드",
    savedSignalListLabel: "저장된 영감 목록",
    savedSignalPathsLabel: "저장된 영감 경로",
    savedSignalNoSearchMatches: (query: string, path: string) => `${path}에서 “${query}”와 맞는 저장된 영감이 없습니다.`,
    savedSignalNoPathMatches: (path: string) => `${path}에는 아직 저장된 영감이 없습니다.`,
    savedSignalShowAllSaved: "/all-saved 보기",
    allSavedPathLabel: "모든 영감",
    recentlySavedPathLabel: "최근 저장",
    allSavedPathDescription: "저장된 모든 영감, 최신순",
    recentlySavedPathDescription: "최근 2일 안에 저장됨",
    topOfMindEvidencePathLabel: "탑오브마인드",
    topOfMindEvidenceDescription: (label: string) => `“${label}”로 이어진 영감`,
    topOfMindEvidenceCount: (count: number) => `영감 ${count}개가 여기로 이어짐`,
    groupingContentsLabel: "묶음 내용",
    backToMap: "← 지도로 돌아가기",
    nameCollectionLabel: "이 묶음 이름 짓기",
    bottomActionsLabel: "하단 작업",
    drawerUndoAria: "영감이 삭제됨, 되돌리기",
    drawerUndoCta: "영감이 삭제됨 · 되돌리기",
    drawerSaveEditedAria: "수정한 영감 저장",
    drawerSaveEditedCta: "저장",
    drawerEditSaving: "영감 저장 중...",
    drawerEditSaved: "영감이 저장되었습니다",
    drawerEditError: "영감 수정을 저장하지 못했습니다",
    drawerDeletePending: "영감이 삭제되었습니다. 되돌릴 수 있습니다.",
    drawerDeleteError: "영감을 삭제하지 못했습니다. 다시 서랍에 넣었습니다.",
    drawerUndoRestored: "영감을 다시 넣었습니다",
    drawerUndoError: "영감을 되돌리지 못했습니다",
    topOfMindUndoAria: "포스트잇이 삭제됨, 되돌리기",
    topOfMindUndoCta: "포스트잇이 삭제됨 · 되돌리기",
    savingShort: "저장 중...",
    cancelEditAria: "수정 취소",
    cancelEditCta: "수정 취소",
    drawerBackHome: "방으로 돌아가기",
    draftLabel: "임시 글",
    reflectionQuestionLoading: "이 영감을 위한 질문을 찾는 중...",
    reflectionAnswerLabel: "돌아보기 답변",
    reflectionAnswerPlaceholder: "여기에 답하기",
    reflectionPrevious: "이전",
    reflectionNext: "다음",
    reflectionSave: "저장",
    reflectionCancel: "취소",
    reflectionQuestionError: "새 질문을 찾지 못해 기본 질문을 보여드립니다.",
    reflectionSaveError: "돌아보기를 저장하지 못했습니다",
    loadingThoughts: "생각을 모으는 중...",
    emptyThoughts: "첫 영감을 기록하세요. 저장하고 돌아볼수록 WAKA가 반복되는 패턴을 연결하고, 고치기 쉬운 임시 포스트잇이 여기에 나타납니다.",
    firstRunTitle: "처음에는 이렇게 시작하세요",
    firstRunSteps: [
      "지금 마음에 걸리는 영감 하나를 저장하세요.",
      "왜 끌렸는지 몇 단어만 덧붙이세요.",
      "영감과 돌아보기가 쌓이면 WAKA가 반복되는 패턴을 임시 포스트잇으로 보여줍니다.",
    ],
    captureTitle: "첫 영감 붙잡기",
    captureBody: "정리하지 않아도 됩니다. 사라지기 전에 저장하고, 왜 끌렸는지만 조금 덧붙이면 됩니다.",
    captureInlineKicker: "영감 기록",
    footnote: (name: string) => (
      <>
        이 페이지는 {name}님이 직접 쓴 글이 아닙니다.
        <br />
        저장한 것들이 모여 모양을 바꾼 결과입니다.
        <br />
        매주 달라집니다.
      </>
    ),
    footnoteCredit: "— Ⓒ 2026, 생각의 서랍",
    savesTitle: "영감 서랍",
    drawerObjectTitle: "저장된 영감",
    drawerObjectBody: "서랍 열기",
    searchLabel: "검색",
    searchPlaceholder: "저장된 영감 검색",
    loadingSaves: "저장된 영감을 불러오는 중...",
    emptySaves: "아직 저장된 영감이 없습니다. 영감을 하나 기록하면 WAKA가 패턴을 연결할 재료가 생깁니다.",
    captureAria: "영감 기록하기",
    captureCta: "영감 기록",
    captureHint: () => "",
    bottomHint: "영감을 기록하고 돌아보면 WAKA가 반복되는 패턴을 임시 포스트잇으로 띄웁니다.",
    myRoomName: "나",
    captureDialog: "영감 기록",
    close: "닫기",
  },
  "en-US": {
    thoughtTab: "top of mind",
    topOfMindRegionLabel: "Five Top of Mind post-its",
    savesTab: "inspiration drawer",
    room: "my room",
    titleLineOne: (name: string) => (
      <>
        <span className="nc-title-name">{name}'s</span> top of mind
      </>
    ),
    titleLineTwo: "",
    titleSuffix: "",
    tagline: <></>,
    lifecycleHint: "",
    noteShifted: ["keeps returning", "newly forming", "came back", "tension", "needs testing"],
    evidenceLabel: "where it began",
    reactionGroup: "post-it controls",
    notePreviewAria: "post-it preview",
    correctionLabel: "edit post-it",
    correctionPlaceholder: "write the version you would keep on the wall",
    pinCta: "PIN",
    unpinCta: "unpin post-it",
    pinTitle: "Pin",
    unpinTitle: "Unpin",
    deleteTitle: "Delete",
    rewriteCta: "save",
    removeCta: "delete",
    feedbackPinned: "pinned",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not change post-it",
    savedSignalCorrectionLabel: "what changed?",
    savedSignalCorrectionPlaceholder: "optional — how does it feel different now?",
    savedSignalCorrectionSave: "save",
    savedSignalCorrectionSkip: "skip",
    savedSignalFeedbackSaved: "saved",
    savedSignalFeedbackSaving: "saving...",
    savedSignalFeedbackError: "could not save inspiration feedback",
    savedSignalActionsLabel: "inspiration actions",
    savedSignalReflect: "reflect",
    savedSignalReflecting: "reflecting",
    savedSignalDelete: "delete",
    savedSignalCollapseLabel: "collapse inspiration",
    savedSignalEditLabel: "edit saved inspiration",
    savedSignalFeedbackLabel: "saved inspiration feedback",
    savedSignalReflectionConversationLabel: "reflection conversation",
    savedSignalOpening: "opening inspiration...",
    savedSignalReflectionCount: (count: number) => `${count} reflection${count === 1 ? "" : "s"} from this inspiration`,
    savedSignalReflectionToggleShow: "show",
    savedSignalReflectionToggleHide: "hide",
    savedSignalReflectionDelete: "delete",
    savedSignalReflectionLoading: "loading reflections...",
    savedSignalReflectionEmpty: "Your reflection will appear here.",
    readingsSectionLabel: "how this inspiration reads",
    readingsSummary: (count: number, places: string[]) =>
      `generated ${count} top of mind${count === 1 ? "" : "s"} in ${places.join(", ")}`,
    readingsNoQuote: "this reading did not point at a particular part",
    ledToSummary: (count: number, places: string[]) =>
      `generated ${count} top of mind${count === 1 ? "" : "s"} in ${places.join(", ")}`,
    timeRailRegionLabel: "this room over time",
    timeRailNow: "now",
    timeRailFormed: "the room was formed",
    timeRailArrived: (name: string) => `${name} joined`,
    timeRailDeparted: (name: string) => `${name} left`,
    timeRailBackToNow: "back to now",
    timeRailPastEmpty: "At this moment the room had not read anything yet.",
    readingsAloneLabel: "alone",
    readingsInRoomLabel: (name: string) => `in ${name}`,
    readingsLedToLabel: (title: string) => `led to “${title}”`,
    readingsDivergenceLabel: "reads differently here",
    readingsNeighborsLabel: "next to",
    ledToLabel: "top of mind this led to",
    savedSignalListLabel: "saved inspiration list",
    savedSignalPathsLabel: "saved inspiration paths",
    savedSignalNoSearchMatches: (query: string, path: string) => `No saved inspirations match “${query}” in ${path}.`,
    savedSignalNoPathMatches: (path: string) => `No saved inspirations in ${path} yet.`,
    savedSignalShowAllSaved: "show /all-saved",
    allSavedPathLabel: "all saved",
    recentlySavedPathLabel: "recently saved",
    allSavedPathDescription: "all saved inspirations, newest first",
    recentlySavedPathDescription: "saved in the last 2 days",
    topOfMindEvidencePathLabel: "top of mind",
    topOfMindEvidenceDescription: (label: string) => `inspirations that led to "${label}"`,
    topOfMindEvidenceCount: (count: number) => `${count} inspiration${count === 1 ? "" : "s"} led here`,
    groupingContentsLabel: "grouping contents",
    backToMap: "← back to map",
    nameCollectionLabel: "name this collection",
    bottomActionsLabel: "bottom actions",
    drawerUndoAria: "inspiration was deleted, undo",
    drawerUndoCta: "inspiration was deleted · undo",
    drawerSaveEditedAria: "save edited inspiration",
    drawerSaveEditedCta: "save",
    drawerEditSaving: "saving inspiration...",
    drawerEditSaved: "inspiration saved",
    drawerEditError: "could not save inspiration edit",
    drawerDeletePending: "inspiration deleted. You can undo it.",
    drawerDeleteError: "could not delete inspiration. It is back in the drawer.",
    drawerUndoRestored: "inspiration restored",
    drawerUndoError: "could not undo inspiration deletion",
    topOfMindUndoAria: "sticky note was deleted, undo",
    topOfMindUndoCta: "sticky note was deleted · undo",
    savingShort: "saving...",
    cancelEditAria: "cancel edit",
    cancelEditCta: "cancel edit",
    drawerBackHome: "back home",
    draftLabel: "draft",
    reflectionQuestionLoading: "Finding a question for this inspiration...",
    reflectionAnswerLabel: "answer reflection prompt",
    reflectionAnswerPlaceholder: "answer here",
    reflectionPrevious: "previous",
    reflectionNext: "next",
    reflectionSave: "save",
    reflectionCancel: "cancel",
    reflectionQuestionError: "Could not find a new question, so this fallback is here.",
    reflectionSaveError: "could not save reflection",
    loadingThoughts: "gathering what is top of mind...",
    emptyThoughts: "Capture an inspiration. As you save and reflect, WAKA connects recurring patterns, and provisional post-its you can correct will appear here.",
    firstRunTitle: "Start with one small loop",
    firstRunSteps: [
      "Save the first inspiration that is tugging at you.",
      "Add a few words about what pulled you toward it.",
      "As you save and reflect, WAKA starts noticing patterns as provisional post-its.",
    ],
    captureTitle: "Catch the first inspiration",
    captureBody: "No tagging, journaling, or organizing. Save the messy, half-formed thing and add a few words about what pulled you toward it.",
    captureInlineKicker: "inspiration capture",
    footnote: () => <></>,
    footnoteCredit: "",
    savesTitle: "inspiration drawer",
    drawerObjectTitle: "saved inspirations",
    drawerObjectBody: "open the drawer",
    searchLabel: "search",
    searchPlaceholder: "search saved inspirations",
    loadingSaves: "loading saved inspirations...",
    emptySaves: "no inspirations saved yet. Capture one and WAKA will have something to connect into patterns.",
    captureAria: "capture inspiration",
    captureCta: "capture inspiration",
    captureHint: () => "",
    bottomHint: "Capture and reflect; WAKA turns recurring patterns into provisional post-its you can correct.",
    myRoomName: "just you",
    captureDialog: "capture inspiration",
    close: "close",
  },
} satisfies Record<
  SupportedLocale,
  {
    thoughtTab: string;
    topOfMindRegionLabel: string;
    savesTab: string;
    room: string;
    titleLineOne: (name: string) => JSX.Element;
    titleLineTwo: string;
    titleSuffix: string;
    tagline: JSX.Element;
    lifecycleHint: string;
    noteShifted: string[];
    evidenceLabel: string;
    reactionGroup: string;
    notePreviewAria: string;
    correctionLabel: string;
    correctionPlaceholder: string;
    pinCta: string;
    unpinCta: string;
    pinTitle: string;
    unpinTitle: string;
    deleteTitle: string;
    rewriteCta: string;
    removeCta: string;
    feedbackPinned: string;
    feedbackSaved: string;
    feedbackSaving: string;
    feedbackError: string;
    savedSignalCorrectionLabel: string;
    savedSignalCorrectionPlaceholder: string;
    savedSignalCorrectionSave: string;
    savedSignalCorrectionSkip: string;
    savedSignalFeedbackSaved: string;
    savedSignalFeedbackSaving: string;
    savedSignalFeedbackError: string;
    savedSignalActionsLabel: string;
    savedSignalReflect: string;
    savedSignalReflecting: string;
    savedSignalDelete: string;
    savedSignalCollapseLabel: string;
    savedSignalEditLabel: string;
    savedSignalFeedbackLabel: string;
    savedSignalReflectionConversationLabel: string;
    savedSignalOpening: string;
    savedSignalReflectionCount: (count: number) => string;
    savedSignalReflectionToggleShow: string;
    savedSignalReflectionToggleHide: string;
    savedSignalReflectionDelete: string;
    savedSignalReflectionLoading: string;
    savedSignalReflectionEmpty: string;
    readingsSectionLabel: string;
    readingsSummary: (count: number, places: string[]) => string;
    readingsNoQuote: string;
    ledToSummary: (count: number, places: string[]) => string;
    timeRailRegionLabel: string;
    timeRailNow: string;
    timeRailFormed: string;
    timeRailArrived: (name: string) => string;
    timeRailDeparted: (name: string) => string;
    timeRailBackToNow: string;
    timeRailPastEmpty: string;
    readingsAloneLabel: string;
    readingsInRoomLabel: (name: string) => string;
    readingsLedToLabel: (title: string) => string;
    readingsDivergenceLabel: string;
    readingsNeighborsLabel: string;
    ledToLabel: string;
    savedSignalListLabel: string;
    savedSignalPathsLabel: string;
    savedSignalNoSearchMatches: (query: string, path: string) => string;
    savedSignalNoPathMatches: (path: string) => string;
    savedSignalShowAllSaved: string;
    allSavedPathLabel: string;
    recentlySavedPathLabel: string;
    allSavedPathDescription: string;
    recentlySavedPathDescription: string;
    topOfMindEvidencePathLabel: string;
    topOfMindEvidenceDescription: (label: string) => string;
    topOfMindEvidenceCount: (count: number) => string;
    groupingContentsLabel: string;
    backToMap: string;
    nameCollectionLabel: string;
    bottomActionsLabel: string;
    drawerUndoAria: string;
    drawerUndoCta: string;
    drawerSaveEditedAria: string;
    drawerSaveEditedCta: string;
    drawerEditSaving: string;
    drawerEditSaved: string;
    drawerEditError: string;
    drawerDeletePending: string;
    drawerDeleteError: string;
    drawerUndoRestored: string;
    drawerUndoError: string;
    topOfMindUndoAria: string;
    topOfMindUndoCta: string;
    savingShort: string;
    cancelEditAria: string;
    cancelEditCta: string;
    drawerBackHome: string;
    draftLabel: string;
    reflectionQuestionLoading: string;
    reflectionAnswerLabel: string;
    reflectionAnswerPlaceholder: string;
    reflectionPrevious: string;
    reflectionNext: string;
    reflectionSave: string;
    reflectionCancel: string;
    reflectionQuestionError: string;
    reflectionSaveError: string;
    loadingThoughts: string;
    emptyThoughts: string;
    firstRunTitle: string;
    firstRunSteps: [string, string, string];
    captureTitle: string;
    captureBody: string;
    captureInlineKicker: string;
    footnote: (name: string) => JSX.Element;
    footnoteCredit: string;
    savesTitle: string;
    drawerObjectTitle: string;
    drawerObjectBody: string;
    searchLabel: string;
    searchPlaceholder: string;
    loadingSaves: string;
    emptySaves: string;
    captureAria: string;
    captureCta: string;
    captureHint: (count: number) => string;
    bottomHint: string;
    myRoomName: string;
    captureDialog: string;
    close: string;
  }
>;

export function HomePage(): JSX.Element {
  const { user } = useAuth();

  // Local list state is the union of:
  //   1. Rows fetched once on mount from GET /inspirations (the
  //      authenticated user's history, scoped to their `user_id` by the
  //      API).
  //   2. Optimistic rows added during this session as the user saves new
  //      inspirations through the `<CaptureForm>`.
  //
  // The fetch is a single request — pagination lands in a later AC. The
  // API enforces tenant scope, so this page never has to filter by
  // `user_id` itself; whatever the server returns is by construction the
  // current user's data, which is exactly the data-isolation contract the
  // seed's `data_isolation` evaluation rule calls for.
  const [entries, setEntries] = useState<InspirationListEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setTopOfMind] = useState<ApiTopOfMind | null>(null);
  const [topOfMindLoading, setTopOfMindLoading] = useState(true);
  const [topOfMindError, setTopOfMindError] = useState<string | null>(null);
  const [topOfMindNotes, setTopOfMindNotes] = useState<ApiTopOfMindNoteSurface[]>([]);
  const [topOfMindNotesLoading, setTopOfMindNotesLoading] = useState(true);
  const [homeStateOwnerId, setHomeStateOwnerId] = useState<string | null>(user?.id ?? null);
  const [groupRooms, setGroupRooms] = useState<ApiGroupConversationRoom[]>([]);
  const [groupRoomsLoading, setGroupRoomsLoading] = useState(false);
  const [groupRoomsError, setGroupRoomsError] = useState<string | null>(null);
  const [groupRoomStatus, setGroupRoomStatus] = useState<
    { status: "idle" } | { status: "saving" } | { status: "saved"; message: string } | { status: "error"; message: string }
  >({ status: "idle" });
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const [inspirationFilters, setInspirationFilters] =
    useState<InspirationDiscoveryFilters>(DEFAULT_INSPIRATION_FILTERS);
  const [selectedMemoryGroupId, setSelectedMemoryGroupId] = useState<string | null>(null);
  const [selectedMemoryPathFilterId, setSelectedMemoryPathFilterId] = useState("all-saved");
  // The cleaned-up contents view always reads newest-first; the explicit
  // sort toggle was removed in favor of a calmer, text-forward layout.
  const memoryBrowseOrder: MemoryBrowseOrder = "newest";
  const [userMemoryGroups, setUserMemoryGroups] = useState<UserMemoryGrouping[]>([]);
  const [renamedMemoryGroups, setRenamedMemoryGroups] = useState<Record<string, string>>({});
  const [dismissedMemoryGroupIds] = useState<Set<string>>(() => new Set());
  const [memoryGroupDrags, setMemoryGroupDrags] = useState<Record<string, { x: number; y: number }>>({});
  const [memoryPreviewPlacements, setMemoryPreviewPlacements] = useState<Record<string, MemoryPreviewPlacement>>({});
  const [seenMemoryGroupIds, setSeenMemoryGroupIds] = useState<Set<string>>(() => new Set());
  const [draggingMemoryGroupId, setDraggingMemoryGroupId] = useState<string | null>(null);
  const [memoryWindows, setMemoryWindows] = useState<MemoryWindowState[]>([]);
  const [memoryWindowDetails, setMemoryWindowDetails] = useState<Record<string, ApiSavedSignalDetail | null>>({});
  const [memoryWindowLoadingIds, setMemoryWindowLoadingIds] = useState<Set<string>>(() => new Set());
  const [memoryWindowZ, setMemoryWindowZ] = useState(10);
  const [captureFocused, setCaptureFocused] = useState(false);
  const [captureSaveFlash, setCaptureSaveFlash] = useState(false);
  const [captureView] = useState<CaptureView>("note");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<HomeMode>("topOfMind");
  // Group Top of Mind boards (US-052). `activeBoard` is MINE_BOARD_ID for the
  // personal wall, or a group id for a group board.
  const [activeBoard, setActiveBoard] = useState<string>(MINE_BOARD_ID);
  const [groupBoards, setGroupBoards] = useState<ApiGroupSummary[]>([]);
  const [groupBoardsError, setGroupBoardsError] = useState<string | null>(null);
  const [groupNotes, setGroupNotes] = useState<ApiGroupTopOfMindNote[]>([]);
  const [groupBoardLoading, setGroupBoardLoading] = useState(false);
  // The board endpoint already returns the group's members; keeping them lets
  // a room show its cast rather than only its name.
  const [groupMembers, setGroupMembers] = useState<ApiGroupMemberSummary[]>([]);
  const [groupRefreshing, setGroupRefreshing] = useState(false);
  /**
   * The room's life, and where on it the wall is standing.
   *
   * `scrubbedAt === null` is the present, which is a position like any other
   * rather than the absence of one — the rail rests there and travel back is
   * always reversible.
   */
  const [roomTimeline, setRoomTimeline] = useState<ApiRoomTimeline | null>(null);
  const [scrubbedAt, setScrubbedAt] = useState<string | null>(null);
  const [scrubbedNotes, setScrubbedNotes] = useState<ApiTimelineNote[] | null>(null);
  /** Which saves have their readings unfolded. Collapsed is the resting state. */
  const [expandedReadings, setExpandedReadings] = useState<Set<string>>(new Set());
  /** Which collapsed cards have unfolded the readings they led to. */
  const [expandedLedChips, setExpandedLedChips] = useState<Set<string>>(new Set());
  /**
   * The reading you are currently looking at a save through.
   *
   * This is the whole point of the surface: the same save read by two rooms
   * rests on different sentences, so "which words" is only answerable once you
   * have said WHICH READING you are asking about.
   */
  const [activeReading, setActiveReading] = useState<{
    signalId: string;
    noteId: string;
    quote: string | null;
  } | null>(null);
  /**
   * The reading you opened these saves through, if you came from one.
   *
   * Set when the evidence drawer is opened from a post-it, cleared when the
   * drawer closes. It is what makes the same save light up differently
   * depending on which reading you arrived by — which is the entire claim.
   */
  const [arrivedThroughNote, setArrivedThroughNote] = useState<{
    noteId: string;
    quoteBySignalId: Map<string, string>;
  } | null>(null);
  // A join code lifted off the URL, waiting on the person to say yes. Joining
  // is not a navigation: it puts your saved signals into a pool other people
  // read, so a link alone must never be enough to do it.
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [joinPending, setJoinPending] = useState(false);
  /**
   * Which half of the move the wall is in. Switching rooms is travel, so the
   * notes leave before the next room's arrive rather than cross-fading.
   */
  const [travel, setTravel] = useState<"out" | "in" | null>(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureClosing, setCaptureClosing] = useState(false);
  const [captureSaved, setCaptureSaved] = useState(false);
  const [captureHasDraft, setCaptureHasDraft] = useState<boolean>(() => captureDraftHasContent());
  const captureSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Group Top of Mind boards (US-052) -----------------------------------

  const loadGroupBoards = useCallback(async (): Promise<ApiGroupSummary[]> => {
    try {
      const boards = await fetchGroups();
      setGroupBoards(boards);
      setGroupBoardsError(null);
      return boards;
    } catch (err) {
      setGroupBoardsError(err instanceof Error ? err.message : "Failed to load boards");
      return [];
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setGroupBoards([]);
      setActiveBoard(MINE_BOARD_ID);
      return;
    }
    void loadGroupBoards();
  }, [user, loadGroupBoards]);

  /**
   * A room's life is loaded once per room, and scrubbing is then pure client
   * state — the marks number in the handful, so holding them costs nothing and
   * dragging never waits on a request.
   */
  useEffect(() => {
    if (!user || activeBoard === MINE_BOARD_ID) {
      setRoomTimeline(null);
      setScrubbedAt(null);
      setScrubbedNotes(null);
      return;
    }
    let cancelled = false;
    fetchRoomTimeline(activeBoard)
      .then((result) => {
        if (!cancelled) setRoomTimeline(result.timeline);
      })
      .catch((err) => {
        // A room without a readable history still shows its wall; the rail
        // simply does not appear. Never an error the wall has to carry — but
        // never silent either, or a rail that fails to load is indistinguishable from a room too young to have one.
        console.error("[home] room timeline failed to load", { activeBoard, err });
        if (!cancelled) setRoomTimeline(null);
      });
    return () => {
      cancelled = true;
    };
    /**
     * Keyed on the user's ID, not the user object.
     *
     * The object is rebuilt by the auth context on renders that change nothing
     * about who is signed in, so depending on it re-ran this effect on every
     * render — each run cancelling the request the previous one had in flight.
     * A fetch that is always superseded never lands, and the rail never
     * appeared. `user?.id` is what the rest of this file keys on for the same
     * reason.
     */
  }, [user?.id, activeBoard]);

  /**
   * Every board this room has ever shown, held once.
   *
   * A room's history is a handful of moments, so the whole of it fits in
   * memory and travel costs nothing after the first visit. Without this, each
   * scrub was a fresh round-trip that re-sent the entire event list alongside
   * the one board it was asked for — the rail moved instantly and the wall
   * caught up a beat later, which reads as the instrument being broken rather
   * than the network being slow.
   */
  const boardsByMoment = useRef(new Map<string, ApiTimelineNote[]>());
  const scrubSeq = useRef(0);

  useEffect(() => {
    boardsByMoment.current = new Map();
  }, [activeBoard]);

  useEffect(() => {
    if (!user || activeBoard === MINE_BOARD_ID || scrubbedAt === null) {
      setScrubbedNotes(null);
      return;
    }
    // Already visited: show it in the same frame the rail moved.
    const cached = boardsByMoment.current.get(scrubbedAt);
    if (cached) {
      setScrubbedNotes(cached);
      return;
    }
    const seq = ++scrubSeq.current;
    fetchRoomTimeline(activeBoard, scrubbedAt)
      .then((result) => {
        const notes = result.board?.notes ?? [];
        boardsByMoment.current.set(scrubbedAt, notes);
        // Sequence-guarded: dragging fires these faster than they return, and a
        // slow earlier response landing last would show a moment the rail has
        // already left.
        if (seq !== scrubSeq.current) return;
        setScrubbedNotes(notes);
      })
      .catch((err) => {
        console.error("[home] board-as-of failed", { activeBoard, scrubbedAt, err });
        if (seq === scrubSeq.current) setScrubbedNotes(null);
      });
  }, [user?.id, activeBoard, scrubbedAt]);

  /**
   * Warm every moment in the background, one at a time.
   *
   * Sequential and unhurried on purpose: this is work nobody asked for, and it
   * must never compete with the board the person is actually looking at. By
   * the time anyone reaches for the rail the whole room's history is usually
   * already in hand, and travel is instant from the first drag rather than the
   * second.
   */
  useEffect(() => {
    if (!user || activeBoard === MINE_BOARD_ID || !roomTimeline) return;
    let cancelled = false;
    const moments = [...new Set(roomTimeline.events.map((event) => event.at))];
    void (async () => {
      for (const at of moments) {
        if (cancelled) return;
        if (boardsByMoment.current.has(at)) continue;
        try {
          const result = await fetchRoomTimeline(activeBoard, at);
          if (cancelled) return;
          boardsByMoment.current.set(at, result.board?.notes ?? []);
        } catch {
          // A moment that will not load is simply fetched again if visited.
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, activeBoard, roomTimeline]);

  // Load the synthesized board whenever a group is selected.
  useEffect(() => {
    if (!user || activeBoard === MINE_BOARD_ID) {
      setGroupNotes([]);
      setGroupMembers([]);
      setGroupBoardLoading(false);
      return;
    }
    let cancelled = false;
    setGroupBoardLoading(true);
    fetchGroupTopOfMind(activeBoard, TOP_OF_MIND_NOTE_LIMIT)
      .then((result) => {
        if (cancelled) return;
        setGroupNotes(result.notes);
        setGroupMembers(result.members ?? []);
        setGroupBoardsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setGroupNotes([]);
        const message = err instanceof Error ? err.message : "Failed to load group board";
        setGroupBoardsError(message);
        console.error("[home] group board failed to load", { activeBoard, err });
        /**
         * Leave the room ONLY when the room is genuinely not yours any more.
         *
         * This used to eject on any failure at all, so a timeout or a blip
         * threw you out to your own wall mid-session — the room you were
         * reading simply vanished, and nothing said why. A stale or left group
         * is a 403/404; everything else is worth staying put for and showing
         * the error on the wall you are already on.
         */
        if (/not found|forbidden|403|404/i.test(message)) setActiveBoard(MINE_BOARD_ID);
      })
      .finally(() => {
        if (!cancelled) setGroupBoardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, activeBoard]);

  /**
   * Arriving via a `?join=CODE` invite link *offers* the join; it does not
   * perform it.
   *
   * Joining a group is not a navigation. It puts every signal you have marked
   * shareable into a pool the group's other members read, tagged with your
   * name — so a link someone got you to open must never be sufficient on its
   * own. The code is lifted off the URL immediately (a refresh should not
   * re-offer it) and held until the person says yes.
   */
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const rawJoin = params.get("join");
    if (!rawJoin) return;
    setPendingJoinCode(extractJoinCode(rawJoin));
    params.delete("join");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
  }, [user]);

  const confirmPendingJoin = useCallback(async () => {
    if (!pendingJoinCode || joinPending) return;
    setJoinPending(true);
    try {
      const result = await apiJoinGroup(pendingJoinCode);
      await loadGroupBoards();
      setActiveBoard(result.group.id);
      setPendingJoinCode(null);
      setGroupBoardsError(null);
    } catch (err) {
      setGroupBoardsError(err instanceof Error ? err.message : "Could not join that group");
      setPendingJoinCode(null);
    } finally {
      setJoinPending(false);
    }
  }, [pendingJoinCode, joinPending, loadGroupBoards]);

  const handleCreateGroup = useCallback(
    async (name: string) => {
      const group = await apiCreateGroup(name);
      await loadGroupBoards();
      setActiveBoard(group.id);
    },
    [loadGroupBoards],
  );

  const handleJoinGroup = useCallback(
    async (code: string) => {
      const result = await apiJoinGroup(code);
      await loadGroupBoards();
      setActiveBoard(result.group.id);
    },
    [loadGroupBoards],
  );

  /**
   * Deleting or leaving the room you are standing in leaves you nowhere, so
   * both fall back to your own wall. Done before reloading the list so the
   * board that is going away is never briefly the active one.
   */
  const stepOffBoard = useCallback(
    (roomId: string) => {
      if (activeBoard === roomId) setActiveBoard(MINE_BOARD_ID);
    },
    [activeBoard],
  );

  const handleDeleteGroup = useCallback(
    async (roomId: string) => {
      try {
        await apiDeleteGroup(roomId);
        stepOffBoard(roomId);
        await loadGroupBoards();
        setGroupBoardsError(null);
      } catch (err) {
        setGroupBoardsError(
          err instanceof Error ? err.message : "Could not delete that room",
        );
        throw err;
      }
    },
    [loadGroupBoards, stepOffBoard],
  );

  const handleLeaveGroup = useCallback(
    async (roomId: string) => {
      try {
        await apiLeaveGroup(roomId);
        stepOffBoard(roomId);
        await loadGroupBoards();
        setGroupBoardsError(null);
      } catch (err) {
        setGroupBoardsError(
          err instanceof Error ? err.message : "Could not leave that room",
        );
        throw err;
      }
    },
    [loadGroupBoards, stepOffBoard],
  );

  /**
   * Switching rooms is a move, not a swap: the wall empties upward, the board
   * changes while nothing is on screen, and the new room's notes arrive from
   * below. Doing it in one step would cross-fade, which says the content
   * changed rather than that you did.
   */
  const travelToRoom = useCallback(
    (roomId: string) => {
      if (roomId === activeBoard) return;
      setTravel("out");
      window.setTimeout(() => {
        setActiveBoard(roomId);
        setTravel("in");
        window.setTimeout(() => setTravel(null), 640);
      }, 300);
    },
    [activeBoard],
  );

  const handleRenameGroup = useCallback(
    async (roomId: string, name: string) => {
      try {
        await apiRenameGroup(roomId, name);
        await loadGroupBoards();
        setGroupBoardsError(null);
      } catch (err) {
        setGroupBoardsError(err instanceof Error ? err.message : "Could not rename that room");
        throw err;
      }
    },
    [loadGroupBoards],
  );

  const handleRemoveMember = useCallback(
    async (roomId: string, memberUserId: string) => {
      try {
        await apiRemoveGroupMember(roomId, memberUserId);
        // The cast and the board both change when someone leaves it, so reload
        // the active board rather than only the room list.
        await loadGroupBoards();
        setActiveBoard((current) => current);
        setGroupBoardsError(null);
      } catch (err) {
        setGroupBoardsError(err instanceof Error ? err.message : "Could not remove that member");
        throw err;
      }
    },
    [loadGroupBoards],
  );

  const handleRefreshGroup = useCallback(async () => {
    if (activeBoard === MINE_BOARD_ID) return;
    setGroupRefreshing(true);
    try {
      const result = await apiRefreshGroupTopOfMind(activeBoard);
      setGroupNotes(result.notes);
      // A declined run returns the same board, which is indistinguishable from
      // "looked and found nothing new" unless we say so. Pressing a button and
      // watching nothing happen is the thing to avoid.
      setGroupBoardsError(
        result.refreshed ? null : `Just refreshed — ${untilNextRefresh(result.nextEligibleAt)}`,
      );
    } catch (err) {
      setGroupBoardsError(err instanceof Error ? err.message : "Failed to refresh board");
    } finally {
      setGroupRefreshing(false);
    }
  }, [activeBoard]);
  const deletedTopOfMindUndoTimerRef = useRef<number | null>(null);
  const deletedSavedSignalUndoTimerRef = useRef<number | null>(null);
  const [noteFeedback, setNoteFeedback] = useState<
    Record<
      string,
      {
        value: TopOfMindFeedbackValue | null;
        status: FeedbackStatus;
        error: string | null;
        correctionText: string;
      }
    >
  >({});
  const [removedTopOfMindNoteIds, setRemovedTopOfMindNoteIds] = useState<Set<string>>(() => new Set());
  const [deletedTopOfMindUndo, setDeletedTopOfMindUndo] = useState<{
    note: ApiTopOfMindNoteSurface;
    signalId: string;
    feedback: {
      value: TopOfMindFeedbackValue | null;
      status: FeedbackStatus;
      error: string | null;
      correctionText: string;
    };
  } | null>(null);
  const [deletedSavedSignalUndo, setDeletedSavedSignalUndo] = useState<{
    signal: ApiSavedSignalSearchResult;
    detail: ApiSavedSignalDetail | null;
  } | null>(null);
  const [drags, setDrags] = useState<Record<number, { x: number; y: number }>>({});
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [savedSignals, setSavedSignals] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedSignalsLoading, setSavedSignalsLoading] = useState(false);
  const [savedSignalsError, setSavedSignalsError] = useState<string | null>(null);
  const [selectedSavedSignalId, setSelectedSavedSignalId] = useState<string | null>(null);
  const [selectedSupportingSignalFallback, setSelectedSupportingSignalFallback] =
    useState<ApiSavedSignalSearchResult | null>(null);
  const [activeTopOfMindEvidenceFilter, setActiveTopOfMindEvidenceFilter] = useState<MemoryPathFilter | null>(null);
  const [savedSignalDetail, setSavedSignalDetail] = useState<ApiSavedSignalDetail | null>(null);
  const [savedSignalDetailLoading, setSavedSignalDetailLoading] = useState(false);
  const [savedSignalDrafts, setSavedSignalDrafts] = useState<Record<string, string>>({});
  const [savedSignalEditSaving, setSavedSignalEditSaving] = useState(false);
  const [drawerActionStatus, setDrawerActionStatus] = useState<DrawerActionStatus>(null);
  const [savedSignalFeedback, setSavedSignalFeedback] = useState<
    Record<
      string,
      {
        value: SavedSignalFeedbackValue | null;
        status: FeedbackStatus;
        error: string | null;
      }
    >
  >({});
  const [pendingSavedSignalCorrection, setPendingSavedSignalCorrection] = useState<{
    signalId: string;
    value: Extract<SavedSignalFeedbackValue, "partly" | "not_true">;
    text: string;
  } | null>(null);
  const [savedSignalReflections, setSavedSignalReflections] = useState<Record<string, ApiReflection[]>>({});
  const [savedSignalReadings, setSavedSignalReadings] = useState<Record<string, ApiSignalReading[]>>({});
  const [expandedReflectionThreads, setExpandedReflectionThreads] = useState<Set<string>>(() => new Set());
  const [savedSignalReflectionLoadingIds, setSavedSignalReflectionLoadingIds] = useState<Set<string>>(() => new Set());
  const [savedSignalReflectingId, setSavedSignalReflectingId] = useState<string | null>(null);
  const [savedSignalReflectionDraft, setSavedSignalReflectionDraft] = useState("");
  const [savedSignalReflectionAnswers, setSavedSignalReflectionAnswers] = useState<string[]>([]);
  const [savedSignalReflectionQuestions, setSavedSignalReflectionQuestions] = useState<string[]>([]);
  const [savedSignalReflectionQuestionLoadingSteps, setSavedSignalReflectionQuestionLoadingSteps] = useState<
    Set<number>
  >(() => new Set());
  const [savedSignalReflectionStepIndex, setSavedSignalReflectionStepIndex] = useState(0);
  const [savedSignalReflectionSaving, setSavedSignalReflectionSaving] = useState(false);
  const [savedSignalReflectionQuestionError, setSavedSignalReflectionQuestionError] = useState<string | null>(null);
  const [savedSignalReflectionError, setSavedSignalReflectionError] = useState<string | null>(null);
  const savedSignalReflectionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const savedSignalReflectionRequestSeqRef = useRef(0);
  /**
   * `true` until the first `GET /inspirations` resolves for this user.
   * Drives the loading-skeleton UI in `<InspirationsBoard>` so the page
   * never momentarily lies with "0 INSPIRATIONS SAVED" + an empty grid
   * before the fetch comes back. Stays `false` after that point — a
   * future explicit refresh affordance can re-arm it locally without
   * toggling the page-wide skeleton.
   */
  const [initialLoading, setInitialLoading] = useState(true);
  /**
   * Currently-selected inspiration id for the history-drawer detail
   * view. `null` while the user is browsing the list. The detail view
   * itself is responsible for fetching reflections — this page only
   * tracks *which* row is selected.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Track which auth identity owns the rows currently in `entries`. If the
   * user signs out and another user signs in inside the same SPA mount
   * (extremely rare, but defensible against), this guard prevents the
   * previous user's rows from briefly leaking into the new user's view
   * before the next fetch resolves.
   */
  const loadedForUserIdRef = useRef<string | null>(null);
  const activeHomeUserIdRef = useRef<string | null>(user?.id ?? null);
  const topOfMindLoadedForUserIdRef = useRef<string | null>(null);
  const groupRoomsLoadedForUserIdRef = useRef<string | null>(null);
  const topOfMindRequestIdRef = useRef(0);
  const topOfMindEditTimersRef = useRef<Record<string, number>>({});
  const classificationRefreshTimersRef = useRef<number[]>([]);
  const dragStartRef = useRef<{ index: number; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const memoryGroupDragStartRef = useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const dragMovedRef = useRef(false);
  const memoryGroupDragMovedRef = useRef(false);
  const captureSaveFlashTimerRef = useRef<number | null>(null);

  // Keep stale async continuations fenced to the identity from the
  // currently-rendering tree. The passive reset effect below may run after a
  // commit/paint, so the ref cannot wait for that effect to observe auth
  // changes.
  activeHomeUserIdRef.current = user?.id ?? null;

  const clearDrawerCloseTimer = () => {
    if (drawerCloseTimerRef.current === null) return;
    clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = null;
  };

  const clearSessionTimers = useCallback(() => {
    if (captureSaveFlashTimerRef.current !== null) {
      window.clearTimeout(captureSaveFlashTimerRef.current);
      captureSaveFlashTimerRef.current = null;
    }
    if (captureSavedTimerRef.current) {
      clearTimeout(captureSavedTimerRef.current);
      captureSavedTimerRef.current = null;
    }
    if (deletedTopOfMindUndoTimerRef.current !== null) {
      window.clearTimeout(deletedTopOfMindUndoTimerRef.current);
      deletedTopOfMindUndoTimerRef.current = null;
    }
    if (deletedSavedSignalUndoTimerRef.current !== null) {
      window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
      deletedSavedSignalUndoTimerRef.current = null;
    }
    Object.values(topOfMindEditTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    topOfMindEditTimersRef.current = {};
    classificationRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    classificationRefreshTimersRef.current = [];
    clearDrawerCloseTimer();
  }, []);

  const resetUserScopedHomeState = useCallback((nextUserId: string | null) => {
    loadedForUserIdRef.current = null;
    topOfMindLoadedForUserIdRef.current = null;
    topOfMindRequestIdRef.current += 1;
    savedSignalReflectionRequestSeqRef.current += 1;
    clearSessionTimers();
    setEntries([]);
    setLoadError(null);
    setTopOfMind(null);
    setTopOfMindLoading(nextUserId !== null);
    setTopOfMindError(null);
    setTopOfMindNotes([]);
    setTopOfMindNotesLoading(nextUserId !== null);
    setInspirationFilters(DEFAULT_INSPIRATION_FILTERS);
    setSelectedMemoryGroupId(null);
    setSelectedMemoryPathFilterId("all-saved");
    setUserMemoryGroups([]);
    setRenamedMemoryGroups({});
    setMemoryGroupDrags({});
    setMemoryPreviewPlacements({});
    setSeenMemoryGroupIds(new Set());
    setDraggingMemoryGroupId(null);
    setMemoryWindows([]);
    setMemoryWindowDetails({});
    setMemoryWindowLoadingIds(new Set());
    setMemoryWindowZ(10);
    setCaptureFocused(false);
    setCaptureSaveFlash(false);
    setHistoryOpen(false);
    setHomeMode("topOfMind");
    setDrawerClosing(false);
    setCaptureOpen(false);
    setCaptureClosing(false);
    setCaptureSaved(false);
    setNoteFeedback({});
    setRemovedTopOfMindNoteIds(new Set());
    setDeletedTopOfMindUndo(null);
    setDeletedSavedSignalUndo(null);
    setDrags({});
    setDraggingIndex(null);
    setSavedSignals([]);
    setSavedSignalsLoading(false);
    setSavedSignalsError(null);
    setSelectedSavedSignalId(null);
    setSelectedSupportingSignalFallback(null);
    setActiveTopOfMindEvidenceFilter(null);
    // You are no longer looking through any reading, so nothing should stay lit.
    setArrivedThroughNote(null);
    setActiveReading(null);
    setSavedSignalDetail(null);
    setSavedSignalDetailLoading(false);
    setSavedSignalDrafts({});
    setSavedSignalEditSaving(false);
    setDrawerActionStatus(null);
    setSavedSignalFeedback({});
    setPendingSavedSignalCorrection(null);
    setSavedSignalReflections({});
    setExpandedReflectionThreads(new Set());
    setSavedSignalReflectionLoadingIds(new Set());
    setSavedSignalReflectingId(null);
    setSavedSignalReflectionDraft("");
    setSavedSignalReflectionAnswers([]);
    setSavedSignalReflectionQuestions([]);
    setSavedSignalReflectionQuestionLoadingSteps(new Set());
    setSavedSignalReflectionStepIndex(0);
    setSavedSignalReflectionSaving(false);
    setSavedSignalReflectionQuestionError(null);
    setSavedSignalReflectionError(null);
    setInitialLoading(nextUserId !== null);
    setSelectedId(null);
    dragStartRef.current = null;
    memoryGroupDragStartRef.current = null;
    dragMovedRef.current = false;
    memoryGroupDragMovedRef.current = false;
    setHomeStateOwnerId(nextUserId);
  }, [clearSessionTimers]);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (homeStateOwnerId === nextUserId) return;
    resetUserScopedHomeState(nextUserId);
  }, [homeStateOwnerId, resetUserScopedHomeState, user?.id]);

  useEffect(() => {
    setPendingSavedSignalCorrection((current) =>
      current && current.signalId !== selectedSavedSignalId ? null : current,
    );
  }, [selectedSavedSignalId]);

  useEffect(() => {
    if (!user) return;
    const preferredLocale = normalizeSupportedLocale(user.preferredLocale);
    setLocale(preferredLocale);
    writeStoredLocale(preferredLocale);
  }, [user?.preferredLocale, user?.id]);

  useEffect(() => {
    return () => {
      clearSessionTimers();
    };
  }, [clearSessionTimers]);

  useEffect(() => {
    if (!user) {
      // Guard regression — the route should have already redirected to
      // /login. Wipe local state defensively just in case.
      loadedForUserIdRef.current = null;
      topOfMindLoadedForUserIdRef.current = null;
      groupRoomsLoadedForUserIdRef.current = null;
      topOfMindRequestIdRef.current += 1;
      setEntries([]);
      setTopOfMind(null);
      setTopOfMindLoading(false);
      setTopOfMindError(null);
      setTopOfMindNotes([]);
      setTopOfMindNotesLoading(false);
      setGroupRooms([]);
      setGroupRoomsLoading(false);
      setGroupRoomsError(null);
      return;
    }

    // If we already loaded for this user, don't refetch. A future explicit
    // refresh affordance can bypass this by clearing the ref.
    //
    // The ref is only set AFTER the fetch resolves successfully — under
    // React Strict Mode the effect runs twice on mount, and setting the
    // ref synchronously here would cause the second invocation to
    // short-circuit while the first invocation's fetch is still in flight
    // (and ultimately discarded by the `cancelled` flag), leaving
    // `entries` empty forever after a refresh.
    if (loadedForUserIdRef.current === user.id) return;

    let cancelled = false;
    // Optimistically wipe any rows belonging to a *different* user before
    // starting the new fetch. The new fetch result will repopulate.
    if (loadedForUserIdRef.current && loadedForUserIdRef.current !== user.id) {
      setEntries([]);
    }

    void (async () => {
      try {
        const rows = await fetchInspirations();
        if (cancelled || activeHomeUserIdRef.current !== user.id) return;
        // Defence in depth: even though the API enforces tenant scope, we
        // still drop any row whose `userId` does not match the
        // currently-authenticated user. A regression on the server side
        // (or a bug in a future admin endpoint) would not be allowed to
        // surface another user's saves through this page.
        const ownRows = rows.filter((r) => r.userId === user.id);
        const fetched = ownRows.map(apiInspirationToEntry);
        // Merge with any optimistic entries that may have been added
        // *during* the fetch. We dedupe by `tempId`/`id` so a save that
        // raced the response lands once. Optimistic-saving rows take
        // precedence (their status is still in flight).
        setEntries((prev) => {
          const inflight = prev.filter((e) => e.status !== "saved");
          const fetchedById = new Map(fetched.map((e) => [e.id, e] as const));
          // Drop fetched rows that collide with an optimistic save still
          // in flight to keep the in-flight indicator visible.
          for (const e of inflight) fetchedById.delete(e.id);
          // Newest first within each group; the API already returns
          // server rows newest-first.
          return [...inflight, ...fetchedById.values()];
        });
        setLoadError(null);
        // Mark the load as committed only once the canonical state has
        // landed. A subsequent re-render with the same user.id will then
        // correctly short-circuit, while a Strict Mode double-mount that
        // cancelled the first run leaves the ref untouched so the second
        // run actually refetches.
        loadedForUserIdRef.current = user.id;
        setInitialLoading(false);
      } catch (err) {
        if (cancelled || activeHomeUserIdRef.current !== user.id) return;
        const message =
          err instanceof Error ? err.message : "Failed to load saved inspirations";
        setLoadError(message);
        // Drop the skeleton even on failure so the user can still
        // capture into the empty state — the load-error banner below
        // surfaces the actual problem.
        setInitialLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const refreshTopOfMind = useCallback(
    async (options?: {
      showLoading?: boolean;
      surfaceErrors?: boolean;
    }): Promise<ApiTopOfMind | null> => {
      if (!user) return null;

      const requestUserId = user.id;
      const requestId = topOfMindRequestIdRef.current + 1;
      topOfMindRequestIdRef.current = requestId;

      if (options?.showLoading) {
        setTopOfMindLoading(true);
        setTopOfMindNotesLoading(true);
      }
      if (options?.surfaceErrors ?? true) setTopOfMindError(null);

      try {
        const [next, notes] = await Promise.all([
          fetchTopOfMind(),
          fetchTopOfMindNotes({ limit: TOP_OF_MIND_NOTE_LIMIT }),
        ]);
        if (topOfMindRequestIdRef.current !== requestId || activeHomeUserIdRef.current !== requestUserId) return null;
        topOfMindLoadedForUserIdRef.current = requestUserId;
        const fetchedNotes = notes.filter((note) => note.userId === requestUserId);
        setTopOfMind(next);
        setTopOfMindNotes(fetchedNotes);
        setRemovedTopOfMindNoteIds(new Set(fetchedNotes.filter((note) => note.status !== "active").map((note) => note.id)));
        setNoteFeedback(() => {
          const nextFeedback: Record<
            string,
            {
              value: TopOfMindFeedbackValue | null;
              status: FeedbackStatus;
              error: string | null;
              correctionText: string;
            }
          > = {};
          for (const note of fetchedNotes) {
            nextFeedback[note.id] = {
              value: note.isPinned ? "important" : null,
              status: "idle",
              error: null,
              correctionText: note.title || note.ambientSignal,
            };
          }
          return nextFeedback;
        });
        setTopOfMindLoading(false);
        setTopOfMindNotesLoading(false);
        setTopOfMindError(null);
        return next;
      } catch (err) {
        if (topOfMindRequestIdRef.current !== requestId || activeHomeUserIdRef.current !== requestUserId) return null;
        if (options?.surfaceErrors ?? true) {
          const message =
            err instanceof Error ? err.message : "Failed to load 생각";
          setTopOfMindError(message);
        }
        setTopOfMindLoading(false);
        setTopOfMindNotesLoading(false);
        return null;
      }
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;
    if (topOfMindLoadedForUserIdRef.current === user.id) return;

    if (
      topOfMindLoadedForUserIdRef.current &&
      topOfMindLoadedForUserIdRef.current !== user.id
    ) {
      setTopOfMind(null);
    }

    void refreshTopOfMind({ showLoading: true, surfaceErrors: true });

    return () => {
      topOfMindRequestIdRef.current += 1;
    };
  }, [refreshTopOfMind, user]);

  const refreshGroupRooms = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!user) return;
    if (options?.showLoading) setGroupRoomsLoading(true);
    setGroupRoomsError(null);
    try {
      const rooms = await fetchGroupRooms(3);
      setGroupRooms(rooms.filter((room) => room.participants.some((participant) => participant.userId === user.id)));
      groupRoomsLoadedForUserIdRef.current = user.id;
      setGroupRoomsLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load conversation rooms";
      setGroupRoomsError(message);
      setGroupRoomsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!SHOW_LEGACY_GROUP_ROOM_SURFACE) return;
    if (!user) return;
    if (groupRoomsLoadedForUserIdRef.current === user.id) return;
    if (groupRoomsLoadedForUserIdRef.current && groupRoomsLoadedForUserIdRef.current !== user.id) {
      setGroupRooms([]);
    }
    void refreshGroupRooms({ showLoading: true });
  }, [refreshGroupRooms, user]);

  const handleOptimisticAdd = useCallback((pending: PendingInspiration) => {
    setEntries((prev) => [buildOptimisticEntry(pending), ...prev]);
  }, []);

  const handlePersisted = useCallback(
    (tempId: string, result: PersistedResult) => {
      if (activeHomeUserIdRef.current !== result.inspiration.userId) return;
      const reflectionScorePatch = [...(result.reflections ?? [])]
        .reverse()
        .find((item) => item.inspiration)?.inspiration ?? result.reflection?.inspiration;
      const scoredInspiration = reflectionScorePatch
        ? {
            ...result.inspiration,
            importanceScore:
              typeof reflectionScorePatch.importanceScore === "number"
                ? reflectionScorePatch.importanceScore
                : result.inspiration.importanceScore,
            wowScore:
              typeof reflectionScorePatch.wowScore === "number"
                ? reflectionScorePatch.wowScore
                : result.inspiration.wowScore,
          }
        : result.inspiration;

      setEntries((prev) =>
        prev.map((e) =>
          e.tempId === tempId
            ? applyPersisted(
                e,
                scoredInspiration,
                result.attachments,
                result.failedAttachments.length,
                result.reflectionCount ?? result.reflections?.length ?? (result.reflection ? 1 : 0),
              )
            : e,
        ),
      );

      const targetId = result.inspiration.id;
      const targetUserId = result.inspiration.userId;
      void refreshTopOfMind({ showLoading: false, surfaceErrors: true });

      // The classifier worker (or the dev-mode inline fallback) writes
      // `cluster` asynchronously after the row is persisted. Without a
      // refetch the optimistic row stays at `cluster: null` forever in
      // local state, so the cluster grid never lights up. Poll on a
      // backoff schedule — fast classifications (warm Gemini, ~1 s)
      // surface immediately; slower ones still get picked up before the
      // user gives up.
      const delays = [1500, 2500, 3500, 5000];
      let classifiedRefreshRequested = false;
      for (const delay of delays) {
        const timerId = window.setTimeout(() => {
          void (async () => {
            try {
              if (activeHomeUserIdRef.current !== targetUserId) return;
              const rows = await fetchInspirations();
              const target = rows.find((r) => r.id === targetId);
              if (!target || target.userId !== targetUserId || activeHomeUserIdRef.current !== targetUserId) return;
              // Patch server-calculated fields on the matching row; preserve
              // other local fields (status, attachments, errorMessage)
              // we already committed via `applyPersisted`. The setter is
              // also a no-op when those fields are already set, which keeps
              // successive polls cheap if the first one wins.
              setEntries((prev) => {
                const found = prev.find((e) => e.id === target.id);
                if (
                  !found ||
                  (found.cluster === target.cluster && found.wowScore === target.wowScore)
                ) {
                  return prev;
                }
                return prev.map((e) =>
                  e.id === target.id
                    ? { ...e, cluster: target.cluster, wowScore: target.wowScore }
                    : e,
                );
              });
              if (!target.cluster) return;
              if (!classifiedRefreshRequested) {
                classifiedRefreshRequested = true;
                void refreshTopOfMind({
                  showLoading: false,
                  surfaceErrors: false,
                });
              }
            } catch {
              // Silent — the user will pick up the classification on
              // the next mount or refresh. No banner here because the
              // save itself succeeded; surfacing this would be
              // misleading.
            }
          })();
        }, delay);
        classificationRefreshTimersRef.current.push(timerId);
      }
    },
    [
      refreshTopOfMind,
    ],
  );

  const handlePersistError = useCallback(
    (tempId: string, error: ApiError) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.tempId === tempId
            ? {
                ...e,
                status: "error",
                errorMessage: error.message,
              }
            : e,
        ),
      );
    },
    [],
  );

  const recordRevisit = useCallback(
    (id: string, eventType: "detail_opened" | "detail_returned") => {
      const requestUserId = activeHomeUserIdRef.current;
      void (async () => {
        try {
          const result = await recordInspirationRevisit(id, eventType);
          if (result.inspiration && requestUserId !== null && activeHomeUserIdRef.current === requestUserId) {
            setEntries((prev) =>
              prev.map((entry) => applyInspirationScorePatch(entry, result.inspiration!)),
            );
          }
        } catch {
          // Best-effort analytics/scoring signal only; never block detail navigation.
        }
      })();
    },
    [],
  );

  const handleSelectInspiration = useCallback(
    (id: string) => {
      // Sub-AC 9.5 — open the detail view for the activated row. The
      // `<InspirationDetail>` component fetches reflections via the
      // GET endpoint on mount; this page only needs to track the
      // selected id so the panel knows which inspiration to render.
      setSelectedId(id);
      setHistoryOpen(true);
      recordRevisit(id, "detail_opened");
    },
    [recordRevisit],
  );

  const handleBackFromDetail = useCallback(() => {
    const returningId = selectedId;
    setSelectedId(null);
    if (returningId) recordRevisit(returningId, "detail_returned");
  }, [recordRevisit, selectedId]);

  /**
   * Drop the deleted row from local state and dismiss the detail view.
   * The DELETE round-trip has already resolved successfully by the time
   * this fires (the detail view only invokes `onDeleted` on success), so
   * we don't need to gate on a second confirmation here. Tenant scope is
   * implicit: the row was loaded from the same `GET /inspirations`
   * response, which the API enforces by `user_id`.
   */
  const handleDeletedInspiration = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id && e.tempId !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const handleInspirationUpdated = useCallback((inspiration: ApiInspiration) => {
    setEntries((prev) =>
      prev.map((entry) => applyUpdatedInspiration(entry, inspiration)),
    );
  }, []);

  const isHomeStateRenderSafe = user !== null && homeStateOwnerId === user.id;
  const isGroupBoardActive = isHomeStateRenderSafe && activeBoard !== MINE_BOARD_ID;
  const renderEntries = isHomeStateRenderSafe ? entries : [];
  // The wall renders whichever board is active: the personal notes, or the
  // synthesized notes for the selected group. Group notes extend the personal
  // note surface, so they flow through the same card pipeline unchanged.
  /**
   * A board as it stood then, shaped like the board as it stands now.
   *
   * Every field the card pipeline touches is present, because a card is walked
   * by several passes that assume arrays exist — the first version of this
   * fabricated a partial note and the wall crashed on `relatedSignalIds` the
   * moment anyone scrubbed. A past board must be a WHOLE board or it is not a
   * board at all.
   *
   * A reading that is still on the wall keeps its live card, evidence and
   * faces intact: same reading, same id, nothing lost by travelling to a
   * moment it already existed in. Only readings the room has since retired are
   * rebuilt from the timeline, and those carry what the reading SAID without
   * claiming evidence this endpoint never fetched.
   */
  const scrubbedGroupNotes: ApiGroupTopOfMindNote[] | null = scrubbedNotes
    ? scrubbedNotes.map((note): ApiGroupTopOfMindNote => {
        const live = groupNotes.find((candidate) => candidate.id === note.id);
        if (live) return live;
        /*
           Typed, deliberately, rather than cast.
           
           The first version asserted this shape with `as unknown as` and shipped
           a note missing `relatedSignalIds` — the card pipeline walked it and
           took the whole page down. The annotation is what makes the compiler
           the thing that catches the next missing field instead of a user.
        */
        return {
          id: note.id,
          userId: "",
          title: note.title,
          ambitionDimension: "people",
          ambientSignal: "",
          matchedEnvironment: "",
          antiEnvironment: "",
          evidenceRationale: note.why,
          rejectedAlternativeInterpretation: null,
          type: "pattern",
          body: note.why,
          prompt: null,
          guidance: null,
          confidence: 0,
          status: "active",
          isPinned: false,
          userFeedbackValue: null,
          relatedSignalIds: [],
          relatedContextNodeIds: [],
          createdAt: note.createdAt,
          updatedAt: note.createdAt,
          source: "wow_moment_compatibility",
          isProvisional: true,
          legacy: { wowMomentId: note.id, wowKind: "bridge" as const, wowScore: 0 },
          /*
             The faces travel with the reading. Without them a past card is an
             observation from nowhere, and the room's whole claim is that a
             reading exists BECAUSE these particular collections sat together.
          */
          /*
             Defensive: an API that predates this field must not blank the wall.
             A missing array threw inside render and took the whole page down —
             a card missing its faces is a worse card, never a broken app.
          */
          evidencePreviews: (note.evidence ?? []).map((item) => ({
            signalId: item.signalId,
            role: "related",
            textPreview: item.textPreview,
            reason: item.reason,
            createdAt: note.createdAt,
            kind: null,
            // Not carried by the timeline read model, and not invented: a past
            // card shows what the reading rested on, never a score it never had.
            resonanceScore: 0,
            authorUserId: item.ownerUserId,
            authorName: item.ownerName,
          })),
          relatedSignals: [],
          authorUserId: note.evidence?.[0]?.ownerUserId ?? "",
          authorName: note.evidence?.[0]?.ownerName ?? "",
        };
      })
    : null;

  const renderTopOfMindNotes = !isHomeStateRenderSafe
    ? []
    : isGroupBoardActive
      ? (scrubbedGroupNotes ?? groupNotes)
      : topOfMindNotes;
  const renderSavedSignals = isHomeStateRenderSafe ? savedSignals : [];
  const renderUserMemoryGroups = isHomeStateRenderSafe ? userMemoryGroups : [];
  const renderTopOfMindNotesLoading = isHomeStateRenderSafe ? topOfMindNotesLoading : user !== null;

  /**
   * Pull the currently-selected entry out of the local list so we can
   * hand its body / links / attachments to the detail view. Falls back
   * to `null` when the id no longer matches a row (e.g. the row was
   * just persisted with a new server id and the optimistic mapping has
   * already been swapped).
   */
  const selectedEntry = useMemo(() => {
    if (!selectedId) return null;
    return renderEntries.find((e) => e.id === selectedId) ?? null;
  }, [renderEntries, selectedId]);

  const nextEntryInHistory = useMemo(() => {
    if (!selectedId) return null;
    const index = renderEntries.findIndex((entry) => entry.id === selectedId);
    return index >= 0 ? (renderEntries[index + 1] ?? null) : null;
  }, [renderEntries, selectedId]);

  const handleNextInspiration = useCallback(() => {
    if (!nextEntryInHistory) return;
    setSelectedId(nextEntryInHistory.id);
    recordRevisit(nextEntryInHistory.id, "detail_opened");
  }, [nextEntryInHistory, recordRevisit]);

  const detailData = useMemo<InspirationDetailData | null>(() => {
    if (!selectedEntry) return null;
    return {
      id: selectedEntry.id,
      text: displayTextForEntry(selectedEntry),
      links: selectedEntry.links,
      attachments: selectedEntry.attachments,
      timestamp: selectedEntry.timestamp,
      warningMessage:
        selectedEntry.status === "saved" && selectedEntry.errorMessage
          ? selectedEntry.errorMessage
          : undefined,
    };
  }, [selectedEntry]);

  /**
   * The board's `inspirations` prop expects `InspirationCardData[]` in
   * chronological (oldest-first) order — the board itself reverses for
   * display. We currently store entries newest-first (because the user's
   * latest save sits at the top of the saving queue). Reverse here so the
   * board's reversal lands them in the right order.
   */
  const cardItems = useMemo<InspirationCardData[]>(() => {
    return [...renderEntries].reverse().map(entryToCardData);
  }, [renderEntries]);

  const savedInspirationTextById = useMemo(() => {
    return new Map(renderEntries.map((entry) => [entry.id, displayTextForEntry(entry)] as const));
  }, [renderEntries]);

  const deferredSearch = useDeferredValue(inspirationFilters.search);
  const deferredInspirationFilters = useMemo(
    () => ({ ...inspirationFilters, search: deferredSearch }),
    [deferredSearch, inspirationFilters],
  );

  const filteredEntries = useMemo(() => {
    return filterAndSortInspirationEntries(renderEntries, deferredInspirationFilters);
  }, [deferredInspirationFilters, renderEntries]);
  const savedEntryCount = useMemo(() => {
    return renderEntries.filter((entry) => entry.status === "saved").length;
  }, [renderEntries]);

  const savedSignalQuery = deferredSearch.trim().toLowerCase();
  const localSignalRows = filteredEntries.map((entry) => ({
    id: entry.id,
    userId: user?.id ?? "",
    textPreview: shortText(displayTextForEntry(entry), 260),
    kind: entry.kind,
    capturedAt: entry.createdAt,
    updatedAt: entry.createdAt,
    resonanceScore: entry.wowScore ?? 0,
    signalScores: {
      resonance: entry.wowScore ?? 0,
      recurrence: 0,
      agency: 0,
      identitySignal: 0,
      decisionRelevance: 0,
    },
    highlightedSnippets: [],
    matchingSnippets: [],
    relatedContextTerms: [],
    relatedTopOfMindNoteTitles: [],
    // A save still being captured has not reached any board yet.
    relatedGroupNotes: [],
    attachmentSummary: entry.attachments.map((attachment) => ({
      id: attachment.id,
      type: attachment.type,
      label: attachmentContextLabel(attachment, locale),
      ...(attachment.type === "link" && attachment.url ? { url: attachment.url } : {}),
    })),
    relevanceReasons: entry.errorMessage ? [entry.errorMessage] : [],
  } satisfies ApiSavedSignalSearchResult));
  const savedSignalRows = renderSavedSignals.length > 0
    ? [
        ...localSignalRows.filter((entry) => !renderSavedSignals.some((signal) => signal.id === entry.id)),
        ...renderSavedSignals.map((signal) => {
          const local = localSignalRows.find((entry) => entry.id === signal.id);
          if (!local) return signal;
          return {
            ...signal,
            attachmentSummary:
              signal.attachmentSummary.length > 0 ? signal.attachmentSummary : local.attachmentSummary,
            relevanceReasons: [...signal.relevanceReasons, ...local.relevanceReasons],
          };
        }),
      ]
    : localSignalRows;
  const allSavedSignals = sortedSignalsNewest(savedSignalRows);
  const inPlaceSignals = applySearchToSignals(allSavedSignals, savedSignalQuery);
  const memoryGroupings = useMemo(
    () =>
      buildProposedMemoryGroupings(
        inPlaceSignals,
        renderTopOfMindNotes,
        renderUserMemoryGroups,
        renamedMemoryGroups,
        dismissedMemoryGroupIds,
      ),
    [dismissedMemoryGroupIds, inPlaceSignals, renamedMemoryGroups, renderTopOfMindNotes, renderUserMemoryGroups],
  );
  const memoryPathFilters = useMemo(() => {
    const baseFilters = buildMemoryPathFilters(allSavedSignals);
    if (!activeTopOfMindEvidenceFilter) return baseFilters;
    return [
      activeTopOfMindEvidenceFilter,
      ...baseFilters.filter((filter) => filter.id !== activeTopOfMindEvidenceFilter.id),
    ];
  }, [activeTopOfMindEvidenceFilter, allSavedSignals]);
  const selectedMemoryPathFilter =
    memoryPathFilters.find((filter) => filter.id === selectedMemoryPathFilterId) ?? memoryPathFilters[0] ?? null;
  const pathFilteredSignals = selectedMemoryPathFilter
    ? applySearchToSignals(selectedMemoryPathFilter.signals, savedSignalQuery)
    : inPlaceSignals;
  const selectedMemoryGroup =
    selectedMemoryGroupId === null
      ? null
      : memoryGroupings.find((group) => group.id === selectedMemoryGroupId) ?? null;
  const selectedMemoryGroupSignals = selectedMemoryGroup
    ? sortSignalsForGrouping(selectedMemoryGroup.signals, selectedMemoryGroup.terms, memoryBrowseOrder)
    : [];
  const constellationRelationships = buildMemoryConstellationRelationships(inPlaceSignals, renderTopOfMindNotes);
  const selectedMemoryRelationship = constellationRelationships[0] ?? null;

  const visibleMemoryWindows = useMemo(
    () =>
      memoryWindows
        .map((memoryWindow) => ({
          memoryWindow,
          signal: inPlaceSignals.find((signal) => signal.id === memoryWindow.signalId) ?? null,
        }))
        .filter((item): item is { memoryWindow: MemoryWindowState; signal: ApiSavedSignalSearchResult } =>
          item.signal !== null,
        ),
    [inPlaceSignals, memoryWindows],
  );

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (inPlaceSignals.length === 0) {
      if (selectedSavedSignalId !== null) setSelectedSavedSignalId(null);
      if (memoryWindows.length > 0) setMemoryWindows([]);
      return;
    }
    if (selectedSavedSignalId && !inPlaceSignals.some((signal) => signal.id === selectedSavedSignalId)) {
      setSelectedSavedSignalId(null);
    }
    setMemoryWindows((current) => {
      const next = current.filter((memoryWindow) =>
        inPlaceSignals.some((signal) => signal.id === memoryWindow.signalId),
      );
      return next.length === current.length ? current : next;
    });
  }, [homeMode, inPlaceSignals, memoryWindows.length, selectedSavedSignalId]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") {
      setMemoryWindows([]);
      setMemoryWindowDetails({});
      setMemoryWindowLoadingIds(new Set());
      return;
    }
  }, [homeMode]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (selectedMemoryGroupId === null) return;
    if (!memoryGroupings.some((group) => group.id === selectedMemoryGroupId)) {
      setSelectedMemoryGroupId(null);
    }
  }, [homeMode, memoryGroupings, selectedMemoryGroupId]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (!memoryPathFilters.some((filter) => filter.id === selectedMemoryPathFilterId)) {
      setSelectedMemoryPathFilterId("all-saved");
    }
  }, [homeMode, memoryPathFilters, selectedMemoryPathFilterId]);

  useEffect(() => {
    if (!user || homeMode !== "memoryDrawer") return;
    const requestUserId = user.id;
    let cancelled = false;
    setSavedSignalsLoading(true);
    setSavedSignalsError(null);

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await fetchSavedSignals({
            q: inspirationFilters.search.trim() || undefined,
            limit: 24,
          });
          if (cancelled || activeHomeUserIdRef.current !== requestUserId) return;
          const ownRows = rows.filter((row) => row.userId === requestUserId);
          setSavedSignals(ownRows);
          setSelectedSavedSignalId((current) =>
            current && (ownRows.some((row) => row.id === current) || selectedSupportingSignalFallback?.id === current)
              ? current
              : null,
          );
        } catch (caught) {
          if (cancelled || activeHomeUserIdRef.current !== requestUserId) return;
          setSavedSignalsError(caught instanceof Error ? caught.message : "Failed to load saved inspirations");
        } finally {
          if (!cancelled && activeHomeUserIdRef.current === requestUserId) setSavedSignalsLoading(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [homeMode, inspirationFilters.search, selectedSupportingSignalFallback?.id, user]);

  useEffect(() => {
    if (!user || homeMode !== "memoryDrawer") return;
    if (!selectedSavedSignalId) {
      setSavedSignalDetail(null);
      return;
    }

    const requestUserId = user.id;
    let cancelled = false;
    setSavedSignalDetailLoading(true);
    void (async () => {
      try {
        const detail = await fetchSavedSignalDetail(selectedSavedSignalId);
        if (cancelled || detail.userId !== requestUserId || activeHomeUserIdRef.current !== requestUserId) return;
        setSavedSignalDetail(detail);
        setSavedSignalDrafts((current) => {
          const existingDraft = current[detail.id];
          const previousBaseText = savedInspirationTextById.get(detail.id);
          if (existingDraft !== undefined && previousBaseText && existingDraft !== previousBaseText) return current;
          return {
            ...current,
            [detail.id]: detail.rawText,
          };
        });
      } catch {
        if (cancelled || activeHomeUserIdRef.current !== requestUserId) return;
        setSavedSignalDetail(null);
      } finally {
        if (!cancelled && activeHomeUserIdRef.current === requestUserId) setSavedSignalDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, savedInspirationTextById, selectedSavedSignalId, user]);

  useEffect(() => {
    if (!user || homeMode !== "memoryDrawer" || !selectedSavedSignalId) {
      setSavedSignalReflectingId(null);
      setSavedSignalReflectionDraft("");
      setSavedSignalReflectionError(null);
      return;
    }
    if (savedSignalReflections[selectedSavedSignalId]) return;

    const requestUserId = user.id;
    const requestSignalId = selectedSavedSignalId;
    let cancelled = false;
    setSavedSignalReflectionLoadingIds((current) => new Set(current).add(requestSignalId));
    void (async () => {
      try {
        const reflections = await fetchReflections(requestSignalId);
        if (cancelled || activeHomeUserIdRef.current !== requestUserId) return;
        setSavedSignalReflections((current) => ({
          ...current,
          [requestSignalId]: reflections,
        }));
      } catch (error) {
        if (!cancelled && activeHomeUserIdRef.current === requestUserId) {
          console.error("[home] failed to load saved inspiration reflections:", error);
        }
      } finally {
        if (!cancelled && activeHomeUserIdRef.current === requestUserId) {
          setSavedSignalReflectionLoadingIds((current) => {
            const next = new Set(current);
            next.delete(requestSignalId);
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, savedSignalReflections, selectedSavedSignalId, user]);

  // Readings of the opened signal — every Top of Mind note, solo and per-room,
  // that cited it as evidence. Loaded once per signal like reflections above.
  // No loading state on purpose: an uncited signal (the common case) resolves
  // to [] and the section never renders, rather than flashing and vanishing.
  useEffect(() => {
    if (!user || homeMode !== "memoryDrawer" || !selectedSavedSignalId) return;
    if (savedSignalReadings[selectedSavedSignalId]) return;

    const requestUserId = user.id;
    const requestSignalId = selectedSavedSignalId;
    let cancelled = false;
    void (async () => {
      try {
        const readings = await fetchSignalReadings(requestSignalId);
        if (cancelled || activeHomeUserIdRef.current !== requestUserId) return;
        setSavedSignalReadings((current) => ({
          ...current,
          [requestSignalId]: readings,
        }));
      } catch (error) {
        if (!cancelled && activeHomeUserIdRef.current === requestUserId) {
          console.error("[home] failed to load inspiration readings:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, savedSignalReadings, selectedSavedSignalId, user]);

  const historyContent = useMemo(() => {
    if (cardItems.length === 0) return undefined;
    return [...cardItems].reverse().map((item) => (
      <InspirationCard
        key={item.id}
        item={item}
        locale={locale}
        onSelect={handleSelectInspiration}
      />
    ));
  }, [cardItems, handleSelectInspiration, locale]);

  const handleCapturePersisted = useCallback(
    (tempId: string, result: PersistedResult) => {
      setCaptureSaveFlash(true);
      if (captureSaveFlashTimerRef.current !== null) {
        window.clearTimeout(captureSaveFlashTimerRef.current);
      }
      captureSaveFlashTimerRef.current = window.setTimeout(() => {
        setCaptureSaveFlash(false);
        captureSaveFlashTimerRef.current = null;
      }, 700);
      handlePersisted(tempId, result);
    },
    [handlePersisted],
  );

  useEffect(() => {
    if (initialLoading || topOfMindLoading || renderTopOfMindNotesLoading) return;
    setHomeMode((current) => (current === "memoryDrawer" ? current : "topOfMind"));
  }, [initialLoading, renderTopOfMindNotesLoading, topOfMindLoading]);

  useEffect(() => {
    if (draggingIndex === null) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;
      setDrags((prev) => ({
        ...prev,
        [start.index]: {
          x: start.baseX + dx,
          y: start.baseY + dy,
        },
      }));
    };

    const handlePointerUp = () => {
      dragStartRef.current = null;
      setDraggingIndex(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingIndex]);

  useEffect(() => {
    if (draggingMemoryGroupId === null) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const start = memoryGroupDragStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) memoryGroupDragMovedRef.current = true;
      setMemoryGroupDrags((current) => ({
        ...current,
        [start.id]: {
          x: start.baseX + dx,
          y: start.baseY + dy,
        },
      }));
    };

    const handlePointerUp = () => {
      memoryGroupDragStartRef.current = null;
      setDraggingMemoryGroupId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingMemoryGroupId]);

  // The guard guarantees `user` is non-null at this point. The defensive
  // check below converts a guard regression from "blank screen + console
  // TypeError" into a single visible diagnostic line.
  if (!user) {
    return (
      <div
        // Defensive diagnostic surface — kept in the WAKA design language so
        // an accidental render (route-guard regression) still reads as part
        // of the same product rather than a raw browser error page.
        style={{
          padding: "var(--space-6)",
          fontFamily: "var(--font-sans)",
          color: "var(--ink)",
          background: "var(--bg)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 36,
            letterSpacing: "-0.01em",
            margin: "0 0 var(--space-3) 0",
          }}
        >
          Unexpected state
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Home rendered without an authenticated user. This indicates a route
          guard regression — please report it.
        </p>
      </div>
    );
  }

  const showAdminEntry = shouldShowAdminEntry(import.meta.env);

  const historyDetail = detailData ? (
    <InspirationDetail
      // Re-key on id so navigating between inspirations remounts the
      // component and resets the edit/delete affordances for the new row.
      key={detailData.id}
      inspiration={detailData}
      onBack={handleBackFromDetail}
      onDeleted={handleDeletedInspiration}
      onInspirationUpdated={handleInspirationUpdated}
      locale={locale}
      onNextInspiration={nextEntryInHistory ? handleNextInspiration : undefined}
    />
  ) : undefined;

  const thoughtCards = renderTopOfMindNotes.slice(0, TOP_OF_MIND_NOTE_LIMIT).map(noteToThoughtCard);
  const meaningfulThoughtCards = uniqueThoughtCards(thoughtCards.filter(isMeaningfulThoughtCard)).slice(0, TOP_OF_MIND_NOTE_LIMIT);
  const displayName = user.name?.trim() || user.email.split("@")[0] || "yunji";
  const displayHandle = displayName.toLowerCase();
  // On a group board, title the wall after the group (e.g. "waka의 탑오브마인드").
  const activeGroupJoinLink = (() => {
    const g = groupBoards.find((b) => b.id === activeBoard);
    if (!g?.joinCode) return null;
    return typeof window === "undefined"
      ? `?join=${g.joinCode}`
      : `${window.location.origin}/?join=${encodeURIComponent(g.joinCode)}`;
  })();
  const activeGroupName = isGroupBoardActive
    ? groupBoards.find((board) => board.id === activeBoard)?.name ?? null
    : null;
  const titleHandle = activeGroupName ? activeGroupName.toLowerCase() : displayHandle;
  const copy = HOME_COPY[locale];

  /**
   * The rail carries no English of its own — every word it shows comes from
   * the same locale table as the rest of the wall, so a Korean room's history
   * reads in Korean.
   */
  /*
   * A plain object, NOT a useMemo.
   *
   * `copy` is resolved below an early return, so a hook here would run on some
   * renders and not others — which is exactly the hook-order break the Home
   * test guards against. The rail recomputes its marks from a handful of
   * events, so there is nothing here worth a hook.
   */
  const timeRailCopy = {
    regionLabel: copy.timeRailRegionLabel,
    now: copy.timeRailNow,
    formed: copy.timeRailFormed,
    arrived: copy.timeRailArrived,
    departed: copy.timeRailDeparted,
    backToNow: copy.timeRailBackToNow,
  };


  const chooseHomeMode = (mode: HomeMode) => {
    clearDrawerCloseTimer();
    if (mode === "memoryDrawer") {
      setDrawerClosing(false);
      setActiveTopOfMindEvidenceFilter(null);
      setSelectedMemoryGroupId(null);
      setSelectedMemoryPathFilterId("all-saved");
      setSelectedSavedSignalId(null);
      setSavedSignalDetail(null);
      setMemoryWindows([]);
      setMemoryGroupDrags({});
      setSeenMemoryGroupIds(new Set());
    } else {
      setDrawerClosing(false);
      setActiveTopOfMindEvidenceFilter(null);
      setSeenMemoryGroupIds(new Set());
    }
    setHomeMode(mode);
  };

  const closeMemoryDrawer = () => {
    clearDrawerCloseTimer();
    setDrawerClosing(true);
    drawerCloseTimerRef.current = setTimeout(() => {
      drawerCloseTimerRef.current = null;
      setDrawerClosing(false);
      setSeenMemoryGroupIds(new Set());
      setHomeMode("topOfMind");
    }, MEMORY_DRAWER_CLOSE_MS);
  };

  const closeMemoryDrawerFromBackdrop = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) closeMemoryDrawer();
  };

  const openCapture = () => {
    setCaptureClosing(false);
    setCaptureOpen(true);
  };

  const closeCapture = () => {
    setCaptureFocused(false);
    setCaptureClosing(true);
    window.setTimeout(() => {
      setCaptureOpen(false);
      setCaptureClosing(false);
      // The draft was autosaved while typing; reflect whether anything remains.
      setCaptureHasDraft(captureDraftHasContent());
    }, 360);
  };

  // On a successful save we close the capture surface and flash an ephemeral
  // "saved" confirmation on the capture button (a yellow glow that fades),
  // replacing the old in-cell post-save mirror card.
  const handleCaptureSaved = () => {
    closeCapture();
    setCaptureHasDraft(false);
    setCaptureSaved(true);
    if (captureSavedTimerRef.current) clearTimeout(captureSavedTimerRef.current);
    captureSavedTimerRef.current = setTimeout(() => {
      setCaptureSaved(false);
      captureSavedTimerRef.current = null;
    }, 2600);
  };

  const updateCorrectionText = (noteId: string, correctionText: string) => {
    setNoteFeedback((prev) => ({
      ...prev,
      [noteId]: {
        value: prev[noteId]?.value ?? null,
        status: prev[noteId]?.status ?? "idle",
        error: null,
        correctionText,
      },
    }));
  };

  const submitTopOfMindEdit = async (
    signal: HomeThoughtCard,
    nextTitle: string,
  ) => {
    if (!user || !signal.feedbackTargetId) return;
    const requestUserId = user.id;
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return;

    const previousNotes = topOfMindNotes;
    const previousFeedback = noteFeedback[signal.id] ?? {
      value: null,
      status: "idle" as FeedbackStatus,
      error: null,
      correctionText: "",
    };

    setNoteFeedback((prev) => ({
      ...prev,
      [signal.id]: {
        value: "partly",
        status: "saving",
        error: null,
        correctionText: trimmedTitle,
      },
    }));

    setTopOfMindNotes((prev) =>
      prev.map((note) =>
        note.id === signal.feedbackTargetId
          ? {
              ...note,
              title: trimmedTitle,
              ambientSignal: trimmedTitle,
            }
          : note,
      ),
    );

    try {
      const updatedNote = await updateTopOfMindNote(signal.feedbackTargetId, { title: trimmedTitle });
      if (activeHomeUserIdRef.current !== requestUserId || updatedNote.userId !== requestUserId) return;
      setTopOfMindNotes((prev) =>
        prev.map((note) => (note.id === updatedNote.id ? updatedNote : note)),
      );
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          value: "partly",
          status: "saved",
          error: null,
          correctionText: trimmedTitle,
        },
      }));
    } catch {
      if (activeHomeUserIdRef.current !== requestUserId) return;
      setTopOfMindNotes(previousNotes);
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          ...previousFeedback,
          status: "error",
          error: copy.feedbackError,
          correctionText: signal.label,
        },
      }));
    }
  };

  const scheduleTopOfMindAutosave = (signal: HomeThoughtCard, nextTitle: string): void => {
    if (!signal.feedbackTargetId) return;
    const trimmedTitle = nextTitle.trim();
    const currentText = thoughtCardDisplayLabel(signal, locale).trim();
    const existingTimer = topOfMindEditTimersRef.current[signal.id];
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      delete topOfMindEditTimersRef.current[signal.id];
    }
    if (!trimmedTitle || trimmedTitle === currentText) return;
    topOfMindEditTimersRef.current[signal.id] = window.setTimeout(() => {
      delete topOfMindEditTimersRef.current[signal.id];
      void submitTopOfMindEdit(signal, trimmedTitle);
    }, TOP_OF_MIND_AUTOSAVE_MS);
  };

  const pinTopOfMindNote = async (signal: HomeThoughtCard) => {
    if (!user || !signal.feedbackTargetId) return;
    const requestUserId = user.id;
    const currentlyPinned = noteFeedback[signal.id]?.value === "important";
    const previousFeedback = noteFeedback[signal.id] ?? {
      value: null,
      status: "idle" as FeedbackStatus,
      error: null,
      correctionText: "",
    };

    if (currentlyPinned) {
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          value: null,
          status: "saving",
          error: null,
          correctionText: prev[signal.id]?.correctionText ?? signal.label,
        },
      }));
      try {
        await createFeedback({
          targetType: "top_of_mind_note",
          targetId: signal.feedbackTargetId,
          value: "not_important",
        });
        if (activeHomeUserIdRef.current !== requestUserId) return;
        setNoteFeedback((prev) => ({
          ...prev,
          [signal.id]: {
            value: null,
            status: "saved",
            error: null,
            correctionText: prev[signal.id]?.correctionText ?? signal.label,
          },
        }));
      } catch {
        if (activeHomeUserIdRef.current !== requestUserId) return;
        setNoteFeedback((prev) => ({
          ...prev,
          [signal.id]: {
            ...previousFeedback,
            status: "error",
            error: copy.feedbackError,
          },
        }));
      }
      return;
    }

    setNoteFeedback((prev) => ({
      ...prev,
      [signal.id]: {
        value: "important",
        status: "saving",
        error: null,
        correctionText: prev[signal.id]?.correctionText ?? signal.label,
      },
    }));

    try {
      await createFeedback({
        targetType: "top_of_mind_note",
        targetId: signal.feedbackTargetId,
        value: "important",
      });
      if (activeHomeUserIdRef.current !== requestUserId) return;
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          value: "important",
          status: "saved",
          error: null,
          correctionText: prev[signal.id]?.correctionText ?? signal.label,
        },
      }));
    } catch {
      if (activeHomeUserIdRef.current !== requestUserId) return;
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          ...previousFeedback,
          status: "error",
          error: copy.feedbackError,
        },
      }));
    }
  };

  const showDeletedTopOfMindUndo = (
    note: ApiTopOfMindNoteSurface,
    signal: HomeThoughtCard,
    feedback: {
      value: TopOfMindFeedbackValue | null;
      status: FeedbackStatus;
      error: string | null;
      correctionText: string;
    },
  ) => {
    if (deletedTopOfMindUndoTimerRef.current !== null) {
      window.clearTimeout(deletedTopOfMindUndoTimerRef.current);
    }
    setDeletedTopOfMindUndo({ note, signalId: signal.id, feedback });
    deletedTopOfMindUndoTimerRef.current = window.setTimeout(() => {
      setDeletedTopOfMindUndo(null);
      deletedTopOfMindUndoTimerRef.current = null;
    }, 4200);
  };

  const undoDeletedTopOfMindNote = () => {
    if (!deletedTopOfMindUndo) return;
    if (deletedTopOfMindUndoTimerRef.current !== null) {
      window.clearTimeout(deletedTopOfMindUndoTimerRef.current);
      deletedTopOfMindUndoTimerRef.current = null;
    }
    const { note, signalId, feedback } = deletedTopOfMindUndo;
    setTopOfMindNotes((prev) => (prev.some((item) => item.id === note.id) ? prev : [note, ...prev]));
    setRemovedTopOfMindNoteIds((prev) => {
      const next = new Set(prev);
      next.delete(note.id);
      return next;
    });
    setNoteFeedback((prev) => ({
      ...prev,
      [signalId]: feedback,
    }));
    setDeletedTopOfMindUndo(null);
  };

  const pullDownTopOfMindNote = async (signal: HomeThoughtCard) => {
    if (!user || !signal.feedbackTargetId) return;
    const requestUserId = user.id;

    const previousNotes = topOfMindNotes;
    const deletedNote = topOfMindNotes.find((note) => note.id === signal.feedbackTargetId);
    const previousRemovedIds = removedTopOfMindNoteIds;
    const previousFeedback = noteFeedback[signal.id] ?? {
      value: null,
      status: "idle" as FeedbackStatus,
      error: null,
      correctionText: "",
    };

    setNoteFeedback((prev) => ({
      ...prev,
      [signal.id]: {
        value: "not_true",
        status: "saving",
        error: null,
        correctionText: prev[signal.id]?.correctionText ?? signal.label,
      },
    }));
    setRemovedTopOfMindNoteIds((prev) => new Set(prev).add(signal.feedbackTargetId!));
    setTopOfMindNotes((prev) => prev.filter((note) => note.id !== signal.feedbackTargetId));
    const pendingEditTimer = topOfMindEditTimersRef.current[signal.id];
    if (pendingEditTimer !== undefined) {
      window.clearTimeout(pendingEditTimer);
      delete topOfMindEditTimersRef.current[signal.id];
    }
    if (deletedNote) showDeletedTopOfMindUndo(deletedNote, signal, previousFeedback);

    try {
      await createFeedback({
        targetType: "top_of_mind_note",
        targetId: signal.feedbackTargetId,
        value: "not_true",
        correctionText: "pulled down from the wall",
      });
      if (activeHomeUserIdRef.current !== requestUserId) return;
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          value: "not_true",
          status: "saved",
          error: null,
          correctionText: prev[signal.id]?.correctionText ?? signal.label,
        },
      }));
    } catch {
      if (activeHomeUserIdRef.current !== requestUserId) return;
      if (deletedTopOfMindUndoTimerRef.current !== null) {
        window.clearTimeout(deletedTopOfMindUndoTimerRef.current);
        deletedTopOfMindUndoTimerRef.current = null;
      }
      setDeletedTopOfMindUndo(null);
      setTopOfMindNotes(previousNotes);
      setRemovedTopOfMindNoteIds(previousRemovedIds);
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          ...previousFeedback,
          status: "error",
          error: copy.feedbackError,
        },
      }));
    }
  };

  const latestGroupRoom = groupRooms[0] ?? null;
  const latestGroupPrompt = latestGroupRoom?.prompts[0] ?? null;

  const ensureGroupRoom = async (): Promise<ApiGroupConversationRoom> => {
    if (latestGroupRoom) return latestGroupRoom;
    const room = await createGroupRoom({ name: "next conversation" });
    setGroupRooms((prev) => [room, ...prev.filter((item) => item.id !== room.id)]);
    return room;
  };

  const createDiscussionFromPostIt = async (signal: HomeThoughtCard) => {
    if (!signal.feedbackTargetId) return;
    setGroupRoomStatus({ status: "saving" });
    try {
      const room = await ensureGroupRoom();
      const signalIds = signal.supportingSignals
        .map((support) => signalIdForSupportingSignal(support))
        .filter((id): id is string => Boolean(id))
        .slice(0, 6);
      const result = await createDiscussionTopic({
        roomId: room.id,
        title: thoughtCardDisplayLabel(signal, locale),
        sourceTopOfMindNoteId: signal.feedbackTargetId,
        signalIds,
      });
      setGroupRooms((prev) => [result.room, ...prev.filter((item) => item.id !== result.room.id)]);
      setGroupRoomStatus({ status: "saved", message: "discussion topic ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create discussion topic";
      setGroupRoomStatus({ status: "error", message });
    }
  };

  const markLatestPromptAsNextTopic = async () => {
    if (!latestGroupRoom || !latestGroupPrompt) return;
    setGroupRoomStatus({ status: "saving" });
    try {
      const result = await createGroupRoomFeedback(latestGroupRoom.id, {
        promptId: latestGroupPrompt.id,
        reaction: "unresolved",
        note: "Keep this thread alive as the next conversation.",
      });
      setGroupRooms((prev) => [result.room, ...prev.filter((item) => item.id !== result.room.id)]);
      setGroupRoomStatus({ status: "saved", message: result.room.postConversation.nextAction });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save room feedback";
      setGroupRoomStatus({ status: "error", message });
    }
  };

  const renderGroupRoomSurface = (): JSX.Element => {
    const selectedCount = latestGroupRoom?.selectedSignals.length ?? 0;
    const promptCount = latestGroupRoom?.prompts.length ?? 0;
    return (
      <aside className="group-room-surface" aria-label="group Top of Mind conversation room">
        <div>
          <span className="group-room-kicker">group top of mind</span>
          <h2>{latestGroupRoom?.name ?? "next conversation"}</h2>
        </div>
        {groupRoomsLoading ? (
          <p>loading room...</p>
        ) : groupRoomsError ? (
          <p>{groupRoomsError}</p>
        ) : latestGroupPrompt ? (
          <p className="group-room-prompt">{latestGroupPrompt.promptText}</p>
        ) : (
          <p className="group-room-prompt">Turn a post-it into a discussion topic, then let the room make it sharper.</p>
        )}
        <div className="group-room-meta" aria-label="room signals and prompts">
          <span>{selectedCount} signal{selectedCount === 1 ? "" : "s"}</span>
          <span>{promptCount} topic{promptCount === 1 ? "" : "s"}</span>
        </div>
        {latestGroupPrompt ? (
          <button type="button" className="group-room-action" onClick={() => void markLatestPromptAsNextTopic()}>
            keep as next topic
          </button>
        ) : (
          <button type="button" className="group-room-action" onClick={() => void ensureGroupRoom()}>
            create room
          </button>
        )}
        {groupRoomStatus.status === "saved" || groupRoomStatus.status === "error" ? (
          <p className={`group-room-status group-room-status--${groupRoomStatus.status}`}>
            {groupRoomStatus.message}
          </p>
        ) : null}
      </aside>
    );
  };

  const renderPostItActions = (signal: HomeThoughtCard): JSX.Element | null => {
    // Group boards are synthesized from many members' shared notes; editing,
    // pinning, or pulling them down via personal endpoints doesn't apply.
    if (isGroupBoardActive) return null;
    if (!signal.feedbackTargetId) return null;
    const feedbackState = noteFeedback[signal.id];
    const saving = feedbackState?.status === "saving";
    const pinned = feedbackState?.value === "important";
    return (
      <div className="nc-note-actions" role="group" aria-label={copy.reactionGroup}>
        <div className="nc-note-action-buttons">
          <button
            type="button"
            className={`nc-note-icon-btn nc-note-icon-btn--pin${pinned ? " nc-note-icon-btn--pinned" : ""}`}
            disabled={saving}
            aria-label={pinned ? copy.unpinCta : copy.pinCta}
            title={pinned ? copy.unpinTitle : copy.pinTitle}
            onClick={(event) => {
              event.stopPropagation();
              void pinTopOfMindNote(signal);
            }}
          >
            {saving ? (
              <svg className="nc-note-spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 12a8 8 0 0 0-14.1-5.2" />
                <path d="M5.9 6.8H3.6V4.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M14.8 3.4 20.6 9.2" />
                <path d="M15.7 4.3 11.4 8.6 8 8.2 6.4 9.8 14.2 17.6 15.8 16 15.4 12.6 19.7 8.3" />
                <path d="M10.4 14.4 4 20.8" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="nc-note-icon-btn nc-note-icon-btn--delete"
            disabled={saving}
            aria-label={copy.removeCta}
            title={copy.deleteTitle}
            onClick={(event) => {
              event.stopPropagation();
              void pullDownTopOfMindNote(signal);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 7h16" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M6.5 7 7.4 20h9.2l.9-13" />
              <path d="M9 7V4.8h6V7" />
            </svg>
          </button>
          {/* Writes a discussion topic that only the US-051 surface can
              read, so it waits on the same flag rather than sending
              people's post-its somewhere nothing displays. */}
          {SHOW_LEGACY_GROUP_ROOM_SURFACE ? (
            <button
              type="button"
              className="nc-note-icon-btn nc-note-icon-btn--discuss"
              disabled={saving || groupRoomStatus.status === "saving"}
              aria-label="turn this into a discussion topic"
              title="Discuss"
              onClick={(event) => {
                event.stopPropagation();
                void createDiscussionFromPostIt(signal);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 6.5h14" />
                <path d="M5 11.5h9" />
                <path d="M7 18.5 10.5 15H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2z" />
              </svg>
            </button>
          ) : null}
        </div>
        {feedbackState?.status === "error" ? (
          <p className="nc-note-feedback-status nc-note-feedback-status--error">
            {feedbackState.error ?? copy.feedbackError}
          </p>
        ) : null}
      </div>
    );
  };

  const signalMaterialLabel = (signal: ApiSavedSignalSearchResult): string => {
    const visual = signalVisualTreatment(signal);
    const sourceLabel = signalSourceLabel(signal);
    if (visual === "note") return "note scrap";
    if (visual === "link") return sourceLabel || "link slip";
    if (visual === "image") return "image tile";
    return "layered save";
  };

  const createUserMemoryGroup = (): void => {
    const id = `user-${Date.now()}`;
    const signalIds = inPlaceSignals.slice(0, 4).map((signal) => signal.id);
    setUserMemoryGroups((current) => [
      ...current,
      {
        id,
        name: "my own pile",
        signalIds,
      },
    ]);
    setSelectedMemoryGroupId(id);
  };

  const renameMemoryGroup = (groupId: string, name: string): void => {
    const nextName = name.trimStart();
    setRenamedMemoryGroups((current) => ({ ...current, [groupId]: nextName }));
    setUserMemoryGroups((current) =>
      current.map((group) => (group.id === groupId ? { ...group, name: nextName || group.name } : group)),
    );
  };

  const loadMemoryWindowDetail = (signalId: string): void => {
    if (memoryWindowDetails[signalId] !== undefined || memoryWindowLoadingIds.has(signalId)) return;
    const requestUserId = activeHomeUserIdRef.current;
    setMemoryWindowLoadingIds((current) => new Set([...current, signalId]));
    void fetchSavedSignalDetail(signalId)
      .then((detail) => {
        if (requestUserId === null || activeHomeUserIdRef.current !== requestUserId || detail.userId !== requestUserId) return;
        setMemoryWindowDetails((current) => ({ ...current, [signalId]: detail }));
      })
      .catch(() => {
        if (requestUserId === null || activeHomeUserIdRef.current !== requestUserId) return;
        setMemoryWindowDetails((current) => ({ ...current, [signalId]: null }));
      })
      .finally(() => {
        if (requestUserId === null || activeHomeUserIdRef.current !== requestUserId) return;
        setMemoryWindowLoadingIds((current) => {
          const next = new Set(current);
          next.delete(signalId);
          return next;
        });
      });
  };

  const openMemoryWindow = (signal: ApiSavedSignalSearchResult): void => {
    const nextZ = memoryWindowZ + 1;
    const existingIndex = memoryWindows.findIndex((memoryWindow) => memoryWindow.signalId === signal.id);
    setMemoryWindowZ(nextZ);
    setSelectedSavedSignalId(signal.id);
    setSavedSignalDetail(null);
    recordRevisit(signal.id, "detail_opened");
    loadMemoryWindowDetail(signal.id);
    setMemoryWindows((current) => {
      if (existingIndex >= 0) {
        return current.map((memoryWindow) =>
          memoryWindow.signalId === signal.id
            ? { ...memoryWindow, z: nextZ, minimized: false }
            : memoryWindow,
        );
      }
      const offset = current.length % 4;
      return [
        ...current,
        {
          signalId: signal.id,
          x: 80 + offset * 42,
          y: 78 + offset * 34,
          z: nextZ,
          minimized: false,
        },
      ];
    });
  };

  const placeMemoryPreview = (groupId: string, anchor: HTMLElement): void => {
    if (typeof window === "undefined") return;
    const preview = anchor.querySelector<HTMLElement>(".memory-map-preview");
    const previewRect = preview?.getBoundingClientRect();
    const placement = getMemoryPreviewPlacement(
      anchor.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      {
        width: previewRect?.width || MEMORY_PREVIEW_FALLBACK_SIZE.width,
        height: previewRect?.height || MEMORY_PREVIEW_FALLBACK_SIZE.height,
      },
    );
    setMemoryPreviewPlacements((current) => ({ ...current, [groupId]: placement }));
  };

  const clearMemoryPreviewPlacement = (groupId: string): void => {
    setMemoryPreviewPlacements((current) => {
      if (!current[groupId]) return current;
      const next = { ...current };
      delete next[groupId];
      return next;
    });
  };

  const renderMemoryGroupObject = (group: MemoryGrouping): JSX.Element => {
    const selected = selectedMemoryGroup?.id === group.id;
    const seen = seenMemoryGroupIds.has(group.id);
    const groupIndex = memoryGroupings.findIndex((item) => item.id === group.id);
    const slot = MEMORY_MAP_SLOTS[Math.max(0, groupIndex) % MEMORY_MAP_SLOTS.length];
    const weight = Math.min(1.12, Math.max(0.84, 0.88 + group.signals.length * 0.035));
    const opacity = Math.min(0.82, Math.max(0.44, 0.48 + group.signals.length * 0.055));
    const previewPlacement = memoryPreviewPlacements[group.id];
    const markSeen = () => {
      setSeenMemoryGroupIds((current) => {
        if (current.has(group.id)) return current;
        const next = new Set(current);
        next.add(group.id);
        return next;
      });
    };
    return (
      <article
        key={group.id}
        data-skill-tag="true"
        data-skill-id={group.id}
        data-state={selected ? "selected" : seen ? "seen" : "idle"}
        data-jitter-x={String(Math.round((group.x - 50) * 0.7))}
        data-jitter-y={String(Math.round((group.y - 50) * 0.42))}
        className={`memory-group-object memory-group-object--slip memory-group-object--${group.icon} memory-map-node memory-map-node--${group.icon}${
          selected ? " memory-group-object--selected selected" : ""
        }${seen ? " memory-map-node--seen" : ""}${draggingMemoryGroupId === group.id ? " memory-group-object--dragging" : ""}`}
        style={{
          ["--x" as string]: `${slot.x}%`,
          ["--y" as string]: `${slot.y}%`,
          ["--drag-x" as string]: `${memoryGroupDrags[group.id]?.x ?? 0}px`,
          ["--drag-y" as string]: `${memoryGroupDrags[group.id]?.y ?? 0}px`,
          ["--tilt" as string]: `${group.tilt}deg`,
          ["--memory-map-scale" as string]: `${weight}`,
          ["--memory-map-opacity" as string]: `${opacity}`,
          ["--skill-tag-dynamic-scale" as string]: `${weight}`,
          ["--skill-tag-dynamic-opacity" as string]: `${opacity}`,
          ...(previewPlacement
            ? {
                ["--popup-top" as string]: previewPlacement.top,
                ["--popup-left" as string]: previewPlacement.left,
                ["--popup-translate-x" as string]: previewPlacement.translateX,
                ["--popup-rest-y" as string]: previewPlacement.restTranslateY,
                ["--popup-origin-x" as string]: previewPlacement.originX,
                ["--popup-origin-y" as string]: previewPlacement.originY,
              }
            : {}),
        }}
        data-preview-side={previewPlacement?.side ?? "below"}
        onPointerEnter={(event) => {
          markSeen();
          placeMemoryPreview(group.id, event.currentTarget);
        }}
        onPointerLeave={() => clearMemoryPreviewPlacement(group.id)}
        onFocus={(event) => {
          markSeen();
          placeMemoryPreview(group.id, event.currentTarget);
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          clearMemoryPreviewPlacement(group.id);
        }}
      >
        <button
          type="button"
          className="memory-group-hitarea"
          aria-pressed={selected}
          onMouseEnter={markSeen}
          onFocus={markSeen}
          onPointerDown={(event) => {
            const drag = memoryGroupDrags[group.id] ?? { x: 0, y: 0 };
            memoryGroupDragStartRef.current = {
              id: group.id,
              x: event.clientX,
              y: event.clientY,
              baseX: drag.x,
              baseY: drag.y,
            };
            memoryGroupDragMovedRef.current = false;
            setDraggingMemoryGroupId(group.id);
          }}
          onClick={() => {
            if (memoryGroupDragMovedRef.current) {
              memoryGroupDragMovedRef.current = false;
              return;
            }
            setSelectedMemoryGroupId(group.id);
            setSelectedSavedSignalId(null);
            setSavedSignalDetail(null);
          }}
        >
          <strong>{memoryMapLabel(group.name)}</strong>
          <span className="sr-only">{group.name}</span>
        </button>
        <div className="memory-map-preview" aria-hidden="true">
          <p className="memory-map-preview-blurb">{memoryGroupBlurb(group)}</p>
          <span className="memory-map-preview-cta">
            open {group.signals.length === 1 ? "this 1 save" : `these ${group.signals.length} saves`}
          </span>
          <span className="memory-map-preview-label">{memoryMapLabel(group.name)}</span>
        </div>
      </article>
    );
  };

  const renderMemorySignalCard = (
    signal: ApiSavedSignalSearchResult,
    options: { node?: MemoryConstellationNode; compact?: boolean } = {},
  ): JSX.Element => {
    const visual = options.node?.visual ?? signalVisualTreatment(signal);
    const isSelected = memoryWindows.some((memoryWindow) => memoryWindow.signalId === signal.id);
    const isExpanded = false;
    const detailText = signal.textPreview;
    const style = options.node
      ? {
          ["--x" as string]: `${options.node.x}px`,
          ["--y" as string]: `${options.node.y}px`,
        }
      : undefined;
    const cardInner = (
      <>
        <span className="memory-signal-card-kind">
          {signalMaterialLabel(signal)}
          {signal.ownerName ? (
            <span className="memory-signal-card-owner">{signal.ownerName}</span>
          ) : null}
        </span>
        <strong className={signal.quote ? "memory-signal-card-quote" : undefined}>
          {shortText(signal.textPreview, options.compact ? 96 : 180)}
        </strong>
        {/*
          Whose words these were.

          A save's readable text has two authors — the person, and the page they
          linked. Saying which one carried the reading is the difference between
          "you wrote this" and "the thing you linked said this", and collapsing
          them would attribute an article's argument to someone who only saved
          a link.
        */}
        {signal.quote && signal.quoteSource === "enrichment" ? (
          <span className="memory-signal-card-quote-source">
            {t(locale, "quoteFromLinkedPage")}
          </span>
        ) : null}
        {signal.attachmentSummary.slice(0, 2).map((attachment) => (
          <span
            key={attachment.id}
            className={attachment.type === "link" ? "reference-save-link" : "reference-save-attachment"}
          >
            {attachment.label}
          </span>
        ))}
        {signal.relevanceReasons.find((reason) => reason.includes("failed to upload")) ? (
          <span className="reference-save-attachment">
            {signal.relevanceReasons.find((reason) => reason.includes("failed to upload"))}
          </span>
        ) : null}
        <span className="memory-signal-card-date">{formatTimestamp(signal.capturedAt)}</span>
      </>
    );

    if (options.node) {
      return (
      <button
        key={signal.id}
        type="button"
        className={`reference-save signal-revisit-card memory-signal-card memory-signal-card--${visual} memory-constellation-node memory-constellation-node--${visual}${
          isSelected ? " signal-revisit-card--selected memory-signal-card--selected" : ""
        } memory-signal-card--canvas`}
        style={style}
        onClick={() => openMemoryWindow(signal)}
      >
        {cardInner}
      </button>
      );
    }

    return (
      <article
        key={signal.id}
        className={`reference-save signal-revisit-card memory-signal-card memory-signal-card--${visual}${
          isSelected ? " signal-revisit-card--selected memory-signal-card--selected" : ""
        } memory-signal-card--list${isExpanded ? " memory-signal-card--expanded" : ""}`}
      >
        <button
          type="button"
          className="memory-signal-card-summary"
          aria-expanded={memoryWindows.some((memoryWindow) => memoryWindow.signalId === signal.id && !memoryWindow.minimized)}
        onClick={() => {
            openMemoryWindow(signal);
          }}
        >
          {cardInner}
        </button>
        {isExpanded ? (
          <div className="memory-signal-card-detail signal-revisit-detail signal-revisit-detail--open">
            {savedSignalDetailLoading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
            <section>
              <span>saved inspiration</span>
            <p
              className="signal-revisit-raw memory-readable-signal"
            >
              {detailText}
            </p>
            </section>
            {(savedSignalDetail?.attachments.length ?? 0) > 0 || signal.attachmentSummary.length > 0 ? (
              <section>
                <span>attachment details</span>
                <ul className="signal-revisit-notes">
                  {(savedSignalDetail?.attachments.length
                    ? savedSignalDetail.attachments.map((attachment) => ({
                        id: attachment.id,
                        label: `${attachment.label}${
                          attachment.contentType || attachment.size
                            ? ` · ${[attachment.contentType, attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : null]
                                .filter(Boolean)
                                .join(" · ")}`
                            : ""
                        }`,
                      }))
                    : signal.attachmentSummary
                  ).map((attachment) => (
                    <li key={attachment.id}>
                      <strong>{attachment.label}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <span>why it sits near other saves</span>
              {selectedMemoryRelationship &&
              [selectedMemoryRelationship.sourceId, selectedMemoryRelationship.targetId].includes(signal.id) ? (
                <p>{selectedMemoryRelationship.reason}</p>
              ) : signal.relatedTopOfMindNoteTitles[0] ? (
                <p>It points toward "{signal.relatedTopOfMindNoteTitles[0]}".</p>
              ) : signal.relatedContextTerms[0] ? (
                <p>It shares language with "{signal.relatedContextTerms[0]}".</p>
              ) : (
                <p>No strong connection has earned a label yet.</p>
              )}
            </section>
          </div>
        ) : null}
      </article>
    );
  };

  const selectedDrawerSignal = selectedSavedSignalId
    ? pathFilteredSignals.find((signal) => signal.id === selectedSavedSignalId) ??
      allSavedSignals.find((signal) => signal.id === selectedSavedSignalId) ??
      null
    : null;
  const selectedDrawerBaseText =
    selectedDrawerSignal && savedSignalDetail?.id === selectedDrawerSignal.id
      ? savedSignalDetail.rawText
      : selectedDrawerSignal
        ? savedInspirationTextById.get(selectedDrawerSignal.id) ?? selectedDrawerSignal.textPreview
        : "";
  const selectedDrawerDraftText = selectedDrawerSignal
    ? savedSignalDrafts[selectedDrawerSignal.id] ?? selectedDrawerBaseText
    : "";
  const selectedDrawerHasEdit =
    Boolean(selectedDrawerSignal) && selectedDrawerDraftText.trim() !== selectedDrawerBaseText.trim();
  const selectedDrawerIsReflecting =
    homeMode === "memoryDrawer" &&
    Boolean(selectedDrawerSignal) &&
    savedSignalReflectingId === selectedDrawerSignal?.id;
  const selectedDrawerReflectionCanSave = savedSignalReflectionDraft.trim().length > 0;
  const selectedDrawerReflectionQuestionLoading = savedSignalReflectionQuestionLoadingSteps.has(
    savedSignalReflectionStepIndex,
  );
  const selectedDrawerReflectionQuestion =
    selectedDrawerReflectionQuestionLoading && !savedSignalReflectionQuestions[savedSignalReflectionStepIndex]
      ? copy.reflectionQuestionLoading
      : savedSignalReflectionQuestions[savedSignalReflectionStepIndex] ??
        SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[savedSignalReflectionStepIndex] ??
        SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS.length - 1];
  const selectedDrawerReflectionProgress = `${savedSignalReflectionStepIndex + 1}/${SAVED_SIGNAL_REFLECTION_MAX_STEPS}`;
  const localizedMemoryPathLabel = (filter: MemoryPathFilter): string => {
    if (filter.id === "all-saved") return copy.allSavedPathLabel;
    if (filter.id === "recently-saved") return copy.recentlySavedPathLabel;
    return filter.label;
  };
  const localizedMemoryPathDescription = (filter: MemoryPathFilter): string => {
    if (filter.id === "all-saved") return copy.allSavedPathDescription;
    if (filter.id === "recently-saved") return copy.recentlySavedPathDescription;
    return filter.description;
  };
  const selectedDrawerReflectionCanGoNext =
    selectedDrawerReflectionCanSave &&
    !selectedDrawerReflectionQuestionLoading &&
    savedSignalReflectionStepIndex < SAVED_SIGNAL_REFLECTION_MAX_STEPS - 1;
  const selectedDrawerReflectionCanFinish =
    !selectedDrawerReflectionQuestionLoading &&
    savedSignalReflectionAnswers
      .map((answer, index) => (index === savedSignalReflectionStepIndex ? savedSignalReflectionDraft : answer))
      .filter((answer) => answer.trim().length > 0).length > 0;

  const showDrawerSearch =
    homeMode === "memoryDrawer" &&
    !selectedDrawerHasEdit &&
    !deletedSavedSignalUndo &&
    !selectedDrawerIsReflecting;
  const showDrawerEditActions =
    homeMode === "memoryDrawer" && selectedDrawerHasEdit && !deletedSavedSignalUndo;
  const showDrawerUndo = homeMode === "memoryDrawer" && Boolean(deletedSavedSignalUndo);
  const showTopOfMindUndo = homeMode !== "memoryDrawer" && Boolean(deletedTopOfMindUndo);
  const showTopOfMindCapture = homeMode !== "memoryDrawer" && !deletedTopOfMindUndo;
  const showPrimarySaveButton =
    showTopOfMindCapture || showTopOfMindUndo || showDrawerEditActions || showDrawerUndo;

  const cancelSavedSignalReflection = (): void => {
    setSavedSignalReflectingId(null);
    setSavedSignalReflectionDraft("");
    setSavedSignalReflectionAnswers([]);
    setSavedSignalReflectionQuestions([]);
    setSavedSignalReflectionQuestionLoadingSteps(new Set());
    setSavedSignalReflectionStepIndex(0);
    setSavedSignalReflectionQuestionError(null);
    setSavedSignalReflectionError(null);
    savedSignalReflectionRequestSeqRef.current += 1;
  };

  const savedSignalKindForReflection = (signal: ApiSavedSignalSearchResult): ApiInspirationKind => {
    return signal.kind === "link" || signal.kind === "image" || signal.kind === "mixed" ? signal.kind : "note";
  };

  const requestSavedSignalReflectionQuestion = (
    signal: ApiSavedSignalSearchResult,
    stepIndex: number,
    answers: string[],
    questions: string[],
  ): void => {
    const requestId = savedSignalReflectionRequestSeqRef.current + 1;
    savedSignalReflectionRequestSeqRef.current = requestId;
    const fallback =
      SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[stepIndex] ??
      SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS.length - 1];
    setSavedSignalReflectionQuestionLoadingSteps((current) => new Set(current).add(stepIndex));
    setSavedSignalReflectionQuestionError(null);
    const text =
      savedSignalDetail?.id === signal.id
        ? savedSignalDetail.rawText
        : savedInspirationTextById.get(signal.id) ?? signal.textPreview;
    void generateGuidedReflectionQuestion({
      locale,
      inspiration: {
        text,
        kind: savedSignalKindForReflection(signal),
        attachmentKinds: signal.attachmentSummary.map((attachment) => attachment.type),
      },
      priorAnswers: answers
        .map((answer, index) => ({
          question: questions[index] ?? SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[index] ?? fallback,
          answer: answer.trim(),
        }))
        .filter((item) => item.answer.length > 0),
    }).then(
      (response) => {
        if (savedSignalReflectionRequestSeqRef.current !== requestId) return;
        setSavedSignalReflectionQuestionLoadingSteps((current) => {
          const next = new Set(current);
          next.delete(stepIndex);
          return next;
        });
        setSavedSignalReflectionQuestions((current) => {
          const next = [...current];
          next[stepIndex] = response.question.trim() || fallback;
          return next;
        });
      },
      () => {
        if (savedSignalReflectionRequestSeqRef.current !== requestId) return;
        setSavedSignalReflectionQuestionLoadingSteps((current) => {
          const next = new Set(current);
          next.delete(stepIndex);
          return next;
        });
        setSavedSignalReflectionQuestions((current) => {
          const next = [...current];
          next[stepIndex] = fallback;
          return next;
        });
        setSavedSignalReflectionQuestionError(copy.reflectionQuestionError);
      },
    );
  };

  const syncCurrentReflectionAnswer = (): string[] => {
    const nextAnswers = [...savedSignalReflectionAnswers];
    nextAnswers[savedSignalReflectionStepIndex] = savedSignalReflectionDraft;
    setSavedSignalReflectionAnswers(nextAnswers);
    return nextAnswers;
  };

  const goToPreviousSavedSignalReflection = (): void => {
    if (savedSignalReflectionSaving || savedSignalReflectionStepIndex === 0) return;
    const nextAnswers = syncCurrentReflectionAnswer();
    const previousIndex = savedSignalReflectionStepIndex - 1;
    setSavedSignalReflectionStepIndex(previousIndex);
    setSavedSignalReflectionDraft(nextAnswers[previousIndex] ?? "");
    window.setTimeout(() => savedSignalReflectionInputRef.current?.focus(), 0);
  };

  const goToNextSavedSignalReflection = (): void => {
    if (!selectedDrawerSignal || savedSignalReflectionSaving) return;
    const answer = savedSignalReflectionDraft.trim();
    if (answer.length === 0 || savedSignalReflectionStepIndex >= SAVED_SIGNAL_REFLECTION_MAX_STEPS - 1) return;
    const nextAnswers = syncCurrentReflectionAnswer();
    const nextStepIndex = savedSignalReflectionStepIndex + 1;
    const nextQuestions = savedSignalReflectionQuestions.slice(0, nextStepIndex);
    setSavedSignalReflectionQuestions(nextQuestions);
    setSavedSignalReflectionStepIndex(nextStepIndex);
    setSavedSignalReflectionDraft(nextAnswers[nextStepIndex] ?? "");
    requestSavedSignalReflectionQuestion(selectedDrawerSignal, nextStepIndex, nextAnswers, nextQuestions);
    window.setTimeout(() => savedSignalReflectionInputRef.current?.focus(), 0);
  };

  const discardSavedSignalEditAndCollapse = (): void => {
    if (selectedSavedSignalId) {
      setSavedSignalDrafts((current) => {
        const next = { ...current };
        delete next[selectedSavedSignalId];
        return next;
      });
    }
    setSelectedSavedSignalId(null);
    setSavedSignalDetail(null);
    cancelSavedSignalReflection();
  };
  const cancelSavedSignalEdit = (): void => {
    if (!selectedSavedSignalId) return;
    setSavedSignalDrafts((current) => {
      const next = { ...current };
      delete next[selectedSavedSignalId];
      return next;
    });
  };
  const saveEditedSavedSignal = async (): Promise<void> => {
    if (!selectedDrawerSignal || !selectedDrawerHasEdit || savedSignalEditSaving) return;
    const nextText = selectedDrawerDraftText.trim();
    setSavedSignalEditSaving(true);
    setDrawerActionStatus({ tone: "status", message: copy.drawerEditSaving });
    try {
      const updated = await updateInspiration(selectedDrawerSignal.id, { text: nextText });
      const nextSignal = {
        ...selectedDrawerSignal,
        textPreview: updated.text,
        kind: updated.kind,
        updatedAt: updated.updatedAt,
      };
      setSavedSignals((current) =>
        current.map((signal) => (signal.id === updated.id ? nextSignal : signal)),
      );
      setEntries((current) =>
        current.map((entry) => (entry.id === updated.id ? apiInspirationToEntry(updated) : entry)),
      );
      setSavedSignalDetail((current) =>
        current?.id === updated.id
          ? {
              ...current,
              textPreview: updated.text,
              rawText: updated.text,
              kind: updated.kind,
              updatedAt: updated.updatedAt,
            }
          : current,
      );
      setSavedSignalDrafts((current) => {
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
      setDrawerActionStatus({ tone: "status", message: copy.drawerEditSaved });
    } catch (error) {
      console.error("[home] failed to update saved inspiration:", error);
      setSavedSignalDrafts((current) => {
        const next = { ...current };
        delete next[selectedDrawerSignal.id];
        return next;
      });
      setDrawerActionStatus({ tone: "error", message: copy.drawerEditError });
    } finally {
      setSavedSignalEditSaving(false);
    }
  };

  const saveSavedSignalReflection = async (): Promise<void> => {
    const signalId = savedSignalReflectingId;
    if (!signalId || savedSignalReflectionSaving) return;
    const answers = syncCurrentReflectionAnswer();
    const payload = answers
      .map((answer, index) => ({
        question:
          savedSignalReflectionQuestions[index] ??
          SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[index] ??
          SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS.length - 1],
        answer: answer.trim(),
      }))
      .filter((item) => item.answer.length > 0)
      .slice(0, SAVED_SIGNAL_REFLECTION_MAX_STEPS);
    if (payload.length === 0) return;
    setSavedSignalReflectionSaving(true);
    setSavedSignalReflectionError(null);
    setDrawerActionStatus(null);
    try {
      const results = await Promise.all(
        payload.map((item) =>
          createReflection(signalId, {
            question: item.question,
            answer: item.answer,
          }),
        ),
      );
      setSavedSignalReflections((current) => ({
        ...current,
        [signalId]: [...(current[signalId] ?? []), ...results.map((result) => result.reflection)],
      }));
      setExpandedReflectionThreads((current) => new Set(current).add(signalId));
      const scorePatch = [...results].reverse().find((result) => result.inspiration)?.inspiration;
      if (scorePatch) {
        setEntries((current) =>
          current.map((entry) => applyInspirationScorePatch(entry, scorePatch)),
        );
      }
      cancelSavedSignalReflection();
    } catch (error) {
      console.error("[home] failed to save reflection:", error);
      setSavedSignalReflectionError(copy.reflectionSaveError);
    } finally {
      setSavedSignalReflectionSaving(false);
    }
  };

  const openStackSignal = (signal: ApiSavedSignalSearchResult): void => {
    setSavedSignalReflectionError(null);
    if (selectedSavedSignalId === signal.id) {
      setSelectedSavedSignalId(null);
      setSavedSignalDetail(null);
      cancelSavedSignalReflection();
      return;
    }
    setSelectedSavedSignalId(signal.id);
    setDrawerActionStatus(null);
    setSavedSignalDrafts((current) => {
      if (current[signal.id] !== undefined) return current;
      const immediateText = savedInspirationTextById.get(signal.id);
      return immediateText ? { ...current, [signal.id]: immediateText } : current;
    });
    recordRevisit(signal.id, "detail_opened");
  };

  const reflectDeeperOnSavedSignal = (signal: ApiSavedSignalSearchResult): void => {
    if (selectedSavedSignalId !== signal.id) {
      setSelectedSavedSignalId(signal.id);
    }
    setSavedSignalReflectingId(signal.id);
    setDrawerActionStatus(null);
    setSavedSignalReflectionAnswers([]);
    setSavedSignalReflectionQuestions([]);
    setSavedSignalReflectionQuestionLoadingSteps(new Set());
    setSavedSignalReflectionStepIndex(0);
    setSavedSignalReflectionDraft("");
    setSavedSignalReflectionError(null);
    requestSavedSignalReflectionQuestion(signal, 0, [], []);
    window.setTimeout(() => savedSignalReflectionInputRef.current?.focus(), 0);
    recordRevisit(signal.id, "detail_opened");
  };

  const canRestoreDeletedSavedSignal = (signal: ApiSavedSignalSearchResult, requestUserId: string): boolean =>
    signal.userId === requestUserId && activeHomeUserIdRef.current === requestUserId;

  const undoDeletedSavedSignal = () => {
    if (!deletedSavedSignalUndo) return;
    try {
      if (deletedSavedSignalUndoTimerRef.current !== null) {
        window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
        deletedSavedSignalUndoTimerRef.current = null;
      }
      const { signal, detail } = deletedSavedSignalUndo;
      const requestUserId = signal.userId;
      if (!canRestoreDeletedSavedSignal(signal, requestUserId)) {
        setDeletedSavedSignalUndo(null);
        return;
      }
      setSavedSignals((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signal, ...prev]));
      setEntries((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signalToListEntry(signal), ...prev]));
      if (detail) setSavedSignalDetail(detail);
      setSelectedSavedSignalId(signal.id);
      setDeletedSavedSignalUndo(null);
      setDrawerActionStatus({ tone: "status", message: copy.drawerUndoRestored });
    } catch (error) {
      console.error("[home] failed to undo saved inspiration delete:", error);
      setDrawerActionStatus({ tone: "error", message: copy.drawerUndoError });
    }
  };

  const deleteSavedSignalFromDrawer = (signal: ApiSavedSignalSearchResult): void => {
    const requestUserId = activeHomeUserIdRef.current;
    if (!requestUserId || signal.userId !== requestUserId) return;
    if (deletedSavedSignalUndoTimerRef.current !== null) {
      window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
      deletedSavedSignalUndoTimerRef.current = null;
    }
    const detail = savedSignalDetail?.id === signal.id ? savedSignalDetail : null;
    setDrawerActionStatus({ tone: "status", message: copy.drawerDeletePending });
    setDeletedSavedSignalUndo({ signal, detail });
    setSavedSignals((prev) => prev.filter((item) => item.id !== signal.id));
    setEntries((prev) => prev.filter((item) => item.id !== signal.id));
    setSelectedSavedSignalId(null);
    setSavedSignalDetail(null);
    cancelSavedSignalReflection();
    setSavedSignalDrafts((current) => {
      const next = { ...current };
      delete next[signal.id];
      return next;
    });
    deletedSavedSignalUndoTimerRef.current = window.setTimeout(() => {
      void deleteInspiration(signal.id).then(
        () => {
          if (activeHomeUserIdRef.current === requestUserId) setDrawerActionStatus(null);
        },
        (error) => {
          console.error("[home] failed to delete saved inspiration:", error);
          if (!canRestoreDeletedSavedSignal(signal, requestUserId)) return;
          setSavedSignals((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signal, ...prev]));
          setEntries((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signalToListEntry(signal), ...prev]));
          setDrawerActionStatus({ tone: "error", message: copy.drawerDeleteError });
        },
      );
      if (activeHomeUserIdRef.current === requestUserId) setDeletedSavedSignalUndo(null);
      deletedSavedSignalUndoTimerRef.current = null;
    }, 4200);
  };

  const deleteSavedSignalReflection = (signalId: string, reflection: ApiReflection): void => {
    setSavedSignalReflections((current) => ({
      ...current,
      [signalId]: (current[signalId] ?? []).filter((item) => item.id !== reflection.id),
    }));
    void deleteReflection(signalId, reflection.id).catch((error) => {
      console.error("[home] failed to delete reflection:", error);
      setSavedSignalReflections((current) => {
        const existing = current[signalId] ?? [];
        if (existing.some((item) => item.id === reflection.id)) return current;
        return {
          ...current,
          [signalId]: [...existing, reflection].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        };
      });
    });
  };

  const submitSavedSignalFeedback = async (
    signal: ApiSavedSignalSearchResult,
    value: SavedSignalFeedbackValue,
    correctionText?: string,
  ): Promise<void> => {
    const persistedFeedbackValue =
      savedSignalDetail?.id === signal.id
        ? [...savedSignalDetail.resonanceFeedback]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .reverse()
            .find((feedback) => feedback.value === "true" || feedback.value === "partly" || feedback.value === "not_true")
            ?.value ?? null
        : null;
    const previousFeedback = savedSignalFeedback[signal.id] ?? {
      value: persistedFeedbackValue,
      status: "idle" as FeedbackStatus,
      error: null,
    };
    setSavedSignalFeedback((current) => ({
      ...current,
      [signal.id]: { value, status: "saving", error: null },
    }));
    setPendingSavedSignalCorrection((current) =>
      current?.signalId === signal.id ? null : current,
    );

    try {
      const trimmedCorrection = correctionText?.trim();
      const feedback = await createFeedback({
        targetType: "signal",
        targetId: signal.id,
        value,
        ...(trimmedCorrection ? { correctionText: trimmedCorrection } : {}),
      });
      setSavedSignalFeedback((current) => ({
        ...current,
        [signal.id]: { value, status: "saved", error: null },
      }));
      setSavedSignalDetail((current) => {
        if (!current || current.id !== signal.id) return current;
        return {
          ...current,
          resonanceFeedback: [
            ...current.resonanceFeedback,
            {
              id: feedback.id,
              value,
              emotionLabel: feedback.emotionLabel,
              correctionText: feedback.correctionText,
              createdAt: feedback.createdAt,
            },
          ],
        };
      });
    } catch {
      setSavedSignalFeedback((current) => ({
        ...current,
        [signal.id]: {
          ...previousFeedback,
          status: "error",
          error: copy.savedSignalFeedbackError,
        },
      }));
    }
  };

  const renderMemoryStackSignalCard = (signal: ApiSavedSignalSearchResult): JSX.Element => {
    const linkAttachment = signal.attachmentSummary.find((attachment) => attachment.type === "link" && attachment.url);
    const sourceLabel = signalSourceLabel(signal);
    const failedUploadReason = signal.relevanceReasons.find((reason) => reason.includes("failed to upload"));
    const isSelectedSignal = selectedSavedSignalId === signal.id;
    const metaItems = [
      // On a group board, lead with who saved this inspiration.
      signal.ownerName ? `from ${signal.ownerName}` : null,
      sourceLabel,
      ...signal.attachmentSummary.slice(0, 2).map((attachment) => attachment.label),
      failedUploadReason,
      formatTimestamp(signal.capturedAt),
    ].filter(Boolean);
    if (isSelectedSignal) {
      const fullDetailReady = savedSignalDetail?.id === signal.id;
      const immediateFullText = savedInspirationTextById.get(signal.id);
      const detailPending = savedSignalDetailLoading && !fullDetailReady && !immediateFullText;
      const detailText = detailPending ? "" : fullDetailReady ? savedSignalDetail.rawText : immediateFullText ?? signal.textPreview;
      const draftText = savedSignalDrafts[signal.id] ?? detailText;
      const hasEditedDraft = draftText.trim() !== detailText.trim();
      const reflectionRows = savedSignalReflections[signal.id] ?? [];
      const reflectionsLoading = savedSignalReflectionLoadingIds.has(signal.id);
      const isReflecting = savedSignalReflectingId === signal.id;
      const reflectionsExpanded = expandedReflectionThreads.has(signal.id);
      const detailFeedback = savedSignalFeedback[signal.id];
      const detailFeedbackStatus = detailFeedback?.status ?? "idle";
      const detailFeedbackError = detailFeedback?.error ?? null;
      const pendingCorrection = pendingSavedSignalCorrection?.signalId === signal.id
        ? pendingSavedSignalCorrection
        : null;
      const isFeedbackSaving = detailFeedbackStatus === "saving";
      return (
        <article
          className="memory-contents-item memory-contents-item--expanded"
          data-memory-signal-id={signal.id}
        >
          <button
            type="button"
            className="memory-contents-collapse"
            aria-label={copy.savedSignalCollapseLabel}
            onClick={() => {
              if (hasEditedDraft) {
                discardSavedSignalEditAndCollapse();
                return;
              }
              setSelectedSavedSignalId(null);
              setSavedSignalDetail(null);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <div
            className="memory-contents-expanded-copy memory-contents-expanded-copy--ready"
          >
            {detailPending ? (
              <p className="memory-contents-loading">{copy.savedSignalOpening}</p>
            ) : (activeReading?.signalId === signal.id && activeReading.quote)
              || arrivedThroughNote?.quoteBySignalId.get(signal.id) ? (
              /*
                Reading through a reading.

                A textarea cannot mark a span, and marking is the entire point
                here — so choosing a reading swaps the editor for a read-only
                view of the same text with the words that carried THAT reading
                lit. Choosing it again puts the editor back.
              */
              <div
                className="memory-contents-expanded-text memory-contents-expanded-reading"
                aria-label={copy.savedSignalEditLabel}
              >
                {highlightQuote(
                  detailText,
                  activeReading?.signalId === signal.id && activeReading.quote
                    ? activeReading.quote
                    : arrivedThroughNote?.quoteBySignalId.get(signal.id) ?? null,
                )}
              </div>
            ) : (
              <textarea
                className="memory-contents-expanded-text memory-contents-expanded-editor"
                value={draftText}
                onChange={(event) => {
                  setDrawerActionStatus(null);
                  setSavedSignalDrafts((current) => ({
                    ...current,
                    [signal.id]: event.currentTarget.value,
                  }));
                }}
                role="textbox"
                aria-label={copy.savedSignalEditLabel}
                aria-multiline="true"
                spellCheck={true}
              />
            )}
          </div>
          {drawerActionStatus ? (
            <p
              className={`memory-contents-feedback-status${
                drawerActionStatus.tone === "error" ? " memory-contents-feedback-status--error" : ""
              }`}
            >
              {drawerActionStatus.message}
            </p>
          ) : null}
          {/* Readings: the same save, read alone and read beside each room's
              other hearts. The contrast IS the content — the belief statements
              sit adjacent and disagree (or agree) on their own. Absent
              entirely when nothing cited this signal.

              Each reading names the Top of Mind it produced and the room it
              produced it in, because "in Waka" alone never said what this save
              actually made happen there. Where a room reads the save
              differently from the way its owner does, that difference is said
              here — beside the save it is about, rather than as a card on the
              owner's own wall competing with their real top-of-minds. */}
          {(savedSignalReadings[signal.id]?.length ?? 0) > 0 ? (
            <section
              className="memory-contents-readings"
              aria-label={copy.readingsSectionLabel}
            >
              {/*
                One line first, then the readings, then the words.

                This used to print every reading in full at once — title,
                belief, the judge's reason, and two neighbour previews each —
                so four readings filled the surface and none of them landed.
                What a person wants from a save is: how many did this produce,
                which ones, and then WHICH WORDS. Three steps, each answering
                the question the last one raises.
              */}
              <button
                type="button"
                className="memory-contents-readings-summary"
                aria-expanded={expandedReadings.has(signal.id)}
                onClick={() =>
                  setExpandedReadings((current) => {
                    const next = new Set(current);
                    if (next.has(signal.id)) next.delete(signal.id);
                    else next.add(signal.id);
                    return next;
                  })
                }
              >
                {copy.readingsSummary(
                  savedSignalReadings[signal.id]?.length ?? 0,
                  Array.from(
                    new Set(
                      (savedSignalReadings[signal.id] ?? []).map((reading) =>
                        reading.context.scope === "alone"
                          ? copy.readingsAloneLabel
                          : reading.context.groupName,
                      ),
                    ),
                  ),
                )}
              </button>

              {expandedReadings.has(signal.id) ? (
                <ul className="memory-reading-list">
                  {(savedSignalReadings[signal.id] ?? []).map((reading) => {
                    const isOpen = activeReading?.signalId === signal.id
                      && activeReading.noteId === reading.note.id;
                    const contextLabel =
                      reading.context.scope === "alone"
                        ? copy.readingsAloneLabel
                        : copy.readingsInRoomLabel(reading.context.groupName);
                    return (
                      <li key={reading.note.id} className="memory-reading">
                        {/*
                          Choosing a reading is what highlights the save.

                          The same save read by two rooms lights up different
                          sentences, and that difference IS the claim — so the
                          reading has to be selectable, not merely listed.
                        */}
                        <button
                          type="button"
                          className={`memory-reading-pick${isOpen ? " memory-reading-pick--open" : ""}`}
                          aria-pressed={isOpen}
                          disabled={!reading.quote}
                          title={reading.quote ? undefined : copy.readingsNoQuote}
                          onClick={() =>
                            setActiveReading((current) =>
                              current?.signalId === signal.id
                                && current.noteId === reading.note.id
                                ? null
                                : {
                                    signalId: signal.id,
                                    noteId: reading.note.id,
                                    quote: reading.quote,
                                  },
                            )
                          }
                        >
                          <span className="memory-reading-context">{contextLabel}</span>
                          <span className="memory-reading-title">{reading.note.title}</span>
                        </button>
                        {isOpen && reading.myRole.reason ? (
                          <p className="memory-reading-reason">{reading.myRole.reason}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          ) : null}
          <section className="memory-contents-reflection-prompts">
            {pendingCorrection ? (
              <div className="memory-contents-feedback-correction">
                <label>
                  <span>{copy.savedSignalCorrectionLabel}</span>
                  <textarea
                    aria-label={copy.savedSignalCorrectionLabel}
                    placeholder={copy.savedSignalCorrectionPlaceholder}
                    value={pendingCorrection.text}
                    disabled={isFeedbackSaving}
                    onChange={(event) => {
                      const nextText = event.currentTarget.value;
                      setPendingSavedSignalCorrection((current) =>
                        current?.signalId === signal.id
                          ? { ...current, text: nextText }
                          : current,
                      );
                    }}
                  />
                </label>
                <div className="memory-contents-feedback-correction-actions">
                  <button
                    type="button"
                    className="memory-contents-secondary-action"
                    disabled={isFeedbackSaving}
                    onClick={() => {
                      void submitSavedSignalFeedback(
                        signal,
                        pendingCorrection.value,
                        pendingCorrection.text,
                      );
                    }}
                  >
                    {copy.savedSignalCorrectionSave}
                  </button>
                  <button
                    type="button"
                    className="memory-contents-secondary-action memory-contents-secondary-action--quiet"
                    disabled={isFeedbackSaving}
                    onClick={() => {
                      void submitSavedSignalFeedback(signal, pendingCorrection.value);
                    }}
                  >
                    {copy.savedSignalCorrectionSkip}
                  </button>
                </div>
              </div>
            ) : null}
            {detailFeedbackStatus === "saved" ? (
              <p className="memory-contents-feedback-status">{copy.savedSignalFeedbackSaved}</p>
            ) : null}
            {detailFeedbackStatus === "error" && detailFeedbackError ? (
              <p className="memory-contents-feedback-status memory-contents-feedback-status--error">
                {detailFeedbackError}
              </p>
            ) : null}
          </section>
          <div className="memory-contents-expanded-footer">
            <span className="memory-contents-item-meta">
              {metaItems.map((item, index) => (
                <span key={`${signal.id}-meta-${index}`}>
                  {index > 0 ? " · " : null}
                  {index === 0 && linkAttachment?.url ? (
                    <a href={linkAttachment.url} target="_blank" rel="noreferrer">
                      {item}
                    </a>
                  ) : (
                    item
                  )}
                </span>
              ))}
            </span>
            <div className="memory-contents-expanded-actions" aria-label={copy.savedSignalActionsLabel}>
              <button
                type="button"
                className={`memory-contents-secondary-action${
                  isReflecting ? " memory-contents-secondary-action--active" : ""
                }`}
                onClick={() => reflectDeeperOnSavedSignal(signal)}
              >
                {isReflecting ? copy.savedSignalReflecting : copy.savedSignalReflect}
              </button>
              <button
                type="button"
                className="memory-contents-secondary-action memory-contents-secondary-action--quiet"
                onClick={() => deleteSavedSignalFromDrawer(signal)}
              >
                {copy.savedSignalDelete}
              </button>
            </div>
          </div>
          {reflectionRows.length > 0 || reflectionsLoading || isReflecting ? (
            <section className="memory-contents-reflections" aria-label={copy.savedSignalReflectionConversationLabel}>
              {reflectionRows.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="memory-contents-reflection-summary"
                    aria-expanded={reflectionsExpanded}
                    onClick={() => {
                      setExpandedReflectionThreads((current) => {
                        const next = new Set(current);
                        if (next.has(signal.id)) next.delete(signal.id);
                        else next.add(signal.id);
                        return next;
                      });
                    }}
                  >
                    <span>
                      {copy.savedSignalReflectionCount(reflectionRows.length)}
                    </span>
                    <small>{reflectionsExpanded ? copy.savedSignalReflectionToggleHide : copy.savedSignalReflectionToggleShow}</small>
                  </button>
                  {reflectionsExpanded ? (
                    <div className="memory-contents-reflection-thread">
                      {reflectionRows.map((reflection) => (
                        <article className="memory-contents-reflection" key={reflection.id}>
                          <p className="memory-contents-reflection-question">{reflection.question}</p>
                          {reflection.answer ? (
                            <p className="memory-contents-reflection-answer">{reflection.answer}</p>
                          ) : null}
                          <footer>
                            <time>{formatTimestamp(reflection.createdAt)}</time>
                            <button
                              type="button"
                              onClick={() => deleteSavedSignalReflection(signal.id, reflection)}
                            >
                              {copy.savedSignalReflectionDelete}
                            </button>
                          </footer>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : reflectionsLoading ? (
                <p className="memory-contents-reflection-empty">{copy.savedSignalReflectionLoading}</p>
              ) : isReflecting ? (
                <p className="memory-contents-reflection-empty">{copy.savedSignalReflectionEmpty}</p>
              ) : null}
            </section>
          ) : null}
        </article>
      );
    }
    return (
      <button
        type="button"
        className={`memory-contents-item${isSelectedSignal ? " memory-contents-item--active" : ""}`}
        aria-current={isSelectedSignal ? "true" : undefined}
        onClick={() => openStackSignal(signal)}
      >
        <span className="memory-contents-item-text">{shortText(signal.textPreview, 160)}</span>
        <span className="memory-contents-item-meta">{metaItems.join(" · ")}</span>
        {/* Where this save led. Scanning the list, you can see that this one
            became that reading in that room — the relationship the group
            boards already record, finally visible from the save's side. */}
        {/* Optional-chained despite `normalizeSavedSignal` defaulting this at
            the client boundary: the blast radius of a miss is the whole drawer,
            not one chip, and that is exactly how it failed the first time. */}
        {(signal.relatedGroupNotes?.length ?? 0) > 0 ? (
          <span className="memory-contents-item-led" aria-label={copy.ledToLabel}>
            {/*
              A count first, the titles on request.

              Four readings printed as four full-width chips buried the save
              they were about. What a person wants at a glance is "did this go
              anywhere, and how far" — the titles are the answer to a question
              they have not asked yet.
            */}
            <span
              className="memory-led-summary"
              role="button"
              tabIndex={0}
              aria-expanded={expandedLedChips.has(signal.id)}
              onClick={(event) => {
                event.stopPropagation();
                setExpandedLedChips((current) => {
                  const next = new Set(current);
                  if (next.has(signal.id)) next.delete(signal.id);
                  else next.add(signal.id);
                  return next;
                });
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setExpandedLedChips((current) => {
                  const next = new Set(current);
                  if (next.has(signal.id)) next.delete(signal.id);
                  else next.add(signal.id);
                  return next;
                });
              }}
            >
              {copy.ledToSummary(
                signal.relatedGroupNotes.length,
                Array.from(new Set(signal.relatedGroupNotes.map((note) => note.groupName))),
              )}
            </span>
            {expandedLedChips.has(signal.id)
              ? signal.relatedGroupNotes.map((note) => (
                  <span key={`${note.groupId}-${note.noteTitle}`} className="memory-led-chip">
                    <span className="memory-led-note">{note.noteTitle}</span>
                  </span>
                ))
              : null}
          </span>
        ) : null}
      </button>
    );
  };

  const renderMemoryPathDrawer = (): JSX.Element => {
    const hasSavedInspirations = allSavedSignals.length > 0;
    const hasMatches = pathFilteredSignals.length > 0;
    const activePath = selectedMemoryPathFilter?.path ?? "/all-saved";
    const emptyCopy = !hasSavedInspirations
      ? initialLoading
        ? copy.loadingSaves
        : copy.emptySaves
      : savedSignalQuery
        ? copy.savedSignalNoSearchMatches(inspirationFilters.search.trim(), activePath)
        : copy.savedSignalNoPathMatches(activePath);

	    return (
	      <div className="memory-category-panel memory-path-panel" aria-label={copy.savedSignalListLabel}>
        {renderMemoryPathFilters()}
        {drawerActionStatus ? (
          <p
            className={`memory-contents-feedback-status${
              drawerActionStatus.tone === "error" ? " memory-contents-feedback-status--error" : ""
            }`}
          >
            {drawerActionStatus.message}
          </p>
        ) : null}
	        {savedSignalsError ? <p className="memory-relationship-empty">{savedSignalsError}</p> : null}
        {savedSignalsLoading && allSavedSignals.length === 0 ? (
          <p className="memory-relationship-empty">{copy.loadingSaves}</p>
        ) : null}
        {!savedSignalsError && !savedSignalsLoading && !hasMatches ? (
          <p className="memory-relationship-empty">
            {emptyCopy}
            {selectedMemoryPathFilterId !== "all-saved" || savedSignalQuery ? (
              <button
                type="button"
                className="memory-path-clear"
                onClick={() => {
                  setActiveTopOfMindEvidenceFilter(null);
                  setSelectedMemoryPathFilterId("all-saved");
                  if (savedSignalQuery) setInspirationFilters({ search: "" });
                }}
              >
                {copy.savedSignalShowAllSaved}
              </button>
            ) : null}
          </p>
        ) : null}
        {hasMatches ? (
          <ul
            className={`memory-contents-list memory-path-list${
              selectedSavedSignalId ? " memory-contents-list--has-expanded" : ""
            }`}
          >
            {pathFilteredSignals.map((signal) => (
              <li key={signal.id}>{renderMemoryStackSignalCard(signal)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  };

  const renderMemoryPathFilters = (): JSX.Element | null => {
    if (homeMode !== "memoryDrawer") return null;
    // Arriving from "N inspirations led here" is a question about one thought,
    // so the drawer answers only that. Offering "all saved" beside it invites
    // you to lose the set you came to look at, and there is no way back to it.
    if (activeTopOfMindEvidenceFilter) {
      return (
        <nav className="memory-path-filters" aria-label={copy.savedSignalPathsLabel}>
          <span className="memory-path-filter memory-path-filter--active memory-path-filter--only">
            {activeTopOfMindEvidenceFilter.label}
            <span className="memory-path-filter-count">
              {applySearchToSignals(activeTopOfMindEvidenceFilter.signals, savedSignalQuery).length}
            </span>
          </span>
        </nav>
      );
    }
    const primaryFilterIds = new Set(["all-saved", "recently-saved"]);
    const primaryFilters = memoryPathFilters.filter((filter) => primaryFilterIds.has(filter.id));
    const visibleFilters = primaryFilters;
    return (
	      <nav className="memory-path-filters" aria-label={copy.savedSignalPathsLabel}>
	        {visibleFilters.map((filter) => {
          const count = applySearchToSignals(filter.signals, savedSignalQuery).length;
          return (
            <button
              key={filter.id}
              type="button"
              className={`memory-path-filter${selectedMemoryPathFilterId === filter.id ? " memory-path-filter--active" : ""}`}
              aria-pressed={selectedMemoryPathFilterId === filter.id}
              onClick={() => {
                setSelectedMemoryPathFilterId(filter.id);
                setSelectedMemoryGroupId(null);
                setSelectedSavedSignalId(null);
                setSavedSignalDetail(null);
              }}
              title={`${localizedMemoryPathDescription(filter)} (${count})`}
            >
	              <span>{localizedMemoryPathLabel(filter)}</span>
	              <small>{count}</small>
	            </button>
          );
        })}
      </nav>
    );
  };

  // Retired by the anchored stack drawer; keep the old comparison helpers
  // inert until the remaining memory-window state can be removed in one cleanup.
  void visibleMemoryWindows;
  void renderMemorySignalCard;
  void renderMemoryGroupObject;
  void createUserMemoryGroup;

  const onNotePointerDown = (index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) return;
    const base = drags[index] ?? { x: 0, y: 0 };
    dragStartRef.current = {
      index,
      x: event.clientX,
      y: event.clientY,
      baseX: base.x,
      baseY: base.y,
    };
    dragMovedRef.current = false;
    setDraggingIndex(index);
  };

  const signalIdForSupportingSignal = (support: SupportingThoughtSignal): string | null => {
    const id = support.id?.trim();
    return id ? id : null;
  };

  const fallbackSavedSignalFromSupport = (support: SupportingThoughtSignal): ApiSavedSignalSearchResult | null => {
    const id = signalIdForSupportingSignal(support);
    if (!id) return null;
    const listedSignal = allSavedSignals.find((signal) => signal.id === id);
    // Even when the inspiration is one of the viewer's own saved signals, keep
    // the group-evidence owner tag so every inspiration on a group board is
    // attributed (including the viewer's).
    if (listedSignal) {
      return support.authorName
        ? { ...listedSignal, ownerName: support.authorName }
        : listedSignal;
    }
    return {
      id,
      userId: user.id,
      // On a group board, tag the inspiration with the member who saved it.
      ownerName: support.authorName,
      textPreview: support.preview,
      /**
       * Marked as a quotation when the preview IS the span the reading rested
       * on, rather than the opening of the save. Carried through so the drawer
       * can say "these were the words" instead of showing a truncation that
       * looks the same either way.
       */
      quote: support.quote ?? null,
      quoteSource: support.quoteSource ?? null,
      kind: support.kind ?? null,
      capturedAt: support.createdAt ?? new Date().toISOString(),
      updatedAt: support.createdAt ?? new Date().toISOString(),
      resonanceScore: support.resonanceScore ?? 0,
      signalScores: {
        resonance: support.resonanceScore ?? 0,
        recurrence: 0,
        agency: 0,
        identitySignal: 0,
        decisionRelevance: 0,
      },
      highlightedSnippets: [],
      matchingSnippets: [],
      relatedContextTerms: [],
      relatedTopOfMindNoteTitles: [],
      // Stand-in for a group board's evidence row: the list route is what
      // resolves where a save led, and this never came through it.
      relatedGroupNotes: [],
      attachmentSummary: [],
      relevanceReasons: support.reason ? [support.reason] : [],
    };
  };

  const openTopOfMindEvidenceDrawer = (signal: HomeThoughtCard) => {
    const evidenceSignals = uniqueSignals(
      signal.supportingSignals
        .map((support) => fallbackSavedSignalFromSupport(support))
        .filter((supportSignal): supportSignal is ApiSavedSignalSearchResult => supportSignal !== null),
    );
    if (evidenceSignals.length === 0) return;

    /**
     * You are arriving THROUGH this reading, so the saves open already lit.
     *
     * Which words matter is only answerable once you have said which reading
     * you are asking about — and coming from a post-it, you already have. The
     * quotes travel with the note's own evidence, one per save, so this is a
     * lookup rather than a second request.
     */
    setArrivedThroughNote({
      noteId: signal.feedbackTargetId ?? signal.id,
      quoteBySignalId: new Map(
        signal.supportingSignals
          .filter((support) => support.quote)
          .map((support) => [support.id, support.quote as string]),
      ),
    });

    const filterId = `top-of-mind-evidence-${signal.id}`;
    setActiveTopOfMindEvidenceFilter({
      id: filterId,
      path: "/top-of-mind",
      label: copy.topOfMindEvidencePathLabel,
      description: copy.topOfMindEvidenceDescription(shortText(thoughtCardDisplayLabel(signal, locale), 64)),
      signals: evidenceSignals,
    });
    setSelectedSupportingSignalFallback(evidenceSignals[0] ?? null);
    setSelectedMemoryGroupId(null);
    setSelectedMemoryPathFilterId(filterId);
    setSelectedSavedSignalId(null);
    setSavedSignalDetail(null);
    clearDrawerCloseTimer();
    setDrawerClosing(false);
    setHomeMode("memoryDrawer");
    for (const evidenceSignal of evidenceSignals) {
      recordRevisit(evidenceSignal.id, "detail_opened");
    }
  };

  const renderThoughtCard = (signal: HomeThoughtCard, index: number): JSX.Element => {
    const layout = NOTE_LAYOUTS[index] ?? NOTE_LAYOUTS[0];
    const drag = drags[index] ?? { x: 0, y: 0 };
    const feedbackState = noteFeedback[signal.id];
    const pinned = feedbackState?.value === "important";
    const savingEdit = feedbackState?.status === "saving";
    const noteIsInteractive = homeMode !== "memoryDrawer";
    const supportingCount = signal.supportingSignals.length;
    const canOpenEvidenceDrawer = signal.supportingSignals.some((support) => signalIdForSupportingSignal(support));
    const noteText = thoughtCardDisplayLabel(signal, locale);
    const draftText = noteFeedback[signal.id]?.correctionText ?? noteText;
    const textDensityClass = thoughtCardTextDensityClass(draftText);
    // Only a room has contributors; your own wall's notes are yours by
    // definition and stamping "you" on every card is noise.
    const noteContributors = isGroupBoardActive
      ? Array.from(
          new Set(
            signal.supportingSignals
              .map((support) => support.authorName)
              .filter((name): name is string => Boolean(name && name.trim())),
          ),
        )
      : [];
    return (
    <article
      className={`nc-note${index === 0 ? " nc-note--featured" : ""}${draggingIndex === index ? " nc-note--dragging" : ""}${pinned ? " nc-note--pinned" : ""}${savingEdit ? " nc-note--saving" : ""}${textDensityClass}${noteIsInteractive ? "" : " nc-note--passive"}`}
      key={signal.id}
      aria-busy={savingEdit ? "true" : undefined}
      style={{
        ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
        ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        ["--tilt" as string]: `${layout.tilt}deg`,
        ["--w" as string]: layout.w,
        ["--dx" as string]: `${drag.x}px`,
        ["--dy" as string]: `${drag.y}px`,
        // Notes recede with position, but the fade has a floor. Unclamped it
        // reached 0 at the thirteenth note and went negative after, so a long
        // wall ended in notes that were completely invisible until hovered —
        // which reads as a wall that stops rather than one that recedes.
        ["--decay" as string]: String(Math.max(0.42, 1 - index * 0.08)),
        // Position in the stack, so travelling staggers rather than sliding
        // as one sheet.
        ["--travel-i" as string]: String(index),
      }}
      onPointerDown={noteIsInteractive ? onNotePointerDown(index) : undefined}
    >
      <div className="nc-note-preview" aria-label={copy.notePreviewAria}>
        {noteIsInteractive && signal.feedbackTargetId ? (
          <div className="nc-note-edit-shell">
            <textarea
              className="nc-note-body nc-note-body-edit nc-note-body-edit--inline"
              aria-label={copy.correctionLabel}
              value={draftText}
              rows={thoughtCardTextareaRows(draftText)}
              disabled={savingEdit}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                const nextText = event.target.value;
                updateCorrectionText(signal.id, nextText);
                scheduleTopOfMindAutosave(signal, nextText);
              }}
            />
            {savingEdit ? (
              <span className="nc-note-edit-saving" aria-label={copy.feedbackSaving} role="status">
                <svg className="nc-note-spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M20 12a8 8 0 0 0-14.1-5.2" />
                  <path d="M5.9 6.8H3.6V4.5" />
                </svg>
              </span>
            ) : null}
          </div>
        ) : (
          <p className="nc-note-body nc-note-body--preview">{noteText}</p>
        )}
      </div>
      {/* One provenance line. Contributor faces and the evidence count were two
          rows answering the same question -- where did this come from -- so
          they are one row: who, then how many, opening the evidence. */}
      <div className="nc-note-footer-row">
        {noteIsInteractive && supportingCount > 0 ? (
          <button
            type="button"
            className="nc-note-inspiration-slide nc-note-provenance"
            disabled={!canOpenEvidenceDrawer}
            onClick={(event) => {
              event.stopPropagation();
              openTopOfMindEvidenceDrawer(signal);
            }}
            aria-label={
              noteContributors.length > 0
                ? `${copy.topOfMindEvidenceCount(supportingCount)} — ${noteContributors.join(", ")}`
                : copy.topOfMindEvidenceCount(supportingCount)
            }
          >
            {noteContributors.length > 0 ? (
              <span className="nc-note-faces" aria-hidden="true">
                {noteContributors.map((name) => (
                  <span
                    key={name}
                    className="nc-note-face"
                    style={{ background: contributorColor(name) }}
                    title={name}
                  >
                    {contributorInitials(name)}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="nc-note-provenance-text">
              {noteContributors.length > 0
                ? `${noteContributors.join(", ")} · ${supportingCount}`
                : copy.topOfMindEvidenceCount(supportingCount)}
            </span>
            {/*
              When the room first read this.

              A wall that can be travelled needs its notes dated, or scrubbing
              back is the only way to learn that a reading is three weeks old
              while the one beside it arrived this morning.
            */}
            {signal.createdAt ? (
              <span className="nc-note-when">{noteWhen(signal.createdAt)}</span>
            ) : null}
          </button>
        ) : <span />}
        {noteIsInteractive ? renderPostItActions(signal) : null}
      </div>
    </article>
  );
  };

  return (
    <>
      <BackgroundField />
      <DropOverlay />
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={PRODUCT_SPACES.memoryDrawer}
        detail={historyDetail}
      >
        {historyContent}
      </HistoryPanel>
      <div className="nc-language-controls" aria-label={t(locale, "profileTitle")}>
        <Link
          to="/profile"
          className="nc-profile-link nc-lang--top"
          aria-label={t(locale, "profileTitle")}
          title={t(locale, "profileTitle")}
          aria-hidden={homeMode === "memoryDrawer" ? true : undefined}
          {...(homeMode === "memoryDrawer" ? { inert: "" } : {})}
        >
          {t(locale, "profileLink")}
        </Link>
      </div>
      <main
        className={`nc-canvas nc-canvas--top-of-mind${homeMode === "memoryDrawer" ? " nc-canvas--drawer-open" : ""}`}
        data-locale={locale}
        aria-hidden={homeMode === "memoryDrawer" ? true : undefined}
        {...(homeMode === "memoryDrawer" ? { inert: "" } : {})}
      >
        {/* One object: names the room, switches rooms, shows the cast, and
            is how you invite someone into it. Your own wall is a room with one
            member, so nothing about the layout changes when you switch. */}
        <RoomTitle
          title={copy.titleLineOne(
            isGroupBoardActive && activeGroupName ? activeGroupName : titleHandle,
          )}
          members={
            isGroupBoardActive
              ? groupMembers
              : user
                ? [{ userId: user.id, name: user.name || copy.myRoomName }]
                : []
          }
          currentUserId={user?.id}
          inviteLink={activeGroupJoinLink}
          onRefresh={isGroupBoardActive ? handleRefreshGroup : undefined}
          refreshing={groupRefreshing}
          faceColor={contributorColor}
          faceInitials={contributorInitials}
          error={groupBoardsError}
          activeRoomSummary={
            isGroupBoardActive
              ? (groupBoards.find((board) => board.id === activeBoard) ?? null)
              : null
          }
          onCreateRoom={handleCreateGroup}
          onJoinRoom={handleJoinGroup}
          onRenameRoom={handleRenameGroup}
          onRemoveMember={handleRemoveMember}
          onDeleteRoom={handleDeleteGroup}
          onLeaveRoom={handleLeaveGroup}
        />

        <RoomRail
          rooms={[
            { id: MINE_BOARD_ID, name: copy.myRoomName, role: "owner", joinCode: "", memberCount: 1, createdAt: "" },
            ...groupBoards,
          ]}
          activeRoom={activeBoard}
          onSelect={travelToRoom}
        />

        <GroupWall
          copy={{
            regionLabel: copy.topOfMindRegionLabel,
            loadingThoughts: copy.loadingThoughts,
            emptyThoughts: copy.emptyThoughts,
            firstRunTitle: copy.firstRunTitle,
            firstRunSteps: copy.firstRunSteps,
            groupLoading: "Gathering the group’s Top of Mind…",
            groupEmpty:
              "Nothing shared here yet. When members keep inspirations shared, this board fills with the group’s Top of Mind.",
            pastEmpty: copy.timeRailPastEmpty,
            groupEmptyLabel: "Group Top of Mind",
          }}
          travel={travel}
          isGroupBoardActive={isGroupBoardActive}
          groupBoardLoading={groupBoardLoading}
          ownBoardLoading={topOfMindLoading}
          ownBoardError={topOfMindError}
          cardCount={meaningfulThoughtCards.length}
          renderCards={() =>
            meaningfulThoughtCards.map((card, index) => renderThoughtCard(card, index))
          }
          /* The legacy US-051 group conversation-rooms card is superseded by
             the Group Top of Mind boards above and no longer shown on the wall. */
          legacySurface={
            SHOW_LEGACY_GROUP_ROOM_SURFACE ? renderGroupRoomSurface() : null
          }
          inPast={isGroupBoardActive && scrubbedAt !== null}
        />

        {/*
          Outside the stage, deliberately.

          The wall carries a `filter` when it stands in the past and transforms
          while it travels between rooms, and either one makes a `position:
          fixed` descendant position itself against THAT element rather than the
          viewport. Rendered inside, the rail rode the wall and appeared to jump
          on every state change. A fixed edge surface has to be a child of the
          page, like the room rail beside it.
        */}
        {isGroupBoardActive ? (
          <TimeRail
            timeline={roomTimeline}
            position={scrubbedAt}
            onScrub={setScrubbedAt}
            copy={timeRailCopy}
          />
        ) : null}
      </main>

      {homeMode === "memoryDrawer" ? (
	        <section
	          className={`reference-saves-page signal-revisit-page memory-drawer-stack${
	            drawerClosing ? " memory-drawer-stack--closing" : ""
	          }`}
	          data-locale={locale}
	          aria-label={copy.savesTitle}
	          role="dialog"
	          aria-modal="false"
	        >
          <span className="memory-stack-glass" aria-hidden="true" />
          {selectedMemoryGroup ? (
            <div className="memory-contents-flow" aria-label={copy.groupingContentsLabel}>
              <button
                type="button"
                className="memory-contents-back"
                onClick={() => {
                  setSelectedMemoryGroupId(null);
                  setSelectedSavedSignalId(null);
                  setSavedSignalDetail(null);
                }}
              >
                {copy.backToMap}
              </button>
              {selectedMemoryGroup.source === "user" ? (
                <label className="memory-contents-rename">
                  <span className="sr-only">{copy.nameCollectionLabel}</span>
                  <input
                    value={selectedMemoryGroup.name}
                    onChange={(event) => renameMemoryGroup(selectedMemoryGroup.id, event.target.value)}
                  />
                </label>
              ) : (
                <h2 className="memory-contents-title">{memoryMapLabel(selectedMemoryGroup.name)}</h2>
              )}
              <ul className="memory-contents-list">
                {selectedMemoryGroupSignals.map((signal) => (
                  <li key={signal.id}>{renderMemoryStackSignalCard(signal)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              className="memory-stack-level memory-stack-level--categories"
              onClick={closeMemoryDrawerFromBackdrop}
            >
              {renderMemoryPathDrawer()}
            </div>
          )}
        </section>
      ) : null}

      <div
        className={`nc-bottom-bar${
          homeMode === "memoryDrawer" ? " nc-bottom-bar--drawer" : " nc-bottom-bar--wall"
        }`}
        data-locale={locale}
        aria-label={copy.bottomActionsLabel}
      >
        <div
          className={`nc-primary-action${
            showDrawerSearch ? " nc-primary-action--search" : ""
          }${showDrawerEditActions ? " nc-primary-action--save" : ""}${
            selectedDrawerIsReflecting ? " nc-primary-action--reflect" : ""
          }${showTopOfMindUndo || showDrawerUndo ? " nc-primary-action--undo" : ""
          }`}
        >
          {showPrimarySaveButton ? (
            <button
              type="button"
              className={`nc-save${captureSaved ? " nc-save--saved" : ""}${
                showTopOfMindUndo || showDrawerUndo
                  ? " nc-save--undo"
                  : showDrawerEditActions
                    ? " nc-save--save"
                    : ""
              }`}
              onClick={
                showDrawerUndo
                  ? undoDeletedSavedSignal
                  : showDrawerEditActions
                    ? () => void saveEditedSavedSignal()
                  : showTopOfMindUndo
                    ? undoDeletedTopOfMindNote
                    : openCapture
              }
              aria-label={
                showDrawerUndo
                  ? copy.drawerUndoAria
                  : showDrawerEditActions
                    ? copy.drawerSaveEditedAria
                    : showTopOfMindUndo
                      ? copy.topOfMindUndoAria
                      : copy.captureAria
              }
              disabled={showDrawerEditActions && savedSignalEditSaving}
            >
              <span className="nc-save-cta">
                {showDrawerUndo
                  ? copy.drawerUndoCta
                  : showDrawerEditActions
                    ? savedSignalEditSaving
                      ? copy.savingShort
                      : copy.drawerSaveEditedCta
                    : showTopOfMindUndo
                      ? copy.topOfMindUndoCta
                      : captureSaved
                        ? t(locale, "saved")
                        : copy.captureCta}
                {showTopOfMindCapture && !captureSaved && captureHasDraft ? (
                  <span className="nc-save-draft">({copy.draftLabel})</span>
                ) : null}
              </span>
            </button>
          ) : null}
          {showDrawerEditActions ? (
            <button
              type="button"
              className="nc-edit-cancel"
              onClick={cancelSavedSignalEdit}
              aria-label={copy.cancelEditAria}
            >
              {copy.cancelEditCta}
            </button>
          ) : null}
          {showDrawerSearch ? (
            <label className={`nc-drawer-search${drawerClosing ? " nc-drawer-search--closing" : ""}`}>
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                type="search"
                value={inspirationFilters.search}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setInspirationFilters({ search: event.target.value });
                  setSelectedMemoryGroupId(null);
                  setSelectedSavedSignalId(null);
                  setSavedSignalDetail(null);
                  cancelSavedSignalReflection();
                }}
                placeholder={copy.searchPlaceholder}
              />
            </label>
          ) : null}
          {selectedDrawerIsReflecting ? (
            <form
              className="nc-drawer-reflect"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSavedSignalReflection();
              }}
            >
              <div className="nc-drawer-reflect-question">
                <span>{selectedDrawerReflectionProgress}</span>
                <p id="saved-signal-reflection-question">{selectedDrawerReflectionQuestion}</p>
                {savedSignalReflectionQuestionError ? (
                  <small className="nc-drawer-reflect-status">{savedSignalReflectionQuestionError}</small>
                ) : null}
              </div>
              <textarea
                ref={savedSignalReflectionInputRef}
                aria-label={copy.reflectionAnswerLabel}
                aria-describedby="saved-signal-reflection-question"
                value={savedSignalReflectionDraft}
                onChange={(event) => {
                  setSavedSignalReflectionDraft(event.target.value);
                  event.currentTarget.style.height = "auto";
                  event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
                }}
                placeholder={copy.reflectionAnswerPlaceholder}
                disabled={savedSignalReflectionSaving}
                rows={1}
              />
              <div className="nc-drawer-reflect-actions">
                <button
                  type="button"
                  onClick={goToPreviousSavedSignalReflection}
                  disabled={savedSignalReflectionSaving || savedSignalReflectionStepIndex === 0}
                >
                  {copy.reflectionPrevious}
                </button>
                <button
                  type="button"
                  onClick={goToNextSavedSignalReflection}
                  disabled={!selectedDrawerReflectionCanGoNext || savedSignalReflectionSaving}
                >
                  {copy.reflectionNext}
                </button>
                <button
                  type="submit"
                  disabled={!selectedDrawerReflectionCanFinish || savedSignalReflectionSaving}
                >
                  {savedSignalReflectionSaving ? copy.savingShort : copy.reflectionSave}
                </button>
                <button type="button" onClick={cancelSavedSignalReflection}>
                  {copy.reflectionCancel}
                </button>
              </div>
              {savedSignalReflectionError ? (
                <span className="nc-drawer-reflect-error">{savedSignalReflectionError}</span>
              ) : null}
            </form>
          ) : null}
        </div>
        {!selectedDrawerIsReflecting ? (
          <button
            type="button"
            className={`nc-drawer-object${homeMode === "memoryDrawer" ? " nc-drawer-object--close" : ""}`}
            onClick={() => {
              if (homeMode === "memoryDrawer") {
                closeMemoryDrawer();
              } else {
                chooseHomeMode("memoryDrawer");
              }
            }}
            aria-label={homeMode === "memoryDrawer" ? copy.drawerBackHome : `${copy.drawerObjectBody}: ${copy.savesTitle}`}
          >
            {/* One .nc-drawer-icon instance across both modes so the white
                circle is the same element sliding across the pill rather than
                two elements swapping places. Only the glyph inside crossfades. */}
            <span className="nc-drawer-icon" aria-hidden="true">
              {homeMode === "memoryDrawer" ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                  <path d="M8.5 14.5c-1.6-1.2-2.5-3-2.5-5A6 6 0 0 1 18 9.5c0 2-.9 3.8-2.5 5-.8.6-1.2 1.4-1.2 2.5H9.7c0-1.1-.4-1.9-1.2-2.5Z" />
                </svg>
              )}
            </span>
            <span className="sr-only">{homeMode === "memoryDrawer" ? copy.drawerBackHome : copy.drawerObjectTitle}</span>
            <small className="nc-drawer-count">
              {homeMode === "memoryDrawer" ? copy.close : formatSavedCount(locale, savedEntryCount)}
            </small>
          </button>
        ) : null}
          {/* Onboarding copy, not furniture: it explains what saving is for,
              which stops being useful the moment you have saved anything. A
              permanent instruction under the primary action reads as the
              product explaining its own button forever. */}
          {homeMode !== "memoryDrawer" && savedEntryCount === 0 ? (
            <p className="nc-bottom-hint">{copy.bottomHint}</p>
          ) : null}
        </div>

      {/* An invite link offers; the person decides. See the `?join=` effect. */}
      {pendingJoinCode ? (
        <div
          className="nc-join-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="Join this group?"
        >
          <div className="nc-join-confirm-card">
            <p className="nc-join-confirm-title">Join this group?</p>
            <p className="nc-join-confirm-body">
              Everything you have marked shareable becomes readable by this group's
              members, with your name on it.
            </p>
            <code className="nc-join-confirm-code">{pendingJoinCode}</code>
            <div className="nc-join-confirm-actions">
              <button
                type="button"
                className="nc-join-confirm-cancel"
                onClick={() => setPendingJoinCode(null)}
                disabled={joinPending}
              >
                Not now
              </button>
              <button
                type="button"
                className="nc-join-confirm-accept"
                onClick={() => void confirmPendingJoin()}
                disabled={joinPending}
              >
                {joinPending ? "Joining…" : "Join"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {captureOpen ? (
        <div
          className={`reference-capture-modal${captureFocused ? " reference-capture-modal--expanded" : ""}${
            captureClosing ? " reference-capture-modal--closing" : ""
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={copy.captureDialog}
        >
          <button
            type="button"
            className="reference-capture-close"
            onClick={closeCapture}
          >
            {copy.close}
          </button>
          <div className="reference-capture-shell">
          <CaptureForm
            view={captureView}
            visualState={{
              focused: captureFocused,
              saveFlash: captureSaveFlash,
            }}
            focused={captureFocused}
            onToggleFocus={setCaptureFocused}
            onOptimisticAdd={handleOptimisticAdd}
            onPersisted={handleCapturePersisted}
            onPersistError={handlePersistError}
            locale={locale}
            onDismissAfterSave={() => {
              closeCapture();
            }}
            onSaved={handleCaptureSaved}
          />
          </div>
        </div>
      ) : null}
      {loadError ? (
        <div
          // Non-blocking diagnostic ribbon. Kept tiny + outside the board's
          // visual contract so a transient fetch error doesn't disrupt the
          // prototype's layout rhythm. The user can still capture new saves
          // — only the historical list failed to load.
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 300,
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "6px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            maxWidth: 320,
          }}
        >
          {loadError}
        </div>
      ) : null}
      {showAdminEntry ? (
        <Link
          to="/admin"
          className="admin-entry-pill"
          aria-label="Open admin inspection tools"
          title={PRODUCT_SPACES.internalDebug}
        >
          Debug
        </Link>
      ) : null}
    </>
  );
}

export default HomePage;
