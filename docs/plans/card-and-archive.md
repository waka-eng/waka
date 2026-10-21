# Card and archive: what was tried, and what a fix needs

Known issues L11, L12, L13. Home's memory card and the archive's note page can
both edit one note. **No code shipped from this plan.** Four review rounds on
`claude/followup-card-archive` (2026-10-21) each found new defects, so every
code change was reverted to `origin/dev`. This file records the attempts, so
the next one starts from what failed.

Before this branch, earlier attempts (a shared detail cache, freshness
counters, pending-write counts, conflict prompts, reads that waited on writes)
were reverted too. Conflicts landed on the wrong note, reads hung, stale words
came back, and the iOS keyboard stopped rising.

## Attempt 1: the archive's way out waits on its own writes (rounds 1-3)

Close, Escape and the top-of-mind row awaited a running recording's
attachment and the open note's write, later with a 20 s deadline.

Why it failed: the close became asynchronous, and every assumption around it
was synchronous. The archive flickered. A closer captured before the wait
dropped words cleared during it. A failed clip on a note already left meant a
silent no-op close. A late close shut a newer note. The recorder's error path
was reported as success. A failed list re-read was reported as a failed
upload. A write that never answered held the archive open. The deadline added
for that then closed the archive over work still running.

## Attempt 2: the card refuses to let go of unsaved words (rounds 1-4)

Bar, menu and chat presses were refused while the card held changed words or
a save in flight, with "Save or cancel this edit first." and, after 20 s, a
Cancel edit offer. The card's edit was also refused under the archive.

Why it failed: a refusal has to be correct at every call site, and the call
sites carry side effects. The review exit was refused. `savesFocus` was set
before a refused open. A refused tap took focus, and iOS refocused. The
refusal was silent when the held edit was not on screen. ↩ via `openTalk`
was still gated. Exits had to be exempted one at a time (Close, top of mind,
Escape, ↩), and each round found another.

## What a viable fix needs

- **One owner for "leaving the card",** not a check in front of each door.
  The decision belongs where the selection changes (`leaveWordsRef`), so
  every route (bar, menu, orb tap, address, Back) gets the same answer.
- **No refusal and no wait on any press.** Keep the iOS rule: focus happens
  inside the tap. The cheapest shape is to commit the card's words on the
  way out, the way the archive does. Report a failure through Home, which
  outlives both surfaces, never through the surface that just unmounted.
- **A clip that outlives the archive.** The recorder hands the clip over
  after unmount, and Home owns the upload and its failure line (L12).
- **A read that cannot overtake its door's write.** The archive's way-out
  write must land before the card seeds an edit of the same note. Order the
  writes per note in one place both doors call, without making reads wait on
  writes. Waiting reads were already reverted once (L13).
- **Browser-level tests** for Back, iOS focus, and a write that never answers.
  jsdom cannot stage the orderings that broke each round.
