# Goal: everything in the world

Status: **Phase 2 passed (2026-08-23).** Phase 3 next. Replaces `one-world.md`, whose premise was wrong.
Branch: `claude/repo-sync-qlndc3`. Base `dev` @ `c6a64b2`.
Source: `docs/craft/e2e-experience-audit.md` — thirteen findings, driven
against a real stack. **Three closed, ten open.** Every phase below closes
findings by number, and no finding leaves this goal unnamed.

**What replaced what.** `everything-in-the-world.md` said "the flat screens are deprecated"
and gated the work behind making the world readable by a screen reader. Both
premises are gone:

- **The flat screens are not being deleted. They are the parking lot.** The
  `≡` menu is a holding pen: a feature parks there until it has been designed
  into the world, and leaves the moment it has. The routes stay addressable
  throughout. The goal is that nothing *needs* them, not that nothing *has*
  them.
- **Screen readers are out of scope**, by founder decision, recorded as a
  decision and not a gap. Finding 9 stays in the audit as a known, accepted
  state. It is not a gate on anything here and is not raised again.

The bar for "designed into the world" is set once, here, because every phase
is measured against it: **the feature is reachable and usable from `/` without
visiting a flat route, and that was seen in a browser rather than reasoned
about.** The four entries removed on 2026-08-22 each cleared exactly that bar,
and the first attempt to check them got it wrong — it compared
`document.body.innerText` and missed a placeholder and two canvas draws. What
counts as evidence here is a screenshot or an assertion, not a reading.

## What is actually left

Measured, not remembered — every row re-checked against the tree at v1:

| # | Finding | State |
|---|---|---|
| 1 | The world blanks when a font CDN is unreachable | **closed** — `SurfaceBoundary` + `preload-recovery`, gated by `e2e:first-paint` |
| 2 | `pnpm demo:seed` broken by migration `0007` | **closed** |
| 3 | A declared principle silently filed as a note | **closed** — `503 retryable`, nothing written |
| 6 | The `≡` menu | **closed** — the control is gone; nothing matches `jar-flatmenu` in `packages/web/src` |
| 4 | Two palettes — world dark, flat screens near-white | open |
| 5 | Sign-in's submit is the weakest control; no password recovery | open (lockout copy fixed) |
| 7 | Keeping something confirms almost invisibly | **closed in the world** — the orb now arrives, which is the confirmation the design always intended. The flat screen's quiet "kept" is untouched and no longer the path that matters |
| 14 | **Nobody knows the world can be moved through** — real user feedback, 2026-08-23 | **closed 2026-08-24** — three separate invisible failures; `journeys:ways-out` gates it. The neighbouring *wall* still does not peek past the side edges the way the field peeks past the bottom; recorded, not attempted |
| 15 | The first memory a person ever keeps does not appear until reload | **closed** — a clock-skew bug; `journeys:first-keep` gates it |
| 8 | 21–22 touch targets under 44px; destructive ones at 20px | open |
| 9 | The world is one unlabelled canvas | **out of scope, by decision** |
| 10 | Three product nouns on the sign-in screen | open |
| 11 | `/signals` prints a raw `43%` with no legend | open |
| 12 | The demo fixture declares an impossible signal state | open — a data call |
| 13 | The consent page has no decline control | out of scope — too small for a phase |

## Shape of the work

Phase 1 empties the holding pen, because that is the thing being asked for and
because the two features left in it are the only ones that do not exist in the
world at all. Phase 2 is the capture confirmation, which is the same class of
defect as finding 3 and belongs beside it. Phase 3 is the palette, which is
sequenced after the menu because with rooms and principles in the world there
is less flat surface left to have a palette. Phase 4 is the doorway. Phase 5
is the hand. Phase 6 closes the gates.

**Every phase ships with the thing that proves it**, and where a phase fixes an
observed defect the test demonstrates the defect first — the standard Phase 0
of the old goal was held to and met, twice.

