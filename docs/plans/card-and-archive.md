# Card and archive: one door at a time

Known issues L11, L12, L13. Home's memory card and the archive's note page can
both edit one note. Earlier fixes tried to coordinate the two doors (a shared
detail cache, freshness counters, pending-write counts, conflict prompts,
reads that waited on writes) and were reverted: conflicts landed on the wrong
note, reads hung, stale words came back, the iOS keyboard stopped rising.

This plan coordinates nothing. **Only one door is open at a time.** Nothing is
shared between the two surfaces, nothing is counted, and no read or close
ever waits.

## The rules

1. **The card does not let go of unsaved words.** While the card's edit holds
   words that differ from the ones it opened with, or its Save is still in
   flight, a press that would take Home somewhere else (a bar row, a menu
   row, anything through `openOverHome` or `openTalk`) does nothing except
   show one line on the card: "Save or cancel this edit first." The card's
   own Save and Cancel edit sit right under it. Nothing is awaited: the press
   either goes through at once, inside the tap, or it does not happen. So a
   field that is focused next (the notepad, a chat's composer) still gets
   focus inside the tap, and the iOS keyboard still rises. If the save is
   still out after 20 s (`lib/leave-deadline.ts`), the line also offers
   Cancel edit, so the bar is never dead. Unchanged words, and an edit
   already in its "Saved" beat, let go as they do today.
2. **The card's edit cannot open while the archive is open.** This was
   assumed, and checking it showed it was false. An address holding both a
   note and `?open=saves` draws the card under the archive, and its words
   still opened an edit. Now the card's edit refuses while any page is held
   up over the world. The check is synchronous, so a permitted edit still
   opens inside the tap.
3. **Every way out of the archive is exempt from rule 1**: the list's return
   row, the bar's Close, the top-of-mind row and Escape. They lead back
   toward the card, never away from it.

## Tried and reverted: the archive waiting on its own writes

Three review rounds made Close, Escape and the top-of-mind row wait for a
running recording to attach and for the note's write to land, later with a
20 s deadline. Each round found new defects: flicker, a stale closer dropping
cleared words, silent no-op closes, a late close shutting a newer note, the
recorder's error path reported as success. So the close is back to
`origin/dev`: it fires the write and leaves. L12 and that half of L13 stay
open in `docs/known-issues.md`, with every case found.

## What each race in L13 becomes

- *Card save in flight when the archive opens*: cannot happen (rule 1).
- *Card edit seeded from words older than an archive save*: the card cannot
  edit while the archive is open (rule 2). It is still open on the way out:
  the archive's write may land after the card reads again.
- *Archive changes not shown in Home's field*: skipped. It needs either the
  coordination layer this plan avoids, or orbs moving untouched.
- *Two writes from two doors not ordered*: open for the archive's way out.
