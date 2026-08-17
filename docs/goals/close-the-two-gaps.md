# Goal: close the two gaps — the state nobody owns, and the findings nobody named

Status: **draft v1 (2026-08-17).** Not started. Branch `goal/frontend-you-can-read`
carries the work this follows; nothing is merged and no PR is open.

Follows: `docs/goals/a-frontend-you-can-read.md`, which asked two questions and
answered one. Terminology is done and defended by a gate. Structure is roughly
forty per cent done and stopped against a real obstacle. Six security findings
of twelve are closed. This goal finishes both, and exists as a separate
document because the remaining work has a different shape: the first goal was
mostly relocation, and this one is mostly ownership.

Canon: `docs/data-model.md` for the nouns, `docs/architecture.md` for the three
vocabularies. Neither is amended here.

## Why

Two gaps, and they are unequal — which decides the order.

1. **Seven findings have never been named.** The count of twelve came from a
   compacted summary; five were written down and are now closed, and the
   audit meant to derive the rest never returned. So "seven remain" is not a
   backlog, it is an absence of knowledge. Everything found by actually
   looking, this week, was live: a session cookie shipping without `Secure`
   because Lambda does not set `NODE_ENV`, an invite link that enrolled you on
   click, removal that left the door key unchanged, and Google sign-in handing
   a victim's session to whoever had squatted their address. The rate at which
   looking produced real bugs is the argument for looking again.

2. **One file is half the frontend, and half of that file is one function.**
   `Home.tsx` is 10,792 lines; the simulation effect is 5,109 of them. That is
   not a size problem. 83 functions close over 113 loose `let`s, so nothing can
   leave while every function can touch everything — the sky's 18 outward
   dependencies and the three panels held by DOM refs are the same fact wearing
   two costumes.

**Security first.** An unverified session cookie cannot wait for a refactor,
and the refactor is safer once the codebase stops changing underneath it.

## Shape of the work

Four phases. Phase 1 buys knowledge, Phase 2 finishes what shipping the last
fix started, Phase 3 buys the coverage Phase 4 spends. Phase 4 is the
structural work and is deliberately last, because it is the only phase whose
failure mode is silent.

The rule that governs Phase 4: **name the state before moving anything.** Every
extraction attempted before that in the previous goal either failed on
measurement or produced a component with forty props.

---

### Phase 1 — Name the seven

The audit that was supposed to produce this list stalled twice. Run it again,
and treat "no finding in this area" as a real and useful answer rather than a
failure to look hard enough.

Areas, chosen because each one produced a live bug this week or is adjacent to
one that did:

- **Sessions and tokens** beyond the cookie: lifetime, revocation on password
  change, CLI login code entropy and reuse, whether logout invalidates server
  side.
- **Authorization on every route**: whose data can this reach, and what proves
  the caller owns it? Particularly any list endpoint that filters in JS after
  selecting rows it should never have selected.
- **The canon's privacy boundary**: an inspiration never crosses an account
  boundary, a member sees THAT a shared signal fed an entry and never which
  one, `visibility` defaults private. Over-serialization is the shape to look
  for — a row spread instead of named field by field.
- **Group membership**: can one member vote twice, or as another; does leaving
  revoke every capability; does any endpoint trust a client-supplied profile id.
- **Secrets and injection**: unsafe env fallbacks, prompt injection reaching a
  model that can then act, S3 key construction, rate limits on model calls.

Each finding needs a concrete exploit — actor, steps, what they gain. "Could be
exploited" is not a finding.

**Gate:** every area has been looked at and reported on, each finding carries
an exploit path, and the ones not being fixed are recorded here with the reason
and what would reopen them.

### Phase 2 — Make verification real

`1319a95` built email verification with the transport left out deliberately —
choosing SES over Resend is a decision about domains, DKIM and credentials that
belongs to whoever runs the infrastructure. That decision is now the only thing
standing between a working gate and a broken product.