---

### Phase 1 — Empty the holding pen

Closes finding 6. The whole of it: `≡`, `jar-flatmenu`, and
`aria-label="Other screens"` leave `packages/web/src`.

Two features are parked and neither exists in the world:

- **Rooms.** `MAKE A ROOM` exists; there is no way to walk into one. Rooms are
  walls, and the world already draws an axis of walls along the bottom edge
  (`jar-axis`, `Home.tsx:9849`) with `groups` already loaded into the page
  (`Home.tsx:1292`). The data and the surface are both already there, so this
  is a move rather than new design: a room takes its place on the axis beside
  your agents and you, and travelling to it is travelling.
- **Principles.** Layer 4, and the world draws three. `docs/data-model.md` has
  four layers and the third is where you stand, so there is nowhere to put the
  fourth without deciding what it *is* spatially. This is the one genuine
  design question in the goal. A principle is what survives the top of mind —
  the same material, further along — so the honest candidates are near where
  you stand rather than a fourth region.

**Gate:** `grep -r "jar-flatmenu\|Other screens" packages/web/src` returns
nothing, and a browser walkthrough reaches rooms and principles from `/`
without touching a flat route. If principles cannot be answered in this phase,
**the phase ships with the menu holding one entry** and says so — it does not
stall, and it does not delete a feature to make a gate pass.

### Phase 2 — Keeping something looks like it happened

Closes finding 7.

`201` comes back and the word "kept" appears in small low-contrast type, with
no motion and no change to the composition — for the single act the product
exists for. In the world, `KEEP SOMETHING` opens an inline field, so the
answer lives there rather than on a flat screen.

The laws bind here: motion explains rather than decorates, and the world never
moves unless the user moved it — **keeping is the user moving it**, so the
field has grounds to answer. A memory that has just landed becoming an orb is
the world explaining itself, not decoration.

**Gate:** a `journeys` case that fails on the current build and passes after,
asserting the confirmation is visible in the world after a keep.

### Phase 3 — One palette

Closes finding 4.

Measured: the world, `/login` and `/profile` at ~`rgb(10,12,15)`; the six
Surface routes at ~`rgb(251,251,250)`. Crossing between them is a full-screen
black-to-white flash.

With Phase 1 done, the flat routes are a parking lot rather than a
destination, which changes the sum: the cheap answer is to bring them onto the
world's palette, and `chrome.css` already does exactly that for `/login` and
`/profile`. `docs/architecture.md` also already claims this is what happens —
so the doc and the build disagree today, and this phase makes one of them
right.

**Gate:** every route's sampled background comes from one token set, asserted
by a test that walks the routes. `architecture.md` and the build agree.

### Phase 4 — The doorway

Closes findings 5 and 10. `/login` is the one screen that cannot be in the
world — there is no memory to stand in before you are authenticated.

- **Password recovery does not exist**: no route, no token table, no mail
  transport. It is the only finding that locks a real person out of their own
  memory. **Deferred by decision** pending a mail provider; the lockout
  message that pointed at the missing feature is already fixed. When a
  provider is chosen this is the first thing built.
- **The submit button is a footnote** — 40×16px, lowercase, bottom-left,
  ranked below the two tabs that navigate away from the form
  (`chrome.css:1019-1025`).
- **One noun.** The eyebrow says "WAKA · Signals"
  (`i18n/messages/en-US.json:191`) over a title saying "Inspirations" and a
  line saying "your inspirations". The first screen anyone sees uses a canon
  layer name as branding.

**Gate:** sign-in's submit is the highest-weight control in the form; no
screen shows two product nouns for one thing.

### Phase 5 — The hand

Closes finding 8. **Destructive controls are 20×20px on touch, beside
non-destructive ones at 21×21px, with no separation** — 21–22 under 44px per
surface. Undo (`Surface.tsx:2243`) and the `window.confirm` guards
(`Surface.tsx:333,501`) make this ergonomics rather than data loss; a mis-tap
that undo has to catch is still a mis-tap.

