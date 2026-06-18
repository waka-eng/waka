/**
 * <CaptureCell /> — the cream-bordered capture surface that lives in the
 * center of the home grid (3×3 cluster grid) and the all-encompassing focus
 * mode overlay.
 *
 * Ports the prototype's `#capture` markup (index.html lines 2124–2150)
 * into a declarative React component while preserving the exact DOM
 * structure, class names, and id attributes so the existing CSS in
 * `index.html` (lines 282–626) — and the parity rules now mirrored in
 * `global.css` — continues to apply 1:1.
 *
 * Prototype DOM contract preserved verbatim:
 *
 *   <div class="cell capture" id="capture" tabindex="0">
 *     <div class="cap-confirm" id="capConfirm" />
 *     <div class="reflect-complete" id="reflectComplete" />
 *     <div class="cap-body" id="capBody">
 *       <textarea id="capNote" placeholder="…">…</textarea>
 *       <div class="cap-strip" id="capStrip">…attachments…</div>
 *     </div>
 *     <div class="reflect-area" id="reflectArea">
 *       <div class="reflect-question" id="reflectQ">…</div>
 *       <textarea class="reflect-answer" id="reflectAns" placeholder="…">…</textarea>
 *     </div>
 *     <div class="cap-bar" id="capBar">
 *       <label class="cap-file-btn" for="capFile">+ icon</label>
 *       <input id="capFile" type="file" accept="image/*" hidden />
 *       <button class="cap-save" id="capSave">Save</button>
 *       <button class="cap-expand" id="capExpand">expand/collapse</button>
 *     </div>
 *     <div class="reflect-bar" id="reflectBar">
 *       <button class="reflect-btn reflect-later" id="reflectLater">Done</button>
 *       <button class="reflect-btn reflect-next" id="reflectNext">Continue</button>
 *     </div>
 *   </div>
 *
 * Per Sub-AC 4.3.3, the focus is on porting *interactive primitives* —
 * the capture textarea, save pill, file picker, the expand/collapse
 * focus-mode toggle, the reflection mini-flow — without yet wiring the
 * upload pipeline, the inspiration POST, or the reflection API. The
 * component therefore takes presentational state via props (the parent
 * decides when to make the save button visible, when to flip into focus
 * mode, when to switch to the reflection sub-view) and reports user
 * intent via callbacks. Wiring lands in subsequent sub-ACs.
 *
 * Class-token contract:
 *
 *   - `.cell.capture`              → root grid cell + capture surface
 *   - `.capture.dragover`          → during a drag-and-drop hover
 *   - `.capture.focused`           → the expand-to-cover focus mode is on
 *   - `.capture.focus-enter`       → entrance keyframe (paired with focused)
 *   - `.capture.focus-exit`        → exit keyframe (paired with !focused)
 *   - `.capture.save-flash`        → save-success pulse animation
 *   - `.capture.reflect-glow`      → reflection-complete warm glow
 *   - `.cap-save.visible`          → save pill becomes interactive
 *   - `.cap-confirm.visible`       → save confirmation overlay shown
 *   - `.reflect-area.visible`      → reflection sub-view active
 *   - `.reflect-bar.visible`       → reflection actions strip active
 *   - `.reflect-complete.visible`  → reflection-complete success message
 *
 * The component flips these tokens via the props below; CSS does the rest.
 */

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  forwardRef,
  useState,
} from "react";

/**
 * The capture surface has two top-level views:
 *
 *   - `note`     — the original capture textarea with file picker + save.
 *   - `reflect`  — the post-save reflection prompt with "Done"/"Continue".
 *
 * The component owns no state for which view is active; the parent
 * supplies `view` so the visual contract stays predictable in tests.
 */
export type CaptureView = "note" | "reflect";

/**
 * Visual modifiers the parent can stack on top of the base cell. Each maps
 * 1:1 to a prototype CSS class. We accept these as discrete booleans
 * instead of a single string union so consumers can compose them
 * independently — e.g. `focused` + `save-flash` can co-exist when a save
 * happens while the user is in focus mode, just like the prototype.
 */
