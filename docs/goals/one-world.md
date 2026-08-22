# Goal: one world, and no screens beside it

Status: **draft v2 (2026-08-22).** Phase 0 landed. Base `dev` @ `c6a64b2`.
Source: `docs/craft/e2e-experience-audit.md` — thirteen findings, driven
against a real stack on 2026-08-22. Every phase below closes findings by
number, and no finding leaves this goal unnamed.

**v2 changes the destination, not the findings.** v1 planned to reconcile two
palettes and stop a menu overlapping a headline. The founder's direction is
larger and simpler: **the flat screens are deprecated, and what they do moves
into the world.** That dissolves finding 4 (two palettes — there is only one
surface left to have a palette) and finding 6 (the menu — it has nothing left
to point at), and it turns finding 9 from a late phase into the thing the rest
depends on. See "What this direction costs" below, which is the only part of
this document arguing with the instruction, and does so once.

~~Relates to `docs/goals/a-frontend-you-can-read.md`, unmerged on
`world/three-layers`… a hard dependency.~~ **Withdrawn 2026-08-22 — measured,
and the opposite is true.** `origin/world/three-layers` is a stale snapshot
from 2026-08-16; `dev` is four days newer and strictly ahead on every axis
this goal cares about. The extraction and the canvas test net that goal
proposed **already exist on `dev`**, having landed by another route. Nothing
blocks on that branch, and it should be closed. See the log for the numbers.

Canon unchanged. `docs/data-model.md` for the nouns, `docs/architecture.md`
for the laws and the three registers. **One canon amendment is required and is
named in Phase 4**: `docs/architecture.md` currently says `/profile` and
`/login` are "deliberately NOT the world" and "should stay flat". This goal
keeps one of those two and retires the claim for the rest, so the document
changes in its own diff, first, with the reason.

## Why

1. **The product currently lies about its own state.** A signed-in person
   could land on `/` and get a black rectangle (finding 1, **fixed**). A
   person can declare a principle in their own words and have it filed as a
   note, with a `201` and no signal of any kind, because a model call failed
   and the catch treats an outage as a verdict (finding 3). A person can keep
   something — the one act the product exists for — and get a word so quiet
   they may not see it (finding 7). One family: **the failure is
   indistinguishable from the success.**

2. **It is not one thing.** Measured: the world, `/login` and `/profile` at
   roughly `rgb(10,12,15)`; the six Surface routes at roughly
   `rgb(251,251,250)`. A hamburger holding six addresses navigates a place you
   are supposed to walk, and opens on top of the one sentence that place
   exists to show. Both are symptoms of the same thing — a world was built,
   and the screens it replaced were kept.

3. **The gate that should have caught the worst of it did not exist.** The
   blank world reproduced in a production build in under ten seconds, and
   nothing ran a production build. `tools/seed-demo.ts` — the README's own way
   in — was broken by migration `0007` and stayed broken because nothing
   covers it. Same gap: the checks read source, and what users get is a build.

## What this direction costs, said once

Three things do not follow the rest into the world, and pretending otherwise
would be the expensive kind of agreement.

**The doorway cannot be inside the house.** `/login` is reached by someone who
has no memory to stand in yet. The world *is* your inspirations, your signals,
your sentence; before authentication there is nothing to render and nobody to
render it for. So `/login` is not a flat screen to deprecate — it is the door,
and Phase 5 makes it a good one rather than a leftover.

**Some confirmations have to be plain.** `docs/architecture.md` gives the
reason and it is not aesthetic: "text that reflows at 200%, focus traps, plain
confirmations — things in-world UI cannot give". Account deletion is the sharp
case. A person ending their account should not have to aim at a canvas.

**And the load-bearing one: the flat screens are currently the only surface a
screen reader can use.** The world is one `<canvas>` with `role: null`,
`aria-label: null`, no fallback content, one `nav` landmark, no `main`, and
zero `aria-live` regions (finding 9). Everything it means — every memory in
the field, its aliveness, every statement forming in the sky, whose wall you
stand on — is painted pixels with no text equivalent. Today someone using
assistive technology reads their archive at `/inspirations`. **Deprecating the
flat screens before the world can be read aloud does not degrade that path; it
deletes it.**

