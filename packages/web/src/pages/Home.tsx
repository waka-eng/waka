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
  type ApiInspirationScorePatch,
  type ApiSavedSignalDetail,
  type ApiSavedSignalSearchResult,
  type ApiTopOfMind,
  type ApiTopOfMindNoteSurface,
  type ApiTopOfMindSignal,
  type ClusterKind,
  createFeedback,
  fetchSavedSignalDetail,
  fetchSavedSignals,
  fetchInspirations,
  fetchTopOfMind,
  fetchTopOfMindNotes,
  recordInspirationRevisit,
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
type TopOfMindFeedbackValue = Extract<
  ApiFeedbackValue,
  "true" | "partly" | "not_true"
>;
type TopOfMindFeedbackAction = TopOfMindFeedbackValue | "rewrite";
type FeedbackStatus = "idle" | "saving" | "saved" | "error";
type MemoryMovementLabel =
  | "keeps returning"
  | "newly forming"
  | "came back"
  | "fading"
  | "tension"
  | "needs testing";

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
  if (kind === "image") return "Image signal";
  if (kind === "link") return "Link signal";
  if (kind === "mixed") return "Mixed signal";
  return "Untitled signal";
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

interface InspirationDiscoveryFilters {
  search: string;
}

type MemoryDrawerLens =
  | "all"
  | "still_alive"
  | "changed_shape"
  | "returning"
  | "older_self"
  | "keeps_returning"
  | "tensions";

const DEFAULT_INSPIRATION_FILTERS: InspirationDiscoveryFilters = {
  search: "",
};

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
    label: note.ambientSignal || note.title,
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

const MEMORY_DRAWER_LENSES: Array<{ id: MemoryDrawerLens; label: string }> = [
  { id: "all", label: "all" },
  { id: "still_alive", label: "still alive" },
  { id: "changed_shape", label: "changed shape" },
  { id: "returning", label: "forgotten but returning" },
  { id: "older_self", label: "older version of me" },
  { id: "keeps_returning", label: "keeps coming back" },
  { id: "tensions", label: "tensions" },
];

function memoryMovementForThoughtCard(signal: HomeThoughtCard, index: number): MemoryMovementLabel {
  if (signal.status === "stale" || signal.status === "replaced") return "fading";
  if (signal.type === "tension" || signal.ambitionDimension === "tension") return "tension";
  if (signal.type === "question" || signal.type === "hypothesis" || signal.ambitionDimension === "next_experiment") {
    return "needs testing";
  }
  if ((signal.supportingSignals.length >= 3 || (signal.confidence ?? 0) >= 0.8) && index < 2) {
    return "keeps returning";
  }
  if (signal.supportingSignals.some((support) => Date.now() - new Date(support.createdAt).getTime() > 1000 * 60 * 60 * 24 * 30)) {
    return "came back";
  }
  return "newly forming";
}

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

function memoryDrawerSectionForSignal(signal: ApiSavedSignalSearchResult): MemoryDrawerLens {
  const haystack = signalTextHaystack(signal);
  if (haystack.includes("tension") || haystack.includes("bothers") || haystack.includes("not anymore")) {
    return "tensions";
  }
  if (signal.relatedTopOfMindNoteTitles.length > 0 || signal.signalScores.recurrence >= 6) {
    return "keeps_returning";
  }
  if (signal.highlightedSnippets.length > 0 || signal.resonanceScore >= 7) {
    return "still_alive";
  }
  if (signalAgeDays(signal) >= 45) {
    return "older_self";
  }
  if (signal.relatedContextTerms.length > 0 || signal.matchingSnippets.length > 0) {
    return "returning";
  }
  return "changed_shape";
}

function memoryDrawerSectionLabel(section: MemoryDrawerLens): string {
  return MEMORY_DRAWER_LENSES.find((lens) => lens.id === section)?.label ?? section.replace(/_/g, " ");
}

