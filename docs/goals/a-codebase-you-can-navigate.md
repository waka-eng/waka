# Goal: the whole codebase, not just the frame loop

Status: **draft v1 (2026-08-17).** Branch `goal/frontend-you-can-read`.
Nothing merged, no PR open.

Follows `close-the-two-gaps.md`, which is finishing `Home.tsx`'s state. That
work is real but it is one file. The owner's question was about the CODEBASE:
*is it restructured so it is extremely easy to navigate and understand?* The
honest answer has been "about forty per cent", and forty per cent is a number
about `Home.tsx`, not about 50,092 lines across three packages.

This document says what 100% means in numbers, so it can be checked rather
than felt.

## Where it actually stands (measured 2026-08-17)

| package | files | lines |
|---|---|---|
| api | 108 | 26,689 |
| web | 46 | 22,736 |
| admin | 6 | 667 |

The twenty largest files hold roughly half of everything:

| lines | file |
|---|---|
| 10,959 | `packages/web/src/pages/Home.tsx` |
| 1,863 | `packages/api/src/routes/groups.ts` |
| 1,745 | `packages/web/src/lib/api.ts` |
| 1,266 | `packages/api/src/routes/inspirations.ts` |
| 963 | `packages/api/src/lib/top-of-mind-synthesis.ts` |
| 880 | `packages/api/src/lib/signal-derivation.ts` |
| 854 | `packages/web/src/lib/fixture.ts` |
| 817 | `packages/web/src/pages/Login.tsx` |
| 799 | `packages/api/src/routes/auth.ts` |
| 791 | `packages/api/src/lib/signal-enrichment.ts` |
| 783 | `packages/api/src/queue/gemini.ts` |
| 745 | `packages/api/src/routes/signals.ts` |
| 732 | `packages/api/src/lib/queue.ts` |
| 706 | `packages/web/src/pages/Profile.tsx` |
| 693 | `packages/api/src/routes/auth-google.ts` |
| 672 | `packages/api/src/routes/attachments.ts` |

`Home.tsx` alone is 48% of the web package.

## What 100% means

Seven gates. Each is checkable by a command, not by opinion.

**G1 — No file is a landmark.** Nothing over 800 lines, OR the file carries a
header saying in plain words why it is one thing that must not be split. A
file over 800 lines with no such header fails. `Home.tsx` under 2,000.

**G2 — A reader knows where to start.** A `docs/map.md` that answers, for
someone who has never seen this repo: what are the three packages, what is the
one path a request takes end to end, and which six files should be read first.
Every directory under `src/` named in it.

**G3 — One name for one thing, enforced.** The vocabulary gate already does
this for the frontend's canon words. Extend it to `packages/api`, so the two
sides cannot drift apart again.

**G4 — Sibling directories are not near-synonyms.** `space/` and
`space-kinds/` sit next to each other and nothing in either name says which
holds what. Resolve it — merge, rename, or document the distinction in a way
that survives a reader who has not read this file.

**G5 — Every module says what it needs.** No function in a frame loop or
request handler should reach past four state groups without a written reason.
Two checks: `packages/web/scripts/measure-groups.mjs` for the frame loop and
`packages/api/scripts/measure-concerns.mjs` for the request handlers. Measured
below; the reasons are written and the outstanding ones are named.

**G6 — The tests describe the product, not the fixture.** Already burned once:
a test suite passed while describing the offline fixture because it mocked
`lib/api` instead of `lib/data`. Every suite states in a header what layer it
mocks and why.

**G7 — Nothing green is blind.** Every gate this repo trusts is proven to fail
at more than one point. The vocabulary gate was clean over half a file for a
week because it was only ever proven at one location.

## G5, measured (2026-08-17)

### First, the tool was under-reporting, and by how much

`measure-groups.mjs` only knew names declared INSIDE the frame effect. A ref
declared in the component body above it — `const selectedIdRef = useRef(null)`
— was neither a state group nor an effect-local, so it fell through both
buckets and was counted as **nothing at all**. That is the worst way for a gate
to be wrong. It does not report a boundary as expensive when it is cheap, which
someone would argue with; it reports one as cheap when it is expensive, and
everyone agrees and moves on.

It was caught by the sky extraction, which measured NINE outward references and
then had to write a `SkyDeps` interface with FIFTEEN members. The six the tool
could not see were `groupBallsRef`, `viewerIdRef`, `selectedIdRef`, two DOM
handles reached through `measured`, and the `setFocusCandId` state setter —
every one a component-body declaration.

The fix collects the component's own top-level scope and reports it in a
separate column, `past-effect`. It is checkable rather than asserted: the
script now takes `--file`, so it can be aimed at the pre-extraction `Home.tsx`
out of git, where the answer is known.

