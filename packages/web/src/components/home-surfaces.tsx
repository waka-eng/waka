import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";

import type {
  CreateReflectionResponse,
  ApiReflection,
  ApiSavedSignalDetail,
  ApiSavedSignalSearchResult,
  ApiError,
} from "../lib/api";
import {
  buildReflectionAnalysis,
  deriveInspirationTitle,
  reflectionDefaultQuestion,
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
  onReflectionOptimisticAdd: (pending: PendingReflection) => void;
  onReflectionPersisted: (tempId: string, server: CreateReflectionResponse) => void;
  onReflectionPersistError: (tempId: string, error: ApiError) => void;
  onBack: () => void;
  onTextMouseUp: (event: MouseEvent<HTMLElement>) => void;
  onTextKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  formatTimestamp: (date: string) => string;
  signalSourceLabel: (signal: ApiSavedSignalSearchResult) => string | null;
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
  onReflectionOptimisticAdd,
  onReflectionPersisted,
  onReflectionPersistError,
  onBack,
  onTextMouseUp,
  onTextKeyUp,
  formatTimestamp,
  signalSourceLabel,
}: SavedInspirationDetailProps): JSX.Element {
  const sourceLabel = signalSourceLabel(signal);
  const meta = [sourceLabel, formatTimestamp(signal.capturedAt)].filter(Boolean).join(" · ");
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
  const sourceLinks = Array.from(
    new Set(
      attachments
        .filter((attachment) => attachment.type === "link" && attachment.url)
        .map((attachment) => attachment.url as string),
    ),
  );
  const analysis = buildReflectionAnalysis(reflections, locale);

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
          <h2 id="savedInspirationDetailTitle">{deriveInspirationTitle(signal.textPreview, locale)}</h2>
          <p>{meta}</p>
        </header>
      </section>

      {loading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
      {sourceLinks.length > 0 ? (
        <section className="memory-detail-link" aria-label={t(locale, "detailSavedLink")}>
          <span>{t(locale, "linkChipPrefix")}</span>
          {sourceLinks.map((link) => (
            <a key={link} href={link} target="_blank" rel="noreferrer">
              {link}
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

      <section className="memory-stack-readable memory-stack-readable--mockup memory-detail-reflections" aria-label={t(locale, "reflectionDetailCta")}>
        <span>{t(locale, "reflectionDetailCta")}</span>
        <p className="signal-revisit-state">{t(locale, "reflectionDetailIntro")}</p>
        <ReflectionForm
          inspirationId={signal.id}
          defaultQuestion={reflectionDefaultQuestion(locale)}
          locale={locale}
          autoFocus={false}
          onOptimisticAdd={onReflectionOptimisticAdd}
          onPersisted={onReflectionPersisted}
          onPersistError={onReflectionPersistError}
        />
      </section>
      {reflectionsLoading ? (
        <p className="signal-revisit-state">{t(locale, "reflectDeeperLoading")}</p>
      ) : null}
      {reflectionError ? <p className="signal-revisit-state">{reflectionError}</p> : null}
      {analysis ? (
        <section
          className="memory-stack-readable memory-stack-readable--mockup memory-detail-reflections"
          aria-label={analysis.title}
        >
          <span>{analysis.title}</span>
          <p className="signal-revisit-state">{analysis.summary}</p>
          <ul className="signal-revisit-notes memory-detail-reflection-list">
            {analysis.insights.map((insight) => (
              <li className="thread-entry memory-detail-reflection-row" key={insight}>
                <span className="memory-detail-reflection-label">
                  {t(locale, "reflectionAnalysisInsightLabel")}
                </span>{" "}
                {insight}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {selectionPopover}
      {existingHighlightPopover}
      {highlightError ? <p className="signal-revisit-state">{highlightError}</p> : null}
    </div>
  );
}
