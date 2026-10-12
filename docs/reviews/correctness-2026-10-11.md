# Correctness and regression review — `ffee792a~1..HEAD`

17 commits, 82 files, +8137/−5213. The question asked here is narrow: **does this
code do what its commit messages claim, and did any of it break something that
used to work?** Design opinions are out of scope.

## How this was run

The working tree was dirty — a parallel agent is restoring `ReadingPanel`,
`AntechamberPanel`, `DuplicatesPanel`, `lib/api/reading.ts` and
`lib/api/signal-duplicates.ts` — so everything below was measured against a
clean export of `HEAD` rather than against the checkout.

| Gate | Result at clean `HEAD` |
| --- | --- |
| `packages/web` vitest | **116 files, 802 tests, all pass** |
| `packages/api` vitest (`DB_CONNECTION_URL=…/waka_test`, `JWT_SECRET` set) | **185 of 186 files pass, 1821 tests pass**; the single failure is `test/local-env-files.test.ts` shelling out to `git ls-files` inside my non-git export — it passes in the real checkout |
| `fresh-migrate.db.test.ts`, `conversation-context.db.test.ts`, `conversations.db.test.ts`, `conversation-replies.db.test.ts`, `conversation-retrieval.db.test.ts` against a real Postgres | 59 tests, all pass |

Two failures appear if you run the suite in the dirty checkout —
`orphans.test.ts` naming `resolveSignalDuplicate` and `verb-pairs.test.ts`
naming `restoreSignal`. **Both belong to the parallel agent's uncommitted work,
not to this range**: neither symbol exists at `HEAD`. They are the gates working
correctly on in-flight code.

Four findings are CONFIRMED — each reproduced with a failing probe. Eight more
are SUSPECTED and summarised at the end.

---

## CONFIRMED 1 — the third race: the away-window sentence crosses a wall

**Severity: high.** This is the founder's own reported bug ("did I not tell you
that when I'm switching between me and my agent the speech bubble should be
gone? Sometimes it's not gone") still live, through a writer that neither of
today's two fixes covers.

**Where.** `packages/web/src/pages/Home.tsx:4134` — `tell()` inside the
returning-visitor greeting effect:

```js
const tell = () => {
  if (toldRef.current) setCharSay(asSentence(toldRef.current, localeRef.current));
};
```

**Why it escapes both guards.** The two guards added today are:

- `speechEpoch` (`Home.tsx:636`), captured as `asked` and checked by `mine()` —
  but only inside `sayTheWeather` (`Home.tsx:3952`). `tell` never captures or
  checks it.
- the write seal (`Home.tsx:2583-2590`), which holds for `FORM_HUSH_MS` —
  **650 ms** — from the moment the wall changes.

`tell` is scheduled for **1400 ms** after the greeting arms when nothing is new,
and for **1400 + 2600 = 4000 ms** when there is a fresh memory to glide to
(`Home.tsx:4140`, `Home.tsx:4172`). So any wall or form change made more than
650 ms before the sentence speaks finds the seal already expired and the epoch
unconsulted, and a sentence about *your* day lands on whichever wall you are
standing on — including your agent's, the one wall the companion may not even
offer a save on.

**Reproduction** (probe, clean `HEAD`, the `speech-on-switch` harness):

```
localStorage['waka.seen'] = <two days before the fixture's memory>
fetchTheWeather → { told: 'you kept one memory while you were gone', … }
mount, settle, click "My agent", advance 8000ms

  control (no switch):  wall=self   speech="You kept one memory while you were gone"
  probe   (switched):   wall=agent  speech="You kept one memory while you were gone"
```

Expected `null` on the agent wall. Got the sentence. The existing
`speech-on-switch.test.tsx` does not catch it because all three of its cases go
through `creatureSpeaks` → `sayTheWeather`, the one path that *is* guarded.