export interface CaptureCellVisualState {
  /** `.dragover` — drop target highlight while a file is hovering. */
  dragover?: boolean;
  /** `.focused` — capture is expanded to cover the whole grid. */
  focused?: boolean;
  /** `.focus-enter` — entrance keyframe; pair with `focused: true`. */
  focusEntering?: boolean;
  /** `.focus-exit` — exit keyframe; pair with `focused: false`. */
  focusExiting?: boolean;
  /** `.save-flash` — save-success pulse. Auto-clears via animation end. */
  saveFlash?: boolean;
  /** `.reflect-glow` — reflection-complete warm glow. */
  reflectGlow?: boolean;
}

export interface CaptureCellProps {
  /** Current sub-view: capture form vs. reflection. Defaults to `"note"`. */
  view?: CaptureView;

  /** Stacked visual modifiers (drag, focus, save flash, reflect glow). */
  visualState?: CaptureCellVisualState;

  // ---------------------------------------------------------------------
  // Note-view props
  // ---------------------------------------------------------------------

  /** Controlled textarea value for the capture note. */
  noteValue?: string;
  /** Optional selected ranges to render as in-text highlights behind the textarea. */
  noteHighlights?: Array<{ startOffset: number; endOffset: number; text: string }>;
  /** Removes one existing note highlight. */
  onRemoveNoteHighlight?: (index: number) => void;
  /** Optional floating action shown while text is selected but not yet highlighted. */
  noteSelectionToolbar?: ReactNode;
  /** Fires on every textarea keystroke. */
  onNoteChange?: (value: string) => void;
  /** Fires when text is pasted into the universal composer. */
  onNotePaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Fires when the user selects text inside the capture textarea. */
  onNoteSelect?: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
  /**
   * Optional textarea keydown — used by the prototype to (a) submit on
   * Cmd/Ctrl+Enter and (b) discard with Escape. We forward the event
   * unmodified so consumers can implement either policy without us
   * baking it in.
   */
  onNoteKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Placeholder copy for the note textarea. Defaults to the prototype's. */
  notePlaceholder?: string;
  processSaveLabel?: string;
  processSaveInProgress?: boolean;
  processSaveInProgressLabel?: string;
  processSaveTitle?: string;
  quickSaveLabel?: string;
  quickSaveTitle?: string;
  focusModeLabel?: string;
  enterFocusModeLabel?: string;
  exitFocusModeLabel?: string;
  doneLabel?: string;
  continueLabel?: string;

  /**
   * Whether the save pill is in the "ready" state (visible + clickable).
   * In the prototype the pill is hidden until the textarea has content;
   * the parent makes that decision and toggles via this prop.
   */
  saveVisible?: boolean;
  /** Fires when the user clicks the quick-save pill. */
  onSave?: () => void;
  /** Fires when the user chooses the guided reflective save flow. */
  onReflectiveSave?: () => void;
  /** Fires when the user picks a file via the `+` button. */
  onFileSelect?: (file: File) => void;

  /** Whether the focus-mode toggle should render the collapse glyph. */
  focused?: boolean;
  /**
   * Fires when the user toggles focus mode via the expand/collapse button.
   * Receives the *next* state so the parent can flip without re-deriving.
   */
  onToggleFocus?: (next: boolean) => void;

  /**
   * Optional pre-rendered attachment chips. Rendered verbatim inside
   * `.cap-strip`. The prototype builds these imperatively in
   * `addAttachment()`; in React we let the parent pass them as `<a className="att">`
   * elements so the visual contract holds without coupling the cell to
   * the attachment data model.
   */
  attachments?: ReactNode;
  /** Optional lightweight controls or metadata rendered under the textarea. */
  captureMeta?: ReactNode;

