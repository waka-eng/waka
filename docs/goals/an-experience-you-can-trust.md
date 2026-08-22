# Goal: an experience you can trust, on a surface worth the world

Status: **draft v1 (2026-08-22).** Not started. Base `dev` @ `c6a64b2`.
Source: `docs/craft/e2e-experience-audit.md` — thirteen findings, driven
against a real stack on 2026-08-22. Every phase below closes findings by
number, and no finding leaves this goal unnamed.

Relates to `docs/goals/a-frontend-you-can-read.md`, which is unmerged on
`world/three-layers` and owns the *structure* of `packages/web` — the
vocabulary gate, the extraction of `Home.tsx`, and the canvas test net its
Phase 2 builds. This goal owns the *experience* and deliberately does not
restructure anything. Where the two touch, that goal wins on structure and
this one states what the structure has to be able to prove. Phase 5 here is
the one real dependency: it needs a canvas that can be rendered in a test,
which is exactly what that goal's Phase 2 delivers.

Canon unchanged. `docs/data-model.md` for the nouns, `docs/architecture.md`
for the laws and the three registers. Nothing here amends either. If a phase
finds it must, the phase halts and the canon is amended first.

## Why

Three forces, and they are not the same kind of problem.

1. **The product currently lies about its own state, in three places.** A
   signed-in person can land on `/` and get a black rectangle — no spinner,
   no error, no retry — because a third-party font host did not answer
   (finding 1). A person can declare a principle in their own words and have
   it filed as a note, with a `201` and no signal of any kind, because a
   model call failed and the catch treats an outage as a verdict (finding 3).
   A person can keep something — the one act the product exists for — and get
   a word so quiet they may not see it (finding 7). These are one family:
   **in each, the failure is indistinguishable from the success.** That is
   the property to remove, and it comes first, because everything else on
   this list is a matter of degree and these three are matters of truth.

2. **It is not yet one thing to look at.** Measured, not described: the
   world, `/login` and `/profile` sit at roughly `rgb(10,12,15)`; the six
   Surface routes sit at roughly `rgb(251,251,250)`. Opening the `≡` menu and
   choosing SIGNALS is a full-screen black-to-white flash, and coming back is
   the reverse (finding 4). The sign-in screen ranks its own submit button
   below the tab labels that switch away from it (finding 5). The world — a
   place you are meant to walk — navigates by a hamburger holding a flat list
   of six addresses, which opens on top of the one sentence it exists to show
   (finding 6). None of these is a bug in the sense that something computes
   the wrong answer. All of them are the difference between a product and a
   set of screens.

3. **The gate that should have caught the worst of it does not exist.** The
   blank world reproduces in a production build in under ten seconds, and no
   suite runs a production build. `tools/seed-demo.ts` — the README's own way
   in — was broken by migration `0007` and stayed broken because nothing
   covers it (finding 2, fixed 2026-08-22 in `4fc3c61`). Both are the same
   gap: the checks run against source, and the thing users get is a build.

## Shape of the work

Eight, counting 4b. The order is not by severity — it is by **what each phase
makes provable for the ones after it.**

Phase 0 stops the outage and, more importantly, makes chunk failure a thing
that can be seen at all. Phase 1 removes the rest of the silent-failure class
while the principle is fresh. Phase 2 is the theme decision, and it is
sequenced third rather than last because six of the remaining findings are
downstream of it — there is no point tuning the weight of a button on a
surface whose palette is about to change. Phases 3–5 are the craft passes,
each on a settled palette, and Phase 4 is the one that removes something
rather than adjusting it. Phase 6 closes the gates that would let any of it
regress.

**The rule that governs every phase: a fix must be provable by something
other than looking at the screen.** Every gate below is falsifiable and most
of them are a test that must fail on the commit before the fix. Where a gate
is a human judgment — Phase 2's is — it says so, and it says whose.

## The one decision that is not mine

**Phase 2 needs a founder call before it can start.** Six redesigns have been
rejected here for arriving with a position already taken, and the palette is
exactly the kind of thing that happens to. So this goal does not pick.

The measured fact is that the product is two palettes. The options, with what
each costs:

- **The world's dark palette everywhere.** `chrome.css` already does this for
  `/login` and `/profile`, and `docs/architecture.md` already claims it is
  what happens ("the world's palette without its geometry"). Cheapest to
  state, and it makes the doc true. Cost: the Surface routes are dense
  reading surfaces — lists of captures, a top-of-mind board — and long-form
  reading on near-black is a real ergonomic loss, not a taste one.