**Note for anyone reproducing by hand:** this is invisible in `pnpm dev`.
`main.tsx:136` wraps the app in `React.StrictMode`, whose double-invoked mount
runs the greeting effect's cleanup (`timers.forEach(clearTimeout)`) and then
re-enters to find `greetedRef.current === true` — so in a development build the
away-window greeting never speaks at all. StrictMode's double-invocation is a
no-op in production builds, where the bug is reachable. (The `greetedRef`
early-return predates this range; it is noted only so the bug is not dismissed
as unreproducible.)

**Smallest fix.** Give `tell` the guard `sayTheWeather` already has — the wall
effect bumps the epoch, so one capture covers both wall changes and presses:

```js
const asked = speechEpoch;
const tell = () => {
  if (asked !== speechEpoch) return;
  if (toldRef.current) setCharSay(asSentence(toldRef.current, localeRef.current));
};
```

placed in the greeting effect body, beside `const toldRef = …`.

---

## CONFIRMED 2 — Escape on an edited archive note throws the edit away

**Severity: high (silent data loss).** The commit at `Home.tsx:2864` claims
"**EVERY WAY OUT OF A NOTE COMMITS IT** — not only Inspirations. With no chevron
on the page, all five of the bar's presses are exits from an open note." The
four dock rows do commit. Escape does not, and Escape is now one of only two
ways out.

**Where.**

- `SavesOverlay.tsx:522` — `<DialogSurface … onClose={onClose}>`, one handler
  for both depths of the surface.
- `DialogSurface.tsx:80-84` — Escape calls `onClose()` unconditionally.
- `Home.tsx:17676` — `onClose={viewNavigation.closeOpen}`, with no
  `commitOpenNote()`.

So at note depth, Escape closes the whole archive and `leaveNote` never runs.

**Reproduction** (probe, clean `HEAD`): mount `SavesOverlay`, open the one row,
type `"dusk on the hill, and the fog under it"` over the stored
`"dusk on the hill"`, dispatch `keydown` `Escape` on the `[role="dialog"]`.

```
ESC onClose calls= 1   updateInspiration calls= 0
```

The words are gone. Browser **Back** loses them the same way: the address change
unmounts the overlay, which fires `onNoteOpen(null)` (`SavesOverlay.tsx:435`) —
a handle release, not a write.

