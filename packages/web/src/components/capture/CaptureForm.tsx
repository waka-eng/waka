/**
 * <CaptureForm /> — the *wired* capture surface.
 *
 * Sub-AC 5.4 (Sub-AC 4 of evaluation milestone 5) lifts the presentational
 * `<CaptureCell>` into a save-capable form: it owns the textarea, the
 * pending-attachment list (links from the textarea, files picked / dropped
 * in), and the API round-trip — POST /inspirations, then for each
 * attachment either POST /attachments (link) or POST /attachments/presign +
 * PUT to S3 + POST /attachments (image / file).
 *
 * Optimistic state contract
 * -------------------------
 * The board needs to render the new inspiration in the history sidebar the
 * instant the user clicks Save — *before* the API has answered. We meet that
 * by emitting three lifecycle callbacks to the parent:
 *
 *   1. `onOptimisticAdd(pending)` fires immediately when Save is clicked.
 *      The parent unshifts the pending row into its history list.
 *   2. `onPersisted(tempId, server)` fires when the inspirations POST + every
 *      attachment finalize succeeds. The parent swaps the optimistic row
 *      for the canonical server row.
 *   3. `onPersistError(tempId, error)` fires when any step fails. The
 *      parent leaves the optimistic row in place but flags it so the user
 *      can retry.
 *
 * The form deliberately does NOT mutate the parent's list itself — the
 * board owns that data, and layering optimistic state into a single owner
 * keeps the cross-render guarantees (key stability, ordering) easy to reason
 * about.
 *
 * Error handling contract
 * -----------------------
 *   - The save pill stays disabled while an in-flight save is open. This
 *     prevents a double-click from creating two inspirations.
 *   - Field-level validation errors (zod `details`) are surfaced as a
 *     human-readable message the cell's confirm-overlay renders, so the
 *     primitive's visual contract carries the failure without requiring a
 *     new chrome.
 *   - Per-attachment failures are reported through the same callback. The
 *     inspiration row is still considered persisted (it landed in Postgres
 *     successfully) — only the failed attachment is reported as missing
 *     so the user can retry the upload without re-typing the note.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import {
  ApiError,
  createInspiration,
  createReflection,
  finalizeAttachment,
  generateGuidedReflectionQuestion,
  presignAttachment,
  uploadToPresignedUrl,
  type ApiAttachment,
  type ApiInspiration,
  type CreateReflectionResponse,
} from "../../lib/api";
import { DEFAULT_LOCALE, formatMessage, t, type MessageKey, type SupportedLocale } from "../../lib/locales";
import {
  CaptureCell,
  type CaptureCellVisualState,
  type CaptureView,
} from "./CaptureCell";

/* ============================================================
 * Public types
 * ============================================================ */

/**
 * Local-only handle for an attachment that is sitting in the capture
 * surface but has not been persisted yet. The shape is deliberately *not*
 * an `ApiAttachment` — pending attachments don't have a server id, and we
 * keep the discriminated union flat so the strip rendering can branch on
 * `kind` without secondary lookups.
 */
export interface PendingAttachment {
  /** Stable client-side id used for React keys and removal. */
  localId: string;
  /** Source kind — drives which API call finalizes it on save. */
  kind: "link" | "image" | "file";
  /** For links: the original URL the user pasted. */
  url?: string;
  /** For files: the in-memory File handle (image or generic file). */
  file?: File;
  /** Display label in the strip; falls back to a derived value. */
  name?: string;
  /** For images: object URL for thumbnail preview. */
  previewUrl?: string;
}

/**
 * Optimistic record handed to the parent the moment Save is clicked.
 *
 * The parent unshifts this into its history list and renders it as a
 * "saving" entry. Once the persist round-trip resolves, the parent uses
 * `tempId` to swap the pending row for the canonical `ApiInspiration`.
 */
export interface PendingInspiration {
  /** Synthetic uuid — replaced by the server id on success. */
  tempId: string;
  /** Note text exactly as the user typed it (post-trim). */
  text: string;
  /** Link URLs the user attached (deduped). */
  links: string[];
  /** Pending attachments (image / file / link). For UI only; the API call
   *  flow uses these to drive the per-attachment finalize loop. */
  attachments: PendingAttachment[];
  /** Bounded MVP input type inferred at save time for optimistic UI parity. */
  kind: CaptureInputKind;
  /** ISO timestamp of when the user clicked Save. */
  createdAt: string;
}

export interface PersistedResult {
  inspiration: ApiInspiration;
  attachments: ApiAttachment[];
  reflections?: CreateReflectionResponse[];
  reflection?: CreateReflectionResponse;
  /** Count of Reflect Deeper Q/A rows saved by POST /inspirations. */
  reflectionCount?: number;
  /** Per-attachment failures. Surfaces the original `localId` so the parent
   *  can keep the failed one visible (e.g. with a retry affordance) while
   *  the inspiration row itself is treated as saved. */
  failedAttachments: Array<{ localId: string; error: ApiError }>;
}

export interface CaptureFormProps {
  /** Parent receives the optimistic row immediately on Save click. */
  onOptimisticAdd?: (pending: PendingInspiration) => void;
  /** Resolves with the canonical server row + finalized attachments. */
  onPersisted?: (tempId: string, result: PersistedResult) => void;
  /** Surfaces a hard failure (the inspirations POST itself failed). */
  onPersistError?: (tempId: string, error: ApiError) => void;

  /** Focus mode toggle wired by the parent (controls grid expand). */
  focused?: boolean;
  onToggleFocus?: (next: boolean) => void;