That is why finding 9 is Phase 2 here and was Phase 5 in v1. It is not a
polish item at the end of this goal. It is the licence to do the rest of it.

## Shape of the work

Phase 0 (**done**) stopped the outage and made chunk failure visible at all.
Phase 1 removes the rest of the silent-failure class; it is independent of
everything else and can run in parallel. **Phase 2 is the gate on the whole
migration** — the world gets a text equivalent before it becomes the only
surface. Phase 3 brings the layers home, one destination at a time, each
landing only when its world affordance is verified. Phase 4 deletes the menu
and the routes, which by then is subtraction rather than design. Phase 5 makes
the doorway good. Phase 6 closes the gates.

**The rule that governs every phase: a fix must be provable by something other
than looking at the screen.** Every gate below is falsifiable, and where a
phase fixes an observed defect the test demonstrates the defect first — the
standard Phase 0 was held to and met.

**The rule that governs Phase 3 specifically: nothing is deleted until its
replacement is verified affordance by affordance.** This is not caution for
its own sake. It is the exact method `docs/architecture.md` records for
removing the archive — "the layout does everything it did, verified affordance
by affordance rather than by call site" — and that removal is the precedent
this whole goal is built on.

---

### Phase 0 — A failure you can see ✅ done

Closed finding 1. See the log.

### Phase 1 — Nothing fails silently

Closes findings 3 and 7. Independent; can run alongside anything.

- **An outage is not a verdict.**
  `packages/api/src/routes/principles.ts:260-265` catches every provider
  failure into `{ route: "inspiration" }`, so a missing key, a rate limit and
  a considered rejection produce the same row and the same `201`. Separate
  them. The rule that **no refusal is ever shown** is not in question and does
  not change — "we could not consider this yet" is a different sentence from a
  refusal, and it is currently not sayable. The declaration should be
  retryable rather than quietly rewritten into a note nobody asked for.
- **The core act should look like it happened.** Keeping something returns
  `201` and prints "kept" in small low-contrast type, with no motion. Whatever
  replaces it obeys the laws: motion explains rather than decorates, and the
  world does not move unless the user moved it — keeping *is* the user moving
  it, so the field has grounds to answer.
- **Announce outcomes.** Zero `aria-live` regions exist. Every outcome here
  needs one, or the fix lands for sighted users only. This is also the first
  brick of Phase 2.

**Gate:** no code path converts a provider failure into a product verdict,
enforced by a test that stubs the provider to throw and asserts the response
is distinguishable from a routing decision. A capture, driven headlessly,
produces an assertion-visible confirmation in the accessibility tree.

### Phase 2 — The world can be read aloud

Closes finding 9. **Blocks Phase 3.** Depends on
`a-frontend-you-can-read.md` Phase 2 for a canvas that renders in a test.

This is the largest and least certain phase, and the direction has made it
mandatory rather than optional. The founder law bites hardest exactly here:
**light is the only meaning channel**, and a screen reader has no light. So
the work is not "label the canvas". It is deciding what the world's meaning
*is* in a channel with no brightness — and that is design, not remediation.

The three layers each need an answer:

- **The field.** Aliveness is currently luminance. Spoken, it is recency and
  nothing else is available; "kept three weeks ago, not returned to" says what
  a dim orb says.
- **The sky.** A signal's state — emerging, active, unsupported — is already
  a word in the canon. This is the layer that translates most cleanly.
- **Where you stand.** The top of mind is already an `h1`. It is the one part
  that works today.

**Gate (revised 2026-08-22 — no screen-reader user is available):** the three
layers are reachable and comprehensible without the canvas, established three
ways, all of which must hold:

1. **A written walkthrough**, reviewed by the founder — what a person hears,
   in order, arriving at each layer.
