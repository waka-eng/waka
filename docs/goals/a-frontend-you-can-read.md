# Goal: a frontend you can read — one vocabulary, one map

Status: **draft v2 (2026-08-16).** Not started. Branch `world/three-layers`
is **77 commits ahead of `origin/dev` and 0 behind**, with no PR — Phase 0
exists because everything below is currently unmerged work sitting on one
branch.

v1 said 123 ahead. That was measured against the *local* `dev` pointer,
which is 47 commits stale; `origin/dev` is the real base and is also the
exact merge base, so the branch fast-forwards. The same correction changes
Phase 0's shape: of the 77, only the last ~19 are the rapid-fire extraction
commits the owner called noisy. The rest is earlier work with good messages
— the archive's removal, a group's majority-approval loop, the codebase
docs, the CSS layer assignment — plus merge commits from team PRs #210–#247.
Squashing those would destroy history that was never the complaint.

Canon: `docs/data-model.md` for the nouns, `docs/architecture.md` for the
three-vocabulary rule. This goal implements those two documents on the web
package and has no model opinions of its own. If a phase discovers the
canon cannot express something the product needs, the phase halts and the
canon is amended first; the code never wins an argument with the document.

Follows: `docs/goals/three-layers.md` (done 2026-08-15), which rebuilt the
API and database on the inspiration → signal → top of mind canon. That goal
stopped at the API boundary. This one carries the same vocabulary and the
same structure across the boundary into `packages/web`, which still holds a
single 11,516-line page.

## Why

Three forces, and the first is the same one that justified the rebuild:

1. **The vocabulary stops at the API boundary.** `three-layers.md` made one
   name mean one thing in the database, the routes and the MCP contract. The
   web package was never carried across. Identifiers have now been renamed
   (`captures` → `inspirations`, `patterns` → `signals`, 24 `room` symbols →
   `group`), but nothing *enforces* it: the rename was a person reading a
   file, and the next feature can reintroduce `room` with no gate failing.
   The naming-debt tax `three-layers.md` priced is unpaid on this side.

2. **One file is the product.** `packages/web/src/pages/Home.tsx` is 11,516
   lines, of which a single `useEffect` is ~5,000 — 43% of the file in one
   hook. Six modules have been extracted (`space/inspiration/`,
   `space/signal/`, `space/top-of-mind/`, `space-kinds/`, `canvas/`,
   `character/`), which is real progress and still leaves the body untouched.
   A file that cannot be held in one head is a file where every change is a
   guess.

3. **The instruments lie, and that cost a day.** On 2026-08-16 a bug — a
   wall reached by travelling had a fully solved ground of orbs that were
   never switched on — took a dozen measurements to locate, because the one
   diagnostic that existed (`SimApi.audit`) looped the whole ball list with
   no wall filter and reported an identical `present: 128` on every wall. It
   could answer *placed-ness* and not *drawn-ness*. Three CI gates were green
   throughout. The 374 API tests never open a database connection; the 58 web
   tests never render the canvas.

## Shape of the work

Seven phases. Phase 0 lands what exists, because 123 unmerged commits is the
largest single risk in the repo right now. Phases 1–2 buy the safety that
Phases 3–5 spend: the security findings and the verification net come before
any further structural moves, because the moves that remain are the ones that
cannot be checked by eye. Phase 6 closes the product gaps the backend already
supports and nothing on screen reaches.

The rule that governs every structural phase: **a move is a move.** If a
proposed extraction changes behaviour, it is not an extraction and it does
not belong in that phase. The component body (Phase 5) is explicitly a
redesign and is sequenced last, behind the net that can prove it.

## Budget

Phases 0–2 are the floor: without them the rest is unsafe. Phases 3–4 are
the goal's actual subject. Phase 5 is open-ended and may be split out into
its own goal once Phase 4 reveals its true shape — that decision is a gate,
not an assumption.

---

### Phase 0 — Land what exists

77 commits on `world/three-layers`, in five distinct efforts. Only the last
is this session's, and only that one is the noise the owner objected to:

