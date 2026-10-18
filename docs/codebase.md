# Organising this codebase

**The goal: a new engineer can find where a change belongs, and make it without
reading the whole product.**

That is the measure. Not file count, not line count — whether someone who has
never seen this repo can answer "where does this go?" and then change it
without a second file surprising them.

Today they cannot, and the evidence is in the bug history rather than in
anyone's opinion. In one session: memories from every space piled at the
origin because the layout learned about spaces and the renderer did not; both
profile tabs rendered at once because a rule set `display` on an element using
`hidden`, three separate times; a whole design pass landed in dev and not in
production because two stylesheets disagreed and bundle order decided. Every
one is the same shape — **one part of the codebase not knowing what another
part assumed.**

## Where it stands

```
13,663  packages/web/src/pages/Home.tsx     the entire product, one file
 3,043  packages/web/src/styles/global.css   tokens --ink / --rule / --paper
 1,755  packages/web/src/styles/home.css    tokens --jar-*
 1,684  packages/web/src/lib/api.ts
 1,098  packages/web/src/styles/chrome.css  tokens --w-*, repoints main's
```

Three token vocabularies for one product. One file holding a canvas renderer, a
physics loop, sprite baking, a palette, data loading, twenty pieces of React
state, and every panel's markup.

## The shape of the repo, and where the world sits in it

```
packages/api             100 source files   the backend: routes, db schema, generation
packages/web              35 source files   the product: Home.tsx, the flat screens
packages/admin             7 source files   internal tooling
packages/apis              0 source files   EMPTY — node_modules and nothing else
packages/design-system     0 source files   EMPTY — node_modules and nothing else
```

**Two of those five packages are ghosts.** No `package.json`, no source, never
imported — but `pnpm-workspace.yaml` globs `packages/*`, so they get
`node_modules` and appear in every listing as though they mean something.

They actively mislead. A `design-system` package is exactly where a new
engineer would look before writing styles, and finding it empty *after*
writing them is the wrong order. That is not hypothetical: this branch added
`chrome.css` and a token repoint without ever checking whether a design
system already existed, because the directory listing implied one did and the
absence of any import implied one did not, and neither signal was checked.

**Delete both.** They cost nothing to remove and every reader something to
ignore. If a design system is coming, an empty directory is not how to reserve
the name.

## Where this branch's changes live

Almost all of it lands in two files and their satellites:

| File | Lines | What it is |
| --- | --- | --- |
| `packages/web/src/pages/Home.tsx` | 13,600 | the entire product surface |
| `packages/web/src/styles/home.css` | 1,755 | the world's appearance |
| `packages/web/src/styles/chrome.css` | 1,098 | the flat screens in the world's light |
| ~~`packages/api/src/routes/groups.ts`~~ | — | rooms: DELETED 2026-10-15 with the rest of the room routes |
| `packages/web/src/lib/world-data.ts` | 406 | the one canon↔world translation |
| `packages/api/src/routes/feedback.ts` | +100 | who may answer whose statement |

The dependency is lopsided and worth naming: **everything in the world depends
on `Home.tsx`, and `Home.tsx` depends on almost nothing.** That is the shape
of a file that grew rather than one that was designed, and it is why the four
steps below are ordered the way they are.

## The order, safest first

Each step is independently valuable and independently revertable. Do them in
this order because each makes the next cheaper — and stop at any point without
leaving the repo worse.

### 1. A map (`docs/architecture.md`)

Highest value per hour, and it costs nothing to be wrong about. Forty lines
saying:

- the three layers are the three vertical sections: inspiration → **field**,
  signal → **sky**, top of mind → **headquarters**
- one column per mind: yours, each agent's, each room's
- `world-data.ts` is the ONLY translation between the canon's words and the
  world's
- `SimApi` is the boundary between React and the canvas; nothing crosses it
  another way
- what each package is for, and which screens are deliberately flat

Nobody can navigate the rest of this list without it.

### 2. `@layer` for CSS ownership

Declare `@layer base, product, chrome;` once (done — `styles/layers.css`), then
assign every stylesheet in ONE change. Not file by file: unlayered rules beat
all layers, so moving one file in while its neighbours stay out drops it below
them rather than raising it. Wrapping `chrome.css` alone was tried and
instantly reverted every override it exists to make. Precedence then stops
depending on import order — which is the bug that made a
design pass apply in dev and not in production, with identical source. It is a
handful of lines and it removes an entire category of failure.

