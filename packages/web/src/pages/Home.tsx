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
  type ApiFeedbackValue,
  type ApiError,
  type ApiInspiration,
  type ApiInspirationScorePatch,
  type ApiTopOfMind,
  type ApiTopOfMindNoteSurface,
  type ApiTopOfMindSignal,
  type ClusterKind,
  createFeedback,
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
type HomeMode = "capture" | "thought" | "saves";
type TopOfMindFeedbackValue = Extract<
  ApiFeedbackValue,
  "true" | "partly" | "not_true" | "important" | "not_important"
>;
type FeedbackStatus = "idle" | "saving" | "saved" | "error";

const TOP_OF_MIND_SIGNAL_THRESHOLD = 2;

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
    label: note.title,
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

const NOTE_POSITIONS: Array<{ top: string; left: string; tilt: number; w: string }> = [
  { top: "24px", left: "calc(50% - 200px)", tilt: -1.4, w: "400px" },
  { top: "74px", left: "calc(50% - 520px)", tilt: -2.2, w: "260px" },
  { top: "270px", left: "calc(50% + 80px)", tilt: 1.8, w: "280px" },
  { top: "268px", left: "calc(50% - 470px)", tilt: 1.2, w: "260px" },
];

const NOTE_COLORS = [
  { hue: "#ece4cb", ink: "#4a3e1f" },
  { hue: "#e8d4ce", ink: "#6b3c34" },
  { hue: "#d8ddc6", ink: "#3f4a2a" },
  { hue: "#cdd3df", ink: "#3a4456" },
];

