# Dead-code and cleanliness review — `ffee792a~1..5eee072f`

17 commits, 82 files, +8137/−5213. The question asked here is narrow: **after a
session that deleted a page, five settings sections, eleven modules, 121
catalogue strings and 130 CSS rules, what did the deletions leave behind, and do
the comments still describe the code that is there?** Correctness is reviewed in
`correctness-2026-10-11.md`; design opinions are out of scope.

## Verdict

**Clean enough to build on.** The deletions were done with the discipline this
repo asks for — every removal site carries a tombstone, the gates that had to
move were moved by teaching rather than by loosening, and both lowered ratchets
are real (verified below, to the literal). The residue is of one kind: **the
session swept the live code and did not sweep what pointed at it.** Nothing here
is a behaviour bug; most of it is a future reader being told something that was
true yesterday.

Three things to fix first:

1. **The browser gates still walk `/profile`.** 14 navigations across six
   `tools/e2e` scripts and 15 `.profile-*` selectors in `journeys.ts` point at a
   route that no longer exists — and because `/profile` now falls through to
   `/:handle`, it redirects to the world rather than 404ing, so those walks run
   silently on the wrong page. `dead-css.ts` was rewritten for the new panel;
   nothing else was.
2. **23 classes were stranded.** The product's dead-class count went from
   57 to 80 in this session, including the whole hover-card family whose own
   comment names its call site as `Profile.tsx`, and a `.jar-keep-via:hover`
   with no base rule — the second instance of the orphaned-modifier bug the
   `.jar-char-bubble--aside` fix was for.
3. **`lib/api/index.ts`'s header table still advertises four deleted clients.**
   That table is the one map of the client-to-route surface, and the next commit
   edited the file without fixing it.

## How this was run

HEAD moved while this review was being written: the parallel agent's work landed
as `d722fd6f` ("the three machinery doors come back, behind the \"i\""), which
restores `ReadingPanel`, `AntechamberPanel`, `DuplicatesPanel`,
`lib/api/reading.ts` and `lib/api/signal-duplicates.ts`. The reviewed range is
the 17 commits ending at `5eee072f`, but **every finding below was re-verified
against `d722fd6f`** and anything that commit already repaired has been dropped.
Line numbers are `d722fd6f`'s.

| Gate | Result |
| --- | --- |
| `packages/web` vitest at `d722fd6f` | **119 files, 817 tests, all pass** |
| `packages/web` vitest in the dirty window | 1 failure — `verb-pairs.test.ts` naming `resolveSignalDuplicate` and `restoreSignal`, both from the parallel agent's then-uncommitted restore. The gate working correctly on in-flight code, not a finding. |
| `tools/e2e/dead-css.ts` against the dev server on :3010 | runs; 94 selectors reported unreachable, 4 surfaces NOT WALKED (below) |
| Own probes | full-tree CSS class reachability, catalogue-key reachability, duplicate-selector diff, prop-read analysis, comment-reference resolution — all run twice, once on `ffee792a~1` and once on HEAD, so every count below is a delta rather than a snapshot |

Eight findings are CONFIRMED HIGH, eight CONFIRMED MEDIUM, seven CONFIRMED LOW.
Two are SUSPECTED and need a browser.

---

# CONFIRMED — HIGH

## H1. Six e2e scripts still walk `/profile`, and it silently redirects

**Where.** `tools/e2e/journeys.ts:748, 755, 772, 816, 874, 1852, 1903, 1999,
2063`; `tools/e2e/usability.ts:309`; `tools/e2e/answers-the-hand.ts:353`;
`tools/e2e/computed-snapshot.ts:83`; `tools/e2e/web-quality-locales.ts:14, 35`.
Plus 15 `.profile-*` selectors in `journeys.ts`, and its header at line 149:
`` `/profile` IS NOT A FLAT SCREEN IN THE SENSE THAT WAS RETIRED, so this stays ``.