### 3. One token vocabulary

`--ink`/`--rule`/`--paper`, `--jar-*` and `--w-*` describe the same product in
three languages, and `chrome.css` exists mostly to translate between
them. Collapse to one set. The translation layer then deletes itself.

### 4. Split `Home.tsx` — the decided shape

```
web/src/
  space/                what EVERY space has, one directory per layer
    inspiration/        orbs, layout, the memory panel, the capture mouth
    signal/             statements, verdicts, joining, proposals
    top-of-mind/        the poster, provenance, the version history
  space-kinds/          how spaces DIFFER
    self.ts
    agent.ts            machine hand · pixelated orbs · quantized motion
    group.ts            members · hues · legend · proposals
  character/            the companion — one creature, everywhere
    body.ts             its form, baked: dome, nubs, aura, the machine variant
    motion.ts           bob, lean, gaze, blink, breath
    reactions.ts        what it does at each moment: kept · answered ·
                        arrived · shared · let-go
  transition/           moving between spaces
  canvas/               the loop, sprites, camera, hit-testing
  lib/                  data.ts · words.ts · appearance.ts
  account/              the flat screens: profile, login
```

**No wrapper.** `world/` only existed to contrast with the archive, and the
archive is deleted — a word naming what something is NOT, once the something
else is gone. `space/` beside `account/` states the real split, spatial versus
flat, without a container to explain. It also ends the doubling: `lib/data.ts`,
not `world/lib/world-data.ts`.

**Canon words name the layer directories** — `inspiration`, `signal`,
`top-of-mind` — so one vocabulary runs from the database to the folder:
`api/routes/inspirations.ts` ↔ `space/inspiration/`. *Field*, *sky* and
*headquarters* stay as the words for WHERE these are drawn: spatial, and so
they belong in the UI and its comments rather than in paths.

**`group`, not `room`** — the API already says `groups.ts`, `group_members`,
`groupTopOfMindProposals`. One word, both ends. "Room" survives in what a
person reads on screen, which is a different register again.

**`canvas/`, not `sim`** — it names the real boundary in this app. Everything
in it happens on the canvas element; everything outside it is DOM. A new
engineer knows what is inside without being told.

**Everything under `space/` because there is never one of anything.** Seven
spaces are on screen right now. A group's inspirations and yours are the same
code with different contents — `presentBalls()` already filters one list by
`ball.agentId`, and the structure should say so.

**`character/` is one creature, and today proved it has to be one file.**
The companion is currently spread across the whole of `Home.tsx` — its being
and baking near the palette, its bob and lean inside the frame loop, its gaze
and blink further down, its reactions in the sim API, its whisper in the DOM.
Nothing owns it, and it shows: a body hashed from a group id rendered an
enormous blur over the poster; the nubs shipped as 1px specks and then vanished
entirely; an in-page motion toggle silently killed every animation in the
world and had to be deleted rather than fixed.

