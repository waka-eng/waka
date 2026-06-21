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
  type KeyboardEvent as ReactKeyboardEvent,
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
  type ApiAmbitionDimension,
  type ApiFeedbackValue,
  type ApiError,
  type ApiInspiration,
  type ApiInspirationKind,
  type ApiReflection,
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
  createReflection,
  deleteInspiration,
  deleteInspirationSpark,
  fetchReflections,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchInspirations,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  generateGuidedReflectionQuestion,
  recordInspirationRevisit,
  updateInspiration,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { deriveTitleFromText, mergeReflectionRows } from "../lib/inspiration-detail";
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
const SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS: Record<SupportedLocale, readonly string[]> = {
  "en-US": [
    "What does this inspiration ask you to notice next?",
    "What desire, fear, or standard does it point toward?",
    "What would change if you took that seriously?",
  ],
  "ko-KR": [
    "이 영감은 지금 무엇을 알아차리라고 하나요?",
    "어떤 바람, 두려움, 기준을 가리키나요?",
    "그 신호를 진지하게 받아들이면 무엇이 달라질까요?",
  ],
};

function savedSignalReflectionFallbackQuestion(locale: SupportedLocale, index: number): string {
  const questions = SAVED_SIGNAL_REFLECTION_FALLBACK_QUESTIONS[locale];
  return questions[index] ?? questions[questions.length - 1] ?? "";
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
  "important" | "partly" | "not_true"
>;
type FeedbackStatus = "idle" | "saving" | "saved" | "error";
type MemoryConstellationVisual = "note" | "link" | "image" | "mixed";
type SupportingThoughtSignal = HomeThoughtCard["supportingSignals"][number];

const TOP_OF_MIND_NOTE_LIMIT = 5;
const MEMORY_DRAWER_CLOSE_MS = 360;

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

function userFacingCopy(value: string): string {
  return value
    .replace(/\bsaved signals\b/gi, "saved inspirations")
    .replace(/\bsignals\b/gi, "inspirations")
    .replace(/\bsignal\b/gi, "inspiration")
    .replace(/\bresonance\b/gi, "what hit")
    .replace(/\bgraph\b/gi, "pattern")
    .replace(/\bnodes?\b/gi, "claim")
    .replace(/\bmemory movement\b/gi, "what changed")
    .replace(/\banalysis\b/gi, "read")
    .replace(/\bAI\b/g, "the read");
}

type HighlightableSnippet = Pick<ApiInspirationSpark, "id" | "text"> & { note?: string | null };
type SavedSignalHighlight = ApiSavedSignalSearchResult["highlightedSnippets"][number];

interface MemoryHighlightSelection {
  signalId: string;
  text: string;
}

function renderHighlightedInspirationText(
  text: string,
  highlights: HighlightableSnippet[],
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
      <mark
        className="memory-inline-highlight"
        key={next.highlight.id || key++}
        tabIndex={0}
      >
        {next.highlight.text}
      </mark>,
    );
    cursor = next.index + next.highlight.text.length;
  }

  return chunks;
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

interface MemoryPathFilter {
  id: string;
  path: string;
  displayPath: string;
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

function thoughtCardPreviewLabel(card: HomeThoughtCard, locale: string): string {
  const displayLabel =
    locale === "en-US" ? card.label : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(card.label)] ?? card.label;
  return userFacingCopy(displayLabel);
}

function thoughtCardDisplayLabel(card: HomeThoughtCard, locale: string): string {
  return locale === "en-US"
    ? card.label
    : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(card.label)] ?? card.label;
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
  return words.length > 0 ? words.join(" ") : "inspirations touching";
}