Sequenced late because Phase 1 and Phase 3 move these controls, and measuring
targets that are about to move is measuring twice.

**Gate:** no interactive control under 44px in either axis at 390px, asserted
by a test that walks the routes.

### Phase 6 — The gates, and the last two findings

Closes findings 11 and 12, and wires what exists into CI.

- **`e2e:first-paint` and `e2e:journeys` run in CI.** Both exist, both fail
  correctly on the old commit, neither runs automatically. `ci.yml` already
  holds `secrets.GEMINI_API_KEY`, so the model-spending suites are wireable
  too.
- **Register the five unnamed suites** — `signals`, `top-of-mind`, `groups`,
  `cold-start`, `principles` run only as raw `tsx` invocations. A gate nobody
  can name is a gate nobody runs.
- **`43%` has no legend** (finding 11). In the world a percentage is a numeral
  where the law says a state should render, so it becomes a state or it stops
  being shown.
- **The fixture data call** (finding 12): `personal-data-needs-a-volume-knob`
  is `active` on two evidence rows against a bar of three. It seeds `emerging`
  with a warning naming it. Either give it a third evidence row or declare it
  emerging.

**Gate:** the browser gates run in CI and fail on `c6a64b2`. Every suite is
reachable by a named script.

---

## Out of scope

- **Finding 9, the world's accessibility.** Founder decision, recorded above.
- **Finding 13**, the consent page's missing decline control — real, minor,
  and it resolves through the client's timeout.
- **Google OAuth and the real image-upload path** — unproven, and owned by
  `every-workflow-works.md`, not here.
- **Deleting the flat routes.** They are the parking lot and they stay
  addressable. If they ever go, that is a separate decision made after nothing
  needs them.

## Rules

1. **"In the world" means seen in a browser.** A reading of the source is not
   evidence; the first check of the four removed entries was a reading and it
   was wrong.
2. **A fix ships with the thing that proves it**, and the proof fails on the
   commit before the fix.
3. **Nothing leaves the holding pen before its replacement is verified.** Per
   feature, in the commit that proves it.
4. **The canon does not lose an argument to the code.** Phase 3's amendment to
   `docs/architecture.md` lands in its own diff, with the reason.
5. **A phase that cannot finish ships smaller and says so.** It does not stall,
   and it does not delete a feature to make a gate pass.

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

### 2026-08-22 — the menu is a holding pen, and it is emptying

Two corrections from the founder, and both change the plan rather than the
code.

**1. The menu is not a wart. It is a staging area.** "The menu exists today so
I can safely store existing features before I design them into our world
experience." So the goal was never "delete the control" — it is "empty it".
An entry leaves the moment its feature exists in the world, and the control
goes when the last one does. That is also what the code always said:
"DELETE THIS when `/principles` has a home in the world."

**2. Screen readers are explicitly out of scope.** "I don't care about screen
reader. The features just need to exist somewhere in the world version."
Recorded as a **decision, not a gap**: Rule 6 and the Phase 2 block are
withdrawn as gates. Finding 9 stays in the audit as a known, accepted state.
This entry is the last time it is raised.

#### Four entries removed, each on evidence

Verified in a browser first, because the earlier claim that these duplicated
the world was a hypothesis and was logged as one:

| Entry | The world's equivalent | How it was seen |
|---|---|---|
| capture | `KEEP SOMETHING` | opens an inline "Something worth keeping" field |
| signals | `TWO PATTERNS ARE FORMING` | opens the sky; every statement standing in it |
| inspirations | an orb in the field | opens that memory, with `reflect on this · more` |
| top of mind | the headline you stand in | already there — and this entry was **circular**: `surface-route.ts` resolves the wall view to `/`, so it linked to the world from inside the world |

The first probe of this reported all four as doing nothing, which was wrong:
it compared `document.body.innerText`, and three of the four change a
placeholder or draw on canvas. Screenshots settled it.

