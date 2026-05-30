/**
 * <InspirationCard /> — single saved-inspiration card (history-list entry).
 *
 * Ports the prototype's `history-item` markup verbatim. In `index.html` the
 * markup is built imperatively in `renderHistory()` (lines 2553–2602):
 *
 *   <div class="history-item" data-id="…">
 *     <div class="history-item-text">…note text…</div>
 *     <div class="history-item-links">
 *       <a href="…" target="_blank" rel="noopener">hostname</a>
 *       …
 *     </div>
 *     <div class="history-item-meta">saving · 2 days ago · …</div>
 *     <div class="history-item-reflections">2 of 3 reflected</div>
 *   </div>
 *
 * Interaction contract (preserved 1:1 with the prototype):
 *
 *   • The card is a clickable surface — `cursor: pointer`, hover background
 *     tint, hover border on the cluster chip. The `onSelect` prop fires when
 *     the card is activated.
 *   • Link chips inside `.history-item-links` are interactive `<a>` elements
 *     that open in a new tab. Clicks on a link MUST NOT bubble up and trigger
 *     the card's `onSelect` — the prototype calls `e.stopPropagation()` on
 *     the link element; we replicate that here.
 *   • Keyboard activation (Enter / Space) is added to bring the prototype's
 *     pointer-only behavior up to React-router-app baseline accessibility,
 *     without altering the visual contract. The DOM remains a `<div>` so the
 *     existing `.history-item` selectors still match — `role="button"` plus
 *     `tabIndex=0` make it focusable and AT-readable.
 *
 * Why a `<div>` and not `<article>` / `<button>`?
 *   The prototype's CSS targets `.history-item` exactly; switching the
 *   element changes the cascade weight (button defaults reset font/color)
 *   and breaks visual parity. Per Sub-AC 4.3.1 we preserve identical DOM
 *   structure and CSS classes.
 *
 * The component is intentionally presentational. Data shape parity with the
 * prototype's `savedItems` entries lives in `InspirationCardData` so the
 * eventual API hook can map server records into props with one transform.
 */

import { useCallback, useMemo, type KeyboardEvent, type MouseEvent } from "react";

import type { ApiAttachment } from "../lib/api";
import { DEFAULT_LOCALE, t, type SupportedLocale } from "../lib/locales";

/**
 * Shape of a single inspiration as the card consumes it. Mirrors the
 * prototype's `savedItems` entry — fields that aren't present on a given
 * record are simply omitted, matching the `if(item.field)` gates in
 * `renderHistory()`.
 */
export interface InspirationCardData {
  /** Stable unique id; surfaced in `data-id` for click-target tracing. */
  id: string;
  /** Free-form note text. Rendered in `.history-item-text` if present. */
  text?: string | null;
  /** Attached link URLs. Rendered as hostname chips in `.history-item-links`. */
  links?: string[] | null;
  /** Attached link/image/file context for attachment-first card previews. */
  attachments?: ApiAttachment[] | null;
  /** Human-readable timestamp (e.g. "2 days ago"). Joined into the meta row. */
  timestamp?: string | null;
  /** Optional transient save status label (e.g. "saving", "save failed"). */
  kind?: string | null;
  /** Optional non-blocking warning copy for saved rows with partial attachment loss. */
  warningMessage?: string | null;
  /** Number of reflections that have been answered (i.e. `!skipped`). */
  reflectionsAnswered?: number;
  /** Total reflections attached to this inspiration. */
  reflectionsTotal?: number;
}

export interface InspirationCardProps {
  /** Inspiration record to render. */
  item: InspirationCardData;
  /** Current UI locale for user/AT-facing copy. */
  locale?: SupportedLocale;
  /**
   * Fires when the user activates the card (click, Enter, or Space).
   * Receives the card's id so the parent doesn't need to close over it.
   */
  onSelect?: (id: string) => void;
}