- **The Surface's light palette for all flat screens, dark reserved for the
  world.** Makes the split intentional: the world is a place, the flat
  screens are paper. Cost: `/login` and `/profile` move, and the transition
  into and out of the world stays a hard cut — it would need to become a
  deliberate passage rather than a flash.
- **One palette, both modes, chosen by the viewer.** Most work by a wide
  margin, and the only option that survives someone reading at night and
  someone reading in sun. Cost: every surface gets audited twice, and the
  world's light model — the product's only meaning channel — has to hold in
  both, which is not a given.

`docs/architecture.md` currently asserts the first. The build does the
second, partially. **Until that is settled, Phase 2 is blocked and Phases
3–5 are speculative.** Everything in Phase 0 and Phase 1 is independent of
it and can proceed today.

---

### Phase 0 — A failure you can see

Closes finding 1. Independent of every other phase.

Two fixes, and the second is the one that generalises.

- **Make chunk failure visible and recoverable.** There is no
  `ErrorBoundary`, `componentDidCatch`, or `getDerivedStateFromError`
  anywhere in `packages/web/src`, and no `vite:preloadError` listener —
  though Vite dispatches exactly that event, cancellable, before it rethrows.
  A boundary around the lazy routes turns a permanent blank into a legible
  failure with a retry. This fixes *every* chunk-load failure, not the font
  one: a stale `index.html` after a deploy produces the same black rectangle
  today.
- **Remove the third-party dependency from first paint.** Six families load
  from two hosts, all render-blocking (`packages/web/index.html:7-12,37-42`).
  Self-host the Latin faces used above the fold. Pretendard's dynamic subset
  is Korean and large, so it is the one to keep remote — but non-blocking,
  behind the fallback stack that `styles/` already declares
  (`-apple-system`, `Apple SD Gothic Neo`), which is a real fallback and not
  a hope.

Do the boundary first. It is smaller, it is what makes the bug *observable*,
and it is what keeps the next unrelated chunk failure from looking identical.

**Gate:** a test that boots the production build with every non-same-origin
request failing, and asserts the world renders its canvas. It must fail on
`c6a64b2` and pass after. A second assertion, on the boundary alone: with the
Home chunk itself made to reject, the page shows a named error and a retry
control — not `null`.

### Phase 1 — Nothing fails silently

Closes findings 3 and 7. Independent of Phase 2.

- **An outage is not a verdict.** `packages/api/src/routes/principles.ts:260-265`
  catches every provider failure into `{ route: "inspiration" }`, so a
  missing key, a rate limit and a considered rejection all produce the same
  row and the same `201`. Separate them. The product rule that **no refusal
  is ever shown** is not in question and does not need to change — "we could
  not consider this yet" is a different sentence from a refusal, and right
  now it is not sayable. The declaration should be retryable rather than
  quietly rewritten into a note the person did not ask for.
- **The core act should look like it happened.** Keeping something returns
  `201` and prints "kept" in small low-contrast type, with no motion and no
  change to the composition. Whatever replaces it obeys the laws: motion
  explains rather than decorates, and the world does not move unless the user
  moved it — keeping *is* the user moving it, so the field has grounds to
  answer.
- **Announce outcomes.** Zero `aria-live` regions exist anywhere. Every
  outcome in this phase needs one, or the fix lands for sighted users only.

**Gate:** no code path converts a provider failure into a product verdict —
enforced by a test that stubs the provider to throw and asserts the response
is distinguishable from a routing decision. And a capture, driven headlessly,
produces an assertion-visible confirmation in the accessibility tree.

### Phase 2 — One product, one palette

Closes finding 4. **Blocked on the decision above.**

Once the direction is chosen, this phase is mechanical and wide: the tokens
land in one place, the surfaces adopt them, and `docs/architecture.md` is
corrected in the same diff — it currently describes an arrangement the build
does not have, and whichever way the decision goes, one of the two is wrong
today.

If the answer is "both modes", this phase grows a second half: the light
model is the product's only meaning channel and has no test
(`a-frontend-you-can-read.md` Phase 2 proposes the pixel baseline it would
need). That is a dependency, not a detail.