**The routes stay addressable.** `/capture`, `/inspirations`, `/signals`,
`/top-of-mind` all still serve 200. What is gone is the world implying it
needed a list to do these things.

#### What is still parked, and why

- **rooms** — `MAKE A ROOM` exists, but there is no way to walk into one.
  Rooms are walls and the world already draws an axis of walls along the
  bottom edge, so that is where they belong. A move, not new design.
- **principles** — layer 4, and the world draws three. Nowhere to put it
  without deciding what it *is* spatially. This is the real design question
  and the last thing standing between here and deleting the control.

#### Also fixed

The sheet was `88%` opaque with an 8px blur, so a 48px headline read straight
through six lines of 11px menu type and neither was legible. It is opaque now,
with a hairline and a shadow. Translucency is right for something floating in
the world; this is chrome laid over it, and chrome occludes.

A shift to move it off the headline was tried and **reverted**: the `h1` box
is full-width (400–1040 at 1440px), so no horizontal offset clears it. The
overlap remains, on a transient user-initiated panel now two lines tall,
scheduled for deletion.

### 2026-08-22 — v1: `one-world.md` replaced, because its premise was wrong

Two founder corrections retired both of that goal's load-bearing assumptions
in one turn, so it was rewritten rather than patched.

It said **"the flat screens are deprecated."** They are not. They are the
parking lot: the `≡` menu is a holding pen where a feature waits until it has
been designed into the world, and the routes stay addressable throughout. The
goal is that nothing *needs* a flat route, not that none exists. That is a
different piece of work with a different finish line.

It also **gated the entire migration on making the world readable by a screen
reader** — its Rule 6, written so the block could not be negotiated away. The
founder put finding 9 out of scope. The gate is withdrawn, the finding stays
in the audit as a known accepted state, and this is the last entry that
mentions it.

What survives unchanged: the thirteen findings, the three that are closed, and
the standard of evidence. What is new is the bar, stated once because every
phase is measured against it — **reachable and usable from `/` without
visiting a flat route, seen in a browser.** That bar exists because the first
check of the four removed entries was a source reading, and source readings
are how this goal gets fooled.

Re-measured against the tree at v1 rather than carried over: 3 findings
closed, 2 out of scope, **8 open**, and the holding pen down to rooms and
principles.

### 2026-08-22 — Phase 1 passed: the holding pen is gone

`≡`, `jar-flatmenu` and `aria-label="Other screens"` no longer appear in
`packages/web/src`. 84 lines of JSX, 73 of CSS, and one piece of state.

**Rooms were already there, and my note saying otherwise was wrong.** The
goal said "there is no way to walk into one." `walls` has pushed
`kind: "group"` for every group since before this goal existed
(`Home.tsx:1472`) — agents left, you at the origin, rooms right. The demo
account simply had zero rooms, so the right-hand side of the axis was empty
and I read an empty axis as a missing feature. Driven:

    axis before   ["ME"]
    make a room from the world, "What is it about?"
    axis after    ["ME", "THE READING ROOM"]
    travel in     THE READING ROOM · Forming — nothing read together yet · ‹ ME

Create, join and travel were all already in the world (`submitGroup` handles
both `make` and `join`). Nothing was built for rooms. The entry left because
it never needed to be there.

**Principles needed a design, and this is it: layer 4 lives where you stand.**

The world draws three sections because the canon's first three are *places* —
memories below, statements above, the sentence you are standing in. Layer 4 is
not a fourth place. A principle is what is left of the top of mind once the
weather has passed: the same material, further along. So it belongs where the
top of mind already is.

It is built from two pieces the page already had, on purpose: a
`jar-forming-line` (the quiet line that opens the sky) and the `jar-prov` band
(what the poster opens into). Somebody who learned that the forming line takes
them up has already learned this one.