  /** Capture sub-view (note vs reflect). Reflection wiring lives later. */
  view?: CaptureView;
  /** Stacked visual modifiers — drag, focus, save flash. */
  visualState?: CaptureCellVisualState;
  /** Locale used for user-facing capture and reflection copy. */
  locale?: SupportedLocale;
  /** Parent can close the modal after the post-save mirror action. */
  onDismissAfterSave?: () => void;
  /**
   * Fires once a save fully succeeds. The parent uses this to close the
   * capture surface and flash an ephemeral "saved" confirmation on the
   * capture button, replacing the in-cell post-save mirror card.
   */
  onSaved?: () => void;
}

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * URL extractor mirroring the prototype (`extractUrls` in index.html).
 * Anchored on a word boundary so partial matches inside other tokens are
 * not extracted; trailing punctuation that commonly attaches to a URL in
 * prose (`.`, `,`, `)`, `]`, `>`, `;`, `'`, `"`) is stripped so paste of
 * "Read this — https://example.com." picks up the bare URL.
 */
const URL_REGEX = /\bhttps?:\/\/[^\s]+/gi;
const TRAILING_PUNCT = /[.,)\]>;'"]+$/;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CAPTURE_DRAFT_STORAGE_KEY = "waka.captureDraft.v1";
const CAPTURE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const CAPTURE_DRAFT_WRITE_DEBOUNCE_MS = 300;
const GUIDED_REFLECTION_FALLBACK_QUESTION_KEYS = [
  "guidedReflectionQuestion1",
  "guidedReflectionQuestion2",
  "guidedReflectionQuestion3",
] as const satisfies readonly MessageKey[];
const GUIDED_REFLECTION_MAX_STEPS = 3;

interface GuidedReflectionPayloadItem {
  question: string;
  answer: string;
}

type GuidedReflectionPayload = GuidedReflectionPayloadItem[];

type CaptureResonanceAnswer =
  | "pulled_me"
  | "want"
  | "miss"
  | "envy"
  | "taste"
  | "reject"
  | "person"
  | "place"
  | "work"
  | "hurt"
  | "scared"
  | "feels_like_me"
  | "not_me_anymore"
  | "want_people_like_this"
  | "build_toward_this"
  | "live_near_this"
  | "not_sure";

interface HighlightedSignalText {
  text: string;
  startOffset: number;
  endOffset: number;
}

interface CapturePopoverPosition {
  top: number;
  left: number;
}

interface StoredCaptureDraft {
  note?: string;
  resonance?: CaptureResonanceAnswer | null;
  resonanceNote?: string;
  highlight?: HighlightedSignalText | null;
  highlights?: HighlightedSignalText[];
  links?: Array<{ url: string; name?: string }>;
  storedAt?: number;
}

const resonanceOptions: Array<{ value: CaptureResonanceAnswer; label: string; icon: string; prompt: string }> = [
  { value: "pulled_me", label: "pulled me", icon: "*", prompt: "What pulled me here?" },
  { value: "want", label: "I want this", icon: "+", prompt: "What do I want more of here?" },
  { value: "miss", label: "I miss this", icon: "<", prompt: "What does this make me miss?" },
  { value: "envy", label: "I envy this", icon: "~", prompt: "What does the envy point toward?" },
  { value: "taste", label: "taste", icon: ".", prompt: "What taste or standard is this marking?" },
  { value: "reject", label: "reject", icon: "-", prompt: "What am I refusing here?" },
  { value: "person", label: "person", icon: "p", prompt: "Who does this make me want near?" },
  { value: "place", label: "place", icon: "m", prompt: "What place or room does this point toward?" },
  { value: "work", label: "work", icon: "w", prompt: "What kind of work does this point toward?" },
  { value: "hurt", label: "this hurt", icon: "!", prompt: "What did this touch?" },
  { value: "scared", label: "this scared me", icon: "^", prompt: "What feels at stake?" },
  { value: "feels_like_me", label: "this feels like me", icon: "=", prompt: "What feels like me here?" },
  { value: "not_me_anymore", label: "this is not me anymore", icon: "x", prompt: "What am I done being near?" },
  { value: "want_people_like_this", label: "I want people like this", icon: "p", prompt: "What kind of people does this point to?" },
  { value: "build_toward_this", label: "I want to build toward this", icon: "b", prompt: "What would building toward this mean?" },
  { value: "live_near_this", label: "I want to live near this", icon: "m", prompt: "What environment does this make me want?" },
  { value: "not_sure", label: "I don't know yet", icon: "...", prompt: "What is the first clue?" },
];

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(TRAILING_PUNCT, "");
    if (cleaned.length === 0) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Best-effort filename → extension stripper used to render a compact label
 * in the cap-strip. We mirror the prototype's display rule: hostname +
 * pathname truncated to ~32 chars, falling back to the raw URL.
 */
function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > 32 ? `${display.slice(0, 30)}…` : display;
  } catch {
    return url;
  }
}

/**
 * Synthetic id factory. We avoid `crypto.randomUUID()` to stay compatible
 * with older Safari / WebView runtimes the prototype targets — a 12-char
 * base36 token is more than enough collision resistance for client-only
 * keys that get replaced by a real server uuid within seconds.
 */
function makeLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export type CaptureInputKind = "note" | "link" | "image" | "mixed";

function removeUrlsFromText(text: string): string {
  let remainder = text;
  for (const url of extractUrlsFromText(text)) {
    remainder = remainder.replace(url, " ");
  }
  return remainder.replace(/\s+/g, " ").trim();
}

function primaryCaptureKind(
  text: string,
  attachments: PendingAttachment[],
): CaptureInputKind {
  if (attachments.length === 0) return "note";
  const kinds = new Set(attachments.map((att) => att.kind));
  const hasUserNoteText = removeUrlsFromText(text).length > 0;
  if (hasUserNoteText || kinds.size > 1 || kinds.has("file")) return "mixed";
  if (kinds.has("image")) return "image";
  return "link";
}

function fallbackTextForCaptureKind(kind: CaptureInputKind): string {
  if (kind === "image") return "Image inspiration";
  if (kind === "link") return "Link inspiration";
  if (kind === "mixed") return "Mixed inspiration";
  return "Untitled inspiration";
}

