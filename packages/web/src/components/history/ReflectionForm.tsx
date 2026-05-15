/**
 * <ReflectionForm /> — wired question/answer composer for the inspiration
 * detail view.
 *
 * Sub-AC 9.4 lifts the reflection-mini-flow markup from the prototype
 * (index.html ~lines 2737+, surfaced via `.reflect-area` / `.reflect-bar`)
 * into a save-capable form: it owns the question and answer textareas, the
 * Save / Skip / Later affordances, and the POST round-trip to
 * `/inspirations/:id/reflections`.
 *
 * Optimistic state contract
 * -------------------------
 * The detail view needs to render a freshly-authored reflection in the
 * thread the *instant* the user clicks Save — before the API answers — so
 * the typing rhythm and the rendered rhythm stay aligned with the
 * prototype's feel. We meet that with three lifecycle callbacks, mirroring
 * the contract `<CaptureForm>` already implements for inspirations:
 *
 *   1. `onOptimisticAdd(pending)` fires immediately when Save (or Skip) is
 *      clicked. The parent unshifts / appends the pending row into its
 *      local `reflections` state. The pending row carries `tempId` so the
 *      parent can swap it for the canonical server row on success.
 *   2. `onPersisted(tempId, server)` fires when the POST resolves with
 *      201. The parent uses `tempId` to swap the pending row for the
 *      canonical `ApiReflection`.
 *   3. `onPersistError(tempId, error)` fires when the POST fails. The
 *      parent decides whether to drop the optimistic row (most common, so
 *      the user can retry without seeing a confusing duplicate) or keep
 *      it visible with a retry chip. We surface `ApiError` so the parent
 *      can branch on `status` (e.g. 401 → re-route to /login).
 *
 * The form deliberately does NOT mutate the parent's reflection list
 * itself — the detail view owns that data, and layering optimistic state
 * into a single owner keeps the cross-render guarantees (key stability,
 * ordering) easy to reason about. This mirrors the precedent set by
 * `<CaptureForm>` for inspirations.
 *
 * Skipped vs answered
 * -------------------
 * The schema permits three persistent reflection states:
 *
 *   - pending  : `answer = null`, `skipped = false`  (we don't write this
 *                state from this form — a pending reflection is one that
 *                exists without an answer; this form always *creates* a
 *                reflection, so either Save or Skip is required).
 *   - answered : `answer = "..."`, `skipped = false`
 *   - skipped  : `answer = null`,  `skipped = true`
 *
 * Save submits `{ question, answer }` and the server records `skipped =
 * false` by default. Skip submits `{ question, skipped: true }` and the
 * server records `answer = null`. Question is mandatory in both cases —
 * a skipped-without-question row would be meaningless.
 *
 * Visual contract
 * ---------------
 * The component renders inside the prototype's `.reflect-area` /
 * `.reflect-bar` skeleton (CSS lines 941-1044 in `global.css`). We avoid
 * the `.visible` modifier here because this form is mounted only when the
 * detail view chooses to show it — toggling visibility is the parent's
 * concern. The textarea uses `.reflect-answer`, the question prompt uses
 * `.reflect-question`, and the action row uses `.reflect-bar` with
 * `.reflect-btn` / `.reflect-later` / `.reflect-next` modifiers, all of
 * which already exist in `global.css` so we get the prototype's italic
 * serif rhythm and pill buttons for free.
 *
 * One deliberate divergence: the prototype shows a single fixed prompt
 * baked into JS state. Per the seed ontology, `question` is a property
 * of the row and is required at insert time, so we render the question
 * as an editable input above the answer when the parent has not supplied
 * one. When the parent passes `defaultQuestion`, the prompt renders as
 * the prototype's italic serif headline and is locked — the user reflects
 * against the supplied prompt without rephrasing it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import {
  ApiError,
  createReflection,
  type CreateReflectionResponse,
} from "../../lib/api";

/* ============================================================
 * Public types
 * ============================================================ */