2. **Automated assertions**: every interactive element has an accessible name;
   every outcome in Phase 1 announces through a live region; a full keyboard
   traversal reaches all three layers and returns.
3. **No canvas-only meaning**: a test asserts that the field's aliveness, the
   sky's state and the wall you stand on are each readable from the
   accessibility tree, not only from pixels.

This is **weaker than a real user and is recorded as weaker.** Automated
checks prove an element has a name; they cannot prove the name means anything
to somebody. Whoever gets access to a screen-reader user first should run the
walkthrough past them and log the result here — that is the confirmation this
gate is standing in for, not a formality it replaced.

If the walkthrough cannot be written, the phase halts rather than shipping
labels that describe nothing. Because Phase 3 is blocked on this, halting here
halts the migration — the correct outcome, not a setback.

### Phase 3 — Bring the layers home

Closes findings 6 and 11, and is the body of the direction. **Blocked on
Phase 2.**

Six destinations. Four look like duplicates of affordances the world already
has — verify each before deleting anything:

| Route | What the world appears to already have |
|---|---|
| `/capture` | `KEEP SOMETHING` |
| `/top-of-mind` | the headline you stand in, with `READ IT AGAIN` / `SAY IT IN MY WORDS` / `NOT THIS` |
| `/signals` | `TWO PATTERNS ARE FORMING`, above the wall |
| `/inspirations` | the field itself — one orb per memory |

Two are genuinely homeless and are the real design work:

- **`/rooms`.** The world has `MAKE A ROOM` but no way to walk into one. Rooms
  are walls, and the world already draws an axis of walls along the bottom
  edge — `‹ DEMO AGENT` / `ME ›`. A room is a wall a few of you keep, so the
  axis is where it belongs. Less new design than it sounds.
- **`/principles`.** Layer 4, and the honest blocker. The world draws three
  layers; the canon has four, and the third is where you stand. There is
  nowhere to put the fourth without deciding what it *is* spatially. If it
  cannot be answered, **this is the one route that keeps a flat screen** — and
  it keeps it as a named link, not as a menu.

Two things travel with the layers rather than after them: the list surfaces
are where a person **searches** and **edits text**, and neither has an obvious
in-world form. `/inspirations` has a seek line and inline editing. Whatever
replaces the field's list must do both, or the field is a prettier archive
that lost the two things people used the archive for. **Finding 11** rides
here too: `/signals` prints a raw `43%` with no legend; in the world, a
percentage is a numeral where the law says a state should render, so it either
becomes a state or it stops being shown.

**Gate:** for each of the six, a written walkthrough naming the world
affordance that replaces it, verified in a browser. A route is deleted in the
same commit that proves its replacement — never before, never in a batch.

### Phase 4 — The menu goes away, and the routes with it

Closes findings 4 and 6. Mostly subtraction by this point.

`≡`, `jar-flatmenu`, and `aria-label="Other screens"` leave
`packages/web/src`. The code already asks for this: the comment above the
control (`Home.tsx:9648-9660`) calls it "the placeholder that keeps it usable
meanwhile" and says "DELETE THIS when `/principles` has a home in the world.
That is the real fix."

The palette question dies here without being answered, which is the neatest
thing about this direction: with the Surface routes gone there is one surface,
and it is the world's. What remains is to delete `surface.css`, fold what
`chrome.css` still needs for the doorway, and **correct
`docs/architecture.md`** — its "Screens that are deliberately NOT the world"
section describes an arrangement that will no longer exist.

The routes stay addressable as long as anything links them; a bookmark to
`/inspirations` should land in the field rather than 404.

**Gate:** one stylesheet system, one palette, asserted by a test that walks
every remaining route and finds a single token set. `architecture.md` and the
build agree.

### Phase 4b — The hand

Closes finding 8. Independent of the migration's outcome, and the targets move
with the surfaces, so it lands after them.