function readStoredCaptureDraft(): StoredCaptureDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCaptureDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.storedAt !== "number" ||
      !Number.isFinite(parsed.storedAt) ||
      Date.now() - parsed.storedAt > CAPTURE_DRAFT_TTL_MS
    ) {
      window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredCaptureDraft(draft: StoredCaptureDraft): void {
  if (typeof window === "undefined") return;
  const hasDraft =
    (draft.note?.trim().length ?? 0) > 0 ||
    Boolean(draft.resonance) ||
    (draft.resonanceNote?.trim().length ?? 0) > 0 ||
    Boolean(draft.highlight?.text) ||
    (draft.highlights?.length ?? 0) > 0 ||
    (draft.links?.length ?? 0) > 0;
  try {
    if (!hasDraft) {
      window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      CAPTURE_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, storedAt: Date.now() }),
    );
  } catch {
    // Draft persistence is best-effort; capture itself should keep working.
  }
}

function clearStoredCaptureDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CAPTURE_DRAFT_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

function resonanceLabel(value: CaptureResonanceAnswer): string {
  return resonanceOptions.find((option) => option.value === value)?.label ?? value;
}

function buildCaptureMetadataNote(input: {
  resonance: CaptureResonanceAnswer | null;
  resonanceNote: string;
}): string | undefined {
  if (!input.resonance && input.resonanceNote.trim().length === 0) return undefined;
  return `capture_metadata:v1:${JSON.stringify({
    reason: input.resonance,
    reasonLabel: input.resonance ? resonanceLabel(input.resonance) : null,
    userReason: input.resonanceNote.trim() || null,
  })}`;
}

/* ============================================================
 * Component
 * ============================================================ */

