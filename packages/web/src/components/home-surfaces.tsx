import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";

import type {
  ApiError,
  ApiReflection,
  ApiSavedSignalDetail,
  ApiSavedSignalSearchResult,
  CreateReflectionResponse,
} from "../lib/api";
import {
  buildReflectionAnalysis,
  deriveTitleFromText,
} from "../lib/inspiration-detail";
import { t, type SupportedLocale } from "../lib/locales";
import { ReflectionForm, type PendingReflection } from "./history/ReflectionForm";

interface SavedInspirationDetailProps {
  signal: ApiSavedSignalSearchResult;
  detail: ApiSavedSignalDetail | null;
  loading: boolean;
  reflections: ApiReflection[];
  reflectionsLoading: boolean;
  reflectionError: string | null;
  locale: SupportedLocale;
  backLabel: string;
  highlightError: string | null;
  sourceText: ReactNode;
  selectionPopover: ReactNode;
  existingHighlightPopover: ReactNode;
  onBack: () => void;
  onTextMouseUp: (event: MouseEvent<HTMLElement>) => void;
  onTextKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  formatTimestamp: (date: string) => string;
  signalSourceLabel: (signal: ApiSavedSignalSearchResult) => string | null;
  reflectionComposerOpen: boolean;
  onToggleReflectionComposer: () => void;
  onCloseReflectionComposer: () => void;
  onReflectionOptimisticAdd: (pending: PendingReflection) => void;
  onReflectionPersisted: (tempId: string, server: CreateReflectionResponse) => void;
  onReflectionPersistError: (tempId: string, error: ApiError) => void;
}

export function SavedInspirationDetail({
  signal,
  detail,
  loading,
  reflections,
  reflectionsLoading,
  reflectionError,
  locale,
  backLabel,
  highlightError,
  sourceText,
  selectionPopover,
  existingHighlightPopover,
  onBack,
  onTextMouseUp,
  onTextKeyUp,
  formatTimestamp,
  signalSourceLabel,
  reflectionComposerOpen,
  onToggleReflectionComposer,
  onCloseReflectionComposer,
  onReflectionOptimisticAdd,
  onReflectionPersisted,
  onReflectionPersistError,
}: SavedInspirationDetailProps): JSX.Element {
  const sourceLabel = signalSourceLabel(signal);
  const meta = [sourceLabel, formatTimestamp(signal.capturedAt)].filter(Boolean).join(" · ");
  const sourceTextValue = detail?.rawText ?? signal.textPreview;
  const title = deriveTitleFromText(sourceTextValue, locale);
  const attachments = detail?.attachments.length
    ? detail.attachments.map((attachment) => ({
        id: attachment.id,
        type: attachment.type,
        url: attachment.url ?? null,
        label: `${attachment.label}${
          attachment.contentType || attachment.size
            ? ` · ${[attachment.contentType, attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : null]
                .filter(Boolean)
                .join(" · ")}`
            : ""
        }`,
      }))
    : signal.attachmentSummary.map((attachment) => ({
        ...attachment,
        url: null,
      }));
  const primaryAttachment = attachments[0] ?? null;
  const primaryImageUrl = primaryAttachment?.type === "image" ? primaryAttachment.url : null;
  const links = attachments
    .filter((attachment) => attachment.type === "link" && attachment.url)
    .map((attachment) => ({
      id: attachment.id,
      href: attachment.url as string,
      label: attachment.label || (attachment.url as string),
    }));
  const analysis = buildReflectionAnalysis(reflections, title, locale);

  return (
    <div
      className="memory-stack-detail memory-stack-detail--mockup signal-revisit-detail signal-revisit-detail--open"
      aria-label="opened inspiration"
    >
      <button
        type="button"
        className="memory-detail-close"
        onClick={onBack}
        aria-label="Close inspiration detail"
      >
        ×
      </button>

      <section className="memory-detail-hero" aria-labelledby="savedInspirationDetailTitle">
        <div className="memory-detail-source-card">
          {primaryImageUrl ? (
            <img src={primaryImageUrl} alt="" className="memory-detail-source-image" loading="lazy" />
          ) : (
            <div className="memory-detail-source-placeholder" aria-hidden="true">
              <span>{primaryAttachment?.label ?? sourceLabel ?? "Saved inspiration"}</span>
            </div>
          )}
          {primaryAttachment ? (
            <div className="memory-detail-source-caption">
              <span>{primaryAttachment.label}</span>
            </div>
          ) : null}
        </div>

        <header className="memory-detail-head memory-detail-head--mockup">
          <button
            type="button"
            className="memory-contents-back memory-workspace-back"
            onClick={onBack}
          >
            ← back to {backLabel}
          </button>
          <span>saved inspiration</span>
          <h2 id="savedInspirationDetailTitle">{title}</h2>
          <p>{meta}</p>
        </header>
      </section>

      {loading ? <p className="signal-revisit-state" role="status">Opening the inspiration...</p> : null}
      <div className="detail-editor-actions detail-reflect-cta-row">
        <button
          type="button"
          className="detail-save-button"
          onClick={onToggleReflectionComposer}
          aria-expanded={reflectionComposerOpen}
        >
          {t(locale, "reflectDeeperCta")}
        </button>
      </div>
      {links.length > 0 ? (
        <section className="memory-detail-link" aria-label={t(locale, "detailSavedLink")}>
          <span>{t(locale, "linkChipPrefix")}</span>
          {links.map((link) => (
            <a key={link.id} href={link.href} target="_blank" rel="noreferrer">
              {link.label === link.href ? link.href : `${link.label} — ${link.href}`}
            </a>
          ))}
        </section>
      ) : (
        <section className="memory-stack-readable memory-stack-readable--mockup" aria-label={t(locale, "detailInspirationDetails")}>
          <span>{t(locale, "detailInspirationDetails")}</span>
          <p
            className="signal-revisit-raw memory-readable-signal"
            onMouseUp={onTextMouseUp}
            onKeyUp={onTextKeyUp}
          >
            {sourceText}
          </p>
        </section>
      )}
      {reflectionComposerOpen ? (
        <ReflectionForm
          key={`saved-reflection-${signal.id}`}
          inspirationId={signal.id}
          defaultQuestion={t(locale, "reflectDeeperDefaultQuestion")}
          locale={locale}
          onCancel={onCloseReflectionComposer}
          onOptimisticAdd={onReflectionOptimisticAdd}
          onPersisted={onReflectionPersisted}
          onPersistError={onReflectionPersistError}
        />
      ) : null}
      {reflectionsLoading ? (
        <p className="signal-revisit-state" role="status">{t(locale, "reflectDeeperLoading")}</p>
      ) : null}
      {reflectionError ? <p className="signal-revisit-state" role="alert">{reflectionError}</p> : null}
      {analysis ? (
        <section
          className="memory-stack-readable memory-stack-readable--mockup memory-detail-reflections"
          aria-label={t(locale, "reflectDeeperSectionTitle")}
        >
          <span>{t(locale, "reflectDeeperSectionTitle")}</span>
          <p className="signal-revisit-state">{analysis.overview}</p>
          <ol className="signal-revisit-notes memory-detail-reflection-list">
            {analysis.bullets.map((bullet) => (
              <li className="thread-entry memory-detail-reflection-row" key={bullet}>
                <div className="thread-a">{bullet}</div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {selectionPopover}
      {existingHighlightPopover}
      {highlightError ? <p className="signal-revisit-state">{highlightError}</p> : null}
    </div>
  );
}
