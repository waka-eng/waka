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

The rename happened; the enforcement did not.

- **A lint gate on the old vocabulary.** `capture`, `pattern`, `room`, `wow`
  as identifiers fail the build in `packages/web/src`. Prose in comments is
  allowed and human words on screen are required — the check is scoped to
  identifiers, which is precisely the third-vocabulary rule in
  `docs/architecture.md` made mechanical.
- **The frame's own noun.** `WorldExperience`, `World`, `computeWorld`,
  `OfflineWorld` still carry "world", the noun the owner rejected in favour
  of Home. Rename, and add them to the gate.
- **`field`, `sky`, `headquarters` survive as places, not layers.** They name
  where a layer is *drawn*. Document that distinction where the gate points,
  so the next reader does not "fix" them into canon words.
- **The fixture stops being a product dependency.** `space-kinds/agent.ts`
  imports `AgentBundle` from `lib/fixture` — a dev fixture supplying a
  product type. When `GET /api/agents` lands, that import moves to `lib/api`
  and nothing else changes; until then the direction is named in the file so
  it is a known loan rather than an accident.

**Gate:** the gate fails on a deliberately reintroduced `roomPanel`, and the
web package builds clean.

### Phase 4 — The rest of the map

Pure moves, in dependency order. Each lands with the audit invariant green.

- **`canvas/` pass two** (~350 lines). `buildPalette` calls
  `rasterBody(…, OWNER_BEING)`, which reads as a cycle. It is not: place the
  body rasterisers in `character/raster.ts` and `buildPalette` in
  `canvas/palette.ts`, and the dependency runs `canvas/palette` →
  `character/raster` → `canvas/sprites` → `lib/*` with no cycle and no
  signature change.
- **`space/signal/sky.ts` — the engine** (~950 lines, currently inside the
  giant effect). Measured separable: 13 mutable variables of its own against
  the engine's 98, reaching only 11 outward, of which 8 are read-only
  viewport facts. It becomes `createSky({ view })` returning a handle. This
  is the largest single block in the effect with its own state boundary, and
  it is exactly layer 2.
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