/**
 * Optimistic reflection record handed to the parent the moment Save / Skip
 * is clicked. The parent inserts this into its local reflection list so
 * the user sees the new row before the server has answered. Once the POST
 * resolves, the parent uses `tempId` to swap this row for the canonical
 * `ApiReflection`.
 *
 * Mirrors `PendingInspiration` in shape so a future refactor that unifies
 * both optimistic-write contracts has a clean migration target.
 */
export interface PendingReflection {
  /** Synthetic id — replaced by the server uuid on success. */
  tempId: string;
  /** Parent inspiration id. Same string the form was mounted with. */
  inspirationId: string;
  /** Question text, post-trim. */
  question: string;
  /** Answer text, post-trim. `null` when the user skipped. */
  answer: string | null;
  /** `true` when the user clicked Skip; `false` when they clicked Save. */
  skipped: boolean;
  /** ISO timestamp of when the click landed. Useful for ordering. */
  createdAt: string;
}

export interface ReflectionFormProps {
  /**
   * Id of the parent inspiration. The form posts to
   * `/inspirations/:inspirationId/reflections`.
   */
  inspirationId: string;

  /**
   * Optional locked-in question. When provided, the form renders it as the
   * italic serif `.reflect-question` prompt and the user only fills in the
   * answer. When omitted, the user types both the question and the answer.
   */
  defaultQuestion?: string;

  /**
   * Initial answer text. Useful for an "edit" affordance that pre-fills the
   * draft. Defaults to empty.
   */
  defaultAnswer?: string;

  /** Optional placeholder for the answer textarea. */
  answerPlaceholder?: string;

  /** Optional placeholder for the question textarea (only shown when the
   *  parent did not lock-in a question via `defaultQuestion`). */
  questionPlaceholder?: string;

  /**
   * Auto-focus the answer textarea on mount. Defaults to true so the
   * detail view can mount the form and have the user start typing without
   * an extra click. Set to false in tests where focus would steal it from
   * the harness.
   */
  autoFocus?: boolean;

  /** Hide the Skip affordance. The user must answer or cancel. */
  hideSkip?: boolean;

  /** Optional Cancel button. When provided, renders alongside Save / Skip. */
  onCancel?: () => void;

  /** Fires immediately when Save / Skip lands a non-empty submission. */
  onOptimisticAdd?: (pending: PendingReflection) => void;
  /** Fires when the POST resolves with the canonical server row. */
  onPersisted?: (tempId: string, server: CreateReflectionResponse) => void;
  /** Fires when the POST fails (network or 4xx/5xx). */
  onPersistError?: (tempId: string, error: ApiError) => void;
}

/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * Synthetic id factory. We avoid `crypto.randomUUID()` to stay compatible
 * with older Safari / WebView runtimes the prototype targets — a 12-char
 * base36 token is more than enough collision resistance for client-only
 * keys that get replaced by a real server uuid within seconds. Mirrors the
 * helper inside `<CaptureForm>` so both forms emit the same id shape.
 */
function makeLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/* ============================================================
 * Component
 * ============================================================ */

