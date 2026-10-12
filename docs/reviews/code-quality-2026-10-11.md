# Code-quality and maintainability review — `dev..HEAD`

145 commits over four days. The question asked here is not "does it work" and not
"what is dead" — those are `correctness-2026-10-11.md` and
`cleanliness-2026-10-11.md`. The question is **what will the next person get
wrong, and what in this tree will mislead them into getting it wrong.**

## Basis, and the drift

Measured against the checkout at `HEAD = ea1727db`, with
`packages/web/src/pages/Home.tsx` at **18,145 lines**, md5
`d00d92b25bc290e9198071bae03bf005`, and `home.css` at 5,317 lines. Two agents
were editing while this was written — one owns `Home.tsx`, `keep-ready.ts`,
`use-dictation.ts`, `InspirationComposer.tsx`, `NotePage.tsx`; the other owns
`claims.css`, `chrome.css`, `home.css`, `global.css` and `system.css`. **Every
line number below was re-verified against that md5 and those files at the end of
the review**, but all ten of the files I care most about are in that set, so
expect ±150 lines of drift in `Home.tsx` and ±60 in the stylesheets. Where a
finding has a stable anchor — a selector, a function name, a quoted sentence — I
have given it alongside the line, and the anchor is the thing to search for.

`npx tsc --noEmit` in `packages/web` exits **0**. `test/one-box-two-faces.test.ts`
passes (3/3) — which is finding 2.

What I did not re-report, because the four sibling reviews have it: dead code and
unused exports; the three speech races and the save rule's first three copies;
the `/profile` and `/review/*` leftovers; the dock overflowing a 320px phone; the
`type-scale` and `capitalized` ratchets, which are honest. Where I touch
something they found, I say so and say what is new.

---

## Verdict

**A team could pick this up, and the thing that would let them is also the thing
that will hurt them.** The commenting discipline here is the best I have seen in
a codebase this size: a rule is stated, the rejected alternative is named, the
founder's words are quoted, and the measurement is recorded. That is why a team
could start on Monday. But the comments are now load-bearing infrastructure — in
`Home.tsx` there are 7,604 comment lines against 9,833 of code — and four days of
churn has left some of them asserting the opposite of what the code does, in the
two places where being wrong costs the most: **which CSS layer a sheet is in, and
where the one copy of a rule lives.** Three comments across two stylesheets teach
the wrong mechanism for a bug the founder reported twice; the module written to
end the triplication of the save rule now has a fourth implementation sitting
under its own function's name; the module that holds the product's date words is
bypassed by nine components, two of which print the same fact differently in both
languages. None of that is a bug today. All of it is a trap that fires the first
time somebody trusts the file they are reading. Four of the mechanical gates are
in the same state: not broken, but blind to the sheet or the file where the thing
they guard actually resolves — and one of them is already green while the exact
regression it was written for is live. Fix the ten items below, in order, and
this is a codebase with an unusually high floor. Leave them and the comments stop
being an asset, which costs more than having had none.

---

# 1. The layer assignment is wrong in the one place it exists to be decided — and two comments teach the wrong lesson from the founder's own bug

**Severity: highest. This is the finding I would act on first.** It is cheap to
fix, it is the mechanism behind a bug the founder reported twice, and it is
currently being taught wrongly to the next reader in two files.

### 1a. `claims.css` — 5,494 lines, the second-most-churned file in the range — is entirely unlayered, and `layers.css` does not know it exists

`layers.css` exists for exactly one purpose, stated in its own first paragraph:

> "`@layer` makes the order explicit and total. … That is a statement of intent,
> **in one place**, rather than a fact you have to reconstruct from four import
> lines and a bundler's behaviour."

Its register of what is assigned (`layers.css:31-36`) reads:

```
 * WHAT IS ASSIGNED, as of 85f3274:
 *
 *   product   global.css:2, system.css:2, home.css:5
 *   chrome    chrome.css:2
 *   base      nothing yet — …
```

Measured, by brace-matching the comment-stripped sheets:

| sheet | lines | layer |
| --- | --- | --- |
| `global.css` | 1,182 | `product` (10–1182) |
| `system.css` | 525 | `product` (2–422), `register` (424–525) |
| `home.css` | 5,317 | `product` (10–4423), `chrome` (4580–5153), **and 164 lines unlayered** |
| `chrome.css` | 1,776 | `chrome` (2–1775) |
| `chat.css` | 1,059 | `chrome` (1–1059) |
| **`claims.css`** | **5,494** | **none — `grep -c '@layer' claims.css` is `0`** |

So the table is stale by two sheets, and the one it omits is the biggest. By
`layers.css`'s own rule — stated three times in that file, e.g. `layers.css:50`,
"unlayered rules beat all layers" — **every rule in `claims.css` out-ranks every
rule in `global.css`, `system.css`, `home.css`, `chrome.css` and `chat.css`,
regardless of specificity and regardless of what any bundler does.**

`layers.css:38-47` records what a stale version of this very table cost last
time:

> "This block used to say, in capitals, that nothing was assigned yet. It had
> been false since that commit, and **it was not a harmless stale comment**: the
> rule it stated — unlayered beats ALL layers — is true, so anyone reasoning from
> it got every duplicate definition BACKWARDS. … A token audit had to re-derive
> all of that against the tree because this file asserted otherwise."

It is in that state again, for a different pair of sheets.

**The live collision surface, measured.** 11 class families are declared both in
unlayered `claims.css` and in a layered sheet, so `claims.css` wins each one
unconditionally: `jar-panel-foot` (6 in claims, 3 in home, 1 in chrome),
`jar-panel-head` (1 / 1 / 5), `jar-here` (3 / 4 / 1), `jar-mouth-slot` (2 / 2),
`jar-note-top` (1 / 4), `jar-panel-text` (2 / 1), `jar-panel-save` (1 / 2),
`waka-over-head` (1 / 1), `jar-here-split` (4 / 3), `waka-companion` (1 chrome),
`waka-public` (1 / 3). And `claims.css` holds **36 selectors whose subject is a
bare element** — `.waka-settings-rows input`, `.waka-account button`,
`.jar-char-claim-answers button`, `.waka-drawer-items li`, `.jar-char-bubble-body p`
and 31 more — which is precisely the `.jar-inspiration-composer button` shape that
cost this session five silent overrides.

**No gate asks.** `type-scale.test.ts`'s `GOVERNED` (`:79`) already names
`claims.css` and `chat.css`, so both sheets are read for type and spacing — and
nothing anywhere asserts that a sheet is inside a layer at all. The diagnosis is
even written down, in `phone-breakpoints.test.ts:75-77`, about these exact two
files:

> "The two sheets this pass covers, and the reason they are a pair: they were
> written after the gates were, so they **inherited every house rule in spirit
> and none in fact**."

`chat.css` did get its `@layer chrome` wrapper. `claims.css` did not, and nobody
noticed because nothing can.

