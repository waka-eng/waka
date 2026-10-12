/**
 * ═══ WHETHER A NOTE CAN BE KEPT, AND WHY NOT ═════════════════════════════
 *
 * Founder: "the save button is very hard to see. Maybe the save button should
 * be in the bottom bar as well. And then it should have save or save as
 * draft." Moving Save out of the note and into the dock is what made this
 * file necessary, and the reason is worth stating because it is not the move
 * itself.
 *
 * THE CONDITION USED TO BE WRITTEN TWICE. `InspirationComposer` decided
 * whether its button was disabled, and `keepIt` in `Home.tsx` re-decided the
 * same question on press and returned silently on its first line if it
 * disagreed. Two copies of one rule, in two files, neither aware of the
 * other — so a Save could look pressable and do nothing, which is the exact
 * failure `whyNoSend` was written for on the chat composer after it happened
 * there.
 *
 * With the button in a third place, a third copy was the obvious next step.
 * One function instead, returning the REASON rather than a boolean, for the
 * same two gains the chat's version named: the control can say why it cannot
 * be pressed, and a test can enumerate the causes rather than probing a
 * disabled attribute through the DOM.
 *
 * IT IS NOT A VALIDATOR. Nothing here reads a file or parses a link; it reads
 * state that other code has already settled. The link's own parse stays in
 * `inspirationWithPendingLink`, where the error belongs to the field.
 */

/** Every reason a kept note is not ready to leave, as message keys. */
export type WhyNotKept =
  | "worldComposerOpening"
  | "worldComposerUploading"
  | "worldComposerChooseRecording"
  | "worldComposerFixFiles"
  | "worldComposerTooManyFiles"
  | "worldComposerFinishRecording";

export interface KeepReadiness {
  /** Anything to keep at all: words, a file, or a link in the open field. */
  hasWords: boolean;
  /** The draft store has opened; before that there is nowhere to write. */
  ready: boolean;
  /** A save is already in flight or awaiting acknowledgement. */
  saving: boolean;
  /** Files are going up right now. */
  uploading: boolean;
  /** A recording is running, so the material is not final. */
  recording: boolean;
  /** Two recordings exist and nobody has said which one to keep. */
  undecidedRecording: boolean;
  /** How many attachments carry a validation error of their own. */
  invalidFiles: number;
  /** How many attachments there are in total. */
  files: number;
}

/** Up to this many attachments in one inspiration. */
export const KEEP_FILE_LIMIT = 5;

/**
 * The first reason this note cannot be kept, or `null` when it can.
 *
 * ORDERED BY WHAT A PERSON SHOULD DO FIRST, not by cheapness to check: a
 * recording that is still running is the thing to stop before thinking about
 * anything else, and a count of files is the last thing worth mentioning to
 * somebody who also has an unreadable one. Only the first is ever shown, so
 * the order IS the message.
 *
 * AN EMPTY NOTE RETURNS `null`, NOT A REASON. There is nothing wrong with a
 * blank page — it simply has no Save on it, which the caller decides with
 * `hasWords`. A reason here would be a complaint about not having written
 * anything yet.
 */
export function whyNotKept(state: KeepReadiness): WhyNotKept | null {
  if (!state.hasWords) return null;
  if (state.recording) return "worldComposerFinishRecording";
  if (state.undecidedRecording) return "worldComposerChooseRecording";
  if (!state.ready) return "worldComposerOpening";
  if (state.uploading || state.saving) return "worldComposerUploading";
  if (state.invalidFiles > 0) return "worldComposerFixFiles";
  if (state.files > KEEP_FILE_LIMIT) return "worldComposerTooManyFiles";
  return null;
}

/** Whether the bar's Save may be pressed. */
export function canKeep(state: KeepReadiness): boolean {
  return state.hasWords && whyNotKept(state) === null;
}
