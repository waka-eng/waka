/**
 * HOW LONG A WAY OUT WAITS ON ITS OWN WRITE (review, 2026-10-21).
 *
 * Closing the archive waits for the open note's write and for a running
 * recording's upload, and the card refuses a press away while its save is
 * out (`docs/plans/card-and-archive.md`). A request that never answers would
 * make either wait a trap. So each one has this deadline. After it, the
 * archive closes anyway (the write or upload carries on in the background and
 * Home says so), and the held card offers Cancel edit in its line.
 */
export const LEAVE_DEADLINE_MS = 20_000;

/** `work`'s answer, or `"late"` once the deadline passes first. */
export function withinDeadline<T>(work: Promise<T>, ms = LEAVE_DEADLINE_MS): Promise<T | "late"> {
  let timer = 0;
  const late = new Promise<"late">((done) => { timer = window.setTimeout(() => done("late"), ms); });
  return Promise.race([work, late]).finally(() => window.clearTimeout(timer));
}