```
$ git show c7cc869^:packages/web/src/pages/Home.tsx > /tmp/Home.pre-sky.tsx
$ node scripts/measure-groups.mjs --file /tmp/Home.pre-sky.tsx --unit \
    persistSky,makeSat,solveSats,makeNeb,measureNeb,layoutSky,focusOn,\
placeSats,stepSky,computeClusters,springs,releaseHolds,sayWho

  UNIT: 13 functions, 723 lines
  state groups needed (3): sky stir view
  calls back into the file (8): allBalls clampHome colOfGroup findBall
                                orbFitX orbFitY release wake
  other free names (1): byId
  reaches past the effect (6): groupBallsRef[ref] nebElsRef[ref]
        satSayRef[ref] selectedIdRef[ref] setFocusCandId[state] viewerIdRef[ref]
  → a deps object of about 15 members.
```

Fifteen, and they are the same fifteen `SkyDeps` actually has, name for name.

Proved in the other direction too, because G7 asks for more than one point and
a fix for under-reporting that over-reports instead has not fixed anything. The
first draft of the correction walked the whole component subtree rather than
modelling scope, and reported `mouthSpot` as depending on a name `x` and `worn`
on a name `body` — parameters of unrelated callbacks that happen to share a
name. With the scope chain modelled, `mouthSpot` reports exactly `measured`,
which is the one thing it reaches (`measured.mouthSpot.current`), and `worn`
reports nothing.

**Which earlier conclusions this affects.** The VERDICTS all stand, and it is
worth being precise about why: the correction adds component-body names, and a
component-body name is not a state group, so no group count moves and no
pass/fail flips. The sky engine still needs three groups and is still
separable. The reversal recorded in `close-the-two-gaps.md` — that the boundary
drawn around the engine proper passes where the one drawn around the pointer-
facing functions does not — still holds.

What is wrong is every number that described the COST of a seam:

- `close-the-two-gaps.md` §4b says the sky is "3 groups and 9 outward
  references" and that the boundary is "`stepSky(sky, view, stir, deps)` with a
  nine-member `deps`". Both should read fifteen. The nine it lists are real;
  six are missing from the list.
- `c7cc869`'s commit message says nine, then names the six missing ones in a
  later paragraph. The commit was honest about the gap — it is where the gap
  was first written down — but the headline number in it is still the wrong one.
- Any estimate made with the old tool for a candidate not yet extracted
  understates its deps object. The remaining candidates named in Order step 1
  are affected: nothing about whether they can move, everything about how big
  the seam will be when they do.

**And a thing the correction shows that was not visible before.** Thirty-two of
the sixty-nine functions in the frame loop reach past the effect entirely, into
**28 distinct component-body names — 20 refs, 7 state setters, and `measured`**.
The eleven state groups are not the frame loop's whole state surface. They are
the part that got named in 4a; this is the part that did not.

### The frame loop today

`node packages/web/scripts/measure-groups.mjs` — 69 functions in the effect,
254 names in the component body around it, 49 of them refs.

| groups touched | functions |
|---|---|
| 0 | 17 |
| 1 | 18 |
| 2 | 16 |
| 3 | 4 |
| 4 | 4 |
| 5 | 5 |
| 6 | 3 |
| 7 | 1 |
| 11 | 1 |

**Fifty-five of sixty-nine touch three groups or fewer.** Ten reach past four,
which is the line G5 draws; four more sit exactly at four, which is the line the
script's own module gate draws, and both are listed because the two thresholds
answer different questions — G5 asks whether one function is honest, the script
asks whether a SET of them could become a module.

### The fourteen at four groups or more, and why

**`tick` — 467 lines, 11 groups, 8 past-effect. Legitimate, and this is the
reason.** `tick` is the frame loop's conductor. It is the single
`requestAnimationFrame` callback: it clamps `dt` once for the whole frame,
advances the camera, the travel, the character, the pour, the sky and the
clock's own idle in a fixed order, and only then calls `draw`. Touching all
eleven groups is not a symptom of it doing too much — it is what conducting IS.
Splitting it would not remove a dependency, it would move the same eleven into
whatever function then decided the order, and add a hop. The order is the
behaviour: the travel reads a camera the rubber-band has already clamped, and
the sky reads a viewport `measure` may have replaced this frame. **`tick` is
allowed eleven groups. It should stay one function, and it should stay the only
one in this file with that permission.**