**Gate:** every route's sampled background comes from one token set, asserted
by a test that walks the routes rather than by a reviewer's eye. The
architecture doc and the build agree.

### Phase 3 — The doors

Closes findings 5 and 10. Wants Phase 2 settled.

- **There is no password recovery.** Neither tab offers it and the word
  appears nowhere on the page. For an email-and-password product that is a
  terminal state, and it is the only finding in this document that locks a
  real person out of their own memory. It is the first thing in this phase
  and arguably the first thing in this goal that a user would thank anyone
  for.
- **The submit button is a footnote.** 40×16px, lowercase, bottom-left,
  ranked below the two tabs that navigate away from the form
  (`chrome.css:1019-1025`). Sign-in's primary action should read as the
  primary action.
- **One noun.** The eyebrow says "WAKA · Signals"
  (`i18n/messages/en-US.json:191`) above a title saying "Inspirations" and a
  line saying "your inspirations". `docs/architecture.md` is explicit that
  user-facing text says *inspiration* and that *signal* is a canon layer
  name; the one screen every user sees first uses a layer name as branding.
- The duplicate "New to WAKA? Create account." beneath a left-aligned form
  goes with it.

**Gate:** a password can be reset end to end against a running stack, driven,
not described. The sign-in submit is the highest-weight control in the form.
No screen shows two product nouns for one thing.

### Phase 4 — The menu goes away

Closes finding 6. Wants Phase 2 settled.

**The goal of this phase is that the `≡` control does not exist when it
ends.** Not that it stops overlapping the headline — the overlap is a symptom,
and treating it would preserve the thing causing it. A hamburger holding a
flat list of six addresses is what a product reaches for when it has not
decided where things live, and this world has decided: it is a place you walk,
and a menu of addresses is the opposite of a place.

The code already agrees. The comment above the control
(`Home.tsx:9648-9660`) calls it "the placeholder that keeps it usable
meanwhile" and says "DELETE THIS when `/principles` has a home in the world.
That is the real fix." This phase does the real fix.

**Most of the work is already done.** Of the six destinations the menu lists,
four look like duplicates of affordances the world already has:

| Menu entry | What the world appears to already have |
|---|---|
| CAPTURE | `KEEP SOMETHING` |
| TOP OF MIND | the headline you stand in, with `READ IT AGAIN` / `SAY IT IN MY WORDS` / `NOT THIS` |
| SIGNALS | `TWO PATTERNS ARE FORMING`, above the wall |
| INSPIRATIONS | the field itself — one orb per memory |

**Verify that affordance by affordance before deleting any of it.** Not
caution for its own sake: it is the exact method `docs/architecture.md`
records for deleting the archive — "the layout does everything it did,
verified affordance by affordance rather than by call site". The archive's
four routes were removed on that evidence and this is the same claim, so it
needs the same evidence. An entry whose world equivalent turns out to be
missing is a gap to close, not a link to keep.

That leaves two that are genuinely homeless:

- **ROOMS.** The world has `MAKE A ROOM` but no way to walk into one. Rooms
  are walls, and the world already draws an axis of walls along the bottom
  edge — `‹ DEMO AGENT` / `ME ›`. A room is a wall a few of you keep, so the
  axis is where it belongs, and this may be less new design than it sounds.
- **PRINCIPLES.** Layer 4, and the honest blocker. The world draws three
  layers; `docs/data-model.md` has four, and the third is where you stand.
  There is nowhere to put the fourth without deciding what it *is* spatially.
  This is the one part of Phase 4 that is a design question rather than a
  move. If it cannot be answered inside this phase, **the phase shrinks — the
  menu loses five entries and keeps one — it does not get abandoned.** A
  control with a single destination is a link, and a link can be named.

The routes themselves stay addressable either way. `/inspirations` and
`/signals` remain URLs a bookmark can reach; what goes away is the menu that
implies the world could not show you those things itself.

**Gate:** `≡`, `jar-flatmenu`, and `aria-label="Other screens"` do not appear
in `packages/web/src`, and each of the six destinations is reachable from the
world by an affordance named in a written walkthrough. If PRINCIPLES survives
as a single named link, the walkthrough says so and says why, and the gate is
the other five.

### Phase 4b — The hand

Closes finding 8. Independent of Phase 4's outcome.