| commits | what |
|---|---|
| 9 | merge commits from team PRs #210–#247 |
| ~11 | the world becomes the product; the archive is deleted |
| ~8 | a group's majority-approval loop |
| ~19 | codebase-shape docs, CSS layers, the first extractions |
| ~11 | field brightness, the web test suite, the migration journal fix |
| ~19 | **this session** — security fixes, six modules, the rename, the ground |

- **Squash only the last group.** The others have good messages and are
  someone's record of why a decision was taken; collapsing them buys nothing
  and costs the reasoning. The rapid-fire extraction commits were kept as a
  revert net during the split, that net is spent, and they collapse into:
  *API hardening*, *the group outlives its creator*, *six modules leave the
  page*, *the page speaks the canon*, *the ground is one person's*.
- **Rebase, do not merge-commit.** `origin/dev` is the exact merge base and
  the branch is 0 behind, so this fast-forwards.
- Open the PR. **The merge itself is the owner's call** — this is a team
  repo and the branch carries a product-level change (the archive's removal)
  well beyond this goal's subject.

**Gate:** PR open and green; the squashed section reads top to bottom without
this document beside it; nothing outside this session's ~19 commits rewritten.

### Phase 1 — The migration I broke, and the eleven others

Twelve high findings are open. One was introduced during this work and is
listed first because it is a regression, not a legacy finding.

- **Migration `0003`, self-inflicted.** Registering it in the journal means
  the trigger now bricks derivation for an active signal that drops below
  three evidence rows, on fresh databases. Either the trigger tolerates the
  transition or the migration is amended; a fresh-database test proves it.
- Session cookie ships without `Secure`, because `NODE_ENV` is never set in
  the deployed stages. Fix the stage config, not the cookie code.
- OAuth account pre-hijacking.
- `?join=` enrols silently — a link should propose membership, not confer it.
- Join code is never rotated when a member is removed, so removal does not
  remove access.
- Seven remaining, triaged in the log at execution.

**Gate:** each of the twelve is closed, or explicitly deferred in the log
with the reason and the conditions that would reopen it. No finding leaves
this phase unnamed.

### Phase 2 — A net that can fail

Nothing here is a refactor. This phase exists so Phases 3–5 can be checked
by something other than looking at the screen.

- **The audit becomes a first-class instrument.** It now reports `wallKind`,
  `wallId`, `ground`, an owner census and `drawn { active, rMin, rMax,
  aliveMax, arriveMin }`. Keep it, and add the invariant it was missing:
  `active === present === onScreen` for the wall you are standing on.
- **A canvas test that renders.** Headless canvas, real ball list, assert the
  audit's invariant after: first load, travel, ground switch, scrub, resize.
  The travel case is the exact bug from 2026-08-16 and must fail against the
  commit before its fix.
- **Interaction traces.** Record pointer/key sequences and assert the world
  state they produce, so the frame loop has a regression surface at all.
- **Pixel diff for the light model.** Brightness is the product's only
  meaning channel and currently has no test. Baseline images per wall kind.

**Gate:** the travel-activation bug reproduces as a failing test on the old
commit and passes on the new one. Without that demonstration this phase is
not done, because an untested net is the same hope it replaces.

### Phase 3 — One vocabulary, enforced

**The gate already exists and is already green.** `cfb312d` landed
`packages/web/scripts/check-vocabulary.mjs`, wired into `pnpm test`
(`package.json:11`) and into CI's *Web tests* step. It reads identifiers only,
blanks comments and strings, forbids `capture`/`pattern`/`room`/`wow`/`world`,
and today prints *"vocabulary: clean — every identifier speaks the canon."*

It prints that while `.jar-roomform` is worn by live markup, 33 `Wow` keys ship
in both message catalogs, and one map key reads `cached:` and matches nothing.
The gate is not lying; it is reporting its scope. Phase 3 is therefore not
"build a gate" — it is closing the three holes the gate has by construction:

1. **It walks `.ts`/`.tsx` under `src` only.** `.json` and `.css` are
   unwatched. That is where 33 stale i18n keys and 30 stale CSS names live.
2. **`codeOnly()` blanks every string literal.** Correct for prose, wrong for
   the two string classes that *are* identifiers: CSS class names and map keys.
3. **`words()` matches whole words**, so abbreviations pass. `cap`, `caps`,
   `insp` all run clean.

Everything below is anchored on an identifier and its enclosing symbol, never
a line number — see the last bullet of *What contradicts this plan*.

#### The rename list, in order

**A — not vocabulary, a bug the rename caused. Lands first, and alone.**

- **A1. The wall-provenance key never matched.** In the `wallProv` producer
  effect, `` m.set(`cached:${w.id}`, prov) `` → `m.set(spaceKey(w), prov)`.
  Use the function, not a hand-built literal, so this cannot drift again. The
  producer is guarded `if (w.kind !== "group") continue`, and both consumers
  read `wallProv.get(spaceKey(w))`, which is `` `${s.kind}:${s.id}` ``
  (`space-kinds/index.ts:43`) — so the only key that ever resolves is
  `group:<id>`. It was `room:` (a miss under the old vocabulary); a mechanical
  sweep rewrote it to `cached:` (a miss for a new reason, borrowed from the
  `const cached` on the line above). Every group wall shows the empty peek row
  the comment above it exists to prevent. The sibling loop `wallChromeNow`
  already calls `spaceKey(w)` correctly; this is the one that diverged.
- **A2. Revert a blind rename.** `const group = seam - hqH - gap * 2` →
  `const avail`. This was `const room` in the *English* sense: leftover
  vertical pixels between the headquarters block and the jar seam. A sweep
  renamed it to the canon noun for a database entity, so one token now carries
  three meanings in one file — connected components of clouds (`groups`), a
  canon group, and a pixel count. Its own surviving comments still say `room`,
  including a backticked `room > 0` that now names nothing. Second site:
  `if (charSize > group)`. `avail` is free in `Home.tsx`.

**B — file-local, collision-free, no companion change.**

- **B1. `caps` → `inspirations`** in the `grounds` memo
  (`groupFieldRef.current.get(atWall.id) ?? []`), 2 sites. Take the loop
  variable `c` with it; it is the same word's initial.
- **B2. `cap` → `inspiration`** at every binding that holds an inspiration
  row: the `makeAgentBall` map, the group-field ball map, the hue-assignment
  loop, and the `posterChain` agent branch. ~22 sites, 4 blocks. Two traps.
  **Not `insp`** — `insp` already names a 0–1 aliveness scalar in this file
  (`Resident.insp`, `inspNow`, `inspCol`, `inspTop`, `residentInsp`, 31 code
  sites); reusing it for an inspiration *object* is a clash even where the
  scopes do not overlap. **Not a file-wide `\bcap\b` replace** — `lib/words.ts`
  binds `const cap = (s) => …` as *capitalise*, and Home.tsx has three comment
  blocks where `cap` is the English word for a limit. Rename by block.
- **B3. `layout` → `geom`, `interface Layout` → `Geom`, `layoutH` → `geomH`**
  — *disambiguation, not vocabulary, and the one item here the gate would
  never fire on.* `layout` means three things in `Home.tsx`: the `OfflineHome`
  payload, the geometry record from `computeLayout`, and a
  `Record<string, {x, y}>` inside `persistSky()` that genuinely shadows the
  geometry record within the same effect. Harmless today — `persistSky` never
  reads geometry — but its own comment already talks about "layout
  coordinates" in the geometry sense inside the function where `layout` means
  positions. 48 dotted reads, 2 call sites; `geom`/`Geom`/`computeGeom`/
  `geomH` are free across `packages/web/src`; `computeLayout` and `layoutH`
  appear nowhere else in the repo. **Defer to Phase 4** if the sky extraction
  lands first — it is taking this effect apart anyway, and doing it twice is
  churn.

**C — coordinated. Two or more files, one commit.**

- **C1. The 33 `Wow` i18n keys — delete, do not rename.** `en-US.json` and
  `ko-KR.json`, 33 keys each, identical key sets, 290 lines each. Zero
  references in any `.ts`/`.tsx`/`.css`; `t()` is only ever called with string
  literals; `translationKeys` is exported and unused. Their one consumer,
  `pages/AdminWowStatus.tsx`, no longer exists. The values were already
  migrated ("Note status", "What hit"), so the catalog says one word out loud
  and another in code — but renaming dead keys manufactures 33 canon-named
  messages no screen reads. **Companion: both catalogs in the same commit** —
  `ExactCatalog<T>` (`lib/i18n/index.ts:50-52`) types a key present in one and
  missing from the other as `never`, and `test/i18n.test.ts:22` asserts key-set
  equality. Trap if anyone renames instead: `developmentWowStatus` →
  `developmentStatus` collides with the live `developmentStatus` on line 13 of
  both files, duplicate JSON keys collapse last-wins *identically in both
  files*, and both the type and the test stay green while a message vanishes.
- **C2. `.jar-roomform*` → `.jar-groupform*`.** `home.css` (8 declarations) and
  `Home.tsx` (8 `className` sites) **in one commit.** It is literally the
  create/join-a-group form: gated on `groupForm`, driven by `setGroupForm`,
  submitted by `submitGroup()`. The on-screen strings beside it ("Make a
  group", "Join with a link") are untouched. **Scope correction:**
  `.jar-roomform-box` is *not* group-specific — it is a bare-input style also
  worn by the agent-name field, the search field and the group-rename form.
  Renaming it to `jar-groupform-box` clears the old word and puts a group name
  on the search box. Lift it to a neutral `.jar-bareinput` in the same pass and
  move only the wrapper, `-tabs` and `-err` to `groupform`. The precedent for
  the same-commit rule is in this stylesheet already: a v8→v10 rename moved
  markup to `.jar-wallcol` while the selector stayed `.jar-roomcol`, every
  column computed `position: static`, and all five walls stacked at x=0. That
  comment is prose and stays.
- **C3. Delete the dead CSS.** 30 distinct old-vocabulary names across
  `styles/`; exactly two are reachable from TSX (C2 and C4). The rest —
  `.jar-room-empty`, `.jar-room-hold`, `.jar-roomcol`, the `.nc-room-*` and
  `.nc-rail-room*` family, `.capture*`, `.reference-capture-*`,
  `.top-home-capture`, `.inspiration-first-capture` — have no markup. A
  renamed dead selector is a canon-named rule nothing wears; delete instead.
  Establish reachability with the same grep, not by eye.
- **C4. `.profile-room` is a decision, not a rename.** Live in `Profile.tsx`
  on the *access* tab panel, and load-bearing: `.profile-room[hidden]
  { display: none }` in both `global.css` and `chrome.css` is what hides that
  panel. But the CSS treats it as a list row, beside `.profile-memory-row` and
  `.profile-connection-row` — it was "a row per room you belong to" and it is
  now stuck on a tabpanel. `.profile-group` would repeat the `--voice-room`
  error: a canon entity name on something that is not that entity. Name it for
  what it is (`.profile-access-panel`) or split the two rules that are doing
  different jobs. Owner's call; do not sweep it.

#### The allowlist the gate needs

`ALLOWED` is where a gate goes to die, and the script says so itself. One rule:
**an entry is admitted only if renaming it would break a correspondence with
something outside our control — the server, the DOM, or the English language.**
"It's a lot of work" is not an entry. "It's dead anyway" is not an entry
either; dead code is deleted, not allowlisted.

Nine entries exist and all nine still earn their place:

| entry | why it cannot be renamed |
|---|---|
| `capturedAt` | the server sends this name; our mirror must match it |
| `capturedMs` | the parsed ms form of `capturedAt`. One entry covers ~35 sites across `Home.tsx`, `space/inspiration/orb.ts` + `field.ts`, `space-kinds/group.ts`, `lib/data.ts`, `lib/fixture.ts` |
| `captureRef` | React's pointer-capture handle, not ours to name |
| `setPointerCapture`, `releasePointerCapture`, `hasPointerCapture` | DOM methods |
| `CanvasPattern`, `createPattern` | DOM type and method on the 2D context |
| `PUBLIC_HANDLE_PATTERN` | `pattern` as in regular expression, no relation to the layer |

One correction to a reason line: the `capturedMs` entry currently claims a
server field name. The server column is `createdAt`; `lib/data.ts` deliberately
maps `capturedMs: ms(row.createdAt)`. It mirrors the canon's *concept* of
capture time, not a wire field. Still worth keeping — say the true reason.

Add exactly three, and only as their scope becomes visible:

- **`--voice-room`** (`system.css`) — needed only once the gate reads CSS. It
  is a WORLD word, not an entity: the family is `--voice-room` /
  `--voice-you` / `--voice-machine`, an axis of *who speaks* — the ambient
  place, you, the system. Its two live consumers are `.login-title` and
  `.nc-title`. A login screen has no group; `--voice-group` would be a false
  claim, not a fix.
- **the wire value `"pattern"`** — `ApiTopOfMindEntryType` in `lib/api.ts` and
  `type: "pattern" as const` in `lib/fixture.ts`. It mirrors the Postgres enum
  at `packages/api/src/db/schema-top-of-mind.ts:102`, which lists `pattern`
  verbatim. Invisible to the gate today because it is a string, and it must
  stay invisible if the gate ever reads strings. The entry must state the
  order: **DB migration first, client second.** Changing the client alone
  silently stops matching server payloads, with no type error.
- **`"pattern is" / "patterns are" forming`** — on-screen copy in
  `space/top-of-mind/board.ts`, rendered on every wall through `formingWords`
  (`space-kinds/group.ts:190`, `agent.ts:54`, two `Home.tsx` sites). This is
  the one place the two rules point in opposite directions: human words on
  screen are protected, but the product sanctions only *room* as a warm
  synonym, and `pattern` names a concept the canon **removed** — there is
  nothing behind the word. **This is the owner's ruling and Phase 3 does not
  make it.** One ruling fixes all four call sites. If the copy changes it is
  copy work, not a rename.

Refused admission:

- **`jar`, `JarNote`, `.jar-*`** — not old vocabulary. It is a live token
  namespace (`docs/codebase.md:112`, queried by `test/helpers/render-home.tsx`),
  so it never goes on `FORBIDDEN` and needs no hole. The separate proposal to
  collapse `export type JarNote = Entry` is wrong on its own terms:
  `board.ts` already imports `Entry` from `lib/data` (the alias would be
  self-referential) and `Home.tsx` already imports both — it is a duplicate
  identifier in two files, and a five-site refactor, not a rename.
- **Abbreviations, as a class.** Putting `cap`/`caps`/`insp` on `FORBIDDEN`
  produces 9 violating identifiers, of which 6 are correct — the whole `insp`
  aliveness family and `lib/words.ts`'s capitalise helper. Six permanent holes
  to catch two one-time renames is a gate paying rent forever. Do B1 and B2 by
  hand; leave `words()` whole-word.

**Gate:** a deliberately reintroduced `roomPanel` fails the build **three
ways — as a `.tsx` identifier, as a `.css` selector, and as an i18n key**;
`pnpm --filter @waka/web test` and `build` green; and `ALLOWED` has grown by at
most the three entries above, each naming what would break.

Two bullets from the earlier draft survive unchanged:

- **`field`, `sky`, `headquarters` survive as places, not layers.** They name
  where a layer is *drawn*. Document that distinction where the gate points —
  and next to it, the gate's scope, so the next reader does not read green as
  done.
- **The fixture stops being a product dependency.** `space-kinds/agent.ts:10`
  imports `AgentBundle` from `lib/fixture` — a dev fixture supplying a product
  type. When `GET /api/agents` lands, that import moves to `lib/api` and
  nothing else changes; until then the direction is named in the file (lines
  6-9) so it is a known loan rather than an accident.

#### What contradicts this plan

- **The frame's own noun is already renamed. Delete that bullet.** The earlier
  draft listed `WorldExperience`, `World`, `computeWorld`, `OfflineWorld` as
  outstanding. All four are gone — zero occurrences in `packages/web/src`.
  `interface World` is `interface Layout`, `computeWorld` is `computeLayout`,
  `worldH` is `layoutH`, `ProtectedWorld` is `ProtectedHome`. `world` is
  already on `FORBIDDEN` and the gate passes. The only surviving "world"
  strings are deliberate historical prose in `lib/data.ts:12-24` and
  `main.tsx` comments, which stay. Four separate agents in the sweep proposed
  renames against that stale line and one of them would have silently
  retitled `Layout` if applied positionally. A stale backlog line is not
  free — it costs a review pass every time.
- **A green gate is not a clean package**, and this is the strongest argument
  in the phase. Three CI gates were green over `.jar-roomform`, 33 dead `Wow`
  keys, and a map key that resolves for nobody. That is the same failure mode
  Phase 2 exists for, in a different instrument.
- **The rename left a real bug in shipped code.** `` `cached:${w.id}` `` is a
  text substitution that rewrote a string literal along with the local
  variable beside it. It is the case *for* the gate reading map keys and
  *against* ever running a vocabulary pass as a find-and-replace. Add the group
  wall's peek row to Phase 2's canvas assertions.
- **`room` in CSS is 30 names, and 28 of them are dead.** The vocabulary
  problem in `styles/` is mostly a dead-code problem. Deleting is cheaper,
  and more honest, than renaming rules nothing wears.
- **`Home.tsx` line numbers are unstable, and this invalidated part of the
  sweep.** During this analysis the file went 11,590 → 11,005 lines: Phase 4's
  `canvas/` pass two is in flight in the same working tree (`canvas/palette.ts`
  and `character/raster.ts` untracked, `canvas/sprites.ts` modified). Findings
  carrying line numbers were off by 500+ within the hour. **Phase 3 and
  Phase 4 do not run concurrently on `Home.tsx`**, and the working tree is
  committed or stashed before Phase 3 starts.

### Phase 4 — The rest of the map

Pure moves, in dependency order. Each lands with the audit invariant green.

- **`canvas/` pass two** (~350 lines). `buildPalette` calls
  `rasterBody(…, OWNER_BEING)`, which reads as a cycle. It is not: place the
  body rasterisers in `character/raster.ts` and `buildPalette` in
  `canvas/palette.ts`, and the dependency runs `canvas/palette` →
  `character/raster` → `canvas/sprites` → `lib/*` with no cycle and no
  signature change.
- **~~`space/signal/sky.ts` — the engine (~950 lines)~~. CORRECTED 2026-08-16:
  this is not separable, and the earlier measurement that said it was had
  been taken over a narrower line range than the engine occupies.** Measured
  again over its true extent (L3500-4452): it reaches for 18 outer things
  (camX, camY, col, cursor, dragging, draw, layout, list, nowMs, onUp, place,
  reduced, release, root, settle, tap, wake, box) and 23 of its own are read
  by the rest, ten of them functions. A handle exposing 13 fields and 10
  methods while taking 18 inputs is not a module, it is the same code with a
  wall drawn through it. Two of the 23 — `provenance` and `heldBall` — are
  not sky state at all; they are declared in that region and belong to the
  wall and the field respectively, which is part of why the region looked
  more coherent than it is.

- **`space/signal/geometry.ts` — what survives that correction** (~270 lines).
  The pure half: `orbFitX`, `orbFitY`, `measureNeb`, `solveSats` and `makeSat`
  reach for nothing outside themselves; `clampHome` needs the layout and
  `makeNeb` needs the column and the drag flag, all three passable as
  arguments. These take values and return values, which is the only test that
  matters.
- **The five panels** (1,762 lines of JSX): ready-phase field (464),
  inspiration detail (278), sky (215), settings (188), group panel (131).
  Mechanical but wide — each closes over dozens of state variables and needs
  a prop object. They are the most conventional React work in the goal and
  the most tedious; they are also what makes the file navigable by feature.

**Gate:** `Home.tsx` under 6,000 lines. Every module has a header that says
its one reason to exist, in the style the six existing ones already use.

### Phase 5 — The body

~5,000 lines in one `useEffect`: ~98 loose mutable variables, `draw` (534),
`tick` (471), the pointer and key handlers (~640).

This is **not** a move and must not be attempted as one. It is a redesign of
how per-frame state is owned, and the earlier extraction map flagged its own
proposals here as behaviour-changing. It runs only behind Phase 2's net.

**Gate (entry):** Phase 2 complete and the net has caught at least one real
regression in Phases 3–4. If it has not, the net is not trusted yet and this
phase does not start.

**Gate (exit):** to be written at entry, from what Phase 4 reveals. Splitting
this into its own goal is an acceptable and expected outcome.

### Phase 6 — What the backend has and the screen does not

Re-run the backend-gap audit first: workflow `w0hbpqqm0` stalled on
2026-08-16 and never produced output, so this list is known-incomplete.

Confirmed so far:

- **No way to share an inspiration into a group.** Sharing a signal is a
  per-group act; publishing an inspiration is global. That asymmetry is why a
  group can show five signals over an empty ground — a correct state that
  reads as a bug, every time, to the person looking at it.
- "Read again" is gated behind the board it produces.
- Group synthesis is a server stub.
- Only 1 of 7 top-of-mind entries renders.
- No surface for signals that are not `emerging`.
- **Field brightness, unresolved.** After the arrival fix the orbs are active
  and placed, but lit-pixel count barely separates a 9-orb ground from a
  3-orb one. Consistent with honest decay on two-week-old memories; not
  proven. Phase 2's pixel baselines settle it either way.
- **`atWall` regression.** The tab-return refresh moves `atWall`, so
  returning to the tab can change which wall you are standing on.

**Gate:** the audit has run to completion and every gap is either built or
recorded here with a reason.

## Out of scope

- The `packages/admin` surface.
- Any change to the canon's nouns. This goal carries them; it does not vote.
- Visual redesign. Where this goal touches the screen it is to close a gap
  the backend already supports, not to restyle what is there.
- The Route-FSD experiment in `~/Downloads` — unrelated project, unrelated
  `route.yaml`.

## Log

_(appended per phase at execution)_

### Pre-goal — what already landed (2026-08-16)

Recorded here because it is the starting state, not a phase.

- Six modules out of the page: `lib/num.ts`, `lib/appearance.ts`,
  `lib/words.ts`, `lib/fixture.ts`, `lib/data.ts`, `space-kinds/index.ts`,
  `canvas/sprites.ts`, `space/inspiration/orb.ts` + `field.ts`,
  `space/top-of-mind/board.ts` + `poster.tsx`, `character/body.ts`,
  `space/signal/sky.ts`, `space-kinds/group.ts` + `agent.ts`.
  `Home.tsx` 13,516 → 11,516.
- All three canon layers now have a directory. `space/signal/` did not exist
  before 2026-08-16 — it was the only layer with no home in the code.
- Identifier rename complete: zero old-vocabulary identifiers remain in
  `Home.tsx`. The compiler found every crossing into the extracted modules on
  its own and refused to build until each was carried through.
- The group ground is one person's, switched from the corner the hue legend
  occupied, because a group's ground is structurally incapable of explaining
  its sky (`loadGroupField` stops at shares, by canon).
- Fixed: a wall reached by travelling never activated its orbs —
  `arriveColumn` re-ran the layout but nothing set `active`. Measured 0 of 9
  before, 9 of 9 after.
- Fixed: the field audit's missing wall filter.

### Phase 0 — landed (2026-08-16)

Branch `goal/frontend-you-can-read`, PR waka#248 against `dev`.

- This session's 21 commits squashed to 7 chronological milestones. The
  other 57 left untouched: their messages are someone's record of why a
  decision was taken, and collapsing them would cost the reasoning while
  buying nothing. Only the rapid-fire extraction commits were the complaint.
- Squash verified by tree comparison, not by reading: `git diff
  backup/pre-squash-2026-08-16 HEAD` is empty, so the seven commits produce a
  byte-identical result to the twenty-one. Backup branch kept.
- `origin/dev` confirmed as the exact merge base and 0 behind — fast-forward.
- Green: web typecheck, 58/58 web tests, web build, 384/384 API unit tests.
- **The full API suite refused to run**, and correctly: it will not perform
  test-only schema DDL against a database that is not clearly disposable, and
  `DB_CONNECTION_URL` here is the shared instance. That guard is `b70e233`
  working as designed. It also restates Phase 2's premise — the coverage that
  would exercise a real database is exactly the coverage nobody runs locally.

**Gate met**, with one deliberate exception: the merge is left to the owner.
The branch carries `e19cfd2` — the archive's removal — a product-level change
outside this goal's subject, on a team repo. Opening the PR is this goal's
job; deciding that change ships is not.