export function ReflectionForm({
  inspirationId,
  defaultQuestion,
  defaultAnswer = "",
  answerPlaceholder = "answer here…",
  questionPlaceholder = "what does this make you ask?",
  autoFocus = true,
  hideSkip = false,
  onCancel,
  onOptimisticAdd,
  onPersisted,
  onPersistError,
}: ReflectionFormProps): JSX.Element {
  /* --------------------------------------------------------
   * Local state
   * -------------------------------------------------------- */

  /**
   * The question is editable only when the parent has not supplied one.
   * When `defaultQuestion` is set we render it as the locked prompt; the
   * user can only modify the answer.
   */
  const questionLocked = typeof defaultQuestion === "string";
  const [question, setQuestion] = useState<string>(defaultQuestion ?? "");
  const [answer, setAnswer] = useState<string>(defaultAnswer);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Tracks whether the component is still mounted so an in-flight POST
   * that resolves after unmount doesn't call `setState` on a dead
   * instance. The lifecycle callbacks (`onPersisted`, `onPersistError`)
   * still fire — the parent decides whether they're still relevant.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const questionTextareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Auto-focus on mount. We focus the answer textarea when a default
   * question is supplied (the typical detail-view path) and the question
   * textarea otherwise. Deferred via `queueMicrotask` so the focus call
   * lands after React has committed the DOM — matches the same gesture
   * `<InspirationsBoard>` uses for its capture cell.
   */
  useEffect(() => {
    if (!autoFocus) return;
    queueMicrotask(() => {
      if (questionLocked) {
        answerTextareaRef.current?.focus();
      } else {
        questionTextareaRef.current?.focus();
      }
    });
    // We deliberately want this to run exactly once on mount; the
    // `questionLocked` value is fixed for the lifetime of the form
    // because it derives from the (effectively static) `defaultQuestion`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset error / submitting state when the form is reused for a new
  // inspiration — the parent re-keys on `inspirationId`, but defending
  // against a non-keyed reuse pattern keeps the state machine honest.
  useEffect(() => {
    setError(null);
    setSubmitting(false);
  }, [inspirationId]);

  /* --------------------------------------------------------
   * Submit / skip handlers
   * -------------------------------------------------------- */

  /**
   * Shared submit core. Both Save and Skip funnel through this so the
   * optimistic-add → POST → persist/error contract has a single
   * implementation.
   *
   * @param skip  When true, posts `{ question, skipped: true }` and stores
   *              `answer = null` server-side. When false, posts
   *              `{ question, answer }`.
   */
  const submit = useCallback(
    async (skip: boolean) => {
      if (submitting) return;

      const trimmedQuestion = question.trim();
      if (trimmedQuestion.length === 0) {
        setError("Please enter a question to reflect on.");
        // Focus the question field if it's editable so the user can
        // address the validation without hunting for it.
        if (!questionLocked) {
          queueMicrotask(() => questionTextareaRef.current?.focus());
        }
        return;
      }

      const trimmedAnswer = answer.trim();
      if (!skip && trimmedAnswer.length === 0) {
        setError(
          hideSkip
            ? "Add a thought before saving this reflection."
            : "Add an answer or click Skip.",
        );
        queueMicrotask(() => answerTextareaRef.current?.focus());
        return;
      }

      const tempId = makeLocalId("reflection");
      const createdAt = new Date().toISOString();

      // 1. Optimistic add — emit *before* the network call so the parent
      //    renders the row instantly. The parent owns the swap on
      //    success.
      const pending: PendingReflection = {
        tempId,
        inspirationId,
        question: trimmedQuestion,
        answer: skip ? null : trimmedAnswer,
        skipped: skip,
        createdAt,
      };
      onOptimisticAdd?.(pending);

      setSubmitting(true);
      setError(null);

      // 2. POST. The body shape matches the server's zod schema. We
      //    deliberately do not send the `inspirationId` in the body —
      //    the server takes it from the URL path so a mismatched body /
      //    path cannot fool the ownership check.
      try {
        const server = await createReflection(inspirationId, {
          question: trimmedQuestion,
          ...(skip ? { skipped: true } : { answer: trimmedAnswer }),
        });

        // 3a. Success. Tell the parent to swap the optimistic row for
        //     the canonical server row, then reset the form so the user
        //     can author another reflection without an extra click. We
        //     keep the question locked-in if the parent supplied one;
        //     otherwise we clear both fields.
        onPersisted?.(tempId, server);

        if (mountedRef.current) {
          setAnswer("");
          if (!questionLocked) setQuestion("");
          setSubmitting(false);
        }
      } catch (caught) {
        // 3b. Failure. Wrap unknown errors in `ApiError` so the parent
        //     callback gets a stable shape. Any non-`ApiError` thrown by
        //     the helper (e.g. a runtime bug) is surfaced as a
        //     network-level failure with status 0.
        const apiErr =
          caught instanceof ApiError
            ? caught
            : new ApiError({
                status: 0,
                message:
                  caught instanceof Error
                    ? caught.message
                    : "Failed to save reflection.",
              });

        onPersistError?.(tempId, apiErr);

        if (mountedRef.current) {
          setError(apiErr.message);
          setSubmitting(false);
        }
      }
    },
    [
      submitting,
      question,
      answer,
      questionLocked,
      inspirationId,
      onOptimisticAdd,
      onPersisted,
      onPersistError,
      hideSkip,
    ],
  );

  const handleSave = useCallback(() => {
    void submit(false);
  }, [submit]);

  const handleSkip = useCallback(() => {
    void submit(true);
  }, [submit]);

  /* --------------------------------------------------------
   * Keyboard parity: ⌘/Ctrl+Enter saves, Escape cancels.
   *
   * The prototype binds these on the textarea so the user can compose +
   * commit without lifting from the keyboard. Mirroring the same gesture
   * preserves the typing rhythm.
   * -------------------------------------------------------- */

  const handleAnswerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleSave();
      } else if (event.key === "Escape" && onCancel) {
        event.preventDefault();
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  const handleAnswerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setAnswer(event.target.value);
      if (error) setError(null);
    },
    [error],
  );

  const handleQuestionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setQuestion(event.target.value);
      if (error) setError(null);
    },
    [error],
  );

  /* --------------------------------------------------------
   * Render
   *
   * Use the prototype's `.reflect-area` / `.reflect-bar` skeleton so the
   * existing CSS rhythm (italic serif prompt, transparent answer
   * textarea, pill buttons) carries the visual contract.
   * -------------------------------------------------------- */

  // Generate ids once so the answer textarea has stable a11y wiring even
  // across re-renders. `useId` is React 18's official primitive for this.
  const reactId = useId();
  const questionId = `${reactId}-question`;
  const answerId = `${reactId}-answer`;
  const errorId = `${reactId}-error`;

  return (
    <div className="reflect-area visible" role="form" aria-label="Reflection">
      {questionLocked ? (
        // Locked prompt — render exactly as the prototype's italic serif
        // headline. We still annotate it with an id so the answer textarea
        // can declare the prompt as its `aria-labelledby`.
        <div className="reflect-question" id={questionId}>
          {question}
        </div>
      ) : (
        // Editable question field. We reuse the `.reflect-answer` class
        // (transparent serif textarea) because it already matches the
        // visual rhythm; the `.reflect-question` class is intended for a
        // *display* of the prompt rather than an input. Keeping the
        // editable variant in `.reflect-answer` styling means a single
        // CSS selector covers both fields.
        <textarea
          id={questionId}
          ref={questionTextareaRef}
          className="reflect-answer"
          // Tighter row count for the question — it's typically a single
          // sentence, while the answer can spill across multiple lines.
          rows={2}
          value={question}
          onChange={handleQuestionChange}
          placeholder={questionPlaceholder}
          aria-label="Reflection question"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={submitting}
        />
      )}

      <textarea
        id={answerId}
        ref={answerTextareaRef}
        className="reflect-answer"
        rows={4}
        value={answer}
        onChange={handleAnswerChange}
        onKeyDown={handleAnswerKeyDown}
        placeholder={answerPlaceholder}
        aria-labelledby={questionLocked ? questionId : undefined}
        aria-label={questionLocked ? undefined : "Reflection answer"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={submitting}
      />

      {error ? (
        <div
          // Error banner — tiny, mono, uppercase, mirrors the visual
          // language used elsewhere in the SPA for transient diagnostic
          // ribbons. `role="alert"` so AT users hear it immediately.
          id={errorId}
          role="alert"
          aria-live="polite"
          style={{
            marginTop: 6,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="reflect-bar visible">
        <div>
          {!hideSkip ? (
            <button
              type="button"
              className="reflect-btn reflect-later"
              onClick={handleSkip}
              disabled={submitting}
              aria-label="Skip this reflection"
            >
              Skip
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="reflect-btn reflect-later"
              onClick={onCancel}
              disabled={submitting}
              aria-label="Cancel reflection"
              style={{ marginLeft: hideSkip ? 0 : 8 }}
            >
              Cancel
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="reflect-btn reflect-next"
          onClick={handleSave}
          disabled={submitting}
          aria-label="Save reflection"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export default ReflectionForm;