**Destructive controls are 20×20px on touch, adjacent to non-destructive ones
at 21×21px, with no separation** — 21–22 controls per surface under 44px. The
undo (`Surface.tsx:2243`) and the `window.confirm` guards
(`Surface.tsx:333,501`) make this ergonomics rather than data loss — "fading
never deletes" is honoured — but a mis-tap that undo has to catch is still a
mis-tap.

**Gate:** no interactive control under 44px in either axis at 390px, asserted
by a test that walks the routes.

### Phase 5 — The doorway

Closes findings 5 and 10. Independent of the migration.

The one screen that stays flat, made good rather than left over.

- **There is no password recovery — and it is deferred by decision
  (2026-08-22), not by oversight.** Building it needs a mail transport, and
  there is none in the repo: no SES, no nodemailer, no Resend, nothing. That
  is a provider choice with credentials attached, so it waits for one.
  Meanwhile the honest half shipped: the lockout response used to end "or
  reset your password", sending the one person guaranteed to read it —
  someone locked out and anxious — looking for a door that does not exist.
  That clause is gone. **This remains the only finding in this document that
  locks a real person out of their own memory, and deferring it does not make
  it smaller.** When a provider is chosen, this is the first thing built.
- **The submit button is a footnote** — 40×16px, lowercase, bottom-left,
  ranked below the two tabs that navigate away from the form
  (`chrome.css:1019-1025`).
- **One noun.** The eyebrow says "WAKA · Signals"
  (`i18n/messages/en-US.json:191`) above a title saying "Inspirations" and a
  line saying "your inspirations". `docs/architecture.md` is explicit that
  user-facing text says *inspiration*; the first screen anyone sees uses a
  canon layer name as branding.
- The duplicate "New to WAKA? Create account." beneath a left-aligned form
  goes with it.

**Gate:** a password can be reset end to end against a running stack, driven,
not described. Sign-in's submit is the highest-weight control in the form. No
screen shows two product nouns for one thing.

### Phase 6 — The gates that would have caught this

Closes findings 2 (**done**) and 12. Independent.

- **`pnpm e2e:first-paint` runs in CI**, not just on demand. It exists and it
  fails correctly (see log); what remains is wiring.
- **`tools/seed-demo.ts` is covered by no suite**, which is why `0007` broke
  the README's own way in and nothing failed. It is the first thing a new
  contributor runs.
- **The fixture data decision.** `personal-data-needs-a-volume-knob` is
  declared `active` on two evidence rows against a bar of three. It seeds
  `emerging` with a warning naming it. Either give it a third evidence row or
  declare it emerging — a data call, not a code one, and still open.

**Gate:** the production-build smoke gate runs in CI and fails on `c6a64b2`.
`pnpm demo:seed` is exercised against a freshly migrated database.

---

## Out of scope

Named so their absence is not mistaken for a judgment that they are fine.

- **The rooms journey.** No seeded room has a second member, so the sharing
  boundary — what crosses and what must not — was read in the audit, not
  driven. It is the highest-stakes surface for privacy and deserves its own
  audit against a two-account stack before Phase 3 designs its home.
- **The consent page's missing decline control** (finding 13). Real, minor,
  resolves on its own via the client's timeout. Belongs to whoever next opens
  `auth-cli.ts`.
- **Everything downstream of a model call.** Derivation, synthesis, minting,
  enrichment — never exercised, no `GEMINI_API_KEY`. Finding 3 is about the
  *failure* path, which is reachable without a key.
- **Google OAuth.** Not configured, never pressed, no findings.
- **Restructuring `packages/web`.** That is `a-frontend-you-can-read.md`,
  which this goal now depends on rather than merely neighbours.

## Rules

1. **A fix ships with the thing that proves it.** A phase whose gate is "it
   looks right now" is not done.
2. **A gate that cannot fail on the old commit is not a gate.** Where a phase
   fixes an observed defect, the test demonstrates the defect first.
3. **Nothing is deleted before its replacement is verified.** Per route, in
   the commit that proves it — never in a batch at the end.
