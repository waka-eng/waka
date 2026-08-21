/**
 * THE POSTER'S WORDS — layer three, said in a way that shows what survived.
 *
 * This is the only file under `space/top-of-mind/` that returns JSX, and that
 * is deliberate: the distinction it draws is a rendering distinction (a word
 * that carried over is already lit; a word that arrived animates in), so it
 * has to reach the element level to exist at all. `board.ts` beside it holds
 * the model; this holds the one thing the model cannot say without markup.
 */
import { Fragment, type JSX } from "react";

/**
 * THE POSTER, AND WHICH OF ITS WORDS ARE NEW.
 *
 * Every poster used to replay every word on every change, which is beautiful
 * once and useless afterwards: scrubbing a wall's history was a stream of
 * identical assemblies, and the one question a person actually has about a
 * self-description — HAS THIS BEEN THE SAME THING? — had no answer on screen.
 *
 * So a word that survived the rewrite stays lit and still, and only new words
 * arrive. The spine of an identity is the text that does not move; the drift
 * is the flicker. That is a drift readout with no numerals, no timeline and no
 * diff view, and it answers the question better than a version list could.
 *
 * Matching is a multiset, not a diff: a word that was in the previous sentence
 * is a word that survived, wherever it moved to. Order changes are not drift.
 *
 * Reduced motion keeps the distinction — it just spends the world's own
 * channel on it instead of movement (see jar.css): a new word arrives as a
 * step in luminance, a carried one is simply already lit.
 */
export function posterWords(text: string, prev: string | null): JSX.Element[] {
  const words = text.split(/\s+/);
  const pool = new Map<string, number>();
  if (prev) for (const w of prev.split(/\s+/)) pool.set(w, (pool.get(w) ?? 0) + 1);
  let arriving = 0;
  return words.map((word, i) => {
    const have = pool.get(word) ?? 0;
    const carried = have > 0;
    if (carried) pool.set(word, have - 1);
    return (
      /* the space lives OUTSIDE the inline-block, or it collapses and the
         whole ambition runs together */
      <Fragment key={`${i}-${word}`}>
        <span
          className={carried ? "jar-word jar-word--held" : "jar-word"}
          style={carried ? undefined : { animationDelay: `${arriving++ * 28}ms` }}
        >
          {word}
        </span>{" "}
      </Fragment>
    );
  });
}
