import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";

import type {
  ApiFeedbackValue,
  ApiSavedSignalDetail,
  ApiSavedSignalSearchResult,
} from "../lib/api";

export type SavedDetailFeedbackValue = Extract<
  ApiFeedbackValue,
  "important" | "partly" | "not_important"
>;

export type SavedDetailFeedbackState = {
  value: SavedDetailFeedbackValue | null;
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
};

interface SavedInspirationDetailProps {
  signal: ApiSavedSignalSearchResult;
  detail: ApiSavedSignalDetail | null;
  loading: boolean;
  relatedGroupNames: string[];
  backLabel: string;
  activeFeedback: SavedDetailFeedbackState | undefined;
  highlightError: string | null;
  sourceText: ReactNode;
  selectionPopover: ReactNode;
  existingHighlightPopover: ReactNode;
  onBack: () => void;
  onTextMouseUp: (event: MouseEvent<HTMLElement>) => void;
  onTextKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
  onSubmitFeedback: (value: SavedDetailFeedbackValue) => void;
  formatTimestamp: (date: string) => string;
  signalSourceLabel: (signal: ApiSavedSignalSearchResult) => string | null;
  shortText: (text: string, maxLength: number) => string;
}

const REFLECTION_PROMPTS = [
  "what did this mean then?",
  "what does it mean now?",
  "is this still me?",
] as const;

const FEEDBACK_CHOICES: Array<{ value: SavedDetailFeedbackValue; label: string }> = [
  { value: "important", label: "still alive" },
  { value: "partly", label: "changed shape" },
  { value: "not_important", label: "not anymore" },
];

export function SavedInspirationDetail({
  signal,
  detail,
  loading,
  relatedGroupNames,
  backLabel,
  activeFeedback,
  highlightError,
  sourceText,
  selectionPopover,
  existingHighlightPopover,
  onBack,
  onTextMouseUp,
  onTextKeyUp,
  onSubmitFeedback,
  formatTimestamp,
  signalSourceLabel,
  shortText,
}: SavedInspirationDetailProps): JSX.Element {
  const latestFeedback = detail?.resonanceFeedback[0] ?? null;
  const activeFeedbackValue = activeFeedback?.value ?? latestFeedback?.value ?? null;
  const meta = [signalSourceLabel(signal), formatTimestamp(signal.capturedAt)].filter(Boolean).join(" · ");
  const attachments = detail?.attachments.length
    ? detail.attachments.map((attachment) => ({
        id: attachment.id,
        label: `${attachment.label}${
          attachment.contentType || attachment.size
            ? ` · ${[attachment.contentType, attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : null]
                .filter(Boolean)
                .join(" · ")}`
            : ""
        }`,
      }))
    : signal.attachmentSummary;

  return (
    <div className="memory-stack-detail signal-revisit-detail signal-revisit-detail--open" aria-label="opened inspiration">
      <header className="memory-detail-head">
        <button
          type="button"
          className="memory-contents-back memory-workspace-back"
          onClick={onBack}
        >
          ← back to {backLabel}
        </button>
        <span>saved inspiration</span>
        <h2>{shortText(signal.textPreview, 86)}</h2>
        <p>{meta}</p>
      </header>
      {loading ? <p className="signal-revisit-state">Opening the inspiration...</p> : null}
      <section className="memory-stack-readable">
        <p
          className="signal-revisit-raw memory-readable-signal"
          onMouseUp={onTextMouseUp}
          onKeyUp={onTextKeyUp}
        >
          {sourceText}
        </p>
      </section>
      {selectionPopover}
      {existingHighlightPopover}
      {highlightError ? <p className="signal-revisit-state">{highlightError}</p> : null}
      <section className="memory-detail-prompts" aria-label="reflection prompts">
        {REFLECTION_PROMPTS.map((prompt) => (
          <p key={prompt}>{prompt}</p>
        ))}
      </section>
      <section className="memory-detail-feedback" aria-label="does this still fit?">
        <span>does this still fit?</span>
        <div className="memory-detail-feedback-actions">
          {FEEDBACK_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={activeFeedbackValue === choice.value ? "memory-detail-feedback-choice--active" : undefined}
              disabled={activeFeedback?.status === "saving"}
              onClick={() => onSubmitFeedback(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {activeFeedback?.status === "saving" ? <p>saving...</p> : null}
        {activeFeedback?.status === "saved" ? <p>saved</p> : null}
        {activeFeedback?.status === "error" ? <p>{activeFeedback.error}</p> : null}
      </section>
      {attachments.length > 0 ? (
        <section>
          <span>attachment details</span>
          <ul className="signal-revisit-notes">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <strong>{attachment.label}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="memory-detail-nearby">
        <span>nearby piles</span>
        <p>{relatedGroupNames.length > 0 ? relatedGroupNames.join(", ") : "no clear pile has claimed this yet"}</p>
      </section>
    </div>
  );
}
