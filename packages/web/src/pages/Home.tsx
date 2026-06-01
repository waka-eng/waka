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
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
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
  type ApiActionRecommendation,
  type ApiAmbitionDimension,
  type ApiFeedbackValue,
  type ApiError,
  type ApiInspiration,
  type ApiInspirationScorePatch,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiInspirationSpark,
  type ApiTopOfMind,
  type ApiTopOfMindNoteSurface,
  type ApiTopOfMindSignal,
  type ClusterKind,
  createFeedback,
  createInspirationSpark,
  deleteInspirationSpark,
  fetchActionRecommendations,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchInspirations,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  recordInspirationRevisit,
  updateActionRecommendationState,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  DEFAULT_LOCALE,
  normalizeSupportedLocale,
  t,
  type SupportedLocale,
} from "../lib/locales";

const LOCALE_STORAGE_KEY = "waka.ui.locale";
const ATTACHMENT_ONLY_SENTINEL = "(attachment-only inspiration)";

function readInitialLocale(): SupportedLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  try {
    const storedLocale = window.localStorage?.getItem?.(LOCALE_STORAGE_KEY);
    if (storedLocale) return normalizeSupportedLocale(storedLocale);
  } catch {
    // Tests and privacy-mode browsers can expose localStorage but throw or stub
    // incomplete methods. Fall back to the browser language in those cases.
  }

  return normalizeSupportedLocale(window.navigator.language);
}

function writeLocalePreference(locale: SupportedLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Preference persistence is best-effort; the selected locale still applies
    // for the current render through React state.
  }
}

interface InternalEntryEnv {
  DEV?: boolean;
  VITE_SHOW_INTERNAL_STATUS?: string;
}

function shouldShowAdminEntry(env: InternalEntryEnv): boolean {
  const hostname =
    typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return env.DEV === true || env.VITE_SHOW_INTERNAL_STATUS === "true" || isLocalhost;
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
type MemoryFolderView = "grid" | "vertical" | "horizontal";
type TopOfMindFeedbackValue = Extract<
  ApiFeedbackValue,
  "partly" | "not_true"
>;
type FeedbackStatus = "idle" | "saving" | "saved" | "error";
type MemoryConstellationVisual = "note" | "link" | "image" | "mixed";

const TOP_OF_MIND_NOTE_LIMIT = 5;

const PRODUCT_SPACES = {
  capture: "Capture",
  topOfMind: "Five Top of Mind post-its",
  memoryDrawer: "Memory Drawer",
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

type HighlightableSnippet = Pick<ApiInspirationSpark, "id" | "text">;

function renderHighlightedInspirationText(
  text: string,
  highlights: HighlightableSnippet[],
  onRemove: (highlight: HighlightableSnippet) => void,
): ReactNode {
  const usableHighlights = highlights
    .filter((highlight) => highlight.text.trim().length > 0)
    .map((highlight) => ({ ...highlight, text: highlight.text.trim() }))
    .sort((a, b) => (b.text.length - a.text.length));
  if (usableHighlights.length === 0) return text;

  const chunks: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const next = usableHighlights
      .map((highlight) => ({ highlight, index: text.indexOf(highlight.text, cursor) }))
      .filter((candidate) => candidate.index >= 0)
      .sort((a, b) => a.index - b.index || b.highlight.text.length - a.highlight.text.length)[0];

    if (!next) {
      chunks.push(text.slice(cursor));
      break;
    }

    if (next.index > cursor) chunks.push(text.slice(cursor, next.index));
    chunks.push(
      <mark className="memory-inline-highlight" key={next.highlight.id || key++}>
        {next.highlight.text}
        <button
          type="button"
          aria-label="remove highlight"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(next.highlight);
          }}
        >
          remove
        </button>
      </mark>,
    );
    cursor = next.index + next.highlight.text.length;
  }

  return chunks;
}

function meaningTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
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