- **Wire a provider.** One implementation of `SendVerificationEmail`, passed in
  at the edge. Nothing else in `lib/email-verification.ts` changes.
- **Verify a sending domain** before a single message leaves.
- **A `/verify-email` page** on the web side that posts the token and says
  which of the four outcomes happened — `expired` is actionable where `invalid`
  is not, which is why they are told apart.
- **Decide the backfill, and say which was chosen.** Joining a group now
  requires a proven address. Every pre-existing account is unproven, which is
  honest but means they cannot join anything until mail works. Either wire the
  transport before deploying, or mark accounts created before `0006` as
  verified so only new signups are gated. The second is a deliberate weakening
  and should be written down as one.
- **Resend endpoint**, throttled by the cooldown already implemented.

**Gate:** a real address receives a real link, following it proves the address,
and a person who signed up yesterday can join a group.

### Phase 3 — The net sees more than one thing

The net asserts one invariant and one count over 5,109 lines, and it stayed
GREEN through a real bug — the provenance key that left every group's poster
standing on nothing. That is the coverage Phase 4 would be leaning on.

The harness exists and the expensive part is built. This is fixture work.

- **The sky**: no candidate currently reaches the harness at all, so layer 2 is
  entirely unobserved. Assert that a signal with evidence becomes a nebula with
  satellites, and that adopting one condenses it.
- **The poster**: the drift readout — a word that survived a rewrite stays lit,
  a new one arrives — has no test, and it is the product's most-read surface.
- **The dial**: scrubbing changes what is present. Assert `present` falls as
  the dial winds back.
- **Three-point probes.** The vocabulary gate reported clean over half a file
  for a week because it was only ever proven at one location. Every check this
  repo trusts should be proven to fail at more than one point.

**Gate:** each new case is demonstrated to fail against the code that would
break it, not merely to pass against the code that works.

### Phase 4 — Give the state an owner

5,109 lines, 113 mutable variables, 83 functions. In four steps, and the first
one moves nothing.

**4a. Name the state.** The 113 already group by theme:

| count | group |
|---|---|
| 42 | camera and travel |
| 33 | the character |
| 15 | the sky |
| 10 | viewport and clock |
| 9 | the field's pour |
| 4 | judged individually |

`let camY = 0` becomes `cam.y`. Every use site is a compiler error until it is
carried through — the same property that made the vocabulary rename safe.
Nothing changes file, nothing changes behaviour, and the net stays green
throughout or the step is wrong.

#### 4a in practice — the order, the method, and what stops it

**Five commits, smallest first.** Not because the small ones matter, but because
the method has to be proven on something cheap before it is pointed at the
forty-two-variable one.

| # | group | count | why here |
|---|---|---|---|
| 1 | the field's pour | 9 | the rehearsal: few names, one concern, obvious blast radius |
| 2 | the sky | 15 | already known to be cohesive; this is the group 4b is really about |
| 3 | viewport and clock | 10 | read by everything, written by almost nothing — proves the method under wide reach |
| 4 | the character | 33 | large but self-contained |
| 5 | camera and travel | 42 | last: biggest, most entangled, and the one travel bugs live in |

**The method, per group.**

1. Declare the object where the `let`s were, with the same initial values:
   `const pour = { active: false, poured: false, step: 35, … }`. Not a `let` —
   the object is never reassigned, only its fields.
2. Delete the `let`s. Every use site is now a compiler error.
3. Rename with `packages/web/scripts/rename-identifier.mjs`, which masks
   comments and string literals exactly as the vocabulary gate does — a plain
   regex rewrote 142 comment lines the last time one was used here.
4. Fix what the compiler still complains about by hand. Expect collisions:
   several of these names (`col`, `settle`, `prev`) also exist as locals inside
   nested functions, and TypeScript will say so.
5. `pnpm test` (vocabulary gate, 65 tests) and `tsc --noEmit`. Commit.

**Assignment still works.** `pour.active = true` behaves exactly as `pouring =
true` did — the closure captures the object, not the field. That is the whole
reason this is safe: nothing about lifetime, ordering or identity changes.

