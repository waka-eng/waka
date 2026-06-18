import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";

import type {
  ApiReflection,
  ApiSavedSignalDetail,
  ApiSavedSignalSearchResult,
} from "../lib/api";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";

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
  shortText: (text: string, maxLength: number) => string;
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
  shortText,
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
  const primaryUrl = primaryAttachment?.url ?? null;
  const answeredReflectionCount = reflections.filter((reflection) => !reflection.skipped).length;

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
          <h2 id="savedInspirationDetailTitle">{shortText(signal.textPreview, 132)}</h2>
          <p>{meta}</p>
        </header>
      </section>

      {loading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
      {primaryUrl ? (
        <section className="memory-detail-link" aria-label="Primary source link">
          <span>Link</span>
          <a href={primaryUrl} target="_blank" rel="noreferrer">
            {primaryUrl}
          </a>
        </section>
      ) : null}
      <section className="memory-stack-readable memory-stack-readable--mockup" aria-label="Highlights">
        <span>Highlights</span>
        <p
          className="signal-revisit-raw memory-readable-signal"
          onMouseUp={onTextMouseUp}
          onKeyUp={onTextKeyUp}
        >
          {sourceText}
        </p>
      </section>
      {reflectionsLoading ? (
        <p className="signal-revisit-state">{t(locale, "reflectDeeperLoading")}</p>
      ) : null}
      {reflectionError ? <p className="signal-revisit-state">{reflectionError}</p> : null}
      {reflections.length > 0 ? (
        <section
          className="memory-stack-readable memory-stack-readable--mockup memory-detail-reflections"
          aria-label={t(locale, "reflectDeeperSectionTitle")}
        >
          <span>{t(locale, "reflectDeeperSectionTitle")}</span>
          <p className="signal-revisit-state">
            {formatMessage(locale, "reflectDeeperCount", {
              answered: answeredReflectionCount,
              total: reflections.length,
            })}
          </p>
          <ol className="signal-revisit-notes memory-detail-reflection-list">
            {reflections.map((reflection, index) => (
              <li className="thread-entry memory-detail-reflection-row" key={reflection.id}>
                <div className="thread-q">
                  <span className="memory-detail-reflection-label">
                    {formatMessage(locale, "reflectDeeperQuestionLabel", { index: index + 1 })}
                  </span>{" "}
                  {reflection.question}
                </div>
                <div className={`thread-a${reflection.skipped ? " skipped" : ""}`}>
                  <span className="memory-detail-reflection-label">
                    {t(locale, "reflectDeeperAnswerLabel")}
                  </span>{" "}
                  {reflection.skipped || !reflection.answer
                    ? t(locale, "reflectDeeperSkipped")
                    : reflection.answer}
                </div>
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
