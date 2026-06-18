/**
 * <InspirationDetail /> — single-inspiration detail view rendered inside
 * the history drawer's `.detail-view` shell.
 *
 * Replaces the prototype's `renderDetail(item)` (index.html lines 2628-2698)
 * with a declarative component that:
 *
 *   1. Renders the mockup-style source/preview hero, primary link, and
 *      editable Highlights area, and any saved Reflect Deeper responses.
 *   2. Keeps the close/back/delete and next-inspiration navigation affordances
 *      available without reviving the prototype's broader lower context panels.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  deleteInspiration,
  fetchReflections,
  updateInspiration,
  type CreateReflectionResponse,
  type ApiAttachment,
  type ApiInspiration,
  type ApiReflection,
} from "../../lib/api";
import {
  buildReflectionAnalysis,
  deriveInspirationTitle,
  firstNonEmpty,
  reflectionDefaultQuestion,
} from "../../lib/inspiration-detail";
import { DEFAULT_LOCALE, t, type SupportedLocale } from "../../lib/locales";
import { ReflectionForm, type PendingReflection } from "./ReflectionForm";

/* ============================================================
 * Types
 * ============================================================ */

/**
 * The minimum inspiration shape the detail view needs to render its
 * header / body. Mirrors the fields the prototype's `renderDetail`
 * touches (index.html line 2628). The detail view does NOT depend on
 * the full `ApiInspiration` shape so a parent that only has a card-row
 * representation can still mount the component.
 */
export interface InspirationDetailData {
  /** Server-assigned uuid. Drives the reflection fetch URL. */
  id: string;
  /** Inspiration text body. May be empty. */
  text: string;
  /** Optional list of link URLs attached to the inspiration. */
  links?: string[] | null;
  /** Optional attachments (image / file / link). */
  attachments?: ApiAttachment[] | null;
  /** Pre-formatted timestamp string for the meta row. */
  timestamp: string;
  /** Optional transient save status copy retained for compatibility. */
  kind?: string | null;
  /** Optional non-blocking warning copy for saved rows with partial attachment loss. */
  warningMessage?: string | null;
}

export interface InspirationDetailProps {
  /** The inspiration being inspected. Required — the component wouldn't
   *  have anything to render without it. */
  inspiration: InspirationDetailData;
  /** Fires when the user clicks "← Back" in the detail header. */
  onBack: () => void;
  /**
   * Fires when the user confirms a delete and the DELETE round-trip
   * resolves successfully. The parent uses this to drop the row from the
   * history list and close the detail view. The component DOES NOT close
   * itself — the parent owns the navigation state — so a parent that
   * wants to keep the detail open (e.g. for an undo affordance in a
   * later AC) can do so.
   *
   * Optional: when omitted, the delete affordance is hidden so the
   * component can still be mounted in a read-only context.
   */
  onDeleted?: (id: string) => void;
  /** Fires after editing details returns the canonical inspiration row. */
  onInspirationUpdated?: (inspiration: ApiInspiration) => void;
  /** Locale for user-visible attachment status copy. */
  locale?: SupportedLocale;
  /** Move to the next inspiration in the parent list/order. Hidden when omitted. */
  onNextInspiration?: () => void;
}

/* ============================================================
 * Component
 * ============================================================ */

function attachmentTitle(attachment: ApiAttachment, locale: SupportedLocale): string {
  const link = attachment.enrichment?.link;
  if (attachment.type === "link") {
    const title = link?.title?.trim();
    return title || link?.hostname || attachment.url || t(locale, "detailSavedLink");
  }
  if (attachment.type === "image") {
    return attachment.enrichment?.image?.filename ?? attachment.name ?? t(locale, "detailUploadedImage");
  }
  return attachment.name ?? t(locale, "detailAttachedFile");
}