4. **The canon does not lose an argument to the code.** Phase 4's amendment to
   `docs/architecture.md` lands in its own diff, first, with the reason.
5. **No phase widens.** Phase 5 fixes the doorway; it does not redesign
   sign-up. Work discovered outside a phase's findings is logged here, not
   absorbed.
6. **Phase 2 is a stop, not a speed bump.** If the world cannot be described
   without its light, the migration does not proceed on the grounds that it is
   mostly fine.

## Log

### 2026-08-22 — audit, and finding 2 closed

`docs/craft/e2e-experience-audit.md` written against a full local stack.
Thirteen findings. Finding 2 fixed in the same commit (`4fc3c61`):
`tools/seed-demo.ts` now inserts signals `emerging`, inserts their evidence,
then promotes — the order derivation uses and the order `0007`'s own comment
says the product always follows. That exposed finding 12, which is a data
decision and is logged unmade.

### 2026-08-22 — Phase 0 landed

`SurfaceBoundary` + `preload-recovery` shipped. The gate is
`pnpm e2e:first-paint`, and it was demonstrated both ways before it was
believed: on the unfixed build both steps FAIL (`rootChildren=0 canvases=0
text=0`), on the fixed build both PASS. That demonstration is the point — a
gate that has never failed is a gate nobody has checked.

Two things done rather than one, because fonts were the trigger and not the
bug. The boundary answers *any* rejected lazy chunk, including the likelier
production cause: a visitor on a stale `index.html` asking for a hashed chunk
that no longer exists. `preload-recovery` cancels the stylesheet case only —
deliberately narrow, since blanket-cancelling would resolve a genuinely
missing module to `undefined` and move the failure somewhere that names
nothing.

**Still open from Phase 0:** self-hosting the Latin faces. The blank screen is
fixed and the third-party dependency is not — six families still load from two
hosts on first paint, so a blocked CDN now costs typography instead of the
whole product. That is a large improvement and not the finish line.

### 2026-08-22 — direction changed: the flat screens are deprecated

The founder's call: migrate what the flat screens do into the world rather
than reconcile two palettes. v2 rewrites the goal around it.

What it settles for free: finding 4 (two palettes) and finding 6 (the menu)
both stop being design problems and become consequences — with the Surface
routes gone there is one surface, and the menu has nothing left to point at.
The palette question raised in v1 is withdrawn unanswered, which is the right
outcome rather than a dodged one.

What it costs, and this is the part that changed the phase order: **the flat
screens are currently the only surface a screen reader can use.** The world is
one unlabelled canvas with no fallback content and no live regions. Migrating
before that is fixed would not degrade the accessible path, it would delete
it. So finding 9 moved from Phase 5 to Phase 2 and now blocks the migration
outright, and Rule 6 exists to stop that block being negotiated away later.

Three things stay flat and are named rather than quietly kept: the doorway
(`/login` — there is no memory to stand in before authentication), plain
confirmations for account deletion, and `/principles` **if** Phase 3 cannot
find layer 4 a home in a world that draws three.

### 2026-08-22 — affordance verification attempted, inconclusive

The Phase 3 table ("what the world appears to already have") is still
*appears*. A probe drove the world and tried to click each candidate by
`button[aria-label="…"]`; every lookup missed, because those controls carry
their labels as text content rather than as `aria-label` — the enumeration
that produced the table read `aria-label || innerText` and the probe read only
the first. Field clicks at three canvas positions changed nothing observable,
which is evidence of nothing: the orbs' hit targets were not located.

Logged rather than quietly redone because the table is load-bearing for
Phase 3 and must not be mistaken for verified. It is a hypothesis with a
plausible shape. Phase 3's gate — a walkthrough per route, confirmed in a
browser — is what turns it into evidence, and Phase 2 blocks that anyway.

### 2026-08-22 — Phase 1, first of three: an outage is no longer a verdict

Finding 3 closed. There were **two** silent conversions, not one, and fixing
either alone would have left the lie intact:

