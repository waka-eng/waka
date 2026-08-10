# Goal: capture and the second beat — out loud, held, and rooms can't unhear

Status: shipped 2026-08-09 (in-app slice). Extension / share sheet / cursor
capture are follow-up PRs.
Branch: working tree on `goal/two-modes` (should land as its own PR per the
per-goal scoping rule).
Follows: US-052 (`shared_to_groups`), the guided-reflection module, the
readings-of-a-signal surface.
Decided by founder, 2026-08-09: all four capture doors · out loud by default ·
reflect = invite now + resurface later · reflections always private, only
their effect flows.

## Why

Capture is where the product's whole claim starts: the heart reacts before
the brain has processed why. So the capture experience has two jobs that pull
against each other —

1. **Keep saving instant.** Saving IS the signal. Nothing gatekeeps it, and
   no decision stands in front of it.
2. **Invite the why.** A heartbeat is two sounds. The save is the first; the
   reflection — the person processing why their heart reacted — is the
   second. The second beat is what sharpens pulls and ambitions, and it can
   only be invited, never demanded.

Between them sits the visibility contract: a save speaks in every room you
are in, or it is kept to yourself — and the difference must be explainable in
one breath, because it is a privacy promise.

## The terminology decision

"Public / private" is retired from this surface. Both words lied a little:
"public" imports the internet-scale meaning (anyone) when the flag means the
rooms you already chose to join; "private" sounds inert when a held save
still works for its owner — your own room reads it, and it still shapes your
own pulls and ambitions.

The pair is now the product's own physics:

- **Out loud** — the default, and the default is unmarked. Every room you are
  in can read it, may quote a short excerpt with your name as evidence.
- **Held** — the exception, and the exception is the word that gets ink (and
  the colour: held is the only ink on the archive's right edge, which is what
  makes the audit scannable). Only your own room reads it. It never joins the
  pool a room's reading is made from, and it cannot be quoted.
- **The rule, named: "Rooms can't unhear."** Holding a save later stops every
  future reading — nothing new quotes or cites it, and it withdraws from the
  evidence lists of readings that already cite it (no tombstone; absence must
  be unremarkable or holding gets punished socially). What it cannot do is
  unmake a reading a room already produced: the reading is the room's memory
  of what it understood, and it stays on that room's wall and timeline.

Joining a room is the consent; holding a save is the per-signal veto. That is
why capture presents no toggle-shaped decision — only one quiet escape hatch.

Voice discipline (per the Aug 9 stranger-test audit, and the same day's
"machine goes unnamed" rule): the state names ("out loud", "held") appear
only with their fact line beside them; interactive verbs are plain ("keep
this one to yourself", "say why this caught you"); machine-generated
questions are labeled by what they are, never by a character (`A QUESTION
FROM THIS PULSE` — WAKA is not named in UI); dialog headlines are plain
questions ("Stop rooms from reading this?"), with the system's prose as
explanation underneath. Vocabulary note: ambition publishing now owns the
word "public" (draft / public, a genuinely public page), which is one more
reason signal visibility says "out loud", not "public".

## What the code already enforced (verified, not built)

- Every group read path filters `signals.shared_to_groups = true` at the
  query layer (`group-top-of-mind-synthesis`, `group-direction`,
  `group-combination-reading`, `signal-readings`, `reading-divergence`,
  `wow-candidates`, `queue`).
- Non-retroactivity display: a held save's evidence rows are filtered out of
  room display while the note stands (`signal-readings.ts` neighbor guard,
  `group-top-of-mind.ts` `signalShared` skip). The founder's sentence —
  "stops it being read, quoted, or shown as evidence, but the pull already
  generated is not taken away" — was already the implemented behavior.
- Group synthesis reads only `signals.text` + enrichment. Reflections feed
  embeddings and scores (the effect flows) but are never quotable text in a
  room. Quote sources are `own | enrichment` only.
- Reflections, guided-question generation (Gemini, prior-answers ladder), and
  sparks ("what caught you", with offsets) already existed.

No schema migration was needed for any of this goal.

## What shipped (2026-08-09)

1. **The held system, everywhere the flag appears** — composer control,
   save-detail foot, archive rows, `SHARING_MEANING` / `SHARING_NOTE` /
   `SharingExplainer`, kept-lines. `confirmLettingSpeakMessage()` guards the
   irreversible direction; `confirmHoldingMessage(n)` appears only when rooms
   have already read the save, and speaks this save's own numbers.
2. **The beat after keeping** — after a save completes, the confirmation line
   grows two invitations: "keep this one to yourself" (the escape hatch at
   its cheapest, before any room has plausibly read it) and "say why this
   caught you" (one generated question, labeled `A QUESTION FROM THIS
   PULSE`, answer or not now). Both optional, both gone when you start
   typing the next save.
3. **The archive lenses and marks** — an "everything / held" lens
   (server-side `filter=held`); unmarked default rows offering "keep to
   yourself" on reach; persistent "held" chips; a small second-beat dot on
   saves with at least one answered reflection (texture, not a todo — the
   unmarked state is not a debt).
4. **The sit (`/sit`)** — solo-only. When today's pulses have no why yet, the
   solo wall shows one quiet line: "Today's N pulses have no why yet. Sit
   with them?" The walk: one save at a time set large in the serif, one
   labeled question under it, answer or pass. A pass is recorded as a skip
   so tomorrow does not re-ask; skipped questions stay out of the detail
   transcript (bookkeeping, not content). No counters age, no badge reddens.
5. **Provenance beside the control** — the save detail shows "read in N
   rooms" next to the hold control, so the confirmation's numbers are visible
   before the dialog has to say them.
6. **API**: `answeredReflectionCount` / `skippedReflectionCount` on the
   archive list; `held` in the filter enum. Copy contract locked in
   `markQuote.test.tsx` (overclaim guards kept: never "anyone", never the
   internet).

## Decisions on record (founder may veto; defaults shipped)

1. **No tombstones.** When a held save withdraws from a note's evidence, the
   list silently shrinks. A tombstone is itself a read — "she took something
   back" is information — and holding must be unremarkable or it is punished.
2. **Reflection state is private too.** Rooms cannot see that a save was
   reflected on; only the effect flows. Even the second-beat dot is
   owner-only (it rides the owner's archive list).
3. **Generated prose stays verbatim.** If a note's own sentences absorbed a
   save's meaning at generation time, those sentences are the room's words
   and stand; only the evidence row (and its quote) withdraws. Sharpest edge
   of "rooms can't unhear" — stated in the contract copy, not discovered.
4. **A pass counts as sat-with.** Skipped questions never re-queue and never
   render as transcript. A ritual that renags is a chore list.

## The other three doors (follow-up PRs)

One capture grammar, four doors; every door produces the same object and the
same three-word toast (saved · keep to yourself · say why). The composer is
the reference implementation; the others compress it:

- **Mobile share sheet** — where most heart-reactions happen. One optional
  question after save, voice answer first-class.
- **Browser extension** — save the page or the selection at the moment of the
  reaction; the selection becomes the save's face (sparks already model
  this). Toast, never a popup form.
- **Cursor/desktop hotkey** — clipboard/selection capture with a small HUD;
  later becomes the bidirectional context-at-cursor door.

Also open: full-text (not preview) as the sit's question input; per-source
capture defaults (e.g. "everything from my journal arrives held").