**`draw` — 531 lines, 7 groups, 3 past-effect. Outstanding.** Same shape of
argument as `tick` and it is genuinely partly true: `draw` is one canvas pass,
and a single canvas has a single depth order, so the painter has to know about
every layer that can appear in it. But `tick`'s eleven are a schedule, which
cannot be anywhere else, and `draw`'s seven are seven separate painting
routines that happen to share a `ctx` and an order — the passes are already
numbered in the source. Nothing here has been measured to say the passes are
separable, so this is not a plan; it is a statement that the reason is weaker
than `tick`'s and the file's own Order step 1 already schedules it.

**`measure` — 145 lines, 6 groups. Legitimate.** The viewport changed. Every
value derived from the viewport is now wrong, and they live in six different
groups: the camera's rest points, the sky's layout, the character's floor, the
field's homes, the trip's spans, the view itself. There is no boundary to draw
here that does not need re-crossing on the next resize.

**`onUp` (112, 6), `onCancel` (34, 6), `onDown` (101, 5), `onMove` (75, 5),
`onHover` (33, 5), `tap` (23, 4). Legitimate, as one reason.** These are input
dispatch, which is the mirror image of `tick`. One pointer stream has to decide
which of several things a gesture was — a camera drag, a sky hit, a field orb,
the character, a wall crossing — and deciding that requires asking each of them.
A router touches everything it routes to. **What is NOT legitimate here is how
alike they are**: `onUp` and `onCancel` touch the identical six groups, and
`onMove` and `onHover` differ by one group each way — `onMove` has `trip`,
`onHover` has `sky`. That is a duplication finding rather than a group-count
finding, and it is outstanding.

**`travel` — 54 lines, 5 groups. Outstanding, weakly.** Starting a crossing
sets the camera's aim, the character's lead, the trip's clock and the gesture's
lockout together, and those four are genuinely one act. `view` is the fifth and
it is only read, for the viewport width the lead is scaled by. Small enough that
it is not worth moving and honest enough that it should not be hidden.

**`arriveColumn` — 29 lines, 5 groups, 3 past-effect. Legitimate.** Arrival is
by definition a moment when several things change at once: the character stops
and turns front, the ground is cleared and re-solved, the wall wakes, the peek
is re-elected. The function is 29 lines and reads as a list of what arriving
means. Its comments already say why each line is there and why it is here rather
than in a React effect watching the wall change.

**`step` (127, 4) and `tryWakeWall` (39, 4) and `onWheel` (36, 4)** sit exactly
at four and so pass G5 as written. They are named here only so that the next
person running the script does not have to work out whether they were looked at.

### The API request handlers

There was no tool, so there is one now: `packages/api/scripts/measure-concerns.mjs`.
The frame loop had eleven named state objects to count against; the API has
nothing equivalent, so the script says what it counts before it counts. **A
concern is a database table the handler reads or writes, or a module it calls
into.** Tables are read off the `pgTable` exports so the list cannot drift from
the schema. The connection, hono, drizzle and zod are excluded — every handler
in the package touches all four, and a number that never varies measures
nothing.

The one judgement in it: names local to the file are followed transitively,
imported modules are one concern each and are not followed. Hiding six tables
behind a helper in the same file changes nothing for a reader; hiding them
behind an imported module is exactly what a module is for. So the number
answers *how much does a reader of this handler have to hold*, not *how much
code runs*.

`node packages/api/scripts/measure-concerns.mjs` — 62 routes, 61 with a body it
can read, 23 tables.

| concerns | handlers |
|---|---|
| 0–2 | 33 |
| 3 | 4 |
| 4 | 4 |
| 5 | 5 |
| 6 | 6 |
| 7 | 5 |
| 8 | 4 |

**Twenty of sixty-one reach past four.** The widest:

| concerns | route | file |
|---|---|---|
| 8 | `POST /signup` | `auth.ts` |
| 8 | `PATCH /:id`, `DELETE /:id` | `inspirations-editing.ts` |
| 8 | `PATCH /:signalId` | `signals.ts` |
| 7 | `POST /login` | `auth.ts` |
| 7 | `POST /` | `feedback.ts` |
| 7 | `GET /:id` | `inspirations-recall.ts` |
| 7 | `GET /`, `GET /:signalId` | `signals.ts` |
| 6 | `POST /` | `attachments.ts` |
| 6 | `GET /callback` | `auth-google.ts` |
| 6 | `POST /` | `inspirations-capture.ts` |
| 6 | `GET /` | `inspirations-recall.ts` |
| 6 | `POST /:id/reflections` | `inspirations-reflections.ts` |
| 6 | `PATCH /entries/:entryId` | `top-of-mind.ts` |

Reporting, not refactoring — but four things are worth writing down.