const HOME_COPY = {
  "ko-KR": {
    thoughtTab: "top of mind",
    savesTab: "all signals",
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
    lifecycleHint: "not final. changes as new signals arrive.",
    noteShifted: ["today's shape", "still here", "not gone yet", "fading"],
    evidenceLabel: "여기서 시작됨",
    feedbackLabels: {
      true: "true",
      partly: "partly",
      not_true: "not true",
      important: "important",
      not_important: "not important",
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
    savesTitle: "all signals",
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
    savesTab: "all signals",
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
        This person caught what almost slipped away.
        <br />
        And slowly, the things they saved began to take shape.
        <br />
        Who they want to think with. Where they want to be. What they might be here to build.
        <br />
        <span className="nc-tagline-en">
          — they did not write any of this. they only saved what almost slipped away. the rest emerged.
        </span>
      </>
    ),
    lifecycleHint: "not final. changes as new signals arrive.",
    noteShifted: ["today's shape", "still here", "not gone yet", "fading"],
    evidenceLabel: "where it began",
    feedbackLabels: {
      true: "true",
      partly: "partly",
      not_true: "not true",
      important: "important",
      not_important: "not important",
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
    savesTitle: "saved signals",
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
    feedbackLabels: Record<TopOfMindFeedbackValue, string>;
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
  const [captureFocused, setCaptureFocused] = useState(false);
  const [captureSaveFlash, setCaptureSaveFlash] = useState(false);
  const [captureView] = useState<CaptureView>("note");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<HomeMode>("thought");
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
          fetchTopOfMindNotes({ limit: 4 }),
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
      setCaptureOpen(false);
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
  ].slice(0, 4).map(signalToThoughtCard);
  const thoughtCards = topOfMindNotes.length > 0
    ? topOfMindNotes.slice(0, 4).map(noteToThoughtCard)
    : fallbackThoughtCards;
  const displayName = (user.name || user.email.split("@")[0] || "yunji").split(" ")[0];
  const displayHandle = displayName.toLowerCase();
  const dateLabel = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const copy = HOME_COPY[locale];
  const hasEnoughSignalsForTopOfMind =
    entries.length >= TOP_OF_MIND_SIGNAL_THRESHOLD || thoughtCards.length > 0;

  useEffect(() => {
    if (homeModeChosen || initialLoading || topOfMindLoading || topOfMindNotesLoading) return;
    setHomeMode("thought");
  }, [
    hasEnoughSignalsForTopOfMind,
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
    "important",
    "not_important",
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
              status:
                value === "not_true" || value === "not_important"
                  ? "stale"
                  : note.status,
              confidence:
                value === "true" || value === "important"
                  ? Math.min(100, note.confidence + 4)
                  : value === "not_true" || value === "not_important"
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
          {feedbackValues.map((value) => {
            const active = feedbackState?.value === value;
            return (
              <button
                key={value}
                type="button"
                className={`nc-note-feedback-btn${active ? " nc-note-feedback-btn--active" : ""}`}
                aria-pressed={active}
                disabled={saving}
                onClick={(event) => {
                  event.stopPropagation();
                  void submitTopOfMindFeedback(signal, value);
                }}
              >
                {copy.feedbackLabels[value]}
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
      <header className="nc-note-head">
        <span className="nc-note-title">no. {String(index + 1).padStart(2, "0")}</span>
        <span className="nc-note-shifted">
          {copy.noteShifted[index] ?? copy.noteShifted[copy.noteShifted.length - 1]}
        </span>
      </header>

      <p className="nc-note-body">
        {locale === "en-US"
          ? signal.label
          : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(signal.label)] ?? signal.label}
      </p>

      <div className="nc-note-reveal">
        <div className="nc-note-evidence">
          <span className="nc-note-evidence-label">why it stuck</span>
          <p className="nc-note-evidence-quote">
            "{shortText(source?.preview || signal.reason, 120)}"
          </p>
          <span className="nc-note-evidence-source">— {meaningTypeLabel(signal.type)}</span>
        </div>
      </div>
      {renderFeedbackControls(signal)}
    </article>
  );
  };

  const renderExpandedThoughtCard = (index: number): JSX.Element | null => {
    const signal = thoughtCards[index];
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
        className="nc-note-modal"
        aria-labelledby={`top-of-mind-note-${signal.id}`}
        style={{
          ["--bg" as string]: NOTE_COLORS[index]?.hue ?? NOTE_COLORS[0].hue,
          ["--ink" as string]: NOTE_COLORS[index]?.ink ?? NOTE_COLORS[0].ink,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nc-note-head">
          <span className="nc-note-title">no. {String(index + 1).padStart(2, "0")}</span>
          <span className="nc-note-shifted">
            {copy.noteShifted[index] ?? copy.noteShifted[copy.noteShifted.length - 1]}
          </span>
        </header>

        <p className="nc-note-body" id={`top-of-mind-note-${signal.id}`}>
          {locale === "en-US"
            ? signal.label
            : MEANING_NOTE_LABEL_TRANSLATIONS[normalizeMeaningLabel(signal.label)] ?? signal.label}
        </p>

        <div className="nc-note-expanded-content">
          <section className="nc-note-reading">
            <p>{signal.reason}</p>
          </section>

          <section className="nc-note-source-section">
            <span>it began here</span>
            <blockquote className="nc-note-source">
              “{shortText(source?.preview || signal.reason, 190)}”
            </blockquote>
          </section>

          <section className="nc-note-evidence-panel" aria-labelledby={`top-of-mind-evidence-${signal.id}`}>
            <div className="nc-note-evidence-header">
              <span>evidence signals</span>
              <strong id={`top-of-mind-evidence-${signal.id}`}>
                {signal.supportingSignals.length > 0
                  ? `${signal.supportingSignals.length} signal${signal.supportingSignals.length === 1 ? "" : "s"} behind this`
                  : "no signal evidence yet"}
              </strong>
            </div>
            {signal.supportingSignals.length > 0 ? (
              <ol className="nc-note-evidence-list">
                {signal.supportingSignals.slice(0, 4).map((evidence) => (
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
              <span>related context</span>
              <strong id={`top-of-mind-context-${signal.id}`}>
                {contextNodes.length > 0
                  ? `${contextNodes.length} context claim${contextNodes.length === 1 ? "" : "s"}`
                  : "no context claims yet"}
              </strong>
            </div>
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
            <span>not final</span>
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
        title="all signals"
        detail={historyDetail}
      >
        {historyContent}
      </HistoryPanel>
      {expandedNoteIndex !== null ? (
        <div className="nc-note-overlay" onClick={closeExpandedNoteOnBackdrop}>
          {renderExpandedThoughtCard(expandedNoteIndex)}
        </div>
      ) : null}
      <main className={`nc-canvas${homeMode === "thought" ? " nc-canvas--top-of-mind" : ""}`}>
        <header className="nc-topbar">
          <div className="nc-topleft">
            <div className="nc-mode" role="tablist" aria-label="home mode">
            <button
              type="button"
              className={`nc-mode-btn${homeMode === "thought" ? " nc-mode-btn--active" : ""}`}
              onClick={() => chooseHomeMode("thought")}
            >
              {copy.thoughtTab}
            </button>
            <button
              type="button"
              className={`nc-mode-btn${homeMode === "saves" ? " nc-mode-btn--active" : ""}`}
              onClick={() => chooseHomeMode("saves")}
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

        {homeMode === "thought" ? (
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

            <section className="nc-stage" aria-label="generated thoughts">
              {topOfMindLoading ? (
                <p className="nc-loading">{copy.loadingThoughts}</p>
              ) : topOfMindError ? (
                <p className="nc-loading">{topOfMindError}</p>
              ) : thoughtCards.length > 0 ? (
                thoughtCards.map(renderThoughtCard)
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
          <section className="reference-saves-page" aria-label={copy.savesTitle}>
            <header>
              <label>
                <input
                  type="search"
                  value={inspirationFilters.search}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setInspirationFilters({ search: event.target.value })
                  }
                  placeholder={copy.searchPlaceholder}
                />
              </label>
              <Link to="/signals" className="reference-saves-archive-link">
                deep signal archive
              </Link>
            </header>
            <div className="reference-save-list">
              {filteredEntries.length > 0 ? (
                filteredEntries.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => handleSelectInspiration(entry.id)}
                    className="reference-save"
                  >
                    <span>{entry.status === "saved" ? entry.timestamp : entry.status}</span>
                    <strong>{shortText(displayTextForEntry(entry), 420)}</strong>
                    {entry.attachments.map((attachment) => (
                      <span
                        key={attachment.id}
                        className={attachment.type === "link" ? "reference-save-link" : "reference-save-attachment"}
                      >
                        {attachmentContextLabel(attachment, locale)}
                      </span>
                    ))}
                    {entry.attachments.length === 0
                      ? entry.links.map((link) => (
                          <span key={link} className="reference-save-link">
                            {link}
                          </span>
                        ))
                      : null}
                    {entry.status === "saved" && entry.errorMessage ? (
                      <span className="reference-save-warning">{entry.errorMessage}</span>
                    ) : null}
                  </button>
                ))
              ) : (
                <p>{initialLoading ? copy.loadingSaves : copy.emptySaves}</p>
              )}
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
          title="Admin inspection"
        >
          Admin
        </Link>
      ) : null}
    </>
  );
}

export default HomePage;
