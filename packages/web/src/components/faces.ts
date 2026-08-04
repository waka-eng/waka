/**
 * A person's face, wherever they appear.
 *
 * The same name must produce the same colour and the same initials on a note,
 * in a room's cast, and on the moment they joined — a face that changes between
 * surfaces reads as a different person, which is the one thing a product about
 * whose-heart-is-this cannot afford.
 *
 * Lifted out of Home so the rail can use it without importing a page.
 */

const CONTRIBUTOR_COLORS = ["#8a6a2f", "#4a6a55", "#5a5170", "#7a4a4a", "#6a5a3a", "#3f5a6a"];

export function contributorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CONTRIBUTOR_COLORS[hash % CONTRIBUTOR_COLORS.length]!;
}

/*
 * The paper a reading is written on.
 *
 * Post-its were tinted by their index in the array -- five pastels, cycled --
 * so the wall's most visible variable encoded nothing at all. Colour now
 * answers the only question the wall is really about: whose hands is this
 * reading resting between.
 *
 * THE PAPERS ARE THE ORIGINAL ONES. WHAT CHANGED IS WHAT PICKS THEM.
 *
 * Two attempts got this wrong in opposite directions. Mixing the person's own
 * colour into cream produced sludge -- `CONTRIBUTOR_COLORS` are dark muted
 * INKS, made to be legible as one character on white, and diluting a dark
 * muted ink gives grey-green mud. Swapping to bright canary-and-pink sticky
 * paper was legible but wrong for this room: saturated notes shout over the
 * sentences printed on them, and over the mark.
 *
 * These are the app's original papers, which were always right -- soft, warm,
 * and quiet enough that the words stay the loudest thing on the sheet. The
 * defect was never the colours. It was that they were chosen by ARRAY INDEX,
 * so the wall's most visible variable encoded nothing. Same papers, keyed to
 * the person instead of the position.
 */
const PAPER_COLORS = [
  "#ece4cb", // cream
  "#e8d4ce", // clay
  "#d8ddc6", // sage
  "#cdd3df", // slate blue
  "#f1d7a8", // gold
  "#dcd3e0", // heather
];

const PAPER_INKS = [
  "#4a3e1f",
  "#6b3c34",
  "#3f4a2a",
  "#3a4456",
  "#4f3921",
  "#453a52",
];

/** Plain paper for a wall with no other hands on it. */
const PAPER_PLAIN = "#ece4cb";
const PAPER_PLAIN_INK = "#4a3e1f";

function paperIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % PAPER_COLORS.length;
}

/*
 * `background` may be a gradient, so it can never be fed to `color-mix()`.
 * `tint` is always a single colour, for anything derived from the paper.
 */
export function contributorPaper(names: string[]): {
  background: string;
  tint: string;
  ink: string;
} {
  if (names.length === 0) {
    // Your own wall. Every note is yours, so colouring them all the same says
    // nothing; plain paper is the honest answer.
    return { background: PAPER_PLAIN, tint: PAPER_PLAIN, ink: PAPER_PLAIN_INK };
  }
  const ordered = [...names].sort();
  const indices = Array.from(new Set(ordered.map(paperIndex)));
  const papers = indices.map((i) => PAPER_COLORS[i]!);
  if (papers.length === 1) {
    return { background: papers[0]!, tint: papers[0]!, ink: PAPER_INKS[indices[0]!]! };
  }
  /*
   * Several hands: the sheet is torn across, not blended.
   *
   * A soft gradient between two papers reads as a third colour and loses the
   * fact that two people are in it. Hard stops keep both papers legible as
   * themselves, which is the whole point of a reading that joins hands.
   */
  const step = 100 / papers.length;
  const stops = papers
    .map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`)
    .join(", ");
  return {
    background: `linear-gradient(107deg, ${stops})`,
    tint: papers[0]!,
    ink: PAPER_INKS[indices[0]!]!,
  };
}

export function contributorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