**Fix.** Two lines of work and one gate. Wrap `claims.css` in `@layer chrome`
*together with* whatever else needs to move at that precedence level — `layers.css:48-57`
is emphatic that this cannot be done one file at a time ("Wrapping chrome.css
alone was tried and instantly undid every override it exists to make") — then
update the assignment table, then add to `type-scale.test.ts` a case asserting
that every sheet in `GOVERNED` has all of its rules inside a layer. The gate is
the half that matters; the assignment will drift again otherwise.

### 1b. Three comments in two files disagree about whether `chrome.css` is layered. Two of them are wrong

`chrome.css:1` and `:2` are:

```css
/* assigned to the `chrome` layer — see styles/layers.css for the order */
@layer chrome {
```

The block closes at line 1775 of 1776. Brace depth at line 1490, comment-stripped:
**1**. The whole file is in the layer. Yet:

- **`chrome.css:1490`** — "`.jar-inspiration-composer button` **is unlayered** at
  (0,1,1) and sets a 44px floor, a 12px padding, a 1px border and a 12px radius on
  EVERY button inside the notepad."
- **`claims.css:457-458`** — "`.jar-inspiration-composer button` in `chrome.css`
  **is unlayered** at (0,1,1) and puts a `1px solid var(--w-edge)` and a 12px
  radius on every button inside the notepad — **it has silently overruled four
  component rules this week, and it is the first thing to look at whenever a pale
  edge appears on a note page.**"
- **`claims.css:497`** — "The opacity is stated here rather than inherited from
  `chrome.css` **because this file is unlayered and that one is not**."

The third is right. The first two are wrong, and they are the two that a person
chasing the pale edge will read, because `claims.css:458` tells them to.

**Why this is the costliest stale comment in the tree.** The real mechanism of
that bug is **specificity inside one layer**: `.jar-inspiration-composer button`
is (0,1,1) and `.jar-note-back` / `.jar-tile-x` are (0,1,0), and both sheets put
their rules in `chrome`. The recorded lesson is the other one. A reader who
believes `chrome.css` is unlayered draws two false conclusions, both of which
this codebase has already paid for once:

1. *"To beat it, move my rule into a layer"* — which does nothing, because the
   winner is in the latest layer already. `home.css:5035-5040` records somebody
   making the symmetrical mistake in the other direction and losing an afternoon:
   "The first attempt put this in `@layer product` and nothing happened."
2. *"To beat it, I must out-specify it"* — which is **unnecessary** from
   `claims.css`, the file where most new component rules are now written, because
   that file is unlayered and already wins at any specificity. So the escape
   hatch `chrome.css:1498` describes ("every control that has wanted to look like
   anything else has had to out-specify it … This is the third such escape in one
   file") is advice for a constraint that does not apply where the reader is
   standing.

**Fix.** One sentence in each of the two wrong comments: say "in `@layer chrome`,
at (0,1,1), and it wins by specificity inside that layer", and in `claims.css:458`
add the one fact that matters there — "this file is unlayered, so a rule written
here needs no specificity at all to beat it."

### 1c. 22 rules have fallen out of `home.css`'s layer blocks, with no comment anywhere saying so

`home.css`'s `@layer product` closes at **4423** and `@layer chrome` opens at
**4580**. Everything between, and everything after 5153, is unlayered and
therefore beats both:

```
4424..4579   .jar-where-on  .jar-where-off  .jar-when  .jar-when-place
             .jar-when-story  .jar-when-story button  .jar-when:focus-visible
             .jar-when--away  .jar-here-split  .jar-here-split .jar-here
             .jar-here-more  .jar-here-row  .jar-here-row:focus-visible
             .jar-here-row--make
5154..5317   .jar-drift-reading  .jar-drift-new  .jar-drift-left
             .jar-drift-left-label  .jar-drift-note  .waka-over--talk
             .waka-over--talk .waka-over-head  .waka-over--talk .chat-page
```

Most are live (`.jar-when` is rendered 7 times, `.jar-drift-*` and
`.waka-over--talk` once each; only the `.jar-here-*` family is dead, which the
cleanliness review has). Two deserve naming:

- **`home.css:4486` `.jar-when-story button`** — a bare element inside a
  container, unlayered. The same shape as the rule in 1b, now with the stronger
  weapon: nothing in any sheet can override it at any specificity.
- **`home.css:5307` `.waka-over--talk .chat-page`** — unlayered, so it silently
  out-ranks the whole of `chat.css`, which is `@layer chrome` end to end. Today it
  would have won on specificity anyway. The day somebody writes
  `.chat-page` geometry in `chat.css` and it does not take, this is why, and there
  is no comment in either file to find.

The founder's own bug this session was a rule silently overriding five component
rules. These 22 are positioned to do the same, and unlike `claims.css` they are
not a decision anybody made — they are an append past a closing brace.

**Fix.** Move them inside the appropriate block. The gate in 1a catches this too
if it asserts per-rule rather than per-file.

---

# 2. `one-box-two-faces.test.ts` is green while the invariant it states is violated — and the violation is the founder's own reported regression

**Severity: high.** This is the clearest case in the tree of a gate that reads
like proof and is not. I proved it by running the gate's own algorithm over the
rule that actually wins.

**What the gate promises** (`test/one-box-two-faces.test.ts:32-36`):

> "So the rule is stated here mechanically instead: **WHATEVER DECIDES WHERE THE
> FIRST LINE OF INK SITS MUST BE SAID TO BOTH FACES, in every condition where it
> is said to either.** That is the vertical padding, and it is being block-level
> rather than inline — the two things that have actually broken."

And it names the break it exists to stop (`:26-29`):

> "2026-08-25/09-08 — the coarse-pointer pass gave the BUTTON 13px of vertical
> padding to reach the 44px an act needs under a thumb, and gave the field none.
> MEASURED at 393x852 DPR 3: the ink band moved from device rows 114-134 to 75-95
> when pressed."

**What it reads** (`:58`): `const SHEET = resolve(HERE, "../src/styles/home.css");`
— one file. And `declarationsOf` (`:118`) keeps a block only when a selector in
its list is **exactly** `.jar-mouth-rest` or `.jar-mouth-field`.

**What actually wins.** Collected across all sheets with layer rank:

| rule | sheet / layer | sets |
| --- | --- | --- |
| `.jar-mouth-rest` | `home.css:3799`, `@layer product`, `@media (pointer: coarse)` | `padding-top/bottom: var(--sp-14)` = **14px** |
| `.jar-mouth-field` | `home.css:5051`, `@layer chrome`, `@media (pointer: coarse)` | `padding-top/bottom: var(--sp-14)` = **14px** |
| `.jar-mouth-rest:not(.jar-mouth-rest--said), .jar .jar-capture-shortcut` | **`chrome.css:1651`, `@layer chrome`, unconditional** | `min-height: var(--sp-44); box-sizing: border-box; padding: var(--sp-8) var(--sp-12)` = **8px** |
| `.jar-mouth .jar-mouth-rest:not(…)` | `chrome.css:1657`, `@layer chrome` | `display: flex; align-items: center; line-height: 1.6` |

`chrome` is a later layer than `product`, so `chrome.css:1651` beats
`home.css:3799` **regardless of the media query and regardless of specificity**.
The resting face gets 8px of vertical padding inside a 44px flex-centred box; the
field gets 14px and is a block. That is the 2026-09-08 regression, by the same
mechanism, in a sheet the gate does not open.

**Proof.** I ran the gate's `declarationsOf` / `verticalPadding` verbatim
(scratch copy, no source touched) against (a) `home.css` as it stands and (b) the
same file with `chrome.css`'s winning declaration appended inside `@layer chrome`:

```
sheet: src/styles/home.css
  (unconditional):                      rest 0/0                field 0/0                 ok
  @media (prefers-reduced-motion: …):   rest 0/0                field 0/0                 ok
  @media (pointer: coarse):             rest var(--sp-14)/…     field var(--sp-14)/…      ok

sheet: home.css + chrome.css's rule
  (unconditional):                      rest var(--sp-8)/…      field 0/0        <<< MISMATCH
  @media (prefers-reduced-motion: …):   rest var(--sp-8)/…      field 0/0        <<< MISMATCH
  @media (pointer: coarse):             rest var(--sp-8)/…      field var(--sp-14)/…  <<< MISMATCH
```

The gate's own arithmetic reports three mismatches, including 8px against 14px on
a coarse pointer. `npx vitest run test/one-box-two-faces.test.ts` → **3 passed**.
The only reason is the one-file scope.

**And the author knew the mechanism.** `home.css:3794-3798`, nine lines above the
losing rule:

> "**THE FIELD'S HALF IS DECLARED IN `@layer chrome`, NOT HERE.** This block is in
> `product`, and `chrome.css` pads every bare textarea, so the mouth answers that
> from inside `chrome` with a flat `padding: 0`. A coarse-pointer rule written
> here loses to it in silence — measured, by writing it here first and reading
> back a computed `0px`."

The field's half was moved to `chrome`. The rest face's half was left in
`product`, where it loses to `chrome.css:1651` by the identical mechanism the
comment describes. Both halves of the one invariant, and only one of them learned
the lesson written beside it.

**Fix.** Two parts, and the second is the one that keeps paying. (i) Move the
rest face's coarse padding into the same `@layer chrome` block as the field's, or
raise it to `.jar-mouth-rest:not(.jar-mouth-rest--said)` so it meets
`chrome.css:1651` head-on. (ii) Make the gate read every sheet and every selector
whose **subject** is one of the two faces, carrying layer rank across files —
`one-class-one-thing.test.ts` already walks multiple sheets with an at-rule stack,
so the parser exists. A gate pinned to one file, guarding a property three sheets
set, is a gate that will go green again the next time.

**Caveat.** Whether the ink visibly moves needs a browser; jsdom has no layout
and the dev server is serving two agents' in-flight edits. What is proven here is
that the gate's stated invariant is violated and that the gate cannot see it —
which is the whole reason the invariant was made mechanical.

---

# 3. The save rule has a fourth implementation, and it sits under the same name as the function written to end the duplication

**Severity: high.** The correctness review found the rule written three times with
the copies disagreeing, and the cleanliness review found `canKeep` exported with
no importer and its body re-typed inline. This is the other half: **the second of
the two "identical" note pages never asks the rule at all, and the prop it passes
instead is called `canKeep`.**

`lib/keep-ready.ts:9-17` states the file's whole purpose:

> "**THE CONDITION USED TO BE WRITTEN TWICE.** `InspirationComposer` decided
> whether its button was disabled, and `keepIt` in `Home.tsx` re-decided the same
> question on press and returned silently on its first line if it disagreed. Two
> copies of one rule, in two files, neither aware of the other — so a Save could
> look pressable and do nothing… With the button in a third place, a third copy
> was the obvious next step. **One function instead.**"

It exports `whyNotKept(state)` (`:74`) over nine inputs and
`canKeep(state) = state.hasWords && whyNotKept(state) === null` (`:86`).

**The notepad asks it.** `Home.tsx:11675-11689`:

```js
const whyNotKeeping = whyNotKept({ hasWords, ready, saving, uploading,
  recording: recording.phase !== 'idle' || dictation.listening,
  undecidedRecording, invalidFiles, files });
const composerCanKeep = composerHasWords && whyNotKeeping === null;
```

**The saved note does not.** `SavesOverlay.tsx:355`:

```js
/** Whether the open note holds words that are not the stored ones yet. */
const canKeepOpenNote = Boolean(open) && !saving
  && draft.trim().length > 0 && draft.trim() !== open?.preview;
```

Four inputs, none of them from `keep-ready.ts`. It is passed at
`SavesOverlay.tsx:838` as `canKeep={canKeepOpenNote}` into
`NoteTools.tsx:57`'s prop:

```ts
/** Whether the words on the note differ from the ones that are stored. */
canKeep: boolean;
```

and consumed at `NoteTools.tsx:139` as `disabled={!props.canKeep}` on
`.waka-dock-tool--keep` — **the same CSS class, the same slot, the same glyph** as
the notepad's Save.

**Why this bites, in four ways.**

1. **One name, two meanings, in the save path.** `canKeep` in `lib/keep-ready.ts`
   means *"the rule permits this press"*. `canKeep` as a `NoteTools` prop means
   *"the words are dirty"*. The cleanliness review correctly dismissed the
   collision for the dead-export question ("a prop name, not this function"); as
   a **naming** fact it is the worst kind — the same identifier for the
   enablement predicate and for a dirty check, on one control.
2. **`NoteTools` reasons about `canKeep` as though it were the lib's.**
   `NoteTools.tsx:134-137`: "BUSY DOES NOT BLOCK IT… **The caller's own `canKeep`
   already folds in `saving`**, which is the conflict that does exist." True of
   `canKeepOpenNote` by luck. The sentence reads as a statement about the
   contract, and there is no contract.
3. **The divergence is reachable and undeclared.** `NoteTools.tsx:76` renders
   Record on the saved note, so `recording.phase !== 'idle'` is a real state
   there — and `canKeepOpenNote` does not consider it, while `whyNotKept` returns
   `worldComposerFinishRecording` for it first, before anything else, because
   "a recording that is still running is the thing to stop before thinking about
   anything else" (`keep-ready.ts:63-66`). Some of the nine inputs genuinely do
   not apply to a saved note — there is no draft media list, so `KEEP_FILE_LIMIT`
   and `invalidFiles` have no subject — **and nothing anywhere says which, or
   why.** That is the gap: not that the predicates differ, but that the file
   claiming to be "the only statement of what blocks a save" has a second
   statement with no tombstone between them.
4. **It is on the one pair of pages the product insists are one page.**
   `NotePage.tsx:5-12` quotes the founder — "make sure that when I'm entering from
   create new inspiration or my past inspiration, **it's using the exact same
   component**" — and `test/one-note.test.tsx` exists to hold it. The shared
   component shares the chrome; the bar, which is where the acts are, is two
   implementations.

**Fix.** Give `KeepReadiness` the saved note's shape and call the one function
from both bars: `canKeep(keepState)` at each site, with the fields that do not
apply passed as their neutral value **and a one-line note per field saying so**.
That also gives `canKeep` the importer the cleanliness review found it lacking,
and it makes the next divergence a type error rather than a second opinion.

---

# 4. `lib/words.ts` is the product's date vocabulary and nine components bypass it — two of them print the same fact differently, in both languages

**Severity: high for Q2.** This is the largest instance of the exact shape asked
for: a rule stated once, with its reasoning, and re-implemented at the call site.

`lib/words.ts:1-20` states the contract:

> "**THE WORLD'S LANGUAGE** — data turned into the words this world says. One
> reason to exist: every function here takes a fact and returns a phrase, in the
> register the world speaks… The register matters as much as the logic. **This
> world says "four days ago" and "you and your agent", never "4d" or "2
> members".** … **AND THE HUMAN WORDS SPEAK TWO LANGUAGES** (founder, 2026-08-31,
> reversing 2026-08-22). Every function takes the locale LAST… Korean counts use
> the native numerals a person says out loud (두 달, 사흘, 스무 날), which is this
> module's own law — **"counts are prose here, never digits"**."

And `Home.tsx:4356-4360` records the bug that enforced it, plus the lesson:

> "**THE WORDS ARE `words.ts`'S, NOT THIS FILE'S.** It carried a
> `toLocaleDateString("en-US")` and its own year rule, which was correct while the
> product spoke one language and **silently wrong the moment it spoke two** — a
> Korean wall labelling its rows in English. `dialMonth` keeps the rule and knows
> both hands."

**Nine components format a date without it.** `ConversationsOverlay.tsx:76` and
`:168`, `PrinciplesOverlay.tsx:76`, `ReviewEvidence.tsx:31`,
`PrincipleEvidence.tsx:38`, `InspirationSearch.tsx:68`, `PrincipleShare.tsx:107`
and `:108`, `InspirationProcessingNotice.tsx:13`, `AttachmentPreview.tsx:92` —
each with its own `Intl` option bag.

**Two of them disagree with the module, measurably.** Ran against the real
exports, `ms = Date.UTC(2026, 9, 11, 14, 5)`:

| the fact | `lib/words.ts` | the inline copy |
| --- | --- | --- |
| the month something is dated to, `en-US` | `October twenty twenty-six` (`monthTag`, `:56`) | `October 2026` (`PrinciplesOverlay.heldSince`, `:70-76`) |
| the same, `ko-KR` | `이천이십육년 시월` | `2026년 10월` |
| a short date, `en-US` | `Oct 11, 2026` (`dateStamp`, `:142`) | `Oct 11` (`ConversationsOverlay`, `:168`) |
| the same, `ko-KR` | `2026년 10월 11일` | `10월 11일` |
| a bare clock | `7:05 AM` / `오전 7:05` (`timeOf`, `:247`) | identical (`ConversationsOverlay.clock`, `:72-77`) |

`monthTag`'s doc comment is `/** The month a scrub is standing in, spoken — "June
twenty twenty-six", "이천이십육년 유월". Korean says the year first, because Korean
does. */`. `PrinciplesOverlay`'s local `heldSince` answers the same question —
`/** The month a principle started being true, which is as precise as anyone
needs. */` — and prints digits, in both languages, breaking the module's own
stated law in Korean and its year rule in English. A reader moving between the
dial and the principles page sees one fact in two registers.

`timeOf` and `clock` agree **today, by coincidence**: both delegate to `Intl` for
English, and `timeOf` hand-builds a Korean string that happens to match the
platform's. `Intl` output is not under this project's control — it moves with ICU
versions and platforms — so that agreement is not a property anybody is holding.

**No gate can see this.** `i18n.test.ts` asks for catalogue parity;
`copy.test.ts` asks whether every catalogue key is rendered. Neither has a
subject here: these strings never enter the catalogue. The new in-flight
`test/korean-reaches-the-screen.test.tsx` is the right shape — "mount the surface
in Korean, read what it actually says, and fail on a Latin word" — and mounts
`AttachmentPreview`/`AttachmentTranscript`, not these. It would not catch
`2026년 10월` either: the defect is digits, not Latin.

**Fix, in two sizes.** Smallest: `PrinciplesOverlay.heldSince` becomes
`monthTag(when.getTime(), locale)` and `ConversationsOverlay`'s group label
becomes `dateStamp`; delete both local helpers. Durable: one gate that fails on a
`toLocaleDateString` / `toLocaleTimeString` / `Intl.DateTimeFormat` outside
`lib/words.ts`, with a named exemption list — the same shape
`type-scale.test.ts` uses for `text-transform: uppercase`, which is the closest
existing precedent and works.

---

# 5. `reachable.test.ts`'s ratchet is already breached and structurally cannot see it — and what it hides is a second, disagreeing copy of the product's central formula

**Severity: medium-high.** The ratchet is well built and has a slack check, which
is why this matters: it is sitting at zero slack and the number is wrong.

`test/reachable.test.ts:45-49`:

```
 * THE CEILING, AND IT IS A NUMBER TO BE LOWERED.
 *
 * 27 on 2026-10-11, measured right after the two genuinely dead ones went.
 */
const PRIVATE_ENOUGH = 27;
```

with a second assertion (`:111-115`) that the slack must be ≤ 2: "the same shape
the type scale uses: slack is room for the thing the ceiling exists to stop."

**The reachability test is a substring match on raw file text.**
`reachable.test.ts:74-82`:

```js
const word = new RegExp(`\\b${name}\\b`);
for (const [other, body] of everywhere) {
  if (other !== path && word.test(body)) { outside = true; break; }
}
```

`everywhere` holds files as read from disk. So **a comment that names a symbol
counts as a caller, and so does a module path that contains it.** In a codebase
whose house style is to name symbols in backticks in prose — 7,604 comment lines
in `Home.tsx` alone — that is not a corner case.

**Proven.** I ran the gate's own `inwardOnly()` three ways (scratch script, no
source touched):

```
as written (comments and strings count as callers) : 27   (ceiling 27, slack must be <= 2)
comments and // lines blanked                      : 31
comments + module-path strings blanked             : 32
```

Four exports are off the list only because another file mentions their name in
prose: `canvas/sprites.ts: rasterOrbPixel`, `lib/api/http.ts: writeJson`,
`lib/words.ts: agoWords`, `space/inspiration/field.ts: ORB_R_MIN`. **So the
ratchet is at 27/27 with zero slack while the honest count is 31 — already four
over — and the next legitimate export fails the build for a budget four
prose-propped symbols are occupying.**

**The fifth one is the interesting one.** `lib/data.ts: aliveness` appears only
once the import *paths* stop counting: `space/inspiration/field.ts:29` does
`from "../../lib/aliveness"`, and `\baliveness\b` matches inside that string. So
a function is held alive by the filename of a different module.

And what that function is matters for Q2. `lib/aliveness.ts:1-27` is the file
written to end exactly this:

> "These were eight literals inside the render loop: 7, 0.34, 0.18, 0.1, 0.25, 2,
> 0.12, 3. Brightness is the only meaning channel this product has, so those eight
> numbers were a scoring model — an unnamed one, sitting beside a documented one
> it disagreed with. … **What is not acceptable is the previous state: the same
> idea carrying two different numbers, in two places, with nothing connecting
> them.**"

`lib/data.ts:542-549` is the previous state, still standing:

```js
export function aliveness(c: Inspiration, now: number): number {
  const days = Math.max(0, (now - Math.max(c.updatedMs, c.capturedMs)) / 86_400_000);
  const decay = Math.pow(0.5, days / 7);
  const attention = 0.25 * Math.min(c.reflectionCount, 2) * decay;
  const hasWords = c.reflectionCount > 0 ? 0.15 : 0;
  const hasAttachment = c.attachments.length > 0 ? 0.1 : 0;
  …
```

Five literals — `7`, `0.25`, `2`, `0.15`, `0.1` — which are
`FIELD_DECAY_HALF_LIFE_DAYS`, `FIELD_REFLECTION_WEIGHT`,
`FIELD_REFLECTION_SATURATION`, `FIELD_FLOOR_CITED` and `FIELD_FLOOR_IN_GROUP`
re-typed, in the file every page imports, under the product's most load-bearing
name, with a doc comment presenting itself as canonical: *"HOW ALIVE AN
INSPIRATION IS, 0..1 — the only channel the world spends on it."* The live
formula is `space/inspiration/field.ts:72-73`, which imports the constants.
`86_400_000` is written out here too, though `lib/num.ts:17` exports `DAY_MS` and
`field.ts` uses it.

I am not reporting it as dead code — that is the parallel review's call and out of
my scope. I am reporting that **the project's central formula exists twice with
nothing connecting the copies, which is the precise state `lib/aliveness.ts` was
created to end**, and that the gate which should have surfaced it is held shut by
a filename.

**Fix.** `reachable.test.ts` should strip comments and import specifiers before
matching — four lines, and it is the same comment-blanking
`type-scale.test.ts`, `one-class-one-thing.test.ts` and `phone-breakpoints.test.ts`
all already do for exactly this reason, each with a note saying why ("a gate that
reads its own documentation as evidence reports work that was never done",
`phone-breakpoints.test.ts:82-85`). Then re-measure the ceiling against the real
figure. Then decide what `lib/data.ts`'s `aliveness` is: delete it, or make it
`carryOf`'s caller.

---

# 6. Six more vacuous absence assertions, and `one-note.test.tsx`'s comparison now reduces to the tree identity its own header calls insufficient

**Severity: medium.** The regression audit found one of these (`one-note.test.tsx`'s
`corners`). There are seven, across two files, and the pattern is systematic:
`-` the project's "asserted as absence" idiom is only as strong as the class name
surviving a rename, and four names did not.

**The four classes, counted across the tree** (`src`, excluding `src/styles`,
versus `src/styles`):

| class | rendered | in CSS |
| --- | --- | --- |
| `jar-note-save` | 0 | **0** — the string exists nowhere in the repo but these tests |
| `jar-note-back` | 0 | 9 |
| `waka-over-back` | 0 | 4 |
| `jar-note-tools` | 0 | 2 |

**The seven assertions pinned to them:**

- `test/inspiration-composer.test.tsx:55` — `expect(host.querySelectorAll('.jar-note-save')).toHaveLength(0);`
- `test/inspiration-composer.test.tsx:93` — `expect(host.querySelector('.jar-note-back')).toBeNull();`
- `test/inspiration-composer.test.tsx:236` — `expect(count('.jar-note-back'), 'the chevron came back').toBe(0);`
- `test/inspiration-composer.test.tsx:245` — `expect(count('.jar-note-tools'), 'the attach corner came back beside the bar').toBe(0);`
- `test/one-note.test.tsx:144` — `backs: host.querySelectorAll(".jar-note-back").length,`
- `test/one-note.test.tsx:145` — `headerBacks: host.querySelectorAll(".waka-over-back").length,`
- `test/one-note.test.tsx:155` — `corners: host.querySelectorAll(".jar-note-tools").length,` *(the one already reported)*

Each is deliberate and each is documented. `inspiration-composer.test.tsx:88-92`
is explicit about the intent:

> "**ASSERTED AS ABSENCE, because the regression is it coming back.** The visible
> way out is the bar, which `way-out.test.ts` holds to that promise structurally."

But the regression it is guarding — somebody restores a way back onto a note page
— will not arrive wearing `jar-note-back`. The current vocabulary for a control
in that position is `waka-dock-*`, `waka-corner-*`, `waka-over-*`; the chevron's
own class was renamed and then stranded in the same session. `jar-note-save` is
the sharpest case: the test's comment at `:35` explains that the control moved
("WHAT THIS CASE USED TO DO was press `.jar-note-save`… The control is in the dock
now"), and the dock's Save is `.waka-dock-tool--keep` — so the assertion kept "as
absence" names a string that is absent from the whole repository and says nothing
about the control it is about.

**And `one-note.test.tsx`'s headline comparison is now almost empty.**
`shape()` (`:136-157`) returns five fields; three of them —`backs`,
`headerBacks`, `corners` — can only ever be `0`. The test then does
`expect(fresh).toEqual(kept)` plus five spelled-out assertions, three of which
are those constants. What is actually asserted is `whens === 1` and
`whenIndex === 0`: that both pages render one `.jar-note-when` as the first child
of `.jar-note-top`. Both pages call the same `<NotePage>` (`InspirationComposer.tsx:303`,
`SavesOverlay.tsx:911`), so that is structurally guaranteed — and the file's own
header says structure is not the point (`:12-18`):

> "**WHY A TEST AND NOT JUST THE SHARED COMPONENT.** Extracting `NotePage` made
> the two tops identical in the TREE and left four differences on screen… **A
> shared component is not a shared page.**"

Meanwhile the asymmetries that exist today are all in the bar, which `shape()`
does not read: the notepad's slot offers **Speak** where the browser can dictate
(`Home.tsx:17441`, `dictationAvailable() ? … : supportedRecordingType() ? … : null`)
and the saved note's offers **Record** unconditionally (`NoteTools.tsx:76`,
`supportedRecordingType() ? …`) — the regression audit's L2 — and the two bars'
Save buttons are gated by two different predicates (finding 3).

**Fix.** Re-point each absence assertion at a class that exists, or better, at the
structural fact: count elements inside `.jar-note-top` that are focusable and are
not the trailing verb, which catches a way-back under any name. And extend
`shape()` to read the dock slot: `[...slot.querySelectorAll('button')].map(b => b.className)`
compared between the two pages would have caught the mic asymmetry and the Save
divergence on the day each landed.

---

# 7. `Home.tsx`: do not rewrite it. Split one thing, and the seam is already drawn, named and published

**My answer to Q1: it is a liability, the cost is measurable, and the fix is one
move, not a rewrite.** A recommendation to decompose 18,000 lines is worth
nothing; this is the one cut that pays, and I would make it and stop.

### The shape

`HomeExperience` (`Home.tsx:1414`) runs to the end of the file — **16,731 lines
in one React function body.** Measured inside it:

| | |
| --- | --- |
| `useState` / `useRef` | 120 / 125 |
| `useEffect` | 61 |
| `useCallback` | 74, **of which 42 have an empty dependency array** |
| distinct `*Ref` identifiers | 107 |
| `.current` accesses | 720 |
| `x.current = y` assignments **during render** | 34 |
| comment lines / code lines | 7,604 / 9,833 |
| JSX | `return (` at `:16860`, ~1,285 lines |

### The demonstrable cost, and it is the cost the correctness review already paid

There is no module boundary, so there is nowhere to put a value, so **values
travel as mutable refs with no barrier**. That is what 42-of-74 empty dependency
arrays and 34 render-time ref writes mean: closures are built once and read
hand-maintained mutable state. Every defect the correctness review confirmed in
the speech machinery is an instance of that one mechanism, not three unrelated
bugs:

- the away-window sentence (`tell()` reads `toldRef.current` and never consults
  `speechEpoch`, which only `sayTheWeather` captures);
- the setter-level seal dropping failure sentences across ~20 `setCharSay` call
  sites;
- the dictation stop/start splice in `use-dictation.ts`.

Two were "fixed" and a third was found by a reviewer afterwards **because nothing
in the file can tell you how many writers a piece of state has.** `charSay` has
about twenty; `speechEpoch` has one reader. In a module with an export list that
question is answered by reading the export list. Here it is answered by grepping
18,145 lines and hoping. That is the concrete cost, and it has already been
charged three times this session in one subsystem.

### The seam, named

**Move the field simulation out.** One `useEffect`, `Home.tsx:4814-10446` —
**5,632 lines, 31% of the file** — ending in:

```js
}, [pourSig, agents, walls, groupFieldTick]);
```

It is not an arbitrary cut. It is already a module wearing an effect's clothes:

1. **Its interface is already written and published.** `interface SimApi`
   (`Home.tsx:1168`) — 102 members: `navigationState`, `standIn`, `windTo`,
   `select`, `release`, `travel`, `goToWall`, `born`, `identify`, `unborn`,
   `setProvenance`, `audit` and the rest — plus `FieldAudit` beside it. That
   interface exists precisely because the rest of the component is not allowed to
   reach inside.
2. **Nothing reaches inside.** Of 38 `simApiRef` references, **34 are outside the
   effect and 4 are inside** (the assignment, the two teardown clears, one read).
   The boundary is observed today.
3. **Its dependency array is already an honest admission that it cannot be one.**
   The effect captures **70 component-scope bindings — 39 refs and 31 values —
   against a 4-entry dependency array.** The file argues the staleness for exactly
   two of them, at length and well (`:10410-10446`: "`citations` AND `signals` ARE
   DELIBERATELY NOT DEPENDENCIES, and an earlier attempt at this bug added
   them… It also re-pours the field every time either changes"). It is silent
   about the rest. A reviewer cannot distinguish the 2 reasoned exclusions from
   the other ~19.

**What the split costs.** One options object of 70 entries — 39 of which are
already refs and pass as-is — and a signature like
`startField(root, canvas, opts): SimApi`, with the existing `SimApi` as its return
type. The effect becomes four lines. The inputs it reads become **named
parameters**, which is the whole gain: the 31 captured values stop being invisible
staleness and become a declared surface somebody can argue with. It touches no
behaviour and no CSS, and the browser gates in `tools/e2e` plus
`test/home-field.test.tsx`, `pour-signature.test.ts`, `orb-origin.test.ts`,
`carry.test.ts` and `home-light.test.tsx` already cover the thing being moved.

**What I would not do.** Not the speech machinery — it is tangled with `charSay`,
`lit`, the write seal and the wall effect, and pulling it out while three races
are being fixed in it is how a fourth one arrives. Not the JSX — 1,285 lines of
markup in one return is unpleasant to read and costs nothing, because markup has
no hidden writers. Not the 120 `useState`s — a state-machine rewrite of a working
world is the kind of project that is abandoned at 60%.

**And not the rest of the file.** After the simulation leaves, `Home.tsx` is
~12,500 lines, which is still too big and is nobody's emergency. The honest answer
for the remainder is **leave it**, keep writing the comments at the current
standard, and take the next seam only when a second subsystem grows its own
published interface the way `SimApi` did. The size is not the problem; the
absence of named boundaries is, and this is the one place a boundary already
exists and is merely unenforced.

---

# 8. `lib/page-menu.ts` hand-parses the URL beside the parser that exists for it, and restates its own list 35 lines below declaring it

**Severity: medium.** Two instances of Q2's shape in one 238-line file, and the
file's own header documents the bug that the second one causes.

**8a. A second URL reader in `lib/`.** `lib/view-location.ts:53` is
`readViewLocation(pathname, search)`, which validates ids, parses `/w/:id/:label`,
and resolves `open` against a declared `OPEN` array (`:34`). `lib/use-view-navigation.ts:10`
wraps it, and `Home.tsx:1425` holds the result as `viewNavigation.view`.
`lib/page-menu.ts:197-199` parses the same URL again, by hand:

```js
const onAWall = pathname.startsWith("/w/");
const open = new URLSearchParams(search).get("open");
const owner = onAWall ? decodeURIComponent(pathname.split("/")[2] ?? "") || null : null;
```

No id validation, no path-shape check. `readViewLocation` returns `null` for a
`/w/` address it cannot parse — an over-long or malformed wall id — and for those
`usePageMenu` returns a non-null `owner` and labels all four rows
"Your agent's …". It also reads `open` on `/chat/:id` and `/principles/:id`, where
`readViewLocation` returns early with `open: null`. Both callers —
`Home.tsx:11091` and `Days.tsx:83` — have the parsed view available or adjacent.
Two parsers for one address, both in `lib/`, both consumed by the same component.

**8b. `VIEWS` is declared once and re-stated as a literal.** `page-menu.ts:150-166`
declares the rungs:

```js
{ what: "saves", … }, { what: "claims", … }, { what: null, id: "top-of-mind", … },
{ what: "principles", … },
```

and `:233` asks which one is current:

```js
current: open === "saves" || open === "claims" || open === "principles" ? open : "top-of-mind",
```

Thirty-five lines apart, in one file, the same list twice. And the file already
records what happens when the two drift — `:215-228`:

> "**WHICH RUNG IS BEING READ — AND ONLY THE THREE COUNT.** … But `open` has a
> fourth value, `conversations`, which is not a rung at all… Passing it through
> made `Menu` look for a row with that id, find none, and fall back to the first
> one, so the switcher read "Your inspirations" while the screen showed the top of
> mind. **A control whose whole job is to name where you are, naming somewhere
> else.**"

That bug was fixed by adding the three-way literal. A fifth rung added to `VIEWS`
reproduces it exactly: `claims` joined on 2026-10-11 and the literal had to be
hand-edited to match, which is the N+1th call site `keep-ready.ts`'s header warns
about.

**Fix.** `current: VIEWS.some(v => v.what === open) ? open : "top-of-mind"` — one
line, and the list has one home. For 8a, take `view: ViewLocation | null` as a
parameter (both callers hold one) and read `view.wallId` and `view.open`; the
file's own argument for taking the account from the caller rather than reaching
into auth (`:168-171`) applies verbatim.

---

# 9. `lib/dismiss.ts` states a universal rule that three of ten modal sheets obey

**Severity: medium.** Q3 and Q4 together: the comment promises automatic, the
mechanism is opt-in, and the gap is invisible from either end.

`lib/dismiss.ts:1-16`:

> "**EVERY SHEET CLOSES THE SAME TWO WAYS.** … It is what a person expects of
> anything that opens over the thing they were reading: press away, and it goes;
> press Escape, and it goes. The rest of the sheets never learned it… **One hook,
> so a sheet added later gets both without anyone remembering to.**"

The hook has three callers, all in `Home.tsx` (`:13263-13265`): the room settings,
the join sheet, the provenance room. `DialogSurface` supplies Escape to every
surface (`DialogSurface.tsx:243`) and deliberately supplies no press-away, with the
reasoning stated for the five **pages** (`DialogSurface.tsx:112-121`): "NOT
APPLICABLE — PRESS-AWAY. There is nowhere to press away TO… `.waka-page` is opaque
and covers the viewport."

That argument is correct and complete for the pages. It is not made for the
**sheets**, which do float on a scrim. Of the ten modal `DialogSurface` call sites
— `GroupPanel.tsx:86`, `ReadingChanges.tsx:56`, `InspirationComposer.tsx:279`,
`InspirationSearch.tsx:58`, `PrincipleShare.tsx:152`, `SpaceSettings.tsx:166`, and
`Home.tsx:16145` (the memory card), `:16580` (provenance), `:16943` (agent name),
`:18077` (join) — **three have press-away.** `grep -c useDismissAway` is `0` in
every component file. So a sheet added later gets neither half automatically: it
gets Escape from `DialogSurface` and nothing else, and the hook's sentence says
otherwise.

Whether all seven *should* have press-away is a design question I am not
answering. The code-quality defect is that the file holding the rule asserts
coverage it does not have, so nobody auditing dismissal will look past it.

**Fix.** Either lift press-away into `DialogSurface` behind `modal === true` —
which is what "without anyone remembering to" requires, and the two halves already
do not overlap (`dismiss.ts:30-38` explains why) — or amend the header to say the
rule is opt-in, list the three sheets that take it, and say why the other seven do
not. The first is better; the second is honest.

---

# 10. The photo rule has four copies, the fourth disagrees, and the call site that disagrees also skips the content sniffer

**Severity: medium.** `lib/inspiration-photo.ts:1-2` states the rule and why it is
a rule:

> "Inspect a small header, **not the filename or the browser's MIME guess.** Keep
> original bytes (including EXIF orientation); never re-encode a capture."

`inspectInspirationPhoto` (`:4`) sniffs magic bytes for JPEG/PNG/GIF/WebP/AVIF/
HEIC/HEIF, enforces `MAX_PHOTO_BYTES` (`:3`, 25 MiB), and rejects anything else
with "Use a JPEG, PNG, WebP, GIF, AVIF or HEIC photo."

**The accepted set is then written out as a literal four times, and the fourth
disagrees:**

```
NoteTools.tsx:99                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif"
InspirationComposer.tsx:309     accept="image/jpeg,…,.heif"   (identical)
Home.tsx:17485                  accept="image/jpeg,…,.heif"   (identical)
Home.tsx:16386                  accept="image/*"              ← the memory card's add-attachment
```

**And that fourth picker is the one that never calls the sniffer.** The notepad
path does (`Home.tsx:11679`, inside `addInspirationFiles`:
`const checked = audio ? file : await inspectInspirationPhoto(file);`). The memory
card's `attachTo` (`Home.tsx:13131`) does not — it goes straight to presign and
finalize, and classifies the file from the browser's guess:

```js
type: file.type.startsWith("image/") ? "image" : "file",
```

which is the exact input the lib's first sentence says not to trust. There is no
size check against `MAX_PHOTO_BYTES` either (the server's 25 MiB cap in
`packages/api/src/lib/inspiration-attachment-input.ts:4` bounds it, so this is a
consistency defect and not a hole). Net effect: a TIFF, a BMP or an SVG renamed
`.jpg` is selectable from one of the product's four pickers, is uploaded, and is
stored as `type: "image"`, while the same file is refused with a sentence at the
other three.

The error string is also a fifth statement of the set, in English prose, in a
module with no locale parameter — the same class the regression audit's L4 covers,
noted here only because it is the fifth copy.

**Fix.** Export the accept list from `lib/inspiration-photo.ts` next to the
sniffer — `export const PHOTO_ACCEPT = "image/jpeg,…"` — and use it at all four
inputs, including `Home.tsx:16386`; route `attachTo`'s file through
`inspectInspirationPhoto` like its sibling. The lib is already the single home for
the rule; it just does not export the half the DOM needs.

---

# 11. Minor, grouped — each a one-line fix, each a reader misled

These are below the line I would ask anybody to act on individually, but they are
the same shape as the findings above and cost minutes each.

- **Two complete class vocabularies, with no rule for which to use.** Markup:
  **458 `jar-` tokens against 214 `waka-`**, plus 36 `chat-`, 28 `login-`, 21
  `field-`. Stylesheets: **974 `jar-` against 340 `waka-`**, 94 `chat-`, 82
  `login-`. The redesign added a full second family and retired none. The two
  halves of the one note page are split across them: `NotePage.tsx` renders
  `jar-note-top`, `jar-note-when`, `jar-note-verb`; `NoteTools.tsx` renders
  `waka-dock-tool`, `waka-dock-state` — two files that exist solely to make one
  page. `home.css:2655` already names the risk in its own voice: *"A new surface
  that brings its own type is how a product ends up with **thirty-four
  prefixes**."* One paragraph in `claims.css`'s header saying which prefix new
  work uses and what `jar-` now means would settle it; nothing in the tree says
  today.
- **`jar.css` is named five times and does not exist** (renamed to `home.css`):
  `canvas/palette.ts:307` ("Every colour the canvas paints with lives in jar.css")
  and `:316` ("These fallbacks MUST match jar.css's warm ivory"),
  `canvas/sprites.ts:137`, `lib/num.ts:29`, `space/top-of-mind/poster.tsx:29`.
  Each is a "go read that file" pointer, which is the kind that costs the reader
  most.
- **`DAY_MS` is exported, imported, and then re-typed as a literal inside the
  importing file.** `lib/words.ts:21` does `import { DAY_MS } from "./num"` and
  uses it at `:32`; `:280`, inside `archiveChapter`, declares
  `const day = 86_400_000;`. Three other sites write the literal:
  `ConversationsOverlay.tsx:161`, `PrincipleShare.tsx:67`, `lib/data.ts:543`.
  `lib/num.ts:1-14` is explicit that this file exists so "symbols nobody owned"
  get an owner.
- **The 25 MiB cap is three literals in two packages with no pointer between
  them**: `MAX_PHOTO_BYTES` (`lib/inspiration-photo.ts:3`),
  `MAX_ATTACHMENT_UPLOAD_BYTES` (`packages/api/src/lib/inspiration-attachment-input.ts:4`),
  and "over 25 MB" in the client's error prose. They agree today. Neither
  comment names the other, so a server-side raise leaves the client refusing at
  the old number.
- **`NoteTools.tsx:70` is an effect with no dependency array**:
  `useEffect(() => { setSlot(document.getElementById(DOCK_SLOT)); });` — it re-runs
  after every render. It is safe (React bails on an identical `setState` value)
  and the reasoning above it for reading the slot after paint rather than during
  render is right. But the comment says "which re-renders once with it", which
  describes a `[]` or `[open]` dependency array; the code describes a
  getElementById on every render forever. Add the array, or say why there is none.
- **`ConversationPanel.tsx:465` names a mechanism that does not exist**:
  "`isDisabled` deliberately does not apply to the stop state". There is no
  `isDisabled` in the file; the mechanism is `whyNoSend` (`:271`) and
  `disabled={Boolean(whyNoSend)}` (`:483`). It may be a quotation of the reference
  library's prop name, in which case one word ("the reference's `isDisabled`")
  fixes it; as written, a reader greps for a symbol that is not there.

---

# What held up

Recorded so nobody re-derives it.

**The `buildPalette` ↔ CSS palette contract is intact, verified literal for
literal.** `canvas/palette.ts:299-325` reads eight custom properties off the
computed root with hardcoded fallbacks. All eight are declared exactly once in the
tree, in `home.css:181-200`, and **every fallback matches its declaration
exactly**:

| property | `home.css` | `palette.ts` fallback |
| --- | --- | --- |
| `--jar-live` | `#fff2dc` | `#fff2dc` |
| `--jar-live-edge` | `#f7ead4` | `#f7ead4` |
| `--jar-live-bloom` | `#ffedd0` | `#ffedd0` |
| `--jar-fade` | `#b9c4d1` | `#b9c4d1` |
| `--jar-dorm` | `#28323f` | `#28323f` |
| `--jar-dust` | `#cdd8e6` | `#cdd8e6` |
| `--jar-body-lit` | `#f7f1e4` | `#f7f1e4` |
| `--jar-body-shade` | `#a49b8c` | `#a49b8c` |

No duplicate declaration of any of the eight exists in any sheet, so the canvas
and the DOM genuinely read one palette, and the layer problem in finding 1 cannot
break it: `getComputedStyle` reads whatever the cascade resolved, so both sides
move together by construction. The warning at `:316-321` about a cold fallback
baking a cold companion for the whole session is live and correct. The only defect
here is the file name in the prose (finding 11).

**`lib/num.ts`, `lib/dismiss.ts`'s mechanism, `lib/keep-ready.ts`'s own body,
`lib/view-location.ts`, `components/DialogSurface.tsx` and
`components/NotePage.tsx` are the right abstractions in the right layer.** I went
looking for things in the wrong place and these are not them.
`DialogSurface`'s `modal` prop is the best piece of design work in the range: it
names two things that were one component, quotes the audit, quotes the stylesheet
back at itself, measures the bug ("sixty presses forward and sixty backward, and
not one of them landed on the bar") and explains what each kind keeps and gives
up. `NotePage`'s "What this owns, and what it does not" — "It owns no state, no
save, no textarea… pretending those are one thing is how a shared component
becomes a switch statement wearing a disguise" — is exactly the boundary statement
a shared component needs, and the component obeys it. `view-location.ts` keeps all
address knowledge in one place with its retired routes tombstoned in place rather
than parsed into surfaces that no longer exist.

**`whyNotKept`'s ordering is reasoned, not incidental**, and the reasoning is the
kind that survives: "ORDERED BY WHAT A PERSON SHOULD DO FIRST, not by cheapness to
check… Only the first is ever shown, **so the order IS the message**"
(`keep-ready.ts:63-69`). Finding 3 is about who asks it, not about it.

**`reachable.test.ts` is the best-shaped ratchet in the suite** — a ceiling, a
slack assertion so the ceiling cannot go stale upward, a tripwire against a broken
walk ("THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES"), and a written
argument for why it is a ratchet and not a ban. Finding 5 is a four-line bug in a
good gate, not a bad gate.

**Three of the long comments are load-bearing and correct, and should be the model
for the rest.** `layers.css`'s "WHY IT HAD TO BE ONE CHANGE" paragraph (`:48-57`)
is the single most valuable comment in the repository — it will stop somebody
breaking the product. `home.css:5035-5040`'s record of a layer fix that did
nothing is the right way to record a failed attempt. `lib/aliveness.ts`'s "WHERE
THEY DELIBERATELY DIFFER FROM THE BACKEND, AND WHY" ends with "That is an
argument, not a fact, and it is written here so it can be argued with", which is
the standard the whole file set is reaching for.

**`npx tsc --noEmit` exits 0** on the dirty tree, mid-edit, with two agents
writing. That is not nothing.

---

# What I could not check, and why

- **Anything that needs a browser, which is where two of my findings resolve.**
  Finding 2 proves that the gate's stated invariant is violated and that the gate
  cannot see it; whether the ink visibly jumps on a coarse pointer needs a
  measured capture at 393×852. Finding 1's live consequences — which of the 11
  cross-layer class collisions and 36 bare-element selectors in unlayered
  `claims.css` actually change a pixel — need `e2e:measure` / `e2e:snapshot`
  against a signed-in session. The dev server on `:3010` is serving two agents'
  in-flight edits to the exact five stylesheets and the exact page in question, so
  a capture from it would not be a statement about `ea1727db`. I did not
  authenticate.
- **I did not mutate source to prove the vacuous tests stay green**, which would
  have been the stronger proof. The brief forbids editing source and two agents own
  these files; a revert racing a concurrent write is a real risk. Instead: finding
  2 is proved by running the gate's own algorithm over the winning rule in a
  scratch copy, and finding 6 is proved by counting the four class names to zero
  across `src` and `src/styles` — a `querySelectorAll` for a string that exists
  nowhere cannot return a node. Finding 5 is proved by running the gate's own
  `inwardOnly()` three ways. All scratch files were written under the session
  scratchpad and deleted; `git status` shows nothing of mine.
- **`ReadingPanel.tsx`, `AntechamberPanel.tsx` and `DuplicatesPanel.tsx` are
  deleted in the working tree** (`git status`: ` D`), along with
  `lib/api/reading.ts`, `lib/api/signal-duplicates.ts` and three of their tests.
  The brief asks me to judge their naming and consistency. I read them at
  `d722fd6f` and found nothing worth reporting beside the items above, but I am
  not making a claim about files that are being removed as I write.
- **`Home.tsx`'s speech machinery.** The correctness review has three findings
  live in it and an agent is editing it now. I measured its shape (107 refs, 720
  `.current`, 42 empty dependency arrays) and used it as evidence for finding 7,
  but I did not audit the individual writers of `charSay` or `lit`, because any
  conclusion would describe a file that changed under me — `Home.tsx` moved ~111
  lines during this review and I re-anchored every citation once at the end.
- **Whether the seven modal sheets in finding 9 should have press-away** is a
  design question for the founder, not a code-quality one. I report only that the
  file holding the rule claims coverage it does not have.
- **The 31 non-ref values the simulation effect captures.** I measured the count
  mechanically and verified the two the file itself documents (`citations`,
  `signals`). Deciding which of the remaining ~19 are deliberate needs the author;
  that is the point of the finding — the information is not recoverable from the
  file.
- **`packages/api`, `packages/admin`, `packages/mobile`.** The brief's seven
  questions are all about `packages/web`, and the churn is 99% there. I read the
  API only where a client rule needed a server counterpart (the upload cap, the
  attachment size bound). The API's own quality is unreviewed by me;
  `correctness-2026-10-11.md` ran its 1,821 tests.
- **`tools/e2e`.** Not run — same reason as the browser items. The cleanliness
  review covers its `/profile` leftovers; I did not assess the walks as code.
