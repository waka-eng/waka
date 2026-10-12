/**
 * WHAT MOVED BETWEEN TWO READINGS, AT THE LEVEL OF WORDS.
 *
 * The product already had a way to show this and it was a modal holding two
 * full passages, one above the other, each several paragraphs long — the
 * reader's job was to read both and spot the difference themselves. Founder:
 * "the what changed I obviously want to keep it somewhere but not in this
 * format. Help me find a better way to design this information to match the
 * product experience."
 *
 * The product's own answer was already written down. The poster's note says
 * it: words that survived a rewrite stay lit and still, only new words
 * arrive, "the spine is the still text, the drift is the flicker". That is
 * the same question asked of the same material, so this is the same answer —
 * ONE passage, the current one, with what is new carrying the light and what
 * carried over staying quiet. Light is the only meaning channel, so the
 * difference is shown in the only channel there is.
 *
 * AND WHAT LEFT IS STILL SHOWN. Fading never deletes: words the rewrite
 * dropped are printed once, faded, under the reading. A diff that silently
 * omits the removals is a diff that can only ever flatter the new version.
 *
 * A REPEATED WORD CARRIES ONLY AS MANY TIMES AS IT WAS THERE BEFORE. The
 * poster holds this invariant and so does this: two uses of "small" in the
 * new wording, against one in the old, is one carried and one new — not two
 * carried. Without it, any passage that repeats a common word reads as having
 * changed less than it did.
 */

/** One word of the current reading, and whether it is new to it. */
export interface DriftWord {
  readonly text: string;
  /** True when this reading introduced it — the ones that carry the light. */
  readonly arrived: boolean;
}

export interface Drift {
  /** The current reading, in order, each word marked. */
  readonly words: readonly DriftWord[];
  /** Words the rewrite dropped, in the order they stood, de-duplicated. */
  readonly left: readonly string[];
  /** True when nothing moved at all — same words, same number of each. */
  readonly same: boolean;
}

/** Case- and punctuation-insensitive, because "Small," and "small" are the
    same word surviving, and a reader comparing two sentences does not count
    a comma as a change of mind. */
function fold(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function split(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

export function driftWords(before: string | null, after: string): Drift {
  const words = split(after);
  /* No earlier reading is not "everything is new": a first reading has
     nothing to have drifted FROM, and lighting every word of it would be
     announcing a change that never happened. */
  if (before === null) {
    return { words: words.map((text) => ({ text, arrived: false })), left: [], same: false };
  }

  /* How many times each word was available to carry. Decremented as the new
     wording claims them, which is the repeated-word invariant above. */
  const budget = new Map<string, number>();
  for (const word of split(before)) {
    const key = fold(word);
    if (key) budget.set(key, (budget.get(key) ?? 0) + 1);
  }

  const marked = words.map((text) => {
    const key = fold(text);
    const left = key ? budget.get(key) ?? 0 : 0;
    if (left > 0) {
      budget.set(key, left - 1);
      return { text, arrived: false };
    }
    return { text, arrived: true };
  });

  /* Whatever the new wording never claimed is what the rewrite dropped. The
     original spelling is kept — a reader should see the word as it stood, not
     as the comparison folded it. */
  const unclaimed = new Set<string>();
  for (const [key, count] of budget) if (count > 0) unclaimed.add(key);
  const seen = new Set<string>();
  const left: string[] = [];
  for (const word of split(before)) {
    const key = fold(word);
    if (!unclaimed.has(key) || seen.has(key)) continue;
    seen.add(key);
    left.push(word);
  }

  return { words: marked, left, same: left.length === 0 && marked.every((w) => !w.arrived) };
}