Every one of those was a change to the creature made in a place that could not
see the rest of the creature. Three files — what it IS, how it MOVES, what it
DOES when something happens — and each of those questions has one answer in
one place. Note that `body.ts` varies by space kind (an agent's space wears a
machine's form), so it reads `space-kinds/`; it does not duplicate it.

**`space-kinds/` fixes a bug class, not just tidiness.** "How does an agent's
space differ" is answered independently in at least six places today —
`isMachineWall`, `wornBeing`, `hasSky`, `hasDial`, the `data-kind` typography
selector, `mechAt`'s quantization — and they have disagreed in production: a
body hashed from a group id, typography and motion wired separately, "Our
agents" reading as a machine's space in one place and a human's in another.
One file owning what an agent's space IS makes that impossible, and a new kind
of space becomes a new file rather than a hunt through 13,000 lines.

### What goes where

Every major piece of `Home.tsx`, and its destination. Anything not listed is
either already in `lib/` or is page wiring that stays behind.

**`canvas/`** — the machinery. It knows orbs, light and time; it does not know
what a signal is.

| Now | Goes to |
| --- | --- |
| the `requestAnimationFrame` loop, `draw()` | `canvas/loop.ts` |
| `buildPalette`, `rasterOrb`, `rasterOrbPixel`, `rasterBloom`, `makeSprite`, `orbsForHue` | `canvas/sprites.ts` |
| `SIZE_R`, `TIERS`, `PIXEL_STEP`, `ORB_PAD` | `canvas/sprites.ts` |
| `camX/camY`, `aimTo`, `kd()`, wheel/drag/key handlers | `canvas/camera.ts` |
| `assignHomes`, `scatterX`, `presentBalls`, `electPeek` | `canvas/layout.ts` |
| `tap`, `findBall`, `select`, `release` | `canvas/hit.ts` |
| the `SimApi` interface itself | `canvas/index.ts` |

**`character/`** — one creature, three questions.

| Now | Goes to |
| --- | --- |
| `Being`, `OWNER_BEING`, `agentBeing`, `bakeBeing`, `worn`, `wornBeing`, the nubs, the aura | `character/body.ts` |
| `bobPh`, `charY`, `charOff`, `charLead`, `lean`, `pitch`, `charLift` | `character/motion.ts` |
| `eyeX/eyeY/eyeTX/eyeTY`, `blink`, `glance`, breath, `attendTo`, `attendHold` | `character/motion.ts` |
| `acknowledge(moment)`, the `Moment` union, `flare`, `relight` | `character/reactions.ts` |
| the whisper line (`charSay`) | `character/reactions.ts` |

**`space/`** — the three layers, one directory each.

| Now | Goes to |
| --- | --- |
| `Ball`, `makeBall`, `makeAgentBall`, `seedOf`, `colorBall`, aliveness | `space/inspiration/orb.ts` |
| the memory panel markup, `place()`, `markPassages`, `salience` | `space/inspiration/panel.tsx` |
| the capture mouth, `born`, `unborn`, the public/private choice | `space/inspiration/capture.tsx` |
| `Neb`, nebulae, `candidates`, clustering, `joinTo` | `space/signal/sky.ts` |
| verdicts, `sayVerdict`, `dropPattern`, the statement markup | `space/signal/statement.tsx` |
| poster, `posterWords`, `posterChain`, `versions`, the forming line | `space/top-of-mind/poster.tsx` |
| `adopted`, `notes`, entry editing | `space/top-of-mind/board.ts` |

**`space-kinds/`** — everything that answers "how does THIS kind differ".

| Now | Goes to |
| --- | --- |
| `isMachineWall`, `mechAt`, the `data-kind` typography rule, pixelated orbs | `space-kinds/agent.ts` |
| `machineRooms`, members, hues, the legend, `roomCompany`, proposals | `space-kinds/group.ts` |
| `hasSky`, `hasDial` and the other per-kind predicates | the file for the kind they describe |

**`transition/`** — `travel`, `goToWall`, `travelMs`/`travelSpanMs`, the axis
strip, the `walls` array, `arriveColumn`.

**`lib/`** — `world-data.ts` → `data.ts`; `world-words.ts` → `words.ts`;
`world-appearance.ts` → `appearance.ts`.

**Stays in the page** — the route component, top-level state, the effects that
load data, and the JSX that composes the above. It should end up short enough
to read in one sitting.

### Delete rather than move

Audited before the split, because moving dead code is the most expensive way
to discover it is dead.

**Already deleted this session**

| What | Why |
| --- | --- |
| `pages/Surface.tsx` (1,362) | the archive, superseded affordance by affordance |
| `styles/surface.css` (1,416) | all 77 classes unreferenced, still imported — every visitor downloaded it |
| `components/faces.ts` | `contributorColor`, `contributorPaper`, `contributorInitials` — zero importers |
| `lib/surface-route.ts` (72) | `parseSurfacePath`, `buildSurfacePath`, `SurfaceRoute` — routing for a page that no longer exists |
| `packages/apis`, `packages/design-system` | no `package.json`, no source, never imported |

**Keep, but know they are unreached**

`fetchReflections` and `refreshGroupTopOfMind` have zero callers. Neither is
dead in the same sense: `refreshGroupTopOfMind` became redundant when agreeing
with a statement started triggering synthesis automatically, and
`fetchReflections` answers a question the world has not yet been asked
("show me everything I have reflected on"). Deleting them removes a working
endpoint's only client; leaving them costs a few lines. Decide when the
surface for either exists — but do not carry them into the new structure
unexamined.

**Check during the move, not before**

The dead things that remain are the ones no grep will find: state that is set
and never read, refs assigned once, effects whose dependencies mean they never
re-run. Extraction surfaces those for free — a symbol nothing imports becomes
obvious the moment it has to be exported. Delete as you go rather than
scheduling a second pass.

### The order to move them

Dependencies point inward, so move from the outside in and nothing you have
already moved needs touching again:

1. `lib/` — rename, no logic change
2. `character/` — reads `canvas/` types but nothing reads it back
3. `space-kinds/` — pure predicates and constants
4. `space/*` — each reads `lib/` and `space-kinds/`
5. `transition/`
6. `canvas/` — biggest, last, and by then everything else is out of its way

### How to get there

Only after 1–3, because those make the seams visible. In dependency order:

- **`world/sim/`** — the rAF loop, sprite baking, palette, layout, ball state.
  The seam already exists: `SimApi`. This is moving code, not redesigning it.
- **`world/panels/`** — memory, sky, room, capture mouth. Independent markup
  that only reads state.
- **`world/state/`** — loaders and hooks: `loadRoom`, the ball-list build, hue
  assignment.

### What makes a module, rather than a pile

The test is not "are these functions small" — it is **does the group have ONE
reason to exist**, statable in a sentence, such that you can read the whole
file and know what belongs in it.

- `lib/world-words.ts` — *data turned into the words this world says.* Every
  function takes a fact and returns a phrase. It says "four days ago" and "you
  and your agent", never "4d" or "2 members".
- `lib/world-appearance.ts` — *whose memory this is, in colour.* Given a ramp
  and a member's slot, returns colours.

A good boundary asserts itself while you cross it. Lifting `dateWords` pulled
in `ordWords`, `yearWords` and `numWords`, and those pulled their word tables —
because they were always one thing. That is the boundary telling you where it
is, and it is why extraction should follow the compiler rather than a plan.

**Started.** `lib/world-appearance.ts` was the first piece out: the per-member
hue system, extracted because none of it touches React or the frame loop.
That is the test for whether something can leave — *does it need the loop or
the component?* If not, it belongs in `lib/`, and moving it is safe. Working
outward from the pure edges is why this can be done incrementally at all,
unlike the CSS layers above, which have to move all at once.
- what remains is a page that wires three things together, readable in one
  sitting.

## Rules worth keeping while doing it

- **Never set `display` on an element that uses the `hidden` attribute.** It is
  the weakest display declaration there is; any author rule silently disables
  it. This cost three separate bugs.
- **Never rely on import order for precedence.** Use `@layer` or specificity.
- **One fact, one owner.** The space a ball belongs to is decided in one place
  and read everywhere. When the layout knew and the renderer did not, the
  result was memories stacked at the origin.
- **A rule nobody can execute is a rule nobody has checked.** Route tests that
  inject mocks prove the route calls a function, not that the function is
  right. Extract the rule into a pure function so a test can run it.

## The newcomer test — run it before trusting the plan

Six real tasks. If the structure is right, each one names a single destination
without reading any code. Any task that lands in two places is a boundary in
the wrong spot.

| Task | Where |
| --- | --- |
| "Make an agent's memories look different" | `space-kinds/agent.ts` |
| "The companion should react when a group approves something" | `character/reactions.ts` |
| "Add a filter to the field" | `space/inspiration/` |
| "Change how long travel takes" | `transition/` |
| "A memory should say 'yesterday' not 'one day ago'" | `lib/words.ts` |
| "Add a fourth kind of space" | a new file in `space-kinds/` |

Three fail today, and each failure is a bug that has already happened:

- the first is answered in **six** places, which is why an agent's space read
  as machine in one and human in another
- the second is in **five**, which is why an in-page toggle killed every
  animation in the world
- the fourth is split between `travel`, `goToWall` and `arriveColumn`, which is
  why crossing several spaces was a queue of animations rather than one glide

**The gap this test does NOT close.** It tells a newcomer where code lives, not
what will break when they change it. The laws below are the answer to that
second question, and they are the part that is easy to skip: light is the only
meaning channel, motion explains rather than decorates, the world never moves
unless the user moved it. Someone who finds the right file and breaks a law has
still shipped a bug — and every one of those laws was learned by shipping one.

## How to know it worked

A new engineer, given "make an agent's memories render differently", can find
the file in under a minute and change it without touching the sim loop, the
data layer, or another space's behaviour.
