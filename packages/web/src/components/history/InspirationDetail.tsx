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
  generateGuidedReflectionQuestion,
  updateInspiration,
  type ApiAttachment,
  type ApiInspiration,
  type ApiInspirationKind,
  type ApiReflection,
  type CreateReflectionResponse,
} from "../../lib/api";
import {
  buildReflectionAnalysis,
  deriveTitleFromText,
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

function mergeReflectionsPreservingLocal(
  incoming: ApiReflection[],
  local: ApiReflection[],
): ApiReflection[] {
  const merged = new Map<string, ApiReflection>();
  for (const reflection of incoming) merged.set(reflection.id, reflection);
  for (const reflection of local) merged.set(reflection.id, reflection);
  return Array.from(merged.values());
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

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function detailTitle(inspiration: InspirationDetailData, locale: SupportedLocale): string {
  return deriveTitleFromText(inspiration.text, locale);
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

function normalizeInspirationKind(kind: string | null | undefined): ApiInspirationKind {
  if (kind === "link" || kind === "image" || kind === "mixed") return kind;
  return "note";
}

function attachmentKindForQuestion(attachment: ApiAttachment): "link" | "image" | "file" {
  if (attachment.type === "link" || attachment.type === "image") return attachment.type;
  return "file";
}

function linkAttachments(inspiration: InspirationDetailData): Array<{ id: string; href: string; label: string }> {
  const fromAttachments = (inspiration.attachments ?? [])
    .filter((attachment) => attachment.type === "link")
    .map((attachment) => {
      const href = firstNonEmpty(
        attachment.enrichment?.link?.finalUrl,
        attachment.enrichment?.link?.originalUrl,
        attachment.url,
      );
      if (!href) return null;
      return {
        id: attachment.id,
        href,
        label: firstNonEmpty(attachment.enrichment?.link?.title, attachment.name, href) ?? href,
      };
    })
    .filter((link): link is { id: string; href: string; label: string } => link !== null);

  if (fromAttachments.length > 0) return fromAttachments;
  return (inspiration.links ?? [])
    .map((link, index) => {
      const href = link.trim();
      return href ? { id: `link-${index}`, href, label: href } : null;
    })
    .filter((link): link is { id: string; href: string; label: string } => link !== null);
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
  const [reflectionQuestionState, setReflectionQuestionState] = useState<
    | { status: "idle"; question: string }
    | { status: "loading"; question: string }
    | { status: "ready"; question: string }
    | { status: "fallback"; question: string }
  >({ status: "idle", question: t(locale, "reflectDeeperDefaultQuestion") });
  useEffect(() => {
    // Reset the delete affordance whenever the user navigates to a
    // different inspiration so a half-confirmed delete on row A doesn't
    // bleed into row B.
    setDeleteState({ status: "idle" });
    setDetailsText(inspiration.text);
    setSaveState({ status: "idle" });
    setReflectionComposerOpen(false);
    setReflectionQuestionState({ status: "idle", question: t(locale, "reflectDeeperDefaultQuestion") });
  }, [inspiration.id, inspiration.text, locale]);

  useEffect(() => {
    let cancelled = false;
    setReflectionState({ status: "loading", reflections: [] });
    void (async () => {
      try {
        const reflections = await fetchReflections(inspiration.id);
        if (!cancelled) {
          setReflectionState((prev) => ({
            status: "loaded",
            reflections: mergeReflectionsPreservingLocal(reflections, prev.reflections),
          }));
        }
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
  const sourceLinks = useMemo(() => linkAttachments(inspiration), [inspiration]);
  const heroTitle = useMemo(() => detailTitle(inspiration, locale), [inspiration, locale]);
  const heroDescription = useMemo(() => detailDescription(inspiration), [inspiration]);
  const featuredAttachment = useMemo(() => primaryAttachment(inspiration), [inspiration]);
  const featuredPreview = previewImageUrl(featuredAttachment);
  const analysis = useMemo(
    () => buildReflectionAnalysis(reflectionState.reflections, heroTitle, locale),
    [heroTitle, locale, reflectionState.reflections],
  );

  useEffect(() => {
    if (!reflectionComposerOpen) return;
    let cancelled = false;
    const fallbackQuestion = t(locale, "reflectDeeperDefaultQuestion");
    setReflectionQuestionState({ status: "loading", question: fallbackQuestion });
    void (async () => {
      try {
        const response = await generateGuidedReflectionQuestion({
          locale,
          inspiration: {
            text: detailsText.trim() || inspiration.text,
            kind: normalizeInspirationKind(inspiration.kind),
            links: sourceLinks.map((link) => link.href),
            attachmentKinds: (inspiration.attachments ?? []).map(attachmentKindForQuestion),
            highlights: [heroTitle, heroDescription].filter((value): value is string => Boolean(value?.trim())),
          },
          priorAnswers: reflectionState.reflections
            .filter((reflection) => !reflection.skipped && reflection.answer?.trim())
            .map((reflection) => ({
              question: reflection.question,
              answer: reflection.answer?.trim() ?? "",
            })),
        });
        if (cancelled) return;
        setReflectionQuestionState({
          status: response.source === "model" ? "ready" : "fallback",
          question: response.question.trim() || fallbackQuestion,
        });
      } catch {
        if (!cancelled) {
          setReflectionQuestionState({ status: "fallback", question: fallbackQuestion });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    detailsText,
    heroDescription,
    heroTitle,
    inspiration.attachments,
    inspiration.id,
    inspiration.kind,
    inspiration.text,
    locale,
    reflectionComposerOpen,
    reflectionState.reflections,
    sourceLinks,
  ]);

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

  const appendReflection = useCallback((reflection: ApiReflection) => {
    setReflectionState((prev) => {
      const reflections = [...prev.reflections.filter((item) => item.id !== reflection.id), reflection];
      if (prev.status === "error") return { status: "error", reflections, message: prev.message };
      return { status: "loaded", reflections };
    });
  }, []);

  const handleReflectionOptimisticAdd = useCallback((pending: PendingReflection) => {
    appendReflection({
      id: pending.tempId,
      inspirationId: pending.inspirationId,
      userId: "",
      question: pending.question,
      answer: pending.answer,
      skipped: pending.skipped,
      createdAt: pending.createdAt,
    });
  }, [appendReflection]);

  const handleReflectionPersisted = useCallback((tempId: string, server: CreateReflectionResponse) => {
    setReflectionState((prev) => {
      const replaced = prev.reflections.some((reflection) => reflection.id === tempId);
      const reflections = replaced
        ? prev.reflections.map((reflection) =>
          reflection.id === tempId ? server.reflection : reflection,
        )
        : mergeReflectionsPreservingLocal([server.reflection], prev.reflections);
      return { status: "loaded", reflections };
    });
    setReflectionComposerOpen(false);
  }, []);

  const handleReflectionPersistError = useCallback((tempId: string, error: ApiError) => {
    setReflectionState((prev) => ({
      status: "error",
      reflections: prev.reflections.filter((reflection) => reflection.id !== tempId),
      message: error.message,
    }));
  }, []);

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
          <h1 id="inspirationDetailTitle" className="detail-title detail-title--full-width">
            {heroTitle}
          </h1>

          <div className="detail-media-card">
            {featuredPreview ? (
              <img
                src={featuredPreview}
                alt=""
                className="detail-media-image"
                loading="lazy"
              />
            ) : (
              <div className="detail-media-placeholder" aria-hidden="true">
                <span>{featuredAttachment ? attachmentTitle(featuredAttachment, locale) : t(locale, "detailSavedSignal")}</span>
              </div>
            )}
            {featuredAttachment ? (
              <div className="detail-media-caption">
                <span>{attachmentTitle(featuredAttachment, locale)}</span>
                <small>{attachmentMeta(featuredAttachment, locale)}</small>
              </div>
            ) : null}
          </div>

          <div className="detail-hero-copy">
            <div className="detail-meta detail-meta--hero">
              {featuredAttachment?.enrichment?.link?.hostname ? `${featuredAttachment.enrichment.link.hostname} · ` : ""}
              {t(locale, "saved")} {inspiration.timestamp}
            </div>
            {heroDescription ? (
              <p className="detail-hero-description">{heroDescription}</p>
            ) : null}
          </div>
        </section>

        <div className="detail-editor-actions detail-reflect-cta-row">
          <button
            type="button"
            className="detail-save-button"
            onClick={() => setReflectionComposerOpen((open) => !open)}
            aria-expanded={reflectionComposerOpen}
          >
            {t(locale, "reflectDeeperCta")}
          </button>
        </div>

        {sourceLinks.length > 0 ? (
          <section className="detail-links-section" aria-label={t(locale, "detailSavedLink")}>
            <div className="detail-section-label">{t(locale, "linkChipPrefix")}</div>
            <div className="detail-reflections-list">
              {sourceLinks.map((link) => (
                <a
                  key={link.id}
                  className="detail-primary-link"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label === link.href ? link.href : `${link.label} — ${link.href}`}
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {reflectionComposerOpen ? (
          <ReflectionForm
            key={`reflection-${inspiration.id}`}
            inspirationId={inspiration.id}
            defaultQuestion={reflectionQuestionState.question}
            answerPlaceholder={
              reflectionQuestionState.status === "loading"
                ? t(locale, "reflectDeeperLoading")
                : undefined
            }
            locale={locale}
            onCancel={() => setReflectionComposerOpen(false)}
            onOptimisticAdd={handleReflectionOptimisticAdd}
            onPersisted={handleReflectionPersisted}
            onPersistError={handleReflectionPersistError}
          />
        ) : null}

        <form
          className="detail-editor"
          aria-label={t(locale, "detailInspirationDetails")}
          onSubmit={(event) => {
            event.preventDefault();
            handleSaveDetails();
          }}
        >
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
          <p className="detail-reflection-status" role="status" aria-live="polite">{t(locale, "reflectDeeperLoading")}</p>
        ) : null}

        {reflectionState.status === "error" ? (
          <p className="detail-reflection-status" role="alert">{reflectionState.message}</p>
        ) : null}

        {reflectionState.status === "loaded" && analysis ? (
          <section className="detail-reflections-section" aria-label={t(locale, "threadShowReflection")}>
            <div className="detail-section-label">{t(locale, "reflectDeeperSectionTitle")}</div>
            <p className="detail-reflection-status">{analysis.overview}</p>
            <div className="detail-reflections-list">
              {analysis.bullets.map((bullet) => (
                <article key={bullet} className="detail-reflection-card">
                  <p>{bullet}</p>
                </article>
              ))}
            </div>
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