- **`how you choose`**, under the top of mind, on your own wall only. A room
  does not choose; an agent's principles are its own.
- **No count.** *States render, numerals never* — the line says there is a way
  you choose, not how many. Asserted: no `N. ` numbering in the rendered text.
- **Nothing when there are none**, rather than an empty band — the same rule
  the poster follows about never inventing a placeholder.
- `aspirational` carried through, because declared-but-not-yet-demonstrated is
  a different claim from earned and the canon already has the word.

One craft defect found and fixed by looking rather than reasoning:
`.jar-forming-line` is `inline-block` because there had only ever been one, so
the second rendered flush against the first — **`TWO PATTERNS ARE
FORMINGHOW YOU CHOOSE`**, two ways in read as one broken word. It takes its own
row now via a modifier, not a separator: these are two different layers, and a
middot between them would say they are the same kind of thing.

#### Gate

    ≡ present                     0
    capture / signals / principles / make a room, from "/"   all present
    wall axis                     ["DEMO AGENT","ME"]
    canvas                        1
    /capture /inspirations /signals /top-of-mind /rooms /principles   all 200

The routes stay addressable, which was always the point: the parking lot keeps
working, and nothing needs it. Regression: `e2e:journeys` 7/7,
`e2e:first-paint` 2/2, web 130/130, vocabulary and seams clean.

### 2026-08-23 — Phase 2, part 1: the case is written and it fails

Not done. The gate's failing case exists and reproduces; the fix does not.

#### What keeping something actually does in the world today

Driven on a brand-new account. The keep succeeds — `201 /api/inspirations` —
and then:

    note        null      (`setMouthNote` is only ever set on FAILURE)
    field       null      (the mouth closes)
    aria-live   []        (there are none anywhere)
    the field   unchanged

**Nothing acknowledges it at all.** This is *worse* in the world than on the
flat screen, which at least prints "kept" in small type. The audit recorded
finding 7 as "confirms almost invisibly"; in the world it does not confirm.

#### And the reason is a bug, not a missing flourish — finding 15

The design already intends the confirmation. `Home.tsx:9060` says the mouth
sits on the seam so "what you type sits just above where the orb it becomes
will appear: **the geography teaches itself in one beat** and there is no
tutorial anywhere."

That beat is broken. Field brightness read off the canvas, bottom quarter:

| account | before keep | after keep | after reload |
|---|---|---|---|
| **brand new** (empty field) | 0.07 | **0.05** — nothing | **1.95** |
| demo (≈50 memories) | 3.39 | **5.11 → 5.73** — orb arrives | 3.40 |

So `born()` draws the orb when the field already has memories, and does not
when it is empty. **The very first memory anybody keeps vanishes until they
reload.** It is the one capture that most needs to land, and it is the only
one that does not.

Cause not yet isolated, and I am not going to guess at it in this log.
`born()` (`Home.tsx:6432`) pushes the ball, calls `assignHomes()` and
`wake()`; `assignHomes` returns early only at `n === 0`; the sim effect's
guard (`!root || !canvas || !inspirations || !agents`) resolves on a fresh
account. Something between those is not re-solving the ground for the first
ball, and finding it needs a session with instrumentation inside the loop
rather than pixel-reading from outside.

**The case is written**: `journeys:first-keep`, asserting the field brightens
after the first keep of a new account. On the current build:

    FAIL 1. the very first memory a person keeps appears in the field
            — fieldLight 0.02 -> 0.05 (reload shows ~1.95)

Its `--negative` sabotage is the keep POST itself, so the journey fails
identically whether the bug is present or the write is broken — which is
correct: from the person's side those are the same experience.

#### Finding 14 — nobody knows the world can be moved through

Real user feedback, 2026-08-23: *"they had no idea they can go left, right,
up, bottom."* Unstarted, and the most valuable signal in this document
because it came from somebody using the thing rather than from a harness.