  /**
   * Optional save-confirmation overlay copy. When set (and `confirmVisible`
   * is true), rendered inside `.cap-confirm.visible`. Default empty so
   * the overlay stays inert when the parent has nothing to surface.
   */
  confirmMessage?: ReactNode;
  confirmVisible?: boolean;

  // ---------------------------------------------------------------------
  // Reflect-view props
  // ---------------------------------------------------------------------

  /** Reflection question to display in `.reflect-question`. */
  reflectQuestion?: ReactNode;
  /** Controlled textarea value for the reflection answer. */
  reflectValue?: string;
  /** Fires on every reflection-textarea keystroke. */
  onReflectChange?: (value: string) => void;
  /** Optional reflection-textarea keydown forwarder (Esc/Enter handling). */
  onReflectKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Placeholder for the reflection textarea. Defaults to the prototype's. */
  reflectPlaceholder?: string;
  /** Fires when the user clicks the "Done" reflect-later button. */
  onReflectLater?: () => void;
  /** Fires when the user clicks the "Continue" reflect-next button. */
  onReflectNext?: () => void;
  /** Disables the reflect-next button while a guided question is still loading. */
  reflectNextDisabled?: boolean;

  /**
   * Optional reflection-complete overlay copy. Surfaces inside
   * `.reflect-complete.visible` after the user finishes a reflection.
   */
  reflectComplete?: ReactNode;
  reflectCompleteVisible?: boolean;
}

/**
 * Compose the root cell's class list. Order is fixed (`cell` first,
 * `capture` next, then modifier tokens) so it matches the prototype
 * cascade exactly.
 */
function rootClassName(
  view: CaptureView,
  visualState: CaptureCellVisualState,
): string {
  const tokens: string[] = ["cell", "capture"];
  if (view === "reflect") {
    // Visual hook for any future "capture-in-reflection" treatment. The
    // prototype doesn't ship this token; we add it (purely additive) so
    // tests and styles can target the reflection sub-view without parsing
    // child visibility. CSS in `global.css` does not depend on it.
    tokens.push("capture--reflect");
  }
  if (visualState.dragover) tokens.push("dragover");
  if (visualState.focused) tokens.push("focused");
  if (visualState.focusEntering) tokens.push("focus-enter");
  if (visualState.focusExiting) tokens.push("focus-exit");
  if (visualState.saveFlash) tokens.push("save-flash");
  if (visualState.reflectGlow) tokens.push("reflect-glow");
  return tokens.join(" ");
}

/**
 * Forwarded ref points at the root `.cell.capture` div so parents that
 * need to imperatively measure or attach DOM-level event listeners
 * (drag-and-drop, IntersectionObserver) can hook in without re-querying
 * by id. The prototype pulls `#capture` via `getElementById` for the
 * same purposes; the ref keeps that hook intact in React.
 */