**Why it matters.** `main.tsx` deleted the route (and says so, at line 182), so
`/profile` now matches `<Route path="/:handle">`; `PublicProfile.tsx:122` sees a
handle that does not start with `@` and returns `<Navigate to="/" replace />`.
The walk does not fail — it lands on the world. `journeys.ts`'s own `goSurface`
(line 156) is `goto` plus a 2.5s wait with no address assertion, so the only
symptom is later locators timing out on a page nobody meant to be on, and any
step whose assertion is "this is absent" now passes vacuously. This is the same
class of defect `one-class-one-thing.test.ts`'s header is about: nothing looks
wrong, and the machinery behaves perfectly.

The session did do this sweep for the Save control — `.jar-note-save` →
`.waka-dock-tool--keep` in `keep.ts`, `usability.ts` and `by-keyboard.ts`, each
with a note — which is what makes the omission visible: the same pass should
have carried `/profile`.

**Smallest fix.** Each `/profile` navigation becomes "open the gear from the
world": `await page.locator("button.waka-corner--settings").click()`, which is
exactly what `dead-css.ts:724` was rewritten to do. The `.profile-*` selectors
in `journeys.ts` become `.waka-settings-*`. Delete the line-149 note.

## H2. `lib/api/index.ts`'s route table names four deleted clients

**Where.** `packages/web/src/lib/api/index.ts:11, 19, 20, 21`:

```
 *   sessions.ts                  sessions.ts      /api/sessions
 *   keeper-keys.ts               keeper-keys.ts   /api/keeper-keys
 *   agent-grants.ts              agent-grants.ts  /api/agent-grants
 *   consultations.ts             consultations.ts /api/consultations
```