export const CaptureForm = forwardRef<HTMLDivElement, CaptureFormProps>(
  function CaptureForm(
    {
      onOptimisticAdd,
      onPersisted,
      onPersistError,
      focused = false,
      onToggleFocus,
      view = "note",
      visualState,
      locale = DEFAULT_LOCALE,
      onDismissAfterSave,
      onSaved,
    },
    ref,
  ): JSX.Element {
    /* --------------------------------------------------------
     * Local state
     * -------------------------------------------------------- */

    const [note, setNote] = useState("");
    const [activeView, setActiveView] = useState<CaptureView>(view);
    const [reflectionAnswer, setReflectionAnswer] = useState("");
    const [reflectionStepIndex, setReflectionStepIndex] = useState(0);
    const [guidedReflectionAnswers, setGuidedReflectionAnswers] = useState<string[]>([]);
    const [guidedReflectionQuestions, setGuidedReflectionQuestions] = useState<string[]>([]);
    const [postSaveReflectionTargetId, setPostSaveReflectionTargetId] = useState<string | null>(null);
    const [reflectGlow, setReflectGlow] = useState(false);
    const [pending, setPending] = useState<PendingAttachment[]>([]);
    const [highlights, setHighlights] = useState<HighlightedSignalText[]>([]);
    const [pendingHighlight, setPendingHighlight] = useState<HighlightedSignalText | null>(null);
    const [highlightPopoverPosition, setHighlightPopoverPosition] = useState<CapturePopoverPosition | null>(null);
    const [, setHighlightDetailsOpen] = useState(false);
    const [resonance, setResonance] = useState<CaptureResonanceAnswer | null>(null);
    const [resonanceNote, setResonanceNote] = useState("");
    const [saving, setSaving] = useState(false);
    /**
     * Confirmation / error message displayed in `cap-confirm`. The cell
     * keeps the overlay mounted but hides it via `.visible`; we drive that
     * by toggling the message on/off on a timer.
     */
    const [confirmMessage, setConfirmMessage] = useState<ReactNode>(null);
    const [confirmVisible, setConfirmVisible] = useState(false);
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reflectGlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const draftWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const guidedReflectionRequestSeqRef = useRef(0);
    const resonanceNoteInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      const draft = readStoredCaptureDraft();
      if (!draft) return;
      if (typeof draft.note === "string") setNote(draft.note);
      if (Array.isArray(draft.highlights)) {
        setHighlights(draft.highlights.filter((item) => item.text && item.endOffset > item.startOffset));
      } else if (draft.highlight?.text) {
        setHighlights([draft.highlight]);
      }
      if (draft.resonance) setResonance(draft.resonance);
      if (typeof draft.resonanceNote === "string") setResonanceNote(draft.resonanceNote);
      if (Array.isArray(draft.links)) {
        setPending(
          draft.links
            .filter((link) => typeof link.url === "string" && link.url.trim().length > 0)
            .map((link) => ({
              localId: makeLocalId("att"),
              kind: "link",
              url: link.url,
              name: link.name ?? `${t(locale, "linkChipPrefix")} · ${linkLabel(link.url)}`,
            })),
        );
      }
    }, [locale]);

    useEffect(() => {
      const links = pending
        .filter((att) => att.kind === "link" && att.url)
        .map((att) => ({ url: att.url as string, name: att.name }));
      if (draftWriteTimerRef.current) clearTimeout(draftWriteTimerRef.current);
      draftWriteTimerRef.current = setTimeout(() => {
        writeStoredCaptureDraft({ note, resonance, resonanceNote, highlights, links });
        draftWriteTimerRef.current = null;
      }, CAPTURE_DRAFT_WRITE_DEBOUNCE_MS);
      return () => {
        if (draftWriteTimerRef.current) {
          clearTimeout(draftWriteTimerRef.current);
          draftWriteTimerRef.current = null;
        }
      };
    }, [note, resonance, resonanceNote, highlights, pending]);

    // Cleanup timers when the component unmounts. Without this an
    // in-flight setTimeout would fire `setState` on an unmounted instance.
    useEffect(() => {
      return () => {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        if (reflectGlowTimerRef.current) clearTimeout(reflectGlowTimerRef.current);
        if (draftWriteTimerRef.current) clearTimeout(draftWriteTimerRef.current);
      };
    }, []);

    // Cleanup any object URLs we minted for image previews. Without this the
    // browser pins the underlying File in memory until the tab closes.
    useEffect(() => {
      return () => {
        for (const att of pending) {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally only on unmount; per-item revoke happens in remove handler

    /* --------------------------------------------------------
     * Confirmation helper — short-lived banner inside `cap-confirm`.
     * -------------------------------------------------------- */

    const flashConfirm = useCallback((message: ReactNode, ms = 2000) => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmMessage(message);
      setConfirmVisible(true);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmVisible(false);
      }, ms);
    }, []);

    const fallbackGuidedQuestion = useCallback(
      (stepIndex: number): string => {
        const key = GUIDED_REFLECTION_FALLBACK_QUESTION_KEYS[stepIndex] ?? GUIDED_REFLECTION_FALLBACK_QUESTION_KEYS[GUIDED_REFLECTION_FALLBACK_QUESTION_KEYS.length - 1];
        return t(locale, key);
      },
      [locale],
    );

    const requestGuidedQuestion = useCallback(
      async (priorAnswers: string[], priorQuestions: string[]): Promise<string> => {
        const trimmed = note.trim();
        const existingLinkUrls = pending
          .filter((p) => p.kind === "link" && p.url)
          .map((p) => p.url as string);
        const typedLinks = extractUrlsFromText(trimmed).filter((url) => !existingLinkUrls.includes(url));
        const kind = primaryCaptureKind(trimmed, pending);
        const response = await generateGuidedReflectionQuestion({
          locale,
          inspiration: {
            text: trimmed.length > 0 ? trimmed : fallbackTextForCaptureKind(kind),
            kind,
            links: [...existingLinkUrls, ...typedLinks],
            attachmentKinds: pending.map((item) => item.kind),
            highlights: highlights.map((item) => item.text),
            resonance,
            resonanceNote: resonanceNoteInputRef.current?.value ?? resonanceNote,
          },
          priorAnswers: priorAnswers
            .map((answer, index) => ({
              question: priorQuestions[index] ?? fallbackGuidedQuestion(index),
              answer: answer.trim(),
            }))
            .filter((item) => item.answer.length > 0),
        });
        return response.question.trim() || fallbackGuidedQuestion(priorAnswers.length);
      },
      [fallbackGuidedQuestion, highlights, locale, note, pending, resonance, resonanceNote],
    );

    /* --------------------------------------------------------
     * Attachment management
     * -------------------------------------------------------- */

    const addFile = useCallback((file: File): void => {
      // The current product slice supports image upload/drop only. Keep the
      // file picker at image/* and defensively reject scripted/dragged
      // non-images or over-limit blobs before creating any pending row.
      if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
        flashConfirm(t(locale, "unsupportedImage"), 2600);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setPending((prev) => [
        ...prev,
        {
          localId: makeLocalId("att"),
          kind: "image",
          file,
          name: file.name,
          previewUrl,
        },
      ]);
    }, [flashConfirm, locale]);

    const removeAttachment = useCallback((localId: string): void => {
      setPending((prev) => {
        const target = prev.find((p) => p.localId === localId);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.localId !== localId);
      });
    }, []);

    /* --------------------------------------------------------
     * Note keystroke handling. The prototype extracts URLs on *paste*
     * only — typing a URL one character at a time keeps it in the body
     * (so the user can keep editing it). We mirror that: per-keystroke
     * the textarea is the source of truth, and at save time we run the
     * URL extractor over the note to lift any unattached URLs into link
     * attachments before posting.
     * -------------------------------------------------------- */

    const handleNoteChange = useCallback((next: string): void => {
      setNote(next);
      setHighlights((current) =>
        current.filter((item) => next.slice(item.startOffset, item.endOffset) === item.text),
      );
      setPendingHighlight((current) => {
        if (!current) return current;
        const stillMatches = next.slice(current.startOffset, current.endOffset) === current.text;
        if (!stillMatches) setHighlightPopoverPosition(null);
        return stillMatches ? current : null;
      });
    }, []);

    const handleNoteSelect = useCallback((event: SyntheticEvent<HTMLTextAreaElement>): void => {
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const text = target.value.slice(start, end).trim();
      if (!text || start === end) {
        setPendingHighlight(null);
        setHighlightPopoverPosition(null);
        return;
      }
      const rawSelection = target.value.slice(start, end);
      const leadingWhitespace = rawSelection.match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = rawSelection.match(/\s*$/)?.[0].length ?? 0;
      const selectionStart = start + leadingWhitespace;
      const nextHighlight = {
        text,
        startOffset: selectionStart,
        endOffset: end - trailingWhitespace,
      };
      const beforeSelection = target.value.slice(0, selectionStart);
      const lines = beforeSelection.split("\n");
      const line = Math.max(0, lines.length - 1);
      const column = lines[lines.length - 1]?.length ?? 0;
      const computed = window.getComputedStyle(target);
      const fontSize = Number.parseFloat(computed.fontSize) || 24;
      const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.22;
      const averageCharacterWidth = fontSize * 0.54;
      const top = target.offsetTop + line * lineHeight - target.scrollTop - 10;
      const left = target.offsetLeft + Math.min(column * averageCharacterWidth, target.clientWidth - 48) - target.scrollLeft;
      setPendingHighlight(nextHighlight);
      setHighlightPopoverPosition({
        top: Math.max(12, top),
        left: Math.max(12, left),
      });
      setHighlightDetailsOpen(false);
    }, []);

    const handleNotePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const pasted = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text");
      const urls = extractUrlsFromText(pasted);
      if (urls.length !== 1 || pasted.trim() !== urls[0]) return;

      event.preventDefault();
      const url = urls[0];
      setPending((prev) => {
        if (prev.some((p) => p.kind === "link" && p.url === url)) return prev;
        return [
          ...prev,
          {
            localId: makeLocalId("att"),
            kind: "link",
            url,
            name: `${t(locale, "linkChipPrefix")} · ${linkLabel(url)}`,
          },
        ];
      });
    }, [locale]);

    /**
     * Cmd/Ctrl+Enter saves; Esc collapses focus mode. Mirrors the prototype.
     */
    const handleNoteKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          // Defer to the same handler the save pill triggers — see below.
          // Saved on next microtask so React commits the keypress first.
          queueMicrotask(() => triggerSave());
        }
        if (event.key === "Escape" && focused) {
          event.preventDefault();
          onToggleFocus?.(false);
        }
      },
      // triggerSave is defined below — declared with `function` so JS hoists
      // it; React sees the same identity across renders because the call
      // path goes through the local closure rather than a memoized callback.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [focused, onToggleFocus],
    );

    /* --------------------------------------------------------
     * The save round-trip
     * -------------------------------------------------------- */

    /**
     * Persist a single pending attachment after the inspiration row exists.
     * Returns the canonical row on success; on failure rethrows so the
     * caller's gather-all logic can decide what to do.
     */
    async function persistAttachment(
      inspirationId: string,
      att: PendingAttachment,
    ): Promise<ApiAttachment> {
      if (att.kind === "link") {
        if (!att.url) {
          throw new ApiError({
            status: 0,
            message: "Link attachment missing url",
          });
        }
        return finalizeAttachment({
          type: "link",
          inspirationId,
          url: att.url,
          name: att.name,
        });
      }

      // image / file — presign, PUT, finalize.
      if (!att.file) {
        throw new ApiError({
          status: 0,
          message: "File attachment missing file handle",
        });
      }
      const presign = await presignAttachment({
        filename: att.file.name,
        contentType: att.file.type || "application/octet-stream",
        size: att.file.size,
      });
      await uploadToPresignedUrl(
        presign.uploadUrl,
        att.file,
        presign.headers,
      );
      return finalizeAttachment({
        type: att.kind,
        inspirationId,
        key: presign.key,
        name: att.name ?? att.file.name,
        contentType: att.file.type || undefined,
        size: att.file.size,
      });
    }

    /**
     * The save pill / Cmd+Enter shortcut. Pulled out as a regular function
     * (not `useCallback`) so the keydown handler can reference it without
     * incurring an extra dependency cycle. Closes over the latest state via
     * its caller (state setters and refs are stable).
     */
    const triggerSave = useCallback(async (options: { reflection?: GuidedReflectionPayload } = {}): Promise<void> => {
      if (saving) return;
      const trimmed = note.trim();
      if (trimmed.length === 0 && pending.length === 0) {
        flashConfirm(t(locale, "emptyCapturePrompt"), 2200);
        return;
      }

      const reflectiveAnswers = options.reflection?.map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      })) ?? [];
      if (options.reflection && reflectiveAnswers.some((item) => item.question.length === 0 || item.answer.length === 0)) {
        flashConfirm(t(locale, "addThoughtBeforeReflectiveSave"), 2600);
        setActiveView("reflect");
        return;
      }

      // Lift any URLs in the note body into link attachments. The prototype
      // does this implicitly via paste; doing it again here covers the
      // typed-URL case without hijacking keystrokes. We dedup against any
      // chips the user pasted earlier so saving twice doesn't double up.
      const existingLinkUrls = new Set(
        pending
          .filter((p) => p.kind === "link" && p.url)
          .map((p) => p.url as string),
      );
      const liftedLinks: PendingAttachment[] = [];
      for (const url of extractUrlsFromText(trimmed)) {
        if (existingLinkUrls.has(url)) continue;
        existingLinkUrls.add(url);
        liftedLinks.push({
          localId: makeLocalId("att"),
          kind: "link",
          url,
          name: linkLabel(url),
        });
      }
      const persistList: PendingAttachment[] = [...pending, ...liftedLinks];
      const kind = primaryCaptureKind(trimmed, persistList);
      const inspirationText =
        trimmed.length > 0 ? trimmed : fallbackTextForCaptureKind(kind);

      const tempId = makeLocalId("insp");
      const links = persistList
        .filter((p) => p.kind === "link" && p.url)
        .map((p) => p.url as string);
      const optimistic: PendingInspiration = {
        tempId,
        text: inspirationText,
        links,
        attachments: persistList.map((p) => ({ ...p })),
        kind,
        createdAt: new Date().toISOString(),
      };

      // 1. Tell the parent immediately so the history sidebar updates.
      onOptimisticAdd?.(optimistic);
      setSaving(true);

      try {
        // 2. Persist the inspiration row first. Until this resolves we have
        //    no inspirationId to attach attachments to.
        const currentResonanceNote = resonanceNoteInputRef.current?.value ?? resonanceNote;
        const captureMetadataNote = buildCaptureMetadataNote({ resonance, resonanceNote: currentResonanceNote });
        const captureSparks =
          highlights.length > 0 || resonance || currentResonanceNote.trim().length > 0
            ? highlights.length > 0
              ? highlights.map((item, index) => ({
                  text: item.text,
                  source: "user_selected" as const,
                  startOffset: item.startOffset,
                  endOffset: item.endOffset,
                  confidence: 100,
                  isPrimary: index === 0,
                  note: index === 0 ? captureMetadataNote : undefined,
                }))
              : [
                  {
                    text: inspirationText.slice(0, 4096),
                    source: "user_written" as const,
                    confidence: resonance ? 90 : 80,
                    isPrimary: true,
                    note: captureMetadataNote,
                  },
                ]
            : undefined;
        const inspiration = await createInspiration({
          text: inspirationText,
          kind,
          ...(captureSparks ? { sparks: captureSparks } : {}),
          ...(reflectiveAnswers.length > 0
            ? {
                reflections: reflectiveAnswers.map((item) => ({
                  question: item.question,
                  answer: item.answer,
                  skipped: false,
                })),
              }
            : {}),
        });

        const savedReflectionCount = reflectiveAnswers.length;

        // 3. Fan out each attachment. We persist in parallel because they
        //    don't depend on one another. `Promise.allSettled` lets a single
        //    bad upload (e.g. timed-out S3 PUT) coexist with successful
        //    siblings instead of taking the whole batch down.
        const results = await Promise.allSettled(
          persistList.map((p) => persistAttachment(inspiration.id, p)),
        );

        const attachments: ApiAttachment[] = [];
        const failed: Array<{ localId: string; error: ApiError }> = [];
        results.forEach((res, i) => {
          const att = persistList[i];
          if (!att) return;
          if (res.status === "fulfilled") {
            attachments.push(res.value);
          } else {
            const reason = res.reason as unknown;
            const err =
              reason instanceof ApiError
                ? reason
                : new ApiError({
                    status: 0,
                    message:
                      reason instanceof Error
                        ? reason.message
                        : "Attachment upload failed",
                  });
            failed.push({ localId: att.localId, error: err });
          }
        });

        // 4. Hand the canonical result back to the parent so it can swap
        //    the optimistic row for the server row.
        onPersisted?.(tempId, {
          inspiration,
          attachments,
          reflectionCount: savedReflectionCount,
          failedAttachments: failed,
        });

        // 5. Reset local state. Revoke any blob URLs we minted.
        for (const p of pending) {
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        }
        setNote("");
        setHighlights([]);
        setPendingHighlight(null);
        setHighlightPopoverPosition(null);
        setHighlightDetailsOpen(false);
        setResonance(null);
        setResonanceNote("");
        setReflectionAnswer("");
        setReflectionStepIndex(0);
        setGuidedReflectionAnswers([]);
        setActiveView("note");
        setPostSaveReflectionTargetId(savedReflectionCount > 0 ? null : inspiration.id);
        setReflectGlow(savedReflectionCount > 0);
        if (reflectGlowTimerRef.current) clearTimeout(reflectGlowTimerRef.current);
        if (savedReflectionCount > 0) {
          reflectGlowTimerRef.current = setTimeout(() => {
            setReflectGlow(false);
            reflectGlowTimerRef.current = null;
          }, 1800);
        }
        setPending([]);
        if (draftWriteTimerRef.current) {
          clearTimeout(draftWriteTimerRef.current);
          draftWriteTimerRef.current = null;
        }
        clearStoredCaptureDraft();
        if (failed.length > 0) {
          // Partial save: keep the surface open so the user sees the warning.
          flashConfirm(formatMessage(locale, "partialAttachmentFailure", { count: failed.length }), 2800);
        } else {
          // Full success: hand off to the parent, which closes the capture
          // surface and flashes an ephemeral "saved" confirmation on the
          // capture button (no in-cell post-save mirror).
          setPostSaveReflectionTargetId(null);
          onSaved?.();
        }
      } catch (err) {
        const error =
          err instanceof ApiError
            ? err
            : new ApiError({
                status: 0,
                message:
                  err instanceof Error
                    ? err.message
                    : t(locale, "reflectionSaveError"),
              });
        onPersistError?.(tempId, error);
        flashConfirm(error.message, 2800);
      } finally {
        setSaving(false);
      }
    }, [
      locale,
      note,
      pending,
      highlights,
      resonance,
      saving,
      onOptimisticAdd,
      onPersisted,
      onPersistError,
      flashConfirm,
      onDismissAfterSave,
      onSaved,
    ]);

    const handleStartReflectiveSave = useCallback((): void => {
      if (saving) return;
      if (note.trim().length === 0 && pending.length === 0) return;
      const firstFallback = fallbackGuidedQuestion(0);
      setPostSaveReflectionTargetId(null);
      setGuidedReflectionAnswers([]);
      setGuidedReflectionQuestions([]);
      setReflectionStepIndex(0);
      setReflectionAnswer("");
      setActiveView("reflect");
      setReflectGlow(false);
      onToggleFocus?.(true);
      const requestId = guidedReflectionRequestSeqRef.current + 1;
      guidedReflectionRequestSeqRef.current = requestId;
      void requestGuidedQuestion([], []).then(
        (question) => {
          if (guidedReflectionRequestSeqRef.current !== requestId) return;
          setGuidedReflectionQuestions([question]);
        },
        () => {
          if (guidedReflectionRequestSeqRef.current !== requestId) return;
          setGuidedReflectionQuestions([firstFallback]);
        },
      );
      queueMicrotask(() => {
        document.querySelector<HTMLTextAreaElement>("#reflectAns")?.focus();
      });
    }, [fallbackGuidedQuestion, note, pending, requestGuidedQuestion, saving, onToggleFocus]);

    const buildGuidedReflectionPayload = useCallback((answers: string[]): GuidedReflectionPayload => {
      return answers
        .map((answer, index) => ({
          question: guidedReflectionQuestions[index] ?? fallbackGuidedQuestion(index),
          answer: answer.trim(),
        }))
        .filter((item) => item.question.trim().length > 0 && item.answer.length > 0);
    }, [fallbackGuidedQuestion, guidedReflectionQuestions]);

    const handleGuidedReflectionBack = useCallback((): void => {
      if (saving) return;
      if (reflectionStepIndex === 0) {
        setActiveView("note");
        setPostSaveReflectionTargetId(null);
        return;
      }
      setGuidedReflectionAnswers((current) => {
        const nextAnswers = [...current];
        nextAnswers[reflectionStepIndex] = reflectionAnswer;
        const previousIndex = reflectionStepIndex - 1;
        setReflectionAnswer(nextAnswers[previousIndex] ?? "");
        setReflectionStepIndex(previousIndex);
        return nextAnswers;
      });
      queueMicrotask(() => {
        document.querySelector<HTMLTextAreaElement>("#reflectAns")?.focus();
      });
    }, [reflectionAnswer, reflectionStepIndex, saving]);

    const handleGuidedReflectionNext = useCallback((): void => {
      if (saving) return;
      const answer = reflectionAnswer.trim();
      if (activeView === "reflect" && !postSaveReflectionTargetId && !guidedReflectionQuestions[reflectionStepIndex]) {
        return;
      }
      if (answer.length === 0) {
        flashConfirm(t(locale, "addThoughtBeforeReflectiveSave"), 2600);
        return;
      }

      const nextAnswers = [...guidedReflectionAnswers];
      nextAnswers[reflectionStepIndex] = answer;
      setGuidedReflectionAnswers(nextAnswers);

      const isFinalStep = reflectionStepIndex === GUIDED_REFLECTION_MAX_STEPS - 1;
      if (isFinalStep) {
        void triggerSave({ reflection: buildGuidedReflectionPayload(nextAnswers) });
        return;
      }

      const nextStepIndex = reflectionStepIndex + 1;
      const nextFallback = fallbackGuidedQuestion(nextStepIndex);
      const questionsSnapshot = guidedReflectionQuestions.slice(0, nextStepIndex);
      setGuidedReflectionQuestions(questionsSnapshot);
      setReflectionStepIndex(nextStepIndex);
      setReflectionAnswer(nextAnswers[nextStepIndex] ?? "");
      const requestId = guidedReflectionRequestSeqRef.current + 1;
      guidedReflectionRequestSeqRef.current = requestId;
      void requestGuidedQuestion(nextAnswers, questionsSnapshot).then(
        (question) => {
          if (guidedReflectionRequestSeqRef.current !== requestId) return;
          setGuidedReflectionQuestions((current) => {
            const updated = [...current];
            updated[nextStepIndex] = question;
            return updated;
          });
        },
        () => {
          if (guidedReflectionRequestSeqRef.current !== requestId) return;
          setGuidedReflectionQuestions((current) => {
            const updated = [...current];
            updated[nextStepIndex] = nextFallback;
            return updated;
          });
        },
      );
      queueMicrotask(() => {
        document.querySelector<HTMLTextAreaElement>("#reflectAns")?.focus();
      });
    }, [
      activeView,
      buildGuidedReflectionPayload,
      fallbackGuidedQuestion,
      flashConfirm,
      guidedReflectionAnswers,
      postSaveReflectionTargetId,
      guidedReflectionQuestions,
      locale,
      reflectionAnswer,
      reflectionStepIndex,
      requestGuidedQuestion,
      saving,
      triggerSave,
    ]);

    const savePostSaveReflection = useCallback(async (): Promise<void> => {
      if (!postSaveReflectionTargetId || saving) return;
      const answer = reflectionAnswer.trim();
      if (answer.length === 0) {
        flashConfirm(t(locale, "addThoughtBeforeReflectiveSave"), 2600);
        return;
      }
      setSaving(true);
      try {
        await createReflection(postSaveReflectionTargetId, {
          question: t(locale, "reflectionQuestion"),
          answer,
          skipped: false,
        });
        setReflectionAnswer("");
        setPostSaveReflectionTargetId(null);
        setActiveView("note");
        setReflectGlow(true);
        if (reflectGlowTimerRef.current) clearTimeout(reflectGlowTimerRef.current);
        reflectGlowTimerRef.current = setTimeout(() => {
          setReflectGlow(false);
          reflectGlowTimerRef.current = null;
        }, 1800);
        onSaved?.();
      } catch (err) {
        const error =
          err instanceof ApiError
            ? err
            : new ApiError({
                status: 0,
                message:
                  err instanceof Error
                    ? err.message
                    : t(locale, "reflectionSaveError"),
              });
        flashConfirm(error.message, 2800);
      } finally {
        setSaving(false);
      }
    }, [
      flashConfirm,
      locale,
      onDismissAfterSave,
      onSaved,
      postSaveReflectionTargetId,
      reflectionAnswer,
      saving,
    ]);

    const handleReflectAnswerKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          if (postSaveReflectionTargetId) void savePostSaveReflection();
          else handleGuidedReflectionNext();
        }
        if (event.key === "Escape" && focused) {
          event.preventDefault();
          onToggleFocus?.(false);
        }
      },
      [
        focused,
        onToggleFocus,
        postSaveReflectionTargetId,
        savePostSaveReflection,
        handleGuidedReflectionNext,
      ],
    );

    /* --------------------------------------------------------
     * Derived flags
     * -------------------------------------------------------- */

    const saveVisible =
      !saving && (note.trim().length > 0 || pending.length > 0);
    const guidedReflectionInProgress = activeView === "reflect" && !postSaveReflectionTargetId;
    const reflectStepCount = GUIDED_REFLECTION_MAX_STEPS;
    const reflectQuestion = postSaveReflectionTargetId
      ? t(locale, "reflectionQuestion")
      : guidedReflectionQuestions[reflectionStepIndex];
    const guidedReflectionQuestionLoading = guidedReflectionInProgress && !reflectQuestion;
    const reflectProgress = formatMessage(locale, "guidedReflectionProgress", {
      current: reflectionStepIndex + 1,
      total: reflectStepCount,
    });
    const reflectProgressPercent = Math.round(((reflectionStepIndex + 1) / reflectStepCount) * 100);

    /* --------------------------------------------------------
     * Render
     * -------------------------------------------------------- */

    return (
      <CaptureCell
        ref={ref}
        view={activeView}
        visualState={{ ...visualState, focused, reflectGlow }}
        noteValue={note}
        noteHighlights={highlights}
        onRemoveNoteHighlight={(index) => {
          setHighlights((current) => current.filter((_, itemIndex) => itemIndex !== index));
        }}
        noteSelectionToolbar={
          pendingHighlight && highlightPopoverPosition ? (
            <div
              className="cap-selection-toolbar"
              style={{
                ["--highlight-top" as string]: `${highlightPopoverPosition.top}px`,
                ["--highlight-left" as string]: `${highlightPopoverPosition.left}px`,
              }}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setHighlights((current) => {
                    const withoutOverlaps = current.filter(
                      (item) =>
                        item.endOffset <= pendingHighlight.startOffset ||
                        item.startOffset >= pendingHighlight.endOffset,
                    );
                    return [...withoutOverlaps, pendingHighlight].sort((a, b) => a.startOffset - b.startOffset);
                  });
                  const textarea = document.querySelector<HTMLTextAreaElement>("#capNote");
                  textarea?.setSelectionRange(pendingHighlight.endOffset, pendingHighlight.endOffset);
                  textarea?.focus();
                  setPendingHighlight(null);
                  setHighlightPopoverPosition(null);
                }}
                aria-label={t(locale, "captureHighlightSelectionLabel")}
                title={t(locale, "captureHighlightSelectionLabel")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 11-6 6v4h4l6-6" />
                  <path d="m22 12-7.5 7.5L4.5 9.5 12 2l10 10Z" />
                </svg>
                <span>{t(locale, "captureHighlightSelectionText")}</span>
              </button>
            </div>
          ) : null
        }
        notePlaceholder={t(locale, "capturePlaceholder")}
        onNoteChange={handleNoteChange}
        onNotePaste={handleNotePaste}
        onNoteSelect={handleNoteSelect}
        onNoteKeyDown={handleNoteKeyDown}
        saveVisible={saveVisible}
        onSave={() => {
          void triggerSave();
        }}
        onReflectiveSave={handleStartReflectiveSave}
        processSaveLabel={t(locale, "processThisInspiration")}
        processSaveInProgress={guidedReflectionInProgress}
        processSaveInProgressLabel={t(locale, "reflectDeeperInProgress")}
        processSaveTitle={t(locale, "processSaveTitle")}
        quickSaveLabel={t(locale, "quickSave")}
        quickSaveTitle={t(locale, "quickSaveTitle")}
        focusModeLabel={t(locale, "focusMode")}
        enterFocusModeLabel={t(locale, "enterFocusMode")}
        exitFocusModeLabel={t(locale, "exitFocusMode")}
        doneLabel={t(locale, "done")}
        continueLabel={reflectionStepIndex === reflectStepCount - 1 && !postSaveReflectionTargetId ? t(locale, "guidedReflectionSave") : t(locale, "continue")}
        focused={focused}
        onToggleFocus={onToggleFocus}
        onFileSelect={addFile}
        confirmVisible={confirmVisible}
        confirmMessage={confirmMessage}
        captureMeta={
          <div className="cap-meta" id="capMeta">
            <span className="cap-draft-state" id="capDraftState">
              {t(locale, "captureTip")}
            </span>
          </div>
        }
        reflectQuestion={
          <>
            {guidedReflectionQuestionLoading ? (
              <span className="reflect-question-loading" role="status" aria-live="polite">
                <span className="reflect-question-spinner" aria-hidden="true" />
                <span className="sr-only">{t(locale, "guidedReflectionLoading")}</span>
              </span>
            ) : (
              <>
                <span className="reflect-kicker">{guidedReflectionInProgress ? t(locale, "reflectDeeperInProgress") : t(locale, "processThisInspiration")}</span>
                {reflectQuestion}
              </>
            )}
            {guidedReflectionInProgress ? (
              <span
                className="reflect-progress"
                role="progressbar"
                aria-label={reflectProgress}
                aria-valuemin={0}
                aria-valuemax={reflectStepCount}
                aria-valuenow={reflectionStepIndex + 1}
                style={{ ["--reflect-progress" as string]: `${reflectProgressPercent}%` }}
              >
                <span className="reflect-progress-track" aria-hidden="true">
                  <span className="reflect-progress-fill" />
                </span>
              </span>
            ) : null}
          </>
        }
        reflectValue={reflectionAnswer}
        onReflectChange={setReflectionAnswer}
        onReflectKeyDown={handleReflectAnswerKeyDown}
        reflectPlaceholder={t(locale, "reflectionPlaceholder")}
        reflectNextDisabled={guidedReflectionQuestionLoading}
        onReflectLater={() => {
          if (postSaveReflectionTargetId) {
            setActiveView("note");
            setPostSaveReflectionTargetId(null);
          } else {
            handleGuidedReflectionBack();
          }
        }}
        onReflectNext={() => {
          if (postSaveReflectionTargetId) void savePostSaveReflection();
          else handleGuidedReflectionNext();
        }}
        reflectComplete={reflectGlow ? t(locale, "savedWithReflection") : null}
        reflectCompleteVisible={reflectGlow}
        attachments={
          pending.length === 0
            ? null
            : pending.map((att) => (
                <AttachmentChip
                  key={att.localId}
                  attachment={att}
                  removeLabel={t(locale, "removeAttachment")}
                  onRemove={() => removeAttachment(att.localId)}
                />
              ))
        }
      />
    );
  },
);