function memoryMapLabel(value: string): string {
  const label = normalizeMeaningLabel(value);
  const knownLabels: Record<string, string> = {
    "all saved, newest first": "all saved",
    "highlighted by me": "highlights",
    "recently saved": "recently saved",
    "rooms i keep wanting": "wanted rooms",
    "people i want near me": "wanted people",
    "work i keep circling": "work orbit",
    "things i am done with": "done with",
    "taste with a pulse": "taste pulse",
    "questions still open": "open questions",
    "inspirations touching": "loose signals",
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
      highlights?: unknown[];
      links?: unknown[];
    };
    return (
      (draft.note?.trim().length ?? 0) > 0 ||
      (draft.highlights?.length ?? 0) > 0 ||
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

function sortedSignalsNewest(signals: ApiSavedSignalSearchResult[]): ApiSavedSignalSearchResult[] {
  return [...signals].sort((a, b) => capturedAtMs(b) - capturedAtMs(a));
}

const MEMORY_PATH_COPY: Record<
  SupportedLocale,
  {
    allSavedLabel: string;
    allSavedDescription: string;
    allSavedPath: string;
    recentlySavedLabel: string;
    recentlySavedDescription: string;
    recentlySavedPath: string;
    inspirationCount: (count: number) => string;
    sharedPathDescription: (count: number) => string;
  }
> = {
  "ko-KR": {
    allSavedLabel: "전체 저장",
    allSavedDescription: "저장된 영감 전체, 최신순",
    allSavedPath: "/전체-저장",
    recentlySavedLabel: "최근 저장",
    recentlySavedDescription: "최근 2일 안에 저장한 영감",
    recentlySavedPath: "/최근-저장",
    inspirationCount: (count) => `${count}개 저장`,
    sharedPathDescription: (count) => `이 길에 함께 놓인 영감 ${count}개`,
  },
  "en-US": {
    allSavedLabel: "all saved",
    allSavedDescription: "all saved inspirations, newest first",
    allSavedPath: "/all-saved",
    recentlySavedLabel: "recently saved",
    recentlySavedDescription: "saved in the last 2 days",
    recentlySavedPath: "/recently-saved",
    inspirationCount: (count) => `${count} ${count === 1 ? "save" : "saves"}`,
    sharedPathDescription: (count) => `${count} inspiration${count === 1 ? "" : "s"} sharing this path`,
  },
};

function buildMemoryPathFilters(signals: ApiSavedSignalSearchResult[], locale: SupportedLocale): MemoryPathFilter[] {
  const pathCopy = MEMORY_PATH_COPY[locale];
  const sortedSignals = sortedSignalsNewest(signals);
  const recentlySavedSignals = sortedSignals.filter((signal) => signalAgeDays(signal) <= 2);
  const filters: MemoryPathFilter[] = [
    {
      id: "all-saved",
      path: "/all-saved",
      displayPath: pathCopy.allSavedPath,
      label: pathCopy.allSavedLabel,
      description: pathCopy.allSavedDescription,
      signals: sortedSignals,
    },
  ];

  filters.push({
    id: "recently-saved",
    path: "/recently-saved",
    displayPath: pathCopy.recentlySavedPath,
    label: pathCopy.recentlySavedLabel,
    description: pathCopy.recentlySavedDescription,
    signals: recentlySavedSignals,
  });

  const internalTermPattern = /(?:meaning[-_]?nodes?|context[-_]?nodes?|node id|ctx[-_]?\d+|edge)/i;
  const addThemeFilter = (rawLabel: string, relatedSignals: ApiSavedSignalSearchResult[]): void => {
    const label = normalizeMeaningLabel(rawLabel);
    if (!label || internalTermPattern.test(label)) return;
    const uniqueRelatedSignals = uniqueSignals(relatedSignals);
    if (uniqueRelatedSignals.length === 0) return;
    const id = `theme-${label.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    const existing = filters.find((filter) => filter.id === id || filter.label === label);
    if (existing) {
      existing.signals = uniqueSignals([...existing.signals, ...uniqueRelatedSignals]);
      existing.description = pathCopy.sharedPathDescription(existing.signals.length);
      return;
    }
    filters.push({
      id,
      path: `/${id}`,
      displayPath: `/${label}`,
      label,
      description: pathCopy.sharedPathDescription(uniqueRelatedSignals.length),
      signals: sortedSignalsNewest(uniqueRelatedSignals),
    });
  };

  for (const signal of sortedSignals) {
    for (const title of signal.relatedTopOfMindNoteTitles) addThemeFilter(title, [signal]);
    for (const term of signal.relatedContextTerms) addThemeFilter(term, [signal]);
  }

  return filters;
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
    savesTab: "영감 서랍",
    room: "내 방",
    titleLineOne: (name: string) => (
      <>
        <span className="nc-title-name">{name}님의</span> 탑오브마인드
      </>
    ),
    titleLineTwo: "",
    titleSuffix: "",
    tagline: (
      <>
        저장한 영감들이 조금씩 하나의 지도를 만듭니다.
        <br />
        누구와 생각하고 싶은지. 어디에 머물고 싶은지. 무엇을 만들고 싶은지.
        <br />
        <span className="nc-tagline-en">— 저장한 것들에서 나온 임시 노트입니다. 새 영감이 들어오면 달라집니다.</span>
      </>
    ),
    lifecycleHint: "",
    noteShifted: ["반복됨", "형성 중", "다시 돌아옴", "긴장", "확인 필요"],
    evidenceLabel: "시작된 곳",
    reactionGroup: "포스트잇 조정",
    correctionLabel: "포스트잇 수정",
    correctionPlaceholder: "벽에 남길 문장으로 다듬기",
    pinCta: "PIN",
    rewriteCta: "저장",
    removeCta: "삭제",
    feedbackPinned: "고정됨",
    feedbackSaved: "저장됨",
    feedbackSaving: "저장 중...",
    feedbackError: "포스트잇을 바꾸지 못했습니다",
    loadingThoughts: "생각을 모으는 중...",
    emptyThoughts: "관련된 영감이 2~3개 이상 쌓이면 임시 노트가 여기에 나타납니다.",
    captureTitle: "첫 영감 붙잡기",
    captureBody: "정리하지 않아도 됩니다. 어설프고 덜 완성된 생각도 그대로 저장하세요.",
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
    emptySaves: "아직 저장된 영감이 없습니다.",
    captureAria: "영감 기록하기",
    captureCta: "영감 기록",
    captureHint: () => "",
    captureDialog: "영감 기록",
    close: "닫기",
    bottomHint: "영감을 기록하면 탑오브마인드 포스트잇이 만들어집니다.",
    dropOverlay: "어디에든 놓기 — 링크, 이미지, 메모",
    homeControlsAria: "홈 컨트롤",
    languageControlsAria: "언어",
    topOfMindAria: "탑오브마인드 포스트잇 다섯 장",
    memoryDrawerTitle: "영감 서랍",
    memoryPathListAria: "저장된 영감 목록",
    memoryPathNavAria: "저장된 영감 길",
    memoryPathClearAll: "전체 저장 보기",
    memoryPathNoSearchResults: (query: string, path: string) => `“${query}”와 일치하는 저장된 영감이 ${path}에 없습니다.`,
    memoryPathEmpty: (path: string) => `아직 ${path}에 저장된 영감이 없습니다.`,
    backHome: "홈으로 돌아가기",
    adminInspectionLabel: "점검",
    adminInspectionAria: "관리자 점검 도구 열기",
    adminInspectionTitle: "내부 점검",
    bottomActionsAria: "하단 작업",
    undoDeletedInspiration: "영감이 삭제되었습니다 · 되돌리기",
    undoDeletedSticky: "포스트잇이 삭제되었습니다 · 되돌리기",
    saveEditedInspiration: "수정한 영감 저장",
    saveEdit: "저장",
    cancelEdit: "수정 취소",
    reflectionAnswerPlaceholder: "여기에 답변",
    previous: "이전",
    next: "다음",
    saving: "저장 중...",
    save: "저장",
    cancel: "취소",
  },
  "en-US": {
    thoughtTab: "top of mind",
    savesTab: "inspiration drawer",
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
        Saved inspirations start to form a map.
        <br />
        Who they want to think with. Where they want to be. What they are here to build.
        <br />
        <span className="nc-tagline-en">
          — provisional notes from the things they saved. changing as new inspirations arrive.
        </span>
      </>
    ),
    lifecycleHint: "",
    noteShifted: ["keeps returning", "newly forming", "came back", "tension", "needs testing"],
    evidenceLabel: "where it began",
    reactionGroup: "post-it controls",
    correctionLabel: "edit post-it",
    correctionPlaceholder: "write the version you would keep on the wall",
    pinCta: "PIN",
    rewriteCta: "save",
    removeCta: "delete",
    feedbackPinned: "pinned",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not change post-it",
    loadingThoughts: "gathering what is top of mind...",
    emptyThoughts: "When 2–3 related inspirations gather, provisional notes will appear here.",
    captureTitle: "Catch the first inspiration",
    captureBody: "No tagging, journaling, or organizing. Save the messy, embarrassing, half-formed thing as it is.",
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
    footnoteCredit: "— Ⓒ 2026, for minds that wander",
    savesTitle: "inspiration drawer",
    drawerObjectTitle: "saved inspirations",
    drawerObjectBody: "open the drawer",
    searchLabel: "search",
    searchPlaceholder: "search saved inspirations",
    loadingSaves: "loading saved inspirations...",
    emptySaves: "no inspirations saved yet.",
    captureAria: "capture inspiration",
    captureCta: "capture inspiration",
    captureHint: () => "",
    captureDialog: "capture inspiration",
    close: "close",
    bottomHint: "Capture inspirations to generate your top of mind stickies.",
    dropOverlay: "Drop anywhere — link, image, or note",
    homeControlsAria: "home controls",
    languageControlsAria: "language",
    topOfMindAria: "Five Top of Mind post-its",
    memoryDrawerTitle: "Inspiration Drawer",
    memoryPathListAria: "saved inspiration list",
    memoryPathNavAria: "saved inspiration paths",
    memoryPathClearAll: "show /all-saved",
    memoryPathNoSearchResults: (query: string, path: string) => `No saved inspirations match “${query}” in ${path}.`,
    memoryPathEmpty: (path: string) => `No saved inspirations in ${path} yet.`,
    backHome: "back home",
    adminInspectionLabel: "Debug",
    adminInspectionAria: "Open admin inspection tools",
    adminInspectionTitle: "Internal Debug",
    bottomActionsAria: "bottom actions",
    undoDeletedInspiration: "inspiration was deleted · undo",
    undoDeletedSticky: "sticky note was deleted · undo",
    saveEditedInspiration: "save edited inspiration",
    saveEdit: "save",
    cancelEdit: "cancel edit",
    reflectionAnswerPlaceholder: "answer here",
    previous: "previous",
    next: "next",
    saving: "saving...",
    save: "save",
    cancel: "cancel",
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
    pinCta: string;
    rewriteCta: string;
    removeCta: string;
    feedbackPinned: string;
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
    bottomHint: string;
    dropOverlay: string;
    homeControlsAria: string;
    languageControlsAria: string;
    topOfMindAria: string;
    memoryDrawerTitle: string;
    memoryPathListAria: string;
    memoryPathNavAria: string;
    memoryPathClearAll: string;
    memoryPathNoSearchResults: (query: string, path: string) => string;
    memoryPathEmpty: (path: string) => string;
    backHome: string;
    adminInspectionLabel: string;
    adminInspectionAria: string;
    adminInspectionTitle: string;
    bottomActionsAria: string;
    undoDeletedInspiration: string;
    undoDeletedSticky: string;
    saveEditedInspiration: string;
    saveEdit: string;
    cancelEdit: string;
    reflectionAnswerPlaceholder: string;
    previous: string;
    next: string;
    saving: string;
    save: string;
    cancel: string;
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
  const [topOfMind, setTopOfMind] = useState<ApiTopOfMind | null>(null);
  const [topOfMindLoading, setTopOfMindLoading] = useState(true);
  const [topOfMindError, setTopOfMindError] = useState<string | null>(null);
  const [topOfMindNotes, setTopOfMindNotes] = useState<ApiTopOfMindNoteSurface[]>([]);
  const [topOfMindNotesLoading, setTopOfMindNotesLoading] = useState(true);
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const [inspirationFilters, setInspirationFilters] =
    useState<InspirationDiscoveryFilters>(DEFAULT_INSPIRATION_FILTERS);
  const [selectedMemoryGroupId, setSelectedMemoryGroupId] = useState<string | null>(null);
  const [selectedMemoryPathFilterId, setSelectedMemoryPathFilterId] = useState("all-saved");
  const [showAllMemoryPathFilters, setShowAllMemoryPathFilters] = useState(false);
  // The cleaned-up contents view always reads newest-first; the explicit
  // sort toggle was removed in favor of a calmer, text-forward layout.
  const memoryBrowseOrder: MemoryBrowseOrder = "newest";
  const [memoryFolderView, setMemoryFolderView] = useState<MemoryFolderView>("grid");
  const [memoryFlowIndex, setMemoryFlowIndex] = useState(0);
  const [userMemoryGroups, setUserMemoryGroups] = useState<UserMemoryGrouping[]>([]);
  const [renamedMemoryGroups, setRenamedMemoryGroups] = useState<Record<string, string>>({});
  const [dismissedMemoryGroupIds] = useState<Set<string>>(() => new Set());
  const [memoryGroupDrags, setMemoryGroupDrags] = useState<Record<string, { x: number; y: number }>>({});
  const [seenMemoryGroupIds, setSeenMemoryGroupIds] = useState<Set<string>>(() => new Set());
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
  const [expandedNoteIndex, setExpandedNoteIndex] = useState<number | null>(null);
  const [expandedSupportingSignalIds, setExpandedSupportingSignalIds] = useState<Set<string>>(() => new Set());
  const [supportingSignalDetails, setSupportingSignalDetails] = useState<Record<string, ApiSavedSignalDetail | null>>({});
  const [supportingSignalDetailLoadingIds, setSupportingSignalDetailLoadingIds] = useState<Set<string>>(() => new Set());
  const [supportingSignalDetailErrors, setSupportingSignalDetailErrors] = useState<Record<string, string>>({});
  const [savedSignals, setSavedSignals] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedSignalsLoading, setSavedSignalsLoading] = useState(false);
  const [savedSignalsError, setSavedSignalsError] = useState<string | null>(null);
  const [selectedSavedSignalId, setSelectedSavedSignalId] = useState<string | null>(null);
  const [selectedSupportingSignalFallback, setSelectedSupportingSignalFallback] =
    useState<ApiSavedSignalSearchResult | null>(null);
  const [savedSignalDetail, setSavedSignalDetail] = useState<ApiSavedSignalDetail | null>(null);
  const [savedSignalDetailLoading, setSavedSignalDetailLoading] = useState(false);
  const [savedSignalDrafts, setSavedSignalDrafts] = useState<Record<string, string>>({});
  const [savedSignalEditSaving, setSavedSignalEditSaving] = useState(false);
  const [memoryHighlightMode, setMemoryHighlightMode] = useState(false);
  const [savedSignalReflections, setSavedSignalReflections] = useState<Record<string, ApiReflection[]>>({});
  const [savedSignalReflectionLoadingIds, setSavedSignalReflectionLoadingIds] = useState<Set<string>>(() => new Set());
  const [savedSignalReflectingId, setSavedSignalReflectingId] = useState<string | null>(null);
  const [savedSignalReflectionDraft, setSavedSignalReflectionDraft] = useState("");
  const [savedSignalReflectionAnswers, setSavedSignalReflectionAnswers] = useState<string[]>([]);
  const [savedSignalReflectionQuestions, setSavedSignalReflectionQuestions] = useState<string[]>([]);
  const [savedSignalReflectionStepIndex, setSavedSignalReflectionStepIndex] = useState(0);
  const [savedSignalReflectionSaving, setSavedSignalReflectionSaving] = useState(false);
  const [savedSignalReflectionError, setSavedSignalReflectionError] = useState<string | null>(null);
  const savedSignalReflectionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const savedSignalReflectionRequestSeqRef = useRef(0);
  const [selectedInspirationText, setSelectedInspirationText] = useState<MemoryHighlightSelection | null>(null);
  const [memoryHighlightReaction, setMemoryHighlightReaction] = useState<string | null>(null);
  const [memoryHighlightNote, setMemoryHighlightNote] = useState("");
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
  const memoryGroupDragStartRef = useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const memoryWindowDragStartRef = useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const dragMovedRef = useRef(false);
  const memoryGroupDragMovedRef = useRef(false);
  const memoryWindowDragMovedRef = useRef(false);
  const captureSaveFlashTimerRef = useRef<number | null>(null);

  const clearDrawerCloseTimer = () => {
    if (drawerCloseTimerRef.current === null) return;
    clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = null;
  };

  useEffect(() => {
    if (!user) return;
    const preferredLocale = normalizeSupportedLocale(user.preferredLocale);
    setLocale(preferredLocale);
    writeStoredLocale(preferredLocale);
  }, [user?.preferredLocale, user?.id]);

  useEffect(() => {
    return () => {
      if (captureSaveFlashTimerRef.current !== null) {
        window.clearTimeout(captureSaveFlashTimerRef.current);
      }
      if (deletedTopOfMindUndoTimerRef.current !== null) {
        window.clearTimeout(deletedTopOfMindUndoTimerRef.current);
      }
      if (deletedSavedSignalUndoTimerRef.current !== null) {
        window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
      }
      clearDrawerCloseTimer();
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
        if (topOfMindRequestIdRef.current !== requestId) return null;
        topOfMindLoadedForUserIdRef.current = requestUserId;
        setTopOfMind(next);
        setTopOfMindNotes(notes.filter((note) => note.userId === requestUserId));
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
      void refreshTopOfMind({ showLoading: false, surfaceErrors: true });

      // The classifier worker writes `cluster` first, then attempts automatic
      // top-of-mind generation. Keep polling briefly after classification so a
      // note created just after the first classified refetch still appears
      // without requiring a manual refresh.
      const delays = [1500, 2500, 3500, 5000, 8000, 13000];
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
              void refreshTopOfMind({
                showLoading: false,
                surfaceErrors: false,
              });
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

  const captureMemoryHighlightSelection = useCallback(
    (signalId: string, selected: string): void => {
      if (!memoryHighlightMode) {
        // The detail surface supports quick selection popovers even before the
        // explicit highlight toggle is pressed, so users can react to text in
        // place without entering a separate mode.
      }
      const normalizedSelection = selected.trim();
      if (normalizedSelection.length < 2) {
        setSelectedInspirationText((current) => (current?.signalId === signalId ? null : current));
        return;
      }
      setSelectedInspirationText({
        signalId,
        text: normalizedSelection.slice(0, 4096),
      });
      setMemoryHighlightReaction(null);
      setMemoryHighlightNote("");
      setHighlightStatus({ status: "idle" });
    },
    [memoryHighlightMode],
  );

  const handleMemoryTextSelection = useCallback(
    (signalId: string): void => {
      captureMemoryHighlightSelection(signalId, window.getSelection()?.toString() ?? "");
    },
    [captureMemoryHighlightSelection],
  );

  const handleMemoryTextareaSelection = useCallback(
    (signalId: string, element: HTMLTextAreaElement): void => {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const selected = element.value.slice(Math.min(start, end), Math.max(start, end)) || window.getSelection()?.toString() || "";
      captureMemoryHighlightSelection(signalId, selected);
      element.setSelectionRange(end, end);
    },
    [captureMemoryHighlightSelection],
  );

  const addMemoryHighlight = useCallback(
    async (signalId: string): Promise<void> => {
      if (!selectedInspirationText || selectedInspirationText.signalId !== signalId) return;
      const selected = selectedInspirationText;
      const tempHighlight: SavedSignalHighlight = {
        id: `temp-highlight-${signalId}-${Date.now()}`,
        text: selected.text,
        source: "user_selected",
        confidence: 100,
        isPrimary: false,
      };
      const updateLocalHighlight = (
        updater: (current: SavedSignalHighlight[]) => SavedSignalHighlight[],
      ): void => {
        setSavedSignalDetail((current) =>
          current && current.id === signalId
            ? { ...current, highlightedSnippets: updater(current.highlightedSnippets) }
            : current,
        );
        setMemoryWindowDetails((current) => {
          const detail = current[signalId];
          if (!detail) return current;
          return {
            ...current,
            [signalId]: {
              ...detail,
              highlightedSnippets: updater(detail.highlightedSnippets),
            },
          };
        });
        setSavedSignals((current) =>
          current.map((signal) =>
            signal.id === signalId
              ? { ...signal, highlightedSnippets: updater(signal.highlightedSnippets) }
              : signal,
          ),
        );
      };

      setHighlightStatus({ status: "saving" });
      updateLocalHighlight((current) => [tempHighlight, ...current]);
      setSelectedInspirationText(null);
      window.getSelection()?.removeAllRanges();
      try {
        const spark = await createInspirationSpark(signalId, {
          text: selected.text,
          source: "user_selected",
          confidence: 100,
          isPrimary: false,
          ...(memoryHighlightReaction
            ? {
                note: `highlight_reaction:v1:${JSON.stringify({
                  reaction: memoryHighlightReaction,
                  note: memoryHighlightNote,
                })}`,
              }
            : {}),
        });
        updateLocalHighlight((current) =>
          current.map((highlight) => (highlight.id === tempHighlight.id ? spark : highlight)),
        );
        setHighlightStatus({ status: "idle" });
      } catch (caught) {
        updateLocalHighlight((current) => current.filter((highlight) => highlight.id !== tempHighlight.id));
        setHighlightStatus({
          status: "error",
          message: caught instanceof Error ? caught.message : "Highlight did not save",
        });
      }
    },
    [memoryHighlightNote, memoryHighlightReaction, selectedInspirationText],
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

  useEffect(() => {
    if (!memoryHighlightMode || !selectedInspirationText) return;
    const selectedText = selectedInspirationText.text.trim();
    if (selectedText.length < 2) return;
    const signal =
      savedSignalDetail?.id === selectedInspirationText.signalId
        ? savedSignalDetail
        : savedSignals.find((item) => item.id === selectedInspirationText.signalId);
    const matchingHighlight = signal?.highlightedSnippets.find((snippet) => {
      const snippetText = snippet.text.trim();
      const comparableSnippetText = snippetText.replace(/\s+/g, " ");
      const comparableSelectedText = selectedText.replace(/\s+/g, " ");
      return (
        comparableSnippetText === comparableSelectedText ||
        comparableSnippetText.includes(comparableSelectedText) ||
        comparableSelectedText.includes(comparableSnippetText)
      );
    });
    if (matchingHighlight) {
      setSelectedInspirationText(null);
      window.getSelection()?.removeAllRanges();
      void removeMemoryHighlight(selectedInspirationText.signalId, matchingHighlight);
      return;
    }
    void addMemoryHighlight(selectedInspirationText.signalId);
  }, [
    addMemoryHighlight,
    memoryHighlightMode,
    removeMemoryHighlight,
    savedSignalDetail,
    savedSignals,
    selectedInspirationText,
  ]);

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

  const nextEntryInHistory = useMemo(() => {
    if (!selectedId) return null;
    const index = entries.findIndex((entry) => entry.id === selectedId);
    return index >= 0 ? (entries[index + 1] ?? null) : null;
  }, [entries, selectedId]);

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
    return [...entries].reverse().map(entryToCardData);
  }, [entries]);

  const savedInspirationTextById = useMemo(() => {
    return new Map(entries.map((entry) => [entry.id, displayTextForEntry(entry)] as const));
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
      ...(attachment.type === "link" && attachment.url ? { url: attachment.url } : {}),
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
  const allSavedSignals = sortedSignalsNewest(savedSignalRows);
  const inPlaceSignals = applySearchToSignals(allSavedSignals, savedSignalQuery);
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
  const memoryPathFilters = useMemo(() => buildMemoryPathFilters(allSavedSignals, locale), [allSavedSignals, locale]);
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
  const constellationRelationships = buildMemoryConstellationRelationships(inPlaceSignals, topOfMindNotes);
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
            current && (ownRows.some((row) => row.id === current) || selectedSupportingSignalFallback?.id === current)
              ? current
              : null,
          );
        } catch (caught) {
          if (cancelled) return;
          setSavedSignalsError(caught instanceof Error ? caught.message : "Failed to load saved inspirations");
        } finally {
          if (!cancelled) setSavedSignalsLoading(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [homeMode, inspirationFilters.search, selectedSupportingSignalFallback?.id, user]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (!selectedSavedSignalId) {
      setSavedSignalDetail(null);
      return;
    }

    let cancelled = false;
    setSavedSignalDetailLoading(true);
    void (async () => {
      try {
        const detail = await fetchSavedSignalDetail(selectedSavedSignalId);
        if (cancelled) return;
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
        if (cancelled) return;
        setSavedSignalDetail(null);
      } finally {
        if (!cancelled) setSavedSignalDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, savedInspirationTextById, selectedSavedSignalId]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer" || !selectedSavedSignalId) {
      setSavedSignalReflectingId(null);
      setSavedSignalReflectionDraft("");
      setSavedSignalReflectionError(null);
      return;
    }
    if (savedSignalReflections[selectedSavedSignalId]) return;

    let cancelled = false;
    setSavedSignalReflectionLoadingIds((current) => new Set(current).add(selectedSavedSignalId));
    void (async () => {
      try {
        const reflections = await fetchReflections(selectedSavedSignalId);
        if (cancelled) return;
        setSavedSignalReflections((current) => ({
          ...current,
          [selectedSavedSignalId]: mergeReflectionRows(current[selectedSavedSignalId] ?? [], reflections),
        }));
      } catch (error) {
        if (!cancelled) {
          console.error("[home] failed to load saved inspiration reflections:", error);
        }
      } finally {
        if (!cancelled) {
          setSavedSignalReflectionLoadingIds((current) => {
            const next = new Set(current);
            next.delete(selectedSavedSignalId);
            return next;
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeMode, savedSignalReflections, selectedSavedSignalId]);

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

  const showAdminEntry = user?.isAdmin === true && shouldShowAdminEntry(import.meta.env);

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

  const fallbackThoughtCards = [
    ...(topOfMind?.activeQuestions ?? []),
    ...(topOfMind?.activeThemes ?? []),
  ].slice(0, TOP_OF_MIND_NOTE_LIMIT).map(signalToThoughtCard);
  const usesTopOfMindNoteSurface = topOfMindNotes.length > 0 || removedTopOfMindNoteIds.size > 0;
  const thoughtCards = usesTopOfMindNoteSurface
    ? topOfMindNotes.slice(0, TOP_OF_MIND_NOTE_LIMIT).map(noteToThoughtCard)
    : fallbackThoughtCards;
  const meaningfulThoughtCards = uniqueThoughtCards(thoughtCards.filter(isMeaningfulThoughtCard)).slice(0, TOP_OF_MIND_NOTE_LIMIT);
  const displayName = (user.name || user.email.split("@")[0] || "yunji").split(" ")[0];
  const displayHandle = displayName.toLowerCase();
  const copy = HOME_COPY[locale];
  useEffect(() => {
    if (initialLoading || topOfMindLoading || topOfMindNotesLoading) return;
    setHomeMode((current) => (current === "memoryDrawer" ? current : "topOfMind"));
  }, [initialLoading, topOfMindLoading, topOfMindNotesLoading]);

  const chooseHomeMode = (mode: HomeMode) => {
    clearDrawerCloseTimer();
    if (mode === "memoryDrawer") {
      setDrawerClosing(false);
      setSelectedMemoryGroupId(null);
      setSelectedMemoryPathFilterId("all-saved");
      setSelectedSavedSignalId(null);
      setSavedSignalDetail(null);
      setMemoryWindows([]);
      setMemoryGroupDrags({});
      setSeenMemoryGroupIds(new Set());
    } else {
      setDrawerClosing(false);
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

  const closeCaptureFromBackdrop = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && !captureClosing) closeCapture();
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
          correctionText: signal.label,
        },
      }));
    }
  };

  const pinTopOfMindNote = async (signal: HomeThoughtCard) => {
    if (!signal.feedbackTargetId) return;
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
          status: "idle",
          error: null,
          correctionText: prev[signal.id]?.correctionText ?? signal.label,
        },
      }));
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
    if (!signal.feedbackTargetId) return;

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
    setExpandedNoteIndex(null);
    if (deletedNote) showDeletedTopOfMindUndo(deletedNote, signal, previousFeedback);

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
    const currentText = thoughtCardDisplayLabel(signal, locale);
    const draftText = feedbackState?.correctionText ?? currentText;
    const hasEditedText = draftText.trim() !== currentText.trim();
    return (
      <div className="nc-note-actions" role="group" aria-label={copy.reactionGroup}>
        <div className="nc-note-action-buttons">
          <button
            type="button"
            className={`nc-note-control-btn nc-note-control-btn--pin${pinned ? " nc-note-control-btn--pinned" : ""}`}
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation();
              void pinTopOfMindNote(signal);
            }}
          >
            {pinned ? "unpin" : copy.pinCta}
          </button>
          {hasEditedText ? (
            <button
              type="button"
              className="nc-note-control-btn nc-note-control-btn--save"
              disabled={saving || !draftText.trim()}
              onClick={(event) => {
                event.stopPropagation();
                void submitTopOfMindEdit(signal, draftText);
              }}
            >
              {copy.rewriteCta}
            </button>
          ) : null}
          <button
            type="button"
            className="nc-note-control-btn nc-note-control-btn--delete"
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
        ) : feedbackState?.status === "saved" && feedbackState.value !== "important" ? (
          <p className="nc-note-feedback-status">
            {copy.feedbackSaved}
          </p>
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
    const seen = seenMemoryGroupIds.has(group.id);
    const groupIndex = memoryGroupings.findIndex((item) => item.id === group.id);
    const slot = MEMORY_MAP_SLOTS[Math.max(0, groupIndex) % MEMORY_MAP_SLOTS.length];
    const weight = Math.min(1.12, Math.max(0.84, 0.88 + group.signals.length * 0.035));
    const opacity = Math.min(0.82, Math.max(0.44, 0.48 + group.signals.length * 0.055));
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
          ["--popup-top" as string]: "98%",
          ["--popup-left" as string]: "0%",
          ["--popup-translate-y" as string]: "0%",
          ["--popup-translate-x" as string]: "0%",
          ["--popup-origin-y" as string]: "top",
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
            setMemoryFlowIndex(0);
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
            {savedSignalDetailLoading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
            <section>
              <span>saved inspiration</span>
            <p
              className="signal-revisit-raw memory-readable-signal"
              onMouseUp={() => handleMemoryTextSelection(signal.id)}
              onKeyUp={() => handleMemoryTextSelection(signal.id)}
            >
              {renderHighlightedInspirationText(detailText, detailHighlights)}
            </p>
            </section>
            {highlightStatus.status === "error" && selectedInspirationText?.signalId === signal.id ? (
              <p className="signal-revisit-state">{highlightStatus.message}</p>
            ) : null}
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
      (selectedSupportingSignalFallback?.id === selectedSavedSignalId ? selectedSupportingSignalFallback : null)
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
  const selectedDrawerReflectionQuestion =
    savedSignalReflectionQuestions[savedSignalReflectionStepIndex] ??
    savedSignalReflectionFallbackQuestion(locale, savedSignalReflectionStepIndex);
  const selectedDrawerReflectionProgress = `${savedSignalReflectionStepIndex + 1}/${SAVED_SIGNAL_REFLECTION_MAX_STEPS}`;
  const selectedDrawerReflectionCanGoNext =
    selectedDrawerReflectionCanSave &&
    savedSignalReflectionStepIndex < SAVED_SIGNAL_REFLECTION_MAX_STEPS - 1;
  const selectedDrawerReflectionCanFinish =
    savedSignalReflectionAnswers
      .map((answer, index) => (index === savedSignalReflectionStepIndex ? savedSignalReflectionDraft : answer))
      .filter((answer) => answer.trim().length > 0).length > 0;

  const cancelSavedSignalReflection = (): void => {
    setSavedSignalReflectingId(null);
    setSavedSignalReflectionDraft("");
    setSavedSignalReflectionAnswers([]);
    setSavedSignalReflectionQuestions([]);
    setSavedSignalReflectionStepIndex(0);
    setSavedSignalReflectionError(null);
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
    const fallback = savedSignalReflectionFallbackQuestion(locale, stepIndex);
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
        highlights: signal.highlightedSnippets.map((highlight) => highlight.text),
      },
      priorAnswers: answers
        .map((answer, index) => ({
          question: questions[index] ?? savedSignalReflectionFallbackQuestion(locale, index) ?? fallback,
          answer: answer.trim(),
        }))
        .filter((item) => item.answer.length > 0),
    }).then(
      (response) => {
        if (savedSignalReflectionRequestSeqRef.current !== requestId) return;
        setSavedSignalReflectionQuestions((current) => {
          const next = [...current];
          next[stepIndex] = response.question.trim() || fallback;
          return next;
        });
      },
      () => {
        if (savedSignalReflectionRequestSeqRef.current !== requestId) return;
        setSavedSignalReflectionQuestions((current) => {
          const next = [...current];
          next[stepIndex] = fallback;
          return next;
        });
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
    setSelectedInspirationText(null);
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
    } catch (error) {
      console.error("[home] failed to update saved inspiration:", error);
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
          savedSignalReflectionFallbackQuestion(locale, index),
        answer: answer.trim(),
      }))
      .filter((item) => item.answer.length > 0)
      .slice(0, SAVED_SIGNAL_REFLECTION_MAX_STEPS);
    if (payload.length === 0) return;
    setSavedSignalReflectionSaving(true);
    setSavedSignalReflectionError(null);
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
        [signalId]: mergeReflectionRows(current[signalId] ?? [], results.map((result) => result.reflection)),
      }));
      const scorePatch = [...results].reverse().find((result) => result.inspiration)?.inspiration;
      if (scorePatch) {
        setEntries((current) =>
          current.map((entry) => applyInspirationScorePatch(entry, scorePatch)),
        );
      }
      cancelSavedSignalReflection();
    } catch (error) {
      setSavedSignalReflectionError(
        error instanceof Error ? error.message : "Could not save that reflection.",
      );
    } finally {
      setSavedSignalReflectionSaving(false);
    }
  };

  const openStackSignal = (signal: ApiSavedSignalSearchResult): void => {
    setSelectedInspirationText(null);
    setSavedSignalReflectionError(null);
    if (selectedSavedSignalId === signal.id) {
      setSelectedSavedSignalId(null);
      setSavedSignalDetail(null);
      cancelSavedSignalReflection();
      return;
    }
    setSelectedSavedSignalId(signal.id);
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
    setMemoryHighlightMode(false);
    setSelectedInspirationText(null);
    setSavedSignalReflectingId(signal.id);
    setSavedSignalReflectionAnswers([]);
    setSavedSignalReflectionQuestions([savedSignalReflectionFallbackQuestion(locale, 0)]);
    setSavedSignalReflectionStepIndex(0);
    setSavedSignalReflectionDraft("");
    setSavedSignalReflectionError(null);
    window.setTimeout(() => savedSignalReflectionInputRef.current?.focus(), 0);
    recordRevisit(signal.id, "detail_opened");
  };

  const undoDeletedSavedSignal = () => {
    if (!deletedSavedSignalUndo) return;
    if (deletedSavedSignalUndoTimerRef.current !== null) {
      window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
      deletedSavedSignalUndoTimerRef.current = null;
    }
    const { signal, detail } = deletedSavedSignalUndo;
    setSavedSignals((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signal, ...prev]));
    setEntries((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signalToListEntry(signal), ...prev]));
    if (detail) setSavedSignalDetail(detail);
    setSelectedSavedSignalId(signal.id);
    setDeletedSavedSignalUndo(null);
  };

  const deleteSavedSignalFromDrawer = (signal: ApiSavedSignalSearchResult): void => {
    if (deletedSavedSignalUndoTimerRef.current !== null) {
      window.clearTimeout(deletedSavedSignalUndoTimerRef.current);
      deletedSavedSignalUndoTimerRef.current = null;
    }
    const detail = savedSignalDetail?.id === signal.id ? savedSignalDetail : null;
    setDeletedSavedSignalUndo({ signal, detail });
    setSavedSignals((prev) => prev.filter((item) => item.id !== signal.id));
    setEntries((prev) => prev.filter((item) => item.id !== signal.id));
    setSelectedSavedSignalId(null);
    setSavedSignalDetail(null);
    setSelectedInspirationText(null);
    cancelSavedSignalReflection();
    setSavedSignalDrafts((current) => {
      const next = { ...current };
      delete next[signal.id];
      return next;
    });
    deletedSavedSignalUndoTimerRef.current = window.setTimeout(() => {
      void deleteInspiration(signal.id).catch((error) => {
        console.error("[home] failed to delete saved inspiration:", error);
        setSavedSignals((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signal, ...prev]));
        setEntries((prev) => (prev.some((item) => item.id === signal.id) ? prev : [signalToListEntry(signal), ...prev]));
      });
      setDeletedSavedSignalUndo(null);
      deletedSavedSignalUndoTimerRef.current = null;
    }, 4200);
  };


  const renderMemoryStackSignalCard = (signal: ApiSavedSignalSearchResult): JSX.Element => {
    const linkAttachment = signal.attachmentSummary.find((attachment) => attachment.type === "link" && attachment.url);
    const sourceLabel = signalSourceLabel(signal);
    const failedUploadReason = signal.relevanceReasons.find((reason) => reason.includes("failed to upload"));
    const isSelectedSignal = selectedSavedSignalId === signal.id;
    const metaItems = [
      sourceLabel,
      failedUploadReason,
      formatTimestamp(signal.capturedAt),
    ].filter(Boolean);
    const listMetaItems = [
      sourceLabel,
      ...signal.attachmentSummary.slice(0, 2).map((attachment) => attachment.label),
      failedUploadReason,
      formatTimestamp(signal.capturedAt),
    ].filter(Boolean);
    if (isSelectedSignal) {
      const fullDetailReady = savedSignalDetail?.id === signal.id;
      const immediateFullText = savedInspirationTextById.get(signal.id);
      const detailText = fullDetailReady ? savedSignalDetail.rawText : immediateFullText ?? signal.textPreview;
      const draftText = savedSignalDrafts[signal.id] ?? detailText;
      const hasEditedDraft = draftText.trim() !== detailText.trim();
      const detailHighlights = fullDetailReady ? savedSignalDetail.highlightedSnippets : signal.highlightedSnippets;
      const sourceAttachments = fullDetailReady ? savedSignalDetail.attachments : signal.attachmentSummary;
      const reflectionRows = savedSignalReflections[signal.id] ?? [];
      const reflectionsLoading = savedSignalReflectionLoadingIds.has(signal.id);
      const isReflecting = savedSignalReflectingId === signal.id;
      const showHighlightOverlay = !hasEditedDraft && detailHighlights.length > 0;
      return (
        <article
          className="memory-stack-detail memory-stack-detail--mockup signal-revisit-detail signal-revisit-detail--open memory-contents-item memory-contents-item--expanded"
          data-memory-signal-id={signal.id}
          aria-label="opened inspiration"
        >
          <button
            type="button"
            className="memory-workspace-back"
            onClick={() => {
              setSelectedSavedSignalId(null);
              setSavedSignalDetail(null);
              setSelectedInspirationText(null);
              cancelSavedSignalReflection();
            }}
          >
            ← back to all saved
          </button>
          <button
            type="button"
            className="memory-detail-close"
            aria-label="close inspiration detail"
            onClick={() => {
              setSelectedSavedSignalId(null);
              setSavedSignalDetail(null);
              setSelectedInspirationText(null);
              cancelSavedSignalReflection();
            }}
          >
            ×
          </button>
          <header className="memory-detail-hero memory-detail-hero--full-title">
            <h2>{deriveTitleFromText(detailText, locale)}</h2>
          </header>
          {sourceAttachments.length > 0 ? (
            <section className="memory-detail-source-card" aria-label="source">
              {sourceAttachments.map((attachment) => (
                <p key={attachment.id}>
                  {attachment.type === "link" ? "Link" : attachment.type} {attachment.label}{attachment.url ? ` ${attachment.url}` : ""}
                </p>
              ))}
            </section>
          ) : null}
          <button
            type="button"
            className="memory-contents-collapse"
            aria-label="collapse inspiration"
            onClick={() => {
              if (hasEditedDraft) {
                discardSavedSignalEditAndCollapse();
                return;
              }
              setSelectedSavedSignalId(null);
              setSavedSignalDetail(null);
              setSelectedInspirationText(null);
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
            {showHighlightOverlay ? (
              <div
                className="memory-contents-highlight-layer"
                aria-hidden="true"
              >
                {renderHighlightedInspirationText(draftText, detailHighlights)}
              </div>
            ) : null}
            <textarea
              className={`memory-contents-expanded-text memory-contents-expanded-editor memory-readable-signal${
                showHighlightOverlay ? " memory-contents-expanded-editor--with-highlights" : ""
              }`}
              value={draftText}
              onChange={(event) => {
                setSavedSignalDrafts((current) => ({
                  ...current,
                  [signal.id]: event.currentTarget.value,
                }));
              }}
              onMouseUp={(event) => handleMemoryTextareaSelection(signal.id, event.currentTarget)}
              onKeyUp={(event) => handleMemoryTextareaSelection(signal.id, event.currentTarget)}
              role="textbox"
              aria-label="edit saved inspiration"
              aria-multiline="true"
              spellCheck={true}
            />
          </div>
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
            <div className="memory-contents-expanded-actions" aria-label="inspiration actions">
              <button
                type="button"
                className={`memory-contents-secondary-action${
                  memoryHighlightMode ? " memory-contents-secondary-action--active" : ""
                }`}
                aria-pressed={memoryHighlightMode}
                onClick={() => {
                  window.getSelection()?.removeAllRanges();
                  setSelectedInspirationText(null);
                  setMemoryHighlightMode((current) => {
                    const next = !current;
                    if (next) cancelSavedSignalReflection();
                    return next;
                  });
                }}
              >
                {memoryHighlightMode ? "highlighting" : "highlight"}
              </button>
              <button
                type="button"
                className={`memory-contents-secondary-action${
                  isReflecting ? " memory-contents-secondary-action--active" : ""
                }`}
                onClick={() => reflectDeeperOnSavedSignal(signal)}
              >
                {isReflecting ? "Reflecting" : "Reflect Deeper"}
              </button>
              <button
                type="button"
                className="memory-contents-secondary-action memory-contents-secondary-action--quiet"
                onClick={() => deleteSavedSignalFromDrawer(signal)}
              >
                delete
              </button>
            </div>
          </div>
          {isReflecting ? (
            <section className="memory-contents-reflections" aria-label="Reflect Deeper prompt">
              <p className="memory-contents-reflection-question">{selectedDrawerReflectionQuestion}</p>
              <textarea
                ref={savedSignalReflectionInputRef}
                className="reflect-answer"
                value={savedSignalReflectionDraft}
                onChange={(event) => setSavedSignalReflectionDraft(event.target.value)}
                aria-label="Reflect Deeper answer"
              />
              <div className="memory-contents-expanded-actions">
                <button type="button" onClick={() => void saveSavedSignalReflection()}>
                  Save
                </button>
              </div>
              {savedSignalReflectionError ? <p className="memory-contents-reflection-empty">{savedSignalReflectionError}</p> : null}
            </section>
          ) : null}
          {reflectionRows.length > 0 ? (
            <section className="memory-contents-reflections" aria-label="Reflect Deeper analysis">
              <span>Reflect Deeper analysis</span>
              <p>Read against the original inspiration</p>
              {reflectionRows[0]?.answer ? <p>What this reveals: {reflectionRows[0].answer}</p> : null}
              {reflectionRows[reflectionRows.length - 1]?.answer ? (
                <p>A useful next thread: {reflectionRows[reflectionRows.length - 1].answer}</p>
              ) : null}
            </section>
          ) : reflectionsLoading ? (
            <p className="memory-contents-reflection-empty">loading reflections...</p>
          ) : null}
          {sourceAttachments.length > 0 || selectedSupportingSignalFallback?.id === signal.id ? (
            <button type="button" className="memory-detail-next">
              View next inspiration
            </button>
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
        <span className="memory-contents-item-meta">{listMetaItems.join(" · ")}</span>
      </button>
    );
  };

  const renderMemoryPathDrawer = (): JSX.Element => {
    const hasSavedInspirations = allSavedSignals.length > 0;
    const hasMatches = pathFilteredSignals.length > 0;
    const pathCopy = MEMORY_PATH_COPY[locale];
    const activePath = selectedMemoryPathFilter?.displayPath ?? pathCopy.allSavedPath;
    const emptyCopy = !hasSavedInspirations
      ? initialLoading
        ? copy.loadingSaves
        : copy.emptySaves
      : savedSignalQuery
        ? copy.memoryPathNoSearchResults(inspirationFilters.search.trim(), activePath)
        : copy.memoryPathEmpty(activePath);


	    return (
      <div className="memory-category-panel memory-path-panel" aria-label={copy.memoryPathListAria}>
        {renderMemoryPathFilters()}
        <p className="memory-path-summary">
          {selectedMemoryPathFilter?.description ?? pathCopy.inspirationCount(pathFilteredSignals.length)}
          {selectedMemoryPathFilterId === "all-saved" ? ` · ${pathCopy.inspirationCount(pathFilteredSignals.length)}` : ""}
        </p>
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
                  setSelectedMemoryPathFilterId("all-saved");
                  if (savedSignalQuery) setInspirationFilters({ search: "" });
                }}
              >
                {copy.memoryPathClearAll}
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
    const primaryFilterIds = new Set(["all-saved", "highlights", "recently-saved"]);
    const primaryFilters = memoryPathFilters.filter((filter) => primaryFilterIds.has(filter.id));
    const themeFilters = memoryPathFilters.filter((filter) => !primaryFilterIds.has(filter.id));
    const visibleThemeFilters = themeFilters;
    const selectedHiddenTheme = themeFilters.find(
      (filter) =>
        filter.id === selectedMemoryPathFilterId &&
        !visibleThemeFilters.some((visibleFilter) => visibleFilter.id === filter.id),
    );
    const visibleFilters = [
      ...primaryFilters,
      ...visibleThemeFilters,
      ...(selectedHiddenTheme ? [selectedHiddenTheme] : []),
    ];
    const hiddenThemeCount = Math.max(themeFilters.length - visibleThemeFilters.length, 0);
    return (
	      <nav className="memory-path-filters" aria-label={copy.memoryPathNavAria}>
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
              title={`${filter.description} (${count})`}
            >
	              <span>{filter.label}</span>
	              <small>{count}</small>
	            </button>
          );
        })}
        {hiddenThemeCount > 0 ? (
          <button
            type="button"
            className="memory-path-filter memory-path-filter--more"
            onClick={() => setShowAllMemoryPathFilters(true)}
          >
            <span>more themes</span>
            <small>{hiddenThemeCount}</small>
          </button>
        ) : showAllMemoryPathFilters && themeFilters.length > 4 ? (
          <button
            type="button"
            className="memory-path-filter memory-path-filter--more"
            onClick={() => setShowAllMemoryPathFilters(false)}
          >
            <span>fewer themes</span>
          </button>
        ) : null}
      </nav>
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
                {renderHighlightedInspirationText(detailText, detailHighlights)}
              </p>
            </section>
            {highlightStatus.status === "error" && selectedInspirationText?.signalId === signal.id ? (
              <p className="signal-revisit-state">{highlightStatus.message}</p>
            ) : null}
            {(detail?.attachments.length ?? 0) > 0 || signal.attachmentSummary.length > 0 ? (
              <section className="memory-window-context">
                <span>attachment details</span>
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

  // Retired by the anchored stack drawer; keep the old comparison helpers
  // inert until the remaining memory-window state can be removed in one cleanup.
  void setMemoryFolderView;
  void visibleMemoryWindows;
  void renderMemorySignalCard;
  void renderMemoryGroupObject;
  void createUserMemoryGroup;
  void renderMemoryFlow;
  void renderMemoryWindow;

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

  const onNoteKeyDown = (index: number) => (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setExpandedNoteIndex((current) => (current === index ? current : index));
  };

  const closeExpandedNoteOnBackdrop = () => {
    setExpandedNoteIndex(null);
    setExpandedSupportingSignalIds(new Set());
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

  const openSupportingSignalDetail = (support: SupportingThoughtSignal) => {
    const fallbackSignal = fallbackSavedSignalFromSupport(support);
    if (!fallbackSignal) return;
    setSelectedSupportingSignalFallback(fallbackSignal);
    setSelectedMemoryGroupId(null);
    setSelectedMemoryPathFilterId("all-saved");
    setSelectedInspirationText(null);
    setSelectedSavedSignalId(fallbackSignal.id);
    setSavedSignalDetail(supportingSignalDetails[fallbackSignal.id] ?? null);
    setExpandedNoteIndex(null);
    setExpandedSupportingSignalIds(new Set());
    clearDrawerCloseTimer();
    setDrawerClosing(false);
    setHomeMode("memoryDrawer");
    recordRevisit(fallbackSignal.id, "detail_opened");
  };

  const loadSupportingSignalDetail = (signalId: string) => {
    if (supportingSignalDetails[signalId] !== undefined || supportingSignalDetailLoadingIds.has(signalId)) return;
    setSupportingSignalDetailLoadingIds((current) => new Set([...current, signalId]));
    setSupportingSignalDetailErrors((current) => {
      const next = { ...current };
      delete next[signalId];
      return next;
    });
    void fetchSavedSignalDetail(signalId)
      .then((detail) => {
        setSupportingSignalDetails((current) => ({ ...current, [signalId]: detail }));
      })
      .catch(() => {
        setSupportingSignalDetails((current) => ({ ...current, [signalId]: null }));
        setSupportingSignalDetailErrors((current) => ({
          ...current,
          [signalId]: "Couldn’t open this save yet. The preview still stays here.",
        }));
      })
      .finally(() => {
        setSupportingSignalDetailLoadingIds((current) => {
          const next = new Set(current);
          next.delete(signalId);
          return next;
        });
      });
  };

  const toggleSupportingSignal = (signalId: string) => {
    setExpandedSupportingSignalIds((current) => {
      const next = new Set(current);
      if (next.has(signalId)) {
        next.delete(signalId);
      } else {
        next.add(signalId);
        loadSupportingSignalDetail(signalId);
      }
      return next;
    });
  };

  const renderThoughtCard = (signal: HomeThoughtCard, index: number): JSX.Element => {
    const layout = NOTE_LAYOUTS[index] ?? NOTE_LAYOUTS[0];
    const drag = drags[index] ?? { x: 0, y: 0 };
    const pinned = noteFeedback[signal.id]?.value === "important";
    return (
    <article
      className={`nc-note${index === 0 ? " nc-note--featured" : ""}${draggingIndex === index ? " nc-note--dragging" : ""}${pinned ? " nc-note--pinned" : ""}`}
      key={signal.id}
      role="button"
      tabIndex={0}
      aria-label="open post-it reflection"
      style={{
        ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
        ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        ["--tilt" as string]: `${layout.tilt}deg`,
        ["--w" as string]: layout.w,
        ["--dx" as string]: `${drag.x}px`,
        ["--dy" as string]: `${drag.y}px`,
        ["--decay" as string]: String(1 - index * 0.08),
      }}
      onPointerDown={onNotePointerDown(index)}
      onClick={onNoteClick(index)}
      onKeyDown={onNoteKeyDown(index)}
    >
      {pinned ? <span className="nc-note-pin" aria-label="pinned" /> : null}
	      <div className="nc-note-preview" aria-label="post-it preview">
	        <p className="nc-note-body nc-note-body--preview">{thoughtCardPreviewLabel(signal, locale)}</p>
	      </div>
    </article>
  );
  };

  const renderExpandedThoughtCard = (index: number): JSX.Element | null => {
    const signal = meaningfulThoughtCards[index];
    if (!signal) return null;
    const pinned = noteFeedback[signal.id]?.value === "important";
    const supportingCount = signal.supportingSignals.length;
    const hasExpandedSupportingSignal = signal.supportingSignals.some((support) => {
      const supportSignalId = signalIdForSupportingSignal(support);
      return supportSignalId ? expandedSupportingSignalIds.has(supportSignalId) : false;
    });
    return (
      <article
        className={`nc-note-modal${hasExpandedSupportingSignal ? " nc-note-modal--evidence-expanded" : ""}${pinned ? " nc-note-modal--pinned" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`top-of-mind-note-${signal.id}`}
        style={{
          ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
          ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {pinned ? <span className="nc-note-pin nc-note-pin--modal" aria-label="pinned" /> : null}
        <button
          type="button"
          className="nc-note-peel-close"
          aria-label="close post-it reflection"
          onClick={closeExpandedNoteOnBackdrop}
        >
          close
        </button>

        <div className="nc-note-expanded-content">
          <section className="nc-note-peel-hero" aria-label="opened post-it">
            {signal.feedbackTargetId ? (
              <textarea
                className="nc-note-body nc-note-body-edit"
                id={`top-of-mind-note-${signal.id}`}
	                aria-label={copy.correctionLabel}
	                value={
	                  noteFeedback[signal.id]?.correctionText ??
	                  thoughtCardDisplayLabel(signal, locale)
	                }
                rows={3}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  updateCorrectionText(signal.id, event.target.value)
                }
              />
            ) : (
	              <p className="nc-note-body" id={`top-of-mind-note-${signal.id}`}>
	                {thoughtCardDisplayLabel(signal, locale)}
	              </p>
            )}
          </section>

          <section
            className={`nc-note-evidence${hasExpandedSupportingSignal ? " nc-note-evidence--expanded" : ""}`}
            aria-label="inspirations that led here"
          >
            <div className="nc-note-evidence-head">
              <p>inspirations that led here</p>
              <span>
                {supportingCount > 0
                  ? `${supportingCount} saved inspiration${supportingCount === 1 ? "" : "s"} nearby`
                  : "saved inspirations stay private there"}
              </span>
            </div>
            {supportingCount > 0 ? (
              <ul className="nc-note-evidence-list">
                {signal.supportingSignals.map((support) => {
                  const supportSignalId = signalIdForSupportingSignal(support);
                  const isOpen = supportSignalId ? expandedSupportingSignalIds.has(supportSignalId) : false;
                  const detail = supportSignalId ? supportingSignalDetails[supportSignalId] : undefined;
                  const isLoading = supportSignalId ? supportingSignalDetailLoadingIds.has(supportSignalId) : false;
                  const error = supportSignalId ? supportingSignalDetailErrors[supportSignalId] : undefined;
                  return (
                    <li
                      className={`nc-note-evidence-item${isOpen ? " nc-note-evidence-item--expanded" : ""}`}
                      key={`${supportSignalId ?? "missing"}-${support.preview}`}
                    >
                      <div className="nc-note-evidence-actions">
                        <button
                          type="button"
                          className="nc-note-evidence-trigger"
                          aria-expanded={isOpen}
                          aria-controls={`top-of-mind-evidence-${supportSignalId ?? "missing"}`}
                          disabled={!supportSignalId}
                          onClick={() => {
                            if (supportSignalId) toggleSupportingSignal(supportSignalId);
                          }}
                        >
                          <span>{shortText(userFacingCopy(support.preview), 96)}</span>
                          <small>{supportSignalId ? (isOpen ? "hide" : "expand") : "preview"}</small>
                        </button>
                      </div>
                      {isOpen ? (
                        <div className="nc-note-evidence-detail" id={`top-of-mind-evidence-${supportSignalId ?? "missing"}`}>
                          {isLoading ? <p className="nc-note-evidence-muted">Opening this save…</p> : null}
                          {error ? <p className="nc-note-evidence-muted">{error}</p> : null}
                          <p className="nc-note-evidence-full">
                            {userFacingCopy(detail?.rawText || detail?.signalPacket?.text || support.preview)}
                          </p>
                          {supportSignalId ? (
                            <div className="nc-note-evidence-detail-actions">
                              <button
                                type="button"
                                className="nc-note-evidence-open"
                                aria-label="open inspiration"
                                title="Open inspiration"
                                onClick={() => openSupportingSignalDetail(support)}
                              >
                                open
                              </button>
                            </div>
                          ) : null}
                          {support.reason ? <p className="nc-note-evidence-why">{userFacingCopy(support.reason)}</p> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <footer className="nc-note-expanded-foot">
            {renderPostItActions(signal)}
          </footer>
        </div>
      </article>
    );
  };

  return (
    <>
      <BackgroundField />
      <DropOverlay label={copy.dropOverlay} />
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={copy.memoryDrawerTitle}
        detail={historyDetail}
      >
        {historyContent}
      </HistoryPanel>
      {expandedNoteIndex !== null ? (
        <div className="nc-note-overlay" onClick={closeExpandedNoteOnBackdrop}>
          {renderExpandedThoughtCard(expandedNoteIndex)}
        </div>
      ) : null}
      <main
        className={`nc-canvas nc-canvas--top-of-mind${homeMode === "memoryDrawer" ? " nc-canvas--drawer-open" : ""}`}
        data-locale={locale}
      >
        <div className="nc-language-controls" aria-label={copy.homeControlsAria}>
          <Link
            to="/profile"
            className="nc-profile-link nc-lang--top"
            aria-label={t(locale, "profileTitle")}
            title={t(locale, "profileTitle")}
          >
            {t(locale, "profileLink")}
          </Link>
        </div>

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
          {copy.lifecycleHint ? <p className="nc-lifecycle-hint">{copy.lifecycleHint}</p> : null}
        </section>

        <section className="nc-stage nc-stage--top-of-mind-wall" aria-label={copy.topOfMindAria}>
          {topOfMindLoading ? (
            <p className="nc-loading">{copy.loadingThoughts}</p>
          ) : topOfMindError ? (
            <p className="nc-loading">{topOfMindError}</p>
          ) : meaningfulThoughtCards.length > 0 ? (
            meaningfulThoughtCards.map((card, index) => renderThoughtCard(card, index))
          ) : (
            <p className="nc-loading">{copy.emptyThoughts}</p>
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
	        >
          <span className="memory-stack-glass" aria-hidden="true" />
          {selectedMemoryGroup ? (
            <div className="memory-contents-flow" aria-label="grouping contents">
              <button
                type="button"
                className="memory-contents-back"
                onClick={() => {
                  setSelectedMemoryGroupId(null);
                  setSelectedSavedSignalId(null);
                  setSavedSignalDetail(null);
                }}
              >
                ← back to map
              </button>
              {selectedMemoryGroup.source === "user" ? (
                <label className="memory-contents-rename">
                  <span className="sr-only">name this collection</span>
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
          ) : selectedDrawerSignal ? (
            renderMemoryStackSignalCard(selectedDrawerSignal)
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
        className={`nc-bottom-bar${homeMode === "memoryDrawer" ? " nc-bottom-bar--drawer" : ""}`}
        data-locale={locale}
        aria-label={copy.bottomActionsAria}
      >
        <div
          className={`nc-primary-action${
            homeMode === "memoryDrawer" &&
            !deletedSavedSignalUndo &&
            !selectedDrawerHasEdit &&
            !selectedDrawerIsReflecting
              ? " nc-primary-action--search"
              : ""
          }${
            homeMode === "memoryDrawer" && selectedDrawerHasEdit && !deletedSavedSignalUndo
              ? " nc-primary-action--save"
              : ""
          }${
            selectedDrawerIsReflecting && !deletedSavedSignalUndo && !selectedDrawerHasEdit
              ? " nc-primary-action--reflect"
              : ""
          }${
            (deletedTopOfMindUndo && homeMode !== "memoryDrawer") ||
            (deletedSavedSignalUndo && homeMode === "memoryDrawer")
              ? " nc-primary-action--undo"
              : ""
          }`}
        >
          <button
            type="button"
            className={`nc-save${captureSaved ? " nc-save--saved" : ""}${
              (deletedTopOfMindUndo && homeMode !== "memoryDrawer") ||
              (deletedSavedSignalUndo && homeMode === "memoryDrawer")
                ? " nc-save--undo"
                : homeMode === "memoryDrawer" && selectedDrawerHasEdit
                  ? " nc-save--save"
                : ""
            }`}
            onClick={
              deletedSavedSignalUndo && homeMode === "memoryDrawer"
                ? undoDeletedSavedSignal
                : homeMode === "memoryDrawer" && selectedDrawerHasEdit
                  ? () => void saveEditedSavedSignal()
                : deletedTopOfMindUndo && homeMode !== "memoryDrawer"
                  ? undoDeletedTopOfMindNote
                  : openCapture
            }
            aria-label={
              deletedSavedSignalUndo && homeMode === "memoryDrawer"
                ? copy.undoDeletedInspiration
                : homeMode === "memoryDrawer" && selectedDrawerHasEdit
                  ? copy.saveEditedInspiration
                : deletedTopOfMindUndo && homeMode !== "memoryDrawer"
                ? copy.undoDeletedSticky
                : copy.captureAria
            }
            tabIndex={homeMode === "memoryDrawer" && !deletedSavedSignalUndo && !selectedDrawerHasEdit ? -1 : undefined}
            aria-hidden={
              homeMode === "memoryDrawer" &&
              !deletedSavedSignalUndo &&
              !selectedDrawerHasEdit
                ? "true"
                : undefined
            }
            disabled={homeMode === "memoryDrawer" && selectedDrawerHasEdit && savedSignalEditSaving}
          >
            <span className="nc-save-cta">
              {deletedSavedSignalUndo && homeMode === "memoryDrawer"
                ? copy.undoDeletedInspiration
                : homeMode === "memoryDrawer" && selectedDrawerHasEdit
                  ? savedSignalEditSaving
                    ? copy.saving
                    : copy.saveEdit
                : deletedTopOfMindUndo && homeMode !== "memoryDrawer"
                ? copy.undoDeletedSticky
                : captureSaved
                  ? t(locale, "saved")
                  : copy.captureCta}
              {homeMode !== "memoryDrawer" && !deletedTopOfMindUndo && !captureSaved && captureHasDraft ? (
                <span className="nc-save-draft">(draft)</span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            className="nc-edit-cancel"
            onClick={cancelSavedSignalEdit}
            aria-label={copy.cancelEdit}
            tabIndex={homeMode === "memoryDrawer" && selectedDrawerHasEdit ? undefined : -1}
            aria-hidden={homeMode === "memoryDrawer" && selectedDrawerHasEdit ? undefined : "true"}
          >
            {copy.cancelEdit}
          </button>
          <label
            className={`nc-drawer-search${drawerClosing ? " nc-drawer-search--closing" : ""}`}
            aria-hidden={homeMode === "memoryDrawer" ? undefined : "true"}
          >
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
              disabled={
                homeMode !== "memoryDrawer" ||
                selectedDrawerHasEdit ||
                Boolean(deletedSavedSignalUndo) ||
                selectedDrawerIsReflecting
              }
              tabIndex={
                homeMode === "memoryDrawer" &&
                !selectedDrawerHasEdit &&
                !deletedSavedSignalUndo &&
                !selectedDrawerIsReflecting
                  ? undefined
                  : -1
              }
            />
          </label>
          <form
            className="nc-drawer-reflect"
            aria-hidden={selectedDrawerIsReflecting ? undefined : "true"}
            onSubmit={(event) => {
              event.preventDefault();
              void saveSavedSignalReflection();
            }}
          >
            <div className="nc-drawer-reflect-question">
              <span>{selectedDrawerReflectionProgress}</span>
              <p>{selectedDrawerReflectionQuestion}</p>
            </div>
            <textarea
              ref={savedSignalReflectionInputRef}
              value={savedSignalReflectionDraft}
              onChange={(event) => {
                setSavedSignalReflectionDraft(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
              }}
              placeholder={copy.reflectionAnswerPlaceholder}
              disabled={!selectedDrawerIsReflecting || savedSignalReflectionSaving}
              tabIndex={selectedDrawerIsReflecting ? undefined : -1}
              rows={1}
            />
            <div className="nc-drawer-reflect-actions">
              <button
                type="button"
                onClick={goToPreviousSavedSignalReflection}
                disabled={
                  !selectedDrawerIsReflecting ||
                  savedSignalReflectionSaving ||
                  savedSignalReflectionStepIndex === 0
                }
                tabIndex={selectedDrawerIsReflecting ? undefined : -1}
              >
                {copy.previous}
              </button>
              <button
                type="button"
                onClick={goToNextSavedSignalReflection}
                disabled={
                  !selectedDrawerIsReflecting ||
                  !selectedDrawerReflectionCanGoNext ||
                  savedSignalReflectionSaving
                }
                tabIndex={selectedDrawerIsReflecting ? undefined : -1}
              >
                {copy.next}
              </button>
              <button
                type="submit"
                disabled={
                  !selectedDrawerIsReflecting ||
                  !selectedDrawerReflectionCanFinish ||
                  savedSignalReflectionSaving
                }
                tabIndex={selectedDrawerIsReflecting ? undefined : -1}
              >
                {savedSignalReflectionSaving ? copy.saving : copy.save}
              </button>
              <button
                type="button"
                onClick={cancelSavedSignalReflection}
                disabled={!selectedDrawerIsReflecting}
                tabIndex={selectedDrawerIsReflecting ? undefined : -1}
              >
                {copy.cancel}
              </button>
            </div>
            {savedSignalReflectionError ? (
              <span className="nc-drawer-reflect-error">{savedSignalReflectionError}</span>
            ) : null}
          </form>
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
            aria-label={homeMode === "memoryDrawer" ? copy.backHome : `${copy.drawerObjectBody}: ${copy.savesTitle}`}
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
            <span className="sr-only">{homeMode === "memoryDrawer" ? copy.backHome : copy.drawerObjectTitle}</span>
            <small className="sr-only">{formatSavedCount(locale, entries.length)}</small>
          </button>
        ) : null}
          {homeMode !== "memoryDrawer" ? (
            <p className="nc-bottom-hint">{copy.bottomHint}</p>
          ) : null}
        </div>

      {selectedInspirationText ? (
        <div
          className="memory-highlight-popover memory-highlight-popover--selection"
          style={{
            ["--memory-highlight-top" as string]: "74px",
            ["--memory-highlight-left" as string]: "80px",
          }}
        >
          <span>{selectedInspirationText.text}</span>
          {memoryHighlightReaction ? (
            <>
              <input
                value={memoryHighlightNote}
                onChange={(event) => setMemoryHighlightNote(event.target.value)}
                aria-label="highlight note"
              />
              <button type="button" onClick={() => void addMemoryHighlight(selectedInspirationText.signalId)}>
                save
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setMemoryHighlightReaction("taste")}>
              taste
            </button>
          )}
          <button type="button" onClick={() => setSelectedInspirationText(null)}>
            note
          </button>
        </div>
      ) : null}
      {savedSignalDetail?.highlightedSnippets[0] ? (
        <div className="memory-highlight-popover memory-highlight-popover--saved">
          <button type="button">edit reaction</button>
          <button type="button">expand note</button>
          <button type="button" onClick={() => void removeMemoryHighlight(savedSignalDetail.id, savedSignalDetail.highlightedSnippets[0])}>
            remove
          </button>
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
          onClick={closeCaptureFromBackdrop}
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
      {showAdminEntry ? (
        <Link
          to="/admin"
          className="admin-entry-pill"
          aria-label={copy.adminInspectionAria}
          title={copy.adminInspectionTitle}
        >
          {copy.adminInspectionLabel}
        </Link>
      ) : null}
    </>
  );
}

export default HomePage;