function attachmentMeta(attachment: ApiAttachment, locale: SupportedLocale): string {
  const enrichment = attachment.enrichment;
  if (!enrichment) return t(locale, "attachmentPreviewUnavailable");
  if (enrichment.status === "pending") return t(locale, "attachmentPreviewPending");
  if (enrichment.status === "failed" || enrichment.status === "unavailable") return t(locale, "attachmentPreviewUnavailable");
  if (attachment.type === "link") {
    const host = enrichment.link?.hostname;
    const source = enrichment.source === "url" ? t(locale, "attachmentSourceUrl") : enrichment.source;
    return [host, source].filter(Boolean).join(" · ") || t(locale, "attachmentSourceUrl");
  }
  const image = enrichment.image;
  const size = image?.size ?? attachment.size;
  const sizeLabel = typeof size === "number" && size > 0 ? `${Math.ceil(size / 1024)} KB` : null;
  const source = enrichment.source === "user_upload" ? t(locale, "attachmentSourceUserUpload") : enrichment.source;
  return [attachment.contentType, sizeLabel, source].filter(Boolean).join(" · ") || t(locale, "attachmentSourceUserUpload");
}

function detailTitle(inspiration: InspirationDetailData, locale: SupportedLocale): string {
  return deriveInspirationTitle(inspiration.text, locale);
}

function detailDescription(inspiration: InspirationDetailData): string | null {
  return firstNonEmpty(
    ...(inspiration.attachments ?? []).map((attachment) =>
      attachment.type === "link" ? attachment.enrichment?.link?.description : null,
    ),
  );
}

function primaryAttachment(inspiration: InspirationDetailData): ApiAttachment | null {
  const attachments = inspiration.attachments ?? [];
  return (
    attachments.find((attachment) => attachment.type === "link" && attachment.enrichment?.link) ??
    attachments.find((attachment) => attachment.type === "image" && attachment.url) ??
    attachments[0] ??
    null
  );
}

function previewImageUrl(attachment: ApiAttachment | null): string | null {
  if (!attachment) return null;
  if (attachment.type === "link") return attachment.enrichment?.link?.previewImageUrl ?? null;
  if (attachment.type === "image") return attachment.url ?? null;
  return null;
}

