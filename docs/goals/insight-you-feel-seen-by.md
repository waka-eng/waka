# Goal: insight you feel seen by

Status: Phases 1 to 5 built on design/meeting-1120 (2026-11-26), not yet deployed. Owner: the founder decides design; Claude builds.

| Phase | State |
| --- | --- |
| 1. Every reading shows its saves | Built: "From n inspirations" opens exactly those saves. |
| 2. Specific or silent | Built: the reviewer's `specific` verdict rejects horoscopes; fixture set of real readings still to write. |
| 3. A hunch from the first saves | Built: `hunches` table and `generate_hunch` job (migration 0096), onboarding answers keep their question. Not yet tried against a live model. |
| 4. Not quite rewrites it | Built for readings and hunches: the bar takes the answer, "Rethinking", the new line lands. |
| 5. The moment | Built: the first principle's reveal, and the weekly card (`GET /api/top-of-mind/week`) shared as a story image. |
| Later: values other agents can ask | Started as sharper MCP: principles carry their saves, and every key's read is logged (migration 0095). |

## Why

Market research (2026-11-26): saving alone is not a business. Pocket closed, Mem is
closing, Limitless was absorbed. Mymind stores your content without reflecting on you;
Rosebud reflects on you but only on what you write; ChatGPT remembers only what you type.
WAKA's open space is **what you save without thinking, read back as who you are**. The
reading is the product, so it has to be early, specific and answerable.

Today it is weak in three ways:

1. **Late.** One save gives "Nothing to say yet". A reading needs two distinct saves, and
   then waits up to 24 hours between versions. A principle needs about 9 independent pieces
   of evidence (3 active signals at 3 each). Most people leave before the first one.
2. **Could be about anyone.** The reviewer's only generic check is a side clause ("reject a
   generic slogan", `gemini.ts` reviewer prompt). Nothing measures specificity.
3. **One way.** The reading is announced. Why? shows up to 3 saves, but only by opening a
   chat. Correcting it ("not true") queues a refresh the person never sees land, and
   editing a signal or answering a review waits on the 24 hour gate.

## The promise

> Save without thinking. WAKA tells you what it means about you, and shows you why.

Done means a new person, within their first session, reads one sentence about themselves,
taps it and sees the saves behind it, and can say "not quite" and watch it change.

## What exists to build on (mapped 2026-11-26)

- Top of mind entries link to signals (`top_of_mind_entry_signals`); signals link to saves
  (`signal_evidence`). Home's Why? already walks entry, signal, save (`whyIds`, `whyFor`).
- Gates: `readingQualityIssue` (language, single source, copied source) and a second-model
  reviewer (`reviewReadingEntries`: grounded, synthesized, 2+ supporting saves).
- Feedback verdicts already queue a `manual` refresh that skips the 24 hour gate.
- Onboarding's three answers are saved as ordinary inspirations, but their questions are
  not stored, so the answer loses its context.
- Principles return at most 2 example saves per signal, so "From N" undercounts.

## Phases

### Phase 1. Every reading shows its saves (web only)

The specific saves are what make a reading feel seen rather than horoscope.

- Under the home reading, a quiet line "From 3 of your saves" that opens the saves behind
  it in place (not a chat): each save's words or picture and its date, tappable to open it.
- Same on a principle: the saves, not the signal statements (signals are plumbing).
- Fix the "From N" undercount by asking the API for the count, not counting examples.

Done when: every reading and principle on screen names and opens the saves it rests on;
measured in a browser at 390 and 1280; tests pin the count and the open.

### Phase 2. Specific or silent (API, prompt and test)

- Add a `specific` verdict to the reviewer: "Would this sentence be true of most people who
  saved anything? If yes, reject." Rejection fails publication like `synthesized` does.
- A cheap pre-check in `readingQualityIssue`: a reading must reuse at least one concrete
  word or name from its sources (a place, a person, an object), not only abstractions.
- Prompt: prefer a tension ("you save about staying and about leaving") over a trait.
- Fixture set of 20 good and 20 horoscope readings; the gate must pass the first and catch
  most of the second.

Done when: the fixture suite passes, and no published reading on the look stack is generic.

### Phase 3. A hunch from the first saves (API plus web, design first)

- A **hunch** is a tentative reading allowed from 1 to 2 saves, stored apart from the
  reading so the reading's 2-save rule stays. Worded as a question: "Three of your saves
  are about leaving something. Am I close?" with Yes / Not quite.
- Onboarding answers count, and store their question with them (new `prompt` column or
  `source: onboarding` plus the question), so the first hunch can come out of onboarding.
- Yes affirms the signals (+confidence); Not quite opens one question (Phase 4).

Done when: a fresh account sees a hunch after onboarding or its first save; design shown
on the canvas and approved before the migration.

### Phase 4. Not quite rewrites it, in front of you (API plus web)

- "Not quite" asks one short question ("What's closer?"), and the answer is a correction
  the next reading must honour (already wired through `loadRecentFeedback`).
- The refresh is `manual` (skips the gate), and the bubble shows "Rethinking…" then the new
  reading, with the old one struck through for a moment.
- Editing a signal and answering a review also take the manual path for the person who
  made them.

Done when: a correction produces a new reading on screen within a minute, and the
corrected claim does not return in the same form (test with the recorded model client).

### Phase 5. The moment (design first)

- The first principle is a ceremony: the creature gathers the saves behind it, in light,
  and the principle forms from them. Once.
- A weekly card: "This week you were circling ___", with the 3 saves, shareable as an
  image without the saves' text unless chosen.

### Later: values other agents can ask (A2A)

`what_would_i_care_about(question)` over MCP, answering with principles and cited saves,
every call logged and revocable in Settings. Agent to agent introductions between two
consenting people compare principles, never saves. Depends on Phases 1 to 4: an agent can
only be as good as the reading.

Introductions started 2026-11-27 (board "Agent introductions", branch `design/introductions`),
behind `WAKA_INTRODUCTIONS=1` and off everywhere by default: opt in per person, a double
blind ask per match (an unanswered ask, and a yes still waiting, each lapse quietly after 14 days,
the same whatever the other side did), held principle statements compared by word overlap (no principle
embeddings exist yet), and no name at all: each side sees only its own principle words.
Migration 0097; rules in `packages/api/src/lib/introductions.ts`.

## Rules that hold throughout

Nothing invented: every sentence traces to saves. Signals are never shown by name. No
dashes in copy; Save not Keep; inspiration never note; Korean retired words. Design before
backend for Phases 3 and 5.