**Why it matters.** All four modules were deleted in this session; the table is
the one place in the repo that holds the client-to-route mapping in one view, and
its header says so ("so the two sides of the wire can be held in one head at
once"). A reader looking for the sessions client is now sent to a file that does
not exist, and the barrel below the table does not export it. `d722fd6f` edited
this same file — it added a correct tombstone at line 71 for `reading` and
`signal-duplicates` coming back — so the table was read twice and fixed neither
time.

**Smallest fix.** Delete the four rows. The body already carries tombstones for
the removals, which is where the reasoning belongs.

## H3. `ConversationPanel` keeps the pre-removal comment and the tombstone, in that order

**Where.** `packages/web/src/components/ConversationPanel.tsx:494–509`, then
`510–536`.

The first block is present tense and describes the drawer as shipped:

> ═══ WHAT THIS CONVERSATION IS ABOUT, BESIDE IT ═══ … `.chat-page` becomes a
> row wide enough to hold both and stays a column when it is not — see
> `.chat-aside`, where the one breakpoint is reasoned about. … ONLY ON A REAL
> CONVERSATION. Pinning is a fact about a conversation …

The block immediately after it is the removal tombstone ("THE SIDE PANEL IS
GONE, AND SO IS PINNING"). `.chat-aside` does not exist —
`chat.css:222` records that it went with the drawer.

**Why it matters.** This is the worst shape a stale comment can take: not an old
claim in a file nobody opens, but a *present-tense specification followed by its
own retraction*, where the first half points the reader at a selector to go read
and the selector is gone. A reader who stops at the first block believes the
panel renders.

**Smallest fix.** Delete 494–509. Nothing in it is argument the tombstone does
not already carry, and the one sentence worth keeping (the better label, "reference
and inspiration") is already in the tombstone.

## H4. 23 classes were stranded; the dead-class count went 57 → 80

Measured by resolving every class token in `src/styles` against every `.ts`/`.tsx`
in `src`, once at `ffee792a~1` and once at HEAD. These 23 had a renderer before
the session and have none now. `dead-css.ts`'s own text check sees most of them
(94 unreachable selectors in the run above) and the session shipped anyway.

**The families, by host:**

| Where | Selectors | What they were |
| --- | --- | --- |
| `claims.css:1070–1147` | `.waka-hovercard`, `.waka-hovercard-trigger` (+3 states), `.waka-hovercard-card`, `.waka-hovercard-card a` | `HoverCard.tsx`, deleted |
| `claims.css:1056` | `.jar-keep-via:hover, :focus-visible` | **orphan modifier — no base rule anywhere in `src/styles`** |
| `claims.css:1113` | `.jar-keep-via .waka-hovercard-card` | the one card's placement rule |
| `claims.css:1797, 1808–1831` | `.waka-note-top`, `.waka-note-foot`, `.waka-note-foot button` (+states) | the note page's own chrome; `NoteTools` renders `waka-dock-*` and `#waka-note-tools` is an id now |
| `claims.css:1847–1866` | `.waka-over-back` (+states) | the overlay chevron |
| `claims.css:2708` | `.jar-char-bubble-open` | — |
| `claims.css:5283, 5511` (and the measured table at 5459, "the way to the settings page") | `.waka-account-go` | the link to `/profile` |
| `home.css:4861–4909` | `.jar-note-tools`, `.jar-inspiration-composer .jar-note-tool` (+2) | the notepad's bottom-left tool pill |
| `home.css:5028` | `:not(.jar-note-tools)` inside a live rule | a no-op `:not()` |
| `chrome.css:1409–1443` | `.jar-note-back`, `.jar-inspiration-composer .jar-note-back` (+hover pair) | the chevron the founder removed |
| `chrome.css:303, 369–418, 462, 748`; `global.css:609–644`; `system.css:326, 376, 492–501, 515` | `.field-hint`, `.btn-destructive`, `.form-success`, `.profile-eyebrow`, `.profile-tab`, `.profile-tabs button`, `.profile-row-tag`, `.profile-memory-badge`, `.profile-memory-action` | `Profile.tsx`'s vocabulary |
| `chat.css:614` | `.chat-muted` | the two `<p>`s this session removed from `ConversationPanel` |

**Three of these are worse than dead:**

- **`.jar-keep-via:hover` with no base rule** (`claims.css:1056`) is the exact
  bug the `.jar-char-bubble--aside` fix was for, one file over: a scripted edit
  took the base block and left the state. I checked every pseudo-class selector
  in all seven stylesheets against the set of base rules across all of them —
  this is the only true orphan left (`.waka-rail-go:disabled`,
  `.jar-reach:focus` and `.jar-mouth-rest--said` all have live bases or are
  `:not()` arguments; `.waka-settings-erase` is S1 below).
- **`claims.css:1093–1112` is a comment that asserts a call site that was
  deleted in the same session**: "`HoverCard` has exactly one call site in the
  tree now (`Profile.tsx`, the MCP line under the agent keys), and it wears
  `.jar-keep-via`. Deleting the rule with the selector would have been the easy
  half of a dead-CSS sweep and the wrong half." It reads as though somebody
  checked. Both the host and the component are gone.
- **`chrome.css:1379–1443` is the surviving half of a one-class-one-thing
  merge.** `home.css:4819` records the merge ("THE BLOCK THAT STOOD HERE MOVED TO
  `chrome.css`… Two blocks laying out one class is what
  `one-class-one-thing.test.ts` fails the build over"), and the block that won
  the merge carries 35 lines arguing about specificity `(0,1,1)` vs `(0,1,0)`
  for a control that no longer renders. The tombstone and the dead code now
  point at each other.

**Why it matters.** This codebase's standard, in `type-scale.test.ts`'s own
words, is that dead rules are what actually move the ratchets — and that a
ceiling which "had no way to notice" them is the defect. 130 rules went out this
session; these are the ones that should have gone with them. `.profile-*` in
`system.css` is the clearest case: that stylesheet is the register nothing else
reads, and six of its nine `.profile-` lines are now register for nothing.

**Smallest fix.** Delete the rules. Where a dead class is one part of a grouped
selector (`system.css:326, 376, 515`; `chrome.css:303`; `global.css:615`), drop
the selector part and keep the rule — the same shape as the "142 dead selector
parts across 127 rules" pass on 2026-10-10. Then lower `COLOUR_CEILING` and
`SPACE_CEILING` by whatever the deletion drains, which is what those ratchets
exist for.

## H5. `onPast` is a documented prop for a control that was removed

**Where.** `packages/web/src/components/InspirationComposer.tsx:217–218`:

```ts
  /** The chevron: the archive this note is about to join. */
  onPast: () => void;
```

`props.onPast` appears nowhere in the component (0 occurrences). `Home.tsx:15996`
still passes a live handler — `() => { void recording.stop(); setMouthNote(''); openOverHome('saves'); }`
— and `inspiration-composer.test.tsx:19` and `one-note.test.tsx:93` both stub it.

**Why it matters.** The founder's ruling that removed the chevron is the
load-bearing argument for the newest entry in `way-out.test.ts`
("I still don't get why you have this carrot button… So don't do that"). The
prop is the control's last trace, it is documented as the control, and it is
wired end to end — so the next person to open this file has a handler, a doc
comment and a test fixture all agreeing that a chevron exists.

**And the gate that argued the removal now contradicts itself.**
`way-out.test.ts:78–87`, the note on `WAY_OUT_CLASSES`, says in the present
tense:

> `-back` JOINED THE LIST 2026-10-11, with the notepad. That page's visible exit
> is a chevron in its top-left corner … and it is wired to `onPast` rather than
> to `onClose`

while `LEFT_BY_THE_DOCK`'s entry 90 lines above records that the chevron was
given up. Both notes are from this session and the later one is right.

**Smallest fix.** Delete the prop, the handler at `Home.tsx:15996` and the two
fixtures; rewrite the `-back` note as a tombstone (see M2, which is the same
line of code).

## H6. Two G6 mock declarations delegate their argument to a deleted file

**Where.** `packages/web/test/page-exit.test.tsx:39` ("Same reasoning, and the
same shape, as `Profile.test.ts` one directory over") and `:47` ("it is argued at
length at the top of `Profile.test.ts`"); `packages/web/test/public-page.test.tsx:37`
("That is the condition argued at length at the top of `Profile.test.ts`").
`packages/web/test/Profile.test.ts` was deleted in this session (581 lines).

**Why it matters.** G6 exists so that every suite states what it replaces and
why that replacement is safe. In both of these the central claim — that mocking
`lib/api` is safe *here* because a wrong mock produces an empty page and a red
test — is not stated, it is cited. The argument now lives nowhere, so the
declaration is a pointer into a void, and `page-exit.test.tsx` was itself edited
in this session.

**Smallest fix.** Inline the paragraph (it is four sentences) into whichever of
the two suites is more canonical and have the other cite that one.

## H7. One commit message in this branch's history still names the reference library

**Where.** Commit `7de6a3b7` ("The archive and the principles are pages, not
camera positions", 2026-10-08), reachable from `goal/one-material-everywhere`
(the current branch) and `goal/three-tab-ia`. Verified by extracting the
patterns from the gate's own `NAMES` array and matching `git log --all
--format=%B` against them; one hit, in that commit's body. Nothing in the
working tree matches, and nothing in the 17 reviewed commit messages does.

**Why it matters.** `unnamed-reference.test.ts` is this session's own gate for a
founder instruction stated as a MUST DO with no expiry, and its header claims the
scrub covered "the two local commit messages that carried it". It covered one of
three. The gate cannot see the third: `SKIP` contains `.git`, so commit messages
are structurally outside its reach, and that limit is not written down in a file
whose own doctrine is that an unstated limit is how a check stops checking. The
history is local, so this is still cheap to fix; after a push it is not.

**Smallest fix.** Rewrite that one message (it is unpushed), and add one
paragraph to the gate's header saying that commit messages are outside its reach
and must be checked by hand before a push — the same shape as
`verb-pairs.test.ts`'s written-down blind spot about `logout`.

## H8. `PublicProfile` records an open question whose fix lives in a deleted file

**Where.** `packages/web/src/pages/PublicProfile.tsx:65–72`:

> WHAT IS STILL NOT ANSWERED … the OWNER reaching their own public page from the
> settings page. `Profile` renders the URL as a plain in-app link, so pressing it
> unmounts the settings page … the fix belongs on the link rather than here; see
> the note at that link in `Profile.tsx`.

**Why it matters.** This is a recorded Law 2 violation with an owner and a
location, and both are gone: `SettingsPanel`'s public group (lines 228–253)
renders a handle field and two checkboxes and **no link to the public page at
all**. So either the Law 2 problem was solved by deletion — in which case the
note should say so — or the product lost the owner's route to their own page and
the note is now the only record of a feature nobody will find. A reader cannot
tell which, and the file they are sent to does not exist.

**Smallest fix.** One sentence: whether the link came back in the panel or not,
say which, and drop the `Profile.tsx` pointer.

---

# CONFIRMED — MEDIUM

**M1. `canKeep` has no caller, and its body is re-written inline.**
`lib/keep-ready.ts:86` exports `canKeep`; the only import of that module anywhere
is `Home.tsx:132`, which imports `whyNotKept` alone, and then writes
`const composerCanKeep = composerHasWords && whyNotKeeping === null;`
(`Home.tsx:11575`) — which is `canKeep`'s body verbatim. The two `canKeep`
identifiers in `SavesOverlay.tsx:817` and `NoteTools.tsx:57` are a prop name, not
this function. `keep-ready.test.ts` is what keeps it alive, and
`orphans.test.ts`'s header is explicit that "a name used ONLY by a test still
counts as unused". It cannot catch this one: its sweep covers `lib/api`, `space`
and `space-kinds`, not `lib/`. The file's own header — "THE CONDITION USED TO BE
WRITTEN TWICE … One function instead" — is the argument against what the call
site does. *Fix:* `const composerCanKeep = canKeep(keepState)` with the state
object hoisted, or delete `canKeep` and its case. `KEEP_FILE_LIMIT` is in the
same position (declaration plus test only) but is read by `whyNotKept` inside the
module, so it is a named constant rather than a dead export.

**M2. Three of five `WAY_OUT_CLASSES` branches match nothing.**
`way-out.test.ts:87`. Across all of `src`, `-close` matches once
(`jar-prov-room-close`), `-out` matches once, and `-back`, `waka-over-close` and
`jar-x` match zero times. `-back` was *added this session* for a control deleted
in the same session; the other two are older rot. Worse, the one `-out` match is
`SettingsPanel.tsx:256`'s `waka-account-out` — a **sign-out** button, not a way
out of the surface — so for that one file the class half of the gate passes on a
control that leaves the account rather than the panel. The structural check
(`closedByAVisibleButton`) is the one the file tells you to trust and is
unaffected. *Fix:* delete the three dead branches; if the sign-out match is load-
bearing for `SettingsPanel`, say so in `NO_VISIBLE_WAY_OUT` where it can be
argued with.

**M3. The new `data-way-out` exemption is applied everywhere and validated in one
file.** `way-out.test.ts:386` exempts any surface in any file whose span
matches `SURFACE_LEFT_BY_DOCK`, but the two validation loops that check those claims (`:437` and `:505`) read only
`src/pages/Home.tsx`. Today that is sound — the attribute appears exactly once,
at `Home.tsx:17818` — but the asymmetry means a surface in any other file can
claim the dock as its exit and have the claim checked by nothing, which is
precisely the "completeness check quietly stops checking" failure the mechanism's
own doc comment is written against. *Fix:* collect claims from all `files`, not
from `Home.tsx` alone; it is a two-line change to the same loop.

**M4. `main.tsx` justifies keeping `chrome.css` with a route that is gone.**
`main.tsx:52`: "chrome.css stays: it dresses `/login` and `/profile`, which are
not flat screens in the sense that was retired." Thirteen lines below,
`main.tsx:182` says `/profile` is gone. The two notes are in one file, in one
viewport on a wide screen. This matters more than a usual stale line, because
`chrome.css` is where nine of H4's dead `.profile-*`/`.field-hint`/`.btn-destructive`
rules live — the comment is the reason nobody looked. *Fix:* "it dresses
`/login`", and then look at what else in that file was only for the other route.

**M5. `chat.css` states "STILL NO BUBBLE, NO BORDER, NO FILL, NO COLOUR" thirty
lines above the bubble.** `chat.css:394`, closing the long contrast argument,
immediately before `.chat-message[data-role="user"]` and then the "FILLED FOR YOU,
GHOST FOR WAKA" section that gives your turns `background: color-mix(…)` and an
18px radius (`:421–438`). The contrast reasoning above it is still correct and
worth keeping; only its final sentence is now false. *Fix:* one line — mark the
sentence superseded and point at the section below, which is what the file does
elsewhere ("THE REVERSAL, STATED PLAINLY", `:236`).

**M6. `type-scale.test.ts` still exempts a stylesheet deleted seven weeks ago.**
`type-scale.test.ts:38–46` exempts `surface.css` "slated for deletion by
`one-product-one-system.md` Phase 6", and says "when the file is deleted this
line is what tells the next person the exemption can go too". The file was deleted
on 2026-08-26. `one-class-one-thing.test.ts:85` records that the *same note,
copied from this file*, was itself a defect and removed its copy: "That file was
deleted on 2026-08-26 — the exemption described a file that is not there, in a
list it was not in." The original survived the fix. Pre-existing, but this session
edited this file twice and the note is eight lines above the ratchet it changed.
*Fix:* delete the paragraph and the name from `GOVERNED`'s note.

**M7. `dead-css.ts` still tries to open a settings entry that no longer exists.**
`tools/e2e/dead-css.ts:600` — `["your settings", ".jar-account"]` in the
world-opens-these loop. `.jar-account` is in the unreachable list its own run
prints, so this step can only ever print `your settings NOT WALKED — it did not
open`, which it does. The same run's rewritten walk already covers the real
panel under the name `settings`, so the stale step also duplicates a surface
name. *Fix:* delete the entry. While there: `the timeline` fails too, but
`.jar-when` **is** live (`Home.tsx:16654`), so that one is a real walk defect
rather than a leftover and wants its own look.

**M8. Three walk targets and one surface are now unreachable in the dead-CSS
run, so ~94 selectors are reported unreachable with no way to tell leftovers from
unentered states.** `the walls list`, `make another place`, `making a room` and
`a room, just made` all time out, and `.jar-here-more` / `.jar-here-row--make` —
the controls they click — are themselves in the unreachable list. That is
self-consistent (the walls dropdown has no renderer), but it means the walk's
most valuable property, the one its own header argues for ("an unentered state
and a dead rule look identical from here, so the answer is to enter more states
rather than to trust the number"), is degraded for a quarter of `home.css`.
*Fix:* decide whether the walls list still exists; if it does not, delete the
three steps and the `.jar-here*` family together, which is a larger and separate
piece of work than H4.

---

# CONFIRMED — LOW

- **`one-class-one-thing.test.ts:128` says the hand-count "still reports
  ELEVEN".** It is nine now: this session drained two (`.chat-message` grouping
  and one `claims.css` pair). The number is cited as the argument for not
  widening the gate, so it is worth keeping true. Measured with the same
  definition the comment uses (same file, same selector, same property, same
  value).
- **`capitalized.test.ts:174–181`'s tripwire is 540 against 595 actual.** Honest and
  self-documented ("a TRIPWIRE for a broken parse, not a ratchet… set below the
  real figure rather than at it"), and the old 600 sat 94 below its own figure,
  so the ratio did not change. Noted only because 55 of slack is now the largest
  unexplained gap in the file.
- **`worldCardClose` is a `WAY_OUT_WORDS` entry with no surface.**
  `way-out.test.ts:64`; the key is in both catalogues and is rendered by nothing
  (pre-existing — it was already orphaned at `ffee792a~1`). `worldReflectionDone`
  was retired from this same list on 2026-10-10 with a note explaining exactly
  why a way-out word kept alive by nothing is a leftover. This is the next one.
- **`tagline` is a catalogue string nothing renders.** Used only as a probe in
  `i18n.test.ts:117–120` (it needs any key whose two locales differ). Harmless;
  a comment in the catalogue or a rename to something obviously fixture-shaped
  would stop the next reader hunting for its screen.
- **`seam-gate.test.ts:56` and `:243` illustrate a past hole with
  `exclude: ["test/when.test.ts"]`.** That suite was deleted this session, so
  the example now names a file that does not exist. The sentence is about a
  historical event and reads fine, which is the only reason this is LOW.
- **`chat.css:163`'s `textarea:focus-visible` outline never applies.**
  `chat.css:885` sets `outline: none` on the same selector and wins; the frame
  answers focus with a border-colour change (`:804`), which is the intended
  pattern and is argued at `:787`. The earlier rule's `textarea` arm is dead and
  nothing says the frame took over. One comment, or drop the arm.
- **`docs/archive/**` is tracked while matching an ignore pattern** (`git
  ls-files -i -c` lists 10 files). Pre-existing and deliberate-looking. The
  session's `.gitignore` addition (`scratch/`, `packages/*/scratch/`) is correct
  and the 27 screenshots are gone; no other junk is tracked — the only large
  tracked binaries are `docs/craft/evidence/**` captures, which are evidence.

---

# SUSPECTED

**S1. `.waka-settings-erase` may render unstyled in the danger zone.**
`claims.css:5195` declares only `:hover, :focus-visible` for it; there is no base
rule. Its layout comes from `.waka-settings-rows button` (`claims.css:5168`), a
descendant selector. The agent-row instance (`SettingsPanel.tsx:203`) sits inside
that list and is dressed. The account-deletion instance (`SettingsPanel.tsx:266`)
is a direct child of the `danger` group's body, so by reading it gets no height,
no padding, no radius and no font — a default browser button with a hover colour.
Severity depends entirely on what it looks like, which is why this is SUSPECTED;
I did not sign in. *Check:* open the gear → the last group, or add
`.waka-settings-erase` to the measured table in `claims.css:5459`. *Fix if
real:* give the class its own base block.

**S2. The five-attachment cap is client-only.** `KEEP_FILE_LIMIT = 5`
(`lib/keep-ready.ts:58`) has no counterpart in `packages/api` — no media-count
bound in the inspirations route. Not a cleanliness finding and possibly
deliberate, but it is the one rule in the new module that the server does not
also hold, and `keep-ready.ts`'s header says explicitly that it "is not a
validator".

---

# The gates' own integrity

Each gate this session touched, and whether it was taught or loosened. **All six
were taught.** The two lowered ratchets are real to the literal:

| Gate | Change | Verdict |
| --- | --- | --- |
| `type-scale.test.ts` | `COLOUR_CEILING` 84 → 79 | **Honest.** Actual count at HEAD: **76**. The companion case ("has a ceiling that is still worth having") caps slack at 3 and this sits exactly at 3 — tight, and it will fail the moment H4's rules go out, which is the behaviour wanted. |
| `type-scale.test.ts` | `SPACE_CEILING` 29 → 19 | **Honest.** Actual count: **19**. Zero slack. (`CEILING` for font sizes is 2 against 2.) |
| `capitalized.test.ts` | 600 → 540 tripwire; seven `EXEMPT` entries deleted; `SPEAKS_A_CLAUSE_ALONE` entry removed; Korean lower-case list asserted empty rather than deleted | **Taught.** The exemptions went because their host went, and the replacement is a tombstone saying so. Asserting `[]` rather than deleting the Korean case is the stricter choice. The `ReadingPanel` entry was correctly *restored* by `d722fd6f` when the panel came back, exactly as the tombstone promised. |
| `verb-pairs.test.ts` | `restoreSignal`, `endConnection`, `createKeeperKey`/`revokeKeeperKey`, `createAgentGrant`/`revokeAgentGrant`, `resolveSignalDuplicate` removed; `login` converted to a `RULED:` | **Taught, and the `login` ruling is the best piece of writing in the diff** — it records a discovery blind spot (`logout` reaches the network through `apiFetch`, not through the `postJson` helpers the file scans) instead of working around it. The register went red in the dirty window when the clients came back, which is the gate working. |
| `way-out.test.ts` | notepad added to `LEFT_BY_THE_DOCK`; per-surface `data-way-out`; two new assertions (`view?.compose` and the dock-row cross-check) | **Taught** — the two new assertions are real mechanism, not exemption. But see M2 (three dead branches), M3 (exemption wider than its validation) and H5 (the file now contradicts itself about the chevron). |
| `tools/e2e/dead-css.ts` | `/profile` tab walk replaced with the corner panel walk, its three disclosure groups and the "i" card; handle lookup moved | **Taught**, and it carries the reasoning forward ("THE SHAPE OF THE PROBLEM SURVIVES THE PAGE, which is why this is a rewrite rather than a deletion"). See M7 for the one step left behind. |
| `fresh-migrate.db.test.ts` | new structural case: folder ↔ journal in both directions, no `idx` gaps, `when` strictly rising, plus the two columns the omission cost | **Taught, and the best gate work in the session.** It catches the real defect (`0069` never in the journal, silent for three days), it is structural rather than pinned to the two known columns, and the commit says it was proved by removing the entry again and watching it name the file. `0070`'s SQL is idempotent as claimed (`ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`), and its `ON DELETE SET NULL("initial_inspiration_id")` column-list form is correct for the composite FK. |
| `unnamed-reference.test.ts` | new | **Real gate**, with a tripwire under it and a documented refusal to watch the over-broad word. One unstated blind spot — see H7. |

**Gates that no longer watch anything:** none outright. Two watch less than they
read: `WAY_OUT_CLASSES` (M2) and `one-class-one-thing.test.ts` over `chat.css`,
whose vocabulary is keyed on `[data-role]`/`[data-run]` and is therefore outside
`BARE_CLASS` entirely — the file admits this ("Zero new collisions. That is not
the two sheets being clean — it is this gate being unable to see the shape they
actually had"), which is why it is not a finding.

**Duplication, measured rather than asserted.** Same-file same-selector
duplicate blocks went from 37 disagreeing / 11 identical at `ffee792a~1` to 35 /
9 at HEAD: **the session net-reduced duplication.** Five new pairs appear and
all five are legitimate or artefacts — `.waka-settings-keep` (group rule plus the
documented one-filled-control override), `.jar-tile-retry` (shared block plus a
one-line mirrored position, with the merge argued in place at `chrome.css:1536`),
and two `chat.css` pairs that are different `[data-role]` values my parser
collapsed. No two components were found sharing one job; `LoadingHome` was
correctly rewritten to render the one `Companion` instead of its own six-div
likeness, and `REST_BLEED` is derived from the anatomy constants rather than
copied.

**Catalogue integrity.** 714 → 610 keys. `en-US.json` and `ko-KR.json` are at
exact key parity (610 each), no key is defined twice in either file, no key is
missing from one side, and **no key is unreferenced by the product** — the only
two reached solely from tests are the pre-existing `tagline` and
`worldCardClose` above. The three headings `HowItWorksPanel`'s header says went
out of both catalogues really did, and its recovery note (`git show 5df201f6^`,
with every path and key listed) checks out file by file — that comment is the
model for how a deletion should be recorded.

---

# What I could not check, and why

- **Anything that needs a signed-in browser.** The dev server on :3010 answers,
  but I did not authenticate, so S1 (the unstyled erase button), the real look of
  the new settings panel and the "i" card, and whether the four NOT WALKED
  surfaces in the dead-CSS run are broken or merely absent are all unverified by
  eye. `e2e:dead-css` ran; `e2e:journeys`, `e2e:usability`, `e2e:phone` and
  `e2e:measure` did not — which matters for H1, because the exact failure mode
  of the 14 `/profile` steps (loud timeout vs vacuous pass) depends on each
  assertion and I read them rather than ran them.
- **The `packages/api` suite and the database gates.** Reviewed by reading only;
  `correctness-2026-10-11.md` covers the run.
- **`@media`/`@layer`-nested CSS reachability is answered by class name, not by
  rule.** My sweep resolves class *tokens* against the source, so a class that is
  rendered somewhere but whose `@media` block is for a breakpoint nothing reaches
  still reads as live. That gap is exactly what `e2e:dead-css` exists for, and
  with four surfaces NOT WALKED it is not currently closed either.
- **Computed class names.** 25 `className={\`…\`}` templates exist; I checked
  each dead-class candidate against them by prefix and none is constructed
  dynamically, but a class assembled from a variable fragment two calls away
  would still read as dead to both my sweep and the gates.
- **Which of the 15 `.profile-*` selectors in `journeys.ts` are load-bearing.** I
  counted them; deciding which journeys lose coverage when they go needs the
  walk to be rewritten, not reviewed.
- **The MCP server and native app.** `keeper-keys`, `agent-grants` and
  `consultations` routes still stand with no web client. The repo's documented
  stance is that the server keeps the route, and the MCP door may well call
  them, but I did not trace those consumers — so "the client wrapper is dead" is
  established and "the route is dead" is not claimed.
- **HEAD moved under me.** The range reviewed ends at `5eee072f`; `d722fd6f`
  landed during the review and every finding was re-verified against it. A
  commit after that one may have fixed some of this; the dirty-window
  `verb-pairs` failure in the table above is the shape of noise to expect.