export function InspirationDetail({
  inspiration,
  onBack,
  onDeleted,
  onInspirationUpdated,
  locale = DEFAULT_LOCALE,
  onNextInspiration,
}: InspirationDetailProps): JSX.Element {
  const [detailsText, setDetailsText] = useState(inspiration.text);
  const [saveState, setSaveState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  /**
   * Two-stage confirmation for the destructive delete affordance:
   *   - idle             → "Delete" pill in the header.
   *   - confirming       → swap the pill for "Confirm? · Cancel" so the
   *                         user has to click a second button to proceed.
   *                         An accidental click on the first pill never
   *                         destroys data.
   *   - deleting         → in-flight indicator; both buttons disabled.
   *   - error            → kept inline so the user can retry without
   *                         leaving the detail view.
   *
   * We deliberately avoid `window.confirm()`: the prototype's design
   * language has its own .close-confirm modal vocabulary, and a native
   * confirm dialog would clash with the WAKA visual rhythm. An inline
   * two-step is also faster to dismiss with the keyboard.
   */
  const [deleteState, setDeleteState] = useState<
    | { status: "idle" }
    | { status: "confirming" }
    | { status: "deleting" }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [reflectionState, setReflectionState] = useState<
    | { status: "loading"; reflections: ApiReflection[] }
    | { status: "loaded"; reflections: ApiReflection[] }
    | { status: "error"; reflections: ApiReflection[]; message: string }
  >({ status: "loading", reflections: [] });
  const [reflectionComposerOpen, setReflectionComposerOpen] = useState(false);
  const [reflectionComposerError, setReflectionComposerError] = useState<string | null>(null);
  useEffect(() => {
    // Reset the delete affordance whenever the user navigates to a
    // different inspiration so a half-confirmed delete on row A doesn't
    // bleed into row B.
    setDeleteState({ status: "idle" });
    setDetailsText(inspiration.text);
    setSaveState({ status: "idle" });
    setReflectionComposerOpen(false);
    setReflectionComposerError(null);
  }, [inspiration.id, inspiration.text]);

  useEffect(() => {
    let cancelled = false;
    setReflectionState({ status: "loading", reflections: [] });
    void (async () => {
      try {
        const reflections = await fetchReflections(inspiration.id);
        if (!cancelled) setReflectionState({ status: "loaded", reflections });
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : t(locale, "reflectionLoadError");
        setReflectionState({ status: "error", reflections: [], message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspiration.id, locale]);

  const detailsChanged = detailsText !== inspiration.text;
  const detailsEmpty = detailsText.trim().length === 0;
  const sourceLinks = useMemo(() => {
    const links = [
      ...(inspiration.attachments ?? [])
        .filter((attachment) => attachment.type === "link")
        .map((attachment) => attachment.enrichment?.link?.finalUrl ?? attachment.url),
      ...(inspiration.links ?? []),
    ]
      .map((link) => link?.trim())
      .filter((link): link is string => Boolean(link));
    return Array.from(new Set(links));
  }, [inspiration.attachments, inspiration.links]);
  const heroTitle = useMemo(() => detailTitle(inspiration, locale), [inspiration, locale]);
  const heroDescription = useMemo(() => detailDescription(inspiration), [inspiration]);
  const featuredAttachment = useMemo(() => primaryAttachment(inspiration), [inspiration]);
  const featuredPreview = previewImageUrl(featuredAttachment);
  const reflectionAnalysis = useMemo(
    () => buildReflectionAnalysis(reflectionState.reflections, locale),
    [locale, reflectionState.reflections],
  );

  const handleSaveDetails = useCallback(() => {
    const nextText = detailsText.trim();
    if (!nextText || saveState.status === "saving") return;

    setSaveState({ status: "saving" });
    void (async () => {
      try {
        const updated = await updateInspiration(inspiration.id, { text: nextText });
        setDetailsText(updated.text);
        setSaveState({ status: "saved" });
        onInspirationUpdated?.(updated);
      } catch (caught) {
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : t(locale, "detailSaveError");
        setSaveState({ status: "error", message });
      }
    })();
  }, [detailsText, inspiration.id, locale, onInspirationUpdated, saveState.status]);

  // ----- Delete handlers ---------------------------------------------------

  const handleDeleteClick = useCallback(() => {
    setDeleteState((prev) =>
      prev.status === "idle" || prev.status === "error"
        ? { status: "confirming" }
        : prev,
    );
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeleteState({ status: "idle" });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    setDeleteState({ status: "deleting" });
    void (async () => {
      try {
        await deleteInspiration(inspiration.id);
        // Parent owns the post-delete navigation: dropping the row from
        // the list and dismissing the detail view. Do NOT call setState
        // afterwards — the parent will unmount us.
        onDeleted?.(inspiration.id);
      } catch (caught) {
        const message =
          caught instanceof ApiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : t(locale, "detailDeleteError");
        setDeleteState({ status: "error", message });
      }
    })();
  }, [inspiration.id, locale, onDeleted]);

  const addPendingReflection = useCallback((pending: PendingReflection) => {
    const optimistic: ApiReflection = {
      id: pending.tempId,
      inspirationId: pending.inspirationId,
      userId: "",
      question: pending.question,
      answer: pending.answer,
      skipped: pending.skipped,
      createdAt: pending.createdAt,
    };
    setReflectionComposerError(null);
    setReflectionState((prev) => ({
      status: "loaded",
      reflections: [...prev.reflections, optimistic],
    }));
  }, []);

  const replacePendingReflection = useCallback((tempId: string, server: CreateReflectionResponse) => {
    setReflectionState((prev) => ({
      status: "loaded",
      reflections: prev.reflections.map((reflection) =>
        reflection.id === tempId ? server.reflection : reflection,
      ),
    }));
    setReflectionComposerOpen(false);
  }, []);

  const removePendingReflection = useCallback((tempId: string, error: ApiError) => {
    setReflectionState((prev) => {
      const reflections = prev.reflections.filter((reflection) => reflection.id !== tempId);
      return prev.status === "error"
        ? { status: "error", reflections, message: prev.message }
        : { status: "loaded", reflections };
    });
    setReflectionComposerError(error.message);
  }, []);

  return (
    <div className="detail-view detail-view--mockup visible" id="detailView">
      <div className="detail-head detail-head--balanced">
        <div className="detail-head-inner">
          <button
            type="button"
            className="detail-back"
            id="detailBack"
            onClick={onBack}
            aria-label={t(locale, "detailBackSignals")}
          >
            ← {t(locale, "detailBack")}
          </button>
          {/* Inline two-stage delete pill. Hidden when `onDeleted` is not
              wired so a read-only mount of the detail view stays read-only. */}
          {onDeleted ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
            {deleteState.status === "idle" || deleteState.status === "error" ? (
              <button
                type="button"
                onClick={handleDeleteClick}
                aria-label={t(locale, "detailDelete")}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  letterSpacing: "inherit",
                  textTransform: "inherit",
                }}
              >
                {t(locale, "detailDelete")}
              </button>
            ) : null}

            {deleteState.status === "confirming" ? (
              <>
                <span
                  // Live region so screen readers announce the destructive
                  // confirmation step the moment it appears.
                  role="status"
                  aria-live="polite"
                  style={{ color: "var(--muted)" }}
                >
                  {t(locale, "detailConfirmDelete")}?
                </span>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  aria-label={t(locale, "detailConfirmDelete")}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "6px 14px",
                    color: "var(--ink)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                  }}
                >
                  {t(locale, "detailConfirmDelete")}
                </button>
                <button
                  type="button"
                  onClick={handleCancelDelete}
                  aria-label={t(locale, "detailCancelDelete")}
                  style={{
                    background: "transparent",
                    border: "1px solid transparent",
                    borderRadius: 999,
                    padding: "6px 10px",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                  }}
                >
                  {t(locale, "detailCancelDelete")}
                </button>
              </>
            ) : null}

            {deleteState.status === "deleting" ? (
              <span
                role="status"
                aria-live="polite"
                style={{ color: "var(--muted)" }}
              >
                {t(locale, "detailDeleting")}
              </span>
            ) : null}

            {deleteState.status === "error" ? (
              <span
                role="alert"
                aria-live="polite"
                style={{
                  color: "var(--muted)",
                  textTransform: "none",
                  letterSpacing: 0,
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                }}
              >
                {deleteState.message}
              </span>
            ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="detail-body" id="detailBody">
        <section className="detail-hero" aria-labelledby="inspirationDetailTitle">
          <div className="detail-hero-copy">
            <h1 id="inspirationDetailTitle" className="detail-title">
              {heroTitle}
            </h1>
            <div className="detail-meta detail-meta--hero">
              {featuredAttachment?.enrichment?.link?.hostname ? `${featuredAttachment.enrichment.link.hostname} · ` : ""}
              {t(locale, "saved")} {inspiration.timestamp}
            </div>
            {heroDescription && sourceLinks.length === 0 ? (
              <p className="detail-hero-description">{heroDescription}</p>
            ) : null}
          </div>

          {featuredPreview && sourceLinks.length === 0 ? (
            <div className="detail-media-card">
              <img
                src={featuredPreview}
                alt=""
                className="detail-media-image"
                loading="lazy"
              />
              {featuredAttachment ? (
                <div className="detail-media-caption">
                  <span>{attachmentTitle(featuredAttachment, locale)}</span>
                  <small>{attachmentMeta(featuredAttachment, locale)}</small>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {sourceLinks.length > 0 ? (
          <section className="detail-links-section" aria-label={t(locale, "detailSavedLink")}>
            <div className="detail-section-label">{t(locale, "linkChipPrefix")}</div>
            <div className="detail-reflections-list">
              {sourceLinks.map((link) => (
                <a
                  key={link}
                  className="detail-primary-link"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link}
                </a>
              ))}
            </div>
          </section>
        ) : (
          <section className="detail-links-section" aria-label={t(locale, "detailInspirationDetails")}>
            <div className="detail-section-label">{t(locale, "detailInspirationDetails")}</div>
            <p className="detail-hero-description">{inspiration.text}</p>
          </section>
        )}

        <section className="detail-reflections-section" aria-label={t(locale, "reflectionDetailCta")}>
          <div className="detail-section-label">{t(locale, "reflectionDetailCta")}</div>
          <p className="detail-reflection-status">{t(locale, "reflectionDetailIntro")}</p>
          {reflectionComposerOpen ? (
            <ReflectionForm
              inspirationId={inspiration.id}
              defaultQuestion={reflectionDefaultQuestion(locale)}
              locale={locale}
              onCancel={() => setReflectionComposerOpen(false)}
              onOptimisticAdd={addPendingReflection}
              onPersisted={replacePendingReflection}
              onPersistError={removePendingReflection}
            />
          ) : (
            <button
              type="button"
              className="detail-save-button"
              onClick={() => {
                setReflectionComposerError(null);
                setReflectionComposerOpen(true);
              }}
            >
              {t(locale, "reflectionDetailCta")}
            </button>
          )}
          {reflectionComposerError ? (
            <p className="detail-reflection-status" role="alert">{reflectionComposerError}</p>
          ) : null}
        </section>

        <form
          className="detail-editor"
          aria-label={t(locale, "detailInspirationDetails")}
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveDetails();
          }}
        >
          <label
            htmlFor="inspirationDetailText"
            className="detail-section-label detail-section-title"
          >
            {t(locale, "detailInspirationDetails")}
          </label>
          <textarea
            id="inspirationDetailText"
            value={detailsText}
            onChange={(event) => {
              setDetailsText(event.currentTarget.value);
              if (saveState.status !== "idle") setSaveState({ status: "idle" });
            }}
            rows={7}
            aria-label={t(locale, "detailInspirationDetails")}
            className="detail-text detail-textarea"
          />
          <div className="detail-editor-actions">
            <button
              type="submit"
              disabled={!detailsChanged || detailsEmpty || saveState.status === "saving"}
              className="detail-save-button"
            >
              {saveState.status === "saving" ? t(locale, "detailSaving") : t(locale, "detailSaveDetails")}
            </button>
            {saveState.status === "saved" ? (
              <span role="status" aria-live="polite" className="detail-inline-status">
                {t(locale, "saved")}.
              </span>
            ) : null}
            {saveState.status === "error" ? (
              <span role="alert" aria-live="polite" className="detail-inline-status">
                {saveState.message}
              </span>
            ) : null}
          </div>
        </form>

        {reflectionState.status === "loading" ? (
          <section className="detail-reflections-section" aria-label={t(locale, "threadShowReflection")}>
            <div className="detail-section-label">{t(locale, "processThisInspiration")}</div>
            <p className="detail-reflection-status" role="status" aria-live="polite">{t(locale, "wowMomentsLoading")}</p>
          </section>
        ) : null}

        {reflectionState.status === "error" ? (
          <section className="detail-reflections-section" aria-label={t(locale, "threadShowReflection")}>
            <div className="detail-section-label">{t(locale, "processThisInspiration")}</div>
            <p className="detail-reflection-status" role="alert">{reflectionState.message}</p>
          </section>
        ) : null}

        {reflectionState.status === "loaded" && reflectionAnalysis ? (
          <section className="detail-reflections-section" aria-label={t(locale, "threadShowReflection")}>
            <div className="detail-section-label">{reflectionAnalysis.title}</div>
            <p className="detail-reflection-status">{reflectionAnalysis.summary}</p>
            <ul className="signal-revisit-notes memory-detail-reflection-list">
              {reflectionAnalysis.insights.map((insight) => (
                <li key={insight} className="thread-entry memory-detail-reflection-row">
                  <span className="memory-detail-reflection-label">
                    {t(locale, "reflectionAnalysisInsightLabel")}
                  </span>{" "}
                  {insight}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {onNextInspiration ? (
          <button
            type="button"
            className="detail-next-button"
            onClick={onNextInspiration}
            aria-label={t(locale, "detailViewNext")}
          >
            {t(locale, "detailViewNext")} <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default InspirationDetail;
