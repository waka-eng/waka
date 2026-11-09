/**
 * ═══ HOW LONG "KEPT" STAYS (design E4) ═══════════════════════════════════
 *
 * The creature's other lines are a whisper and go after four seconds. "Kept"
 * carries two acts worth reaching for (Talk about it, See all) and, for a
 * screenshot, the words the server reads AFTER the save — a read that takes
 * a few seconds to land. So it stays eight seconds, and while the words are
 * still being read it waits for them, up to half a minute; once they land
 * it still gives them four seconds to be read. Past the cap the words are
 * not lost: they are on the saved note.
 */
export const LINE_STAY_MS = 4_000;
export const KEPT_STAY_MS = 8_000;
export const KEPT_WORDS_CAP_MS = 30_000;

/** Milliseconds left for the bubble, from when it began saying what it says. */
export function bubbleStayMs(input: { kept: boolean; waitingForWords: boolean; elapsedMs: number }): number {
  if (!input.kept) return LINE_STAY_MS;
  if (input.waitingForWords) return Math.max(0, KEPT_WORDS_CAP_MS - input.elapsedMs);
  return Math.max(LINE_STAY_MS, KEPT_STAY_MS - input.elapsedMs);
}
