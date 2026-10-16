/**
 * WHETHER THE PERSON HAS ASKED FOR LESS MOTION.
 *
 * One answer for every surface that animates in script — the claim slip's
 * throw, the walk to the timeless page, the sky that streams behind it. They
 * each carried their own copy of this check, and three copies of a question
 * are three chances to answer it differently. Read at the moment of asking,
 * not cached: the setting can change while the page is open.
 */
export function prefersStillness(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