export const CaptureCell = forwardRef<HTMLDivElement, CaptureCellProps>(
  function CaptureCell(
    {
      view = "note",
      visualState = {},
      noteValue,
      noteHighlights = [],
      onRemoveNoteHighlight,
      noteSelectionToolbar,
      onNoteChange,
      onNotePaste,
      onNoteSelect,
      onNoteKeyDown,
      notePlaceholder = "Drop what hit: a note, link, or image. Save it fast or reflect deeper.",
      processSaveLabel = "Reflect deeper",
      processSaveInProgress = false,
      processSaveInProgressLabel = "Reflect Deeper in progress",
      processSaveTitle = "Add one small thought before saving this inspiration",
      quickSaveLabel = "Save it now",
      quickSaveTitle = "Save this inspiration now",
      doneLabel = "Done",
      continueLabel = "Continue",
      saveVisible = false,
      onSave,
      onReflectiveSave,
      onFileSelect,
      focused = false,
      onToggleFocus,
      attachments,
      captureMeta,
      confirmMessage,
      confirmVisible = false,
      reflectQuestion,
      reflectValue,
      onReflectChange,
      onReflectKeyDown,
      reflectPlaceholder = "Your reflection…",
      onReflectLater,
      onReflectNext,
      reflectNextDisabled = false,
      reflectComplete,
      reflectCompleteVisible = false,
    },
    ref,
  ): JSX.Element {
    const [dragActive, setDragActive] = useState(false);
    const noteText = noteValue ?? "";
    const visibleNoteHighlights = noteHighlights
      .map((item, index) => ({ ...item, index }))
      .filter(
        (item) =>
          noteText &&
          item.startOffset >= 0 &&
          item.endOffset > item.startOffset &&
          noteText.slice(item.startOffset, item.endOffset) === item.text,
      )
      .sort((a, b) => a.startOffset - b.startOffset);
    const noteHighlightLayer = visibleNoteHighlights.length > 0 ? (
      <div className="cap-note-highlight-layer" aria-hidden="true">
        {visibleNoteHighlights.map((item, itemIndex) => {
          const previousEnd = visibleNoteHighlights[itemIndex - 1]?.endOffset ?? 0;
          return (
            <span key={`${item.startOffset}-${item.endOffset}`}>
              <span>{noteText.slice(previousEnd, item.startOffset)}</span>
              <mark>
                {item.text}
                {onRemoveNoteHighlight ? (
                  <button
                    type="button"
                    className="cap-unhighlight"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onRemoveNoteHighlight(item.index)}
                  >
                    unhighlight
                  </button>
                ) : null}
              </mark>
              {itemIndex === visibleNoteHighlights.length - 1 ? (
                <span>{noteText.slice(item.endOffset) || "\n"}</span>
              ) : null}
            </span>
          );
        })}
      </div>
    ) : null;

    const handleNoteChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
      onNoteChange?.(event.target.value);
    };

    const handleReflectChange = (
      event: ChangeEvent<HTMLTextAreaElement>,
    ): void => {
      onReflectChange?.(event.target.value);
    };

    /**
     * The `<input type="file">` change event surfaces the picked file as
     * `event.target.files[0]`. We forward only the first file because the
     * prototype only attaches one image at a time (`accept="image/*"`,
     * non-multiple). After delivering the file we reset `event.target.value`
     * so picking the same file twice in a row still fires `change`.
     */
    const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (file && onFileSelect) onFileSelect(file);
      // Reset so re-selecting the same file fires change again.
      event.target.value = "";
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
      if (!onFileSelect) return;
      event.preventDefault();
      setDragActive(true);
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDragActive(false);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
      if (!onFileSelect) return;
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFileSelect(file);
    };

    const isReflectView = view === "reflect";
    const reflectiveSaveLabel = processSaveInProgress ? processSaveInProgressLabel : processSaveLabel;

    return (
      <div
        ref={ref}
        className={rootClassName(view, { ...visualState, dragover: visualState.dragover || dragActive })}
        id="capture"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* --- Save confirmation overlay (absolutely positioned over body) --- */}
        <div
          className={`cap-confirm${confirmVisible ? " visible" : ""}`}
          id="capConfirm"
          aria-live="polite"
        >
          {confirmMessage}
        </div>

        {/* --- Reflection-complete overlay (after a reflection is finished) --- */}
        <div
          className={`reflect-complete${reflectCompleteVisible ? " visible" : ""}`}
          id="reflectComplete"
          aria-live="polite"
        >
          {reflectComplete}
        </div>

        {/* --- Capture body (note textarea + attachment strip) --- */}
        {/*
          The prototype keeps `.cap-body` mounted even when the reflect
          sub-view is active — the `.reflect-area.visible` rule simply
          stacks above. We mirror that so the two views can cross-fade
          via CSS rather than mount/unmount, which is what makes the
          transition smooth.
        */}
        <div className="cap-body" id="capBody" hidden={isReflectView}>
          {noteHighlightLayer}
          {noteSelectionToolbar}
          <textarea
            className={visibleNoteHighlights.length > 0 ? "cap-note-input cap-note-input--has-highlight" : "cap-note-input"}
            id="capNote"
            placeholder={notePlaceholder}
            spellCheck={false}
            value={noteValue ?? ""}
            onChange={handleNoteChange}
            onPaste={onNotePaste}
            onSelect={onNoteSelect}
            onMouseUp={onNoteSelect}
            onKeyUp={onNoteSelect}
            onKeyDown={onNoteKeyDown}
          />
          {captureMeta}
          <div className="cap-strip" id="capStrip">
            {attachments}
          </div>
        </div>

        {/* --- Reflect area (question + answer textarea + guided controls) --- */}
        <div
          className={`reflect-area${isReflectView ? " visible" : ""}`}
          id="reflectArea"
        >
          <div className="reflect-question" id="reflectQ">
            {reflectQuestion}
          </div>
          <textarea
            className="reflect-answer"
            id="reflectAns"
            placeholder={reflectPlaceholder}
            spellCheck={false}
            value={reflectValue ?? ""}
            onChange={handleReflectChange}
            onKeyDown={onReflectKeyDown}
          />
          {/* --- Reflect bar (Back · Continue/Save) lives inside the reflective card
               so modal captures keep the journey controls together with the prompt. --- */}
          <div
            className={`reflect-bar${isReflectView ? " visible" : ""}`}
            id="reflectBar"
          >
            <button
              type="button"
              className="reflect-btn reflect-later"
              id="reflectLater"
              onClick={onReflectLater}
            >
              {doneLabel}
            </button>
            <button
              type="button"
              className="reflect-btn reflect-next"
              id="reflectNext"
              onClick={onReflectNext}
              disabled={reflectNextDisabled}
            >
              {continueLabel}
            </button>
          </div>
        </div>

        {/* --- Capture bar: utilities (attach · expand) on the left, save
             actions on the right — placed directly, no enclosing pill.
             Once the guided reflection journey starts, remove these normal
             capture controls entirely so Back/Continue/Save reflection are
             the only visible journey actions. --- */}
        {!isReflectView ? (
          <div className="cap-bar" id="capBar">
            <div className="cap-bar-left">
              <label className="cap-file-btn" htmlFor="capFile" title="attach an image">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.4 11.6 12.2 20.8a6 6 0 0 1-8.5-8.5l9.8-9.8a4 4 0 0 1 5.7 5.7l-9.8 9.8a2 2 0 1 1-2.8-2.8l9.2-9.2" />
                </svg>
              </label>
              <input
                id="capFile"
                type="file"
                accept="image/*"
                hidden
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="cap-expand"
                id="capExpand"
                title={focused ? "exit focus mode" : "focus mode"}
                aria-label={focused ? "exit focus mode" : "enter focus mode"}
                aria-pressed={focused}
                onClick={() => onToggleFocus?.(!focused)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {focused ? (
                    <>
                      <polyline points="4 14 10 14 10 20" />
                      <polyline points="20 10 14 10 14 4" />
                      <line x1="14" y1="10" x2="21" y2="3" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </>
                  ) : (
                    <>
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </>
                  )}
                </svg>
              </button>
            </div>
            <div className="cap-bar-right">
              <button
                type="button"
                className={`cap-save cap-save--reflect${saveVisible ? " visible" : ""}${processSaveInProgress ? " cap-save--reflecting" : ""}`}
                id="capReflectiveSave"
                onClick={onReflectiveSave}
                title={processSaveTitle}
                aria-label={reflectiveSaveLabel}
                aria-pressed={processSaveInProgress}
                disabled={!saveVisible}
              >
                {reflectiveSaveLabel}
              </button>
              <button
                type="button"
                className={`cap-save cap-save--quick${saveVisible ? " visible" : ""}`}
                id="capSave"
                onClick={onSave}
                title={quickSaveTitle}
                aria-label={quickSaveTitle}
                disabled={!saveVisible}
              >
                {quickSaveLabel}
              </button>
            </div>
          </div>
        ) : null}

      </div>
    );
  },
);

export default CaptureCell;