**What stops the phase.** If a group cannot be named without also touching
another group's variables in the same commit, the grouping is wrong — stop and
regroup rather than widening the commit. The five above are a hypothesis from
name prefixes, not a proof.

**Do not start this without finishing it.** Half-renamed state is worse than
none: the file then has two vocabularies for the same concept and no compiler
error to say so. One group per sitting, committed green.

**4b. Read the dependencies off the signatures.** A function that only touches
`sky` now says so. The sky engine's 18 outward dependencies should collapse to
two or three objects, because most of the 18 were fields of one theme. This is
the gate for 4c: **if a candidate still needs four or more groups, it is not a
module** — that measurement, not enthusiasm, decides.

**4c. Extract what 4b proved separable**, taking its group as a parameter:
`stepSky(sky, view, dt)` rather than a closure over everything. The sky is the
expected first at roughly 950 lines.

**4d. The three blocked panels.** Their DOM refs are a distinct seam — React
owns the elements, the loop measures them. Collect them into one `measured`
object written by React and read by the loop, and the refs stop being props
threaded through children.

**Gate:** `Home.tsx` under 6,000 and the effect under 2,000, with the net green
at every step. If 4b shows the sky still needs four groups, this phase stops
and says so rather than forcing a module that is a wall drawn through code.

## Out of scope

- The `packages/admin` surface.
- Any change to the canon's nouns.
- `ApiTopOfMindEntryType` is still `"pattern" | "tension" | …` in the API. The
  frontend must keep saying `"pattern"` in that one string until the backend
  adopts its own renamed canon. That is a change in `waka`'s API, not here.
- Visual redesign.

## Log

_(appended per phase at execution)_

### Starting state (2026-08-17)

- **Terminology: done.** `vocabulary: clean`, enforced by `pnpm test`, and
  proven to fail at three points across the file — including line 9013, where
  the gate had been blind because an apostrophe in JSX text opened a string
  that swallowed half of `Home.tsx`.
- **Security: six of twelve.** Closed: migration `0003` bricking derivation,
  the session cookie without `Secure`, `?join=` silent enrolment, join codes
  surviving removal, Google pre-hijacking, and unverified email addresses. Five
  are held by a test that goes red without the fix.
- **Structure: thirteen modules out, one file still half the frontend.**
  `Home.tsx` 13,516 → 10,792. All three canon layers have a directory;
  `space/signal/` did not exist before this work.
- **Two corrections carried forward**: the sky engine is NOT separable as first
  measured, and three of the five JSX panels are blocked on DOM refs the loop
  writes into. Both were measured optimistically the first time.

### 4a — done (2026-08-17), in six commits, not five

`4b81b82 dc97e22 0fba6a7 4799f30 5b1afd7 3487686`

113 loose `let`s are now 13, and eleven of those are locals inside nested
functions that were never in scope. Every commit: vocabulary clean, 65 tests
green, `tsc` clean.

| object | fields | what it owns |
|---|---|---|
| `view` | 8 | the viewport, and what the display asked for |
| `cam` | 10 | where the world is looked at from, both axes |
| `trip` | 10 | a crossing from one wall to the next |
| `companion` | 33 | one body's posture at one instant |
| `gesture` | 24 | one hand on the world |
| `sky` | 11 | layer 2, and what the pointer is doing to it |
| `pour` | 5 | staging orbs into the field |
| `clock` | 4 | whether the loop turns, and since when |
| `stir` | 2 | how alive the world is right now |
| `poster` | 2 | what the peek row rests on |
| `hinted` | 2 | which one-time hints have been said |

`mech` and `ground` stay loose — each is a single value with one meaning and
no partner to be incoherent with.

