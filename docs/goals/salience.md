# Goal: which part of a save led to this reading

Status: proposed 2026-08-03. Not started.
Follows: the readings layer (`a save says where it landed`)

## Why

A save already says *that* it fed a reading, and a reading already says *why*
each save was cited — in prose, on the citation row. Neither says **which
words**.

That gap matters most where the save is longest. A thousand-word essay is
credited whole for a reading that turned on one sentence, and the person who
wrote it cannot tell which sentence the room heard. Pointing at the words is
the difference between "this contributed" and "this is what you said that
landed."

## Approach: the judge quotes it, and we refuse what it cannot prove

The judge already has each save's full text in front of it. Naming the run of
words that carried the reading is one more field in a response we are already
paying for — **no extra model call**.

**Verification is the whole design.** Models paraphrase. A quote is stored only
if it is a literal substring of the save after whitespace normalization;
otherwise nothing is stored and the citation renders as it does today. A
missing highlight is honest. A wrong one attributes words to a person they did
not write, which is worse than saying nothing.

This is the discipline `combination-reading` already applies — a quote that
does not appear in a cited signal is thrown out — moved one layer down.

**Store the quote, not offsets.** Offsets rot the moment a save is edited or
enrichment is appended later. The span is located at render by searching for
the stored text; when it no longer matches, the citation shows without a
highlight rather than highlighting the wrong words.

## The decision that matters

A save's readable text is **the person's own words plus the fetched page**.

If the quote lands in the enrichment, it came from the article they linked, not
from anything they wrote. Those are different claims about a person, and
collapsing them would quietly attribute an article's argument to a member. The
two must be visibly different wherever a quote is shown.

## Phases

### Phase 0 — The column

`quote` on `group_top_of_mind_note_signals` and `top_of_mind_note_signals`.
Nullable, nothing reads it. One migration.

**Gate:** migrations apply; no behaviour changes.

### Phase 1 — The judge names it

- `quote` joins `WowSourceEvidence` and the prompt's output contract, asked for
  per citation rather than per note.
- Verified at persist time against the cited save's text; dropped silently on
  mismatch.
- Recorded: what share of citations come back with a quote that verifies. If it
  is low, the fallback in "What this does not do" becomes the plan.

**Gate:** on a real board, **every** stored quote is a literal substring of its
save — zero exceptions, asserted by test, not sampled.

### Phase 2 — The surfaces

- The saved-inspiration detail highlights the span, and says which reading
  heard it.
- A note's evidence preview shows the quote instead of the first 180
  characters, which is strictly better: today it shows whatever happened to sit
  at the start of the save.
- Enrichment-sourced quotes are marked as the page's words, not the person's.
- Same treatment on the readings surface, which already answers "how this
  inspiration reads".

**Gate:** browser-verified; a save whose quote no longer matches renders
without a highlight and without an error.

## What this does not do

**No backfill.** New readings carry quotes; existing ones do not. Same stance
enrichment took.

**It does not infer salience.** The alternative was to split a save into
sentences, embed each, and pick the one nearest the reading's belief statement.
That needs no prompt change and cannot hallucinate — but it is a *guess about*
the judge's reasoning rather than the judge's reason. For a product whose claim
is traceable evidence, asking and refusing what cannot be proven is the more
honest mechanism.

Worth building as a fallback if Phase 1 shows the judge quotes reliably badly.

## Non-goals

- Highlighting more than one span per citation. A reading that rests on three
  separate sentences of one save is a reading that rests on the save.
- Editing or correcting a quote by hand. It is the judge's account of what it
  heard, not a user annotation, and letting it be edited would make it neither.