**It is partly finding 15.** The world's own answer to "how would anyone know
there is a field below?" is that you keep something and watch it drop there —
the sentence quoted above. For every new user that beat does not happen, so
the world's one self-teaching moment is exactly the one that is broken. Fixing
15 is a prerequisite for judging how much of 14 is left.

What remains of 14 after that is a real design question and is not answered
here: the axis along the bottom edge already maps the horizontal walls, the
sky is reachable from the forming line, and neither apparently reads as "you
can go there". Owned by this goal; it needs its own phase and probably its own
measurement, because "did they know they could move" is not something the
existing gates can see.

### 2026-08-23 — Phase 2 passed: it was a clock-skew bug, and it hit everyone

The confirmation the design always intended now happens. **One line of code,
after two hours of looking in the wrong place** — worth writing down, because
the wrong places were all plausible.

#### The instrument was already in the repo

Pixel-reading the canvas from outside told me *that* nothing was drawn and
never *why*. `SimApi.audit()` has existed all along and is reachable as
`window.wakaField()` behind `showsDebug()` — so `VITE_SHOW_INTERNAL=1 pnpm
dev:local` puts it in a real build. It answered in one run:

    after keep    owners {"(none)":1}   present 0   drawn.active 0
    after reload  present 1  onScreen 1  drawn.active 1  highest 804  lowest 888

The ball **was in the list**. `assignHomes` was filtering it out.

#### The cause

`assignHomes` places only what exists at the dial's time —
`b.capturedMs <= TRef.current`. That is correct and is what lets the dial wind
history back. `TRef` starts at `Date.now()` on mount and is advanced in
exactly two places: the dial, and `born`.

`born` advances it with the **client's** optimistic stamp. The row that comes
back carries the **server's** `createdAt`. Measured on one machine:

    client before POST  1787525750805
    server createdAt    1787525750811     <- +6ms AHEAD
    client after  POST  1787525750820

And `inspirations` is a dependency of the sim effect, so the keep's own
`setInspirations` tears the loop down and rebuilds it — rebuilding that ball
from the server's timestamp, now sitting in the future of a dial that had only
ever been told about the client's. Six milliseconds was enough. Across a
network it is routinely far more.

#### It hit every keep, not just the first

This is the part I had wrong all afternoon. The newest orb was dropped on
**every** capture, on every account. It was only *visible* on the first,
because with fifty memories already in the ground `present` is 49-of-50 and
the field still lights, while with none it is 0-of-1 and the world answers a
person's first capture with nothing at all. I had recorded it as "born fails
when the field is empty", which was the symptom and not the bug.

#### The fix

One clamp, where the list and the clock meet: whatever the loop was just
handed, the dial's now is at least as late as the newest thing in it. It only
ever moves `TRef` forward, and only to something that exists, so winding back
is untouched.

    for (const b of list) TRef.current = Math.max(TRef.current, b.capturedMs);

#### Gate

    positive   fieldLight 0.03 -> 1.12   PASS   (reload shows ~1.95)
    negative   fieldLight 0.03 -> 0.04   journey fails, as required

Regression: `e2e:journeys` **8/8**, `e2e:first-paint` 2/2, web 130/130,
vocabulary and seams clean.

#### What this leaves of finding 14

The world's one self-teaching moment now works: you keep something and watch
it drop into the field below you. That was the whole of "the geography teaches
itself in one beat", and for every new user the beat was missing.

How much of *"no idea they can go left, right, up, bottom"* that closes is now
an open question rather than a guess — and it needs to be asked of a person,
not of a harness. Left/right along the wall axis and up to the sky are still
unaddressed. Finding 14 stays open and unstarted.

### 2026-08-24 — finding 14 closed, and it was three bugs

The user's sentence was *"no idea they can go left, right, up, bottom"*. I had
assumed one cause. There were three, and what they had in common is the part
worth keeping: **not one of them threw, moved a count, or turned a suite red.**
Every failure here was a thing that was supposed to be SEEN and wasn't, and
the entire test suite was green through all of it.