**The plan's five groups were wrong three times, and the same way each time:
they were prefix guesses, and reading the use sites moved things.** `settle`
and `stirAt` were filed under the pour and are read by four subsystems, none
of them the pour. `primed` and `motesPlaced` were filed under the pour and are
first-sizing flags. `provenance` and `wallProv` sat in the sky's block and
belong to the poster. The rule that caught all three: **name the group after
what reads it, not after what it sits next to.**

**The tool did the real work, and it was wrong twice before it was right.**
`packages/web/scripts/rename-identifier.mjs` is now on the TypeScript AST:

- Both regex versions corrupted prose — the first rewrote 142 comment lines,
  the second survived comment and string masking and still rewrote JSX text,
  because `<div>Waka could not be poured</div>` is neither.
- `--decl <line>` resolves symbols, which mattered enormously: `prev` appears
  112 times and 4 are the variable; `layout` 153 and 44; `col` throughout and
  36. A text rename at this scale would have been unrecoverable.
- `{ vh }` is both a property and a reference, and the checker answers about
  the property. The shorthand guard compared the wrong symbols and silently
  skipped two sites; `tsc` caught it. It now asks
  `getShorthandAssignmentValueSymbol`, and the fix is proven on a fixture.

**The order matters and is not obvious**: rename while the `let` is still
there, THEN delete it. Delete first and the inner references resolve to
whatever they shadow, and the tool faithfully renames the wrong variable.

### 4b — measured (2026-08-17). The sky PASSES, and the old verdict was wrong.

`packages/web/scripts/measure-groups.mjs` reads the dependencies off the code
rather than off anyone's memory. 82 functions are declared in the frame effect.

| groups touched | functions |
|---|---|
| 0 | 5 |
| 1 | 21 |
| 2 | 19 |
| 3 | 6 |
| 4 | 3 |
| 5 | 6 |
| 6 | 2 |
| 7 | 1 (`draw`, 531 lines) |
| 11 | 1 (`tick`, 467 lines) |

**Sixty of eighty-two functions touch two groups or fewer.** That is the
result 4a was for: before it, every one of them could reach all 113 variables
and none of them said which.

**The sky engine — 13 functions, 723 lines, 3 groups: `sky`, `stir`, `view`.
It passes the gate.**

The previous goal recorded "the sky engine is NOT separable (18 outward, 23
back)" as a correction to an optimistic first measurement. That correction was
itself wrong — or rather, it measured a boundary that included the pointer-
facing functions. Drawn around the engine proper it is 3 groups and 9 outward
references:

- `allBalls`, `findBall`, `byId` — looking a memory up
- `clampHome`, `orbFitX`, `orbFitY` — field geometry
- `colOfGroup` — column lookup
- `release`, `wake` — telling the rest of the world something happened

Adding `nebAt` and `satAt` takes it to **4 groups and FAILS**, because both
need `cam` to turn a screen point into a layout one. They are hit-testers, not
engine, and they stay behind.

So the boundary the measurement draws is `stepSky(sky, view, stir, deps)` with
a nine-member `deps`, and the two hit-testers left in `Home.tsx`.

**What this says about the method.** Three times now a claim about this file
has been settled by measuring instead of arguing, and twice the measurement
reversed the previous answer. The tool is committed so the next person does
not have to take this on trust either.

### 4c — done (2026-08-17), recorded in `c7cc869`

The sky engine left the page on the boundary 4b measured. `Home.tsx` 10,959 →
10,110. The commit message carries the detail, including which of the thirteen
moved functions the suite actually reaches and which are covered by the
identical-body diff alone.

### 4d — the refs collapse; the panels still do not come out, and here is why

**Done: twelve refs became one seam.** `packages/web/src/canvas/measured.ts`
holds the elements React creates and the canvas side reads and writes. The
membership rule is mechanical and has no exceptions — an element is in
`Measured` if and only if the frame effect or the palette pass that feeds it
dereferences the element. That rule excludes `panelRef`, `panelTextRef`, the
four dial refs and `mouthFieldRef`: the reading panel and the dial DO cross the
seam, but they cross it as numbers through `SimApi.place()` and
`SimApi.scrubTo()`, and the elements themselves are only ever read by React.

