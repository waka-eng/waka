# Card and archive: one door at a time

Known issues L11, L12, L13. Home's memory card and the archive's note page can
both edit one note. Earlier fixes tried to coordinate the two doors (a shared
detail cache, freshness counters, pending-write counts, conflict prompts,
reads that waited on writes) and were reverted: conflicts landed on the wrong
note, reads hung, stale words came back, the iOS keyboard stopped rising.

This plan coordinates nothing. **Only one door is open at a time, and a door
does not close while its own write is still out.** Nothing is shared between
the two surfaces, nothing is counted, and no read ever waits.

## The rules

1. **The card does not let go of unsaved words.** While the card's edit holds
   words that differ from the ones it opened with, or its Save is still in
   flight, a press that would take Home somewhere else (a bar row, a menu
   row, anything through `openOverHome` or `openTalk`) does nothing except
   show one line on the card: "Save or cancel your changes first." The card's
   own Save and Cancel sit right under it. Nothing is awaited: the press
   either goes through at once, inside the tap, or it does not happen. So a
   field that is focused next (the notepad, a chat's composer) still gets
   focus inside the tap, and the iOS keyboard still rises.
   Unchanged words, and an edit already in its "Saved" beat, let go as they
   do today.
2. **The card's edit cannot open while the archive is open.** This is already
   true: applying any address clears the selection, which closes the card,
   and the archive covers the world. A test pins it.
3. **The archive does not close while its own writes are out.** Every way out
   that Home handles (Close, Escape, a top-of-mind row) goes through
   `leaveOpen`, and `leaveOpen` now awaits, in this order:
   - a running recording: stop it, and wait until the clip is uploaded and
     attached to the note it was recorded on. If the upload fails, the archive
     stays open on that note with its upload-failed line.
   - the open note's changed words: wait for the save. If it fails, the
     archive stays open with "That didn't save. Your words are still here."
   Then it closes, but only if the address has not moved in the meantime. A
   second press while it waits does nothing. No editor is focused after the
   archive closes (the world and the card start read-only), so this wait
   cannot cost a keyboard.

## What each race in L13 becomes

- *Card save in flight when the archive opens*: cannot happen (rule 1).
- *Card edit seeded from words older than an archive save*: the card cannot
  edit while the archive is open (rule 2). The archive's save has landed
  before it closes (rule 3), and the card reads the note again when it opens.
- *Archive changes not shown in Home's field until Home reads again*:
  **skipped.** Fixing it means telling Home what changed, or reloading the
  field on close. The first is the coordination layer this plan avoids. The
  second moves orbs the person did not touch. The card itself is always
  read fresh.
- *Two writes from two doors not ordered on the client*: covered by rules 1
  and 3, because only one door can have a write out at a time.

## Not covered

The browser's own Back, and switching walls from the corner, take the
address away from outside React. Nothing can be awaited there. The archive
still commits on the way out, but does not wait for it, and a recording
running at that moment is still lost (L12 stays open for those two routes).