#### Left and right — a hover that could never happen

The signposts were already designed and already built: `‹ Demo Agent` at the
margin the wall lives past, `Add an agent` / `Make a room` below it. They sat
at `opacity: 0`, revealed by `.jar-hq:hover .jar-edge`.

`.jar-hq` carries `pointer-events: none`. An element that takes no pointer
never matches `:hover`. **That selector had never fired once, on any pointer
device, in the life of the file.** The only reason the signposts were visible
anywhere was a `@media (hover: none)` fallback — so they worked on a phone and
had never been drawn on a desktop.

The affordance that teaches you the world is wider was gated behind already
knowing.

#### …and one class name doing two jobs

Turning them on printed `‹ DEMO AGENT` straight through `ADD AN AGENT`.
`home.css` held **two complete, conflicting `.jar-edge` blocks** 280 lines
apart, each with its own header claiming the name — one a vertical rail
anchored to a margin, one a horizontal name placed from its wall's column.
Later won, property by property: a way out inherited `writing-mode:
vertical-rl` and became a 10px stripe; the right-hand one held its own inline
`left` **and** the rail's `right: 10px`, was anchored twice, and stretched
flat. Both looked like layout bugs. Neither was.

The horizontal signposts are `.jar-way` now. The two things each margin
carries are separated: travel at eye level, growing the axis below it.

#### Up — and the fix that looked broken while working perfectly

Measured at headquarters, canvas pixels: top edge **0.05**, bottom edge
**7.20**. The ground announced itself 144× more loudly than the sky, whose
lowest statement rested ~340px above the viewport.

So: `peekY` on `Neb`, the lowest two per wall elected in `layoutSky`, eased
toward the seam by `stepSky` against the same camera scalar `peekLift` uses.
Built it, measured it, and the top edge went **0.05 → 0.07**.

It was working. `rasterNebula` bakes alpha as `peak · (1−u)^2.4` under a mask
already at zero by the rim — past about half a radius there is no light left
in the sprite. Hanging the clouds at `0.62r` put the whole on-screen band
inside that dead zone. A temporary probe proved the clouds were reaching their
`peekY` to the pixel, in a part of themselves that cannot be seen.

`0.28r`, named and commented with the measurement, because the number is the
entire fix and looks arbitrary without it. Top edge **0.05 → 0.73**; the top
6% strip reads **1.42**.

One more thing the fix surfaced: at full lean a statement's DOM sentence was
sliced mid-line by the viewport and printed under the chrome. The words now
fade as the cloud leans down and resolve as you climb. Light is the only thing
that crosses the seam; reading the sentence is what going up there is for.

#### Gate

`journeys:ways-out`, whose sabotage **is the original bug** —
`.jar-edge, .jar-way { opacity: 0 }` — rather than an invented one:

    positive   2 ways out visible, none overlapping; sky leaning (1) but EMPTY
    negative   invisible: MAKE A ROOM, ADD AN AGENT   journey fails, as required

It also says out loud when the sky half checked nothing, so a vacuous pass can
never read as a clean one — a fresh account has no statements to elect, and
the `lean` scalar is asserted regardless so ripping the mechanism out is
distinguishable from having nothing to show. `FieldAudit` gained a `sky` block
for the same reason `provenanceCount` is in it: this is a promise whose
failure looks exactly like a quiet screen. The temporary probe is gone; that
block replaced it, behind the same `showsDebug()` gate as the rest.

Confirmed at 1440×900 and 390×844, and on the climb.

Regression: `e2e:journeys` **9/9**, vocabulary clean.

#### What this leaves open

The horizontal fix restores signposts that were designed and built. It does
**not** make the neighbouring wall itself peek past the left and right edges
the way the field peeks past the bottom — that would be the world's own idiom
rather than chrome, and it is a larger change touching culling, physics, and
the question of whose memories are whose. Recorded, not attempted, not
pretended.