**Pre-existing in mechanism, newly the main risk.** At `ffee792a~1` the overlay
rendered `<button className="waka-over-back" … onClick={() => void leaveNote()}>`
— a visible, committing exit. This range removed it ("one mark to keep a note,
and no second door off it") and replaced it with `commitOpenNote()` on the dock
rows. Escape was always uncommitted; it has gone from one uncommitted exit among
three to one of two.

**Smallest fix.** Make Escape mean "leave the note", not "leave the archive",
which is also the correct semantics for a surface the file itself describes as
"one surface, two states":

```jsx
onClose={() => { if (open) void leaveNote(); else onClose(); }}
```

in `SavesOverlay.tsx:522`. (Fixing it in `Home` with
`onClose={() => { commitOpenNote(); viewNavigation.closeOpen(); }}` also closes
the hole but keeps Escape collapsing both depths at once.)

---

## CONFIRMED 3 — `whyNotKept` is read twice and the two reads disagree

**Severity: medium.** `lib/keep-ready.ts`'s header states the whole point of the
file: "`whyNotKept` is now the only statement of what blocks a save, so the
bar's Save and this function cannot disagree about whether a press should do
anything." They can, on two fields, and two call sites reach the write without
consulting the enablement predicate at all.

**The divergence.** `Home.tsx:11561` (what the button reads) against
`Home.tsx:11616` (what the write checks):

| field | render-time | `keepIt` |
| --- | --- | --- |
| `recording` | `recording.phase !== 'idle' \|\| dictation.listening` | `recording.phase !== 'idle'` |
| `uploading` | `checkingFiles \|\| Boolean(uploadingMediaId)` | `Boolean(checkingFilesCount.current)` |

The write's guard is the **looser** of the two in both rows, so a path that
reaches `keepIt` without going through the button saves in a state the button
has declared unsafe.

**Both such paths exist, and both are in this range's surfaces:**

1. `Home.tsx:11716` — `onMouthKey`, the notepad's `Cmd`/`Ctrl`+`Enter`, calls
   `void keepIt()` with no `composerCanKeep` check.
2. `InspirationComposer.tsx:315` — `Enter` in the link field calls `submit()` →
   `props.onSubmit()` → `keepIt`, gated on its own third copy of the rule,
   `blocked = props.busy || save.pending || !props.ready || recording.phase !== 'idle'`
   (`InspirationComposer.tsx:233`), which also omits dictation, invalid files,
   the five-file ceiling and the undecided recording.

**Reproduction (inputs → wrong output).** In the notepad, press the dock
microphone, speak, and press `Cmd+Enter` while the engine still holds
un-finalized interim text. The dock's Save is disabled with the title "Finish
the recording first"; `keepIt` runs anyway and writes the note **without the
interim words** — precisely the outcome the render-time comment says the rule
exists to prevent ("saving mid-utterance would drop whatever the engine had not
yet marked final"). Same press with a draft file mid-upload bypasses
`uploadingMediaId`.

**Smallest fix.** Add the two missing terms to the `keepIt` call so the two
reads are literally the same expression:

```js
recording: recording.phase !== 'idle' || dictation.listening,
uploading: Boolean(checkingFilesCount.current) || Boolean(uploadingMediaId),
```

and have `onMouthKey` and `InspirationComposer`'s `submit()` consult
`composerCanKeep` rather than hand-written conditions — the file's own argument
is that a rule repeated at N call sites will be missed at the N+1th.

---

## CONFIRMED 4 — the chat's run grouping breaks where the pending draft joins

**Severity: low (visual and announced-metadata only).** The grouping arithmetic
itself is right; the appended draft is not part of it.

**Where.** `ConversationPanel.tsx:356-371` computes `data-run` from neighbours
inside `conversation.messages` only, and the pending draft is a separate
`<article … data-run="fl">` at `ConversationPanel.tsx:375`, outside the `map`.

**The arithmetic on confirmed messages is correct** — verified: a
user/user/assistant thread renders `fm`, `ml`, `fl`, with metadata on the two
`…l` rows. First message, single message, alternating and long runs all come out
right.

**Where it is wrong.** When the last confirmed message is from the user and a
pending draft follows it, the confirmed message computes `after === undefined`
and so claims to be the end of its run:

```
probe: one confirmed user message + one held (never-resolving) send
  got  ["user:fl", "user:fl"], 2 metadata rows
  want ["user:fm", "user:ml"], 1 metadata row
```

Two of your own consecutive bubbles render as two separate runs with a timestamp
between them — against the rule the code quotes from the reference library and
obeys everywhere else ("one timestamp per run, on the last bubble").

**Reachable** whenever two user messages can stand consecutively: with
`generationEnabled === false`, or after a reply is stopped (`phase === 'stopped'`
clears `awaitingReply`, so Send re-enables with a user message last).

**Smallest fix.** Let the draft participate in the neighbour test:

```js
const pending = draft?.pending && !conversation?.messages.some(m => m.id === draft.id) ? draft : null;
// inside the map:
const after = all[at + 1] ?? (pending ? { role: 'user' as const } : undefined);
// and on the pending article:
data-run={all.at(-1)?.role === 'user' ? 'ml' : 'fl'}
```

---

## What held up

Checked and found correct — recorded so the next reader does not re-derive it.

**The positional parameter shift (`readConversationContext`).** The new
signature is `(db, profileId, question, referenceIds?, initialPrincipleId?,
initialInspirationId?, queryVector?, onRetrievalTrace?)`
(`conversation-context.ts:36`). The two same-type neighbours
(`initialPrincipleId` / `initialInspirationId`, both `string | null`) are the
real hazard, and every one of the four call sites passes them in the right
order: `conversation-replies.ts:73` (8 args), `routes/conversations.ts:243`
(6 args), `readConversationReferenceSources` (4 args, so both default to
`undefined`), and `conversation-retrieval.db.test.ts:38`, which gained the one
extra `undefined` it needed. No caller exists outside `packages/api`.

**The pin cannot break historical citation.** The pin block
(`conversation-context.ts:71`) is gated on `!referenceIds`, and
`readConversationReferenceSources` always passes `references` — so the
exact-closed-set read is untouched. `conversation-context.db.test.ts:108`
asserts it directly with a pin supplied alongside a citation.

**`focusIndex`.** `conversation-replies.ts` builds it from two `findIndex`
calls; with a `null` id each returns `-1` (no source has a null `id`), and
`.find(i => i >= 0) ?? -1` is correct. Principle keeps precedence, as documented.

**Migration 0069's journal entry.** At `ffee792a~1` the journal ended at idx 68
— *neither* 0069 nor 0070 was in it, so no deployed database carries the
"0070 at idx 69" record the commit message describes; that was an intra-session
state. The final journal has idx 69 at `1791512364893` and idx 70 at
`1791745200000`, which is strictly between 68's and above 69's — `idx` has no
gap and `when` rises, which is what drizzle's migrator walks. Both SQL files are
idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and 0070's
constraint inside a `DO $$ … EXCEPTION WHEN duplicate_object` block), so
re-application where a column was added by hand is safe. The whole corpus
applies to an empty database in `fresh-migrate.db.test.ts`.

**The trailing-whitespace fix on the archive's Save.** Measured, not reasoned:
with a dock slot present, `canKeepOpenNote` is `disabled` at open, still
`disabled` after typing a trailing space, and `enabled` after a real edit. The
claim at `SavesOverlay.tsx:318` holds. (`leaveNote` and `keepOpenNote` compare a
trimmed draft against an untrimmed `preview`, which would misfire on a note
whose stored text had surrounding whitespace — but `inspirations-validation.ts`
applies `z.string().trim()` on both create and update, so `preview` is always
trimmed and the asymmetry is unreachable through the API.)

**The autosave fires on all four dock rows.** `home`, `talk` and `principles`
call `commitOpenNote()`; `saves` calls the closer directly
(`Home.tsx:17184`, `:17218`, `:17228`, `:17229`). The fifth row — the plus — is
*not* wired, and does not need to be: `Home.tsx:17302` replaces that slot with
the `NoteTools` portal target whenever `savedNoteOpen` or `view.compose`, so the
plus is unrendered while any note is open.

**The explicit Save and the autosave cannot double-write or clobber.**
`keepOpenNote` re-points `open.preview` at the words it stored, which makes
`leaveNote`'s `words === note.preview` early-return true, so leaving after an
explicit save sends nothing. Both are gated on `saving`, and the two presses are
separate event-loop turns, so the state is committed between them.

**The side-drawer removal is complete.** No `.chat-aside*`, `.chat-about*`,
`.chat-drawer*` or `.chat-pin*` rules survive in `chat.css` (only comments
recording their removal); no `pinConversationInspiration` wrapper, no drawer
state, no props threaded to nothing. `ApiConversation.initialInspiration` and the
`PATCH /:id` route remain deliberately, each annotated with the recovery path.
`ConversationPanel.tsx` — the file that was lost and rebuilt twice — reads
coherently: the `mine(owner)` fix captures the controller per routine at all
eleven sites, `run()`'s abort plumbing is symmetric, and `observe`'s
revision-monotonicity guard is intact.

**The send/stop toggle cannot strand a conversation.** Stop is now gated on
`replyPending` alone (`ConversationPanel.tsx:467`). At `ffee792a~1` it was
nested inside `awaitingReply && !reply.error`, so a pending reply whose status
poll had failed showed *no* Stop at all. The new placement is strictly more
available. (The permanently-disabled-Send state — `generationEnabled && last
message is user && reply.state === null` — is unchanged from base.)

**The ratchets moved the right way.** `SPACE_CEILING` 29→19 and
`COLOUR_CEILING` 84→79 are *tightenings*. `verb-pairs.test.ts` and
`capitalized.test.ts` lost entries for verbs and strings that no longer exist —
those gates discover their subjects dynamically and fail when a live verb has no
register line, which is exactly what they did against the parallel agent's
re-added `restoreSignal`. `capitalized.test.ts`'s parse tripwire dropped
600→540 against an actual 595 Latin-initial values: still a tripwire with
headroom, not a ratchet pinned to the figure.

---

## SUSPECTED

Reasoned, not reproduced. Ordered by severity.

1. **The microphone is never released when the notepad closes** —
   `Home.tsx` calls `dictation.stop()` from exactly one place
   (`Home.tsx:17316`), inside the block gated on `view.compose`. `saveAsDraft`
   (`Home.tsx:11418`) stops `recording` but not `dictation`, and
   `useDictation`'s only automatic release is its unmount cleanup
   (`use-dictation.ts:124`) — whose host is `Home`, which stays mounted for the
   session. So leaving the notepad while dictating unmounts the "Stop" control
   and leaves the engine listening, still writing into `draftRef`/`setDraft` via
   `onText`, with no visible way to switch it off. `base.current` holds the
   pre-leave text, so each further result rewrites the whole keep box.
   `ConversationPanel` is safe — its hook unmounts with the page and calls
   `abort()`. Weight: the product's own copy
   (`worldComposerDictateCloud`) tells the person Chrome sends their audio to a
   third party. Could not reproduce in jsdom: the `Speak` control is
   `disabled={!composerDraft.available}` and the IndexedDB-backed draft store
   never reports available there. Fix: `useEffect(() => { if (!view?.compose &&
   dictation.listening) dictation.stop(); }, [view?.compose])`, plus
   `dictation.stop()` at the head of `keepIt`.
2. **The setter-level seal silently drops failure sentences.** `setCharSay`
   (`Home.tsx:1895`) drops every non-empty write while sealed, and the seal is
   on for 650 ms after any wall change. The commit reasoned only about the
   weather sentence, but about a dozen of the ~20 call sites are error reports —
   `Home.tsx:12406`, `:12448`, `:12460`, `:12477`, `:12498`, `:12538`, `:12553`,
   `:12094`, `:13665` — plus the save receipt at `:11490`. A write that fails
   inside that window says nothing at all, against the standing rule that "a
   quiet surface is not the same as a quiet failure". Fix: give `setCharSay` a
   second argument so a failure sentence is exempt from the seal, or seal only
   the weather/telling writers.
3. **`useDictation` can splice the previous session's words into the next.**
   `stop()` (`use-dictation.ts:126`) calls the engine's `stop()` — which asks
   for one more final result — and immediately clears `session.current`. A
   `start()` before that trailing result arrives resets `base.current` and
   `settled.current`, and the old engine's `onresult` then writes
   `base(new) + settled(old words appended)`. Narrow (stop-then-start inside one
   engine's tail) but real. Fix: `abort()` in `stop()`, or capture the engine in
   the handler closure and ignore results from a non-current one.
4. **Dead CSS from the note-page unification, and one vacuous assertion.**
   `.jar-note-back` (`chrome.css:1409-1442`, two blocks) and `.jar-note-tools`
   (`home.css:4799`) have no markup anywhere in `packages/web/src`;
   `home.css:4966` still names the latter inside a `:not()`. Consequently
   `one-note.test.tsx`'s `corners: querySelectorAll('.jar-note-tools').length`
   can only ever be `0` — the assertion that "neither page may grow an attach
   corner" cannot fail. `tools/e2e/dead-css.ts` was re-pointed correctly in this
   range (no suppression was added) but it is a browser tool, not part of the
   vitest suite, so it has not swept these yet. Fix: delete the three blocks and
   re-point that assertion at a class that exists.
5. **`way-out.test.ts`'s new exemption is wider than its compensating check.**
   `SURFACE_LEFT_BY_DOCK` exempts any surface span containing
   `data-way-out="…"` in *every* scanned file, while the check that validates the
   claim against the dock's real row list reads only `src/pages/Home.tsx`. A
   surface in any other file can write `data-way-out="nonsense"` and be exempted
   unchecked. Fix: run the `claimed` loop over the same file set the scan walks.
6. **With `generationEnabled === false` the chat now says nothing about it.**
   `ConversationPanel`'s `{generationEnabled===false ? <p
   className="chat-notice">{say('worldConversationFoundation')}</p> : null}` was
   removed and the string deleted from both catalogues, and `whyNoSend` has no
   case for `false`. You can send and never be told no reply is coming. The
   conversation-panel test that used to assert the sentence was rewritten as two
   negative assertions (`not.toContain('Thinking')`), which guard the weaker
   claim. This looks deliberate rather than accidental, so it is listed as a
   behaviour loss for the founder to confirm, not as a bug.
7. **The shine outlives the sentence it accompanied.** `creatureSpeaks` sets
   `lit` for `LIT_MS` (1400 ms) with cleanup only on unmount
   (`Home.tsx:1987`). A wall change inside that window clears `charSay` but
   leaves the creature bright on the new wall for up to 1.4 s, "answering" a
   question asked somewhere else. Fix: clear `litTimer` and `setLit(false)` in
   the wall effect that already seals and clears.
8. **An attachment-only note seeds a synthetic label into its own text.**
   `SavesOverlay.tsx:1028` does `setDraft(row.preview)`, and `preview` for a note
   with no words is `inspirationPreview`'s generated label — "Photo",
   "Saved inspiration". Typing anything then saves `"Photo" + what you typed` as
   the person's own words, against `inspiration-preview.ts`'s own warning
   ("Never turn filenames, object keys or model descriptions into the person's
   own words"). Pre-existing — base did the same — but the new explicit Save
   puts a lit button next to it. Fix: open the note on its real text (`null`
   when there is none) and keep `preview` for the list.

---

## What I could not check, and why

- **The microphone leak (SUSPECTED 1) in a running browser.** The dev server at
  `:3010` serves the dirty working tree, and `Home.tsx`, `SavesOverlay.tsx`,
  `Menu.tsx` and four stylesheets are mid-edit by a parallel agent — a browser
  reproduction there would not be a statement about this range. In jsdom the
  `Speak` control is disabled because the IndexedDB draft store reports
  unavailable. Reproducing it needs either a clean dev server or a stubbed draft
  store.
- **Anything visual.** jsdom has no layout. The claims this range makes about
  geometry — that the two note pages put the same parts at the same
  coordinates, that the bubble hugs its text rather than filling 85% of the
  measure, that the two bubble weights are 0.843 and 0.706, that the sheet is
  centred on the plus — are held by browser walks in `tools/e2e`, which I did
  not run for the same reason as above.
- **The reply generation path end to end.** `conversationRepliesEnabled()`
  requires `WAKA_CONVERSATION_REPLIES=1` and a live model provider. The pin
  reaching the model *input* is proved by
  `conversation-replies.db.test.ts`; that the model then uses it is not
  checkable here.
- **`PATCH /conversations/:id` from a client.** The route and its db tests are
  live, but nothing on the client calls it, so there is no integration to
  exercise. Its two-tab locking argument is read, not measured.
- **The `0070` constraint on older Postgres.** `ON DELETE SET NULL(column)`
  needs Postgres 15+. It applies cleanly on the local test database; I did not
  check the deployed server's version.
- **Whether SUSPECTED 6 is a decision or an omission.** Only the founder can say
  whether the "replies aren't connected" sentence was meant to go entirely or
  only to move.
- **The nine source files scrubbed of the reference library's name.** The
  standing gate (`unnamed-reference.test.ts`) passes at `HEAD`, which is the
  check that matters going forward; I did not independently re-scan history.
