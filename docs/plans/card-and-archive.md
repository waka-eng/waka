# Card and archive: what was tried, and what a fix needs

Known issues L11, L12, L13. Home's memory card and the archive's note page can
both edit one note. Four review rounds on `claude/followup-card-archive`
(2026-10-21) each found new defects, so every code change was reverted to
`origin/dev`. This file records the attempts, so the next one starts from
what failed. **L12 has since been fixed** on `claude/recorder-in-home` (see
"L12: fixed" below); L11 and L13 are still open.

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
- **A clip that outlives the archive (L12) — done, see below.**
- **A read that cannot overtake its door's write.** The archive's way-out
  write must land before the card seeds an edit of the same note. Order the
  writes per note in one place both doors call, without making reads wait on
  writes. Waiting reads were already reverted once (L13).
- **Browser-level tests** for Back, iOS focus, and a write that never answers.
  jsdom cannot stage the orderings that broke each round.

## L12: fixed (`claude/recorder-in-home`, 2026-10-21)

The final review of PR #455 named the simpler fix, and it is the one taken:
**lift the recorder, don't save the clip from an unmount path.** The bullet
this replaces said the clip had to be rescued from the overlay's unmount and
that it was lost on every close. Both were wrong (PR #455, "Corrections from
the final review"): a pushed archive's close can win the race, and the
recorder never has to unmount at all.

- **The recorder lives in `Home`.** `lib/archive-recorder.ts`
  (`useArchiveRecorder`) wraps the same `useAudioRecording` the notepad uses.
  `Home` calls it and passes it to `SavesOverlay` as `recorder`. The hook's
  `mounted.current` and epoch guards are untouched: they never fire, because
  the hook no longer unmounts with the archive.
- **The clip keeps its note and its owner.** `recorder.start(note,
  profileId)` records the note's id, its words (for the failure line) and the
  archive's profile. The overlay wraps `start` for `NoteTools`, still inside
  the tap (no await before the microphone). The clip is attached to that note
  under that profile, even after a wall switch has remounted the archive on
  another owner. It never goes to whatever note is open later.
- **Leaving the archive stops the recording.** The overlay's unmount calls
  `recorder.stop()` (no live microphone with no Stop). Leaving the note still
  stops it through the note-change effect. No `popstate` listener was added.
- **`Home` uploads and reports.** Presign (with `?profile=`), upload and
  finalize run in the hook, not in `SavesOverlay`'s `attach`. On success the
  overlay, if it is mounted on the same profile, re-reads its list and
  re-points the open note. On failure `Home` shows `.waka-clip-failed` above
  the dock: "Couldn't attach your recording to "<note>"." with Try again and
  ×. It stays until one of them is pressed. Try again sends the same file to
  the same note under the same profile.
- **One microphone at a time.** `useArchiveRecorder({ blocked })` refuses to
  start while the notepad's recorder is not idle, and the notepad's Record
  (dock and composer mic) is disabled and refused while the archive's is not
  idle. The upload is not awaited inside the recorder, so the notepad is held
  off only while the archive's microphone is live, not for a round trip.
- **Tests:** `test/archive-recording-outlives.test.tsx` mounts `Home` and
  delivers `stop` only after the archive has gone, the order a browser
  produces. It covers Close, Escape, Back, a cold link's close, a wall switch
  (original note, original profile), a failed upload after close (line, Try
  again, ×) and both directions of one-microphone. Standalone archive suites
  mount it through `test/helpers/archive.tsx`, which supplies the recorder.

**After `/code-review` (2026-10-22), each its own commit with a test:**

- **One attach helper.** `lib/attach-to-note.ts` (`attachToNote`) is the
  presign/upload/finalize both the archive's photo door and the recorder call.
- **Uploads per note.** In-flight uploads are counted per note and owner
  (`isSending(noteId, profileId)`), so two concurrent clips keep their own
  "Uploading…" and neither clears the other.
- **`beforeunload` while uploading.** The recorder's own warning ends at
  idle; `useArchiveRecorder` warns while any clip upload is in flight.
- **One object.** The returned recorder is memoized, and the microphone
  request is a module constant, so the hook's `start` is stable.
- **Re-point only the landed note.** A clip landing on note A no longer swaps
  an open note B's card for the list's copy.
- **Unmount stop from the press.** `start` marks the recorder live
  synchronously and the archive's unmount calls `stopIfLive()`, so Record and
  leaving in one commit never leave a live microphone.
- **Recorder errors reach Home.** The archive tells the recorder which note
  it shows (`setViewing`). An empty, too-large, interrupted or refused
  recording for any other note, or after the archive closed, goes to Home's
  line ("Your recording for "<note>": …", × only). Reopening the archive
  does not clear it.
- **Residual: L14** (`docs/known-issues.md`). An account or profile switch
  remounts `HomeExperience` and drops a pending clip and its line. Not
  restructured.

Still open from the L13 entry: `finalizeAttachment` for an inspiration sends
no `?profile=`. The lifted recorder keeps the calls the archive made before.