Every field is a ref object, never a captured element, so `.current` is read in
the frame that uses it. The opposite shape is the trap the sky extraction hit —
a value collected when the object is built freezes whatever was mounted at that
instant, silently, and nothing throws.

**Proven a pure collection, not asserted.** The substitution was undone
mechanically — every `measured.x` back to `xRef` — and the result diffed
against the file before the change. The only differences are the import and the
declaration block; all 49 use sites are byte-identical.

**What green meant here, before and after.** Each of the twelve was pinned to
its value at construction, one at a time, and the whole suite re-run:

| frozen | before 4d | after 4d |
|---|---|---|
| `root`, `canvas` | red | red |
| `atmos`, `hq`, `charSay`, `mouth` | **green** | red |
| `grain`, `hqInner`, `nebEls`, `clusterEls`, `satSay`, `mouthSpot` | green | green |

Ten of twelve silent holes, in exactly the place a silent failure was
predicted, is not a net — so `test/measured.test.tsx` reads back four of the
styles the loop writes and closes four of them. The six that remain open are
named in that file's header with the reason each one is out of reach: a canvas
the stub does not rasterise, a value only ever read into the companion's size,
a formed candidate with a pointer resting on its satellite, and a keep.

**Not done, and it is not the refs.** The refs were one of two things holding
the three panels, and much the smaller one. Free bindings per block, JSX
intrinsics excluded, measured with ONE tool across this change's actual parent
(`c7cc869`) and its result:

| block | lines | bindings, was | bindings, now | effect of 4d |
|---|---|---|---|---|
| the ready field | 463 | 43 | 41 | −2 |
| the reading panel | 277 | 38 | 38 | 0 |
| the sky | 216 | 28 | 26 | −2 |

The reading panel is unchanged BY CONSTRUCTION: it holds no `Measured` member,
because it crosses the seam as NUMBERS through `SimApi.place()` rather than by
handing the loop an element. That is the membership rule working, and it is a
better argument than a larger number would have been.

An earlier draft of this table claimed −10, −6 and −11. Those were wrong, and
wrong in the direction that flattered the change: the "was" column had been
lifted from `a-frontend-you-can-read.md`, where it was measured by a different
tool at commit `a00582a`, so it silently credited 4d with reductions that 4c
and other work had already made. The numbers above come from running one
counter at both commits. **A measurement taken with one tool and compared
against another tool's output is not a measurement.**

`measured` is now ONE of those, in place of three each in the ready field and
the sky. The rest is not ref-shaped. The sky's 24 are ten pieces of data, six
actions, `simApiRef`, `measured`, and six of transient editing state — and that
last group is the real remaining blocker, because `edit`, `setEdit` and
`saveEdit` appear in ALL THREE blocks. One editing state, written by three
panels, is a shared mutable channel of exactly the kind `measured` just
resolved for the DOM, and threading it as props would relocate it rather than
resolve it. That is the next measurement, not this one.

### 4e — the editing state gets an owner; the panels still cannot leave

4d ended by naming the last shared channel: `edit`, `setEdit` and `saveEdit`,
free in all three blocked blocks at once. That is now one object with one owner
in `packages/web/src/space/editing.ts`, and the answer to "did a panel come
free" is **no**. The numbers are below rather than the verdict alone, because
the verdict is the boring half.

**The counter, checked against two published answers before it was trusted.**
`packages/web/scripts/measure-blocks.mjs` counts, per JSX block, every free name
the block reads, split into what the component body holds (the props a child
would take) and what is module-level or global (not props — a child imports
them itself). Aimed at `c7cc869` and at 4d's result it reproduces both columns
of 4d's table exactly: 43 / 38 / 28 and 41 / 38 / 26. A tool that agrees with a
known answer at two commits is one whose answer at a third can be read.