/* ============================================================
 * Attachment chip — renders inside `cap-strip`. We co-locate this
 * with the form because (a) the chip's display rules are part of the
 * capture domain, and (b) the data shape (`PendingAttachment`) is local
 * to this module.
 * ============================================================ */

interface AttachmentChipProps {
  attachment: PendingAttachment;
  removeLabel: string;
  onRemove: () => void;
}

function AttachmentChip({
  attachment,
  removeLabel,
  onRemove,
}: AttachmentChipProps): JSX.Element {
  // The prototype renders link chips as `<a>` and image / file chips as
  // `<div>` — same `.att` class either way. We mirror that branch here so
  // the existing CSS (in `index.html` lines 478–496) cascades unchanged.
  const handleRemove = (
    event: React.MouseEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    onRemove();
  };

  if (attachment.kind === "link" && attachment.url) {
    return (
      <a
        className="att"
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        data-url={attachment.url}
      >
        <span className="att-url">{attachment.name ?? attachment.url}</span>
        <button
          type="button"
          className="att-x"
          aria-label={removeLabel}
          onClick={handleRemove}
        >
          ×
        </button>
      </a>
    );
  }

  return (
    <div className="att">
      {attachment.kind === "image" && attachment.previewUrl ? (
        <img
          className="att-thumb"
          src={attachment.previewUrl}
          alt={attachment.name ?? ""}
        />
      ) : null}
      <span className="att-name">{attachment.name ?? "file"}</span>
      <button
        type="button"
        className="att-x"
        aria-label={removeLabel}
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}

export default CaptureForm;