/**
 * Best-effort URL → hostname formatter. Falls back to the raw URL when
 * parsing fails — matches the prototype's `try { new URL(u).hostname } catch
 * { u }` block so visual output is byte-for-byte identical for malformed
 * inputs.
 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isSystemFallbackText(text: string | null | undefined, kind: string | null | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;
  if (trimmed === "(attachment-only inspiration)") return true;
  if (trimmed === "(attachment-only signal)") return true;
  if (kind === "link" && trimmed === "Link inspiration") return true;
  if (kind === "link" && trimmed === "Link signal") return true;
  if (kind === "image" && trimmed === "Image inspiration") return true;
  if (kind === "image" && trimmed === "Image signal") return true;
  if (kind === "mixed" && trimmed === "Mixed inspiration") return true;
  if (kind === "mixed" && trimmed === "Mixed signal") return true;
  return false;
}

function attachmentTitle(attachment: ApiAttachment): string {
  if (attachment.type === "link") {
    const link = attachment.enrichment?.link;
    return link?.title?.trim() || link?.hostname || attachment.url || attachment.name || "Link";
  }
  return attachment.enrichment?.image?.filename ?? attachment.name ?? "Image";
}

function attachmentMeta(attachment: ApiAttachment): string | null {
  if (attachment.type === "link") {
    return attachment.enrichment?.link?.hostname ?? (attachment.url ? hostnameOf(attachment.url) : null);
  }
  const size = attachment.enrichment?.image?.size ?? attachment.size;
  const sizeLabel = typeof size === "number" && size > 0 ? `${Math.ceil(size / 1024)} KB` : null;
  return [attachment.contentType, sizeLabel].filter(Boolean).join(" · ") || null;
}

export function InspirationCard({
  item,
  locale = DEFAULT_LOCALE,
  onSelect,
}: InspirationCardProps): JSX.Element {
  const {
    id,
    text,
    links,
    attachments,
    timestamp,
    kind,
    warningMessage,
    reflectionsAnswered = 0,
    reflectionsTotal = 0,
  } = item;

  /**
   * Build the meta row from transient save state and timestamp only. Backend
   * inspiration kind/category/cluster metadata intentionally stays out of the
   * product UI.
   */
  const metaText = useMemo(() => {
    const parts: string[] = [];
    if (kind && !["note", "link", "image", "mixed"].includes(kind)) parts.push(kind);
    if (timestamp) parts.push(timestamp);
    return parts.join(" · ");
  }, [kind, timestamp]);

  const handleActivate = useCallback(() => {
    onSelect?.(id);
  }, [id, onSelect]);

  /**
   * Keyboard parity: Enter or Space activate, mirroring native button
   * semantics. We call `preventDefault` on Space so the page doesn't scroll
   * — the same defensive gesture native buttons take.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleActivate();
      }
    },
    [handleActivate],
  );

  /**
   * Stop link-chip clicks from bubbling to the card — the prototype's
   * `a.addEventListener('click', e => e.stopPropagation())` ensures clicking
   * a link only opens the URL and does not also push the user into the
   * inspiration's detail view.
   */
  const stopPropagation = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const hasLinks = Array.isArray(links) && links.length > 0;
  const visibleAttachments = Array.isArray(attachments) ? attachments : [];
  const hasAttachmentContext = visibleAttachments.length > 0;
  const showText = Boolean(text && !(hasAttachmentContext && isSystemFallbackText(text, kind)));
  const hasReflections = reflectionsTotal > 0;

  return (
    <div
      className="history-item"
      data-id={id}
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      {showText ? <div className="history-item-text">{text}</div> : null}

      {hasAttachmentContext ? (
        <div className="history-attachments" aria-label={t(locale, "attachmentContext")}>
          {visibleAttachments.map((attachment) => {
            const meta = attachmentMeta(attachment);
            return (
              <div key={attachment.id} className="history-attachment">
                <span className="history-attachment-title">{attachmentTitle(attachment)}</span>
                {meta ? <span className="history-attachment-meta">{meta}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {hasLinks ? (
        <div className="history-item-links">
          {links!.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stopPropagation}
            >
              {hostnameOf(url)}
            </a>
          ))}
        </div>
      ) : null}

      {metaText ? (
        <div className="history-item-meta">{metaText}</div>
      ) : null}

      {warningMessage ? (
        <div className="history-item-warning" role="status" aria-live="polite">
          {warningMessage}
        </div>
      ) : null}

      {hasReflections ? (
        <div className="history-item-reflections">
          {reflectionsAnswered} of {reflectionsTotal} reflected
        </div>
      ) : null}
    </div>
  );
}

export default InspirationCard;