**Destructive controls are 20×20px on touch, adjacent to non-destructive ones
at 21×21px, with no separation.** 21–22 controls per surface sit under 44px.
The undo (`Surface.tsx:2243`) and the `window.confirm` guards
(`Surface.tsx:333,501`) mean this is an ergonomics problem rather than a
data-loss one — "fading never deletes" is being honoured — but a mis-tap that
undo has to catch is still a mis-tap.

**Gate:** no interactive control under 44px in either axis on a 390px
viewport, asserted by a test that walks the routes.

### Phase 5 — The world, read aloud

Closes finding 9. **Depends on `a-frontend-you-can-read.md` Phase 2** for a
canvas that can be rendered in a test.

The world is one `<canvas>` with `role: null`, `aria-label: null` and no
fallback content; one `nav` landmark and no `main`. Everything the world
*means* — every memory in the field, its aliveness, every statement forming
in the sky, whose wall you are standing on — is painted pixels with no text
equivalent.

This is the largest and least certain phase in the goal, and it is sequenced
last deliberately. It is also the one where the founder laws bite hardest:
**light is the only meaning channel**, and a screen reader has no light. So
the work is not "label the canvas" — it is deciding what the world's meaning
*is* in a channel that has no brightness, and that is a design question, not
a remediation. It may well want its own goal.

**Gate:** the three layers are reachable and comprehensible without the
canvas — stated as a written walkthrough that a person using a screen reader
confirms, before any code. If that walkthrough cannot be written, the phase
halts and says so rather than shipping labels that describe nothing.

### Phase 6 — The gates that would have caught this

Closes findings 2 (already fixed), 11, 12. Independent of Phase 2.

- **Nothing runs the production build.** The blank world reproduces in one in
  under ten seconds. A smoke gate that builds, serves, signs in and asserts
  the world renders would have caught finding 1 on the commit that introduced
  it, and would catch the next one.
- **`tools/seed-demo.ts` is covered by no suite**, which is why `0007` broke
  the README's own way in and nothing failed. It is the first thing a new
  contributor runs.
- **The fixture data decision.** `personal-data-needs-a-volume-knob` is
  declared `active` on two evidence rows against a bar of three. It now seeds
  `emerging` with a warning naming it. Either give it a third evidence row or
  declare it emerging — a data call, not a code one.
- **`43%` has no legend.** `/signals` prints a raw confidence with nothing
  saying what it is a percentage of or what would change it, beside two
  things that read fine without one. Either it earns an explanation or it
  stops being shown.

**Gate:** the production-build smoke gate runs in CI and fails on `c6a64b2`.
`pnpm demo:seed` is exercised by a test against a freshly migrated database.

---

## Out of scope

Named so their absence is not mistaken for a judgment that they are fine.

- **The rooms journey.** No seeded room has a second member, so the sharing
  boundary — what crosses and what must not — was read in the audit, not
  driven. It is the highest-stakes surface in the product for privacy and it
  deserves its own audit against a two-account stack, before it deserves a
  plan. Nothing in this goal touches it.
- **The consent page's missing decline control** (finding 13). Real, minor,
  and it resolves on its own via the client's timeout. It belongs to whoever
  next opens `auth-cli.ts`; it does not justify a phase.
- **Everything downstream of a model call.** Derivation, synthesis, minting
  and enrichment were never exercised — no `GEMINI_API_KEY`. Their UX is
  unaudited, so this goal has no opinion about it. Finding 3 is about the
  *failure* path, which is reachable without a key.
- **Google OAuth.** Not configured, never pressed, no findings.
- **Restructuring `packages/web`.** That is `a-frontend-you-can-read.md`.

## Rules

1. **A fix ships with the thing that proves it.** Every phase gate above is
   falsifiable. A phase whose gate is "it looks right now" is not done.
2. **A gate that cannot fail on the old commit is not a gate.** Where a phase
   fixes an observed defect, the test demonstrates the defect first.
3. **The canon does not lose an argument to the code.** If a phase needs
   `docs/data-model.md` or `docs/architecture.md` to say something different,
   the document changes first, in its own diff, with the reason.
4. **Phase 2's decision is not made by whoever picks up the work.** It is
   made once, by the founder, and written into this file's log before any
   token moves.
5. **No phase widens.** Phase 3 fixes the doors; it does not redesign
   sign-up. If a phase discovers work outside its findings, it is logged
   here, not absorbed.

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