function memoryDrawerSectionDescription(section: MemoryDrawerLens): string {
  if (section === "still_alive") return "signals that still have heat when you touch them again";
  if (section === "changed_shape") return "saved moments whose meaning is allowed to move";
  if (section === "returning") return "fragments that went quiet and are starting to reappear";
  if (section === "older_self") return "older saves from a version of you worth meeting gently";
  if (section === "keeps_returning") return "patterns that keep writing their way back to the five post-its";
  if (section === "tensions") return "live contradictions WAKA should not smooth away";
  return "everything in the drawer";
}

function replaceabilityLine(label: MemoryMovementLabel): string {
  if (label === "keeps returning") return "still here because the evidence keeps returning";
  if (label === "came back") return "came back after going quiet";
  if (label === "fading") return "may be replaced if new signals stop supporting it";
  if (label === "tension") return "kept visible until the tension changes shape";
  if (label === "needs testing") return "not final; asks for a small test";
  return "newly forming; changed by new signals";
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
    feedbackLabels: {
      true: "true",
      partly: "partly",
      not_true: "not this",
      rewrite: "rewrite in my words",
    },
    reactionGroup: "How does this land",
    correctionLabel: "optional correction",
    correctionPlaceholder: "what should this post-it know instead?",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not save feedback",
    loadingThoughts: "생각이 모이는 중...",
    emptyThoughts: "신호가 쌓이면 여기에 생각이 나타납니다.",
    captureTitle: "첫 신호를 붙잡기",
    captureBody: "가볍게 남겨도 됩니다. 무엇이 걸렸는지만 붙잡으면, WAKA가 나중에 공명과 반복을 찾아냅니다.",
    captureInlineKicker: "signal capture",
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
    searchLabel: "search",
    searchPlaceholder: "저장본 검색",
    loadingSaves: "저장본을 불러오는 중...",
    emptySaves: "아직 저장된 신호가 없습니다.",
    captureAria: "capture signal",
    captureCta: "capture signal",
    captureHint: () => "",
    captureDialog: "capture signal",
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
    feedbackLabels: {
      true: "true",
      partly: "partly",
      not_true: "not this",
      rewrite: "rewrite in my words",
    },
    reactionGroup: "How does this land",
    correctionLabel: "optional correction",
    correctionPlaceholder: "what should this post-it know instead?",
    feedbackSaved: "saved",
    feedbackSaving: "saving...",
    feedbackError: "could not save feedback",
    loadingThoughts: "gathering what is top of mind...",
    emptyThoughts: "When signals gather, provisional notes will appear here.",
    captureTitle: "Catch the first signals",
    captureBody: "No tagging, journaling, or organizing. Save what hit, and WAKA will start noticing resonance and recurrence.",
    captureInlineKicker: "signal capture",
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
    searchLabel: "search",
    searchPlaceholder: "search saved signals",
    loadingSaves: "loading saved signals...",
    emptySaves: "no signals saved yet.",
    captureAria: "capture signal",
    captureCta: "capture signal",
    captureHint: () => "",
    captureDialog: "capture signal",
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
    feedbackLabels: Record<TopOfMindFeedbackAction, string>;
    reactionGroup: string;
    correctionLabel: string;
    correctionPlaceholder: string;
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
  const [memoryDrawerLens, setMemoryDrawerLens] = useState<MemoryDrawerLens>("all");
  const [captureFocused, setCaptureFocused] = useState(false);
  const [captureSaveFlash, setCaptureSaveFlash] = useState(false);
  const [captureView] = useState<CaptureView>("note");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<HomeMode>("topOfMind");
  const [homeModeChosen, setHomeModeChosen] = useState(false);
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
  const [drags, setDrags] = useState<Record<number, { x: number; y: number }>>({});
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [expandedNoteIndex, setExpandedNoteIndex] = useState<number | null>(null);
  const [savedSignals, setSavedSignals] = useState<ApiSavedSignalSearchResult[]>([]);
  const [savedSignalsLoading, setSavedSignalsLoading] = useState(false);
  const [savedSignalsError, setSavedSignalsError] = useState<string | null>(null);
  const [selectedSavedSignalId, setSelectedSavedSignalId] = useState<string | null>(null);
  const [savedSignalDetail, setSavedSignalDetail] = useState<ApiSavedSignalDetail | null>(null);
  const [savedSignalDetailLoading, setSavedSignalDetailLoading] = useState(false);
  const [savedSignalFeedback, setSavedSignalFeedback] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; label: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [savedSignalChangeText, setSavedSignalChangeText] = useState("");
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
  const dragMovedRef = useRef(false);
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
  const inPlaceSignals = searchedSignals.filter(
    (signal) =>
      memoryDrawerLens === "all" || memoryDrawerSectionForSignal(signal) === memoryDrawerLens,
  );
  const memoryDrawerSections = MEMORY_DRAWER_LENSES.filter((section) => section.id !== "all")
    .map((section) => ({
      ...section,
      description: memoryDrawerSectionDescription(section.id),
      signals: inPlaceSignals.filter((signal) => memoryDrawerSectionForSignal(signal) === section.id),
    }))
    .filter((section) => section.signals.length > 0);

  const selectedSavedSignal = useMemo(() => {
    return inPlaceSignals.find((signal) => signal.id === selectedSavedSignalId) ?? inPlaceSignals[0] ?? null;
  }, [inPlaceSignals, selectedSavedSignalId]);

  useEffect(() => {
    if (homeMode !== "memoryDrawer") return;
    if (inPlaceSignals.length === 0) {
      if (selectedSavedSignalId !== null) setSelectedSavedSignalId(null);
      return;
    }
    if (!selectedSavedSignalId || !inPlaceSignals.some((signal) => signal.id === selectedSavedSignalId)) {
      setSelectedSavedSignalId(inPlaceSignals[0].id);
    }
  }, [homeMode, inPlaceSignals, selectedSavedSignalId]);

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
          setSelectedSavedSignalId((current) => current ?? ownRows[0]?.id ?? null);
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
    setSavedSignalFeedback({ status: "idle" });
    setSavedSignalChangeText("");
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
  const thoughtCards = topOfMindNotes.length > 0
    ? topOfMindNotes.slice(0, TOP_OF_MIND_NOTE_LIMIT).map(noteToThoughtCard)
    : fallbackThoughtCards;
  const meaningfulThoughtCards = thoughtCards.filter(isMeaningfulThoughtCard);
  const displayName = (user.name || user.email.split("@")[0] || "yunji").split(" ")[0];
  const displayHandle = displayName.toLowerCase();
  const dateLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const copy = HOME_COPY[locale];

  useEffect(() => {
    if (homeModeChosen || initialLoading || topOfMindLoading || topOfMindNotesLoading) return;
    setHomeMode("topOfMind");
  }, [
    homeModeChosen,
    initialLoading,
    topOfMindLoading,
    topOfMindNotesLoading,
  ]);

  const chooseHomeMode = (mode: HomeMode) => {
    setHomeMode(mode);
    setHomeModeChosen(true);
  };

  const feedbackValues: TopOfMindFeedbackValue[] = [
    "true",
    "partly",
    "not_true",
  ];

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

  const submitTopOfMindFeedback = async (
    signal: HomeThoughtCard,
    value: TopOfMindFeedbackValue,
  ) => {
    if (!signal.feedbackTargetId) return;

    const previousNotes = topOfMindNotes;
    const previousFeedback = noteFeedback[signal.id] ?? {
      value: null,
      status: "idle" as FeedbackStatus,
      error: null,
      correctionText: "",
    };
    const correctionText = previousFeedback.correctionText.trim();

    setNoteFeedback((prev) => ({
      ...prev,
      [signal.id]: {
        value,
        status: "saving",
        error: null,
        correctionText: prev[signal.id]?.correctionText ?? "",
      },
    }));

    setTopOfMindNotes((prev) =>
      prev.map((note) =>
        note.id === signal.feedbackTargetId
          ? {
              ...note,
              status: value === "not_true" ? "stale" : note.status,
              confidence:
                value === "true"
                  ? Math.min(100, note.confidence + 4)
                  : value === "not_true"
                    ? Math.max(0, note.confidence - 12)
                    : note.confidence,
            }
          : note,
      ),
    );

    try {
      await createFeedback({
        targetType: "top_of_mind_note",
        targetId: signal.feedbackTargetId,
        value,
        ...(correctionText ? { correctionText } : {}),
      });
      setNoteFeedback((prev) => ({
        ...prev,
        [signal.id]: {
          value,
          status: "saved",
          error: null,
          correctionText: prev[signal.id]?.correctionText ?? "",
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

  const submitSavedSignalFeedback = async (value: ApiFeedbackValue, label: string) => {
    const targetId = savedSignalDetail?.id ?? selectedSavedSignal?.id;
    if (!targetId) return;
    setSavedSignalFeedback({ status: "saving" });
    try {
      await createFeedback({
        targetType: "signal",
        targetId,
        value,
        ...(savedSignalChangeText.trim()
          ? { correctionText: savedSignalChangeText.trim() }
          : {}),
      });
      setSavedSignalFeedback({ status: "saved", label });
    } catch (caught) {
      setSavedSignalFeedback({
        status: "error",
        message: caught instanceof Error ? caught.message : "Feedback did not save",
      });
    }
  };

  const packetSummary = (packetText: string): string => {
    return packetText
      .split("\n")
      .filter((line) => !line.startsWith("waka.signal_packet"))
      .join(" ")
      .replace(/^[A-Z_]+:\s*/, "")
      .trim();
  };

  const renderFeedbackControls = (
    signal: HomeThoughtCard,
    options: { expanded?: boolean } = {},
  ): JSX.Element | null => {
    if (!signal.feedbackTargetId) return null;
    const feedbackState = noteFeedback[signal.id];
    const saving = feedbackState?.status === "saving";
    return (
      <div
        className={`nc-note-feedback${options.expanded ? " nc-note-feedback--expanded" : ""}`}
        role="group"
        aria-label={copy.reactionGroup}
      >
        <div className="nc-note-feedback-options">
          {[...feedbackValues, ...(options.expanded ? (["rewrite"] as const) : [])].map((action) => {
            const value: TopOfMindFeedbackValue = action === "rewrite" ? "partly" : action;
            const active = feedbackState?.value === value;
            return (
              <button
                key={action}
                type="button"
                className={`nc-note-feedback-btn${active ? " nc-note-feedback-btn--active" : ""}`}
                aria-pressed={active}
                disabled={saving}
                onClick={(event) => {
                  event.stopPropagation();
                  void submitTopOfMindFeedback(signal, value);
                }}
              >
                {copy.feedbackLabels[action]}
              </button>
            );
          })}
        </div>
        {options.expanded ? (
          <label className="nc-note-correction" onClick={(event) => event.stopPropagation()}>
            <span>{copy.correctionLabel}</span>
            <textarea
              value={feedbackState?.correctionText ?? ""}
              placeholder={copy.correctionPlaceholder}
              rows={2}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                updateCorrectionText(signal.id, event.target.value)
              }
            />
          </label>
        ) : null}
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

  const renderThoughtCard = (signal: HomeThoughtCard, index: number): JSX.Element => {
    const source = signal.supportingSignals[0];
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

      <div className="nc-note-reveal">
        <div className="nc-note-evidence">
          <span className="nc-note-evidence-label">ambition signal</span>
          <p className="nc-note-evidence-quote">
            "{shortText(source?.preview || signal.reason, 120)}"
          </p>
        <span className="nc-note-evidence-source">
            — {signal.ambitionDimension?.replace(/_/g, " ") ?? meaningTypeLabel(signal.type)}
          </span>
        </div>
      </div>
      {renderFeedbackControls(signal)}
    </article>
  );
  };

  const renderExpandedThoughtCard = (index: number): JSX.Element | null => {
    const signal = meaningfulThoughtCards[index];
    if (!signal) return null;
    const memoryMovement = memoryMovementForThoughtCard(signal, index);
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
            <span className="nc-note-title">no. {String(index + 1).padStart(2, "0")}</span>
            <span className="nc-note-shifted">{memoryMovement}</span>
          </div>
          <p>peeled open from the current five post-its</p>
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
                <span>memory movement</span>
                <strong id={`top-of-mind-frequency-${signal.id}`}>
                  {memoryMovement}
                </strong>
              </div>
              <dl className="nc-note-frequency-list">
                <div>
                  <dt>why it is here now</dt>
                  <dd>{replaceabilityLine(memoryMovement)}.</dd>
                </div>
                <div>
                  <dt>what this points toward</dt>
                  <dd>{signal.matchedEnvironment ?? "WAKA is still inferring the surrounding signal."}</dd>
                </div>
                <div>
                  <dt>what it rejects</dt>
                  <dd>{signal.antiEnvironment ?? "No rejected context has surfaced clearly yet."}</dd>
                </div>
                <div>
                  <dt>what changed recently</dt>
                  <dd>{signal.evidenceRationale ?? "This read is provisional and should be corrected if it misses."}</dd>
                </div>
                <div>
                  <dt>rejected alternate read</dt>
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
              Feedback on this post-it trains the {signal.ambitionDimension?.replace(/_/g, " ") ?? "ambition"} read,
              not just the graph claim underneath it.
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
            {renderFeedbackControls(signal, { expanded: true })}
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
        <header className="nc-topbar">
          <div className="nc-topleft">
            <div className="nc-mode" role="tablist" aria-label="home mode">
            <button
              type="button"
              className={`nc-mode-btn${homeMode === "topOfMind" ? " nc-mode-btn--active" : ""}`}
              onClick={() => chooseHomeMode("topOfMind")}
            >
              {copy.thoughtTab}
            </button>
            <button
              type="button"
              className={`nc-mode-btn${homeMode === "memoryDrawer" ? " nc-mode-btn--active" : ""}`}
              onClick={() => chooseHomeMode("memoryDrawer")}
            >
              {copy.savesTab} ({entries.length})
            </button>
            </div>
          </div>
          <span className="nc-meta">{dateLabel}</span>
          <div className="nc-topright">
            <div className="nc-lang" aria-label="language">
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
          </div>
        </header>

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
                meaningfulThoughtCards.map((card, index) => renderThoughtCard(card, index))
              ) : (
                <p className="nc-loading">{copy.emptyThoughts}</p>
              )}
            </section>

            <footer className="nc-footnote">
              <p>{copy.footnote(displayHandle)}</p>
              <p className="nc-footnote-credit">{copy.footnoteCredit}</p>
            </footer>
          </>
        ) : (
          <section className="reference-saves-page signal-revisit-page" aria-label={copy.savesTitle}>
            <header className="signal-revisit-header">
              <div>
                <span>{PRODUCT_SPACES.memoryDrawer}</span>
                <h2>Return to what once moved you.</h2>
                <p>This is the drawer beneath the post-its: saved moments first, search only when you need it.</p>
              </div>
              <details className="signal-revisit-search">
                <summary>advanced search</summary>
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

            <div className="signal-revisit-layout">
              <div className="signal-memory-lenses" aria-label="memory drawer sections">
                {MEMORY_DRAWER_LENSES.map((lens) => (
                  <button
                    key={lens.id}
                    type="button"
                    className={memoryDrawerLens === lens.id ? "is-active" : ""}
                    aria-pressed={memoryDrawerLens === lens.id}
                    onClick={() => {
                      setMemoryDrawerLens(lens.id);
                      setSelectedSavedSignalId(null);
                      setSavedSignalDetail(null);
                    }}
                  >
                    {lens.label}
                  </button>
                ))}
              </div>

              <div className="signal-memory-shelves" aria-label="memory sections">
                {savedSignalsError ? <p>{savedSignalsError}</p> : null}
                {savedSignalsLoading && inPlaceSignals.length === 0 ? <p>{copy.loadingSaves}</p> : null}
                {!savedSignalsError && !savedSignalsLoading && inPlaceSignals.length === 0 ? (
                  <p>{initialLoading ? copy.loadingSaves : copy.emptySaves}</p>
                ) : null}
                {memoryDrawerSections.map((section) => (
                  <section key={section.id} className="signal-memory-section">
                    <header>
                      <div>
                        <span>{section.label}</span>
                        <p>{section.description}</p>
                      </div>
                      <strong>{section.signals.length}</strong>
                    </header>
                    <div className="reference-save-list signal-revisit-list">
                      {section.signals.map((signal) => (
                        <button
                          type="button"
                          key={signal.id}
                          onClick={() => {
                            setSelectedSavedSignalId(signal.id);
                            recordRevisit(signal.id, "detail_opened");
                          }}
                          className={`reference-save signal-revisit-card${
                            selectedSavedSignal?.id === signal.id ? " signal-revisit-card--selected" : ""
                          }`}
                        >
                          <span>{formatTimestamp(signal.capturedAt)}</span>
                          <strong>{shortText(signal.textPreview, 280)}</strong>
                          {signal.highlightedSnippets[0] ? (
                            <blockquote>{shortText(signal.highlightedSnippets[0].text, 150)}</blockquote>
                          ) : null}
                          <div className="signal-revisit-card-tags">
                            <span>{memoryDrawerSectionLabel(memoryDrawerSectionForSignal(signal))}</span>
                            {[...signal.relevanceReasons, ...signal.relatedContextTerms].slice(0, 2).map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                          {signal.attachmentSummary.map((attachment) => (
                            <span
                              key={attachment.id}
                              className={attachment.type === "link" ? "reference-save-link" : "reference-save-attachment"}
                            >
                              {attachment.label}
                            </span>
                          ))}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <article className="signal-revisit-detail signal-revisit-detail--open" aria-label="signal revisit">
                {savedSignalDetailLoading ? <p className="signal-revisit-state">Opening the signal...</p> : null}
                {!savedSignalDetailLoading && selectedSavedSignal ? (
                  <>
                    <header>
                      <span>
                        {memoryDrawerSectionLabel(memoryDrawerSectionForSignal(selectedSavedSignal))} ·{" "}
                        {formatTimestamp(selectedSavedSignal.capturedAt)}
                      </span>
                      <h3>{shortText(savedSignalDetail?.rawText ?? selectedSavedSignal.textPreview, 180)}</h3>
                      <p>
                        A saved signal opened from the drawer, not a database record. The question is what it
                        meant then, what it means now, and whether it still feels like you.
                      </p>
                    </header>

                    <section>
                      <span>original signal</span>
                      <p className="signal-revisit-raw">{savedSignalDetail?.rawText ?? selectedSavedSignal.textPreview}</p>
                    </section>

                    <section>
                      <span>what once hit · highlighted part</span>
                      {(savedSignalDetail?.highlightedSnippets ?? selectedSavedSignal.highlightedSnippets).length > 0 ? (
                        <ul className="signal-revisit-highlights">
                          {(savedSignalDetail?.highlightedSnippets ?? selectedSavedSignal.highlightedSnippets)
                            .slice(0, 3)
                            .map((snippet) => (
                              <li key={snippet.id}>
                                <blockquote>{snippet.text}</blockquote>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p>No highlight yet. The whole signal can still be the part worth returning to.</p>
                      )}
                    </section>

                    <section>
                      <span>emotional pull at capture time</span>
                      <p>
                        {selectedSavedSignal.relevanceReasons.length > 0
                          ? selectedSavedSignal.relevanceReasons.join(" · ")
                          : selectedSavedSignal.resonanceScore > 0
                            ? `resonance ${Math.round(selectedSavedSignal.resonanceScore)}`
                            : "No explicit pull was named then. Revisit feedback can teach WAKA what it was."}
                      </p>
                    </section>

                    {(savedSignalDetail?.attachments.length ?? 0) > 0 || selectedSavedSignal.attachmentSummary.length > 0 ? (
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
                            : selectedSavedSignal.attachmentSummary
                          ).map((attachment) => (
                            <li key={attachment.id}>
                              <strong>{attachment.label}</strong>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <section>
                      <span>what it may reveal now</span>
                      {savedSignalDetail?.signalPacket ? (
                        <p>{shortText(packetSummary(savedSignalDetail.signalPacket.text), 360)}</p>
                      ) : (
                        <p>WAKA has not written a signal packet for this yet.</p>
                      )}
                    </section>

                    <section>
                      <span>related context</span>
                      {(savedSignalDetail?.relatedContextNodes ?? []).length > 0 ? (
                        <ul className="signal-revisit-notes">
                          {savedSignalDetail!.relatedContextNodes.slice(0, 3).map((node) => (
                            <li key={node.id}>
                              <strong>{node.label}</strong>
                              <p>{node.evidenceReason || node.description}</p>
                            </li>
                          ))}
                        </ul>
                      ) : selectedSavedSignal.relatedContextTerms.length > 0 ? (
                        <ul className="signal-revisit-notes">
                          {selectedSavedSignal.relatedContextTerms.slice(0, 3).map((term) => (
                            <li key={term}>
                              <strong>{term}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No durable context has attached itself to this signal yet.</p>
                      )}
                    </section>

                    <section>
                      <span>nearby ambition reads</span>
                      {(savedSignalDetail?.relatedTopOfMindNotes ?? []).length > 0 ? (
                        <ul className="signal-revisit-notes">
                          {savedSignalDetail!.relatedTopOfMindNotes.slice(0, 3).map((note) => (
                            <li key={note.id}>
                              <strong>{note.title}</strong>
                              <p>{note.body}</p>
                            </li>
                          ))}
                        </ul>
                      ) : selectedSavedSignal.relatedTopOfMindNoteTitles.length > 0 ? (
                        <ul className="signal-revisit-notes">
                          {selectedSavedSignal.relatedTopOfMindNoteTitles.slice(0, 3).map((title) => (
                            <li key={title}>
                              <strong>{title}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No top-of-mind post-it points back here yet.</p>
                      )}
                    </section>

                    <section>
                      <span>what did this mean then?</span>
                      <p>
                        It was saved because something in it had charge. The exact charge can stay messy; WAKA
                        treats the saved moment and highlight as evidence before it asks for structure.
                      </p>
                    </section>

                    <section>
                      <span>what does it mean now?</span>
                      <p>
                        {selectedSavedSignal.relatedTopOfMindNoteTitles[0] ??
                          selectedSavedSignal.relatedContextTerms[0] ??
                          "Its current shape is still open. Marking what changed will move the memory model."}
                      </p>
                    </section>

                    <section>
                      <span>is this still me?</span>
                      <label className="signal-revisit-change-note">
                        <span>optional what changed</span>
                        <textarea
                          value={savedSignalChangeText}
                          rows={3}
                          placeholder="what changed since you saved this?"
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                            setSavedSignalChangeText(event.target.value)
                          }
                        />
                      </label>
                      <div className="signal-revisit-feedback" role="group" aria-label="mark whether this signal still matters">
                        {[
                          { value: "important" as const, label: "Still alive" },
                          { value: "partly" as const, label: "Changed shape" },
                          { value: "not_important" as const, label: "Not anymore" },
                        ].map((action) => (
                          <button
                            key={action.value}
                            type="button"
                            disabled={savedSignalFeedback.status === "saving"}
                            onClick={() => void submitSavedSignalFeedback(action.value, action.label)}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                      {savedSignalFeedback.status === "saved" ? (
                        <p className="signal-revisit-feedback-status">Saved: {savedSignalFeedback.label}</p>
                      ) : savedSignalFeedback.status === "saving" ? (
                        <p className="signal-revisit-feedback-status">Saving...</p>
                      ) : savedSignalFeedback.status === "error" ? (
                        <p className="signal-revisit-feedback-status">{savedSignalFeedback.message}</p>
                      ) : null}
                    </section>
                  </>
                ) : null}
              </article>
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