**`groups.ts` is the counter-example, and it is the useful result.** All
sixteen of its handlers score 1–3, and they are the most permission-heavy
routes in the package. They score low because the work sits behind
`groups-membership`, `groups-wall`, `groups-field`, `groups-proposals` and
`groups-top-of-mind`, each named for what it does. Commit `7d4695d` moved 1,220
lines out of `groups.ts` into those five, leaving 685. It is the shape G5 is
asking for, already done once in this repo, by someone who was not trying to
satisfy this gate.

Which means the line-count table at the top of this document is already out of
date, and in the direction that flatters nobody's estimate of remaining work:
`groups.ts` is 685 rather than 1,863, `inspirations.ts` is 105 rather than
1,266, `Home.tsx` is 10,109 rather than 10,959, and `auth.ts` has grown to 891
from 799. The table is left as the dated snapshot it says it is; this note is
here so the next person does not plan against it.

**`auth.ts`'s two eights are the honest kind.** `POST /signup` writes an
account and a profile, then reaches admin-auth, throttling, email verification,
locales and sessions. Those are not five concerns that drifted together; they
are the five things that have to be true before someone has an account, and
four of them are security-relevant. This is a candidate for a named
`createAccount` step, not for being broken into five routes.

**`inspirations-editing.ts`'s two eights are the kind worth looking at.**
`DELETE /:id` reaches inspirations, attachments and signal evidence, plus the
queue, the derivation lib, two sibling route modules and the S3 client
directly. The S3 client is the one that stands out: it is the only concern in
that list that is not about what an inspiration IS, and `attachments.ts` next
door already owns object storage.

**`signals.ts` has three handlers at 7–8 and one cause.** All three carry
`resolveProfileScope` / `loadProfileTarget` — the agent-versus-human permission
matrix — inline, which brings `profiles` in as a table alongside the four
signal tables. The permission decision is the same in all three.

None of this is a defect list. It is the list to write reasons against, and the
reasons above are the start of it.

## Order

Largest lever first, but never a file whose tests do not exist yet.

1. **Finish `Home.tsx`** — 4c, 4d, then `draw` (531 lines, 7 groups) and
   `tick` (467, 11). This is already in motion and is the single biggest lever.
2. **`packages/web/src/lib/api.ts`** (1,745) — the client. Split by resource,
   matching the API's own route files, so the two sides read as mirrors.
3. **`packages/api/src/routes/groups.ts`** (1,863) and `inspirations.ts`
   (1,266) — the two biggest route files, and both hold security-relevant
   logic that a reader currently has to find in a haystack.
4. **The three Gemini-adjacent libs** — `signal-enrichment`, `signal-
   derivation`, `top-of-mind-synthesis`, `gemini`. Do these AFTER the two open
   security findings in them are fixed, not before: fixing a bug in code that
   is being moved is how a fix gets lost.
5. **`Login.tsx`, `Profile.tsx`, `fixture.ts`** — the remaining web files.
6. **G2, G3, G4, G6, G7** — the documentation and gate work, last, because it
   describes where things ended up.

## Rules

- Every commit green: `pnpm test` (vocabulary gate + web suite) and
  `tsc --noEmit`; the API suite for API changes.
- **Do not start an extraction that cannot finish green in one sitting.**
  Half-moved code is worse than unmoved code — two vocabularies for one
  concept and no compiler error saying so.
- Measure before claiming separability. Three times now a claim about this
  codebase has been reversed by measuring it.
- Never merge into `dev`. Never seed or hard-code data.
- **One PR, and the owner opens it.** PR 248 was closed because it had been
  opened early and then had every phase pushed into it, so no reviewer could
  tell what it was. The replacement is not opened by any autonomous run. The
  description gets DRAFTED to `docs/pr-draft.md` (since removed) when the
  work is done and green; opening it is the owner's call, on their word.

## What the PR has to read like

The owner's instruction, twice: *make it extremely easy to understand exactly
what was added and why, without any jargon and technical words.*

That is a real constraint, not a tone preference. The test is whether someone
who does not know this codebase can read the description and understand what
changed and why it mattered.

- **Lead with what a person would notice**, not what moved. "Rooms that never
  loaded now load" before "the effect no longer rebuilds at column zero".
- **Say why each change was needed**, in the terms of the problem it fixed.
  A bug is described by what went wrong for someone, not by its mechanism.
- **No jargon.** Not "refactor", "closure", "AST", "extraction", "state
  group", "invariant". If a technical word is unavoidable, the sentence
  around it has to explain it.
- **Name what is NOT fixed** and why. The group synthesis stub, the signals
  that have no surface, anything measured and refused.
- **Numbers only where they mean something.** "One file was half the app" is
  worth saying; a table of line counts is not.

## Log

_(appended per step at execution)_
