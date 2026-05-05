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
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  ApiError,
  createInspiration,
  finalizeAttachment,
  presignAttachment,
  uploadToPresignedUrl,
  type ApiAttachment,
  type ApiInspiration,
} from "../../lib/api";
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
  /** ISO timestamp of when the user clicked Save. */
  createdAt: string;
}

export interface PersistedResult {
  inspiration: ApiInspiration;
  attachments: ApiAttachment[];
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
    },
    ref,
  ): JSX.Element {
    /* --------------------------------------------------------
     * Local state
     * -------------------------------------------------------- */

    const [note, setNote] = useState("");
    const [pending, setPending] = useState<PendingAttachment[]>([]);
    const [saving, setSaving] = useState(false);
    /**
     * Confirmation / error message displayed in `cap-confirm`. The cell
     * keeps the overlay mounted but hides it via `.visible`; we drive that
     * by toggling the message on/off on a timer.
     */
    const [confirmMessage, setConfirmMessage] = useState<ReactNode>(null);
    const [confirmVisible, setConfirmVisible] = useState(false);
    const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup the confirm timer when the component unmounts. Without this an
    // in-flight setTimeout would fire `setState` on an unmounted instance.
    useEffect(() => {
      return () => {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
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

    /* --------------------------------------------------------
     * Attachment management
     * -------------------------------------------------------- */

    const addFile = useCallback((file: File): void => {
      // Image vs generic file matches the prototype's `handleFile` policy:
      // anything starting with `image/` becomes a thumbnail, everything else
      // is rendered as a name-only chip.
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      setPending((prev) => [
        ...prev,
        {
          localId: makeLocalId("att"),
          kind: isImage ? "image" : "file",
          file,
          name: file.name,
          previewUrl,
        },
      ]);
    }, []);

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
    }, []);

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
    const triggerSave = useCallback(async (): Promise<void> => {
      if (saving) return;
      const trimmed = note.trim();
      if (trimmed.length === 0 && pending.length === 0) return;

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

      const tempId = makeLocalId("insp");
      const links = persistList
        .filter((p) => p.kind === "link" && p.url)
        .map((p) => p.url as string);
      const optimistic: PendingInspiration = {
        tempId,
        text: trimmed,
        links,
        attachments: persistList.map((p) => ({ ...p })),
        createdAt: new Date().toISOString(),
      };

      // 1. Tell the parent immediately so the history sidebar updates.
      onOptimisticAdd?.(optimistic);
      setSaving(true);

      try {
        // 2. Persist the inspiration row first. Until this resolves we have
        //    no inspirationId to attach attachments to.
        const inspiration = await createInspiration({
          text: trimmed.length > 0 ? trimmed : "(attachment-only inspiration)",
        });

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
          failedAttachments: failed,
        });

        // 5. Reset local state. Revoke any blob URLs we minted.
        for (const p of pending) {
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        }
        setNote("");
        setPending([]);
        if (failed.length > 0) {
          flashConfirm(
            `Saved — ${failed.length} attachment${
              failed.length === 1 ? "" : "s"
            } failed`,
            2400,
          );
        } else {
          flashConfirm("Saved");
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
                    : "Failed to save inspiration",
              });
        onPersistError?.(tempId, error);
        flashConfirm(error.message, 2800);
      } finally {
        setSaving(false);
      }
    }, [
      note,
      pending,
      saving,
      onOptimisticAdd,
      onPersisted,
      onPersistError,
      flashConfirm,
    ]);

    /* --------------------------------------------------------
     * Derived flags
     * -------------------------------------------------------- */

    const saveVisible =
      !saving && (note.trim().length > 0 || pending.length > 0);

    /* --------------------------------------------------------
     * Render
     * -------------------------------------------------------- */

    return (
      <CaptureCell
        ref={ref}
        view={view}
        visualState={visualState}
        noteValue={note}
        onNoteChange={handleNoteChange}
        onNoteKeyDown={handleNoteKeyDown}
        saveVisible={saveVisible}
        onSave={() => {
          void triggerSave();
        }}
        focused={focused}
        onToggleFocus={onToggleFocus}
        onFileSelect={addFile}
        confirmVisible={confirmVisible}
        confirmMessage={confirmMessage}
        attachments={
          pending.length === 0
            ? null
            : pending.map((att) => (
                <AttachmentChip
                  key={att.localId}
                  attachment={att}
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
  onRemove: () => void;
}

function AttachmentChip({
  attachment,
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
          aria-label="Remove attachment"
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
        aria-label="Remove attachment"
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}

export default CaptureForm;
