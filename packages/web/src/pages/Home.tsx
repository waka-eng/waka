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

import {
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
  type ApiInspirationScorePatch,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiTopOfMind,
  type ApiTopOfMindNoteSurface,
  type ClusterKind,
  createFeedback,
  createReflection,
  deleteReflection,
  deleteInspiration,
  fetchReflections,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchInspirations,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  generateGuidedReflectionQuestion,
  recordInspirationRevisit,
  updateInspiration,
  updateTopOfMindNote,
} from "../lib/api";
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

function noteToThoughtCard(note: ApiTopOfMindNoteSurface): HomeThoughtCard {
  const evidenceSignals = note.evidencePreviews.map((evidence) => ({
    id: evidence.signalId,
    preview: evidence.textPreview,
    reason: evidence.reason,
    createdAt: evidence.createdAt,
    kind: evidence.kind,
    resonanceScore: evidence.resonanceScore,
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
    }));

  return {
    id: note.id,
    feedbackTargetId: note.id,
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
    savedSignalFeedbackActions: [
      { label: "아직 살아 있음", value: "true" },
      { label: "달라진 모양", value: "partly" },
      { label: "더는 아님", value: "not_true" },
    ],
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
    savedSignalFeedbackActionLabel: (label: string) => `영감 피드백: ${label}`,
    savedSignalReflectionConversationLabel: "영감 돌아보기 대화",
    savedSignalOpening: "영감을 여는 중...",
    savedSignalReflectionCount: (count: number) => `이 영감에서 나온 돌아보기 ${count}개`,
    savedSignalReflectionToggleShow: "보기",
    savedSignalReflectionToggleHide: "숨기기",
    savedSignalReflectionDelete: "삭제",
    savedSignalReflectionLoading: "돌아보기를 불러오는 중...",
    savedSignalReflectionEmpty: "돌아보기가 여기에 나타납니다.",
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
    savedSignalFeedbackActions: [
      { label: "still alive", value: "true" },
      { label: "changed shape", value: "partly" },
      { label: "not anymore", value: "not_true" },
    ],
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
    savedSignalFeedbackActionLabel: (label: string) => `saved inspiration feedback: ${label}`,
    savedSignalReflectionConversationLabel: "reflection conversation",
    savedSignalOpening: "opening inspiration...",
    savedSignalReflectionCount: (count: number) => `${count} reflection${count === 1 ? "" : "s"} from this inspiration`,
    savedSignalReflectionToggleShow: "show",
    savedSignalReflectionToggleHide: "hide",
    savedSignalReflectionDelete: "delete",
    savedSignalReflectionLoading: "loading reflections...",
    savedSignalReflectionEmpty: "Your reflection will appear here.",
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
    savedSignalFeedbackActions: Array<{ label: string; value: SavedSignalFeedbackValue }>;
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
    savedSignalFeedbackActionLabel: (label: string) => string;
    savedSignalReflectionConversationLabel: string;
    savedSignalOpening: string;
    savedSignalReflectionCount: (count: number) => string;
    savedSignalReflectionToggleShow: string;
    savedSignalReflectionToggleHide: string;
    savedSignalReflectionDelete: string;
    savedSignalReflectionLoading: string;
    savedSignalReflectionEmpty: string;
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
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureClosing, setCaptureClosing] = useState(false);
  const [captureSaved, setCaptureSaved] = useState(false);
  const [captureHasDraft, setCaptureHasDraft] = useState<boolean>(() => captureDraftHasContent());
  const captureSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      topOfMindRequestIdRef.current += 1;
      setEntries([]);
      setTopOfMind(null);
      setTopOfMindLoading(false);
      setTopOfMindError(null);
      setTopOfMindNotes([]);
      setTopOfMindNotesLoading(false);
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
  const renderEntries = isHomeStateRenderSafe ? entries : [];
  const renderTopOfMindNotes = isHomeStateRenderSafe ? topOfMindNotes : [];
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
  const copy = HOME_COPY[locale];

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

  const renderPostItActions = (signal: HomeThoughtCard): JSX.Element | null => {
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
        </span>
        <strong>{shortText(signal.textPreview, options.compact ? 96 : 180)}</strong>
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
      const persistedFeedbackValue = fullDetailReady
        ? [...savedSignalDetail.resonanceFeedback]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .at(-1)?.value ?? null
        : null;
      const detailFeedback = savedSignalFeedback[signal.id];
      const selectedFeedbackValue = detailFeedback?.value ?? persistedFeedbackValue;
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
          <section className="memory-contents-reflection-prompts">
            <div className="memory-contents-feedback-actions" aria-label={copy.savedSignalFeedbackLabel}>
              {copy.savedSignalFeedbackActions.map((action) => {
                const isSelected = selectedFeedbackValue === action.value;
                const isSaving = isFeedbackSaving && isSelected;
                return (
                  <button
                    key={action.value}
                    type="button"
                    className={`memory-contents-feedback-action${isSelected ? " memory-contents-feedback-action--selected" : ""}`}
                    aria-label={copy.savedSignalFeedbackActionLabel(action.label)}
                    aria-pressed={isSelected}
                    disabled={isFeedbackSaving}
                    onClick={() => {
                      if (action.value === "true") {
                        void submitSavedSignalFeedback(signal, action.value);
                        return;
                      }
                      setPendingSavedSignalCorrection({
                        signalId: signal.id,
                        value: action.value,
                        text: "",
                      });
                    }}
                  >
                    {action.label}
                    {isSaving ? <span>{copy.savedSignalFeedbackSaving}</span> : null}
                  </button>
                );
              })}
            </div>
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
    const primaryFilterIds = new Set(["all-saved", "recently-saved"]);
    const primaryFilters = memoryPathFilters.filter((filter) => primaryFilterIds.has(filter.id));
    const visibleFilters = [
      ...(activeTopOfMindEvidenceFilter ? [activeTopOfMindEvidenceFilter] : []),
      ...primaryFilters,
    ];
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
                if (activeTopOfMindEvidenceFilter?.id !== filter.id) {
                  setActiveTopOfMindEvidenceFilter(null);
                }
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
    if (listedSignal) return listedSignal;
    return {
      id,
      userId: user.id,
      textPreview: support.preview,
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
        ["--decay" as string]: String(1 - index * 0.08),
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
      <div className="nc-note-footer-row">
        {noteIsInteractive && supportingCount > 0 ? (
          <button
            type="button"
            className="nc-note-inspiration-slide"
            disabled={!canOpenEvidenceDrawer}
            onClick={(event) => {
              event.stopPropagation();
              openTopOfMindEvidenceDrawer(signal);
            }}
          >
            {copy.topOfMindEvidenceCount(supportingCount)}
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
        <section className="nc-titlecard">
          <h1 className="nc-title">
            {copy.titleLineOne(displayHandle)}
            {copy.titleLineTwo ? (
              <>
                <br />
                {copy.titleLineTwo}
              </>
            ) : null}
            {copy.titleSuffix ? <span className="nc-title-suffix"> ({copy.titleSuffix})</span> : null}
          </h1>
          {copy.tagline ? <p className="nc-tagline">{copy.tagline}</p> : null}
        </section>

        <section className="nc-stage nc-stage--top-of-mind-wall" aria-label={copy.topOfMindRegionLabel}>
          {topOfMindLoading ? (
            <p className="nc-loading">{copy.loadingThoughts}</p>
          ) : topOfMindError ? (
            <p className="nc-loading">{topOfMindError}</p>
          ) : meaningfulThoughtCards.length > 0 ? (
            meaningfulThoughtCards.map((card, index) => renderThoughtCard(card, index))
          ) : (
            <div className="nc-first-run-guide" aria-label={copy.firstRunTitle}>
              <p className="nc-loading">{copy.emptyThoughts}</p>
              <div className="nc-first-run-card">
                <h2>{copy.firstRunTitle}</h2>
                <ol>
                  {copy.firstRunSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
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
            {homeMode === "memoryDrawer" ? (
              <span className="nc-drawer-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3 10.5 9-7 9 7" />
                  <path d="M5 9.5V20h14V9.5" />
                  <path d="M9.5 20v-6h5v6" />
                </svg>
              </span>
            ) : (
              <span className="nc-drawer-icon" aria-hidden="true">
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
              </span>
            )}
            <span className="sr-only">{homeMode === "memoryDrawer" ? copy.drawerBackHome : copy.drawerObjectTitle}</span>
            <small className="nc-drawer-count">{formatSavedCount(locale, savedEntryCount)}</small>
          </button>
        ) : null}
          {homeMode !== "memoryDrawer" ? (
            <p className="nc-bottom-hint">{copy.bottomHint}</p>
          ) : null}
        </div>

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