function signalToThoughtCard(signal: ApiTopOfMindSignal): HomeThoughtCard {
  return {
    id: signal.nodeId,
    label: signal.label,
    type: signal.type,
    reason: signal.reason,
    supportingSignals: signal.supportingInspirations.map((support) => ({
      id: support.id,
      preview: support.preview,
      reason: support.reason,
      createdAt: support.createdAt,
    })),
    contextNodes: [
      {
        id: signal.nodeId,
        label: signal.label,
        type: signal.type,
      },
    ],
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
      reason: "Related signal",
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

function explainThoughtCard(card: HomeThoughtCard): string {
  const reason = shortText(card.reason || card.evidenceRationale || "", 135);
  const context = card.matchedEnvironment || card.ambientSignal;
  if (reason && context) {
    return `${reason} It keeps pointing toward ${shortText(context, 72)}.`;
  }
  if (reason) return reason;
  if (context) return `This keeps surfacing around ${shortText(context, 96)}.`;
  return "This is provisional. New saves can replace it.";
}

const NOTE_POSITIONS: Array<{ top: string; left: string; tilt: number; w: string }> = [
  { top: "24px", left: "calc(50% - 200px)", tilt: -1.4, w: "400px" },
  { top: "74px", left: "calc(50% - 520px)", tilt: -2.2, w: "260px" },
  { top: "270px", left: "calc(50% + 80px)", tilt: 1.8, w: "280px" },
  { top: "268px", left: "calc(50% - 470px)", tilt: 1.2, w: "260px" },
  { top: "438px", left: "calc(50% - 110px)", tilt: -0.8, w: "300px" },
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
    ...signal.highlightedSnippets.map((snippet) => snippet.text),
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
        reason: "These saves sit close together in the drawer while WAKA looks for a sharper connection.",
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
    signal.highlightedSnippets.length * 2 +
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
  return words.length > 0 ? words.join(" ") : "signals touching";
}

function groupingIconForSignals(signals: ApiSavedSignalSearchResult[]): MemoryGrouping["icon"] {
  if (signals.some((signal) => signalVisualTreatment(signal) === "image")) return "image";
  if (signals.some((signal) => signalVisualTreatment(signal) === "link")) return "link";
  if (signals.some((signal) => signal.highlightedSnippets.length > 0)) return "pin";
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

function buildProposedMemoryGroupings(
  signals: ApiSavedSignalSearchResult[],
  notes: ApiTopOfMindNoteSurface[],
  userGroups: UserMemoryGrouping[],
  renamedGroups: Record<string, string>,
  dismissedGroupIds: Set<string>,
): MemoryGrouping[] {
  const positions = [
    { x: 42, y: 72, tilt: -2 },
    { x: 330, y: 42, tilt: 1.5 },
    { x: 638, y: 88, tilt: -0.8 },
    { x: 148, y: 315, tilt: 2 },
    { x: 480, y: 292, tilt: -1.4 },
    { x: 760, y: 345, tilt: 1.2 },
  ];
  const groups: MemoryGrouping[] = [];
  const addGroup = (group: Omit<MemoryGrouping, "x" | "y" | "tilt">) => {
    if (group.signals.length === 0 || dismissedGroupIds.has(group.id) || groups.some((existing) => existing.id === group.id)) {
      return;
    }
    const position = positions[groups.length % positions.length];
    groups.push({
      ...group,
      name: renamedGroups[group.id] ?? group.name,
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
      explanation: "A grouping you made, kept beside WAKA's proposed piles.",
      source: "user",
      icon: "pin",
      signals: signals.filter((signal) => userGroup.signalIds.includes(signal.id)),
      terms: [userGroup.name],
    });
  }

  const highlighted = signals.filter((signal) => signal.highlightedSnippets.length > 0);
  addGroup({
    id: "highlighted-by-me",
    name: "highlighted by me",
    explanation: "These are the saves where you marked the part that hit.",
    source: "proposed",
    icon: "pin",
    signals: highlighted,
    terms: ["highlighted"],
  });

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
      explanation: `WAKA put these near the post-it "${shortText(note.title, 58)}".`,
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
        explanation: "These saves keep sharing language, highlights, or Top of Mind evidence.",
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
    explanation: "Recurrence is high here, so WAKA is keeping the pattern visible.",
    source: "proposed",
    icon: groupingIconForSignals(recurring),
    signals: recurring,
    terms: ["recurrence"],
  });

  return groups.slice(0, 8);
}

const HOME_COPY = {
  "ko-KR": {
    thoughtTab: "top of mind",
    savesTab: "memory drawer",
    room: "내 방",
    titleLineOne: (name: string) => (
      <>
        <span className="nc-title-name">{name}'s</span> top of mind
      </>
    ),
    titleLineTwo: "",
    titleSuffix: "",
    tagline: (
      <>
        떠오른 생각은 자주 사라집니다.
        <br />
        이 사람은 사라지기 전에 붙잡아 두었습니다.
        <br />
        그렇게 모인 조각들이 천천히 한 방향을 만들기 시작합니다.
        <br />
        누구와 생각하고 싶은지. 어디에 머물고 싶은지. 무엇을 만들고 싶은지.
        <br />
        <span className="nc-tagline-en">
          — she did not write any of this. she caught what almost slipped away. the rest found its shape.
        </span>
      </>
    ),
    lifecycleHint: "five provisional post-its. not final. changed by new signals.",
    noteShifted: ["keeps returning", "newly forming", "came back", "tension", "needs testing"],
    evidenceLabel: "여기서 시작됨",
    reactionGroup: "post-it controls",
    correctionLabel: "rewrite this post-it",
    correctionPlaceholder: "write the version you would keep on the wall",
    rewriteCta: "pin wording",
    removeCta: "pull down",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not change post-it",
    loadingThoughts: "생각이 모이는 중...",
    emptyThoughts: "저장한 영감이 쌓이면 여기에 생각이 나타납니다.",
    captureTitle: "첫 영감 붙잡기",
    captureBody: "정리하지 않아도 됩니다. 지저분하고 부끄럽고 덜 완성된 것도 사라지기 전에 저장하세요.",
    captureInlineKicker: "inspiration capture",
    footnote: (name: string) => (
      <>
        ※ 본 페이지는 {name} 본인이 쓴 글이 아닙니다.
        <br />
        저장한 것들이 모여 자기 멋대로 변합니다.
        <br />
        매주 바뀝니다. 어쩔 수 없음.
      </>
    ),
    footnoteCredit: "— Ⓒ WAKA, 2026, 생각의 서랍",
    savesTitle: "memory drawer",
    drawerObjectTitle: "saved inspirations",
    drawerObjectBody: "open the drawer",
    searchLabel: "search",
    searchPlaceholder: "저장본 검색",
    loadingSaves: "저장본을 불러오는 중...",
    emptySaves: "아직 저장된 영감이 없습니다.",
    captureAria: "capture inspiration",
    captureCta: "catch inspiration",
    captureHint: () => "",
    captureDialog: "capture inspiration",
    close: "close",
  },
  "en-US": {
    thoughtTab: "top of mind",
    savesTab: "memory drawer",
    room: "my room",
    titleLineOne: (name: string) => (
      <>
        <span className="nc-title-name">{name}'s</span> top of mind
      </>
    ),
    titleLineTwo: "",
    titleSuffix: "",
    tagline: (
      <>
        Most inspiration disappears.
        <br />
        They caught what almost slipped away.
        <br />
        And slowly, the things they saved began to take shape.
        <br />
        Who they want to think with. Where they want to be. What they are here to build.
        <br />
        <span className="nc-tagline-en">
          — they did not write any of this. they only saved what almost slipped away. the rest emerged.
        </span>
      </>
    ),
    lifecycleHint: "five provisional post-its. not final. changed by new signals.",
    noteShifted: ["keeps returning", "newly forming", "came back", "tension", "needs testing"],
    evidenceLabel: "where it began",
    reactionGroup: "post-it controls",
    correctionLabel: "rewrite this post-it",
    correctionPlaceholder: "write the version you would keep on the wall",
    rewriteCta: "pin wording",
    removeCta: "pull down",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not change post-it",
    loadingThoughts: "gathering what is top of mind...",
    emptyThoughts: "When saved inspirations gather, provisional notes will appear here.",
    captureTitle: "Catch the first inspiration",
    captureBody: "No tagging, journaling, or organizing. Save the messy, embarrassing, half-formed thing before it disappears.",
    captureInlineKicker: "inspiration capture",
    footnote: (name: string) => (
      <>
        This page was not written by {name}.
        <br />
        It was made from the things they saved.
        <br />
        They gathered, changed shape, and started speaking back.
        <br />
        It changes every week. It cannot help itself.
      </>
    ),
    footnoteCredit: "— Ⓒ WAKA, 2026, for minds that wander",
    savesTitle: "memory drawer",
    drawerObjectTitle: "saved inspirations",
    drawerObjectBody: "open the drawer",
    searchLabel: "search",
    searchPlaceholder: "search saved inspirations",
    loadingSaves: "loading saved inspirations...",
    emptySaves: "no inspirations saved yet.",
    captureAria: "capture inspiration",
    captureCta: "catch inspiration",
    captureHint: () => "",
    captureDialog: "capture inspiration",
    close: "close",
  },
} satisfies Record<
  SupportedLocale,
  {
    thoughtTab: string;
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
    correctionLabel: string;
    correctionPlaceholder: string;
    rewriteCta: string;
    removeCta: string;
    feedbackSaved: string;
    feedbackSaving: string;
    feedbackError: string;
    loadingThoughts: string;
    emptyThoughts: string;
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
    captureDialog: string;
    close: string;
  }
>;

export function HomePage(): JSX.Element {
  const { user, logout, updatePreferredLocale } = useAuth();

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
  const [topOfMind, setTopOfMind] = useState<ApiTopOfMind | null>(null);
  const [topOfMindLoading, setTopOfMindLoading] = useState(true);
  const [topOfMindError, setTopOfMindError] = useState<string | null>(null);
  const [topOfMindNotes, setTopOfMindNotes] = useState<ApiTopOfMindNoteSurface[]>([]);
  const [topOfMindNotesLoading, setTopOfMindNotesLoading] = useState(true);
  const [locale, setLocale] = useState<SupportedLocale>(() => readInitialLocale());
  const [inspirationFilters, setInspirationFilters] =
    useState<InspirationDiscoveryFilters>(DEFAULT_INSPIRATION_FILTERS);
  const [selectedMemoryGroupId, setSelectedMemoryGroupId] = useState<string>("all");
  const [memoryBrowseOrder, setMemoryBrowseOrder] = useState<MemoryBrowseOrder>("newest");
  const [memoryFolderView, setMemoryFolderView] = useState<MemoryFolderView>("grid");
  const [memoryFlowIndex, setMemoryFlowIndex] = useState(0);
  const [userMemoryGroups, setUserMemoryGroups] = useState<UserMemoryGrouping[]>([]);
  const [renamedMemoryGroups, setRenamedMemoryGroups] = useState<Record<string, string>>({});
  const [dismissedMemoryGroupIds, setDismissedMemoryGroupIds] = useState<Set<string>>(() => new Set());
  const [keptMemoryGroupIds, setKeptMemoryGroupIds] = useState<Set<string>>(() => new Set());
  const [memoryGroupDrags, setMemoryGroupDrags] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingMemoryGroupId, setDraggingMemoryGroupId] = useState<string | null>(null);
  const [memoryWindows, setMemoryWindows] = useState<MemoryWindowState[]>([]);
  const [draggingMemoryWindowId, setDraggingMemoryWindowId] = useState<string | null>(null);
  const [memoryWindowDetails, setMemoryWindowDetails] = useState<Record<string, ApiSavedSignalDetail | null>>({});
  const [memoryWindowLoadingIds, setMemoryWindowLoadingIds] = useState<Set<string>>(() => new Set());
  const [memoryWindowZ, setMemoryWindowZ] = useState(10);
  const [captureFocused, setCaptureFocused] = useState(false);
  const [captureSaveFlash, setCaptureSaveFlash] = useState(false);
  const [captureView] = useState<CaptureView>("note");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<HomeMode>("topOfMind");
  const [captureOpen, setCaptureOpen] = useState(false);
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
  const [drags, setDrags] = useState<Record<number, { x: number; y: number }>>({});
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [actionDrag, setActionDrag] = useState({ x: 0, y: 0 });
  const [actionDragging, setActionDragging] = useState(false);
  const [expandedNoteIndex, setExpandedNoteIndex] = useState<number | null>(null);
  const [actionRecommendations, setActionRecommendations] = useState<
    ApiActionRecommendation[]
  >([]);
  const [savedSignals, setSavedSignals] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedSignalsLoading, setSavedSignalsLoading] = useState(false);
  const [savedSignalsError, setSavedSignalsError] = useState<string | null>(null);
  const [selectedSavedSignalId, setSelectedSavedSignalId] = useState<string | null>(null);
  const [savedSignalDetail, setSavedSignalDetail] = useState<ApiSavedSignalDetail | null>(null);
  const [savedSignalDetailLoading, setSavedSignalDetailLoading] = useState(false);
  const [selectedInspirationText, setSelectedInspirationText] = useState<{
    signalId: string;
    text: string;
  } | null>(null);
  const [highlightStatus, setHighlightStatus] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "error"; message: string }
  >({ status: "idle" });
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
  const topOfMindLoadedForUserIdRef = useRef<string | null>(null);
  const topOfMindRequestIdRef = useRef(0);
  const dragStartRef = useRef<{ index: number; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const actionDragStartRef = useRef<{ x: number; y: number; baseX: number; baseY: number } | null>(null);
  const memoryGroupDragStartRef = useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const memoryWindowDragStartRef = useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const dragMovedRef = useRef(false);
  const memoryGroupDragMovedRef = useRef(false);
  const memoryWindowDragMovedRef = useRef(false);
  const captureSaveFlashTimerRef = useRef<number | null>(null);

  const handleLocaleChange = useCallback(
    (nextLocale: SupportedLocale) => {
      setLocale(nextLocale);
      writeLocalePreference(nextLocale);
      void updatePreferredLocale(nextLocale);
    },
    [updatePreferredLocale],
  );

  useEffect(() => {
    if (!user) return;
    const preferredLocale = normalizeSupportedLocale(user.preferredLocale);
    setLocale(preferredLocale);
    writeLocalePreference(preferredLocale);
  }, [user?.preferredLocale, user?.id]);

  useEffect(() => {
    return () => {
      if (captureSaveFlashTimerRef.current !== null) {
        window.clearTimeout(captureSaveFlashTimerRef.current);
      }
    };
  }, []);

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
      setActionRecommendations([]);
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
        if (cancelled) return;
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
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load signals";
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
        if (topOfMindRequestIdRef.current !== requestId) return null;
        topOfMindLoadedForUserIdRef.current = requestUserId;
        setTopOfMind(next);
        setTopOfMindNotes(notes.filter((note) => note.userId === requestUserId));
        fetchActionRecommendations()
          .then((actions) => {
            if (topOfMindRequestIdRef.current === requestId) {
              setActionRecommendations(actions.filter((action) => action.status === "active"));
            }
          })
          .catch(() => {
            if (topOfMindRequestIdRef.current === requestId) {
              setActionRecommendations([]);
            }
          });
        setTopOfMindLoading(false);
        setTopOfMindNotesLoading(false);
        setTopOfMindError(null);
        return next;
      } catch (err) {
        if (topOfMindRequestIdRef.current !== requestId) return null;
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
      const reflectionScorePatch = result.reflection?.inspiration;
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
                result.reflection ? 1 : 0,
              )
            : e,
        ),
      );

      const targetId = result.inspiration.id;
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
        window.setTimeout(() => {
          void (async () => {
            try {
              const rows = await fetchInspirations();
              const target = rows.find((r) => r.id === targetId);
              if (!target) return;
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
      void (async () => {
        try {
          const result = await recordInspirationRevisit(id, eventType);
          if (result.inspiration) {
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

  const handleMemoryTextSelection = useCallback((signalId: string): void => {
    const selection = window.getSelection();
    const selected = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (selected.length < 2) {
      setSelectedInspirationText((current) => (current?.signalId === signalId ? null : current));
      return;
    }
    setSelectedInspirationText({ signalId, text: selected.slice(0, 4096) });
    setHighlightStatus({ status: "idle" });
  }, []);

  const addMemoryHighlight = useCallback(
    async (signalId: string): Promise<void> => {
      if (!selectedInspirationText || selectedInspirationText.signalId !== signalId) return;
      setHighlightStatus({ status: "saving" });
      try {
        const spark = await createInspirationSpark(signalId, {
          text: selectedInspirationText.text,
          source: "user_selected",
          confidence: 100,
          isPrimary: false,
        });
        setSavedSignalDetail((current) =>
          current && current.id === signalId
            ? { ...current, highlightedSnippets: [spark, ...current.highlightedSnippets] }
            : current,
        );
        setMemoryWindowDetails((current) => {
          const detail = current[signalId];
          if (!detail) return current;
          return {
            ...current,
            [signalId]: {
              ...detail,
              highlightedSnippets: [spark, ...detail.highlightedSnippets],
            },
          };
        });
        setSavedSignals((current) =>
          current.map((signal) =>
            signal.id === signalId
              ? { ...signal, highlightedSnippets: [spark, ...signal.highlightedSnippets] }
              : signal,
          ),
        );
        setSelectedInspirationText(null);
        setHighlightStatus({ status: "idle" });
        window.getSelection()?.removeAllRanges();
      } catch (caught) {
        setHighlightStatus({
          status: "error",
          message: caught instanceof Error ? caught.message : "Highlight did not save",
        });
      }
    },
    [selectedInspirationText],
  );

  const removeMemoryHighlight = useCallback(
    async (signalId: string, highlight: HighlightableSnippet): Promise<void> => {
      const removeLocal = (): void => {
        setSavedSignalDetail((current) =>
          current && current.id === signalId
            ? {
                ...current,
                highlightedSnippets: current.highlightedSnippets.filter((snippet) => snippet.id !== highlight.id),
              }
            : current,
        );
        setMemoryWindowDetails((current) => {
          const detail = current[signalId];
          if (!detail) return current;
          return {
            ...current,
            [signalId]: {
              ...detail,
              highlightedSnippets: detail.highlightedSnippets.filter((snippet) => snippet.id !== highlight.id),
            },
          };
        });
        setSavedSignals((current) =>
          current.map((signal) =>
            signal.id === signalId
              ? {
                  ...signal,
                  highlightedSnippets: signal.highlightedSnippets.filter((snippet) => snippet.id !== highlight.id),
                }
              : signal,
          ),
        );
      };

      removeLocal();
      try {
        await deleteInspirationSpark(signalId, highlight.id);
      } catch {
        // Removing highlight UI should feel reversible and light; a future
        // sync can reconcile if the best-effort delete fails.
      }
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

  const handleDetailReflectionCountChanged = useCallback(
    (id: string, count: number) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === id || entry.tempId === id
            ? {
                ...entry,
                reflectionsAnswered: count,
                reflectionsTotal: count,
              }
            : entry,
        ),
      );
    },
    [],
  );

  const handleInspirationScoresChanged = useCallback(
    (scores: ApiInspirationScorePatch) => {
      setEntries((prev) => prev.map((entry) => applyInspirationScorePatch(entry, scores)));
    },
    [],
  );

  const handleInspirationUpdated = useCallback((inspiration: ApiInspiration) => {
    setEntries((prev) =>
      prev.map((entry) => applyUpdatedInspiration(entry, inspiration)),
    );
  }, []);

  /**
   * Pull the currently-selected entry out of the local list so we can
   * hand its body / links / attachments to the detail view. Falls back
   * to `null` when the id no longer matches a row (e.g. the row was
   * just persisted with a new server id and the optimistic mapping has
   * already been swapped).
   */
  const selectedEntry = useMemo(() => {
    if (!selectedId) return null;
    return entries.find((e) => e.id === selectedId) ?? null;
  }, [entries, selectedId]);

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
    return [...entries].reverse().map(entryToCardData);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return filterAndSortInspirationEntries(entries, inspirationFilters);
  }, [entries, inspirationFilters]);

  const savedSignalQuery = inspirationFilters.search.trim().toLowerCase();
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
    })),
    relevanceReasons: entry.errorMessage ? [entry.errorMessage] : [],
  } satisfies ApiSavedSignalSearchResult));
  const savedSignalRows = savedSignals.length > 0
    ? [
        ...localSignalRows.filter((entry) => !savedSignals.some((signal) => signal.id === entry.id)),
        ...savedSignals.map((signal) => {
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
  const searchedSignals = savedSignalRows.filter((signal) => {
    if (!savedSignalQuery) return true;
    return signalTextHaystack(signal).includes(savedSignalQuery);
  });
  const inPlaceSignals = [...searchedSignals].sort((a, b) => capturedAtMs(b) - capturedAtMs(a));
  const memoryGroupings = useMemo(
    () =>
      buildProposedMemoryGroupings(
        inPlaceSignals,
        topOfMindNotes,
        userMemoryGroups,
        renamedMemoryGroups,
        dismissedMemoryGroupIds,
      ),
    [dismissedMemoryGroupIds, inPlaceSignals, renamedMemoryGroups, topOfMindNotes, userMemoryGroups],
  );
  const selectedMemoryGroup =
    memoryGroupings.find((group) => group.id === selectedMemoryGroupId) ?? memoryGroupings[0] ?? null;
  const selectedMemoryGroupSignals = selectedMemoryGroup
    ? sortSignalsForGrouping(selectedMemoryGroup.signals, selectedMemoryGroup.terms, memoryBrowseOrder)
    : [];
  const constellationRelationships = buildMemoryConstellationRelationships(inPlaceSignals, topOfMindNotes);
  const selectedMemoryRelationship = constellationRelationships[0] ?? null;

  const selectedSavedSignal = useMemo(() => {
    return inPlaceSignals.find((signal) => signal.id === selectedSavedSignalId) ?? null;
  }, [inPlaceSignals, selectedSavedSignalId]);

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
    if (memoryGroupings.length === 0) return;
    if (!memoryGroupings.some((group) => group.id === selectedMemoryGroupId)) {
      setSelectedMemoryGroupId(memoryGroupings[0].id);
    }
  }, [homeMode, memoryGroupings, selectedMemoryGroupId]);

  useEffect(() => {
    if (!user || homeMode !== "memoryDrawer") return;
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
          if (cancelled) return;
          const ownRows = rows.filter((row) => row.userId === user.id);
          setSavedSignals(ownRows);
          setSelectedSavedSignalId((current) =>
            current && ownRows.some((row) => row.id === current) ? current : null,
          );
        } catch (caught) {
          if (cancelled) return;
          setSavedSignalsError(caught instanceof Error ? caught.message : "Failed to load saved signals");
        } finally {
          if (!cancelled) setSavedSignalsLoading(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [homeMode, inspirationFilters.search, user]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (!selectedSavedSignal?.id) {
      setSavedSignalDetail(null);
      return;
    }

    let cancelled = false;
    setSavedSignalDetailLoading(true);
    void (async () => {
      try {
        const detail = await fetchSavedSignalDetail(selectedSavedSignal.id);
        if (cancelled) return;
        setSavedSignalDetail(detail);
      } catch {
        if (cancelled) return;
        setSavedSignalDetail(null);
      } finally {
        if (!cancelled) setSavedSignalDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, selectedSavedSignal?.id]);

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
  }, [cardItems, handleSelectInspiration]);

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
      // component, resetting the loading state and re-running the
      // reflections fetch for the new row.
      key={detailData.id}
      inspiration={detailData}
      onBack={handleBackFromDetail}
      onDeleted={handleDeletedInspiration}
      onReflectionCountChanged={handleDetailReflectionCountChanged}
      onInspirationScoresChanged={handleInspirationScoresChanged}
      onInspirationUpdated={handleInspirationUpdated}
      locale={locale}
    />
  ) : undefined;

  const fallbackThoughtCards = [
    ...(topOfMind?.activeQuestions ?? []),
    ...(topOfMind?.activeThemes ?? []),
  ].slice(0, TOP_OF_MIND_NOTE_LIMIT).map(signalToThoughtCard);
  const usesTopOfMindNoteSurface = topOfMindNotes.length > 0 || removedTopOfMindNoteIds.size > 0;
  const thoughtCards = usesTopOfMindNoteSurface
    ? topOfMindNotes.slice(0, TOP_OF_MIND_NOTE_LIMIT).map(noteToThoughtCard)
    : fallbackThoughtCards;
  const meaningfulThoughtCards = uniqueThoughtCards(thoughtCards.filter(isMeaningfulThoughtCard)).slice(0, TOP_OF_MIND_NOTE_LIMIT);
  const visibleActionItems = actionRecommendations
    .filter((item) => item.status === "active")
    .slice(0, 5);
  const displayName = (user.name || user.email.split("@")[0] || "yunji").split(" ")[0];
  const displayHandle = displayName.toLowerCase();
  const copy = HOME_COPY[locale];

  useEffect(() => {
    if (initialLoading || topOfMindLoading || topOfMindNotesLoading) return;
    setHomeMode("topOfMind");
  }, [initialLoading, topOfMindLoading, topOfMindNotesLoading]);

  const chooseHomeMode = (mode: HomeMode) => {
    setHomeMode(mode);
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
    if (!signal.feedbackTargetId) return;
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
      await createFeedback({
        targetType: "top_of_mind_note",
        targetId: signal.feedbackTargetId,
        value: "partly",
        correctionText: trimmedTitle,
      });
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
      setTopOfMindNotes(previousNotes);
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

  const pullDownTopOfMindNote = async (signal: HomeThoughtCard) => {
    if (!signal.feedbackTargetId) return;

    const previousNotes = topOfMindNotes;
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
    setExpandedNoteIndex(null);

    try {
      await createFeedback({
        targetType: "top_of_mind_note",
        targetId: signal.feedbackTargetId,
        value: "not_true",
        correctionText: "pulled down from the wall",
      });
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

  const renderPostItControls = (
    signal: HomeThoughtCard,
  ): JSX.Element | null => {
    if (!signal.feedbackTargetId) return null;
    const feedbackState = noteFeedback[signal.id];
    const saving = feedbackState?.status === "saving";
    const draft = feedbackState?.correctionText || signal.label;
    return (
      <div
        className="nc-note-controls"
        role="group"
        aria-label={copy.reactionGroup}
      >
        <label className="nc-note-rewrite" onClick={(event) => event.stopPropagation()}>
          <span>{copy.correctionLabel}</span>
          <textarea
            value={draft}
            placeholder={copy.correctionPlaceholder}
            rows={2}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              updateCorrectionText(signal.id, event.target.value)
            }
          />
        </label>
        <div className="nc-note-control-actions">
          <button
            type="button"
            className="nc-note-control-btn"
            disabled={saving || !draft.trim()}
            onClick={(event) => {
              event.stopPropagation();
              void submitTopOfMindEdit(signal, draft);
            }}
          >
            {copy.rewriteCta}
          </button>
          <button
            type="button"
            className="nc-note-control-btn nc-note-control-btn--pull"
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation();
              void pullDownTopOfMindNote(signal);
            }}
          >
            {copy.removeCta}
          </button>
        </div>
        {feedbackState?.status === "saving" ? (
          <p className="nc-note-feedback-status">{copy.feedbackSaving}</p>
        ) : feedbackState?.status === "saved" ? (
          <p className="nc-note-feedback-status">{copy.feedbackSaved}</p>
        ) : feedbackState?.status === "error" ? (
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
    if (visual === "note") return signal.highlightedSnippets.length > 0 ? "highlighted scrap" : "note scrap";
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

  const keepMemoryGroup = (groupId: string): void => {
    setKeptMemoryGroupIds((current) => new Set([...current, groupId]));
  };

  const dismissMemoryGroup = (groupId: string): void => {
    setDismissedMemoryGroupIds((current) => new Set([...current, groupId]));
    if (selectedMemoryGroupId === groupId) setSelectedMemoryGroupId("all");
  };

  const loadMemoryWindowDetail = (signalId: string): void => {
    if (memoryWindowDetails[signalId] !== undefined || memoryWindowLoadingIds.has(signalId)) return;
    setMemoryWindowLoadingIds((current) => new Set([...current, signalId]));
    void fetchSavedSignalDetail(signalId)
      .then((detail) => {
        setMemoryWindowDetails((current) => ({ ...current, [signalId]: detail }));
      })
      .catch(() => {
        setMemoryWindowDetails((current) => ({ ...current, [signalId]: null }));
      })
      .finally(() => {
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

  const closeMemoryWindow = (signalId: string): void => {
    setMemoryWindows((current) => current.filter((memoryWindow) => memoryWindow.signalId !== signalId));
    if (selectedSavedSignalId === signalId) setSelectedSavedSignalId(null);
  };

  const toggleMinimizeMemoryWindow = (signalId: string): void => {
    setMemoryWindows((current) =>
      current.map((memoryWindow) =>
        memoryWindow.signalId === signalId
          ? { ...memoryWindow, minimized: !memoryWindow.minimized, z: memoryWindowZ + 1 }
          : memoryWindow,
      ),
    );
    setMemoryWindowZ((current) => current + 1);
  };

  const relationshipHintsForOpenWindow = (signalId: string): MemoryConstellationRelationship[] => {
    const openIds = new Set(memoryWindows.map((memoryWindow) => memoryWindow.signalId));
    if (openIds.size < 2) return [];
    return constellationRelationships
      .filter((relationship) =>
        [relationship.sourceId, relationship.targetId].includes(signalId) &&
        openIds.has(relationship.sourceId) &&
        openIds.has(relationship.targetId),
      )
      .slice(0, 2);
  };

  const renderMemoryGroupObject = (group: MemoryGrouping): JSX.Element => {
    const selected = selectedMemoryGroup?.id === group.id;
    const kept = keptMemoryGroupIds.has(group.id);
    return (
      <article
        key={group.id}
        className={`memory-group-object mac-folder memory-group-object--${group.icon}${
          selected ? " memory-group-object--selected selected" : ""
        }${draggingMemoryGroupId === group.id ? " memory-group-object--dragging" : ""}`}
        style={{
          ["--x" as string]: `${group.x + (memoryGroupDrags[group.id]?.x ?? 0)}px`,
          ["--y" as string]: `${group.y + (memoryGroupDrags[group.id]?.y ?? 0)}px`,
          ["--tilt" as string]: `${group.tilt}deg`,
        }}
      >
        <button
          type="button"
          className="memory-group-hitarea"
          aria-pressed={selected}
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
            setMemoryFlowIndex(0);
          }}
        >
          <span className="mac-folder-back" aria-hidden="true" />
          <span className="mac-folder-front" aria-hidden="true" />
          <span className="folder-icon" data-icon={group.icon} aria-hidden="true">
            {group.icon === "pin" ? "*" : group.icon === "image" ? "I" : group.icon === "link" ? "L" : "F"}
          </span>
          <strong>{group.name}</strong>
          <small>{group.signals.length} saved</small>
        </button>
        <p>{group.explanation}</p>
        <div className="memory-group-actions">
          {group.source === "proposed" ? (
            <>
              <button type="button" onClick={() => keepMemoryGroup(group.id)}>
                {kept ? "kept" : "keep"}
              </button>
              <button type="button" onClick={() => dismissMemoryGroup(group.id)}>
                dismiss
              </button>
            </>
          ) : null}
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
    const detailHighlights = signal.highlightedSnippets;
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
        {signal.highlightedSnippets[0] && !isExpanded ? (
          <blockquote>{shortText(signal.highlightedSnippets[0].text, options.compact ? 72 : 120)}</blockquote>
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
            setSelectedInspirationText(null);
            openMemoryWindow(signal);
          }}
        >
          {cardInner}
        </button>
        {isExpanded ? (
          <div className="memory-signal-card-detail signal-revisit-detail signal-revisit-detail--open">
            {savedSignalDetailLoading ? <p className="signal-revisit-state">Opening the signal...</p> : null}
            <section>
              <span>original signal</span>
            <p
              className="signal-revisit-raw memory-readable-signal"
              onMouseUp={() => handleMemoryTextSelection(signal.id)}
              onKeyUp={() => handleMemoryTextSelection(signal.id)}
            >
              {renderHighlightedInspirationText(detailText, detailHighlights, (highlight) => {
                void removeMemoryHighlight(signal.id, highlight);
              })}
            </p>
            </section>
            {selectedInspirationText?.signalId === signal.id ? (
              <div className="memory-highlight-popover">
                <span>{shortText(selectedInspirationText.text, 90)}</span>
                <button
                  type="button"
                  disabled={highlightStatus.status === "saving"}
                  onClick={() => void addMemoryHighlight(signal.id)}
                >
                  {highlightStatus.status === "saving" ? "adding..." : "add highlight"}
                </button>
              </div>
            ) : null}
            {highlightStatus.status === "error" && selectedInspirationText?.signalId === signal.id ? (
              <p className="signal-revisit-state">{highlightStatus.message}</p>
            ) : null}
            {(savedSignalDetail?.attachments.length ?? 0) > 0 || signal.attachmentSummary.length > 0 ? (
              <section>
                <span>attachment context</span>
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

  const renderMemoryFlow = (): JSX.Element => {
    const flowSignals = selectedMemoryGroupSignals;
    const activeIndex = Math.min(memoryFlowIndex, Math.max(flowSignals.length - 1, 0));
    const activeSignal = flowSignals[activeIndex];
    const axis = memoryFolderView === "horizontal" ? "horizontal" : "vertical";

    if (!activeSignal) {
      return <p className="memory-relationship-empty">Nothing in this pile yet.</p>;
    }

    return (
      <section
        className={`memory-flow-workspace memory-flow-workspace--${axis}`}
        aria-label={`${axis} inspiration flow`}
      >
        <header className="memory-flow-toolbar">
          <div>
            <span>{axis} flow</span>
            <strong>
              {activeIndex + 1} / {flowSignals.length}
            </strong>
          </div>
          <div className="memory-flow-controls">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setMemoryFlowIndex((index) => Math.max(0, index - 1))}
            >
              previous
            </button>
            <button
              type="button"
              disabled={activeIndex >= flowSignals.length - 1}
              onClick={() =>
                setMemoryFlowIndex((index) => Math.min(flowSignals.length - 1, index + 1))
              }
            >
              next
            </button>
          </div>
        </header>
        <div className="memory-flow-stage">
          <div
            className="memory-flow-track"
            style={{
              transform:
                axis === "horizontal"
                  ? `translateX(-${activeIndex * 100}%)`
                  : `translateY(-${activeIndex * 100}%)`,
            }}
          >
            {flowSignals.map((signal, index) => {
              const visual = signalVisualTreatment(signal);
              const whyIncluded =
                selectedMemoryGroup?.source === "all"
                  ? "newest saved inspiration in the drawer"
                  : selectedMemoryGroup?.terms.find((term) => signalTextHaystack(signal).includes(term)) ||
                    signal.relatedTopOfMindNoteTitles[0] ||
                    signal.relatedContextTerms[0] ||
                    selectedMemoryGroup?.explanation ||
                    "this pile is still forming";
              return (
                <article
                  key={signal.id}
                  className={`memory-flow-card memory-flow-card--${visual}${
                    index === activeIndex ? " memory-flow-card--active" : ""
                  }`}
                  aria-hidden={index === activeIndex ? undefined : true}
                >
                  <span className="memory-flow-kicker">{signalMaterialLabel(signal)}</span>
                  <p className="memory-flow-readable">{signal.textPreview}</p>
                  {signal.highlightedSnippets[0] ? (
                    <blockquote>{signal.highlightedSnippets[0].text}</blockquote>
                  ) : null}
                  {signal.attachmentSummary.slice(0, 2).map((attachment) => (
                    <span key={attachment.id} className="memory-flow-attachment">
                      {attachment.label}
                    </span>
                  ))}
                  <footer>
                    <div>
                      <span>{selectedMemoryGroup?.name ?? "current pile"}</span>
                      <p>{shortText(whyIncluded, 112)}</p>
                    </div>
                    <button type="button" onClick={() => openMemoryWindow(signal)}>
                      open on desk
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    );
  };

  const renderMemoryWindow = ({
    memoryWindow,
    signal,
  }: {
    memoryWindow: MemoryWindowState;
    signal: ApiSavedSignalSearchResult;
  }): JSX.Element => {
    const detail = memoryWindowDetails[signal.id];
    const loading = memoryWindowLoadingIds.has(signal.id);
    const detailText = detail?.rawText ?? signal.textPreview;
    const detailHighlights = detail?.highlightedSnippets ?? signal.highlightedSnippets;
    const relatedGroupNames = memoryGroupings
      .filter((group) => group.signals.some((groupSignal) => groupSignal.id === signal.id))
      .map((group) => group.name)
      .slice(0, 3);
    const relationshipHints = relationshipHintsForOpenWindow(signal.id);
    return (
      <article
        key={signal.id}
        className={`memory-window${memoryWindow.minimized ? " memory-window--minimized" : ""}${
          draggingMemoryWindowId === signal.id ? " memory-window--dragging" : ""
        }`}
        style={{
          ["--x" as string]: `${memoryWindow.x}px`,
          ["--y" as string]: `${memoryWindow.y}px`,
          zIndex: memoryWindow.z,
        }}
        onPointerDown={onMemoryWindowPointerDown(memoryWindow)}
        onMouseDown={onMemoryWindowMouseDown(memoryWindow)}
        aria-label={`open inspiration: ${shortText(signal.textPreview, 64)}`}
      >
        <header className="memory-window-bar">
          <div
            className="memory-window-title"
            aria-hidden="true"
          >
            <span>{signalMaterialLabel(signal)}</span>
            <strong>{shortText(signal.textPreview, 54)}</strong>
          </div>
          <div className="memory-window-actions">
            <button type="button" onClick={() => toggleMinimizeMemoryWindow(signal.id)}>
              {memoryWindow.minimized ? "open" : "minimize"}
            </button>
            <button type="button" onClick={() => closeMemoryWindow(signal.id)}>
              close
            </button>
          </div>
        </header>
        {memoryWindow.minimized ? null : (
          <div className="memory-window-body signal-revisit-detail signal-revisit-detail--open">
            {loading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
            <section className="memory-window-primary">
              <span>saved inspiration</span>
              <p
                className="signal-revisit-raw memory-readable-signal"
                onMouseUp={() => handleMemoryTextSelection(signal.id)}
                onKeyUp={() => handleMemoryTextSelection(signal.id)}
              >
                {renderHighlightedInspirationText(detailText, detailHighlights, (highlight) => {
                  void removeMemoryHighlight(signal.id, highlight);
                })}
              </p>
            </section>
            {selectedInspirationText?.signalId === signal.id ? (
              <div className="memory-highlight-popover">
                <span>{shortText(selectedInspirationText.text, 90)}</span>
                <button
                  type="button"
                  disabled={highlightStatus.status === "saving"}
                  onClick={() => void addMemoryHighlight(signal.id)}
                >
                  {highlightStatus.status === "saving" ? "adding..." : "add highlight"}
                </button>
              </div>
            ) : null}
            {highlightStatus.status === "error" && selectedInspirationText?.signalId === signal.id ? (
              <p className="signal-revisit-state">{highlightStatus.message}</p>
            ) : null}
            {(detail?.attachments.length ?? 0) > 0 || signal.attachmentSummary.length > 0 ? (
              <section className="memory-window-context">
                <span>attachment context</span>
                <ul className="signal-revisit-notes">
                  {(detail?.attachments.length
                    ? detail.attachments.map((attachment) => ({
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
            <section className="memory-window-context">
              <span>nearby piles</span>
              <p>
                {relatedGroupNames.length > 0
                  ? relatedGroupNames.join(", ")
                  : "No clear pile has claimed this yet."}
              </p>
            </section>
            {signal.relatedTopOfMindNoteTitles.length > 0 ? (
              <section className="memory-window-context">
                <span>why it may belong here</span>
                <p>{signal.relatedTopOfMindNoteTitles.slice(0, 2).join(", ")}</p>
              </section>
            ) : null}
            {relationshipHints.length > 0 ? (
              <section className="memory-window-hints" aria-label="relationship hints">
                <span>between open inspirations</span>
                {relationshipHints.map((relationship) => {
                  const otherId = relationship.sourceId === signal.id ? relationship.targetId : relationship.sourceId;
                  const otherSignal = inPlaceSignals.find((candidate) => candidate.id === otherId);
                  return (
                    <p key={relationship.id}>
                      <strong>{relationship.label}</strong>
                      {otherSignal ? ` with "${shortText(otherSignal.textPreview, 58)}"` : null}
                    </p>
                  );
                })}
              </section>
            ) : null}
          </div>
        )}
      </article>
    );
  };

  const relatedMeaningLabels = (signal: HomeThoughtCard): string[] => {
    if (!topOfMind) return [];
    const labels = new Set<string>();
    for (const edge of topOfMind.relationshipSignals) {
      if (edge.sourceNodeId === signal.id) labels.add(edge.targetLabel);
      if (edge.targetNodeId === signal.id) labels.add(edge.sourceLabel);
    }
    return [...labels].slice(0, 3).map((label) =>
      locale === "en-US"
        ? label
        : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(label)] ?? label,
    );
  };

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
    if (!actionDragging) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const start = actionDragStartRef.current;
      if (!start) return;
      setActionDrag({
        x: start.baseX + event.clientX - start.x,
        y: start.baseY + event.clientY - start.y,
      });
    };

    const handlePointerUp = () => {
      actionDragStartRef.current = null;
      setActionDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [actionDragging]);

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

  useEffect(() => {
    if (draggingMemoryWindowId === null) return undefined;

    const moveWindow = (clientX: number, clientY: number) => {
      const start = memoryWindowDragStartRef.current;
      if (!start) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) memoryWindowDragMovedRef.current = true;
      setMemoryWindows((current) =>
        current.map((memoryWindow) =>
          memoryWindow.signalId === start.id
            ? {
                ...memoryWindow,
                x: start.baseX + dx,
                y: start.baseY + dy,
              }
            : memoryWindow,
        ),
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      moveWindow(event.clientX, event.clientY);
    };

    const handleMouseMove = (event: MouseEvent) => {
      moveWindow(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      memoryWindowDragStartRef.current = null;
      setDraggingMemoryWindowId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [draggingMemoryWindowId]);

  const onNotePointerDown = (index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) return;
    if (expandedNoteIndex === index) return;
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

  const onActionPadPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) return;
    actionDragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      baseX: actionDrag.x,
      baseY: actionDrag.y,
    };
    setActionDragging(true);
  };

  const startMemoryWindowDrag = (
    memoryWindow: MemoryWindowState,
    event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  ) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, mark")) return;
      if (draggingMemoryWindowId === memoryWindow.signalId) return;
      const nextZ = memoryWindowZ + 1;
      setMemoryWindowZ(nextZ);
      setMemoryWindows((current) =>
        current.map((item) =>
          item.signalId === memoryWindow.signalId ? { ...item, z: nextZ } : item,
        ),
      );
      memoryWindowDragStartRef.current = {
        id: memoryWindow.signalId,
        x: event.clientX,
        y: event.clientY,
        baseX: memoryWindow.x,
        baseY: memoryWindow.y,
      };
      memoryWindowDragMovedRef.current = false;
      setDraggingMemoryWindowId(memoryWindow.signalId);
    };

  const onMemoryWindowPointerDown =
    (memoryWindow: MemoryWindowState) => (event: ReactPointerEvent<HTMLElement>) => {
      startMemoryWindowDrag(memoryWindow, event);
    };

  const onMemoryWindowMouseDown =
    (memoryWindow: MemoryWindowState) => (event: ReactMouseEvent<HTMLElement>) => {
      startMemoryWindowDrag(memoryWindow, event);
    };

  const onNoteClick = (index: number) => () => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    setExpandedNoteIndex((current) => (current === index ? current : index));
  };

  const closeExpandedNoteOnBackdrop = () => {
    setExpandedNoteIndex(null);
  };

  const completeActionItem = (item: ApiActionRecommendation): void => {
    setActionRecommendations((current) =>
      current.filter((action) => action.id !== item.id),
    );
    void updateActionRecommendationState(item.id, {
      sourceTopOfMindId: item.sourceTopOfMindId,
      status: "completed",
    }).catch(() => {
      setActionRecommendations((current) =>
        current.some((action) => action.id === item.id)
          ? current
          : [...current, item].sort((a, b) => b.confidence - a.confidence),
      );
    });
  };

  const removeActionItem = (item: ApiActionRecommendation): void => {
    setActionRecommendations((current) =>
      current.filter((action) => action.id !== item.id),
    );
    void updateActionRecommendationState(item.id, {
      sourceTopOfMindId: item.sourceTopOfMindId,
      status: "removed",
    }).catch(() => {
      setActionRecommendations((current) =>
        current.some((action) => action.id === item.id)
          ? current
          : [...current, item].sort((a, b) => b.confidence - a.confidence),
      );
    });
  };

  const renderActionPostIt = (): JSX.Element | null => {
    if (visibleActionItems.length === 0) return null;
    return (
      <aside
        className={`nc-action-pad${actionDragging ? " nc-action-pad--dragging" : ""}`}
        aria-label="suggested actions"
        style={{
          ["--action-dx" as string]: `${actionDrag.x}px`,
          ["--action-dy" as string]: `${actionDrag.y}px`,
        }}
        onPointerDown={onActionPadPointerDown}
      >
        <header>
          <span>try next</span>
          <strong>get one signal from the real world</strong>
        </header>
        <ul>
          {visibleActionItems.map((item) => {
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="nc-action-check"
                  aria-label={`mark done: ${item.text}`}
                  onClick={() => completeActionItem(item)}
                />
                <span>
                  <strong>{item.text}</strong>
                  <small>
                    {shortText(item.whyNow, 54)}
                    {item.evidenceSnippets[0]
                      ? ` · evidence: ${shortText(item.evidenceSnippets[0], 54)}`
                      : ""}
                  </small>
                </span>
                <button
                  type="button"
                  className="nc-action-remove"
                  aria-label={`remove action: ${item.text}`}
                  onClick={() => removeActionItem(item)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    );
  };

  const renderThoughtCard = (signal: HomeThoughtCard, index: number): JSX.Element => {
    const position = NOTE_POSITIONS[index] ?? NOTE_POSITIONS[0];
    const drag = drags[index] ?? { x: 0, y: 0 };
    return (
    <article
      className={`nc-note${index === 0 ? " nc-note--featured" : ""}${draggingIndex === index ? " nc-note--dragging" : ""}`}
      key={signal.id}
      style={{
        ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
        ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        ["--tilt" as string]: `${position.tilt}deg`,
        ["--w" as string]: position.w,
        ["--top" as string]: position.top,
        ["--left" as string]: position.left,
        ["--dx" as string]: `${drag.x}px`,
        ["--dy" as string]: `${drag.y}px`,
        ["--decay" as string]: String(1 - index * 0.08),
      }}
      onPointerDown={onNotePointerDown(index)}
      onClick={onNoteClick(index)}
    >
      <p className="nc-note-body">
        {locale === "en-US"
          ? signal.label
          : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(signal.label)] ?? signal.label}
      </p>

      <div className="nc-note-explain">
        <p>{explainThoughtCard(signal)}</p>
      </div>
    </article>
  );
  };

  const renderExpandedThoughtCard = (index: number): JSX.Element | null => {
    const signal = meaningfulThoughtCards[index];
    if (!signal) return null;
    const relatedLabels = relatedMeaningLabels(signal);
    const source = signal.supportingSignals[0];
    const contextNodes =
      signal.contextNodes.length > 0
        ? signal.contextNodes
        : relatedLabels.map((label, labelIndex) => ({
            id: `${signal.id}-related-${labelIndex}`,
            label,
            type: "context",
          }));
    return (
      <article
        className="nc-note-modal nc-note-peel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`top-of-mind-note-${signal.id}`}
        style={{
          ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
          ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="nc-note-peel-close"
          aria-label="close post-it reflection"
          onClick={closeExpandedNoteOnBackdrop}
        >
          close
        </button>

        <header className="nc-note-peel-head">
          <div>
            <span className="nc-note-title">opened post-it</span>
          </div>
          <p>the short note, with just enough context to understand why it surfaced</p>
        </header>

        <div className="nc-note-expanded-content">
          <section className="nc-note-peel-hero" aria-label="opened post-it">
            <p className="nc-note-body" id={`top-of-mind-note-${signal.id}`}>
              {locale === "en-US"
                ? signal.label
                : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(signal.label)] ?? signal.label}
            </p>
            <p>{signal.reason}</p>
          </section>

          <div className="nc-note-peel-grid">
            <section className="nc-note-context-panel" aria-labelledby={`top-of-mind-frequency-${signal.id}`}>
              <div className="nc-note-evidence-header">
                <span>why this matters</span>
                <strong id={`top-of-mind-frequency-${signal.id}`}>
                  current read
                </strong>
              </div>
              <dl className="nc-note-frequency-list">
                <div>
                  <dt>points toward</dt>
                  <dd>{signal.matchedEnvironment ?? "WAKA is still inferring the surrounding signal."}</dd>
                </div>
                <div>
                  <dt>pushes away from</dt>
                  <dd>{signal.antiEnvironment ?? "No rejected context has surfaced clearly yet."}</dd>
                </div>
                <div>
                  <dt>why now</dt>
                  <dd>{signal.evidenceRationale ?? "This read is provisional and should be corrected if it misses."}</dd>
                </div>
                <div>
                  <dt>outside reading</dt>
                  <dd>
                    {signal.rejectedAlternativeInterpretation ??
                      "No competing interpretation has been strong enough to name yet."}
                  </dd>
                </div>
              </dl>
            </section>

          <section className="nc-note-source-section nc-note-peel-source">
            <span>it began here</span>
            <blockquote className="nc-note-source">
              “{shortText(source?.preview || signal.reason, 190)}”
            </blockquote>
          </section>
          </div>

          <section className="nc-note-evidence-panel nc-note-peel-evidence" aria-labelledby={`top-of-mind-evidence-${signal.id}`}>
            <div className="nc-note-evidence-header">
              <span>supporting saved moments · evidence signals</span>
              <strong id={`top-of-mind-evidence-${signal.id}`}>
                {signal.supportingSignals.length > 0
                  ? `${signal.supportingSignals.length} signal${signal.supportingSignals.length === 1 ? "" : "s"} behind this`
                  : "no signal evidence yet"}
              </strong>
            </div>
            {signal.supportingSignals.length > 0 ? (
              <ol className="nc-note-evidence-list">
                {signal.supportingSignals.slice(0, 5).map((evidence) => (
                  <li key={evidence.id}>
                    <blockquote>“{shortText(evidence.preview || evidence.reason, 150)}”</blockquote>
                    <p>{shortText(evidence.reason, 120)}</p>
                    <div>
                      <span>{evidence.kind || "signal"}</span>
                      {typeof evidence.resonanceScore === "number" ? (
                        <span>resonance {Math.round(evidence.resonanceScore)}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="nc-note-empty-evidence">
                This post-it does not have signal evidence attached yet.
              </p>
            )}
          </section>

          <section className="nc-note-context-panel" aria-labelledby={`top-of-mind-context-${signal.id}`}>
            <div className="nc-note-evidence-header">
              <span>ambition dimension</span>
              <strong id={`top-of-mind-context-${signal.id}`}>
                {signal.ambitionDimension?.replace(/_/g, " ") ?? "still forming"}
              </strong>
            </div>
            <p className="nc-note-empty-evidence">
              Edits to this post-it help WAKA keep the {signal.ambitionDimension?.replace(/_/g, " ") ?? "ambition"} read
              close to what is alive now.
            </p>
            {contextNodes.length > 0 ? (
              <ul className="nc-note-context-list">
                {contextNodes.slice(0, 4).map((node) => (
                  <li key={node.id}>
                    <span>{meaningTypeLabel(node.type)}</span>
                    <p>
                      {locale === "en-US"
                        ? shortText(node.label, 120)
                        : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(node.label)] ??
                          shortText(node.label, 120)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nc-note-empty-evidence">
                WAKA has not linked a durable context claim to this note yet.
              </p>
            )}
          </section>

          {relatedLabels.length > 0 ? (
            <section className="nc-note-nearby-section">
              <span>nearby thought</span>
              <p className="nc-note-related-line">{relatedLabels[0]}</p>
            </section>
          ) : null}

          <footer className="nc-note-expanded-foot">
            {renderPostItControls(signal)}
            <span>not final · changed by new signals · replaceable</span>
          </footer>
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
      {expandedNoteIndex !== null ? (
        <div className="nc-note-overlay" onClick={closeExpandedNoteOnBackdrop}>
          {renderExpandedThoughtCard(expandedNoteIndex)}
        </div>
      ) : null}
      <main className={`nc-canvas${homeMode === "topOfMind" ? " nc-canvas--top-of-mind" : ""}`}>
        {homeMode === "topOfMind" ? (
          <>
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
              <p className="nc-tagline">{copy.tagline}</p>
              <p className="nc-lifecycle-hint">{copy.lifecycleHint}</p>
            </section>

            <section className="nc-stage" aria-label={PRODUCT_SPACES.topOfMind}>
              {topOfMindLoading ? (
                <p className="nc-loading">{copy.loadingThoughts}</p>
              ) : topOfMindError ? (
                <p className="nc-loading">{topOfMindError}</p>
              ) : meaningfulThoughtCards.length > 0 ? (
                <>
                  {meaningfulThoughtCards.map((card, index) => renderThoughtCard(card, index))}
                  {renderActionPostIt()}
                </>
              ) : (
                <p className="nc-loading">{copy.emptyThoughts}</p>
              )}
              <button
                type="button"
                className="nc-drawer-object"
                onClick={() => chooseHomeMode("memoryDrawer")}
                aria-label={`${copy.drawerObjectBody}: ${copy.savesTitle}`}
              >
                <span className="nc-drawer-tab" aria-hidden="true" />
                <span className="nc-drawer-title">{copy.drawerObjectTitle}</span>
                <strong>{copy.drawerObjectBody}</strong>
                <small>{entries.length} saved</small>
              </button>
            </section>

            <footer className="nc-footnote">
              <p>{copy.footnote(displayHandle)}</p>
              <p className="nc-footnote-credit">{copy.footnoteCredit}</p>
              <div className="nc-lang nc-lang--footer" aria-label="language">
                <button
                  type="button"
                  className={`nc-lang-btn${locale === "ko-KR" ? " nc-lang-btn--active" : ""}`}
                  onClick={() => handleLocaleChange("ko-KR")}
                >
                  한
                </button>
                <button
                  type="button"
                  className={`nc-lang-btn${locale === "en-US" ? " nc-lang-btn--active" : ""}`}
                  onClick={() => handleLocaleChange("en-US")}
                >
                  en
                </button>
              </div>
            </footer>
          </>
        ) : (
          <section className="reference-saves-page signal-revisit-page" aria-label={copy.savesTitle}>
            <header className="signal-revisit-header">
              <div>
                <span>{PRODUCT_SPACES.memoryDrawer}</span>
                <h2>Open the piles WAKA thinks belong together.</h2>
                <p>Raw saves stay intact. These groupings are a removable layer above them.</p>
              </div>
              <button
                type="button"
                className="nc-wall-return"
                onClick={() => chooseHomeMode("topOfMind")}
              >
                back to wall
              </button>
              <details className="signal-revisit-search">
                <summary>search</summary>
                <label>
                  <span>{copy.searchLabel}</span>
                  <input
                    type="search"
                  value={inspirationFilters.search}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setInspirationFilters({ search: event.target.value });
                    setSelectedSavedSignalId(null);
                    setSavedSignalDetail(null);
                  }}
                  placeholder={copy.searchPlaceholder}
                />
                </label>
              </details>
            </header>

            <div className="memory-drawer-desk">
              <div className="memory-window-layer" aria-label="open inspiration windows">
                {visibleMemoryWindows.map(renderMemoryWindow)}
              </div>
              <section className="memory-group-board" aria-label="proposed inspiration groupings">
                {memoryGroupings.map(renderMemoryGroupObject)}
                <button
                  type="button"
                  className="memory-bulletin-object"
                  onClick={createUserMemoryGroup}
                >
                  <span>new pile</span>
                  <strong>make my own</strong>
                </button>
                {savedSignalsError ? <p className="memory-relationship-empty">{savedSignalsError}</p> : null}
                {savedSignalsLoading && inPlaceSignals.length === 0 ? (
                  <p className="memory-relationship-empty">{copy.loadingSaves}</p>
                ) : null}
                {!savedSignalsError && !savedSignalsLoading && inPlaceSignals.length === 0 ? (
                  <p className="memory-relationship-empty">{initialLoading ? copy.loadingSaves : copy.emptySaves}</p>
                ) : null}
              </section>

              <section className="memory-group-contents" aria-label="grouping contents">
                <header>
                  <div>
                    <span>{selectedMemoryGroup?.source === "all" ? "chronological path" : "selected grouping"}</span>
                    <label className="memory-group-name-edit">
                      <span>name</span>
                      <input
                        value={selectedMemoryGroup?.name ?? ""}
                        onChange={(event) => {
                          if (selectedMemoryGroup) renameMemoryGroup(selectedMemoryGroup.id, event.target.value);
                        }}
                        disabled={!selectedMemoryGroup}
                      />
                    </label>
                    {selectedMemoryGroup ? <p>{selectedMemoryGroup.explanation}</p> : null}
                  </div>
                  <div className="memory-order-switcher" role="group" aria-label="browse order">
                    {[
                      { id: "newest" as const, label: "newest first" },
                      { id: "relevance" as const, label: "strongest fit" },
                    ].map((order) => (
                      <button
                        key={order.id}
                        type="button"
                        className={memoryBrowseOrder === order.id ? "is-active" : ""}
                        aria-pressed={memoryBrowseOrder === order.id}
                        onClick={() => setMemoryBrowseOrder(order.id)}
                      >
                        {order.label}
                      </button>
                    ))}
                  </div>
                  <div className="memory-view-switcher" role="group" aria-label="pile view">
                    {[
                      { id: "grid" as const, label: "grid" },
                      { id: "vertical" as const, label: "vertical flow" },
                      { id: "horizontal" as const, label: "horizontal flow" },
                    ].map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        className={memoryFolderView === view.id ? "is-active" : ""}
                        aria-pressed={memoryFolderView === view.id}
                        onClick={() => {
                          setMemoryFolderView(view.id);
                          setMemoryFlowIndex(0);
                        }}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                </header>
                {memoryFolderView === "grid" ? (
                  <div className="memory-list-stack">
                    {selectedMemoryGroupSignals.map((signal) => renderMemorySignalCard(signal))}
                  </div>
                ) : (
                  renderMemoryFlow()
                )}
              </section>
            </div>
          </section>
        )}
      </main>

      {expandedNoteIndex === null ? (
        <button type="button" className="nc-save" onClick={() => setCaptureOpen(true)} aria-label={copy.captureAria}>
          <span className="nc-save-cta">{copy.captureCta}</span>
        </button>
      ) : null}

      {captureOpen ? (
        <div className="reference-capture-modal" role="dialog" aria-modal="true" aria-label={copy.captureDialog}>
          <button type="button" className="reference-capture-close" onClick={() => setCaptureOpen(false)}>
            {copy.close}
          </button>
          <div className="reference-capture-shell">
            <div className="reference-capture-kicker">{copy.captureInlineKicker}</div>
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
            onDismissAfterSave={() => setCaptureOpen(false)}
          />
          </div>
        </div>
      ) : null}
      {/*
        Temporary sign-out affordance. The prototype has no auth concept,
        so there's no in-design slot for this control yet. We render it
        as a fixed-position pill outside the board so it doesn't pollute
        the visual contract — a proper user-menu UI lands in a later
        design pass.
      */}
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
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
        style={{
          position: "fixed",
          bottom: 10,
          right: 10,
          zIndex: 300,
          background: "rgba(255, 253, 247, 0.52)",
          border: "1px solid rgba(15, 15, 14, 0.12)",
          borderRadius: 999,
          padding: "4px 9px",
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--muted)",
          opacity: 0.72,
          cursor: "pointer",
        }}
        aria-label={`${t(locale, "signOut")} ${user.email}`}
        title={`${user.name} ${t(locale, "signOutPerson")}`}
      >
        {t(locale, "signOut")}
      </button>
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
