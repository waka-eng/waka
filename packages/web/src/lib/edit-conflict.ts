/**
 * WHAT AN OPEN EDIT DOES WHEN THE SAME NOTE IS SAVED ELSEWHERE.
 *
 * Home's memory card can be holding a note's words open while another door
 * stores new words for it. The card must neither silently overwrite them
 * nor silently discard what the person typed. One small rule, kept pure so
 * it is tested on its own (review, 2026-10-17):
 *
 *   - only a WRITE can conflict — a re-read that changed no words is not
 *     news to an editor;
 *   - only words that actually DIFFER from what the edit opened with are a
 *     change at all;
 *   - an edit the person has not touched is moved onto the new words
 *     ("rebase"); one they have typed into asks which to keep ("ask").
 */
export type EditVerdict = "none" | "rebase" | "ask";

export function verdictOnSavedWords(input: {
  how: "write" | "read";
  /** the words the edit opened with */
  openedWith: string;
  /** the words in the edit now */
  draft: string;
  /** the words just stored by the other door */
  saved: string;
  /** the edit's own keep is in flight or just landed */
  busy: boolean;
}): EditVerdict {
  const opened = input.openedWith.trim(), draft = input.draft.trim(), saved = input.saved.trim();
  if (input.how !== "write" || input.busy) return "none";
  if (saved === opened || saved === draft) return "none";
  return draft === opened ? "rebase" : "ask";
}
