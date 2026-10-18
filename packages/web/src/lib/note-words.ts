/**
 * WHEN A SAVED NOTE MAY BE LEFT WITH NO WORDS — one rule for every door.
 *
 * The create rule is the source: a save may be made with no words when it
 * carries an attachment (`text` defaults to "" beside attachments), and the
 * PATCH route holds edits to the same line ("Inspiration text is required"
 * only when no attachment remains). The archive's note page and Home's
 * memory card both edit a stored note, and each had its own guess — the
 * card refused every empty edit, the archive briefly dropped them all
 * silently (review, 2026-10-17). Both ask this now.
 */
export function wordsCanStand(text: string, attachmentCount: number): boolean {
  return text.trim().length > 0 || attachmentCount > 0;
}