- `queue/gemini.ts` — `routeDeclaration` read a null payload (envelope failed
  schema validation, or the prompt was blocked) as `{ route: "inspiration" }`.
  The provider invented a verdict nobody reached.
- `routes/principles.ts` — `.catch(() => ({ route: "inspiration" }))` did the
  same thing one frame later for every thrown failure.

Now `DeclarationNotConsideredError` names the state, the provider throws
rather than inventing, and the route answers `503 { retryable: true }` and
**writes nothing** — a declaration the person can send again beats a note they
did not ask for.

Driven against the live stack with no `GEMINI_API_KEY`:

    before   201  {"created":"inspiration"}   + one row silently written
    after    503  {"error":"Not considered yet","retryable":true}   + 0 rows

The existing unit case was called "falls back to inspiration when routing
itself fails" and asserted the old contract, so it encoded the defect as
intent. It is rewritten with the reason at the site, and its load-bearing new
assertion is `inserted).toHaveLength(0)` — without that, the change would be
cosmetic.

The product rule it was protecting still holds: no **refusal** is ever shown.
That was always narrower than "say nothing", and the response carries no
verdict vocabulary — asserted.

**Still open in Phase 1:** the capture confirmation (finding 7) and the
`aria-live` regions that make any of these outcomes audible. The MCP live
gate's step 9 should now report the 503 rather than a wrong `created`, but
that is unverified — re-running it needs a key.

### 2026-08-22 — `world/three-layers` assessed: not needed, and stale

v2 named that branch a hard dependency. **Measured, it is the reverse** —
`dev` is ahead of it on every axis this goal cares about:

| | `origin/dev` | `origin/world/three-layers` |
|---|---|---|
| last commit | 2026-08-20 | 2026-08-16 |
| `Home.tsx` | 10,097 lines | 11,516 lines |
| web test files | 20 | 6 |
| canvas test net | `home-field` `home-light` `home-sky` `home-poster` `home-dial` `measured` `seam-gate` + `helpers/render-home` | none |
| `src/space` · `canvas` · `character` · `space-kinds` | 11 · 3 · 2 · 4 | 5 · 1 · 1 · 3 |

The branch is 502 commits "ahead" only in the sense that its history never
merged; the *work* landed on `dev` by another route (#261, #262). Six files
exist there and not on `dev`, and every one is superseded: three renumbered
migrations, a drizzle snapshot, and `lib/api.ts` + `lib/fixture.ts` — the
pre-refactor singles that `dev` replaced with `lib/api/` and `lib/fixture/`
directories.

`a-frontend-you-can-read.md` describes an 11,516-line `Home.tsx` and proposes
building a canvas test net. Both sentences describe that branch's state, and
`dev` has since passed them. **That goal doc is stale on `dev` and reads as
current, which is the trap this entry exists to disarm.** Phase 3 is not
blocked. The branch should be closed.

### 2026-08-22 — four decisions taken

- **Base:** `dev`. No dependency on `world/three-layers` (above).
- **Phase 2 gate:** no screen-reader user available, so automated proxies plus
  founder review stand in — recorded as weaker, with the real confirmation
  still owed. See the revised gate.
- **Password recovery:** deferred pending a mail provider. The lockout message
  that pointed at the missing feature is fixed.
- **Model key:** provided. Generation is now exercisable.

### 2026-08-22 — the model key closes the loop on finding 3

With `GEMINI_API_KEY` set, the same declaration that the old code filed
silently as a note:

    no key   503  {"error":"Not considered yet","retryable":true}   0 rows
    key set  201  {"created":"principle", type:"stance", state:"aspirational"}

So the statement **was** a principle. The old `.catch(() => inspiration)` was
not mishandling an edge case; it was misclassifying real principles as notes
for the whole duration of any outage, silently, with no way to tell afterwards.

**The MCP live gate now passes 9 of 9**, up from 6 of 9. Gates 6 and 7 were
the missing key; gate 9 was this defect.