| block | lines | bindings, after 4d | after 4e | of which editing |
|---|---|---|---|---|
| the ready field | 463 → 456 | 41 | 39 | 3 → 1 |
| the reading panel | 277 → 276 | 38 | 36 | 3 → 1 |
| the sky | 216 → 214 | 26 | 24 | 3 → 1 |

Exactly −2 each, which is the arithmetic of three names becoming one and is
all it could ever have been. `Home.tsx` 9,910 → 9,840.

**So what actually holds them, and it is not a third `measured`.** The tool now
also reports which names more than one block reads, because that is the only
column that distinguishes a channel running BETWEEN blocks from a block's own
subject. There were eleven such names after 4d and there are nine now — three
became one — and `editing` is the only one read by all three blocks:

```
editing    [hook]  the ready field, the sky, the reading panel
measured   [hook]  the ready field, the sky
atWall     [state] the ready field, the sky
simApiRef  [ref]   the ready field, the sky
salience   [cb]    the ready field, the sky
candidates [memo]  the ready field, the sky
TRef       [ref]   the ready field, the reading panel
verdicts   [state] the sky, the reading panel
sayVerdict [cb]    the sky, the reading panel
```

Two of the nine are the collections already built. Of the other seven, none is
shared by more than two blocks and no three of them are the same kind of thing,
so there is no fourth object waiting to be named — collecting `atWall`,
`salience` and `candidates` would produce a bag whose only property is that the
ready field and the sky both happen to read it, which is the grab-bag
`measured`'s membership rule exists to refuse.

Everything else is the block's own: the reading panel's 29 component-body names
are 8 pieces of panel state, 6 of its own callbacks, 5 locals derived from the
focused ball, 4 refs, 3 setters, 2 memos and `editing` — and 25 of those 29
appear in no other block, so they would leave WITH it and leave no seam behind.
That is the honest shape of the answer: what blocks the panels is not
entanglement any more, it is size. A 29-prop component is not more readable than
the block it replaced. The state has an owner and the panels stay.

**The save itself moved unchanged, and that was checked rather than claimed.**
The old `saveEdit` body and the new `keep` were normalised for the rename
(`edit`→`held`, `setEdit`→`put`, the page's writers behind `d.`) and diffed.
Four differences, all of them the intended ones: the two accessor reads at the
top, one re-wrapped line, and the failure path's functional `setEdit((e) => …)`
becoming a read of the same ref — equivalent because `put` is the only writer to
either half. Every branch, every comment and the 404 reload are byte-identical.

**Why the shape is not `measured`'s shape.** `Measured` is one stable object of
refs because its reader is the frame loop, which closes over it once and never
re-runs. `Editing`'s reader is the RENDER, which re-runs whenever the words
change, so the object is rebuilt when its value changes and that identity change
is what makes React redraw the open editor. The refs move to where the freeze
actually is: the callbacks are stable for the page's life, so the draft and the
page's writers are read through refs at call time rather than captured.

**What green meant here, measured the same way 4d measured it.** Each freeze was
introduced deliberately and the suite re-run:

| frozen | before 4e | after 4e |
|---|---|---|
| the draft `keep()` reads | — | red (3 cases, 2 suites) |
| the draft `retype()` writes onto | — | red (3 cases, 2 suites) |
| the `deps` object | — | **green** |

The last row is the point of recording the table. Freezing the writers changes
nothing today because every member of `EditingDeps` is stable by React's own
guarantee — so the ref around it is a defence with no net under it, and the day
someone adds a `useCallback` to that list there will be nothing to catch it.
That is stated in the file's header rather than left for someone to discover.

**And a hole that was there before this change.** Editing is one gesture on
three layers and it had exactly ONE test, on the poster's entry. Measured, not
assumed: throwing from inside the `memory` and `signal` branches of the save
left the whole suite green. Both are now driven end to end in
`test/home-sky.test.tsx` — "say it better" on a candidate, and "change the
words" on the memory a candidate was read from, reached by the product's own
`read from` row — and each was proven to go red for both freezes above.
